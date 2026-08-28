import type { CircuitConnection, CircuitPart, WirePoint } from '../../circuit/types';
import { endpointParts, endpointPoint, offsetPoint, partRect, pinExitDirection, type CardinalDirection } from '../../wires/geometry';
import { simplifyWirePoints } from '../../wires/path';
import { AGENT_GRID_SIZE, type GridPoint } from './grid';
import { BREADBOARD_HOLE_PITCH, isBreadboardType } from '../../breadboard/geometry';
import { CANVAS_CENTER_X, CANVAS_CENTER_Y } from '../../layout/placement';

export type RouteRole = 'signal' | 'power' | 'ground';

export type AutoRouteRequest = {
  id?: string;
  from: string;
  to: string;
  color: string;
  role?: RouteRole;
};

type Direction = CardinalDirection | 'start';
type SearchNode = GridPoint & { dir: Direction; g: number; f: number; key: string };
type LaneUse = { horizontal: number; vertical: number };
type LaneOccupancy = Map<string, LaneUse>;

const DIRS: Array<{ dir: CardinalDirection; dx: number; dy: number }> = [
  { dir: 'right', dx: 1, dy: 0 },
  { dir: 'down', dx: 0, dy: 1 },
  { dir: 'left', dx: -1, dy: 0 },
  { dir: 'up', dx: 0, dy: -1 },
];

/**
 * Routing uses the physical 0.1-inch breadboard pitch, not the coarse 32px
 * agent planning grid. This gives adjacent pins their own real wire lanes.
 */
export const ROUTING_LANE_PITCH = BREADBOARD_HOLE_PITCH;

function canvasPointToRoute(point: WirePoint): GridPoint {
  return {
    x: Math.round((point.x - CANVAS_CENTER_X) / ROUTING_LANE_PITCH),
    y: Math.round((point.y - CANVAS_CENTER_Y) / ROUTING_LANE_PITCH),
  };
}

function routePointToCanvas(point: GridPoint): WirePoint {
  return {
    x: point.x * ROUTING_LANE_PITCH + CANVAS_CENTER_X,
    y: point.y * ROUTING_LANE_PITCH + CANVAS_CENTER_Y,
  };
}

function key(x: number, y: number) {
  return `${x},${y}`;
}

function stateKey(x: number, y: number, dir: Direction) {
  return `${x},${y},${dir}`;
}

function oppositeDirection(direction: CardinalDirection): CardinalDirection {
  if (direction === 'left') return 'right';
  if (direction === 'right') return 'left';
  if (direction === 'up') return 'down';
  return 'up';
}

function inferExitDirection(endpoint: string, parts: CircuitPart[], toward: WirePoint): CardinalDirection {
  const parsed = endpointParts(endpoint);
  const part = parsed ? parts.find((candidate) => candidate.id === parsed.partId) : undefined;
  // A seated component pin is physically a breadboard socket. It should not
  // inherit the visual body's edge direction, because that creates needless
  // detours around a component that the wire is actually plugging into.
  const explicit = part?.seating ? null : pinExitDirection(endpoint, parts);
  if (explicit) return explicit;
  const point = endpointPoint(endpoint, parts);
  if (point && part && !part.seating) {
    const rect = partRect(part);
    const distances: Array<[CardinalDirection, number]> = [
      ['left', Math.abs(point.x - rect.x)],
      ['right', Math.abs(rect.x + rect.width - point.x)],
      ['up', Math.abs(point.y - rect.y)],
      ['down', Math.abs(rect.y + rect.height - point.y)],
    ];
    const nearest = distances.reduce((best, candidate) => candidate[1] < best[1] ? candidate : best);
    if (nearest[1] <= ROUTING_LANE_PITCH * 2.5) return nearest[0];
  }
  if (!point) return 'right';
  const dx = toward.x - point.x;
  const dy = toward.y - point.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'down' : 'up';
}

function endpointDirectionCandidates(endpoint: string, parts: CircuitPart[], toward: WirePoint) {
  const preferred = inferExitDirection(endpoint, parts, toward);
  const parsed = endpointParts(endpoint);
  const part = parsed ? parts.find((candidate) => candidate.id === parsed.partId) : undefined;
  if (!part || (!isBreadboardType(part.type) && !part.seating)) return [preferred];
  // Breadboard holes and seated pins are omnidirectional sockets. Let the
  // router choose a side that keeps neighboring wires traceable instead of
  // forcing several wires into the same short lead corridor.
  return [preferred, ...(['up', 'right', 'down', 'left'] as CardinalDirection[]).filter((direction) => direction !== preferred)];
}

