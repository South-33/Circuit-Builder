import fs from 'node:fs';
import path from 'node:path';

const COMPILER_URL = 'https://hexi.wokwi.com/build';

const IRREMOTE_COMPAT = `
#ifndef HARDWARE_LAB_IRREMOTE_COMPAT
#define HARDWARE_LAB_IRREMOTE_COMPAT
#ifndef ENABLE_LED_FEEDBACK
#define ENABLE_LED_FEEDBACK true
#endif

struct HardwareLabIRData { unsigned char command = 0; };

class HardwareLabIRReceiver {
 public:
  HardwareLabIRData decodedIRData;

  void begin(unsigned char pin, bool = false) {
    pin_ = pin;
    pinMode(pin_, INPUT_PULLUP);
  }

  bool decode() {
    const unsigned long leaderMark = measureLevel(LOW, 30000UL);
    if (leaderMark < 8000UL || leaderMark > 10000UL) return false;
    const unsigned long leaderSpace = measureLevel(HIGH, 7000UL);
    if (leaderSpace < 3500UL || leaderSpace > 5500UL) return false;

    unsigned long frame = 0;
    for (unsigned char bit = 0; bit < 32; bit++) {
      const unsigned long mark = measureLevel(LOW, 1600UL);
      if (mark < 300UL || mark > 900UL) return false;
      const unsigned long space = measureLevel(HIGH, 3000UL);
      if (space < 300UL || space > 2300UL) return false;
      if (space > 1000UL) frame |= (1UL << bit);
    }

    const unsigned char address = frame & 0xff;
    const unsigned char addressInverse = (frame >> 8) & 0xff;
    const unsigned char command = (frame >> 16) & 0xff;
    const unsigned char commandInverse = (frame >> 24) & 0xff;
    if ((unsigned char)(address ^ addressInverse) != 0xff) return false;
    if ((unsigned char)(command ^ commandInverse) != 0xff) return false;
    decodedIRData.command = command;
    return true;
  }

  void resume() {}

 private:
  unsigned long measureLevel(unsigned char level, unsigned long timeout) {
    const unsigned long waitStart = micros();
    while (digitalRead(pin_) != level) {
      if ((unsigned long)(micros() - waitStart) >= timeout) return 0;
    }
    const unsigned long pulseStart = micros();
    while (digitalRead(pin_) == level) {
      if ((unsigned long)(micros() - pulseStart) >= timeout) return 0;
    }
    return (unsigned long)(micros() - pulseStart);
  }

  unsigned char pin_ = 0;
};

HardwareLabIRReceiver IrReceiver;
#endif
`;

function prepareSource(source) {
  const include = /^\s*#\s*include\s*[<"]IRremote\.hpp[>"]\s*$/m;
  const match = include.exec(source);
  if (!match) return source;
  const line = source.slice(0, match.index).split('\n').length;
  const before = source.slice(0, match.index);
  const after = source.slice(match.index + match[0].length);
  return `${before}${IRREMOTE_COMPAT}\n#line ${line + 1} "sketch.ino"${after}`;
}

