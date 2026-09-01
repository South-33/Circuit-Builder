import { PART_TYPES } from './partTypes';
import type { CircuitPart, PartAttrs, PartType, PinInfo } from '../circuit/types';
import {
  BREADBOARD_HEIGHT,
  BREADBOARD_WIDTH,
  getBreadboardGeometry,
} from '../breadboard/geometry';

const DC_MOTOR_PINS: readonly PinInfo[] = [
  // Fritzing's flexible motor leads terminate at the left edge of the
  // breadboard artwork. Coordinates are converted from its 120.132x55.721
  // SVG viewBox into CSS pixels at 96dpi.
  { name: '1', x: 0, y: 34.10, signals: [] },
  { name: '2', x: 0, y: 44.08, signals: [] },
];

const FRITZING_SCALE = 4 / 3;
const NPN_TRANSISTOR_PINS: readonly PinInfo[] = [
  { name: 'E', x: 1.08 * FRITZING_SCALE, y: 22.581 * FRITZING_SCALE, description: 'Emitter', signals: [] },
  { name: 'B', x: 8.28 * FRITZING_SCALE, y: 22.581 * FRITZING_SCALE, description: 'Base', signals: [] },
  { name: 'C', x: 15.48 * FRITZING_SCALE, y: 22.581 * FRITZING_SCALE, description: 'Collector', signals: [] },
];
const RECTIFIER_DIODE_PINS: readonly PinInfo[] = [
  { name: 'C', x: 0.511 * FRITZING_SCALE, y: 3.594 * FRITZING_SCALE, description: 'Cathode', signals: [] },
  { name: 'A', x: 29.311 * FRITZING_SCALE, y: 3.594 * FRITZING_SCALE, description: 'Anode', signals: [] },
];
const BATTERY_9V_PINS: readonly PinInfo[] = [
  { name: '-', x: 95.628 * FRITZING_SCALE, y: 17.657 * FRITZING_SCALE, description: 'Negative terminal', signals: [{ type: 'power', voltage: 0 }] },
  { name: '+', x: 95.628 * FRITZING_SCALE, y: 10.458 * FRITZING_SCALE, description: 'Positive terminal', signals: [{ type: 'power', voltage: 9 }] },
];
const PNP_TRANSISTOR_PINS: readonly PinInfo[] = [
  { name: 'E', x: 1.08 * FRITZING_SCALE, y: 22.581 * FRITZING_SCALE, description: 'Emitter', signals: [] },
  { name: 'B', x: 8.28 * FRITZING_SCALE, y: 22.581 * FRITZING_SCALE, description: 'Base', signals: [] },
  { name: 'C', x: 15.48 * FRITZING_SCALE, y: 22.581 * FRITZING_SCALE, description: 'Collector', signals: [] },
];
const ZENER_DIODE_PINS: readonly PinInfo[] = [
  { name: 'C', x: 0.511 * FRITZING_SCALE, y: 3.594 * FRITZING_SCALE, description: 'Cathode', signals: [] },
  { name: 'A', x: 29.311 * FRITZING_SCALE, y: 3.594 * FRITZING_SCALE, description: 'Anode', signals: [] },
];
const BATTERY_AA_PINS: readonly PinInfo[] = [
  { name: '-', x: 12, y: 58, description: 'Negative terminal', signals: [{ type: 'power', voltage: 0 }] },
  { name: '+', x: 210, y: 58, description: 'Positive terminal', signals: [{ type: 'power', voltage: 3 }] },
];
const BATTERY_COIN_CELL_PINS: readonly PinInfo[] = [
  { name: '+', x: 48, y: 15, description: 'Positive terminal', signals: [{ type: 'power', voltage: 3 }] },
  { name: '-', x: 48, y: 95, description: 'Negative terminal', signals: [{ type: 'power', voltage: 0 }] },
];

export type PartDefinition = {
  type: PartType;
  name: string;
  idPrefix: string;
  category: PartCategory;
  tag?: string;
  asset?: string;
  defaults: PartAttrs;
  previewScale: number;
  renderScale: number;
  naturalSize: { width: number; height: number };
  simulated: boolean;
  pinSummary: string;
  /** Pins whose visible cable can leave in any direction instead of a rigid header axis. */
  flexibleLeadPins?: string[];
  breadboardMount?: boolean;
  keywords?: string[];
  properties?: PartPropertyDefinition[];
};

export type PartCategory = 'Boards' | 'Layout' | 'Basic' | 'Input' | 'Output' | 'Motion' | 'Sensors';

export type PartPropertyDefinition = {
  key: string;
  label: string;
  kind: 'number' | 'range' | 'select' | 'toggle';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: Array<{ value: string | number | boolean; label: string }>;
};

