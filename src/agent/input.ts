import { PART_ORDER, resolvePinName } from '../components/parts';
import { circuitStore } from '../circuit/store';
import type { CircuitPart, PartAttrs, PartType } from '../circuit/types';
import type { WireRole } from '../wires/conventions';

const PART_TYPE_ALIASES: Record<string, PartType> = {
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

export const agentPartTypeEnum = Array.from(new Set(PART_ORDER.map(agentPartType)));

const partTypeLookup = new Map<string, PartType>();
for (const type of PART_ORDER) {
  partTypeLookup.set(type, type);
  partTypeLookup.set(agentPartType(type), type);
}
for (const [alias, type] of Object.entries(PART_TYPE_ALIASES)) partTypeLookup.set(alias, type);

function normalizePartType(value: string) {
  return value.trim().replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[\s_]+/g, '-').toLowerCase();
}

export function requireString(value: unknown, name: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

export function requirePartType(value: unknown, name = 'type'): PartType {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty part type.`);
  const resolved = partTypeLookup.get(normalizePartType(value));
  if (!resolved) throw new Error(`${name} is not supported: ${String(value)}. Supported types: ${agentPartTypeEnum.join(', ')}`);
  return resolved;
}

export function requireId(value: unknown, name = 'id') {
  const id = requireString(value, name);
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) throw new Error(`${name} must start with a letter and contain only letters, numbers, _ or -.`);
  return id;
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

export function parseAttrs(value: unknown): PartAttrs | undefined {
  return value && typeof value === 'object' ? value as PartAttrs : undefined;
}

export function parseRole(value: unknown): WireRole | undefined {
  if (value === undefined) return undefined;
  if (value === 'signal' || value === 'power' || value === 'ground') return value;
  throw new Error('role must be signal, power, or ground.');
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
