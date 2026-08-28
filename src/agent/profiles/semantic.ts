import { PART_DEFINITIONS, resolvePinName } from '../../components/parts';
import { BREADBOARD_HOLE_PITCH } from '../../breadboard/geometry';
import { circuitStore } from '../../circuit/store';
import type { CircuitPart, PartAttrs, PartType } from '../../circuit/types';
import { endpointPoint, pinExitDirection } from '../../wires/geometry';
import { buildAgentLayout } from '../core/layout';
import { agentPartTypeEnum, applyArduinoCode, canonicalEndpoint, defaultWireColor, parseAttrs, parseRole, requireGridPoint, requireId, requirePartType, requireString } from '../core/actions';
import { AGENT_GRID_SIZE, gridCenterPlacement, gridRectsOverlap, normalizeRightAngle, partCenterGrid, partGridSize, type GridPoint, type GridRect } from '../core/grid';
import { toolResult } from '../core/protocol';
import { autoRouteConnections } from '../core/router';
import { buildMutationSummary } from '../core/summary';
import { inferWireKind } from '../core/wiring';
import type { ToolDefinition, WireRole } from '../types';

type Side = 'left' | 'right' | 'above' | 'below';
type RelativePlacement = { to: string; side: Side; gap: number; portsFace: boolean };
type Seat = { breadboardId: string; pin: string; hole: string };

type SemanticPart = {
  id: string;
  type: PartType;
  anchor: boolean;
  center?: GridPoint;
  relative?: RelativePlacement;
  rotate?: number | 'auto';
  attrs?: PartAttrs;
  seat?: Seat;
};

type RawConnection = { id?: string; from: string; to: string; role?: WireRole; color?: string };

function endpointId(endpoint: string) {
  const colon = endpoint.indexOf(':');
  return colon > 0 ? endpoint.slice(0, colon) : endpoint;
}

function endpointPin(endpoint: string) {
  const colon = endpoint.indexOf(':');
  return colon > 0 ? endpoint.slice(colon + 1) : '';
}

function parsePart(raw: unknown, index: number): SemanticPart {
  if (!raw || typeof raw !== 'object') throw new Error(`parts[${index}] must be an object.`);
  const value = raw as Record<string, unknown>;
  const relativeRaw = value.relative && typeof value.relative === 'object' ? value.relative as Record<string, unknown> : null;
  let relative: RelativePlacement | undefined;
  if (relativeRaw) {
    const side = requireString(relativeRaw.side, `parts[${index}].relative.side`) as Side;
    if (!['left', 'right', 'above', 'below'].includes(side)) throw new Error(`parts[${index}].relative.side must be left/right/above/below.`);
    const gap = relativeRaw.gap === undefined ? 2 : Number(relativeRaw.gap);
    if (!Number.isFinite(gap) || gap < 0) throw new Error(`parts[${index}].relative.gap must be >= 0.`);
    relative = {
      to: requireId(relativeRaw.to, `parts[${index}].relative.to`),
      side,
      gap: Math.round(gap),
      portsFace: relativeRaw.portsFace === true,
    };
  }
  const seatRaw = value.seat && typeof value.seat === 'object' ? value.seat as Record<string, unknown> : null;
  const seat = seatRaw ? {
    breadboardId: requireString(seatRaw.breadboardId, `parts[${index}].seat.breadboardId`),
    pin: requireString(seatRaw.pin, `parts[${index}].seat.pin`),
    hole: requireString(seatRaw.hole, `parts[${index}].seat.hole`),
  } : undefined;
  const rotationRaw = value.rotate;
  const rotate = rotationRaw === 'auto'
    ? 'auto' as const
    : typeof rotationRaw === 'number'
      ? normalizeRightAngle(rotationRaw)
      : undefined;
  return {
    id: requireId(value.id, `parts[${index}].id`),
    type: requirePartType(value.type, `parts[${index}].type`),
    anchor: value.anchor === true,
    ...(value.center !== undefined ? { center: requireGridPoint(value.center, `parts[${index}].center`) } : {}),
    ...(relative ? { relative } : {}),
    ...(rotate !== undefined ? { rotate } : {}),
    ...(parseAttrs(value.attrs) ? { attrs: parseAttrs(value.attrs) } : {}),
    ...(seat ? { seat } : {}),
  };
}

