import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CircuitConnection, CircuitPart } from '../circuit/types';
import { getSchematicSymbolDef } from './schematicSymbols';
import { computeSchematicInitialLayout, routeSchematicNets } from './schematicEngine';
import { isBreadboardType } from '../breadboard/geometry';

type PartPos = { left: number; top: number };

export function SchematicView({
  parts,
  connections,
}: {
  parts: CircuitPart[];
  connections: CircuitConnection[];
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [positions, setPositions] = useState<Record<string, PartPos>>({});
  const [draggingPartId, setDraggingPartId] = useState<string | null>(null);
  const dragStartRef = useRef<{ startX: number; startY: number; partX: number; partY: number } | null>(null);
  const panStartRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const nonBreadboardParts = useMemo(() => {
    return parts.filter((p) => !isBreadboardType(p.type));
  }, [parts]);

  // Compute smart initial positions matching Tinkercad schematic layout
  useEffect(() => {
    setPositions((prev) => {
      const initial = computeSchematicInitialLayout(parts);
      const next = { ...prev };
      let changed = false;

      for (const [id, pos] of Object.entries(initial)) {
        if (!next[id]) {
          next[id] = pos;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [parts]);

  const { wires, powerMarkers } = useMemo(() => {
    return routeSchematicNets(parts, connections, positions);
  }, [parts, connections, positions]);

  const handlePrint = () => {
    window.print();
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Dragging schematic part
  const handlePartPointerDown = (e: React.PointerEvent, partId: string) => {
    e.stopPropagation();
    const currentPos = positions[partId] ?? { left: 100, top: 100 };
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      partX: currentPos.left,
      partY: currentPos.top,
    };
    setDraggingPartId(partId);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePartPointerMove = (e: React.PointerEvent) => {
    if (!dragStartRef.current || !draggingPartId) return;
    const dx = (e.clientX - dragStartRef.current.startX) / zoom;
    const dy = (e.clientY - dragStartRef.current.startY) / zoom;
    const nextLeft = Math.round((dragStartRef.current.partX + dx) / 10) * 10;
    const nextTop = Math.round((dragStartRef.current.partY + dy) / 10) * 10;
    setPositions((prev) => ({
      ...prev,
      [draggingPartId]: {
        left: Math.max(30, Math.min(1100, nextLeft)),
        top: Math.max(30, Math.min(720, nextTop)),
      },
    }));
  };

  const handlePartPointerUp = (e: React.PointerEvent) => {
    if (dragStartRef.current) {
      dragStartRef.current = null;
      setDraggingPartId(null);
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    }
  };

  // Canvas Pan
  const handleCanvasPointerDown = (e: React.PointerEvent) => {
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

  const handleCanvasPointerMove = (e: React.PointerEvent) => {
    if (!panStartRef.current) return;
    const dx = e.clientX - panStartRef.current.startX;
    const dy = e.clientY - panStartRef.current.startY;
    setPan({
      x: panStartRef.current.panX + dx,
      y: panStartRef.current.panY + dy,
    });
  };

  const handleCanvasPointerUp = (e: React.PointerEvent) => {
    if (panStartRef.current) {
      panStartRef.current = null;
      setIsPanning(false);
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom((prev) => Math.max(0.4, Math.min(2.5, prev * factor)));
  };

  return (
    <div className="schematic-view-page">
      <div className="schematic-view-header">
        <div className="schematic-header-left">
          <h2>Schematic View</h2>
          <span className="schematic-part-count">
            {nonBreadboardParts.length} {nonBreadboardParts.length === 1 ? 'component' : 'components'} · {wires.length} {wires.length === 1 ? 'net' : 'nets'}
          </span>
        </div>
        <div className="schematic-controls">
          <button type="button" className="schematic-tool-btn" onClick={() => setZoom((z) => Math.min(2.5, z * 1.15))} title="Zoom In">+</button>
          <span className="schematic-zoom-label">{Math.round(zoom * 100)}%</span>
          <button type="button" className="schematic-tool-btn" onClick={() => setZoom((z) => Math.max(0.4, z / 1.15))} title="Zoom Out">−</button>
          <button type="button" className="schematic-tool-btn reset-btn" onClick={resetView} title="Fit sheet">Reset</button>
          <button type="button" className="pdf-download-btn" onClick={handlePrint}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
            Download PDF / Print
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className={`schematic-canvas-wrap${isPanning ? ' panning' : ''}`}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handleCanvasPointerMove}
        onPointerUp={handleCanvasPointerUp}
        onPointerCancel={handleCanvasPointerUp}
        onWheel={handleWheel}
      >
        <div
          className="schematic-sheet-container"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
          }}
        >
          <svg
            className="schematic-svg-frame"
            viewBox="0 0 1200 800"
            width="1200"
            height="800"
          >
            {/* Sheet background */}
            <rect x="0" y="0" width="1200" height="800" fill="#ffffff" />

            {/* Schematic Net Connections (Tinkercad sea-green wires #5ab69b) */}
            <g className="schematic-nets">
              {wires.map((wire) => {
                const d = wire.points.reduce((acc, pt, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`, '');

                return (
                  <g key={wire.id} className="schematic-net-wire">
                    <path
                      d={d}
                      fill="none"
                      stroke="#5ab69b"
                      strokeWidth="1.3"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                    {/* Junction dots */}
                    <circle cx={wire.fromPos.x} cy={wire.fromPos.y} r="2.2" fill="#5ab69b" />
                    <circle cx={wire.toPos.x} cy={wire.toPos.y} r="2.2" fill="#5ab69b" />
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
                      <line x1="0" y1="0" x2="0" y2="-12" stroke="#b83232" strokeWidth="1.4" />
                      <polygon points="0,-18 -4,-12 4,-12" fill="none" stroke="#b83232" strokeWidth="1.2" />
                      <text x="0" y="-24" textAnchor="middle" fill="#999" fontSize="10" fontFamily="sans-serif">{marker.label}</text>
                    </>
                  ) : (
                    <>
                      <line x1="0" y1="0" x2="0" y2="12" stroke="#b83232" strokeWidth="1.4" />
                      <polygon points="0,18 -4,12 4,12" fill="none" stroke="#b83232" strokeWidth="1.2" />
                      <text x="0" y="30" textAnchor="middle" fill="#999" fontSize="10" fontFamily="sans-serif">{marker.label}</text>
                    </>
                  )}
                </g>
              ))}
            </g>

            {/* Schematic Symbols (Interactive & Draggable) */}
            <g className="schematic-components">
              {nonBreadboardParts.map((part) => {
                const pos = positions[part.id] ?? { left: 100, top: 100 };
                const symDef = getSchematicSymbolDef(part);
                const isDragging = draggingPartId === part.id;

                return (
                  <g
                    key={part.id}
                    className={`schematic-part-node${isDragging ? ' dragging' : ''}`}
                    transform={`translate(${pos.left}, ${pos.top})`}
                    onPointerDown={(e) => handlePartPointerDown(e, part.id)}
                    onPointerMove={handlePartPointerMove}
                    onPointerUp={handlePartPointerUp}
                    onPointerCancel={handlePartPointerUp}
                    style={{ cursor: 'grab' }}
                  >
                    {/* Transparent drag hit boundary */}
                    <rect
                      x="-10"
                      y="-10"
                      width={symDef.width + 20}
                      height={symDef.height + 20}
                      fill="transparent"
                    />
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
