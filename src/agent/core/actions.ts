import { PART_ORDER, resolvePinName } from '../../components/parts';
import { circuitStore } from '../../circuit/store';
import type { CircuitConnection, CircuitPart, PartAttrs, PartType, WirePoint } from '../../circuit/types';
import { AGENT_GRID_SIZE, gridPointToCanvas } from './grid';
import { endpointParts, endpointPoint, offsetPoint, partRect, pinExitDirection, type CardinalDirection } from '../../wires/geometry';
import { simplifyWirePoints } from '../../wires/path';
import type { WireRole } from '../types';
import { inferWireKind, standardWireColor } from './wiring';

export const internalPartTypeEnum = [...PART_ORDER];

const MANUAL_PART_TYPE_ALIASES: Record<string, PartType> = {
  arduino: 'wokwi-arduino-uno',
  uno: 'wokwi-arduino-uno',
  'arduino-uno-r3': 'wokwi-arduino-uno',
  'uno-r3': 'wokwi-arduino-uno',
  'half-breadboard': 'breadboard-half',
  'breadboard-full': 'breadboard',
  'servo-motor': 'wokwi-servo',
};

export function agentPartType(type: PartType) {
  return type.startsWith('wokwi-') ? type.slice('wokwi-'.length) : type;
}

export const agentPartTypeEnum = Array.from(new Set(internalPartTypeEnum.map(agentPartType)));

const agentPartTypeLookup = new Map<string, PartType>();
for (const type of internalPartTypeEnum) {
  agentPartTypeLookup.set(type, type);
  agentPartTypeLookup.set(agentPartType(type), type);
}
for (const [alias, type] of Object.entries(MANUAL_PART_TYPE_ALIASES)) agentPartTypeLookup.set(alias, type);

function normalizePartTypeInput(value: string) {
  return value.trim().replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[\s_]+/g, '-').toLowerCase();
}

export function requireString(value: unknown, name: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

export function requirePartType(value: unknown, name = 'type'): PartType {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty part type.`);
  const normalized = normalizePartTypeInput(value);
  const resolved = agentPartTypeLookup.get(normalized);
  if (!resolved) {
    throw new Error(`${name} is not a supported part type: ${String(value)}. Supported agent type IDs: ${agentPartTypeEnum.join(', ')}`);
  }
  return resolved;
}

export function requireId(value: unknown, name = 'id') {
  const id = requireString(value, name);
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) throw new Error(`${name} must start with a letter and contain only letters, numbers, _ or -.`);
  return id;
}

export function applyArduinoCode(input: Record<string, unknown>) {
  if (typeof input.code !== 'string') return undefined;
  const boardId = typeof input.boardId === 'string' && input.boardId.trim()
    ? requireId(input.boardId, 'boardId')
    : circuitStore.getSnapshot().parts.find((part) => part.type === 'wokwi-arduino-uno')?.id;
  if (!boardId) throw new Error('code was supplied, but no Arduino Uno exists in the workspace.');
  const board = circuitStore.getSnapshot().parts.find((part) => part.id === boardId);
  if (!board || board.type !== 'wokwi-arduino-uno') throw new Error(`${boardId} is not an Arduino Uno.`);
  circuitStore.setCode(boardId, input.code);
  return boardId;
}

export function requireGridPoint(value: unknown, name = 'point'): WirePoint {
  if (!value || typeof value !== 'object') throw new Error(`${name} must be {x,y}.`);
  const raw = value as Record<string, unknown>;
  if (typeof raw.x !== 'number' || !Number.isFinite(raw.x) || typeof raw.y !== 'number' || !Number.isFinite(raw.y)) {
    throw new Error(`${name} requires finite numeric x and y.`);
  }
  return { x: Math.round(raw.x), y: Math.round(raw.y) };
}

export function defaultWireColor(from: string, to: string, role?: WireRole | string) {
  return standardWireColor(from, to, role);
}

export function canonicalEndpoint(endpoint: unknown, parts: CircuitPart[] = circuitStore.getSnapshot().parts) {
  const raw = requireString(endpoint, 'endpoint');
  const colon = raw.indexOf(':');
  if (colon <= 0) throw new Error(`Invalid endpoint "${raw}". Use partId:pinName.`);
  const partId = raw.slice(0, colon);
  const requestedPin = raw.slice(colon + 1);
  const part = parts.find((candidate) => candidate.id === partId);
  if (!part) throw new Error(`Part "${partId}" does not exist.`);
  const pin = resolvePinName(part, requestedPin);
  if (!pin) throw new Error(`Pin "${requestedPin}" does not exist on ${partId}.`);
  return `${partId}:${pin}`;
}

export function parseGridPath(value: unknown, name: string) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${name} must be an array of grid points.`);
  const points = value.map((point, index) => requireGridPoint(point, `${name}[${index}]`));
  for (let i = 0; i < points.length - 1; i++) {
    if (points[i].x !== points[i + 1].x && points[i].y !== points[i + 1].y) {
      throw new Error(`${name}[${i}] -> ${name}[${i + 1}] is diagonal. Wire paths must use horizontal/vertical runs.`);
    }
  }
  return points.map(gridPointToCanvas);
}

