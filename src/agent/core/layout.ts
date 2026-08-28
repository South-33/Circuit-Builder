import { PART_DEFINITIONS } from '../../components/parts';
import type { CircuitConnection, CircuitDocument, CircuitPart, WirePoint } from '../../circuit/types';
import { endpointParts, endpointPoint, partRect, pinExitDirection, type CardinalDirection } from '../../wires/geometry';
import { connectionPolyline, isOrthogonalPair, type WireAxis } from '../../wires/path';
import { BREADBOARD_HOLE_PITCH, isBreadboardType } from '../../breadboard/geometry';
import { CANVAS_CENTER_X, CANVAS_CENTER_Y } from '../../layout/placement';

import { AGENT_GRID_SIZE, canvasPointToGrid, partGridRect, partGridSize } from './grid';
import { inferWireKind, wireColorMatchesStandard } from './wiring';
export { AGENT_GRID_SIZE, canvasPointToGrid, gridCenterPlacement, gridPartPlacement, gridPointToCanvas, partCenterGrid, partGridSize } from './grid';

const MAP_MARGIN_CELLS = 2;
const MAX_MAP_COLUMNS = 72;
const MAX_MAP_ROWS = 42;
const SYMBOLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

type LayoutIssue = {
  kind: 'part-overlap' | 'wire-through-part' | 'wire-crossing' | 'wire-overlap' | 'diagonal-waypoints' | 'too-many-bends' | 'long-route' | 'pin-exit' | 'wire-backtrack' | 'wire-color';
  severity: 'warning' | 'error';
  itemIds: string[];
  message: string;
};

type Rect = { x: number; y: number; width: number; height: number };
type Segment = { a: WirePoint; b: WirePoint };function rectsOverlap(a: Rect, b: Rect, inset = 0) {
  return a.x + inset < b.x + b.width - inset
    && a.x + a.width - inset > b.x + inset
    && a.y + inset < b.y + b.height - inset
    && a.y + a.height - inset > b.y + inset;
}

function segmentDirection(a: WirePoint, b: WirePoint): CardinalDirection | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'down' : 'up';
}

function oppositeDirection(direction: CardinalDirection): CardinalDirection {
  if (direction === 'left') return 'right';
  if (direction === 'right') return 'left';
  if (direction === 'up') return 'down';
  return 'up';
}

function endpointPart(endpoint: string, parts: CircuitPart[]) {
  const id = endpointParts(endpoint)?.partId;
  return id ? parts.find((part) => part.id === id) : undefined;
}

function backtrackDistance(points: WirePoint[]) {
  if (points.length < 2) return 0;
  const overallDx = points.at(-1)!.x - points[0].x;
  const overallDy = points.at(-1)!.y - points[0].y;
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    if (Math.abs(overallDx) >= AGENT_GRID_SIZE * 3 && Math.sign(dx) && Math.sign(dx) !== Math.sign(overallDx)) total += Math.abs(dx);
    if (Math.abs(overallDy) >= AGENT_GRID_SIZE * 3 && Math.sign(dy) && Math.sign(dy) !== Math.sign(overallDy)) total += Math.abs(dy);
  }
  return total;
}

/**
 * Physical connector leads sometimes have to move briefly away from the final
 * destination before the cable can turn into a routing lane. Those compulsory
 * first/last segments are not layout backtracking and should not make an
 * otherwise monotonic route look worse. Keep the evaluator strict about the
 * route between those leads.
 */
function routingInteriorPoints(connection: CircuitConnection, points: WirePoint[], parts: CircuitPart[]) {
  if (points.length < 2) return points;
  let startIndex = 0;
  let endIndex = points.length;

  const fromPart = endpointPart(connection.from, parts);
  if (fromPart && !fromPart.seating) {
    const expected = pinExitDirection(connection.from, parts);
    const actual = segmentDirection(points[0], points[1]);
    const next = points.length >= 3 ? segmentDirection(points[1], points[2]) : null;
    // Only discount a compulsory pin lead when the route actually continues
    // away from it. A wire that exits correctly and immediately doubles back
    // over the same lead is real backtracking and must stay visible to scoring.
    if (expected && actual === expected && next !== oppositeDirection(expected)) startIndex = 1;
  }

  const toPart = endpointPart(connection.to, parts);
  if (toPart && !toPart.seating && endIndex - startIndex >= 2) {
    const expectedExit = pinExitDirection(connection.to, parts);
    const expectedApproach = expectedExit ? oppositeDirection(expectedExit) : null;
    const actualApproach = segmentDirection(points.at(-2)!, points.at(-1)!);
    const previous = points.length >= 3 ? segmentDirection(points.at(-3)!, points.at(-2)!) : null;
    if (expectedApproach && actualApproach === expectedApproach && previous !== expectedExit) endIndex -= 1;
  }

  return points.slice(startIndex, endIndex);
}

