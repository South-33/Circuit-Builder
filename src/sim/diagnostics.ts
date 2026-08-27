import type { CircuitDocument, Diagnostic } from '../types';
import { buildCircuitGraph, directlyConnectedNodes, nodeRef, parseNodeRef, traceToArduinoPin, traceToPower } from './circuitGraph';
import { classifyArduinoPowerPin } from './pins';

export function diagnoseCircuit(document: Pick<CircuitDocument, 'parts' | 'connections'>): Diagnostic[] {
  const graph = buildCircuitGraph(document);
  const diagnostics: Diagnostic[] = [];
  const seenPowerNets = new Set<string>();

  for (const board of document.parts.filter((part) => part.type === 'wokwi-arduino-uno')) {
    for (const powerPin of ['5V', '3.3V']) {
      const start = nodeRef(board.id, powerPin);
      const connected = directlyConnectedNodes(graph, start);
      const key = [...connected].sort().join('|');
      if (seenPowerNets.has(key)) continue;
      seenPowerNets.add(key);

      const grounded = [...connected].some((node) => {
        const { partId, pin } = parseNodeRef(node);
        const part = graph.parts.get(partId);
        return part?.type === 'wokwi-arduino-uno' && classifyArduinoPowerPin(pin) === 'gnd';
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

    const cathodeGround = cathodePower.some((path) => classifyArduinoPowerPin(path.pin) === 'gnd');
    const anodeGround = anodePower.some((path) => classifyArduinoPowerPin(path.pin) === 'gnd');
    if (anodeGround && !cathodeGround) {
      diagnostics.push({
        severity: 'warning',
        message: 'LED appears reversed. The cathode (C) normally goes toward GND.',
        itemIds: [led.id],
      });
    }
  }

  return diagnostics;
}

