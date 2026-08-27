import type { CircuitPart } from '../../circuit/types';
import {
  addEvent,
  digitalPinForNode,
  getElement,
  pinNode,
  poweredLevelForNode,
  readSignal,
  resetInputPin,
  resolveSignal,
  writeExternalPin,
  type DeviceContext,
  type SignalSource,
} from './shared';

function bindMomentaryButton(context: DeviceContext, part: CircuitPart) {
  const sideOne = ['1.l', '1.r'];
  const sideTwo = ['2.l', '2.r'];
  const findDigital = (pins: string[]) => pins
    .map((pin) => digitalPinForNode(context.graph, context.runner, pinNode(part, pin)))
    .find((value) => value !== null) ?? null;
  const findPower = (pins: string[]) => pins
    .map((pin) => poweredLevelForNode(context.graph, pinNode(part, pin)))
    .find((value) => value !== undefined);

  const digitalOne = findDigital(sideOne);
  const digitalTwo = findDigital(sideTwo);
  const digital = digitalOne ?? digitalTwo;
  const element = getElement(part.id);
  if (!digital || !element) return;

  const otherPower = digitalOne ? findPower(sideTwo) : findPower(sideOne);
  const pressedLevel = otherPower ?? false;
  const press = () => writeExternalPin(digital, pressedLevel);
  const release = () => resetInputPin(digital);
  addEvent(context, element, 'button-press', press);
  addEvent(context, element, 'button-release', release);
  release();
}

function bindSlideSwitch(context: DeviceContext, part: CircuitPart) {
  const digital = digitalPinForNode(context.graph, context.runner, pinNode(part, '2'));
  const element = getElement(part.id);
  if (!digital || !element) return;
  const sideOne = poweredLevelForNode(context.graph, pinNode(part, '1'));
  const sideThree = poweredLevelForNode(context.graph, pinNode(part, '3'));
  const update = () => {
    const position = Number(element.value ?? 0);
    const level = position ? sideThree : sideOne;
    if (level !== undefined) writeExternalPin(digital, level);
    else resetInputPin(digital);
  };
  addEvent(context, element, 'input', update);
  update();
}

function bindTilt(context: DeviceContext, part: CircuitPart) {
  const digital = digitalPinForNode(context.graph, context.runner, pinNode(part, 'OUT'));
  if (!digital) return;
  const frame = () => {
    const element = getElement(part.id);
    const tilted = Boolean(element?.tilted ?? part.attrs.tilted ?? false);
    writeExternalPin(digital, tilted);
  };
  context.frameUpdaters.push(frame);
  context.resetters.push(() => resetInputPin(digital));
}

function bindDipSwitch(context: DeviceContext, part: CircuitPart) {
  const element = getElement(part.id);
  if (!element) return;
  const pairs = Array.from({ length: 8 }, (_, index) => {
    const number = index + 1;
    const aNode = pinNode(part, `${number}a`);
    const bNode = pinNode(part, `${number}b`);
    const aDigital = digitalPinForNode(context.graph, context.runner, aNode);
    const bDigital = digitalPinForNode(context.graph, context.runner, bNode);
    const aPower = poweredLevelForNode(context.graph, aNode);
    const bPower = poweredLevelForNode(context.graph, bNode);
    return { aDigital, bDigital, aPower, bPower };
  });

  const update = () => {
    const values = Array.isArray(element.values) ? element.values as number[] : [];
    pairs.forEach((pair, index) => {
      const closed = Boolean(values[index]);
      if (pair.aDigital) {
        if (closed && pair.bPower !== undefined) writeExternalPin(pair.aDigital, pair.bPower);
        else resetInputPin(pair.aDigital);
      }
      if (pair.bDigital) {
        if (closed && pair.aPower !== undefined) writeExternalPin(pair.bDigital, pair.aPower);
        else resetInputPin(pair.bDigital);
      }
    });
  };
  addEvent(context, element, 'switch-change', update);
  context.frameUpdaters.push(update);
  context.resetters.push(() => pairs.forEach((pair) => {
    resetInputPin(pair.aDigital);
    resetInputPin(pair.bDigital);
  }));
  update();
}

