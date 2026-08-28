import { getPartPins, PART_DEFINITIONS } from '../components/parts';
import type { BreadboardSeating, CircuitPart, WirePoint } from '../circuit/types';
import { alignPartToParts, type AlignmentGuide } from '../layout/alignment';
import { localPinPoint, partRect } from '../wires/geometry';
import { BREADBOARD_HOLE_PITCH, isBreadboardType } from './geometry';

export type SnapMode = 'normal' | 'fine' | 'off';

export type PartPlacement = {
  left: number;
  top: number;
  seating?: BreadboardSeating;
  guides?: AlignmentGuide[];
};

/** Compact agent primitive: align one component pin to one named breadboard hole. */
export type BreadboardAnchor = {
  breadboardId: string;
  pin: string;
  hole: string;
};

const FREE_GRID = BREADBOARD_HOLE_PITCH;
const FINE_GRID = BREADBOARD_HOLE_PITCH / 2;
const HOLE_CAPTURE_DISTANCE = 18;
const MAX_SEATED_PIN_ERROR = 4.75;
const BOARD_CAPTURE_MARGIN = 28;

function roundTo(value: number, grid: number) {
  return Math.round(value / grid) * grid;
}

function pointDistance(a: WirePoint, b: WirePoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  margin = 0,
) {
  return a.x < b.x + b.width + margin
    && a.x + a.width > b.x - margin
    && a.y < b.y + b.height + margin
    && a.y + a.height > b.y - margin;
}

function holePoints(breadboard: CircuitPart) {
  return getPartPins(breadboard).map((pin) => {
    const local = localPinPoint(breadboard, pin.name)!;
    return {
      name: pin.name,
      point: { x: breadboard.left + local.x, y: breadboard.top + local.y },
    };
  });
}

function partPinPoints(part: CircuitPart) {
  return getPartPins(part)
    .map((pin) => {
      const local = localPinPoint(part, pin.name);
      return local ? { name: pin.name, point: { x: part.left + local.x, y: part.top + local.y } } : null;
    })
    .filter((value): value is { name: string; point: WirePoint } => value !== null);
}

function resolveName(names: string[], requested: string) {
  return names.find((name) => name === requested)
    ?? names.find((name) => name.toLowerCase() === requested.toLowerCase())
    ?? null;
}

function inferSeating(part: CircuitPart, breadboard: CircuitPart, tolerance = MAX_SEATED_PIN_ERROR) {
  const pins = partPinPoints(part);
  const holes = holePoints(breadboard);
  const used = new Set<string>();
  const mapping: Record<string, string> = {};

  for (const pin of pins) {
    let nearest: { name: string; distance: number } | null = null;
    for (const hole of holes) {
      if (used.has(hole.name)) continue;
      const distance = pointDistance(pin.point, hole.point);
      if (!nearest || distance < nearest.distance) nearest = { name: hole.name, distance };
    }
    if (!nearest || nearest.distance > tolerance) {
      throw new Error(`Cannot seat ${part.id}: pin "${pin.name}" does not land on a breadboard hole.`);
    }
    used.add(nearest.name);
    mapping[pin.name] = nearest.name;
  }

  return { breadboardId: breadboard.id, pins: mapping } satisfies BreadboardSeating;
}

/**
 * Align a component from one semantic anchor, then infer the rest of its hole
 * mapping from the real pin geometry. This is the preferred agent placement
 * primitive because it is compact and deterministic.
 */
