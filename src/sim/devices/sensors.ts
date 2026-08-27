import type { CircuitPart } from '../../circuit/types';
import {
  addPortListener,
  analogChannelForNode,
  digitalPinForNode,
  getElement,
  pinNode,
  resetInputPin,
  writeExternalPin,
  type DeviceContext,
} from './shared';

function setAnalog(context: DeviceContext, part: CircuitPart, pin: string, volts: number) {
  const channel = analogChannelForNode(context.graph, pinNode(part, pin));
  if (channel === null) return;
  context.runner.adc.channelValues[channel] = Math.max(0, Math.min(5, volts));
}

function setDigital(context: DeviceContext, part: CircuitPart, pin: string, high: boolean) {
  const target = digitalPinForNode(context.graph, context.runner, pinNode(part, pin));
  if (target) writeExternalPin(target, high);
}

function bindNtc(context: DeviceContext, part: CircuitPart) {
  const update = () => {
    const element = getElement(part.id);
    const temperature = Number(element?.temperature ?? part.attrs.temperature ?? 24);
    const beta = Math.max(1, Number(element?.beta ?? part.attrs.beta ?? 3950));
    const kelvin = Math.max(1, temperature + 273.15);
    const resistance = 10_000 * Math.exp(beta * ((1 / kelvin) - (1 / 298.15)));
    const adc = 1023 / (1 + resistance / 10_000);
    setAnalog(context, part, 'OUT', (adc / 1023) * 5);
  };
  context.frameUpdaters.push(update);
  update();
}

function bindPhotoresistor(context: DeviceContext, part: CircuitPart) {
  const update = () => {
    const element = getElement(part.id);
    const lux = Math.max(0.001, Number(element?.lux ?? part.attrs.lux ?? 500));
    const threshold = Math.max(0, Math.min(5, Number(element?.threshold ?? part.attrs.threshold ?? 2.5)));
    const rl10 = Math.max(0.001, Number(element?.rl10 ?? part.attrs.rl10 ?? 50));
    const gamma = Math.max(0.01, Number(element?.gamma ?? part.attrs.gamma ?? 0.7));
    const resistance = rl10 * 1000 * Math.pow(10 / lux, gamma);
    const voltage = 5 * resistance / (resistance + 10_000);
    const dark = voltage > threshold;
    setAnalog(context, part, 'AO', voltage);
    setDigital(context, part, 'DO', dark);
    if (element) {
      element.ledPower = true;
      element.ledDO = !dark;
    }
  };
  context.frameUpdaters.push(update);
  context.resetters.push(() => {
    const element = getElement(part.id);
    if (element) { element.ledPower = false; element.ledDO = false; }
  });
  update();
}

function bindThresholdModule(
  context: DeviceContext,
  part: CircuitPart,
  options: { analogPin: string; digitalPin: string; levelKey: string; thresholdKey?: string; inverseDigital?: boolean },
) {
  const update = () => {
    const element = getElement(part.id);
    const level = Math.max(0, Math.min(100, Number(element?.[options.levelKey] ?? part.attrs[options.levelKey] ?? 0)));
    const volts = (level / 100) * 5;
    const threshold = Math.max(0, Math.min(5, Number(
      element?.[options.thresholdKey ?? 'threshold'] ?? part.attrs[options.thresholdKey ?? 'threshold'] ?? 2.5,
    )));
    setAnalog(context, part, options.analogPin, volts);
    const active = volts >= threshold;
    setDigital(context, part, options.digitalPin, options.inverseDigital ? !active : active);
    if (element) {
      if ('ledPower' in element) element.ledPower = true;
      if ('ledSignal' in element) element.ledSignal = active;
      if ('ledD0' in element) element.ledD0 = !active;
      if ('led1' in element) element.led1 = true;
      if ('led2' in element) element.led2 = active;
    }
  };
  context.frameUpdaters.push(update);
  context.resetters.push(() => {
    const element = getElement(part.id);
    if (!element) return;
    for (const key of ['ledPower', 'ledSignal', 'ledD0', 'led1', 'led2']) {
      if (key in element) element[key] = false;
    }
  });
  update();
}

