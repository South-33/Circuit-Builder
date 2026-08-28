import type { AVRIOPort } from 'avr8js';
import type { AVRRunner } from './avrRunner';

export type PortPin = {
  port: AVRIOPort;
  bit: number;
};

export function resolveArduinoDigitalPin(runner: AVRRunner, pinName: string): PortPin | null {
  const normalized = pinName.trim().toUpperCase().replace(/^D/, '');
  if (!/^\d+$/.test(normalized)) return null;
  const pin = Number(normalized);
  if (pin >= 0 && pin <= 7) return { port: runner.portD, bit: pin };
  if (pin >= 8 && pin <= 13) return { port: runner.portB, bit: pin - 8 };
  return null;
}

export function resolveArduinoAnalogChannel(pinName: string): number | null {
  const match = /^A([0-5])$/i.exec(pinName.trim());
  return match ? Number(match[1]) : null;
}

export type PowerPinClassification = 'gnd' | '5v' | '3v3' | 'vin' | '9v';

export function classifyPowerPin(partType: string, pinName: string): PowerPinClassification | null {
  const normalized = pinName.trim().toUpperCase();
  if (partType === 'wokwi-arduino-uno') {
    if (normalized.startsWith('GND')) return 'gnd';
    if (normalized === '5V') return '5v';
    if (normalized === '3.3V' || normalized === '3V3') return '3v3';
    if (normalized === 'VIN') return 'vin';
    return null;
  }
  if (partType === 'battery-9v') {
    if (normalized === '-' || normalized === 'GND' || normalized === 'NEG' || normalized === 'NEGATIVE') return 'gnd';
    if (normalized === '+' || normalized === '9V' || normalized === 'POS' || normalized === 'POSITIVE' || normalized === 'VCC') return '9v';
    return null;
  }
  return null;
}

export function isGroundPin(partType: string, pinName: string): boolean {
  return classifyPowerPin(partType, pinName) === 'gnd';
}

export function isPositivePowerPin(partType: string, pinName: string): boolean {
  const classification = classifyPowerPin(partType, pinName);
  return classification !== null && classification !== 'gnd';
}

export function classifyArduinoPowerPin(pinName: string): 'gnd' | '5v' | '3v3' | 'vin' | null {
  const result = classifyPowerPin('wokwi-arduino-uno', pinName);
  return result === '9v' ? null : result;
}

