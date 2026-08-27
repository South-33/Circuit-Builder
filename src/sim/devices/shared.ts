import { PinState, type AVRIOPort } from 'avr8js';
import type { CircuitDocument, CircuitPart } from '../../circuit/types';
import {
  nodeRef,
  traceToArduinoPin,
  traceToPower,
  type CircuitGraph,
} from '../circuitGraph';
import type { AVRRunner } from '../avrRunner';
import {
  classifyArduinoPowerPin,
  resolveArduinoAnalogChannel,
  resolveArduinoDigitalPin,
  type PortPin,
} from '../pins';

export type CircuitElement = HTMLElement & Record<string, unknown>;

export type SignalSource =
  | { kind: 'constant'; high: boolean }
  | { kind: 'digital'; pin: PortPin };

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

export function powerLevel(pinName: string): boolean | null {
  const kind = classifyArduinoPowerPin(pinName);
  if (kind === 'gnd') return false;
  if (kind === '5v' || kind === '3v3') return true;
  return null;
}

export function resolveSignal(graph: CircuitGraph, runner: AVRRunner, node: string): SignalSource | null {
  const power = traceToPower(graph, node)[0];
  if (power) {
    const high = powerLevel(power.pin);
    if (high !== null) return { kind: 'constant', high };
  }
  const digital = traceToArduinoPin(graph, node)[0];
  if (!digital) return null;
  const pin = resolveArduinoDigitalPin(runner, digital.pin);
  return pin ? { kind: 'digital', pin } : null;
}

export function readSignal(source: SignalSource | null): boolean | null {
  if (!source) return null;
  if (source.kind === 'constant') return source.high;
  return source.pin.port.pinState(source.pin.bit) === PinState.High;
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
    .map((trace) => powerLevel(trace.pin))
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
