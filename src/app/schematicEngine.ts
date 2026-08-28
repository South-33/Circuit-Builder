import type { CircuitConnection, CircuitPart } from '../circuit/types';
import { isBreadboardType } from '../breadboard/geometry';
import { buildCircuitGraph } from '../sim/circuitGraph';
import { getSchematicSymbolDef, resolveSchematicPinCoordinate } from './schematicSymbols';

export type SchematicNetWire = {
  id: string;
  fromPartId: string;
  fromPin: string;
  toPartId: string;
  toPin: string;
  fromPos: { x: number; y: number };
  toPos: { x: number; y: number };
  points: Array<{ x: number; y: number }>;
  isPower?: boolean;
  isGround?: boolean;
};

export type SchematicPowerMarker = {
  id: string;
  x: number;
  y: number;
  label: string;
  direction: 'up' | 'down';
};

// Auto-layout non-breadboard components in a clean, logical schematic flow
export function computeSchematicInitialLayout(parts: CircuitPart[]): Record<string, { left: number; top: number }> {
  const nonBb = parts.filter((p) => !isBreadboardType(p.type));
  const positions: Record<string, { left: number; top: number }> = {};

  const unode = nonBb.find((p) => p.type === 'wokwi-arduino-uno');
  const displays = nonBb.filter((p) => p.type.includes('lcd') || p.type.includes('display') || p.type.includes('oled') || p.type.includes('7segment'));
  const sensors = nonBb.filter((p) => p.type.includes('sensor') || p.type.includes('potentiometer') || p.type.includes('button') || p.type.includes('switch') || p.type.includes('receiver') || p.type.includes('remote') || p.type.includes('joystick') || p.type.includes('keypad'));
  const actuators = nonBb.filter((p) => p.type.includes('motor') || p.type.includes('led') || p.type.includes('buzzer') || p.type.includes('relay') || p.type.includes('servo'));
  const passives = nonBb.filter((p) => !displays.includes(p) && !sensors.includes(p) && !actuators.includes(p) && p !== unode);

  // Position Uno in center-left
  if (unode) {
    positions[unode.id] = { left: 320, top: 220 };
  }

  // Position Inputs / Sensors on the far left
  sensors.forEach((p, idx) => {
    positions[p.id] = {
      left: 100,
      top: 240 + idx * 130,
    };
  });

  // Position Displays in center-right
  displays.forEach((p, idx) => {
    positions[p.id] = {
      left: unode ? 640 : 400,
      top: 240 + idx * 180,
    };
  });

  // Position Actuators / Outputs on the far right
  actuators.forEach((p, idx) => {
    positions[p.id] = {
      left: 920,
      top: 180 + idx * 130,
    };
  });

  // Position Passives (Resistors, Diodes, Transistors, Batteries)
  passives.forEach((p, idx) => {
    if (p.type.includes('battery')) {
      positions[p.id] = { left: 100, top: 80 + idx * 90 };
    } else if (p.type === 'wokwi-resistor') {
      positions[p.id] = { left: 820, top: 250 + idx * 90 };
    } else {
      positions[p.id] = { left: 340 + idx * 140, top: 560 };
    }
  });

  return positions;
}

