import { getPartPins } from '../components/parts';
import { BREADBOARD_HOLE_PITCH } from '../breadboard/geometry';
import type { CircuitConnection, CircuitPart, WirePoint } from '../circuit/types';
import { endpointParts, endpointPoint, localPinPoint, partRect } from '../wires/geometry';

export type AlignmentGuide = { axis: 'x' | 'y'; value: number };
export type AlignmentTargets = { xs: Set<number>; ys: Set<number> };

export function snapToNearest(value: number, targets: Set<number>, threshold: number) {
  let best: number | null = null;
  let bestDistance = threshold;
  for (const target of targets) {
    const distance = Math.abs(value - target);
    if (distance <= bestDistance) {
      best = target;
      bestDistance = distance;
    }
  }
  return best;
}

export function snapPointToTargets(point: WirePoint, targets: AlignmentTargets, threshold: number) {
  const x = snapToNearest(point.x, targets.xs, threshold);
  const y = snapToNearest(point.y, targets.ys, threshold);
  const guides: AlignmentGuide[] = [];
  if (x !== null) guides.push({ axis: 'x', value: x });
  if (y !== null) guides.push({ axis: 'y', value: y });
  return {
    point: {
      x: x ?? Math.round(point.x / BREADBOARD_HOLE_PITCH) * BREADBOARD_HOLE_PITCH,
      y: y ?? Math.round(point.y / BREADBOARD_HOLE_PITCH) * BREADBOARD_HOLE_PITCH,
    },
    guides,
  };
}

/**
 * Tinkercad-style orthogonal wire snapping. The next segment always leaves the
 * previous pin/bend horizontally or vertically, while the free coordinate can
 * still snap to exact pin axes or the physical breadboard lattice.
 */
export function snapOrthogonalPoint(
  point: WirePoint,
  anchor: WirePoint,
  targets: AlignmentTargets,
  threshold: number,
) {
  const horizontal = Math.abs(point.x - anchor.x) >= Math.abs(point.y - anchor.y);
  if (horizontal) {
    const x = snapToNearest(point.x, targets.xs, threshold);
    return {
      point: {
        x: x ?? Math.round(point.x / BREADBOARD_HOLE_PITCH) * BREADBOARD_HOLE_PITCH,
        y: anchor.y,
      },
      guides: [
        { axis: 'y' as const, value: anchor.y },
        ...(x !== null ? [{ axis: 'x' as const, value: x }] : []),
      ],
    };
  }

  const y = snapToNearest(point.y, targets.ys, threshold);
  return {
    point: {
      x: anchor.x,
      y: y ?? Math.round(point.y / BREADBOARD_HOLE_PITCH) * BREADBOARD_HOLE_PITCH,
    },
    guides: [
      { axis: 'x' as const, value: anchor.x },
      ...(y !== null ? [{ axis: 'y' as const, value: y }] : []),
    ],
  };
}

function addPoint(targets: AlignmentTargets, point: WirePoint | null | undefined) {
  if (!point) return;
  targets.xs.add(point.x);
  targets.ys.add(point.y);
}

export function collectWireAlignmentTargets(
  parts: CircuitPart[],
  connections: CircuitConnection[],
  excludeWireId?: string,
  excludeWaypointIndex?: number,
) {
  const targets: AlignmentTargets = { xs: new Set(), ys: new Set() };

  // Physical pin coordinates are the source of truth. The fallback lattice uses
  // the same 0.1-inch pitch, so bends and component pins share one geometry.
  for (const part of parts) {
    for (const pin of getPartPins(part)) addPoint(targets, endpointPoint(`${part.id}:${pin.name}`, parts));
  }

  for (const wire of connections) {
    if (wire.id !== excludeWireId) {
      addPoint(targets, endpointPoint(wire.from, parts));
      addPoint(targets, endpointPoint(wire.to, parts));
      for (const waypoint of wire.waypoints ?? []) addPoint(targets, waypoint);
      continue;
    }

    // While editing one wire, keep its endpoints and other bends as alignment
    // targets. This makes an almost-horizontal run snap perfectly horizontal.
    addPoint(targets, endpointPoint(wire.from, parts));
    addPoint(targets, endpointPoint(wire.to, parts));
    (wire.waypoints ?? []).forEach((waypoint, index) => {
      if (index !== excludeWaypointIndex) addPoint(targets, waypoint);
    });
  }
  return targets;
}