function parseConnections(input: unknown): RawConnection[] {
  if (!Array.isArray(input)) return [];
  return input.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new Error(`connections[${index}] must be an object.`);
    const value = raw as Record<string, unknown>;
    return {
      ...(value.id !== undefined ? { id: requireId(value.id, `connections[${index}].id`) } : {}),
      from: requireString(value.from, `connections[${index}].from`),
      to: requireString(value.to, `connections[${index}].to`),
      ...(parseRole(value.role) ? { role: parseRole(value.role) } : {}),
      ...(typeof value.color === 'string' ? { color: value.color } : {}),
    };
  });
}

function desiredFacing(side: Side) {
  if (side === 'left') return 'right';
  if (side === 'right') return 'left';
  if (side === 'above') return 'down';
  return 'up';
}

function chooseRotation(spec: SemanticPart, connections: RawConnection[]) {
  if (typeof spec.rotate === 'number') return spec.rotate;
  // Boards and layout surfaces have a strong natural reading orientation. Do
  // not rotate an Arduino/breadboard merely to save a few wire cells.
  if (PART_DEFINITIONS[spec.type].category === 'Boards' || PART_DEFINITIONS[spec.type].category === 'Layout') return 0;
  if (!spec.relative?.portsFace) return 0;
  const desired = desiredFacing(spec.relative.side);
  const relevantPins = connections.flatMap((connection) => {
    const fromId = endpointId(connection.from);
    const toId = endpointId(connection.to);
    if (fromId === spec.id && toId === spec.relative!.to) return [endpointPin(connection.from)];
    if (toId === spec.id && fromId === spec.relative!.to) return [endpointPin(connection.to)];
    return [];
  });
  if (!relevantPins.length) return 0;

  let best = { rotation: 0, score: Number.NEGATIVE_INFINITY };
  for (const rotation of [0, 90, 180, 270]) {
    const placement = gridCenterPlacement(spec.type, { x: 0, y: 0 }, rotation);
    const temp: CircuitPart = {
      id: spec.id,
      type: spec.type,
      ...placement,
      rotate: rotation,
      attrs: { ...PART_DEFINITIONS[spec.type].defaults, ...(spec.attrs ?? {}) },
    };
    let score = 0;
    for (const requested of relevantPins) {
      const pin = resolvePinName(temp, requested);
      if (!pin) continue;
      const direction = pinExitDirection(`${spec.id}:${pin}`, [temp]);
      if (direction === desired) score += 5;
      else if (direction) score -= 1;
    }
    if (score > best.score) best = { rotation, score };
  }
  return best.rotation;
}

function relationCenter(spec: SemanticPart, reference: CircuitPart, rotation: number): GridPoint {
  const refCenter = partCenterGrid(reference);
  const refSize = partGridSize(reference);
  const ownSize = partGridSize(spec.type, rotation);
  const gap = spec.relative?.gap ?? 2;
  const xDistance = Math.ceil((refSize.w + ownSize.w) / 2) + gap;
  const yDistance = Math.ceil((refSize.h + ownSize.h) / 2) + gap;
  switch (spec.relative?.side) {
    case 'left': return { x: refCenter.x - xDistance, y: refCenter.y };
    case 'right': return { x: refCenter.x + xDistance, y: refCenter.y };
    case 'above': return { x: refCenter.x, y: refCenter.y - yDistance };
    case 'below': return { x: refCenter.x, y: refCenter.y + yDistance };
    default: return spec.center ?? { x: 0, y: 0 };
  }
}

