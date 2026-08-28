import type { PartType, PinInfo } from '../circuit/types';

/** Fritzing breadboards use a 7.2 SVG-unit / 0.1-inch hole pitch. */
export const BREADBOARD_SCALE = 4 / 3;

type BreadboardType = Extract<PartType, 'breadboard' | 'breadboard-half'>;

export type BreadboardGeometry = {
  type: BreadboardType;
  asset: string;
  width: number;
  height: number;
  columns: number;
  railHoles: number;
  pins: readonly PinInfo[];
};

const PITCH = 7.2;
export const BREADBOARD_HOLE_PITCH = PITCH * BREADBOARD_SCALE;
const ROW_Y: Record<string, number> = {
  A: 36,
  B: 43.2,
  C: 50.4,
  D: 57.6,
  E: 64.8,
  F: 86.4,
  G: 93.6,
  H: 100.8,
  I: 108,
  J: 115.2,
};

function buildPins(columns: number, gridX0: number, railHoles: number, railX0: number): PinInfo[] {
  const pins: PinInfo[] = [];
  for (let column = 1; column <= columns; column++) {
    const x = (gridX0 + (column - 1) * PITCH) * BREADBOARD_SCALE;
    for (const [row, y] of Object.entries(ROW_Y)) {
      pins.push({ name: `${row}${column}`, x, y: y * BREADBOARD_SCALE, signals: [] });
    }
  }

  for (let hole = 1; hole <= railHoles; hole++) {
    const index = hole - 1;
    const x = (railX0 + (index + Math.floor(index / 5)) * PITCH) * BREADBOARD_SCALE;
    pins.push({ name: `-top${hole}`, x, y: 7.2 * BREADBOARD_SCALE, signals: [] });
    pins.push({ name: `+top${hole}`, x, y: 14.4 * BREADBOARD_SCALE, signals: [] });
    pins.push({ name: `-bottom${hole}`, x, y: 136.8 * BREADBOARD_SCALE, signals: [] });
    pins.push({ name: `+bottom${hole}`, x, y: 144 * BREADBOARD_SCALE, signals: [] });
  }
  return pins;
}

const FULL: BreadboardGeometry = {
  type: 'breadboard',
  asset: '/assets/fritzing/breadboard-full.svg',
  width: 468.238 * BREADBOARD_SCALE,
  height: 151.2 * BREADBOARD_SCALE,
  columns: 63,
  railHoles: 50,
  // The full Fritzing board starts the numbered terminal field at x=10.92.
  pins: buildPins(63, 10.92, 50, 25.33),
};

const HALF: BreadboardGeometry = {
  type: 'breadboard-half',
  asset: '/assets/fritzing/breadboard-half.svg',
  width: 245.037 * BREADBOARD_SCALE,
  height: 151.2 * BREADBOARD_SCALE,
  columns: 30,
  railHoles: 25,
  // Verified against halfBreadboard.svg: A1=(25.32,36), A30=(234.117,36),
  // W1/X1/Y1/Z1=(25.32,7.2/14.4/136.8/144).
  pins: buildPins(30, 25.32, 25, 25.32),
};

const GEOMETRIES: Record<BreadboardType, BreadboardGeometry> = {
  breadboard: FULL,
  'breadboard-half': HALF,
};

export const BREADBOARD_COLUMNS = FULL.columns;
export const BREADBOARD_RAIL_HOLES = FULL.railHoles;
export const BREADBOARD_WIDTH = FULL.width;
export const BREADBOARD_HEIGHT = FULL.height;
export const BREADBOARD_PINS = FULL.pins;

export function isBreadboardType(type: PartType): type is BreadboardType {
  return type === 'breadboard' || type === 'breadboard-half';
}

export function getBreadboardGeometry(type: PartType) {
  return isBreadboardType(type) ? GEOMETRIES[type] : null;
}

export function breadboardPin(name: string, type: BreadboardType = 'breadboard') {
  return GEOMETRIES[type].pins.find((pin) => pin.name.toLowerCase() === name.trim().toLowerCase()) ?? null;
}

