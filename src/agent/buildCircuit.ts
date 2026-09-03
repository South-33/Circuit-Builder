import { circuitStore } from '../circuit/store';
import { BREADBOARD_HOLE_PITCH, breadboardHoleNet, getBreadboardGeometry, isBreadboardType } from '../breadboard/geometry';
import type { CircuitConnection, CircuitPart, PartAttrs, PartType, WirePoint } from '../circuit/types';
import { evaluateLayout } from '../layout/quality';
import { inferWireKind, signalWireColor, standardWireColor, type WireRole } from '../wires/conventions';
import { endpointParts, endpointPoint, partRect, pinExitDirection, pinIsFlexible, type CardinalDirection } from '../wires/geometry';
import { simplifyWirePoints } from '../wires/path';
import {
  BLOCK_CELL_PX,
  blockDefinition,
  blockPlacement,
  blockRect,
  blockRectsOverlap,
  compactBlockInventory,
  normalizeRightAngle,
  partBlockAt,
  type BlockCell,
} from './geometry';
import {
  agentPartType,
  agentPartTypeEnum,
  applyArduinoCode,
  canonicalEndpoint,
  parseAttrs,
  parseRole,
  requireId,
  requirePartType,
  requireString,
} from './input';
import { toolResult } from './protocol';
import { parseCircuitProgram, type ProgramRail, type ProgramRailBridge } from './program';
import { routeWires, type RoutedWire } from './router';
import { withCircuitTransaction } from './transaction';
import type { ToolDefinition } from './types';

type BlockPart = {
  id: string;
  type: PartType;
  at?: BlockCell;
  rotate: number;
  attrs?: PartAttrs;
  seat?: { breadboardId: string; pin: string; hole: string };
};

type BlockWire = {
  id?: string;
  netId?: string;
  from: string;
  to: string;
  role?: WireRole;
  color?: string;
  via?: BlockCell[];
  viaPx?: WirePoint[];
  /** Compiler-owned: a local bus tap may enter its already-selected nearby strip directly. */
  directBoardEntry?: boolean;
};

type BlockNet = {
  id: string;
  endpoints: string[];
  role?: WireRole;
  color?: string;
};

type WireTune = {
  wireId: string;
  lane: 'longest-horizontal' | 'longest-vertical';
  by: number;
};

type PinAlignment = {
  from: string;
  to: string;
  axis: 'x' | 'y';
};

function requireCell(value: unknown, name: string): BlockCell {
  if (Array.isArray(value) && value.length === 2) {
    const [x, y] = value;
    if (Number.isInteger(x) && Number.isInteger(y)) return { x: x as number, y: y as number };
  }
  if (value && typeof value === 'object') {
    const raw = value as Record<string, unknown>;
    if (Number.isInteger(raw.x) && Number.isInteger(raw.y)) return { x: raw.x as number, y: raw.y as number };
  }
  throw new Error(`${name} must be an integer cell [x,y].`);
}

function parsePart(raw: unknown, index: number): BlockPart {
  if (!raw || typeof raw !== 'object') throw new Error(`parts[${index}] must be an object.`);
  const value = raw as Record<string, unknown>;
  const seatRaw = value.seat && typeof value.seat === 'object' ? value.seat as Record<string, unknown> : null;
  const seat = seatRaw ? {
    breadboardId: requireId(seatRaw.breadboardId, `parts[${index}].seat.breadboardId`),
    pin: requireString(seatRaw.pin, `parts[${index}].seat.pin`),
    hole: requireString(seatRaw.hole, `parts[${index}].seat.hole`),
  } : undefined;
  if (!seat && value.at === undefined) throw new Error(`parts[${index}] needs at:[x,y] or seat.`);
  return {
    id: requireId(value.id, `parts[${index}].id`),
    type: requirePartType(value.type, `parts[${index}].type`),
    ...(value.at !== undefined ? { at: requireCell(value.at, `parts[${index}].at`) } : {}),
    rotate: normalizeRightAngle(typeof value.rotate === 'number' ? value.rotate : 0),
    ...(parseAttrs(value.attrs) ? { attrs: parseAttrs(value.attrs) } : {}),
    ...(seat ? { seat } : {}),
  };
}