function endpointPart(endpoint: string, parts: CircuitPart[]) {
  const partId = endpointParts(endpoint)?.partId;
  return partId ? parts.find((part) => part.id === partId) : undefined;
}

function cleanLead(endpoint: string, parts: CircuitPart[]) {
  const point = endpointPoint(endpoint, parts);
  if (!point) return null;
  const part = endpointPart(endpoint, parts);
  const direction = pinExitDirection(endpoint, parts);
  if (!direction || !part) return { point, lead: point, direction: null as CardinalDirection | null };
  const rect = partRect(part);
  let distance = AGENT_GRID_SIZE * 0.55;
  if (direction === 'left') distance = Math.max(distance, point.x - rect.x + AGENT_GRID_SIZE * 0.35);
  if (direction === 'right') distance = Math.max(distance, rect.x + rect.width - point.x + AGENT_GRID_SIZE * 0.35);
  if (direction === 'up') distance = Math.max(distance, point.y - rect.y + AGENT_GRID_SIZE * 0.35);
  if (direction === 'down') distance = Math.max(distance, rect.y + rect.height - point.y + AGENT_GRID_SIZE * 0.35);
  return { point, lead: offsetPoint(point, direction, distance), direction };
}

function joinOrthogonal(a: WirePoint, b: WirePoint, firstAxis: 'horizontal' | 'vertical') {
  if (Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01) return [a, b];
  const elbow = firstAxis === 'horizontal' ? { x: b.x, y: a.y } : { x: a.x, y: b.y };
  return [a, elbow, b];
}

/**
 * Compile an agent-authored grid route onto exact physical pin geometry. The
 * model still owns the route lanes; this only guarantees clean straight pin
 * exits/entries and removes the diagonal endpoint artifacts caused by exact
 * pins not living on the coarse 32px planning grid.
 */
function compileAgentWaypoints(from: string, to: string, authored: WirePoint[] | undefined, parts: CircuitPart[]) {
  const start = endpointPoint(from, parts);
  const end = endpointPoint(to, parts);
  if (!start || !end) return authored;

  const startInfo = cleanLead(from, parts);
  const endInfo = cleanLead(to, parts);
  const startLead = startInfo?.lead ?? start;
  const endLead = endInfo?.lead ?? end;
  const anchors = authored?.length ? authored : [];
  const startAxis = startInfo?.direction === 'left' || startInfo?.direction === 'right' ? 'vertical' : 'horizontal';
  const endAxis = endInfo?.direction === 'left' || endInfo?.direction === 'right' ? 'vertical' : 'horizontal';
  const points: WirePoint[] = [startLead];

  if (!anchors.length) {
    points.push(...joinOrthogonal(startLead, endLead, startAxis).slice(1));
  } else {
    const first = anchors[0];
    const last = anchors.at(-1)!;
    points.push(...joinOrthogonal(startLead, first, startAxis).slice(1));
    if (anchors.length > 1) points.push(...anchors.slice(1));
    points.push(...joinOrthogonal(last, endLead, endAxis).slice(1));
  }
  points.push(end);

  return simplifyWirePoints([start, ...points]).slice(1, -1);
}

export function parseAttrs(value: unknown): PartAttrs | undefined {
  return value && typeof value === 'object' ? value as PartAttrs : undefined;
}

export function parseRole(value: unknown): WireRole | undefined {
  if (value === undefined) return undefined;
  if (value === 'signal' || value === 'power' || value === 'ground') return value;
  throw new Error(`role must be signal, power, or ground.`);
}

export function connectionFromInput(raw: Record<string, unknown>, pathField = 'path', compilePinLeads = false): Partial<CircuitConnection> & { from: string; to: string } {
  const from = canonicalEndpoint(raw.from);
  const to = canonicalEndpoint(raw.to);
  if (from === to) throw new Error('A wire cannot connect a pin to itself.');
  const role = parseRole(raw.role);
  const authoredWaypoints = parseGridPath(raw[pathField], pathField);
  const waypoints = compilePinLeads
    ? compileAgentWaypoints(from, to, authoredWaypoints, circuitStore.getSnapshot().parts)
    : authoredWaypoints;
  const kind = inferWireKind(from, to, role);
  const color = kind === 'signal' && typeof raw.color === 'string'
    ? raw.color
    : standardWireColor(from, to, role);
  return {
    ...(typeof raw.id === 'string' && raw.id.trim() ? { id: raw.id.trim() } : {}),
    from,
    to,
    color,
    ...(waypoints !== undefined ? { waypoints } : {}),
  };
}
