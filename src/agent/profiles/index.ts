import type { HarnessId, ToolDefinition } from '../types';
import { createBlueprintHarnessTool } from './blueprint';
import { createProceduralHarnessTool } from './procedural';
import { createSemanticHarnessTool } from './semantic';

export const HARNESS_INFO: Record<HarnessId, { name: string; short: string }> = {
  legacy: { name: 'Legacy control', short: 'Existing CRUD + manual waypoint interface used as the control.' },
  a: { name: 'A: Procedural Grid', short: 'MineBench-style ordered operations on a centered discrete grid.' },
  b: { name: 'B: Blueprint Grid', short: 'Whole-scene exact snapped blueprint with agent-authored wire paths.' },
  c: { name: 'C: Semantic Solver', short: 'Relative placement constraints plus deterministic orthogonal autorouting.' },
};

export function normalizeHarnessId(value: string | null | undefined): HarnessId {
  switch ((value ?? '').trim().toLowerCase()) {
    case 'a': case 'procedural': case 'procedural-grid': return 'a';
    case 'b': case 'blueprint': case 'blueprint-grid': return 'b';
    case 'c': case 'semantic': case 'solver': case 'semantic-solver': return 'c';
    case 'legacy': case 'control': case 'current': return 'legacy';
    default: return 'legacy';
  }
}

export function getActiveHarnessId(): HarnessId {
  if (typeof window === 'undefined' || !window.location) return 'legacy';
  const params = new URLSearchParams(window.location.search);
  return normalizeHarnessId(params.get('harness'));
}

export function createActiveHarnessTool(id: HarnessId): ToolDefinition | null {
  if (id === 'a') return createProceduralHarnessTool();
  if (id === 'b') return createBlueprintHarnessTool();
  if (id === 'c') return createSemanticHarnessTool();
  return null;
}
