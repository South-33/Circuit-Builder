import { isBreadboardType } from '../breadboard/geometry';
import type { CircuitConnection, CircuitPart, WirePoint } from '../circuit/types';
import { endpointParts, endpointPoint, partRect, pinExitDirection, pinIsFlexible } from '../wires/geometry';
import { connectionPolyline, simplifyWirePoints } from '../wires/path';
import { BLOCK_CELL_PX, blockCellToCanvas, type BlockCell } from './geometry';

export type RoutableWire = {
  id?: string;
  netId?: string;
  from: string;
  to: string;
  via?: BlockCell[];
  /** Exact internal corridor used by tune; never part of the agent schema. */
  viaPx?: WirePoint[];
};

export type RoutedWire = RoutableWire & { points: WirePoint[] };

type Rect = { left: number; top: number; right: number; bottom: number };
type Segment = { a: WirePoint; b: WirePoint };
type OccupiedSegment = Segment & { netId?: string };
type GraphEdge = { to: number; length: number };
type SearchNode = { node: number; direction: number; cost: number; estimate: number; serial: number };

const CLEARANCE = BLOCK_CELL_PX * 0.55;
const LANE = BLOCK_CELL_PX;
const EPSILON = 0.02;

function rounded(value: number) {
  return Math.round(value * 1000) / 1000;
}

function pointKey(point: WirePoint) {
  return `${rounded(point.x)},${rounded(point.y)}`;
}

function samePoint(a: WirePoint, b: WirePoint) {
  return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;
}

function facesAway(endpoint: string, other: WirePoint, parts: CircuitPart[]) {
  const point = endpointPoint(endpoint, parts);
  const direction = pinExitDirection(endpoint, parts);
  if (!point || !direction) return false;
  if (direction === 'left') return other.x > point.x + EPSILON;
  if (direction === 'right') return other.x < point.x - EPSILON;
  if (direction === 'up') return other.y > point.y + EPSILON;
  return other.y < point.y - EPSILON;
}

function axis(a: WirePoint, b: WirePoint) {
  if (Math.abs(a.x - b.x) < EPSILON) return 1;
  if (Math.abs(a.y - b.y) < EPSILON) return 0;
  return -1;
}

function travelDirection(a: WirePoint, b: WirePoint) {
  if (Math.abs(a.y - b.y) < EPSILON) return b.x > a.x ? 0 : 2; // right / left
  if (Math.abs(a.x - b.x) < EPSILON) return b.y > a.y ? 1 : 3; // down / up
  return -1;
}

function uniqueSorted(values: number[]) {
  return Array.from(new Set(values.map(rounded))).sort((a, b) => a - b);
}

function obstacles(parts: CircuitPart[], wire?: RoutableWire, escapedBoardIds = new Set<string>()): Rect[] {
  const endpointPartIds = wire
    ? new Set([wire.from, wire.to].flatMap((endpoint) => {
        const partId = endpointParts(endpoint)?.partId;
        return partId ? [partId] : [];
      }))
    : new Set<string>();
  const endpointBoardIds = new Set<string>();
  for (const partId of endpointPartIds) {
    const part = parts.find((candidate) => candidate.id === partId);
    if (!part) continue;
    if (isBreadboardType(part.type)) endpointBoardIds.add(part.id);
    if (part.seating) endpointBoardIds.add(part.seating.breadboardId);
  }
  const flexibleEndpointPartIds = wire
    ? new Set([wire.from, wire.to]
        .filter((endpoint) => pinIsFlexible(endpoint, parts))
        .map((endpoint) => endpointParts(endpoint)?.partId)
        .filter((partId): partId is string => Boolean(partId)))
    : new Set<string>();
  return parts.flatMap((part) => {
    if (part.seating) return [];
    if (flexibleEndpointPartIds.has(part.id)) return [];
    // A breadboard is not empty canvas. External-to-external cables go around
    // it; only a wire that terminates on this board may enter its footprint.
    if (isBreadboardType(part.type) && endpointBoardIds.has(part.id) && !escapedBoardIds.has(part.id)) return [];
    const rect = partRect(part);
    const clearance = isBreadboardType(part.type) ? 0 : CLEARANCE;
    return [{
      left: rect.x - clearance,
      top: rect.y - clearance,
      right: rect.x + rect.width + clearance,
      bottom: rect.y + rect.height + clearance,
    }];
  });
}

