import type { PartType } from '../components/partTypes';
export type { PartType } from '../components/partTypes';


export type PartAttrs = Record<string, string | number | boolean>;

export type BreadboardSeating = {
  breadboardId: string;
  /** Component pin name -> breadboard hole name. */
  pins: Record<string, string>;
};

export type CircuitPart = {
  id: string;
  type: PartType;
  top: number;
  left: number;
  rotate?: number;
  attrs: PartAttrs;
  code?: string;
  seating?: BreadboardSeating;
};

export type WirePoint = {
  x: number;
  y: number;
};

export type CircuitConnection = {
  id: string;
  from: string;
  to: string;
  color: string;
  /** Semantic multi-terminal net this physical edge belongs to, when any. */
  netId?: string;
  /** User/agent-authored visual bend points. Electrical connectivity is from -> to. */
  waypoints?: WirePoint[];
};

export type Diagnostic = {
  severity: 'error' | 'warning' | 'info';
  message: string;
  itemIds: string[];
};

export type SimulationState = {
  status: 'stopped' | 'compiling' | 'running' | 'error';
  compileOutput: string;
  serialOutput: string;
  error: string | null;
};

export type CodeRange = {
  boardId: string;
  startLine: number;
  endLine: number;
};

export type FocusState = {
  itemIds: string[];
  /** Exact partId:pinName endpoints to mark on the visual workspace. */
  pins?: string[];
  code?: CodeRange;
  message?: string;
};

export type CircuitDocument = {
  version: 1;
  parts: CircuitPart[];
  connections: CircuitConnection[];
  selectedId: string | null;
  focus: FocusState | null;
  simulation: SimulationState;
};

export type PinInfo = {
  name: string;
  x: number;
  y: number;
  description?: string;
  signals?: Array<{
    type: string;
    signal?: string;
    channel?: number;
    voltage?: number;
  }>;
};

