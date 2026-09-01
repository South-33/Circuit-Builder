import { BREADBOARD_HOLE_PITCH, getBreadboardGeometry, isBreadboardType } from '../breadboard/geometry';
import { getPartPins, PART_DEFINITIONS } from '../components/parts';
import { circuitStore } from '../circuit/store';
import type { FocusState } from '../circuit/types';
import { evaluateLayout } from '../layout/quality';
import { buildCircuitGraph, directlyConnectedNodes } from '../sim/circuitGraph';
import { diagnoseCircuit } from '../sim/diagnostics';
import { simulator } from '../sim/simulator';
import { WIRING_GUIDE } from '../wires/conventions';
import { endpointPoint, pinExitDirection } from '../wires/geometry';
import { createBuildCircuitTool } from './buildCircuit';
import { BLOCK_UNITS_PER_CELL, blockDefinition, blockPlacement, partBlockAt } from './geometry';
import { agentPartType, agentPartTypeEnum, canonicalEndpoint, requirePartType, requireString } from './input';
import { toolResult } from './protocol';
import type { ModelContext, ToolDefinition } from './types';

declare global {
  interface Window {
    __hardwareLabWebMcpController?: AbortController;
    __webmcp_tools__?: ToolDefinition[];
    webmcp_list_tools?: () => Array<{ name: string; description: string; inputSchema?: Record<string, unknown> }>;
    webmcp_call_tool?: (name: string, input?: Record<string, unknown>) => Promise<unknown>;
    modelContext?: ModelContext;
  }
}

function catalogEntry(requestedType: string, index: number) {
  const type = requirePartType(requestedType, `catalogTypes[${index}]`);
  const definition = PART_DEFINITIONS[type];
  const block = blockDefinition(type, 0);
  const temp = {
    id: `catalog${index + 1}`,
    type,
    ...blockPlacement(type, { x: 0, y: 0 }),
    rotate: 0,
    attrs: { ...definition.defaults },
  };
  const breadboard = isBreadboardType(type) ? getBreadboardGeometry(type) : null;
  return {
    type: agentPartType(type),
    name: definition.name,
    breadboardMount: definition.breadboardMount === true,
    pinSummary: definition.pinSummary,
    blockSize: {
      rotation0: { w: block.w, h: block.h },
      rotation90: (() => { const block = blockDefinition(type, 90); return { w: block.w, h: block.h }; })(),
    },
    agentShadow: { unitsPerCell: BLOCK_UNITS_PER_CELL, size: block.unitSize },
    ...(breadboard ? {
      breadboard: {
        holePitchPx: BREADBOARD_HOLE_PITCH,
        rows: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
        columns: breadboard.columns,
        railHoleRange: [1, breadboard.railHoles],
        rails: ['-top', '+top', '-bottom', '+bottom'],
      },
    } : {}),
    pins: getPartPins(temp).map((pin) => ({
      name: pin.name,
      exit: pinExitDirection(`${temp.id}:${pin.name}`, [temp]),
      blockOffset: block.pins[pin.name]?.at,
      edgeOffset: block.pins[pin.name]?.edgeOffset,
      unitAt: block.pins[pin.name]?.unitAt,
      edgeUnit: block.pins[pin.name]?.edgeUnit,
    })),
  };
}