function outputBindings(context: DeviceContext, part: CircuitPart) {
  const source = (pin: string) => resolveSignal(context.graph, context.runner, pinNode(part, pin));

  if (part.type === 'wokwi-led') {
    const anode = source('A');
    const cathode = source('C');
    context.frameUpdaters.push(() => {
      const element = getElement(part.id);
      if (element) element.value = readSignal(anode) === true && readSignal(cathode) === false;
    });
    context.resetters.push(() => { const element = getElement(part.id); if (element) element.value = false; });
  }

  if (part.type === 'wokwi-rgb-led') {
    const common = source('COM');
    const channels = [source('R'), source('G'), source('B')];
    const commonAnode = String(part.attrs.common ?? 'cathode').toLowerCase() === 'anode';
    const lit = (channel: SignalSource | null) => {
      const commonValue = readSignal(common);
      const value = readSignal(channel);
      if (value === null) return 0;
      if (commonValue === null) return value ? 1 : 0;
      return commonAnode ? (commonValue && !value ? 1 : 0) : (!commonValue && value ? 1 : 0);
    };
    context.frameUpdaters.push(() => {
      const element = getElement(part.id);
      if (!element) return;
      [element.ledRed, element.ledGreen, element.ledBlue] = channels.map(lit);
    });
    context.resetters.push(() => {
      const element = getElement(part.id);
      if (!element) return;
      element.ledRed = 0; element.ledGreen = 0; element.ledBlue = 0;
    });
  }

  if (part.type === 'wokwi-buzzer') {
    const one = source('1');
    const two = source('2');
    context.frameUpdaters.push(() => {
      const element = getElement(part.id);
      const a = readSignal(one);
      const b = readSignal(two);
      if (element) element.hasSignal = a !== null && b !== null && a !== b;
    });
    context.resetters.push(() => { const element = getElement(part.id); if (element) element.hasSignal = false; });
  }

  if (part.type === 'wokwi-7segment') {
    const segmentNames = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'];
    const segments = segmentNames.map(source);
    const commons = [source('COM.1'), source('COM.2'), source('COM')].filter(Boolean) as SignalSource[];
    context.frameUpdaters.push(() => {
      const element = getElement(part.id);
      if (!element) return;
      const common = commons.map(readSignal).find((value) => value !== null) ?? false;
      element.values = segments.map((segment) => readSignal(segment) === true && !common ? 1 : 0);
    });
    context.resetters.push(() => { const element = getElement(part.id); if (element) element.values = new Array(8).fill(0); });
  }

  if (part.type === 'wokwi-led-bar-graph') {
    const leds = Array.from({ length: 10 }, (_, index) => ({
      anode: source(`A${index + 1}`),
      cathode: source(`C${index + 1}`),
    }));
    context.frameUpdaters.push(() => {
      const element = getElement(part.id);
      if (!element) return;
      element.values = leds.map(({ anode, cathode }) => readSignal(anode) === true && readSignal(cathode) === false ? 1 : 0);
    });
    context.resetters.push(() => { const element = getElement(part.id); if (element) element.values = new Array(10).fill(0); });
  }
}

export function setupBasicDevices(context: DeviceContext) {
  for (const part of context.documentState.parts) {
    outputBindings(context, part);
    if (part.type === 'wokwi-pushbutton' || part.type === 'wokwi-pushbutton-6mm') bindMomentaryButton(context, part);
    if (part.type === 'wokwi-slide-switch') bindSlideSwitch(context, part);
    if (part.type === 'wokwi-tilt-switch') bindTilt(context, part);
    if (part.type === 'wokwi-dip-switch-8') bindDipSwitch(context, part);
  }
}
