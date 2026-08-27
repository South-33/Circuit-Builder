import { getPartPins, PART_ORDER, resolvePinName } from '../components/parts';
import { buildAgentLayout, canvasPointToGrid, gridPartPlacement, gridPointToCanvas } from './layout';
import { WORKSPACE_HEIGHT, WORKSPACE_WIDTH } from '../layout/placement';
import { diagnoseCircuit } from '../sim/diagnostics';
import { simulator } from '../sim/simulator';
import { circuitStore } from '../circuit/store';
import { endpointPoint } from '../wires/geometry';
import type { FocusState, PartAttrs, PartType, WirePoint } from '../circuit/types';

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

function defaultWireColor(from: string, to: string, role?: string) {
  if (role === 'ground') return '#343a40';
  if (role === 'power') return '#d94841';
  if (role === 'signal') return '#2f9e44';
  const endpoints = `${from} ${to}`.toLowerCase();
  if (endpoints.includes(':gnd') || endpoints.includes(':-')) return '#343a40';
  if (endpoints.includes(':5v') || endpoints.includes(':3.3v') || endpoints.includes(':+')) return '#d94841';
  return '#2f9e44';
}

function validateOrthogonalGridWaypoints(points: Array<Record<string, unknown>>, connectionIndex: number) {
  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index];
    const b = points[index + 1];
    if (typeof a.x !== 'number' || typeof a.y !== 'number' || typeof b.x !== 'number' || typeof b.y !== 'number') continue;
    if (a.x !== b.x && a.y !== b.y) {
      throw new Error(`connections[${connectionIndex}].gridWaypoints must route like pipes: waypoint ${index} to ${index + 1} must share x or y (90-degree routing, no diagonals).`);
    }
  }
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

