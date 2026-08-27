import type { CircuitPart } from '../../../circuit/types';
import { traceToArduinoPin } from '../../circuitGraph';
import { getElement, pinNode, type DeviceContext } from '../shared';
import { I2CBus, type I2CDevice } from './bus';
import { DS1307Controller, DS1307_ADDR } from './ds1307';
import { LCD1602Controller, LCD1602_ADDR } from './lcd1602';
import { LCD2004Controller } from './lcd2004';
import { MPU6050_ADDR, MPU6050Controller } from './mpu6050';
import { SSD1306_ADDR_32, SSD1306Controller } from './ssd1306';

type LcdElement = HTMLElement & {
  characters?: Uint8Array;
  blink?: boolean;
  cursor?: boolean;
  cursorX?: number;
  cursorY?: number;
  backlight?: boolean;
  cgram?: Uint8Array;
};

type OledElement = HTMLElement & {
  imageData?: ImageData;
  redraw?: () => void;
};

function connectedTo(context: DeviceContext, part: CircuitPart, pin: string, arduinoPin: string) {
  return traceToArduinoPin(context.graph, pinNode(part, pin))
    .some((trace) => trace.pin.toUpperCase() === arduinoPin.toUpperCase());
}

function hasI2CWiring(context: DeviceContext, part: CircuitPart) {
  const dataPin = part.type === 'wokwi-ssd1306' ? 'DATA' : 'SDA';
  const clockPin = part.type === 'wokwi-ssd1306' ? 'CLK' : 'SCL';
  return connectedTo(context, part, dataPin, 'A4') && connectedTo(context, part, clockPin, 'A5');
}

function applyLcdFrame(element: LcdElement | null, frame: ReturnType<LCD1602Controller['render']> | false) {
  if (!element || !frame) return;
  element.characters = frame.characters;
  element.blink = frame.blink;
  element.cursor = frame.cursor;
  element.cursorX = frame.cursorX;
  element.cursorY = frame.cursorY;
  element.backlight = frame.backlight;
  element.cgram = frame.cgram;
}

function registerDevice(bus: I2CBus, address: number, device: I2CDevice) {
  if (bus.devices[address]) return false;
  bus.registerDevice(address, device);
  return true;
}

function bindLcd1602(context: DeviceContext, bus: I2CBus, part: CircuitPart) {
  if (!hasI2CWiring(context, part)) return;
  const controller = new LCD1602Controller();
  if (!registerDevice(bus, LCD1602_ADDR, controller)) return;
  const update = () => applyLcdFrame(getElement(part.id) as LcdElement | null, controller.update());
  context.frameUpdaters.push(update);
}

function bindLcd2004(context: DeviceContext, bus: I2CBus, part: CircuitPart) {
  if (!hasI2CWiring(context, part)) return;
  const controller = new LCD2004Controller();
  if (!registerDevice(bus, LCD1602_ADDR, controller)) return;
  context.frameUpdaters.push(() => {
    const frame = controller.update();
    const element = getElement(part.id) as LcdElement | null;
    if (!element || !frame) return;
    element.characters = frame.characters;
    element.blink = frame.blink;
    element.cursor = frame.cursor;
    element.cursorX = frame.cursorX;
    element.cursorY = frame.cursorY;
    element.backlight = frame.backlight;
    element.cgram = frame.cgram;
  });
}

function bindSsd1306(context: DeviceContext, bus: I2CBus, part: CircuitPart) {
  if (!hasI2CWiring(context, part)) return;
  const controller = new SSD1306Controller(() => context.runner.cpu.cycles / (context.runner.frequency / 1000));
  if (!registerDevice(bus, SSD1306_ADDR_32, controller)) return;
  context.frameUpdaters.push(() => {
    if (!controller.update()) return;
    const element = getElement(part.id) as OledElement | null;
    if (!element?.imageData || !element.redraw) return;
    controller.toImageData(element.imageData);
    element.redraw();
  });
}

function bindDs1307(context: DeviceContext, bus: I2CBus, part: CircuitPart) {
  if (!hasI2CWiring(context, part)) return;
  registerDevice(bus, DS1307_ADDR, new DS1307Controller());
}

function bindMpu6050(context: DeviceContext, bus: I2CBus, part: CircuitPart) {
  if (!hasI2CWiring(context, part)) return;
  const controller = new MPU6050Controller();
  const requestedAddress = Number(part.attrs.address ?? MPU6050_ADDR);
  const address = requestedAddress === 0x69 ? 0x69 : MPU6050_ADDR;
  if (!registerDevice(bus, address, controller)) return;

  const update = () => {
    const element = getElement(part.id);
    const value = (key: string, fallback: number) => Number(element?.[key] ?? part.attrs[key] ?? fallback);
    controller.setAccel('x', value('accelX', 0));
    controller.setAccel('y', value('accelY', 0));
    controller.setAccel('z', value('accelZ', 1));
    controller.setGyro('x', value('gyroX', 0));
    controller.setGyro('y', value('gyroY', 0));
    controller.setGyro('z', value('gyroZ', 0));
    controller.setTemperatureC(value('temperature', 24));
  };
  context.frameUpdaters.push(update);
  update();
}

export function setupI2CDevices(context: DeviceContext) {
  const bus = new I2CBus(context.runner.twi);
  for (const part of context.documentState.parts) {
    if (part.type === 'wokwi-lcd1602') bindLcd1602(context, bus, part);
    if (part.type === 'wokwi-lcd2004') bindLcd2004(context, bus, part);
    if (part.type === 'wokwi-ssd1306') bindSsd1306(context, bus, part);
    if (part.type === 'wokwi-ds1307') bindDs1307(context, bus, part);
    if (part.type === 'wokwi-mpu6050') bindMpu6050(context, bus, part);
  }
}
