export type PartType =
  | 'wokwi-arduino-uno'
  | 'breadboard'
  | 'wokwi-led'
  | 'wokwi-rgb-led'
  | 'wokwi-resistor'
  | 'wokwi-pushbutton'
  | 'wokwi-slide-switch'
  | 'wokwi-potentiometer'
  | 'wokwi-buzzer'
  | 'wokwi-7segment';

export type PartAttrs = Record<string, string | number | boolean>;

export type CircuitPart = {
  id: string;
  type: PartType;
  top: number;
  left: number;
  rotate?: number;
  attrs: PartAttrs;
  code?: string;
};

export type CircuitConnection = {
  id: string;
  from: string;
  to: string;
  color: string;
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