function obstacleCells(parts: CircuitPart[], excludedPartIds: Set<string>) {
  const blocked = new Set<string>();
  for (const part of parts) {
    if (excludedPartIds.has(part.id)) continue;
    const rect = partRect(part);
    const padding = part.seating ? 0 : ROUTING_LANE_PITCH * 0.8;
    const left = Math.floor((rect.x - padding - CANVAS_CENTER_X) / ROUTING_LANE_PITCH);
    const right = Math.ceil((rect.x + rect.width + padding - CANVAS_CENTER_X) / ROUTING_LANE_PITCH);
    const top = Math.floor((rect.y - padding - CANVAS_CENTER_Y) / ROUTING_LANE_PITCH);
    const bottom = Math.ceil((rect.y + rect.height + padding - CANVAS_CENTER_Y) / ROUTING_LANE_PITCH);
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) blocked.add(key(x, y));
    }
  }
  return blocked;
}

function nearestOutsideLead(point: WirePoint, direction: CardinalDirection, part: CircuitPart | undefined) {
  // Breadboard holes and seated pins are already physical wire sockets. They
  // do not need the artificial one-lane clearance used to escape a component
  // body. Starting/ending on the nearest routing cell avoids tiny U-shaped
  // doglegs around otherwise direct breadboard connections.
  if (part && (isBreadboardType(part.type) || part.seating)) return canvasPointToRoute(point);
  let distance = ROUTING_LANE_PITCH * 1.25;
  if (part && !part.seating) {
    const rect = partRect(part);
    if (direction === 'left') distance = Math.max(distance, point.x - rect.x + ROUTING_LANE_PITCH * 1.25);
    if (direction === 'right') distance = Math.max(distance, rect.x + rect.width - point.x + ROUTING_LANE_PITCH * 1.25);
    if (direction === 'up') distance = Math.max(distance, point.y - rect.y + ROUTING_LANE_PITCH * 1.25);
    if (direction === 'down') distance = Math.max(distance, rect.y + rect.height - point.y + ROUTING_LANE_PITCH * 1.25);
  }
  return canvasPointToRoute(offsetPoint(point, direction, distance));
}

function heuristic(a: GridPoint, b: GridPoint) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function popLowest(open: SearchNode[]) {
  let best = 0;
  for (let i = 1; i < open.length; i++) {
    if (open[i].f < open[best].f || (open[i].f === open[best].f && open[i].g < open[best].g)) best = i;
  }
  return open.splice(best, 1)[0];
}

