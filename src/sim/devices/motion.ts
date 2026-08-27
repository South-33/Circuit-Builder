import type { CircuitPart } from '../../circuit/types';
import {
  addEvent,
  addPortListener,
  digitalPinForNode,
  getElement,
  high,
  pinNode,
  resetInputPin,
  writeExternalPin,
  type DeviceContext,
} from './shared';
import { readSignal, resolveSignal } from './shared';

class StepperState {
  private lastPhase = -1;
  angle = 0;

  constructor(private readonly stepsPerRevolution: number) {}

  feed(ap: boolean, an: boolean, bp: boolean, bn: boolean) {
    const phase = ap && !an && bp && !bn ? 0
      : !ap && an && bp && !bn ? 1
        : !ap && an && !bp && bn ? 2
          : ap && !an && !bp && bn ? 3
            : -1;
    if (phase < 0 || phase === this.lastPhase) return;
    if (this.lastPhase >= 0) {
      const delta = phase - this.lastPhase;
      if (delta === 1 || delta === -3) this.angle += 360 / this.stepsPerRevolution;
      if (delta === -1 || delta === 3) this.angle -= 360 / this.stepsPerRevolution;
      this.angle = (this.angle % 360 + 360) % 360;
    }
    this.lastPhase = phase;
  }
}

function bindServo(context: DeviceContext, part: CircuitPart) {
  const signal = digitalPinForNode(context.graph, context.runner, pinNode(part, 'PWM'));
  const element = getElement(part.id);
  if (!signal || !element) return;
  let highCycle: number | null = null;
  const listener = (value: number, oldValue: number) => {
    const mask = 1 << signal.bit;
    const nowHigh = Boolean(value & mask);
    const wasHigh = Boolean(oldValue & mask);
    if (nowHigh && !wasHigh) highCycle = context.runner.cpu.cycles;
    if (!nowHigh && wasHigh && highCycle !== null) {
      const pulseUs = ((context.runner.cpu.cycles - highCycle) / context.runner.frequency) * 1_000_000;
      // Arduino Servo's common 0..180 degree pulse range is roughly 544..2400us.
      const angle = Math.max(0, Math.min(180, ((pulseUs - 544) / (2400 - 544)) * 180));
      if (pulseUs > 350 && pulseUs < 2800) element.angle = angle;
      highCycle = null;
    }
  };
  addPortListener(context, signal.port, listener);
  context.resetters.push(() => { const target = getElement(part.id); if (target) target.angle = 0; });
}

function bindStepper(context: DeviceContext, part: CircuitPart) {
  const pins = ['A+', 'A-', 'B+', 'B-'].map((name) => digitalPinForNode(context.graph, context.runner, pinNode(part, name)));
  if (pins.some((pin) => pin === null)) return;
  const [ap, an, bp, bn] = pins;
  const state = new StepperState(Math.max(4, Number(part.attrs.stepsPerRevolution ?? 200)));
  const update = () => {
    state.feed(high(ap), high(an), high(bp), high(bn));
    const element = getElement(part.id);
    if (element) element.angle = state.angle;
  };
  const uniquePorts = new Set(pins.map((pin) => pin!.port));
  for (const port of uniquePorts) addPortListener(context, port, update);
  context.frameUpdaters.push(update);
  context.resetters.push(() => { const element = getElement(part.id); if (element) element.angle = 0; });
  update();
}

function bindEncoder(context: DeviceContext, part: CircuitPart) {
  const element = getElement(part.id);
  const clk = digitalPinForNode(context.graph, context.runner, pinNode(part, 'CLK'));
  const dt = digitalPinForNode(context.graph, context.runner, pinNode(part, 'DT'));
  const sw = digitalPinForNode(context.graph, context.runner, pinNode(part, 'SW'));
  if (!element) return;

  const set = (pin: typeof clk, value: boolean) => { if (pin) writeExternalPin(pin, value); };
  const idle = () => { resetInputPin(clk); resetInputPin(dt); resetInputPin(sw); };
  const clockwise = () => {
    set(clk, false); set(dt, false); set(clk, true); set(dt, true);
  };
  const counterClockwise = () => {
    set(dt, false); set(clk, false); set(dt, true); set(clk, true);
  };
  const press = () => set(sw, false);
  const release = () => resetInputPin(sw);
  addEvent(context, element, 'rotate-cw', clockwise);
  addEvent(context, element, 'rotate-ccw', counterClockwise);
  addEvent(context, element, 'button-press', press);
  addEvent(context, element, 'button-release', release);
  context.resetters.push(idle);
  idle();
}

function bindDCMotor(context: DeviceContext, part: CircuitPart) {
  const pin1 = resolveSignal(context.graph, context.runner, pinNode(part, '1'));
  const pin2 = resolveSignal(context.graph, context.runner, pinNode(part, '2'));
  const update = () => {
    const a = readSignal(pin1);
    const b = readSignal(pin2);
    const element = getElement(part.id);
    if (!element) return;
    const direction = a === true && b === false
      ? 'forward'
      : a === false && b === true
        ? 'reverse'
        : 'stopped';
    element.dataset.motorDirection = direction;
  };
  context.frameUpdaters.push(update);
  context.resetters.push(() => {
    const element = getElement(part.id);
    if (element) element.dataset.motorDirection = 'stopped';
  });
  update();
}

export function setupMotionDevices(context: DeviceContext) {
  for (const part of context.documentState.parts) {
    if (part.type === 'wokwi-servo') bindServo(context, part);
    if (part.type === 'wokwi-stepper-motor') bindStepper(context, part);
    if (part.type === 'wokwi-ky-040') bindEncoder(context, part);
    if (part.type === 'dc-motor') bindDCMotor(context, part);
  }
}