function doublesBackOverEndpointLead(connection: CircuitConnection, points: WirePoint[], parts: CircuitPart[]) {
  if (points.length < 3) return false;
  const fromPart = endpointPart(connection.from, parts);
  if (fromPart && !fromPart.seating) {
    const expected = pinExitDirection(connection.from, parts);
    const first = segmentDirection(points[0], points[1]);
    const second = segmentDirection(points[1], points[2]);
    if (expected && first === expected && second === oppositeDirection(expected)) return true;
  }

  const toPart = endpointPart(connection.to, parts);
  if (toPart && !toPart.seating) {
    const expectedExit = pinExitDirection(connection.to, parts);
    const expectedApproach = expectedExit ? oppositeDirection(expectedExit) : null;
    const approach = segmentDirection(points.at(-2)!, points.at(-1)!);
    const beforeApproach = segmentDirection(points.at(-3)!, points.at(-2)!);
    if (expectedApproach && approach === expectedApproach && beforeApproach === expectedExit) return true;
  }
  return false;
}

function bendCount(points: WirePoint[]) {
  let bends = 0;
  let previousAxis: WireAxis | null = null;
  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index];
    const b = points[index + 1];
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    if (dx < 0.01 && dy < 0.01) continue;
    const axis: WireAxis = dx >= dy ? 'horizontal' : 'vertical';
    if (previousAxis && axis !== previousAxis) bends++;
    previousAxis = axis;
  }
  return bends;
}

function intendedOverlap(a: CircuitPart, b: CircuitPart) {
  if (a.seating?.breadboardId === b.id) return true;
  if (b.seating?.breadboardId === a.id) return true;
  if (a.seating?.breadboardId && b.seating?.breadboardId && a.seating.breadboardId === b.seating.breadboardId) return true;
  return false;
}

function segmentIntersectsRect(segment: Segment, rect: Rect, inset = 5) {
  const left = rect.x + inset;
  const right = rect.x + rect.width - inset;
  const top = rect.y + inset;
  const bottom = rect.y + rect.height - inset;
  if (left >= right || top >= bottom) return false;

  const { a, b } = segment;
  if ((a.x >= left && a.x <= right && a.y >= top && a.y <= bottom)
    || (b.x >= left && b.x <= right && b.y >= top && b.y <= bottom)) return true;

  const edges: Segment[] = [
    { a: { x: left, y: top }, b: { x: right, y: top } },
    { a: { x: right, y: top }, b: { x: right, y: bottom } },
    { a: { x: right, y: bottom }, b: { x: left, y: bottom } },
    { a: { x: left, y: bottom }, b: { x: left, y: top } },
  ];
  return edges.some((edge) => segmentsIntersect(segment, edge));
}

function cross(a: WirePoint, b: WirePoint, c: WirePoint) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function between(value: number, a: number, b: number) {
  return value >= Math.min(a, b) - 0.001 && value <= Math.max(a, b) + 0.001;
}

function pointOnSegment(point: WirePoint, segment: Segment) {
  return Math.abs(cross(segment.a, segment.b, point)) < 0.001
    && between(point.x, segment.a.x, segment.b.x)
    && between(point.y, segment.a.y, segment.b.y);
}