function pointInside(point: WirePoint, rect: Rect) {
  return point.x > rect.left + EPSILON && point.x < rect.right - EPSILON
    && point.y > rect.top + EPSILON && point.y < rect.bottom - EPSILON;
}

function segmentClear(a: WirePoint, b: WirePoint, blocked: Rect[]) {
  const segmentAxis = axis(a, b);
  if (segmentAxis < 0) return false;
  return !blocked.some((rect) => {
    if (pointInside(a, rect) || pointInside(b, rect)) return true;
    if (segmentAxis === 0) {
      return a.y > rect.top + EPSILON && a.y < rect.bottom - EPSILON
        && Math.max(Math.min(a.x, b.x), rect.left) < Math.min(Math.max(a.x, b.x), rect.right) - EPSILON;
    }
    return a.x > rect.left + EPSILON && a.x < rect.right - EPSILON
      && Math.max(Math.min(a.y, b.y), rect.top) < Math.min(Math.max(a.y, b.y), rect.bottom) - EPSILON;
  });
}

function endpointLead(endpoint: string, otherEndpoint: string, parts: CircuitPart[], allowAutomaticBoardEscape: boolean) {
  const pin = endpointPoint(endpoint, parts);
  if (!pin) throw new Error(`Cannot resolve exact pin geometry for ${endpoint}.`);
  const parsed = endpointParts(endpoint);
  const part = parts.find((candidate) => candidate.id === parsed?.partId);
  if (part && isBreadboardType(part.type) && parsed) {
    const otherPartId = endpointParts(otherEndpoint)?.partId;
    const otherPart = parts.find((candidate) => candidate.id === otherPartId);
    const otherPin = endpointPoint(otherEndpoint, parts);
    const boardRect = partRect(part);
    const otherRect = otherPart && !otherPart.seating && !isBreadboardType(otherPart.type)
      ? partRect(otherPart)
      : null;
    const laterallyOutside = otherRect
      ? otherRect.x >= boardRect.x + boardRect.width || otherRect.x + otherRect.width <= boardRect.x
      : false;
    const directRouteWouldCrossBoard = otherPin
      ? otherPin.y > boardRect.y + EPSILON
        && otherPin.y < boardRect.y + boardRect.height - EPSILON
        && Math.abs(otherPin.y - pin.y) > LANE * 1.25
      : false;
    if (allowAutomaticBoardEscape && laterallyOutside && directRouteWouldCrossBoard && parsed.pinName.includes('top')) {
      return { pin, escape: { x: pin.x, y: boardRect.y - CLEARANCE } };
    }
    if (allowAutomaticBoardEscape && laterallyOutside && directRouteWouldCrossBoard && parsed.pinName.includes('bottom')) {
      return { pin, escape: { x: pin.x, y: boardRect.y + boardRect.height + CLEARANCE } };
    }
  }
  const direction = pinExitDirection(endpoint, parts);
  if (!direction) return { pin, escape: pin };
  if (!part || part.seating || isBreadboardType(part.type)) return { pin, escape: pin };
  const rect = partRect(part);
  // Some visual pins protrude beyond their canonical part rectangle. Anchor the
  // escape to both geometries so the visible lead is always one meaningful
  // lane long instead of becoming a tiny leftover segment near the connector.
  if (direction === 'left') return { pin, escape: { x: Math.min(rect.x - CLEARANCE, pin.x - LANE), y: pin.y } };
  if (direction === 'right') return { pin, escape: { x: Math.max(rect.x + rect.width + CLEARANCE, pin.x + LANE), y: pin.y } };
  if (direction === 'up') return { pin, escape: { x: pin.x, y: Math.min(rect.y - CLEARANCE, pin.y - LANE) } };
  return { pin, escape: { x: pin.x, y: Math.max(rect.y + rect.height + CLEARANCE, pin.y + LANE) } };
}

function segments(points: WirePoint[]) {
  return points.slice(0, -1).map((point, index) => ({ a: point, b: points[index + 1] }));
}