const sketches = {
  blink: `
void setup() {
  pinMode(13, OUTPUT);
}
void loop() {
  digitalWrite(13, HIGH);
  delay(100);
  digitalWrite(13, LOW);
  delay(100);
}
`,
  serialPot: `
void setup() {
  Serial.begin(9600);
}
void loop() {
  int v = analogRead(A0);
  Serial.print("ADC:");
  Serial.println(v);
  delay(50);
}
`,
  buttonLed: `
const int BUTTON = 2;
const int LED = 9;
void setup() {
  pinMode(BUTTON, INPUT_PULLUP);
  pinMode(LED, OUTPUT);
}
void loop() {
  digitalWrite(LED, digitalRead(BUTTON) == LOW ? HIGH : LOW);
}
`,
  servoSweep: `
#include <Servo.h>
Servo s;
void setup() {
  s.attach(9);
  s.write(45);
}
void loop() {
  s.write(90);
  delay(100);
  s.write(180);
  delay(100);
}
`,
  servoPot: `
#include <Servo.h>
Servo s;
void setup() {
  s.attach(9);
}
void loop() {
  int v = analogRead(A0);
  int angle = map(v, 0, 1023, 0, 180);
  s.write(angle);
  delay(20);
}
`,
  hcsr04: `
const int trig = 9;
const int echo = 10;
void setup() {
  Serial.begin(9600);
  pinMode(trig, OUTPUT);
  pinMode(echo, INPUT);
}
void loop() {
  digitalWrite(trig, LOW);
  delayMicroseconds(2);
  digitalWrite(trig, HIGH);
  delayMicroseconds(10);
  digitalWrite(trig, LOW);
  long d = pulseIn(echo, HIGH) / 58;
  Serial.print("DIST:");
  Serial.println(d);
  delay(100);
}
`,
  dht22: `
const int dhtPin = 2;
void setup() {
  Serial.begin(9600);
}
void loop() {
  pinMode(dhtPin, OUTPUT);
  digitalWrite(dhtPin, LOW);
  delay(20);
  digitalWrite(dhtPin, HIGH);
  pinMode(dhtPin, INPUT_PULLUP);
  delayMicroseconds(40);
  if (digitalRead(dhtPin) == LOW) {
    while (digitalRead(dhtPin) == LOW);
    while (digitalRead(dhtPin) == HIGH);
    byte data[5] = {0, 0, 0, 0, 0};
    for (int i = 0; i < 40; i++) {
      while (digitalRead(dhtPin) == LOW);
      unsigned long start = micros();
      while (digitalRead(dhtPin) == HIGH);
      if ((micros() - start) > 40) {
        data[i / 8] |= (1 << (7 - (i % 8)));
      }
    }
    int rawHum = (data[0] << 8) | data[1];
    int rawTemp = ((data[2] & 0x7F) << 8) | data[3];
    if (data[2] & 0x80) rawTemp = -rawTemp;
    Serial.print("DHT:");
    Serial.print(rawTemp / 10.0);
    Serial.print(",");
    Serial.println(rawHum / 10.0);
  }
  delay(200);
}
`,
  i2cScan: `
#include <Wire.h>
void setup() {
  Wire.begin();
  Serial.begin(9600);
  Serial.println("I2C_SCAN");
  for (byte a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) {
      Serial.print("FOUND:0x");
      Serial.println(a, HEX);
    }
  }
}
void loop() {}
`,
  i2cLcd: `
#include <Wire.h>
void sendNibble(byte n, byte rs) {
  byte d = (n << 4) | 0x08 | (rs ? 1 : 0);
  Wire.beginTransmission(0x27);
  Wire.write(d | 4);
  Wire.endTransmission();
  Wire.beginTransmission(0x27);
  Wire.write(d & ~4);
  Wire.endTransmission();
}
void sendByte(byte v, byte rs) {
  sendNibble(v >> 4, rs);
  sendNibble(v & 0x0F, rs);
}
void setup() {
  Wire.begin();
  delay(50);
  sendNibble(3, 0); delay(5);
  sendNibble(3, 0); delay(1);
  sendNibble(3, 0);
  sendNibble(2, 0);
  sendByte(0x28, 0);
  sendByte(0x0C, 0);
  sendByte(0x06, 0);
  sendByte(0x01, 0);
  delay(2);
  sendByte('H', 1);
  sendByte('i', 1);
}
void loop() {}
`,
  i2cDs1307: `
#include <Wire.h>
void setup() {
  Wire.begin();
  Serial.begin(9600);
  Wire.beginTransmission(0x68);
  Wire.write(0);
  Wire.endTransmission();
  Wire.requestFrom(0x68, 7);
  if (Wire.available() >= 7) {
    byte s = Wire.read();
    byte m = Wire.read();
    byte h = Wire.read();
    Serial.print("RTC:");
    Serial.print(h, HEX);
    Serial.print(":");
    Serial.println(m, HEX);
  }
}
void loop() {}
`,
  i2cMpu6050: `
#include <Wire.h>
void setup() {
  Wire.begin();
  Serial.begin(9600);
  Wire.beginTransmission(0x68);
  Wire.write(0x6B);
  Wire.write(0);
  Wire.endTransmission();
  Wire.beginTransmission(0x68);
  Wire.write(0x75);
  Wire.endTransmission();
  Wire.requestFrom(0x68, 1);
  if (Wire.available()) {
    byte who = Wire.read();
    Serial.print("MPU_WHO:0x");
    Serial.println(who, HEX);
  }
}
void loop() {}
`,
  pwmLedMotor: `
const int motorPin = 3;
void setup() {
  pinMode(motorPin, OUTPUT);
}
void loop() {
  analogWrite(motorPin, 128);
  delay(100);
  analogWrite(motorPin, 255);
  delay(100);
  analogWrite(motorPin, 0);
  delay(100);
}
`,
  analogMulti: `
void setup() {
  Serial.begin(9600);
}
void loop() {
  int a0 = analogRead(A0);
  int a1 = analogRead(A1);
  int a2 = analogRead(A2);
  Serial.print("A:");
  Serial.print(a0);
  Serial.print(",");
  Serial.print(a1);
  Serial.print(",");
  Serial.println(a2);
  delay(50);
}
`,
  digitalMulti: `
void setup() {
  for (int i = 2; i <= 6; i++) pinMode(i, INPUT_PULLUP);
  for (int i = 8; i <= 12; i++) pinMode(i, OUTPUT);
}
void loop() {
  digitalWrite(8, digitalRead(2));
  digitalWrite(9, digitalRead(3));
  digitalWrite(10, digitalRead(4));
  digitalWrite(11, digitalRead(5));
  digitalWrite(12, digitalRead(6));
}
`,
  irMotor: `
#include <IRremote.hpp>

const int IR_PIN = 3;
const int LEFT_MOTOR = 2;
const int RIGHT_MOTOR = 5;

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
`,
  transistorMotorDiode: `
const int gate = 3;
void setup() {
  pinMode(gate, OUTPUT);
  Serial.begin(9600);
}
void loop() {
  digitalWrite(gate, HIGH);
  Serial.println("DRIVE_HIGH");
  delay(100);
  digitalWrite(gate, LOW);
  Serial.println("DRIVE_LOW");
  delay(100);
}
`,
};

async function main() {
  const hexMap = {};
  for (const [key, sketch] of Object.entries(sketches)) {
    const prepared = prepareSource(sketch.trim());
    console.log(`Compiling ${key}...`);
    const res = await fetch(COMPILER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sketch: prepared }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} compiling ${key}`);
    const data = await res.json();
    if (!data.hex) throw new Error(`Error compiling ${key}: ${data.stderr || data.stdout}`);
    hexMap[key] = {
      sketch: sketch.trim(),
      hex: data.hex,
    };
    console.log(`✓ ${key} compiled (${data.hex.length} bytes hex)`);
  }

  const outPath = path.resolve(import.meta.dirname, 'fixtures.mjs');
  const fileContent = `// Precompiled AVR Intel HEX fixtures for offline, deterministic testing.
// Generated on ${new Date().toISOString()}

export const HEX_FIXTURES = ${JSON.stringify(hexMap, null, 2)};
`;
  fs.writeFileSync(outPath, fileContent, 'utf8');
  console.log(`Written ${Object.keys(hexMap).length} fixtures to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
