#!/usr/bin/env node
// Deterministic smoke comparison for the three experimental agent action spaces.
// This validates that the harness implementations can express the same scene.
// It is not an LLM quality benchmark. Real agent runs use the browser benchmark-run tool.

import fs from 'node:fs';
import path from 'node:path';

await import('../testing/test-circuits.mjs');

const { createProceduralHarnessTool } = await import('../../src/agent/profiles/procedural.ts');
const { createBlueprintHarnessTool } = await import('../../src/agent/profiles/blueprint.ts');
const { createSemanticHarnessTool } = await import('../../src/agent/profiles/semantic.ts');
const { agentRunRecorder } = await import('../../src/agent/core/session.ts');
const { circuitStore } = await import('../../src/circuit/store.ts');

const signal = new AbortController().signal;

const manualParts = [
  { id: 'bb', type: 'breadboard-half', center: { x: 0, y: 0 } },
  { id: 'uno', type: 'wokwi-arduino-uno', center: { x: -14, y: 0 } },
  { id: 'bat', type: 'battery-9v', center: { x: 0, y: -8 }, rotate: 90 },
  { id: 'motor', type: 'dc-motor', center: { x: 0, y: 9 }, rotate: 90 },
  { id: 'remote', type: 'wokwi-ir-remote', center: { x: 11, y: 0 } },
];

const manualConnections = [
  { from: 'bat:+', to: 'bb:+top20', role: 'power', path: [{ x: 3, y: -5 }, { x: 3, y: -4 }] },
  { from: 'bat:-', to: 'bb:-top18', role: 'ground', path: [{ x: 2, y: -5 }, { x: 2, y: -4 }] },
  { from: 'uno:5V', to: 'bb:+bottom1', role: 'power', path: [{ x: -13, y: 4 }, { x: -4, y: 4 }] },
  { from: 'uno:GND.1', to: 'bb:-bottom1', role: 'ground', path: [{ x: -15, y: -4 }, { x: -4, y: -4 }, { x: -4, y: 3 }] },
  { from: 'motor:1', to: 'bb:B18', role: 'signal', path: [{ x: -1, y: 6 }, { x: -1, y: 4 }, { x: 1, y: 4 }] },
  { from: 'motor:2', to: 'bb:+top16', role: 'power', path: [{ x: 0, y: 6 }, { x: 2, y: 6 }, { x: 2, y: -4 }] },
];

const cases = [
  {
    id: 'a',
    name: 'Procedural Grid',
    tool: createProceduralHarnessTool(),
    input: {
      replace: true,
      operations: [
        ...manualParts.map((part) => ({ op: 'place', ...part })),
        ...manualConnections.map(({ path: via, ...wire }) => ({ op: 'connect', ...wire, via })),
      ],
    },
  },
  {
    id: 'b',
    name: 'Blueprint Grid',
    tool: createBlueprintHarnessTool(),
    input: { replace: true, parts: manualParts, connections: manualConnections },
  },
  {
    id: 'c',
    name: 'Semantic Solver',
    tool: createSemanticHarnessTool(),
    input: {
      replace: true,
      parts: [
        { id: 'bb', type: 'breadboard-half', anchor: true },
        { id: 'uno', type: 'wokwi-arduino-uno', relative: { to: 'bb', side: 'left', gap: 3 } },
        { id: 'bat', type: 'battery-9v', relative: { to: 'bb', side: 'above', gap: 2, portsFace: true }, rotate: 'auto' },
        { id: 'motor', type: 'dc-motor', relative: { to: 'bb', side: 'below', gap: 2, portsFace: true }, rotate: 'auto' },
        { id: 'remote', type: 'wokwi-ir-remote', relative: { to: 'bb', side: 'right', gap: 3 } },
      ],
      connections: manualConnections.map(({ path: _path, ...wire }) => wire),
    },
  },
];

const reports = [];
for (const item of cases) {
  circuitStore.replaceDocument({ parts: [], connections: [] });
  agentRunRecorder.reset(item.id, `deterministic-smoke-${item.id}`);
  const startedAt = performance.now();
  try {
    const output = await item.tool.execute(item.input, { signal });
    agentRunRecorder.record('build-circuit', item.input, output, startedAt);
  } catch (error) {
    agentRunRecorder.record('build-circuit', item.input, null, startedAt, error);
  }
  reports.push({ name: item.name, ...agentRunRecorder.report('Deterministic harness smoke test. Not an LLM quality result.') });
}

const summary = reports.map((report) => ({
  harness: report.harness,
  name: report.name,
  score: report.circuit.layoutScore,
  grade: report.circuit.layoutGrade,
  errors: report.circuit.diagnosticErrors,
  layoutIssues: report.circuit.layoutIssues.length,
  centerOffset: report.circuit.centerOffsetGrid.distance,
  wireLengthPx: report.circuit.totalWireLengthPx,
  bends: report.circuit.wireBends,
  failedCalls: report.failedCalls,
  durationMs: report.durationMs,
}));

console.log('\nHarness implementation smoke comparison');
console.table(summary);
console.log('These are fixed known-good inputs. Use browser benchmark-run logs to compare real agents.\n');

const root = path.resolve(import.meta.dirname, '../..');
const outDir = path.join(root, 'benchmark-results');
fs.mkdirSync(outDir, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const payload = {
  kind: 'deterministic-harness-smoke',
  generatedAt: new Date().toISOString(),
  warning: 'Fixed known-good inputs validate harness implementations only. They do not measure LLM quality.',
  summary,
  reports,
};
fs.writeFileSync(path.join(outDir, `smoke-${timestamp}.json`), JSON.stringify(payload, null, 2));
fs.writeFileSync(path.join(outDir, 'latest-smoke.json'), JSON.stringify(payload, null, 2));
