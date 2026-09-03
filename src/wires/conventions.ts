export type WireRole = 'signal' | 'power' | 'ground';

export const WIRE_COLORS = {
  ground: '#343a40',
  power5v: '#d94841',
  power3v3: '#f29900',
  negativeSupply: '#1a73e8',
  signal: '#2f9e44',
} as const;

const SIGNAL_PALETTE = [
  '#2f9e44',
  '#1971c2',
  '#7b2cbf',
  '#0b7285',
  '#5f3dc4',
  '#087f5b',
] as const;

/** Stable signal color without asking the model to choose presentation details. */
export function signalWireColor(identity: string) {
  let hash = 2166136261;
  for (const char of identity) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return SIGNAL_PALETTE[(hash >>> 0) % SIGNAL_PALETTE.length];
}

function endpointPin(endpoint: string) {
  const colon = endpoint.indexOf(':');
  return (colon >= 0 ? endpoint.slice(colon + 1) : endpoint).trim().toLowerCase();
}

function matches(pin: string, values: string[]) {
  return values.includes(pin);
}

export function inferWireKind(from: string, to: string, role?: WireRole | string) {
  const pins = [endpointPin(from), endpointPin(to)];
  if (role === 'ground' || pins.some((pin) => pin.startsWith('gnd') || matches(pin, ['-', 'ground', '0v', 'vss']))) {
    return 'ground' as const;
  }
  if (pins.some((pin) => matches(pin, ['3.3v', '3v3', '3v']))) return 'power3v3' as const;
  if (pins.some((pin) => matches(pin, ['v-', '-v', 'negative-supply']))) return 'negativeSupply' as const;
  if (role === 'power' || pins.some((pin) => matches(pin, ['+', '5v', 'vcc', 'v+', 'vdd', 'vin', 'power']))) {
    return 'power5v' as const;
  }
  return 'signal' as const;
}

export function standardWireColor(from: string, to: string, role?: WireRole | string) {
  return WIRE_COLORS[inferWireKind(from, to, role)];
}

export function wireColorMatchesStandard(from: string, to: string, color?: string) {
  if (!color) return true;
  const normalized = color.trim().toLowerCase();
  const kind = inferWireKind(from, to);
  const accepted: Record<ReturnType<typeof inferWireKind>, string[]> = {
    ground: ['#202124', '#343a40', '#000', '#000000', 'black'],
    power5v: ['#d93025', '#d94841', '#f00', '#ff0000', 'red'],
    power3v3: ['#f29900', '#ff9800', 'orange'],
    negativeSupply: ['#1a73e8', '#1976d2', 'blue'],
    signal: [],
  };
  return kind === 'signal' || accepted[kind].includes(normalized);
}

export const WIRING_GUIDE = {
  colors: {
    ground: 'black',
    positive5V: 'red',
    positive3V3: 'orange',
    negativeSupply: 'blue',
    signalDefault: 'stable per-net palette',
  },
  routing: [
    'Arrange functional groups in signal or energy-flow order, but let pin-side fit outrank a conventional left-to-right layout.',
    'Place parts where the source outward ray and destination inward ray can meet with at most one main bend; leave approach space for every pin in the bank.',
    'Choose an open wiring channel first. Align connected pin banks along it, then rotate or slide parts to remove any avoidable direction reversal.',
    'Reserve separate parallel distribution lanes for shared power and ground at the edge of a functional group; place consumers for short local drops.',
    'Connect a point-to-point signal to the actual component pin; target a breadboard hole only when its connected strip intentionally joins multiple endpoints.',
    'For a local multi-drop node, make the external cable visibly terminate at the primary active-device pin and co-locate passive branches on its connected strip.',
    'Leave an open channel between connected pin banks. The exact router owns pin exits, bends, and lane separation.',
  ],
} as const;
