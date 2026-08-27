import { defaultCode, PART_DEFINITIONS } from './parts';
import type {
  CircuitConnection,
  CircuitDocument,
  CircuitPart,
  FocusState,
  PartAttrs,
  PartType,
  SimulationState,
} from './types';

type CircuitSnapshot = Pick<CircuitDocument, 'parts' | 'connections'>;

const STOPPED: SimulationState = {
  status: 'stopped',
  compileOutput: '',
  serialOutput: '',
  error: null,
};

const PREFIXES: Record<PartType, string> = {
  'wokwi-arduino-uno': 'uno',
  breadboard: 'bb',
  'wokwi-led': 'led',
  'wokwi-rgb-led': 'rgb',
  'wokwi-resistor': 'r',
  'wokwi-pushbutton': 'button',
  'wokwi-slide-switch': 'switch',
  'wokwi-potentiometer': 'pot',
  'wokwi-buzzer': 'buzzer',
  'wokwi-7segment': 'seg',
};

function cloneSnapshot(state: CircuitDocument): CircuitSnapshot {
  return structuredClone({ parts: state.parts, connections: state.connections });
}

function nextNumericId(existing: string[], prefix: string) {
  let max = 0;
  for (const id of existing) {
    const match = new RegExp(`^${prefix}(\\d+)$`).exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}${max + 1}`;
}

class CircuitStore {
  private state: CircuitDocument = {
    version: 1,
    parts: [],
    connections: [],
    selectedId: null,
    focus: null,
    simulation: { ...STOPPED },
  };

  private listeners = new Set<() => void>();
  private history: CircuitSnapshot[] = [cloneSnapshot(this.state)];
  private historyIndex = 0;
  private focusTimer: number | null = null;

  getSnapshot = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit() {
    for (const listener of this.listeners) listener();
  }

  private setTransient(patch: Partial<CircuitDocument>) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private commit(parts: CircuitPart[], connections: CircuitConnection[], selectedId = this.state.selectedId) {
    this.state = { ...this.state, parts, connections, selectedId };
    this.history.length = this.historyIndex + 1;
    this.history.push(cloneSnapshot(this.state));
    if (this.history.length > 80) this.history.shift();
    this.historyIndex = this.history.length - 1;
    this.emit();
  }

  canUndo() {
    return this.historyIndex > 0;
  }

  canRedo() {
    return this.historyIndex < this.history.length - 1;
  }

  undo() {
    if (!this.canUndo()) return;
    this.historyIndex -= 1;
    const snapshot = structuredClone(this.history[this.historyIndex]);
    this.state = { ...this.state, ...snapshot, selectedId: null, focus: null };
    this.emit();
  }

  redo() {
    if (!this.canRedo()) return;
    this.historyIndex += 1;
    const snapshot = structuredClone(this.history[this.historyIndex]);
    this.state = { ...this.state, ...snapshot, selectedId: null, focus: null };
    this.emit();
  }

  addPart(type: PartType, left: number, top: number, attrs: PartAttrs = {}) {
    const id = nextNumericId(this.state.parts.map((part) => part.id), PREFIXES[type]);
    const part: CircuitPart = {
      id,
      type,
      left: Math.round(left),
      top: Math.round(top),
      attrs: { ...PART_DEFINITIONS[type].defaults, ...attrs },
      ...(type === 'wokwi-arduino-uno' ? { code: defaultCode() } : {}),
    };
    this.commit([...this.state.parts, part], this.state.connections, part.id);
    return part;
  }

  movePart(id: string, left: number, top: number, recordHistory = true) {
    const parts = this.state.parts.map((part) =>
      part.id === id ? { ...part, left: Math.round(left), top: Math.round(top) } : part,
    );
    if (recordHistory) this.commit(parts, this.state.connections, id);
    else this.setTransient({ parts, selectedId: id });
  }

  setPartAttrs(id: string, attrs: PartAttrs) {
    const parts = this.state.parts.map((part) =>
      part.id === id ? { ...part, attrs: { ...part.attrs, ...attrs } } : part,
    );
    this.commit(parts, this.state.connections, id);
  }

  setCode(id: string, code: string) {
    const parts = this.state.parts.map((part) => part.id === id ? { ...part, code } : part);
    this.commit(parts, this.state.connections, id);
  }

  applyParts(
    incoming: Array<Partial<Omit<CircuitPart, 'type'>> & { type: PartType; id?: string }>,
    removePartIds: string[] = [],
    replace = false,
  ) {
    const removeSet = new Set(removePartIds);
    let parts = replace ? [] : this.state.parts.filter((part) => !removeSet.has(part.id));
    const connections = replace
      ? []
      : this.state.connections.filter((connection) => {
          const fromId = connection.from.slice(0, connection.from.indexOf(':'));
          const toId = connection.to.slice(0, connection.to.indexOf(':'));
          return !removeSet.has(fromId) && !removeSet.has(toId);
        });
    const changed: CircuitPart[] = [];

    for (const candidate of incoming) {
      const existingIndex = candidate.id ? parts.findIndex((part) => part.id === candidate.id) : -1;
      const existing = existingIndex >= 0 ? parts[existingIndex] : undefined;
      const id = candidate.id || nextNumericId(parts.map((part) => part.id), PREFIXES[candidate.type]);
      const code = candidate.code ?? existing?.code ?? (candidate.type === 'wokwi-arduino-uno' ? defaultCode() : undefined);
      const part: CircuitPart = {
        id,
        type: candidate.type,
        left: Math.round(candidate.left ?? existing?.left ?? 120),
        top: Math.round(candidate.top ?? existing?.top ?? 120),
        rotate: candidate.rotate ?? existing?.rotate,
        attrs: {
          ...PART_DEFINITIONS[candidate.type].defaults,
          ...(existing?.type === candidate.type ? existing.attrs : {}),
          ...(candidate.attrs ?? {}),
        },
        ...(code !== undefined ? { code } : {}),
      };

      if (existingIndex >= 0) parts[existingIndex] = part;
      else parts = [...parts, part];
      changed.push(part);
    }

    this.commit(parts, connections, changed.at(-1)?.id ?? null);
    return changed;
  }

  removePart(id: string) {
    const parts = this.state.parts.filter((part) => part.id !== id);
    const connections = this.state.connections.filter(
      (connection) => !connection.from.startsWith(`${id}:`) && !connection.to.startsWith(`${id}:`),
    );
    this.commit(parts, connections, null);
  }

  addConnection(from: string, to: string, color = '#24a35a') {
    const existing = this.state.connections.find(
      (connection) =>
        (connection.from === from && connection.to === to)
        || (connection.from === to && connection.to === from),
    );
    if (existing) return existing;

    const id = nextNumericId(this.state.connections.map((connection) => connection.id), 'wire');
    const connection: CircuitConnection = { id, from, to, color };
    this.commit(this.state.parts, [...this.state.connections, connection], id);
    return connection;
  }

  applyConnections(
    incoming: Array<Omit<CircuitConnection, 'id'> & { id?: string }>,
    removeConnectionIds: string[] = [],
  ) {
    const removeSet = new Set(removeConnectionIds);
    const connections = this.state.connections.filter((connection) => !removeSet.has(connection.id));
    const results: CircuitConnection[] = [];

    for (const candidate of incoming) {
      const duplicate = connections.find(
        (connection) =>
          (connection.from === candidate.from && connection.to === candidate.to)
          || (connection.from === candidate.to && connection.to === candidate.from),
      );
      if (duplicate) {
        results.push(duplicate);
        continue;
      }
      const id = candidate.id || nextNumericId(connections.map((connection) => connection.id), 'wire');
      const connection: CircuitConnection = {
        id,
        from: candidate.from,
        to: candidate.to,
        color: candidate.color || '#24a35a',
      };
      connections.push(connection);
      results.push(connection);
    }

    this.commit(this.state.parts, connections, results.at(-1)?.id ?? null);
    return results;
  }

  removeConnection(id: string) {
    this.commit(
      this.state.parts,
      this.state.connections.filter((connection) => connection.id !== id),
      null,
    );
  }

  select(id: string | null) {
    this.setTransient({ selectedId: id });
  }

  focus(focus: FocusState | null, durationMs = 6500) {
    if (this.focusTimer !== null && typeof window !== 'undefined') window.clearTimeout(this.focusTimer);
    const firstItem = focus?.itemIds[0];
    this.setTransient({ focus, selectedId: firstItem ?? this.state.selectedId });
    if (focus && durationMs > 0 && typeof window !== 'undefined') {
      this.focusTimer = window.setTimeout(() => {
        if (this.state.focus === focus) this.setTransient({ focus: null });
      }, durationMs);
    }
  }

  setSimulation(patch: Partial<SimulationState>) {
    this.setTransient({ simulation: { ...this.state.simulation, ...patch } });
  }

  resetSimulation() {
    this.setTransient({ simulation: { ...STOPPED } });
  }

  replaceDocument(document: Pick<CircuitDocument, 'parts' | 'connections'>) {
    this.state = {
      ...this.state,
      parts: structuredClone(document.parts),
      connections: structuredClone(document.connections),
      selectedId: null,
      focus: null,
      simulation: { ...STOPPED },
    };
    this.history = [cloneSnapshot(this.state)];
    this.historyIndex = 0;
    this.emit();
  }
}

export const circuitStore = new CircuitStore();

