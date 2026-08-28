import React, { useMemo, useRef, useState } from 'react';
import type { CircuitConnection, CircuitPart } from '../circuit/types';
import { getSchematicSymbolDef } from './schematicSymbols';
import { computeSchematicInitialLayout, routeSchematicNets } from './schematicEngine';
import { isBreadboardType } from '../breadboard/geometry';

export function SchematicView({
  parts,
  connections,
  zoom = 1,
  onZoomChange,
}: {
  parts: CircuitPart[];
  connections: CircuitConnection[];
  zoom?: number;
  onZoomChange?: React.Dispatch<React.SetStateAction<number>>;
}) {
  const [internalZoom, setInternalZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  const activeZoom = onZoomChange ? zoom : internalZoom;
  const setZoom = onZoomChange ?? setInternalZoom;

  const nonBreadboardParts = useMemo(() => {
    return parts.filter((p) => !isBreadboardType(p.type));
  }, [parts]);

  const positions = useMemo(() => {
    return computeSchematicInitialLayout(parts);
  }, [parts]);

  const { wires, powerMarkers } = useMemo(() => {
    return routeSchematicNets(parts, connections, positions);
  }, [parts, connections, positions]);

  const currentDate = useMemo(() => {
    const d = new Date();
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}, ${d.toLocaleTimeString()}`;
  }, []);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : 0.92;
    setZoom((prev) => Math.max(0.4, Math.min(3.0, prev * factor)));
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    panStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    setIsPanning(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!panStartRef.current) return;
    const dx = e.clientX - panStartRef.current.startX;
    const dy = e.clientY - panStartRef.current.startY;
    setPan({
      x: panStartRef.current.panX + dx,
      y: panStartRef.current.panY + dy,
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    panStartRef.current = null;
    setIsPanning(false);
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <div className="schematic-view-page">
      <div
        className={`schematic-canvas-wrap${isPanning ? ' panning' : ''}`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div
          className="schematic-sheet-container"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${activeZoom})`,
            transformOrigin: 'center center',
          }}
        >
          <svg
            className="schematic-svg-frame"
            viewBox="0 0 1200 800"
            width="100%"
            height="100%"
          >
            {/* Sheet background */}
            <rect x="0" y="0" width="1200" height="800" fill="#ffffff" />

            {/* Outer Engineering Borders (Tinkercad Crimson #d85c5c) */}
            <rect x="14" y="14" width="1172" height="772" fill="none" stroke="#d85c5c" strokeWidth="1.2" />
            <rect x="28" y="28" width="1144" height="744" fill="none" stroke="#d85c5c" strokeWidth="0.8" />

            {/* Coordinate Grid Ticks (1..6 on top and bottom, A..E on left and right) */}
            {[
              { label: '1', x: 130 },
              { label: '2', x: 310 },
              { label: '3', x: 490 },
              { label: '4', x: 670 },
              { label: '5', x: 850 },
              { label: '6', x: 1030 },
            ].map((col) => (
              <g key={col.label}>
                <line x1={col.x} y1="14" x2={col.x} y2="28" stroke="#d85c5c" strokeWidth="0.8" />
                <line x1={col.x} y1="772" x2={col.x} y2="786" stroke="#d85c5c" strokeWidth="0.8" />
                <text x={col.x} y="24" textAnchor="middle" fill="#d85c5c" fontSize="11" fontFamily="sans-serif">{col.label}</text>
                <text x={col.x} y="782" textAnchor="middle" fill="#d85c5c" fontSize="11" fontFamily="sans-serif">{col.label}</text>
              </g>
            ))}

            {[
              { label: 'A', y: 110 },
              { label: 'B', y: 250 },
              { label: 'C', y: 390 },
              { label: 'D', y: 530 },
              { label: 'E', y: 670 },
            ].map((row) => (
              <g key={row.label}>
                <line x1="14" y1={row.y} x2="28" y2={row.y} stroke="#d85c5c" strokeWidth="0.8" />
                <line x1="1172" y1={row.y} x2="1186" y2={row.y} stroke="#d85c5c" strokeWidth="0.8" />
                <text x="22" y={row.y + 4} textAnchor="middle" fill="#d85c5c" fontSize="11" fontFamily="sans-serif">{row.label}</text>
                <text x="1180" y={row.y + 4} textAnchor="middle" fill="#d85c5c" fontSize="11" fontFamily="sans-serif">{row.label}</text>
              </g>
            ))}

            {/* Bottom-Left Tinkercad Watermark */}
            <text x="42" y="756" fill="#d85c5c" fontSize="13" fontWeight="500" fontFamily="sans-serif">Made with Tinkercad®</text>

            {/* Bottom-Right Title Block */}
            <g transform="translate(730, 700)">
              <rect x="0" y="0" width="442" height="72" fill="#fff" stroke="#d85c5c" strokeWidth="0.8" />
              <line x1="0" y1="36" x2="442" y2="36" stroke="#d85c5c" strokeWidth="0.8" />
              <line x1="310" y1="36" x2="310" y2="72" stroke="#d85c5c" strokeWidth="0.8" />

              <text x="14" y="23" fill="#888" fontSize="11" fontFamily="sans-serif">Title:</text>
              <text x="56" y="23" fill="#555" fontSize="12" fontWeight="500" fontFamily="sans-serif">Circuit Schematic</text>

              <text x="14" y="58" fill="#888" fontSize="11" fontFamily="sans-serif">Date:</text>
              <text x="56" y="58" fill="#555" fontSize="11" fontFamily="sans-serif">{currentDate}</text>

              <text x="324" y="58" fill="#888" fontSize="11" fontFamily="sans-serif">Sheet:</text>
              <text x="372" y="58" fill="#555" fontSize="11" fontFamily="sans-serif">1/1</text>
            </g>

            {/* Schematic Net Connections (Tinkercad sea-green wires #5fa896) */}
            <g className="schematic-nets">
              {wires.map((wire) => {
                const d = wire.points.reduce((acc, pt, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`, '');

                return (
                  <g key={wire.id} className="schematic-net-wire">
                    <path
                      d={d}
                      fill="none"
                      stroke="#5fa896"
                      strokeWidth="1.1"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                    {/* Junction dots */}
                    <circle cx={wire.fromPos.x} cy={wire.fromPos.y} r="1.8" fill="#5fa896" />
                    <circle cx={wire.toPos.x} cy={wire.toPos.y} r="1.8" fill="#5fa896" />
                  </g>
                );
              })}
            </g>

            {/* Power Markers (U1_5V, U1_GND) */}
            <g className="schematic-power-markers">
              {powerMarkers.map((marker) => (
                <g key={marker.id} transform={`translate(${marker.x}, ${marker.y})`}>
                  {marker.direction === 'up' ? (
                    <>
                      <line x1="0" y1="0" x2="0" y2="-12" stroke="#b83232" strokeWidth="1.2" />
                      <polygon points="0,-18 -4,-12 4,-12" fill="none" stroke="#b83232" strokeWidth="1.1" />
                      <text x="0" y="-23" textAnchor="middle" fill="#888" fontSize="9.5" fontFamily="sans-serif">{marker.label}</text>
                    </>
                  ) : (
                    <>
                      <line x1="0" y1="0" x2="0" y2="12" stroke="#b83232" strokeWidth="1.2" />
                      <polygon points="0,18 -4,12 4,12" fill="none" stroke="#b83232" strokeWidth="1.1" />
                      <text x="0" y="28" textAnchor="middle" fill="#888" fontSize="9.5" fontFamily="sans-serif">{marker.label}</text>
                    </>
                  )}
                </g>
              ))}
            </g>

            {/* Schematic Symbols (Clean, Static, High-Fidelity) */}
            <g className="schematic-components">
              {nonBreadboardParts.map((part) => {
                const pos = positions[part.id] ?? { left: 100, top: 100 };
                const symDef = getSchematicSymbolDef(part);

                return (
                  <g
                    key={part.id}
                    className="schematic-part-node"
                    transform={`translate(${pos.left}, ${pos.top})`}
                  >
                    {symDef.render(part)}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      </div>
    </div>
  );
}