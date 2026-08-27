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

export function classifyArduinoPowerPin(pinName: string): 'gnd' | '5v' | '3v3' | null {
  const normalized = pinName.trim().toUpperCase();
  if (normalized.startsWith('GND')) return 'gnd';
  if (normalized === '5V') return '5v';
  if (normalized === '3.3V' || normalized === '3V3') return '3v3';
  return null;
}