function searchRoute(
  start: GridPoint,
  goal: GridPoint,
  blocked: Set<string>,
  occupied: LaneOccupancy,
  startDirection: CardinalDirection,
): GridPoint[] {
  const minX = Math.min(start.x, goal.x) - 24;
  const maxX = Math.max(start.x, goal.x) + 24;
  const minY = Math.min(start.y, goal.y) - 24;
  const maxY = Math.max(start.y, goal.y) + 24;
  blocked.delete(key(start.x, start.y));
  blocked.delete(key(goal.x, goal.y));

  const open: SearchNode[] = [{ ...start, dir: startDirection, g: 0, f: heuristic(start, goal), key: stateKey(start.x, start.y, startDirection) }];
  const bestCost = new Map<string, number>([[open[0].key, 0]]);
  const parent = new Map<string, string>();
  const nodeByKey = new Map<string, SearchNode>([[open[0].key, open[0]]]);
  let winner: SearchNode | null = null;
  let iterations = 0;

  while (open.length && iterations++ < 45000) {
    const current = popLowest(open);
    if (current.x === goal.x && current.y === goal.y) {
      winner = current;
      break;
    }
    for (const step of DIRS) {
      const x = current.x + step.dx;
      const y = current.y + step.dy;
      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      const cell = key(x, y);
      if (blocked.has(cell)) continue;
      const bend = current.dir !== 'start' && current.dir !== step.dir ? 8 : 0;
      const reversing = current.dir !== 'start' && oppositeDirection(current.dir) === step.dir ? 30 : 0;
      const orientation = step.dir === 'left' || step.dir === 'right' ? 'horizontal' : 'vertical';
      const perpendicular = orientation === 'horizontal' ? 'vertical' : 'horizontal';
      const laneUse = occupied.get(cell);
      // A shared lane is visually ambiguous, so make it substantially more
      // expensive than a perpendicular crossing. Both are still escapable if
      // the circuit is genuinely boxed in.
      const overlapPenalty = laneUse?.[orientation] ? 180 + laneUse[orientation] * 55 : 0;
      const crossingPenalty = laneUse?.[perpendicular] ? 90 + laneUse[perpendicular] * 30 : 0;
      let parallelNeighborBonus = 0;
      const neighbors = orientation === 'horizontal'
        ? [{ x, y: y - 1 }, { x, y: y + 1 }]
        : [{ x: x - 1, y }, { x: x + 1, y }];
      for (const neighbor of neighbors) {
        if ((occupied.get(key(neighbor.x, neighbor.y))?.[orientation] ?? 0) > 0) parallelNeighborBonus += 0.12;
      }
      let backtrackPenalty = 0;
      const overallDx = goal.x - start.x;
      const overallDy = goal.y - start.y;
      if (Math.abs(overallDx) >= 3 && ((overallDx > 0 && step.dir === 'left') || (overallDx < 0 && step.dir === 'right'))) backtrackPenalty += 12;
      if (Math.abs(overallDy) >= 3 && ((overallDy > 0 && step.dir === 'up') || (overallDy < 0 && step.dir === 'down'))) backtrackPenalty += 12;
      const g = current.g + 1 + bend + reversing + overlapPenalty + crossingPenalty + backtrackPenalty - Math.min(0.24, parallelNeighborBonus);
      const nextKey = stateKey(x, y, step.dir);
      if (g >= (bestCost.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
      const next: SearchNode = { x, y, dir: step.dir, g, f: g + heuristic({ x, y }, goal), key: nextKey };
      bestCost.set(nextKey, g);
      parent.set(nextKey, current.key);
      nodeByKey.set(nextKey, next);
      open.push(next);
    }
  }

  if (!winner) {
    if (start.x === goal.x || start.y === goal.y) return [start, goal];
    const xFirst = [start, { x: goal.x, y: start.y }, goal];
    const yFirst = [start, { x: start.x, y: goal.y }, goal];
    const score = (path: GridPoint[]) => {
      let penalty = 0;
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        const dx = Math.sign(b.x - a.x);
        const dy = Math.sign(b.y - a.y);
        let x = a.x;
        let y = a.y;
        while (x !== b.x || y !== b.y) {
          x += dx;
          y += dy;
          if (blocked.has(key(x, y))) penalty += 100;
          const use = occupied.get(key(x, y));
          const orientation = dx !== 0 ? 'horizontal' : 'vertical';
          const perpendicular = orientation === 'horizontal' ? 'vertical' : 'horizontal';
          if ((use?.[orientation] ?? 0) > 0) penalty += 180;
          if ((use?.[perpendicular] ?? 0) > 0) penalty += 90;
        }
      }
      return penalty;
    };
    return score(xFirst) <= score(yFirst) ? xFirst : yFirst;
  }

  const reversed: GridPoint[] = [];
  let cursor: string | undefined = winner.key;
  while (cursor) {
    const node = nodeByKey.get(cursor);
    if (!node) break;
    reversed.push({ x: node.x, y: node.y });
    cursor = parent.get(cursor);
  }
  return reversed.reverse();
}

function condenseGridPath(points: GridPoint[]) {
  if (points.length <= 2) return points;
  const result: GridPoint[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const here = points[i];
    const next = points[i + 1];
    const sameX = prev.x === here.x && here.x === next.x;
    const sameY = prev.y === here.y && here.y === next.y;
    if (!sameX && !sameY) result.push(here);
  }
  result.push(points.at(-1)!);
  return result;
}

function alignedLead(pin: WirePoint, grid: GridPoint, direction: CardinalDirection) {
  const target = routePointToCanvas(grid);
  return direction === 'up' || direction === 'down'
    ? { x: pin.x, y: target.y }
    : { x: target.x, y: pin.y };
}

function simplifyOrthogonal(points: WirePoint[]) {
  const simple = simplifyWirePoints(points);
  if (simple.length <= 2) return simple;
  const result: WirePoint[] = [simple[0]];
  for (let i = 1; i < simple.length - 1; i++) {
    const prev = result.at(-1)!;
    const here = simple[i];
    const next = simple[i + 1];
    if ((prev.x === here.x && here.x === next.x) || (prev.y === here.y && here.y === next.y)) continue;
    result.push(here);
  }
  result.push(simple.at(-1)!);
  return result;
}

function routeAgainstOccupiedCost(points: WirePoint[], occupied: LaneOccupancy) {
  let cost = 0;
  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index];
    const b = points[index + 1];
    const start = canvasPointToRoute(a);
    const end = canvasPointToRoute(b);
    const dx = Math.sign(end.x - start.x);
    const dy = Math.sign(end.y - start.y);
    const orientation = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'horizontal' : 'vertical';
    const perpendicular = orientation === 'horizontal' ? 'vertical' : 'horizontal';
    let x = start.x;
    let y = start.y;
    while (true) {
      const use = occupied.get(key(x, y));
      if ((use?.[orientation] ?? 0) > 0) cost += 220;
      if ((use?.[perpendicular] ?? 0) > 0) cost += 110;
      if (x === end.x && y === end.y) break;
      if (x !== end.x) x += dx;
      else if (y !== end.y) y += dy;
    }
    cost += Math.hypot(b.x - a.x, b.y - a.y) / ROUTING_LANE_PITCH * 0.12;
  }
  cost += Math.max(0, points.length - 2) * 5;
  return cost;
}

