#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Report whether every catalog component's connector geometry can share the
// visible 0.1-inch routing lattice after a single translation.

import { register } from 'node:module';

register('../testing/loader.mjs', import.meta.url);

class MockHTMLElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.dataset = {};
    this.attributes = {};
    this.children = [];
    this.style = {};
  }
  getAttribute(name) { return this.attributes[name] ?? null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  hasAttribute(name) { return name in this.attributes; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }
}

globalThis.HTMLElement = MockHTMLElement;
globalThis.window = globalThis;
globalThis.ImageData = class ImageData {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
};

const wokwi = await import('@wokwi/elements');
const WOKWI_TAG_MAP = {
  'wokwi-arduino-uno': wokwi.ArduinoUnoElement,
  'wokwi-led': wokwi.LEDElement,
  'wokwi-rgb-led': wokwi.RGBLedElement,
  'wokwi-resistor': wokwi.ResistorElement,
  'wokwi-pushbutton': wokwi.PushbuttonElement,
  'wokwi-slide-switch': wokwi.SlideSwitchElement,
  'wokwi-potentiometer': wokwi.PotentiometerElement,
  'wokwi-buzzer': wokwi.BuzzerElement,
  'wokwi-7segment': wokwi.SevenSegmentElement,
  'wokwi-pushbutton-6mm': wokwi.Pushbutton6mmElement,
  'wokwi-slide-potentiometer': wokwi.SlidePotentiometerElement,
  'wokwi-analog-joystick': wokwi.AnalogJoystickElement,
  'wokwi-ky-040': wokwi.KY040Element,
  'wokwi-tilt-switch': wokwi.TiltSwitchElement,
  'wokwi-dip-switch-8': wokwi.DipSwitch8Element,
  'wokwi-led-bar-graph': wokwi.LedBarGraphElement,
  'wokwi-servo': wokwi.ServoElement,
  'wokwi-stepper-motor': wokwi.StepperMotorElement,
  'wokwi-membrane-keypad': wokwi.MembraneKeypadElement,
  'wokwi-ntc-temperature-sensor': wokwi.NTCTemperatureSensorElement,
  'wokwi-photoresistor-sensor': wokwi.PhotoresistorSensorElement,
  'wokwi-pir-motion-sensor': wokwi.PIRMotionSensorElement,
  'wokwi-flame-sensor': wokwi.FlameSensorElement,
  'wokwi-gas-sensor': wokwi.GasSensorElement,
  'wokwi-big-sound-sensor': wokwi.BigSoundSensorElement,
  'wokwi-small-sound-sensor': wokwi.SmallSoundSensorElement,
  'wokwi-heart-beat-sensor': wokwi.HeartBeatSensorElement,
  'wokwi-hc-sr04': wokwi.HCSR04Element,
  'wokwi-dht22': wokwi.DHT22Element || wokwi.Dht22Element,
  'wokwi-ir-receiver': wokwi.IRReceiverElement,
  'wokwi-ir-remote': wokwi.IRRemoteElement,
  'wokwi-lcd1602': wokwi.LCD1602Element,
  'wokwi-lcd2004': wokwi.LCD2004Element,
  'wokwi-ssd1306': wokwi.SSD1306Element,
  'wokwi-ds1307': wokwi.Ds1307Element,
  'wokwi-mpu6050': wokwi.MPU6050Element,
  'wokwi-neopixel': wokwi.NeoPixelElement,
  'wokwi-led-ring': wokwi.LEDRingElement,
  'wokwi-neopixel-matrix': wokwi.NeopixelMatrixElement,
  'wokwi-ks2e-m-dc5': wokwi.KS2EMDC5Element,
};

globalThis.document = {
  createElement(tag) {
    const Cls = WOKWI_TAG_MAP[tag.toLowerCase()];
    if (Cls) {
      try { return new Cls(); } catch { return new MockHTMLElement(tag); }
    }
    return new MockHTMLElement(tag);
  },
};

const { PART_TYPES } = await import('../../src/components/partTypes.ts');
const { PART_DEFINITIONS, getPartPins } = await import('../../src/components/parts.ts');
const { BREADBOARD_HOLE_PITCH } = await import('../../src/breadboard/geometry.ts');
const { seatPartAtHole, snapPartPlacement } = await import('../../src/breadboard/placement.ts');
const { endpointPoint } = await import('../../src/wires/geometry.ts');