export function seatPartAtHole(part: CircuitPart, allParts: CircuitPart[], anchor: BreadboardAnchor) {
  const breadboard = allParts.find((candidate) => candidate.id === anchor.breadboardId);
  if (!breadboard || !isBreadboardType(breadboard.type)) {
    throw new Error(`Cannot seat ${part.id}: breadboard "${anchor.breadboardId}" does not exist.`);
  }
  if (!PART_DEFINITIONS[part.type].breadboardMount) {
    throw new Error(`${part.type} is not a breadboard-mount component.`);
  }

  const partPinNames = getPartPins(part).map((pin) => pin.name);
  const holeNames = getPartPins(breadboard).map((pin) => pin.name);
  const pinName = resolveName(partPinNames, anchor.pin);
  const holeName = resolveName(holeNames, anchor.hole);
  if (!pinName) throw new Error(`Cannot seat ${part.id}: pin "${anchor.pin}" does not exist.`);
  if (!holeName) throw new Error(`Cannot seat ${part.id}: breadboard hole "${anchor.hole}" does not exist.`);

  const localPart = localPinPoint(part, pinName);
  const localHole = localPinPoint(breadboard, holeName);
  if (!localPart || !localHole) throw new Error(`Cannot resolve seating geometry for ${part.id}.`);

  const aligned: CircuitPart = {
    ...part,
    left: Math.round((breadboard.left + localHole.x - localPart.x) * 100) / 100,
    top: Math.round((breadboard.top + localHole.y - localPart.y) * 100) / 100,
    seating: undefined,
  };
  return { ...aligned, seating: inferSeating(aligned, breadboard) };
}

/** Align a component from an explicit component-pin -> breadboard-hole map. */
export function alignExplicitSeating(part: CircuitPart, allParts: CircuitPart[]) {
  if (!part.seating) return part;
  const breadboard = allParts.find((candidate) => candidate.id === part.seating?.breadboardId);
  if (!breadboard || !isBreadboardType(breadboard.type)) {
    throw new Error(`Cannot seat ${part.id}: breadboard "${part.seating.breadboardId}" does not exist.`);
  }

  const partPins = new Set(getPartPins(part).map((pin) => pin.name));
  const boardPins = new Set(getPartPins(breadboard).map((pin) => pin.name));
  const placements: Array<{ left: number; top: number }> = [];
  for (const [partPin, hole] of Object.entries(part.seating.pins)) {
    if (!partPins.has(partPin)) throw new Error(`Cannot seat ${part.id}: pin "${partPin}" does not exist.`);
    if (!boardPins.has(hole)) throw new Error(`Cannot seat ${part.id}: breadboard hole "${hole}" does not exist.`);
    const localPart = localPinPoint(part, partPin);
    const localHole = localPinPoint(breadboard, hole);
    if (!localPart || !localHole) continue;
    placements.push({
      left: breadboard.left + localHole.x - localPart.x,
      top: breadboard.top + localHole.y - localPart.y,
    });
  }
  if (!placements.length) return part;

  const left = placements.reduce((sum, point) => sum + point.left, 0) / placements.length;
  const top = placements.reduce((sum, point) => sum + point.top, 0) / placements.length;
  const maxError = Math.max(...placements.map((point) => Math.hypot(point.left - left, point.top - top)));
  if (maxError > 2.5) {
    throw new Error(`Cannot seat ${part.id}: the requested holes do not match this component's pin spacing.`);
  }
  return { ...part, left: Math.round(left * 100) / 100, top: Math.round(top * 100) / 100 };
}