function markOccupiedSegment(a: WirePoint, b: WirePoint, occupied: LaneOccupancy) {
  const start = canvasPointToRoute(a);
  const end = canvasPointToRoute(b);
  const dx = Math.sign(end.x - start.x);
  const dy = Math.sign(end.y - start.y);
  const orientation = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'horizontal' : 'vertical';
  let x = start.x;
  let y = start.y;
  while (true) {
    const cellKey = key(x, y);
    const use = occupied.get(cellKey) ?? { horizontal: 0, vertical: 0 };
    use[orientation] += 1;
    occupied.set(cellKey, use);
    if (x === end.x && y === end.y) break;
    if (x !== end.x) x += dx;
    else if (y !== end.y) y += dy;
  }
}

function requestDistance(request: AutoRouteRequest, parts: CircuitPart[]) {
  const start = endpointPoint(request.from, parts);
  const end = endpointPoint(request.to, parts);
  return start && end ? Math.abs(start.x - end.x) + Math.abs(start.y - end.y) : 0;
}

function routeRequestsInOrder(parts: CircuitPart[], requests: AutoRouteRequest[], order: number[]) {
  const routedByIndex = new Map<number, CircuitConnection>();
  const occupied: LaneOccupancy = new Map();

  for (const index of order) {
    const request = requests[index];
    const start = endpointPoint(request.from, parts);
    const end = endpointPoint(request.to, parts);
    if (!start || !end) throw new Error(`Cannot route ${request.from} -> ${request.to}: endpoint geometry is unavailable.`);
    const fromId = endpointParts(request.from)?.partId;
    const toId = endpointParts(request.to)?.partId;
    const excluded = new Set([fromId, toId].filter((value): value is string => Boolean(value)));
    const blocked = obstacleCells(parts, excluded);
    const startPart = parts.find((part) => part.id === fromId);
    const endPart = parts.find((part) => part.id === toId);
    const startDir = inferExitDirection(request.from, parts, end);
    const startLead = nearestOutsideLead(start, startDir, startPart);
    let bestRoute: { full: WirePoint[]; complete: WirePoint[]; cost: number } | null = null;
    for (const endDir of endpointDirectionCandidates(request.to, parts, start)) {
      const endLead = nearestOutsideLead(end, endDir, endPart);
      const cells = searchRoute(startLead, endLead, new Set(blocked), occupied, startDir);
      const corners = condenseGridPath(cells).map(routePointToCanvas);
      const firstAligned = alignedLead(start, startLead, startDir);
      const lastAligned = alignedLead(end, endLead, endDir);
      const full = simplifyOrthogonal([firstAligned, ...corners, lastAligned]);
      const complete = simplifyOrthogonal([start, ...full, end]);
      const cost = routeAgainstOccupiedCost(complete, occupied);
      if (!bestRoute || cost < bestRoute.cost) bestRoute = { full, complete, cost };
    }
    if (!bestRoute) throw new Error(`Cannot route ${request.from} -> ${request.to}.`);
    const { full, complete } = bestRoute;
    for (let segmentIndex = 0; segmentIndex < complete.length - 1; segmentIndex++) {
      markOccupiedSegment(complete[segmentIndex], complete[segmentIndex + 1], occupied);
    }
    routedByIndex.set(index, {
      id: request.id ?? `wire${index + 1}`,
      from: request.from,
      to: request.to,
      color: request.color,
      waypoints: full,
    });
  }
  return requests.map((_, index) => routedByIndex.get(index)!);
}