function parsePath(value: unknown, name: string) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${name} must be an array of integer [x,y] cells.`);
  const cells = value.map((point, index) => requireCell(point, `${name}[${index}]`));
  for (let i = 0; i < cells.length - 1; i++) {
    if (cells[i].x !== cells[i + 1].x && cells[i].y !== cells[i + 1].y) {
      throw new Error(`${name}[${i}] -> ${name}[${i + 1}] is diagonal. Use horizontal/vertical runs only.`);
    }
  }
  return cells;
}

function parseWire(raw: unknown, index: number): BlockWire {
  if (!raw || typeof raw !== 'object') throw new Error(`wires[${index}] must be an object.`);
  const value = raw as Record<string, unknown>;
  if (value.via !== undefined && value.path !== undefined) {
    throw new Error(`wires[${index}] must use via or legacy path, not both.`);
  }
  return {
    ...(value.id !== undefined ? { id: requireId(value.id, `wires[${index}].id`) } : {}),
    from: requireString(value.from, `wires[${index}].from`),
    to: requireString(value.to, `wires[${index}].to`),
    ...(parseRole(value.role) ? { role: parseRole(value.role) } : {}),
    ...(typeof value.color === 'string' ? { color: value.color } : {}),
    ...(value.via !== undefined ? { via: parsePath(value.via, `wires[${index}].via`) } : {}),
    ...(value.path !== undefined ? { via: parsePath(value.path, `wires[${index}].path`) } : {}),
  };
}

function parseNet(raw: unknown, index: number): BlockNet {
  if (!raw || typeof raw !== 'object') throw new Error(`nets[${index}] must be an object.`);
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.endpoints) || value.endpoints.length < 2) {
    throw new Error(`nets[${index}].endpoints must contain at least two partId:pinName terminals.`);
  }
  return {
    id: requireId(value.id, `nets[${index}].id`),
    endpoints: value.endpoints.map((endpoint, endpointIndex) => requireString(endpoint, `nets[${index}].endpoints[${endpointIndex}]`)),
    ...(parseRole(value.role) ? { role: parseRole(value.role) } : {}),
    ...(typeof value.color === 'string' ? { color: value.color } : {}),
  };
}

/**
 * Expand a semantic net into physical two-terminal edges.
 *
 * Supply nets are source-rooted: the first endpoint is the source and every
 * later endpoint is a consumer. Spatial chaining made ordinary device pins
 * look like hidden distribution junctions. Other buses remain spatial chains
 * until they gain a more specific physicalizer.
 */
function expandNet(
  net: BlockNet,
  parts: CircuitPart[],
  reservedSignalJunctionColumns = new Map<string, Set<number>>(),
  signalJunctionBundles = new Map<string, {
    half: 'upper' | 'lower';
    columnsByPartId: Map<string, number>;
  }>(),
): BlockWire[] {
  const endpoints = Array.from(new Set(net.endpoints.map((endpoint) => canonicalEndpoint(endpoint, parts))));
  if (endpoints.length < 2) throw new Error(`Net ${net.id} needs at least two distinct terminals.`);
  if (net.role === 'power' || net.role === 'ground') {
    return endpoints.slice(1).map((endpoint, index): BlockWire => ({
      id: `${net.id}-${index + 1}`,
      netId: net.id,
      from: endpoints[0],
      to: endpoint,
      role: net.role,
      ...(net.color ? { color: net.color } : {}),
    }));
  }
  const boards = parts.filter((part) => isBreadboardType(part.type));
  const endpointPartIds = endpoints.map((endpoint) => endpointPartId(endpoint));
  const rootParsed = endpointParts(endpoints[0]);
  const rootPart = parts.find((part) => part.id === rootParsed?.partId);
  if (net.role === 'signal' && endpoints.length >= 4 && endpoints.length <= 5 && boards.length === 1
    && endpointPartIds.every((id) => id !== boards[0].id)) {
    const board = boards[0];
    const geometry = getBreadboardGeometry(board.type)!;
    const located = endpoints.map((endpoint) => {
      const parsed = endpointParts(endpoint)!;
      const part = parts.find((candidate) => candidate.id === parsed.partId)!;
      const point = endpointPoint(endpoint, parts);
      if (!point) throw new Error(`Cannot resolve exact pin geometry for ${endpoint}.`);
      const seatedHole = part.seating?.breadboardId === board.id ? part.seating.pins[parsed.pinName] : undefined;
      return { endpoint, partId: parsed.partId, point, seatedHole };
    });
    const boardCenterY = board.top + geometry.height / 2;
    const seatedHalves = located.flatMap((item) => item.seatedHole
      ? [(['A', 'B', 'C', 'D', 'E'].includes(item.seatedHole[0].toUpperCase()) ? 'upper' : 'lower') as 'upper' | 'lower']
      : []);
    const averageY = located.reduce((sum, item) => sum + item.point.y, 0) / located.length;
    const bundleKey = `${board.id}|${Array.from(new Set(endpointPartIds)).sort().join(',')}`;
    const existingBundle = signalJunctionBundles.get(bundleKey);
    const upperVotes = seatedHalves.filter((value) => value === 'upper').length;
    const lowerVotes = seatedHalves.length - upperVotes;
    const half: 'upper' | 'lower' = existingBundle?.half
      ?? (upperVotes !== lowerVotes ? (upperVotes > lowerVotes ? 'upper' : 'lower') : (averageY < boardCenterY ? 'upper' : 'lower'));
    const rows = half === 'upper' ? ['A', 'B', 'C', 'D', 'E'] : ['F', 'G', 'H', 'I', 'J'];
    const rowPreference = [rows[2], rows[1], rows[3], rows[0], rows[4]];
    const occupiedHoles = new Set<string>();
    for (const part of parts) {
      if (part.seating?.breadboardId !== board.id) continue;
      for (const hole of Object.values(part.seating.pins)) occupiedHoles.add(hole);
    }
    const reserved = reservedSignalJunctionColumns.get(board.id) ?? new Set<number>();
    reservedSignalJunctionColumns.set(board.id, reserved);
    const bundle = existingBundle ?? { half, columnsByPartId: new Map<string, number>() };
    if (!existingBundle) signalJunctionBundles.set(bundleKey, bundle);

    const columnPointX = (column: number) => endpointPoint(`${board.id}:${rows[2]}${column}`, parts)?.x ?? 0;
    const junctionHoleClear = (hole: string) => {
      if (occupiedHoles.has(hole)) return false;
      const point = endpointPoint(`${board.id}:${hole}`, parts);
      if (!point) return false;
      // These strips are entry anchors for wires arriving from external parts.
      // The exact router gives every unrelated component about half a physical
      // pitch of visual clearance, so the semantic allocator must reserve the
      // same space. Otherwise it can choose a perfectly empty hole beside a
      // mounted LED/module that the router is then forced to reject.
      const externalEntryClearance = BREADBOARD_HOLE_PITCH * 0.55;
      return !parts.some((part) => {
        if (part.seating?.breadboardId !== board.id) return false;
        const rect = partRect(part);
        return point.x >= rect.x - externalEntryClearance && point.x <= rect.x + rect.width + externalEntryClearance
          && point.y >= rect.y - externalEntryClearance && point.y <= rect.y + rect.height + externalEntryClearance;
      });
    };
    const columnFree = (column: number) => column >= 1 && column <= geometry.columns
      && !reserved.has(column)
      && rows.every((row) => junctionHoleClear(`${row}${column}`));
    const chooseColumn = (item: typeof located[number]) => {
      const paired = existingBundle?.columnsByPartId.get(item.partId);
      const itemPart = parts.find((candidate) => candidate.id === item.partId);
      const boardRect = partRect(board);
      const itemRect = itemPart ? partRect(itemPart) : undefined;
      // Keep a small connector bank free at a breadboard's left/right edge for
      // supply and return feeds. Shared buses from a controller beside the board
      // otherwise grab columns 1/2, while power/ground must land just outside
      // them, reversing the source-pin order and creating unavoidable crossings.
      // Above/below modules and seated parts do not consume this side ingress.
      const edgeIngressColumns = Math.min(5, Math.max(2, Math.floor(geometry.columns / 6)));
      const minimumColumn = itemRect && itemRect.x + itemRect.width <= boardRect.x ? edgeIngressColumns + 1 : 1;
      const maximumColumn = itemRect && itemRect.x >= boardRect.x + boardRect.width
        ? geometry.columns - edgeIngressColumns
        : geometry.columns;
      const candidates = Array.from({ length: geometry.columns }, (_, index) => index + 1)
        .filter((column) => column >= minimumColumn && column <= maximumColumn)
        .filter(columnFree)
        .sort((a, b) => {
          const pairedCostA = paired === undefined ? 0 : Math.abs(a - paired) * BREADBOARD_HOLE_PITCH * 100;
          const pairedCostB = paired === undefined ? 0 : Math.abs(b - paired) * BREADBOARD_HOLE_PITCH * 100;
          return pairedCostA + Math.abs(columnPointX(a) - item.point.x)
            - pairedCostB - Math.abs(columnPointX(b) - item.point.x);
        });
      const column = candidates[0];
      if (!column) throw new Error(`Net ${net.id} could not allocate a local breadboard junction near ${item.endpoint}.`);
      reserved.add(column);
      return column;
    };

    const junctions = located.map((item) => {
      const column = chooseColumn(item);
      if (!existingBundle) bundle.columnsByPartId.set(item.partId, column);
      const usedRows = new Set<string>();
      return { ...item, column, usedRows };
    }).sort((a, b) => columnPointX(a.column) - columnPointX(b.column) || a.point.y - b.point.y);

    const wires: BlockWire[] = [];
    const holeAvailable = (junction: typeof junctions[number], row: string) => (
      !junction.usedRows.has(row) && !occupiedHoles.has(`${row}${junction.column}`)
    );
    const takeRow = (junction: typeof junctions[number], preferred = rowPreference) => {
      const row = preferred.find((candidate) => holeAvailable(junction, candidate));
      if (!row) throw new Error(`Net ${net.id} needs another free hole on strip ${junction.column}.`);
      junction.usedRows.add(row);
      return row;
    };

    // Give every device a short tap into a fully exposed local strip. Even a
    // seated module gets a nearby breakout strip rather than using spare holes
    // hidden underneath its body as trunk anchors.
    for (const [index, junction] of junctions.entries()) {
      const tapRows = [...rows].sort((a, b) => {
        const ay = endpointPoint(`${board.id}:${a}${junction.column}`, parts)?.y ?? junction.point.y;
        const by = endpointPoint(`${board.id}:${b}${junction.column}`, parts)?.y ?? junction.point.y;
        return Math.abs(ay - junction.point.y) - Math.abs(by - junction.point.y);
      });
      const row = takeRow(junction, tapRows);
      wires.push({
        id: `${net.id}-tap-${index + 1}`,
        netId: net.id,
        from: junction.endpoint,
        to: `${board.id}:${row}${junction.column}`,
        role: net.role,
        directBoardEntry: true,
        ...(net.color ? { color: net.color } : {}),
      });
    }

    // Link the local strips in physical x order. Each segment uses the same row
    // at both ends when possible, producing a visible horizontal backbone. At a
    // middle strip the next segment uses another hole on the same connected
    // strip, so no physical hole has two wires inserted into it.
    for (let index = 0; index < junctions.length - 1; index++) {
      const left = junctions[index];
      const right = junctions[index + 1];
      const commonRow = rowPreference.find((row) => holeAvailable(left, row) && holeAvailable(right, row));
      const leftRow = commonRow ?? takeRow(left);
      const rightRow = commonRow ?? takeRow(right);
      if (commonRow) {
        left.usedRows.add(commonRow);
        right.usedRows.add(commonRow);
      }
      wires.push({
        id: `${net.id}-trunk-${index + 1}`,
        netId: net.id,
        from: `${board.id}:${leftRow}${left.column}`,
        to: `${board.id}:${rightRow}${right.column}`,
        role: net.role,
        ...(net.color ? { color: net.color } : {}),
      });
    }
    return wires;
  }
  if (net.role === 'signal' && boards.length === 1
    && rootPart?.seating?.breadboardId === boards[0].id && rootParsed) {
    const rootHole = rootPart.seating.pins[rootParsed.pinName];
    return endpoints.slice(1).flatMap((endpoint, index): BlockWire[] => {
      const parsed = endpointParts(endpoint);
      const part = parts.find((candidate) => candidate.id === parsed?.partId);
      const hole = part?.seating?.breadboardId === boards[0].id && parsed
        ? part.seating.pins[parsed.pinName]
        : undefined;
      if (rootHole && hole && breadboardHoleNet(rootHole) === breadboardHoleNet(hole)) return [];
      return [{
        id: `${net.id}-${index + 1}`,
        netId: net.id,
        from: endpoints[0],
        to: endpoint,
        role: net.role,
        ...(net.color ? { color: net.color } : {}),
      }];
    });
  }
  if (net.role === 'signal' && endpoints.length <= 5 && boards.length === 1
    && endpointPartIds.every((id) => id !== boards[0].id)) {
    const board = boards[0];
    const geometry = getBreadboardGeometry(board.type)!;
    const located = endpoints.map((endpoint) => ({ endpoint, point: endpointPoint(endpoint, parts)! }));
    const boardCenterY = board.top + geometry.height / 2;
    const averageY = located.reduce((sum, item) => sum + item.point.y, 0) / located.length;
    const half: 'upper' | 'lower' = averageY < boardCenterY ? 'upper' : 'lower';
    const rows = half === 'upper' ? ['A', 'B', 'C', 'D', 'E'] : ['F', 'G', 'H', 'I', 'J'];
    const ordered = [...located].sort((a, b) => a.point.y - b.point.y);
    const assignedRows = ordered.length === 1
      ? [rows[2]]
      : ordered.map((_, index) => rows[Math.round(index * (rows.length - 1) / (ordered.length - 1))]);
    const reserved = reservedSignalJunctionColumns.get(board.id) ?? new Set<number>();
    reservedSignalJunctionColumns.set(board.id, reserved);
    const occupiedHoles = new Set<string>();
    for (const part of parts) {
      if (part.seating?.breadboardId !== board.id) continue;
      for (const hole of Object.values(part.seating.pins)) occupiedHoles.add(hole);
    }
    let bestColumn = -1;
    let bestCost = Number.POSITIVE_INFINITY;
    let bestTie = Number.POSITIVE_INFINITY;
    const targetX = located.reduce((sum, item) => sum + item.point.x, 0) / located.length;
    for (let column = 1; column <= geometry.columns; column++) {
      if (reserved.has(column)) continue;
      if (assignedRows.some((row) => occupiedHoles.has(`${row}${column}`))) continue;
      const cost = ordered.reduce((sum, item, index) => {
        const point = endpointPoint(`${board.id}:${assignedRows[index]}${column}`, parts)!;
        return sum + Math.abs(point.x - item.point.x) + Math.abs(point.y - item.point.y);
      }, 0);
      const centerPoint = endpointPoint(`${board.id}:${rows[2]}${column}`, parts)!;
      const tie = Math.abs(centerPoint.x - targetX);
      if (cost < bestCost - 0.01 || (Math.abs(cost - bestCost) <= 0.01 && tie < bestTie)) {
        bestCost = cost;
        bestTie = tie;
        bestColumn = column;
      }
    }
    if (bestColumn < 0) {
      throw new Error(`Net ${net.id} could not find one electrically free breadboard strip for ${endpoints.length} shared signal endpoints.`);
    }
    reserved.add(bestColumn);
    return ordered.map((item, index): BlockWire => ({
      id: `${net.id}-${index + 1}`,
      netId: net.id,
      from: item.endpoint,
      to: `${board.id}:${assignedRows[index]}${bestColumn}`,
      role: net.role,
      ...(net.color ? { color: net.color } : {}),
    }));
  }
  const located = endpoints.map((endpoint, index) => {
    const point = endpointPoint(endpoint, parts);
    if (!point) throw new Error(`Cannot resolve exact pin geometry for ${endpoint}.`);
    return { endpoint, index, point };
  });
  const xs = located.map((item) => item.point.x);
  const ys = located.map((item) => item.point.y);
  const horizontal = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys);
  located.sort((a, b) => horizontal
    ? a.point.x - b.point.x || a.point.y - b.point.y || a.index - b.index
    : a.point.y - b.point.y || a.point.x - b.point.x || a.index - b.index);
  return located.slice(0, -1).map((item, index): BlockWire => ({
      id: `${net.id}-${index + 1}`,
      netId: net.id,
      from: item.endpoint,
      to: located[index + 1].endpoint,
      ...(net.role ? { role: net.role } : {}),
      ...(net.color ? { color: net.color } : {}),
    }));
}

/**
 * Turn one semantic supply rail into a source feed and one branch per consumer.
 * Hole choice is geometry, not circuit intent, so the compiler owns it. Each
 * endpoint gets the nearest unused physical rail hole to keep drops short and
 * prevent hidden fanout on an ordinary terminal.
 */
/**
 * Turn semantic supply rails into source feeds and branch drops.
 * Hole choice is geometry, not circuit intent, so the compiler owns it.
 *
 * Ordered multi-rail compilation:
 * When multiple conductors from the same component (such as paired feeds from
 * an Arduino/battery, or multi-conductor peripheral cables like a servo or
 * potentiometer) connect to parallel rails on the same breadboard:
 * 1. Conductors approaching from the top/bottom are assigned distinct columns
 *    matching their physical left-to-right spatial order to eliminate vertical
 *    lane overlap and crossings.
 * 2. Peripherals placed laterally outside the breadboard (left or right)
 *    receive clean horizontal rail corridors along each rail's axis, keeping
 *    supply and ground branches straight, parallel, and untwisted.
 */
function expandRails(rails: ProgramRail[], parts: CircuitPart[]): BlockWire[] {
  const result: BlockWire[] = [];
  const railsByBoard = new Map<string, ProgramRail[]>();
  for (const rail of rails) {
    const list = railsByBoard.get(rail.breadboardId) ?? [];
    list.push(rail);
    railsByBoard.set(rail.breadboardId, list);
  }

  for (const [breadboardId, boardRails] of railsByBoard) {
    const board = parts.find((part) => part.id === breadboardId);
    if (!board || !isBreadboardType(board.type)) {
      throw new Error(`Rail references unknown breadboard ${breadboardId}.`);
    }
    const geometry = getBreadboardGeometry(board.type)!;

    for (const rail of boardRails) {
      if (!/^[+-](?:top|bottom)$/.test(rail.rail)) {
        throw new Error(`Rail ${rail.id} name must be +top, -top, +bottom, or -bottom.`);
      }
    }

    // A column is one visible cable-entry lane across a +/- rail pair. Reserve
    // it once per board edge so power and ground cannot be assigned on top of
    // each other and then be rejected by the layout evaluator.
    const usedColumns = new Map<'top' | 'bottom', Set<number>>([
      ['top', new Set<number>()],
      ['bottom', new Set<number>()],
    ]);
    const railEdge = (railName: string): 'top' | 'bottom' => railName.includes('bottom') ? 'bottom' : 'top';

    type ConnectionRequest = {
      railId: string;
      railName: string;
      role: WireRole;
      isFeed: boolean;
      index?: number;
      rawEndpoint: string;
      endpoint: string;
      targetPartId?: string;
      targetPoint: WirePoint;
      exit: CardinalDirection | null;
    };

    const requests: ConnectionRequest[] = [];
    for (const rail of boardRails) {
      const role: WireRole = rail.rail.startsWith('+') ? 'power' : 'ground';
      const sourceEndpoint = canonicalEndpoint(rail.source, parts);
      const sourcePoint = endpointPoint(sourceEndpoint, parts);
      if (!sourcePoint) throw new Error(`Rail ${rail.id} cannot resolve source ${rail.source}.`);
      const sourcePartId = endpointParts(sourceEndpoint)?.partId;
      const sourcePart = parts.find((part) => part.id === sourcePartId);
      const sourceExit = sourcePart?.seating ? null : pinExitDirection(sourceEndpoint, parts);
      requests.push({
        railId: rail.id,
        railName: rail.rail,
        role,
        isFeed: true,
        rawEndpoint: rail.source,
        endpoint: sourceEndpoint,
        targetPartId: sourcePartId,
        targetPoint: sourcePoint,
        exit: sourceExit,
      });

      rail.consumers.forEach((consumer, index) => {
        const consumerEndpoint = canonicalEndpoint(consumer, parts);
        const consumerPoint = endpointPoint(consumerEndpoint, parts);
        if (!consumerPoint) throw new Error(`Rail ${rail.id} cannot resolve consumer ${consumer}.`);
        const consumerPartId = endpointParts(consumerEndpoint)?.partId;
        const consumerPart = parts.find((part) => part.id === consumerPartId);
        const consumerExit = consumerPart?.seating ? null : pinExitDirection(consumerEndpoint, parts);
        requests.push({
          railId: rail.id,
          railName: rail.rail,
          role,
          isFeed: false,
          index,
          rawEndpoint: consumer,
          endpoint: consumerEndpoint,
          targetPartId: consumerPartId,
          targetPoint: consumerPoint,
          exit: consumerExit,
        });
      });
    }

    const bundleKey = (req: ConnectionRequest) => {
      const edge = req.railName.includes('bottom') ? 'bottom' : 'top';
      const kind = req.isFeed ? 'feed' : 'branch';
      return req.targetPartId ? `${edge}:${kind}:${req.targetPartId}` : null;
    };

    const bundles = new Map<string, ConnectionRequest[]>();
    for (const req of requests) {
      const key = bundleKey(req);
      if (!key) continue;
      const list = bundles.get(key) ?? [];
      list.push(req);
      bundles.set(key, list);
    }

    const assignedHoles = new Map<ConnectionRequest, number>();

    const pickHole = (req: ConnectionRequest, minCol?: number, maxCol?: number): number => {
      const used = usedColumns.get(railEdge(req.railName))!;
      const target = req.targetPoint;
      const exit = req.exit;
      const candidates = Array.from({ length: geometry.railHoles }, (_, index) => index + 1)
        .filter((hole) => !used.has(hole))
        .filter((hole) => minCol === undefined || hole >= minCol)
        .filter((hole) => maxCol === undefined || hole <= maxCol)
        .map((hole) => {
          const boardEndpoint = `${board.id}:${req.railName}${hole}`;
          const point = endpointPoint(boardEndpoint, parts)!;
          const targetPart = parts.find((part) => part.id === req.targetPartId);
          const targetRect = targetPart ? partRect(targetPart) : null;
          const boardRect = partRect(board);
          const componentIsRight = targetRect ? targetRect.x >= boardRect.x + boardRect.width : false;
          const componentIsLeft = targetRect ? targetRect.x + targetRect.width <= boardRect.x : false;
          const wrongSide = exit === 'left' ? point.x > target.x - BLOCK_CELL_PX
            : exit === 'right' ? point.x < target.x + BLOCK_CELL_PX
              : exit === 'up' ? point.y > target.y - BLOCK_CELL_PX
                : exit === 'down' ? point.y < target.y + BLOCK_CELL_PX
                  : false;
          const wrongExternalLane = componentIsRight ? point.x >= target.x
            : componentIsLeft ? point.x <= target.x
              : false;
          return {
            hole,
            distance: Math.abs(point.x - target.x) + (wrongSide || wrongExternalLane ? 100_000 : 0),
          };
        })
        .sort((a, b) => a.distance - b.distance || a.hole - b.hole);
      const chosen = candidates[0];
      if (!chosen) throw new Error(`Rail ${req.railName} on ${board.id} has no available hole.`);
      used.add(chosen.hole);
      return chosen.hole;
    };

    for (const [, bundle] of bundles) {
      if (bundle.length < 2) continue;
      bundle.sort((a, b) => a.targetPoint.x - b.targetPoint.x);
      const edge = railEdge(bundle[0].railName);
      const used = usedColumns.get(edge)!;
      const averageX = bundle.reduce((sum, req) => sum + req.targetPoint.x, 0) / bundle.length;
      const available = Array.from({ length: geometry.railHoles }, (_, index) => index + 1)
        .filter((hole) => !used.has(hole))
        .map((hole) => ({
          hole,
          distance: Math.abs(endpointPoint(`${board.id}:${bundle[0].railName}${hole}`, parts)!.x - averageX),
        }))
        .sort((a, b) => a.distance - b.distance || a.hole - b.hole)
        .slice(0, bundle.length)
        .map((candidate) => candidate.hole)
        .sort((a, b) => a - b);
      if (available.length !== bundle.length) {
        throw new Error(`Rail pair on ${board.id} has no room for the ${bundle.length}-wire ${edge} cable.`);
      }
      for (let index = 0; index < bundle.length; index++) {
        const hole = available[index];
        used.add(hole);
        assignedHoles.set(bundle[index], hole);
      }
    }

    for (const req of requests) {
      if (assignedHoles.has(req)) continue;
      const hole = pickHole(req);
      assignedHoles.set(req, hole);
    }

    for (const req of requests) {
      const hole = assignedHoles.get(req)!;
      const boardEndpoint = `${board.id}:${req.railName}${hole}`;
      const targetPart = parts.find((p) => p.id === req.targetPartId);
      const targetPoint = req.targetPoint;
      const railPoint = endpointPoint(boardEndpoint, parts)!;
      const isCablePeripheral = targetPart
        && !targetPart.seating
        && !isBreadboardType(targetPart.type)
        && !targetPart.type.includes('arduino')
        && pinIsFlexible(req.endpoint, parts);
      const boardRect = partRect(board);
      const targetRect = targetPart ? partRect(targetPart) : null;
      const outsideRight = targetRect ? targetRect.x >= boardRect.x + boardRect.width : targetPoint.x > boardRect.x + boardRect.width;
      const outsideLeft = targetRect ? targetRect.x + targetRect.width <= boardRect.x : targetPoint.x < boardRect.x;
      const outsideBelow = targetRect ? targetRect.y >= boardRect.y + boardRect.height : targetPoint.y > boardRect.y + boardRect.height;
      const outsideAbove = targetRect ? targetRect.y + targetRect.height <= boardRect.y : targetPoint.y < boardRect.y;
      const externalRailCorner = isCablePeripheral && (outsideRight || outsideLeft)
        ? [{
            x: targetPoint.x,
            y: railPoint.y,
          }]
        : isCablePeripheral && (outsideAbove || outsideBelow)
          ? [{
              x: railPoint.x,
              y: targetPoint.y,
            }]
        : undefined;

      if (req.isFeed) {
        if (req.endpoint !== boardEndpoint) {
          result.push({
            id: `${req.railId}-feed`,
            netId: req.railId,
            from: req.endpoint,
            to: boardEndpoint,
            role: req.role,
            ...(externalRailCorner ? { viaPx: externalRailCorner } : {}),
          });
        }
      } else {
        result.push({
          id: `${req.railId}-branch-${(req.index ?? 0) + 1}`,
          netId: req.railId,
          from: boardEndpoint,
          to: req.endpoint,
          role: req.role,
          ...(externalRailCorner ? { viaPx: externalRailCorner } : {}),
        });
      }
    }
  }

  return result;
}

/** Join split top/bottom rails around a board edge without occupying its work area. */
function expandRailBridge(bridge: ProgramRailBridge, parts: CircuitPart[]): BlockWire {
  const board = parts.find((part) => part.id === bridge.breadboardId);
  if (!board || !isBreadboardType(board.type)) {
    throw new Error(`Bridge ${bridge.id} needs breadboard ${bridge.breadboardId}.`);
  }
  const geometry = getBreadboardGeometry(board.type)!;
  const hole = bridge.side === 'left' ? 1 : geometry.railHoles;
  const from = `${board.id}:${bridge.polarity}bottom${hole}`;
  const to = `${board.id}:${bridge.polarity}top${hole}`;
  const fromPoint = endpointPoint(from, parts)!;
  const toPoint = endpointPoint(to, parts)!;
  const outsideX = bridge.side === 'left'
    ? board.left - BLOCK_CELL_PX * 2
    : board.left + geometry.width + BLOCK_CELL_PX * 2;
  return {
    id: bridge.id,
    netId: bridge.id,
    from,
    to,
    role: bridge.polarity === '+' ? 'power' : 'ground',
    viaPx: [
      { x: outsideX, y: fromPoint.y },
      { x: outsideX, y: toPoint.y },
    ],
  };
}

function parseTune(raw: unknown, index: number): WireTune {
  if (!raw || typeof raw !== 'object') throw new Error(`tune[${index}] must be an object.`);
  const value = raw as Record<string, unknown>;
  const lane = value.lane;
  if (lane !== 'longest-horizontal' && lane !== 'longest-vertical') {
    throw new Error(`tune[${index}].lane must be longest-horizontal or longest-vertical.`);
  }
  if (!Number.isInteger(value.by) || value.by === 0) throw new Error(`tune[${index}].by must be a non-zero integer cell count.`);
  return { wireId: requireId(value.wireId, `tune[${index}].wireId`), lane, by: value.by as number };
}

function parseAlignment(raw: unknown, index: number): PinAlignment {
  if (!raw || typeof raw !== 'object') throw new Error(`align[${index}] must be an object.`);
  const value = raw as Record<string, unknown>;
  if (value.axis !== 'x' && value.axis !== 'y') throw new Error(`align[${index}].axis must be x or y.`);
  return {
    from: requireString(value.from, `align[${index}].from`),
    to: requireString(value.to, `align[${index}].to`),
    axis: value.axis,
  };
}

function applyPinAlignment(alignment: PinAlignment) {
  const snapshot = circuitStore.getSnapshot();
  const from = canonicalEndpoint(alignment.from, snapshot.parts);
  const to = canonicalEndpoint(alignment.to, snapshot.parts);
  const parsed = endpointParts(from);
  const target = endpointParts(to);
  if (!parsed) throw new Error(`Cannot align ${alignment.from}: use partId:pinName.`);
  if (!target) throw new Error(`Cannot align to ${alignment.to}: use partId:pinName.`);
  if (parsed.partId === target.partId) throw new Error('align must reference pins on two different components.');
  const moving = snapshot.parts.find((part) => part.id === parsed.partId);
  const fromPoint = endpointPoint(from, snapshot.parts);
  const toPoint = endpointPoint(to, snapshot.parts);
  if (!moving || !fromPoint || !toPoint) throw new Error(`Cannot resolve exact pin geometry for ${from} -> ${to}.`);
  if (moving.seating) throw new Error(`Cannot align seated part ${moving.id}; change its named breadboard seat instead.`);
  const delta = toPoint[alignment.axis] - fromPoint[alignment.axis];
  if (Math.abs(delta) > BLOCK_CELL_PX + 0.01) {
    throw new Error(`Cannot fine-align ${from}: it needs a ${Math.abs(delta / BLOCK_CELL_PX).toFixed(1)}-cell move. Fix the part's at cell first.`);
  }
  circuitStore.applyParts([{
    id: moving.id,
    type: moving.type,
    left: moving.left + (alignment.axis === 'x' ? delta : 0),
    top: moving.top + (alignment.axis === 'y' ? delta : 0),
    rotate: moving.rotate,
    attrs: moving.attrs,
  }]);
  return moving.id;
}