function inspectCircuit(input: Record<string, unknown>) {
  const state = circuitStore.getSnapshot();
  const partIds = Array.isArray(input.partIds)
    ? input.partIds.map((value) => requireString(value, 'partId'))
    : undefined;
  const partFilter = partIds?.length ? new Set(partIds) : null;
  const pinPartIds = Array.isArray(input.pinPartIds)
    ? input.pinPartIds.map((value) => requireString(value, 'pinPartId'))
    : [];
  const pinFilter = new Set(pinPartIds);
  const parts = partFilter ? state.parts.filter((part) => partFilter.has(part.id)) : state.parts;
  const connections = partFilter
    ? state.connections.filter((wire) => partFilter.has(wire.from.split(':')[0]) || partFilter.has(wire.to.split(':')[0]))
    : state.connections;

  let netTrace: string[] | undefined;
  if (typeof input.netOf === 'string' && input.netOf.trim()) {
    const root = canonicalEndpoint(input.netOf.trim());
    netTrace = Array.from(directlyConnectedNodes(buildCircuitGraph(state), root));
  }

  const catalogTypes = Array.isArray(input.catalogTypes)
    ? input.catalogTypes.map((value) => requireString(value, 'catalogType'))
    : [];

  const includePins = input.includePins === true;
  const includeCode = input.includeCode === true;
  const includeLayout = input.includeLayout === true;

  return {
    coordinateSystem: {
      origin: 'workbench-center',
      cellPixels: BREADBOARD_HOLE_PITCH,
      agentUnitsPerCell: BLOCK_UNITS_PER_CELL,
      componentCoordinate: 'block top-left cell',
    },
    availablePartTypes: agentPartTypeEnum,
    parts: parts.map((part) => {
      const block = blockDefinition(part.type, part.rotate ?? 0);
      return {
        id: part.id,
        type: agentPartType(part.type),
        ...(!part.seating ? { blockAt: partBlockAt(part), blockSize: { w: block.w, h: block.h } } : {}),
        ...(part.rotate ? { rotate: part.rotate } : {}),
        ...(part.attrs && Object.keys(part.attrs).length ? { attrs: part.attrs } : {}),
        ...(part.seating ? { seating: part.seating } : {}),
        ...(includeCode && part.code !== undefined ? { code: part.code } : {}),
        ...(includePins && (!pinFilter.size || pinFilter.has(part.id)) ? {
          pins: getPartPins(part).map((pin) => ({
            name: pin.name,
            exit: pinExitDirection(`${part.id}:${pin.name}`, state.parts),
            blockOffset: block.pins[pin.name]?.at,
            edgeOffset: block.pins[pin.name]?.edgeOffset,
            unitAt: block.pins[pin.name]?.unitAt,
            edgeUnit: block.pins[pin.name]?.edgeUnit,
          })),
        } : {}),
      };
    }),
    connections: connections.map((wire) => ({
      id: wire.id,
      ...(wire.netId ? { netId: wire.netId } : {}),
      from: wire.from,
      to: wire.to,
      color: wire.color,
      ...(wire.waypoints?.length ? { routePx: wire.waypoints } : {}),
    })),
    ...(netTrace ? { net: { root: input.netOf, connectedNodes: netTrace } } : {}),
    diagnostics: diagnoseCircuit(state),
    layoutQuality: evaluateLayout(state),
    simulation: {
      status: state.simulation.status,
      ...(state.simulation.error ? { error: state.simulation.error } : {}),
      ...(state.simulation.serialOutput ? { serialOutput: state.simulation.serialOutput } : {}),
    },
    ...(catalogTypes.length ? { catalog: catalogTypes.map(catalogEntry) } : {}),
    ...(input.includeGuidance === true ? { wiringGuide: WIRING_GUIDE } : {}),
    ...(includeLayout ? {
      layout: {
        kind: 'block-grid',
        cellPixels: BREADBOARD_HOLE_PITCH,
        parts: parts.filter((part) => !part.seating).map((part) => {
          const block = blockDefinition(part.type, part.rotate ?? 0);
          return { id: part.id, at: partBlockAt(part), size: { w: block.w, h: block.h } };
        }),
      },
    } : {}),
  };
}

