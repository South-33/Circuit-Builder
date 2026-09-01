import { circuitStore } from '../circuit/store';
import { buildCircuitGraph } from './circuitGraph';
import { diagnoseCircuit } from './diagnostics';
import type { AVRRunner } from './avrRunner';
import type { DeviceRuntime } from './devices';

const PIN_STATE_HIGH = 1;

type BoardElement = HTMLElement & {
  led13?: boolean;
  ledPower?: boolean;
};

type ObservableElement = HTMLElement & {
  value?: unknown;
  angle?: unknown;
  hasSignal?: unknown;
  ledRed?: unknown;
  ledGreen?: unknown;
  ledBlue?: unknown;
  values?: unknown;
};

function getBoardElement(partId: string): BoardElement | null {
  return document.querySelector(`[data-part-element="${CSS.escape(partId)}"]`) as BoardElement | null;
}

function getPartElement(partId: string): ObservableElement | null {
  return document.querySelector(`[data-part-element="${CSS.escape(partId)}"]`) as ObservableElement | null;
}

function observablePartState(part: ReturnType<typeof circuitStore.getSnapshot>['parts'][number]) {
  const element = getPartElement(part.id);
  if (!element) return {};
  if (part.type === 'wokwi-arduino-uno') {
    return { led13: Boolean((element as BoardElement).led13), powerLed: Boolean((element as BoardElement).ledPower) };
  }
  if (part.type === 'wokwi-led') return { lit: Boolean(element.value) };
  if (part.type === 'wokwi-rgb-led') {
    return {
      red: Number(element.ledRed ?? 0),
      green: Number(element.ledGreen ?? 0),
      blue: Number(element.ledBlue ?? 0),
    };
  }
  if (part.type === 'wokwi-servo' || part.type === 'wokwi-stepper-motor') return { angle: Number(element.angle ?? 0) };
  if (part.type === 'dc-motor') return { direction: element.dataset.motorDirection ?? 'stopped' };
  if (part.type === 'wokwi-buzzer') return { active: Boolean(element.hasSignal) };
  if (part.type === 'wokwi-7segment' || part.type === 'wokwi-led-bar-graph') {
    return { values: Array.isArray(element.values) ? [...element.values] : [] };
  }
  if (part.type === 'wokwi-ks2e-m-dc5') return { energized: Boolean(element.value) };
  return {};
}

function uniqueObservedValues(samples: Array<Record<string, unknown>>) {
  const byField = new Map<string, Map<string, unknown>>();
  for (const sample of samples) {
    for (const [field, value] of Object.entries(sample)) {
      const values = byField.get(field) ?? new Map<string, unknown>();
      values.set(JSON.stringify(value), value);
      byField.set(field, values);
    }
  }
  return Object.fromEntries([...byField.entries()].map(([field, values]) => [field, [...values.values()]]));
}

function parseCompileLine(message: string): number | null {
  const match = /(?:sketch\.ino|\.ino):(\d+)(?::\d+)?/i.exec(message);
  return match ? Number(match[1]) : null;
}

class SimulatorRuntime {
  private runner: AVRRunner | null = null;
  private devices: DeviceRuntime | null = null;
  private boardId: string | null = null;
  private serialBuffer = '';
  private serialFlushTimer: number | null = null;

  private queueSerial(byte: number) {
    this.serialBuffer += String.fromCharCode(byte);
    if (this.serialFlushTimer !== null) return;
    this.serialFlushTimer = window.setTimeout(() => this.flushSerial(), 40);
  }

  private flushSerial() {
    if (this.serialFlushTimer !== null) window.clearTimeout(this.serialFlushTimer);
    this.serialFlushTimer = null;
    if (!this.serialBuffer) return;
    const current = circuitStore.getSnapshot().simulation.serialOutput;
    const next = (current + this.serialBuffer).slice(-12000);
    this.serialBuffer = '';
    circuitStore.setSimulation({ serialOutput: next });
  }