function validateBlockOverlaps(parts: BlockPart[]) {
  const positioned = parts.filter((part): part is BlockPart & { at: BlockCell } => Boolean(part.at) && !part.seat);
  for (let i = 0; i < positioned.length; i++) {
    const a = positioned[i];
    const aDef = blockDefinition(a.type, a.rotate);
    const aRect = blockRect(a.at, aDef);
    for (let j = i + 1; j < positioned.length; j++) {
      const b = positioned[j];
      const bDef = blockDefinition(b.type, b.rotate);
      const bRect = blockRect(b.at, bDef);
      if (blockRectsOverlap(aRect, bRect)) {
        throw new Error(
          `Block overlap: ${a.id} is ${aDef.w}x${aDef.h} at [${a.at.x},${a.at.y}] and `
          + `${b.id} is ${bDef.w}x${bDef.h} at [${b.at.x},${b.at.y}]. Move one block so their rectangles do not intersect.`,
        );
      }
    }
  }
}

function compileWire(spec: BlockWire & RoutedWire): Partial<CircuitConnection> & { from: string; to: string } {
  const { from, to } = spec;
  const full = simplifyWirePoints(spec.points);
  for (let i = 0; i < full.length - 1; i++) {
    const a = full[i];
    const b = full[i + 1];
    if (Math.abs(a.x - b.x) >= 0.5 && Math.abs(a.y - b.y) >= 0.5) {
      throw new Error(`${spec.id ?? `${from}->${to}`} compiled a diagonal segment. This is an exact-router bug.`);
    }
  }
  const waypoints = full.slice(1, -1);
  const inferredKind = inferWireKind(from, to, spec.role);
  const color = spec.color
    ?? (inferredKind === 'signal'
      ? signalWireColor(spec.netId ?? spec.id ?? `${from}|${to}`)
      : standardWireColor(from, to, spec.role));
  return {
    ...(spec.id ? { id: spec.id } : {}),
    ...(spec.netId ? { netId: spec.netId } : {}),
    from,
    to,
    color,
    waypoints,
  };
}

