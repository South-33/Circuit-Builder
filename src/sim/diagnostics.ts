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