function bindGas(context: DeviceContext, part: CircuitPart) {
  const update = () => {
    const element = getElement(part.id);
    const ppm = Math.max(0, Number(element?.ppm ?? part.attrs.ppm ?? 400));
    const threshold = Math.max(0, Math.min(5, Number(element?.threshold ?? part.attrs.threshold ?? 4.4)));
    // Wokwi documents the MQ2 output as monotonic rather than specifying a
    // transfer curve. Use a smooth log response across the useful simulator
    // range while preserving the documented higher-ppm -> higher-voltage rule.
    const volts = Math.max(0, Math.min(5, (Math.log10(ppm + 1) / Math.log10(10_001)) * 5));
    setAnalog(context, part, 'AOUT', volts);
    setDigital(context, part, 'DOUT', volts < threshold);
    if (element) { element.ledPower = true; element.ledD0 = volts < threshold; }
  };
  context.frameUpdaters.push(update);
  context.resetters.push(() => {
    const element = getElement(part.id);
    if (element) { element.ledPower = false; element.ledD0 = false; }
  });
  update();
}

function bindHeartbeat(context: DeviceContext, part: CircuitPart) {
  const update = () => {
    const bpm = Math.max(30, Math.min(220, Number(part.attrs.bpm ?? 72)));
    const periodCycles = context.runner.frequency * (60 / bpm);
    const phase = (context.runner.cpu.cycles % periodCycles) / periodCycles;
    // A simple PPG-like pulse shape: sharp systolic peak with a smaller tail.
    const pulse = phase < 0.08
      ? Math.sin((phase / 0.08) * Math.PI)
      : phase < 0.22
        ? 0.28 * Math.sin(((phase - 0.08) / 0.14) * Math.PI)
        : 0;
    setAnalog(context, part, 'OUT', 0.5 + pulse * 4);
  };
  context.frameUpdaters.push(update);
  update();
}

function bindPir(context: DeviceContext, part: CircuitPart) {
  const output = digitalPinForNode(context.graph, context.runner, pinNode(part, 'OUT'));
  if (!output) return;
  let previousMotion = false;
  let readyCycle = 0;
  let lowEvent: (() => void) | null = null;

  const trigger = () => {
    const element = getElement(part.id);
    const delaySeconds = Math.max(0.1, Number(element?.delayTime ?? part.attrs.delayTime ?? 5));
    const inhibitSeconds = Math.max(0, Number(element?.inhibitTime ?? part.attrs.inhibitTime ?? 1.2));
    const retrigger = String(element?.retrigger ?? part.attrs.retrigger ?? true) !== '0'
      && element?.retrigger !== false && part.attrs.retrigger !== false;
    if (context.runner.cpu.cycles < readyCycle) return;
    writeExternalPin(output, true);
    const delayCycles = Math.round(delaySeconds * context.runner.frequency);
    if (lowEvent && retrigger) context.runner.cpu.clearClockEvent(lowEvent);
    lowEvent = () => {
      writeExternalPin(output, false);
      readyCycle = context.runner.cpu.cycles + Math.round(inhibitSeconds * context.runner.frequency);
      lowEvent = null;
    };
    context.runner.cpu.addClockEvent(lowEvent, delayCycles);
  };

  context.frameUpdaters.push(() => {
    const element = getElement(part.id);
    const motion = Boolean(element?.motion ?? part.attrs.motion ?? false);
    if (motion && !previousMotion) trigger();
    previousMotion = motion;
  });
  context.resetters.push(() => {
    if (lowEvent) context.runner.cpu.clearClockEvent(lowEvent);
    lowEvent = null;
    resetInputPin(output);
  });
  resetInputPin(output);
}

function bindHcsr04(context: DeviceContext, part: CircuitPart) {
  const trig = digitalPinForNode(context.graph, context.runner, pinNode(part, 'TRIG'));
  const echo = digitalPinForNode(context.graph, context.runner, pinNode(part, 'ECHO'));
  if (!trig || !echo) return;
  const cyclesPerUs = context.runner.frequency / 1_000_000;
  let trigWasHigh = false;
  let riseCycle = 0;
  const scheduled = new Set<() => void>();

  const schedule = (cycles: number, callback: () => void) => {
    const event = () => { scheduled.delete(event); callback(); };
    scheduled.add(event);
    context.runner.cpu.addClockEvent(event, Math.max(1, Math.round(cycles)));
  };

  const listener = () => {
    const isHigh = trig.port.pinState(trig.bit) === 1;
    if (isHigh && !trigWasHigh) riseCycle = context.runner.cpu.cycles;
    if (!isHigh && trigWasHigh) {
      const pulseUs = (context.runner.cpu.cycles - riseCycle) / cyclesPerUs;
      if (pulseUs >= 8) {
        const element = getElement(part.id);
        const distance = Math.max(2, Math.min(400, Number(element?.distance ?? part.attrs.distance ?? 100)));
        const preDelay = 460 * cyclesPerUs;
        const echoDuration = Math.min(23_200, distance * 58) * cyclesPerUs;
        schedule(preDelay, () => writeExternalPin(echo, true));
        schedule(preDelay + echoDuration, () => writeExternalPin(echo, false));
      }
    }
    trigWasHigh = isHigh;
  };
  addPortListener(context, trig.port, listener);
  writeExternalPin(echo, false);
  context.resetters.push(() => {
    for (const event of scheduled) context.runner.cpu.clearClockEvent(event);
    scheduled.clear();
    writeExternalPin(echo, false);
  });
}