function endpointPartId(endpoint: string) {
  return endpoint.slice(0, endpoint.indexOf(':'));
}

function visualRouteCost(parts: CircuitPart[], connections: CircuitConnection[]) {
  return connections.reduce((total, wire) => {
    const start = endpointPoint(wire.from, parts);
    const end = endpointPoint(wire.to, parts);
    if (!start || !end) return total;
    const points = [start, ...(wire.waypoints ?? []), end];
    let length = 0;
    let bends = 0;
    let previousAxis: 'h' | 'v' | undefined;
    for (let index = 0; index < points.length - 1; index++) {
      const dx = Math.abs(points[index + 1].x - points[index].x);
      const dy = Math.abs(points[index + 1].y - points[index].y);
      length += dx + dy;
      const axis = dx >= dy ? 'h' : 'v';
      if (previousAxis && axis !== previousAxis) bends++;
      previousAxis = axis;
    }
    return total + length / BLOCK_CELL_PX + bends * 2;
  }, 0);
}

function routeCandidateCost(
  quality: ReturnType<typeof evaluateLayout>,
  visualCost: number,
) {
  const issueCost: Partial<Record<ReturnType<typeof evaluateLayout>['issues'][number]['kind'], number>> = {
    'wire-through-part': 1_000,
    'pin-fanout': 1_000,
    'wire-through-board': 120,
    // A few extra cells or bends are preferable to two distinct electrical
    // paths visually becoming one path. Keep these far above ordinary route
    // compactness costs so the refinement pass takes a clean lane when one
    // exists instead of preserving a shorter but ambiguous route.
    'wire-overlap': 1_400,
    'wire-crossing': 1_200,
    'wire-backtrack': 45,
    'wire-notch': 20,
    'too-many-bends': 18,
    'long-route': 18,
    'pin-exit': 35,
    'connector-facing-away': 30,
  };
  return visualCost + quality.issues.reduce((total, issue) => total + (issueCost[issue.kind] ?? 0), 0);
}

