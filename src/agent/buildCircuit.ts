import { circuitStore } from '../circuit/store';
import { getBreadboardGeometry, isBreadboardType } from '../breadboard/geometry';
import type { CircuitConnection, CircuitPart, PartAttrs, PartType, WirePoint } from '../circuit/types';
import { evaluateLayout } from '../layout/quality';
import { standardWireColor, type WireRole } from '../wires/conventions';
import { endpointParts, endpointPoint, pinExitDirection, pinIsFlexible } from '../wires/geometry';
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
function expandNet(net: BlockNet, parts: CircuitPart[]): BlockWire[] {
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
  if (net.role === 'signal' && endpoints.length <= 5 && boards.length === 1
    && endpointPartIds.every((id) => id !== boards[0].id)) {
    const board = boards[0];
    const geometry = getBreadboardGeometry(board.type)!;
    const located = endpoints.map((endpoint) => ({ endpoint, point: endpointPoint(endpoint, parts)! }));
    const boardCenterY = board.top + geometry.height / 2;
    const averageY = located.reduce((sum, item) => sum + item.point.y, 0) / located.length;
    const rows = averageY < boardCenterY ? ['A', 'B', 'C', 'D', 'E'] : ['F', 'G', 'H', 'I', 'J'];
    const ordered = [...located].sort((a, b) => a.point.y - b.point.y);
    const assignedRows = ordered.length === 1
      ? [rows[2]]
      : ordered.map((_, index) => rows[Math.round(index * (rows.length - 1) / (ordered.length - 1))]);
    let bestColumn = 1;
    let bestCost = Number.POSITIVE_INFINITY;
    for (let column = 1; column <= geometry.columns; column++) {
      const cost = ordered.reduce((sum, item, index) => {
        const point = endpointPoint(`${board.id}:${assignedRows[index]}${column}`, parts)!;
        return sum + Math.abs(point.x - item.point.x) + Math.abs(point.y - item.point.y);
      }, 0);
      if (cost < bestCost) {
        bestCost = cost;
        bestColumn = column;
      }
    }
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
function expandRail(rail: ProgramRail, parts: CircuitPart[]): BlockWire[] {
  const board = parts.find((part) => part.id === rail.breadboardId);
  if (!board || !isBreadboardType(board.type)) {
    throw new Error(`Rail ${rail.id} needs breadboard ${rail.breadboardId}.`);
  }
  if (!/^[+-](?:top|bottom)$/.test(rail.rail)) {
    throw new Error(`Rail ${rail.id} name must be +top, -top, +bottom, or -bottom.`);
  }
  const geometry = getBreadboardGeometry(board.type)!;
  const used = new Set<number>();
  const nearestHole = (rawEndpoint: string) => {
    const endpoint = canonicalEndpoint(rawEndpoint, parts);
    const target = endpointPoint(endpoint, parts);
    if (!target) throw new Error(`Rail ${rail.id} cannot resolve ${rawEndpoint}.`);
    const targetPartId = endpointParts(endpoint)?.partId;
    const targetPart = parts.find((part) => part.id === targetPartId);
    const exit = targetPart?.seating ? null : pinExitDirection(endpoint, parts);
    const candidates = Array.from({ length: geometry.railHoles }, (_, index) => index + 1)
      .filter((hole) => !used.has(hole))
      .map((hole) => {
        const boardEndpoint = `${board.id}:${rail.rail}${hole}`;
        const point = endpointPoint(boardEndpoint, parts)!;
        const wrongSide = exit === 'left' ? point.x > target.x - BLOCK_CELL_PX
          : exit === 'right' ? point.x < target.x + BLOCK_CELL_PX
            : exit === 'up' ? point.y > target.y - BLOCK_CELL_PX
              : exit === 'down' ? point.y < target.y + BLOCK_CELL_PX
                : false;
        return {
          hole,
          boardEndpoint,
          distance: Math.abs(point.x - target.x) + (wrongSide ? 100_000 : 0),
        };
      })
      .sort((a, b) => a.distance - b.distance || a.hole - b.hole);
    const chosen = candidates[0];
    if (!chosen) throw new Error(`Rail ${rail.id} has no unused holes.`);
    used.add(chosen.hole);
    return { endpoint, boardEndpoint: chosen.boardEndpoint };
  };
  const role: WireRole = rail.rail.startsWith('+') ? 'power' : 'ground';
  const source = nearestHole(rail.source);
  const feed: BlockWire = {
    id: `${rail.id}-feed`, netId: rail.id, from: source.endpoint, to: source.boardEndpoint, role,
  };
  const branches = rail.consumers.map((consumer, index): BlockWire => {
    const branch = nearestHole(consumer);
    const target = endpointPoint(branch.endpoint, parts)!;
    const railPoint = endpointPoint(branch.boardEndpoint, parts)!;
    const targetPartId = endpointParts(branch.endpoint)?.partId;
    const targetPart = parts.find((part) => part.id === targetPartId);
    const outsideRight = target.x > board.left + geometry.width;
    const outsideLeft = target.x < board.left;
    const externalRailCorner = targetPart && !targetPart.seating && !isBreadboardType(targetPart.type)
      && pinIsFlexible(branch.endpoint, parts) && (outsideRight || outsideLeft)
        ? [{
            x: target.x,
            y: railPoint.y,
          }]
        : undefined;
    return {
      id: `${rail.id}-branch-${index + 1}`,
      netId: rail.id,
      from: branch.boardEndpoint,
      to: branch.endpoint,
      role,
      ...(externalRailCorner ? { viaPx: externalRailCorner } : {}),
    };
  });
  return source.endpoint === source.boardEndpoint ? branches : [feed, ...branches];
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
    if (Math.abs(a.x - b.x) >= 0.01 && Math.abs(a.y - b.y) >= 0.01) {
      throw new Error(`${spec.id ?? `${from}->${to}`} compiled a diagonal segment. This is an exact-router bug.`);
    }
  }
  const waypoints = full.slice(1, -1);
  const color = spec.role === 'signal' && spec.color ? spec.color : standardWireColor(from, to, spec.role);
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

function suggestCleanerPlacement(
  state: { parts: CircuitPart[]; connections: CircuitConnection[] },
  currentScore: number,
) {
  const currentVisualCost = visualRouteCost(state.parts, state.connections);
  const troubledWireIds = new Set(evaluateLayout(state).issues
    .filter((issue) => issue.kind === 'wire-crossing' || issue.kind === 'wire-overlap' || issue.kind === 'wire-backtrack' || issue.kind === 'wire-notch')
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
        for (const strategy of ['input', 'reverse', 'shortest', 'longest'] as const) {
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
      ? 'Moving a connected component removes layout conflicts more effectively than adding wire checkpoints.'
      : 'A small component slide removes avoidable route length or bends while preserving the same clean layout score.',
    expectedLayoutScore: best.score,
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
  'wokwi-potentiometer',
  'wokwi-servo',
  'dc-motor',
  'battery-9v',
];
const INVENTORY = `PIN-FIRST SHADOWS: 10u = 1 placement cell. pin@x,y is the exact integer terminal offset from the shadow top-left; its group is the outward exit side, or any for a flexible cable. Place and rotate for terminal flow first. The shadow is only a collision envelope. Keep one clear routing cell outside every used rigid pin bank because body non-overlap can still close its exit lane. Preserve required topology: a controller driving an externally powered stage normally needs a common ground, even when its physical route should move. Rail labels include physical gaps: express shared supply with rail() and let canonical geometry choose holes instead of guessing labels. If one local drop bends at a rail gap, translate the complete functional group one cell left or right before tuning that wire. A flexible external lead uses one corner at the load axis and runs directly along the rail axis. A rigid header preserves its outward side and leaves through the board boundary when a direct route would cross the board. When split top/bottom rails need continuity, bridge(id,breadboardId,"+|-","left|right") owns one clean outside-edge jumper; choose the edge nearest the source and away from active signal flow. Keep the controller and main distribution board in one working band when their active pin banks permit it; do not move the whole controller above or below the board to repair one wire. A numeric layout grade cannot accept a render: reject any placement that can move closer or share a clearer band without creating a crossing. Every :mount part must use seat() whenever the scene contains a breadboard; free placement is only valid without a breadboard.\n${compactBlockInventory(STARTER_TYPES)}`;

const VISUAL_GUIDANCE = `VISUAL DESIGN PROCEDURE
Follow this order. Do not route first and organize afterward.
1. Identify source, distribution, controller, switching stages, loads, and required common grounds. Keep the topology minimal: do not add a power connection merely because a compatible pin exists. A USB-powered controller driving an externally powered load normally shares ground with that source but does not also need the load battery connected to VIN unless the task explicitly requests it.
2. Prefer one horizontal working band: conventional upright controller on the left, primary breadboard in the center, load on the right, and source at the nearest quiet board edge. Put controller and board side by side with a small clear gap unless the majority of active pin banks prove another arrangement is simpler.
3. Assign every multi-terminal peripheral one board-edge zone before placing it. Treat all of its active pins as one bundle and compare the sum of rough Manhattan distances to their intended signal and distribution points. Never place a three-wire peripheral beside the controller merely to shorten its one signal while its power and ground then span the scene; two nearby distribution connections normally outweigh one remote signal. Keep each bundle in one zone and keep different bundles out of each other's corridors. Check whether the connector's ordered pins can map to the ordered approach lanes without exchanging sides. If not, test an adjacent board edge with a 90/270 rotation before routing; moving the whole cable bank is better than accepting one crossing.
4. Plan breadboard electrical columns before seating. A-E holes with one number share a strip, F-J with that number share another, and the center trench separates them. Seat electrically connected mounted pins on the same strip so no rendered jumper is needed. Then treat each mounted local stage and its remaining holes as one compact functional group.
5. Put each external source or load just outside the nearest board edge used by its terminals. A source belongs beside the distribution rail it feeds, not beneath an unrelated controller. Compare the combined rough cell distance of all its conductors at each open board edge and choose the shortest clear placement. When placing a battery below a board, keep its terminal bank within the board's horizontal span. Keep batteries out of the controller-to-board gap. Face rigid terminal banks toward their destination before routing. Enumerate only destination-facing orientations first; do not rotate a connector sideways or away merely to repair its cable. Translate it along the destination edge or change entry lanes instead.
6. A paired source cable enters distribution on one nearest board edge. If a battery is below the board, both positive and ground enter the bottom rails; never send one conductor through the board to a far rail while its mate uses the near rail. Carry power from that entry rail to a local load strip with a short aligned drop or one quiet outside-edge bridge. Choose top versus bottom independently only for nets that are not conductors of the same connector cable. Assign quiet outer edges to supply entry and rail bridges. Keep signals near their functional stage. Preserve cable order: projected toward the destination, conductors must reach their adjacent distribution lanes in the same left-to-right or top-to-bottom order in which they leave the connector. If two conductors exchange sides, rotate or translate the source or choose different entry lanes; never accept the resulting crossing or U-turn.
7. Build without via or tune. Let rail(), net(), and the router physicalize the topology.
8. Judge the render with your eyes. For every external part, compare moving it left, right, up, down, and rotating it. Reject the placement if one simple change removes a reversal, long perimeter run, board crossing, or split group without creating a worse conflict.
   Keep large controller boards in their conventional upright rotation by default. Never rotate a controller to improve one signal pin. Rotate it only when most active connections become simpler and no supply or ground route becomes worse.
9. Explain every bend. Valid reasons are a rigid pin exit, real obstacle, board-edge entry, lane separation, or intentional shared corridor. If a route goes left then right, or up then down, move or rotate a component first. A flexible lead normally needs no more than one corner to its destination axis.
10. Inspect diagnostics separately. A perfect numeric grade does not mean the picture is good. Do not finish while an obvious simpler placement exists.

REJECT THESE SHAPES
- Controller moved a whole row above or below its breadboard merely to repair one wire.
- Large controller rotated or inverted to improve one signal while making the overall scene harder to read.
- External load battery connected to controller VIN when the controller can remain USB-powered and only needs common ground.
- Two conductors from one connector crossing, exchanging sides, or making opposite hooks before reaching adjacent distribution lanes.
- A source or load beside one board edge with its rigid connector facing a different edge, unless a real obstacle blocks every destination-facing orientation.
- A paired source cable split across opposite board edges, or one source conductor traversing the board just to reach a far rail.
- Battery, motor, or peripheral far away while useful space exists beside its destination.
- Three-wire peripheral placed for its signal pin alone while its two distribution wires become long, crossed, or detached from its cable.
- Multi-wire connector kept on an edge where its pin order cannot match the approach-lane order, then repaired with hooks or crossings instead of moving the whole peripheral to an adjacent edge.
- Battery under the controller when moving it under or beside the breadboard shortens both supply conductors.
- Mountable parts floating around a breadboard instead of seated in named holes.
- Power entering a board, leaving it, and entering again without an electrical reason.
- Rail branch crossing active breadboard rows when it could remain on the rail axis or outside edge.
- Top rail chosen for terminals clustered below the board, or bottom rail chosen for terminals clustered above it, causing an avoidable perimeter route.
- Flexible load lead with an avoidable up-sideways-down or left-sideways-right detour.
- One functional stage spread across unrelated columns, creating long local jumpers.
- Jumper between mounted pins that could share one breadboard strip by choosing better seats.
- Several wires repaired individually when translating or rotating the complete group fixes all of them.

PREFERRED SHAPES
- Controller -> small gap -> breadboard -> small gap -> external load in one readable flow band.
- Source near the rail it feeds, paired supply conductors, and one quiet-edge bridge for split rails.
- Seated local stage aligned by columns for short rail, transistor, diode, and resistor drops.
- In a motor switch, share one strip between resistor output and transistor base; share another between diode return, transistor collector, and motor return. Use the board's internal connection instead of drawing U-shaped jumpers.
- Flexible motor lead turns once onto the destination rail or strip axis.
- Rigid header is approached from its declared side; rotate or move the part instead of wrapping around it.
- With multiple three-wire peripherals, assign separate board-edge zones: keep each signal/power/ground bundle together and minimize the combined length of all three, not one favored wire.
- If a side-facing three-wire connector cannot meet its three lanes in order, rotate it toward an adjacent open edge so the pins can use separate aligned rows or columns.`;

export function createBuildCircuitTool(): ToolDefinition {
  return {
    name: 'build-circuit',
    description: `Build or refine a circuit with block placement and exact-pin routing. ONE CELL = ${BLOCK_CELL_PX}px = one breadboard-hole pitch. Cells describe coarse component placement and optional corridors only; exact pins may have a fractional-cell phase. Use align to slide one part inside the coarse plan when two connected pins should share a perfectly straight x- or y-axis. This one action works at four scales: replace the whole circuit (replace:true), move/add selected parts or wires (replace:false), align a real pin axis, or shift one existing wire lane with tune. Place non-seated parts by top-left integer cell at:[x,y]; each starter entry gives its WxH block and pin names grouped by exit side.\n\nPLAN BEFORE THE CALL\nDecompose the build into controller, power/distribution, functional modules, and external inputs/outputs. For every module, identify the controller or breadboard pin cluster it mostly uses. Decide the energy/signal flow, connector-facing direction, and one cable corridor before choosing cells. Place primary groups first, then local details.\n\nCOMPOSITION POLICY\n1. Arrange functional groups in signal or energy-flow order, but let pin-side fit outrank a conventional left-to-right layout.\n2. Place each peripheral beside the pin cluster it mostly uses, face its connector toward that cluster, and leave 2-4 clear cells for the cable to fan out. Treat adjacent signal/power/ground conductors as one ordered cable.\n3. Every pin has a fixed outward half-plane. Put the connected part or shared channel in that direction: a left-facing servo belongs to the right of the lane feeding it, so the route can approach from the left without doubling back.\n4. Align connected pin banks along one open channel. Move or rotate a component whenever that removes a left-right or up-down reversal; never preserve a poor placement and repair it with extra bends.\n5. An ordinary component pin is not a junction. When power or ground has multiple consumers, add or use a breadboard rail/distribution part: source to one rail hole, each consumer to its own nearby rail hole. Do not attach several rendered wires to one Uno or peripheral pin.\n6. Reserve separate parallel lanes for power and ground at the group edge. List the source first in multi-terminal supply nets. Keep signals inside the functional flow and use short local rail drops.\n7. Build once without wire hints. Inspect exact state and the render. Apply a verified placement suggestion or align a nearly straight connection before using via for a real obstacle or tune for final lane spacing.\n\nThe exact orthogonal router owns straight pin leads, obstacle avoidance, bends, and lane separation. Supply nets compile as source-rooted physical branches; other buses compile as spatial chains. A short shared lead at a real distribution terminal is intentional; arbitrary same-net overlap is not. Use wires for ordinary two-terminal signals. rotate 90/270 swaps footprint W/H and rotates pin sides with the part. Breadboard-mounted parts may use seat:{breadboardId,pin,hole}. The schema lists every supported type; call inspect-circuit with catalogTypes only when a non-starter footprint is needed.\n\n${VISUAL_GUIDANCE}\n\nSTARTER KIT format type=WxH[:mount][side:pin names]\n${INVENTORY}`,
    inputSchema: {
      type: 'object',
      properties: {
        replace: { type: 'boolean', description: 'Defaults true.' },
        reroute: { type: 'string', enum: ['affected', 'all'], description: 'With replace:false, defaults affected. Use all after a placement change that alters shared routing space.' },
        boardId: { type: 'string' },
        code: { type: 'string', description: 'Optional complete Arduino sketch in the same call.' },
        program: {
          type: 'string',
          description: 'Optional tiny declarative scene program, exactly one listed call per line with JSON literals. Declarations may appear anywhere. Example: const uno = part("uno","arduino-uno",{"at":[-35,0]}) then wire("signal","uno.9","servo.PWM","signal"). This is not general JavaScript: do not invent object constraints, bare variable arguments, methods, loops, or return values. Dot or colon endpoints are accepted. Calls: part(id,type,{at:[x,y],rotate,attrs}), place(id,x,y,rotate), rightOf/leftOf/above/below(id,anchor,gap,offset), seat(id,breadboardId,anchorPin,hole), align(movingPin,fixedPin,"x|y"), wire(id,from,to,role,optionalSparseCorridor), net(id,role,[endpoints]), rail(id,breadboardId,"+top|-top|+bottom|-bottom",source,[consumers]), bridge(id,breadboardId,"+|-","left|right"). With one breadboard present, a signal net lands endpoints on distinct holes in one connected strip; wire is one direct cable. Treat parts as pin-first shadows and the breadboard as an electrical region, never empty routing canvas. rail resolves canonical geometry to choose nearby distinct holes for shared power or ground. bridge joins split rails outside the chosen quiet board edge. Omit corridors by default; use one or two cells only around a real functional region. Use align only after coarse placement to remove a verified sub-cell mismatch. Use program instead of parts/wires/nets; all forms compile through the same exact transaction and router.',
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
        const requestedWires = [
          ...(program?.rails ?? []).flatMap((rail) => expandRail(rail, stateAfterParts.parts)),
          ...(program?.bridges ?? []).map((bridge) => expandRailBridge(bridge, stateAfterParts.parts)),
          ...requestedNets.flatMap((net) => expandNet(net, stateAfterParts.parts)),
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
        const candidates = (['input', 'reverse', 'shortest', 'longest'] as const).map((strategy) => {
          const routed = routeWires(wires, stateAfterParts.parts, reservedConnections, strategy);
          const compiled = routed.map((wire, index) => compileWire({ ...wires[index], ...wire }));
          const connections = asConnections(compiled);
          return {
            compiled,
            quality: evaluateLayout({ parts: stateAfterParts.parts, connections }),
            visualCost: visualRouteCost(stateAfterParts.parts, connections),
          };
        });
        candidates.sort((a, b) => b.quality.score - a.quality.score || a.visualCost - b.visualCost);
        let compiled = candidates[0].compiled;
        let routeQuality = candidates[0].quality;
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
            if (index < 0 || wires[index].via?.length) return [];
            const otherConnections = asConnections(compiled).filter((connection) => connection.id !== wireId);
            return (['input', 'reverse', 'shortest', 'longest'] as const).map((strategy) => {
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
          refinements.sort((a, b) => b.quality.score - a.quality.score || a.visualCost - b.visualCost);
          if (!refinements.length || refinements[0].quality.score <= routeQuality.score) break;
          compiled = refinements[0].compiled;
          routeQuality = refinements[0].quality;
        }
        circuitStore.applyConnections(compiled);
        const boardId = applyArduinoCode(effective);
        circuitStore.select(null);

        const state = circuitStore.getSnapshot();
        const quality = evaluateLayout(state);
        const blocking = quality.issues.filter((issue) => issue.kind === 'part-overlap' || issue.kind === 'wire-through-part');
        if (blocking.length) {
          throw new Error(`Grid build rejected: ${blocking.map((issue) => issue.message).join(' | ')}`);
        }
        const suggestedEdit = suggestCleanerPlacement(state, quality.score);
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
