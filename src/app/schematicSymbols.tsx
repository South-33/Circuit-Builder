import React from 'react';
import type { CircuitPart } from '../circuit/types';
import { getPartPins, PART_DEFINITIONS } from '../components/parts';

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
    const label = ohms >= 1e6 ? `${ohms / 1e6}k` : ohms >= 1e3 ? `${ohms / 1e3}k` : `${ohms}`;
    return {
      width: 70,
      height: 30,
      pins: [
        { name: '1', x: 0, y: 15, orientation: 'left' },
        { name: '2', x: 70, y: 15, orientation: 'right' },
        { name: 'pin1', x: 0, y: 15, orientation: 'left' },
        { name: 'pin2', x: 70, y: 15, orientation: 'right' },
      ],
      render: (p) => (
        <g>
          <line x1="0" y1="15" x2="15" y2="15" stroke="#b83232" strokeWidth="1.4" />
          <rect x="15" y="6" width="40" height="18" fill="#fff" stroke="#b83232" strokeWidth="1.4" />
          <line x1="55" y1="15" x2="70" y2="15" stroke="#b83232" strokeWidth="1.4" />
          <text x="35" y="-2" textAnchor="middle" fill="#777" fontSize="10" fontFamily="sans-serif">{p.id.toUpperCase()}</text>
          <text x="35" y="36" textAnchor="middle" fill="#777" fontSize="9" fontFamily="sans-serif">{label}</text>
        </g>
      ),
    };
  }

  if (type === 'wokwi-potentiometer') {
    const ohms = Number(part.attrs.value ?? 250000);
    const label = ohms >= 1e3 ? `${ohms / 1e3}k` : `${ohms}`;
    return {
      width: 70,
      height: 36,
      pins: [
        { name: '1', x: 0, y: 18, orientation: 'left' },
        { name: '2', x: 35, y: 0, orientation: 'top' },
        { name: '3', x: 70, y: 18, orientation: 'right' },
        { name: 'GND', x: 0, y: 18, orientation: 'left' },
        { name: 'SIG', x: 35, y: 0, orientation: 'top' },
        { name: 'VCC', x: 70, y: 18, orientation: 'right' },
      ],
      render: (p) => (
        <g>
          <line x1="0" y1="18" x2="15" y2="18" stroke="#b83232" strokeWidth="1.4" />
          <rect x="15" y="9" width="40" height="18" fill="#fff" stroke="#b83232" strokeWidth="1.4" />
          <line x1="55" y1="18" x2="70" y2="18" stroke="#b83232" strokeWidth="1.4" />
          <line x1="35" y1="0" x2="35" y2="9" stroke="#b83232" strokeWidth="1.4" />
          <text x="35" y="-4" textAnchor="middle" fill="#777" fontSize="10" fontFamily="sans-serif">RPOT1</text>
          <text x="35" y="38" textAnchor="middle" fill="#777" fontSize="9" fontFamily="sans-serif">{label}</text>
        </g>
      ),
    };
  }

  if (type === 'wokwi-lcd1602' || type === 'wokwi-lcd2004') {
    const dbPins = ['DB0', 'DB1', 'DB2', 'DB3', 'DB4', 'DB5', 'DB6', 'DB7'];
    const ctrlPins = ['VCC', 'VO', 'LED+', 'LED-', 'RS', 'RW', 'ENA', 'GND'];
    const boxW = 160;
    const boxH = 140;

    const pins: SchematicPin[] = [];
    dbPins.forEach((p, idx) => {
      pins.push({ name: p, x: 0, y: 22 + idx * 14, orientation: 'left' });
    });
    ctrlPins.forEach((p, idx) => {
      pins.push({ name: p, x: boxW, y: 22 + idx * 14, orientation: 'right' });
    });

    return {
      width: boxW,
      height: boxH,
      pins,
      render: (p) => (
        <g>
          <rect x="0" y="0" width={boxW} height={boxH} fill="#fff" stroke="#b83232" strokeWidth="1.4" />
          <text x={boxW / 2} y="-6" textAnchor="middle" fill="#777" fontSize="11" fontFamily="sans-serif">U2</text>

          <rect x={boxW / 2 - 28} y={boxH / 2 - 24} width="56" height="48" fill="#fff" stroke="#b83232" strokeWidth="1.2" />
          <text x={boxW / 2} y={boxH / 2 - 6} textAnchor="middle" fill="#b83232" fontSize="13" fontWeight="500" fontFamily="sans-serif">LCD</text>
          <text x={boxW / 2} y={boxH / 2 + 12} textAnchor="middle" fill="#b83232" fontSize="13" fontWeight="500" fontFamily="sans-serif">16x2</text>

          {dbPins.map((pinName, idx) => {
            const py = 22 + idx * 14;
            return (
              <g key={pinName}>
                <line x1="-10" y1={py} x2="0" y2={py} stroke="#b83232" strokeWidth="1.2" />
                <text x="5" y={py + 3.5} fill="#666" fontSize="8" fontFamily="sans-serif">{pinName}</text>
              </g>
            );
          })}

          {ctrlPins.map((pinName, idx) => {
            const py = 22 + idx * 14;
            return (
              <g key={pinName}>
                <line x1={boxW} y1={py} x2={boxW + 10} y2={py} stroke="#b83232" strokeWidth="1.2" />
                <text x={boxW - 5} y={py + 3.5} textAnchor="end" fill="#666" fontSize="8" fontFamily="sans-serif">{pinName}</text>
              </g>
            );
          })}
        </g>
      ),
    };
  }

  if (type === 'wokwi-arduino-uno') {
    const leftPins = ['VIN', '5V', '3.3V', 'AREF', 'IOREF', 'RES', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'GND'];
    const rightPins = ['RX', 'TX', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9', 'D10', 'D11', 'D12', 'D13', 'SDA', 'SCL'];
    const boxW = 100;
    const boxH = 240;

    const pins: SchematicPin[] = [];
    leftPins.forEach((p, idx) => {
      const actualPinName = p === 'RES' ? 'RESET' : p === 'GND' ? 'GND.1' : p;
      pins.push({ name: actualPinName, x: 0, y: 24 + idx * 16, orientation: 'left' });
    });
    rightPins.forEach((p, idx) => {
      const actualPinName = p === 'RX' ? '0' : p === 'TX' ? '1' : p.startsWith('D') ? p.slice(1) : p;
      pins.push({ name: actualPinName, x: boxW, y: 24 + idx * 13, orientation: 'right' });
    });

    return {
      width: boxW,
      height: boxH,
      pins,
      render: (p) => (
        <g>
          <rect x="0" y="0" width={boxW} height={boxH} fill="#fff" stroke="#b83232" strokeWidth="1.4" />
          <text x={boxW / 2} y="-6" textAnchor="middle" fill="#777" fontSize="11" fontFamily="sans-serif">U1</text>

          <text x={boxW / 2} y={boxH / 2 - 20} textAnchor="middle" fill="#b83232" fontSize="11" fontWeight="500" fontFamily="sans-serif">Arduino</text>
          <text x={boxW / 2} y={boxH / 2 - 6} textAnchor="middle" fill="#b83232" fontSize="11" fontWeight="500" fontFamily="sans-serif">UNO</text>

          {leftPins.map((pinName, idx) => {
            const py = 24 + idx * 16;
            return (
              <g key={pinName}>
                <line x1="-10" y1={py} x2="0" y2={py} stroke="#b83232" strokeWidth="1.2" />
                <text x="6" y={py + 3.5} fill="#666" fontSize="8" fontFamily="sans-serif">{pinName}</text>
              </g>
            );
          })}

          {rightPins.map((pinName, idx) => {
            const py = 24 + idx * 13;
            return (
              <g key={pinName}>
                <line x1={boxW} y1={py} x2={boxW + 10} y2={py} stroke="#b83232" strokeWidth="1.2" />
                <text x={boxW - 6} y={py + 3.5} textAnchor="end" fill="#666" fontSize="8" fontFamily="sans-serif">{pinName}</text>
              </g>
            );
          })}
        </g>
      ),
    };
  }

  if (type === 'dc-motor') {
    return {
      width: 60,
      height: 44,
      pins: [
        { name: '1', x: 0, y: 22, orientation: 'left' },
        { name: '2', x: 60, y: 22, orientation: 'right' },
        { name: '+', x: 0, y: 22, orientation: 'left' },
        { name: '-', x: 60, y: 22, orientation: 'right' },
      ],
      render: (p) => (
        <g>
          <circle cx="30" cy="22" r="16" fill="#fff" stroke="#b83232" strokeWidth="1.5" />
          <text x="30" y="28" textAnchor="middle" fill="#b83232" fontSize="16" fontWeight="bold" fontFamily="sans-serif">M</text>
          <line x1="0" y1="22" x2="14" y2="22" stroke="#b83232" strokeWidth="1.4" />
          <line x1="46" y1="22" x2="60" y2="22" stroke="#b83232" strokeWidth="1.4" />
          <text x="30" y="-2" textAnchor="middle" fill="#777" fontSize="10" fontFamily="sans-serif">{p.id.toUpperCase()}</text>
        </g>
      ),
    };
  }

  // Universal IC block for sensors, buttons, modules
  const rawPins = getPartPins(part);
  const pinCount = Math.max(2, rawPins.length);
  const leftPins = rawPins.slice(0, Math.ceil(pinCount / 2));
  const rightPins = rawPins.slice(Math.ceil(pinCount / 2));
  const boxH = Math.max(50, Math.max(leftPins.length, rightPins.length) * 16 + 24);
  const boxW = Math.max(90, def.name.length * 6.5 + 20);

  const pins: SchematicPin[] = [];
  leftPins.forEach((p, idx) => {
    pins.push({ name: p.name, x: 0, y: 20 + idx * 16, orientation: 'left' });
  });
  rightPins.forEach((p, idx) => {
    pins.push({ name: p.name, x: boxW, y: 20 + idx * 16, orientation: 'right' });
  });

  return {
    width: boxW,
    height: boxH,
    pins,
    render: (p) => (
      <g>
        <rect x="0" y="0" width={boxW} height={boxH} fill="#fff" stroke="#b83232" strokeWidth="1.4" />
        <text x={boxW / 2} y="-5" textAnchor="middle" fill="#777" fontSize="10" fontFamily="sans-serif">{p.id.toUpperCase()}</text>
        <text x={boxW / 2} y={boxH / 2 + 4} textAnchor="middle" fill="#b83232" fontSize="9.5" fontWeight="500" fontFamily="sans-serif">{def.name}</text>

        {leftPins.map((pin, idx) => {
          const py = 20 + idx * 16;
          return (
            <g key={pin.name}>
              <line x1="-10" y1={py} x2="0" y2={py} stroke="#b83232" strokeWidth="1.2" />
              <text x="4" y={py + 3} fill="#666" fontSize="7.5" fontFamily="sans-serif">{pin.name}</text>
            </g>
          );
        })}

        {rightPins.map((pin, idx) => {
          const py = 20 + idx * 16;
          return (
            <g key={pin.name}>
              <line x1={boxW} y1={py} x2={boxW + 10} y2={py} stroke="#b83232" strokeWidth="1.2" />
              <text x={boxW - 4} y={py + 3} textAnchor="end" fill="#666" fontSize="7.5" fontFamily="sans-serif">{pin.name}</text>
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

  const offsetX = matched.orientation === 'left' ? -10 : matched.orientation === 'right' ? 10 : 0;
  const offsetY = matched.orientation === 'top' ? -10 : matched.orientation === 'bottom' ? 10 : 0;

  return {
    x: schematicLayout.left + matched.x + offsetX,
    y: schematicLayout.top + matched.y + offsetY,
  };
}