function suggestCleanerPlacement(
  state: { parts: CircuitPart[]; connections: CircuitConnection[] },
  currentScore: number,
) {
  const currentVisualCost = visualRouteCost(state.parts, state.connections);
  const troubledWireIds = new Set(evaluateLayout(state).issues
    .filter((issue) => issue.kind === 'wire-crossing' || issue.kind === 'wire-overlap' || issue.kind === 'wire-backtrack' || issue.kind === 'wire-notch' || issue.kind === 'connector-facing-away' || issue.kind === 'excessive-gap' || issue.kind === 'split-source-cable' || issue.kind === 'perimeter-rail-detour' || issue.kind === 'viewport-overflow')
    .flatMap((issue) => issue.itemIds));
  const candidateConnections = state.connections
    .filter((wire) => troubledWireIds.size === 0 || troubledWireIds.has(wire.id))
    .filter((wire) => endpointPartId(wire.from) !== endpointPartId(wire.to));
  let best: { score: number; visualCost: number; disruption: number; travel: number; part: CircuitPart; at: BlockCell } | undefined;

  for (const wire of candidateConnections) {
    const firstId = endpointPartId(wire.from);
    const secondId = endpointPartId(wire.to);
    for (const [movingId, anchorId] of [[firstId, secondId], [secondId, firstId]] as const) {
      const moving = state.parts.find((part) => part.id === movingId);
      const anchor = state.parts.find((part) => part.id === anchorId);
      if (!moving || !anchor || moving.seating || isBreadboardType(moving.type)
        || moving.type.includes('arduino')
        || blockDefinition(moving.type, moving.rotate ?? 0).breadboardMount) continue;
      const movingAt = partBlockAt(moving);
      const anchorAt = partBlockAt(anchor);
      const movingDef = blockDefinition(moving.type, moving.rotate ?? 0);
      const anchorDef = blockDefinition(anchor.type, anchor.rotate ?? 0);
      const movingEndpoint = endpointPartId(wire.from) === moving.id ? wire.from : wire.to;
      const anchorEndpoint = endpointPartId(wire.from) === anchor.id ? wire.from : wire.to;
      const movingPinName = endpointParts(movingEndpoint)?.pinName;
      const anchorPinName = endpointParts(anchorEndpoint)?.pinName;
      const movingPin = movingPinName ? movingDef.pins[movingPinName] : undefined;
      const anchorPin = anchorPinName ? anchorDef.pins[anchorPinName] : undefined;
      const connectionCount = state.connections.filter((wire) => (
        endpointPartId(wire.from) === moving.id || endpointPartId(wire.to) === moving.id
      )).length;
      const disruption = movingDef.w * movingDef.h * Math.max(1, connectionCount);
      const pinAlignedCandidates: BlockCell[] = movingPin && anchorPin ? [
        {
          x: anchorAt.x + anchorDef.w + 2,
          y: Math.round(anchorAt.y + anchorPin.at.y - movingPin.at.y),
        },
        {
          x: anchorAt.x - movingDef.w - 2,
          y: Math.round(anchorAt.y + anchorPin.at.y - movingPin.at.y),
        },
        {
          x: Math.round(anchorAt.x + anchorPin.at.x - movingPin.at.x),
          y: anchorAt.y + anchorDef.h + 2,
        },
        {
          x: Math.round(anchorAt.x + anchorPin.at.x - movingPin.at.x),
          y: anchorAt.y - movingDef.h - 2,
        },
      ] : [];
      const candidates: BlockCell[] = [
        ...pinAlignedCandidates,
        { x: anchorAt.x + anchorDef.w + 1, y: movingAt.y },
        { x: anchorAt.x - movingDef.w - 1, y: movingAt.y },
        { x: movingAt.x, y: anchorAt.y + anchorDef.h + 1 },
        { x: movingAt.x, y: anchorAt.y - movingDef.h - 1 },
        { x: movingAt.x + 3, y: movingAt.y },
        { x: movingAt.x - 3, y: movingAt.y },
        { x: movingAt.x, y: movingAt.y + 3 },
        { x: movingAt.x, y: movingAt.y - 3 },
      ];

      for (const at of candidates.filter((candidate, index, all) => (
        all.findIndex((other) => other.x === candidate.x && other.y === candidate.y) === index
      ))) {
        const travel = Math.abs(at.x - movingAt.x) + Math.abs(at.y - movingAt.y);
        if (!travel) continue;
        const rect = blockRect(at, movingDef);
        const overlaps = state.parts.some((part) => {
          if (part.id === moving.id) return false;
          return blockRectsOverlap(rect, blockRect(partBlockAt(part), blockDefinition(part.type, part.rotate ?? 0)));
        });
        if (overlaps) continue;
        const trialParts = state.parts.map((part) => part.id === moving.id
          ? { ...part, ...blockPlacement(part.type, at, part.rotate ?? 0) }
          : part);
        const specs: BlockWire[] = state.connections.map((wire) => ({
          id: wire.id,
          ...(wire.netId ? { netId: wire.netId } : {}),
          from: wire.from,
          to: wire.to,
          color: wire.color,
        }));
        for (const strategy of ['input', 'reverse', 'shortest', 'longest', 'external-first'] as const) {
          try {
            const routed = routeWires(specs, trialParts, [], strategy);
            const connections = routed.map((wire, index): CircuitConnection => ({
              id: wire.id ?? specs[index].id ?? `__suggest${index + 1}`,
              ...(specs[index].netId ? { netId: specs[index].netId } : {}),
              from: wire.from,
              to: wire.to,
              color: specs[index].color ?? '#24a35a',
              waypoints: compileWire({ ...specs[index], ...wire }).waypoints ?? [],
            }));
            const score = evaluateLayout({ parts: trialParts, connections }).score;
            const visualCost = visualRouteCost(trialParts, connections);
            const materiallyCleaner = score === currentScore && visualCost <= currentVisualCost - 3;
            if ((score < currentScore || (score === currentScore && !materiallyCleaner)) || (best && (
              score < best.score
              || (score === best.score && visualCost > best.visualCost)
              || (score === best.score && visualCost === best.visualCost && disruption > best.disruption)
              || (score === best.score && visualCost === best.visualCost && disruption === best.disruption && travel >= best.travel)
            ))) continue;
            best = { score, visualCost, disruption, travel, part: moving, at };
          } catch {
            // A suggestion is optional. Ignore candidates with no legal route.
          }
        }
      }
    }
  }
  if (!best) return undefined;
  return {
    reason: best.score > currentScore
      ? `Move ${best.part.id} to [${best.at.x},${best.at.y}] before adding wire checkpoints; this removes more routing conflicts.`
      : `Slide ${best.part.id} to [${best.at.x},${best.at.y}] before tuning wires; this removes avoidable route length or bends.`,
    applyWith: {
      replace: false,
      reroute: 'all',
      parts: [{
        id: best.part.id,
        type: agentPartType(best.part.type),
        at: [best.at.x, best.at.y],
        rotate: normalizeRightAngle(best.part.rotate ?? 0),
      }],
    },
  };
}