function segmentsIntersect(first: Segment, second: Segment) {
  const c1 = cross(first.a, first.b, second.a);
  const c2 = cross(first.a, first.b, second.b);
  const c3 = cross(second.a, second.b, first.a);
  const c4 = cross(second.a, second.b, first.b);
  if (((c1 > 0 && c2 < 0) || (c1 < 0 && c2 > 0))
    && ((c3 > 0 && c4 < 0) || (c3 < 0 && c4 > 0))) return true;
  return pointOnSegment(second.a, first)
    || pointOnSegment(second.b, first)
    || pointOnSegment(first.a, second)
    || pointOnSegment(first.b, second);
}

function near(a: WirePoint, b: WirePoint, tolerance = 4) {
  return Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;
}

function intersectionIsSharedEndpoint(first: CircuitConnection, second: CircuitConnection, point: WirePoint, parts: CircuitPart[]) {
  const shared = [first.from, first.to].filter((endpoint) => endpoint === second.from || endpoint === second.to);
  return shared.some((endpoint) => {
    const location = endpointPoint(endpoint, parts);
    return location ? near(location, point, 6) : false;
  });
}

function segmentIntersectionPoint(first: Segment, second: Segment): WirePoint | null {
  const x1 = first.a.x; const y1 = first.a.y;
  const x2 = first.b.x; const y2 = first.b.y;
  const x3 = second.a.x; const y3 = second.a.y;
  const x4 = second.b.x; const y4 = second.b.y;
  const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denominator) < 0.001) return null;
  const determinant1 = x1 * y2 - y1 * x2;
  const determinant2 = x3 * y4 - y3 * x4;
  return {
    x: (determinant1 * (x3 - x4) - (x1 - x2) * determinant2) / denominator,
    y: (determinant1 * (y3 - y4) - (y1 - y2) * determinant2) / denominator,
  };
}

function intersectionNearSharedPart(first: CircuitConnection, second: CircuitConnection, point: WirePoint, parts: CircuitPart[]) {
  const firstIds = [first.from, first.to].map((endpoint) => endpointParts(endpoint)?.partId).filter(Boolean);
  const secondIds = new Set([second.from, second.to].map((endpoint) => endpointParts(endpoint)?.partId).filter(Boolean));
  for (const id of firstIds) {
    if (!id || !secondIds.has(id)) continue;
    const part = parts.find((candidate) => candidate.id === id);
    if (!part) continue;
    const rect = partRect(part);
    const margin = AGENT_GRID_SIZE * 1.1;
    if (point.x >= rect.x - margin && point.x <= rect.x + rect.width + margin
      && point.y >= rect.y - margin && point.y <= rect.y + rect.height + margin) return true;
  }
  return false;
}
function segmentsShareOnlyEndpoint(first: Segment, second: Segment) {
  return near(first.a, second.a, 1)
    || near(first.a, second.b, 1)
    || near(first.b, second.a, 1)
    || near(first.b, second.b, 1);
}

function parallelOverlapLength(first: Segment, second: Segment) {
  const firstHorizontal = Math.abs(first.a.y - first.b.y) < 0.001;
  const secondHorizontal = Math.abs(second.a.y - second.b.y) < 0.001;
  const firstVertical = Math.abs(first.a.x - first.b.x) < 0.001;
  const secondVertical = Math.abs(second.a.x - second.b.x) < 0.001;
  if (firstHorizontal && secondHorizontal && Math.abs(first.a.y - second.a.y) < 2) {
    return Math.max(0, Math.min(Math.max(first.a.x, first.b.x), Math.max(second.a.x, second.b.x))
      - Math.max(Math.min(first.a.x, first.b.x), Math.min(second.a.x, second.b.x)));
  }
  if (firstVertical && secondVertical && Math.abs(first.a.x - second.a.x) < 2) {
    return Math.max(0, Math.min(Math.max(first.a.y, first.b.y), Math.max(second.a.y, second.b.y))
      - Math.max(Math.min(first.a.y, first.b.y), Math.min(second.a.y, second.b.y)));
  }
  return 0;
}

function axisForEndpoint(endpoint: string, parts: CircuitPart[]): WireAxis | undefined {
  const direction = pinExitDirection(endpoint, parts);
  if (direction === 'left' || direction === 'right') return 'horizontal';
  if (direction === 'up' || direction === 'down') return 'vertical';
  return undefined;
}

