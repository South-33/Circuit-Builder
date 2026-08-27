// AVR8js is MIT licensed. This runner follows the small official AVR8js demo
// rather than copying a full simulator application.

import {
  adcConfig,
  avrInstruction,
  AVRADC,
  AVRIOPort,
  AVRTimer,
  AVRUSART,
  CPU,
  portBConfig,
  portCConfig,
  portDConfig,
  timer0Config,
  timer1Config,
  timer2Config,
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
  }

  start(onFrame?: () => void) {
    this.stopped = false;

    // Run the MCU in bounded chunks and yield back to the browser between
    // chunks. Trying to catch up to a full 16 MHz in one animation frame can
    // starve React and make the editor look frozen even while the AVR runs.
    const runChunk = () => {
      if (this.stopped) return;
      const deadline = this.cpu.cycles + 100_000;
      while (this.cpu.cycles < deadline) {
        avrInstruction(this.cpu);
        this.cpu.tick();
      }
      this.executionTimer = window.setTimeout(runChunk, 0);
    };

    const frame = () => {
      if (this.stopped) return;
      onFrame?.();
      this.animationFrame = requestAnimationFrame(frame);
    };

    runChunk();
    this.animationFrame = requestAnimationFrame(frame);
  }

  stop() {
    this.stopped = true;
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    if (this.executionTimer !== null) window.clearTimeout(this.executionTimer);
    this.animationFrame = null;
    this.executionTimer = null;
  }
}