export function addAlignmentPoints(targets: AlignmentTargets, points: Array<WirePoint | null | undefined>) {
  for (const point of points) addPoint(targets, point);
  return targets;
}

function rectAxes(rect: { x: number; y: number; width: number; height: number }) {
  return {
    xs: [rect.x, rect.x + rect.width / 2, rect.x + rect.width],
    ys: [rect.y, rect.y + rect.height / 2, rect.y + rect.height],
  };
}

function nearestAxisDelta(values: number[], targets: Set<number>, threshold: number) {
  let best: { delta: number; target: number } | null = null;
  for (const value of values) {
    const target = snapToNearest(value, targets, threshold);
    if (target === null) continue;
    const delta = target - value;
    if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { delta, target };
  }
  return best;
}

export function alignPartToParts(
  part: CircuitPart,
  proposedLeft: number,
  proposedTop: number,
  allParts: CircuitPart[],
  threshold: number,
  connections: CircuitConnection[] = [],
) {
  const moving = { ...part, left: proposedLeft, top: proposedTop, seating: undefined };
  const movingAxes = rectAxes(partRect(moving));
  const targets: AlignmentTargets = { xs: new Set(), ys: new Set() };

  // Connected pin axes matter more than component-box edges. This permits a
  // small sub-cell slide while preserving canonical component and pin geometry.
  const connectedDeltas = connections.flatMap((connection) => {
    const from = endpointParts(connection.from);
    const to = endpointParts(connection.to);
    if (!from || !to) return [];
    const movingEnd = from.partId === part.id ? from : to.partId === part.id ? to : null;
    const fixedEnd = from.partId === part.id ? to : to.partId === part.id ? from : null;
    if (!movingEnd || !fixedEnd) return [];
    const movingPoint = localPinPoint(moving, movingEnd.pinName);
    const fixedPoint = endpointPoint(`${fixedEnd.partId}:${fixedEnd.pinName}`, allParts);
    if (!movingPoint || !fixedPoint) return [];
    return [{
      dx: fixedPoint.x - (moving.left + movingPoint.x),
      dy: fixedPoint.y - (moving.top + movingPoint.y),
      target: fixedPoint,
    }];
  });

  const nearestConnected = (axis: 'x' | 'y') => connectedDeltas
    .map((candidate) => ({ delta: axis === 'x' ? candidate.dx : candidate.dy, target: candidate.target[axis] }))
    .filter((candidate) => Math.abs(candidate.delta) <= threshold)
    .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0] ?? null;

  for (const other of allParts) {
    if (other.id === part.id) continue;
    if (other.seating?.breadboardId === part.id) continue;
    const axes = rectAxes(partRect(other));
    axes.xs.forEach((value) => targets.xs.add(value));
    axes.ys.forEach((value) => targets.ys.add(value));
  }

  const x = nearestConnected('x') ?? nearestAxisDelta(movingAxes.xs, targets.xs, threshold);
  const y = nearestConnected('y') ?? nearestAxisDelta(movingAxes.ys, targets.ys, threshold);
  const guides: AlignmentGuide[] = [];
  if (x) guides.push({ axis: 'x', value: x.target });
  if (y) guides.push({ axis: 'y', value: y.target });
  return {
    left: proposedLeft + (x?.delta ?? 0),
    top: proposedTop + (y?.delta ?? 0),
    snappedX: Boolean(x),
    snappedY: Boolean(y),
    guides,
  };
}
