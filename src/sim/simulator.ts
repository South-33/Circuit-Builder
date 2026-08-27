import { PinState } from 'avr8js';
import { circuitStore } from '../store';
import type { CircuitDocument, CircuitPart } from '../types';
import { buildCircuitGraph, nodeRef, traceToArduinoPin, traceToPower, type CircuitGraph } from './circuitGraph';
import { compileArduino } from './compiler';
import { diagnoseCircuit } from './diagnostics';
import { AVRRunner } from './avrRunner';
import { classifyArduinoPowerPin, resolveArduinoAnalogChannel, resolveArduinoDigitalPin, type PortPin } from './pins';

type CircuitElement = HTMLElement & Record<string, unknown>;

type SignalSource =
  | { kind: 'constant'; high: boolean }
  | { kind: 'digital'; pin: PortPin };

function getElement(partId: string): CircuitElement | null {
  return document.querySelector(`[data-part-element="${CSS.escape(partId)}"]`) as CircuitElement | null;
}

function powerLevel(pinName: string): boolean | null {
  const kind = classifyArduinoPowerPin(pinName);
  if (kind === 'gnd') return false;
  if (kind === '5v' || kind === '3v3') return true;
  return null;
}

function resolveSignal(graph: CircuitGraph, runner: AVRRunner, node: string): SignalSource | null {
  const power = traceToPower(graph, node)[0];
  if (power) {
    const high = powerLevel(power.pin);
    if (high !== null) return { kind: 'constant', high };
  }
  const digital = traceToArduinoPin(graph, node)[0];
  if (digital) {
    const pin = resolveArduinoDigitalPin(runner, digital.pin);
    if (pin) return { kind: 'digital', pin };
  }
  return null;
}

function readSignal(source: SignalSource | null): boolean | null {
  if (!source) return null;
  if (source.kind === 'constant') return source.high;
  return source.pin.port.pinState(source.pin.bit) === PinState.High;
}

function writeExternalPin(pin: PortPin, high: boolean) {
  pin.port.setPin(pin.bit, high);
}

function parseCompileLine(message: string): number | null {
  const match = /(?:sketch\.ino|\.ino):(\d+)(?::\d+)?/i.exec(message);
  return match ? Number(match[1]) : null;
}

class SimulatorRuntime {
  private runner: AVRRunner | null = null;
  private cleanupCallbacks: Array<() => void> = [];
  private outputUpdater: (() => void) | null = null;
  private boardId: string | null = null;

  async start(signal?: AbortSignal) {
    this.stop(false);
    const state = circuitStore.getSnapshot();
    const boards = state.parts.filter((part) => part.type === 'wokwi-arduino-uno');
    if (boards.length !== 1) {
      const message = boards.length === 0
        ? 'Add one Arduino Uno before starting the simulation.'
        : 'The MVP simulator currently runs one Arduino Uno at a time.';
      circuitStore.setSimulation({ status: 'error', error: message });
      throw new Error(message);
    }

    const diagnostics = diagnoseCircuit(state);
    const blocking = diagnostics.find((item) => item.severity === 'error');
    if (blocking) {
      circuitStore.setSimulation({ status: 'error', error: blocking.message });
      circuitStore.focus({ itemIds: blocking.itemIds, message: blocking.message }, 9000);
      throw new Error(blocking.message);
    }

    const board = boards[0];
    const code = board.code?.trim();
    if (!code) {
      const message = 'The Arduino sketch is empty.';
      circuitStore.setSimulation({ status: 'error', error: message });
      throw new Error(message);
    }

    circuitStore.setSimulation({
      status: 'compiling',
      compileOutput: '',
      serialOutput: '',
      error: null,
    });

    try {
      const compiled = await compileArduino(code, signal);
      if (signal?.aborted) throw new DOMException('Simulation start cancelled.', 'AbortError');
      const runner = new AVRRunner(compiled.hex);
      const graph = buildCircuitGraph(circuitStore.getSnapshot());
      this.runner = runner;
      this.boardId = board.id;
      this.setupInputs(circuitStore.getSnapshot(), graph, runner);
      this.outputUpdater = this.createOutputUpdater(circuitStore.getSnapshot(), graph, runner, board.id);

      runner.usart.onByteTransmit = (byte) => {
        const current = circuitStore.getSnapshot().simulation.serialOutput;
        const next = (current + String.fromCharCode(byte)).slice(-12000);
        circuitStore.setSimulation({ serialOutput: next });
      };

      const boardElement = getElement(board.id);
      if (boardElement) boardElement.ledPower = true;
      circuitStore.setSimulation({
        status: 'running',
        compileOutput: compiled.stderr || compiled.stdout,
        error: null,
      });
      this.outputUpdater();
      runner.start(this.outputUpdater);
      return { status: 'running' as const, compileOutput: compiled.stderr || compiled.stdout };
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error;
      const message = error instanceof Error ? error.message : String(error);
      circuitStore.setSimulation({ status: 'error', error: message, compileOutput: message });
      const line = parseCompileLine(message);
      if (line) {
        circuitStore.focus({
          itemIds: [board.id],
          code: { boardId: board.id, startLine: line, endLine: line },
          message: 'The compiler reported an error on this line.',
        }, 10000);
      }
      throw error;
    }
  }

