import { getPartBounds, getPartPins, PART_DEFINITIONS } from '../components/parts';
import { BREADBOARD_HOLE_PITCH, getBreadboardGeometry, isBreadboardType } from '../breadboard/geometry';
import { buildAgentLayout, canvasPointToGrid, evaluateLayout, gridCenterPlacement, partCenterGrid, partGridSize } from './core/layout';
import { agentRunRecorder, listBenchmarkRuns, persistBenchmarkRun } from './core/session';
import { agentPartType, agentPartTypeEnum, canonicalEndpoint, requirePartType, requireString } from './core/actions';
import { toolResult as result } from './core/protocol';
import type { ModelContext, ToolDefinition } from './types';
import { createActiveHarnessTool, getActiveHarnessId, HARNESS_INFO } from './profiles';
import { createLegacyHarnessTools } from './profiles/legacy';
import { diagnoseCircuit } from '../sim/diagnostics';
import { buildCircuitGraph, directlyConnectedNodes } from '../sim/circuitGraph';
import { simulator } from '../sim/simulator';
import { circuitStore } from '../circuit/store';
import { endpointPoint, pinExitDirection } from '../wires/geometry';
import type { FocusState } from '../circuit/types';
import { WIRING_GUIDE } from './core/wiring';

declare global {
  interface Window {
    __hardwareLabWebMcpController?: AbortController;
    __webmcp_tools__?: ToolDefinition[];
    webmcp_list_tools?: () => Array<{ name: string; description: string; inputSchema?: Record<string, unknown> }>;
    webmcp_call_tool?: (name: string, input?: Record<string, unknown>) => Promise<unknown>;
    modelContext?: ModelContext;
    __webmcp_last_run__?: unknown;
  }
}

