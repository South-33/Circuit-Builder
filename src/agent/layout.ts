import { getPartBounds, PART_DEFINITIONS } from '../components/parts';
import type { CircuitConnection, CircuitDocument, CircuitPart, WirePoint } from '../circuit/types';
import { endpointParts, endpointPoint, partRect, pinExitDirection } from '../wires/geometry';
import { connectionPolyline, isOrthogonalPair, type WireAxis } from '../wires/path';
import { isBreadboardType } from '../breadboard/geometry';

export const AGENT_GRID_SIZE = 32;
const MAP_MARGIN_CELLS = 2;
const MAX_MAP_COLUMNS = 72;
const MAX_MAP_ROWS = 42;
const SYMBOLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

type LayoutIssue = {
  kind: 'part-overlap' | 'wire-through-part' | 'wire-crossing' | 'wire-overlap' | 'diagonal-waypoints' | 'too-many-bends' | 'long-route';
  severity: 'warning' | 'error';
  itemIds: string[];
  message: string;
};

type Rect = { x: number; y: number; width: number; height: number };

type Segment = { a: WirePoint; b: WirePoint };

export function gridPointToCanvas(point: WirePoint): WirePoint {
  return { x: point.x * AGENT_GRID_SIZE, y: point.y * AGENT_GRID_SIZE };
}

export function canvasPointToGrid(point: WirePoint): WirePoint {
  return {
    x: Math.round(point.x / AGENT_GRID_SIZE),
    y: Math.round(point.y / AGENT_GRID_SIZE),
  };
}

export function gridPartPlacement(point: WirePoint) {
  const canvas = gridPointToCanvas(point);
  return { left: canvas.x, top: canvas.y };
}

function rectsOverlap(a: Rect, b: Rect, inset = 0) {
  return a.x + inset < b.x + b.width - inset
    && a.x + a.width - inset > b.x + inset
    && a.y + inset < b.y + b.height - inset
    && a.y + a.height - inset > b.y + inset;
}

