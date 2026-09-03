import type { CircuitDocument, Diagnostic } from '../circuit/types';
import {
  buildCircuitGraph,
  directlyConnectedNodes,
  nodeRef,
  parseNodeRef,
  traceToArduinoPin,
  traceToPower,
} from './circuitGraph';
import {
  classifyArduinoPowerPin,
  classifyPowerPin,
  isGroundPin,
  isPositivePowerPin,
} from './pins';
import { breadboardHoleNet } from '../breadboard/geometry';

type I2CDeviceInfo = {
  partId: string;
  boardId: string;
  address: number;
};

function i2cAddress(part: CircuitDocument['parts'][number], graph: ReturnType<typeof buildCircuitGraph>) {
  if (part.type === 'wokwi-ssd1306') return 0x3c;
  if (part.type === 'wokwi-ds1307') return 0x68;
  if (part.type === 'wokwi-lcd1602' || part.type === 'wokwi-lcd2004') return 0x27;
  if (part.type !== 'wokwi-mpu6050') return undefined;
  const ad0Power = traceToPower(graph, nodeRef(part.id, 'AD0'));
  if (ad0Power.some((trace) => isPositivePowerPin(trace.part.type, trace.pin))) return 0x69;
  return Number(part.attrs.address) === 0x69 ? 0x69 : 0x68;
}

function i2cBoardFor(part: CircuitDocument['parts'][number], graph: ReturnType<typeof buildCircuitGraph>) {
  const dataPin = part.type === 'wokwi-ssd1306' ? 'DATA' : 'SDA';
  const clockPin = part.type === 'wokwi-ssd1306' ? 'CLK' : 'SCL';
  const dataBoards = traceToArduinoPin(graph, nodeRef(part.id, dataPin))
    .filter((trace) => ['A4', 'A4.2'].includes(trace.pin.toUpperCase()))
    .map((trace) => trace.part.id);
  const clockBoards = new Set(traceToArduinoPin(graph, nodeRef(part.id, clockPin))
    .filter((trace) => ['A5', 'A5.2'].includes(trace.pin.toUpperCase()))
    .map((trace) => trace.part.id));
  return dataBoards.find((boardId) => clockBoards.has(boardId));
}

