import React from 'react';
import type { CircuitConnection, CircuitPart } from '../circuit/types';
import { getPartPins, PART_DEFINITIONS } from '../components/parts';
import { isBreadboardType } from '../breadboard/geometry';
import { buildCircuitGraph } from '../sim/circuitGraph';

export type SchematicPin = {
  name: string;
  x: number;
  y: number;
  label?: string;
  orientation?: 'left' | 'right' | 'top' | 'bottom';
};

export type SchematicSymbolDef = {
  width: number;
  height: number;
  pins: SchematicPin[];
  render: (part: CircuitPart) => React.ReactNode;
};

export function getSchematicSymbolDef(part: CircuitPart): SchematicSymbolDef {
  const type = part.type;
  const def = PART_DEFINITIONS[type] ?? { name: type, category: 'Basic' };

  if (type === 'wokwi-resistor') {
    const ohms = Number(part.attrs.value ?? 220);
    const label = ohms >= 1e6 ? `${ohms / 1e6}MΩ` : ohms >= 1e3 ? `${ohms / 1e3}kΩ` : `${ohms}Ω`;
    return {
      width: 80,
      height: 40,
      pins: [
        { name: '1', x: 0, y: 20, orientation: 'left' },
        { name: '2', x: 80, y: 20, orientation: 'right' },
        { name: 'pin1', x: 0, y: 20, orientation: 'left' },
        { name: 'pin2', x: 80, y: 20, orientation: 'right' },
      ],
      render: (p) => (
        <g>
          <line x1="0" y1="20" x2="16" y2="20" stroke="#d63333" strokeWidth="1.8" />
          <polyline
            points="16,20 20,10 28,30 36,10 44,30 52,10 60,30 64,20"
            fill="none"
            stroke="#d63333"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <line x1="64" y1="20" x2="80" y2="20" stroke="#d63333" strokeWidth="1.8" />
          <text x="40" y="6" textAnchor="middle" fill="#d63333" fontSize="10" fontWeight="bold" fontFamily="monospace">{p.id.toUpperCase()}</text>
          <text x="40" y="38" textAnchor="middle" fill="#555" fontSize="9" fontFamily="monospace">{label}</text>
        </g>
      ),
    };
  }

  if (type === 'wokwi-potentiometer') {
    return {
      width: 80,
      height: 50,
      pins: [
        { name: '1', x: 0, y: 30, orientation: 'left' },
        { name: '2', x: 40, y: 0, orientation: 'top' },
        { name: '3', x: 80, y: 30, orientation: 'right' },
        { name: 'GND', x: 0, y: 30, orientation: 'left' },
        { name: 'SIG', x: 40, y: 0, orientation: 'top' },
        { name: 'VCC', x: 80, y: 30, orientation: 'right' },
      ],
      render: (p) => (
        <g>
          <line x1="0" y1="30" x2="16" y2="30" stroke="#d63333" strokeWidth="1.8" />
          <polyline points="16,30 20,20 28,40 36,20 44,40 52,20 60,40 64,30" fill="none" stroke="#d63333" strokeWidth="1.8" />
          <line x1="64" y1="30" x2="80" y2="30" stroke="#d63333" strokeWidth="1.8" />
          <line x1="40" y1="0" x2="40" y2="18" stroke="#d63333" strokeWidth="1.8" />
          <polygon points="40,24 36,16 44,16" fill="#d63333" />
          <text x="40" y="-4" textAnchor="middle" fill="#d63333" fontSize="9" fontWeight="bold" fontFamily="monospace">{p.id.toUpperCase()}</text>
        </g>
      ),
    };
  }

  if (type === 'wokwi-led' || type === 'wokwi-rgb-led') {
    const color = String(part.attrs.color ?? 'RED').toUpperCase();
    return {
      width: 70,
      height: 40,
      pins: [
        { name: 'A', x: 0, y: 20, orientation: 'left' },
        { name: 'C', x: 70, y: 20, orientation: 'right' },
        { name: 'anode', x: 0, y: 20, orientation: 'left' },
        { name: 'cathode', x: 70, y: 20, orientation: 'right' },
        { name: 'R', x: 0, y: 10, orientation: 'left' },
        { name: 'G', x: 0, y: 20, orientation: 'left' },
        { name: 'B', x: 0, y: 30, orientation: 'left' },
        { name: 'COM', x: 70, y: 20, orientation: 'right' },
      ],
      render: (p) => (
        <g>
          <line x1="0" y1="20" x2="25" y2="20" stroke="#d63333" strokeWidth="1.8" />
          <polygon points="25,10 25,30 45,20" fill="none" stroke="#d63333" strokeWidth="1.8" />
          <line x1="45" y1="10" x2="45" y2="30" stroke="#d63333" strokeWidth="1.8" />
          <line x1="45" y1="20" x2="70" y2="20" stroke="#d63333" strokeWidth="1.8" />
          <line x1="36" y1="8" x2="44" y2="0" stroke="#d63333" strokeWidth="1.5" />
          <polygon points="44,0 40,3 42,5" fill="#d63333" />
          <line x1="42" y1="12" x2="50" y2="4" stroke="#d63333" strokeWidth="1.5" />
          <polygon points="50,4 46,7 48,9" fill="#d63333" />
          <text x="35" y="-4" textAnchor="middle" fill="#d63333" fontSize="9" fontWeight="bold" fontFamily="monospace">{p.id.toUpperCase()}</text>
          <text x="35" y="40" textAnchor="middle" fill="#555" fontSize="8" fontFamily="monospace">{color}</text>
        </g>
      ),
    };
  }

  if (type === 'rectifier-diode' || type === 'zener-diode') {
    return {
      width: 70,
      height: 40,
      pins: [
        { name: 'A', x: 0, y: 20, orientation: 'left' },
        { name: 'C', x: 70, y: 20, orientation: 'right' },
        { name: 'anode', x: 0, y: 20, orientation: 'left' },
        { name: 'cathode', x: 70, y: 20, orientation: 'right' },
      ],
      render: (p) => (
        <g>
          <line x1="0" y1="20" x2="25" y2="20" stroke="#d63333" strokeWidth="1.8" />
          <polygon points="25,10 25,30 45,20" fill="none" stroke="#d63333" strokeWidth="1.8" />
          <line x1="45" y1="10" x2="45" y2="30" stroke="#d63333" strokeWidth="1.8" />
          {type === 'zener-diode' && <line x1="41" y1="10" x2="45" y2="10" stroke="#d63333" strokeWidth="1.8" />}
          {type === 'zener-diode' && <line x1="45" y1="30" x2="49" y2="30" stroke="#d63333" strokeWidth="1.8" />}
          <line x1="45" y1="20" x2="70" y2="20" stroke="#d63333" strokeWidth="1.8" />
          <text x="35" y="4" textAnchor="middle" fill="#d63333" fontSize="9" fontWeight="bold" fontFamily="monospace">{p.id.toUpperCase()}</text>
        </g>
      ),
    };
  }

  if (type === 'npn-transistor' || type === 'pnp-transistor') {
    return {
      width: 60,
      height: 60,
      pins: [
        { name: 'B', x: 0, y: 30, orientation: 'left' },
        { name: 'base', x: 0, y: 30, orientation: 'left' },
        { name: 'C', x: 45, y: 0, orientation: 'top' },
        { name: 'collector', x: 45, y: 0, orientation: 'top' },
        { name: 'E', x: 45, y: 60, orientation: 'bottom' },
        { name: 'emitter', x: 45, y: 60, orientation: 'bottom' },
      ],
      render: (p) => (
        <g>
          <circle cx="35" cy="30" r="22" fill="none" stroke="#d63333" strokeWidth="1.8" />
          <line x1="0" y1="30" x2="22" y2="30" stroke="#d63333" strokeWidth="1.8" />
          <line x1="22" y1="16" x2="22" y2="44" stroke="#d63333" strokeWidth="2.5" />
          <line x1="22" y1="22" x2="45" y2="10" stroke="#d63333" strokeWidth="1.8" />
          <line x1="45" y1="10" x2="45" y2="0" stroke="#d63333" strokeWidth="1.8" />
          <line x1="22" y1="38" x2="45" y2="50" stroke="#d63333" strokeWidth="1.8" />
          <line x1="45" y1="50" x2="45" y2="60" stroke="#d63333" strokeWidth="1.8" />
          {type === 'npn-transistor' ? (
            <polygon points="43,49 35,42 38,40" fill="#d63333" />
          ) : (
            <polygon points="26,24 33,31 31,33" fill="#d63333" />
          )}
          <text x="35" y="-4" textAnchor="middle" fill="#d63333" fontSize="9" fontWeight="bold" fontFamily="monospace">{p.id.toUpperCase()}</text>
          <text x="35" y="68" textAnchor="middle" fill="#555" fontSize="8" fontFamily="monospace">{type === 'npn-transistor' ? 'NPN' : 'PNP'}</text>
        </g>
      ),
    };
  }

  if (type === 'battery-9v' || type === 'battery-aa' || type === 'battery-coin-cell') {
    const vLabel = type === 'battery-9v' ? '9V' : type === 'battery-coin-cell' ? '3V' : '1.5V';
    return {
      width: 60,
      height: 60,
      pins: [
        { name: 'VCC', x: 30, y: 0, orientation: 'top' },
        { name: '+', x: 30, y: 0, orientation: 'top' },
        { name: 'GND', x: 30, y: 60, orientation: 'bottom' },
        { name: '-', x: 30, y: 60, orientation: 'bottom' },
      ],
      render: (p) => (
        <g>
          <line x1="30" y1="0" x2="30" y2="18" stroke="#d63333" strokeWidth="1.8" />
          <line x1="16" y1="18" x2="44" y2="18" stroke="#d63333" strokeWidth="2.5" />
          <line x1="22" y1="26" x2="38" y2="26" stroke="#d63333" strokeWidth="1.8" />
          <line x1="16" y1="34" x2="44" y2="34" stroke="#d63333" strokeWidth="2.5" />
          <line x1="22" y1="42" x2="38" y2="42" stroke="#d63333" strokeWidth="1.8" />
          <line x1="30" y1="42" x2="30" y2="60" stroke="#d63333" strokeWidth="1.8" />
          <text x="48" y="16" fill="#d63333" fontSize="11" fontWeight="bold">+</text>
          <text x="48" y="44" fill="#d63333" fontSize="11" fontWeight="bold">−</text>
          <text x="30" y="-4" textAnchor="middle" fill="#d63333" fontSize="9" fontWeight="bold" fontFamily="monospace">{p.id.toUpperCase()}</text>
          <text x="6" y="32" fill="#555" fontSize="8" fontFamily="monospace">{vLabel}</text>
        </g>
      ),
    };
  }

  if (type === 'dc-motor') {
    return {
      width: 70,
      height: 50,
      pins: [
        { name: '1', x: 0, y: 25, orientation: 'left' },
        { name: '2', x: 70, y: 25, orientation: 'right' },
        { name: '+', x: 0, y: 25, orientation: 'left' },
        { name: '-', x: 70, y: 25, orientation: 'right' },
      ],
      render: (p) => (
        <g>
          <circle cx="35" cy="25" r="18" fill="#fff" stroke="#d63333" strokeWidth="2" />
          <text x="35" y="31" textAnchor="middle" fill="#d63333" fontSize="16" fontWeight="bold" fontFamily="sans-serif">M</text>
          <line x1="0" y1="25" x2="17" y2="25" stroke="#d63333" strokeWidth="1.8" />
          <line x1="53" y1="25" x2="70" y2="25" stroke="#d63333" strokeWidth="1.8" />
          <text x="35" y="2" textAnchor="middle" fill="#d63333" fontSize="9" fontWeight="bold" fontFamily="monospace">{p.id.toUpperCase()}</text>
        </g>
      ),
    };
  }

  if (type === 'wokwi-pushbutton' || type === 'wokwi-pushbutton-6mm') {
    return {
      width: 60,
      height: 40,
      pins: [
        { name: '1.1', x: 0, y: 20, orientation: 'left' },
        { name: '1.2', x: 0, y: 20, orientation: 'left' },
        { name: '2.1', x: 60, y: 20, orientation: 'right' },
        { name: '2.2', x: 60, y: 20, orientation: 'right' },
        { name: '1', x: 0, y: 20, orientation: 'left' },
        { name: '2', x: 60, y: 20, orientation: 'right' },
      ],
      render: (p) => (
        <g>
          <line x1="0" y1="20" x2="20" y2="20" stroke="#d63333" strokeWidth="1.8" />
          <circle cx="20" cy="20" r="2.5" fill="#fff" stroke="#d63333" strokeWidth="1.5" />
          <line x1="22" y1="12" x2="38" y2="12" stroke="#d63333" strokeWidth="2" />
          <line x1="30" y1="12" x2="30" y2="4" stroke="#d63333" strokeWidth="1.5" />
          <circle cx="40" cy="20" r="2.5" fill="#fff" stroke="#d63333" strokeWidth="1.5" />
          <line x1="40" y1="20" x2="60" y2="20" stroke="#d63333" strokeWidth="1.8" />
          <text x="30" y="-2" textAnchor="middle" fill="#d63333" fontSize="9" fontWeight="bold" fontFamily="monospace">{p.id.toUpperCase()}</text>
        </g>
      ),
    };
  }

  if (type === 'wokwi-slide-switch') {
    return {
      width: 60,
      height: 40,
      pins: [
        { name: '1', x: 0, y: 12, orientation: 'left' },
        { name: '2', x: 60, y: 20, orientation: 'right' },
        { name: '3', x: 0, y: 28, orientation: 'left' },
      ],
      render: (p) => (
        <g>
          <line x1="0" y1="12" x2="18" y2="12" stroke="#d63333" strokeWidth="1.8" />
          <circle cx="18" cy="12" r="2" fill="#d63333" />
          <line x1="0" y1="28" x2="18" y2="28" stroke="#d63333" strokeWidth="1.8" />
          <circle cx="18" cy="28" r="2" fill="#d63333" />
          <circle cx="42" cy="20" r="2" fill="#d63333" />
          <line x1="42" y1="20" x2="60" y2="20" stroke="#d63333" strokeWidth="1.8" />
          <line x1="42" y1="20" x2="20" y2="12" stroke="#d63333" strokeWidth="2" />
          <text x="30" y="-2" textAnchor="middle" fill="#d63333" fontSize="9" fontWeight="bold" fontFamily="monospace">{p.id.toUpperCase()}</text>
        </g>
      ),
    };
  }

  if (type === 'wokwi-buzzer') {
    return {
      width: 60,
      height: 50,
      pins: [
        { name: '1', x: 0, y: 20, orientation: 'left' },
        { name: '2', x: 0, y: 35, orientation: 'left' },
        { name: '+', x: 0, y: 20, orientation: 'left' },
        { name: '-', x: 0, y: 35, orientation: 'left' },
      ],
      render: (p) => (
        <g>
          <line x1="0" y1="20" x2="20" y2="20" stroke="#d63333" strokeWidth="1.8" />
          <line x1="0" y1="35" x2="20" y2="35" stroke="#d63333" strokeWidth="1.8" />
          <path d="M 20 10 L 35 10 L 50 0 L 50 45 L 35 35 L 20 35 Z" fill="#fff" stroke="#d63333" strokeWidth="1.8" />
          <text x="35" y="-4" textAnchor="middle" fill="#d63333" fontSize="9" fontWeight="bold" fontFamily="monospace">{p.id.toUpperCase()}</text>
        </g>
      ),
    };
  }

  if (type === 'wokwi-arduino-uno') {
    const digitalPins = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', 'GND.1', 'AREF'];
    const powerPins = ['IOREF', 'RESET', '3.3V', '5V', 'GND.2', 'GND.3', 'VIN', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5'];
    const boxW = 140;
    const boxH = 260;

    const pins: SchematicPin[] = [];
    powerPins.forEach((p, idx) => {
      pins.push({ name: p, x: 0, y: 45 + idx * 16, orientation: 'left' });
    });
    digitalPins.forEach((p, idx) => {
      pins.push({ name: p, x: boxW, y: 45 + idx * 13, orientation: 'right' });
    });

    return {
      width: boxW,
      height: boxH,
      pins,
      render: (p) => (
        <g>
          <rect x="0" y="0" width={boxW} height={boxH} fill="#fff" stroke="#d63333" strokeWidth="2" rx="2" />
          <rect x="0" y="0" width={boxW} height="28" fill="#fff5f5" stroke="#d63333" strokeWidth="1" />
          <text x={boxW / 2} y="14" textAnchor="middle" fill="#d63333" fontSize="11" fontWeight="bold" fontFamily="sans-serif">Arduino UNO R3</text>
          <text x={boxW / 2} y="25" textAnchor="middle" fill="#666" fontSize="8" fontFamily="monospace">{p.id.toUpperCase()}</text>

          {/* Left Pins (Power / Analog) */}
          {powerPins.map((pinName, idx) => {
            const py = 45 + idx * 16;
            return (
              <g key={pinName}>
                <line x1="-12" y1={py} x2="0" y2={py} stroke="#d63333" strokeWidth="1.5" />
                <text x="6" y={py + 3.5} fill="#24292f" fontSize="8.5" fontFamily="monospace">{pinName}</text>
              </g>
            );
          })}

          {/* Right Pins (Digital / PWM) */}
          {digitalPins.map((pinName, idx) => {
            const py = 45 + idx * 13;
            const isPwm = ['3', '5', '6', '9', '10', '11'].includes(pinName);
            return (
              <g key={pinName}>
                <line x1={boxW} y1={py} x2={boxW + 12} y2={py} stroke="#d63333" strokeWidth="1.5" />
                <text x={boxW - 6} y={py + 3.5} textAnchor="end" fill="#24292f" fontSize="8.5" fontFamily="monospace">
                  {isPwm ? `~${pinName}` : pinName}
                </text>
              </g>
            );
          })}
        </g>
      ),
    };
  }

  // Universal Integrated Circuit / Module schematic block for sensors & ICs
  const rawPins = getPartPins(part);
  const pinCount = Math.max(2, rawPins.length);
  const leftPins = rawPins.slice(0, Math.ceil(pinCount / 2));
  const rightPins = rawPins.slice(Math.ceil(pinCount / 2));
  const boxH = Math.max(60, Math.max(leftPins.length, rightPins.length) * 18 + 30);
  const boxW = Math.max(100, (def.name.length * 7) + 20);

  const pins: SchematicPin[] = [];
  leftPins.forEach((p, idx) => {
    pins.push({ name: p.name, x: 0, y: 30 + idx * 18, orientation: 'left' });
  });
  rightPins.forEach((p, idx) => {
    pins.push({ name: p.name, x: boxW, y: 30 + idx * 18, orientation: 'right' });
  });

  return {
    width: boxW,
    height: boxH,
    pins,
    render: (p) => (
      <g>
        <rect x="0" y="0" width={boxW} height={boxH} fill="#fff" stroke="#d63333" strokeWidth="1.8" rx="2" />
        <rect x="0" y="0" width={boxW} height="20" fill="#fff5f5" stroke="#d63333" strokeWidth="1" />
        <text x={boxW / 2} y="13" textAnchor="middle" fill="#d63333" fontSize="9.5" fontWeight="bold" fontFamily="sans-serif">{def.name}</text>
        <text x={boxW / 2} y={boxH + 12} textAnchor="middle" fill="#d63333" fontSize="9" fontWeight="bold" fontFamily="monospace">{p.id.toUpperCase()}</text>

        {leftPins.map((pin, idx) => {
          const py = 30 + idx * 18;
          return (
            <g key={pin.name}>
              <line x1="-10" y1={py} x2="0" y2={py} stroke="#d63333" strokeWidth="1.5" />
              <text x="5" y={py + 3} fill="#24292f" fontSize="8" fontFamily="monospace">{pin.name}</text>
            </g>
          );
        })}

        {rightPins.map((pin, idx) => {
          const py = 30 + idx * 18;
          return (
            <g key={pin.name}>
              <line x1={boxW} y1={py} x2={boxW + 10} y2={py} stroke="#d63333" strokeWidth="1.5" />
              <text x={boxW - 5} y={py + 3} textAnchor="end" fill="#24292f" fontSize="8" fontFamily="monospace">{pin.name}</text>
            </g>
          );
        })}
      </g>
    ),
  };
}

export function resolveSchematicPinCoordinate(
  part: CircuitPart,
  pinName: string,
  schematicLayout: { left: number; top: number }
): { x: number; y: number } {
  const symDef = getSchematicSymbolDef(part);
  const cleanPin = pinName.toLowerCase().replace(/\s+/g, '');
  const matched = symDef.pins.find(
    (p) => p.name.toLowerCase().replace(/\s+/g, '') === cleanPin || p.name === pinName
  ) ?? symDef.pins[0];

  if (!matched) {
    return { x: schematicLayout.left + symDef.width / 2, y: schematicLayout.top + symDef.height / 2 };
  }

  const offsetX = matched.orientation === 'left' ? -12 : matched.orientation === 'right' ? 12 : 0;
  const offsetY = matched.orientation === 'top' ? -12 : matched.orientation === 'bottom' ? 12 : 0;

  return {
    x: schematicLayout.left + matched.x + offsetX,
    y: schematicLayout.top + matched.y + offsetY,
  };
}

export type SchematicNetLine = {
  id: string;
  fromPartId: string;
  fromPin: string;
  toPartId: string;
  toPin: string;
};

export function extractSchematicNets(
  parts: CircuitPart[],
  connections: CircuitConnection[],
): SchematicNetLine[] {
  const graph = buildCircuitGraph({ parts, connections });
  const nonBbParts = parts.filter((p) => !isBreadboardType(p.type));
  const netLines: SchematicNetLine[] = [];
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
                    netLines.push({
                      id: `net_${netLines.length}_${pairKey}`,
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

  // Fallback for direct non-breadboard connection wires
  if (netLines.length === 0) {
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
          netLines.push({
            id: conn.id,
            fromPartId,
            fromPin,
            toPartId,
            toPin,
          });
        }
      }
    }
  }

  return netLines;
}