function commonTools(): ToolDefinition[] {
  return [
    {
      name: 'inspect-circuit',
      description: 'Read exact circuit state, diagnostics, nets, code, and optional block-grid layout. Pins include exit side, exact block-relative position, and ordered edge offset. build-circuit contains starter geometry; request catalogTypes only for non-starter footprints or exact connector maps.',
      inputSchema: {
        type: 'object',
        properties: {
          partIds: { type: 'array', items: { type: 'string' } },
          netOf: { type: 'string' },
          includePins: { type: 'boolean' },
          pinPartIds: { type: 'array', items: { type: 'string' } },
          includeCode: { type: 'boolean' },
          includeLayout: { type: 'boolean' },
          catalogTypes: { type: 'array', items: { type: 'string', enum: agentPartTypeEnum } },
          includeGuidance: { type: 'boolean' },
        },
      },
      annotations: { readOnlyHint: true },
      async execute(input) {
        return toolResult(inspectCircuit(input));
      },
    },
    createBuildCircuitTool(),
    {
      name: 'set-code',
      description: 'Replace the complete Arduino sketch on an Arduino Uno.',
      inputSchema: {
        type: 'object',
        properties: { boardId: { type: 'string' }, code: { type: 'string' } },
        required: ['boardId', 'code'],
      },
      async execute(input) {
        const boardId = requireString(input.boardId, 'boardId');
        const code = requireString(input.code, 'code');
        const board = circuitStore.getSnapshot().parts.find((part) => part.id === boardId);
        if (!board || board.type !== 'wokwi-arduino-uno') throw new Error(`${boardId} is not an Arduino Uno.`);
        circuitStore.setCode(boardId, code);
        return toolResult({ boardId, lines: code.split('\n').length });
      },
    },
    {
      name: 'simulate',
      description: 'Start, observe, or stop Arduino simulation. Observation samples visible runtime behavior such as LEDs, servo angle, motors, displays, and serial output.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['start', 'observe', 'stop'] },
          observeMs: { type: 'number', minimum: 0, maximum: 5000 },
          samples: { type: 'integer', minimum: 1, maximum: 30 },
        },
        required: ['action'],
      },
      async execute(input, options) {
        const action = requireString(input.action, 'action');
        if (action === 'stop') return toolResult(simulator.stop());
        const samples = typeof input.samples === 'number' ? input.samples : 6;
        if (action === 'observe') {
          const observeMs = typeof input.observeMs === 'number' ? input.observeMs : 400;
          return toolResult(await simulator.observe(observeMs, samples, options.signal));
        }
        if (action !== 'start') throw new Error('action must be start, observe, or stop.');
        const simulation = await simulator.start(options.signal);
        const observation = typeof input.observeMs === 'number' && input.observeMs > 0
          ? await simulator.observe(input.observeMs, samples, options.signal)
          : undefined;
        const state = circuitStore.getSnapshot();
        return toolResult({
          ...simulation,
          ...(observation ? { observation } : {}),
          layoutQuality: evaluateLayout(state),
          diagnostics: diagnoseCircuit(state),
        });
      },
    },
    {
      name: 'focus',
      description: 'Highlight exact parts, wires, pins, or Arduino code lines in the shared workspace. Use pins for a temporary marked visual when inspecting or explaining a connection.',
      inputSchema: {
        type: 'object',
        properties: {
          itemIds: { type: 'array', items: { type: 'string' } },
          pins: { type: 'array', items: { type: 'string' }, description: 'Exact endpoints such as uno:9 or servo:PWM.' },
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
        const itemIds = Array.isArray(input.itemIds) ? input.itemIds.map((value) => requireString(value, 'itemId')) : [];
        for (const id of itemIds) if (!knownIds.has(id)) throw new Error(`Cannot focus unknown item "${id}".`);
        const pins = Array.isArray(input.pins) ? input.pins.map((value) => canonicalEndpoint(value, state.parts)) : [];

        let code: FocusState['code'];
        if (input.code && typeof input.code === 'object') {
          const raw = input.code as Record<string, unknown>;
          const boardId = requireString(raw.boardId, 'code.boardId');
          const startLine = Number(raw.startLine);
          const endLine = Number(raw.endLine);
          const board = state.parts.find((part) => part.id === boardId && part.type === 'wokwi-arduino-uno');
          if (!board) throw new Error(`Unknown Arduino board "${boardId}".`);
          if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) throw new Error('Invalid code line range.');
          code = { boardId, startLine, endLine };
        }
        const focus: FocusState = {
          itemIds,
          ...(pins.length ? { pins } : {}),
          ...(code ? { code } : {}),
          ...(typeof input.message === 'string' ? { message: input.message } : {}),
        };
        circuitStore.focus(focus, 9000);
        return toolResult({ focused: focus });
      },
    },
  ];
}