export function diagnoseCircuit(document: Pick<CircuitDocument, 'parts' | 'connections'>): Diagnostic[] {
  const graph = buildCircuitGraph(document);
  const diagnostics: Diagnostic[] = [];
  const seenPowerNets = new Set<string>();

  for (const board of document.parts.filter((part) => part.type === 'wokwi-arduino-uno')) {
    for (const powerPin of ['5V', '3.3V', 'VIN']) {
      const start = nodeRef(board.id, powerPin);
      const connected = directlyConnectedNodes(graph, start);
      const key = [...connected].sort().join('|');
      if (seenPowerNets.has(key)) continue;
      seenPowerNets.add(key);

      const grounded = [...connected].some((node) => {
        const { partId, pin } = parseNodeRef(node);
        const part = graph.parts.get(partId);
        return part ? isGroundPin(part.type, pin) : false;
      });
      if (grounded) {
        const wireIds = document.connections
          .filter((connection) => connected.has(connection.from) && connected.has(connection.to))
          .map((connection) => connection.id);
        diagnostics.push({
          severity: 'error',
          message: `${powerPin} is directly connected to GND. This is a short circuit.`,
          itemIds: [board.id, ...wireIds],
        });
      }
    }
  }

  for (const battery of document.parts.filter((part) => part.type === 'battery-9v' || part.type === 'battery-aa' || part.type === 'battery-coin-cell')) {
    const start = nodeRef(battery.id, '+');
    const connected = directlyConnectedNodes(graph, start);
    const key = [...connected].sort().join('|');
    if (seenPowerNets.has(key)) continue;
    seenPowerNets.add(key);

    const grounded = [...connected].some((node) => {
      const { partId, pin } = parseNodeRef(node);
      const part = graph.parts.get(partId);
      return part ? isGroundPin(part.type, pin) : false;
    });
    if (grounded) {
      const wireIds = document.connections
        .filter((connection) => connected.has(connection.from) && connected.has(connection.to))
        .map((connection) => connection.id);
      diagnostics.push({
        severity: 'error',
        message: `${battery.type === 'battery-9v' ? '9V Battery' : battery.type === 'battery-aa' ? 'AA Battery' : 'Coin Cell'} (+) is directly connected to Ground. This is a short circuit.`,
        itemIds: [battery.id, ...wireIds],
      });
    }
  }

  for (const led of document.parts.filter((part) => part.type === 'wokwi-led')) {
    const anode = nodeRef(led.id, 'A');
    const cathode = nodeRef(led.id, 'C');
    const anodePins = traceToArduinoPin(graph, anode);
    const cathodePins = traceToArduinoPin(graph, cathode);
    const anodePower = traceToPower(graph, anode);
    const cathodePower = traceToPower(graph, cathode);
    const hasSignalSide = anodePins.length + cathodePins.length + anodePower.length + cathodePower.length > 0;
    if (!hasSignalSide) continue;

    const paths = [...anodePins, ...cathodePins, ...anodePower, ...cathodePower];
    const hasResistor = paths.some((path) => path.resistorIds.length > 0);
    if (!hasResistor) {
      diagnostics.push({
        severity: 'warning',
        message: 'LED has no current-limiting resistor in its connected path. Add about 220Ω to 1kΩ.',
        itemIds: [led.id, ...new Set(paths.flatMap((path) => path.connectionIds))],
      });
    }

    const cathodeGround = cathodePower.some((path) => isGroundPin(path.part.type, path.pin));
    const anodeGround = anodePower.some((path) => isGroundPin(path.part.type, path.pin));
    if (anodeGround && !cathodeGround) {
      diagnostics.push({
        severity: 'warning',
        message: 'LED appears reversed. The cathode (C) normally goes toward GND.',
        itemIds: [led.id],
      });
    }
  }

  for (const diode of document.parts.filter((part) => part.type === 'rectifier-diode')) {
    const anode = nodeRef(diode.id, 'A');
    const cathode = nodeRef(diode.id, 'C');
    const anodePower = traceToPower(graph, anode);
    const cathodePower = traceToPower(graph, cathode);

    const anodePositive = anodePower.some((p) => isPositivePowerPin(p.part.type, p.pin));
    const cathodeGround = cathodePower.some((p) => isGroundPin(p.part.type, p.pin));

    if (anodePositive && cathodeGround) {
      const paths = [...anodePower, ...cathodePower];
      const hasResistor = paths.some((p) => p.resistorIds.length > 0);
      if (!hasResistor) {
        diagnostics.push({
          severity: 'error',
          message: 'Rectifier diode connects directly from positive power to ground without load resistance. This will damage the diode.',
          itemIds: [diode.id],
        });
      }
    }
  }

  for (const transistor of document.parts.filter((part) => part.type === 'npn-transistor')) {
    const base = nodeRef(transistor.id, 'B');
    const emitter = nodeRef(transistor.id, 'E');

    const emitterPower = traceToPower(graph, emitter);
    const emitterGrounded = emitterPower.some((p) => isGroundPin(p.part.type, p.pin));
    if (!emitterGrounded) {
      diagnostics.push({
        severity: 'warning',
        message: 'NPN Transistor emitter (E) must be connected to GND for low-side switching.',
        itemIds: [transistor.id],
      });
    }

    const baseArduinoPins = traceToArduinoPin(graph, base);
    for (const trace of baseArduinoPins) {
      if (trace.resistorIds.length === 0) {
        diagnostics.push({
          severity: 'warning',
          message: 'NPN Transistor base (B) has no current-limiting resistor. Add a 1kΩ resistor between the Arduino pin and Base to protect the MCU.',
          itemIds: [transistor.id, ...trace.connectionIds],
        });
      }
    }
  }

  for (const transistor of document.parts.filter((part) => part.type === 'pnp-transistor')) {
    const emitter = nodeRef(transistor.id, 'E');
    const emitterPower = traceToPower(graph, emitter);
    const emitterPositive = emitterPower.some((p) => isPositivePowerPin(p.part.type, p.pin));
    if (!emitterPositive) {
      diagnostics.push({
        severity: 'warning',
        message: 'PNP Transistor emitter (E) must be connected to positive power rail (VCC/5V) for high-side switching.',
        itemIds: [transistor.id],
      });
    }
  }

  const i2cDevices: I2CDeviceInfo[] = document.parts.flatMap((part) => {
    const address = i2cAddress(part, graph);
    if (address === undefined) return [];
    const boardId = i2cBoardFor(part, graph);
    return boardId ? [{ partId: part.id, boardId, address }] : [];
  });
  const i2cGroups = new Map<string, I2CDeviceInfo[]>();
  for (const device of i2cDevices) {
    const key = `${device.boardId}:${device.address}`;
    const group = i2cGroups.get(key) ?? [];
    group.push(device);
    i2cGroups.set(key, group);
  }
  for (const devices of i2cGroups.values()) {
    if (devices.length < 2) continue;
    const address = devices[0].address;
    diagnostics.push({
      severity: 'error',
      message: `I2C address conflict at 0x${address.toString(16).toUpperCase().padStart(2, '0')}: ${devices.map((device) => device.partId).join(', ')} are on the same bus. Change a configurable address pin or device address before simulation.`,
      itemIds: devices.map((device) => device.partId),
    });
  }

  for (const connection of document.connections) {
    const fromNode = parseNodeRef(connection.from);
    const toNode = parseNodeRef(connection.to);
    if (fromNode.partId === toNode.partId) {
      const part = graph.parts.get(fromNode.partId);
      if (part && (part.type === 'breadboard' || part.type === 'breadboard-half')) {
        const netA = breadboardHoleNet(fromNode.pin);
        const netB = breadboardHoleNet(toNode.pin);
        if (netA && netB && netA === netB) {
          diagnostics.push({
            severity: 'warning',
            message: `Wire ${connection.id} connects ${connection.from} to ${connection.to} on the same internal breadboard strip (${netA}); this wire is redundant.`,
            itemIds: [connection.id],
          });
        }
      }
    }
  }

  return diagnostics;
}

