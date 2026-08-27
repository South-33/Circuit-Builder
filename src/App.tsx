import React, {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { getPartBounds, getPartPins, PART_DEFINITIONS, PART_ORDER } from './parts';
import { diagnoseCircuit } from './sim/diagnostics';
import { simulator } from './sim/simulator';
import { circuitStore } from './store';
import type { CircuitConnection, CircuitPart, PartAttrs, PartType } from './types';

const WORLD_WIDTH = 1500;
const WORLD_HEIGHT = 900;
const WIRE_COLORS = ['#2f9e44', '#d94841', '#343a40', '#1971c2', '#f08c00'];

function useCircuit() {
  return useSyncExternalStore(circuitStore.subscribe, circuitStore.getSnapshot);
}

function endpointPoint(endpoint: string, parts: CircuitPart[]) {
  const colon = endpoint.indexOf(':');
  if (colon < 0) return null;
  const part = parts.find((candidate) => candidate.id === endpoint.slice(0, colon));
  if (!part) return null;
  const pinName = endpoint.slice(colon + 1);
  const pin = getPartPins(part).find((candidate) => candidate.name === pinName);
  if (!pin) return null;
  const scale = PART_DEFINITIONS[part.type].renderScale;
  const x = pin.x * scale;
  const y = pin.y * scale;
  const radians = ((part.rotate ?? 0) * Math.PI) / 180;
  return {
    x: part.left + x * Math.cos(radians) - y * Math.sin(radians),
    y: part.top + x * Math.sin(radians) + y * Math.cos(radians),
  };
}

function wirePath(from: { x: number; y: number }, to: { x: number; y: number }) {
  const distanceX = Math.abs(to.x - from.x);
  if (distanceX < 45) {
    const midY = (from.y + to.y) / 2;
    return `M ${from.x} ${from.y} L ${from.x} ${midY} L ${to.x} ${midY} L ${to.x} ${to.y}`;
  }
  const midX = (from.x + to.x) / 2;
  return `M ${from.x} ${from.y} L ${midX} ${from.y} L ${midX} ${to.y} L ${to.x} ${to.y}`;
}

function PartElement({ part }: { part: CircuitPart }) {
  const definition = PART_DEFINITIONS[part.type];
  const elementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = elementRef.current as (HTMLElement & Record<string, unknown>) | null;
    if (!element) return;
    for (const [key, value] of Object.entries(part.attrs)) element[key] = value;
  }, [part.attrs]);

  if (part.type === 'breadboard') {
    return (
      <div
        className="breadboard-visual"
        data-part-element={part.id}
        style={{
          width: definition.naturalSize.width,
          height: definition.naturalSize.height,
          transform: `rotate(${part.rotate ?? 0}deg) scale(${definition.renderScale})`,
        }}
      >
        <div className="breadboard-rail rail-red rail-top" />
        <div className="breadboard-rail rail-blue rail-top-blue" />
        <div className="breadboard-trench" />
        <div className="breadboard-rail rail-red rail-bottom" />
        <div className="breadboard-rail rail-blue rail-bottom-blue" />
      </div>
    );
  }

  if (!definition.tag) return null;
  return createElement(definition.tag, {
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
  if (type === 'breadboard') {
    return <div className="mini-breadboard"><span /><span /><span /></div>;
  }
  if (!definition.tag) return null;
  return createElement(definition.tag, {
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
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const left = Math.max(0, Math.min(WORLD_WIDTH - 30, drag.left + event.clientX - drag.startX));
    const top = Math.max(0, Math.min(WORLD_HEIGHT - 30, drag.top + event.clientY - drag.startY));
    circuitStore.movePart(part.id, left, top, false);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    circuitStore.movePart(part.id, part.left, part.top, true);
  };

  return (
    <div
      className={`canvas-part${selected ? ' selected' : ''}${focused ? ' focused' : ''}${part.type === 'breadboard' ? ' is-breadboard' : ''}`}
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
      {selected && <span className="part-id-chip">{part.id}</span>}
    </div>
  );
}

function Wires({
  connections,
  parts,
  selectedId,
  focusedIds,
}: {
  connections: CircuitConnection[];
  parts: CircuitPart[];
  selectedId: string | null;
  focusedIds: Set<string>;
}) {
  return (
    <svg className="wire-layer" width={WORLD_WIDTH} height={WORLD_HEIGHT}>
      {connections.map((connection) => {
        const from = endpointPoint(connection.from, parts);
        const to = endpointPoint(connection.to, parts);
        if (!from || !to) return null;
        const active = selectedId === connection.id;
        const focused = focusedIds.has(connection.id);
        return (
          <g key={connection.id}>
            <path
              className="wire-hit"
              d={wirePath(from, to)}
              onClick={(event) => {
                event.stopPropagation();
                circuitStore.select(connection.id);
              }}
            />
            <path
              className={`wire-path${active ? ' selected' : ''}${focused ? ' focused' : ''}`}
              d={wirePath(from, to)}
              stroke={connection.color}
            />
          </g>
        );
      })}
    </svg>
  );
}

function ComponentTray({ onAdd }: { onAdd: (type: PartType) => void }) {
  const [search, setSearch] = useState('');
  const filtered = PART_ORDER.filter((type) =>
    PART_DEFINITIONS[type].name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <aside className="side-panel components-panel">
      <div className="panel-heading">Components</div>
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
      {part?.type === 'wokwi-resistor' && (
        <label>
          <span>Ω</span>
          <input
            value={String(part.attrs.value ?? '220')}
            onChange={(event) => circuitStore.setPartAttrs(part.id, { value: event.target.value })}
          />
        </label>
      )}
      {part?.type === 'wokwi-led' && (
        <select
          value={String(part.attrs.color ?? 'red')}
          onChange={(event) => circuitStore.setPartAttrs(part.id, { color: event.target.value })}
          aria-label="LED color"
        >
          {['red', 'green', 'blue', 'yellow', 'orange', 'white', 'purple'].map((color) => (
            <option key={color} value={color}>{color}</option>
          ))}
        </select>
      )}
      {wire && (
        <div className="wire-colors">
          {WIRE_COLORS.map((color) => (
            <button
              type="button"
              key={color}
              aria-label={`Wire color ${color}`}
              style={{ background: color }}
              onClick={() => {
                circuitStore.applyConnections([], [wire.id]);
                circuitStore.addConnection(wire.from, wire.to, color);
              }}
            />
          ))}
        </div>
      )}
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
  const [pendingWire, setPendingWire] = useState<string | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const focusedIds = useMemo(() => new Set(state.focus?.itemIds ?? []), [state.focus]);
  const focusedBoardId = state.focus?.code?.boardId;
  const selectedBoard = state.parts.find((part) => part.id === state.selectedId && part.type === 'wokwi-arduino-uno');
  const board = state.parts.find((part) => part.id === focusedBoardId)
    ?? selectedBoard
    ?? state.parts.find((part) => part.type === 'wokwi-arduino-uno');
  const [draft, setDraft] = useState(board?.code ?? '');

  useEffect(() => {
    setDraft(board?.code ?? '');
  }, [board?.id, board?.code]);

  useEffect(() => {
    if (state.focus?.code) setCodeOpen(true);
  }, [state.focus?.code]);

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
        setPendingWire(null);
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
    if (!pendingWire) {
      setPendingWire(endpoint);
      circuitStore.select(part.id);
      return;
    }
    if (pendingWire === endpoint) {
      setPendingWire(null);
      return;
    }
    const color = WIRE_COLORS[state.connections.length % WIRE_COLORS.length];
    circuitStore.addConnection(pendingWire, endpoint, color);
    setPendingWire(null);
  }, [pendingWire, state.connections.length, state.simulation.status]);

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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="toolbar-group">
          <button type="button" className="icon-button" onClick={() => circuitStore.undo()} disabled={!circuitStore.canUndo()} title="Undo">↶</button>
          <button type="button" className="icon-button" onClick={() => circuitStore.redo()} disabled={!circuitStore.canRedo()} title="Redo">↷</button>
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
            <span>{state.simulation.status === 'running' ? '■' : '▶'}</span>
            {state.simulation.status === 'running'
              ? 'Stop Simulation'
              : state.simulation.status === 'compiling'
                ? 'Compiling…'
                : 'Start Simulation'}
          </button>
        </div>
      </header>

      <main className="main-area">
        <div
          ref={canvasRef}
          className="canvas-scroll"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget || (event.target as HTMLElement).classList.contains('canvas-world')) {
              circuitStore.select(null);
              setPendingWire(null);
            }
          }}
        >
          <div className="canvas-world" style={{ width: WORLD_WIDTH, height: WORLD_HEIGHT }}>
            <Wires
              connections={state.connections}
              parts={state.parts}
              selectedId={state.selectedId}
              focusedIds={focusedIds}
            />
            {state.parts.map((part) => (
              <PartOnCanvas
                key={part.id}
                part={part}
                selected={state.selectedId === part.id}
                focused={focusedIds.has(part.id)}
                pendingWire={pendingWire}
                simulationRunning={state.simulation.status === 'running' || state.simulation.status === 'compiling'}
                onPinClick={handlePinClick}
              />
            ))}
            <SelectionBar selectedId={state.selectedId} />
            {pendingWire && <div className="wire-hint">Choose another pin <button type="button" onClick={() => setPendingWire(null)}>Cancel</button></div>}
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

        {codeOpen
          ? <CodePanel board={board} draft={draft} setDraft={setDraft} />
          : <ComponentTray onAdd={addPart} />}
      </main>
    </div>
  );
}
