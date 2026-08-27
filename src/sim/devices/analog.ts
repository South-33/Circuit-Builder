import type { CircuitPart } from '../../circuit/types';
import {
  addEvent,
  analogChannelForNode,
  digitalPinForNode,
  getElement,
  pinNode,
  resetInputPin,
  writeExternalPin,
  type DeviceContext,
} from './shared';

function bindPotentiometer(context: DeviceContext, part: CircuitPart, range: { min: number; max: number }) {
  const channel = analogChannelForNode(context.graph, pinNode(part, 'SIG'));
  const element = getElement(part.id);
  if (channel === null || !element) return;
  const update = () => {
    const value = Number(element.value ?? part.attrs.value ?? range.min);
    const normalized = Math.max(0, Math.min(1, (value - range.min) / Math.max(1, range.max - range.min)));
    context.runner.adc.channelValues[channel] = normalized * 5;
  };
  addEvent(context, element, 'input', update);
  context.frameUpdaters.push(update);
  update();
}

function bindJoystick(context: DeviceContext, part: CircuitPart) {
  const element = getElement(part.id);
  if (!element) return;
  const horizontal = analogChannelForNode(context.graph, pinNode(part, 'HORZ'));
  const vertical = analogChannelForNode(context.graph, pinNode(part, 'VERT'));
  const select = digitalPinForNode(context.graph, context.runner, pinNode(part, 'SEL'));

  const updateAxes = () => {
    if (horizontal !== null) {
      const value = Number(element.xValue ?? 0);
      context.runner.adc.channelValues[horizontal] = Math.max(0, Math.min(5, ((value + 1) / 2) * 5));
    }
    if (vertical !== null) {
      const value = Number(element.yValue ?? 0);
      context.runner.adc.channelValues[vertical] = Math.max(0, Math.min(5, ((1 - value) / 2) * 5));
    }
  };
  const press = () => { if (select) writeExternalPin(select, false); };
  const release = () => { if (select) resetInputPin(select); };
  addEvent(context, element, 'input', updateAxes);
  addEvent(context, element, 'button-press', press);
  addEvent(context, element, 'button-release', release);
  context.frameUpdaters.push(updateAxes);
  context.resetters.push(release);
  updateAxes();
  release();
}

export function setupAnalogDevices(context: DeviceContext) {
  for (const part of context.documentState.parts) {
    if (part.type === 'wokwi-potentiometer') bindPotentiometer(context, part, { min: 0, max: 1023 });
    if (part.type === 'wokwi-slide-potentiometer') {
      bindPotentiometer(context, part, {
        min: Number(part.attrs.min ?? 0),
        max: Number(part.attrs.max ?? 100),
      });
    }
    if (part.type === 'wokwi-analog-joystick') bindJoystick(context, part);
  }
}
