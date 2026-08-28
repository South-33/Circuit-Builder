import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CircuitConnection, CircuitPart } from '../circuit/types';
import { extractSchematicNets, getSchematicSymbolDef, resolveSchematicPinCoordinate } from './schematicSymbols';
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

  const schematicNets = useMemo(() => {
    return extractSchematicNets(parts, connections);
  }, [parts, connections]);

  // Compute smart default layout for components on the 1140x740 drawing area
  useEffect(() => {
    setPositions((prev) => {
      const next = { ...prev };
      let changed = false;

      let unoCount = 0;
      let inputCount = 0;
      let outputCount = 0;
      let otherCount = 0;

      for (const part of nonBreadboardParts) {
        if (!next[part.id]) {
          changed = true;
          if (part.type === 'wokwi-arduino-uno') {
            next[part.id] = { left: 460 + unoCount * 200, top: 180 + unoCount * 40 };
            unoCount++;
          } else if (
            part.type.includes('motor') ||
            part.type.includes('led') ||
            part.type.includes('buzzer') ||
            part.type.includes('relay')
          ) {
            next[part.id] = {
              left: 780 + (outputCount % 2) * 160,
              top: 100 + Math.floor(outputCount / 2) * 120,
            };
            outputCount++;
          } else if (
            part.type.includes('sensor') ||
            part.type.includes('button') ||
            part.type.includes('switch') ||
            part.type.includes('potentiometer') ||
            part.type.includes('keypad')
          ) {
            next[part.id] = {
              left: 140 + (inputCount % 2) * 140,
              top: 100 + Math.floor(inputCount / 2) * 110,
            };
            inputCount++;
          } else {
            next[part.id] = {
              left: 140 + (otherCount % 3) * 130,
              top: 480 + Math.floor(otherCount / 3) * 90,
            };
            otherCount++;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [nonBreadboardParts]);

  const currentDate = new Date().toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
  });

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
        left: Math.max(40, Math.min(1060, nextLeft)),
        top: Math.max(40, Math.min(680, nextTop)),
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
            {nonBreadboardParts.length} {nonBreadboardParts.length === 1 ? 'component' : 'components'} · {schematicNets.length} {schematicNets.length === 1 ? 'net' : 'nets'}
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

            {/* Red Engineering Outer & Inner Border */}
            <rect x="24" y="24" width="1152" height="752" fill="none" stroke="#e06c75" strokeWidth="1.8" />
            <rect x="32" y="32" width="1136" height="736" fill="none" stroke="#e06c75" strokeWidth="0.8" />

            {/* Coordinate grid labels 1-6 Top & Bottom */}
            {['1', '2', '3', '4', '5', '6'].map((num, i) => (
              <React.Fragment key={num}>
                <text x={32 + (i + 0.5) * (1136 / 6)} y="28" textAnchor="middle" fill="#e06c75" fontSize="10" fontWeight="bold" fontFamily="monospace">{num}</text>
                <text x={32 + (i + 0.5) * (1136 / 6)} y="774" textAnchor="middle" fill="#e06c75" fontSize="10" fontWeight="bold" fontFamily="monospace">{num}</text>
              </React.Fragment>
            ))}

            {/* Coordinate grid labels A-E Left & Right */}
            {['A', 'B', 'C', 'D', 'E'].map((letter, i) => (
              <React.Fragment key={letter}>
                <text x="18" y={32 + (i + 0.5) * (736 / 5)} textAnchor="middle" fill="#e06c75" fontSize="10" fontWeight="bold" fontFamily="monospace">{letter}</text>
                <text x="1182" y={32 + (i + 0.5) * (736 / 5)} textAnchor="middle" fill="#e06c75" fontSize="10" fontWeight="bold" fontFamily="monospace">{letter}</text>
              </React.Fragment>
            ))}

            {/* Title block (Bottom-right engineering block) */}
            <g transform="translate(868, 678)">
              <rect x="0" y="0" width="300" height="90" fill="#fff" stroke="#e06c75" strokeWidth="1.2" />
              <line x1="0" y1="30" x2="300" y2="30" stroke="#e06c75" strokeWidth="0.8" />
              <line x1="0" y1="60" x2="300" y2="60" stroke="#e06c75" strokeWidth="0.8" />
              <line x1="180" y1="60" x2="180" y2="90" stroke="#e06c75" strokeWidth="0.8" />
              <text x="10" y="20" fill="#c92a2a" fontSize="11" fontWeight="bold" fontFamily="sans-serif">Title: Circuit Schematic</text>
              <text x="10" y="48" fill="#555" fontSize="9.5" fontFamily="sans-serif">Date: {currentDate}</text>
              <text x="190" y="78" fill="#555" fontSize="9.5" fontFamily="sans-serif">Sheet: 1/1</text>
              <text x="10" y="78" fill="#888" fontSize="9.5" fontFamily="sans-serif">Made with Hardware Lab</text>
            </g>

            {/* Schematic Net Connections (Green wires) */}
            <g className="schematic-nets">
              {schematicNets.map((net) => {
                const fromPart = parts.find((p) => p.id === net.fromPartId);
                const toPart = parts.find((p) => p.id === net.toPartId);
                if (!fromPart || !toPart) return null;

                const fromPos = positions[fromPart.id] ?? { left: 100, top: 100 };
                const toPos = positions[toPart.id] ?? { left: 100, top: 100 };

                const start = resolveSchematicPinCoordinate(fromPart, net.fromPin, fromPos);
                const end = resolveSchematicPinCoordinate(toPart, net.toPin, toPos);

                const midX = Math.round((start.x + end.x) / 2);
                const path = `M ${start.x} ${start.y} L ${midX} ${start.y} L ${midX} ${end.y} L ${end.x} ${end.y}`;

                return (
                  <g key={net.id} className="schematic-net-wire">
                    <path
                      d={path}
                      fill="none"
                      stroke="#2f9e44"
                      strokeWidth="1.6"
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                    <circle cx={start.x} cy={start.y} r="3" fill="#2f9e44" />
                    <circle cx={end.x} cy={end.y} r="3" fill="#2f9e44" />
                  </g>
                );
              })}
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