export const PART_DEFINITIONS: Record<PartType, PartDefinition> = {
  'wokwi-arduino-uno': {
    type: 'wokwi-arduino-uno',
    name: 'Arduino Uno',
    idPrefix: 'uno',
    category: 'Boards',
    tag: 'wokwi-arduino-uno',
    defaults: {},
    previewScale: 0.42,
    // Keep the 9.5px header pitch close to the shared 9.6px routing lattice.
    renderScale: 9.6 / 9.5,
    naturalSize: { width: 274, height: 202 },
    simulated: true,
    pinSummary: 'Digital 0-13, analog A0-A5, 5V, 3.3V, GND.1-GND.3, VIN, RESET',
  },
  breadboard: {
    type: 'breadboard',
    name: 'Breadboard',
    idPrefix: 'bb',
    category: 'Layout',
    defaults: {},
    previewScale: 0.13,
    renderScale: 1,
    naturalSize: { width: BREADBOARD_WIDTH, height: BREADBOARD_HEIGHT },
    simulated: true,
    pinSummary: 'Rows A-E and F-J, columns 1-63. Rails: +top1..50, -top1..50, +bottom1..50, -bottom1..50',
  },
  'breadboard-half': {
    type: 'breadboard-half',
    name: 'Half Breadboard',
    idPrefix: 'bb',
    category: 'Layout',
    defaults: {},
    previewScale: 0.22,
    renderScale: 1,
    naturalSize: {
      width: 245.037 * (4 / 3),
      height: BREADBOARD_HEIGHT,
    },
    simulated: true,
    pinSummary: 'Rows A-E and F-J, columns 1-30. Rails: +top1..25, -top1..25, +bottom1..25, -bottom1..25',
  },
  'wokwi-led': {
    type: 'wokwi-led',
    name: 'LED',
    idPrefix: 'led',
    category: 'Output',
    tag: 'wokwi-led',
    defaults: { color: 'red' },
    previewScale: 1.25,
    renderScale: 0.96,
    naturalSize: { width: 40, height: 50 },
    simulated: true,
    pinSummary: 'A = anode, C = cathode',
    breadboardMount: true,
    properties: [{
      key: 'color', label: 'Color', kind: 'select', options: [
        { value: 'red', label: 'Red' }, { value: 'green', label: 'Green' },
        { value: 'blue', label: 'Blue' }, { value: 'yellow', label: 'Yellow' },
        { value: 'orange', label: 'Orange' }, { value: 'white', label: 'White' },
      ],
    }],
  },
  'wokwi-rgb-led': {
    type: 'wokwi-rgb-led',
    name: 'RGB LED',
    idPrefix: 'rgb',
    category: 'Output',
    tag: 'wokwi-rgb-led',
    defaults: { common: 'cathode' },
    previewScale: 1.05,
    renderScale: 1.0323,
    naturalSize: { width: 43, height: 73 },
    simulated: true,
    pinSummary: 'R, G, B and COM',
    breadboardMount: true,
    properties: [{
      key: 'common', label: 'Common', kind: 'select', options: [
        { value: 'cathode', label: 'Cathode' }, { value: 'anode', label: 'Anode' },
      ],
    }],
  },
  'wokwi-resistor': {
    type: 'wokwi-resistor',
    name: 'Resistor',
    idPrefix: 'r',
    category: 'Basic',
    tag: 'wokwi-resistor',
    defaults: { value: '220' },
    previewScale: 1.25,
    renderScale: 57.6 / 58.8,
    naturalSize: { width: 58.8, height: 11.34 },
    simulated: true,
    pinSummary: 'Pins 1 and 2',
    breadboardMount: true,
    properties: [{ key: 'value', label: 'Resistance', kind: 'number', min: 1, max: 10_000_000, step: 1, unit: 'ohm' }],
  },
  'npn-transistor': {
    type: 'npn-transistor',
    name: 'NPN Transistor',
    idPrefix: 'q',
    category: 'Basic',
    asset: '/assets/fritzing/npn-transistor.svg',
    defaults: {},
    previewScale: 1.55,
    renderScale: 1,
    naturalSize: { width: 16.527 * FRITZING_SCALE, height: 24.081 * FRITZING_SCALE },
    simulated: true,
    pinSummary: 'E = emitter, B = base, C = collector.',
    breadboardMount: true,
    keywords: ['transistor', 'npn', 'bjt', 'switch', '2n2222'],
  },
  'rectifier-diode': {
    type: 'rectifier-diode',
    name: 'Rectifier Diode',
    idPrefix: 'd',
    category: 'Basic',
    asset: '/assets/fritzing/rectifier-diode.svg',
    defaults: {},
    previewScale: 1.35,
    renderScale: 1,
    naturalSize: { width: 29.879 * FRITZING_SCALE, height: 7.2 * FRITZING_SCALE },
    simulated: true,
    pinSummary: 'A = anode, C = cathode. Useful as a flyback diode across inductive loads.',
    breadboardMount: true,
    keywords: ['diode', 'rectifier', '1n4001', 'flyback'],
  },
  'battery-9v': {
    type: 'battery-9v',
    name: '9V Battery',
    idPrefix: 'bat',
    category: 'Basic',
    asset: '/assets/fritzing/battery-9v.svg',
    defaults: { voltage: 9 },
    previewScale: 0.24,
    renderScale: 1,
    naturalSize: { width: 95.269 * FRITZING_SCALE, height: 151.872 * FRITZING_SCALE },
    simulated: true,
    pinSummary: '+ = positive supply, - = negative/return.',
    keywords: ['battery', '9v', 'power', 'supply'],
    properties: [{ key: 'voltage', label: 'Voltage', kind: 'number', min: 1, max: 12, step: 0.1, unit: 'V' }],
  },
  'wokwi-pushbutton': {
    type: 'wokwi-pushbutton',
    name: 'Pushbutton',
    idPrefix: 'button',
    category: 'Input',
    tag: 'wokwi-pushbutton',
    defaults: { color: 'red' },
    previewScale: 1.1,
    renderScale: 1,
    naturalSize: { width: 68, height: 48 },
    simulated: true,
    pinSummary: '1.l and 1.r are one side. 2.l and 2.r are the other side.',
    breadboardMount: true,
    properties: [{
      key: 'color', label: 'Color', kind: 'select', options: [
        { value: 'red', label: 'Red' }, { value: 'green', label: 'Green' },
        { value: 'blue', label: 'Blue' }, { value: 'yellow', label: 'Yellow' },
        { value: 'white', label: 'White' }, { value: 'black', label: 'Black' },
      ],
    }],
  },
  'wokwi-slide-switch': {
    type: 'wokwi-slide-switch',
    name: 'Slide Switch',
    idPrefix: 'switch',
    category: 'Input',
    tag: 'wokwi-slide-switch',
    defaults: {},
    previewScale: 1.1,
    renderScale: 1,
    naturalSize: { width: 33, height: 36 },
    simulated: true,
    pinSummary: 'Pins 1, 2, 3. Pin 2 is common.',
    breadboardMount: true,
  },
  'wokwi-potentiometer': {
    type: 'wokwi-potentiometer',
    name: 'Potentiometer',
    idPrefix: 'pot',
    category: 'Input',
    tag: 'wokwi-potentiometer',
    defaults: { value: 512 },
    previewScale: 0.95,
    renderScale: 0.96,
    naturalSize: { width: 76, height: 76 },
    simulated: true,
    pinSummary: 'VCC, SIG, GND',
    properties: [
      { key: 'value', label: 'Value', kind: 'number', min: 0, max: 1023, step: 1 },
    ],
  },
  'wokwi-buzzer': {
    type: 'wokwi-buzzer',
    name: 'Buzzer',
    idPrefix: 'buzzer',
    category: 'Output',
    tag: 'wokwi-buzzer',
    defaults: {},
    previewScale: 0.9,
    renderScale: 0.96,
    naturalSize: { width: 65, height: 86 },
    simulated: true,
    pinSummary: 'Pins 1 and 2',
    breadboardMount: true,
  },
  'wokwi-7segment': {
    type: 'wokwi-7segment',
    name: '7-Segment',
    idPrefix: 'seg',
    category: 'Output',
    tag: 'wokwi-7segment',
    defaults: { color: 'red' },
    previewScale: 0.8,
    renderScale: 1,
    naturalSize: { width: 54, height: 76 },
    simulated: true,
    pinSummary: 'Segments A-G, DP and common pins COM.1/COM.2',
    breadboardMount: true,
    properties: [{
      key: 'color', label: 'Color', kind: 'select', options: [
        { value: 'red', label: 'Red' }, { value: 'green', label: 'Green' },
        { value: 'blue', label: 'Blue' }, { value: 'yellow', label: 'Yellow' },
        { value: 'white', label: 'White' },
      ],
    }],
  },
  'wokwi-pushbutton-6mm': {
    type: 'wokwi-pushbutton-6mm',
    name: '6mm Pushbutton',
    idPrefix: 'button',
    category: 'Input',
    tag: 'wokwi-pushbutton-6mm',
    defaults: { color: 'red' },
    previewScale: 1.7,
    renderScale: 1,
    naturalSize: { width: 28.02, height: 25.68 },
    simulated: true,
    pinSummary: '1.l and 1.r are one side. 2.l and 2.r are the other side.',
    breadboardMount: true,
    keywords: ['button', 'tactile', 'momentary'],
    properties: [{
      key: 'color', label: 'Color', kind: 'select', options: [
        { value: 'red', label: 'Red' }, { value: 'green', label: 'Green' },
        { value: 'blue', label: 'Blue' }, { value: 'yellow', label: 'Yellow' },
        { value: 'white', label: 'White' }, { value: 'black', label: 'Black' },
      ],
    }],
  },
  'wokwi-slide-potentiometer': {
    type: 'wokwi-slide-potentiometer',
    name: 'Slide Potentiometer',
    idPrefix: 'slider',
    category: 'Input',
    tag: 'wokwi-slide-potentiometer',
    defaults: { value: 50, min: 0, max: 100 },
    previewScale: 0.28,
    renderScale: 0.96,
    naturalSize: { width: 207.86, height: 113.6 },
    simulated: true,
    pinSummary: 'VCC, SIG, GND',
    keywords: ['slider', 'analog', 'fader'],
    properties: [
      { key: 'value', label: 'Value', kind: 'number', min: 0, max: 100, step: 1 },
      { key: 'min', label: 'Min', kind: 'number', step: 1 },
      { key: 'max', label: 'Max', kind: 'number', step: 1 },
    ],
  },
  'wokwi-analog-joystick': {
    type: 'wokwi-analog-joystick',
    name: 'Analog Joystick',
    idPrefix: 'joystick',
    category: 'Input',
    tag: 'wokwi-analog-joystick',
    defaults: {},
    previewScale: 0.46,
    renderScale: 1,
    naturalSize: { width: 102.8, height: 124.2 },
    simulated: true,
    pinSummary: 'VCC, VERT, HORZ, SEL, GND',
    breadboardMount: true,
    keywords: ['joystick', 'thumbstick', 'analog'],
  },
  'wokwi-ky-040': {
    type: 'wokwi-ky-040',
    name: 'Rotary Encoder',
    idPrefix: 'encoder',
    category: 'Input',
    tag: 'wokwi-ky-040',
    defaults: {},
    previewScale: 0.48,
    renderScale: 9.6 / 9.5,
    naturalSize: { width: 116.46, height: 74.42 },
    simulated: true,
    pinSummary: 'CLK, DT, SW, VCC, GND',
    breadboardMount: true,
    keywords: ['encoder', 'rotary', 'knob', 'ky040'],
  },
  'wokwi-tilt-switch': {
    type: 'wokwi-tilt-switch',
    name: 'Tilt Sensor',
    idPrefix: 'tilt',
    category: 'Sensors',
    tag: 'wokwi-tilt-switch',
    defaults: { tilted: false },
    previewScale: 0.64,
    renderScale: 1,
    naturalSize: { width: 88.44, height: 59.55 },
    simulated: true,
    pinSummary: 'GND, VCC, OUT',
    breadboardMount: true,
    properties: [{ key: 'tilted', label: 'Tilted', kind: 'toggle' }],
  },
  'wokwi-dip-switch-8': {
    type: 'wokwi-dip-switch-8',
    name: '8-way DIP Switch',
    idPrefix: 'dip',
    category: 'Input',
    tag: 'wokwi-dip-switch-8',
    defaults: {},
    previewScale: 0.68,
    renderScale: 1,
    naturalSize: { width: 82.86, height: 59.35 },
    simulated: true,
    pinSummary: 'Eight independent switches: 1a-8a paired with 1b-8b.',
    breadboardMount: true,
    keywords: ['dip', 'switch bank'],
  },
  'wokwi-led-bar-graph': {
    type: 'wokwi-led-bar-graph',
    name: 'LED Bar Graph',
    idPrefix: 'bar',
    category: 'Output',
    tag: 'wokwi-led-bar-graph',
    defaults: { color: 'red' },
    previewScale: 0.5,
    renderScale: 1,
    naturalSize: { width: 38.18, height: 100.38 },
    simulated: true,
    pinSummary: 'A1-A10 anodes and C1-C10 cathodes.',
    breadboardMount: true,
    keywords: ['bargraph', '10 segment', 'display'],
    properties: [{
      key: 'color', label: 'Color', kind: 'select', options: [
        { value: 'red', label: 'Red' }, { value: 'green', label: 'Green' },
        { value: 'blue', label: 'Blue' }, { value: 'yellow', label: 'Yellow' },
      ],
    }],
  },
  'wokwi-servo': {
    type: 'wokwi-servo',
    name: 'Servo',
    idPrefix: 'servo',
    category: 'Motion',
    tag: 'wokwi-servo',
    defaults: { horn: 'single' },
    previewScale: 0.32,
    renderScale: 9.6 / 9.5,
    naturalSize: { width: 170.08, height: 123.54 },
    simulated: true,
    pinSummary: 'GND, V+, PWM',
    properties: [{
      key: 'horn', label: 'Horn', kind: 'select', options: [
        { value: 'single', label: 'Single' }, { value: 'double', label: 'Double' }, { value: 'cross', label: 'Cross' },
      ],
    }],
  },
  'wokwi-stepper-motor': {
    type: 'wokwi-stepper-motor',
    name: 'Stepper Motor',
    idPrefix: 'stepper',
    category: 'Motion',
    tag: 'wokwi-stepper-motor',
    defaults: { stepsPerRevolution: 200 },
    previewScale: 0.23,
    renderScale: 1,
    naturalSize: { width: 220.35, height: 239.46 },
    simulated: true,
    pinSummary: 'A-, A+, B+, B-. Drive through a suitable motor driver in physical builds.',
    properties: [{ key: 'stepsPerRevolution', label: 'Steps/rev', kind: 'number', min: 4, max: 4096, step: 1 }],
    keywords: ['stepper', 'motor', 'nema'],
  },
  'dc-motor': {
    type: 'dc-motor',
    name: 'DC Motor',
    idPrefix: 'motor',
    category: 'Motion',
    defaults: {},
    previewScale: 0.4,
    // 9.6 / 9.98: keep both motor terminals on the shared physical grid.
    renderScale: 9.6 / 9.98,
    naturalSize: { width: 160.18, height: 74.29 },
    simulated: true,
    pinSummary: 'Pins 1 and 2. Polarity controls direction; PWM controls average drive.',
    flexibleLeadPins: ['1', '2'],
    keywords: ['motor', 'dc motor', 'brushed', 'fan'],
  },
  'wokwi-membrane-keypad': {
    type: 'wokwi-membrane-keypad',
    name: '4x4 Keypad',
    idPrefix: 'keypad',
    category: 'Input',
    tag: 'wokwi-membrane-keypad',
    defaults: { columns: '4', connector: true },
    previewScale: 0.16,
    renderScale: 9.6 / 9.5,
    naturalSize: { width: 265.83, height: 344 },
    simulated: true,
    pinSummary: 'R1-R4 rows and C1-C4 columns.',
    properties: [{
      key: 'columns', label: 'Columns', kind: 'select', options: [
        { value: '4', label: '4 columns' }, { value: '3', label: '3 columns' },
      ],
    }],
    keywords: ['keypad', 'matrix', 'keyboard'],
  },
  'wokwi-ntc-temperature-sensor': {
    type: 'wokwi-ntc-temperature-sensor',
    name: 'NTC Temperature',
    idPrefix: 'ntc',
    category: 'Sensors',
    tag: 'wokwi-ntc-temperature-sensor',
    defaults: { temperature: 24, beta: 3950 },
    previewScale: 0.38,
    renderScale: 1,
    naturalSize: { width: 135.4, height: 75.8 },
    simulated: true,
    pinSummary: 'GND, VCC, OUT analog temperature voltage.',
    breadboardMount: true,
    properties: [
      { key: 'temperature', label: 'Temperature', kind: 'number', min: -40, max: 125, step: 0.5, unit: 'C' },
      { key: 'beta', label: 'Beta', kind: 'number', min: 1000, max: 10000, step: 10 },
    ],
    keywords: ['thermistor', 'temperature', 'analog'],
  },
  'wokwi-photoresistor-sensor': {
    type: 'wokwi-photoresistor-sensor',
    name: 'Photoresistor',
    idPrefix: 'ldr',
    category: 'Sensors',
    tag: 'wokwi-photoresistor-sensor',
    defaults: { lux: 500, threshold: 2.5, rl10: 50, gamma: 0.7 },
    previewScale: 0.3,
    renderScale: 0.96,
    naturalSize: { width: 173.66, height: 65.47 },
    simulated: true,
    pinSummary: 'VCC, GND, DO threshold output, AO analog light level.',
    breadboardMount: true,
    properties: [
      { key: 'lux', label: 'Light', kind: 'number', min: 0.1, max: 100000, step: 1, unit: 'lux' },
      { key: 'threshold', label: 'Threshold', kind: 'number', min: 0, max: 5, step: 0.1, unit: 'V' },
    ],
    keywords: ['ldr', 'light', 'lux', 'photo sensor'],
  },
  'wokwi-pir-motion-sensor': {
    type: 'wokwi-pir-motion-sensor',
    name: 'PIR Motion Sensor',
    idPrefix: 'pir',
    category: 'Sensors',
    tag: 'wokwi-pir-motion-sensor',
    defaults: { motion: false, delayTime: 5, inhibitTime: 1.2, retrigger: true },
    previewScale: 0.47,
    renderScale: 1,
    naturalSize: { width: 90.71, height: 96.4 },
    simulated: true,
    pinSummary: 'VCC, OUT, GND.',
    breadboardMount: true,
    properties: [
      { key: 'motion', label: 'Motion', kind: 'toggle' },
      { key: 'delayTime', label: 'Hold', kind: 'number', min: 0.1, max: 30, step: 0.1, unit: 's' },
    ],
    keywords: ['motion', 'pir', 'presence'],
  },
  'wokwi-flame-sensor': {
    type: 'wokwi-flame-sensor',
    name: 'Flame Sensor',
    idPrefix: 'flame',
    category: 'Sensors',
    tag: 'wokwi-flame-sensor',
    defaults: { level: 0, threshold: 2.5 },
    previewScale: 0.26,
    renderScale: 1,
    naturalSize: { width: 199.94, height: 65.47 },
    simulated: true,
    pinSummary: 'VCC, GND, DOUT, AOUT.',
    breadboardMount: true,
    properties: [
      { key: 'level', label: 'Flame', kind: 'number', min: 0, max: 100, step: 1, unit: '%' },
      { key: 'threshold', label: 'Threshold', kind: 'number', min: 0, max: 5, step: 0.1, unit: 'V' },
    ],
    keywords: ['fire', 'infrared', 'flame'],
  },
  'wokwi-gas-sensor': {
    type: 'wokwi-gas-sensor',
    name: 'MQ2 Gas Sensor',
    idPrefix: 'gas',
    category: 'Sensors',
    tag: 'wokwi-gas-sensor',
    defaults: { ppm: 400, threshold: 4.4 },
    previewScale: 0.36,
    renderScale: 0.9697,
    naturalSize: { width: 136.94, height: 66.8 },
    simulated: true,
    pinSummary: 'AOUT, DOUT, GND, VCC.',
    breadboardMount: true,
    properties: [
      { key: 'ppm', label: 'Gas', kind: 'number', min: 0, max: 10000, step: 10, unit: 'ppm' },
      { key: 'threshold', label: 'Threshold', kind: 'number', min: 0, max: 5, step: 0.1, unit: 'V' },
    ],
    keywords: ['mq2', 'gas', 'smoke'],
  },
  'wokwi-big-sound-sensor': {
    type: 'wokwi-big-sound-sensor',
    name: 'Sound Sensor',
    idPrefix: 'sound',
    category: 'Sensors',
    tag: 'wokwi-big-sound-sensor',
    defaults: { level: 0, threshold: 2.5 },
    previewScale: 0.36,
    renderScale: 0.96,
    naturalSize: { width: 140.05, height: 54.44 },
    simulated: true,
    pinSummary: 'AOUT, GND, VCC, DOUT.',
    breadboardMount: true,
    properties: [
      { key: 'level', label: 'Sound', kind: 'number', min: 0, max: 100, step: 1, unit: '%' },
      { key: 'threshold', label: 'Threshold', kind: 'number', min: 0, max: 5, step: 0.1, unit: 'V' },
    ],
    keywords: ['microphone', 'sound', 'noise'],
  },
  'wokwi-small-sound-sensor': {
    type: 'wokwi-small-sound-sensor',
    name: 'Small Sound Sensor',
    idPrefix: 'sound',
    category: 'Sensors',
    tag: 'wokwi-small-sound-sensor',
    defaults: { level: 0, threshold: 2.5 },
    previewScale: 0.38,
    renderScale: 0.96,
    naturalSize: { width: 133.08, height: 54.44 },
    simulated: true,
    pinSummary: 'AOUT, GND, VCC, DOUT.',
    breadboardMount: true,
    properties: [
      { key: 'level', label: 'Sound', kind: 'number', min: 0, max: 100, step: 1, unit: '%' },
      { key: 'threshold', label: 'Threshold', kind: 'number', min: 0, max: 5, step: 0.1, unit: 'V' },
    ],
    keywords: ['microphone', 'sound', 'noise'],
  },
  'wokwi-heart-beat-sensor': {
    type: 'wokwi-heart-beat-sensor',
    name: 'Pulse Sensor',
    idPrefix: 'pulse',
    category: 'Sensors',
    tag: 'wokwi-heart-beat-sensor',
    defaults: { bpm: 72 },
    previewScale: 0.55,
    renderScale: 0.96,
    naturalSize: { width: 88.44, height: 83.15 },
    simulated: true,
    pinSummary: 'GND, VCC, OUT analog pulse waveform.',
    breadboardMount: true,
    properties: [{ key: 'bpm', label: 'Heart rate', kind: 'number', min: 30, max: 220, step: 1, unit: 'bpm' }],
    keywords: ['heart', 'pulse', 'heartbeat'],
  },
  'wokwi-hc-sr04': {
    type: 'wokwi-hc-sr04',
    name: 'HC-SR04',
    idPrefix: 'sonar',
    category: 'Sensors',
    tag: 'wokwi-hc-sr04',
    defaults: { distance: 100 },
    previewScale: 0.31,
    renderScale: 0.96,
    naturalSize: { width: 170.08, height: 98.49 },
    simulated: true,
    pinSummary: 'VCC, TRIG, ECHO, GND. ECHO pulse is distance x 58 microseconds.',
    breadboardMount: true,
    properties: [{ key: 'distance', label: 'Distance', kind: 'number', min: 2, max: 400, step: 1, unit: 'cm' }],
    keywords: ['ultrasonic', 'distance', 'sonar'],
  },
  'wokwi-dht22': {
    type: 'wokwi-dht22',
    name: 'DHT22',
    idPrefix: 'dht',
    category: 'Sensors',
    tag: 'wokwi-dht22',
    defaults: { temperature: 24, humidity: 40 },
    previewScale: 0.42,
    renderScale: 1,
    naturalSize: { width: 57.07, height: 120.72 },
    simulated: true,
    pinSummary: 'VCC, SDA single-wire data, NC, GND.',
    breadboardMount: true,
    properties: [
      { key: 'temperature', label: 'Temperature', kind: 'number', min: -40, max: 80, step: 0.5, unit: 'C' },
      { key: 'humidity', label: 'Humidity', kind: 'number', min: 0, max: 100, step: 1, unit: '%' },
    ],
    keywords: ['temperature', 'humidity', 'weather'],
  },
  'wokwi-ir-receiver': {
    type: 'wokwi-ir-receiver',
    name: 'IR Receiver',
    idPrefix: 'irrx',
    category: 'Sensors',
    tag: 'wokwi-ir-receiver',
    defaults: {},
    previewScale: 0.5,
    renderScale: 1,
    naturalSize: { width: 61.15, height: 92.75 },
    simulated: true,
    pinSummary: 'GND, VCC, DAT. Receives NEC commands from an IR Remote in the same bench.',
    breadboardMount: true,
    keywords: ['infrared', 'remote', 'nec'],
  },
  'wokwi-ir-remote': {
    type: 'wokwi-ir-remote',
    name: 'IR Remote',
    idPrefix: 'irremote',
    category: 'Input',
    tag: 'wokwi-ir-remote',
    defaults: {},
    previewScale: 0.18,
    renderScale: 0.72,
    naturalSize: { width: 151.18, height: 320.16 },
    simulated: true,
    pinSummary: 'Wireless NEC remote. No physical pins.',
    keywords: ['infrared', 'remote', 'nec'],
  },
  'wokwi-lcd1602': {
    type: 'wokwi-lcd1602',
    name: 'LCD 16x2 I2C',
    idPrefix: 'lcd',
    category: 'Output',
    tag: 'wokwi-lcd1602',
    defaults: { pins: 'i2c', background: 'blue' },
    previewScale: 0.22,
    renderScale: 9.6 / 9.5,
    naturalSize: { width: 302.5, height: 136.5 },
    simulated: true,
    pinSummary: 'GND, VCC, SDA, SCL. I2C address 0x27.',
    keywords: ['lcd', 'display', 'i2c', '1602'],
    properties: [{
      key: 'background', label: 'Backlight', kind: 'select', options: [
        { value: 'blue', label: 'Blue' }, { value: 'green', label: 'Green' }, { value: 'black', label: 'Black' },
      ],
    }],
  },
  'wokwi-lcd2004': {
    type: 'wokwi-lcd2004',
    name: 'LCD 20x4 I2C',
    idPrefix: 'lcd',
    category: 'Output',
    tag: 'wokwi-lcd2004',
    defaults: { pins: 'i2c', background: 'blue' },
    previewScale: 0.18,
    renderScale: 9.6 / 9.5,
    naturalSize: { width: 355.5, height: 179.5 },
    simulated: true,
    pinSummary: 'GND, VCC, SDA, SCL. I2C address 0x27.',
    keywords: ['lcd', 'display', 'i2c', '2004'],
    properties: [{
      key: 'background', label: 'Backlight', kind: 'select', options: [
        { value: 'blue', label: 'Blue' }, { value: 'green', label: 'Green' }, { value: 'black', label: 'Black' },
      ],
    }],
  },
  'wokwi-ssd1306': {
    type: 'wokwi-ssd1306',
    name: 'OLED 128x64',
    idPrefix: 'oled',
    category: 'Output',
    tag: 'wokwi-ssd1306',
    defaults: {},
    previewScale: 0.42,
    renderScale: 0.96,
    naturalSize: { width: 150, height: 116 },
    simulated: true,
    pinSummary: 'DATA/SDA, CLK/SCL, power and control pins. I2C address 0x3C.',
    keywords: ['oled', 'display', 'i2c', 'ssd1306'],
  },
  'wokwi-ds1307': {
    type: 'wokwi-ds1307',
    name: 'DS1307 RTC',
    idPrefix: 'rtc',
    category: 'Sensors',
    tag: 'wokwi-ds1307',
    defaults: {},
    previewScale: 0.58,
    renderScale: 0.96,
    naturalSize: { width: 97.5, height: 84 },
    simulated: true,
    pinSummary: 'GND, 5V, SDA, SCL, SQW. I2C address 0x68.',
    keywords: ['rtc', 'clock', 'time', 'i2c'],
  },
  'wokwi-mpu6050': {
    type: 'wokwi-mpu6050',
    name: 'MPU6050 IMU',
    idPrefix: 'imu',
    category: 'Sensors',
    tag: 'wokwi-mpu6050',
    defaults: { accelX: 0, accelY: 0, accelZ: 1, gyroX: 0, gyroY: 0, gyroZ: 0, temperature: 24 },
    previewScale: 0.62,
    renderScale: 1,
    naturalSize: { width: 81.6, height: 61.2 },
    simulated: true,
    pinSummary: 'SDA, SCL, VCC, GND, INT and auxiliary pins. I2C address 0x68.',
    breadboardMount: true,
    keywords: ['imu', 'accelerometer', 'gyro', 'i2c'],
    properties: [
      { key: 'accelX', label: 'Accel X', kind: 'number', min: -16, max: 16, step: 0.05, unit: 'g' },
      { key: 'accelY', label: 'Accel Y', kind: 'number', min: -16, max: 16, step: 0.05, unit: 'g' },
      { key: 'accelZ', label: 'Accel Z', kind: 'number', min: -16, max: 16, step: 0.05, unit: 'g' },
      { key: 'gyroX', label: 'Gyro X', kind: 'number', min: -2000, max: 2000, step: 1, unit: '°/s' },
      { key: 'gyroY', label: 'Gyro Y', kind: 'number', min: -2000, max: 2000, step: 1, unit: '°/s' },
      { key: 'gyroZ', label: 'Gyro Z', kind: 'number', min: -2000, max: 2000, step: 1, unit: '°/s' },
      { key: 'temperature', label: 'Temperature', kind: 'number', min: -40, max: 85, step: 0.5, unit: 'C' },
    ],
  },
  'battery-aa': {
    type: 'battery-aa',
    name: 'AA Battery Pack',
    idPrefix: 'batt',
    category: 'Basic',
    asset: '/assets/fritzing/battery-aa.svg',
    defaults: { cells: 2 },
    previewScale: 0.28,
    // 198px terminal span -> exactly 18 physical 9.6px cells.
    renderScale: 172.8 / 198,
    naturalSize: { width: 222.88, height: 116.64 },
    simulated: true,
    pinSummary: '+ (positive), - (GND). 1-4 cells (1.5V - 6.0V).',
    properties: [{
      key: 'cells', label: 'Cells', kind: 'select', options: [
        { value: 1, label: '1 (1.5V)' }, { value: 2, label: '2 (3.0V)' }, { value: 3, label: '3 (4.5V)' }, { value: 4, label: '4 (6.0V)' },
      ],
    }],
    keywords: ['battery', 'aa', 'power', 'dc'],
  },
  'battery-coin-cell': {
    type: 'battery-coin-cell',
    name: 'Coin Cell 3V',
    idPrefix: 'batt',
    category: 'Basic',
    asset: '/assets/fritzing/battery-coin-cell.svg',
    defaults: {},
    previewScale: 0.45,
    // 80px terminal span -> exactly 7 physical 9.6px cells.
    renderScale: 67.2 / 80,
    naturalSize: { width: 96.95, height: 109.52 },
    simulated: true,
    pinSummary: '+ (3V positive), - (GND negative).',
    keywords: ['battery', 'coin cell', 'cr2032', '3v', 'power'],
  },
  'pnp-transistor': {
    type: 'pnp-transistor',
    name: 'PNP Transistor',
    idPrefix: 'q',
    category: 'Basic',
    asset: '/assets/fritzing/pnp-transistor.svg',
    defaults: {},
    previewScale: 0.8,
    renderScale: 1,
    naturalSize: { width: 22.036, height: 32.108 },
    simulated: true,
    pinSummary: 'E (emitter), B (base), C (collector). High-side switching.',
    breadboardMount: true,
    keywords: ['transistor', 'pnp', '2n3906', 'bjt', 'switch'],
  },
  'zener-diode': {
    type: 'zener-diode',
    name: 'Zener Diode',
    idPrefix: 'd',
    category: 'Basic',
    asset: '/assets/fritzing/zener-diode.svg',
    defaults: { voltage: 5.1 },
    previewScale: 0.85,
    renderScale: 1,
    naturalSize: { width: 40.167, height: 9.721 },
    simulated: true,
    pinSummary: 'A (anode), C (cathode). 5.1V reverse breakdown regulation.',
    breadboardMount: true,
    properties: [{ key: 'voltage', label: 'Zener Voltage', kind: 'number', min: 2.4, max: 24, step: 0.1, unit: 'V' }],
    keywords: ['diode', 'zener', '1n4733', 'voltage regulator'],
  },
  'wokwi-neopixel': {
    type: 'wokwi-neopixel',
    name: 'NeoPixel LED',
    idPrefix: 'pixel',
    category: 'Output',
    tag: 'wokwi-neopixel',
    defaults: {},
    previewScale: 0.9,
    renderScale: 1,
    naturalSize: { width: 21.4, height: 18.9 },
    simulated: true,
    pinSummary: 'VDD (5V), DOUT, VSS (GND), DIN (data in). WS2812B protocol.',
    keywords: ['neopixel', 'ws2812', 'ws2812b', 'rgb', 'addressable'],
  },
  'wokwi-led-ring': {
    type: 'wokwi-led-ring',
    name: 'NeoPixel Ring',
    idPrefix: 'ring',
    category: 'Output',
    tag: 'wokwi-led-ring',
    defaults: { pixels: 16 },
    previewScale: 0.35,
    renderScale: 1,
    naturalSize: { width: 150, height: 150 },
    simulated: true,
    pinSummary: 'GND, VCC, DIN, DOUT. 16 addressable RGB LEDs.',
    properties: [{ key: 'pixels', label: 'Pixels', kind: 'number', min: 8, max: 64, step: 4 }],
    keywords: ['neopixel', 'led ring', 'ws2812', 'ws2812b', 'rgb'],
  },
  'wokwi-neopixel-matrix': {
    type: 'wokwi-neopixel-matrix',
    name: 'NeoPixel Matrix',
    idPrefix: 'matrix',
    category: 'Output',
    tag: 'wokwi-neopixel-matrix',
    defaults: { rows: 8, cols: 8 },
    previewScale: 0.28,
    renderScale: 1,
    naturalSize: { width: 200, height: 200 },
    simulated: true,
    pinSummary: 'GND, VCC, DIN, DOUT. 8x8 addressable RGB LED matrix.',
    properties: [
      { key: 'rows', label: 'Rows', kind: 'number', min: 4, max: 16, step: 1 },
      { key: 'cols', label: 'Cols', kind: 'number', min: 4, max: 16, step: 1 },
    ],
    keywords: ['neopixel', 'matrix', 'led matrix', 'ws2812', 'ws2812b', 'rgb'],
  },
  'wokwi-ks2e-m-dc5': {
    type: 'wokwi-ks2e-m-dc5',
    name: 'SPDT Relay',
    idPrefix: 'relay',
    category: 'Output',
    tag: 'wokwi-ks2e-m-dc5',
    defaults: {},
    previewScale: 0.55,
    renderScale: 1,
    naturalSize: { width: 79.37, height: 37.79 },
    simulated: true,
    pinSummary: 'COIL1, COIL2, P1 (common), NO1, NC1, P2, NO2, NC2. 5V relay.',
    breadboardMount: true,
    keywords: ['relay', 'spdt', 'switch', 'isolation', 'ks2e'],
  },
};