const detailTypes = new Set(process.argv.slice(2));

const pitch = BREADBOARD_HOLE_PITCH;
const rotations = [0, 90, 180, 270];
const residual = (value) => {
  const nearest = Math.round(value / pitch) * pitch;
  return Math.abs(value - nearest);
};

function latticeError(pins, scale) {
  if (pins.length < 2) return 0;
  const anchor = pins[0];
  let error = 0;
  for (const pin of pins.slice(1)) {
    error = Math.max(
      error,
      residual((pin.x - anchor.x) * scale),
      residual((pin.y - anchor.y) * scale),
    );
  }
  return error;
}

function bestNearbyScale(pins, current) {
  if (pins.length < 2) return { scale: current, error: 0 };
  let best = { scale: current, error: latticeError(pins, current), drift: 0 };
  const min = 0.2;
  const max = 2.0;
  for (let scale = min; scale <= max + 1e-9; scale += 0.0005) {
    const error = latticeError(pins, scale);
    const drift = Math.abs(scale - current) / current;
    const materiallyBetter = error < best.error - 0.005;
    const effectivelyEqual = Math.abs(error - best.error) <= 0.005;
    if (materiallyBetter || (effectivelyEqual && drift < best.drift)) {
      best = { scale, error, drift };
    }
  }
  return best;
}

const breadboardDraft = {
  id: '__audit_breadboard__',
  type: 'breadboard-half',
  left: 0,
  top: 0,
  rotate: 0,
  attrs: {},
};
const breadboardPlacement = snapPartPlacement(breadboardDraft, 0, 0, [], 'normal', 0);
const auditBreadboard = { ...breadboardDraft, ...breadboardPlacement };
const auditBreadboardHoles = getPartPins(auditBreadboard).map((pin) => pin.name);

function rotationAnchorError(type, def, pins) {
  if (!pins.length) return 0;
  let maxError = 0;
  for (const rotate of rotations) {
    const draft = {
      id: '__rotation_audit__',
      type,
      left: 123.37,
      top: 211.19,
      rotate,
      attrs: { ...def.defaults },
    };
    const placement = snapPartPlacement(draft, draft.left, draft.top, [], 'normal', 0);
    const snapped = { ...draft, ...placement };
    const anchorPoint = endpointPoint(`${snapped.id}:${pins[0].name}`, [snapped]);
    if (!anchorPoint) return Number.POSITIVE_INFINITY;
    maxError = Math.max(maxError, residual(anchorPoint.x), residual(anchorPoint.y));
  }
  return maxError;
}

function canSeatOnBreadboard(type, def, pins) {
  if (!def.breadboardMount) return null;
  if (!pins.length) return false;
  for (const rotate of rotations) {
    const draft = {
      id: '__mount_audit__',
      type,
      left: 0,
      top: 0,
      rotate,
      attrs: { ...def.defaults },
    };
    for (const hole of auditBreadboardHoles) {
      try {
        seatPartAtHole(draft, [auditBreadboard, draft], {
          breadboardId: auditBreadboard.id,
          pin: pins[0].name,
          hole,
        });
        return true;
      } catch {
        // Keep searching: some parts only fit particular rows/orientations.
      }
    }
  }
  return false;
}

function connectorPitchScale(pins, current) {
  const spacings = [];
  for (let a = 0; a < pins.length; a++) {
    for (let b = a + 1; b < pins.length; b++) {
      const dx = Math.abs(pins[a].x - pins[b].x);
      const dy = Math.abs(pins[a].y - pins[b].y);
      // A normal 0.1-inch header pitch in the source assets is roughly 9.5-10
      // source units. Only use adjacent, collinear pins so board/header gaps do
      // not distort the calibration.
      if (dy <= 0.75 && dx >= 8.5 && dx <= 10.5) spacings.push(dx);
      if (dx <= 0.75 && dy >= 8.5 && dy <= 10.5) spacings.push(dy);
    }
  }
  if (!spacings.length) return current;
  spacings.sort((a, b) => a - b);
  const median = spacings[Math.floor(spacings.length / 2)];
  return pitch / median;
}