function intendedOverlap(a: CircuitPart, b: CircuitPart) {
  if (a.seating?.breadboardId === b.id) return true;
  if (b.seating?.breadboardId === a.id) return true;
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

function authoredSegments(connection: CircuitConnection) {
  const points = connection.waypoints ?? [];
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
      if (endpointPartIds.has(part.id) || isBreadboardType(part.type)) continue;
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
    const diagonalPair = authored.slice(0, -1).findIndex((point, index) => !isOrthogonalPair(point, authored[index + 1]));
    if (diagonalPair >= 0) {
      issues.push({
        kind: 'diagonal-waypoints',
        severity: 'warning',
        itemIds: [connection.id],
        message: `${connection.id} has diagonal authored waypoints. Route like plumbing: horizontal/vertical lanes with 90-degree turns only.`,
      });
    }

    const authoredBends = Math.max(0, authored.length - 1);
    if (authoredBends > 4) {
      issues.push({
        kind: 'too-many-bends',
        severity: 'warning',
        itemIds: [connection.id],
        message: `${connection.id} has ${authoredBends} authored bends. Prefer a simpler intentional route.`,
      });
    }
    if (authored.length >= 2) {
      const direct = Math.hypot(authored.at(-1)!.x - authored[0].x, authored.at(-1)!.y - authored[0].y);
      const routed = routeLength(authored);
      if (direct > 80 && routed > direct * 2.7) {
        issues.push({
          kind: 'long-route',
          severity: 'warning',
          itemIds: [connection.id],
          message: `${connection.id}'s authored lane is ${Math.round(routed / direct * 10) / 10}x longer than its direct interior span. Shorten it if the route stays clear.`,
        });
      }
    }
  }

  for (let firstIndex = 0; firstIndex < connections.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < connections.length; secondIndex++) {
      const first = connections[firstIndex];
      const second = connections[secondIndex];
      let overlap = 0;
      for (const firstSegment of authoredSegments(first)) {
        for (const secondSegment of authoredSegments(second)) {
          overlap = Math.max(overlap, parallelOverlapLength(firstSegment, secondSegment));
        }
      }
      if (overlap >= AGENT_GRID_SIZE * 0.6) {
        issues.push({
          kind: 'wire-overlap',
          severity: 'warning',
          itemIds: [first.id, second.id],
          message: `${first.id} overlaps ${second.id} for about ${Math.round(overlap / AGENT_GRID_SIZE)} grid cells. Give each wire its own nearby lane so both remain traceable.`,
        });
      }

      let crossing: WirePoint | null = null;
      outer: for (const firstSegment of authoredSegments(first)) {
        for (const secondSegment of authoredSegments(second)) {
          if (!segmentsIntersect(firstSegment, secondSegment)) continue;
          if (segmentsShareOnlyEndpoint(firstSegment, secondSegment)) continue;
          const point = segmentIntersectionPoint(firstSegment, secondSegment);
          if (!point || intersectionIsSharedEndpoint(first, second, point, parts)) continue;
          crossing = point;
          break outer;
        }
      }
      if (!crossing) continue;
      issues.push({
        kind: 'wire-crossing',
        severity: 'warning',
        itemIds: [first.id, second.id],
        message: `${first.id} crosses ${second.id} near grid (${Math.round(crossing.x / AGENT_GRID_SIZE)}, ${Math.round(crossing.y / AGENT_GRID_SIZE)}). Separate the routes when practical.`,
      });
    }
  }

  const penalties: Record<LayoutIssue['kind'], number> = {
    'part-overlap': 20,
    'wire-through-part': 12,
    'wire-crossing': 3,
    'wire-overlap': 6,
    'diagonal-waypoints': 4,
    'too-many-bends': 2,
    'long-route': 2,
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

function partGridRect(part: CircuitPart) {
  const rect = partRect(part);
  return {
    x: Math.floor(rect.x / AGENT_GRID_SIZE),
    y: Math.floor(rect.y / AGENT_GRID_SIZE),
    width: Math.max(1, Math.ceil(rect.width / AGENT_GRID_SIZE)),
    height: Math.max(1, Math.ceil(rect.height / AGENT_GRID_SIZE)),
  };
}

export function buildAgentLayout(document: Pick<CircuitDocument, 'parts' | 'connections'>) {
  const { parts, connections } = document;
  const allPoints: WirePoint[] = [];
  for (const part of parts) {
    const rect = partRect(part);
    allPoints.push({ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y + rect.height });
  }
  for (const connection of connections) allPoints.push(...wirePoints(connection, parts));

  const minX = allPoints.length ? Math.min(...allPoints.map((point) => point.x)) : 0;
  const minY = allPoints.length ? Math.min(...allPoints.map((point) => point.y)) : 0;
  const maxX = allPoints.length ? Math.max(...allPoints.map((point) => point.x)) : AGENT_GRID_SIZE * 24;
  const maxY = allPoints.length ? Math.max(...allPoints.map((point) => point.y)) : AGENT_GRID_SIZE * 16;
  let gridLeft = Math.max(0, Math.floor(minX / AGENT_GRID_SIZE) - MAP_MARGIN_CELLS);
  let gridTop = Math.max(0, Math.floor(minY / AGENT_GRID_SIZE) - MAP_MARGIN_CELLS);
  let gridRight = Math.ceil(maxX / AGENT_GRID_SIZE) + MAP_MARGIN_CELLS;
  let gridBottom = Math.ceil(maxY / AGENT_GRID_SIZE) + MAP_MARGIN_CELLS;
  if (gridRight - gridLeft > MAX_MAP_COLUMNS) gridRight = gridLeft + MAX_MAP_COLUMNS;
  if (gridBottom - gridTop > MAX_MAP_ROWS) gridBottom = gridTop + MAX_MAP_ROWS;

  const width = Math.max(1, gridRight - gridLeft + 1);
  const height = Math.max(1, gridBottom - gridTop + 1);
  const rows = Array.from({ length: height }, () => Array.from({ length: width }, () => '.'));
  const legend: Record<string, string> = {};

  parts.forEach((part, index) => {
    const symbol = SYMBOLS[index] ?? '?';
    legend[symbol] = `${part.id}:${part.type}`;
    const rect = partGridRect(part);
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      for (let x = rect.x; x < rect.x + rect.width; x++) {
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

  return {
    coordinateSystem: {
      cellSizePx: AGENT_GRID_SIZE,
      placement: 'edit-circuit parts may use grid:{x,y}; grid coordinates address cell intersections and are converted deterministically to pixels.',
      routing: 'connect-pins uses your gridWaypoints as the authoritative interior path. The workbench only adds a minimal lead-in/out to the exact physical pins; it never autoroutes or later rewrites your lanes.',
      routingStyle: 'agent-authored-grid-path',
      routingRules: [
        'Think like plumbing or road design: long straight horizontal/vertical runs are preferred.',
        'Use the fewest 90-degree bends that keep the circuit readable.',
        'Give separate wires separate nearby lanes; never stack unrelated wires on the exact same track.',
        'Keep wires outside unrelated component footprints and avoid crossings when a nearby clear lane exists.',
        'It is okay to move components farther apart if that makes the wiring simpler and easier to trace.',
        'After wiring, inspect quality and repair every error plus avoidable overlap/crossing warning before simulation.',
      ],
      workflow: [
        'Place the major components first with edit-circuit grid coordinates.',
        'Seat breadboard components by named holes when applicable.',
        'Request pins only for the parts you are currently wiring.',
        'Draw each connection explicitly with gridWaypoints.',
        'Inspect the grid and quality report, repair layout issues, then set code and simulate.',
      ],
      breadboardNaming: 'Terminal holes are A1..E<n> and F1..J<n>. Rails are +top1/-top1 and +bottom1/-bottom1. For placement prefer seat:{breadboardId,pin,hole}.',
    },
    map: {
      originGrid: { x: gridLeft, y: gridTop },
      width,
      height,
      rows: rows.map((row) => row.join('')),
      legend: { ...legend, '*': 'wire route', X: 'multiple wire routes share this cell' },
    },
    parts: parts.map((part) => ({
      id: part.id,
      type: part.type,
      grid: partGridRect(part),
      pixelSize: getPartBounds(part),
      pinSummary: PART_DEFINITIONS[part.type].pinSummary,
      ...(part.seating ? { seating: part.seating } : {}),
    })),
    routes: connections.map((connection) => ({
      id: connection.id,
      from: connection.from,
      to: connection.to,
      gridWaypoints: (connection.waypoints ?? []).map(canvasPointToGrid),
      bends: connection.waypoints?.length ?? 0,
    })),
    quality: evaluateLayout(document),
  };
}