type RoutedSetCellUse = { horizontal: Set<number>; vertical: Set<number> };

function routeSetScore(parts: CircuitPart[], connections: CircuitConnection[]) {
  const cells = new Map<string, RoutedSetCellUse>();
  let bends = 0;
  let length = 0;
  let routeQualityCost = 0;

  for (let wireIndex = 0; wireIndex < connections.length; wireIndex++) {
    const connection = connections[wireIndex];
    const start = endpointPoint(connection.from, parts);
    const end = endpointPoint(connection.to, parts);
    if (!start || !end) continue;
    const points = simplifyOrthogonal([start, ...(connection.waypoints ?? []), end]);
    bends += Math.max(0, points.length - 2);

    let interiorStart = 0;
    let interiorEnd = points.length;
    const fromPartId = endpointParts(connection.from)?.partId;
    const toPartId = endpointParts(connection.to)?.partId;
    const fromPart = parts.find((part) => part.id === fromPartId);
    const toPart = parts.find((part) => part.id === toPartId);
    const segmentDirection = (a: WirePoint, b: WirePoint): CardinalDirection | null => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return null;
      if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
      return dy >= 0 ? 'down' : 'up';
    };
    let endpointLeadReversal = false;
    if (fromPart && !fromPart.seating && points.length >= 2) {
      const expected = pinExitDirection(connection.from, parts);
      const actual = segmentDirection(points[0], points[1]);
      const next = points.length >= 3 ? segmentDirection(points[1], points[2]) : null;
      endpointLeadReversal ||= Boolean(expected && actual === expected && next === oppositeDirection(expected));
      if (expected && actual === expected && next !== oppositeDirection(expected)) interiorStart = 1;
    }
    if (toPart && !toPart.seating && interiorEnd - interiorStart >= 2) {
      const expectedExit = pinExitDirection(connection.to, parts);
      const expectedApproach = expectedExit ? oppositeDirection(expectedExit) : null;
      const actualApproach = segmentDirection(points.at(-2)!, points.at(-1)!);
      const previous = points.length >= 3 ? segmentDirection(points.at(-3)!, points.at(-2)!) : null;
      endpointLeadReversal ||= Boolean(expectedApproach && actualApproach === expectedApproach && previous === expectedExit);
      if (expectedApproach && actualApproach === expectedApproach && previous !== expectedExit) interiorEnd -= 1;
    }
    if (endpointLeadReversal) routeQualityCost += 90;
    const interior = points.slice(interiorStart, interiorEnd);
    if (interior.length >= 2) {
      const overallDx = interior.at(-1)!.x - interior[0].x;
      const overallDy = interior.at(-1)!.y - interior[0].y;
      let backtrack = 0;
      let interiorLength = 0;
      let interiorBends = 0;
      let previousAxis: 'horizontal' | 'vertical' | null = null;
      for (let index = 0; index < interior.length - 1; index++) {
        const dx = interior[index + 1].x - interior[index].x;
        const dy = interior[index + 1].y - interior[index].y;
        interiorLength += Math.hypot(dx, dy);
        if (Math.abs(overallDx) >= AGENT_GRID_SIZE * 3 && Math.sign(dx) && Math.sign(dx) !== Math.sign(overallDx)) backtrack += Math.abs(dx);
        if (Math.abs(overallDy) >= AGENT_GRID_SIZE * 3 && Math.sign(dy) && Math.sign(dy) !== Math.sign(overallDy)) backtrack += Math.abs(dy);
        if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
          const axis = Math.abs(dx) >= Math.abs(dy) ? 'horizontal' as const : 'vertical' as const;
          if (previousAxis && axis !== previousAxis) interiorBends += 1;
          previousAxis = axis;
        }
      }
      if (backtrack >= AGENT_GRID_SIZE * 2.5) routeQualityCost += 70 + backtrack / AGENT_GRID_SIZE * 4;
      if (interiorBends > 6) routeQualityCost += 60 + (interiorBends - 6) * 15;
      const direct = Math.hypot(overallDx, overallDy);
      if (direct > 80 && interiorLength > direct * 2.7) routeQualityCost += 50 + (interiorLength / direct - 2.7) * 10;
    }

    for (let segmentIndex = 0; segmentIndex < points.length - 1; segmentIndex++) {
      const a = points[segmentIndex];
      const b = points[segmentIndex + 1];
      length += Math.hypot(b.x - a.x, b.y - a.y);
      const startCell = canvasPointToRoute(a);
      const endCell = canvasPointToRoute(b);
      const dx = Math.sign(endCell.x - startCell.x);
      const dy = Math.sign(endCell.y - startCell.y);
      const orientation = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'horizontal' : 'vertical';
      let x = startCell.x;
      let y = startCell.y;
      while (true) {
        const cellKey = key(x, y);
        const use = cells.get(cellKey) ?? { horizontal: new Set<number>(), vertical: new Set<number>() };
        use[orientation].add(wireIndex);
        cells.set(cellKey, use);
        if (x === endCell.x && y === endCell.y) break;
        if (x !== endCell.x) x += dx;
        else if (y !== endCell.y) y += dy;
      }
    }
  }

  let conflictCost = 0;
  for (const use of cells.values()) {
    const horizontal = use.horizontal.size;
    const vertical = use.vertical.size;
    if (horizontal > 1) conflictCost += (horizontal * (horizontal - 1) / 2) * 240;
    if (vertical > 1) conflictCost += (vertical * (vertical - 1) / 2) * 240;
    if (horizontal && vertical) {
      for (const horizontalWire of use.horizontal) {
        for (const verticalWire of use.vertical) {
          if (horizontalWire !== verticalWire) conflictCost += 140;
        }
      }
    }
  }

  // Conflicts dominate. Length and bends only break ties between similarly
  // readable candidates, so the router does not trade a crossing for a tiny
  // path-length win.
  return {
    problemCost: conflictCost + routeQualityCost,
    score: conflictCost + routeQualityCost + bends * 2 + length / ROUTING_LANE_PITCH * 0.02,
  };
}