  stop(updateStore = true) {
    this.runner?.stop();
    this.runner = null;
    for (const cleanup of this.cleanupCallbacks.splice(0)) cleanup();
    this.outputUpdater = null;

    if (this.boardId) {
      const boardElement = getElement(this.boardId);
      if (boardElement) {
        boardElement.led13 = false;
        boardElement.ledPower = false;
      }
    }
    this.boardId = null;

    for (const part of circuitStore.getSnapshot().parts) {
      const element = getElement(part.id);
      if (!element) continue;
      if (part.type === 'wokwi-led') element.value = false;
      if (part.type === 'wokwi-rgb-led') {
        element.ledRed = 0;
        element.ledGreen = 0;
        element.ledBlue = 0;
      }
      if (part.type === 'wokwi-buzzer') element.hasSignal = false;
      if (part.type === 'wokwi-7segment') element.values = [0, 0, 0, 0, 0, 0, 0, 0];
    }

    if (updateStore) circuitStore.setSimulation({ status: 'stopped', error: null });
    return { status: 'stopped' as const };
  }

  private createOutputUpdater(
    documentState: Pick<CircuitDocument, 'parts' | 'connections'>,
    graph: CircuitGraph,
    runner: AVRRunner,
    boardId: string,
  ) {
    const outputBindings = documentState.parts.map((part) => {
      const source = (pin: string) => resolveSignal(graph, runner, nodeRef(part.id, pin));
      if (part.type === 'wokwi-led') {
        const anode = source('A');
        const cathode = source('C');
        return () => {
          const element = getElement(part.id);
          if (!element) return;
          const a = readSignal(anode);
          const c = readSignal(cathode);
          element.value = a === true && c === false;
        };
      }
      if (part.type === 'wokwi-rgb-led') {
        const common = source('COM');
        const red = source('R');
        const green = source('G');
        const blue = source('B');
        const commonAnode = String(part.attrs.common ?? 'cathode').toLowerCase() === 'anode';
        const lit = (channel: SignalSource | null) => {
          const c = readSignal(common);
          const value = readSignal(channel);
          if (value === null) return 0;
          if (c === null) return value ? 1 : 0;
          return commonAnode ? (c && !value ? 1 : 0) : (!c && value ? 1 : 0);
        };
        return () => {
          const element = getElement(part.id);
          if (!element) return;
          element.ledRed = lit(red);
          element.ledGreen = lit(green);
          element.ledBlue = lit(blue);
        };
      }
      if (part.type === 'wokwi-buzzer') {
        const one = source('1');
        const two = source('2');
        return () => {
          const element = getElement(part.id);
          if (!element) return;
          const a = readSignal(one);
          const b = readSignal(two);
          element.hasSignal = a !== null && b !== null && a !== b;
        };
      }
      if (part.type === 'wokwi-7segment') {
        const segmentNames = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'];
        const segments = segmentNames.map((name) => source(name));
        const commons = [source('COM.1'), source('COM.2'), source('COM')].filter(Boolean) as SignalSource[];
        return () => {
          const element = getElement(part.id);
          if (!element) return;
          const common = commons.map(readSignal).find((value) => value !== null) ?? false;
          element.values = segments.map((segment) => {
            const value = readSignal(segment);
            return value !== null && value && !common ? 1 : 0;
          });
        };
      }
      return null;
    }).filter((binding): binding is () => void => Boolean(binding));

    return () => {
      const boardElement = getElement(boardId);
      if (boardElement) boardElement.led13 = runner.portB.pinState(5) === PinState.High;
      for (const update of outputBindings) update();
    };
  }

