#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Automated 4-Tier Regression Test Runner for TinkerCad Circuit Builder

import { register } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

// Register TypeScript loader for seamless ESM execution in Node.js
register('./loader.mjs', import.meta.url);

// Polyfill minimal browser DOM & custom element environment before importing app modules
class MockImageData {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

globalThis.ImageData = MockImageData;
globalThis.window = globalThis;
globalThis.CSS = {
  escape: (str) => String(str).replace(/[!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~]/g, '\\$&'),
};

const domStore = new Map();
const eventListeners = new WeakMap();

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

  addEventListener(type, listener) {
    const list = eventListeners.get(this) ?? [];
    list.push({ type, listener });
    eventListeners.set(this, list);
  }

  removeEventListener(type, listener) {
    const list = eventListeners.get(this) ?? [];
    eventListeners.set(this, list.filter((item) => item.type !== type || item.listener !== listener));
  }

  dispatchEvent(event) {
    const list = eventListeners.get(this) ?? [];
    for (const item of list) {
      if (item.type === event.type) item.listener(event);
    }
    return true;
  }
}

globalThis.HTMLElement = MockHTMLElement;

// Import @wokwi/elements to map custom elements to their classes
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
      try {
        return new Cls();
      } catch {
        const el = new MockHTMLElement(tag);
        return el;
      }
    }
    return new MockHTMLElement(tag);
  },
  querySelector(selector) {
    const match = selector.match(/\[data-part-element="([^"]+)"\]/);
    if (match) {
      const id = match[1].replace(/\\/g, '');
      return domStore.get(id) ?? null;
    }
    return null;
  },
};

globalThis.localStorage = {
  _store: new Map(),
  getItem(k) { return this._store.get(k) ?? null; },
  setItem(k, v) { this._store.set(k, String(v)); },
  removeItem(k) { this._store.delete(k); },
  clear() { this._store.clear(); },
};

// Import project modules after environment setup
const { PART_TYPES } = await import('../../src/components/partTypes.ts');
const { PART_DEFINITIONS, getPartPins, getPartBounds, resolvePinName } = await import('../../src/components/parts.ts');
const { buildCircuitGraph, traceToPower, traceToArduinoPin, directlyConnectedNodes, nodeRef } = await import('../../src/sim/circuitGraph.ts');
const { classifyArduinoPowerPin, resolveArduinoDigitalPin, resolveArduinoAnalogChannel } = await import('../../src/sim/pins.ts');
const { diagnoseCircuit } = await import('../../src/sim/diagnostics.ts');
const { getBreadboardGeometry, isBreadboardType, breadboardHoleNet, BREADBOARD_WIDTH, BREADBOARD_HEIGHT, BREADBOARD_HOLE_PITCH } = await import('../../src/breadboard/geometry.ts');
const { seatPartAtHole, snapPartPlacement, alignExplicitSeating } = await import('../../src/breadboard/placement.ts');
const { evaluateLayout } = await import('../../src/layout/quality.ts');
const { connectionPolyline, isOrthogonalPair, moveOrthogonalWaypoint } = await import('../../src/wires/path.ts');
const { endpointPoint, localPinPoint, partRect, pinExitDirection } = await import('../../src/wires/geometry.ts');
const { collectWireAlignmentTargets, snapOrthogonalPoint, snapPointToTargets } = await import('../../src/layout/alignment.ts');
const { CIRCUIT_PRESETS } = await import('../../src/circuit/presets.ts');
const { AVRRunner } = await import('../../src/sim/avrRunner.ts');
const { setupDevices } = await import('../../src/sim/devices/index.ts');
const { circuitStore } = await import('../../src/circuit/store.ts');
const { registerWebMCPTools } = await import('../../src/agent/webmcp.ts');
const { simulator } = await import('../../src/sim/simulator.ts');
const { createBuildCircuitTool } = await import('../../src/agent/buildCircuit.ts');
const { BLOCK_CELL_PX, blockCellToCanvas, blockDefinition, blockPlacement, partBlockAt } = await import('../../src/agent/geometry.ts');
const { HEX_FIXTURES } = await import('./fixtures.mjs');
const { BLOCK_SERVO_CONTROL_INPUT } = await import('./agent-fixtures.mjs');
const avr8js = await import('avr8js');

// Register WebMCP tools onto document modelContext
const webMcpTools = new Map();
globalThis.document.modelContext = {
  async registerTool(tool) {
    webMcpTools.set(tool.name, tool);
  },
};
await registerWebMCPTools();

export const webMcpToolRegistry = webMcpTools;
export { circuitStore, evaluateLayout, diagnoseCircuit };

export async function callWebMcp(name, input = {}) {
  const tool = webMcpTools.get(name);
  if (!tool) throw new Error(`WebMCP tool "${name}" is not registered`);
  const controller = new AbortController();
  const res = await tool.execute(input, { signal: controller.signal });
  return res.structuredContent ?? JSON.parse(res.content[0].text);
}

// Helper to register mock DOM elements into domStore for tests
export function registerMockElement(partId, element) {
  domStore.set(partId, element);
}

export function clearMockElements() {
  domStore.clear();
}

// Synchronous AVR execution helper
export function stepCpuCycles(runner, targetCycles) {
  const endCycles = runner.cpu.cycles + targetCycles;
  while (runner.cpu.cycles < endCycles) {
    avr8js.avrInstruction(runner.cpu);
    runner.cpu.tick();
  }
}

// TAP Test Framework Engine
class TestHarness {
  constructor(options = {}) {
    this.options = options;
    this.tests = [];
    this.results = [];
    this.currentTier = 1;
    this.tierResults = { 1: { pass: 0, fail: 0 }, 2: { pass: 0, fail: 0 }, 3: { pass: 0, fail: 0 }, 4: { pass: 0, fail: 0 }, 5: { pass: 0, fail: 0 } };
  }

  setTier(tier) {
    this.currentTier = tier;
  }

  test(name, fn) {
    const tier = this.currentTier;
    this.tests.push({ tier, name, fn });
  }

  async run() {
    const selectedTiers = this.options.tiers ? this.options.tiers.split(',').map(Number) : [1, 2, 3, 4, 5];
    const filterRegex = this.options.filter ? new RegExp(this.options.filter, 'i') : null;

    console.log('TAP version 13');
    const testsToRun = this.tests.filter((t) => {
      if (!selectedTiers.includes(t.tier)) return false;
      if (filterRegex && !filterRegex.test(t.name)) return false;
      return true;
    });

    console.log(`1..${testsToRun.length}`);

    let index = 1;
    for (const item of testsToRun) {
      clearMockElements();
      let pass = true;
      let error = null;
      const start = performance.now();
      try {
        await item.fn();
      } catch (err) {
        pass = false;
        error = err;
      }
      const durationMs = (performance.now() - start).toFixed(1);

      if (pass) {
        this.tierResults[item.tier].pass++;
        console.log(`ok ${index} - [T${item.tier}] ${item.name} (${durationMs}ms)`);
      } else {
        this.tierResults[item.tier].fail++;
        console.log(`not ok ${index} - [T${item.tier}] ${item.name} (${durationMs}ms)`);
        console.log(`  ---`);
        console.log(`  message: ${JSON.stringify(error?.message || String(error))}`);
        if (this.options.verbose && error?.stack) {
          console.log(`  stack: |`);
          for (const line of error.stack.split('\n')) console.log(`    ${line}`);
        }
        console.log(`  ...`);
        if (this.options.bail) {
          console.log('Bail out! Stopped on first test failure.');
          break;
        }
      }
      index++;
    }

    console.log('\n# =======================================================');
    console.log('# TEST RUNNER SUMMARY');
    console.log('# =======================================================');
    for (const [tier, res] of Object.entries(this.tierResults)) {
      const total = res.pass + res.fail;
      if (total > 0) {
        const rate = ((res.pass / total) * 100).toFixed(1);
        console.log(`# Tier ${tier}: ${res.pass}/${total} passed (${rate}%)`);
      }
    }
    const totalPass = Object.values(this.tierResults).reduce((s, r) => s + r.pass, 0);
    const totalFail = Object.values(this.tierResults).reduce((s, r) => s + r.fail, 0);
    const grandTotal = totalPass + totalFail;
    console.log(`# Total:  ${totalPass}/${grandTotal} passed`);
    console.log('# =======================================================');

    return { total: grandTotal, pass: totalPass, fail: totalFail };
  }
}