function bankPitchError(pins, scale) {
  const groups = [];
  const tolerance = 0.8;
  for (const axis of ['x', 'y']) {
    const perpendicular = axis === 'x' ? 'y' : 'x';
    const varying = axis;
    const remaining = [...pins];
    while (remaining.length) {
      const seed = remaining.shift();
      const group = [seed];
      for (let i = remaining.length - 1; i >= 0; i--) {
        if (Math.abs(remaining[i][perpendicular] - seed[perpendicular]) <= tolerance) {
          group.push(remaining[i]);
          remaining.splice(i, 1);
        }
      }
      if (group.length >= 2) groups.push({ varying, pins: group });
    }
  }

  let maxError = 0;
  let samples = 0;
  for (const group of groups) {
    const values = group.pins.map((pin) => pin[group.varying]).sort((a, b) => a - b);
    const gaps = values.slice(1).map((value, index) => value - values[index]);
    if (!gaps.length) continue;
    const sorted = [...gaps].sort((a, b) => a - b);
    const typical = sorted[Math.floor(sorted.length / 2)];
    for (const rawGap of gaps) {
      // Large discontinuities usually separate connector banks (Arduino is a
      // classic example). They are physical board geometry, not pin pitch.
      if (gaps.length > 1 && rawGap > typical * 1.45) continue;
      const scaled = rawGap * scale;
      if (scaled > pitch * 4.25) continue;
      const multiple = Math.max(1, Math.round(scaled / pitch));
      maxError = Math.max(maxError, Math.abs(scaled - multiple * pitch));
      samples++;
    }
  }
  return { error: maxError, samples };
}

function bestBankScale(pins, current) {
  let best = { scale: current, ...bankPitchError(pins, current) };
  const min = Math.max(0.5, current * 0.75);
  const max = Math.min(1.5, current * 1.25);
  for (let scale = min; scale <= max + 1e-9; scale += 0.0005) {
    const candidate = bankPitchError(pins, scale);
    if (!candidate.samples) continue;
    if (candidate.error < best.error - 0.001 || (Math.abs(candidate.error - best.error) <= 0.001 && Math.abs(scale - current) < Math.abs(best.scale - current))) {
      best = { scale, ...candidate };
    }
  }
  return best;
}

const rows = [];
for (const type of PART_TYPES) {
  const def = PART_DEFINITIONS[type];
  const pins = getPartPins(type);
  if (!pins.length) {
    rows.push({ type, pins: 0, scale: def.renderScale, xError: 0, yError: 0, status: 'no-pins' });
    continue;
  }
  const anchor = pins[0];
  let xError = 0;
  let yError = 0;
  for (const pin of pins.slice(1)) {
    xError = Math.max(xError, residual((pin.x - anchor.x) * def.renderScale));
    yError = Math.max(yError, residual((pin.y - anchor.y) * def.renderScale));
  }
  const best = bestNearbyScale(pins, def.renderScale);
  const pitchScale = connectorPitchScale(pins, def.renderScale);
  const bank = bankPitchError(pins, def.renderScale);
  const bestBank = bestBankScale(pins, def.renderScale);
  const anchorError = rotationAnchorError(type, def, pins);
  const mountable = canSeatOnBreadboard(type, def, pins);
  rows.push({
    type,
    pins: pins.length,
    scale: Number(def.renderScale.toFixed(5)),
    xError: Number(xError.toFixed(3)),
    yError: Number(yError.toFixed(3)),
    bestScale: Number(best.scale.toFixed(4)),
    bestError: Number(best.error.toFixed(3)),
    pitchScale: Number(pitchScale.toFixed(4)),
    bankError: Number(bank.error.toFixed(3)),
    bestBankScale: Number(bestBank.scale.toFixed(4)),
    bestBankError: Number(bestBank.error.toFixed(3)),
    anchorError: Number(anchorError.toFixed(3)),
    mountable: mountable === null ? '-' : mountable ? 'yes' : 'NO',
    status: bank.error <= 1.25 && anchorError <= 0.02 && mountable !== false ? 'aligned' : 'off-grid',
  });
  if (detailTypes.has(type)) {
    console.log(`\n${type} pins @ scale ${def.renderScale}:`);
    console.table(pins.map((pin) => ({ name: pin.name, x: pin.x, y: pin.y })));
  }
}

console.table(rows);
const bad = rows.filter((row) => row.status === 'off-grid');
console.log(`\n${rows.length - bad.length}/${rows.length} catalog components pass the ${pitch}px connector-grid audit; ${bad.length} need attention.`);
if (bad.length) process.exitCode = 1;
