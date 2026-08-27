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
import { CIRCUIT_PRESETS } from '../circuit/presets';
import { diagnoseCircuit } from '../sim/diagnostics';
import { simulator } from '../sim/simulator';
import { circuitStore } from '../circuit/store';
import type { SnapMode } from '../breadboard/placement';
import { getBreadboardGeometry, isBreadboardType } from '../breadboard/geometry';
import { endpointPoint, partRect, pinExitDirection } from '../wires/geometry';
import { connectionPolyline, nearestPointOnPolyline, roundedPath, snapPoint, type WireAxis } from '../wires/path';
import type { CircuitConnection, CircuitPart, PartType, WirePoint } from '../circuit/types';

const WIRE_COLORS = ['#2f9e44', '#d94841', '#343a40', '#1971c2', '#f08c00'];
const DEFAULT_WIRE_COLOR = WIRE_COLORS[0];
const WIRE_COLOR_STORAGE_KEY = 'hardware-lab:wire-color';

function UndoIcon({ redo = false }: { redo?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={redo ? 'M9 7h5a6 6 0 0 1 6 6v3' : 'M15 7h-5a6 6 0 0 0-6 6v3'} />
      <path d={redo ? 'm15 3 4 4-4 4' : 'm9 3-4 4 4 4'} />
    </svg>
  );
}

function FrameIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
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
        title="Wire color"
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
              key={option}
              className={option === color ? 'active' : ''}
              aria-label={`Use wire color ${option}`}
              onClick={() => { onChange(option); setOpen(false); }}
            >
              <span style={{ background: option }} />
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
          width: definition.naturalSize.width,
          height: definition.naturalSize.height,
          transform: `rotate(${part.rotate ?? 0}deg) scale(${definition.renderScale})`,
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
          width: definition.naturalSize.width,
          height: definition.naturalSize.height,
          transform: `rotate(${part.rotate ?? 0}deg) scale(${definition.renderScale})`,
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
          width: definition.naturalSize.width,
          height: definition.naturalSize.height,
          transform: `rotate(${part.rotate ?? 0}deg) scale(${definition.renderScale})`,
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
      transform: `rotate(${part.rotate ?? 0}deg) scale(${definition.renderScale})`,
    },
  });
}

