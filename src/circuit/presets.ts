import { gridPartPlacement, gridPointToCanvas } from '../agent/layout';
import type { CircuitConnection, CircuitPart, WirePoint } from './types';

const placed = (x: number, y: number) => gridPartPlacement({ x, y });
const route = (...points: Array<[number, number]>): WirePoint[] =>
  points.map(([x, y]) => gridPointToCanvas({ x, y }));

export type CircuitPreset = {
  id: string;
  name: string;
  description: string;
  parts: CircuitPart[];
  connections: CircuitConnection[];
};

const blinkCode = `void setup() {
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
`;

const buttonCode = `const int BUTTON = 2;
const int LED = 9;

void setup() {
  pinMode(BUTTON, INPUT_PULLUP);
  pinMode(LED, OUTPUT);
}

void loop() {
  digitalWrite(LED, digitalRead(BUTTON) == LOW ? HIGH : LOW);
}
`;

const potentiometerCode = `void setup() {
  Serial.begin(9600);
}

void loop() {
  int value = analogRead(A0);
  Serial.println(value);
  delay(100);
}
`;

const irMotorCode = `#include <IRremote.hpp>

const int IR_PIN = 3;
const int LEFT_MOTOR = 2;
const int RIGHT_MOTOR = 5;

// Wokwi NEC remote buttons 1, 2, 3 and 4.
const int STOP_CODE = 0x30;
const int LEFT_CODE = 0x18;
const int RIGHT_CODE = 0x7A;
const int BOTH_CODE = 0x10;

void setup() {
  pinMode(LEFT_MOTOR, OUTPUT);
  pinMode(RIGHT_MOTOR, OUTPUT);
  digitalWrite(LEFT_MOTOR, LOW);
  digitalWrite(RIGHT_MOTOR, LOW);
  IrReceiver.begin(IR_PIN, ENABLE_LED_FEEDBACK);
}

void loop() {
  if (IrReceiver.decode()) {
    const int code = IrReceiver.decodedIRData.command;
    if (code == STOP_CODE) {
      digitalWrite(LEFT_MOTOR, LOW);
      digitalWrite(RIGHT_MOTOR, LOW);
    } else if (code == LEFT_CODE) {
      digitalWrite(LEFT_MOTOR, HIGH);
      digitalWrite(RIGHT_MOTOR, LOW);
    } else if (code == RIGHT_CODE) {
      digitalWrite(LEFT_MOTOR, LOW);
      digitalWrite(RIGHT_MOTOR, HIGH);
    } else if (code == BOTH_CODE) {
      digitalWrite(LEFT_MOTOR, HIGH);
      digitalWrite(RIGHT_MOTOR, HIGH);
    }
    IrReceiver.resume();
  }
}
`;