function scoreSeating(part: CircuitPart, breadboard: CircuitPart) {
  const pins = partPinPoints(part);
  if (pins.length < 2) return null;
  const holes = holePoints(breadboard);
  if (!holes.length) return null;

  let best: { dx: number; dy: number; score: number; seating: BreadboardSeating } | null = null;

  // A good snap is always explainable as aligning one real part pin with one
  // real breadboard hole. Generate only those nearby translations, then score
  // how well every other pin lands on a distinct hole.
  for (const anchorPin of pins) {
    for (const anchorHole of holes) {
      const dx = anchorHole.point.x - anchorPin.point.x;
      const dy = anchorHole.point.y - anchorPin.point.y;
      if (Math.hypot(dx, dy) > HOLE_CAPTURE_DISTANCE) continue;

      const usedHoles = new Set<string>();
      const mapping: Record<string, string> = {};
      let squaredError = 0;
      let maxError = 0;
      let valid = true;

      for (const pin of pins) {
        const translated = { x: pin.point.x + dx, y: pin.point.y + dy };
        let nearest: { name: string; distance: number } | null = null;
        for (const hole of holes) {
          if (usedHoles.has(hole.name)) continue;
          const distance = pointDistance(translated, hole.point);
          if (!nearest || distance < nearest.distance) nearest = { name: hole.name, distance };
        }
        if (!nearest || nearest.distance > MAX_SEATED_PIN_ERROR) {
          valid = false;
          break;
        }
        usedHoles.add(nearest.name);
        mapping[pin.name] = nearest.name;
        squaredError += nearest.distance * nearest.distance;
        maxError = Math.max(maxError, nearest.distance);
      }

      if (!valid) continue;
      const movement = Math.hypot(dx, dy);
      const score = squaredError + maxError * 2 + movement * 0.12;
      if (!best || score < best.score) {
        best = {
          dx,
          dy,
          score,
          seating: { breadboardId: breadboard.id, pins: mapping },
        };
      }
    }
  }
  return best;
}

/**
 * Snap a dragged component either to the breadboard's real hole grid or to
 * the free canvas grid. Shift/free movement is represented by mode="off".
 */
export function snapPartPlacement(
  part: CircuitPart,
  proposedLeft: number,
  proposedTop: number,
  allParts: CircuitPart[],
  mode: SnapMode = 'normal',
  alignmentThreshold = 6,
): PartPlacement {
  const proposed: CircuitPart = { ...part, left: proposedLeft, top: proposedTop, seating: undefined };

  if (mode !== 'off' && PART_DEFINITIONS[part.type].breadboardMount) {
    const proposedRect = partRect(proposed);
    let best: ReturnType<typeof scoreSeating> = null;

    for (const breadboard of allParts) {
      if (!isBreadboardType(breadboard.type) || breadboard.id === part.id) continue;
      if (!rectsOverlap(proposedRect, partRect(breadboard), BOARD_CAPTURE_MARGIN)) continue;
      const candidate = scoreSeating(proposed, breadboard);
      if (candidate && (!best || candidate.score < best.score)) best = candidate;
    }

    if (best) {
      return {
        left: Math.round((proposedLeft + best.dx) * 100) / 100,
        top: Math.round((proposedTop + best.dy) * 100) / 100,
        seating: best.seating,
      };
    }
  }

  if (mode === 'off') return { left: proposedLeft, top: proposedTop };
  const aligned = alignPartToParts(part, proposedLeft, proposedTop, allParts, alignmentThreshold);
  const grid = mode === 'fine' ? FINE_GRID : FREE_GRID;

  // Snap by a real component pin when possible, not by the component's arbitrary
  // top-left box. This keeps breadboard-compatible parts (resistors, LEDs, DIP
  // parts, etc.) on the same 0.1-inch physical lattice as breadboard holes.
  const candidate: CircuitPart = { ...part, left: aligned.left, top: aligned.top, seating: undefined };
  const anchorPin = partPinPoints(candidate)[0];
  const pinSnappedLeft = anchorPin
    ? candidate.left + (roundTo(anchorPin.point.x, grid) - anchorPin.point.x)
    : roundTo(candidate.left, grid);
  const pinSnappedTop = anchorPin
    ? candidate.top + (roundTo(anchorPin.point.y, grid) - anchorPin.point.y)
    : roundTo(candidate.top, grid);

  return {
    left: aligned.snappedX ? aligned.left : Math.round(pinSnappedLeft * 100) / 100,
    top: aligned.snappedY ? aligned.top : Math.round(pinSnappedTop * 100) / 100,
    ...(aligned.guides.length ? { guides: aligned.guides } : {}),
  };
}

export function getBreadboardSeating(part: CircuitPart, allParts: CircuitPart[]) {
  if (!part.seating) return null;
  const breadboard = allParts.find((candidate) => candidate.id === part.seating?.breadboardId);
  if (!breadboard || !isBreadboardType(breadboard.type)) return null;
  return part.seating;
}