function tuningSpec(tune: WireTune, connections: CircuitConnection[], parts: CircuitPart[]): BlockWire {
  const connection = connections.find((candidate) => candidate.id === tune.wireId);
  if (!connection) throw new Error(`Cannot tune ${tune.wireId}: that wire does not exist.`);
  const start = endpointPoint(connection.from, parts);
  const end = endpointPoint(connection.to, parts);
  if (!start || !end) throw new Error(`Cannot tune ${tune.wireId}: an endpoint has no exact geometry.`);
  const points = [start, ...(connection.waypoints ?? []), end];
  const horizontal = tune.lane === 'longest-horizontal';
  let best: { a: WirePoint; b: WirePoint; length: number } | null = null;
  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index];
    const b = points[index + 1];
    if (horizontal ? Math.abs(a.y - b.y) > 0.02 : Math.abs(a.x - b.x) > 0.02) continue;
    const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (!best || length > best.length) best = { a, b, length };
  }
  if (!best) throw new Error(`Cannot tune ${tune.wireId}: it has no ${horizontal ? 'horizontal' : 'vertical'} lane.`);
  const shift = horizontal ? { x: 0, y: tune.by * BLOCK_CELL_PX } : { x: tune.by * BLOCK_CELL_PX, y: 0 };
  return {
    id: connection.id,
    ...(connection.netId ? { netId: connection.netId } : {}),
    from: connection.from,
    to: connection.to,
    color: connection.color,
    viaPx: [
      { x: best.a.x + shift.x, y: best.a.y + shift.y },
      { x: best.b.x + shift.x, y: best.b.y + shift.y },
    ],
  };
}

const STARTER_TYPES: readonly PartType[] = [
  'wokwi-arduino-uno',
  'breadboard-half',
  'wokwi-led',
  'wokwi-resistor',
  'wokwi-pushbutton',
  'wokwi-potentiometer',
  'wokwi-servo',
  'dc-motor',
  'battery-9v',
  'npn-transistor',
  'rectifier-diode',
  'wokwi-hc-sr04',
  'wokwi-buzzer',
];
const INVENTORY = `PIN-FIRST SHADOWS: 10u = 1 placement cell. Each WxH block is only a collision envelope; pin@x,y is the exact terminal offset and its group is the rigid exit side or any for a flexible lead. Leave one clear cell outside used rigid pin banks. Every :mount part must use seat() when a breadboard exists.\n${compactBlockInventory(STARTER_TYPES)}`;

const VISUAL_GUIDANCE = `YOU OWN LAYOUT INTENT; THE COMPILER OWNS EXACT GEOMETRY.
Before building, make a short private ledger:
1. For every component: name its functional group, active pin bank, chosen board edge, and why its orientation faces that destination. Place by the combined distance of all active pins, not one favored signal.
2. For every wire or cable bundle: predict its shape as straight, one-corner L, or a justified perimeter route. Every additional bend needs one real reason: rigid pin exit, obstacle, board entry, or lane separation.
3. Put shared power and ground on marked rails. Put switched nodes and multi-drop signals on one local connected breadboard strip with net(); never use a + or - rail as a generic junction. An ordinary component pin is never a junction.
   For a point-to-point signal, connect to the actual seated component pin. Name a board hole only when that connected strip is intentionally the junction for two or more endpoints.
   For a local multi-drop node, route the external cable to its primary functional terminal (for example motor return to transistor collector), then seat passive or protective terminals on that same connected strip.
   In net(), list that primary active terminal first; the compiler treats it as the local root and omits wires to terminals already joined by the same breadboard strip.
4. Preserve connector order. Adjacent pins must reach adjacent lanes without crossing or exchanging sides.
5. Seat mounted parts into electrically useful named holes. A-E and F-J are separate strips across the trench. Use the smallest board that leaves real routing margin; move to a full board when the half board is physically crowded or a dense multi-pin display needs it.
6. Choose the rail side for each functional group once. Seat every rail-fed pin in the adjacent board half; never cross the center trench merely to reach power or ground.
7. Omit wire colors unless the user explicitly requests one. The compiler assigns red to positive power, black to ground, and a stable non-power color to each signal net.
8. Build first without via or tune. Inspect the render, then try moving or rotating the whole component before editing a wire.
9. Reject any unexplained reversal: left-right, right-left, up-down, or down-up. Also reject a component that can move closer and remove a bend without creating a worse conflict.

Good: compact functional groups, ordered parallel bundles, one clear distribution point, short local drops.
Bad: scene-sized perimeter loops, power entering and leaving the board repeatedly, direct pin fan-out, wires using the breadboard as empty canvas, or fixing poor placement with extra bends.
A numeric score never accepts the picture. Finish only when every component location and every bend has an obvious physical reason.`;

