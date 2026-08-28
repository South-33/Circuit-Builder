// AVR8js is MIT licensed. This runner follows the small official AVR8js demo
// rather than copying a full simulator application.

import {
  adcConfig,
  avrInstruction,
  AVRADC,
  AVRIOPort,
  AVRTimer,
  AVRUSART,
  AVRTWI,
  CPU,
  portBConfig,
  portCConfig,
  portDConfig,
  timer0Config,
  timer1Config,
  timer2Config,
  twiConfig,
  usart0Config,
} from 'avr8js';
import { loadHex } from './intelhex';

const FLASH_WORDS = 0x8000;
const FREQUENCY_HZ = 16_000_000;

export class AVRRunner {
  readonly program = new Uint16Array(FLASH_WORDS);
  readonly cpu: CPU;
  readonly timer0: AVRTimer;
  readonly timer1: AVRTimer;
  readonly timer2: AVRTimer;
  readonly portB: AVRIOPort;
  readonly portC: AVRIOPort;
  readonly portD: AVRIOPort;
  readonly adc: AVRADC;
  readonly usart: AVRUSART;
  readonly twi: AVRTWI;
  readonly frequency = FREQUENCY_HZ;

  private animationFrame: number | null = null;
  private executionTimer: number | null = null;
  private stopped = true;

  constructor(hex: string) {
    loadHex(hex, new Uint8Array(this.program.buffer));
    this.cpu = new CPU(this.program);
    this.timer0 = new AVRTimer(this.cpu, timer0Config);
    this.timer1 = new AVRTimer(this.cpu, timer1Config);
    this.timer2 = new AVRTimer(this.cpu, timer2Config);
    this.portB = new AVRIOPort(this.cpu, portBConfig);
    this.portC = new AVRIOPort(this.cpu, portCConfig);
    this.portD = new AVRIOPort(this.cpu, portDConfig);
    this.adc = new AVRADC(this.cpu, adcConfig);
    this.usart = new AVRUSART(this.cpu, usart0Config, FREQUENCY_HZ);
    this.twi = new AVRTWI(this.cpu, twiConfig, FREQUENCY_HZ);
  }

  start(onFrame?: () => void) {
    this.stopped = false;

    // Run the MCU in short wall-clock slices and yield between them. A fixed
    // instruction/cycle chunk can become a long task when the simulated
    // program exercises expensive peripherals, which makes dragging and the
    // editor feel delayed even though the AVR is still making progress.
    const runChunk = () => {
      if (this.stopped) return;
      const maxCycles = this.cpu.cycles + 90_000;
      const wallDeadline = performance.now() + 2.5;
      let instructions = 0;
      while (this.cpu.cycles < maxCycles) {
        avrInstruction(this.cpu);
        this.cpu.tick();
        instructions++;
        if ((instructions & 511) === 0 && performance.now() >= wallDeadline) break;
      }
      this.executionTimer = window.setTimeout(runChunk, 0);
    };

    const safeRequestAnimationFrame = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number;

    const frame = () => {
      if (this.stopped) return;
      onFrame?.();
      this.animationFrame = safeRequestAnimationFrame(frame);
    };

    runChunk();
    this.animationFrame = safeRequestAnimationFrame(frame);
  }

  stop() {
    this.stopped = true;
    const safeCancelAnimationFrame = typeof cancelAnimationFrame === 'function'
      ? cancelAnimationFrame
      : (id: number) => clearTimeout(id);

    if (this.animationFrame !== null) safeCancelAnimationFrame(this.animationFrame);
    if (this.executionTimer !== null) (typeof window !== 'undefined' ? window.clearTimeout : clearTimeout)(this.executionTimer);
    this.animationFrame = null;
    this.executionTimer = null;
  }
}

