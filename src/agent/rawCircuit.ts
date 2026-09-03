import { BREADBOARD_HOLE_PITCH, isBreadboardType } from '../breadboard/geometry';
import { circuitStore } from '../circuit/store';
import type { CircuitPart, PartAttrs, WirePoint } from '../circuit/types';
import { evaluateLayout } from '../layout/quality';
import { CANVAS_CENTER_X, CANVAS_CENTER_Y } from '../layout/placement';
import { diagnoseCircuit } from '../sim/diagnostics';
import { endpointPoint } from '../wires/geometry';
import { isOrthogonalPair } from '../wires/path';
import { BLOCK_UNITS_PER_CELL, blockPlacement, normalizeRightAngle, partBlockAt } from './geometry';
import { agentPartType, agentPartTypeEnum, canonicalEndpoint, requireId, requirePartType, requireString } from './input';
import { toolResult } from './protocol';
import type { ToolDefinition } from './types';

const UNIT_PX = BREADBOARD_HOLE_PITCH / BLOCK_UNITS_PER_CELL;

type Pair = [number, number];

function pair(value: unknown, name: string, integer = false): Pair {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${name} must be [x,y].`);
  const x = Number(value[0]);
  const y = Number(value[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`${name} must contain finite numbers.`);
  if (integer && (!Number.isInteger(x) || !Number.isInteger(y))) throw new Error(`${name} must contain integer grid cells.`);
  return [x, y];
}

function unitToCanvas([x, y]: Pair): WirePoint {
  return {
    x: CANVAS_CENTER_X + x * UNIT_PX,
    y: CANVAS_CENTER_Y + y * UNIT_PX,
  };
}

function canvasToUnit(point: WirePoint): Pair {
  return [
    Math.round(((point.x - CANVAS_CENTER_X) / UNIT_PX) * 10) / 10,
    Math.round(((point.y - CANVAS_CENTER_Y) / UNIT_PX) * 10) / 10,
  ];
}

function attrs(value: unknown, name: string): PartAttrs | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value as PartAttrs;
}

function parseSeat(value: unknown, name: string) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  const seat = value as Record<string, unknown>;
  return {
    breadboardId: requireId(seat.breadboardId, `${name}.breadboardId`),
    pin: requireString(seat.pin, `${name}.pin`),
    hole: requireString(seat.hole, `${name}.hole`),
  };
}

function parsePart(value: unknown, index: number, existing: CircuitPart[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`parts[${index}] must be an object.`);
  const raw = value as Record<string, unknown>;
  const id = requireId(raw.id, `parts[${index}].id`);
  const prior = existing.find((part) => part.id === id);
  const type = raw.type === undefined
    ? prior?.type
    : requirePartType(raw.type, `parts[${index}].type`);
  if (!type) throw new Error(`parts[${index}].type is required for new part "${id}".`);
  const rotate = raw.rotate === undefined ? normalizeRightAngle(prior?.rotate ?? 0) : normalizeRightAngle(Number(raw.rotate));
  if (![0, 90, 180, 270].includes(rotate)) throw new Error(`parts[${index}].rotate must be 0, 90, 180, or 270.`);
  const seat = parseSeat(raw.seat, `parts[${index}].seat`);
  const at = raw.at === undefined ? undefined : pair(raw.at, `parts[${index}].at`, true);
  const nudge = raw.nudge === undefined ? undefined : pair(raw.nudge, `parts[${index}].nudge`);
  if (seat && at) throw new Error(`parts[${index}] must use seat or at, not both.`);
  if (seat && nudge) throw new Error(`parts[${index}] cannot nudge a breadboard-seated part.`);
  if (!seat && !at && !prior) throw new Error(`parts[${index}] needs at:[cellX,cellY] or seat.`);

  const placement = at
    ? blockPlacement(type, { x: at[0], y: at[1] }, rotate)
    : prior
      ? { left: prior.left, top: prior.top }
      : { left: CANVAS_CENTER_X, top: CANVAS_CENTER_Y };
  const left = placement.left + (nudge?.[0] ?? 0) * UNIT_PX;
  const top = placement.top + (nudge?.[1] ?? 0) * UNIT_PX;
  const parsedAttrs = attrs(raw.attrs, `parts[${index}].attrs`);

  return {
    id,
    type,
    left,
    top,
    rotate,
    ...(parsedAttrs ? { attrs: parsedAttrs } : {}),
    ...(seat ? { seat } : {}),
  };
}

function parseWire(value: unknown, index: number) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`wires[${index}] must be an object.`);
  const raw = value as Record<string, unknown>;
  const id = requireId(raw.id, `wires[${index}].id`);
  const state = circuitStore.getSnapshot();
  const from = canonicalEndpoint(raw.from, state.parts);
  const to = canonicalEndpoint(raw.to, state.parts);
  if (from === to) throw new Error(`wires[${index}] cannot connect a pin to itself.`);
  const points = raw.points === undefined
    ? []
    : Array.isArray(raw.points)
      ? raw.points.map((point, pointIndex) => pair(point, `wires[${index}].points[${pointIndex}]`))
      : (() => { throw new Error(`wires[${index}].points must be an array of [x,y] unit points.`); })();
  const waypoints = points.map(unitToCanvas);
  const start = endpointPoint(from, state.parts);
  const end = endpointPoint(to, state.parts);
  if (!start || !end) throw new Error(`wires[${index}] could not resolve its endpoints.`);
  const polyline = [start, ...waypoints, end];
  for (let segment = 0; segment < polyline.length - 1; segment++) {
    if (!isOrthogonalPair(polyline[segment], polyline[segment + 1])) {
      const a = canvasToUnit(polyline[segment]);
      const b = canvasToUnit(polyline[segment + 1]);
      throw new Error(`wires[${index}] segment ${segment} is diagonal (${a.join(',')} -> ${b.join(',')}). Every segment must share x or y exactly.`);
    }
  }
  return {
    id,
    from,
    to,
    color: typeof raw.color === 'string' && raw.color.trim() ? raw.color.trim() : '#24a35a',
    waypoints,
  };
}

// Kept local to this experiment so the production semantic builder is untouched.
export function createRawCircuitTool(): ToolDefinition {
  return {
    name: 'raw-circuit',
    description: `Literal-grid circuit editor. You directly own component placement and every visible wire path.

Coordinate system:
- Component at:[x,y] uses integer breadboard-pitch cells, relative to workbench center.
- Wire points use finer units where ${BLOCK_UNITS_PER_CELL} units = 1 component cell. A point [120,-30] means 12 cells right and 3 cells up from center.
- inspect-circuit catalogTypes returns compact footprints, defaults, and pin summaries. After placement, request only the endpoints you need with pinEndpoints to get global wire coordinates. Ask for catalogPinTypes only if exact local pin offsets are truly needed.

Place the scene like a human would. Use seat for breadboard-mounted parts. Use nudge only for a small sub-cell correction. Every wire is literal endpoint -> points -> endpoint. No router or hidden detours. Every segment must be horizontal or vertical. Prefer 0-2 bends and separate nearby lanes. After the first scene build, patch only the parts or wires you want to change. Do not use replace:true again unless you really want to erase the scene.

The result is intentionally compact. Use inspect-circuit when you need full state or diagnostics, and render-circuit when you need to judge the picture.`,
    inputSchema: {
      type: 'object',
      properties: {
        replace: { type: 'boolean', description: 'When true, clear the current circuit before applying these parts and wires.' },
        removePartIds: { type: 'array', items: { type: 'string' } },
        removeWireIds: { type: 'array', items: { type: 'string' } },
        parts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              type: { type: 'string', enum: agentPartTypeEnum },
              at: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 },
              rotate: { type: 'integer', enum: [0, 90, 180, 270] },
              nudge: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
              attrs: { type: 'object' },
              seat: {
                type: 'object',
                properties: {
                  breadboardId: { type: 'string' },
                  pin: { type: 'string' },
                  hole: { type: 'string' },
                },
                required: ['breadboardId', 'pin', 'hole'],
              },
            },
            required: ['id'],
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
              color: { type: 'string' },
              points: {
                type: 'array',
                items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
              },
            },
            required: ['id', 'from', 'to'],
          },
        },
      },
    },
    async execute(input) {
      const replace = input.replace === true;
      const removePartIds = Array.isArray(input.removePartIds)
        ? input.removePartIds.map((value, index) => requireId(value, `removePartIds[${index}]`))
        : [];
      const removeWireIds = Array.isArray(input.removeWireIds)
        ? input.removeWireIds.map((value, index) => requireId(value, `removeWireIds[${index}]`))
        : [];
      const existing = circuitStore.getSnapshot().parts;
      const rawParts = Array.isArray(input.parts) ? input.parts : [];
      const parsedParts = rawParts.map((value, index) => parsePart(value, index, existing));
      parsedParts.sort((a, b) => Number(isBreadboardType(b.type)) - Number(isBreadboardType(a.type)));
      if (replace || parsedParts.length || removePartIds.length) {
        circuitStore.applyParts(parsedParts, removePartIds, replace);
      }
      const rawWires = Array.isArray(input.wires) ? input.wires : [];
      const parsedWires = rawWires.map((value, index) => parseWire(value, index));
      if (parsedWires.length || removeWireIds.length) circuitStore.applyConnections(parsedWires, removeWireIds);
      const state = circuitStore.getSnapshot();
      const diagnostics = diagnoseCircuit(state);
      const layout = evaluateLayout(state);
      const appliedPartIds = new Set(parsedParts.map((part) => part.id));
      const appliedStoredParts = state.parts.filter((part) => appliedPartIds.has(part.id));
      return toolResult({
        harness: 'raw-grid',
        appliedParts: appliedStoredParts.map((part) => ({
          id: part.id,
          type: agentPartType(part.type),
          ...(!part.seating ? { blockAt: partBlockAt(part) } : { seating: part.seating }),
          ...(part.rotate ? { rotate: part.rotate } : {}),
        })),
        appliedWires: parsedWires.map((wire) => ({
          id: wire.id,
          from: wire.from,
          to: wire.to,
          color: wire.color,
          points: (wire.waypoints ?? []).map(canvasToUnit),
        })),
        ...(removePartIds.length ? { removedPartIds: removePartIds } : {}),
        ...(removeWireIds.length ? { removedWireIds: removeWireIds } : {}),
        state: { parts: state.parts.length, wires: state.connections.length },
        diagnostics: {
          errors: diagnostics.filter((item) => item.severity === 'error').length,
          warnings: diagnostics.filter((item) => item.severity === 'warning').length,
          ...(diagnostics.length <= 4 ? { items: diagnostics } : {}),
        },
        layout: {
          errors: layout.issues.filter((item) => item.severity === 'error').length,
          warnings: layout.issues.filter((item) => item.severity === 'warning').length,
          ...(layout.issues.length <= 4 ? { issues: layout.issues } : {}),
        },
      });
    },
  };
}
