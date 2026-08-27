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
