import { circuitStore } from './store';
import type { CircuitConnection, CircuitPart } from './types';

export function loadStarterCircuit() {
  if (circuitStore.getSnapshot().parts.length > 0) return;

  const parts: CircuitPart[] = [
    {
      id: 'uno1',
      type: 'wokwi-arduino-uno',
      left: 105,
      top: 255,
      attrs: {},
      code: `void setup() {
  pinMode(13, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  digitalWrite(13, HIGH);
  Serial.println("LED on");
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
}
`,
    },
    { id: 'bb1', type: 'breadboard', left: 410, top: 205, attrs: {} },
    { id: 'r1', type: 'wokwi-resistor', left: 515, top: 310, attrs: { value: '220' } },
    { id: 'led1', type: 'wokwi-led', left: 640, top: 277, attrs: { color: 'red' } },
  ];

  const connections: CircuitConnection[] = [
    { id: 'wire1', from: 'uno1:13', to: 'bb1:A6', color: '#2f9e44' },
    { id: 'wire2', from: 'bb1:E6', to: 'r1:1', color: '#2f9e44' },
    { id: 'wire3', from: 'r1:2', to: 'led1:A', color: '#d94841' },
    { id: 'wire4', from: 'led1:C', to: 'bb1:A13', color: '#343a40' },
    { id: 'wire5', from: 'bb1:E13', to: 'uno1:GND.2', color: '#343a40' },
  ];

  circuitStore.replaceDocument({ parts, connections });
}