export const CIRCUIT_PRESETS: CircuitPreset[] = [
  {
    id: 'ir-motor-control',
    name: 'IR Motor Control',
    description: 'Remote-controlled dual DC motors with a breadboarded IR receiver',
    parts: [
      { id: 'remote1', type: 'wokwi-ir-remote', ...placed(1, 2), attrs: {} },
      { id: 'motor1', type: 'dc-motor', ...placed(28, 3), attrs: {} },
      { id: 'motor2', type: 'dc-motor', ...placed(36, 3), attrs: {} },
      { id: 'bb1', type: 'breadboard-half', ...placed(15, 9), attrs: {} },
      {
        id: 'ir1',
        type: 'wokwi-ir-receiver',
        left: 0,
        top: 0,
        attrs: {},
        seating: {
          breadboardId: 'bb1',
          pins: { GND: 'E20', VCC: 'E21', DAT: 'E22' },
        },
      },
      { id: 'uno1', type: 'wokwi-arduino-uno', ...placed(3, 10), attrs: {}, code: irMotorCode },
    ],
    connections: [
      { id: 'wire1', from: 'uno1:5V', to: 'ir1:VCC', color: '#d94841', waypoints: route([8, 18], [12, 18], [12, 7], [22, 7]) },
      { id: 'wire2', from: 'uno1:GND.2', to: 'bb1:-top1', color: '#343a40', waypoints: route([9, 19], [13, 19], [13, 8], [16, 8]) },
      { id: 'wire3', from: 'ir1:GND', to: 'bb1:-top20', color: '#343a40', waypoints: route([21, 8]) },
      { id: 'wire4', from: 'uno1:3', to: 'ir1:DAT', color: '#1971c2', waypoints: route([11, 6], [23, 6]) },
      { id: 'wire5', from: 'uno1:2', to: 'motor1:1', color: '#2f9e44', waypoints: route([11, 2], [28, 2]) },
      { id: 'wire6', from: 'motor1:2', to: 'bb1:-top25', color: '#343a40', waypoints: route([27, 4], [27, 8], [25, 8]) },
      { id: 'wire7', from: 'uno1:5', to: 'motor2:1', color: '#f08c00', waypoints: route([10, 1], [36, 1]) },
      { id: 'wire8', from: 'motor2:2', to: 'bb1:-top24', color: '#343a40', waypoints: route([35, 4], [35, 9], [25, 9]) },
    ],
  },
  {
    id: 'blink',
    name: 'Blink LED',
    description: 'Arduino, breadboard, seated resistor and LED',
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', ...placed(3, 8), attrs: {}, code: blinkCode },
      { id: 'bb1', type: 'breadboard-half', ...placed(15, 8), attrs: {} },
      {
        id: 'r1', type: 'wokwi-resistor', left: 0, top: 0, attrs: { value: '220' },
        seating: { breadboardId: 'bb1', pins: { '1': 'E6', '2': 'E12' } },
      },
      {
        id: 'led1', type: 'wokwi-led', left: 0, top: 0, attrs: { color: 'red' },
        seating: { breadboardId: 'bb1', pins: { A: 'A12', C: 'A11' } },
      },
    ],
    connections: [
      { id: 'wire1', from: 'uno1:13', to: 'bb1:A6', color: '#2f9e44', waypoints: route([11, 6], [17, 6]) },
      { id: 'wire2', from: 'bb1:E11', to: 'uno1:GND.2', color: '#343a40', waypoints: route([19, 16], [9, 16]) },
    ],
  },
  {
    id: 'button-led',
    name: 'Button + LED',
    description: 'Read a button and drive an LED',
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', ...placed(3, 8), attrs: {}, code: buttonCode },
      { id: 'button1', type: 'wokwi-pushbutton', ...placed(17, 7), attrs: {} },
      { id: 'led1', type: 'wokwi-led', ...placed(23, 10), attrs: { color: 'green' } },
      { id: 'r1', type: 'wokwi-resistor', ...placed(20, 13), attrs: { value: '220' } },
    ],
    connections: [
      { id: 'wire1', from: 'uno1:2', to: 'button1:1.l', color: '#1971c2', waypoints: route([12, 6], [17, 6]) },
      { id: 'wire2', from: 'button1:2.l', to: 'uno1:GND.2', color: '#343a40', waypoints: route([18, 15], [9, 15]) },
      { id: 'wire3', from: 'uno1:9', to: 'r1:1', color: '#2f9e44', waypoints: route([10, 5], [19, 5], [19, 13]) },
      { id: 'wire4', from: 'r1:2', to: 'led1:A', color: '#d94841', waypoints: route([23, 13], [23, 11]) },
      { id: 'wire5', from: 'led1:C', to: 'uno1:GND.3', color: '#343a40', waypoints: route([25, 16], [10, 16]) },
    ],
  },
  {
    id: 'potentiometer',
    name: 'Potentiometer',
    description: 'Read analog input and print it to Serial',
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', ...placed(4, 8), attrs: {}, code: potentiometerCode },
      { id: 'pot1', type: 'wokwi-potentiometer', ...placed(18, 9), attrs: { value: 512 } },
    ],
    connections: [
      { id: 'wire1', from: 'uno1:5V', to: 'pot1:VCC', color: '#d94841', waypoints: route([9, 16], [17, 16]) },
      { id: 'wire2', from: 'uno1:GND.2', to: 'pot1:GND', color: '#343a40', waypoints: route([10, 17], [19, 17]) },
      { id: 'wire3', from: 'uno1:A0', to: 'pot1:SIG', color: '#1971c2', waypoints: route([12, 15], [18, 15]) },
    ],
  },
];