export const PART_ORDER: PartType[] = [...PART_TYPES];

type PinElement = HTMLElement & { pinInfo?: PinInfo[] };

export function getPartPins(partOrType: CircuitPart | PartType): PinInfo[] {
  const type = typeof partOrType === 'string' ? partOrType : partOrType.type;
  const breadboard = getBreadboardGeometry(type);
  if (breadboard) return [...breadboard.pins];
  if (type === 'dc-motor') return [...DC_MOTOR_PINS];
  if (type === 'npn-transistor') return [...NPN_TRANSISTOR_PINS];
  if (type === 'pnp-transistor') return [...PNP_TRANSISTOR_PINS];
  if (type === 'rectifier-diode') return [...RECTIFIER_DIODE_PINS];
  if (type === 'zener-diode') return [...ZENER_DIODE_PINS];
  if (type === 'battery-9v') return [...BATTERY_9V_PINS];
  if (type === 'battery-aa') return [...BATTERY_AA_PINS];
  if (type === 'battery-coin-cell') return [...BATTERY_COIN_CELL_PINS];
  const tag = PART_DEFINITIONS[type].tag;
  if (!tag || typeof document === 'undefined') return [];
  const element = document.createElement(tag) as PinElement & Record<string, unknown>;
  const defaults = PART_DEFINITIONS[type].defaults;
  const attrs = typeof partOrType === 'string' ? defaults : { ...defaults, ...partOrType.attrs };
  for (const [key, value] of Object.entries(attrs)) element[key] = value;
  return Array.isArray(element.pinInfo) ? element.pinInfo : [];
}

