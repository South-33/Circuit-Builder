import type { CircuitConnection, CircuitDocument, CircuitPart, WirePoint } from '../circuit/types';
import { endpointParts, endpointPoint, partRect, pinExitDirection, type CardinalDirection } from '../wires/geometry';
import { connectionPolyline, isOrthogonalPair, type WireAxis } from '../wires/path';
import { BREADBOARD_HOLE_PITCH, isBreadboardType } from '../breadboard/geometry';
import { CANVAS_CENTER_X, CANVAS_CENTER_Y } from './placement';
import { inferWireKind, wireColorMatchesStandard } from '../wires/conventions';

const ROUTING_CELL_PX = BREADBOARD_HOLE_PITCH;

type LayoutIssue = {
  kind: 'part-overlap' | 'pin-fanout' | 'connector-facing-away' | 'controller-stacked' | 'split-source-cable' | 'excessive-gap' | 'trench-spanning-drop' | 'wire-through-part' | 'wire-through-board' | 'wire-crossing' | 'wire-overlap' | 'diagonal-waypoints' | 'too-many-bends' | 'long-route' | 'pin-exit' | 'wire-backtrack' | 'wire-notch' | 'wire-color' | 'perimeter-rail-detour' | 'same-column-rail-congestion' | 'viewport-overflow' | 'seated-part-collision' | 'board-capacity-recommendation';
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
  let directional = 0;
  let right = 0;
  let left = 0;
  let down = 0;
  let up = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    if (dx > 0) right += dx;
    else left += -dx;
    if (dy > 0) down += dy;
    else up += -dy;
    if (Math.abs(overallDx) >= ROUTING_CELL_PX * 3 && Math.sign(dx) && Math.sign(dx) !== Math.sign(overallDx)) directional += Math.abs(dx);
    if (Math.abs(overallDy) >= ROUTING_CELL_PX * 3 && Math.sign(dy) && Math.sign(dy) !== Math.sign(overallDy)) directional += Math.abs(dy);
  }
  // Net displacement alone hides a U-shaped detour because its opposing runs
  // cancel. Count the distance that cancels itself on either axis as well.
  const cancelled = Math.min(right, left) + Math.min(down, up);
  return Math.max(directional, cancelled);
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