function PartPreview({ type }: { type: PartType }) {
  const definition = PART_DEFINITIONS[type];
  if (isBreadboardType(type)) {
    return <div className="mini-breadboard"><span /><span /><span /></div>;
  }
  if (type === 'dc-motor') {
    return <img className="dc-motor-preview" src="/assets/fritzing/dc-motor.svg" alt="" />;
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
  return createElement(definition.tag, {
    ...definition.defaults,
    style: {
      transformOrigin: '0 0',
      transform: `scale(${definition.previewScale})`,
      pointerEvents: 'none',
    },
  });
}

function PartOnCanvas({
  part,
  selected,
  focused,
  pendingWire,
  simulationRunning,
  onPinClick,
}: {
  part: CircuitPart;
  selected: boolean;
  focused: boolean;
  pendingWire: string | null;
  simulationRunning: boolean;
  onPinClick: (part: CircuitPart, pin: string) => void;
}) {
  const definition = PART_DEFINITIONS[part.type];
  const bounds = getPartBounds(part);
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

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (simulationRunning) return;
    if ((event.target as HTMLElement).closest('.pin-hit')) return;
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
    if (!drag || drag.pointerId !== event.pointerId) return;
    const left = Math.max(0, Math.min(WORKSPACE_WIDTH - 30, drag.left + event.clientX - drag.startX));
    const top = Math.max(0, Math.min(WORKSPACE_HEIGHT - 30, drag.top + event.clientY - drag.startY));
    const snapMode: SnapMode = event.shiftKey ? 'off' : (event.altKey || event.ctrlKey ? 'fine' : 'normal');
    drag.latestLeft = left;
    drag.latestTop = top;
    drag.latestSnapMode = snapMode;
    if (drag.frame === null) {
      drag.frame = requestAnimationFrame(() => {
        const current = dragRef.current;
        if (!current) return;
        current.frame = null;
        circuitStore.movePart(part.id, current.latestLeft, current.latestTop, false, current.latestSnapMode);
      });
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.frame !== null) cancelAnimationFrame(drag.frame);
    dragRef.current = null;
    circuitStore.movePart(part.id, drag.latestLeft, drag.latestTop, true, drag.latestSnapMode);
  };

  return (
    <div
      className={`canvas-part${selected ? ' selected' : ''}${focused ? ' focused' : ''}${isBreadboardType(part.type) ? ' is-breadboard' : ''}`}
      data-part-id={part.id}
      style={{ left: part.left, top: part.top, width: bounds.width, height: bounds.height }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={() => circuitStore.select(part.id)}
    >
      <div className="part-render"><PartElement part={part} /></div>
      <div className="part-pins">
        {getPartPins(part).map((pin) => {
          const scale = definition.renderScale;
          const x = pin.x * scale;
          const y = pin.y * scale;
          const radians = ((part.rotate ?? 0) * Math.PI) / 180;
          const px = x * Math.cos(radians) - y * Math.sin(radians);
          const py = x * Math.sin(radians) + y * Math.cos(radians);
          const endpoint = `${part.id}:${pin.name}`;
          return (
            <button
              type="button"
              key={pin.name}
              className={`pin-hit${pendingWire === endpoint ? ' pending' : ''}`}
              style={{ left: px, top: py }}
              data-label={pin.name}
              aria-label={`${part.id} pin ${pin.name}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onPinClick(part, pin.name);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function svgEventPoint(event: { clientX: number; clientY: number }, svg: SVGSVGElement): WirePoint {
  const rect = svg.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function WireWaypointHandle({
  wireId,
  index,
  point,
  disabled,
}: {
  wireId: string;
  index: number;
  point: WirePoint;
  disabled: boolean;
}) {
  const dragRef = useRef<{ pointerId: number } | null>(null);

  return (
    <circle
      className="wire-waypoint"
      cx={point.x}
      cy={point.y}
      r={5}
      onPointerDown={(event) => {
        if (disabled) return;
        event.stopPropagation();
        dragRef.current = { pointerId: event.pointerId };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (disabled || dragRef.current?.pointerId !== event.pointerId) return;
        const svg = event.currentTarget.ownerSVGElement;
        if (!svg) return;
        const nextPoint = snapPoint(svgEventPoint(event, svg));
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
      }}
    />
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
}: {
  connections: CircuitConnection[];
  parts: CircuitPart[];
  selectedId: string | null;
  focusedIds: Set<string>;
  draft: WireDraft | null;
  pointer: WirePoint | null;
  editingDisabled: boolean;
  draftColor: string;
}) {
  return (
    <svg className="wire-layer" width={WORKSPACE_WIDTH} height={WORKSPACE_HEIGHT}>
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
                waypoints.splice(nearest.segmentIndex, 0, snapPoint(nearest.point));
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
              />
            ))}
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

function ComponentTray({ onAdd }: { onAdd: (type: PartType) => void }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<'All' | PartCategory>('All');
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
    <aside className="side-panel components-panel">
      <div className="panel-heading">Components</div>
      <select
        className="component-filter"
        value={category}
        onChange={(event) => setCategory(event.target.value as 'All' | PartCategory)}
        aria-label="Component category"
      >
        {categories.map((value) => <option value={value} key={value}>{value}</option>)}
      </select>
      <div className="component-search-wrap">
        <span className="search-icon">⌕</span>
        <input
          className="component-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search"
          aria-label="Search components"
        />
      </div>
      <div className="component-grid">
        {filtered.map((type) => (
          <button className="component-card" type="button" key={type} onClick={() => onAdd(type)}>
            <span className="component-preview"><PartPreview type={type} /></span>
            <span>{PART_DEFINITIONS[type].name}</span>
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
}: {
  board: CircuitPart | undefined;
  draft: string;
  setDraft: (code: string) => void;
}) {
  const state = useCircuit();
  const [scrollTop, setScrollTop] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lines = draft.split('\n');
  const focusCode = state.focus?.code;
  const codeFocus = focusCode?.boardId === board?.id ? focusCode : undefined;
  const lineHeight = 20;

  useEffect(() => {
    if (!codeFocus || !textareaRef.current) return;
    const targetTop = Math.max(0, (codeFocus.startLine - 3) * lineHeight);
    textareaRef.current.scrollTo({ top: targetTop, behavior: 'smooth' });
  }, [codeFocus]);

  if (!board) {
    return (
      <aside className="side-panel code-panel empty-code-panel">
        <div className="panel-heading">Code</div>
        <p>Add an Arduino Uno to edit a sketch.</p>
      </aside>
    );
  }

  return (
    <aside className="side-panel code-panel">
      <div className="code-panel-top">
        <span>{board.id}</span>
        <span>Arduino C++</span>
      </div>
      <div className="editor-shell">
        <div className="line-numbers" style={{ transform: `translateY(${-scrollTop}px)` }}>
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
        <textarea
          ref={textareaRef}
          className="code-editor"
          spellCheck={false}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          onBlur={() => {
            if (board.code !== draft) circuitStore.setCode(board.id, draft);
          }}
        />
      </div>
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

function SelectionBar({ selectedId }: { selectedId: string | null }) {
  const state = useCircuit();
  if (!selectedId) return null;
  const part = state.parts.find((candidate) => candidate.id === selectedId);
  const wire = state.connections.find((candidate) => candidate.id === selectedId);
  if (!part && !wire) return null;

  const remove = () => {
    if (part) circuitStore.removePart(part.id);
    else if (wire) circuitStore.removeConnection(wire.id);
  };

  return (
    <div className="selection-bar" onPointerDown={(event) => event.stopPropagation()}>
      <div className="selection-name">
        <strong>{part ? PART_DEFINITIONS[part.type].name : 'Wire'}</strong>
        <span>{selectedId}</span>
      </div>
      {part && (PART_DEFINITIONS[part.type].properties ?? []).map((property) => (
        <PartPropertyControl key={property.key} part={part} property={property} />
      ))}
      <button type="button" className="delete-button" onClick={remove}>Delete</button>
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

export default function App() {
  const state = useCircuit();
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [codeOpen, setCodeOpen] = useState(false);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const [wireDraft, setWireDraft] = useState<WireDraft | null>(null);
  const [wirePointer, setWirePointer] = useState<WirePoint | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);
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
  const selectedWire = state.connections.find((connection) => connection.id === state.selectedId);
  const shownWireColor = selectedWire?.color ?? activeWireColor;

  const chooseWireColor = useCallback((color: string) => {
    setActiveWireColor(color);
    try { localStorage.setItem(WIRE_COLOR_STORAGE_KEY, color); } catch { /* ignore storage failures */ }
    const selected = circuitStore.getSnapshot().connections.find((connection) => connection.id === circuitStore.getSnapshot().selectedId);
    if (selected) circuitStore.setConnectionColor(selected.id, color);
  }, []);

  useEffect(() => {
    setDraft(board?.code ?? '');
  }, [board?.id, board?.code]);

  useEffect(() => {
    if (state.focus?.code) setCodeOpen(true);
  }, [state.focus?.code]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || circuitStore.getSnapshot().parts.length) return;
    canvas.scrollLeft = WORKSPACE_WIDTH / 2 - canvas.clientWidth / 2;
    canvas.scrollTop = WORKSPACE_HEIGHT / 2 - canvas.clientHeight / 2;
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.matches('textarea,input,select')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
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
        circuitStore.select(null);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [state.selectedId, state.parts]);

  const addPart = useCallback((type: PartType) => {
    if (state.simulation.status === 'running' || state.simulation.status === 'compiling') return;
    const canvas = canvasRef.current;
    const bounds = getPartBounds(type);
    const left = canvas
      ? canvas.scrollLeft + canvas.clientWidth / 2 - bounds.width / 2
      : 250;
    const top = canvas
      ? canvas.scrollTop + canvas.clientHeight / 2 - bounds.height / 2
      : 180;
    circuitStore.addPart(type, Math.max(20, left), Math.max(20, top));
  }, [state.simulation.status]);

  const handlePinClick = useCallback((part: CircuitPart, pin: string) => {
    if (state.simulation.status !== 'stopped' && state.simulation.status !== 'error') return;
    const endpoint = `${part.id}:${pin}`;
    if (!wireDraft) {
      setWireDraft({ from: endpoint, waypoints: [] });
      setWirePointer(endpointPoint(endpoint, state.parts));
      circuitStore.select(part.id);
      return;
    }
    if (wireDraft.from === endpoint) {
      setWireDraft(null);
      setWirePointer(null);
      return;
    }
    circuitStore.addConnection(wireDraft.from, endpoint, activeWireColor, {
      waypoints: wireDraft.waypoints,
    });
    setWireDraft(null);
    setWirePointer(null);
  }, [wireDraft, activeWireColor, state.parts, state.simulation.status]);

  const canvasPoint = useCallback((event: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: canvas.scrollLeft + event.clientX - rect.left,
      y: canvas.scrollTop + event.clientY - rect.top,
    };
  }, []);

  const frameCircuit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const live = circuitStore.getSnapshot();
    const points: WirePoint[] = [];

    for (const part of live.parts) {
      const rect = partRect(part);
      points.push(
        { x: rect.x, y: rect.y },
        { x: rect.x + rect.width, y: rect.y + rect.height },
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
      canvas.scrollTo({ left: WORKSPACE_WIDTH / 2 - canvas.clientWidth / 2, top: WORKSPACE_HEIGHT / 2 - canvas.clientHeight / 2, behavior: 'smooth' });
      return;
    }

    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    canvas.scrollTo({
      left: Math.max(0, Math.min(WORKSPACE_WIDTH - canvas.clientWidth, centerX - canvas.clientWidth / 2)),
      top: Math.max(0, Math.min(WORKSPACE_HEIGHT - canvas.clientHeight, centerY - canvas.clientHeight / 2)),
      behavior: 'smooth',
    });
  }, []);

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
    setCodeOpen(false);
    setWireDraft(null);
    setWirePointer(null);
    setExamplesOpen(false);
    requestAnimationFrame(() => frameCircuit());
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="toolbar-group">
          <button type="button" className="icon-button" onClick={() => circuitStore.undo()} disabled={!circuitStore.canUndo()} title="Undo" aria-label="Undo"><UndoIcon /></button>
          <button type="button" className="icon-button" onClick={() => circuitStore.redo()} disabled={!circuitStore.canRedo()} title="Redo" aria-label="Redo"><UndoIcon redo /></button>
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
          <button type="button" className={`code-button${codeOpen ? ' active' : ''}`} onClick={() => setCodeOpen(!codeOpen)}>
            <span>{'</>'}</span> Code
          </button>
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
        </div>
      </header>

      <main className="main-area">
        <div className="canvas-stage">
          <div
            ref={canvasRef}
            className={`canvas-scroll${isPanning ? ' panning' : ''}`}
            onWheel={(event) => {
              event.preventDefault();
              event.currentTarget.scrollLeft += event.deltaX;
              event.currentTarget.scrollTop += event.deltaY;
            }}
            onPointerMove={(event) => {
              if (wireDraft) {
                const point = canvasPoint(event);
                if (point) setWirePointer(point);
                return;
              }
              const pan = panRef.current;
              if (!pan || pan.pointerId !== event.pointerId) return;
              event.currentTarget.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX);
              event.currentTarget.scrollTop = pan.scrollTop - (event.clientY - pan.startY);
            }}
            onPointerDown={(event) => {
              const target = event.target as HTMLElement;
              const onBackground = event.target === event.currentTarget || target.classList.contains('canvas-world');
              if (!onBackground) return;
              if (wireDraft) {
                const point = canvasPoint(event);
                if (point) {
                  const waypoint = snapPoint(point);
                  setWireDraft((current) => current
                    ? { ...current, waypoints: [...current.waypoints, waypoint] }
                    : current);
                  setWirePointer(waypoint);
                }
                return;
              }
              circuitStore.select(null);
              panRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                scrollLeft: event.currentTarget.scrollLeft,
                scrollTop: event.currentTarget.scrollTop,
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
            <div className="canvas-world" style={{ width: WORKSPACE_WIDTH, height: WORKSPACE_HEIGHT }}>
            <Wires
              connections={state.connections}
              parts={state.parts}
              selectedId={state.selectedId}
              focusedIds={focusedIds}
              draft={wireDraft}
              pointer={wirePointer}
              editingDisabled={state.simulation.status === 'running' || state.simulation.status === 'compiling'}
              draftColor={activeWireColor}
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
              />
            ))}
            {wireDraft && (
              <div className="wire-hint">
                Route like a pipe: add a few 90? bends, then choose a pin
                <button type="button" onClick={() => { setWireDraft(null); setWirePointer(null); }}>Cancel</button>
              </div>
            )}
            {state.focus?.message && <div className="focus-message">{state.focus.message}</div>}
            {state.simulation.status === 'error' && state.simulation.error && (
              <button
                type="button"
                className="simulation-error"
                onClick={() => state.focus?.code && setCodeOpen(true)}
              >
                {state.simulation.error}
              </button>
            )}
            <Diagnostics open={diagnosticsOpen} setOpen={setDiagnosticsOpen} />
            </div>
          </div>
          <div className="canvas-tools">
            <button type="button" className="frame-button" onClick={frameCircuit} title="Frame circuit" aria-label="Frame circuit"><FrameIcon /></button>
            <WireColorTool color={shownWireColor} onChange={chooseWireColor} />
          </div>
          <SelectionBar selectedId={state.selectedId} />
        </div>

        {codeOpen
          ? <CodePanel board={board} draft={draft} setDraft={setDraft} />
          : <ComponentTray onAdd={addPart} />}
      </main>
    </div>
  );
}
