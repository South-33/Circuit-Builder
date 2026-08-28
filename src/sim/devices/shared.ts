import { PinState, type AVRIOPort } from 'avr8js';
import type { CircuitDocument, CircuitPart } from '../../circuit/types';
import {
  isDiodePathValidForPower,
  nodeRef,
  traceFrom,
  traceToArduinoPin,
  traceToPower,
  type CircuitGraph,
  type DiodeTraversal,
} from '../circuitGraph';
import type { AVRRunner } from '../avrRunner';
import {
  classifyArduinoPowerPin,
  classifyPowerPin,
  isGroundPin,
  resolveArduinoAnalogChannel,
  resolveArduinoDigitalPin,
  type PortPin,
} from '../pins';

export type CircuitElement = HTMLElement & Record<string, unknown>;

export type SignalSource =
  | { kind: 'constant'; high: boolean; voltageDrop?: number }
  | { kind: 'digital'; pin: PortPin; diodeTraversals?: DiodeTraversal[] }
  | {
      kind: 'transistor';
      transistorPart: CircuitPart;
      baseSource: SignalSource | null;
      isEmitterGrounded: boolean;
    };

export type DeviceContext = {
  documentState: Pick<CircuitDocument, 'parts' | 'connections'>;
  graph: CircuitGraph;
  runner: AVRRunner;
  frameUpdaters: Array<() => void>;
  cleanups: Array<() => void>;
  resetters: Array<() => void>;
};

export function getElement(partId: string): CircuitElement | null {
  return document.querySelector(`[data-part-element="${CSS.escape(partId)}"]`) as CircuitElement | null;
}

export function powerLevel(partOrTypeOrPin: CircuitPart | string, pinName?: string): boolean | null {
  if (pinName === undefined) {
    const kind = classifyArduinoPowerPin(partOrTypeOrPin as string);
    if (kind === 'gnd') return false;
    if (kind === '5v' || kind === '3v3' || kind === 'vin') return true;
    if (partOrTypeOrPin === '-' || partOrTypeOrPin === 'gnd') return false;
    if (partOrTypeOrPin === '+' || partOrTypeOrPin === '9v') return true;
    return null;
  }
  const partType = typeof partOrTypeOrPin === 'string' ? partOrTypeOrPin : partOrTypeOrPin.type;
  const kind = classifyPowerPin(partType, pinName);
  if (kind === 'gnd') return false;
  if (kind === '5v' || kind === '3v3' || kind === 'vin' || kind === '9v' || kind === 'aa' || kind === 'coin') return true;
  return null;
}

export function resolveSignal(graph: CircuitGraph, runner: AVRRunner, node: string): SignalSource | null {
  const power = traceToPower(graph, node)[0];
  if (power) {
    const high = powerLevel(power.part, power.pin);
    if (high !== null) return { kind: 'constant', high, voltageDrop: power.voltageDrop };
  }
  const digital = traceToArduinoPin(graph, node)[0];
  if (digital) {
    const pin = resolveArduinoDigitalPin(runner, digital.pin);
    if (pin) return { kind: 'digital', pin, diodeTraversals: digital.diodeTraversals };
  }

  // Transistor Collector (Low-Side Switch Return)
  const transistorTrace = traceFrom(graph, node, (part, pinName) =>
    part.type === 'npn-transistor' && pinName === 'C',
  )[0];

  if (transistorTrace) {
    const transistorPart = transistorTrace.part;
    const baseNode = nodeRef(transistorPart.id, 'B');
    const emitterNode = nodeRef(transistorPart.id, 'E');

    const emitterPower = traceToPower(graph, emitterNode);
    const isEmitterGrounded = emitterPower.some((p) => isGroundPin(p.part.type, p.pin));

    const baseSource = resolveSignal(graph, runner, baseNode);

    return {
      kind: 'transistor',
      transistorPart,
      baseSource,
      isEmitterGrounded,
    };
  }

  return null;
}

export function readSignal(source: SignalSource | null): boolean | null {
  if (!source) return null;
  if (source.kind === 'constant') return source.high;
  if (source.kind === 'digital') {
    const isHigh = source.pin.port.pinState(source.pin.bit) === PinState.High;
    if (source.diodeTraversals && source.diodeTraversals.length > 0) {
      if (isHigh) {
        return isDiodePathValidForPower(source.diodeTraversals, 'pos') ? true : false;
      } else {
        return isDiodePathValidForPower(source.diodeTraversals, 'gnd') ? false : null;
      }
    }
    return isHigh;
  }
  if (source.kind === 'transistor') {
    if (!source.isEmitterGrounded) return null;
    const baseVal = readSignal(source.baseSource);
    return baseVal === true ? false : null;
  }
  return null;
}

export function writeExternalPin(pin: PortPin, high: boolean) {
  pin.port.setPin(pin.bit, high);
}

export function digitalPinForNode(graph: CircuitGraph, runner: AVRRunner, node: string): PortPin | null {
  const trace = traceToArduinoPin(graph, node)[0];
  return trace ? resolveArduinoDigitalPin(runner, trace.pin) : null;
}

export function analogChannelForNode(graph: CircuitGraph, node: string) {
  const trace = traceToArduinoPin(graph, node).find((result) => /^A[0-5]$/i.test(result.pin));
  return trace ? resolveArduinoAnalogChannel(trace.pin) : null;
}

export function poweredLevelForNode(graph: CircuitGraph, node: string) {
  return traceToPower(graph, node)
    .map((trace) => powerLevel(trace.part, trace.pin))
    .find((value): value is boolean => value !== null);
}

export function pinNode(part: CircuitPart, pin: string) {
  return nodeRef(part.id, pin);
}

export function addEvent(
  context: DeviceContext,
  element: HTMLElement,
  name: string,
  listener: EventListener,
) {
  element.addEventListener(name, listener);
  context.cleanups.push(() => element.removeEventListener(name, listener));
}

export function addPortListener(
  context: DeviceContext,
  port: AVRIOPort,
  listener: (value: number, oldValue: number) => void,
) {
  port.addListener(listener);
  context.cleanups.push(() => port.removeListener(listener));
}

export function high(pin: PortPin | null) {
  return Boolean(pin && pin.port.pinState(pin.bit) === PinState.High);
}

export function resetInputPin(pin: PortPin | null) {
  if (!pin) return;
  const state = pin.port.pinState(pin.bit);
  writeExternalPin(pin, state === PinState.InputPullUp);
}