function wirePoints(connection: CircuitConnection, parts: CircuitPart[]) {
  const start = endpointPoint(connection.from, parts);
  const end = endpointPoint(connection.to, parts);
  return start && end
    ? connectionPolyline(start, connection.waypoints, end, axisForEndpoint(connection.from, parts))
    : [];
}

function wireSegments(connection: CircuitConnection, parts: CircuitPart[]) {
  const points = wirePoints(connection, parts);
  return points.slice(0, -1).map((point, index) => ({ a: point, b: points[index + 1] }));
}

function routeLength(points: WirePoint[]) {
  let length = 0;
  for (let index = 0; index < points.length - 1; index++) {
    length += Math.hypot(points[index + 1].x - points[index].x, points[index + 1].y - points[index].y);
  }
  return length;
}

export function evaluateLayout(document: Pick<CircuitDocument, 'parts' | 'connections'>) {
  const issues: LayoutIssue[] = [];
  const { parts, connections } = document;

  for (let leftIndex = 0; leftIndex < parts.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < parts.length; rightIndex++) {
      const first = parts[leftIndex];
      const second = parts[rightIndex];
      if (intendedOverlap(first, second)) continue;
      if (!rectsOverlap(partRect(first), partRect(second), 4)) continue;
      issues.push({
        kind: 'part-overlap',
        severity: 'error',
        itemIds: [first.id, second.id],
        message: `${first.id} overlaps ${second.id}. Move one component to a clear grid area.`,
      });
    }
  }

  for (const connection of connections) {
    const endpointPartIds = new Set([connection.from, connection.to]
      .map((endpoint) => endpointParts(endpoint)?.partId)
      .filter((value): value is string => Boolean(value)));
    const segments = wireSegments(connection, parts);
    for (const part of parts) {
      if (endpointPartIds.has(part.id) || isBreadboardType(part.type) || part.seating) continue;
      if (segments.some((segment) => segmentIntersectsRect(segment, partRect(part), 7))) {
        issues.push({
          kind: 'wire-through-part',
          severity: 'error',
          itemIds: [connection.id, part.id],
          message: `${connection.id} passes through ${part.id}. Move its grid waypoints around the component footprint.`,
        });
      }
    }

    const authored = connection.waypoints ?? [];
    const start = endpointPoint(connection.from, parts);
    const end = endpointPoint(connection.to, parts);
    const fullPoints = start && end ? connectionPolyline(start, authored, end) : [];
    const fromPart = endpointPart(connection.from, parts);
    const toPart = endpointPart(connection.to, parts);
    if (fullPoints.length >= 2 && !fromPart?.seating) {
      const expected = pinExitDirection(connection.from, parts);
      const actual = segmentDirection(fullPoints[0], fullPoints[1]);
      if (expected && actual && expected !== actual) {
        issues.push({
          kind: 'pin-exit',
          severity: 'warning',
          itemIds: [connection.id, fromPart?.id ?? ''],
          message: `${connection.id} leaves ${connection.from} toward ${actual}, but that pin faces ${expected}. Exit the pin in its outward direction before turning.`,
        });
      }
    }
    if (fullPoints.length >= 2 && !toPart?.seating) {
      const expectedExit = pinExitDirection(connection.to, parts);
      const actualApproach = segmentDirection(fullPoints.at(-2)!, fullPoints.at(-1)!);
      const expectedApproach = expectedExit ? oppositeDirection(expectedExit) : null;
      if (expectedApproach && actualApproach && expectedApproach !== actualApproach) {
        issues.push({
          kind: 'pin-exit',
          severity: 'warning',
          itemIds: [connection.id, toPart?.id ?? ''],
          message: `${connection.id} approaches ${connection.to} from ${actualApproach}, but the clean approach is ${expectedApproach}. Align with the destination pin before entering it.`,
        });
      }
    }
    const routingInterior = routingInteriorPoints(connection, fullPoints, parts);
    const backtrack = backtrackDistance(routingInterior);
    const endpointLeadReversal = doublesBackOverEndpointLead(connection, fullPoints, parts);
    if (endpointLeadReversal || backtrack >= AGENT_GRID_SIZE * 2.5) {
      issues.push({
        kind: 'wire-backtrack',
        severity: 'warning',
        itemIds: [connection.id],
        message: endpointLeadReversal
          ? `${connection.id} exits a connector and immediately doubles back over the same lead. Continue away from the pin before turning.`
          : `${connection.id} reverses about ${Math.round(backtrack / AGENT_GRID_SIZE)} grid cells inside its routing corridor. Prefer a monotonic route unless an obstacle requires the detour.`,
      });
    }
    if (!wireColorMatchesStandard(connection.from, connection.to, connection.color)) {
      const kind = inferWireKind(connection.from, connection.to);
      issues.push({
        kind: 'wire-color',
        severity: 'warning',
        itemIds: [connection.id],
        message: `${connection.id} is a ${kind} connection but uses ${connection.color}. Use the standard power/ground color convention so the circuit is readable at a glance.`,
      });
    }
    const diagonalPair = authored.slice(0, -1).findIndex((point, index) => !isOrthogonalPair(point, authored[index + 1]));
    if (diagonalPair >= 0) {
      issues.push({
        kind: 'diagonal-waypoints',
        severity: 'warning',
        itemIds: [connection.id],
        message: `${connection.id} has diagonal authored waypoints. Route like plumbing: horizontal/vertical lanes with 90-degree turns only.`,
      });
    }

    // Endpoint lead-in/out elbows are sometimes required to leave a physical pin cleanly.
    // Count actual direction changes only inside the routing corridor.
    const interiorBends = bendCount(routingInterior);
    if (interiorBends > 6) {
      issues.push({
        kind: 'too-many-bends',
        severity: 'warning',
        itemIds: [connection.id],
        message: `${connection.id} has ${interiorBends} routing bends. Aim for <=6 interior bends: exit cleanly, travel in a clear lane, then approach the destination.`,
      });
    }
    if (routingInterior.length >= 2) {
      const direct = Math.hypot(routingInterior.at(-1)!.x - routingInterior[0].x, routingInterior.at(-1)!.y - routingInterior[0].y);
      const routed = routeLength(routingInterior);
      if (direct > 80 && routed > direct * 2.7) {
        issues.push({
          kind: 'long-route',
          severity: 'warning',
          itemIds: [connection.id],
          message: `${connection.id}'s routing corridor is ${Math.round(routed / direct * 10) / 10}x longer than its direct interior span. Shorten it if the route stays clear.`,
        });
      }
    }
  }

  for (let firstIndex = 0; firstIndex < connections.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < connections.length; secondIndex++) {
      const first = connections[firstIndex];
      const second = connections[secondIndex];
      let overlap = 0;
      for (const firstSegment of wireSegments(first, parts)) {
        for (const secondSegment of wireSegments(second, parts)) {
          overlap = Math.max(overlap, parallelOverlapLength(firstSegment, secondSegment));
        }
      }
      if (overlap >= BREADBOARD_HOLE_PITCH * 1.5) {
        issues.push({
          kind: 'wire-overlap',
          severity: 'warning',
          itemIds: [first.id, second.id],
          message: `${first.id} overlaps ${second.id} for about ${Math.max(1, Math.round(overlap / BREADBOARD_HOLE_PITCH))} physical routing lanes. Give each wire its own nearby lane so both remain traceable.`,
        });
      }

      let crossing: WirePoint | null = null;
      outer: for (const firstSegment of wireSegments(first, parts)) {
        for (const secondSegment of wireSegments(second, parts)) {
          if (!segmentsIntersect(firstSegment, secondSegment)) continue;
          if (segmentsShareOnlyEndpoint(firstSegment, secondSegment)) continue;
          const point = segmentIntersectionPoint(firstSegment, secondSegment);
          if (!point || intersectionIsSharedEndpoint(first, second, point, parts) || intersectionNearSharedPart(first, second, point, parts)) continue;
          crossing = point;
          break outer;
        }
      }
      if (!crossing) continue;
      const cx = Math.round((crossing.x - CANVAS_CENTER_X) / AGENT_GRID_SIZE);
      const cy = Math.round((crossing.y - CANVAS_CENTER_Y) / AGENT_GRID_SIZE);
      issues.push({
        kind: 'wire-crossing',
        severity: 'warning',
        itemIds: [first.id, second.id],
        message: `${first.id} crosses ${second.id} near grid (${cx}, ${cy}). Separate the routes when practical.`,
      });
    }
  }

  const penalties: Record<LayoutIssue['kind'], number> = {
    'part-overlap': 20,
    'wire-through-part': 20,   // raised: passing through a part body is never acceptable
    'wire-crossing': 10,
    'wire-overlap': 12,
    'diagonal-waypoints': 4,
    'too-many-bends': 4,       // raised: encourage simpler routes earlier
    'long-route': 3,
    'pin-exit': 3,
    'wire-backtrack': 3,
    'wire-color': 2,
  };
  const score = Math.max(0, 100 - issues.reduce((sum, issue) => sum + penalties[issue.kind], 0));
  const grade = score >= 92 ? 'excellent' : score >= 80 ? 'good' : score >= 65 ? 'needs-work' : 'poor';
  return { score, grade, issues };
}