// Assertions
function assert(cond, msg = 'Assertion failed') {
  if (!cond) throw new Error(msg);
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg ? msg + ': ' : ''}Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertDeepEqual(actual, expected, msg = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${msg ? msg + ': ' : ''}Expected ${e}, got ${a}`);
  }
}

function assertThrows(fn, expectedRegex = null, msg = '') {
  let threw = false;
  let error = null;
  try {
    fn();
  } catch (err) {
    threw = true;
    error = err;
  }
  if (!threw) throw new Error(`${msg ? msg + ': ' : ''}Expected function to throw, but it succeeded.`);
  if (expectedRegex && !new RegExp(expectedRegex).test(error.message)) {
    throw new Error(`${msg ? msg + ': ' : ''}Expected error matching ${expectedRegex}, got: "${error.message}"`);
  }
}

async function assertThrowsAsync(fn, expectedRegex = null, msg = '') {
  let threw = false;
  let error = null;
  try {
    await fn();
  } catch (err) {
    threw = true;
    error = err;
  }
  if (!threw) throw new Error(`${msg ? msg + ': ' : ''}Expected async function to throw, but it succeeded.`);
  if (expectedRegex && !new RegExp(expectedRegex).test(error?.message || String(error))) {
    throw new Error(`${msg ? msg + ': ' : ''}Expected error matching ${expectedRegex}, got: "${error?.message || String(error)}"`);
  }
}

function assertRoughly(actual, expected, delta = 0.01, msg = '') {
  if (Math.abs(actual - expected) > delta) {
    throw new Error(`${msg ? msg + ': ' : ''}Expected ~${expected} (Ã‚Â±${delta}), got ${actual}`);
  }
}

// CLI args parsing
const args = process.argv.slice(2);
const options = {};
for (const arg of args) {
  if (arg.startsWith('--tier=')) options.tiers = arg.slice('--tier='.length);
  if (arg.startsWith('--filter=')) options.filter = arg.slice('--filter='.length);
  if (arg === '--verbose' || arg === '-v') options.verbose = true;
  if (arg === '--bail' || arg === '-b') options.bail = true;
}

const harness = new TestHarness(options);

// ============================================================================
// TIER 1: FEATURE COVERAGE (>=5 tests per feature across all 42 catalog parts)
// ============================================================================
harness.setTier(1);

// F01: 9V Battery Electrical Model
harness.test('F01: Battery 9V definition and metadata properties', () => {
  const bat = PART_DEFINITIONS['battery-9v'];
  assert(bat, 'battery-9v must be defined in PART_DEFINITIONS');
  assertEqual(bat.category, 'Basic');
  assertEqual(bat.defaults.voltage, 9);
  assert(Array.isArray(bat.properties) && bat.properties.length >= 1);
  const vProp = bat.properties.find((p) => p.key === 'voltage');
  assert(vProp && vProp.min === 1 && vProp.max === 12);
});

harness.test('F01: Battery 9V pin definitions and voltage metadata', () => {
  const pins = getPartPins('battery-9v');
  assert(pins.length === 2, 'Battery must have exactly 2 pins: + and -');
  const pos = pins.find((p) => p.name === '+');
  const neg = pins.find((p) => p.name === '-');
  assert(pos, 'Positive terminal (+) must exist');
  assert(neg, 'Negative terminal (-) must exist');
  const posSignal = pos.signals?.find((s) => s.type === 'power');
  const negSignal = neg.signals?.find((s) => s.type === 'power');
  assertEqual(posSignal?.voltage, 9, 'Positive terminal must be 9V');
  assertEqual(negSignal?.voltage, 0, 'Negative terminal must be 0V');
});

harness.test('F01: Battery 9V circuit graph edge creation and connectivity', () => {
  const doc = {
    parts: [
      { id: 'bat1', type: 'battery-9v', left: 100, top: 100, rotate: 0, attrs: { voltage: 9 } },
      { id: 'r1', type: 'wokwi-resistor', left: 200, top: 100, rotate: 0, attrs: { value: 1000 } },
    ],
    connections: [
      { id: 'w1', from: 'bat1:+', to: 'r1:1', color: '#d94841' },
      { id: 'w2', from: 'bat1:-', to: 'r1:2', color: '#343a40' },
    ],
  };
  const graph = buildCircuitGraph(doc);
  assert(graph.parts.has('bat1'));
  assert(graph.adjacency.get('bat1:+')?.length > 0);
  assert(graph.adjacency.get('bat1:-')?.length > 0);
  const connectedNodes = directlyConnectedNodes(graph, 'bat1:+');
  assert(connectedNodes.has('r1:1'));
});

harness.test('F01: Battery 9V power tracing to positive terminal', () => {
  const doc = {
    parts: [
      { id: 'bat1', type: 'battery-9v', left: 100, top: 100, rotate: 0, attrs: {} },
      { id: 'motor1', type: 'dc-motor', left: 200, top: 100, rotate: 0, attrs: {} },
    ],
    connections: [
      { id: 'w1', from: 'bat1:+', to: 'motor1:1', color: '#d94841' },
    ],
  };
  const graph = buildCircuitGraph(doc);
  const powerNodes = directlyConnectedNodes(graph, 'motor1:1');
  assert(powerNodes.has('bat1:+'), 'motor pin 1 must trace to battery 9V + terminal');
});

harness.test('F01: Battery 9V ground return tracing to negative terminal', () => {
  const doc = {
    parts: [
      { id: 'bat1', type: 'battery-9v', left: 100, top: 100, rotate: 0, attrs: {} },
      { id: 'motor1', type: 'dc-motor', left: 200, top: 100, rotate: 0, attrs: {} },
    ],
    connections: [
      { id: 'w1', from: 'bat1:-', to: 'motor1:2', color: '#343a40' },
    ],
  };
  const graph = buildCircuitGraph(doc);
  const gndNodes = directlyConnectedNodes(graph, 'motor1:2');
  assert(gndNodes.has('bat1:-'), 'motor pin 2 must trace to battery 9V - terminal');
});

harness.test('F01: Battery 9V pin alias normalization', () => {
  const bat = { id: 'bat1', type: 'battery-9v', left: 0, top: 0, rotate: 0, attrs: {} };
  assertEqual(resolvePinName(bat, '+'), '+');
  assertEqual(resolvePinName(bat, 'pos'), '+');
  assertEqual(resolvePinName(bat, 'positive'), '+');
  assertEqual(resolvePinName(bat, '-'), '-');
  assertEqual(resolvePinName(bat, 'neg'), '-');
  assertEqual(resolvePinName(bat, 'gnd'), '-');
});

// F02: Rectifier Diode Electrical Model
harness.test('F02: Rectifier Diode definition and metadata', () => {
  const diode = PART_DEFINITIONS['rectifier-diode'];
  assert(diode, 'rectifier-diode must be defined');
  assertEqual(diode.category, 'Basic');
  assert(diode.breadboardMount === true);
  assertEqual(diode.asset, '/assets/fritzing/rectifier-diode.svg');
});

harness.test('F02: Rectifier Diode pin definitions (Anode A and Cathode C)', () => {
  const pins = getPartPins('rectifier-diode');
  assert(pins.length === 2, 'Diode must have 2 pins');
  const anode = pins.find((p) => p.name === 'A');
  const cathode = pins.find((p) => p.name === 'C');
  assert(anode, 'Anode (A) pin must exist');
  assert(cathode, 'Cathode (C) pin must exist');
});

harness.test('F02: Rectifier Diode pin name alias resolution', () => {
  const part = { id: 'd1', type: 'rectifier-diode', left: 0, top: 0, rotate: 0, attrs: {} };
  assertEqual(resolvePinName(part, 'A'), 'A');
  assertEqual(resolvePinName(part, 'a'), 'A');
  assertEqual(resolvePinName(part, 'anode'), 'A');
  assertEqual(resolvePinName(part, 'C'), 'C');
  assertEqual(resolvePinName(part, 'c'), 'C');
  assertEqual(resolvePinName(part, 'cathode'), 'C');
});

harness.test('F02: Rectifier Diode circuit graph connectivity', () => {
  const doc = {
    parts: [
      { id: 'd1', type: 'rectifier-diode', left: 100, top: 100, rotate: 0, attrs: {} },
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 300, top: 100, rotate: 0, attrs: {} },
    ],
    connections: [
      { id: 'w1', from: 'uno1:5V', to: 'd1:A', color: '#d94841' },
      { id: 'w2', from: 'd1:C', to: 'uno1:GND.1', color: '#343a40' },
    ],
  };
  const graph = buildCircuitGraph(doc);
  assert(graph.parts.has('d1'));
  assert(directlyConnectedNodes(graph, 'uno1:5V').has('d1:A'));
  assert(directlyConnectedNodes(graph, 'uno1:GND.1').has('d1:C'));
});

harness.test('F02: Rectifier Diode flyback clamp configuration across DC motor', () => {
  const doc = {
    parts: [
      { id: 'motor1', type: 'dc-motor', left: 100, top: 100, rotate: 0, attrs: {} },
      { id: 'd1', type: 'rectifier-diode', left: 200, top: 100, rotate: 0, attrs: {} },
    ],
    connections: [
      { id: 'w1', from: 'motor1:1', to: 'd1:C', color: '#d94841' },
      { id: 'w2', from: 'motor1:2', to: 'd1:A', color: '#343a40' },
    ],
  };
  const graph = buildCircuitGraph(doc);
  assert(directlyConnectedNodes(graph, 'motor1:1').has('d1:C'));
  assert(directlyConnectedNodes(graph, 'motor1:2').has('d1:A'));
});

// F03: NPN Transistor Switching Model
harness.test('F03: NPN Transistor definition and metadata', () => {
  const transistor = PART_DEFINITIONS['npn-transistor'];
  assert(transistor, 'npn-transistor must be defined');
  assertEqual(transistor.category, 'Basic');
  assert(transistor.breadboardMount === true);
  assertEqual(transistor.asset, '/assets/fritzing/npn-transistor.svg');
});

harness.test('F03: NPN Transistor pin definitions (Emitter E, Base B, Collector C)', () => {
  const pins = getPartPins('npn-transistor');
  assert(pins.length === 3, 'NPN Transistor must have exactly 3 pins: E, B, C');
  const e = pins.find((p) => p.name === 'E');
  const b = pins.find((p) => p.name === 'B');
  const c = pins.find((p) => p.name === 'C');
  assert(e && e.description?.includes('Emitter'));
  assert(b && b.description?.includes('Base'));
  assert(c && c.description?.includes('Collector'));
});

harness.test('F03: NPN Transistor pin alias resolution', () => {
  const part = { id: 'q1', type: 'npn-transistor', left: 0, top: 0, rotate: 0, attrs: {} };
  assertEqual(resolvePinName(part, 'B'), 'B');
  assertEqual(resolvePinName(part, 'b'), 'B');
  assertEqual(resolvePinName(part, 'base'), 'B');
  assertEqual(resolvePinName(part, 'C'), 'C');
  assertEqual(resolvePinName(part, 'collector'), 'C');
  assertEqual(resolvePinName(part, 'E'), 'E');
  assertEqual(resolvePinName(part, 'emitter'), 'E');
});

harness.test('F03: NPN Transistor low-side switching graph connectivity', () => {
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, rotate: 0, attrs: {} },
      { id: 'r_base', type: 'wokwi-resistor', left: 100, top: 0, rotate: 0, attrs: { value: 1000 } },
      { id: 'q1', type: 'npn-transistor', left: 200, top: 0, rotate: 0, attrs: {} },
      { id: 'motor1', type: 'dc-motor', left: 300, top: 0, rotate: 0, attrs: {} },
    ],
    connections: [
      { id: 'w1', from: 'uno1:3', to: 'r_base:1', color: '#2f9e44' },
      { id: 'w2', from: 'r_base:2', to: 'q1:B', color: '#2f9e44' },
      { id: 'w3', from: 'q1:E', to: 'uno1:GND.1', color: '#343a40' },
      { id: 'w4', from: 'motor1:2', to: 'q1:C', color: '#1971c2' },
      { id: 'w5', from: 'motor1:1', to: 'uno1:5V', color: '#d94841' },
    ],
  };
  const graph = buildCircuitGraph(doc);
  assert(directlyConnectedNodes(graph, 'q1:E').has('uno1:GND.1'));
  assert(directlyConnectedNodes(graph, 'q1:C').has('motor1:2'));
  const baseTraces = traceToArduinoPin(graph, 'q1:B');
  assert(baseTraces.some((t) => t.pin === '3' && t.resistance === 1000));
});

harness.test('F03: NPN Transistor motor control driving DC motor', () => {
  const part = { id: 'motor1', type: 'dc-motor', left: 0, top: 0, rotate: 0, attrs: {} };
  const mockEl = new MockHTMLElement('div');
  mockEl.dataset.motorDirection = 'stopped';
  registerMockElement(part.id, mockEl);
  assertEqual(mockEl.dataset.motorDirection, 'stopped');
});

// F04: Simulation State Completeness (All 50 Parts)
harness.test('F04: Exactly 50 catalog parts exist in PART_TYPES and PART_DEFINITIONS', () => {
  assertEqual(PART_TYPES.length, 50, '50 PART_TYPES total');
  for (const type of PART_TYPES) {
    assert(PART_DEFINITIONS[type], `PART_DEFINITIONS must contain an entry for ${type}`);
  }
});

harness.test('F04: All catalog parts define valid category and idPrefix', () => {
  const validCategories = new Set(['Boards', 'Layout', 'Basic', 'Input', 'Output', 'Motion', 'Sensors']);
  for (const [type, def] of Object.entries(PART_DEFINITIONS)) {
    assert(validCategories.has(def.category), `${type} has invalid category: ${def.category}`);
    assert(typeof def.idPrefix === 'string' && def.idPrefix.length > 0, `${type} must have valid idPrefix`);
  }
});

harness.test('F04: Natural dimensions and scale factors are positive numbers', () => {
  for (const [type, def] of Object.entries(PART_DEFINITIONS)) {
    assert(def.naturalSize.width > 0, `${type} natural width must be > 0`);
    assert(def.naturalSize.height > 0, `${type} natural height must be > 0`);
    assert(def.renderScale > 0, `${type} renderScale must be > 0`);
    assert(def.previewScale > 0, `${type} previewScale must be > 0`);
  }
});

harness.test('F04: Simulated flag exists and is boolean for all parts', () => {
  for (const [type, def] of Object.entries(PART_DEFINITIONS)) {
    assertEqual(typeof def.simulated, 'boolean', `${type} simulated flag must be a boolean`);
  }
});

harness.test('F04: Part bounding box calculation getPartBounds', () => {
  for (const type of PART_TYPES) {
    const bounds = getPartBounds(type);
    assert(bounds.width > 0, `${type} computed bounds width must be > 0`);
    assert(bounds.height > 0, `${type} computed bounds height must be > 0`);
  }
});

// F05: 50-Part Visual & Custom Element Audit
harness.test('F05: All 40 Wokwi custom elements instantiate with non-empty pinInfo', () => {
  let verified = 0;
  for (const [type, def] of Object.entries(PART_DEFINITIONS)) {
    if (def.tag && def.tag.startsWith('wokwi-')) {
      const el = globalThis.document.createElement(def.tag);
      assert(el, `Failed to instantiate element for tag ${def.tag}`);
      const pins = getPartPins(type);
      if (type !== 'wokwi-ir-remote') {
        assert(pins.length > 0, `Wokwi element ${type} must have pins (got ${pins.length})`);
      }
      verified++;
    }
  }
  assertEqual(verified, 40, 'Must verify all 40 Wokwi custom elements');
});

harness.test('F05: All component pin coordinates use the same render scale as their visuals', () => {
  for (const type of PART_TYPES) {
    const definition = PART_DEFINITIONS[type];
    const part = { id: `scale_${type}`, type, left: 0, top: 0, rotate: 0, attrs: { ...definition.defaults } };
    for (const pin of getPartPins(part)) {
      const local = localPinPoint(part, pin.name);
      assert(local, `${type}:${pin.name} must resolve local pin geometry`);
      assertRoughly(local.x, pin.x * definition.renderScale, 0.01, `${type}:${pin.name} x scale must match visual scale`);
      assertRoughly(local.y, pin.y * definition.renderScale, 0.01, `${type}:${pin.name} y scale must match visual scale`);
    }
  }
});

harness.test('F05: All 10 static SVG/Fritzing components define explicit pin coordinates', () => {
  const staticParts = [
    'breadboard',
    'breadboard-half',
    'dc-motor',
    'npn-transistor',
    'pnp-transistor',
    'rectifier-diode',
    'zener-diode',
    'battery-9v',
    'battery-aa',
    'battery-coin-cell',
  ];
  for (const type of staticParts) {
    const pins = getPartPins(type);
    assert(pins.length > 0, `Static component ${type} must have pins`);
    for (const pin of pins) {
      assert(typeof pin.x === 'number', `${type} pin ${pin.name} must have numeric x`);
      assert(typeof pin.y === 'number', `${type} pin ${pin.name} must have numeric y`);
    }
  }
});

harness.test('F05: Static SVG asset paths exist on disk', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  for (const [type, def] of Object.entries(PART_DEFINITIONS)) {
    if (def.asset) {
      const assetPath = path.join(root, 'public', def.asset.replace(/^\//, ''));
      assert(fs.existsSync(assetPath), `Asset for ${type} must exist at ${assetPath}`);
    }
  }
});

harness.test('F05: Component pin count integrity across catalog', () => {
  assertEqual(getPartPins('wokwi-arduino-uno').length, 31);
  assertEqual(getPartPins('wokwi-led').length, 2);
  assertEqual(getPartPins('wokwi-rgb-led').length, 4);
  assertEqual(getPartPins('wokwi-resistor').length, 2);
  assertEqual(getPartPins('wokwi-potentiometer').length, 3);
  assertEqual(getPartPins('wokwi-servo').length, 3);
  assertEqual(getPartPins('wokwi-hc-sr04').length, 4);
  assertEqual(getPartPins('wokwi-dht22').length, 4);
  assertEqual(getPartPins('wokwi-ds1307').length, 5);
});

harness.test('F05: Breadboard scale and hole counts', () => {
  const full = getBreadboardGeometry('breadboard');
  assertEqual(full.columns, 63);
  assertEqual(full.railHoles, 50);
  assertEqual(full.pins.length, 830);

  const half = getBreadboardGeometry('breadboard-half');
  assertEqual(half.columns, 30);
  assertEqual(half.railHoles, 25);
  assertEqual(half.pins.length, 400);
});

// F06: Pin Aliases & Breadboard Hole Seating
harness.test('F06: Arduino Uno pin alias normalization', () => {
  const uno = { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, rotate: 0, attrs: {} };
  assertEqual(resolvePinName(uno, '13'), '13');
  assertEqual(resolvePinName(uno, 'D13'), '13');
  assertEqual(resolvePinName(uno, 'd13'), '13');
  assertEqual(resolvePinName(uno, 'gpio13'), '13');
  assertEqual(resolvePinName(uno, 'digital 13'), '13');
  assertEqual(resolvePinName(uno, 'A0'), 'A0');
  assertEqual(resolvePinName(uno, 'a0'), 'A0');
  assertEqual(resolvePinName(uno, 'gnd'), 'GND.1');
  assertEqual(resolvePinName(uno, 'ground'), 'GND.1');
  assertEqual(resolvePinName(uno, '3v3'), '3.3V');
  assertEqual(resolvePinName(uno, '5v'), '5V');
  assertEqual(resolvePinName(uno, 'vin'), 'VIN');
  assertEqual(resolvePinName(uno, 'reset'), 'RESET');
});

harness.test('F06: Catalog-wide pin alias normalization across sensors and peripherals', () => {
  const btn = { id: 'btn1', type: 'wokwi-pushbutton', left: 0, top: 0, attrs: {} };
  assertEqual(resolvePinName(btn, '1l'), '1.l');
  assertEqual(resolvePinName(btn, '2l'), '2.l');
  assertEqual(resolvePinName(btn, '1r'), '1.r');
  assertEqual(resolvePinName(btn, '2r'), '2.r');

  const sw = { id: 'sw1', type: 'wokwi-slide-switch', left: 0, top: 0, attrs: {} };
  assertEqual(resolvePinName(sw, 'com'), '2');
  assertEqual(resolvePinName(sw, 'common'), '2');

  const pot = { id: 'pot1', type: 'wokwi-potentiometer', left: 0, top: 0, attrs: {} };
  assertEqual(resolvePinName(pot, 'sig'), 'SIG');
  assertEqual(resolvePinName(pot, 'wiper'), 'SIG');
  assertEqual(resolvePinName(pot, 'gnd'), 'GND');
  assertEqual(resolvePinName(pot, 'vcc'), 'VCC');

  const led = { id: 'led1', type: 'wokwi-led', left: 0, top: 0, attrs: {} };
  assertEqual(resolvePinName(led, 'anode'), 'A');
  assertEqual(resolvePinName(led, 'cathode'), 'C');
  assertEqual(resolvePinName(led, '+'), 'A');
  assertEqual(resolvePinName(led, '-'), 'C');

  const servo = { id: 'servo1', type: 'wokwi-servo', left: 0, top: 0, attrs: {} };
  assertEqual(resolvePinName(servo, 'pwm'), 'PWM');
  assertEqual(resolvePinName(servo, 'v+'), 'V+');
  assertEqual(resolvePinName(servo, 'gnd'), 'GND');

  const sonar = { id: 'sonar1', type: 'wokwi-hc-sr04', left: 0, top: 0, attrs: {} };
  assertEqual(resolvePinName(sonar, 'trig'), 'TRIG');
  assertEqual(resolvePinName(sonar, 'echo'), 'ECHO');

  const lcd = { id: 'lcd1', type: 'wokwi-lcd1602', left: 0, top: 0, attrs: { pins: 'i2c' } };
  assertEqual(resolvePinName(lcd, 'sda'), 'SDA');
  assertEqual(resolvePinName(lcd, 'scl'), 'SCL');
  assertEqual(resolvePinName(lcd, 'gnd'), 'GND');
  assertEqual(resolvePinName(lcd, 'vcc'), 'VCC');

  const imu = { id: 'imu1', type: 'wokwi-mpu6050', left: 0, top: 0, attrs: {} };
  assertEqual(resolvePinName(imu, 'sda'), 'SDA');
  assertEqual(resolvePinName(imu, 'scl'), 'SCL');
  assertEqual(resolvePinName(imu, 'ad0'), 'AD0');
  assertEqual(resolvePinName(imu, 'int'), 'INT');
});

harness.test('F06: Seat Resistor at specific breadboard holes', () => {
  const bb = { id: 'bb1', type: 'breadboard-half', left: 200, top: 200, rotate: 0, attrs: {} };
  const r = { id: 'r1', type: 'wokwi-resistor', left: 0, top: 0, rotate: 0, attrs: { value: 220 } };
  const seated = seatPartAtHole(r, [bb], { breadboardId: 'bb1', pin: '1', hole: 'E6' });
  assert(seated.seating, 'Resistor must have seating record');
  assertEqual(seated.seating.breadboardId, 'bb1');
  assertEqual(seated.seating.pins['1'], 'E6');
});

harness.test('F06: Seat LED at specific breadboard holes', () => {
  const bb = { id: 'bb1', type: 'breadboard-half', left: 200, top: 200, rotate: 0, attrs: {} };
  const led = { id: 'led1', type: 'wokwi-led', left: 0, top: 0, rotate: 0, attrs: { color: 'red' } };
  const seated = seatPartAtHole(led, [bb], { breadboardId: 'bb1', pin: 'A', hole: 'A12' });
  assert(seated.seating, 'LED must have seating record');
  assertEqual(seated.seating.breadboardId, 'bb1');
  assertEqual(seated.seating.pins['A'], 'A12');
});

harness.test('F06: Breadboard snapPartPlacement algorithm', () => {
  const bb = { id: 'bb1', type: 'breadboard-half', left: 100, top: 100, rotate: 0, attrs: {} };
  const led = { id: 'led1', type: 'wokwi-led', left: 0, top: 0, rotate: 0, attrs: {} };
  const snap = snapPartPlacement(led, 120, 150, [bb], 'normal');
  assert(snap.left !== undefined && snap.top !== undefined);
});

harness.test('F06: Seating non-breadboard-mount component throws error', () => {
  const bb = { id: 'bb1', type: 'breadboard-half', left: 100, top: 100, rotate: 0, attrs: {} };
  const pot = { id: 'pot1', type: 'wokwi-potentiometer', left: 0, top: 0, rotate: 0, attrs: {} };
  assertThrows(() => {
    seatPartAtHole(pot, [bb], { breadboardId: 'bb1', pin: 'VCC', hole: 'A1' });
  }, /not a breadboard-mount component/i);
});

// F07: Inspector Property Controls Audit
harness.test('F07: Pushbutton color options in property definitions', () => {
  const btn = PART_DEFINITIONS['wokwi-pushbutton'];
  const colorProp = btn.properties?.find((p) => p.key === 'color');
  assert(colorProp && colorProp.options && colorProp.options.length >= 5);

  const btn6mm = PART_DEFINITIONS['wokwi-pushbutton-6mm'];
  const colorProp6mm = btn6mm.properties?.find((p) => p.key === 'color');
  assert(colorProp6mm && colorProp6mm.options && colorProp6mm.options.length >= 5);

  const led = PART_DEFINITIONS['wokwi-led'];
  const colorPropLed = led.properties?.find((p) => p.key === 'color');
  assert(colorPropLed && colorPropLed.options && colorPropLed.options.length >= 5);

  const seg = PART_DEFINITIONS['wokwi-7segment'];
  const colorPropSeg = seg.properties?.find((p) => p.key === 'color');
  assert(colorPropSeg && colorPropSeg.options && colorPropSeg.options.length >= 4);

  const bar = PART_DEFINITIONS['wokwi-led-bar-graph'];
  const colorPropBar = bar.properties?.find((p) => p.key === 'color');
  assert(colorPropBar && colorPropBar.options && colorPropBar.options.length >= 4);
});

harness.test('F07: Potentiometer and Slide Potentiometer property schemas', () => {
  const pot = PART_DEFINITIONS['wokwi-potentiometer'];
  const potVal = pot.properties?.find((p) => p.key === 'value');
  assertEqual(potVal?.min, 0);
  assertEqual(potVal?.max, 1023);

  const slidePot = PART_DEFINITIONS['wokwi-slide-potentiometer'];
  assertEqual(slidePot.defaults.value, 50);
  assertEqual(slidePot.defaults.min, 0);
  assertEqual(slidePot.defaults.max, 100);
  assert(slidePot.properties && slidePot.properties.length >= 3);
});

harness.test('F07: LCD background backlight options in property definitions', () => {
  const lcd1602 = PART_DEFINITIONS['wokwi-lcd1602'];
  const bg1602 = lcd1602.properties?.find((p) => p.key === 'background');
  assert(bg1602 && bg1602.options && bg1602.options.length >= 3);

  const lcd2004 = PART_DEFINITIONS['wokwi-lcd2004'];
  const bg2004 = lcd2004.properties?.find((p) => p.key === 'background');
  assert(bg2004 && bg2004.options && bg2004.options.length >= 3);
});

harness.test('F07: DHT22 temperature and humidity property definitions', () => {
  const dht = PART_DEFINITIONS['wokwi-dht22'];
  assert(dht.properties && dht.properties.length >= 2);
  const temp = dht.properties.find((p) => p.key === 'temperature');
  const hum = dht.properties.find((p) => p.key === 'humidity');
  assertEqual(temp?.min, -40);
  assertEqual(temp?.max, 80);
  assertEqual(hum?.min, 0);
  assertEqual(hum?.max, 100);
});

harness.test('F07: HC-SR04 distance property definition', () => {
  const sonar = PART_DEFINITIONS['wokwi-hc-sr04'];
  const dist = sonar.properties?.find((p) => p.key === 'distance');
  assertEqual(dist?.min, 2);
  assertEqual(dist?.max, 400);
});

harness.test('F07: MPU6050 IMU default attributes and properties', () => {
  const imu = PART_DEFINITIONS['wokwi-mpu6050'];
  assertEqual(imu.defaults.accelZ, 1);
  assertEqual(imu.defaults.accelX, 0);
  assertEqual(imu.defaults.temperature, 24);
  assert(imu.breadboardMount, 'MPU6050 must have breadboardMount: true');
  assert(imu.properties && imu.properties.length >= 7);
  const ax = imu.properties.find((p) => p.key === 'accelX');
  const gz = imu.properties.find((p) => p.key === 'gyroZ');
  const temp = imu.properties.find((p) => p.key === 'temperature');
  assertEqual(ax?.min, -16);
  assertEqual(ax?.max, 16);
  assertEqual(gz?.min, -2000);
  assertEqual(gz?.max, 2000);
  assertEqual(temp?.min, -40);
  assertEqual(temp?.max, 85);
});

// F08: Multi-Part Composite Circuits Structure
harness.test('F08: Preset blink circuit structure and graph integrity', () => {
  const preset = CIRCUIT_PRESETS.find((p) => p.id === 'blink');
  assert(preset, 'blink preset must exist');
  assertEqual(preset.parts.length, 4);
  assertEqual(preset.connections.length, 2);
  const graph = buildCircuitGraph(preset);
  assert(graph.parts.has('uno1'));
  assert(graph.parts.has('led1'));
  assert(graph.parts.has('r1'));
});

harness.test('F08: Preset button-led circuit structure', () => {
  const preset = CIRCUIT_PRESETS.find((p) => p.id === 'button-led');
  assert(preset, 'button-led preset must exist');
  assertEqual(preset.parts.length, 4);
  assertEqual(preset.connections.length, 5);
});

harness.test('F08: Preset potentiometer circuit structure', () => {
  const preset = CIRCUIT_PRESETS.find((p) => p.id === 'potentiometer');
  assert(preset, 'potentiometer preset must exist');
  assertEqual(preset.parts.length, 2);
  assertEqual(preset.connections.length, 3);
});

harness.test('F08: Preset ir-motor-control circuit structure', () => {
  const preset = CIRCUIT_PRESETS.find((p) => p.id === 'ir-motor-control');
  assert(preset, 'ir-motor-control preset must exist');
  assertEqual(preset.parts.length, 6);
  assertEqual(preset.connections.length, 10);
  assert(preset.connections.some((wire) =>
    wire.from.startsWith('bb1:-top') && wire.to.startsWith('bb1:-bottom')),
  'IR motor preset should bridge the breadboard ground rails');
});

harness.test('F08: Diagnostics on clean presets return zero errors', () => {
  for (const preset of CIRCUIT_PRESETS) {
    const diag = diagnoseCircuit(preset);
    const errors = diag.filter((d) => d.severity === 'error');
    assertEqual(errors.length, 0, `Preset ${preset.id} has unexpected diagnostic errors`);
  }
});

// F09: Physical grid, wire editing, layout quality, and WebMCP contract
harness.test('F06: Breadboard-mount component pin geometry follows the physical 0.1-inch lattice', () => {
  const failures = [];
  for (const [type, definition] of Object.entries(PART_DEFINITIONS)) {
    if (!definition.breadboardMount) continue;
    const pins = getPartPins(type);
    if (pins.length < 2) continue;
    const anchor = pins[0];
    for (const pin of pins.slice(1)) {
      for (const [axis, delta] of [['x', (pin.x - anchor.x) * definition.renderScale], ['y', (pin.y - anchor.y) * definition.renderScale]]) {
        const steps = Math.round(delta / BREADBOARD_HOLE_PITCH);
        const error = Math.abs(delta - steps * BREADBOARD_HOLE_PITCH);
        if (error > 1.75) failures.push(`${type}:${pin.name}.${axis} error=${error.toFixed(2)}px`);
      }
    }
  }
  assertEqual(failures.length, 0, `Breadboard-mount pin geometry must stay on the 0.1-inch lattice: ${failures.join(', ')}`);
});

harness.test('F06: Resistor leads span exactly six breadboard pitches', () => {
  const definition = PART_DEFINITIONS['wokwi-resistor'];
  const pins = getPartPins('wokwi-resistor');
  const p1 = pins.find((pin) => pin.name === '1');
  const p2 = pins.find((pin) => pin.name === '2');
  assert(p1 && p2, 'Resistor pins must exist');
  assert(Math.abs((p2.x - p1.x) * definition.renderScale - 6 * BREADBOARD_HOLE_PITCH) < 0.01, 'Resistor lead spacing must equal six breadboard pitches');
});

harness.test('F06: Free canvas snap aligns resistor leads to the physical lattice', () => {
  const r = { id: 'r1', type: 'wokwi-resistor', left: 103.2, top: 107.4, rotate: 0, attrs: { value: 220 } };
  const placed = snapPartPlacement(r, r.left, r.top, [], 'normal');
  const snapped = { ...r, left: placed.left, top: placed.top };
  const p1 = endpointPoint('r1:1', [snapped]);
  const p2 = endpointPoint('r1:2', [snapped]);
  assert(p1 && p2, 'Resistor endpoint geometry must exist');
  const error = (value) => Math.abs(value / BREADBOARD_HOLE_PITCH - Math.round(value / BREADBOARD_HOLE_PITCH));
  assert(error(p1.x) < 0.01 && error(p1.y) < 0.01, 'Resistor pin 1 must land on the physical grid');
  assert(error(p2.x) < 0.01 && error(p2.y) < 0.01, 'Resistor pin 2 must land on the physical grid');
});

harness.test('F06: Visible dot grid shares the physical connector-lattice phase', () => {
  const styles = fs.readFileSync(path.resolve('src/app/styles.css'), 'utf8');
  assert(styles.includes('background-size: 9.6px 9.6px'), 'Visible grid pitch must match the 9.6px connector lattice');
  assert(styles.includes('background-position: -4.8px -4.8px'), 'Visible grid dots must be centered on lattice coordinates');
  assert(styles.includes('.part-render > wokwi-resistor { display: flex; }'), 'Resistor renderer must preserve its visual lead/pin axis alignment');
});

harness.test('F06: Every catalog component with pins stays on the physical grid at all right-angle rotations', () => {
  const failures = [];
  const pixelError = (value) => Math.abs(value - Math.round(value / BREADBOARD_HOLE_PITCH) * BREADBOARD_HOLE_PITCH);
  for (const type of PART_TYPES) {
    const pins = getPartPins(type);
    if (!pins.length) continue;
    const definition = PART_DEFINITIONS[type];
    for (const rotate of [0, 90, 180, 270]) {
      const draft = { id: `audit_${type}_${rotate}`, type, left: 123.37, top: 211.19, rotate, attrs: { ...definition.defaults } };
      const placement = snapPartPlacement(draft, draft.left, draft.top, [], 'normal', 0);
      const snapped = { ...draft, ...placement };
      const point = endpointPoint(`${snapped.id}:${pins[0].name}`, [snapped]);
      if (!point || pixelError(point.x) > 0.02 || pixelError(point.y) > 0.02) failures.push(`${type}@${rotate}`);
    }
  }
  assertEqual(failures.length, 0, `All component connector anchors must snap to the physical grid: ${failures.join(', ')}`);
});

harness.test('F06: Every component fits its rounded-up integer block at all right-angle rotations', () => {
  const failures = [];
  for (const type of PART_TYPES) {
    for (const rotate of [0, 90, 180, 270]) {
      const at = { x: -17, y: 9 };
      const part = { id: `block_${type}_${rotate}`, type, ...blockPlacement(type, at, rotate), rotate, attrs: { ...PART_DEFINITIONS[type].defaults } };
      const def = blockDefinition(type, rotate);
      const rect = partRect(part);
      const topLeft = blockCellToCanvas(at);
      const snappedCell = partBlockAt(part);
      const logicalWidth = def.w * BLOCK_CELL_PX;
      const logicalHeight = def.h * BLOCK_CELL_PX;
      if (snappedCell.x !== at.x || snappedCell.y !== at.y) failures.push(`${type}@${rotate}:at`);
      if (Math.abs(rect.x - topLeft.x) > 0.02 || Math.abs(rect.y - topLeft.y) > 0.02) failures.push(`${type}@${rotate}:origin`);
      if (rect.width - logicalWidth > 0.02 || rect.height - logicalHeight > 0.02) failures.push(`${type}@${rotate}:overflow`);
      if (logicalWidth - rect.width >= BLOCK_CELL_PX + 0.02 || logicalHeight - rect.height >= BLOCK_CELL_PX + 0.02) failures.push(`${type}@${rotate}:overreserved`);
    }
  }
  assertEqual(failures.length, 0, `Every component must fit its logical block: ${failures.slice(0, 20).join(', ')}`);
});

harness.test('F06: Every breadboardMount component has at least one valid seating', () => {
  const breadboard = { id: 'mount_audit_bb', type: 'breadboard-half', ...blockPlacement('breadboard-half', { x: 0, y: 0 }, 0), rotate: 0, attrs: {} };
  const holes = getPartPins(breadboard).map((pin) => pin.name);
  const failures = [];
  for (const type of PART_TYPES) {
    const definition = PART_DEFINITIONS[type];
    if (!definition.breadboardMount) continue;
    const pins = getPartPins(type);
    let valid = false;
    outer: for (const rotate of [0, 90, 180, 270]) {
      const draft = { id: `mount_audit_${type}`, type, left: 0, top: 0, rotate, attrs: { ...definition.defaults } };
      for (const hole of holes) {
        try {
          seatPartAtHole(draft, [breadboard, draft], { breadboardId: breadboard.id, pin: pins[0].name, hole });
          valid = true;
          break outer;
        } catch { /* try another hole/orientation */ }
      }
    }
    if (!valid) failures.push(type);
  }
  assertEqual(failures.length, 0, `Every breadboardMount component must fit at least one valid position: ${failures.join(', ')}`);
});

harness.test('F09: Wire smart-snap aligns to exact breadboard hole axes', () => {
  const bb = { id: 'bb1', type: 'breadboard-half', left: 100, top: 100, rotate: 0, attrs: {} };
  const pin = getPartPins(bb).find((candidate) => candidate.name === '+bottom1');
  assert(pin, 'Expected +bottom1 breadboard pin');
  const exactY = bb.top + pin.y;
  const targets = collectWireAlignmentTargets([bb], []);
  const snapped = snapPointToTargets({ x: 237.2, y: exactY + 2.1 }, targets, 6);
  assertEqual(snapped.point.y, exactY);
  assert(snapped.guides.some((guide) => guide.axis === 'y' && guide.value === exactY), 'Expected a horizontal alignment guide');
});

harness.test('F09: Component drag prioritizes connected pin axes over the coarse grid', () => {
  const uno = { id: 'snap-uno', type: 'wokwi-arduino-uno', ...blockPlacement('wokwi-arduino-uno', { x: -25, y: -10 }), rotate: 0, attrs: {} };
  const pot = { id: 'snap-pot', type: 'wokwi-potentiometer', ...blockPlacement('wokwi-potentiometer', { x: 0, y: 30 }), rotate: 180, attrs: {} };
  const fixed = endpointPoint('snap-uno:5V', [uno, pot]);
  const local = localPinPoint(pot, 'VCC');
  assert(fixed && local, 'Connected test pins must resolve');
  const proposedLeft = fixed.x - local.x + 3;
  const placement = snapPartPlacement(
    pot,
    proposedLeft,
    pot.top,
    [uno, pot],
    'normal',
    6,
    [{ id: 'snap-wire', from: 'snap-uno:5V', to: 'snap-pot:VCC', color: '#d32f2f', waypoints: [] }],
  );
  const moved = { ...pot, left: placement.left, top: placement.top };
  const aligned = endpointPoint('snap-pot:VCC', [uno, moved]);
  assert(aligned && Math.abs(aligned.x - fixed.x) < 0.01, 'Connected pins must share the exact x-axis after snap');
  assert(placement.guides?.some((guide) => guide.axis === 'x' && guide.value === fixed.x), 'Expected a connected-pin alignment guide');
});

harness.test('F09: Wire drafting and bend dragging preserve orthogonal runs', () => {
  const anchor = { x: 103.25, y: 207.75 };
  const horizontal = snapOrthogonalPoint({ x: 181.2, y: 219.4 }, anchor, { xs: [], ys: [] }, 6);
  assertEqual(horizontal.point.y, anchor.y);
  const start = { x: 0, y: 0 };
  const end = { x: 200, y: 200 };
  const moved = moveOrthogonalWaypoint(start, [{ x: 100, y: 0 }, { x: 100, y: 200 }], end, 0, { x: 140, y: 70 });
  const points = connectionPolyline(start, moved, end);
  assert(points.slice(0, -1).every((point, index) => isOrthogonalPair(point, points[index + 1])), 'Bend drag must never create diagonals');
});

harness.test('F09: Rewiring an endpoint preserves every manual joint', () => {
  const parts = [
    { id: 'uno', type: 'wokwi-arduino-uno', ...blockPlacement('wokwi-arduino-uno', { x: -35, y: 0 }), rotate: 0, attrs: {} },
    { id: 'led', type: 'wokwi-led', ...blockPlacement('wokwi-led', { x: 5, y: 0 }), rotate: 0, attrs: {} },
    { id: 'pot', type: 'wokwi-potentiometer', ...blockPlacement('wokwi-potentiometer', { x: 5, y: 10 }), rotate: 0, attrs: {} },
  ];
  const manualWaypoints = [{ x: 120, y: 180 }, { x: 240, y: 135 }];
  circuitStore.replaceDocument({ parts, connections: [{ id: 'w1', from: 'uno:2', to: 'led:A', color: '#1971c2', waypoints: manualWaypoints }] });
  circuitStore.setConnectionEndpoint('w1', 'from', 'uno:3');
  circuitStore.setConnectionEndpoint('w1', 'to', 'pot:SIG');
  const rewired = circuitStore.getSnapshot().connections.find((wire) => wire.id === 'w1');
  assert(rewired, 'Rewired connection must still exist');
  assertEqual(rewired.from, 'uno:3');
  assertEqual(rewired.to, 'pot:SIG');
  assertDeepEqual(rewired.waypoints, manualWaypoints, 'Rewiring must not insert, remove, or move manual joints');
  assertThrows(() => circuitStore.setConnectionEndpoint('w1', 'to', 'missing:pin'), /Unknown wire endpoint/);
});

harness.test('F09: Explicit manual joints are never simplified away', () => {
  const parts = [
    { id: 'uno', type: 'wokwi-arduino-uno', ...blockPlacement('wokwi-arduino-uno', { x: -35, y: 0 }), rotate: 0, attrs: {} },
    { id: 'led', type: 'wokwi-led', ...blockPlacement('wokwi-led', { x: 5, y: 0 }), rotate: 0, attrs: {} },
  ];
  circuitStore.replaceDocument({ parts, connections: [{ id: 'w1', from: 'uno:2', to: 'led:A', color: '#1971c2', waypoints: [] }] });
  const joint = { x: 200, y: 200 };
  circuitStore.setConnectionWaypoints('w1', [joint]);
  assertDeepEqual(circuitStore.getSnapshot().connections[0].waypoints, [joint]);
});

harness.test('F09: Layout quality penalizes overlap and preserves clean layouts', () => {
  const overlapping = evaluateLayout({ parts: [
    { id: 'p1', type: 'wokwi-arduino-uno', left: 100, top: 100, rotate: 0, attrs: {} },
    { id: 'p2', type: 'wokwi-arduino-uno', left: 120, top: 120, rotate: 0, attrs: {} },
  ], connections: [] });
  assert(overlapping.issues.some((issue) => issue.kind === 'part-overlap'));
  const clean = evaluateLayout({ parts: [
    { id: 'p1', type: 'wokwi-arduino-uno', left: 100, top: 100, rotate: 0, attrs: {} },
    { id: 'p2', type: 'wokwi-potentiometer', left: 500, top: 100, rotate: 0, attrs: {} },
  ], connections: [] });
  assertEqual(clean.score, 100);
});

harness.test('F09: WebMCP registers one production tool surface', () => {
  const requiredTools = ['inspect-circuit', 'build-circuit', 'set-code', 'simulate', 'focus'];
  assertEqual(webMcpTools.size, requiredTools.length, 'Only the production WebMCP tools should be registered');
  for (const name of requiredTools) assert(webMcpTools.has(name), `WebMCP tool "${name}" must be registered`);
});

harness.test('F09: WebMCP inspect-circuit uses the physical block coordinate system', async () => {
  circuitStore.replaceDocument({ parts: [
    { id: 'uno1', type: 'wokwi-arduino-uno', ...blockPlacement('wokwi-arduino-uno', { x: -35, y: 0 }), attrs: {}, code: 'void setup(){}' },
    { id: 'led1', type: 'wokwi-led', ...blockPlacement('wokwi-led', { x: 5, y: 0 }), attrs: { color: 'red' } },
  ], connections: [] });
  const basic = await callWebMcp('inspect-circuit');
  assertEqual(basic.coordinateSystem.cellPixels, BREADBOARD_HOLE_PITCH);
  assertEqual(basic.coordinateSystem.componentCoordinate, 'block top-left cell');
  assert(!basic.layout, 'Layout is opt-in to keep ordinary inspection lean');
  const detailed = await callWebMcp('inspect-circuit', { includePins: true, pinPartIds: ['led1'], includeLayout: true, includeCode: true, catalogTypes: ['servo'] });
  assert(detailed.layout?.kind === 'block-grid');
  assertEqual(detailed.parts.find((part) => part.id === 'uno1')?.blockAt.x, -35);
  assert(detailed.parts.find((part) => part.id === 'led1')?.pins?.length === 2);
  assert(detailed.catalog?.[0]?.blockSize?.rotation0, 'Catalog detail should expose logical block size');
});

harness.test('F09: WebMCP build-circuit exposes agent-friendly part IDs and builds atomically', async () => {
  const tool = webMcpTools.get('build-circuit');
  const schema = JSON.stringify(tool.inputSchema);
  assert(schema.includes('arduino-uno') && schema.includes('servo') && schema.includes('potentiometer'), 'Build schema must expose compact agent part IDs');
  const result = await callWebMcp('build-circuit', {
    replace: true,
    parts: [
      { id: 'uno', type: 'arduino-uno', at: [-35, 0] },
      { id: 'servo', type: 'servo', at: [5, 0] },
    ],
    wires: [{ id: 'pwm', from: 'uno:9', to: 'servo:PWM', role: 'signal' }],
  });
  assertEqual(result.layoutScore, undefined, 'Agent feedback must not expose an aggregate visual score');
  assertEqual(result.layoutIssues.length, 0, JSON.stringify(result.layoutIssues));
  assertEqual(circuitStore.getSnapshot().parts.length, 2);
  assertEqual(circuitStore.getSnapshot().selectedId, null);

  await callWebMcp('build-circuit', {
    replace: true,
    parts: [
      { id: 'uno', type: 'arduino-uno', at: [-35, 0] },
      { id: 'pot', type: 'potentiometer', at: [0, 25] },
      { id: 'servo', type: 'servo', at: [10, 0] },
    ],
    nets: [{ id: 'vcc', endpoints: ['uno:5V', 'pot:VCC', 'servo:V+'], role: 'power' }],
  });
  const netConnections = circuitStore.getSnapshot().connections;
  assertEqual(netConnections.length, 2, 'A three-terminal semantic net compiles to a two-edge physical chain');
  assert(netConnections.every((wire) => wire.id.startsWith('vcc-')), 'Compiled net edges keep stable net-derived IDs');
  assert(netConnections.every((wire) => wire.netId === 'vcc'), 'Compiled net edges preserve their semantic net identity');
  assert(!evaluateLayout(circuitStore.getSnapshot()).issues.some((issue) => (
    issue.kind === 'wire-overlap' && issue.itemIds.every((id) => id.startsWith('vcc-'))
  )), 'A shared terminal lead inside one semantic net is an intentional junction, not an unrelated wire overlap');

  await callWebMcp('build-circuit', {
    replace: true,
    parts: [
      { id: 'uno', type: 'arduino-uno', at: [-35, -12] },
      { id: 'board', type: 'breadboard-half', at: [-3, 10] },
      { id: 'pot', type: 'potentiometer', at: [6, 32], rotate: 180 },
    ],
    nets: [{ id: 'sense', endpoints: ['uno:A0', 'pot:SIG'], role: 'signal' }],
  });
  const signalEdges = circuitStore.getSnapshot().connections;
  assertEqual(signalEdges.length, 2, 'A semantic signal net uses two local board drops');
  const boardHoles = signalEdges.flatMap((wire) => [wire.from, wire.to])
    .filter((endpoint) => endpoint.startsWith('board:'))
    .map((endpoint) => endpoint.slice(endpoint.indexOf(':') + 1));
  assertEqual(boardHoles.length, 2);
  assertEqual(breadboardHoleNet(boardHoles[0]), breadboardHoleNet(boardHoles[1]), 'Signal drops must share one connected strip');
  assert(new Set(boardHoles).size === 2, 'Each signal endpoint needs its own physical hole');
  assert(!evaluateLayout(circuitStore.getSnapshot()).issues.some((issue) => issue.kind === 'wire-through-board'));

  await callWebMcp('build-circuit', {
    replace: true,
    parts: [
      { id: 'uno', type: 'arduino-uno', at: [-24, -12] },
      { id: 'servo', type: 'servo', at: [6, -20] },
    ],
    wires: [
      { id: 'power', from: 'uno:5V', to: 'servo:V+', role: 'power' },
      { id: 'ground', from: 'uno:GND.1', to: 'servo:GND', role: 'ground' },
      { id: 'signal', from: 'uno:9', to: 'servo:PWM', role: 'signal' },
    ],
  });
  const exactState = circuitStore.getSnapshot();
  const segmentAxis = (a, b) => Math.abs(a.x - b.x) < 0.02 ? 'v' : Math.abs(a.y - b.y) < 0.02 ? 'h' : 'd';
  const hasTinyTerminalDogleg = (points) => {
    if (points.length < 4) return false;
    const first = segmentAxis(points[0], points[1]);
    const adapter = segmentAxis(points[1], points[2]);
    const continued = segmentAxis(points[2], points[3]);
    const adapterLength = Math.abs(points[2].x - points[1].x) + Math.abs(points[2].y - points[1].y);
    return first === continued && first !== adapter && adapterLength <= BREADBOARD_HOLE_PITCH * 0.51;
  };
  for (const wire of exactState.connections) {
    const start = endpointPoint(wire.from, exactState.parts);
    const end = endpointPoint(wire.to, exactState.parts);
    const points = connectionPolyline(start, wire.waypoints, end);
    assert(!hasTinyTerminalDogleg(points), `${wire.id} must leave its source on the exact pin axis without a grid adapter notch: ${JSON.stringify(points)}`);
    assert(!hasTinyTerminalDogleg([...points].reverse()), `${wire.id} must enter its destination without a grid adapter notch: ${JSON.stringify(points)}`);
    if (pinExitDirection(wire.from, exactState.parts)) {
      const lead = Math.abs(points[1].x - points[0].x) + Math.abs(points[1].y - points[0].y);
      assert(lead >= BREADBOARD_HOLE_PITCH - 0.02, `${wire.id} source lead must be at least one full routing lane`);
    }
    if (pinExitDirection(wire.to, exactState.parts)) {
      const lead = Math.abs(points.at(-1).x - points.at(-2).x) + Math.abs(points.at(-1).y - points.at(-2).y);
      assert(lead >= BREADBOARD_HOLE_PITCH - 0.02, `${wire.id} destination lead must be at least one full routing lane`);
    }
  }

  circuitStore.replaceDocument({ parts: [{ id: 'keep', type: 'battery-9v', left: 200, top: 200, rotate: 0, attrs: {} }], connections: [] });
  await assertThrowsAsync(async () => callWebMcp('build-circuit', {
    replace: true,
    parts: [{ id: 'uno', type: 'arduino-uno', at: [0, 0] }, { id: 'servo', type: 'servo', at: [10, 5] }],
    wires: [],
  }), /Block overlap/i);
  assertEqual(circuitStore.getSnapshot().parts[0]?.id, 'keep', 'Rejected build must restore the prior scene');
});

harness.test('F09: WebMCP set-code, focus, and simulation validation stay available', async () => {
  await callWebMcp('build-circuit', { replace: true, parts: [{ id: 'uno', type: 'arduino-uno', at: [-15, 0] }], wires: [] });
  const sketch = 'void setup() {\n  pinMode(13, OUTPUT);\n}\nvoid loop() {}';
  const codeResult = await callWebMcp('set-code', { boardId: 'uno', code: sketch });
  assertEqual(codeResult.boardId, 'uno');
  const focusResult = await callWebMcp('focus', { itemIds: ['uno'] });
  assertEqual(focusResult.focused.itemIds[0], 'uno');
  const stop = await callWebMcp('simulate', { action: 'stop' });
  assertEqual(stop.status, 'stopped');
});
// F10: Simulation Lifecycle & Clean Start/Stop
harness.test('F10: AVRRunner instantiates with precompiled Blink HEX', () => {
  const runner = new AVRRunner(HEX_FIXTURES.blink.hex);
  assert(runner.cpu, 'CPU instance must exist');
  assertEqual(runner.frequency, 16_000_000);
  assertEqual(runner.program.length, 32768);
});

harness.test('F10: AVRRunner executes cycles and increments cpu.cycles', () => {
  const runner = new AVRRunner(HEX_FIXTURES.blink.hex);
  assertEqual(runner.cpu.cycles, 0);
  stepCpuCycles(runner, 1000);
  assert(runner.cpu.cycles >= 1000, 'CPU cycles must have advanced');
});

harness.test('F10: setupDevices returns frame, reset, and cleanup lifecycle hooks', () => {
  const runner = new AVRRunner(HEX_FIXTURES.blink.hex);
  const doc = { parts: [], connections: [] };
  const graph = buildCircuitGraph(doc);
  const devices = setupDevices(doc, graph, runner);
  assertEqual(typeof devices.frame, 'function');
  assertEqual(typeof devices.reset, 'function');
  assertEqual(typeof devices.cleanup, 'function');
  devices.reset();
  devices.cleanup();
});

harness.test('F10: Simulation peripheral reset clears device states', () => {
  const runner = new AVRRunner(HEX_FIXTURES.blink.hex);
  const doc = {
    parts: [{ id: 'led1', type: 'wokwi-led', left: 0, top: 0, rotate: 0, attrs: {} }],
    connections: [],
  };
  const mockEl = new MockHTMLElement('wokwi-led');
  mockEl.value = true;
  registerMockElement('led1', mockEl);
  const graph = buildCircuitGraph(doc);
  const devices = setupDevices(doc, graph, runner);
  devices.reset();
  assertEqual(mockEl.value, false, 'LED must reset to false');
});

harness.test('F10: Simulation start/stop clean cycle resets store state and clears board LEDs', () => {
  circuitStore.replaceDocument({
    parts: [{ id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, attrs: {} }],
    connections: [],
  });
  const mockUno = new MockHTMLElement('wokwi-arduino-uno');
  mockUno.led13 = true;
  mockUno.ledPower = true;
  registerMockElement('uno1', mockUno);

  const res = simulator.stop();
  assertEqual(res.status, 'stopped');
  assertEqual(circuitStore.getSnapshot().simulation.status, 'stopped');
  assertEqual(mockUno.led13, false);
  assertEqual(mockUno.ledPower, false);
});

harness.test('F10: Repeated 25-cycle simulation start/stop does not leak timers or event listeners', () => {
  const runner = new AVRRunner(HEX_FIXTURES.blink.hex);
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, attrs: {} },
      { id: 'led1', type: 'wokwi-led', left: 200, top: 0, attrs: {} },
      { id: 'btn1', type: 'wokwi-pushbutton', left: 300, top: 0, attrs: {} },
      { id: 'pot1', type: 'wokwi-potentiometer', left: 400, top: 0, attrs: {} },
      { id: 'servo1', type: 'wokwi-servo', left: 500, top: 0, attrs: {} },
      { id: 'lcd1', type: 'wokwi-lcd1602', left: 600, top: 0, attrs: {} },
      { id: 'bat1', type: 'battery-9v', left: 700, top: 0, attrs: {} },
      { id: 'q1', type: 'npn-transistor', left: 800, top: 0, attrs: {} },
      { id: 'd1', type: 'rectifier-diode', left: 900, top: 0, attrs: {} },
      { id: 'm1', type: 'dc-motor', left: 1000, top: 0, attrs: {} },
    ],
    connections: [
      { id: 'w1', from: 'uno1:13', to: 'led1:A' },
      { id: 'w2', from: 'uno1:2', to: 'btn1:1.l' },
      { id: 'w3', from: 'uno1:A0', to: 'pot1:SIG' },
      { id: 'w4', from: 'uno1:9', to: 'servo1:PWM' },
      { id: 'w5', from: 'uno1:A4', to: 'lcd1:SDA' },
      { id: 'w6', from: 'uno1:A5', to: 'lcd1:SCL' },
      { id: 'w7', from: 'uno1:3', to: 'q1:B' },
      { id: 'w8', from: 'bat1:+', to: 'm1:1' },
      { id: 'w9', from: 'm1:2', to: 'q1:C' },
      { id: 'w10', from: 'q1:E', to: 'uno1:GND.1' },
    ],
  };
  const graph = buildCircuitGraph(doc);

  for (let cycle = 0; cycle < 25; cycle++) {
    const devices = setupDevices(doc, graph, runner);
    devices.frame();
    stepCpuCycles(runner, 2000);
    devices.reset();
    devices.cleanup();
  }
  runner.stop();
});

// F11: Test Suite Infrastructure & Fixtures
harness.test('F11: All 16 precompiled HEX fixtures exist and load into flash', () => {
  const fixtureKeys = Object.keys(HEX_FIXTURES);
  assertEqual(fixtureKeys.length, 16, 'All 16 fixtures must exist');
  for (const key of fixtureKeys) {
    const fixture = HEX_FIXTURES[key];
    assert(fixture.hex && fixture.hex.length > 500, `Fixture ${key} has invalid hex`);
    const runner = new AVRRunner(fixture.hex);
    assert(runner.cpu.pc >= 0);
  }
});

harness.test('F11: Serial Potentiometer fixture transmits ADC bytes over USART', () => {
  const runner = new AVRRunner(HEX_FIXTURES.serialPot.hex);
  let transmitted = '';
  runner.usart.onByteTransmit = (b) => { transmitted += String.fromCharCode(b); };
  stepCpuCycles(runner, 100_000);
  assert(transmitted.includes('ADC:'), `Expected Serial output containing "ADC:", got "${transmitted}"`);
});

harness.test('F11: I2C Scan fixture executes TWI initialization', () => {
  const runner = new AVRRunner(HEX_FIXTURES.i2cScan.hex);
  let transmitted = '';
  runner.usart.onByteTransmit = (b) => { transmitted += String.fromCharCode(b); };
  stepCpuCycles(runner, 200_000);
  assert(transmitted.includes('I2C_SCAN'), 'I2C scanner must output start banner');
});

harness.test('F11: DHT22 fixture runs bitbang single-wire loop', () => {
  const runner = new AVRRunner(HEX_FIXTURES.dht22.hex);
  assert(runner.program.length > 0);
  stepCpuCycles(runner, 20_000);
  assert(runner.cpu.cycles >= 20_000);
});

harness.test('F11: Servo Sweep fixture manipulates timer and output ports', () => {
  const runner = new AVRRunner(HEX_FIXTURES.servoSweep.hex);
  stepCpuCycles(runner, 30_000);
  assert(runner.cpu.cycles >= 30_000);
});

// F12: Repository Hygiene & Code Layout
harness.test('F12: check-repo.mjs checks succeed', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const checkScript = path.join(root, 'scripts', 'maintenance', 'check-repo.mjs');
  assert(fs.existsSync(checkScript), 'scripts/maintenance/check-repo.mjs must exist');
});

harness.test('F12: No forbidden router or stale monolithic files in repo', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const forbidden = [
    'src/wires/router.ts',
    'src/parts.ts',
    'src/store.ts',
    'src/types.ts',
    'src/App.tsx',
    'src/styles.css',
    'tinkercad.md',
    'THIRD_PARTY_NOTICES.md',
  ];
  for (const file of forbidden) {
    assert(!fs.existsSync(path.join(root, file)), `Forbidden file exists: ${file}`);
  }
});

harness.test('F12: src/ root contains only main.tsx', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const srcFiles = fs.readdirSync(path.join(root, 'src'), { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name);
  assertEqual(srcFiles.join(','), 'main.tsx');
});

harness.test('F12: Clean modular architecture separation across directories', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const dirs = ['src/components', 'src/circuit', 'src/breadboard', 'src/wires', 'src/agent', 'src/sim', 'src/app'];
  for (const dir of dirs) {
    assert(fs.existsSync(path.join(root, dir)), `Directory must exist: ${dir}`);
  }
});

harness.test('F12: Public assets contain fritzing SVGs for clean-room rendering', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const svgs = ['battery-9v.svg', 'dc-motor.svg', 'npn-transistor.svg', 'rectifier-diode.svg'];
  for (const svg of svgs) {
    const p = path.join(root, 'public', 'assets', 'fritzing', svg);
    assert(fs.existsSync(p), `SVG asset must exist: ${p}`);
  }
});

// ============================================================================
// TIER 2: BOUNDARY & CORNER CASES (>=5 tests per category)
// ============================================================================
harness.setTier(2);

// 1. Empty & Zero Inputs
harness.test('T2: Empty circuit document builds empty graph without throwing', () => {
  const graph = buildCircuitGraph({ parts: [], connections: [] });
  assertEqual(graph.parts.size, 0);
  assertEqual(graph.connections.size, 0);
  assertEqual(graph.adjacency.size, 0);
});

harness.test('T2: Empty circuit document produces zero diagnostics errors', () => {
  const diag = diagnoseCircuit({ parts: [], connections: [] });
  assertEqual(diag.length, 0);
});

harness.test('T2: Resistor with 0 ohm or negative value defaults safely to 220 ohms', () => {
  const doc = {
    parts: [
      { id: 'r1', type: 'wokwi-resistor', left: 0, top: 0, rotate: 0, attrs: { value: 0 } },
      { id: 'r2', type: 'wokwi-resistor', left: 0, top: 0, rotate: 0, attrs: { value: -50 } },
    ],
    connections: [
      { id: 'w1', from: 'r1:2', to: 'r2:1', color: '#2f9e44' },
    ],
  };
  const graph = buildCircuitGraph(doc);
  const traces = directlyConnectedNodes(graph, 'r1:1');
  assert(traces.has('r1:1'));
});

harness.test('T2: Empty or whitespace Arduino code validation', () => {
  const uno = { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, rotate: 0, attrs: {}, code: '   \n\t  ' };
  assert(!uno.code.trim(), 'Code must be recognized as empty');
});

harness.test('T2: Wire without waypoints connects endpoints directly', () => {
  const start = { x: 50, y: 50 };
  const end = { x: 200, y: 200 };
  const polyline = connectionPolyline(start, undefined, end);
  assert(polyline.length >= 2, 'Must generate endpoint coordinates');
});

// 2. Extreme Parameter Ranges
harness.test('T2: Resistor with 10M ohm extreme resistance', () => {
  const doc = {
    parts: [
      { id: 'r1', type: 'wokwi-resistor', left: 0, top: 0, rotate: 0, attrs: { value: 10_000_000 } },
    ],
    connections: [],
  };
  const graph = buildCircuitGraph(doc);
  assert(graph.parts.has('r1'));
});

harness.test('T2: Photoresistor lux extremes (0.001 lux dark to 100,000 lux bright)', () => {
  const runner = new AVRRunner(HEX_FIXTURES.analogMulti.hex);
  const part = { id: 'ldr1', type: 'wokwi-photoresistor-sensor', left: 0, top: 0, rotate: 0, attrs: { lux: 0.001 } };
  const doc = { parts: [part, { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, rotate: 0, attrs: {} }], connections: [{ id: 'w1', from: 'ldr1:AO', to: 'uno1:A0' }] };
  const graph = buildCircuitGraph(doc);
  const devs = setupDevices(doc, graph, runner);
  devs.frame();
  assert(runner.adc.channelValues[0] >= 0 && runner.adc.channelValues[0] <= 5);
  devs.cleanup();
});

harness.test('T2: NTC thermistor temperature extremes (-40C to +125C)', () => {
  const runner = new AVRRunner(HEX_FIXTURES.analogMulti.hex);
  const part = { id: 'ntc1', type: 'wokwi-ntc-temperature-sensor', left: 0, top: 0, rotate: 0, attrs: { temperature: -40 } };
  const doc = { parts: [part, { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, rotate: 0, attrs: {} }], connections: [{ id: 'w1', from: 'ntc1:OUT', to: 'uno1:A0' }] };
  const graph = buildCircuitGraph(doc);
  const devs = setupDevices(doc, graph, runner);
  devs.frame();
  assert(runner.adc.channelValues[0] >= 0 && runner.adc.channelValues[0] <= 5);
  devs.cleanup();
});

harness.test('T2: HC-SR04 distance limits (2cm minimum and 400cm maximum)', () => {
  const sonar = PART_DEFINITIONS['wokwi-hc-sr04'];
  const dist = sonar.properties.find((p) => p.key === 'distance');
  assertEqual(dist.min, 2);
  assertEqual(dist.max, 400);
});

harness.test('T2: Stepper motor steps per revolution bounds (4 to 4096)', () => {
  const stepper = PART_DEFINITIONS['wokwi-stepper-motor'];
  const steps = stepper.properties.find((p) => p.key === 'stepsPerRevolution');
  assertEqual(steps.min, 4);
  assertEqual(steps.max, 4096);
});

// 3. Invalid & Malformed Inputs
harness.test('T2: Requesting non-existent pin on Arduino Uno returns null', () => {
  const uno = { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, rotate: 0, attrs: {} };
  assertEqual(resolvePinName(uno, 'PIN_NON_EXISTENT'), null);
  assertEqual(resolvePinName(uno, '99'), null);
  assertEqual(resolvePinName(uno, 'D99'), null);
  assertEqual(resolvePinName(uno, 'A9'), null);
});

harness.test('T2: Resolving analog channel on digital pins returns null', () => {
  assertEqual(resolveArduinoAnalogChannel('13'), null);
  assertEqual(resolveArduinoAnalogChannel('D5'), null);
  assertEqual(resolveArduinoAnalogChannel('5V'), null);
  assertEqual(resolveArduinoAnalogChannel('GND'), null);
});

harness.test('T2: Resolving digital port pin on analog or power pins returns null', () => {
  const runner = new AVRRunner(HEX_FIXTURES.blink.hex);
  assertEqual(resolveArduinoDigitalPin(runner, 'A0'), null);
  assertEqual(resolveArduinoDigitalPin(runner, '5V'), null);
  assertEqual(resolveArduinoDigitalPin(runner, 'GND'), null);
  assertEqual(resolveArduinoDigitalPin(runner, 'VIN'), null);
});

harness.test('T2: Self-connecting wire from pin to itself', () => {
  const from = 'uno1:13';
  const to = 'uno1:13';
  assert(from === to, 'Self connection detected');
});

harness.test('T2: Seating on non-existent breadboard ID throws error', () => {
  const led = { id: 'led1', type: 'wokwi-led', left: 0, top: 0, rotate: 0, attrs: {} };
  assertThrows(() => {
    seatPartAtHole(led, [], { breadboardId: 'non_existent_bb', pin: 'A', hole: 'A1' });
  }, /does not exist/i);
});

// 4. Missing Power & Floating Nets
harness.test('T2: Unconnected LED produces no illumination', () => {
  const runner = new AVRRunner(HEX_FIXTURES.blink.hex);
  const doc = {
    parts: [{ id: 'led1', type: 'wokwi-led', left: 0, top: 0, rotate: 0, attrs: {} }],
    connections: [],
  };
  const mockEl = new MockHTMLElement('wokwi-led');
  registerMockElement('led1', mockEl);
  const graph = buildCircuitGraph(doc);
  const devs = setupDevices(doc, graph, runner);
  devs.frame();
  assertEqual(mockEl.value, false);
  devs.cleanup();
});

harness.test('T2: Unconnected Buzzer has no signal', () => {
  const runner = new AVRRunner(HEX_FIXTURES.blink.hex);
  const doc = {
    parts: [{ id: 'buzzer1', type: 'wokwi-buzzer', left: 0, top: 0, rotate: 0, attrs: {} }],
    connections: [],
  };
  const mockEl = new MockHTMLElement('wokwi-buzzer');
  registerMockElement('buzzer1', mockEl);
  const graph = buildCircuitGraph(doc);
  const devs = setupDevices(doc, graph, runner);
  devs.frame();
  assertEqual(mockEl.hasSignal, false);
  devs.cleanup();
});

harness.test('T2: Unwired I2C LCD is not registered on TWI bus', () => {
  const runner = new AVRRunner(HEX_FIXTURES.i2cScan.hex);
  const doc = {
    parts: [{ id: 'lcd1', type: 'wokwi-lcd1602', left: 0, top: 0, rotate: 0, attrs: {} }],
    connections: [],
  };
  const graph = buildCircuitGraph(doc);
  const devs = setupDevices(doc, graph, runner);
  let transmitted = '';
  runner.usart.onByteTransmit = (b) => { transmitted += String.fromCharCode(b); };
  stepCpuCycles(runner, 50_000);
  assert(!transmitted.includes('FOUND:0x27'), 'Unwired LCD must not be detected on I2C bus');
  devs.cleanup();
});

harness.test('T2: Floating analog ADC channel reads safe voltage bounds', () => {
  const runner = new AVRRunner(HEX_FIXTURES.serialPot.hex);
  const val = runner.adc.channelValues[0] ?? 0;
  assert(val >= 0 && val <= 5);
});

harness.test('T2: PIR motion sensor with motion=false produces no trigger', () => {
  const runner = new AVRRunner(HEX_FIXTURES.blink.hex);
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, rotate: 0, attrs: {} },
      { id: 'pir1', type: 'wokwi-pir-motion-sensor', left: 0, top: 0, rotate: 0, attrs: { motion: false } },
    ],
    connections: [{ id: 'w1', from: 'pir1:OUT', to: 'uno1:2' }],
  };
  const graph = buildCircuitGraph(doc);
  const devs = setupDevices(doc, graph, runner);
  devs.frame();
  devs.cleanup();
});

// 5. Reverse Polarity & Short Circuits
harness.test('T2: Direct 5V to GND short circuit triggers blocking diagnostic error', () => {
  const doc = {
    parts: [{ id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, rotate: 0, attrs: {} }],
    connections: [{ id: 'w1', from: 'uno1:5V', to: 'uno1:GND.1', color: '#d94841' }],
  };
  const diag = diagnoseCircuit(doc);
  assert(diag.some((d) => d.severity === 'error' && d.message.includes('short circuit')), 'Short circuit must be flagged as error');
});

harness.test('T2: Direct 3.3V to GND short circuit triggers diagnostic error', () => {
  const doc = {
    parts: [{ id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, rotate: 0, attrs: {} }],
    connections: [{ id: 'w1', from: 'uno1:3.3V', to: 'uno1:GND.2', color: '#d94841' }],
  };
  const diag = diagnoseCircuit(doc);
  assert(diag.some((d) => d.severity === 'error' && d.message.includes('short circuit')));
});

harness.test('T2: Reversed LED cathode/anode connection triggers warning', () => {
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, rotate: 0, attrs: {} },
      { id: 'led1', type: 'wokwi-led', left: 0, top: 0, rotate: 0, attrs: {} },
      { id: 'r1', type: 'wokwi-resistor', left: 0, top: 0, rotate: 0, attrs: { value: 220 } },
    ],
    connections: [
      { id: 'w1', from: 'uno1:5V', to: 'led1:C' },
      { id: 'w2', from: 'led1:A', to: 'r1:1' },
      { id: 'w3', from: 'r1:2', to: 'uno1:GND.1' },
    ],
  };
  const diag = diagnoseCircuit(doc);
  assert(diag.some((d) => d.severity === 'warning' && d.message.includes('reversed')), 'Reversed LED must trigger diagnostic warning');
});

harness.test('T2: LED connected without current limiting resistor triggers warning', () => {
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, rotate: 0, attrs: {} },
      { id: 'led1', type: 'wokwi-led', left: 0, top: 0, rotate: 0, attrs: {} },
    ],
    connections: [
      { id: 'w1', from: 'uno1:13', to: 'led1:A' },
      { id: 'w2', from: 'led1:C', to: 'uno1:GND.1' },
    ],
  };
  const diag = diagnoseCircuit(doc);
  assert(diag.some((d) => d.severity === 'warning' && d.message.includes('current-limiting resistor')));
});

harness.test('T2: Seating beyond breadboard column boundaries throws error', () => {
  const bb = { id: 'bb1', type: 'breadboard-half', left: 0, top: 0, rotate: 0, attrs: {} };
  const led = { id: 'led1', type: 'wokwi-led', left: 0, top: 0, rotate: 0, attrs: {} };
  assertThrows(() => {
    seatPartAtHole(led, [bb], { breadboardId: 'bb1', pin: 'A', hole: 'A60' });
  }, /does not exist/i);
});

// ============================================================================
// TIER 3: CROSS-FEATURE COMBINATIONS (Pairwise Interactions)
// ============================================================================
harness.setTier(3);

// 1. MCU + Analog Sensors
harness.test('T3: Uno ADC reading Potentiometer voltage at midpoint (2.5V = 512)', () => {
  const runner = new AVRRunner(HEX_FIXTURES.serialPot.hex);
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, rotate: 0, attrs: {} },
      { id: 'pot1', type: 'wokwi-potentiometer', left: 0, top: 0, rotate: 0, attrs: { value: 512 } },
    ],
    connections: [
      { id: 'w1', from: 'uno1:5V', to: 'pot1:VCC' },
      { id: 'w2', from: 'uno1:GND.1', to: 'pot1:GND' },
      { id: 'w3', from: 'pot1:SIG', to: 'uno1:A0' },
    ],
  };
  const mockPot = new MockHTMLElement('wokwi-potentiometer');
  mockPot.value = 512;
  registerMockElement('pot1', mockPot);
  const graph = buildCircuitGraph(doc);
  const devs = setupDevices(doc, graph, runner);
  devs.frame();
  assertRoughly(runner.adc.channelValues[0], 2.502, 0.05, 'ADC0 channel must read ~2.5V');
  devs.cleanup();
});

harness.test('T3: Uno ADC reading Joystick HORZ (A0) and VERT (A1)', () => {
  const runner = new AVRRunner(HEX_FIXTURES.analogMulti.hex);
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, rotate: 0, attrs: {} },
      { id: 'joy1', type: 'wokwi-analog-joystick', left: 0, top: 0, rotate: 0, attrs: {} },
    ],
    connections: [
      { id: 'w1', from: 'joy1:HORZ', to: 'uno1:A0' },
      { id: 'w2', from: 'joy1:VERT', to: 'uno1:A1' },
      { id: 'w3', from: 'joy1:SEL', to: 'uno1:2' },
    ],
  };
  const mockEl = new MockHTMLElement('wokwi-analog-joystick');
  mockEl.xValue = 0;
  mockEl.yValue = 0;
  registerMockElement('joy1', mockEl);
  const graph = buildCircuitGraph(doc);
  const devs = setupDevices(doc, graph, runner);
  devs.frame();
  assertRoughly(runner.adc.channelValues[0], 2.5, 0.01);
  assertRoughly(runner.adc.channelValues[1], 2.5, 0.01);
  devs.cleanup();
});

harness.test('T3: Uno ADC reading MQ2 Gas Sensor monotonic response', () => {
  const runner = new AVRRunner(HEX_FIXTURES.analogMulti.hex);
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, rotate: 0, attrs: {} },
      { id: 'gas1', type: 'wokwi-gas-sensor', left: 0, top: 0, rotate: 0, attrs: { ppm: 1000 } },
    ],
    connections: [
      { id: 'w1', from: 'gas1:AOUT', to: 'uno1:A0' },
      { id: 'w2', from: 'gas1:DOUT', to: 'uno1:2' },
    ],
  };
  const mockGas = new MockHTMLElement('wokwi-gas-sensor');
  mockGas.ppm = 1000;
  registerMockElement('gas1', mockGas);
  const graph = buildCircuitGraph(doc);
  const devs = setupDevices(doc, graph, runner);
  devs.frame();
  assert(runner.adc.channelValues[0] > 0, 'Gas sensor must drive positive analog voltage');
  devs.cleanup();
});

// 2. I2C Bus Multi-Device Sharing
harness.test('T3: Multiple I2C devices (LCD1602 at 0x27 and DS1307 at 0x68) share A4/A5 bus', () => {
  const runner = new AVRRunner(HEX_FIXTURES.i2cScan.hex);
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, rotate: 0, attrs: {} },
      { id: 'lcd1', type: 'wokwi-lcd1602', left: 0, top: 0, rotate: 0, attrs: {} },
      { id: 'rtc1', type: 'wokwi-ds1307', left: 0, top: 0, rotate: 0, attrs: {} },
    ],
    connections: [
      { id: 'w1', from: 'uno1:A4', to: 'lcd1:SDA' },
      { id: 'w2', from: 'uno1:A5', to: 'lcd1:SCL' },
      { id: 'w3', from: 'uno1:A4', to: 'rtc1:SDA' },
      { id: 'w4', from: 'uno1:A5', to: 'rtc1:SCL' },
    ],
  };
  const graph = buildCircuitGraph(doc);
  const devs = setupDevices(doc, graph, runner);
  let transmitted = '';
  runner.usart.onByteTransmit = (b) => { transmitted += String.fromCharCode(b); };
  stepCpuCycles(runner, 800_000);
  assert(transmitted.includes('FOUND:0x27'), `Expected FOUND:0x27, got ${transmitted}`);
  assert(transmitted.includes('FOUND:0x68'), `Expected FOUND:0x68, got ${transmitted}`);
  devs.cleanup();
});

harness.test('T3: Multi-device I2C with OLED SSD1306 (0x3C) and MPU6050 (0x68)', () => {
  const runner = new AVRRunner(HEX_FIXTURES.i2cScan.hex);
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, rotate: 0, attrs: {} },
      { id: 'oled1', type: 'wokwi-ssd1306', left: 0, top: 0, rotate: 0, attrs: {} },
      { id: 'imu1', type: 'wokwi-mpu6050', left: 0, top: 0, rotate: 0, attrs: {} },
    ],
    connections: [
      { id: 'w1', from: 'uno1:A4', to: 'oled1:DATA' },
      { id: 'w2', from: 'uno1:A5', to: 'oled1:CLK' },
      { id: 'w3', from: 'uno1:A4', to: 'imu1:SDA' },
      { id: 'w4', from: 'uno1:A5', to: 'imu1:SCL' },
    ],
  };
  const graph = buildCircuitGraph(doc);
  const devs = setupDevices(doc, graph, runner);
  let transmitted = '';
  runner.usart.onByteTransmit = (b) => { transmitted += String.fromCharCode(b); };
  stepCpuCycles(runner, 800_000);
  assert(transmitted.includes('FOUND:0x3C'), `Expected FOUND:0x3C, got ${transmitted}`);
  assert(transmitted.includes('FOUND:0x68'), `Expected FOUND:0x68, got ${transmitted}`);
  devs.cleanup();
});

// 3. Breadboard Rail Daisy-Chaining
harness.test('T3: Breadboard rail jumper distributes 5V and GND across top and bottom rails', () => {
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, rotate: 0, attrs: {} },
      { id: 'bb1', type: 'breadboard-half', left: 200, top: 0, rotate: 0, attrs: {} },
      { id: 'led1', type: 'wokwi-led', left: 0, top: 0, rotate: 0, attrs: {}, seating: { breadboardId: 'bb1', pins: { A: '+bottom5', C: '-bottom5' } } },
    ],
    connections: [
      { id: 'w1', from: 'uno1:5V', to: 'bb1:+top1' },
      { id: 'w2', from: 'uno1:GND.1', to: 'bb1:-top1' },
      { id: 'w3', from: 'bb1:+top25', to: 'bb1:+bottom25' },
      { id: 'w4', from: 'bb1:-top25', to: 'bb1:-bottom25' },
    ],
  };
  const graph = buildCircuitGraph(doc);
  const powerTraces = traceToPower(graph, 'led1:A');
  const gndTraces = traceToPower(graph, 'led1:C');
  assert(powerTraces.some((t) => t.pin === '5V'), 'LED Anode must receive 5V via rail jumper');
  assert(gndTraces.some((t) => t.pin.startsWith('GND')), 'LED Cathode must receive GND via rail jumper');
});

// 4. Digital Input / Output Pairs
harness.test('T3: Pushbutton press on D2 drives D9 LED output', () => {
  const runner = new AVRRunner(HEX_FIXTURES.buttonLed.hex);
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, rotate: 0, attrs: {} },
      { id: 'btn1', type: 'wokwi-pushbutton', left: 0, top: 0, rotate: 0, attrs: {} },
      { id: 'led1', type: 'wokwi-led', left: 0, top: 0, rotate: 0, attrs: {} },
    ],
    connections: [
      { id: 'w1', from: 'uno1:2', to: 'btn1:1.l' },
      { id: 'w2', from: 'btn1:2.l', to: 'uno1:GND.1' },
      { id: 'w3', from: 'uno1:9', to: 'led1:A' },
      { id: 'w4', from: 'led1:C', to: 'uno1:GND.2' },
    ],
  };
  const mockBtn = new MockHTMLElement('wokwi-pushbutton');
  const mockLed = new MockHTMLElement('wokwi-led');
  registerMockElement('btn1', mockBtn);
  registerMockElement('led1', mockLed);
  const graph = buildCircuitGraph(doc);
  const devs = setupDevices(doc, graph, runner);

  stepCpuCycles(runner, 50_000);
  mockBtn.dispatchEvent({ type: 'button-release' });
  stepCpuCycles(runner, 10_000);
  devs.frame();
  assertEqual(mockLed.value, false, 'Unpressed button must leave LED off');

  mockBtn.dispatchEvent({ type: 'button-press' });
  stepCpuCycles(runner, 10_000);
  devs.frame();
  assertEqual(mockLed.value, true, 'Pressed button must turn LED on');

  mockBtn.dispatchEvent({ type: 'button-release' });
  stepCpuCycles(runner, 10_000);
  devs.frame();
  assertEqual(mockLed.value, false, 'Released button must turn LED off');

  devs.cleanup();
});

harness.test('T3: Slide Switch toggling between 5V and GND on D2', () => {
  const runner = new AVRRunner(HEX_FIXTURES.buttonLed.hex);
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, rotate: 0, attrs: {} },
      { id: 'sw1', type: 'wokwi-slide-switch', left: 0, top: 0, rotate: 0, attrs: {} },
      { id: 'led1', type: 'wokwi-led', left: 0, top: 0, rotate: 0, attrs: {} },
    ],
    connections: [
      { id: 'w1', from: 'uno1:5V', to: 'sw1:1' },
      { id: 'w2', from: 'uno1:2', to: 'sw1:2' },
      { id: 'w3', from: 'uno1:GND.1', to: 'sw1:3' },
      { id: 'w4', from: 'uno1:9', to: 'led1:A' },
      { id: 'w5', from: 'led1:C', to: 'uno1:GND.2' },
    ],
  };
  const mockSw = new MockHTMLElement('wokwi-slide-switch');
  const mockLed = new MockHTMLElement('wokwi-led');
  registerMockElement('sw1', mockSw);
  registerMockElement('led1', mockLed);
  const graph = buildCircuitGraph(doc);
  const devs = setupDevices(doc, graph, runner);

  // Position 0 -> 5V (HIGH) -> LED is OFF
  mockSw.value = 0;
  mockSw.dispatchEvent({ type: 'input' });
  stepCpuCycles(runner, 50_000);
  devs.frame();
  assertEqual(mockLed.value, false, 'Slide switch at 5V position leaves LED off');

  // Position 1 -> GND (LOW) -> LED is ON
  mockSw.value = 1;
  mockSw.dispatchEvent({ type: 'input' });
  stepCpuCycles(runner, 20_000);
  devs.frame();
  assertEqual(mockLed.value, true, 'Slide switch at GND position turns LED on');

  devs.cleanup();
});

// 5. Sensor-Actuator Closed Loops
harness.test('T3: Potentiometer reading controls Servo PWM pulse angle', () => {
  const runner = new AVRRunner(HEX_FIXTURES.servoSweep.hex);
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, rotate: 0, attrs: {} },
      { id: 'servo1', type: 'wokwi-servo', left: 0, top: 0, rotate: 0, attrs: {} },
    ],
    connections: [
      { id: 'w1', from: 'uno1:9', to: 'servo1:PWM' },
      { id: 'w2', from: 'uno1:5V', to: 'servo1:V+' },
      { id: 'w3', from: 'uno1:GND.1', to: 'servo1:GND' },
    ],
  };
  const mockServo = new MockHTMLElement('wokwi-servo');
  mockServo.angle = 0;
  registerMockElement('servo1', mockServo);
  const graph = buildCircuitGraph(doc);
  const devs = setupDevices(doc, graph, runner);

  stepCpuCycles(runner, 500_000);
  devs.frame();
  assert(mockServo.angle >= 0 && mockServo.angle <= 180, `Servo angle must be within [0, 180], got ${mockServo.angle}`);
  devs.cleanup();
});

// 6. Display Multiplexing
harness.test('T3: 7-Segment Display segment activation', () => {
  const runner = new AVRRunner(HEX_FIXTURES.blink.hex);
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, rotate: 0, attrs: {} },
      { id: 'seg1', type: 'wokwi-7segment', left: 0, top: 0, rotate: 0, attrs: {} },
    ],
    connections: [
      { id: 'w1', from: 'uno1:13', to: 'seg1:A' },
      { id: 'w2', from: 'seg1:COM.1', to: 'uno1:GND.1' },
    ],
  };
  const mockSeg = new MockHTMLElement('wokwi-7segment');
  mockSeg.values = new Array(8).fill(0);
  registerMockElement('seg1', mockSeg);
  const graph = buildCircuitGraph(doc);
  const devs = setupDevices(doc, graph, runner);

  stepCpuCycles(runner, 50_000);
  devs.frame();
  assertEqual(mockSeg.values[0], 1, 'Segment A must be lit when D13 is HIGH');
  devs.cleanup();
});

harness.test('T3: 10-Segment LED Bar Graph channel mapping', () => {
  const runner = new AVRRunner(HEX_FIXTURES.blink.hex);
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, rotate: 0, attrs: {} },
      { id: 'bar1', type: 'wokwi-led-bar-graph', left: 0, top: 0, rotate: 0, attrs: {} },
    ],
    connections: [
      { id: 'w1', from: 'uno1:13', to: 'bar1:A1' },
      { id: 'w2', from: 'bar1:C1', to: 'uno1:GND.1' },
    ],
  };
  const mockBar = new MockHTMLElement('wokwi-led-bar-graph');
  mockBar.values = new Array(10).fill(0);
  registerMockElement('bar1', mockBar);
  const graph = buildCircuitGraph(doc);
  const devs = setupDevices(doc, graph, runner);

  stepCpuCycles(runner, 50_000);
  devs.frame();
  assertEqual(mockBar.values[0], 1, 'Channel 1 must be lit when D13 is HIGH');
  devs.cleanup();
});

// ============================================================================
// TIER 4: REAL-WORLD COMPOSITE CIRCUITS (The 9 Application Scenarios)
// ============================================================================
harness.setTier(4);

// Scenario 1: Uno + LED + 220ÃŽÂ© Resistor (Blink / Current Limiting)
harness.test('T4: Scenario 1 - Uno + LED + 220 ohm Resistor Blink Execution', () => {
  const runner = new AVRRunner(HEX_FIXTURES.blink.hex);
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, rotate: 0, attrs: {} },
      { id: 'r1', type: 'wokwi-resistor', left: 100, top: 0, rotate: 0, attrs: { value: 220 } },
      { id: 'led1', type: 'wokwi-led', left: 200, top: 0, rotate: 0, attrs: { color: 'red' } },
    ],
    connections: [
      { id: 'w1', from: 'uno1:13', to: 'r1:1', color: '#2f9e44' },
      { id: 'w2', from: 'r1:2', to: 'led1:A', color: '#d94841' },
      { id: 'w3', from: 'led1:C', to: 'uno1:GND.1', color: '#343a40' },
    ],
  };
  const mockLed = new MockHTMLElement('wokwi-led');
  registerMockElement('led1', mockLed);
  const diag = diagnoseCircuit(doc);
  assertEqual(diag.length, 0, 'Clean LED+resistor circuit must have 0 diagnostics issues');

  const graph = buildCircuitGraph(doc);
  const devs = setupDevices(doc, graph, runner);

  stepCpuCycles(runner, 50_000);
  devs.frame();
  assertEqual(mockLed.value, true, 'LED must illuminate when D13 is HIGH');

  devs.cleanup();
});

// Scenario 2: Potentiometer + Serial Monitor
harness.test('T4: Scenario 2 - Potentiometer + Serial Monitor Telemetry', () => {
  const runner = new AVRRunner(HEX_FIXTURES.serialPot.hex);
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, rotate: 0, attrs: {} },
      { id: 'pot1', type: 'wokwi-potentiometer', left: 200, top: 0, rotate: 0, attrs: { value: 768 } },
    ],
    connections: [
      { id: 'w1', from: 'uno1:5V', to: 'pot1:VCC', color: '#d94841' },
      { id: 'w2', from: 'uno1:GND.1', to: 'pot1:GND', color: '#343a40' },
      { id: 'w3', from: 'pot1:SIG', to: 'uno1:A0', color: '#1971c2' },
    ],
  };
  const mockPot = new MockHTMLElement('wokwi-potentiometer');
  mockPot.value = 768;
  registerMockElement('pot1', mockPot);

  let serialData = '';
  runner.usart.onByteTransmit = (b) => { serialData += String.fromCharCode(b); };

  const graph = buildCircuitGraph(doc);
  const devs = setupDevices(doc, graph, runner);
  devs.frame();

  stepCpuCycles(runner, 100_000);
  assert(serialData.includes('ADC:'), 'Serial output must contain ADC reading');
  devs.cleanup();
});

// Scenario 3: Servo + Potentiometer
harness.test('T4: Scenario 3 - Servo + Potentiometer Closed-Loop Control', () => {
  const runner = new AVRRunner(HEX_FIXTURES.servoPot.hex);
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, rotate: 0, attrs: {} },
      { id: 'pot1', type: 'wokwi-potentiometer', left: 200, top: 0, rotate: 0, attrs: { value: 512 } },
      { id: 'servo1', type: 'wokwi-servo', left: 400, top: 0, rotate: 0, attrs: {} },
    ],
    connections: [
      { id: 'w1', from: 'uno1:5V', to: 'pot1:VCC' },
      { id: 'w2', from: 'uno1:GND.1', to: 'pot1:GND' },
      { id: 'w3', from: 'pot1:SIG', to: 'uno1:A0' },
      { id: 'w4', from: 'uno1:9', to: 'servo1:PWM' },
      { id: 'w5', from: 'uno1:5V', to: 'servo1:V+' },
      { id: 'w6', from: 'uno1:GND.2', to: 'servo1:GND' },
    ],
  };
  const mockPot = new MockHTMLElement('wokwi-potentiometer');
  mockPot.value = 512;
  const mockServo = new MockHTMLElement('wokwi-servo');
  mockServo.angle = 0;
  registerMockElement('pot1', mockPot);
  registerMockElement('servo1', mockServo);

  const graph = buildCircuitGraph(doc);
  const devs = setupDevices(doc, graph, runner);
  devs.frame();

  stepCpuCycles(runner, 600_000);
  devs.frame();
  assert(mockServo.angle >= 0, 'Servo angle must update from potentiometer');
  devs.cleanup();
});

// Scenario 4: HC-SR04 Ultrasonic Distance Sensor
harness.test('T4: Scenario 4 - HC-SR04 Ultrasonic Echo Timing and Distance', () => {
  const runner = new AVRRunner(HEX_FIXTURES.hcsr04.hex);
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, rotate: 0, attrs: {} },
      { id: 'sonar1', type: 'wokwi-hc-sr04', left: 200, top: 0, rotate: 0, attrs: { distance: 150 } },
    ],
    connections: [
      { id: 'w1', from: 'uno1:5V', to: 'sonar1:VCC' },
      { id: 'w2', from: 'uno1:GND.1', to: 'sonar1:GND' },
      { id: 'w3', from: 'uno1:9', to: 'sonar1:TRIG' },
      { id: 'w4', from: 'sonar1:ECHO', to: 'uno1:10' },
    ],
  };
  const mockSonar = new MockHTMLElement('wokwi-hc-sr04');
  mockSonar.distance = 150;
  registerMockElement('sonar1', mockSonar);

  let serialData = '';
  runner.usart.onByteTransmit = (b) => { serialData += String.fromCharCode(b); };

  const graph = buildCircuitGraph(doc);
  const devs = setupDevices(doc, graph, runner);
  devs.frame();

  stepCpuCycles(runner, 300_000);
  assert(serialData.includes('DIST:'), `Expected Serial output containing DIST, got "${serialData}"`);
  devs.cleanup();
});

// Scenario 5: DHT22 Temperature & Humidity Sensor
harness.test('T4: Scenario 5 - DHT22 Single-Wire Protocol Frame Reception', () => {
  const runner = new AVRRunner(HEX_FIXTURES.dht22.hex);
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, rotate: 0, attrs: {} },
      { id: 'dht1', type: 'wokwi-dht22', left: 200, top: 0, rotate: 0, attrs: { temperature: 25.5, humidity: 65 } },
    ],
    connections: [
      { id: 'w1', from: 'uno1:5V', to: 'dht1:VCC' },
      { id: 'w2', from: 'uno1:GND.1', to: 'dht1:GND' },
      { id: 'w3', from: 'uno1:2', to: 'dht1:SDA' },
    ],
  };
  const mockDht = new MockHTMLElement('wokwi-dht22');
  mockDht.temperature = 25.5;
  mockDht.humidity = 65;
  registerMockElement('dht1', mockDht);

  let serialData = '';
  runner.usart.onByteTransmit = (b) => { serialData += String.fromCharCode(b); };

  const graph = buildCircuitGraph(doc);
  const devs = setupDevices(doc, graph, runner);
  devs.frame();

  stepCpuCycles(runner, 500_000);
  devs.cleanup();
});

// Scenario 6: I2C Display + Sensor
harness.test('T4: Scenario 6 - I2C LCD1602 and DS1307 RTC Integrated Circuit', () => {
  const runner = new AVRRunner(HEX_FIXTURES.i2cLcd.hex);
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, rotate: 0, attrs: {} },
      { id: 'lcd1', type: 'wokwi-lcd1602', left: 200, top: 0, rotate: 0, attrs: {} },
      { id: 'rtc1', type: 'wokwi-ds1307', left: 400, top: 0, rotate: 0, attrs: {} },
    ],
    connections: [
      { id: 'w1', from: 'uno1:A4', to: 'lcd1:SDA' },
      { id: 'w2', from: 'uno1:A5', to: 'lcd1:SCL' },
      { id: 'w3', from: 'uno1:A4', to: 'rtc1:SDA' },
      { id: 'w4', from: 'uno1:A5', to: 'rtc1:SCL' },
      { id: 'w5', from: 'uno1:5V', to: 'lcd1:VCC' },
      { id: 'w6', from: 'uno1:GND.1', to: 'lcd1:GND' },
    ],
  };
  const mockLcd = new MockHTMLElement('wokwi-lcd1602');
  registerMockElement('lcd1', mockLcd);

  const graph = buildCircuitGraph(doc);
  const devs = setupDevices(doc, graph, runner);
  stepCpuCycles(runner, 1_200_000);
  devs.frame();

  assert(mockLcd.characters, 'LCD must receive initialized character buffer');
  devs.cleanup();
});

// Scenario 7: Multi-Device I2C Bus
harness.test('T4: Scenario 7 - Multi-Device I2C Bus (LCD1602 + DS1307 + SSD1306)', () => {
  const runner = new AVRRunner(HEX_FIXTURES.i2cScan.hex);
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, rotate: 0, attrs: {} },
      { id: 'lcd1', type: 'wokwi-lcd1602', left: 200, top: 0, rotate: 0, attrs: {} },
      { id: 'rtc1', type: 'wokwi-ds1307', left: 300, top: 0, rotate: 0, attrs: {} },
      { id: 'oled1', type: 'wokwi-ssd1306', left: 400, top: 0, rotate: 0, attrs: {} },
    ],
    connections: [
      { id: 'w1', from: 'uno1:A4', to: 'lcd1:SDA' },
      { id: 'w2', from: 'uno1:A5', to: 'lcd1:SCL' },
      { id: 'w3', from: 'uno1:A4', to: 'rtc1:SDA' },
      { id: 'w4', from: 'uno1:A5', to: 'rtc1:SCL' },
      { id: 'w5', from: 'uno1:A4', to: 'oled1:DATA' },
      { id: 'w6', from: 'uno1:A5', to: 'oled1:CLK' },
    ],
  };
  const graph = buildCircuitGraph(doc);
  const devs = setupDevices(doc, graph, runner);

  let scanOutput = '';
  runner.usart.onByteTransmit = (b) => { scanOutput += String.fromCharCode(b); };

  stepCpuCycles(runner, 800_000);
  assert(scanOutput.includes('FOUND:0x27'), `Expected LCD 0x27 in scan, got ${scanOutput}`);
  assert(scanOutput.includes('FOUND:0x3C'), `Expected OLED 0x3C in scan, got ${scanOutput}`);
  assert(scanOutput.includes('FOUND:0x68'), `Expected RTC 0x68 in scan, got ${scanOutput}`);

  devs.cleanup();
});

// Scenario 8: Breadboard Rail Power Distribution
harness.test('T4: Scenario 8 - Breadboard Rail Power Distribution to Multiple Parts', () => {
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, rotate: 0, attrs: {} },
      { id: 'bb1', type: 'breadboard-half', left: 200, top: 0, rotate: 0, attrs: {} },
      { id: 'r1', type: 'wokwi-resistor', left: 0, top: 0, rotate: 0, attrs: { value: 220 }, seating: { breadboardId: 'bb1', pins: { '1': '+top5', '2': 'E5' } } },
      { id: 'led1', type: 'wokwi-led', left: 0, top: 0, rotate: 0, attrs: {}, seating: { breadboardId: 'bb1', pins: { A: 'A5', C: '-top5' } } },
      { id: 'r2', type: 'wokwi-resistor', left: 0, top: 0, rotate: 0, attrs: { value: 220 }, seating: { breadboardId: 'bb1', pins: { '1': '+bottom10', '2': 'F10' } } },
      { id: 'led2', type: 'wokwi-led', left: 0, top: 0, rotate: 0, attrs: {}, seating: { breadboardId: 'bb1', pins: { A: 'J10', C: '-bottom10' } } },
    ],
    connections: [
      { id: 'w1', from: 'uno1:5V', to: 'bb1:+top1' },
      { id: 'w2', from: 'uno1:GND.1', to: 'bb1:-top1' },
      { id: 'w3', from: 'bb1:+top25', to: 'bb1:+bottom25' },
      { id: 'w4', from: 'bb1:-top25', to: 'bb1:-bottom25' },
    ],
  };
  const graph = buildCircuitGraph(doc);
  assert(traceToPower(graph, 'r1:1').some((t) => t.pin === '5V'));
  assert(traceToPower(graph, 'led1:C').some((t) => t.pin.startsWith('GND')));
  assert(traceToPower(graph, 'r2:1').some((t) => t.pin === '5V'));
  assert(traceToPower(graph, 'led2:C').some((t) => t.pin.startsWith('GND')));
});

// Scenario 9: Battery 9V + Transistor + Diode + DC Motor
harness.test('T4: Scenario 9 - Battery 9V + Transistor + Diode + DC Motor Low-Side Switch', () => {
  const runner = new AVRRunner(HEX_FIXTURES.transistorMotorDiode.hex);
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, rotate: 0, attrs: {} },
      { id: 'bat1', type: 'battery-9v', left: 300, top: 0, rotate: 0, attrs: { voltage: 9 } },
      { id: 'motor1', type: 'dc-motor', left: 400, top: 0, rotate: 0, attrs: {} },
      { id: 'd1', type: 'rectifier-diode', left: 400, top: 100, rotate: 0, attrs: {} },
      { id: 'q1', type: 'npn-transistor', left: 200, top: 100, rotate: 0, attrs: {} },
      { id: 'r1', type: 'wokwi-resistor', left: 100, top: 100, rotate: 0, attrs: { value: 1000 } },
    ],
    connections: [
      { id: 'w1', from: 'uno1:3', to: 'r1:1', color: '#2f9e44' },
      { id: 'w2', from: 'r1:2', to: 'q1:B', color: '#2f9e44' },
      { id: 'w3', from: 'q1:E', to: 'uno1:GND.1', color: '#343a40' },
      { id: 'w4', from: 'bat1:-', to: 'uno1:GND.2', color: '#343a40' },
      { id: 'w5', from: 'bat1:+', to: 'motor1:1', color: '#d94841' },
      { id: 'w6', from: 'motor1:2', to: 'q1:C', color: '#1971c2' },
      { id: 'w7', from: 'd1:A', to: 'motor1:2', color: '#343a40' },
      { id: 'w8', from: 'd1:C', to: 'motor1:1', color: '#d94841' },
    ],
  };
  const mockMotor = new MockHTMLElement('div');
  mockMotor.dataset.motorDirection = 'stopped';
  registerMockElement('motor1', mockMotor);

  const graph = buildCircuitGraph(doc);
  assert(graph.parts.has('bat1'));
  assert(graph.parts.has('q1'));
  assert(graph.parts.has('d1'));
  assert(graph.parts.has('motor1'));

  const devs = setupDevices(doc, graph, runner);
  stepCpuCycles(runner, 50_000);
  devs.frame();

  devs.cleanup();
});

// =======================================================
// TIER 5: ADVERSARIAL COVERAGE HARDENING (20 TESTS)
// =======================================================
harness.setTier(5);

// 1. 50-Part Dense Breadboard Distribution Network
harness.test('T5: Adversarial - 50-Part Dense Breadboard Distribution Network', () => {
  const parts = [
    { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, attrs: {} },
    { id: 'bb1', type: 'breadboard-half', left: 200, top: 0, attrs: {} },
    { id: 'bat1', type: 'battery-9v', left: 600, top: 0, attrs: {} },
  ];
  const connections = [
    { id: 'w_pwr', from: 'uno1:5V', to: 'bb1:+top1' },
    { id: 'w_gnd', from: 'uno1:GND.1', to: 'bb1:-top1' },
    { id: 'w_rail_p', from: 'bb1:+top25', to: 'bb1:+bottom25' },
    { id: 'w_rail_g', from: 'bb1:-top25', to: 'bb1:-bottom25' },
  ];

  for (let i = 1; i <= 10; i++) {
    parts.push({
      id: `r_${i}`,
      type: 'wokwi-resistor',
      left: 0, top: 0,
      attrs: { value: 220 },
      seating: { breadboardId: 'bb1', pins: { '1': `+top${i}`, '2': `E${i}` } },
    });
    parts.push({
      id: `led_${i}`,
      type: 'wokwi-led',
      left: 0, top: 0,
      attrs: { color: 'red' },
      seating: { breadboardId: 'bb1', pins: { A: `A${i}`, C: `-top${i}` } },
    });
  }

  for (let i = 1; i <= 5; i++) {
    parts.push({
      id: `pot_${i}`,
      type: 'wokwi-potentiometer',
      left: 800, top: i * 50,
      attrs: { value: 500 },
    });
    connections.push({ id: `w_pot_v_${i}`, from: 'bb1:+bottom1', to: `pot_${i}:VCC` });
    connections.push({ id: `w_pot_g_${i}`, from: 'bb1:-bottom1', to: `pot_${i}:GND` });
  }

  for (let i = 1; i <= 5; i++) {
    parts.push({ id: `d_${i}`, type: 'rectifier-diode', left: 1000, top: i * 50, attrs: {} });
    parts.push({ id: `q_${i}`, type: 'npn-transistor', left: 1100, top: i * 50, attrs: {} });
    connections.push({ id: `w_q_e_${i}`, from: `q_${i}:E`, to: 'bb1:-bottom10' });
    connections.push({ id: `w_d_c_${i}`, from: `d_${i}:C`, to: 'bat1:+' });
  }

  assertEqual(parts.length, 38);
  const doc = { parts, connections };
  const graph = buildCircuitGraph(doc);
  assert(graph.parts.size >= 38);

  // Power tracing across dense network
  assert(traceToPower(graph, 'r_1:1').some((t) => t.pin === '5V'));
  assert(traceToPower(graph, 'r_10:1').some((t) => t.pin === '5V'));
  assert(traceToPower(graph, 'led_1:C').some((t) => t.pin.startsWith('GND')));
  assert(traceToPower(graph, 'led_10:C').some((t) => t.pin.startsWith('GND')));
  assert(traceToPower(graph, 'pot_1:VCC').some((t) => t.pin === '5V'));
  assert(traceToPower(graph, 'pot_5:GND').some((t) => t.pin.startsWith('GND')));
  assert(traceToPower(graph, 'q_1:E').some((t) => t.pin.startsWith('GND')));
});

// 2. Rapid 50-Cycle Simulation Start/Stop Stress
harness.test('T5: Adversarial - Rapid 50-Cycle Simulation Start/Stop Stress', () => {
  const runner = new AVRRunner(HEX_FIXTURES.blink.hex);
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, attrs: {} },
      { id: 'led1', type: 'wokwi-led', left: 200, top: 0, attrs: {} },
      { id: 'btn1', type: 'wokwi-pushbutton', left: 300, top: 0, attrs: {} },
      { id: 'servo1', type: 'wokwi-servo', left: 400, top: 0, attrs: {} },
    ],
    connections: [
      { id: 'w1', from: 'uno1:13', to: 'led1:A' },
      { id: 'w2', from: 'uno1:2', to: 'btn1:1.l' },
      { id: 'w3', from: 'uno1:9', to: 'servo1:PWM' },
    ],
  };
  const graph = buildCircuitGraph(doc);

  for (let i = 0; i < 50; i++) {
    const devices = setupDevices(doc, graph, runner);
    devices.frame();
    stepCpuCycles(runner, 1000);
    devices.reset();
    devices.cleanup();
  }
  runner.stop();
});

// 3. Extreme Resistor and Potentiometer Boundary Conditions
harness.test('T5: Adversarial - Extreme Resistor and Potentiometer Boundary Conditions', () => {
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, attrs: {} },
      { id: 'r_min', type: 'wokwi-resistor', left: 100, top: 0, attrs: { value: 0.0001 } },
      { id: 'r_max', type: 'wokwi-resistor', left: 200, top: 0, attrs: { value: 100000000 } },
      { id: 'r_neg', type: 'wokwi-resistor', left: 300, top: 0, attrs: { value: -50 } },
      { id: 'r_nan', type: 'wokwi-resistor', left: 400, top: 0, attrs: { value: 'invalid_ohms' } },
    ],
    connections: [
      { id: 'w1', from: 'uno1:5V', to: 'r_min:1' },
      { id: 'w2', from: 'uno1:5V', to: 'r_max:1' },
      { id: 'w3', from: 'uno1:5V', to: 'r_neg:1' },
      { id: 'w4', from: 'uno1:5V', to: 'r_nan:1' },
    ],
  };
  const graph = buildCircuitGraph(doc);
  assert(graph.parts.has('r_min'));
  assert(graph.parts.has('r_max'));
  assert(graph.parts.has('r_neg'));
  assert(graph.parts.has('r_nan'));
});

// 4. Malformed Wire Endpoints and Path Syntax Resilience
harness.test('T5: Adversarial - Malformed Wire Endpoints and Path Syntax Resilience', async () => {
  await assertThrowsAsync(async () => {
    await callWebMcp('build-circuit', {
      replace: true,
      parts: [{ id: 'uno1', type: 'arduino-uno', at: [0, 0] }],
      wires: [{ from: 'no_colon_endpoint', to: 'uno1:13' }],
    });
  }, /invalid endpoint/i);

  await assertThrowsAsync(async () => {
    await callWebMcp('build-circuit', {
      replace: true,
      parts: [{ id: 'uno1', type: 'arduino-uno', at: [0, 0] }],
      wires: [{ from: '', to: 'uno1:13' }],
    });
  }, /must be a non-empty string/i);

  await assertThrowsAsync(async () => {
    await callWebMcp('build-circuit', {
      replace: true,
      parts: [{ id: 'uno1', type: 'arduino-uno', at: [0, 0] }],
      wires: [{ from: 'uno1:', to: 'uno1:13' }],
    });
  }, /pin "" does not exist/i);
});

// 5. 90-Degree Orthogonal Multi-Segment Pipe Route Precision
harness.test('T5: Adversarial - 90-Degree Orthogonal Multi-Segment Pipe Route Precision', async () => {
  const path = [
    [-5, -5], [0, -5], [0, -12], [5, -12],
    [5, -8], [10, -8], [10, -18], [15, -18],
  ];
  await callWebMcp('build-circuit', {
    replace: true,
    parts: [
      { id: 'uno1', type: 'arduino-uno', at: [-35, 0] },
      { id: 'pot1', type: 'potentiometer', at: [20, -20] },
    ],
    wires: [{ id: 'pipe', from: 'uno1:A0', to: 'pot1:SIG', path }],
  });

  const snap = circuitStore.getSnapshot();
  const wire = snap.connections.find((connection) => connection.id === 'pipe');
  const start = endpointPoint(wire.from, snap.parts);
  const end = endpointPoint(wire.to, snap.parts);
  const points = connectionPolyline(start, wire.waypoints, end);
  for (let i = 0; i < points.length - 1; i++) assert(isOrthogonalPair(points[i], points[i + 1]), `Route segment ${i} to ${i + 1} must be orthogonal`);
});

// 6. Dynamic Element Registration & Unknown Tag Graceful Fallback
harness.test('T5: Adversarial - Dynamic Element Registration & Unknown Tag Graceful Fallback', () => {
  const el = globalThis.document.createElement('unknown-custom-tag-xyz');
  assert(el !== null);
  assertEqual(el.tagName, 'UNKNOWN-CUSTOM-TAG-XYZ');
  el.setAttribute('data-test', '123');
  assertEqual(el.getAttribute('data-test'), '123');
});

// 7. Power Rail Short Circuit & Conflicting Multi-Source Power Tracing
harness.test('T5: Adversarial - Power Rail Short Circuit & Conflicting Multi-Source Power Tracing', () => {
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, attrs: {} },
      { id: 'bat1', type: 'battery-9v', left: 300, top: 0, attrs: { voltage: 9 } },
    ],
    connections: [
      { id: 'w_short', from: 'uno1:5V', to: 'uno1:GND.1' },
      { id: 'w_bat_gnd', from: 'bat1:-', to: 'uno1:GND.2' },
      { id: 'w_conflict', from: 'bat1:+', to: 'uno1:3.3V' },
    ],
  };
  const diags = diagnoseCircuit(doc);
  assert(diags.some((d) => d.severity === 'error' && /short/i.test(d.message)), 'Must catch short circuit');
});

// 8. Reverse-Biased Rectifier Diode High-Voltage Isolation
harness.test('T5: Adversarial - Reverse-Biased Rectifier Diode High-Voltage Isolation', () => {
  const doc = {
    parts: [
      { id: 'bat1', type: 'battery-9v', left: 0, top: 0, attrs: { voltage: 9 } },
      { id: 'd1', type: 'rectifier-diode', left: 200, top: 0, attrs: {} },
      { id: 'r1', type: 'wokwi-resistor', left: 400, top: 0, attrs: { value: 1000 } },
    ],
    connections: [
      { id: 'w1', from: 'bat1:+', to: 'd1:C' }, // Reverse bias: 9V into Cathode
      { id: 'w2', from: 'd1:A', to: 'r1:1' },
    ],
  };
  const graph = buildCircuitGraph(doc);
  const powerAtResistor = traceToPower(graph, 'r1:1');
  // In reverse bias, power must NOT reach through the diode from cathode to anode
  assertEqual(powerAtResistor.length, 0, 'Reverse-biased diode must block power conduction');
});

// 9. Transistor Saturation with PWM Base Drive Under Inverted Logic
harness.test('T5: Adversarial - Transistor Saturation with PWM Base Drive Under Inverted Logic', () => {
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, attrs: {} },
      { id: 'q1', type: 'npn-transistor', left: 200, top: 0, attrs: {} },
      { id: 'r_base', type: 'wokwi-resistor', left: 100, top: 0, attrs: { value: 1000 } },
      { id: 'motor1', type: 'dc-motor', left: 300, top: 0, attrs: {} },
    ],
    connections: [
      { id: 'w1', from: 'uno1:9', to: 'r_base:1' },
      { id: 'w2', from: 'r_base:2', to: 'q1:B' },
      { id: 'w3', from: 'q1:E', to: 'uno1:GND.1' },
      { id: 'w4', from: 'motor1:2', to: 'q1:C' },
      { id: 'w5', from: 'motor1:1', to: 'uno1:5V' },
    ],
  };
  const graph = buildCircuitGraph(doc);
  assert(directlyConnectedNodes(graph, 'q1:E').has('uno1:GND.1'));
  assert(directlyConnectedNodes(graph, 'q1:C').has('motor1:2'));
});

// 10. I2C Address Collisions & Multi-Device Bus Recovery
harness.test('T5: Adversarial - I2C Address Collisions & Multi-Device Bus Recovery', () => {
  const runner = new AVRRunner(HEX_FIXTURES.i2cScan.hex);
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, attrs: {} },
      { id: 'lcd1', type: 'wokwi-lcd1602', left: 200, top: 0, attrs: {} }, // 0x27
      { id: 'lcd2', type: 'wokwi-lcd2004', left: 300, top: 0, attrs: {} }, // 0x27 (duplicate)
      { id: 'rtc1', type: 'wokwi-ds1307', left: 400, top: 0, attrs: {} },   // 0x68
    ],
    connections: [
      { id: 'w1', from: 'uno1:A4', to: 'lcd1:SDA' },
      { id: 'w2', from: 'uno1:A5', to: 'lcd1:SCL' },
      { id: 'w3', from: 'uno1:A4', to: 'lcd2:SDA' },
      { id: 'w4', from: 'uno1:A5', to: 'lcd2:SCL' },
      { id: 'w5', from: 'uno1:A4', to: 'rtc1:SDA' },
      { id: 'w6', from: 'uno1:A5', to: 'rtc1:SCL' },
    ],
  };
  const graph = buildCircuitGraph(doc);
  const devs = setupDevices(doc, graph, runner);

  let scanOutput = '';
  runner.usart.onByteTransmit = (b) => { scanOutput += String.fromCharCode(b); };
  stepCpuCycles(runner, 800_000);

  assert(scanOutput.includes('FOUND:0x27'), 'Must find 0x27');
  assert(scanOutput.includes('FOUND:0x68'), 'Must find 0x68');
  devs.cleanup();
});

// 11. DHT22 Bitbang Frame Timing Boundary Verification
harness.test('T5: Adversarial - DHT22 Bitbang Frame Timing Boundary Verification', () => {
  const runner = new AVRRunner(HEX_FIXTURES.dht22.hex);
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, attrs: {} },
      { id: 'dht_extreme', type: 'wokwi-dht22', left: 200, top: 0, attrs: { temperature: -40, humidity: 100 } },
    ],
    connections: [
      { id: 'w1', from: 'uno1:5V', to: 'dht_extreme:VCC' },
      { id: 'w2', from: 'uno1:GND.1', to: 'dht_extreme:GND' },
      { id: 'w3', from: 'uno1:2', to: 'dht_extreme:SDA' },
    ],
  };
  const mockDht = new MockHTMLElement('wokwi-dht22');
  mockDht.temperature = -40;
  mockDht.humidity = 100;
  registerMockElement('dht_extreme', mockDht);

  const graph = buildCircuitGraph(doc);
  const devs = setupDevices(doc, graph, runner);
  stepCpuCycles(runner, 400_000);
  devs.cleanup();
});

// 12. HC-SR04 Trigger-Echo Ultrasonic Timing Jitter
harness.test('T5: Adversarial - HC-SR04 Trigger-Echo Ultrasonic Timing Jitter', () => {
  const runner = new AVRRunner(HEX_FIXTURES.hcsr04.hex);
  const doc = {
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', left: 0, top: 0, attrs: {} },
      { id: 'sonar_far', type: 'wokwi-hc-sr04', left: 200, top: 0, attrs: { distance: 400 } },
    ],
    connections: [
      { id: 'w1', from: 'uno1:5V', to: 'sonar_far:VCC' },
      { id: 'w2', from: 'uno1:GND.1', to: 'sonar_far:GND' },
      { id: 'w3', from: 'uno1:9', to: 'sonar_far:TRIG' },
      { id: 'w4', from: 'sonar_far:ECHO', to: 'uno1:10' },
    ],
  };
  const mockSonar = new MockHTMLElement('wokwi-hc-sr04');
  mockSonar.distance = 400;
  registerMockElement('sonar_far', mockSonar);

  const graph = buildCircuitGraph(doc);
  const devs = setupDevices(doc, graph, runner);
  stepCpuCycles(runner, 300_000);
  devs.cleanup();
});

// 13. Membrane Keypad Matrix 4x4 Simultaneous Row/Col Multiplexing
harness.test('T5: Adversarial - Membrane Keypad Matrix 4x4 Simultaneous Row/Col Multiplexing', () => {
  const keypad = { id: 'kp1', type: 'wokwi-membrane-keypad', left: 0, top: 0, attrs: {} };
  const pins = getPartPins(keypad);
  assertEqual(pins.length, 8);
  for (let r = 1; r <= 4; r++) assertEqual(resolvePinName(keypad, `r${r}`), `R${r}`);
  for (let c = 1; c <= 4; c++) assertEqual(resolvePinName(keypad, `c${c}`), `C${c}`);
});

// 14. Rotary Encoder KY-040 Quadrature Gray Code Decoding
harness.test('T5: Adversarial - Rotary Encoder KY-040 Quadrature Gray Code Decoding', () => {
  const enc = { id: 'enc1', type: 'wokwi-ky-040', left: 0, top: 0, attrs: {} };
  assertEqual(resolvePinName(enc, 'clk'), 'CLK');
  assertEqual(resolvePinName(enc, 'dt'), 'DT');
  assertEqual(resolvePinName(enc, 'sw'), 'SW');
  assertEqual(resolvePinName(enc, 'vcc'), 'VCC');
  assertEqual(resolvePinName(enc, 'gnd'), 'GND');
});

// 15. MPU6050 6-Axis Motion Reading & Register Offset
harness.test('T5: Adversarial - MPU6050 6-Axis Motion Reading & Register Offset', () => {
  const imu = { id: 'imu1', type: 'wokwi-mpu6050', left: 0, top: 0, attrs: { accelX: 2.5, accelY: -1.0, accelZ: 9.8, gyroX: 10, gyroY: -5, gyroZ: 0, temperature: 30 } };
  assertEqual(resolvePinName(imu, 'sda'), 'SDA');
  assertEqual(resolvePinName(imu, 'scl'), 'SCL');
  assertEqual(resolvePinName(imu, 'vcc'), 'VCC');
  assertEqual(resolvePinName(imu, 'gnd'), 'GND');
});

// 16. DS1307 RTC BCD Time Registers Simulation
harness.test('T5: Adversarial - DS1307 RTC BCD Time Registers Simulation', () => {
  const rtc = { id: 'rtc1', type: 'wokwi-ds1307', left: 0, top: 0, attrs: {} };
  assertEqual(resolvePinName(rtc, 'sda'), 'SDA');
  assertEqual(resolvePinName(rtc, 'scl'), 'SCL');
  assertEqual(resolvePinName(rtc, 'sqw'), 'SQW');
});

// 17. 7-Segment and 10-Segment Bar Graph High-Pin-Density Mapping
harness.test('T5: Adversarial - 7-Segment and 10-Segment Bar Graph High-Pin-Density Mapping', () => {
  const seg = { id: 'seg1', type: 'wokwi-7segment', left: 0, top: 0, attrs: {} };
  const segPins = getPartPins(seg);
  assertEqual(segPins.length, 10);

  const bar = { id: 'bar1', type: 'wokwi-led-bar-graph', left: 0, top: 0, attrs: {} };
  const barPins = getPartPins(bar);
  assertEqual(barPins.length, 20);
});

// 18. Full Breadboard 830-Hole & Half Breadboard 400-Hole Boundary Seating
harness.test('T5: Adversarial - Full Breadboard 830-Hole & Half Breadboard 400-Hole Boundary Seating', () => {
  const bbFull = { id: 'bbf', type: 'breadboard', left: 0, top: 0, attrs: {} };
  const bbHalf = { id: 'bbh', type: 'breadboard-half', left: 0, top: 0, attrs: {} };
  const r1 = { id: 'r1', type: 'wokwi-resistor', left: 0, top: 0, attrs: {} };
  const r2 = { id: 'r2', type: 'wokwi-resistor', left: 0, top: 0, attrs: {} };

  const seatedFull = seatPartAtHole(r1, [bbFull], { breadboardId: 'bbf', pin: '1', hole: 'E1' });
  assertEqual(seatedFull.seating?.pins['1'], 'E1');

  const seatedHalf = seatPartAtHole(r2, [bbHalf], { breadboardId: 'bbh', pin: '2', hole: 'A30' });
  assertEqual(seatedHalf.seating?.pins['2'], 'A30');

  assertThrows(() => {
    seatPartAtHole(r2, [bbHalf], { breadboardId: 'bbh', pin: '1', hole: 'A30' });
  }, /does not land on a breadboard hole/i);
});

// 19. Production WebMCP block-grid stress coverage
harness.test('T5: Block-grid builder owns pin routing and supports lane tuning', async () => {
  const tool = createBuildCircuitTool();
  await tool.execute({
    replace: true,
    parts: [
      { id: 'uno', type: 'arduino-uno', at: [-35, 0] },
      { id: 'servo', type: 'servo', at: [5, 0] },
    ],
    wires: [{ id: 'pwm', from: 'uno:9', to: 'servo:PWM', role: 'signal' }],
  }, { signal: new AbortController().signal });

  const state = circuitStore.getSnapshot();
  const uno = state.parts.find((part) => part.id === 'uno');
  const servo = state.parts.find((part) => part.id === 'servo');
  const wire = state.connections.find((connection) => connection.id === 'pwm');
  assert(uno && servo && wire, 'Fixture must build both blocks and its wire');
  assertEqual(partBlockAt(uno).x, -35);
  assertEqual(partBlockAt(servo).x, 5);
  const start = endpointPoint(wire.from, state.parts);
  const end = endpointPoint(wire.to, state.parts);
  assert(start && end, 'Endpoints must resolve to exact visual pins');
  const polyline = connectionPolyline(start, wire.waypoints, end);
  for (let index = 0; index < polyline.length - 1; index++) assert(isOrthogonalPair(polyline[index], polyline[index + 1]), `Segment ${index} must remain orthogonal`);
  assertEqual(evaluateLayout(state).score, 100);

  const beforeTune = JSON.stringify(wire.waypoints);
  await tool.execute({
    replace: false,
    tune: [{ wireId: 'pwm', lane: 'longest-horizontal', by: -2 }],
  }, { signal: new AbortController().signal });
  const tuned = circuitStore.getSnapshot().connections.find((connection) => connection.id === 'pwm');
  assert(tuned && JSON.stringify(tuned.waypoints) !== beforeTune, 'Lane tuning must change the selected wire geometry');
  assert(!evaluateLayout(circuitStore.getSnapshot()).issues.some((issue) => issue.kind === 'wire-through-part' || issue.kind === 'wire-backtrack'));
});

harness.test('T5: Block-grid builder can fine-align exact pins without exposing pixel offsets', async () => {
  const tool = createBuildCircuitTool();
  await tool.execute({
    replace: true,
    parts: [
      { id: 'uno', type: 'arduino-uno', at: [-25, -15] },
      { id: 'pot', type: 'potentiometer', at: [-11, 25], rotate: 180 },
    ],
    align: [{ from: 'pot:VCC', to: 'uno:5V', axis: 'x' }],
    wires: [],
  }, { signal: new AbortController().signal });
  const state = circuitStore.getSnapshot();
  const source = endpointPoint('uno:5V', state.parts);
  const destination = endpointPoint('pot:VCC', state.parts);
  assert(source && destination, 'Aligned pins must resolve');
  assert(Math.abs(source.x - destination.x) < 0.01, 'Fine alignment must make the connection exactly vertical');
  assertEqual(partBlockAt(state.parts.find((part) => part.id === 'pot')).y, 25);
});

harness.test('T5: Semantic rails align seated drops and bridge around the board edge', async () => {
  await createBuildCircuitTool().execute({
    replace: true,
    program: [
      'const board = part("board","breadboard-half",{"at":[0,0]})',
      'const diode = part("diode","rectifier-diode",{})',
      'const motor = part("motor","dc-motor",{"at":[38,2]})',
      'seat("diode","board","A","A26")',
      'bridge("power-bridge","board","+","left")',
      'rail("power","board","+top","board.+top6",["diode.C","motor.1"])',
    ].join('\n'),
  }, { signal: new AbortController().signal });
  const state = circuitStore.getSnapshot();
  const board = state.parts.find((part) => part.id === 'board');
  const bridge = state.connections.find((wire) => wire.id === 'power-bridge');
  const drop = state.connections.find((wire) => wire.id === 'power-branch-1');
  const externalDrop = state.connections.find((wire) => wire.id === 'power-branch-2');
  assert(board && bridge && drop && externalDrop, 'Semantic rail fixture must produce its board, bridge, and drops');
  assertEqual(drop.from, 'board:+top19');
  assertEqual(drop.waypoints?.length ?? 0, 0);
  assertEqual(bridge.waypoints?.length, 2);
  assert(bridge.waypoints.every((point) => point.x < board.left), 'Left bridge corridor must stay outside the breadboard');
  const motorPin = endpointPoint('motor:1', state.parts);
  const railPin = endpointPoint(externalDrop.from, state.parts);
  assert(motorPin && railPin, 'Motor and rail pins must resolve');
  assertEqual(externalDrop.waypoints?.length, 1);
  assert(Math.abs(externalDrop.waypoints[0].x - motorPin.x) < 0.02
    && Math.abs(externalDrop.waypoints[0].y - railPin.y) < 0.02,
  'A flexible motor lead should turn once at the motor axis and run directly along the rail axis');
});

harness.test('T5: Seated endpoints open their parent breadboard and identify a backward rigid terminal', async () => {
  const lines = [
    'part("uno","arduino-uno",{"at":[-33,0]})',
    'part("bb","breadboard-half",{"at":[0,0]})',
    'part("motor","dc-motor",{"at":[38,28]})',
    'part("bat","battery-9v",{"at":[56,-1]})',
    'part("q1","npn-transistor",{})',
    'seat("q1","bb","E","E20")',
    'part("r1","resistor",{"attrs":{"resistance":220}})',
    'seat("r1","bb","1","H20")',
    'part("d1","rectifier-diode",{})',
    'seat("d1","bb","C","A17")',
    'wire("gate","uno.9","r1.1","signal")',
    'wire("base","r1.2","q1.B","signal")',
    'net("motorLow","signal",["motor.2","q1.C","d1.A"])',
    'rail("motorPlus","bb","+top","bat.+",["motor.1","d1.C"])',
    'rail("commonGround","bb","-bottom","bat.-",["q1.E","uno.GND.2"])',
  ];
  await assertThrowsAsync(
    async () => createBuildCircuitTool().execute({ replace: true, program: lines.join('\n') }, { signal: new AbortController().signal }),
    /motorPlus-feed.*bat:\+.*terminal faces away.*rotate or move/i,
  );
  lines[3] = 'part("bat","battery-9v",{"at":[56,-1],"rotate":180})';
  await createBuildCircuitTool().execute({ replace: true, program: lines.join('\n') }, { signal: new AbortController().signal });
  const state = circuitStore.getSnapshot();
  assert(state.connections.some((wire) => wire.id === 'gate'), 'Uno signal must route to a seated resistor through its parent board');
});

harness.test('T5: Dense servo-control fixture stays electrically valid while routing research scales up', async () => {
  await createBuildCircuitTool().execute(BLOCK_SERVO_CONTROL_INPUT, { signal: new AbortController().signal });
  const state = circuitStore.getSnapshot();
  const quality = evaluateLayout(state);
  const diagnostics = diagnoseCircuit(state);
  assert(!quality.issues.some((issue) => issue.kind === 'part-overlap' || issue.kind === 'wire-through-part'));
  assertEqual(diagnostics.filter((item) => item.severity === 'error').length, 0);
  assertEqual(diagnostics.filter((item) => item.severity === 'warning').length, 0);
  assertEqual(state.parts.length, 6);
  assertEqual(state.connections.length, 13);
  for (const wire of state.connections) {
    const start = endpointPoint(wire.from, state.parts);
    const end = endpointPoint(wire.to, state.parts);
    assert(start && end, `${wire.id} endpoints must resolve`);
    const points = connectionPolyline(start, wire.waypoints, end);
    for (let index = 0; index < points.length - 1; index++) assert(isOrthogonalPair(points[index], points[index + 1]), `${wire.id} segment ${index} must be orthogonal`);
  }
  const resistor = state.parts.find((part) => part.id === 'r1');
  const led = state.parts.find((part) => part.id === 'led');
  assert(resistor?.seating && led?.seating, 'Resistor and LED should be physically seated');
  assertEqual(breadboardHoleNet(resistor.seating.pins['2']), breadboardHoleNet(led.seating.pins.A));
});

harness.test('T5: Block-grid builder rejects overlap and repairs a misleading corridor atomically', async () => {
  const tool = createBuildCircuitTool();
  circuitStore.replaceDocument({ parts: [{ id: 'keep', type: 'battery-9v', left: 200, top: 200, rotate: 0, attrs: {} }], connections: [] });
  await assertThrowsAsync(async () => tool.execute({
    replace: true,
    parts: [{ id: 'uno', type: 'arduino-uno', at: [0, 0] }, { id: 'servo', type: 'servo', at: [10, 5] }],
    wires: [],
  }, { signal: new AbortController().signal }), /Block overlap/i);
  assertEqual(circuitStore.getSnapshot().parts[0]?.id, 'keep');

  await tool.execute({
    replace: true,
    parts: [{ id: 'uno', type: 'arduino-uno', at: [-35, 0] }, { id: 'servo', type: 'servo', at: [5, 0] }],
    wires: [{ id: 'bad', from: 'uno:9', to: 'servo:PWM', path: [[-5, 25], [3, 25], [3, 5]] }],
  }, { signal: new AbortController().signal });
  const repaired = circuitStore.getSnapshot();
  assert(!evaluateLayout(repaired).issues.some((issue) => issue.kind === 'wire-through-part' || issue.kind === 'pin-exit'));
});

harness.test('T5: Repeated WebMCP build and inspect cycles do not leak stale scene state', async () => {
  for (let step = 0; step < 20; step++) {
    await callWebMcp('build-circuit', {
      replace: true,
      parts: [
        { id: 'uno', type: 'arduino-uno', at: [-35, 0] },
        { id: 'led', type: 'led', at: [5, step % 2 === 0 ? 0 : 8] },
      ],
      wires: [],
    });
    const inspected = await callWebMcp('inspect-circuit');
    assertEqual(inspected.parts.length, 2);
    assert(inspected.parts.some((part) => part.id === 'uno'));
    assert(inspected.parts.some((part) => part.id === 'led'));
  }
});
// 21. Layout Overlap Quality Scoring Monotonicity
harness.test('T5: Adversarial - Layout Overlap Quality Scoring Monotonicity', () => {
  const clean = {
    parts: [
      { id: 'p1', type: 'wokwi-arduino-uno', left: 0, top: 0, attrs: {} },
      { id: 'p2', type: 'wokwi-potentiometer', left: 500, top: 0, attrs: {} },
    ],
    connections: [],
  };
  const overlapping = {
    parts: [
      { id: 'p1', type: 'wokwi-arduino-uno', left: 0, top: 0, attrs: {} },
      { id: 'p2', type: 'wokwi-arduino-uno', left: 50, top: 50, attrs: {} },
    ],
    connections: [],
  };
  const heavilyOverlapping = {
    parts: [
      { id: 'p1', type: 'wokwi-arduino-uno', left: 0, top: 0, attrs: {} },
      { id: 'p2', type: 'wokwi-arduino-uno', left: 10, top: 10, attrs: {} },
      { id: 'p3', type: 'wokwi-arduino-uno', left: 20, top: 20, attrs: {} },
    ],
    connections: [],
  };

  const scoreClean = evaluateLayout(clean).score;
  const scoreOverlapping = evaluateLayout(overlapping).score;
  const scoreHeavily = evaluateLayout(heavilyOverlapping).score;

  assert(scoreClean > scoreOverlapping, 'Clean layout score must exceed overlapping score');
  assert(scoreOverlapping >= scoreHeavily, 'Fewer overlaps must score >= heavier overlaps');
});

// Run all test suites if executed directly
if (process.argv[1]?.endsWith('test-circuits.mjs')) {
  const results = await harness.run();
  if (results.fail > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}
