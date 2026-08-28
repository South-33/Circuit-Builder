import { getPartBounds } from '../components/parts';
import type { CircuitConnection, CircuitPart, PartType } from '../circuit/types';
import { alignExplicitSeating } from '../breadboard/placement';
import { partRect } from '../wires/geometry';

// A focused logical surface keeps circuit coordinates compact while
// letting the viewport roam like an open workbench instead of a page.
// 3200×2000 = 100×62 agent grid cells at 32px each — right-sized for
// circuits an agent can reason about in one planning grid.
export const WORKSPACE_WIDTH = 3200;
export const WORKSPACE_HEIGHT = 2000;

// Canvas center. Grid (0,0) maps here so agents use coordinates that feel
// natural: small numbers around zero rather than large absolute offsets.
export const CANVAS_CENTER_X = WORKSPACE_WIDTH / 2;   // 1600
export const CANVAS_CENTER_Y = WORKSPACE_HEIGHT / 2;  // 1000

const GAP = 22;
const SEARCH_STEP = 34;

type Point = { left: number; top: number };

export function centerCircuitDocument(parts: CircuitPart[], connections: CircuitConnection[]) {
  if (!parts.length) return { parts: structuredClone(parts), connections: structuredClone(connections) };
  const rawParts = structuredClone(parts);
  const alignedParts = rawParts.map((part) => part.seating ? alignExplicitSeating(part, rawParts) : part);
  const rects = alignedParts.map(partRect);
  const minX = Math.min(...rects.map((rect) => rect.x));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  const dx = WORKSPACE_WIDTH / 2 - (minX + maxX) / 2;
  const dy = WORKSPACE_HEIGHT / 2 - (minY + maxY) / 2;
  return {
    parts: alignedParts.map((part) => ({ ...part, left: part.left + dx, top: part.top + dy })),
    connections: connections.map((connection) => ({
      ...structuredClone(connection),
      waypoints: connection.waypoints?.map((point) => ({ x: point.x + dx, y: point.y + dy })),
    })),
  };
}

function clampPlacement(type: PartType, point: Point): Point {
  const bounds = getPartBounds(type);
  return {
    left: Math.max(20, Math.min(WORKSPACE_WIDTH - bounds.width - 20, point.left)),
    top: Math.max(20, Math.min(WORKSPACE_HEIGHT - bounds.height - 20, point.top)),
  };
}

function overlaps(type: PartType, point: Point, parts: CircuitPart[]) {
  const bounds = getPartBounds(type);
  const candidate = {
    x: point.left - GAP,
    y: point.top - GAP,
    width: bounds.width + GAP * 2,
    height: bounds.height + GAP * 2,
  };
  return parts.some((part) => {
    const rect = partRect(part);
    return candidate.x < rect.x + rect.width
      && candidate.x + candidate.width > rect.x
      && candidate.y < rect.y + rect.height
      && candidate.y + candidate.height > rect.y;
  });
}

/** Shared manual/agent placement that avoids stacking new parts. */
export function findOpenPlacement(
  type: PartType,
  parts: CircuitPart[],
  preferred: Point = { left: CANVAS_CENTER_X, top: CANVAS_CENTER_Y },
): Point {
  const origin = clampPlacement(type, preferred);
  if (!overlaps(type, origin, parts)) return origin;

  for (let ring = 1; ring <= 18; ring++) {
    const radius = ring * SEARCH_STEP;
    const offsets: Point[] = [];
    for (let step = -ring; step <= ring; step++) {
      const along = step * SEARCH_STEP;
      offsets.push(
        { left: along, top: -radius },
        { left: radius, top: along },
        { left: along, top: radius },
        { left: -radius, top: along },
      );
    }
    for (const offset of offsets) {
      const point = clampPlacement(type, {
        left: origin.left + offset.left,
        top: origin.top + offset.top,
      });
      if (!overlaps(type, point, parts)) return point;
    }
  }

  for (let top = 30; top < WORKSPACE_HEIGHT - 60; top += SEARCH_STEP) {
    for (let left = 30; left < WORKSPACE_WIDTH - 60; left += SEARCH_STEP) {
      const point = clampPlacement(type, { left, top });
      if (!overlaps(type, point, parts)) return point;
    }
  }
  return origin;
}
