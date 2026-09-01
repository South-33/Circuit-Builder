import { getPartPins, PART_DEFINITIONS, PART_ORDER } from '../components/parts';
import { BREADBOARD_HOLE_PITCH, isBreadboardType } from '../breadboard/geometry';
import type { CircuitPart, PartType, WirePoint } from '../circuit/types';
import { CANVAS_CENTER_X, CANVAS_CENTER_Y } from '../layout/placement';
import { endpointPoint, partRect, pinExitDirection, type CardinalDirection } from '../wires/geometry';
import { agentPartType } from './input';

/** One agent placement/corridor cell is one physical 0.1-inch connector pitch. */
export const BLOCK_CELL_PX = BREADBOARD_HOLE_PITCH;
/** Ten integer planning units per physical connector pitch. */
export const BLOCK_UNITS_PER_CELL = 10;

export function normalizeRightAngle(degrees = 0) {
  return ((Math.round(degrees / 90) * 90) % 360 + 360) % 360;
}

export type BlockCell = { x: number; y: number };
export type BlockPin = {
  exit: CardinalDirection | 'any';
  /** Exact pin position relative to the component's top-left block, in cells. */
  at: BlockCell;
  /** Position along the edge it exits from, in cells. */
  edgeOffset: number;
  /** Integer agent-shadow coordinate. The exact renderer remains canonical. */
  unitAt: [number, number];
  edgeUnit: number;
};
export type BlockDefinition = {
  type: PartType;
  agentType: string;
  rotate: number;
  w: number;
  h: number;
  unitSize: [number, number];
  pins: Record<string, BlockPin>;
  breadboardMount: boolean;
};

function tempPart(type: PartType, rotate: number): CircuitPart {
  return {
    id: '__block_catalog__',
    type,
    left: 0,
    top: 0,
    rotate: normalizeRightAngle(rotate),
    attrs: { ...PART_DEFINITIONS[type].defaults },
  };
}

/**
 * Return the smallest integer-cell rectangle that contains the rendered part.
 * The rectangle is the only geometry the model uses for placement. Real pin
 * positions are intentionally NOT rounded to this grid: some real components
 * (notably the Uno's split header banks) contain offsets that are not integer
 * multiples of the breadboard pitch. The exact router leaves each pin on its
 * canonical axis and uses the grid only as a lane-spacing convention.
 */
export function blockDefinition(type: PartType, rotate = 0): BlockDefinition {
  const angle = normalizeRightAngle(rotate);
  const part = tempPart(type, angle);
  const rect = partRect(part);
  const pins = getPartPins(part);
  const pinMap: Record<string, BlockPin> = {};

  for (const pin of pins) {
    const exit = isBreadboardType(type) ? 'any' : pinExitDirection(`${part.id}:${pin.name}`, [part]) ?? 'any';
    const exact = endpointPoint(`${part.id}:${pin.name}`, [part]) ?? { x: rect.x + pin.x, y: rect.y + pin.y };
    const at = {
      x: Math.round(((exact.x - rect.x) / BLOCK_CELL_PX) * 10) / 10,
      y: Math.round(((exact.y - rect.y) / BLOCK_CELL_PX) * 10) / 10,
    };
    pinMap[pin.name] = {
      exit,
      at,
      edgeOffset: exit === 'left' || exit === 'right' ? at.y : at.x,
      unitAt: [Math.round(at.x * BLOCK_UNITS_PER_CELL), Math.round(at.y * BLOCK_UNITS_PER_CELL)],
      edgeUnit: Math.round((exit === 'left' || exit === 'right' ? at.y : at.x) * BLOCK_UNITS_PER_CELL),
    };
  }

  return {
    type,
    agentType: agentPartType(type),
    rotate: angle,
    w: Math.max(1, Math.ceil(rect.width / BLOCK_CELL_PX)),
    h: Math.max(1, Math.ceil(rect.height / BLOCK_CELL_PX)),
    unitSize: [
      Math.max(1, Math.ceil(rect.width / BLOCK_CELL_PX)) * BLOCK_UNITS_PER_CELL,
      Math.max(1, Math.ceil(rect.height / BLOCK_CELL_PX)) * BLOCK_UNITS_PER_CELL,
    ],
    pins: pinMap,
    breadboardMount: PART_DEFINITIONS[type].breadboardMount === true,
  };
}

export function blockCellToCanvas(cell: BlockCell): WirePoint {
  return {
    x: CANVAS_CENTER_X + cell.x * BLOCK_CELL_PX,
    y: CANVAS_CENTER_Y + cell.y * BLOCK_CELL_PX,
  };
}

export function canvasToBlockCell(point: WirePoint): BlockCell {
  return {
    x: Math.round((point.x - CANVAS_CENTER_X) / BLOCK_CELL_PX),
    y: Math.round((point.y - CANVAS_CENTER_Y) / BLOCK_CELL_PX),
  };
}

/** Place a rendered part from the top-left cell of its logical block. */
export function blockPlacement(type: PartType, at: BlockCell, rotate = 0) {
  const part = tempPart(type, rotate);
  const rect = partRect(part);
  const target = blockCellToCanvas(at);
  return {
    left: Math.round((target.x - rect.x) * 1000) / 1000,
    top: Math.round((target.y - rect.y) * 1000) / 1000,
  };
}

export function blockRect(at: BlockCell, def: Pick<BlockDefinition, 'w' | 'h'>) {
  return { x: at.x, y: at.y, w: def.w, h: def.h };
}

export function blockRectsOverlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function partBlockAt(part: CircuitPart): BlockCell {
  const rect = partRect(part);
  return canvasToBlockCell({ x: rect.x, y: rect.y });
}

function compactPins(def: BlockDefinition) {
  if (isBreadboardType(def.type)) {
    return def.type === 'breadboard-half'
      ? 'holes A-J:1-30; rails +/- top/bottom:1-25'
      : 'holes A-J:1-63; rails +/- top/bottom:1-50';
  }
  const groups = new Map<CardinalDirection | 'any', string[]>();
  for (const [name, pin] of Object.entries(def.pins).sort((a, b) => a[1].edgeUnit - b[1].edgeUnit)) {
    const names = groups.get(pin.exit) ?? [];
    names.push(`${name}@${pin.unitAt[0]},${pin.unitAt[1]}`);
    groups.set(pin.exit, names);
  }
  return (['up', 'right', 'down', 'left', 'any'] as const)
    .flatMap((side) => {
      const names = groups.get(side);
      return names?.length ? [`${side}:${names.join(',')}`] : [];
    })
    .join(' ');
}

/**
 * Compact catalog embedded directly in the build tool description. This is
 * intentionally repetitive data so the model can plan a scene in one shot
 * without spending a separate inspect round trip to learn component geometry.
 * Pins are grouped by exit side. The router reads exact canonical geometry.
 */
export function compactBlockInventory(types: readonly PartType[] = PART_ORDER) {
  return types.map((type) => {
    const def = blockDefinition(type, 0);
    return `${def.agentType} pins{${compactPins(def)}} shadow=${def.unitSize[0]}x${def.unitSize[1]}u/${def.w}x${def.h}cells${def.breadboardMount ? ':mount' : ''}`;
  }).join('\n');
}