  async start(signal?: AbortSignal) {
    this.stop(false);
    const state = circuitStore.getSnapshot();
    const boards = state.parts.filter((part) => part.type === 'wokwi-arduino-uno');
    if (boards.length !== 1) {
      const message = boards.length === 0
        ? 'Add one Arduino Uno before starting the simulation.'
        : 'Run one Arduino Uno at a time.';
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
      // Keep the AVR engine and device bridges off the initial editor path.
      // The workbench can render and be edited without downloading simulator
      // code; the browser fetches these chunks only when simulation starts.
      const [{ compileArduino }, { AVRRunner }, { setupDevices }] = await Promise.all([
        import('./compiler'),
        import('./avrRunner'),
        import('./devices'),
      ]);
      const compiled = await compileArduino(code, signal);
      if (signal?.aborted) throw new DOMException('Simulation start cancelled.', 'AbortError');

      const runner = new AVRRunner(compiled.hex);
      const currentDocument = circuitStore.getSnapshot();
      const graph = buildCircuitGraph(currentDocument);
      const devices = setupDevices(currentDocument, graph, runner);
      this.runner = runner;
      this.devices = devices;
      this.boardId = board.id;

      runner.usart.onByteTransmit = (byte) => this.queueSerial(byte);

      const boardElement = getBoardElement(board.id);
      if (boardElement) boardElement.ledPower = true;
      circuitStore.setSimulation({
        status: 'running',
        compileOutput: compiled.stderr || compiled.stdout,
        error: null,
      });

      const updateFrame = () => {
        const element = getBoardElement(board.id);
        if (element) element.led13 = runner.portB.pinState(5) === PIN_STATE_HIGH;
        devices.frame();
      };
      updateFrame();
      runner.start(updateFrame);
      return { status: 'running' as const, compileOutput: compiled.stderr || compiled.stdout };
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        this.stop(false);
        circuitStore.setSimulation({ status: 'stopped', error: null, compileOutput: '' });
        throw error;
      }
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

  async observe(durationMs = 400, sampleCount = 6, signal?: AbortSignal) {
    if (!this.runner || circuitStore.getSnapshot().simulation.status !== 'running') {
      throw new Error('Start the simulation before observing runtime behavior.');
    }
    const duration = Math.max(0, Math.min(5000, Math.round(durationMs)));
    const count = Math.max(1, Math.min(30, Math.round(sampleCount)));
    const interval = count <= 1 ? 0 : duration / (count - 1);
    const state = circuitStore.getSnapshot();
    const observations = new Map<string, Array<Record<string, unknown>>>();

    for (let index = 0; index < count; index++) {
      if (signal?.aborted) throw new DOMException('Simulation observation cancelled.', 'AbortError');
      this.devices?.frame();
      for (const part of state.parts) {
        const sample = observablePartState(part);
        if (!Object.keys(sample).length) continue;
        const list = observations.get(part.id) ?? [];
        list.push(sample);
        observations.set(part.id, list);
      }
      if (index < count - 1 && interval > 0) {
        await new Promise<void>((resolve, reject) => {
          let cancel: (() => void) | null = null;
          const finish = () => {
            if (signal && cancel) signal.removeEventListener('abort', cancel);
            resolve();
          };
          const timer = window.setTimeout(finish, interval);
          if (!signal) return;
          cancel = () => {
            window.clearTimeout(timer);
            reject(new DOMException('Simulation observation cancelled.', 'AbortError'));
          };
          signal.addEventListener('abort', cancel, { once: true });
        });
      }
    }
    this.flushSerial();

    return {
      status: 'running' as const,
      durationMs: duration,
      samples: count,
      parts: state.parts.flatMap((part) => {
        const samples = observations.get(part.id);
        if (!samples?.length) return [];
        return [{
          id: part.id,
          type: part.type,
          current: samples.at(-1)!,
          observed: uniqueObservedValues(samples),
        }];
      }),
      serialOutput: circuitStore.getSnapshot().simulation.serialOutput.slice(-2000),
    };
  }

  stop(updateStore = true) {
    this.flushSerial();
    this.runner?.stop();
    this.devices?.cleanup();
    this.devices?.reset();
    this.runner = null;
    this.devices = null;

    if (this.boardId) {
      const boardElement = getBoardElement(this.boardId);
      if (boardElement) {
        boardElement.led13 = false;
        boardElement.ledPower = false;
      }
    }
    const state = circuitStore.getSnapshot();
    for (const part of state.parts) {
      if (part.type === 'wokwi-arduino-uno') {
        const boardElement = getBoardElement(part.id);
        if (boardElement) {
          boardElement.led13 = false;
          boardElement.ledPower = false;
        }
      }
    }
    this.boardId = null;

    if (updateStore) circuitStore.setSimulation({ status: 'stopped', error: null });
    return { status: 'stopped' as const };
  }
}

export const simulator = new SimulatorRuntime();