export function findNearestBreadboardPin(
  lx: number,
  ly: number,
  type: BreadboardType = 'breadboard',
  maxDistance = 16
): PinInfo | null {
  const geom = GEOMETRIES[type];
  if (!geom) return null;

  const unscaleY = ly / BREADBOARD_SCALE;
  const unscaleX = lx / BREADBOARD_SCALE;
  let bestPin: PinInfo | null = null;
  let bestDistSq = maxDistance * maxDistance;

  // 1. Check terminal rows A-E and F-J
  const rowsUpper = ['A', 'B', 'C', 'D', 'E'];
  const rowsLower = ['F', 'G', 'H', 'I', 'J'];
  let targetRow: string | null = null;

  if (unscaleY >= 32 && unscaleY <= 69) {
    const rowIdx = Math.round((unscaleY - 36) / PITCH);
    if (rowIdx >= 0 && rowIdx < rowsUpper.length) targetRow = rowsUpper[rowIdx];
  } else if (unscaleY >= 82 && unscaleY <= 120) {
    const rowIdx = Math.round((unscaleY - 86.4) / PITCH);
    if (rowIdx >= 0 && rowIdx < rowsLower.length) targetRow = rowsLower[rowIdx];
  }

  const gridX0 = type === 'breadboard' ? 10.92 : 25.32;
  if (targetRow) {
    const col = 1 + Math.round((unscaleX - gridX0) / PITCH);
    if (col >= 1 && col <= geom.columns) {
      const pinName = `${targetRow}${col}`;
      const pin = breadboardPin(pinName, type);
      if (pin) {
        const dx = lx - pin.x;
        const dy = ly - pin.y;
        const distSq = dx * dx + dy * dy;
        if (distSq <= bestDistSq) return pin;
      }
    }
  }

  // 2. Power rails (+top, -top, -bottom, +bottom)
  const railX0 = type === 'breadboard' ? 25.33 : 25.32;
  if (unscaleY >= 3 && unscaleY <= 20) {
    const isPlus = Math.abs(unscaleY - 14.4) < Math.abs(unscaleY - 7.2);
    const approxIndex = Math.round((unscaleX - railX0) / (PITCH * 1.2));
    for (let h = Math.max(1, approxIndex - 3); h <= Math.min(geom.railHoles, approxIndex + 4); h++) {
      const pinName = `${isPlus ? '+' : '-'}top${h}`;
      const pin = breadboardPin(pinName, type);
      if (pin) {
        const dx = lx - pin.x;
        const dy = ly - pin.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          bestPin = pin;
        }
      }
    }
  } else if (unscaleY >= 130 && unscaleY <= 150) {
    const isPlus = Math.abs(unscaleY - 144) < Math.abs(unscaleY - 136.8);
    const approxIndex = Math.round((unscaleX - railX0) / (PITCH * 1.2));
    for (let h = Math.max(1, approxIndex - 3); h <= Math.min(geom.railHoles, approxIndex + 4); h++) {
      const pinName = `${isPlus ? '+' : '-'}bottom${h}`;
      const pin = breadboardPin(pinName, type);
      if (pin) {
        const dx = lx - pin.x;
        const dy = ly - pin.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          bestPin = pin;
        }
      }
    }
  }

  return bestPin;
}

export function breadboardHoleNet(name: string): string | null {
  const normalized = name.trim();
  if (normalized.startsWith('+top')) return '+top';
  if (normalized.startsWith('-top')) return '-top';
  if (normalized.startsWith('+bottom')) return '+bottom';
  if (normalized.startsWith('-bottom')) return '-bottom';

  const match = /^([A-Ja-j])(\d+)$/.exec(normalized);
  if (!match) return null;
  const row = match[1].toUpperCase();
  const col = match[2];
  if (['A', 'B', 'C', 'D', 'E'].includes(row)) return `terminal-upper:${col}`;
  if (['F', 'G', 'H', 'I', 'J'].includes(row)) return `terminal-lower:${col}`;
  return null;
}
