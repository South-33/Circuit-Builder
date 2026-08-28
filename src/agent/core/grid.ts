import { getPartBounds, getPartPins } from '../../components/parts';
import { BREADBOARD_HOLE_PITCH } from '../../breadboard/geometry';
import type { CircuitPart, PartType, WirePoint } from '../../circuit/types';
import { CANVAS_CENTER_X, CANVAS_CENTER_Y } from '../../layout/placement';
import { localPinPoint, partRect } from '../../wires/geometry';

/** Coarse agent planning cell. Physical connector/routing lanes use the 9.6px breadboard pitch. */
export const AGENT_GRID_SIZE = 32;

export type GridPoint = { x: number; y: number };
export type GridSize = { w: number; h: number };
export type GridRect = GridPoint & GridSize;

/** Grid (0,0) is the semantic center of the workbench. */
export function gridPointToCanvas(point: WirePoint): WirePoint {
  return {
    x: point.x * AGENT_GRID_SIZE + CANVAS_CENTER_X,
    y: point.y * AGENT_GRID_SIZE + CANVAS_CENTER_Y,
  };
}

export function canvasPointToGrid(point: WirePoint): WirePoint {
  return {
    x: Math.round((point.x - CANVAS_CENTER_X) / AGENT_GRID_SIZE),
    y: Math.round((point.y - CANVAS_CENTER_Y) / AGENT_GRID_SIZE),
  };
}

/**
 * Legacy top-left grid placement kept for presets and the legacy harness.
 * New harnesses use gridCenterPlacement so coordinates mean component centers.
 */
export function gridPartPlacement(point: WirePoint) {
  const canvas = gridPointToCanvas(point);
  return { left: canvas.x, top: canvas.y };
}

export function normalizeRightAngle(degrees = 0) {
  const normalized = ((Math.round(degrees / 90) * 90) % 360 + 360) % 360;
  return normalized;
}

export function rotatedPartSize(type: PartType, rotate = 0) {
  const bounds = getPartBounds(type);
  const turn = normalizeRightAngle(rotate);
  return turn === 90 || turn === 270
    ? { width: bounds.height, height: bounds.width }
    : bounds;
}

/** Grid footprint of the rendered, rotated part. */
export function partGridSize(partOrType: CircuitPart | PartType, rotate?: number): GridSize {
  const type = typeof partOrType === 'string' ? partOrType : partOrType.type;
  const angle = rotate ?? (typeof partOrType === 'string' ? 0 : partOrType.rotate ?? 0);
  const size = rotatedPartSize(type, angle);
  return {
    w: Math.max(1, Math.ceil(size.width / AGENT_GRID_SIZE)),
    h: Math.max(1, Math.ceil(size.height / AGENT_GRID_SIZE)),
  };
}

/** Convert a component-center grid coordinate to the store's top-left pixel position. */
export function gridCenterPlacement(type: PartType, center: GridPoint, rotate = 0) {
  const bounds = getPartBounds(type);
  const canvasCenter = gridPointToCanvas(center);
  let left = canvasCenter.x - bounds.width / 2;
  let top = canvasCenter.y - bounds.height / 2;

  // Keep the coarse agent center approximately where requested, but phase the
  // actual component pins onto the same 0.1-inch lattice used by breadboards.
  // This prevents parts such as resistors from visually drifting between grid
  // dots simply because the 32px planning grid and 9.6px physical pitch differ.
  const temp: CircuitPart = { id: '__grid_anchor__', type, left, top, rotate: normalizeRightAngle(rotate), attrs: {} };
  const anchor = getPartPins(temp)[0];
  const local = anchor ? localPinPoint(temp, anchor.name) : null;
  if (local) {
    const pinX = left + local.x;
    const pinY = top + local.y;
    left += Math.round(pinX / BREADBOARD_HOLE_PITCH) * BREADBOARD_HOLE_PITCH - pinX;
    top += Math.round(pinY / BREADBOARD_HOLE_PITCH) * BREADBOARD_HOLE_PITCH - pinY;
  }

  return {
    left: Math.round(left * 100) / 100,
    top: Math.round(top * 100) / 100,
  };
}

export function partCenterCanvas(part: CircuitPart): WirePoint {
  const bounds = getPartBounds(part.type);
  return { x: part.left + bounds.width / 2, y: part.top + bounds.height / 2 };
}

export function partCenterGrid(part: CircuitPart): GridPoint {
  return canvasPointToGrid(partCenterCanvas(part));
}

/** Bounding footprint in centered grid coordinates, including rotation. */
export function partGridRect(part: CircuitPart, paddingCells = 0): GridRect {
  const rect = partRect(part);
  const left = Math.floor((rect.x - CANVAS_CENTER_X) / AGENT_GRID_SIZE) - paddingCells;
  const top = Math.floor((rect.y - CANVAS_CENTER_Y) / AGENT_GRID_SIZE) - paddingCells;
  const right = Math.ceil((rect.x + rect.width - CANVAS_CENTER_X) / AGENT_GRID_SIZE) + paddingCells;
  const bottom = Math.ceil((rect.y + rect.height - CANVAS_CENTER_Y) / AGENT_GRID_SIZE) + paddingCells;
  return {
    x: left,
    y: top,
    w: Math.max(1, right - left),
    h: Math.max(1, bottom - top),
  };
}

export function gridRectsOverlap(a: GridRect, b: GridRect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function gridRectContains(rect: GridRect, point: GridPoint) {
  return point.x >= rect.x && point.x < rect.x + rect.w && point.y >= rect.y && point.y < rect.y + rect.h;
}
