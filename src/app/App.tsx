import React, {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  getPartBounds,
  getPartPins,
  PART_DEFINITIONS,
  PART_ORDER,
  type PartCategory,
  type PartPropertyDefinition,
} from '../components/parts';
import { centerCircuitDocument, WORKSPACE_HEIGHT, WORKSPACE_WIDTH } from '../layout/placement';
import {
  addAlignmentPoints,
  collectWireAlignmentTargets,
  snapOrthogonalPoint,
  snapPointToTargets,
  type AlignmentGuide,
} from '../layout/alignment';
import { CIRCUIT_PRESETS } from '../circuit/presets';
import { diagnoseCircuit } from '../sim/diagnostics';
import { simulator } from '../sim/simulator';
import { circuitStore } from '../circuit/store';
import type { SnapMode } from '../breadboard/placement';
import { findNearestBreadboardPin, getBreadboardGeometry, isBreadboardType } from '../breadboard/geometry';
import { endpointPoint, partRect, pinExitDirection } from '../wires/geometry';
import { connectionPolyline, nearestPointOnPolyline, roundedPath, type WireAxis } from '../wires/path';
import type { CircuitConnection, CircuitPart, PartType, WirePoint } from '../circuit/types';
import { highlightArduinoCode } from './highlight';
import { ComponentsView, exportComponentsCsv } from './ComponentsView';
import { SchematicView } from './SchematicView';
import { NotesLayer, type CanvasNote } from './Notes';
import { BlocksWorkspace } from './BlocksWorkspace';

export type ViewMode = 'circuits' | 'schematic' | 'components';

const WIRE_COLORS = [
  { key: '0', name: 'Black', color: '#000000' },
  { key: '1', name: 'Brown', color: '#8b4513' },
  { key: '2', name: 'Red', color: '#e03131' },
  { key: '3', name: 'Orange', color: '#f76707' },
  { key: '4', name: 'Yellow', color: '#fcc419' },
  { key: '5', name: 'Green', color: '#2f9e44' },
  { key: '6', name: 'Blue', color: '#1971c2' },
  { key: '7', name: 'Purple', color: '#845ef7' },
  { key: '8', name: 'Gray', color: '#868e96' },
  { key: '9', name: 'White', color: '#f8f9fa' },
];
const DEFAULT_WIRE_COLOR = WIRE_COLORS[5].color;
const WIRE_COLOR_STORAGE_KEY = 'hardware-lab:wire-color';

function UndoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13" />
    </svg>
  );
}

function RotateIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function BomIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}

function FrameIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
    </svg>
  );
}

function CircuitsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
    </svg>
  );
}

function SchematicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h4l3-8 4 16 3-8h4" />
    </svg>
  );
}

function NoteIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="9" y1="12" x2="13" y2="12" />
    </svg>
  );
}

function ToggleNotesIcon({ visible }: { visible: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      {visible ? (
        <circle cx="12" cy="10" r="2.5" fill="currentColor" />
      ) : (
        <path d="M3 3l18 18" stroke="currentColor" strokeWidth="2" />
      )}
    </svg>
  );
}

function wireAxisForEndpoint(endpoint: string, parts: CircuitPart[]): WireAxis | undefined {
  const direction = pinExitDirection(endpoint, parts);
  if (direction === 'left' || direction === 'right') return 'horizontal';
  if (direction === 'up' || direction === 'down') return 'vertical';
  return undefined;
}