function alignCenterToConnectedPorts(
  spec: SemanticPart,
  reference: CircuitPart,
  rotation: number,
  preferred: GridPoint,
  connections: RawConnection[],
): GridPoint {
  if (!spec.relative) return preferred;
  const placement = gridCenterPlacement(spec.type, preferred, rotation);
  const temp: CircuitPart = {
    id: spec.id,
    type: spec.type,
    ...placement,
    rotate: rotation,
    attrs: { ...PART_DEFINITIONS[spec.type].defaults, ...(spec.attrs ?? {}) },
  };
  const deltas: number[] = [];
  for (const connection of connections) {
    const fromId = endpointId(connection.from);
    const toId = endpointId(connection.to);
    let ownPin: string | null = null;
    let targetPin: string | null = null;
    if (fromId === spec.id && toId === reference.id) {
      ownPin = resolvePinName(temp, endpointPin(connection.from));
      targetPin = resolvePinName(reference, endpointPin(connection.to));
    } else if (toId === spec.id && fromId === reference.id) {
      ownPin = resolvePinName(temp, endpointPin(connection.to));
      targetPin = resolvePinName(reference, endpointPin(connection.from));
    }
    if (!ownPin || !targetPin) continue;
    const own = endpointPoint(`${temp.id}:${ownPin}`, [temp]);
    const target = endpointPoint(`${reference.id}:${targetPin}`, [reference]);
    if (!own || !target) continue;
    deltas.push(spec.relative.side === 'left' || spec.relative.side === 'right' ? target.y - own.y : target.x - own.x);
  }
  if (!deltas.length) return preferred;
  const average = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
  const cells = Math.round(average / AGENT_GRID_SIZE);
  return spec.relative.side === 'left' || spec.relative.side === 'right'
    ? { x: preferred.x, y: preferred.y + cells }
    : { x: preferred.x + cells, y: preferred.y };
}

function fineAlignPlacementToConnectedPorts(
  spec: SemanticPart,
  reference: CircuitPart,
  rotation: number,
  placement: { left: number; top: number },
  connections: RawConnection[],
) {
  if (!spec.relative) return placement;
  const temp: CircuitPart = {
    id: spec.id,
    type: spec.type,
    ...placement,
    rotate: rotation,
    attrs: { ...PART_DEFINITIONS[spec.type].defaults, ...(spec.attrs ?? {}) },
  };
  const deltas: number[] = [];
  for (const connection of connections) {
    const fromId = endpointId(connection.from);
    const toId = endpointId(connection.to);
    let ownPin: string | null = null;
    let targetPin: string | null = null;
    if (fromId === spec.id && toId === reference.id) {
      ownPin = resolvePinName(temp, endpointPin(connection.from));
      targetPin = resolvePinName(reference, endpointPin(connection.to));
    } else if (toId === spec.id && fromId === reference.id) {
      ownPin = resolvePinName(temp, endpointPin(connection.to));
      targetPin = resolvePinName(reference, endpointPin(connection.from));
    }
    if (!ownPin || !targetPin) continue;
    const own = endpointPoint(`${temp.id}:${ownPin}`, [temp]);
    const target = endpointPoint(`${reference.id}:${targetPin}`, [reference]);
    if (!own || !target) continue;
    deltas.push(spec.relative.side === 'left' || spec.relative.side === 'right' ? target.y - own.y : target.x - own.x);
  }
  if (!deltas.length) return placement;
  const average = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
  // Coarse semantic placement stays easy for the model to reason about, then a
  // small physical-lane nudge lines the actual port cluster up with its target.
  // The coarse pass already removed most of the delta, so cap this residual to
  // avoid surprising large moves.
  const residual = Math.max(-AGENT_GRID_SIZE / 2, Math.min(AGENT_GRID_SIZE / 2, average));
  const nudge = Math.round(residual / BREADBOARD_HOLE_PITCH) * BREADBOARD_HOLE_PITCH;
  return spec.relative.side === 'left' || spec.relative.side === 'right'
    ? { left: placement.left, top: Math.round((placement.top + nudge) * 100) / 100 }
    : { left: Math.round((placement.left + nudge) * 100) / 100, top: placement.top };
}

function footprint(type: PartType, rotation: number, center: GridPoint): GridRect {
  const size = partGridSize(type, rotation);
  return {
    x: center.x - Math.floor(size.w / 2),
    y: center.y - Math.floor(size.h / 2),
    w: size.w,
    h: size.h,
  };
}