export async function registerWebMCPTools() {
  window.__hardwareLabWebMcpController?.abort();
  const controller = new AbortController();
  window.__hardwareLabWebMcpController = controller;
  const options = { signal: controller.signal };
  const tools = commonTools();

  for (const tool of tools) {
    const execute = tool.execute;
    tool.execute = async (input, executionOptions) => {
      const output = await execute(input, executionOptions);
      if (tool.name === 'build-circuit' && typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new Event('webmcp:frame-circuit'));
      }
      return output;
    };
  }

  const findTool = (name: string) => tools.find((tool) =>
    tool.name === name || tool.name.replace(/-/g, '_') === name || tool.name.replace(/_/g, '-') === name,
  );

  window.__webmcp_tools__ = tools;
  window.webmcp_list_tools = () => tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  window.webmcp_call_tool = async (name, input = {}) => {
    const tool = findTool(name);
    if (!tool) throw new Error(`WebMCP tool "${name}" not found.`);
    return tool.execute(input, options);
  };

  const existingDocContext = (document as Document & { modelContext?: ModelContext }).modelContext;
  const existingWinContext = (window as Window & { modelContext?: ModelContext }).modelContext;
  const existingNavContext = (navigator as unknown as { modelContext?: ModelContext }).modelContext;

  try {
    if (existingDocContext?.registerTool) for (const tool of tools) await existingDocContext.registerTool(tool, options);
    if (existingWinContext?.registerTool && existingWinContext !== existingDocContext) for (const tool of tools) await existingWinContext.registerTool(tool, options);
    if (existingNavContext?.registerTool && existingNavContext !== existingDocContext) for (const tool of tools) await existingNavContext.registerTool(tool, options);
  } catch (error) {
    console.warn('[WebMCP] Native tool registration warning:', error);
  }

  const registered = new Map<string, ToolDefinition>();
  for (const tool of tools) {
    registered.set(tool.name, tool);
    registered.set(tool.name.replace(/-/g, '_'), tool);
  }

  const polyfill: ModelContext & {
    listTools: () => Promise<Array<{ name: string; description: string; inputSchema?: Record<string, unknown> }>>;
    callTool: (name: string, input?: Record<string, unknown>) => Promise<unknown>;
  } = {
    registerTool: async (tool) => {
      registered.set(tool.name, tool);
      registered.set(tool.name.replace(/-/g, '_'), tool);
    },
    getTools: async () => tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    listTools: async () => tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    executeTool: async (name, input = {}) => {
      const tool = registered.get(name) || findTool(name);
      if (!tool) throw new Error(`Tool "${name}" not registered.`);
      return tool.execute(input, options);
    },
    callTool: async (name, input = {}) => {
      const tool = registered.get(name) || findTool(name);
      if (!tool) throw new Error(`Tool "${name}" not registered.`);
      return tool.execute(input, options);
    },
  };

  const defineModelContext = (target: object) => {
    try {
      Object.defineProperty(target, 'modelContext', { value: polyfill, writable: true, configurable: true, enumerable: true });
    } catch {
      try { (target as { modelContext?: unknown }).modelContext = polyfill; } catch { /* immutable host */ }
    }
  };

  if (!existingWinContext) defineModelContext(window);
  if (!existingDocContext) defineModelContext(document);
  if (!existingNavContext) defineModelContext(navigator);
  return true;
}
