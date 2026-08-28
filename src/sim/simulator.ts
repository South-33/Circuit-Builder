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

function getBoardElement(partId: string): BoardElement | null {
  return document.querySelector(`[data-part-element="${CSS.escape(partId)}"]`) as BoardElement | null;
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