  private setupInputs(
    documentState: Pick<CircuitDocument, 'parts' | 'connections'>,
    graph: CircuitGraph,
    runner: AVRRunner,
  ) {
    for (const part of documentState.parts) {
      if (part.type === 'wokwi-potentiometer') this.bindPotentiometer(part, graph, runner);
      if (part.type === 'wokwi-pushbutton') this.bindPushbutton(part, graph, runner);
      if (part.type === 'wokwi-slide-switch') this.bindSlideSwitch(part, graph, runner);
    }
  }

  private bindPotentiometer(part: CircuitPart, graph: CircuitGraph, runner: AVRRunner) {
    const trace = traceToArduinoPin(graph, nodeRef(part.id, 'SIG')).find((result) => /^A[0-5]$/i.test(result.pin));
    if (!trace) return;
    const channel = resolveArduinoAnalogChannel(trace.pin);
    const element = getElement(part.id);
    if (channel === null || !element) return;

    const update = () => {
      const value = Number(element.value ?? part.attrs.value ?? 512);
      runner.adc.channelValues[channel] = Math.max(0, Math.min(5, (value / 1023) * 5));
    };
    element.addEventListener('input', update);
    this.cleanupCallbacks.push(() => element.removeEventListener('input', update));
    update();
  }

  private bindPushbutton(part: CircuitPart, graph: CircuitGraph, runner: AVRRunner) {
    const sideOne = ['1.l', '1.r'];
    const sideTwo = ['2.l', '2.r'];
    const findDigital = (pins: string[]) => pins
      .flatMap((pin) => traceToArduinoPin(graph, nodeRef(part.id, pin)))
      .map((trace) => resolveArduinoDigitalPin(runner, trace.pin))
      .find((pin): pin is PortPin => Boolean(pin));
    const findPower = (pins: string[]) => pins
      .flatMap((pin) => traceToPower(graph, nodeRef(part.id, pin)))
      .map((trace) => powerLevel(trace.pin))
      .find((value): value is boolean => value !== null);

    const digitalOne = findDigital(sideOne);
    const digitalTwo = findDigital(sideTwo);
    const digital = digitalOne ?? digitalTwo;
    if (!digital) return;
    const otherPower = digitalOne ? findPower(sideTwo) : findPower(sideOne);
    const pressedLevel = otherPower ?? false;
    const element = getElement(part.id);
    if (!element) return;

    const press = () => writeExternalPin(digital, pressedLevel);
    const release = () => writeExternalPin(digital, !pressedLevel);
    element.addEventListener('button-press', press);
    element.addEventListener('button-release', release);
    this.cleanupCallbacks.push(() => {
      element.removeEventListener('button-press', press);
      element.removeEventListener('button-release', release);
    });
    release();
  }

  private bindSlideSwitch(part: CircuitPart, graph: CircuitGraph, runner: AVRRunner) {
    const digitalTrace = traceToArduinoPin(graph, nodeRef(part.id, '2'))[0];
    const digital = digitalTrace ? resolveArduinoDigitalPin(runner, digitalTrace.pin) : null;
    const element = getElement(part.id);
    if (!digital || !element) return;

    const sideOne = traceToPower(graph, nodeRef(part.id, '1')).map((trace) => powerLevel(trace.pin)).find((v) => v !== null);
    const sideThree = traceToPower(graph, nodeRef(part.id, '3')).map((trace) => powerLevel(trace.pin)).find((v) => v !== null);
    const update = () => {
      const value = Number(element.value ?? 0);
      const level = value ? sideThree : sideOne;
      if (level !== undefined && level !== null) writeExternalPin(digital, level);
    };
    element.addEventListener('input', update);
    this.cleanupCallbacks.push(() => element.removeEventListener('input', update));
    update();
  }
}

export const simulator = new SimulatorRuntime();