function shortNotch(points: WirePoint[]) {
  for (let index = 0; index < points.length - 3; index++) {
    const first = segmentDirection(points[index], points[index + 1]);
    const jog = segmentDirection(points[index + 1], points[index + 2]);
    const continued = segmentDirection(points[index + 2], points[index + 3]);
    if (!first || !jog || !continued || first !== continued || first === jog) continue;
    const length = Math.abs(points[index + 2].x - points[index + 1].x)
      + Math.abs(points[index + 2].y - points[index + 1].y);
    if (length <= ROUTING_CELL_PX * 0.75) return { index, length };
  }
  return null;
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
    const margin = ROUTING_CELL_PX * 1.1;
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

  const endpointUses = new Map<string, string[]>();
  for (const connection of connections) {
    for (const endpoint of [connection.from, connection.to]) {
      const ids = endpointUses.get(endpoint) ?? [];
      ids.push(connection.id);
      endpointUses.set(endpoint, ids);
    }
  }
  for (const [endpoint, wireIds] of endpointUses) {
    if (wireIds.length < 2) continue;
    const part = endpointPart(endpoint, parts);
    if (!part || isBreadboardType(part.type) || part.seating) continue;
    issues.push({
      kind: 'pin-fanout',
      severity: 'error',
      itemIds: [part.id, ...wireIds],
      message: `${endpoint} has ${wireIds.length} physical wires on one ordinary terminal. Add a breadboard rail or explicit distribution part, then give each consumer its own hole and short branch.`,
    });
  }

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

  for (const part of parts) {
    if (part.seating) continue;
    const activePins = new Map<string, { exit: CardinalDirection; point: WirePoint; targets: WirePoint[]; wireIds: string[] }>();
    for (const connection of connections) {
      for (const [endpoint, other] of [[connection.from, connection.to], [connection.to, connection.from]] as const) {
        if (endpointParts(endpoint)?.partId !== part.id) continue;
        const exit = pinExitDirection(endpoint, parts);
        const point = endpointPoint(endpoint, parts);
        const target = endpointPoint(other, parts);
        if (!exit || !point || !target) continue;
        const current = activePins.get(endpoint) ?? { exit, point, targets: [], wireIds: [] };
        current.targets.push(target);
        current.wireIds.push(connection.id);
        activePins.set(endpoint, current);
      }
    }
    if (activePins.size < 2) continue;
    const pins = [...activePins.values()];
    const exits = new Set(pins.map((pin) => pin.exit));
    if (exits.size !== 1) continue;
    const exit = pins[0].exit;
    const axis = exit === 'left' ? { x: -1, y: 0 }
      : exit === 'right' ? { x: 1, y: 0 }
        : exit === 'up' ? { x: 0, y: -1 }
          : { x: 0, y: 1 };
    const projections = pins.flatMap((pin) => pin.targets.map((target) => (
      (target.x - pin.point.x) * axis.x + (target.y - pin.point.y) * axis.y
    )));
    const averageProjection = projections.reduce((sum, value) => sum + value, 0) / projections.length;
    if (averageProjection >= -ROUTING_CELL_PX * 2) continue;
    issues.push({
      kind: 'connector-facing-away',
      severity: 'warning',
      itemIds: [part.id, ...new Set(pins.flatMap((pin) => pin.wireIds))],
      message: `${part.id}'s active connector bank faces ${exit}, but its connected terminals are behind that side. Rotate or move the component so the connector faces its destination before routing.`,
    });
  }

  const uno = parts.find((p) => p.type === 'wokwi-arduino-uno');
  const board = parts.find((p) => isBreadboardType(p.type));
  if (uno && board && !uno.seating) {
    const unoRect = partRect(uno);
    const boardRect = partRect(board);
    if (unoRect.y + unoRect.height <= boardRect.y || unoRect.y >= boardRect.y + boardRect.height) {
      issues.push({
        kind: 'controller-stacked',
        severity: 'warning',
        itemIds: [uno.id, board.id],
        message: `${uno.id} is placed completely above or below ${board.id}. Keep controller and breadboard in one horizontal working band (conventional upright controller on the left) unless active pin banks require otherwise.`,
      });
    }

    if (unoRect.x + unoRect.width <= boardRect.x) {
      const gap = boardRect.x - (unoRect.x + unoRect.width);
      if (gap > ROUTING_CELL_PX * 5) {
        issues.push({
          kind: 'excessive-gap',
          severity: 'warning',
          itemIds: [uno.id, board.id],
          message: `${uno.id} and ${board.id} have an excessive ${Math.round(gap / ROUTING_CELL_PX)}-cell gap. Keep the gap snug (1-3 cells, e.g. rightOf("${board.id}", "${uno.id}", 2)) to avoid sprawling wires.`,
        });
      }
    }
  }

  if (board) {
    const boardRect = partRect(board);
    for (const part of parts) {
      if (part.seating || isBreadboardType(part.type) || part.id === uno?.id) continue;
      const rect = partRect(part);
      const dx = Math.max(0, boardRect.x - (rect.x + rect.width), rect.x - (boardRect.x + boardRect.width));
      const dy = Math.max(0, boardRect.y - (rect.y + rect.height), rect.y - (boardRect.y + boardRect.height));
      const gapCells = Math.round(Math.max(dx, dy) / ROUTING_CELL_PX);
      if (gapCells > 8) {
        issues.push({
          kind: 'excessive-gap',
          severity: 'warning',
          itemIds: [part.id, board.id],
          message: `${part.id} is placed ${gapCells} cells away from ${board.id}. Move it snug against the board edge it connects to (gap 1-3 cells) to eliminate sprawling wires.`,
        });
      }
    }
  }

  for (const part of parts) {
    if (!part.type.includes('battery')) continue;
    const partConns = connections.filter((c) => {
      const p1 = endpointParts(c.from)?.partId;
      const p2 = endpointParts(c.to)?.partId;
      return p1 === part.id || p2 === part.id;
    });
    if (partConns.length < 2) continue;
    const otherEndpoints = partConns.map((c) => {
      const p1 = endpointParts(c.from)?.partId;
      return p1 === part.id ? c.to : c.from;
    });
    const hasTopRail = otherEndpoints.some((ep) => ep.includes(':+top') || ep.includes(':-top'));
    const hasBottomRail = otherEndpoints.some((ep) => ep.includes(':+bottom') || ep.includes(':-bottom'));
    if (hasTopRail && hasBottomRail) {
      issues.push({
        kind: 'split-source-cable',
        severity: 'warning',
        itemIds: [part.id, ...partConns.map((c) => c.id)],
        message: `${part.id} has one terminal on a top rail and another on a bottom rail. Connect both conductors to the same nearest rail pair (+bottom/-bottom or +top/-top) so the supply cable stays bundled together. Use a quiet-edge bridge if the opposite rail needs power.`,
      });
    }
  }

  for (const connection of connections) {
    for (const [rowEp, railEp] of [[connection.from, connection.to], [connection.to, connection.from]] as const) {
      const rowParsed = endpointParts(rowEp);
      const railParsed = endpointParts(railEp);
      if (!rowParsed || !railParsed) continue;
      if (rowParsed.partId !== railParsed.partId) continue;
      const b = parts.find((p) => p.id === rowParsed.partId && isBreadboardType(p.type));
      if (!b) continue;
      const isTopRail = railParsed.pinName.startsWith('+top') || railParsed.pinName.startsWith('-top');
      const isBottomRail = railParsed.pinName.startsWith('+bottom') || railParsed.pinName.startsWith('-bottom');
      if (!isTopRail && !isBottomRail) continue;
      const rowLetter = rowParsed.pinName.charAt(0).toUpperCase();
      if (['A', 'B', 'C', 'D', 'E'].includes(rowLetter) && isBottomRail) {
        issues.push({
          kind: 'trench-spanning-drop',
          severity: 'warning',
          itemIds: [connection.id, b.id],
          message: `${connection.id} connects row ${rowLetter} to ${railParsed.pinName} across the center divider. Use the near rail (+top/-top for rows A-E) or seat the part in rows F-J to keep rail drops short.`,
        });
      } else if (['F', 'G', 'H', 'I', 'J'].includes(rowLetter) && isTopRail) {
        issues.push({
          kind: 'trench-spanning-drop',
          severity: 'warning',
          itemIds: [connection.id, b.id],
          message: `${connection.id} connects row ${rowLetter} to ${railParsed.pinName} across the center divider. Use the near rail (+bottom/-bottom for rows F-J) or seat the part in rows A-E to keep rail drops short.`,
        });
      }
    }
  }

  if (board) {
    const boardRect = partRect(board);
    for (const connection of connections) {
      for (const [partEp, railEp] of [[connection.from, connection.to], [connection.to, connection.from]] as const) {
        const partParsed = endpointParts(partEp);
        const railParsed = endpointParts(railEp);
        if (!partParsed || !railParsed) continue;
        if (partParsed.partId === board.id || railParsed.partId !== board.id) continue;
        const targetPart = parts.find((p) => p.id === partParsed.partId);
        if (!targetPart || targetPart.seating || isBreadboardType(targetPart.type)) continue;
        const targetRect = partRect(targetPart);
        const isTopRail = railParsed.pinName.startsWith('+top') || railParsed.pinName.startsWith('-top');
        const isBottomRail = railParsed.pinName.startsWith('+bottom') || railParsed.pinName.startsWith('-bottom');
        if (targetRect.y + targetRect.height <= boardRect.y && isBottomRail) {
          issues.push({
            kind: 'perimeter-rail-detour',
            severity: 'warning',
            itemIds: [connection.id, targetPart.id, board.id],
            message: `${targetPart.id} is situated above ${board.id} but connects to ${railParsed.pinName}. Draw power from the near rail (+top/-top) or top header to avoid an outer perimeter detour.`,
          });
        } else if (targetRect.y >= boardRect.y + boardRect.height && isTopRail) {
          issues.push({
            kind: 'perimeter-rail-detour',
            severity: 'warning',
            itemIds: [connection.id, targetPart.id, board.id],
            message: `${targetPart.id} is situated below ${board.id} but connects to ${railParsed.pinName}. Draw power from the near rail (+bottom/-bottom) to avoid an outer perimeter detour.`,
          });
        }
      }
    }

    const railColumns: Record<string, string[]> = {};
    for (const connection of connections) {
      for (const ep of [connection.from, connection.to]) {
        const parsed = endpointParts(ep);
        if (!parsed || parsed.partId !== board.id) continue;
        const match = parsed.pinName.match(/^([+-])(top|bottom)(\d+)$/);
        if (match) {
          const bank = match[2];
          const col = match[3];
          const key = `${board.id}:${bank}:${col}`;
          railColumns[key] = (railColumns[key] ?? []).concat(connection.id);
        }
      }
    }
    for (const [key, conns] of Object.entries(railColumns)) {
      const uniqueConns = Array.from(new Set(conns));
      if (uniqueConns.length >= 2) {
        const [, bank, col] = key.split(':');
        issues.push({
          kind: 'same-column-rail-congestion',
          severity: 'warning',
          itemIds: uniqueConns,
          message: `${uniqueConns.join(' and ')} both enter ${bank} rail column ${col}. Offset entry columns (e.g. +${bank}${col} and -${bank}${Number(col) + 1}, or use rail()) so leads have separate parallel lanes.`,
        });
      }
    }
    const seatedOnBoard = parts.filter((p) => p.seating?.breadboardId === board.id);
    for (let i = 0; i < seatedOnBoard.length; i++) {
      const a = seatedOnBoard[i];
      const aRect = partRect(a);
      for (let j = i + 1; j < seatedOnBoard.length; j++) {
        const b = seatedOnBoard[j];
        const bRect = partRect(b);
        if (aRect.x < bRect.x + bRect.width - 4
          && aRect.x + aRect.width > bRect.x + 4
          && aRect.y < bRect.y + bRect.height - 4
          && aRect.y + aRect.height > bRect.y + 4) {
          issues.push({
            kind: 'seated-part-collision',
            severity: 'warning',
            itemIds: [a.id, b.id, board.id],
            message: `${a.id} overlaps ${b.id} on ${board.id}. Offset their seated positions by at least 2 columns to give each part clear physical clearance.`,
          });
        }
      }
    }
    if (board.type === 'breadboard-half' && seatedOnBoard.length >= 8) {
      issues.push({
        kind: 'board-capacity-recommendation',
        severity: 'warning',
        itemIds: [board.id],
        message: `${board.id} has ${seatedOnBoard.length} seated components. For circuits with 8+ seated components or multi-pin displays plus user inputs, upgrade to 'breadboard' (full 63-column) to keep routing spacious and uncrowded.`,
      });
    }
  }

  if (parts.length >= 2) {
    const unseated = parts.filter((p) => !p.seating);
    if (unseated.length >= 2) {
      const xs = unseated.map((p) => partRect(p).x);
      const xMaxs = unseated.map((p) => partRect(p).x + partRect(p).width);
      const ys = unseated.map((p) => partRect(p).y);
      const yMaxs = unseated.map((p) => partRect(p).y + partRect(p).height);
      const spanX = Math.round((Math.max(...xMaxs) - Math.min(...xs)) / ROUTING_CELL_PX);
      const spanY = Math.round((Math.max(...yMaxs) - Math.min(...ys)) / ROUTING_CELL_PX);
      if (spanX > 85 || spanY > 60) {
        issues.push({
          kind: 'viewport-overflow',
          severity: 'warning',
          itemIds: unseated.map((p) => p.id),
          message: `The overall circuit span (${spanX} horizontal cells × ${spanY} vertical cells) exceeds the comfortable 2D working area. Stack wide displays above the breadboard with above() to keep the layout compact.`,
        });
      }
    }
  }

  for (const connection of connections) {
    const endpointPartIds = new Set([connection.from, connection.to]
      .map((endpoint) => endpointParts(endpoint)?.partId)
      .filter((value): value is string => Boolean(value)));
    const segments = wireSegments(connection, parts);
    for (const part of parts) {
      if (endpointPartIds.has(part.id) || part.seating) continue;
      if (segments.some((segment) => segmentIntersectsRect(segment, partRect(part), 7))) {
        if (isBreadboardType(part.type)) {
          issues.push({
            kind: 'wire-through-board',
            severity: 'warning',
            itemIds: [connection.id, part.id],
            message: `${connection.id} uses ${part.id} as a routing corridor without terminating on it. Keep external cables outside the board and enter only at a named hole or rail.`,
          });
          continue;
        }
        issues.push({
          kind: 'wire-through-part',
          severity: 'error',
          itemIds: [connection.id, part.id],
          message: `${connection.id} passes through ${part.id}. Move the component or give the router a meaningful corridor around it.`,
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
    const notch = shortNotch(fullPoints);
    if (notch) {
      issues.push({
        kind: 'wire-notch',
        severity: 'warning',
        itemIds: [connection.id],
        message: `${connection.id} contains a tiny ${Math.round(notch.length * 10) / 10}px sideways notch between parallel runs. Keep one straight axis until the next meaningful bend.`,
      });
    }
    const backtrack = backtrackDistance(routingInterior);
    const endpointLeadReversal = doublesBackOverEndpointLead(connection, fullPoints, parts);
    if (endpointLeadReversal || backtrack >= ROUTING_CELL_PX * 0.75) {
      issues.push({
        kind: 'wire-backtrack',
        severity: 'warning',
        itemIds: [connection.id],
        message: endpointLeadReversal
          ? `${connection.id} exits a connector and immediately doubles back over the same lead. Continue away from the pin before turning.`
          : `${connection.id} reverses about ${Math.round(backtrack / ROUTING_CELL_PX)} physical routing cells inside its routing corridor. Prefer a monotonic route unless an obstacle requires the detour.`,
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
      const sharedNetEndpoint = first.netId && first.netId === second.netId
        ? [first.from, first.to].find((endpoint) => endpoint === second.from || endpoint === second.to)
        : undefined;
      const sharedNetPoint = sharedNetEndpoint ? endpointPoint(sharedNetEndpoint, parts) : undefined;
      let overlap = 0;
      for (const firstSegment of wireSegments(first, parts)) {
        for (const secondSegment of wireSegments(second, parts)) {
          const rawOverlap = parallelOverlapLength(firstSegment, secondSegment);
          const sharedLeadAllowance = sharedNetPoint
            && pointOnSegment(sharedNetPoint, firstSegment)
            && pointOnSegment(sharedNetPoint, secondSegment)
            ? ROUTING_CELL_PX
            : 0;
          overlap = Math.max(overlap, Math.max(0, rawOverlap - sharedLeadAllowance));
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
      const cx = Math.round((crossing.x - CANVAS_CENTER_X) / BREADBOARD_HOLE_PITCH);
      const cy = Math.round((crossing.y - CANVAS_CENTER_Y) / BREADBOARD_HOLE_PITCH);
      issues.push({
        kind: 'wire-crossing',
        severity: 'warning',
        itemIds: [first.id, second.id],
        message: `${first.id} crosses ${second.id} near physical routing cell (${cx}, ${cy}). Separate the routes when practical.`,
      });
    }
  }

  const penalties: Record<LayoutIssue['kind'], number> = {
    'part-overlap': 20,
    'pin-fanout': 20,
    'connector-facing-away': 6,
    'controller-stacked': 12,
    'split-source-cable': 12,
    'excessive-gap': 8,
    'trench-spanning-drop': 8,
    'perimeter-rail-detour': 10,
    'same-column-rail-congestion': 6,
    'viewport-overflow': 12,
    'seated-part-collision': 15,
    'board-capacity-recommendation': 6,
    'wire-through-part': 20,   // raised: passing through a part body is never acceptable
    'wire-through-board': 8,
    'wire-crossing': 10,
    'wire-overlap': 12,
    'diagonal-waypoints': 4,
    'too-many-bends': 4,       // raised: encourage simpler routes earlier
    'long-route': 3,
    'pin-exit': 3,
    'wire-backtrack': 3,
    'wire-notch': 5,
    'wire-color': 2,
  };
  const score = Math.max(0, 100 - issues.reduce((sum, issue) => sum + penalties[issue.kind], 0));
  const grade = score >= 92 ? 'excellent' : score >= 80 ? 'good' : score >= 65 ? 'needs-work' : 'poor';
  return { score, grade, issues };
}
