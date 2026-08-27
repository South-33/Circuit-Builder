import type { CircuitPart } from '../../circuit/types';
import {
  digitalPinForNode,
  getElement,
  pinNode,
  resetInputPin,
  writeExternalPin,
  type DeviceContext,
} from './shared';

type ReceiverRuntime = {
  send: (command: number) => void;
  reset: () => void;
};

const NEC_ADDRESS = 0x00;

function bindReceiver(context: DeviceContext, part: CircuitPart): ReceiverRuntime | null {
  const dat = digitalPinForNode(context.graph, context.runner, pinNode(part, 'DAT'));
  if (!dat) return null;

  const cyclesPerUs = context.runner.frequency / 1_000_000;
  const scheduled = new Set<() => void>();
  let transmitting = false;

  const schedule = (offsetCycles: number, high: boolean) => {
    const event = () => {
      scheduled.delete(event);
      writeExternalPin(dat, high);
    };
    scheduled.add(event);
    context.runner.cpu.addClockEvent(event, Math.max(1, Math.round(offsetCycles)));
  };

  const send = (command: number) => {
    if (transmitting) return;
    transmitting = true;

    const frame = [NEC_ADDRESS, (~NEC_ADDRESS) & 0xff, command & 0xff, (~command) & 0xff];
    const bits: number[] = [];
    for (const byte of frame) {
      for (let bit = 0; bit < 8; bit++) bits.push((byte >> bit) & 1);
    }

    let offset = 10 * cyclesPerUs;
    schedule(offset, false); offset += 9000 * cyclesPerUs;
    schedule(offset, true); offset += 4500 * cyclesPerUs;
    for (const bit of bits) {
      schedule(offset, false); offset += 562.5 * cyclesPerUs;
      schedule(offset, true); offset += (bit ? 1687.5 : 562.5) * cyclesPerUs;
    }
    schedule(offset, false); offset += 562.5 * cyclesPerUs;
    schedule(offset, true);

    const done = () => {
      scheduled.delete(done);
      transmitting = false;
    };
    scheduled.add(done);
    context.runner.cpu.addClockEvent(done, Math.round(offset + 100 * cyclesPerUs));
  };

  const reset = () => {
    for (const event of scheduled) context.runner.cpu.clearClockEvent(event);
    scheduled.clear();
    transmitting = false;
    resetInputPin(dat);
    writeExternalPin(dat, true);
  };

  writeExternalPin(dat, true);
  return { send, reset };
}

export function setupInfraredDevices(context: DeviceContext) {
  const receivers = context.documentState.parts
    .filter((part) => part.type === 'wokwi-ir-receiver')
    .map((part) => bindReceiver(context, part))
    .filter((runtime): runtime is ReceiverRuntime => runtime !== null);

  for (const receiver of receivers) context.resetters.push(receiver.reset);
  if (receivers.length === 0) return;

  for (const remote of context.documentState.parts.filter((part) => part.type === 'wokwi-ir-remote')) {
    const element = getElement(remote.id);
    if (!element) continue;
    const onPress = (event: Event) => {
      const detail = (event as CustomEvent<{ irCode?: number }>).detail;
      if (typeof detail?.irCode !== 'number') return;
      for (const receiver of receivers) receiver.send(detail.irCode);
    };
    element.addEventListener('button-press', onPress);
    context.cleanups.push(() => element.removeEventListener('button-press', onPress));
  }
}