function parallelOverlap(first: Segment, second: Segment) {
  const firstAxis = axis(first.a, first.b);
  const secondAxis = axis(second.a, second.b);
  if (firstAxis < 0 || firstAxis !== secondAxis) return 0;
  if (firstAxis === 0 && Math.abs(first.a.y - second.a.y) < EPSILON) {
    return Math.max(0, Math.min(Math.max(first.a.x, first.b.x), Math.max(second.a.x, second.b.x))
      - Math.max(Math.min(first.a.x, first.b.x), Math.min(second.a.x, second.b.x)));
  }
  if (firstAxis === 1 && Math.abs(first.a.x - second.a.x) < EPSILON) {
    return Math.max(0, Math.min(Math.max(first.a.y, first.b.y), Math.max(second.a.y, second.b.y))
      - Math.max(Math.min(first.a.y, first.b.y), Math.min(second.a.y, second.b.y)));
  }
  return 0;
}

function properCrossing(first: Segment, second: Segment) {
  const firstAxis = axis(first.a, first.b);
  const secondAxis = axis(second.a, second.b);
  if (firstAxis < 0 || secondAxis < 0 || firstAxis === secondAxis) return false;
  const horizontal = firstAxis === 0 ? first : second;
  const vertical = firstAxis === 1 ? first : second;
  const point = { x: vertical.a.x, y: horizontal.a.y };
  if (samePoint(point, horizontal.a) || samePoint(point, horizontal.b)
    || samePoint(point, vertical.a) || samePoint(point, vertical.b)) return false;
  return point.x > Math.min(horizontal.a.x, horizontal.b.x) + EPSILON
    && point.x < Math.max(horizontal.a.x, horizontal.b.x) - EPSILON
    && point.y > Math.min(vertical.a.y, vertical.b.y) + EPSILON
    && point.y < Math.max(vertical.a.y, vertical.b.y) - EPSILON;
}

function occupancyPenalty(candidate: Segment, occupied: OccupiedSegment[], netId?: string) {
  let penalty = 0;
  for (const existing of occupied) {
    const overlap = parallelOverlap(candidate, existing);
    if (overlap > EPSILON) penalty += 20_000 + overlap * 20;
    else if (properCrossing(candidate, existing)) penalty += 12_000;
  }
  return penalty;
}

class MinHeap {
  private values: SearchNode[] = [];
  get length() { return this.values.length; }

  push(value: SearchNode) {
    this.values.push(value);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      const parentValue = this.values[parent];
      if (parentValue.estimate < value.estimate
        || (parentValue.estimate === value.estimate && parentValue.serial <= value.serial)) break;
      this.values[index] = parentValue;
      index = parent;
    }
    this.values[index] = value;
  }

  pop() {
    const first = this.values[0];
    const last = this.values.pop();
    if (!first || !last || !this.values.length) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.values.length) break;
      let child = left;
      if (right < this.values.length && this.values[right].estimate < this.values[left].estimate) child = right;
      if (last.estimate <= this.values[child].estimate) break;
      this.values[index] = this.values[child];
      index = child;
    }
    this.values[index] = last;
    return first;
  }
}

function buildVisibilityGraph(anchors: WirePoint[], blocked: Rect[], occupied: OccupiedSegment[]) {
  const occupiedPoints = occupied.flatMap((segment) => [segment.a, segment.b]);
  const baseX = [...anchors.map((point) => point.x), ...blocked.flatMap((rect) => [rect.left, rect.right]), ...occupiedPoints.map((point) => point.x)];
  const baseY = [...anchors.map((point) => point.y), ...blocked.flatMap((rect) => [rect.top, rect.bottom]), ...occupiedPoints.map((point) => point.y)];
  const xs = uniqueSorted([...baseX, ...baseX.flatMap((value) => [value - LANE, value + LANE])]);
  const ys = uniqueSorted([...baseY, ...baseY.flatMap((value) => [value - LANE, value + LANE])]);
  const points: WirePoint[] = [];
  const indexes = new Map<string, number>();
  for (const y of ys) {
    for (const x of xs) {
      const point = { x, y };
      if (blocked.some((rect) => pointInside(point, rect))) continue;
      indexes.set(pointKey(point), points.length);
      points.push(point);
    }
  }
  const adjacency: GraphEdge[][] = points.map(() => []);
  const connect = (a: number, b: number) => {
    const first = points[a];
    const second = points[b];
    if (!segmentClear(first, second, blocked)) return false;
    const length = Math.abs(first.x - second.x) + Math.abs(first.y - second.y);
    adjacency[a].push({ to: b, length });
    adjacency[b].push({ to: a, length });
    return true;
  };
  const connectMeaningfulNeighbors = (line: number[]) => {
    for (let index = 0; index < line.length - 1; index++) {
      const start = points[line[index]];
      for (let candidate = index + 1; candidate < line.length; candidate++) {
        const end = points[line[candidate]];
        const length = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
        if (length < LANE - EPSILON) continue;
        connect(line[index], line[candidate]);
        break;
      }
    }
  };
  for (const y of ys) {
    const row = xs.map((x) => indexes.get(pointKey({ x, y }))).filter((index): index is number => index !== undefined);
    connectMeaningfulNeighbors(row);
  }
  for (const x of xs) {
    const column = ys.map((y) => indexes.get(pointKey({ x, y }))).filter((index): index is number => index !== undefined);
    connectMeaningfulNeighbors(column);
  }
  const connectMeaningful = (a: WirePoint, b: WirePoint) => {
    const aIndex = indexes.get(pointKey(a));
    const bIndex = indexes.get(pointKey(b));
    if (aIndex === undefined || bIndex === undefined) return;
    const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (length >= LANE - EPSILON) connect(aIndex, bIndex);
  };
  for (let first = 0; first < anchors.length; first++) {
    for (let second = first + 1; second < anchors.length; second++) {
      const a = anchors[first];
      const b = anchors[second];
      const elbowA = { x: a.x, y: b.y };
      const elbowB = { x: b.x, y: a.y };
      connectMeaningful(a, elbowA);
      connectMeaningful(elbowA, b);
      connectMeaningful(a, elbowB);
      connectMeaningful(elbowB, b);
    }
  }
  return { points, indexes, adjacency, blocked };
}

