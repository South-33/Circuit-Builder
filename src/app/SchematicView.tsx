import React from 'react';
import type { CircuitConnection, CircuitPart } from '../circuit/types';
import { getPartPins, PART_DEFINITIONS } from '../components/parts';
import { endpointPoint } from '../wires/geometry';

export function SchematicView({
  parts,
  connections,
}: {
  parts: CircuitPart[];
  connections: CircuitConnection[];
}) {
  const currentDate = new Date().toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  const handlePrint = () => {
    window.print();
  };

  // Map parts to schematic visual nodes
  const renderSchematicSymbol = (part: CircuitPart) => {
    const type = part.type;
    const def = PART_DEFINITIONS[type];
    const width = 80;
    const height = 60;

    if (type === 'wokwi-resistor') {
      const ohms = Number(part.attrs.value ?? 220);
      const label = ohms >= 1e3 ? `${ohms / 1e3}k` : `${ohms}Ω`;
      return (
        <g transform={`translate(${part.left}, ${part.top})`}>
          <line x1="0" y1="20" x2="15" y2="20" stroke="#e03131" strokeWidth="1.5" />
          <polyline
            points="15,20 18,10 24,30 30,10 36,30 42,10 48,30 54,10 60,30 63,20"
            fill="none"
            stroke="#e03131"
            strokeWidth="1.5"
          />
          <line x1="63" y1="20" x2="78" y2="20" stroke="#e03131" strokeWidth="1.5" />
          <text x="39" y="8" textAnchor="middle" fill="#e03131" fontSize="9" fontFamily="monospace">{part.id.toUpperCase()}</text>
          <text x="39" y="42" textAnchor="middle" fill="#555" fontSize="8" fontFamily="monospace">{label}</text>
        </g>
      );
    }

    if (type === 'wokwi-led' || type === 'wokwi-rgb-led') {
      return (
        <g transform={`translate(${part.left}, ${part.top})`}>
          <line x1="0" y1="20" x2="20" y2="20" stroke="#e03131" strokeWidth="1.5" />
          <polygon points="20,10 20,30 35,20" fill="none" stroke="#e03131" strokeWidth="1.5" />
          <line x1="35" y1="10" x2="35" y2="30" stroke="#e03131" strokeWidth="1.5" />
          <line x1="35" y1="20" x2="55" y2="20" stroke="#e03131" strokeWidth="1.5" />
          {/* Light emission arrows */}
          <line x1="28" y1="8" x2="34" y2="2" stroke="#e03131" strokeWidth="1.2" />
          <polygon points="34,2 31,4 33,6" fill="#e03131" />
          <line x1="33" y1="12" x2="39" y2="6" stroke="#e03131" strokeWidth="1.2" />
          <polygon points="39,6 36,8 38,10" fill="#e03131" />
          <text x="27" y="-2" textAnchor="middle" fill="#e03131" fontSize="9" fontFamily="monospace">{part.id.toUpperCase()}</text>
          <text x="27" y="42" textAnchor="middle" fill="#555" fontSize="8" fontFamily="monospace">{String(part.attrs.color ?? 'LED')}</text>
        </g>
      );
    }

    if (type === 'rectifier-diode' || type === 'zener-diode') {
      return (
        <g transform={`translate(${part.left}, ${part.top})`}>
          <line x1="0" y1="20" x2="20" y2="20" stroke="#e03131" strokeWidth="1.5" />
          <polygon points="20,10 20,30 35,20" fill="none" stroke="#e03131" strokeWidth="1.5" />
          <line x1="35" y1="10" x2="35" y2="30" stroke="#e03131" strokeWidth="1.5" />
          {type === 'zener-diode' && <line x1="32" y1="10" x2="35" y2="10" stroke="#e03131" strokeWidth="1.5" />}
          {type === 'zener-diode' && <line x1="35" y1="30" x2="38" y2="30" stroke="#e03131" strokeWidth="1.5" />}
          <line x1="35" y1="20" x2="55" y2="20" stroke="#e03131" strokeWidth="1.5" />
          <text x="27" y="4" textAnchor="middle" fill="#e03131" fontSize="9" fontFamily="monospace">{part.id.toUpperCase()}</text>
        </g>
      );
    }

    if (type === 'npn-transistor' || type === 'pnp-transistor') {
      return (
        <g transform={`translate(${part.left}, ${part.top})`}>
          <circle cx="25" cy="25" r="18" fill="none" stroke="#e03131" strokeWidth="1.5" />
          <line x1="18" y1="15" x2="18" y2="35" stroke="#e03131" strokeWidth="2" />
          <line x1="5" y1="25" x2="18" y2="25" stroke="#e03131" strokeWidth="1.5" />
          <line x1="18" y1="18" x2="32" y2="10" stroke="#e03131" strokeWidth="1.5" />
          <line x1="18" y1="32" x2="32" y2="40" stroke="#e03131" strokeWidth="1.5" />
          {type === 'npn-transistor' ? (
            <polygon points="30,39 25,35 27,33" fill="#e03131" />
          ) : (
            <polygon points="20,20 25,24 23,26" fill="#e03131" />
          )}
          <text x="25" y="0" textAnchor="middle" fill="#e03131" fontSize="9" fontFamily="monospace">{part.id.toUpperCase()}</text>
          <text x="25" y="52" textAnchor="middle" fill="#555" fontSize="8" fontFamily="monospace">{type === 'npn-transistor' ? 'NPN' : 'PNP'}</text>
        </g>
      );
    }

    if (type === 'battery-9v' || type === 'battery-aa' || type === 'battery-coin-cell') {
      return (
        <g transform={`translate(${part.left}, ${part.top})`}>
          <line x1="15" y1="10" x2="35" y2="10" stroke="#e03131" strokeWidth="2" />
          <line x1="20" y1="18" x2="30" y2="18" stroke="#e03131" strokeWidth="1.5" />
          <line x1="15" y1="26" x2="35" y2="26" stroke="#e03131" strokeWidth="2" />
          <line x1="20" y1="34" x2="30" y2="34" stroke="#e03131" strokeWidth="1.5" />
          <line x1="25" y1="0" x2="25" y2="10" stroke="#e03131" strokeWidth="1.5" />
          <line x1="25" y1="34" x2="25" y2="44" stroke="#e03131" strokeWidth="1.5" />
          <text x="36" y="8" fill="#e03131" fontSize="10" fontWeight="bold">+</text>
          <text x="36" y="40" fill="#e03131" fontSize="10" fontWeight="bold">-</text>
          <text x="25" y="-5" textAnchor="middle" fill="#e03131" fontSize="9" fontFamily="monospace">{part.id.toUpperCase()}</text>
        </g>
      );
    }

    if (type === 'dc-motor') {
      return (
        <g transform={`translate(${part.left}, ${part.top})`}>
          <circle cx="30" cy="30" r="18" fill="none" stroke="#e03131" strokeWidth="1.5" />
          <text x="30" y="36" textAnchor="middle" fill="#e03131" fontSize="18" fontWeight="bold" fontFamily="sans-serif">M</text>
          <line x1="0" y1="30" x2="12" y2="30" stroke="#e03131" strokeWidth="1.5" />
          <line x1="48" y1="30" x2="60" y2="30" stroke="#e03131" strokeWidth="1.5" />
          <text x="30" y="5" textAnchor="middle" fill="#e03131" fontSize="9" fontFamily="monospace">{part.id.toUpperCase()}</text>
        </g>
      );
    }

    if (type === 'wokwi-arduino-uno') {
      const pins = getPartPins(part);
      const digitalPins = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', 'GND.1', 'AREF'];
      const powerPins = ['IOREF', 'RESET', '3.3V', '5V', 'GND.2', 'GND.3', 'VIN', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5'];
      const boxW = 120;
      const boxH = 220;
      return (
        <g transform={`translate(${part.left}, ${part.top})`}>
          <rect x="0" y="0" width={boxW} height={boxH} fill="#fff" stroke="#e03131" strokeWidth="1.5" />
          <text x={boxW / 2} y="20" textAnchor="middle" fill="#e03131" fontSize="11" fontWeight="bold" fontFamily="monospace">Arduino</text>
          <text x={boxW / 2} y="34" textAnchor="middle" fill="#e03131" fontSize="11" fontWeight="bold" fontFamily="monospace">UNO</text>
          {powerPins.map((p, idx) => (
            <g key={p} transform={`translate(0, ${48 + idx * 12})`}>
              <line x1="-12" y1="0" x2="0" y2="0" stroke="#e03131" strokeWidth="1.2" />
              <text x="5" y="3" fill="#333" fontSize="8" fontFamily="monospace">{p}</text>
            </g>
          ))}
          {digitalPins.map((p, idx) => (
            <g key={p} transform={`translate(${boxW}, ${48 + idx * 10})`}>
              <line x1="0" y1="0" x2="12" y2="0" stroke="#e03131" strokeWidth="1.2" />
              <text x="-5" y="3" textAnchor="end" fill="#333" fontSize="8" fontFamily="monospace">{p}</text>
            </g>
          ))}
          <text x={boxW / 2} y="-6" textAnchor="middle" fill="#e03131" fontSize="10" fontFamily="monospace">{part.id.toUpperCase()}</text>
        </g>
      );
    }

    // Generic IC / Module block
    const pins = getPartPins(part);
    const boxW = Math.max(70, pins.length * 8);
    const boxH = 48;
    return (
      <g transform={`translate(${part.left}, ${part.top})`}>
        <rect x="0" y="0" width={boxW} height={boxH} fill="#fff" stroke="#e03131" strokeWidth="1.5" />
        <text x={boxW / 2} y={boxH / 2 + 4} textAnchor="middle" fill="#e03131" fontSize="10" fontWeight="bold" fontFamily="monospace">{def.name}</text>
        <text x={boxW / 2} y="-5" textAnchor="middle" fill="#e03131" fontSize="9" fontFamily="monospace">{part.id.toUpperCase()}</text>
      </g>
    );
  };

  return (
    <div className="schematic-view-page">
      <div className="schematic-view-header">
        <h2>Schematic View</h2>
        <button type="button" className="pdf-download-btn" onClick={handlePrint}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          Download PDF / Print
        </button>
      </div>

      <div className="schematic-canvas-wrap">
        <svg className="schematic-svg-frame" viewBox="0 0 1000 680" width="1000" height="680">
          {/* Engineering border */}
          <rect x="20" y="20" width="960" height="640" fill="#fafafa" stroke="#e8a5a5" strokeWidth="1.5" />
          <rect x="26" y="26" width="948" height="628" fill="#ffffff" stroke="#e8a5a5" strokeWidth="0.8" />

          {/* Coordinate grid labels */}
          {['1', '2', '3', '4', '5', '6'].map((num, i) => (
            <text key={num} x={26 + (i + 0.5) * (948 / 6)} y="19" textAnchor="middle" fill="#e8a5a5" fontSize="9">{num}</text>
          ))}
          {['A', 'B', 'C', 'D', 'E'].map((letter, i) => (
            <text key={letter} x="12" y={26 + (i + 0.5) * (628 / 5)} textAnchor="middle" fill="#e8a5a5" fontSize="9">{letter}</text>
          ))}

          {/* Title block bottom right */}
          <g transform="translate(680, 560)">
            <rect x="0" y="0" width="294" height="94" fill="#fff" stroke="#e8a5a5" strokeWidth="1" />
            <line x1="0" y1="32" x2="294" y2="32" stroke="#e8a5a5" strokeWidth="0.8" />
            <line x1="0" y1="64" x2="294" y2="64" stroke="#e8a5a5" strokeWidth="0.8" />
            <line x1="180" y1="64" x2="180" y2="94" stroke="#e8a5a5" strokeWidth="0.8" />
            <text x="8" y="20" fill="#e8a5a5" fontSize="10" fontFamily="sans-serif">Title: Circuit Schematic</text>
            <text x="8" y="52" fill="#e8a5a5" fontSize="9" fontFamily="sans-serif">Date: {currentDate}</text>
            <text x="190" y="82" fill="#e8a5a5" fontSize="9" fontFamily="sans-serif">Sheet: 1/1</text>
            <text x="8" y="82" fill="#e8a5a5" fontSize="9" fontFamily="sans-serif">Made with Hardware Lab</text>
          </g>

          {/* Schematic Net Wires */}
          <g className="schematic-wires">
            {connections.map((wire) => {
              const start = endpointPoint(wire.from, parts);
              const end = endpointPoint(wire.to, parts);
              if (!start || !end) return null;
              // Render green net wire
              const midX = (start.x + end.x) / 2;
              return (
                <g key={wire.id}>
                  <path
                    d={`M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${end.y} L ${end.x} ${end.y}`}
                    fill="none"
                    stroke="#2f9e44"
                    strokeWidth="1.2"
                  />
                  <circle cx={start.x} cy={start.y} r="2" fill="#2f9e44" />
                  <circle cx={end.x} cy={end.y} r="2" fill="#2f9e44" />
                </g>
              );
            })}
          </g>

          {/* Schematic Component Symbols */}
          <g className="schematic-symbols">
            {parts.filter((p) => !p.type.startsWith('breadboard')).map(renderSchematicSymbol)}
          </g>
        </svg>
      </div>
    </div>
  );
}