export function getPartBounds(partOrType: CircuitPart | PartType) {
  const type = typeof partOrType === 'string' ? partOrType : partOrType.type;
  const definition = PART_DEFINITIONS[type];
  return {
    width: definition.naturalSize.width * definition.renderScale,
    height: definition.naturalSize.height * definition.renderScale,
  };
}

function normalizePinName(name: string) {
  return name.trim().toLowerCase().replace(/^gpio\s*/, '').replace(/^digital\s*/, '');
}

export function resolvePinName(part: CircuitPart, requested: string): string | null {
  const pins = getPartPins(part);
  const raw = requested.trim();
  const normalized = normalizePinName(raw);

  const exact = pins.find((pin) => pin.name === raw);
  if (exact) return exact.name;
  const caseInsensitive = pins.find((pin) => pin.name.toLowerCase() === raw.toLowerCase());
  if (caseInsensitive) return caseInsensitive.name;

  if (part.type === 'wokwi-arduino-uno') {
    const digital = normalized.match(/^d?(\d+)$/)?.[1];
    if (digital) {
      const found = pins.find((pin) => pin.name === digital);
      if (found) return found.name;
    }
    if (['gnd', 'ground', 'gnd.1', 'gnd.2', 'gnd.3'].includes(normalized)) {
      return pins.find((pin) => pin.name.startsWith('GND'))?.name ?? null;
    }
    if (['3v3', '3.3v', '3v'].includes(normalized)) {
      return pins.find((pin) => pin.name === '3.3V')?.name ?? null;
    }
    if (['5v', 'vcc'].includes(normalized)) {
      return pins.find((pin) => pin.name === '5V')?.name ?? null;
    }
    if (['vin', '9v', 'raw'].includes(normalized)) {
      return pins.find((pin) => pin.name === 'VIN')?.name ?? null;
    }
    if (['rst', 'reset'].includes(normalized)) {
      return pins.find((pin) => pin.name === 'RESET')?.name ?? null;
    }
    if (['ioref'].includes(normalized)) {
      return pins.find((pin) => pin.name === 'IOREF')?.name ?? null;
    }
    if (['aref'].includes(normalized)) {
      return pins.find((pin) => pin.name === 'AREF')?.name ?? null;
    }
  }

  if (part.type === 'battery-9v') {
    if (['+', 'pos', 'positive', 'plus', 'vcc', '9v', 'red'].includes(normalized)) return '+';
    if (['-', 'neg', 'negative', 'minus', 'gnd', 'ground', '0v', 'black'].includes(normalized)) return '-';
  }

  if (part.type === 'rectifier-diode') {
    if (['a', 'anode', 'pos', 'positive', '+', '1', 'in', 'p'].includes(normalized)) return 'A';
    if (['c', 'k', 'cathode', 'neg', 'negative', '-', '2', 'out', 'n'].includes(normalized)) return 'C';
  }

  if (part.type === 'npn-transistor') {
    if (['1', 'e', 'emitter'].includes(normalized)) return 'E';
    if (['2', 'b', 'base'].includes(normalized)) return 'B';
    if (['3', 'c', 'collector'].includes(normalized)) return 'C';
  }

  if (part.type === 'wokwi-led') {
    if (['a', 'anode', 'pos', 'positive', '+', '1', 'pin1', 'led+'].includes(normalized)) return 'A';
    if (['c', 'k', 'cathode', 'neg', 'negative', '-', '2', 'pin2', 'led-', 'gnd'].includes(normalized)) return 'C';
  }

  if (part.type === 'wokwi-rgb-led') {
    if (['r', 'red'].includes(normalized)) return 'R';
    if (['g', 'green'].includes(normalized)) return 'G';
    if (['b', 'blue'].includes(normalized)) return 'B';
    if (['com', 'common', 'cathode', 'anode', 'c', 'gnd', 'vcc'].includes(normalized)) return 'COM';
  }

  if (part.type === 'wokwi-resistor') {
    if (['1', 'p1', 'pin 1', 'pin1', 'left', 'a', 'r1'].includes(normalized)) return '1';
    if (['2', 'p2', 'pin 2', 'pin2', 'right', 'b', 'r2'].includes(normalized)) return '2';
  }

  if (part.type === 'wokwi-pushbutton' || part.type === 'wokwi-pushbutton-6mm') {
    if (['1.l', '1l', 'l1', '1_l', '1a', 'left1', '1'].includes(normalized)) return '1.l';
    if (['2.l', '2l', 'l2', '2_l', '2a', 'left2', '2'].includes(normalized)) return '2.l';
    if (['1.r', '1r', 'r1', '1_r', '1b', 'right1', '3'].includes(normalized)) return '1.r';
    if (['2.r', '2r', 'r2', '2_r', '2b', 'right2', '4'].includes(normalized)) return '2.r';
  }

  if (part.type === 'wokwi-slide-switch') {
    if (['1', 'p1', 'pin 1', 'pin1', 'a', 'sw1'].includes(normalized)) return '1';
    if (['2', 'p2', 'pin 2', 'pin2', 'com', 'common', 'in', 'c'].includes(normalized)) return '2';
    if (['3', 'p3', 'pin 3', 'pin3', 'b', 'sw2'].includes(normalized)) return '3';
  }

  if (part.type === 'wokwi-potentiometer' || part.type === 'wokwi-slide-potentiometer') {
    if (['gnd', 'ground', '0v', '-', 'neg', 'p1', '1'].includes(normalized)) return 'GND';
    if (['sig', 'signal', 'out', 'wiper', 'analog', 'adj', 's', 'p2', '2'].includes(normalized)) return 'SIG';
    if (['vcc', '5v', '3v3', '3.3v', 'power', 'vin', '+', 'pos', 'p3', '3'].includes(normalized)) return 'VCC';
  }

  if (part.type === 'wokwi-buzzer') {
    if (['1', 'p1', 'pin 1', 'pin1', 'pos', '+', 'positive', 'anode', 'sig', 'in'].includes(normalized)) return '1';
    if (['2', 'p2', 'pin 2', 'pin2', 'neg', '-', 'negative', 'cathode', 'gnd', 'ground'].includes(normalized)) return '2';
  }

  if (part.type === 'dc-motor') {
    if (['1', 'p1', 'pin 1', 'pin1', 'pos', '+', 'positive', 'a', 'm+'].includes(normalized)) return '1';
    if (['2', 'p2', 'pin 2', 'pin2', 'neg', '-', 'negative', 'b', 'm-', 'gnd'].includes(normalized)) return '2';
  }

  if (part.type === 'wokwi-servo') {
    if (['gnd', 'ground', '-', '0v', 'brown', 'black'].includes(normalized)) return 'GND';
    if (['v+', 'vcc', '5v', 'vin', 'power', '+', 'red', 'v'].includes(normalized)) return 'V+';
    if (['pwm', 'sig', 'signal', 'control', 'in', 'data', 'orange', 'yellow', 'white', 's'].includes(normalized)) return 'PWM';
  }

  if (part.type === 'wokwi-stepper-motor') {
    if (['a-', 'a1', 'a_neg', '-a'].includes(normalized)) return 'A-';
    if (['a+', 'a2', 'a_pos', '+a'].includes(normalized)) return 'A+';
    if (['b+', 'b1', 'b_pos', '+b'].includes(normalized)) return 'B+';
    if (['b-', 'b2', 'b_neg', '-b'].includes(normalized)) return 'B-';
  }

  if (part.type === 'wokwi-tilt-switch') {
    if (['gnd', 'ground', '-'].includes(normalized)) return 'GND';
    if (['vcc', '5v', 'power', 'vin', '+'].includes(normalized)) return 'VCC';
    if (['out', 'sig', 'signal', 'data', 'do', 's'].includes(normalized)) return 'OUT';
  }

  if (part.type === 'wokwi-ntc-temperature-sensor') {
    if (['gnd', 'ground', '-'].includes(normalized)) return 'GND';
    if (['vcc', '5v', 'power', 'vin', '+'].includes(normalized)) return 'VCC';
    if (['out', 'sig', 'signal', 'ao', 'analog', 's'].includes(normalized)) return 'OUT';
  }

  if (part.type === 'wokwi-photoresistor-sensor') {
    if (['vcc', '5v', 'power', 'vin', '+'].includes(normalized)) return 'VCC';
    if (['gnd', 'ground', '-'].includes(normalized)) return 'GND';
    if (['do', 'dout', 'digital', 'd0'].includes(normalized)) return 'DO';
    if (['ao', 'aout', 'analog', 'sig', 'a0'].includes(normalized)) return 'AO';
  }

  if (part.type === 'wokwi-pir-motion-sensor') {
    if (['vcc', '5v', 'power', 'vin', '+'].includes(normalized)) return 'VCC';
    if (['out', 'sig', 'signal', 'data', 'do', 's'].includes(normalized)) return 'OUT';
    if (['gnd', 'ground', '-'].includes(normalized)) return 'GND';
  }

  if (part.type === 'wokwi-hc-sr04') {
    if (['vcc', '5v', 'power', '+'].includes(normalized)) return 'VCC';
    if (['trig', 'trigger', 't'].includes(normalized)) return 'TRIG';
    if (['echo', 'e', 'r'].includes(normalized)) return 'ECHO';
    if (['gnd', 'ground', '-'].includes(normalized)) return 'GND';
  }

  if (part.type === 'wokwi-dht22') {
    if (['vcc', '5v', '3v3', 'power', '+'].includes(normalized)) return 'VCC';
    if (['sda', 'dat', 'data', 'sig', 'out', 'io', 'd'].includes(normalized)) return 'SDA';
    if (['nc', 'none'].includes(normalized)) return 'NC';
    if (['gnd', 'ground', '-'].includes(normalized)) return 'GND';
  }

  if (
    part.type === 'wokwi-gas-sensor' ||
    part.type === 'wokwi-flame-sensor' ||
    part.type === 'wokwi-big-sound-sensor' ||
    part.type === 'wokwi-small-sound-sensor'
  ) {
    if (['aout', 'ao', 'analog', 'sig', 'a0', 'a'].includes(normalized)) return 'AOUT';
    if (['dout', 'do', 'digital', 'd0', 'd'].includes(normalized)) return 'DOUT';
    if (['gnd', 'ground', '-', 'g'].includes(normalized)) return 'GND';
    if (['vcc', '5v', 'power', '+', 'v'].includes(normalized)) return 'VCC';
  }

  if (part.type === 'wokwi-heart-beat-sensor') {
    if (['gnd', 'ground', '-', 'g'].includes(normalized)) return 'GND';
    if (['vcc', '5v', 'power', '+', 'v'].includes(normalized)) return 'VCC';
    if (['out', 'sig', 'signal', 'ao', 'analog', 's'].includes(normalized)) return 'OUT';
  }

  if (part.type === 'wokwi-ir-receiver') {
    if (['gnd', 'ground', '-', 'g'].includes(normalized)) return 'GND';
    if (['vcc', '5v', 'power', '+', 'v'].includes(normalized)) return 'VCC';
    if (['dat', 'data', 'out', 'sig', 'signal', 'ir', 's'].includes(normalized)) return 'DAT';
  }

  if (part.type === 'wokwi-lcd1602' || part.type === 'wokwi-lcd2004') {
    if (['gnd', 'ground', '-', 'vss'].includes(normalized)) return 'GND';
    if (['vcc', '5v', 'power', '+', 'vdd'].includes(normalized)) return 'VCC';
    if (['sda', 'data', 'd'].includes(normalized)) return 'SDA';
    if (['scl', 'clock', 'clk', 'c'].includes(normalized)) return 'SCL';
  }

  if (part.type === 'wokwi-ssd1306') {
    if (['data', 'sda', 'd1', 'mosi', 'sdin'].includes(normalized)) return 'DATA';
    if (['clk', 'scl', 'd0', 'sclk', 'clock'].includes(normalized)) return 'CLK';
    if (['gnd', 'ground', 'g', '-'].includes(normalized)) return 'GND';
    if (['vin', 'vcc', '5v', 'power', '+'].includes(normalized)) return 'VIN';
    if (['3v3', '3.3v'].includes(normalized)) return '3V3';
    if (['rst', 'reset'].includes(normalized)) return 'RST';
    if (['dc', 'data/command'].includes(normalized)) return 'DC';
    if (['cs', 'chip select'].includes(normalized)) return 'CS';
  }

  if (part.type === 'wokwi-ds1307') {
    if (['gnd', 'ground', '-'].includes(normalized)) return 'GND';
    if (['5v', 'vcc', 'power', 'vin', '+'].includes(normalized)) return '5V';
    if (['sda', 'data', 'd'].includes(normalized)) return 'SDA';
    if (['scl', 'clock', 'clk', 'c'].includes(normalized)) return 'SCL';
    if (['sqw', 'squarewave', 'out', 's'].includes(normalized)) return 'SQW';
  }

  if (part.type === 'wokwi-mpu6050') {
    if (['vcc', '5v', '3v3', 'power', 'vin', '+'].includes(normalized)) return 'VCC';
    if (['gnd', 'ground', '-'].includes(normalized)) return 'GND';
    if (['scl', 'clock', 'clk', 'c'].includes(normalized)) return 'SCL';
    if (['sda', 'data', 'd'].includes(normalized)) return 'SDA';
    if (['ad0', 'addr', 'address', 'sdo'].includes(normalized)) return 'AD0';
    if (['int', 'interrupt'].includes(normalized)) return 'INT';
    if (['xda', 'aux_da'].includes(normalized)) return 'XDA';
    if (['xcl', 'aux_cl'].includes(normalized)) return 'XCL';
  }

  if (part.type === 'wokwi-analog-joystick') {
    if (['vcc', '5v', 'power', '+'].includes(normalized)) return 'VCC';
    if (['vert', 'vry', 'vy', 'y', 'vertical'].includes(normalized)) return 'VERT';
    if (['horz', 'vrx', 'vx', 'x', 'horizontal'].includes(normalized)) return 'HORZ';
    if (['sel', 'sw', 'switch', 'btn', 'button', 'key', 'z'].includes(normalized)) return 'SEL';
    if (['gnd', 'ground', '-'].includes(normalized)) return 'GND';
  }

  if (part.type === 'wokwi-ky-040') {
    if (['clk', 'clock', 'a', 'outa', 'output a'].includes(normalized)) return 'CLK';
    if (['dt', 'data', 'b', 'outb', 'output b'].includes(normalized)) return 'DT';
    if (['sw', 'switch', 'btn', 'button', 'key'].includes(normalized)) return 'SW';
    if (['vcc', '5v', 'power', '+', '+5v'].includes(normalized)) return 'VCC';
    if (['gnd', 'ground', '-'].includes(normalized)) return 'GND';
  }

  if (part.type === 'wokwi-7segment') {
    if (['dp', 'dot', 'point'].includes(normalized)) return 'DP';
    if (['com.1', 'com1', 'c1'].includes(normalized)) return 'COM.1';
    if (['com.2', 'com2', 'c2', 'com', 'common'].includes(normalized)) return 'COM.2';
  }

  if (part.type === 'battery-aa' || part.type === 'battery-coin-cell') {
    if (['+', 'pos', 'positive', 'vcc', 'v+', '1'].includes(normalized)) return '+';
    if (['-', 'neg', 'negative', 'gnd', 'ground', '2'].includes(normalized)) return '-';
  }

  if (part.type === 'pnp-transistor') {
    if (['e', 'emitter', '1'].includes(normalized)) return 'E';
    if (['b', 'base', '2'].includes(normalized)) return 'B';
    if (['c', 'collector', '3'].includes(normalized)) return 'C';
  }

  if (part.type === 'zener-diode') {
    if (['c', 'cathode', 'neg', '-', 'k', '2'].includes(normalized)) return 'C';
    if (['a', 'anode', 'pos', '+', '1'].includes(normalized)) return 'A';
  }

  if (part.type === 'wokwi-neopixel') {
    if (['vdd', 'vcc', '5v', 'power', '+'].includes(normalized)) return 'VDD';
    if (['dout', 'do', 'out', 'data_out'].includes(normalized)) return 'DOUT';
    if (['vss', 'gnd', 'ground', '-'].includes(normalized)) return 'VSS';
    if (['din', 'di', 'in', 'data', 'data_in'].includes(normalized)) return 'DIN';
  }

  if (part.type === 'wokwi-led-ring' || part.type === 'wokwi-neopixel-matrix') {
    if (['gnd', 'vss', 'ground', '-'].includes(normalized)) return 'GND';
    if (['vcc', 'vdd', '5v', 'power', '+'].includes(normalized)) return 'VCC';
    if (['din', 'di', 'in', 'data', 'data_in'].includes(normalized)) return 'DIN';
    if (['dout', 'do', 'out', 'data_out'].includes(normalized)) return 'DOUT';
  }

  if (part.type === 'wokwi-ks2e-m-dc5') {
    if (['coil1', 'c1'].includes(normalized)) return 'COIL1';
    if (['coil2', 'c2'].includes(normalized)) return 'COIL2';
    if (['p1', 'com1', 'common1'].includes(normalized)) return 'P1';
    if (['no1'].includes(normalized)) return 'NO1';
    if (['nc1'].includes(normalized)) return 'NC1';
    if (['p2', 'com2', 'common2'].includes(normalized)) return 'P2';
    if (['no2'].includes(normalized)) return 'NO2';
    if (['nc2'].includes(normalized)) return 'NC2';
  }

  return null;
}

export function defaultCode(): string {
  return `void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
}
`;
}
