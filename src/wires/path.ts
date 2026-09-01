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
    if (result.length && same(result[result.length - 1], point)) continue;
    result.push({ ...point });
    let changed = true;
    while (changed && result.length >= 3) {
      changed = false;
      const a = result[result.length - 3];
      const b = result[result.length - 2];
      const c = result[result.length - 1];
      if (same(a, c)) {
        result.splice(result.length - 2, 2);
        changed = true;
        continue;
      }
      const firstAxis = axisBetween(a, b);
      const secondAxis = axisBetween(b, c);
      const continuesForward = firstAxis === 'horizontal'
        ? (b.x - a.x) * (c.x - b.x) >= 0
        : firstAxis === 'vertical'
          ? (b.y - a.y) * (c.y - b.y) >= 0
          : false;
      if (firstAxis && firstAxis === secondAxis && continuesForward) {
        result.splice(result.length - 2, 1);
        changed = true;
      }
    }
  }
  return result;
}

export function normalizeWaypoints(start: WirePoint, waypoints: WirePoint[], end: WirePoint): WirePoint[] {
  return simplifyWirePoints([start, ...waypoints, end]).slice(1, -1);
}



/**
 * Render stored wire geometry without routing it. Authored interior waypoints
 * are preserved exactly, including diagonal bends and freeform paths as in Tinkercad.
 * The polyline directly traverses start -> waypoints -> end without injecting
 * artificial 90-degree elbows or doubling back over itself.
 */
export function connectionPolyline(
  start: WirePoint,
  waypoints: WirePoint[] | undefined,
  end: WirePoint,
  _firstAxis?: WireAxis,
) {
  const authored = simplifyWirePoints(waypoints ?? []);
  return simplifyWirePoints([start, ...authored, end]);
}

export function isOrthogonalPair(a: WirePoint, b: WirePoint) {
  return axisBetween(a, b) !== null;
}

function inferredAxis(a: WirePoint, b: WirePoint): WireAxis {
  return axisBetween(a, b) ?? (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'horizontal' : 'vertical');
}

/**
 * Move one existing bend without turning its neighboring wire runs diagonal.
 * The moved corner can slide along the route, and any connected collinear run
 * follows it until a perpendicular corner is reached. If that run reaches a
 * real endpoint, that axis is locked to the endpoint instead of moving the pin.
 */
export function moveOrthogonalWaypoint(
  start: WirePoint,
  waypoints: WirePoint[],
  end: WirePoint,
  waypointIndex: number,
  target: WirePoint,
) {
  if (waypointIndex < 0 || waypointIndex >= waypoints.length) return structuredClone(waypoints);

  const points = [start, ...waypoints.map((point) => ({ ...point })), end];
  const movedIndex = waypointIndex + 1;
  const lastIndex = points.length - 1;
  const incomingAxis = inferredAxis(points[movedIndex - 1], points[movedIndex]);
  const outgoingAxis = inferredAxis(points[movedIndex], points[movedIndex + 1]);

  const backwardBoundary = (axis: WireAxis) => {
    let index = movedIndex;
    while (index > 0 && inferredAxis(points[index - 1], points[index]) === axis) index -= 1;
    return index;
  };
  const forwardBoundary = (axis: WireAxis) => {
    let index = movedIndex;
    while (index < lastIndex && inferredAxis(points[index], points[index + 1]) === axis) index += 1;
    return index;
  };

  const incomingBoundary = backwardBoundary(incomingAxis);
  const outgoingBoundary = forwardBoundary(outgoingAxis);
  const moved = { ...target };

  if (incomingBoundary === 0) {
    if (incomingAxis === 'horizontal') moved.y = start.y;
    else moved.x = start.x;
  }
  if (outgoingBoundary === lastIndex) {
    if (outgoingAxis === 'horizontal') moved.y = end.y;
    else moved.x = end.x;
  }
  points[movedIndex] = moved;

  const moveRun = (from: number, to: number, axis: WireAxis) => {
    const min = Math.min(from, to);
    const max = Math.max(from, to);
    for (let index = min; index <= max; index++) {
      if (index === 0 || index === lastIndex) continue;
      if (axis === 'horizontal') points[index].y = moved.y;
      else points[index].x = moved.x;
    }
  };
  moveRun(incomingBoundary, movedIndex, incomingAxis);
  moveRun(movedIndex, outgoingBoundary, outgoingAxis);

  return simplifyWirePoints(points).slice(1, -1);
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