function uniqueOrders(orders: number[][]) {
  const seen = new Set<string>();
  return orders.filter((order) => {
    const signature = order.join(',');
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

export function autoRouteConnections(parts: CircuitPart[], requests: AutoRouteRequest[]): CircuitConnection[] {
  if (!requests.length) return [];
  const indexes = requests.map((_, index) => index);
  const roleRank = (role?: RouteRole) => role === 'power' || role === 'ground' ? 0 : 1;
  const priority = [...indexes].sort((a, b) => {
    const roleDelta = roleRank(requests[a].role) - roleRank(requests[b].role);
    if (roleDelta) return roleDelta;
    return requestDistance(requests[b], parts) - requestDistance(requests[a], parts) || a - b;
  });

  // Greedy routing is order-sensitive. For normal-sized circuits, try a small
  // deterministic set of useful orderings and keep the globally cleaner one.
  // Large circuits stay single-pass so routing remains predictable and fast.
  const orders = requests.length <= 16
    ? uniqueOrders([
        priority,
        [...priority].reverse(),
        [...indexes].sort((a, b) => requestDistance(requests[a], parts) - requestDistance(requests[b], parts) || a - b),
      ])
    : [priority];

  let best: CircuitConnection[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let orderIndex = 0; orderIndex < orders.length; orderIndex++) {
    const order = orders[orderIndex];
    const routed = routeRequestsInOrder(parts, requests, order);
    const quality = routeSetScore(parts, routed);
    if (quality.score < bestScore) {
      best = routed;
      bestScore = quality.score;
    }
    // Most small circuits are already clean in the preferred order. Avoid two
    // extra full A* passes when there is no crossing/overlap/backtrack problem
    // for alternate orderings to solve.
    if (orderIndex === 0 && quality.problemCost === 0) return routed;
  }
  return best ?? routeRequestsInOrder(parts, requests, priority);
}
