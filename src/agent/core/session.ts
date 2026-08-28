import { circuitStore } from '../../circuit/store';
import type { CircuitConnection, CircuitPart } from '../../circuit/types';
import { diagnoseCircuit } from '../../sim/diagnostics';
import { endpointPoint, partRect } from '../../wires/geometry';
import { connectionPolyline } from '../../wires/path';
import { evaluateLayout } from './layout';
import { canvasPointToGrid } from './grid';
import type { HarnessId } from '../types';

type CallRecord = {
  index: number;
  tool: string;
  durationMs: number;
  inputBytes: number;
  outputBytes: number;
  ok: boolean;
  error?: string;
};

function wireStats(parts: CircuitPart[], connections: CircuitConnection[]) {
  let totalLengthPx = 0;
  let bends = 0;
  for (const wire of connections) {
    const start = endpointPoint(wire.from, parts);
    const end = endpointPoint(wire.to, parts);
    if (!start || !end) continue;
    const points = connectionPolyline(start, wire.waypoints, end);
    for (let i = 0; i < points.length - 1; i++) {
      totalLengthPx += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    }
    bends += Math.max(0, points.length - 2);
  }
  return { totalLengthPx: Math.round(totalLengthPx), bends };
}

function contentCenter(parts: CircuitPart[]) {
  if (!parts.length) return { x: 0, y: 0, distance: 0 };
  const rects = parts.filter((part) => !part.seating).map(partRect);
  const source = rects.length ? rects : parts.map(partRect);
  const minX = Math.min(...source.map((rect) => rect.x));
  const maxX = Math.max(...source.map((rect) => rect.x + rect.width));
  const minY = Math.min(...source.map((rect) => rect.y));
  const maxY = Math.max(...source.map((rect) => rect.y + rect.height));
  const grid = canvasPointToGrid({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
  return { x: grid.x, y: grid.y, distance: Math.round(Math.hypot(grid.x, grid.y) * 10) / 10 };
}
const BENCHMARK_STORAGE_KEY = 'webmcp-hardware-lab:benchmark-runs:v1';

class AgentRunRecorder {
  private harness: HarnessId = 'legacy';
  private label = '';
  private startedAt = performance.now();
  private calls: CallRecord[] = [];

  reset(harness: HarnessId, label = '') {
    this.harness = harness;
    this.label = label;
    this.startedAt = performance.now();
    this.calls = [];
  }

  record(tool: string, input: unknown, output: unknown, startedAt: number, error?: unknown) {
    let inputBytes = 0;
    let outputBytes = 0;
    try { inputBytes = JSON.stringify(input).length; } catch { /* ignore */ }
    try { outputBytes = JSON.stringify(output).length; } catch { /* ignore */ }
    this.calls.push({
      index: this.calls.length + 1,
      tool,
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      inputBytes,
      outputBytes,
      ok: !error,
      ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
    });
  }

  report(notes?: string) {
    const state = circuitStore.getSnapshot();
    const layout = evaluateLayout(state);
    const diagnostics = diagnoseCircuit(state);
    const wires = wireStats(state.parts, state.connections);
    const actionCalls = this.calls.filter((call) => !['inspect-circuit', 'benchmark-run', 'focus'].includes(call.tool));
    return {
      harness: this.harness,
      label: this.label || undefined,
      durationMs: Math.round(performance.now() - this.startedAt),
      calls: this.calls.length,
      actionCalls: actionCalls.length,
      failedCalls: this.calls.filter((call) => !call.ok).length,
      trafficBytes: this.calls.reduce((sum, call) => sum + call.inputBytes + call.outputBytes, 0),
      circuit: {
        parts: state.parts.length,
        wires: state.connections.length,
        layoutScore: layout.score,
        layoutGrade: layout.grade,
        layoutIssues: layout.issues,
        diagnosticErrors: diagnostics.filter((item) => item.severity === 'error').length,
        diagnosticWarnings: diagnostics.filter((item) => item.severity === 'warning').length,
        centerOffsetGrid: contentCenter(state.parts),
        totalWireLengthPx: wires.totalLengthPx,
        wireBends: wires.bends,
        simulationStatus: state.simulation.status,
      },
      ...(notes?.trim() ? { agentNotes: notes.trim() } : {}),
      callLog: [...this.calls],
    };
  }
}

export type AgentRunReport = ReturnType<AgentRunRecorder['report']>;
export type PersistedAgentRun = AgentRunReport & { runId: string; finishedAt: string };

export function persistBenchmarkRun(report: AgentRunReport): PersistedAgentRun {
  const finishedAt = new Date().toISOString();
  const randomPart = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  const persisted: PersistedAgentRun = {
    ...report,
    runId: `${report.harness}-${Date.now()}-${randomPart}`,
    finishedAt,
  };
  try {
    if (typeof localStorage !== 'undefined') {
      const existing = listBenchmarkRuns(100);
      const next = [...existing, persisted].slice(-100);
      localStorage.setItem(BENCHMARK_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // Persistence is best-effort. The report is still returned to the caller.
  }
  return persisted;
}

export function listBenchmarkRuns(limit = 20): PersistedAgentRun[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(BENCHMARK_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(-Math.max(1, limit)) as PersistedAgentRun[];
  } catch {
    return [];
  }
}

export const agentRunRecorder = new AgentRunRecorder();