function clearCenter(type: PartType, rotation: number, preferred: GridPoint, existing: CircuitPart[], side?: Side) {
  const occupied = existing.filter((part) => !part.seating).map((part) => footprint(part.type, part.rotate ?? 0, partCenterGrid(part)));
  const candidates: GridPoint[] = [preferred];
  for (let radius = 1; radius <= 10; radius++) {
    if (side === 'left' || side === 'right') {
      candidates.push({ x: preferred.x, y: preferred.y - radius }, { x: preferred.x, y: preferred.y + radius });
    } else if (side === 'above' || side === 'below') {
      candidates.push({ x: preferred.x - radius, y: preferred.y }, { x: preferred.x + radius, y: preferred.y });
    }
    candidates.push(
      { x: preferred.x - radius, y: preferred.y - radius },
      { x: preferred.x + radius, y: preferred.y - radius },
      { x: preferred.x - radius, y: preferred.y + radius },
      { x: preferred.x + radius, y: preferred.y + radius },
    );
  }
  return candidates.find((center) => occupied.every((rect) => !gridRectsOverlap(footprint(type, rotation, center), rect))) ?? preferred;
}

export function createSemanticHarnessTool(): ToolDefinition {
  return {
    name: 'build-circuit',
    description: 'Harness C, semantic placement plus deterministic routing. Describe what goes where relative to other parts and which pins connect. The harness converts relations into centered snapped geometry, can rotate ports toward their target, avoids part collisions, and routes wires orthogonally with pin-exit, low-backtracking, trunk-first, crossing, and overlap costs. Plan the full circuit and include code in this same call when possible. Use role=power/ground/signal and normally omit color: supply/ground colors are standardized automatically. Prefer semantic relations over exact coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        replace: { type: 'boolean', description: 'Clear the current workbench first. Defaults to true.' },
        boardId: { type: 'string', description: 'Optional Arduino board ID when supplying code. Defaults to the first Arduino Uno.' },
        code: { type: 'string', description: 'Optional complete Arduino sketch to set in this same semantic build call.' },
        parts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              type: { type: 'string', enum: agentPartTypeEnum, description: 'Agent-facing component type ID. Use one of these exact values.' },
              anchor: { type: 'boolean', description: 'Place this part at workbench center (0,0) unless center is given. Use one central anchor, usually the breadboard.' },
              center: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
              relative: {
                type: 'object',
                properties: {
                  to: { type: 'string' },
                  side: { type: 'string', enum: ['left', 'right', 'above', 'below'] },
                  gap: { type: 'number', description: 'Clear routing-lane cells between part footprints. Defaults to 2.' },
                  portsFace: { type: 'boolean', description: 'If true, choose 0/90/180/270 so pins connected to the target face toward it.' },
                },
                required: ['to', 'side'],
              },
              rotate: { description: '0/90/180/270 or "auto". Auto is meaningful with relative.portsFace=true.' },
              attrs: { type: 'object' },
              seat: {
                type: 'object',
                description: 'Seat a breadboard-mounted component at an exact physical hole after the board is placed.',
                properties: { breadboardId: { type: 'string' }, pin: { type: 'string' }, hole: { type: 'string' } },
                required: ['breadboardId', 'pin', 'hole'],
              },
            },
            required: ['id', 'type'],
          },
        },
        connections: {
          type: 'array',
          description: 'Electrical intent only. The harness chooses cable paths.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              from: { type: 'string' },
              to: { type: 'string' },
              role: { type: 'string', enum: ['signal', 'power', 'ground'] },
              color: { type: 'string' },
            },
            required: ['from', 'to'],
          },
        },
      },
      required: ['parts', 'connections'],
    },
    async execute(input) {
      if (input.replace !== false) circuitStore.replaceDocument({ parts: [], connections: [] });
      const specs = (Array.isArray(input.parts) ? input.parts : []).map(parsePart);
      const connections = parseConnections(input.connections);
      const seated = specs.filter((spec) => spec.seat);
      const pending = specs.filter((spec) => !spec.seat);
      const declaredAnchor = pending.find((spec) => spec.anchor);
      const inferredAnchor = declaredAnchor ?? pending.find((spec) => spec.type.startsWith('breadboard')) ?? pending[0];
      const placed = new Set(circuitStore.getSnapshot().parts.map((part) => part.id));

      let guard = 0;
      while (pending.length && guard++ < specs.length * 3 + 3) {
        let progress = false;
        for (let index = pending.length - 1; index >= 0; index--) {
          const spec = pending[index];
          const isAnchor = spec.id === inferredAnchor?.id;
          const reference = spec.relative
            ? circuitStore.getSnapshot().parts.find((part) => part.id === spec.relative!.to)
            : undefined;
          if (spec.relative && !reference) continue;
          const rotation = chooseRotation(spec, connections);
          let preferred = spec.center ?? (reference ? relationCenter(spec, reference, rotation) : { x: 0, y: 0 });
          if (reference && !spec.center) preferred = alignCenterToConnectedPorts(spec, reference, rotation, preferred, connections);
          if (isAnchor && !spec.center) preferred = { x: 0, y: 0 };
          const existing = circuitStore.getSnapshot().parts;
          const center = clearCenter(spec.type, rotation, preferred, existing, spec.relative?.side);
          const coarsePlacement = gridCenterPlacement(spec.type, center, rotation);
          const placement = reference && !spec.center
            ? fineAlignPlacementToConnectedPorts(spec, reference, rotation, coarsePlacement, connections)
            : coarsePlacement;
          circuitStore.applyParts([{
            id: spec.id,
            type: spec.type,
            ...placement,
            rotate: rotation,
            ...(spec.attrs ? { attrs: spec.attrs } : {}),
          }]);
          placed.add(spec.id);
          pending.splice(index, 1);
          progress = true;
        }
        if (!progress) {
          const unresolved = pending.map((spec) => `${spec.id}->${spec.relative?.to ?? 'none'}`).join(', ');
          throw new Error(`Could not resolve semantic placement dependencies: ${unresolved}`);
        }
      }

      for (const spec of seated) {
        if (!spec.seat || !placed.has(spec.seat.breadboardId)) throw new Error(`Cannot seat ${spec.id}: breadboard ${spec.seat?.breadboardId} is not placed.`);
        circuitStore.applyParts([{
          id: spec.id,
          type: spec.type,
          rotate: typeof spec.rotate === 'number' ? spec.rotate : 0,
          seat: spec.seat,
          ...(spec.attrs ? { attrs: spec.attrs } : {}),
        }]);
        placed.add(spec.id);
      }

      const stateAfterParts = circuitStore.getSnapshot();
      const usedIds = new Set(stateAfterParts.connections.map((wire) => wire.id));
      const routedRequests = connections.map((connection, index) => {
        const from = canonicalEndpoint(connection.from, stateAfterParts.parts);
        const to = canonicalEndpoint(connection.to, stateAfterParts.parts);
        let id = connection.id ?? `auto${index + 1}`;
        let suffix = 1;
        while (usedIds.has(id)) id = `auto${index + 1}_${suffix++}`;
        usedIds.add(id);
        const standardColor = defaultWireColor(from, to, connection.role);
        return {
          id,
          from,
          to,
          ...(connection.role ? { role: connection.role } : {}),
          color: inferWireKind(from, to, connection.role) === 'signal' && connection.color ? connection.color : standardColor,
        };
      });
      const routed = autoRouteConnections(stateAfterParts.parts, routedRequests);
      circuitStore.applyConnections(routed);
      const boardId = applyArduinoCode(input);

      const state = circuitStore.getSnapshot();
      return toolResult({
        harness: 'c',
        placement: state.parts.map((part) => ({ id: part.id, center: partCenterGrid(part), rotate: part.rotate ?? 0 })),
        autorouted: routed.map((wire) => wire.id),
        ...(boardId ? { codeBoardId: boardId } : {}),
        ...buildMutationSummary(state),
      });
    },
  };
}
