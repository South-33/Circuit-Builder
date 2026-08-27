import type { WirePoint } from '../circuit/types';

const EPSILON = 0.01;
export type WireAxis = 'horizontal' | 'vertical';

function same(a: WirePoint, b: WirePoint) {
  return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;
}

function axisBetween(a: WirePoint, b: WirePoint): WireAxis | null {
  if (Math.abs(a.y - b.y) < EPSILON) return 'horizontal';
  if (Math.abs(a.x - b.x) < EPSILON) return 'vertical';
  return null;
}

export function simplifyWirePoints(points: WirePoint[]): WirePoint[] {
  const result: WirePoint[] = [];
  for (const point of points) {
    if (!result.length || !same(result[result.length - 1], point)) result.push({ ...point });
  }
  return result;
}

export function normalizeWaypoints(start: WirePoint, waypoints: WirePoint[], end: WirePoint): WirePoint[] {
  return simplifyWirePoints([start, ...waypoints, end]).slice(1, -1);
}

function connector(from: WirePoint, to: WirePoint, preferredAxis?: WireAxis) {
  if (axisBetween(from, to)) return [{ ...to }];
  const axis = preferredAxis
    ?? (Math.abs(to.x - from.x) >= Math.abs(to.y - from.y) ? 'horizontal' : 'vertical');
  const corner = axis === 'horizontal'
    ? { x: to.x, y: from.y }
    : { x: from.x, y: to.y };
  return [corner, { ...to }];
}

/**
 * Render stored wire geometry without routing it. Authored interior waypoints
 * are preserved exactly, including diagonals for human-created wires. The app
 * only adds a minimal lead-in/out elbow when a grid-authored route does not
 * land exactly on the physical source or destination pin.
 */
export function connectionPolyline(
  start: WirePoint,
  waypoints: WirePoint[] | undefined,
  end: WirePoint,
  firstAxis?: WireAxis,
) {
  const authored = simplifyWirePoints(waypoints ?? []);
  if (!authored.length) return simplifyWirePoints([start, ...connector(start, end, firstAxis)]);

  const result: WirePoint[] = [{ ...start }];
  result.push(...connector(start, authored[0], firstAxis));
  for (const waypoint of authored.slice(1)) result.push({ ...waypoint });

  const last = result[result.length - 1];
  const previous = result.length >= 2 ? result[result.length - 2] : null;
  const previousAxis = previous ? axisBetween(previous, last) ?? undefined : undefined;
  result.push(...connector(last, end, previousAxis));
  return simplifyWirePoints(result);
}

export function isOrthogonalPair(a: WirePoint, b: WirePoint) {
  return axisBetween(a, b) !== null;
}

export function roundedPath(points: WirePoint[], radius = 3.5): string {
  if (!points.length) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    const incoming = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outgoing = Math.hypot(next.x - corner.x, next.y - corner.y);
    const bend = Math.min(radius, incoming / 2, outgoing / 2);
    if (bend < 0.75) {
      path += ` L ${corner.x} ${corner.y}`;
      continue;
    }
    const before = {
      x: corner.x - ((corner.x - previous.x) / incoming) * bend,
      y: corner.y - ((corner.y - previous.y) / incoming) * bend,
    };
    const after = {
      x: corner.x + ((next.x - corner.x) / outgoing) * bend,
      y: corner.y + ((next.y - corner.y) / outgoing) * bend,
    };
    path += ` L ${before.x} ${before.y} Q ${corner.x} ${corner.y} ${after.x} ${after.y}`;
  }
  const last = points[points.length - 1];
  return `${path} L ${last.x} ${last.y}`;
}

export function nearestPointOnPolyline(points: WirePoint[], point: WirePoint) {
  let best: { point: WirePoint; segmentIndex: number; distance: number } | null = null;
  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index];
    const b = points[index + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const ratio = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
    const projected = { x: a.x + ratio * dx, y: a.y + ratio * dy };
    const distance = Math.hypot(projected.x - point.x, projected.y - point.y);
    if (!best || distance < best.distance) best = { point: projected, segmentIndex: index, distance };
  }
  return best;
}

export function snapPoint(point: WirePoint, grid = 5): WirePoint {
  return {
    x: Math.round(point.x / grid) * grid,
    y: Math.round(point.y / grid) * grid,
  };
}