function routeSegment(
  start: WirePoint,
  goal: WirePoint,
  graph: ReturnType<typeof buildVisibilityGraph>,
  occupied: OccupiedSegment[],
  netId?: string,
) {
  if (samePoint(start, goal)) return [start];
  if (axis(start, goal) >= 0
    && segmentClear(start, goal, graph.blocked)
    && occupancyPenalty({ a: start, b: goal }, occupied, netId) === 0) return [start, goal];
  const startIndex = graph.indexes.get(pointKey(start));
  const goalIndex = graph.indexes.get(pointKey(goal));
  if (startIndex === undefined || goalIndex === undefined) throw new Error('An exact routing anchor is inside a component clearance rectangle.');
  const heap = new MinHeap();
  const costs = new Map<string, number>();
  const previous = new Map<string, string>();
  let serial = 0;
  const stateKey = (node: number, direction: number) => `${node},${direction}`;
  const initial: SearchNode = {
    node: startIndex,
    direction: -1,
    cost: 0,
    estimate: Math.abs(goal.x - start.x) + Math.abs(goal.y - start.y),
    serial: serial++,
  };
  heap.push(initial);
  costs.set(stateKey(initial.node, initial.direction), 0);
  let winningKey: string | undefined;
  while (heap.length) {
    const current = heap.pop()!;
    const currentKey = stateKey(current.node, current.direction);
    if (current.cost !== costs.get(currentKey)) continue;
    if (current.node === goalIndex) {
      winningKey = currentKey;
      break;
    }
    const currentPoint = graph.points[current.node];
    for (const edge of graph.adjacency[current.node]) {
      const nextPoint = graph.points[edge.to];
      const direction = travelDirection(currentPoint, nextPoint);
      if (current.direction >= 0 && (current.direction + 2) % 4 === direction) continue;
      const bend = current.direction >= 0 && current.direction % 2 !== direction % 2 ? LANE * 2 : 0;
      const nextCost = current.cost + edge.length + bend + occupancyPenalty({ a: currentPoint, b: nextPoint }, occupied, netId);
      const nextKey = stateKey(edge.to, direction);
      if (nextCost >= (costs.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
      costs.set(nextKey, nextCost);
      previous.set(nextKey, currentKey);
      heap.push({
        node: edge.to,
        direction,
        cost: nextCost,
        estimate: nextCost + Math.abs(goal.x - nextPoint.x) + Math.abs(goal.y - nextPoint.y),
        serial: serial++,
      });
    }
  }
  if (!winningKey) throw new Error('No clear exact orthogonal route exists. Move a component or add a sparse corridor checkpoint.');
  const result: WirePoint[] = [];
  let key: string | undefined = winningKey;
  while (key) {
    result.push(graph.points[Number(key.slice(0, key.indexOf(',')))]);
    key = previous.get(key);
  }
  return simplifyWirePoints(result.reverse());
}

function reserveConnection(occupied: OccupiedSegment[], connection: CircuitConnection, parts: CircuitPart[]) {
  const start = endpointPoint(connection.from, parts);
  const end = endpointPoint(connection.to, parts);
  if (!start || !end) return;
  occupied.push(...segments(connectionPolyline(start, connection.waypoints, end)).map((segment) => ({
    ...segment,
    ...(connection.netId ? { netId: connection.netId } : {}),
  })));
}

/** The block grid describes placement and optional corridors, never pin geometry. */
export function routeWires(
  specs: RoutableWire[],
  parts: CircuitPart[],
  reservedConnections: CircuitConnection[] = [],
  strategy: 'input' | 'reverse' | 'shortest' | 'longest' = 'shortest',
): RoutedWire[] {
  const occupied: OccupiedSegment[] = [];
  for (const connection of reservedConnections) reserveConnection(occupied, connection, parts);
  const prepared = specs.map((spec, index) => {
    const ownsCorridor = Boolean(spec.viaPx?.length || spec.via?.length);
    const source = endpointLead(spec.from, spec.to, parts, !ownsCorridor);
    const destination = endpointLead(spec.to, spec.from, parts, !ownsCorridor);
    const escapedBoardIds = new Set<string>();
    for (const [endpoint, lead] of [[spec.from, source], [spec.to, destination]] as const) {
      const partId = endpointParts(endpoint)?.partId;
      const part = parts.find((candidate) => candidate.id === partId);
      if (part && isBreadboardType(part.type) && !samePoint(lead.pin, lead.escape)) escapedBoardIds.add(part.id);
    }
    const blocked = obstacles(parts, spec, escapedBoardIds);
    const vias = spec.viaPx ?? (spec.via ?? []).map(blockCellToCanvas);
    for (const via of vias) {
      if (blocked.some((rect) => pointInside(via, rect))) {
        throw new Error(`${spec.id ?? `${spec.from}->${spec.to}`} corridor checkpoint is inside a component clearance rectangle.`);
      }
    }
    return {
      spec,
      index,
      source,
      destination,
      vias,
      blocked,
      distance: Math.abs(source.escape.x - destination.escape.x) + Math.abs(source.escape.y - destination.escape.y),
    };
  });
  if (strategy === 'reverse') prepared.reverse();
  if (strategy === 'shortest') prepared.sort((a, b) => a.distance - b.distance || a.index - b.index);
  if (strategy === 'longest') prepared.sort((a, b) => b.distance - a.distance || a.index - b.index);
  const routed = new Map<number, RoutedWire>();
  for (const item of prepared) {
    const checkpoints = [item.source.escape, ...item.vias, item.destination.escape];
    const graph = buildVisibilityGraph(checkpoints, item.blocked, occupied);
    const route: WirePoint[] = [];
    for (let index = 0; index < checkpoints.length - 1; index++) {
      let routedSegment: WirePoint[];
      try {
        routedSegment = routeSegment(checkpoints[index], checkpoints[index + 1], graph, occupied, item.spec.netId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const facingHint = facesAway(item.spec.from, item.destination.pin, parts)
          ? ` ${endpointParts(item.spec.from)?.partId ?? item.spec.from}'s terminal faces away from ${item.spec.to}; rotate or move that part before adding a corridor.`
          : facesAway(item.spec.to, item.source.pin, parts)
            ? ` ${endpointParts(item.spec.to)?.partId ?? item.spec.to}'s terminal faces away from ${item.spec.from}; rotate or move that part before adding a corridor.`
            : '';
        throw new Error(`${item.spec.id ?? `${item.spec.from}->${item.spec.to}`} (${item.spec.from} to ${item.spec.to}) could not route: ${message}${facingHint}`);
      }
      route.push(...(index ? routedSegment.slice(1) : routedSegment));
    }
    const points = simplifyWirePoints([
      item.source.pin,
      ...(samePoint(item.source.pin, item.source.escape) ? [] : [item.source.escape]),
      ...route.slice(1, -1),
      ...(samePoint(item.destination.pin, item.destination.escape) ? [] : [item.destination.escape]),
      item.destination.pin,
    ]);
    occupied.push(...segments(points).map((segment) => ({
      ...segment,
      ...(item.spec.netId ? { netId: item.spec.netId } : {}),
    })));
    routed.set(item.index, { ...item.spec, points });
  }
  return specs.map((_, index) => routed.get(index)!);
}