function inspectCircuit(
  includePins = false,
  includeLayout = true,
  pinPartIds: string[] = [],
  includeCode = false,
  netOf?: string,
  filterPartIds?: string[],
  catalogTypes: string[] = [],
  includeGuidance = false,
) {
  const state = circuitStore.getSnapshot();
  const pinFilter = new Set(pinPartIds);
  const partFilter = filterPartIds?.length ? new Set(filterPartIds) : null;
  const parts = partFilter ? state.parts.filter((p) => partFilter.has(p.id)) : state.parts;
  const connections = partFilter
    ? state.connections.filter((c) => {
        const fromPart = c.from.split(':')[0];
        const toPart = c.to.split(':')[0];
        return partFilter.has(fromPart) || partFilter.has(toPart);
      })
    : state.connections;

  let netTrace: string[] | undefined;
  if (netOf) {
    const canonical = canonicalEndpoint(netOf);
    const graph = buildCircuitGraph(state);
    netTrace = Array.from(directlyConnectedNodes(graph, canonical));
  }

  const harnessId = getActiveHarnessId();
  const catalog = catalogTypes.map((requestedType, index) => {
    const type = requirePartType(requestedType, `catalogTypes[${index}]`);
    const definition = PART_DEFINITIONS[type];
    const placement = gridCenterPlacement(type, { x: 0, y: 0 });
    const temp = {
      id: `catalog${index + 1}`,
      type,
      ...placement,
      rotate: 0,
      attrs: { ...definition.defaults },
    };
    const pins = getPartPins(temp);
    const bounds = getPartBounds(type);
    const center = { x: temp.left + bounds.width / 2, y: temp.top + bounds.height / 2 };
    const breadboard = isBreadboardType(type) ? getBreadboardGeometry(type) : null;
    return {
      type: agentPartType(type),
      name: definition.name,
      breadboardMount: definition.breadboardMount === true,
      pinSummary: definition.pinSummary,
      gridSize: {
        rotation0: partGridSize(type, 0),
        rotation90: partGridSize(type, 90),
      },
      ...(breadboard ? {
        breadboard: {
          holePitchPx: BREADBOARD_HOLE_PITCH,
          rows: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
          columns: breadboard.columns,
          railHoleRange: [1, breadboard.railHoles],
          rails: ['-top', '+top', '-bottom', '+bottom'],
          note: 'Hole names are row+column (A1..J30/63). Rail names are e.g. +top1 or -bottom25.',
        },
      } : {}),
      ...(pins.length <= 32 ? {
        pins: pins.map((pin) => {
          const location = endpointPoint(`${temp.id}:${pin.name}`, [temp]);
          return {
            name: pin.name,
            exit: pinExitDirection(`${temp.id}:${pin.name}`, [temp]),
            ...(location ? {
              offsetPx: { x: Math.round((location.x - center.x) * 100) / 100, y: Math.round((location.y - center.y) * 100) / 100 },
              offsetGrid: { x: Math.round(((location.x - center.x) / 32) * 100) / 100, y: Math.round(((location.y - center.y) / 32) * 100) / 100 },
            } : {}),
          };
        }),
      } : {}),
    };
  });
  return {
    harness: { id: harnessId, ...HARNESS_INFO[harnessId] },
    availablePartTypes: agentPartTypeEnum,
    coordinateSystem: { origin: 'workbench-center', planningCellPixels: 32, physicalPitchPixels: BREADBOARD_HOLE_PITCH, componentCoordinate: harnessId === 'legacy' ? 'legacy-top-left-grid plus centerGrid' : 'centerGrid' },
    parts: parts.map((part) => ({
      id: part.id,
      type: agentPartType(part.type),
      grid: canvasPointToGrid({ x: part.left, y: part.top }),
      centerGrid: partCenterGrid(part),
      // gridSize: number of agent grid cells this part occupies (width Ã— height).
      // Cells from grid.x to grid.x+gridSize.w-1 and grid.y to grid.y+gridSize.h-1 are taken.
      gridSize: partGridSize(part),
      ...(part.rotate ? { rotate: part.rotate } : {}),
      ...(part.attrs && Object.keys(part.attrs).length ? { attrs: part.attrs } : {}),
      ...(part.seating ? { seating: part.seating } : {}),
      ...(includeCode && part.code !== undefined ? { code: part.code } : {}),
      ...(includePins && (!pinFilter.size || pinFilter.has(part.id)) ? {
        pins: getPartPins(part).map((pin) => {
          const location = endpointPoint(`${part.id}:${pin.name}`, state.parts);
          return {
            name: pin.name,
            ...(location ? {
              grid: canvasPointToGrid(location),
              canvas: { x: Math.round(location.x * 100) / 100, y: Math.round(location.y * 100) / 100 },
            } : {}),
          };
        }),
      } : {}),
    })),
    connections: connections.map((connection) => ({
      id: connection.id,
      from: connection.from,
      to: connection.to,
      color: connection.color,
      ...(connection.waypoints?.length ? { gridWaypoints: connection.waypoints.map(canvasPointToGrid) } : {}),
    })),
    ...(netTrace ? { net: { root: netOf, connectedNodes: netTrace } } : {}),
    diagnostics: diagnoseCircuit(state),
    layoutQuality: evaluateLayout(state),
    simulation: {
      status: state.simulation.status,
      ...(state.simulation.error ? { error: state.simulation.error } : {}),
      ...(state.simulation.serialOutput ? { serialOutput: state.simulation.serialOutput } : {}),
    },
    ...(catalog.length ? { catalog } : {}),
    ...(includeGuidance ? { wiringGuide: WIRING_GUIDE } : {}),
    ...(includeLayout ? { layout: buildAgentLayout(state) } : {}),
  };
}