function inspectCircuit(includePins = false, includeLayout = true, pinPartIds: string[] = [], includeCode = false) {
  const state = circuitStore.getSnapshot();
  const pinFilter = new Set(pinPartIds);
  return {
    canvas: {
      units: 'pixels',
      origin: 'top-left',
      usefulWorkingArea: { width: WORKSPACE_WIDTH, height: WORKSPACE_HEIGHT },
    },
    supportedPartTypes: partTypeEnum,
    parts: state.parts.map((part) => ({
      id: part.id,
      type: part.type,
      left: part.left,
      top: part.top,
      rotate: part.rotate ?? 0,
      attrs: part.attrs,
      ...(part.seating ? { seating: part.seating } : {}),
      ...(includeCode && part.code !== undefined ? { code: part.code } : {}),
      ...(includePins && (!pinFilter.size || pinFilter.has(part.id)) ? {
        pins: getPartPins(part).map((pin) => {
          const location = endpointPoint(`${part.id}:${pin.name}`, state.parts);
          return {
            name: pin.name,
            description: pin.description,
            signals: pin.signals,
            ...(location ? { grid: canvasPointToGrid(location) } : {}),
          };
        }),
      } : {}),
    })),
    connections: state.connections,
    diagnostics: diagnoseCircuit(state),
    simulation: state.simulation,
    ...(includeLayout ? { layout: buildAgentLayout(state) } : {}),
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
      description: 'Read the live circuit workspace as structured parts, authored wire routes, code, diagnostics, simulation state, and a compact 2D planning grid. Pins are omitted by default to keep responses small; request them only for the parts you are about to wire.',
      inputSchema: {
        type: 'object',
        properties: {
          includePins: { type: 'boolean', description: 'Include semantic pin lists. Defaults to false.' },
          pinPartIds: { type: 'array', items: { type: 'string' }, description: 'When includePins=true, limit pin lists to these part IDs. Omit only when you truly need every pin.' },
          includeCode: { type: 'boolean', description: 'Include complete Arduino source. Defaults to false.' },
          includeLayout: { type: 'boolean', description: 'Include the compact agent planning grid and mechanical layout quality report. Defaults to true.' },
        },
      },
      annotations: { readOnlyHint: true },
      async execute(input) {
        const pinPartIds = Array.isArray(input.pinPartIds)
          ? input.pinPartIds.map((value) => requireString(value, 'pinPartId'))
          : [];
        return result(inspectCircuit(input.includePins === true, input.includeLayout !== false, pinPartIds, input.includeCode === true));
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
                left: { type: 'number', description: 'X position in canvas pixels. Prefer grid for agent-authored layouts.' },
                top: { type: 'number', description: 'Y position in canvas pixels. Prefer grid for agent-authored layouts.' },
                grid: {
                  type: 'object',
                  description: 'Preferred agent placement coordinate on the compact planning grid. Converted deterministically to canvas pixels.',
                  properties: { x: { type: 'number' }, y: { type: 'number' } },
                  required: ['x', 'y'],
                },
                rotate: { type: 'number' },
                attrs: { type: 'object', description: 'Part properties such as LED color or resistor value.' },
                seating: {
                  type: 'object',
                  description: 'Optional physical breadboard seating. Maps this component pin names to breadboard hole names.',
                  properties: {
                    breadboardId: { type: 'string' },
                    pins: { type: 'object', additionalProperties: { type: 'string' } },
                  },
                  required: ['breadboardId', 'pins'],
                },
                seat: {
                  type: 'object',
                  description: 'Preferred compact breadboard placement. Align one component pin to one named breadboard hole; the workbench infers the rest of the pin-to-hole seating from real geometry.',
                  properties: {
                    breadboardId: { type: 'string' },
                    pin: { type: 'string', description: 'Component pin used as the placement anchor, e.g. GND, A, 1.' },
                    hole: { type: 'string', description: 'Named breadboard hole, e.g. E20, A6, +top1.' },
                  },
                  required: ['breadboardId', 'pin', 'hole'],
                },
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
          const grid = value.grid && typeof value.grid === 'object' ? value.grid as Record<string, unknown> : null;
          const gridPlacement = grid && typeof grid.x === 'number' && typeof grid.y === 'number'
            ? gridPartPlacement({ x: grid.x, y: grid.y })
            : null;
          if (value.seating && value.seat) throw new Error(`parts[${index}] cannot specify both seating and seat.`);
          const seat = value.seat && typeof value.seat === 'object' ? value.seat as Record<string, unknown> : null;
          return {
            ...(value.id !== undefined ? { id: String(value.id) } : {}),
            type: value.type as PartType,
            ...(gridPlacement ? { left: gridPlacement.left, top: gridPlacement.top } : {}),
            ...(!gridPlacement && typeof value.left === 'number' ? { left: value.left } : {}),
            ...(!gridPlacement && typeof value.top === 'number' ? { top: value.top } : {}),
            ...(typeof value.rotate === 'number' ? { rotate: value.rotate } : {}),
            ...(value.attrs && typeof value.attrs === 'object' ? { attrs: value.attrs as PartAttrs } : {}),
            ...(value.seating && typeof value.seating === 'object'
              ? { seating: value.seating as { breadboardId: string; pins: Record<string, string> } }
              : {}),
            ...(seat ? {
              seat: {
                breadboardId: requireString(seat.breadboardId, `parts[${index}].seat.breadboardId`),
                pin: requireString(seat.pin, `parts[${index}].seat.pin`),
                hole: requireString(seat.hole, `parts[${index}].seat.hole`),
              },
            } : {}),
            ...(typeof value.code === 'string' ? { code: value.code } : {}),
          };
        });
        const removePartIds = Array.isArray(input.removePartIds)
          ? input.removePartIds.map((value) => requireString(value, 'removePartId'))
          : [];
        const changed = circuitStore.applyParts(parts, removePartIds, input.replace === true);
        return result({ changed: changed.map((part) => part.id), circuit: inspectCircuit(false, true) });
      },
    },
    {
      name: 'connect-pins',
      description: 'Create or remove many semantic wires in one call. Endpoints use partId:pinName. You own the route: inspect the 2D grid, then provide gridWaypoints that draw the wire like plumbing. The workbench preserves your interior path and only snaps the final lead-ins to exact physical pins. Prefer long straight runs, few 90-degree bends, separate parallel lanes, and no overlap through components.',
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
                color: { type: 'string', description: 'Explicit wire color. If omitted, role/endpoints choose a stable semantic default.' },
                role: { type: 'string', enum: ['signal', 'power', 'ground'], description: 'Optional semantic wire role. Defaults: signal green, power red, ground dark.' },
                waypoints: {
                  type: 'array',
                  description: 'Optional exact bend points in canvas pixels. Humans may use this directly; agents should prefer gridWaypoints.',
                  items: {
                    type: 'object',
                    properties: { x: { type: 'number' }, y: { type: 'number' } },
                    required: ['x', 'y'],
                  },
                },
                gridWaypoints: {
                  type: 'array',
                  description: 'Agent-authored route on the planning grid. Consecutive points must share x or y. The route is authoritative: no automatic rerouter will change it later.',
                  items: {
                    type: 'object',
                    properties: { x: { type: 'number' }, y: { type: 'number' } },
                    required: ['x', 'y'],
                  },
                },
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
          if (Array.isArray(value.waypoints) && Array.isArray(value.gridWaypoints)) {
            throw new Error(`connections[${index}] cannot specify both waypoints and gridWaypoints.`);
          }
          if (Array.isArray(value.gridWaypoints)) {
            validateOrthogonalGridWaypoints(value.gridWaypoints as Array<Record<string, unknown>>, index);
          }
          const rawWaypoints = Array.isArray(value.gridWaypoints)
            ? value.gridWaypoints.map((point, pointIndex) => {
                if (!point || typeof point !== 'object') throw new Error(`connections[${index}].gridWaypoints[${pointIndex}] must be a point.`);
                const rawPoint = point as Record<string, unknown>;
                if (typeof rawPoint.x !== 'number' || typeof rawPoint.y !== 'number') {
                  throw new Error(`connections[${index}].gridWaypoints[${pointIndex}] requires numeric x and y.`);
                }
                return gridPointToCanvas({ x: rawPoint.x, y: rawPoint.y });
              })
            : value.waypoints;
          const waypoints = Array.isArray(rawWaypoints)
            ? rawWaypoints.map((point, pointIndex) => {
                if (!point || typeof point !== 'object') throw new Error(`connections[${index}].waypoints[${pointIndex}] must be a point.`);
                const rawPoint = point as Record<string, unknown>;
                if (typeof rawPoint.x !== 'number' || typeof rawPoint.y !== 'number') {
                  throw new Error(`connections[${index}].waypoints[${pointIndex}] requires numeric x and y.`);
                }
                return { x: rawPoint.x, y: rawPoint.y } satisfies WirePoint;
              })
            : undefined;
          return {
            from,
            to,
            color: typeof value.color === 'string'
              ? value.color
              : defaultWireColor(from, to, typeof value.role === 'string' ? value.role : undefined),
            ...(waypoints !== undefined ? { waypoints } : {}),
          };
        });
        const removeIds = Array.isArray(input.removeConnectionIds)
          ? input.removeConnectionIds.map((value) => requireString(value, 'removeConnectionId'))
          : [];
        const changed = circuitStore.applyConnections(connections, removeIds);
        const state = circuitStore.getSnapshot();
        return result({ changed: changed.map((wire) => wire.id), diagnostics: diagnoseCircuit(state), layout: buildAgentLayout(state) });
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