export function createBuildCircuitTool(): ToolDefinition {
  return {
    name: 'build-circuit',
    description: `Build or refine a circuit with block placement and exact-pin routing. ONE CELL = ${BLOCK_CELL_PX}px = one breadboard-hole pitch. Cells describe coarse component placement and optional corridors only; exact pins may have a fractional-cell phase. Use align to slide one part inside the coarse plan when two connected pins should share a perfectly straight x- or y-axis. This one action works at four scales: replace the whole circuit (replace:true), move/add selected parts or wires (replace:false), align a real pin axis, or shift one existing wire lane with tune. Place non-seated parts by top-left integer cell at:[x,y]; each starter entry gives its WxH block and pin names grouped by exit side.\n\nPLAN BEFORE THE CALL\nDecompose the build into controller, power/distribution, functional modules, and external inputs/outputs. For every module, identify the controller or breadboard pin cluster it mostly uses. Decide the energy/signal flow, connector-facing direction, and one cable corridor before choosing cells. Place primary groups first, then local details.\n\nPIN-FIRST COMPOSITION
1. Treat each part body as an obstacle around its exact pins. Choose the edge and rotation from the pins it must meet, not from a fixed scene template.
2. Place connected groups close enough that each cable can be straight, one L, or a justified perimeter route. Keep connector order so adjacent conductors stay parallel instead of crossing.
3. Before building, predict every external cable in layoutIntent. If a route contains left-then-right, up-then-down, or a tiny hook, move or rotate a component. A bend needs a visible obstacle or a deliberate perimeter corridor.
4. Use a rail or connected breadboard strip for shared power/ground. Give each conductor its own nearby entry column; an ordinary pin is not a junction.
5. Choose the smallest breadboard that leaves clear functional zones and routing corridors. Move to a full board only when actual component span, pin count, or route density needs it; never decide by part count alone.
6. Build without corridor hints first. Inspect exact state and the render. Adjust placement before adding a sparse via, and use tune only for final lane spacing.\n\nThe exact orthogonal router owns straight pin leads, obstacle avoidance, bends, and lane separation. Supply nets compile as source-rooted physical branches. Small local shared signals use one connected strip; four- or five-endpoint shared signals can use visible local taps plus a breadboard trunk when one board is present. Larger or unsupported buses retain the conservative spatial-chain fallback instead of forcing an unsafe distribution pattern. A short shared lead at a real distribution terminal is intentional; arbitrary same-net overlap is not. Use wires for ordinary two-terminal signals. rotate 90/270 swaps footprint W/H and rotates pin sides with the part. Breadboard-mounted parts may use seat:{breadboardId,pin,hole}. The schema lists every supported type; call inspect-circuit with catalogTypes only when a non-starter footprint is needed.\n\n${VISUAL_GUIDANCE}\n\nSTARTER KIT format type=WxH[:mount][side:pin names]\n${INVENTORY}`,
    inputSchema: {
      type: 'object',
      properties: {
        replace: { type: 'boolean', description: 'Defaults true.' },
        reroute: { type: 'string', enum: ['affected', 'all'], description: 'With replace:false, defaults affected. Use all after a placement change that alters shared routing space.' },
        boardId: { type: 'string' },
        code: { type: 'string', description: 'Optional complete Arduino sketch in the same call.' },
        layoutIntent: {
          type: 'string',
          description: 'Optional concise pre-build ledger: why each external component uses its edge/orientation and the expected straight, L-shaped, or justified perimeter shape of each wire bundle.',
        },
        program: {
          type: 'string',
          description: 'Optional tiny declarative scene program, exactly one listed call per line with JSON literals. Declarations may appear anywhere. Example: const uno = part("uno","arduino-uno",{"at":[-20,0]}); const bb = part("bb","breadboard-half",{"rightOf":"uno","gap":2}); const motor = part("m1","dc-motor",{"rightOf":"bb","gap":2}); const bat = part("bat","battery-9v",{"below":"bb","gap":2,"rotate":270}). This is not general JavaScript: do not invent object constraints, bare variable arguments, methods, loops, or return values. Dot or colon endpoints are accepted. Calls: part(id,type,{at:[x,y],rotate,attrs,rightOf,leftOf,above,below,gap,seat}), place(id,x,y,rotate), rightOf/leftOf/above/below(id,anchor,gap,offset), seat(id,breadboardId,anchorPin,hole), align(movingPin,fixedPin,"x|y"), wire(id,from,to,role,optionalSparseCorridor), net(id,role,[endpoints]), rail(id,breadboardId,"+top|-top|+bottom|-bottom",source,[consumers]), bridge(id,breadboardId,"+|-","left|right"). In a local multi-drop signal net, list the primary seated active terminal first; external branches root there and same-strip passive terminals need no extra wire. Otherwise, with one breadboard present, a signal net lands endpoints on distinct holes in one connected strip; wire is one direct cable. Treat parts as pin-first shadows and the breadboard as an electrical region, never empty routing canvas. rail is only for shared power or ground on marked +/- rails; use net for switched nodes and shared signals. bridge joins split rails outside the chosen quiet board edge. Omit corridors by default; use one or two cells only around a real functional region. Use align only after coarse placement to remove a verified sub-cell mismatch. Use program instead of parts/wires/nets; all forms compile through the same exact transaction and router.',
        },
        parts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              type: { type: 'string', enum: agentPartTypeEnum },
              at: {
                type: 'array', minItems: 2, maxItems: 2,
                items: { type: 'integer' },
                description: 'Top-left logical block cell [x,y]. Not used with seat.',
              },
              rotate: { type: 'number', enum: [0, 90, 180, 270] },
              attrs: { type: 'object' },
              seat: {
                type: 'object',
                properties: { breadboardId: { type: 'string' }, pin: { type: 'string' }, hole: { type: 'string' } },
                required: ['breadboardId', 'pin', 'hole'],
              },
            },
            required: ['id', 'type'],
          },
        },
        wires: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              from: { type: 'string' },
              to: { type: 'string' },
              role: { type: 'string', enum: ['signal', 'power', 'ground'] },
              color: { type: 'string' },
              via: {
                type: 'array',
                description: 'Optional corridor checkpoints [[x,y],...]. Omit for automatic routing. Checkpoints can be sparse and the harness connects them orthogonally.',
                items: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'integer' } },
              },
            },
            required: ['from', 'to'],
          },
        },
        nets: {
          type: 'array',
          description: 'Multi-terminal electrical nets. Prefer this over several wires repeating the same source pin.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              endpoints: { type: 'array', minItems: 2, items: { type: 'string' } },
              role: { type: 'string', enum: ['signal', 'power', 'ground'] },
              color: { type: 'string' },
            },
            required: ['id', 'endpoints'],
          },
        },
        tune: {
          type: 'array',
          description: 'Small visual edits to existing wires. Positive by moves a horizontal lane down or a vertical lane right; negative moves up or left.',
          items: {
            type: 'object',
            properties: {
              wireId: { type: 'string' },
              lane: { type: 'string', enum: ['longest-horizontal', 'longest-vertical'] },
              by: { type: 'integer' },
            },
            required: ['wireId', 'lane', 'by'],
          },
        },
        align: {
          type: 'array',
          description: 'Fine component alignment without pixel math. The component in from moves; the component in to stays fixed. Example: {from:"pot:VCC",to:"uno:5V",axis:"x"} removes a tiny elbow from an otherwise vertical wire.',
          items: {
            type: 'object',
            properties: {
              from: { type: 'string', description: 'Pin on the component to move, as partId:pinName.' },
              to: { type: 'string', description: 'Fixed target pin, as partId:pinName.' },
              axis: { type: 'string', enum: ['x', 'y'] },
            },
            required: ['from', 'to', 'axis'],
          },
        },
      },
    },
    async execute(input) {
      return withCircuitTransaction(async () => {
        const hasProgram = typeof input.program === 'string' && input.program.trim().length > 0;
        if (hasProgram && (input.parts !== undefined || input.wires !== undefined || input.nets !== undefined)) {
          throw new Error('Use program or structured parts/wires/nets, not both.');
        }
        const program = hasProgram ? parseCircuitProgram(input.program as string) : undefined;
        const effective = program ? { ...input, ...program } : input;
        const replace = effective.replace !== false;
        const rerouteAll = !replace && effective.reroute === 'all';
        const parts = (Array.isArray(effective.parts) ? effective.parts : []).map(parsePart);
        const requestedWireInputs = (Array.isArray(effective.wires) ? effective.wires : []).map(parseWire);
        const requestedNets = (Array.isArray(effective.nets) ? effective.nets : []).map(parseNet);
        const tunes = (Array.isArray(effective.tune) ? effective.tune : []).map(parseTune);
        const alignments = (Array.isArray(effective.align) ? effective.align : []).map(parseAlignment);
        if (!replace && !parts.length && !requestedWireInputs.length && !requestedNets.length && !(program?.rails.length) && !(program?.bridges.length) && !tunes.length && !alignments.length && typeof input.code !== 'string') {
          throw new Error('Nothing to change. Supply parts, wires, nets, align, tune, or code.');
        }
        validateBlockOverlaps(parts);

        if (replace) circuitStore.replaceDocument({ parts: [], connections: [] });
        const normal = parts.filter((part) => !part.seat);
        const seated = parts.filter((part) => part.seat);
        if (normal.length) {
          circuitStore.applyParts(normal.map((part) => ({
            id: part.id,
            type: part.type,
            ...blockPlacement(part.type, part.at!, part.rotate),
            rotate: part.rotate,
            ...(part.attrs ? { attrs: part.attrs } : {}),
          })));
        }
        for (const part of seated) {
          circuitStore.applyParts([{
            id: part.id,
            type: part.type,
            rotate: part.rotate,
            seat: part.seat!,
            ...(part.attrs ? { attrs: part.attrs } : {}),
          }]);
        }

        const alignedPartIds = alignments.map(applyPinAlignment);

        const stateAfterParts = circuitStore.getSnapshot();
        const hasBreadboard = stateAfterParts.parts.some((part) => isBreadboardType(part.type));
        const looseMounts = hasBreadboard
          ? stateAfterParts.parts.filter((part) => blockDefinition(part.type, part.rotate ?? 0).breadboardMount && !part.seating)
          : [];
        if (looseMounts.length) {
          throw new Error(`Breadboard-mount parts must use named holes when a breadboard is present: ${looseMounts.map((part) => part.id).join(', ')}. Use seat(partId,breadboardId,anchorPin,hole).`);
        }
        const signalJunctionColumns = new Map<string, Set<number>>();
        const signalJunctionBundles = new Map<string, {
          half: 'upper' | 'lower';
          columnsByPartId: Map<string, number>;
        }>();
        const requestedWires = [
          ...expandRails(program?.rails ?? [], stateAfterParts.parts),
          ...(program?.bridges ?? []).map((bridge) => expandRailBridge(bridge, stateAfterParts.parts)),
          ...requestedNets.flatMap((net) => expandNet(net, stateAfterParts.parts, signalJunctionColumns, signalJunctionBundles)),
          ...requestedWireInputs,
        ];
        const tunedWires = tunes.map((tune) => tuningSpec(tune, stateAfterParts.connections, stateAfterParts.parts));
        const explicitIds = new Set([...requestedWires, ...tunedWires].flatMap((wire) => wire.id ? [wire.id] : []));
        const explicitPairs = new Set([...requestedWires, ...tunedWires].map((wire) => [wire.from, wire.to].sort().join('|')));
        const changedPartIds = new Set([...parts.map((part) => part.id), ...alignedPartIds]);
        const affectedExisting = replace ? [] : stateAfterParts.connections
          .filter((connection) => rerouteAll || changedPartIds.has(endpointPartId(connection.from)) || changedPartIds.has(endpointPartId(connection.to)))
          .filter((connection) => !explicitIds.has(connection.id) && !explicitPairs.has([connection.from, connection.to].sort().join('|')))
          .map((connection): BlockWire => ({
            id: connection.id,
            ...(connection.netId ? { netId: connection.netId } : {}),
            from: connection.from,
            to: connection.to,
            color: connection.color,
          }));
        const wires = [...requestedWires, ...tunedWires, ...affectedExisting].map((wire) => {
          const from = canonicalEndpoint(wire.from, stateAfterParts.parts);
          const to = canonicalEndpoint(wire.to, stateAfterParts.parts);
          if (from === to) throw new Error('A wire cannot connect a pin to itself.');
          return { ...wire, from, to };
        });
        const reroutedIds = new Set(wires.flatMap((wire) => wire.id ? [wire.id] : []));
        const reroutedPairs = new Set(wires.map((wire) => [wire.from, wire.to].sort().join('|')));
        const reservedConnections = stateAfterParts.connections.filter((connection) => (
          !reroutedIds.has(connection.id) && !reroutedPairs.has([connection.from, connection.to].sort().join('|'))
        ));
        const asConnections = (compiledWires: Array<Partial<CircuitConnection> & { from: string; to: string }>) => [
          ...reservedConnections,
          ...compiledWires.map((wire, index): CircuitConnection => ({
            id: wire.id ?? `__route${index + 1}`,
            ...(wire.netId ? { netId: wire.netId } : {}),
            from: wire.from,
            to: wire.to,
            color: wire.color ?? '#24a35a',
            waypoints: wire.waypoints ?? [],
          })),
        ];
        const candidates = (['input', 'reverse', 'shortest', 'longest', 'external-first'] as const).map((strategy) => {
          const routed = routeWires(wires, stateAfterParts.parts, reservedConnections, strategy);
          const compiled = routed.map((wire, index) => compileWire({ ...wires[index], ...wire }));
          const connections = asConnections(compiled);
          return {
            compiled,
            quality: evaluateLayout({ parts: stateAfterParts.parts, connections }),
            visualCost: visualRouteCost(stateAfterParts.parts, connections),
          };
        });
        candidates.sort((a, b) => (
          routeCandidateCost(a.quality, a.visualCost) - routeCandidateCost(b.quality, b.visualCost)
        ));
        let compiled = candidates[0].compiled;
        let routeQuality = candidates[0].quality;
        let routeCost = routeCandidateCost(routeQuality, candidates[0].visualCost);
        for (let attempt = 0; attempt < wires.length * 2; attempt++) {
          const issue = routeQuality.issues.find((candidate) => (
            candidate.kind === 'wire-crossing'
            || candidate.kind === 'wire-overlap'
            || candidate.kind === 'wire-backtrack'
            || candidate.kind === 'wire-notch'
            || candidate.kind === 'too-many-bends'
          ) && candidate.itemIds.some((id) => wires.some((wire) => wire.id === id)));
          if (!issue) break;
          const refinements = issue.itemIds.flatMap((wireId) => {
            const index = wires.findIndex((wire) => wire.id === wireId);
            if (index < 0 || wires[index].via?.length || wires[index].viaPx?.length) return [];
            const otherConnections = asConnections(compiled).filter((connection) => connection.id !== wireId);
            return (['input', 'reverse', 'shortest', 'longest', 'external-first'] as const).map((strategy) => {
              const [routed] = routeWires([wires[index]], stateAfterParts.parts, otherConnections, strategy);
              const replacement = compileWire({ ...wires[index], ...routed });
              const next = compiled.map((wire, candidateIndex) => candidateIndex === index ? replacement : wire);
              const connections = asConnections(next);
              return {
                compiled: next,
                quality: evaluateLayout({ parts: stateAfterParts.parts, connections }),
                visualCost: visualRouteCost(stateAfterParts.parts, connections),
              };
            });
          });
          if (issue.kind === 'wire-crossing') {
            // A same-connector crossing often cannot be repaired one wire at a
            // time because the fixed neighbor already owns the wrong fan-out
            // lane. Re-route the whole physical pin bank atomically so existing
            // router strategies can swap lane ownership without changing GPIOs.
            const issueWires = issue.itemIds
              .map((wireId) => wires.find((wire) => wire.id === wireId))
              .filter((wire): wire is BlockWire => Boolean(wire));
            const firstIssueWire = issueWires[0];
            const bank = firstIssueWire
              ? [firstIssueWire.from, firstIssueWire.to].map((endpoint) => {
                  const partId = endpointParts(endpoint)?.partId;
                  const part = stateAfterParts.parts.find((candidate) => candidate.id === partId);
                  if (!partId || !part || isBreadboardType(part.type)) return undefined;
                  return { partId, direction: pinExitDirection(endpoint, stateAfterParts.parts) };
                }).find((candidate) => candidate && issueWires.every((wire) => (
                  [wire.from, wire.to].some((endpoint) => (
                    endpointParts(endpoint)?.partId === candidate.partId
                    && pinExitDirection(endpoint, stateAfterParts.parts) === candidate.direction
                  ))
                )))
              : undefined;
            if (bank) {
              const bankIndices = wires.flatMap((wire, index) => {
                if (wire.via?.length || wire.viaPx?.length) return [];
                const belongs = [wire.from, wire.to].some((endpoint) => (
                  endpointParts(endpoint)?.partId === bank.partId
                  && pinExitDirection(endpoint, stateAfterParts.parts) === bank.direction
                ));
                return belongs ? [index] : [];
              });
              if (bankIndices.length >= 2) {
                const bankIds = new Set(bankIndices.flatMap((index) => wires[index].id ? [wires[index].id!] : []));
                const bankPairs = new Set(bankIndices.map((index) => [wires[index].from, wires[index].to].sort().join('|')));
                const otherConnections = asConnections(compiled).filter((connection) => (
                  !bankIds.has(connection.id)
                  && !bankPairs.has([connection.from, connection.to].sort().join('|'))
                ));
                const candidateFromOrder = (orderedIndices: number[], strategy: Parameters<typeof routeWires>[3]) => {
                  const orderedWires = orderedIndices.map((index) => wires[index]);
                  const routed = routeWires(orderedWires, stateAfterParts.parts, otherConnections, strategy);
                  const replacements = new Map(orderedIndices.map((wireIndex, localIndex) => [
                    wireIndex,
                    compileWire({ ...wires[wireIndex], ...routed[localIndex] }),
                  ]));
                  const next = compiled.map((wire, candidateIndex) => replacements.get(candidateIndex) ?? wire);
                  const connections = asConnections(next);
                  return {
                    compiled: next,
                    quality: evaluateLayout({ parts: stateAfterParts.parts, connections }),
                    visualCost: visualRouteCost(stateAfterParts.parts, connections),
                  };
                };
                refinements.push(...(['input', 'reverse', 'shortest', 'longest', 'external-first'] as const).map((strategy) => (
                  candidateFromOrder(bankIndices, strategy)
                )));
                const bankAxis = bank.direction === 'up' || bank.direction === 'down' ? 'x' : 'y';
                const physicalOrder = [...bankIndices].sort((a, b) => {
                  const endpointFor = (index: number) => [wires[index].from, wires[index].to].find((endpoint) => (
                    endpointParts(endpoint)?.partId === bank.partId
                    && pinExitDirection(endpoint, stateAfterParts.parts) === bank.direction
                  ));
                  const aEndpoint = endpointFor(a);
                  const bEndpoint = endpointFor(b);
                  const aPoint = aEndpoint ? endpointPoint(aEndpoint, stateAfterParts.parts) : undefined;
                  const bPoint = bEndpoint ? endpointPoint(bEndpoint, stateAfterParts.parts) : undefined;
                  return (aPoint?.[bankAxis] ?? 0) - (bPoint?.[bankAxis] ?? 0);
                });
                // Input-order routing gives the first pin the innermost free lane.
                // Try both physical orders after a measured bank crossing, then
                // let layout quality choose the readable one for this geometry.
                refinements.push(candidateFromOrder(physicalOrder, 'input'));
                refinements.push(candidateFromOrder([...physicalOrder].reverse(), 'input'));
              }
            }
          }
          refinements.sort((a, b) => (
            routeCandidateCost(a.quality, a.visualCost) - routeCandidateCost(b.quality, b.visualCost)
          ));
          const refinedCost = refinements.length
            ? routeCandidateCost(refinements[0].quality, refinements[0].visualCost)
            : Number.POSITIVE_INFINITY;
          if (refinedCost >= routeCost) break;
          compiled = refinements[0].compiled;
          routeQuality = refinements[0].quality;
          routeCost = refinedCost;
        }
        circuitStore.applyConnections(compiled);
        const boardId = applyArduinoCode(effective);
        circuitStore.select(null);

        const state = circuitStore.getSnapshot();
        const quality = evaluateLayout(state);
        const blocking = quality.issues.filter((issue) => issue.severity === 'error' || issue.kind === 'seated-part-collision');
        if (blocking.length) {
          throw new Error(`Grid build rejected: ${blocking.map((issue) => issue.message).join(' | ')}`);
        }
        const suggestedEdit = input.suggestPlacement === false || quality.issues.some((issue) => issue.kind === 'connector-facing-away')
          ? undefined
          : suggestCleanerPlacement(state, quality.score);
        return toolResult({
          cellPixels: BLOCK_CELL_PX,
          ...(boardId ? { codeBoardId: boardId } : {}),
          layoutIssues: quality.issues,
          ...(suggestedEdit ? { suggestedEdit } : {}),
          routedWireIds: compiled.map((wire) => wire.id).filter(Boolean),
          parts: state.parts.length,
          wires: state.connections.length,
        });
      });
    },
  };
}