export async function registerWebMCPTools() {
  window.__hardwareLabWebMcpController?.abort();
  const controller = new AbortController();
  window.__hardwareLabWebMcpController = controller;
  const options = { signal: controller.signal };
  const harnessId = getActiveHarnessId();
  agentRunRecorder.reset(harnessId);

  const tools: ToolDefinition[] = [
    {
      name: 'inspect-circuit',
      description: 'Read exact circuit state. On experimental harnesses this is compact by default to reduce latency; request includeLayout=true only when you need the ASCII map. Before the first build, request catalogTypes for all needed component types in one call to get footprints, mount support, pins, and pin exit sides so you can place correctly on the first attempt. includeGuidance=true returns the shared wiring/color rules. You can also trace an electrical net using netOf.',
      inputSchema: {
        type: 'object',
        properties: {
          partIds: { type: 'array', items: { type: 'string' }, description: 'Limit inspection to these specific part IDs.' },
          netOf: { type: 'string', description: 'Trace and return all electrically connected nodes on the net connected to partId:pinName (e.g. uno1:5V).' },
          includePins: { type: 'boolean', description: 'Include semantic pin lists. Defaults to false.' },
          pinPartIds: { type: 'array', items: { type: 'string' }, description: 'When includePins=true, limit pin lists to these part IDs.' },
          includeCode: { type: 'boolean', description: 'Include complete Arduino source. Defaults to false.' },
          includeLayout: { type: 'boolean', description: 'Include the ASCII planning map and mechanical layout report. Defaults to true on legacy and false on A/B/C to keep normal inspection small.' },
          catalogTypes: { type: 'array', items: { type: 'string', enum: agentPartTypeEnum }, description: 'One-shot preflight metadata for the component types you plan to use. Prefer requesting all needed types together.' },
          includeGuidance: { type: 'boolean', description: 'Include shared wire color, pin-exit, monotonic-flow, lane, and power-trunk guidance.' },
        },
      },
      annotations: { readOnlyHint: true },
      async execute(input) {
        const pinPartIds = Array.isArray(input.pinPartIds)
          ? input.pinPartIds.map((value) => requireString(value, 'pinPartId'))
          : [];
        const partIds = Array.isArray(input.partIds)
          ? input.partIds.map((value) => requireString(value, 'partId'))
          : undefined;
        const netOf = typeof input.netOf === 'string' && input.netOf.trim() ? input.netOf.trim() : undefined;
        const catalogTypes = Array.isArray(input.catalogTypes)
          ? input.catalogTypes.map((value) => requireString(value, 'catalogType'))
          : [];
        const includeLayout = input.includeLayout === true || (harnessId === 'legacy' && input.includeLayout !== false);
        return result(inspectCircuit(input.includePins === true, includeLayout, pinPartIds, input.includeCode === true, netOf, partIds, catalogTypes, input.includeGuidance === true));
      },
    },
    ...createLegacyHarnessTools(() => inspectCircuit(false, true)),
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
        const simulation = await simulator.start(executionOptions.signal);
        const state = circuitStore.getSnapshot();
        return result({
          ...simulation,
          layoutQuality: evaluateLayout(state),
          diagnostics: diagnoseCircuit(state),
        });
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

  const profileTool = createActiveHarnessTool(harnessId);
  if (profileTool) {
    for (let index = tools.length - 1; index >= 0; index--) {
      if (tools[index].name === 'edit-circuit' || tools[index].name === 'connect-pins') tools.splice(index, 1);
    }
    tools.splice(1, 0, profileTool);
  }

  tools.push({
    name: 'benchmark-run',
    description: 'Experiment logging for harness comparison. Call action=start before a benchmark attempt and action=finish at the end. Finish returns deterministic layout, diagnostics, centering, wire-length, bend, traffic, latency, and call-log metrics; notes are optional agent observations.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'report', 'finish', 'history'] },
        label: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['action'],
    },
    async execute(input) {
      const action = requireString(input.action, 'action');
      if (action === 'start') {
        agentRunRecorder.reset(harnessId, typeof input.label === 'string' ? input.label : '');
        return result({ started: true, harness: harnessId, ...HARNESS_INFO[harnessId] });
      }
      if (action === 'history') {
        const runs = listBenchmarkRuns(30).map(({ callLog: _callLog, ...run }) => run);
        return result({ runs });
      }
      if (action !== 'report' && action !== 'finish') throw new Error('action must be start, report, finish, or history.');
      const report = agentRunRecorder.report(typeof input.notes === 'string' ? input.notes : undefined);
      if (action === 'finish') {
        const persisted = persistBenchmarkRun(report);
        if (typeof window !== 'undefined') window.__webmcp_last_run__ = persisted;
        return result(persisted);
      }
      return result(report);
    },
  });

  for (const tool of tools) {
    if (tool.name === 'benchmark-run') continue;
    const execute = tool.execute;
    tool.execute = async (input, executionOptions) => {
      const startedAt = performance.now();
      try {
        const output = await execute(input, executionOptions);
        agentRunRecorder.record(tool.name, input, output, startedAt);
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && ['build-circuit', 'edit-circuit', 'connect-pins'].includes(tool.name)) {
          window.dispatchEvent(new Event('webmcp:frame-circuit'));
        }
        return output;
      } catch (error) {
        agentRunRecorder.record(tool.name, input, null, startedAt, error);
        throw error;
      }
    };
  }
  const findTool = (name: string) =>
    tools.find(
      (t) =>
        t.name === name ||
        t.name.replace(/-/g, '_') === name ||
        t.name.replace(/_/g, '-') === name,
    );

  // 1. Expose universal browser agent discovery & execution functions on window
  if (typeof window !== 'undefined') {
    window.__webmcp_tools__ = tools;
    window.webmcp_list_tools = () =>
      tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
    window.webmcp_call_tool = async (name: string, input: Record<string, unknown> = {}) => {
      const tool = findTool(name);
      if (!tool) throw new Error(`WebMCP tool "${name}" not found.`);
      return tool.execute(input, options);
    };
  }

  // 2. Capture any pre-existing modelContext on document, window, or navigator
  const existingDocContext = typeof document !== 'undefined' ? (document as Document & { modelContext?: ModelContext }).modelContext : undefined;
  const existingWinContext = typeof window !== 'undefined' ? (window as Window & { modelContext?: ModelContext }).modelContext : undefined;
  const existingNavContext = typeof navigator !== 'undefined' ? (navigator as unknown as { modelContext?: ModelContext }).modelContext : undefined;

  // 3. Register tools on existing native contexts if present
  try {
    if (existingDocContext?.registerTool) {
      for (const tool of tools) await existingDocContext.registerTool(tool, options);
    }
    if (existingWinContext?.registerTool && existingWinContext !== existingDocContext) {
      for (const tool of tools) await existingWinContext.registerTool(tool, options);
    }
    if (existingNavContext?.registerTool && existingNavContext !== existingDocContext) {
      for (const tool of tools) await existingNavContext.registerTool(tool, options);
    }
  } catch (error) {
    console.warn('[WebMCP] Native tool registration warning:', error);
  }

  // 4. Polyfill ModelContext on document, window, and navigator according to WebMCP spec
  const registered = new Map<string, ToolDefinition>();
  for (const tool of tools) {
    registered.set(tool.name, tool);
    registered.set(tool.name.replace(/-/g, '_'), tool);
  }

  const polyfillModelContext: ModelContext & {
    listTools: () => Promise<Array<{ name: string; description: string; inputSchema?: Record<string, unknown> }>>;
    callTool: (name: string, input?: Record<string, unknown>) => Promise<unknown>;
  } = {
    registerTool: async (tool: ToolDefinition) => {
      registered.set(tool.name, tool);
      registered.set(tool.name.replace(/-/g, '_'), tool);
    },
    getTools: async () =>
      Array.from(tools.values()).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    listTools: async () =>
      Array.from(tools.values()).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    executeTool: async (name: string, input: Record<string, unknown> = {}) => {
      const tool = registered.get(name) || findTool(name);
      if (!tool) throw new Error(`Tool "${name}" not registered.`);
      return tool.execute(input, options);
    },
    callTool: async (name: string, input: Record<string, unknown> = {}) => {
      const tool = registered.get(name) || findTool(name);
      if (!tool) throw new Error(`Tool "${name}" not registered.`);
      return tool.execute(input, options);
    },
  };

  const defineModelContext = (target: object) => {
    try {
      Object.defineProperty(target, 'modelContext', {
        value: polyfillModelContext,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } catch {
      try {
        (target as { modelContext?: unknown }).modelContext = polyfillModelContext;
      } catch {
        // Ignore if immutable
      }
    }
  };

  if (typeof window !== 'undefined' && !existingWinContext) {
    defineModelContext(window);
    if (typeof Window !== 'undefined' && Window.prototype) defineModelContext(Window.prototype);
  }
  if (typeof document !== 'undefined' && !existingDocContext) {
    defineModelContext(document);
    if (typeof Document !== 'undefined' && Document.prototype) defineModelContext(Document.prototype);
  }
  if (typeof navigator !== 'undefined' && !existingNavContext) {
    defineModelContext(navigator);
    if (typeof Navigator !== 'undefined' && Navigator.prototype) defineModelContext(Navigator.prototype);
  }

  return true;
}