function rasterizeSegment(a: WirePoint, b: WirePoint) {
  const start = canvasPointToGrid(a);
  const end = canvasPointToGrid(b);
  const cells: WirePoint[] = [];
  let x = start.x;
  let y = start.y;
  const dx = Math.abs(end.x - start.x);
  const sx = start.x < end.x ? 1 : -1;
  const dy = -Math.abs(end.y - start.y);
  const sy = start.y < end.y ? 1 : -1;
  let error = dx + dy;
  while (true) {
    cells.push({ x, y });
    if (x === end.x && y === end.y) break;
    const twice = 2 * error;
    if (twice >= dy) { error += dy; x += sx; }
    if (twice <= dx) { error += dx; y += sy; }
  }
  return cells;
}

export function buildAgentLayout(document: Pick<CircuitDocument, 'parts' | 'connections'>) {
  const { parts, connections } = document;
  const allPoints: WirePoint[] = [];
  for (const part of parts) {
    const rect = partRect(part);
    allPoints.push({ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y + rect.height });
  }
  for (const connection of connections) allPoints.push(...wirePoints(connection, parts));

  // Derive map bounds in CANVAS pixels first, then convert to centered grid coords
  const minX = allPoints.length ? Math.min(...allPoints.map((point) => point.x)) : CANVAS_CENTER_X - AGENT_GRID_SIZE * 12;
  const minY = allPoints.length ? Math.min(...allPoints.map((point) => point.y)) : CANVAS_CENTER_Y - AGENT_GRID_SIZE * 8;
  const maxX = allPoints.length ? Math.max(...allPoints.map((point) => point.x)) : CANVAS_CENTER_X + AGENT_GRID_SIZE * 12;
  const maxY = allPoints.length ? Math.max(...allPoints.map((point) => point.y)) : CANVAS_CENTER_Y + AGENT_GRID_SIZE * 8;

  // Convert to centered grid coords (no Math.max(0) — negative coords are valid)
  let gridLeft = Math.floor((minX - CANVAS_CENTER_X) / AGENT_GRID_SIZE) - MAP_MARGIN_CELLS;
  let gridTop = Math.floor((minY - CANVAS_CENTER_Y) / AGENT_GRID_SIZE) - MAP_MARGIN_CELLS;
  let gridRight = Math.ceil((maxX - CANVAS_CENTER_X) / AGENT_GRID_SIZE) + MAP_MARGIN_CELLS;
  let gridBottom = Math.ceil((maxY - CANVAS_CENTER_Y) / AGENT_GRID_SIZE) + MAP_MARGIN_CELLS;
  if (gridRight - gridLeft > MAX_MAP_COLUMNS) gridRight = gridLeft + MAX_MAP_COLUMNS;
  if (gridBottom - gridTop > MAX_MAP_ROWS) gridBottom = gridTop + MAX_MAP_ROWS;

  const width = Math.max(1, gridRight - gridLeft + 1);
  const height = Math.max(1, gridBottom - gridTop + 1);
  const rows = Array.from({ length: height }, () => Array.from({ length: width }, () => '.'));
  const legend: Record<string, string> = {};
  // spans gives agents the exact bounding box for each symbol in the map
  const spans: Record<string, { id: string; type: string; grid: { x: number; y: number }; gridSize: { w: number; h: number } }> = {};

  parts.forEach((part, index) => {
    const symbol = SYMBOLS[index] ?? '?';
    legend[symbol] = `${part.id}:${part.type}`;
    const rect = partGridRect(part);
    spans[symbol] = {
      id: part.id,
      type: part.type,
      grid: { x: rect.x, y: rect.y },
      gridSize: { w: rect.w, h: rect.h },
    };
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        const row = y - gridTop;
        const column = x - gridLeft;
        if (rows[row]?.[column] !== undefined) rows[row][column] = symbol;
      }
    }
  });

  const wireCells = new Map<string, string>();
  for (const connection of connections) {
    const points = wirePoints(connection, parts);
    for (let index = 0; index < points.length - 1; index++) {
      for (const cell of rasterizeSegment(points[index], points[index + 1])) {
        const key = `${cell.x},${cell.y}`;
        const previous = wireCells.get(key);
        wireCells.set(key, previous && previous !== connection.id ? 'crossing' : connection.id);
      }
    }
  }
  for (const [key, owner] of wireCells) {
    const [x, y] = key.split(',').map(Number);
    const row = y - gridTop;
    const column = x - gridLeft;
    if (rows[row]?.[column] === undefined) continue;
    if (rows[row][column] === '.') rows[row][column] = owner === 'crossing' ? 'X' : '*';
  }

  // Build routing hints: find rows and columns that are fully clear of parts
  const occupiedCols = new Set<number>();
  const occupiedRows = new Set<number>();
  for (const part of parts) {
    const rect = partGridRect(part);
    for (let y = rect.y; y < rect.y + rect.h; y++) occupiedRows.add(y);
    for (let x = rect.x; x < rect.x + rect.w; x++) occupiedCols.add(x);
  }
  const freeRows: number[] = [];
  const freeCols: number[] = [];
  for (let y = gridTop; y <= gridBottom; y++) if (!occupiedRows.has(y)) freeRows.push(y);
  for (let x = gridLeft; x <= gridRight; x++) if (!occupiedCols.has(x)) freeCols.push(x);

  // Suggest the nearest clear lanes above/below and left/right of the part cluster
  const clusterMinRow = parts.length ? Math.min(...parts.map((p) => partGridRect(p).y)) : gridTop;
  const clusterMaxRow = parts.length ? Math.max(...parts.map((p) => { const r = partGridRect(p); return r.y + r.h - 1; })) : gridBottom;
  const clusterMinCol = parts.length ? Math.min(...parts.map((p) => partGridRect(p).x)) : gridLeft;
  const clusterMaxCol = parts.length ? Math.max(...parts.map((p) => { const r = partGridRect(p); return r.x + r.w - 1; })) : gridRight;

  const laneAbove = freeRows.filter((r) => r < clusterMinRow).at(-1) ?? null;
  const laneBelow = freeRows.find((r) => r > clusterMaxRow) ?? null;
  const laneLeft = freeCols.filter((c) => c < clusterMinCol).at(-1) ?? null;
  const laneRight = freeCols.find((c) => c > clusterMaxCol) ?? null;

  return {
    map: {
      // origin tells agent the top-left corner of this map in centered grid coords
      origin: { x: gridLeft, y: gridTop },
      width,
      height,
      cols: `     ` + Array.from({ length: width }, (_, i) => ((i + gridLeft) % 5 === 0 ? String(Math.abs((i + gridLeft) % 10)) : ' ')).join(''),
      rows: rows.map((row, idx) => {
        const gRow = idx + gridTop;
        const label = String(gRow).padStart(3, ' ');
        return `${label} | ${row.join('')}`;
      }),
      legend: { ...legend, '*': 'wire', X: 'wire-crossing' },
      // spans: exact grid bounding box for each part symbol — use this when routing wires around components
      spans,
    },
    routingHints: {
      // Prefer these clear row/col lanes for horizontal and vertical wire segments
      clearLaneAbove: laneAbove,
      clearLaneBelow: laneBelow,
      clearLaneLeft: laneLeft,
      clearLaneRight: laneRight,
      // Tip: route horizontal wire segments along clear rows, vertical segments along clear columns.
      // Keep one wire per lane. Use gridWaypoints with at most 2 bends per wire.
    },
    quality: evaluateLayout(document),
  };
}