function WireColorTool({ color, onChange }: { color: string; onChange: (color: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="wire-color-tool" onPointerDown={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="wire-color-trigger"
        title="Wire color (0-9)"
        aria-label="Wire color"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="wire-color-line" style={{ background: color }} />
        <span className="wire-color-caret" aria-hidden="true" />
      </button>
      {open && (
        <div className="wire-color-menu">
          {WIRE_COLORS.map((option) => (
            <button
              type="button"
              key={option.color}
              className={option.color === color ? 'active' : ''}
              aria-label={`Use wire color ${option.name} (${option.key})`}
              onClick={() => { onChange(option.color); setOpen(false); }}
            >
              <span className="wire-color-chip" style={{ background: option.color }} />
              <span className="wire-color-name">{option.name}</span>
              <kbd className="wire-color-key">{option.key}</kbd>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type WireDraft = {
  from: string;
  waypoints: WirePoint[];
};

function useCircuit() {
  return useSyncExternalStore(circuitStore.subscribe, circuitStore.getSnapshot);
}

function PartElement({ part }: { part: CircuitPart }) {
  const definition = PART_DEFINITIONS[part.type];
  const elementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = elementRef.current as (HTMLElement & Record<string, unknown>) | null;
    if (!element) return;
    for (const [key, value] of Object.entries(part.attrs)) element[key] = value;
  }, [part.attrs]);

  const breadboard = getBreadboardGeometry(part.type);
  if (breadboard) {
    return (
      <img
        className="breadboard-visual"
        data-part-element={part.id}
        src={breadboard.asset}
        alt=""
        draggable={false}
        style={{
          width: definition.naturalSize.width * definition.renderScale,
          height: definition.naturalSize.height * definition.renderScale,
        }}
      />
    );
  }

  if (part.type === 'dc-motor') {
    return (
      <div
        className="dc-motor-visual"
        data-part-element={part.id}
        data-motor-direction="stopped"
        style={{
          width: definition.naturalSize.width * definition.renderScale,
          height: definition.naturalSize.height * definition.renderScale,
        }}
      >
        <img src="/assets/fritzing/dc-motor.svg" alt="" draggable={false} />
        <span className="dc-motor-shaft" />
      </div>
    );
  }

  if (definition.asset) {
    return (
      <img
        className="fritzing-part-visual"
        data-part-element={part.id}
        src={definition.asset}
        alt=""
        draggable={false}
        style={{
          width: definition.naturalSize.width * definition.renderScale,
          height: definition.naturalSize.height * definition.renderScale,
        }}
      />
    );
  }

  if (!definition.tag) return null;
  return createElement(definition.tag, {
    ...part.attrs,
    ref: (node: HTMLElement | null) => { elementRef.current = node; },
    'data-part-element': part.id,
    style: {
      transformOrigin: '0 0',
      transform: `scale(${definition.renderScale})`,
    },
  });
}

function PartPreview({ type }: { type: PartType }) {
  const definition = PART_DEFINITIONS[type];
  if (isBreadboardType(type)) {
    return <div className="mini-breadboard"><span /><span /><span /></div>;
  }
  if (type === 'dc-motor') {
    return <img className="dc-motor-preview" src="/assets/fritzing/dc-motor.svg" alt="" draggable={false} />;
  }
  if (definition.asset) {
    return (
      <img
        className={`fritzing-part-preview ${type}`}
        src={definition.asset}
        alt=""
        draggable={false}
      />
    );
  }
  if (!definition.tag) return null;
  const targetW = 66;
  const targetH = 52;
  const scale = Math.min(targetW / definition.naturalSize.width, targetH / definition.naturalSize.height) * 0.92;
  return (
    <div
      className="preview-scaler"
      style={{
        width: definition.naturalSize.width,
        height: definition.naturalSize.height,
        transform: `scale(${scale})`,
      }}
    >
      {createElement(definition.tag, {
        ...definition.defaults,
        style: { pointerEvents: 'none' },
      })}
    </div>
  );
}

const PartOnCanvas = React.memo(function PartOnCanvas({
  part,
  selected,
  focused,
  pendingWire,
  simulationRunning,
  onPinClick,
  onAlignmentGuidesChange,
  zoom = 1,
}: {
  part: CircuitPart;
  selected: boolean;
  focused: boolean;
  pendingWire: string | null;
  simulationRunning: boolean;
  onPinClick: (part: CircuitPart, pinName: string) => void;
  onAlignmentGuidesChange: (guides: AlignmentGuide[]) => void;
  zoom?: number;
}) {
  const isBreadboard = isBreadboardType(part.type);
  const definition = PART_DEFINITIONS[part.type];
  const bounds = useMemo(() => getPartBounds(part), [part.type]);
  const [hoverBreadboardPin, setHoverBreadboardPin] = useState<{ name: string; px: number; py: number; endpoint: string } | null>(null);

  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    left: number;
    top: number;
    latestLeft: number;
    latestTop: number;
    latestSnapMode: SnapMode;
    frame: number | null;
  } | null>(null);

  // Non-breadboard parts use normal pin buttons (2 to 30 pins total)
  const pinButtons = useMemo(() => {
    if (isBreadboard) return [];
    const scale = definition.renderScale;
    return getPartPins(part).map((pin) => ({
      name: pin.name,
      px: pin.x * scale,
      py: pin.y * scale,
      endpoint: `${part.id}:${pin.name}`,
    }));
  }, [part.type, part.id, definition.renderScale, isBreadboard]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (simulationRunning || event.button !== 0) return;
    if (isBreadboard && hoverBreadboardPin) {
      return;
    }
    event.stopPropagation();
    circuitStore.select(part.id);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: part.left,
      top: part.top,
      latestLeft: part.left,
      latestTop: part.top,
      latestSnapMode: 'normal',
      frame: null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      const left = Math.max(0, Math.min(WORKSPACE_WIDTH - 30, drag.left + (event.clientX - drag.startX) / zoom));
      const top = Math.max(0, Math.min(WORKSPACE_HEIGHT - 30, drag.top + (event.clientY - drag.startY) / zoom));
      const snapMode: SnapMode = event.shiftKey ? 'off' : (event.altKey || event.ctrlKey ? 'fine' : 'normal');
      drag.latestLeft = left;
      drag.latestTop = top;
      drag.latestSnapMode = snapMode;
      if (drag.frame === null) {
        drag.frame = requestAnimationFrame(() => {
          const current = dragRef.current;
          if (!current) return;
          current.frame = null;
          const placement = circuitStore.movePart(
            part.id,
            current.latestLeft,
            current.latestTop,
            false,
            current.latestSnapMode,
            6 / zoom,
          );
          onAlignmentGuidesChange(placement?.guides ?? []);
        });
      }
      return;
    }

    if (isBreadboard) {
      const rect = event.currentTarget.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dx = (event.clientX - centerX) / zoom;
      const dy = (event.clientY - centerY) / zoom;
      const deg = -(part.rotate ?? 0);
      const rad = (deg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const unrotDx = dx * cos - dy * sin;
      const unrotDy = dx * sin + dy * cos;
      const lx = bounds.width / 2 + unrotDx;
      const ly = bounds.height / 2 + unrotDy;

      const pin = findNearestBreadboardPin(lx, ly, part.type as 'breadboard' | 'breadboard-half', 16);
      if (pin) {
        setHoverBreadboardPin({
          name: pin.name,
          px: pin.x,
          py: pin.y,
          endpoint: `${part.id}:${pin.name}`,
        });
      } else if (hoverBreadboardPin) {
        setHoverBreadboardPin(null);
      }
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.frame !== null) cancelAnimationFrame(drag.frame);
    dragRef.current = null;
    circuitStore.movePart(part.id, drag.latestLeft, drag.latestTop, true, drag.latestSnapMode, 6 / zoom);
    onAlignmentGuidesChange([]);
  };

  const handlePointerLeave = () => {
    if (isBreadboard && hoverBreadboardPin) setHoverBreadboardPin(null);
  };

  return (
    <div
      className={`canvas-part${selected ? ' selected' : ''}${focused ? ' focused' : ''}${isBreadboard ? ' is-breadboard' : ''}`}
      data-part-id={part.id}
      style={{
        left: part.left,
        top: part.top,
        width: bounds.width,
        height: bounds.height,
        transform: part.rotate ? `rotate(${part.rotate}deg)` : undefined,
        transformOrigin: '50% 50%',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onDoubleClick={() => circuitStore.select(part.id)}
    >
      <div className="part-render"><PartElement part={part} /></div>
      <div className="part-pins">
        {pinButtons.map((pin) => (
          <button
            type="button"
            key={pin.name}
            className={`pin-hit${pendingWire === pin.endpoint ? ' pending' : ''}`}
            style={{ left: pin.px, top: pin.py }}
            data-label={pin.name}
            aria-label={`${part.id} pin ${pin.name}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onPinClick(part, pin.name);
            }}
          />
        ))}
        {isBreadboard && hoverBreadboardPin && (
          <button
            type="button"
            key={hoverBreadboardPin.name}
            className={`pin-hit hover${pendingWire === hoverBreadboardPin.endpoint ? ' pending' : ''}`}
            style={{ left: hoverBreadboardPin.px, top: hoverBreadboardPin.py }}
            data-label={hoverBreadboardPin.name}
            aria-label={`${part.id} pin ${hoverBreadboardPin.name}`}
            onPointerDown={(event) => {
              event.stopPropagation();
              onPinClick(part, hoverBreadboardPin.name);
            }}
          />
        )}
      </div>
    </div>
  );
});

function svgEventPoint(event: { clientX: number; clientY: number }, svg: SVGSVGElement): WirePoint {
  const ctm = svg.getScreenCTM();
  if (ctm) {
    const inverse = ctm.inverse();
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const world = pt.matrixTransform(inverse);
    return { x: world.x, y: world.y };
  }
  const rect = svg.getBoundingClientRect();
  const zoom = (rect.width / WORKSPACE_WIDTH) || 1;
  return {
    x: (event.clientX - rect.left) / zoom,
    y: (event.clientY - rect.top) / zoom,
  };
}

function WireWaypointHandle({
  wireId,
  index,
  point,
  disabled,
  parts,
  connections,
  zoom,
  onAlignmentGuidesChange,
}: {
  wireId: string;
  index: number;
  point: WirePoint;
  disabled: boolean;
  parts: CircuitPart[];
  connections: CircuitConnection[];
  zoom: number;
  onAlignmentGuidesChange: (guides: AlignmentGuide[]) => void;
}) {
  const dragRef = useRef<{
    pointerId: number;
    targets: ReturnType<typeof collectWireAlignmentTargets>;
  } | null>(null);

  return (
    <circle
      className="wire-waypoint"
      cx={point.x}
      cy={point.y}
      r={5}
      onPointerDown={(event) => {
        if (disabled) return;
        event.stopPropagation();
        dragRef.current = {
          pointerId: event.pointerId,
          targets: collectWireAlignmentTargets(parts, connections, wireId, index),
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (disabled || dragRef.current?.pointerId !== event.pointerId) return;
        const svg = event.currentTarget.ownerSVGElement;
        if (!svg) return;
        const snapped = snapPointToTargets(svgEventPoint(event, svg), dragRef.current.targets, 6 / zoom);
        const nextPoint = snapped.point;
        onAlignmentGuidesChange(snapped.guides);
        const connection = circuitStore.getSnapshot().connections.find((candidate) => candidate.id === wireId);
        if (!connection) return;
        const waypoints = [...(connection.waypoints ?? [])];
        if (index >= waypoints.length) return;
        waypoints[index] = nextPoint;
        circuitStore.previewConnectionWaypoints(wireId, waypoints);
      }}
      onPointerUp={(event) => {
        if (disabled || dragRef.current?.pointerId !== event.pointerId) return;
        dragRef.current = null;
        const connection = circuitStore.getSnapshot().connections.find((candidate) => candidate.id === wireId);
        if (connection) circuitStore.setConnectionWaypoints(wireId, connection.waypoints ?? [], true);
        onAlignmentGuidesChange([]);
      }}
      onPointerCancel={() => {
        dragRef.current = null;
        onAlignmentGuidesChange([]);
      }}
    />
  );
}

type WireEndpointTarget = { endpoint: string; point: WirePoint };

function collectWireEndpointTargets(parts: CircuitPart[], excludedEndpoint: string) {
  const targets: WireEndpointTarget[] = [];
  for (const part of parts) {
    for (const pin of getPartPins(part)) {
      const endpoint = `${part.id}:${pin.name}`;
      if (endpoint === excludedEndpoint) continue;
      const point = endpointPoint(endpoint, parts);
      if (point) targets.push({ endpoint, point });
    }
  }
  return targets;
}

function nearestWireEndpointTarget(point: WirePoint, targets: WireEndpointTarget[], maxDistance: number) {
  let best: WireEndpointTarget | null = null;
  let bestDistance = maxDistance;
  for (const target of targets) {
    const distance = Math.hypot(target.point.x - point.x, target.point.y - point.y);
    if (distance <= bestDistance) {
      best = target;
      bestDistance = distance;
    }
  }
  return best;
}

function WireEndpointHandle({
  wireId,
  side,
  endpoint,
  point,
  anchor,
  otherEndpoint,
  disabled,
  parts,
  zoom,
}: {
  wireId: string;
  side: 'from' | 'to';
  endpoint: string;
  point: WirePoint;
  anchor: WirePoint;
  otherEndpoint: string;
  disabled: boolean;
  parts: CircuitPart[];
  zoom: number;
}) {
  const dragRef = useRef<{ pointerId: number; targets: WireEndpointTarget[] } | null>(null);
  const [dragPoint, setDragPoint] = useState<WirePoint | null>(null);
  const [snapTarget, setSnapTarget] = useState<WireEndpointTarget | null>(null);
  const shownPoint = dragPoint ?? point;

  const clearDrag = () => {
    dragRef.current = null;
    setDragPoint(null);
    setSnapTarget(null);
  };

  return (
    <>
      {dragPoint && (
        <line
          className="wire-rewire-preview"
          x1={anchor.x}
          y1={anchor.y}
          x2={shownPoint.x}
          y2={shownPoint.y}
        />
      )}
      {snapTarget && dragPoint && (
        <circle className="wire-rewire-target" cx={snapTarget.point.x} cy={snapTarget.point.y} r={8} />
      )}
      <circle
        className={`wire-endpoint ${side === 'from' ? 'source' : 'destination'}${dragPoint ? ' dragging' : ''}${disabled ? ' disabled' : ''}`}
        cx={shownPoint.x}
        cy={shownPoint.y}
        r={5}
        onPointerDown={(event) => {
          if (disabled || event.button !== 0) return;
          event.stopPropagation();
          circuitStore.select(wireId);
          dragRef.current = {
            pointerId: event.pointerId,
            targets: collectWireEndpointTargets(parts, otherEndpoint),
          };
          setDragPoint(point);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (disabled || drag?.pointerId !== event.pointerId) return;
          const svg = event.currentTarget.ownerSVGElement;
          if (!svg) return;
          const raw = svgEventPoint(event, svg);
          const target = nearestWireEndpointTarget(raw, drag.targets, 12 / zoom);
          setSnapTarget(target);
          setDragPoint(target?.point ?? raw);
        }}
        onPointerUp={(event) => {
          const drag = dragRef.current;
          if (disabled || drag?.pointerId !== event.pointerId) return;
          const target = snapTarget;
          clearDrag();
          if (target && target.endpoint !== endpoint) {
            try {
              circuitStore.setConnectionEndpoint(wireId, side, target.endpoint);
            } catch {
              // Invalid/duplicate drops simply leave the existing connection intact.
            }
          }
        }}
        onPointerCancel={clearDrag}
      >
        <title>{side === 'from' ? 'Drag to rewire start' : 'Drag to rewire end'}</title>
      </circle>
    </>
  );
}

function Wires({
  connections,
  parts,
  selectedId,
  focusedIds,
  draft,
  pointer,
  editingDisabled,
  draftColor,
  alignmentGuides,
  zoom,
  onAlignmentGuidesChange,
}: {
  connections: CircuitConnection[];
  parts: CircuitPart[];
  selectedId: string | null;
  focusedIds: Set<string>;
  draft: WireDraft | null;
  pointer: WirePoint | null;
  editingDisabled: boolean;
  draftColor: string;
  alignmentGuides: AlignmentGuide[];
  zoom: number;
  onAlignmentGuidesChange: (guides: AlignmentGuide[]) => void;
}) {
  return (
    <svg className="wire-layer" width={WORKSPACE_WIDTH} height={WORKSPACE_HEIGHT}>
      {alignmentGuides.map((guide, index) => guide.axis === 'x' ? (
        <line
          key={`alignment-x-${index}`}
          className="alignment-guide"
          x1={guide.value}
          y1={0}
          x2={guide.value}
          y2={WORKSPACE_HEIGHT}
        />
      ) : (
        <line
          key={`alignment-y-${index}`}
          className="alignment-guide"
          x1={0}
          y1={guide.value}
          x2={WORKSPACE_WIDTH}
          y2={guide.value}
        />
      ))}
      {connections.map((connection) => {
        const from = endpointPoint(connection.from, parts);
        const to = endpointPoint(connection.to, parts);
        if (!from || !to) return null;
        const points = connectionPolyline(from, connection.waypoints, to, wireAxisForEndpoint(connection.from, parts));
        const path = roundedPath(points);
        const active = selectedId === connection.id;
        const focused = focusedIds.has(connection.id);
        return (
          <g key={connection.id}>
            <path
              className="wire-hit"
              d={path}
              onClick={(event) => {
                event.stopPropagation();
                circuitStore.select(connection.id);
              }}
              onDoubleClick={(event) => {
                if (editingDisabled) return;
                event.stopPropagation();
                const svg = event.currentTarget.ownerSVGElement;
                if (!svg) return;
                const nearest = nearestPointOnPolyline(points, svgEventPoint(event, svg));
                if (!nearest) return;
                const waypoints = [...(connection.waypoints ?? [])];
                waypoints.splice(nearest.segmentIndex, 0, nearest.point);
                circuitStore.setConnectionWaypoints(connection.id, waypoints, true);
              }}
            />
            <path
              className={`wire-path${active ? ' selected' : ''}${focused ? ' focused' : ''}`}
              d={path}
              stroke={connection.color}
            />
            {active && (connection.waypoints ?? []).map((waypoint, index) => (
              <WireWaypointHandle
                key={`${connection.id}-${index}`}
                wireId={connection.id}
                index={index}
                point={waypoint}
                disabled={editingDisabled}
                parts={parts}
                connections={connections}
                zoom={zoom}
                onAlignmentGuidesChange={onAlignmentGuidesChange}
              />
            ))}
            {active && (
              <>
                <WireEndpointHandle
                  wireId={connection.id}
                  side="from"
                  endpoint={connection.from}
                  point={from}
                  anchor={points[1] ?? to}
                  otherEndpoint={connection.to}
                  disabled={editingDisabled}
                  parts={parts}
                  zoom={zoom}
                />
                <WireEndpointHandle
                  wireId={connection.id}
                  side="to"
                  endpoint={connection.to}
                  point={to}
                  anchor={points.at(-2) ?? from}
                  otherEndpoint={connection.from}
                  disabled={editingDisabled}
                  parts={parts}
                  zoom={zoom}
                />
              </>
            )}
          </g>
        );
      })}
      {draft && pointer && (() => {
        const start = endpointPoint(draft.from, parts);
        if (!start) return null;
        const points = connectionPolyline(start, draft.waypoints, pointer, wireAxisForEndpoint(draft.from, parts));
        return (
          <g className="wire-draft">
            <path className="wire-preview" d={roundedPath(points)} stroke={draftColor} />
            {draft.waypoints.map((waypoint, index) => (
              <circle key={index} className="wire-preview-point" cx={waypoint.x} cy={waypoint.y} r={3.5} />
            ))}
          </g>
        );
      })()}
    </svg>
  );
}

function SidePanelHeader({
  activeTab,
  onTabChange,
  onToggleCollapse,
}: {
  activeTab: 'components' | 'code';
  onTabChange?: (tab: 'components' | 'code') => void;
  onToggleCollapse?: () => void;
}) {
  return (
    <div className="panel-heading">
      <div className="side-panel-switch">
        <button
          type="button"
          className={`side-switch-btn${activeTab === 'components' ? ' active' : ''}`}
          onClick={() => onTabChange?.('components')}
          aria-label="Components"
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
          <span>Components</span>
        </button>
        <button
          type="button"
          className={`side-switch-btn${activeTab === 'code' ? ' active' : ''}`}
          onClick={() => onTabChange?.('code')}
          aria-label="Code"
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
          <span>Code</span>
        </button>
      </div>
      {onToggleCollapse && (
        <button
          type="button"
          className="panel-toggle-close"
          onClick={onToggleCollapse}
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
        >
          ›
        </button>
      )}
    </div>
  );
}

function ComponentTray({
  onAdd,
  width,
  onResizeStart,
  onToggleCollapse,
  onTabChange,
}: {
  onAdd: (type: PartType) => void;
  width?: number;
  onResizeStart?: (e: React.PointerEvent) => void;
  onToggleCollapse?: () => void;
  onTabChange?: (tab: 'components' | 'code') => void;
}) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<'All' | PartCategory>('All');
  const [categoryOpen, setCategoryOpen] = useState(false);
  const categories: Array<'All' | PartCategory> = ['All', 'Basic', 'Input', 'Output', 'Sensors', 'Motion', 'Boards', 'Layout'];
  const query = search.trim().toLowerCase();
  const filtered = PART_ORDER.filter((type) => {
    const definition = PART_DEFINITIONS[type];
    if (category !== 'All' && definition.category !== category) return false;
    if (!query) return true;
    return [definition.name, definition.category, ...(definition.keywords ?? [])]
      .some((value) => value.toLowerCase().includes(query));
  });

  return (
    <aside className="side-panel components-panel" style={{ width: width ? `${width}px` : undefined }}>
      {onResizeStart && <div className="panel-resize-handle" onPointerDown={onResizeStart} title="Drag to resize panel" />}
      <SidePanelHeader
        activeTab="components"
        onTabChange={onTabChange}
        onToggleCollapse={onToggleCollapse}
      />
      <div className="category-dropdown-wrap">
        <button
          type="button"
          className="category-dropdown-trigger"
          onClick={() => setCategoryOpen(!categoryOpen)}
          aria-label="Filter components by category"
        >
          <span>{category}</span>
          <span className={`category-caret${categoryOpen ? ' open' : ''}`} />
        </button>
        {categoryOpen && (
          <div className="category-dropdown-menu">
            {categories.map((val) => (
              <button
                type="button"
                key={val}
                className={category === val ? 'active' : ''}
                onClick={() => {
                  setCategory(val);
                  setCategoryOpen(false);
                }}
              >
                <span>{val}</span>
                {category === val && <span className="check-mark">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="component-search-wrap">
        <span className="search-icon">⌕</span>
        <input
          className="component-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search components..."
          aria-label="Search components"
        />
      </div>
      <div className="component-grid">
        {filtered.map((type) => (
          <button
            className="component-card"
            type="button"
            key={type}
            onClick={() => onAdd(type)}
            title={PART_DEFINITIONS[type].name}
          >
            <span className="component-preview"><PartPreview type={type} /></span>
            <span className="component-card-name">{PART_DEFINITIONS[type].name}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function CodePanel({
  board,
  draft,
  setDraft,
  width,
  onResizeStart,
  onToggleCollapse,
  onTabChange,
  onAddPart,
}: {
  board: CircuitPart | undefined;
  draft: string;
  setDraft: (code: string) => void;
  width?: number;
  onResizeStart?: (e: React.PointerEvent) => void;
  onToggleCollapse?: () => void;
  onTabChange?: (tab: 'components' | 'code') => void;
  onAddPart?: (type: PartType) => void;
}) {
  const state = useCircuit();
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [codeMode, setCodeMode] = useState<'Blocks' | 'Blocks + Text' | 'Text'>('Text');
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [fontSize, setFontSize] = useState<'11px' | '12.5px' | '14px'>('12.5px');
  const [fontMenuOpen, setFontMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);
  const lines = draft.split('\n');
  const focusCode = state.focus?.code;
  const codeFocus = focusCode?.boardId === board?.id ? focusCode : undefined;
  const lineHeight = fontSize === '14px' ? 22 : fontSize === '11px' ? 18 : 20;

  const downloadIno = () => {
    const blob = new Blob([draft], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${board?.id ?? 'sketch'}.ino`;
    link.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (!codeFocus || !textareaRef.current) return;
    const targetTop = Math.max(0, (codeFocus.startLine - 3) * lineHeight);
    textareaRef.current.scrollTo({ top: targetTop, behavior: 'smooth' });
  }, [codeFocus, lineHeight]);

  const handleScroll = (event: React.UIEvent<HTMLTextAreaElement>) => {
    const top = event.currentTarget.scrollTop;
    const left = event.currentTarget.scrollLeft;
    setScrollTop(top);
    setScrollLeft(left);
    if (preRef.current) {
      preRef.current.scrollTop = top;
      preRef.current.scrollLeft = left;
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      const textarea = event.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const val = textarea.value;
      const next = val.substring(0, start) + '  ' + val.substring(end);
      setDraft(next);
      requestAnimationFrame(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      });
    }
  };

  if (!board) {
    return (
      <aside className="side-panel code-panel empty-code-panel" style={{ width: width ? `${width}px` : undefined }}>
        {onResizeStart && <div className="panel-resize-handle" onPointerDown={onResizeStart} title="Drag to resize panel" />}
        <SidePanelHeader
          activeTab="code"
          onTabChange={onTabChange}
          onToggleCollapse={onToggleCollapse}
        />
        <div className="code-panel-top">
          <div className="code-topbar-right">
            <div className="code-device-dropdown disabled">
              <span>None</span>
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
          </div>
        </div>
        <div className="code-empty-message">
          No programmable components in this circuit
        </div>
      </aside>
    );
  }

  return (
    <aside className="side-panel code-panel" style={{ width: width ? `${width}px` : undefined }}>
      {onResizeStart && <div className="panel-resize-handle" onPointerDown={onResizeStart} title="Drag to resize panel" />}
      <SidePanelHeader
        activeTab="code"
        onTabChange={onTabChange}
        onToggleCollapse={onToggleCollapse}
      />
      <div className="code-panel-top">
        <div className="code-topbar-left">
          {/* Mode Dropdown (Blocks / Blocks + Text / Text) */}
          <div className="code-mode-dropdown-wrap">
            <button
              type="button"
              className="code-mode-btn"
              onClick={() => setModeMenuOpen(!modeMenuOpen)}
              aria-label="Code Editor Mode"
            >
              <span>{codeMode}</span>
              <span className={`dropdown-caret${modeMenuOpen ? ' open' : ''}`} />
            </button>
            {modeMenuOpen && (
              <div className="code-mode-menu">
                <div className="menu-header-label">EDIT MODE</div>
                {(['Blocks', 'Blocks + Text', 'Text'] as const).map((m) => (
                  <button
                    type="button"
                    key={m}
                    className={codeMode === m ? 'active' : ''}
                    onClick={() => { setCodeMode(m); setModeMenuOpen(false); }}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Download sketch button */}
          <button type="button" className="code-tool-btn" onClick={downloadIno} title="Download .ino sketch" aria-label="Download sketch">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>

          {/* Library button */}
          <button type="button" className="code-tool-btn" title="Include Libraries" aria-label="Include Libraries">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/><path d="M6 6h10M6 10h10"/></svg>
          </button>

          {/* Font Size Adjuster (A A) */}
          <div className="code-font-dropdown-wrap">
            <button
              type="button"
              className="code-tool-btn font-btn"
              onClick={() => setFontMenuOpen(!fontMenuOpen)}
              title="Font size"
              aria-label="Font size"
            >
              <span className="font-icon-label">A<span style={{ fontSize: '13px' }}>A</span></span>
              <span className={`dropdown-caret${fontMenuOpen ? ' open' : ''}`} />
            </button>
            {fontMenuOpen && (
              <div className="code-font-menu">
                <button type="button" className={fontSize === '11px' ? 'active' : ''} onClick={() => { setFontSize('11px'); setFontMenuOpen(false); }}>Small</button>
                <button type="button" className={fontSize === '12.5px' ? 'active' : ''} onClick={() => { setFontSize('12.5px'); setFontMenuOpen(false); }}>Medium</button>
                <button type="button" className={fontSize === '14px' ? 'active' : ''} onClick={() => { setFontSize('14px'); setFontMenuOpen(false); }}>Large</button>
              </div>
            )}
          </div>
        </div>

        <div className="code-topbar-right">
          <div className="board-selector-pill">
            <span>{board.id} ({PART_DEFINITIONS[board.type]?.name ?? 'Arduino Uno'})</span>
          </div>
          {onToggleCollapse && (
            <button type="button" className="panel-toggle-close" onClick={onToggleCollapse} title="Collapse sidebar" aria-label="Collapse sidebar">
              ›
            </button>
          )}
        </div>
      </div>

      {codeMode === 'Blocks' ? (
        <BlocksWorkspace />
      ) : codeMode === 'Blocks + Text' ? (
        <div className="split-code-container">
          <div className="split-blocks-side">
            <BlocksWorkspace />
          </div>
          <div className="split-text-side">
            <div className="editor-shell">
              <div className="line-numbers" style={{ transform: `translateY(${-scrollTop}px)`, fontSize, lineHeight: `${lineHeight}px` }}>
                {lines.map((_, index) => {
                  const line = index + 1;
                  const active = codeFocus && line >= codeFocus.startLine && line <= codeFocus.endLine;
                  return <div key={line} className={active ? 'focused-line-number' : ''}>{line}</div>;
                })}
              </div>
              {codeFocus && (
                <div
                  className="code-focus-band"
                  style={{
                    top: (codeFocus.startLine - 1) * lineHeight - scrollTop,
                    height: (codeFocus.endLine - codeFocus.startLine + 1) * lineHeight,
                  }}
                />
              )}
              <pre
                ref={preRef}
                className="code-highlight"
                aria-hidden="true"
                style={{ transform: `translate(${-scrollLeft}px, ${-scrollTop}px)`, fontSize, lineHeight: `${lineHeight}px` }}
                dangerouslySetInnerHTML={{ __html: highlightArduinoCode(draft) + '\n' }}
              />
              <textarea
                ref={textareaRef}
                className="code-editor"
                spellCheck={false}
                style={{ fontSize, lineHeight: `${lineHeight}px` }}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onScroll={handleScroll}
                onKeyDown={handleKeyDown}
                onBlur={() => {
                  if (board.code !== draft) circuitStore.setCode(board.id, draft);
                }}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="editor-shell">
          <div className="line-numbers" style={{ transform: `translateY(${-scrollTop}px)`, fontSize, lineHeight: `${lineHeight}px` }}>
            {lines.map((_, index) => {
              const line = index + 1;
              const active = codeFocus && line >= codeFocus.startLine && line <= codeFocus.endLine;
              return <div key={line} className={active ? 'focused-line-number' : ''}>{line}</div>;
            })}
          </div>
          {codeFocus && (
            <div
              className="code-focus-band"
              style={{
                top: (codeFocus.startLine - 1) * lineHeight - scrollTop,
                height: (codeFocus.endLine - codeFocus.startLine + 1) * lineHeight,
              }}
            />
          )}
          <pre
            ref={preRef}
            className="code-highlight"
            aria-hidden="true"
            style={{ transform: `translate(${-scrollLeft}px, ${-scrollTop}px)`, fontSize, lineHeight: `${lineHeight}px` }}
            dangerouslySetInnerHTML={{ __html: highlightArduinoCode(draft) + '\n' }}
          />
          <textarea
            ref={textareaRef}
            className="code-editor"
            spellCheck={false}
            style={{ fontSize, lineHeight: `${lineHeight}px` }}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onScroll={handleScroll}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (board.code !== draft) circuitStore.setCode(board.id, draft);
            }}
          />
        </div>
      )}

      <div className="serial-monitor">
        <div className="serial-title">Serial Monitor</div>
        <pre>{state.simulation.serialOutput || ' '}</pre>
      </div>
    </aside>
  );
}

function PartPropertyControl({ part, property }: { part: CircuitPart; property: PartPropertyDefinition }) {
  const definition = PART_DEFINITIONS[part.type];
  const current = part.attrs[property.key] ?? definition.defaults[property.key];
  const update = (value: string | number | boolean) => circuitStore.setPartAttrs(part.id, { [property.key]: value });

  if (property.kind === 'toggle') {
    return (
      <label className="property-toggle">
        <span>{property.label}</span>
        <input
          type="checkbox"
          checked={Boolean(current)}
          onChange={(event) => update(event.target.checked)}
        />
      </label>
    );
  }

  if (property.kind === 'select') {
    return (
      <label className="property-field">
        <span>{property.label}</span>
        <select
          value={String(current ?? '')}
          onChange={(event) => {
            const option = property.options?.find((candidate) => String(candidate.value) === event.target.value);
            update(option?.value ?? event.target.value);
          }}
        >
          {(property.options ?? []).map((option) => (
            <option key={String(option.value)} value={String(option.value)}>{option.label}</option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <label className="property-field">
      <span>{property.label}</span>
      <span className="property-number-wrap">
        <input
          type="number"
          value={String(current ?? '')}
          min={property.min}
          max={property.max}
          step={property.step}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isFinite(value)) update(value);
          }}
        />
        {property.unit && <small>{property.unit}</small>}
      </span>
    </label>
  );
}

function InspectorCard({ selectedId }: { selectedId: string | null }) {
  const state = useCircuit();
  if (!selectedId) return null;
  const part = state.parts.find((candidate) => candidate.id === selectedId);
  const wire = state.connections.find((candidate) => candidate.id === selectedId);
  if (!part && !wire) return null;

  const definition = part ? PART_DEFINITIONS[part.type] : null;

  return (
    <div className="inspector-card" onPointerDown={(event) => event.stopPropagation()}>
      <div className="inspector-header">
        <span className="inspector-title">{part ? definition?.name : 'Wire'}</span>
        <button type="button" className="inspector-help-btn" title="Component Help">?</button>
      </div>
      <div className="inspector-body">
        {part && (
          <div className="inspector-row">
            <span className="inspector-badge">Name</span>
            <input
              type="text"
              className="inspector-input"
              value={part.id}
              readOnly
            />
          </div>
        )}
        {part && definition && definition.properties?.map((property) => {
          const current = part.attrs[property.key] ?? definition.defaults[property.key];
          const update = (value: string | number | boolean) =>
            circuitStore.setPartAttrs(part.id, { [property.key]: value });

          if (property.kind === 'select') {
            return (
              <div key={property.key} className="inspector-row">
                <span className="inspector-badge">{property.label}</span>
                <select
                  className="inspector-select"
                  value={String(current ?? '')}
                  onChange={(e) => {
                    const option = property.options?.find((opt) => String(opt.value) === e.target.value);
                    update(option?.value ?? e.target.value);
                  }}
                >
                  {(property.options ?? []).map((opt) => (
                    <option key={String(opt.value)} value={String(opt.value)}>{opt.label}</option>
                  ))}
                </select>
              </div>
            );
          }

          if (property.kind === 'toggle') {
            return (
              <div key={property.key} className="inspector-row">
                <span className="inspector-badge">{property.label}</span>
                <label className="inspector-toggle">
                  <input
                    type="checkbox"
                    checked={Boolean(current)}
                    onChange={(e) => update(e.target.checked)}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>
            );
          }

          return (
            <div key={property.key} className="inspector-row">
              <span className="inspector-badge">{property.label}</span>
              <input
                type="text"
                className="inspector-input number-input"
                value={String(current ?? '')}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isFinite(val)) update(val);
                  else if (e.target.value === '') update(0);
                }}
              />
              {property.unit && (
                <span className="inspector-unit">{property.unit}</span>
              )}
            </div>
          );
        })}
        {wire && (
          <div className="inspector-row">
            <span className="inspector-badge">Color</span>
            <div className="inspector-input" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: '50%', background: wire.color, border: '1px solid rgba(0,0,0,0.15)' }} />
              <span style={{ fontSize: 12, color: '#333' }}>{wire.color}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Diagnostics({ open, setOpen }: { open: boolean; setOpen: (open: boolean) => void }) {
  const state = useCircuit();
  const diagnostics = useMemo(() => diagnoseCircuit(state), [state.parts, state.connections]);
  if (diagnostics.length === 0) return null;
  const errors = diagnostics.filter((item) => item.severity === 'error').length;

  return (
    <div className="diagnostics-wrap">
      {open && (
        <div className="diagnostics-panel">
          {diagnostics.map((diagnostic, index) => (
            <button
              type="button"
              key={`${diagnostic.message}-${index}`}
              className={`diagnostic-row ${diagnostic.severity}`}
              onClick={() => circuitStore.focus({
                itemIds: diagnostic.itemIds,
                message: diagnostic.message,
              }, 8500)}
            >
              <span>{diagnostic.severity === 'error' ? '!' : 'i'}</span>
              <p>{diagnostic.message}</p>
            </button>
          ))}
        </div>
      )}
      <button type="button" className={`diagnostics-chip${errors ? ' has-error' : ''}`} onClick={() => setOpen(!open)}>
        <span>{errors ? '!' : 'i'}</span>
        {diagnostics.length} {diagnostics.length === 1 ? 'issue' : 'issues'}
      </button>
    </div>
  );
}

function BomModal({ onClose }: { onClose: () => void }) {
  const state = useCircuit();
  const bomRows = useMemo(() => {
    const counts = new Map<string, { type: PartType; count: number; name: string }>();
    for (const part of state.parts) {
      const def = PART_DEFINITIONS[part.type];
      const existing = counts.get(part.type) ?? { type: part.type, count: 0, name: def.name };
      existing.count += 1;
      counts.set(part.type, existing);
    }
    return Array.from(counts.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [state.parts]);

  const downloadCsv = () => {
    const header = 'Component,Quantity,Part Type\n';
    const lines = bomRows.map((r) => `"${r.name}",${r.count},"${r.type}"`).join('\n');
    const blob = new Blob([header + lines], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'circuit-components.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="bom-modal" onClick={(e) => e.stopPropagation()}>
        <div className="bom-modal-header">
          <h3>Component List ({state.parts.length} total)</h3>
          <button type="button" className="icon-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="bom-table-wrap">
          {bomRows.length === 0 ? (
            <p className="bom-empty">No components in the circuit yet.</p>
          ) : (
            <table className="bom-table">
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Quantity</th>
                  <th>Type ID</th>
                </tr>
              </thead>
              <tbody>
                {bomRows.map((row) => (
                  <tr key={row.type}>
                    <td><strong>{row.name}</strong></td>
                    <td>{row.count}</td>
                    <td><code>{row.type}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="bom-modal-footer">
          {bomRows.length > 0 && (
            <button type="button" className="bom-export-btn" onClick={downloadCsv}>
              Export CSV
            </button>
          )}
          <button type="button" className="bom-close-btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const state = useCircuit();
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('circuits');
  const [sidePanelTab, setSidePanelTab] = useState<'components' | 'code'>('components');
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [canvasPan, setCanvasPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [schematicZoom, setSchematicZoom] = useState(1);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [bomOpen, setBomOpen] = useState(false);
  const [wireDraft, setWireDraft] = useState<WireDraft | null>(null);
  const [wirePointer, setWirePointer] = useState<WirePoint | null>(null);
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([]);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [notes, setNotes] = useState<CanvasNote[]>([]);
  const [notesVisible, setNotesVisible] = useState(true);
  const [panelWidth, setPanelWidth] = useState(380);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; startPanX: number; startPanY: number } | null>(null);
  const [activeWireColor, setActiveWireColor] = useState(() => {
    try { return localStorage.getItem(WIRE_COLOR_STORAGE_KEY) || DEFAULT_WIRE_COLOR; } catch { return DEFAULT_WIRE_COLOR; }
  });
  const focusedIds = useMemo(() => new Set(state.focus?.itemIds ?? []), [state.focus]);
  const focusedBoardId = state.focus?.code?.boardId;
  const selectedBoard = state.parts.find((part) => part.id === state.selectedId && part.type === 'wokwi-arduino-uno');
  const board = state.parts.find((part) => part.id === focusedBoardId)
    ?? selectedBoard
    ?? state.parts.find((part) => part.type === 'wokwi-arduino-uno');
  const [draft, setDraft] = useState(board?.code ?? '');
  const selectedPart = state.parts.find((part) => part.id === state.selectedId);
  const selectedWire = state.connections.find((connection) => connection.id === state.selectedId);
  const shownWireColor = selectedWire?.color ?? activeWireColor;

  const chooseWireColor = useCallback((color: string) => {
    setActiveWireColor(color);
    try { localStorage.setItem(WIRE_COLOR_STORAGE_KEY, color); } catch { /* ignore storage failures */ }
    const selected = circuitStore.getSnapshot().connections.find((connection) => connection.id === circuitStore.getSnapshot().selectedId);
    if (selected) circuitStore.setConnectionColor(selected.id, color);
  }, []);

  const addNote = useCallback(() => {
    const canvas = canvasRef.current;
    let noteX = WORKSPACE_WIDTH / 2 - 100;
    let noteY = WORKSPACE_HEIGHT / 2 - 60;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const screenCenterX = rect.width / 2;
      const screenCenterY = rect.height / 2;
      noteX = (screenCenterX - canvasPan.x) / canvasZoom - 100;
      noteY = (screenCenterY - canvasPan.y) / canvasZoom - 60;
    }
    const newNote: CanvasNote = {
      id: `note_${Date.now()}`,
      x: Math.round(noteX / 10) * 10,
      y: Math.round(noteY / 10) * 10,
      text: 'Write your note here.',
      collapsed: false,
    };
    setNotes((prev) => [...prev, newNote]);
    setNotesVisible(true);
  }, [canvasPan, canvasZoom]);

  const updateNote = useCallback((id: string, partial: Partial<CanvasNote>) => {
    setNotes((prev) => prev.map((n) => n.id === id ? { ...n, ...partial } : n));
  }, []);

  const deleteNote = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = panelWidth;
    const handlePointerMove = (moveEvent: PointerEvent) => {
      const delta = startX - moveEvent.clientX;
      const nextW = Math.max(280, Math.min(800, startW + delta));
      setPanelWidth(nextW);
    };
    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }, [panelWidth]);

  useEffect(() => {
    setDraft(board?.code ?? '');
  }, [board?.id, board?.code]);

  useEffect(() => {
    if (state.focus?.code) {
      setSidePanelTab('code');
      setSidebarCollapsed(false);
    }
  }, [state.focus?.code]);

  const cameraRef = useRef({ pan: canvasPan, zoom: canvasZoom });
  useEffect(() => {
    cameraRef.current = { pan: canvasPan, zoom: canvasZoom };
  }, [canvasPan, canvasZoom]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || canvas.clientWidth;
    const h = rect.height || canvas.clientHeight;
    if (w > 0 && h > 0) {
      const initialPan = {
        x: Math.round(w / 2 - (WORKSPACE_WIDTH / 2) * canvasZoom),
        y: Math.round(h / 2 - (WORKSPACE_HEIGHT / 2) * canvasZoom),
      };
      setCanvasPan(initialPan);
      cameraRef.current = { pan: initialPan, zoom: canvasZoom };
    }
  }, [viewMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleNativeWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const rect = canvas.getBoundingClientRect();
      const screenX = event.clientX - rect.left;
      const screenY = event.clientY - rect.top;
      const { pan, zoom } = cameraRef.current;

      if (event.ctrlKey || event.metaKey) {
        // Touchpad pinch-to-zoom or Ctrl + mouse wheel
        const worldX = (screenX - pan.x) / zoom;
        const worldY = (screenY - pan.y) / zoom;

        // Smooth continuous exponential zoom for touchpad pinch
        const zoomDelta = -event.deltaY * 0.006;
        const factor = Math.exp(Math.max(-0.25, Math.min(0.25, zoomDelta)));
        const nextZoom = Math.max(0.25, Math.min(3.5, zoom * factor));

        const nextPan = {
          x: screenX - worldX * nextZoom,
          y: screenY - worldY * nextZoom,
        };

        setCanvasZoom(nextZoom);
        setCanvasPan(nextPan);
        cameraRef.current = { pan: nextPan, zoom: nextZoom };
        return;
      }

      // Two-finger trackpad swipe or mouse wheel pan
      const nextPan = {
        x: pan.x - event.deltaX,
        y: pan.y - event.deltaY,
      };
      setCanvasPan(nextPan);
      cameraRef.current = { pan: nextPan, zoom };
    };

    const handleGesture = (event: Event) => {
      event.preventDefault();
    };

    canvas.addEventListener('wheel', handleNativeWheel, { passive: false });
    canvas.addEventListener('gesturestart', handleGesture, { passive: false });
    canvas.addEventListener('gesturechange', handleGesture, { passive: false });
    canvas.addEventListener('gestureend', handleGesture, { passive: false });

    return () => {
      canvas.removeEventListener('wheel', handleNativeWheel);
      canvas.removeEventListener('gesturestart', handleGesture);
      canvas.removeEventListener('gesturechange', handleGesture);
      canvas.removeEventListener('gestureend', handleGesture);
    };
  }, [viewMode]);

  useEffect(() => {
    const handleGlobalWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
      }
    };
    window.addEventListener('wheel', handleGlobalWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleGlobalWheel);
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.matches('textarea,input,select')) return;
      if ((event.ctrlKey || event.metaKey) && (event.key === '=' || event.key === '+' || event.key === '-' || event.key === '_')) {
        event.preventDefault();
        const factor = (event.key === '=' || event.key === '+') ? 1.15 : 0.85;
        if (viewMode === 'schematic') {
          setSchematicZoom((prev) => Math.max(0.4, Math.min(3.0, prev * factor)));
        } else {
          const canvas = canvasRef.current;
          const screenX = canvas ? canvas.clientWidth / 2 : 400;
          const screenY = canvas ? canvas.clientHeight / 2 : 300;
          const worldX = (screenX - canvasPan.x) / canvasZoom;
          const worldY = (screenY - canvasPan.y) / canvasZoom;
          const nextZoom = Math.max(0.25, Math.min(3.5, canvasZoom * factor));
          setCanvasZoom(nextZoom);
          setCanvasPan({
            x: screenX - worldX * nextZoom,
            y: screenY - worldY * nextZoom,
          });
        }
      } else if (event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        setNotesVisible((v) => !v);
      } else if (event.key >= '0' && event.key <= '9') {
        const option = WIRE_COLORS.find((c) => c.key === event.key);
        if (option) chooseWireColor(option.color);
      } else if (event.key.toLowerCase() === 'r' && state.selectedId) {
        const part = state.parts.find((candidate) => candidate.id === state.selectedId);
        if (part) {
          const step = event.shiftKey ? -30 : 30;
          const nextDeg = (((part.rotate ?? 0) + step) % 360 + 360) % 360;
          circuitStore.rotatePart(part.id, nextDeg);
        }
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        event.shiftKey ? circuitStore.redo() : circuitStore.undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        circuitStore.redo();
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && state.selectedId) {
        const part = state.parts.find((candidate) => candidate.id === state.selectedId);
        if (part) circuitStore.removePart(part.id);
        else circuitStore.removeConnection(state.selectedId);
      } else if (event.key === 'Escape') {
        setWireDraft(null);
        setWirePointer(null);
        setAlignmentGuides([]);
        circuitStore.select(null);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [state.selectedId, state.parts, chooseWireColor, canvasPan, canvasZoom, viewMode]);

  const addPart = useCallback((type: PartType) => {
    const canvas = canvasRef.current;
    const def = PART_DEFINITIONS[type];
    let centerX = WORKSPACE_WIDTH / 2;
    let centerY = WORKSPACE_HEIGHT / 2;

    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const screenCenterX = rect.width / 2;
      const screenCenterY = rect.height / 2;
      centerX = (screenCenterX - canvasPan.x) / canvasZoom;
      centerY = (screenCenterY - canvasPan.y) / canvasZoom;
    }

    let targetLeft = Math.round((centerX - def.naturalSize.width / 2) / 10) * 10;
    let targetTop = Math.round((centerY - def.naturalSize.height / 2) / 10) * 10;

    // Prevent direct overlapping if another part is already at targetLeft, targetTop
    const snap = circuitStore.getSnapshot();
    let collision = true;
    let offset = 0;
    while (collision && offset <= 160) {
      const testLeft = targetLeft + offset;
      const testTop = targetTop + offset;
      collision = snap.parts.some((p) => {
        return Math.abs(p.left - testLeft) < 25 && Math.abs(p.top - testTop) < 25;
      });
      if (collision) {
        offset += 25;
      } else {
        targetLeft = testLeft;
        targetTop = testTop;
      }
    }

    circuitStore.addPart(type, targetLeft, targetTop);
  }, [canvasPan, canvasZoom]);

  const handlePinClick = useCallback((part: CircuitPart, pin: string) => {
    if (state.simulation.status !== 'stopped' && state.simulation.status !== 'error') return;
    const endpoint = `${part.id}:${pin}`;
    if (!wireDraft) {
      setWireDraft({ from: endpoint, waypoints: [] });
      setWirePointer(endpointPoint(endpoint, state.parts));
      setAlignmentGuides([]);
      circuitStore.select(part.id);
      return;
    }
    if (wireDraft.from === endpoint) {
      setWireDraft(null);
      setWirePointer(null);
      setAlignmentGuides([]);
      return;
    }
    circuitStore.addConnection(wireDraft.from, endpoint, activeWireColor, {
      waypoints: wireDraft.waypoints,
    });
    setWireDraft(null);
    setWirePointer(null);
    setAlignmentGuides([]);
  }, [wireDraft, activeWireColor, state.parts, state.simulation.status]);

  const canvasPoint = useCallback((event: { clientX: number; clientY: number }): WirePoint | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    return {
      x: (screenX - canvasPan.x) / canvasZoom,
      y: (screenY - canvasPan.y) / canvasZoom,
    };
  }, [canvasPan, canvasZoom]);

  const draftAlignmentTargets = useMemo(() => {
    const targets = collectWireAlignmentTargets(state.parts, state.connections);
    if (wireDraft) {
      addAlignmentPoints(targets, [
        endpointPoint(wireDraft.from, state.parts),
        ...wireDraft.waypoints,
      ]);
    }
    return targets;
  }, [wireDraft, state.parts, state.connections]);

  const snapDraftPoint = useCallback((point: WirePoint) => {
    if (!wireDraft) return { point, guides: [] as AlignmentGuide[] };
    const anchor = wireDraft.waypoints.at(-1) ?? endpointPoint(wireDraft.from, state.parts);
    if (!anchor) return snapPointToTargets(point, draftAlignmentTargets, 6 / canvasZoom);
    return snapOrthogonalPoint(point, anchor, draftAlignmentTargets, 6 / canvasZoom);
  }, [wireDraft, draftAlignmentTargets, canvasZoom, state.parts]);

  const frameCircuit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const viewportWidth = rect.width || canvas.clientWidth || 800;
    const viewportHeight = rect.height || canvas.clientHeight || 600;
    const live = circuitStore.getSnapshot();
    const points: WirePoint[] = [];

    for (const part of live.parts) {
      const r = partRect(part);
      points.push(
        { x: r.x, y: r.y },
        { x: r.x + r.width, y: r.y + r.height },
      );
    }
    for (const wire of live.connections) {
      const start = endpointPoint(wire.from, live.parts);
      const end = endpointPoint(wire.to, live.parts);
      if (start) points.push(start);
      if (end) points.push(end);
      points.push(...(wire.waypoints ?? []));
    }

    if (!points.length) {
      setCanvasZoom(1);
      setCanvasPan({
        x: Math.round(viewportWidth / 2 - (WORKSPACE_WIDTH / 2)),
        y: Math.round(viewportHeight / 2 - (WORKSPACE_HEIGHT / 2)),
      });
      return;
    }

    const minX = Math.min(...points.map((p) => p.x));
    const maxX = Math.max(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    const maxY = Math.max(...points.map((p) => p.y));
    const contentWidth = Math.max(120, maxX - minX);
    const contentHeight = Math.max(120, maxY - minY);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const padding = 120;
    const fitZoomX = (viewportWidth - padding * 2) / contentWidth;
    const fitZoomY = (viewportHeight - padding * 2) / contentHeight;
    const targetZoom = Math.max(0.35, Math.min(1.5, Math.min(fitZoomX, fitZoomY)));

    setCanvasZoom(targetZoom);
    setCanvasPan({
      x: Math.round(viewportWidth / 2 - centerX * targetZoom),
      y: Math.round(viewportHeight / 2 - centerY * targetZoom),
    });
  }, []);

  useEffect(() => {
    const handleWebMcpFrame = () => requestAnimationFrame(() => frameCircuit());
    window.addEventListener('webmcp:frame-circuit', handleWebMcpFrame);
    return () => window.removeEventListener('webmcp:frame-circuit', handleWebMcpFrame);
  }, [frameCircuit]);
  const toggleSimulation = async () => {
    if (state.simulation.status === 'running') {
      simulator.stop();
      return;
    }
    if (state.simulation.status === 'compiling') return;
    if (board && board.code !== draft) circuitStore.setCode(board.id, draft);
    try {
      await simulator.start();
    } catch (error) {
      console.warn('[Simulation]', error);
    }
  };

  const loadExample = (presetId: string | null) => {
    if (state.simulation.status === 'running') simulator.stop();
    if (presetId === null) {
      circuitStore.replaceDocument({ parts: [], connections: [] });
    } else {
      const preset = CIRCUIT_PRESETS.find((candidate) => candidate.id === presetId);
      if (!preset) return;
      circuitStore.replaceDocument(centerCircuitDocument(preset.parts, preset.connections));
    }
    setSidePanelTab('components');
    setWireDraft(null);
    setWirePointer(null);
    setExamplesOpen(false);
    requestAnimationFrame(() => frameCircuit());
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="toolbar-group">
          <button
            type="button"
            className="icon-button"
            onClick={() => {
              if (selectedPart) {
                const nextDeg = (((selectedPart.rotate ?? 0) + 30) % 360 + 360) % 360;
                circuitStore.rotatePart(selectedPart.id, nextDeg);
              }
            }}
            disabled={!selectedPart}
            title="Rotate selected part (R)"
            aria-label="Rotate"
          >
            <RotateIcon />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => {
              if (selectedPart) circuitStore.removePart(selectedPart.id);
              else if (selectedWire) circuitStore.removeConnection(selectedWire.id);
            }}
            disabled={!state.selectedId}
            title="Delete selected item (Del)"
            aria-label="Delete"
          >
            <DeleteIcon />
          </button>
          <button type="button" className="icon-button" onClick={() => circuitStore.undo()} disabled={!circuitStore.canUndo()} title="Undo (Ctrl+Z)" aria-label="Undo"><UndoIcon /></button>
          <button type="button" className="icon-button" onClick={() => circuitStore.redo()} disabled={!circuitStore.canRedo()} title="Redo (Ctrl+Y)" aria-label="Redo"><RedoIcon /></button>
          <div className="toolbar-divider" />
          <button
            type="button"
            className="icon-button"
            onClick={addNote}
            title="Add note"
            aria-label="Add note"
          >
            <NoteIcon />
          </button>
          <button
            type="button"
            className={`icon-button${notesVisible ? '' : ' notes-hidden'}`}
            onClick={() => setNotesVisible((v) => !v)}
            title="Toggle notes visibility (Shift + N)"
            aria-label="Toggle notes visibility"
          >
            <ToggleNotesIcon visible={notesVisible} />
          </button>
          <div className="toolbar-divider" />
          <WireColorTool color={shownWireColor} onChange={chooseWireColor} />
          <div className="examples-wrap">
            <button type="button" className="examples-button" onClick={() => setExamplesOpen((open) => !open)}>
              Examples
            </button>
            {examplesOpen && (
              <div className="examples-menu">
                <button type="button" onClick={() => loadExample(null)}>
                  <strong>Empty bench</strong>
                  <span>Start from nothing</span>
                </button>
                {CIRCUIT_PRESETS.map((preset) => (
                  <button type="button" key={preset.id} onClick={() => loadExample(preset.id)}>
                    <strong>{preset.name}</strong>
                    <span>{preset.description}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="toolbar-group toolbar-right">
          {viewMode === 'circuits' && (
            <button
              type="button"
              className={`simulate-button ${state.simulation.status}`}
              onClick={toggleSimulation}
              disabled={state.simulation.status === 'compiling'}
            >
              <span className="simulation-symbol" aria-hidden="true">{state.simulation.status === 'running' ? '■' : '▶'}</span>
              {state.simulation.status === 'running'
                ? 'Stop Simulation'
                : state.simulation.status === 'compiling'
                  ? 'Compiling...'
                  : 'Start Simulation'}
            </button>
          )}
          {viewMode === 'schematic' && (
            <button
              type="button"
              className="pdf-download-btn"
              onClick={() => window.print()}
              title="Download PDF / Print"
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
              <span>Download PDF</span>
            </button>
          )}
          {viewMode === 'components' && (
            <button
              type="button"
              className="csv-download-btn"
              onClick={() => exportComponentsCsv(state.parts)}
              title="Download CSV"
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span>Download CSV</span>
            </button>
          )}
          <div className="view-mode-switcher">
            <button
              type="button"
              className={`view-mode-btn${viewMode === 'circuits' ? ' active' : ''}`}
              onClick={() => setViewMode('circuits')}
              title="Circuits View"
            >
              <CircuitsIcon />
              <span>Circuits</span>
            </button>
            <button
              type="button"
              className={`view-mode-btn${viewMode === 'schematic' ? ' active' : ''}`}
              onClick={() => setViewMode('schematic')}
              title="Schematic View"
            >
              <SchematicIcon />
              <span>Schematic</span>
            </button>
            <button
              type="button"
              className={`view-mode-btn${viewMode === 'components' ? ' active' : ''}`}
              onClick={() => setViewMode('components')}
              title="Component List"
            >
              <BomIcon />
              <span>Components</span>
            </button>
          </div>
        </div>
      </header>

      {viewMode === 'schematic' && (
        <SchematicView
          parts={state.parts}
          connections={state.connections}
          zoom={schematicZoom}
          onZoomChange={setSchematicZoom}
        />
      )}
      {viewMode === 'components' && (
        <ComponentsView parts={state.parts} />
      )}
      <main className="main-area" style={{ display: viewMode === 'circuits' ? 'flex' : 'none' }}>
        <div className="canvas-stage">
          <div
            ref={canvasRef}
            className={`canvas-viewport${isPanning ? ' panning' : ''}`}
            onPointerMove={(event) => {
              if (wireDraft) {
                const point = canvasPoint(event);
                if (point) {
                  const snapped = snapDraftPoint(point);
                  setWirePointer(snapped.point);
                  setAlignmentGuides(snapped.guides);
                }
                return;
              }
              const pan = panRef.current;
              if (!pan || pan.pointerId !== event.pointerId) return;
              const dx = event.clientX - pan.startX;
              const dy = event.clientY - pan.startY;
              setCanvasPan({
                x: pan.startPanX + dx,
                y: pan.startPanY + dy,
              });
            }}
            onPointerDown={(event) => {
              const target = event.target as HTMLElement;
              const onBackground = target === event.currentTarget || target.classList.contains('canvas-world') || target.classList.contains('canvas-viewport');
              if (!onBackground) return;
              if (wireDraft) {
                const point = canvasPoint(event);
                if (point) {
                  const snapped = snapDraftPoint(point);
                  const waypoint = snapped.point;
                  setWireDraft((current) => current
                    ? { ...current, waypoints: [...current.waypoints, waypoint] }
                    : current);
                  setWirePointer(waypoint);
                  setAlignmentGuides(snapped.guides);
                }
                return;
              }
              circuitStore.select(null);
              panRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                startPanX: canvasPan.x,
                startPanY: canvasPan.y,
              };
              setIsPanning(true);
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerUp={(event) => {
              if (panRef.current?.pointerId !== event.pointerId) return;
              panRef.current = null;
              setIsPanning(false);
            }}
            onPointerCancel={() => { panRef.current = null; setIsPanning(false); }}
          >
            <div
              className="canvas-world"
              style={{
                width: WORKSPACE_WIDTH,
                height: WORKSPACE_HEIGHT,
                transform: `translate(${canvasPan.x}px, ${canvasPan.y}px) scale(${canvasZoom})`,
                transformOrigin: '0 0',
                '--active-wire-color': shownWireColor,
              } as React.CSSProperties}
            >
            <Wires
              connections={state.connections}
              parts={state.parts}
              selectedId={state.selectedId}
              focusedIds={focusedIds}
              draft={wireDraft}
              pointer={wirePointer}
              editingDisabled={state.simulation.status === 'running' || state.simulation.status === 'compiling'}
              draftColor={activeWireColor}
              alignmentGuides={alignmentGuides}
              zoom={canvasZoom}
              onAlignmentGuidesChange={setAlignmentGuides}
            />
            {state.parts.map((part) => (
              <PartOnCanvas
                key={part.id}
                part={part}
                selected={state.selectedId === part.id}
                focused={focusedIds.has(part.id)}
                pendingWire={wireDraft?.from ?? null}
                simulationRunning={state.simulation.status === 'running' || state.simulation.status === 'compiling'}
                onPinClick={handlePinClick}
                onAlignmentGuidesChange={setAlignmentGuides}
                zoom={canvasZoom}
              />
            ))}
            {wireDraft && (
              <div className="wire-hint">
                Click canvas to add bend points, then click a pin to connect
                <button type="button" onClick={() => { setWireDraft(null); setWirePointer(null); setAlignmentGuides([]); }}>Cancel</button>
              </div>
            )}
            {state.focus?.message && <div className="focus-message">{state.focus.message}</div>}
            {state.simulation.status === 'error' && state.simulation.error && (
              <button
                type="button"
                className="simulation-error"
                onClick={() => {
                  if (state.focus?.code) {
                    setSidePanelTab('code');
                    setSidebarCollapsed(false);
                  }
                }}
              >
                {state.simulation.error}
              </button>
            )}
            <NotesLayer
              notes={notes}
              visible={notesVisible}
              onUpdateNote={updateNote}
              onDeleteNote={deleteNote}
            />
            <Diagnostics open={diagnosticsOpen} setOpen={setDiagnosticsOpen} />
            </div>
          </div>
          <div className="canvas-tools">
            <button type="button" className="frame-button" onClick={frameCircuit} title="Frame circuit" aria-label="Frame circuit"><FrameIcon /></button>
          </div>
          <InspectorCard selectedId={state.selectedId} />
          {sidebarCollapsed && (
            <button
              type="button"
              className="reopen-sidebar-btn"
              onClick={() => setSidebarCollapsed(false)}
              title="Expand panel"
              aria-label="Expand panel"
            >
              ‹ {sidePanelTab === 'code' ? 'Code' : 'Components'}
            </button>
          )}
        </div>

        {!sidebarCollapsed && (
          sidePanelTab === 'code'
            ? <CodePanel
                board={board}
                draft={draft}
                setDraft={setDraft}
                width={panelWidth}
                onResizeStart={startResize}
                onToggleCollapse={() => setSidebarCollapsed(true)}
                onTabChange={setSidePanelTab}
                onAddPart={addPart}
              />
            : <ComponentTray
                onAdd={addPart}
                width={panelWidth}
                onResizeStart={startResize}
                onToggleCollapse={() => setSidebarCollapsed(true)}
                onTabChange={setSidePanelTab}
              />
        )}
      </main>
      {bomOpen && <BomModal onClose={() => setBomOpen(false)} />}
    </div>
  );
}