function bindDht22(context: DeviceContext, part: CircuitPart) {
  const data = digitalPinForNode(context.graph, context.runner, pinNode(part, 'SDA'));
  if (!data) return;
  const cyclesPerUs = context.runner.frequency / 1_000_000;
  let responding = false;
  let lastHigh = true;
  let lowStartCycle = 0;
  const scheduled = new Set<() => void>();

  const schedulePin = (offsetCycles: number, high: boolean) => {
    const event = () => {
      scheduled.delete(event);
      writeExternalPin(data, high);
    };
    scheduled.add(event);
    context.runner.cpu.addClockEvent(event, Math.max(1, Math.round(offsetCycles)));
  };

  const sendResponse = () => {
    responding = true;
    const element = getElement(part.id);
    const humidity = Math.max(0, Math.min(100, Number(element?.humidity ?? part.attrs.humidity ?? 40)));
    const temperature = Math.max(-40, Math.min(80, Number(element?.temperature ?? part.attrs.temperature ?? 24)));
    const humRaw = Math.round(humidity * 10);
    const tempAbs = Math.round(Math.abs(temperature) * 10);
    const tempRaw = temperature < 0 ? (tempAbs | 0x8000) : tempAbs;
    const bytes = [(humRaw >> 8) & 255, humRaw & 255, (tempRaw >> 8) & 255, tempRaw & 255, 0];
    bytes[4] = (bytes[0] + bytes[1] + bytes[2] + bytes[3]) & 255;
    const bits: number[] = [];
    for (const byte of bytes) for (let bit = 7; bit >= 0; bit--) bits.push((byte >> bit) & 1);

    let offset = 20 * cyclesPerUs;
    schedulePin(offset, false); offset += 80 * cyclesPerUs;
    schedulePin(offset, true); offset += 80 * cyclesPerUs;
    for (const bit of bits) {
      schedulePin(offset, false); offset += 50 * cyclesPerUs;
      schedulePin(offset, true); offset += (bit ? 70 : 27) * cyclesPerUs;
    }
    schedulePin(offset, false); offset += 50 * cyclesPerUs;
    schedulePin(offset, true);
    const done = () => { scheduled.delete(done); responding = false; };
    scheduled.add(done);
    context.runner.cpu.addClockEvent(done, Math.round(offset + 10 * cyclesPerUs));
  };

  const listener = () => {
    const isHigh = data.port.pinState(data.bit) !== 0;
    if (!isHigh && lastHigh && !responding) lowStartCycle = context.runner.cpu.cycles;
    if (isHigh && !lastHigh && !responding) {
      const lowUs = (context.runner.cpu.cycles - lowStartCycle) / cyclesPerUs;
      if (lowUs > 500) sendResponse();
    }
    lastHigh = isHigh;
  };
  addPortListener(context, data.port, listener);
  writeExternalPin(data, true);
  context.resetters.push(() => {
    for (const event of scheduled) context.runner.cpu.clearClockEvent(event);
    scheduled.clear();
    writeExternalPin(data, true);
  });
}

export function setupSensorDevices(context: DeviceContext) {
  for (const part of context.documentState.parts) {
    if (part.type === 'wokwi-ntc-temperature-sensor') bindNtc(context, part);
    if (part.type === 'wokwi-photoresistor-sensor') bindPhotoresistor(context, part);
    if (part.type === 'wokwi-pir-motion-sensor') bindPir(context, part);
    if (part.type === 'wokwi-gas-sensor') bindGas(context, part);
    if (part.type === 'wokwi-flame-sensor') {
      bindThresholdModule(context, part, { analogPin: 'AOUT', digitalPin: 'DOUT', levelKey: 'level' });
    }
    if (part.type === 'wokwi-big-sound-sensor' || part.type === 'wokwi-small-sound-sensor') {
      bindThresholdModule(context, part, { analogPin: 'AOUT', digitalPin: 'DOUT', levelKey: 'level' });
    }
    if (part.type === 'wokwi-heart-beat-sensor') bindHeartbeat(context, part);
    if (part.type === 'wokwi-hc-sr04') bindHcsr04(context, part);
    if (part.type === 'wokwi-dht22') bindDht22(context, part);
  }
}
