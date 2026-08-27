import type { CircuitPart, PartAttrs, PartType, PinInfo } from './types';

export type PartDefinition = {
  type: PartType;
  name: string;
  tag?: string;
  defaults: PartAttrs;
  previewScale: number;
  renderScale: number;
  naturalSize: { width: number; height: number };
  simulated: boolean;
  pinSummary: string;
};

export const PART_DEFINITIONS: Record<PartType, PartDefinition> = {
  'wokwi-arduino-uno': {
    type: 'wokwi-arduino-uno',
    name: 'Arduino Uno',
    tag: 'wokwi-arduino-uno',
    defaults: {},
    previewScale: 0.42,
    renderScale: 0.78,
    naturalSize: { width: 274, height: 202 },
    simulated: true,
    pinSummary: 'Digital 0-13, analog A0-A5, 5V, 3.3V, GND.1-GND.3, VIN, RESET',
  },
  breadboard: {
    type: 'breadboard',
    name: 'Breadboard',
    defaults: {},
    previewScale: 0.28,
    renderScale: 0.78,
    naturalSize: { width: 430, height: 235 },
    simulated: true,
    pinSummary: 'Rows A-E and F-J, columns 1-30. Rails: +top1..30, -top1..30, +bottom1..30, -bottom1..30',
  },
  'wokwi-led': {
    type: 'wokwi-led',
    name: 'LED',
    tag: 'wokwi-led',
    defaults: { color: 'red' },
    previewScale: 1.25,
    renderScale: 1.1,
    naturalSize: { width: 40, height: 50 },
    simulated: true,
    pinSummary: 'A = anode, C = cathode',
  },
  'wokwi-rgb-led': {
    type: 'wokwi-rgb-led',
    name: 'RGB LED',
    tag: 'wokwi-rgb-led',
    defaults: { common: 'cathode' },
    previewScale: 1.05,
    renderScale: 0.85,
    naturalSize: { width: 43, height: 73 },
    simulated: true,
    pinSummary: 'R, G, B and COM',
  },
  'wokwi-resistor': {
    type: 'wokwi-resistor',
    name: 'Resistor',
    tag: 'wokwi-resistor',
    defaults: { value: '220' },
    previewScale: 1.25,
    renderScale: 1.15,
    naturalSize: { width: 59, height: 13 },
    simulated: true,
    pinSummary: 'Pins 1 and 2',
  },
  'wokwi-pushbutton': {
    type: 'wokwi-pushbutton',
    name: 'Pushbutton',
    tag: 'wokwi-pushbutton',
    defaults: { color: 'red' },
    previewScale: 1.1,
    renderScale: 0.9,
    naturalSize: { width: 68, height: 48 },
    simulated: true,
    pinSummary: '1.l and 1.r are one side. 2.l and 2.r are the other side.',
  },
  'wokwi-slide-switch': {
    type: 'wokwi-slide-switch',
    name: 'Slide Switch',
    tag: 'wokwi-slide-switch',
    defaults: {},
    previewScale: 1.1,
    renderScale: 1,
    naturalSize: { width: 33, height: 36 },
    simulated: true,
    pinSummary: 'Pins 1, 2, 3. Pin 2 is common.',
  },
  'wokwi-potentiometer': {
    type: 'wokwi-potentiometer',
    name: 'Potentiometer',
    tag: 'wokwi-potentiometer',
    defaults: { value: 512 },
    previewScale: 0.95,
    renderScale: 0.82,
    naturalSize: { width: 76, height: 76 },
    simulated: true,
    pinSummary: 'VCC, SIG, GND',
  },
  'wokwi-buzzer': {
    type: 'wokwi-buzzer',
    name: 'Buzzer',
    tag: 'wokwi-buzzer',
    defaults: {},
    previewScale: 0.9,
    renderScale: 0.76,
    naturalSize: { width: 65, height: 86 },
    simulated: true,
    pinSummary: 'Pins 1 and 2',
  },
  'wokwi-7segment': {
    type: 'wokwi-7segment',
    name: '7-Segment',
    tag: 'wokwi-7segment',
    defaults: { color: 'red' },
    previewScale: 0.8,
    renderScale: 0.9,
    naturalSize: { width: 54, height: 76 },
    simulated: true,
    pinSummary: 'Segments A-G, DP and common pins COM.1/COM.2',
  },
};

export const PART_ORDER: PartType[] = [
  'breadboard',
  'wokwi-arduino-uno',
  'wokwi-led',
  'wokwi-resistor',
  'wokwi-pushbutton',
  'wokwi-slide-switch',
  'wokwi-potentiometer',
  'wokwi-buzzer',
  'wokwi-rgb-led',
  'wokwi-7segment',
];

const breadboardPins: PinInfo[] = (() => {
  const pins: PinInfo[] = [];
  const x0 = 29;
  const step = 13.15;
  const rows: Array<[string, number]> = [
    ['A', 51], ['B', 63], ['C', 75], ['D', 87], ['E', 99],
    ['F', 131], ['G', 143], ['H', 155], ['I', 167], ['J', 179],
  ];
  for (let column = 1; column <= 30; column++) {
    const x = x0 + (column - 1) * step;
    for (const [row, y] of rows) pins.push({ name: `${row}${column}`, x, y, signals: [] });
    pins.push({ name: `+top${column}`, x, y: 20, signals: [] });
    pins.push({ name: `-top${column}`, x, y: 32, signals: [] });
    pins.push({ name: `+bottom${column}`, x, y: 202, signals: [] });
    pins.push({ name: `-bottom${column}`, x, y: 214, signals: [] });
  }
  return pins;
})();

type PinElement = HTMLElement & { pinInfo?: PinInfo[] };

export function getPartPins(partOrType: CircuitPart | PartType): PinInfo[] {
  const type = typeof partOrType === 'string' ? partOrType : partOrType.type;
  if (type === 'breadboard') return breadboardPins;
  const tag = PART_DEFINITIONS[type].tag;
  if (!tag || typeof document === 'undefined') return [];
  const element = document.createElement(tag) as PinElement;
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
    if (normalized === 'gnd' || normalized === 'ground') {
      return pins.find((pin) => pin.name.startsWith('GND'))?.name ?? null;
    }
    if (normalized === '3v3' || normalized === '3.3v') {
      return pins.find((pin) => pin.name === '3.3V')?.name ?? null;
    }
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

