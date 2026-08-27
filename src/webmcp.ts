import { getPartPins, PART_ORDER, resolvePinName } from './parts';
import { diagnoseCircuit } from './sim/diagnostics';
import { simulator } from './sim/simulator';
import { circuitStore } from './store';
import type { FocusState, PartAttrs, PartType } from './types';

type ToolDefinition = {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
  execute: (
    input: Record<string, unknown>,
    options: { signal: AbortSignal },
  ) => unknown | Promise<unknown>;
};

type ModelContext = {
  registerTool: (
    tool: ToolDefinition,
    options?: { signal?: AbortSignal },
  ) => Promise<void>;
};

declare global {
  interface Window {
    __hardwareLabWebMcpController?: AbortController;
  }
}

const partTypeEnum = [...PART_ORDER];

function result(data: unknown) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
  };
}

function requireString(value: unknown, name: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

function canonicalEndpoint(endpoint: unknown) {
  const raw = requireString(endpoint, 'endpoint');
  const colon = raw.indexOf(':');
  if (colon <= 0) throw new Error(`Invalid endpoint "${raw}". Use partId:pinName.`);
  const partId = raw.slice(0, colon);
  const requestedPin = raw.slice(colon + 1);
  const part = circuitStore.getSnapshot().parts.find((candidate) => candidate.id === partId);
  if (!part) throw new Error(`Part "${partId}" does not exist.`);
  const pin = resolvePinName(part, requestedPin);
  if (!pin) throw new Error(`Pin "${requestedPin}" does not exist on ${partId}.`);
  return `${partId}:${pin}`;
}

function inspectCircuit(includePins = true) {
  const state = circuitStore.getSnapshot();
  return {
    canvas: {
      units: 'pixels',
      origin: 'top-left',
      usefulWorkingArea: { width: 1200, height: 720 },
    },
    supportedPartTypes: partTypeEnum,
    parts: state.parts.map((part) => ({
      id: part.id,
      type: part.type,
      left: part.left,
      top: part.top,
      rotate: part.rotate ?? 0,
      attrs: part.attrs,
      ...(part.code !== undefined ? { code: part.code } : {}),
      ...(includePins ? {
        pins: getPartPins(part).map((pin) => ({
          name: pin.name,
          description: pin.description,
          signals: pin.signals,
        })),
      } : {}),
    })),
    connections: state.connections,
    diagnostics: diagnoseCircuit(state),
    simulation: state.simulation,
  };
}

export async function registerWebMCPTools() {
  const modelContext = (document as Document & { modelContext?: ModelContext }).modelContext;
  if (!modelContext?.registerTool) return false;

  window.__hardwareLabWebMcpController?.abort();
  const controller = new AbortController();
  window.__hardwareLabWebMcpController = controller;
  const options = { signal: controller.signal };

  const tools: ToolDefinition[] = [
    {
      name: 'inspect-circuit',
      description: 'Read the live circuit workspace as structured parts, pins, wires, code, diagnostics, and simulation state. Use this instead of vision when reasoning about the current circuit.',
      inputSchema: {
        type: 'object',
        properties: {
          includePins: { type: 'boolean', description: 'Include semantic pin lists for every part. Defaults to true.' },
        },
      },
      annotations: { readOnlyHint: true },
      async execute(input) {
        return result(inspectCircuit(input.includePins !== false));
      },
    },
    {
      name: 'edit-circuit',
      description: 'Place, move, update, or remove circuit parts in one batch. This directly updates the visible workspace. Use replace=true with a parts array to lay out a whole new project in one call.',
      inputSchema: {
        type: 'object',
        properties: {
          replace: { type: 'boolean', description: 'Clear all existing parts and wires before adding the supplied parts.' },
          parts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Stable part ID. Omit to auto-generate.' },
                type: { type: 'string', enum: partTypeEnum },
                left: { type: 'number', description: 'X position in canvas pixels.' },
                top: { type: 'number', description: 'Y position in canvas pixels.' },
                rotate: { type: 'number' },
                attrs: { type: 'object', description: 'Part properties such as LED color or resistor value.' },
                code: { type: 'string', description: 'Arduino sketch when this part is an Arduino Uno.' },
              },
              required: ['type'],
            },
          },
          removePartIds: { type: 'array', items: { type: 'string' } },
        },
      },
      async execute(input) {
        const rawParts = Array.isArray(input.parts) ? input.parts : [];
        const parts = rawParts.map((raw, index) => {
          if (!raw || typeof raw !== 'object') throw new Error(`parts[${index}] must be an object.`);
          const value = raw as Record<string, unknown>;
          if (!partTypeEnum.includes(value.type as PartType)) throw new Error(`Unsupported part type: ${String(value.type)}`);
          if (value.id !== undefined && !/^[A-Za-z][A-Za-z0-9_-]*$/.test(String(value.id))) {
            throw new Error(`Invalid part id: ${String(value.id)}`);
          }
          return {
            ...(value.id !== undefined ? { id: String(value.id) } : {}),
            type: value.type as PartType,
            ...(typeof value.left === 'number' ? { left: value.left } : {}),
            ...(typeof value.top === 'number' ? { top: value.top } : {}),
            ...(typeof value.rotate === 'number' ? { rotate: value.rotate } : {}),
            ...(value.attrs && typeof value.attrs === 'object' ? { attrs: value.attrs as PartAttrs } : {}),
            ...(typeof value.code === 'string' ? { code: value.code } : {}),
          };
        });
        const removePartIds = Array.isArray(input.removePartIds)
          ? input.removePartIds.map((value) => requireString(value, 'removePartId'))
          : [];
        const changed = circuitStore.applyParts(parts, removePartIds, input.replace === true);
        return result({ changed: changed.map((part) => part.id), circuit: inspectCircuit(false) });
      },
    },
    {
      name: 'connect-pins',
      description: 'Create or remove many semantic wires in one call. Endpoints use partId:pinName, for example uno1:13 to led1:A. Pin names are validated before anything is changed.',
      inputSchema: {
        type: 'object',
        properties: {
          connections: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                from: { type: 'string' },
                to: { type: 'string' },
                color: { type: 'string' },
              },
              required: ['from', 'to'],
            },
          },
          removeConnectionIds: { type: 'array', items: { type: 'string' } },
        },
      },
      async execute(input) {
        const raw = Array.isArray(input.connections) ? input.connections : [];
        const connections = raw.map((entry, index) => {
          if (!entry || typeof entry !== 'object') throw new Error(`connections[${index}] must be an object.`);
          const value = entry as Record<string, unknown>;
          const from = canonicalEndpoint(value.from);
          const to = canonicalEndpoint(value.to);
          if (from === to) throw new Error(`connections[${index}] connects a pin to itself.`);
          return { from, to, color: typeof value.color === 'string' ? value.color : '#24a35a' };
        });
        const removeIds = Array.isArray(input.removeConnectionIds)
          ? input.removeConnectionIds.map((value) => requireString(value, 'removeConnectionId'))
          : [];
        const changed = circuitStore.applyConnections(connections, removeIds);
        return result({ changed: changed.map((wire) => wire.id), diagnostics: diagnoseCircuit(circuitStore.getSnapshot()) });
      },
    },
    {
      name: 'set-code',
      description: 'Replace the Arduino sketch for a board in the live workspace. Use complete Arduino C++ source.',
      inputSchema: {
        type: 'object',
        properties: {
          boardId: { type: 'string' },
          code: { type: 'string' },
        },
        required: ['boardId', 'code'],
      },
      async execute(input) {
        const boardId = requireString(input.boardId, 'boardId');
        const code = requireString(input.code, 'code');
        const board = circuitStore.getSnapshot().parts.find((part) => part.id === boardId);
        if (!board || board.type !== 'wokwi-arduino-uno') throw new Error(`${boardId} is not an Arduino Uno.`);
        circuitStore.setCode(boardId, code);
        return result({ boardId, lines: code.split('\n').length });
      },
    },
    {
      name: 'simulate',
      description: 'Start or stop the live Arduino simulation. Start compiles the current sketch to real AVR machine code, checks blocking circuit errors, then runs it in the visible workspace.',
      inputSchema: {
        type: 'object',
        properties: { action: { type: 'string', enum: ['start', 'stop'] } },
        required: ['action'],
      },
      async execute(input, executionOptions) {
        const action = requireString(input.action, 'action');
        if (action === 'stop') return result(simulator.stop());
        if (action !== 'start') throw new Error('action must be start or stop.');
        return result(await simulator.start(executionOptions.signal));
      },
    },
    {
      name: 'focus',
      description: 'Visually point the user to exact parts, wires, or Arduino code lines while teaching or diagnosing. The requested items pulse in the shared workspace.',
      inputSchema: {
        type: 'object',
        properties: {
          itemIds: { type: 'array', items: { type: 'string' } },
          message: { type: 'string' },
          code: {
            type: 'object',
            properties: {
              boardId: { type: 'string' },
              startLine: { type: 'integer', minimum: 1 },
              endLine: { type: 'integer', minimum: 1 },
            },
            required: ['boardId', 'startLine', 'endLine'],
          },
        },
      },
      async execute(input) {
        const state = circuitStore.getSnapshot();
        const knownIds = new Set([...state.parts.map((part) => part.id), ...state.connections.map((wire) => wire.id)]);
        const itemIds = Array.isArray(input.itemIds)
          ? input.itemIds.map((value) => requireString(value, 'itemId'))
          : [];
        for (const id of itemIds) if (!knownIds.has(id)) throw new Error(`Cannot focus unknown item "${id}".`);

        let code: FocusState['code'];
        if (input.code && typeof input.code === 'object') {
          const raw = input.code as Record<string, unknown>;
          const boardId = requireString(raw.boardId, 'code.boardId');
          const startLine = Number(raw.startLine);
          const endLine = Number(raw.endLine);
          const board = state.parts.find((part) => part.id === boardId && part.type === 'wokwi-arduino-uno');
          if (!board) throw new Error(`Unknown Arduino board "${boardId}".`);
          if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
            throw new Error('Invalid code line range.');
          }
          code = { boardId, startLine, endLine };
        }

        const focus: FocusState = {
          itemIds,
          ...(code ? { code } : {}),
          ...(typeof input.message === 'string' ? { message: input.message } : {}),
        };
        circuitStore.focus(focus, 9000);
        return result({ focused: focus });
      },
    },
  ];

  try {
    for (const tool of tools) await modelContext.registerTool(tool, options);
    return true;
  } catch (error) {
    console.warn('[WebMCP] Tool registration failed:', error);
    controller.abort();
    return false;
  }
}