// Generate orthogonal bus routes with parallel channel offsets (staircase routing)
export function routeSchematicNets(
  parts: CircuitPart[],
  connections: CircuitConnection[],
  positions: Record<string, { left: number; top: number }>
): { wires: SchematicNetWire[]; powerMarkers: SchematicPowerMarker[] } {
  const graph = buildCircuitGraph({ parts, connections });
  const nonBbParts = parts.filter((p) => !isBreadboardType(p.type));
  const rawNetPairs: Array<{ fromPartId: string; fromPin: string; toPartId: string; toPin: string }> = [];
  const processedPairs = new Set<string>();

  for (const part of nonBbParts) {
    const symDef = getSchematicSymbolDef(part);
    for (const pin of symDef.pins) {
      const startNode = `${part.id}:${pin.name}`;
      const visited = new Set<string>([startNode]);
      const queue = [startNode];

      while (queue.length > 0) {
        const curr = queue.shift()!;
        const edges = graph.adjacency.get(curr) ?? [];

        for (const edge of edges) {
          if (edge.kind === 'wire' || edge.kind === 'breadboard' || edge.kind === 'seat') {
            if (!visited.has(edge.to)) {
              visited.add(edge.to);
              queue.push(edge.to);

              const colon = edge.to.indexOf(':');
              if (colon !== -1) {
                const targetPartId = edge.to.slice(0, colon);
                const targetPin = edge.to.slice(colon + 1);
                const targetPart = graph.parts.get(targetPartId);

                if (targetPart && !isBreadboardType(targetPart.type) && targetPart.id !== part.id) {
                  const pairKey = [startNode, edge.to].sort().join('<->');
                  if (!processedPairs.has(pairKey)) {
                    processedPairs.add(pairKey);
                    rawNetPairs.push({
                      fromPartId: part.id,
                      fromPin: pin.name,
                      toPartId: targetPart.id,
                      toPin: targetPin,
                    });
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // Fallback for direct connections
  if (rawNetPairs.length === 0) {
    for (const conn of connections) {
      const fromColon = conn.from.indexOf(':');
      const toColon = conn.to.indexOf(':');
      if (fromColon !== -1 && toColon !== -1) {
        const fromPartId = conn.from.slice(0, fromColon);
        const fromPin = conn.from.slice(fromColon + 1);
        const toPartId = conn.to.slice(0, toColon);
        const toPin = conn.to.slice(toColon + 1);
        const fromPart = parts.find((p) => p.id === fromPartId);
        const toPart = parts.find((p) => p.id === toPartId);
        if (fromPart && toPart && !isBreadboardType(fromPart.type) && !isBreadboardType(toPart.type)) {
          rawNetPairs.push({ fromPartId, fromPin, toPartId, toPin });
        }
      }
    }
  }

  const wires: SchematicNetWire[] = [];
  const powerMarkers: SchematicPowerMarker[] = [];

  // Group parallel connections by source and target parts to assign parallel channel offsets
  const groupCounts: Record<string, number> = {};

  rawNetPairs.forEach((pair, idx) => {
    const fromPart = parts.find((p) => p.id === pair.fromPartId);
    const toPart = parts.find((p) => p.id === pair.toPartId);
    if (!fromPart || !toPart) return;

    const fromPos = positions[fromPart.id] ?? { left: 100, top: 100 };
    const toPos = positions[toPart.id] ?? { left: 100, top: 100 };

    const start = resolveSchematicPinCoordinate(fromPart, pair.fromPin, fromPos);
    const end = resolveSchematicPinCoordinate(toPart, pair.toPin, toPos);

    const groupKey = [pair.fromPartId, pair.toPartId].sort().join('-');
    const pairIndexInGroup = groupCounts[groupKey] ?? 0;
    groupCounts[groupKey] = pairIndexInGroup + 1;

    const isVcc = pair.fromPin.toLowerCase().includes('5v') || pair.fromPin.toLowerCase().includes('vcc') || pair.toPin.toLowerCase().includes('5v') || pair.toPin.toLowerCase().includes('vcc');
    const isGnd = pair.fromPin.toLowerCase().includes('gnd') || pair.toPin.toLowerCase().includes('gnd');

    let points: Array<{ x: number; y: number }> = [];

    if (isVcc) {
      // Route via top power rail (y = 60..100)
      const railY = 80 + (pairIndexInGroup % 3) * 12;
      points = [
        start,
        { x: start.x, y: railY },
        { x: end.x, y: railY },
        end,
      ];
    } else if (isGnd) {
      // Route via bottom ground rail (y = 700..740)
      const railY = 710 + (pairIndexInGroup % 3) * 12;
      points = [
        start,
        { x: start.x, y: railY },
        { x: end.x, y: railY },
        end,
      ];
    } else if (Math.abs(start.x - end.x) > 30) {
      // Parallel bus channel staircase routing
      const midBaseX = Math.round((start.x + end.x) / 2);
      const channelOffset = ((pairIndexInGroup % 8) - 3.5) * 12;
      const midX = midBaseX + channelOffset;

      points = [
        start,
        { x: midX, y: start.y },
        { x: midX, y: end.y },
        end,
      ];
    } else {
      // Vertical alignment
      const midY = Math.round((start.y + end.y) / 2);
      points = [
        start,
        { x: start.x, y: midY },
        { x: end.x, y: midY },
        end,
      ];
    }

    wires.push({
      id: `wire_${idx}_${pair.fromPartId}_${pair.toPartId}`,
      fromPartId: pair.fromPartId,
      fromPin: pair.fromPin,
      toPartId: pair.toPartId,
      toPin: pair.toPin,
      fromPos: start,
      toPos: end,
      points,
      isPower: isVcc,
      isGround: isGnd,
    });
  });

  // Generate top and bottom power tags (U1_5V and U1_GND) if Uno has power nets
  const hasVccWire = wires.some((w) => w.isPower);
  const hasGndWire = wires.some((w) => w.isGround);
  const unoPart = parts.find((p) => p.type === 'wokwi-arduino-uno');

  if (unoPart) {
    const unoPos = positions[unoPart.id] ?? { left: 320, top: 220 };
    if (hasVccWire) {
      powerMarkers.push({
        id: 'pwr_5v',
        x: unoPos.left + 220,
        y: 80,
        label: 'U1_5V',
        direction: 'up',
      });
    }
    if (hasGndWire) {
      powerMarkers.push({
        id: 'pwr_gnd',
        x: unoPos.left + 220,
        y: 710,
        label: 'U1_GND',
        direction: 'down',
      });
    }
  }

  return { wires, powerMarkers };
}
