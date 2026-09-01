import { getPartBounds, getPartPins, PART_DEFINITIONS } from '../components/parts';
import { isBreadboardType } from '../breadboard/geometry';
import type { CircuitPart, WirePoint } from '../circuit/types';

export type Rect = { x: number; y: number; width: number; height: number };
export type CardinalDirection = 'left' | 'right' | 'up' | 'down';

export function endpointParts(endpoint: string) {
  const colon = endpoint.indexOf(':');
  if (colon < 1) return null;
  return { partId: endpoint.slice(0, colon), pinName: endpoint.slice(colon + 1) };
}

export function rotatePointAround(point: WirePoint, center: WirePoint, degrees = 0): WirePoint {
  if (!degrees) return point;
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + (dx * cos - dy * sin),
    y: center.y + (dx * sin + dy * cos),
  };
}

export function rotatePoint(point: WirePoint, degrees = 0): WirePoint {
  return rotatePointAround(point, { x: 0, y: 0 }, degrees);
}

export function localPinPoint(part: CircuitPart, pinName: string): WirePoint | null {
  const pin = getPartPins(part).find((candidate) => candidate.name === pinName);
  if (!pin) return null;
  const scale = PART_DEFINITIONS[part.type].renderScale;
  const bounds = getPartBounds(part);
  const center = { x: bounds.width / 2, y: bounds.height / 2 };
  return rotatePointAround({ x: pin.x * scale, y: pin.y * scale }, center, part.rotate ?? 0);
}

export function endpointPoint(endpoint: string, parts: CircuitPart[]): WirePoint | null {
  const parsed = endpointParts(endpoint);
  if (!parsed) return null;
  const part = parts.find((candidate) => candidate.id === parsed.partId);
  if (!part) return null;
  const local = localPinPoint(part, parsed.pinName);
  return local ? { x: part.left + local.x, y: part.top + local.y } : null;
}

export function partRect(part: CircuitPart): Rect {
  const bounds = getPartBounds(part);
  const center = { x: bounds.width / 2, y: bounds.height / 2 };
  const corners = [
    { x: 0, y: 0 },
    { x: bounds.width, y: 0 },
    { x: bounds.width, y: bounds.height },
    { x: 0, y: bounds.height },
  ].map((point) => rotatePointAround(point, center, part.rotate ?? 0));
  const xs = corners.map((point) => point.x + part.left);
  const ys = corners.map((point) => point.y + part.top);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function pinIsFlexible(endpoint: string, parts: CircuitPart[]) {
  const parsed = endpointParts(endpoint);
  if (!parsed) return false;
  const part = parts.find((candidate) => candidate.id === parsed.partId);
  return part
    ? PART_DEFINITIONS[part.type].flexibleLeadPins?.includes(parsed.pinName) ?? false
    : false;
}

export function pinExitDirection(endpoint: string, parts: CircuitPart[]): CardinalDirection | null {
  const parsed = endpointParts(endpoint);
  if (!parsed) return null;
  const part = parts.find((candidate) => candidate.id === parsed.partId);
  if (!part || isBreadboardType(part.type)) return null;
  if (pinIsFlexible(endpoint, parts)) return null;
  const pin = getPartPins(part).find((candidate) => candidate.name === parsed.pinName);
  if (!pin) return null;

  const definition = PART_DEFINITIONS[part.type];
  const x = pin.x;
  const y = pin.y;
  const distances: Array<[CardinalDirection, number]> = [
    ['left', x],
    ['right', definition.naturalSize.width - x],
    ['up', y],
    ['down', definition.naturalSize.height - y],
  ];
  let [direction] = distances.reduce((best, candidate) => candidate[1] < best[1] ? candidate : best);

  const turns = ((((part.rotate ?? 0) % 360) + 360) % 360) / 90;
  if (Number.isInteger(turns) && turns !== 0) {
    const order: CardinalDirection[] = ['up', 'right', 'down', 'left'];
    const index = order.indexOf(direction);
    direction = order[(index + turns) % 4];
  }
  return direction;
}

export function offsetPoint(point: WirePoint, direction: CardinalDirection, distance: number): WirePoint {
  if (direction === 'left') return { x: point.x - distance, y: point.y };
  if (direction === 'right') return { x: point.x + distance, y: point.y };
  if (direction === 'up') return { x: point.x, y: point.y - distance };
  return { x: point.x, y: point.y + distance };
}
