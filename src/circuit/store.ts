import { defaultCode, getPartPins, PART_DEFINITIONS } from '../components/parts';
import { findOpenPlacement, CANVAS_CENTER_X, CANVAS_CENTER_Y } from '../layout/placement';
import { alignExplicitSeating, seatPartAtHole, snapPartPlacement, type BreadboardAnchor, type SnapMode } from '../breadboard/placement';
import { endpointPoint, pinExitDirection } from '../wires/geometry';
import { isOrthogonalPair, normalizeWaypoints, simplifyWirePoints } from '../wires/path';
import { isBreadboardType } from '../breadboard/geometry';
import type {
  CircuitConnection,
  CircuitDocument,
  CircuitPart,
  FocusState,
  PartAttrs,
  PartType,
  SimulationState,
  WirePoint,
} from './types';

type CircuitSnapshot = Pick<CircuitDocument, 'parts' | 'connections'>;

const STOPPED: SimulationState = {
  status: 'stopped',
  compileOutput: '',
  serialOutput: '',
  error: null,
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
    const id = nextNumericId(this.state.parts.map((part) => part.id), PART_DEFINITIONS[type].idPrefix);
    const open = findOpenPlacement(type, this.state.parts, { left, top });
    const draft: CircuitPart = {
      id,
      type,
      left: open.left,
      top: open.top,
      attrs: { ...PART_DEFINITIONS[type].defaults, ...attrs },
      ...(type === 'wokwi-arduino-uno' ? { code: defaultCode() } : {}),
    };
    // New parts should be born on the same physical connector lattice used by
    // breadboards and wire bends. Do not wait for the first manual drag to fix
    // their phase, and do not round away the sub-pixel 9.6px pitch.
    const snapped = snapPartPlacement(draft, open.left, open.top, this.state.parts, 'normal', 0);
    const part: CircuitPart = { ...draft, left: snapped.left, top: snapped.top, seating: snapped.seating };
    this.commit([...this.state.parts, part], this.state.connections, part.id);
    return part;
  }

  movePart(id: string, left: number, top: number, recordHistory = true, snapMode: SnapMode = 'normal', alignmentThreshold = 6) {
    const current = this.state.parts.find((part) => part.id === id);
    if (!current) return;
    const placement = snapPartPlacement(current, left, top, this.state.parts, snapMode, alignmentThreshold, this.state.connections);
    const moved: CircuitPart = {
      ...current,
      left: placement.left,
      top: placement.top,
      seating: placement.seating,
    };

    let parts: CircuitPart[];
    if (isBreadboardType(current.type)) {
      const dx = moved.left - current.left;
      const dy = moved.top - current.top;
      parts = this.state.parts.map((part) => {
        if (part.id === id) return moved;
        if (part.seating?.breadboardId === id) {
          return { ...part, left: part.left + dx, top: part.top + dy };
        }
        return part;
      });
    } else {
      parts = this.state.parts.map((part) => part.id === id ? moved : part);
    }
    if (recordHistory) this.commit(parts, this.state.connections, id);
    else this.setTransient({ parts, selectedId: id });
    return placement;
  }

  rotatePart(id: string, rotate: number) {
    const current = this.state.parts.find((part) => part.id === id);
    if (!current) return;
    const rotated: CircuitPart = { ...current, rotate };
    const snapped = snapPartPlacement(rotated, rotated.left, rotated.top, this.state.parts, 'normal', 0);
    const parts = this.state.parts.map((part) => part.id === id
      ? { ...rotated, left: snapped.left, top: snapped.top, seating: snapped.seating }
      : part);
    this.commit(parts, this.state.connections, id);
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
    incoming: Array<
      Partial<Omit<CircuitPart, 'type'>> & {
        type: PartType;
        id?: string;
        seat?: BreadboardAnchor;
        nudge?: { dx: number; dy: number };
        rotateBy?: number;
      }
    >,
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
      const id = candidate.id || nextNumericId(parts.map((part) => part.id), PART_DEFINITIONS[candidate.type].idPrefix);
      const code = candidate.code ?? existing?.code ?? (candidate.type === 'wokwi-arduino-uno' ? defaultCode() : undefined);
      const hasExplicitPosition = typeof candidate.left === 'number' || typeof candidate.top === 'number';
      const nudgeX = candidate.nudge ? candidate.nudge.dx * 32 : 0;
      const nudgeY = candidate.nudge ? candidate.nudge.dy * 32 : 0;
      const preferred = {
        left: (candidate.left ?? existing?.left ?? CANVAS_CENTER_X) + nudgeX,
        top: (candidate.top ?? existing?.top ?? CANVAS_CENTER_Y) + nudgeY,
      };
      const placement = existing || hasExplicitPosition || candidate.nudge
        ? preferred
        : findOpenPlacement(candidate.type, parts, preferred);
      const computedRotate = candidate.rotateBy !== undefined
        ? (((existing?.rotate ?? candidate.rotate ?? 0) + candidate.rotateBy) % 360 + 360) % 360
        : (candidate.rotate ?? existing?.rotate);

      let part: CircuitPart = {
        id,
        type: candidate.type,
        left: placement.left,
        top: placement.top,
        rotate: computedRotate,
        attrs: {
          ...PART_DEFINITIONS[candidate.type].defaults,
          ...(existing?.type === candidate.type ? existing.attrs : {}),
          ...(candidate.attrs ?? {}),
        },
        ...(code !== undefined ? { code } : {}),
        ...(candidate.seating !== undefined
          ? { seating: structuredClone(candidate.seating) }
          : existing?.seating !== undefined
            ? { seating: structuredClone(existing.seating) }
            : {}),
      };

      if (candidate.seat !== undefined && candidate.seating !== undefined) {
        throw new Error(`Cannot seat ${part.id}: use either seat or seating, not both.`);
      }
      if (candidate.seat !== undefined) {
        part = seatPartAtHole(part, [...parts, part], candidate.seat);
      } else if (candidate.seating !== undefined) {
        part = alignExplicitSeating(part, [...parts, part]);
      }

      if (existingIndex >= 0) parts[existingIndex] = part;
      else parts = [...parts, part];
      changed.push(part);
    }

    this.commit(parts, connections, changed.at(-1)?.id ?? null);
    return changed;
  }

  removePart(id: string) {
    const parts = this.state.parts
      .filter((part) => part.id !== id)
      .map((part) => part.seating?.breadboardId === id ? { ...part, seating: undefined } : part);
    const connections = this.state.connections.filter(
      (connection) => !connection.from.startsWith(`${id}:`) && !connection.to.startsWith(`${id}:`),
    );
    this.commit(parts, connections, null);
  }

  addConnection(
    from: string,
    to: string,
    color = '#24a35a',
    options: { waypoints?: WirePoint[] } = {},
  ) {
    const existing = this.state.connections.find(
      (connection) =>
        (connection.from === from && connection.to === to)
        || (connection.from === to && connection.to === from),
    );
    if (existing) return existing;

    const id = nextNumericId(this.state.connections.map((connection) => connection.id), 'wire');
    const connection: CircuitConnection = { id, from, to, color, waypoints: [] };
    if (options.waypoints !== undefined) {
      const start = endpointPoint(from, this.state.parts);
      const end = endpointPoint(to, this.state.parts);
      if (start && end) {
        const authored = normalizeWaypoints(start, options.waypoints, end);
        const points = [...authored];
        const last = points.at(-1) ?? start;
        if (!isOrthogonalPair(last, end)) {
          const direction = pinExitDirection(to, this.state.parts);
          points.push(direction === 'left' || direction === 'right'
            ? { x: last.x, y: end.y }
            : { x: end.x, y: last.y });
        }
        connection.waypoints = simplifyWirePoints(points);
      } else {
        connection.waypoints = structuredClone(options.waypoints);
      }
    } else {
      connection.waypoints = [];
    }
    this.commit(this.state.parts, [...this.state.connections, connection], id);
    return connection;
  }

  applyConnections(
    incoming: Array<Partial<CircuitConnection> & { id?: string; from?: string; to?: string }>,
    removeConnectionIds: string[] = [],
  ) {
    const removeSet = new Set(removeConnectionIds);
    const connections = this.state.connections.filter((connection) => !removeSet.has(connection.id));
    const results: CircuitConnection[] = [];

    for (const candidate of incoming) {
      const exactIdIndex = candidate.id ? connections.findIndex((connection) => connection.id === candidate.id) : -1;
      const duplicateIndex = (candidate.from && candidate.to) ? connections.findIndex(
        (connection) =>
          (connection.from === candidate.from && connection.to === candidate.to)
          || (connection.from === candidate.to && connection.to === candidate.from),
      ) : -1;
      const existingIndex = exactIdIndex >= 0 ? exactIdIndex : duplicateIndex;
      const existing = existingIndex >= 0 ? connections[existingIndex] : undefined;

      const from = candidate.from || existing?.from;
      const to = candidate.to || existing?.to;
      if (!from || !to) throw new Error('Connection requires both from and to endpoints.');

      const id = existing?.id || candidate.id || nextNumericId(connections.map((connection) => connection.id), 'wire');
      const connection: CircuitConnection = {
        id,
        from,
        to,
        color: candidate.color || existing?.color || '#24a35a',
        ...(candidate.netId || existing?.netId ? { netId: candidate.netId || existing?.netId } : {}),
        waypoints: [],
      };
      const requested = candidate.waypoints ?? existing?.waypoints ?? [];
      const start = endpointPoint(connection.from, this.state.parts);
      const end = endpointPoint(connection.to, this.state.parts);
      connection.waypoints = start && end ? normalizeWaypoints(start, requested, end) : structuredClone(requested);
      if (existingIndex >= 0) connections[existingIndex] = connection;
      else connections.push(connection);
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

  setConnectionWaypoints(id: string, waypoints: WirePoint[], recordHistory = true) {
    const existing = this.state.connections.find((connection) => connection.id === id);
    if (!existing) return;
    const connections = this.state.connections.map((connection) =>
      connection.id === id ? { ...connection, waypoints: structuredClone(waypoints) } : connection,
    );
    if (recordHistory) this.commit(this.state.parts, connections, id);
    else this.setTransient({ connections, selectedId: id });
  }

  setConnectionEndpoint(id: string, side: 'from' | 'to', endpoint: string) {
    const existing = this.state.connections.find((connection) => connection.id === id);
    if (!existing) return;
    const other = side === 'from' ? existing.to : existing.from;
    if (endpoint === other) throw new Error('A wire cannot connect both ends to the same pin.');
    if (!endpointPoint(endpoint, this.state.parts)) throw new Error(`Unknown wire endpoint: ${endpoint}`);

    const from = side === 'from' ? endpoint : existing.from;
    const to = side === 'to' ? endpoint : existing.to;
    const duplicate = this.state.connections.find((connection) => connection.id !== id && (
      (connection.from === from && connection.to === to)
      || (connection.from === to && connection.to === from)
    ));
    if (duplicate) throw new Error(`That connection already exists as ${duplicate.id}.`);

    const waypoints = structuredClone(existing.waypoints ?? []);
    const connections = this.state.connections.map((connection) =>
      connection.id === id ? { ...connection, from, to, waypoints } : connection,
    );
    this.commit(this.state.parts, connections, id);
  }

  previewConnectionWaypoints(id: string, waypoints: WirePoint[]) {
    const connections = this.state.connections.map((connection) =>
      connection.id === id
        ? { ...connection, waypoints: structuredClone(waypoints) }
        : connection,
    );
    this.setTransient({ connections, selectedId: id });
  }

  setConnectionColor(id: string, color: string) {
    const connections = this.state.connections.map((connection) =>
      connection.id === id ? { ...connection, color } : connection,
    );
    this.commit(this.state.parts, connections, id);
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
    const rawParts = structuredClone(document.parts);
    const parts = rawParts.map((part) => part.seating ? alignExplicitSeating(part, rawParts) : part);
    const connections: CircuitConnection[] = [];
    for (const rawConnection of structuredClone(document.connections)) {
      const connection = { ...rawConnection };
      connection.waypoints = rawConnection.waypoints ?? [];
      connections.push(connection);
    }
    this.state = {
      ...this.state,
      parts,
      connections,
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

