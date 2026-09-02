#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Render every built-in example through the real app so layout quality can be
// checked visually in addition to deterministic geometry/diagnostic scoring.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HEX_FIXTURES } from '../testing/fixtures.mjs';
import { DENSE_NET_SERVO_INPUT, MOTOR_SWITCH_INPUT } from '../testing/agent-fixtures.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(.:)/, '$1')), '../..');
const serverPort = 4480 + Math.floor(Math.random() * 250);
const debugPort = 9680 + Math.floor(Math.random() * 250);
const serverUrl = `http://127.0.0.1:${serverPort}/`;
const outDir = path.join(root, 'benchmark-results', 'example-renders');

function findChrome() {
  const candidates = process.platform === 'win32'
    ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      ]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

async function waitFor(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
  }
  async open() {
    if (this.ws.readyState !== WebSocket.OPEN) {
      await new Promise((resolve, reject) => {
        this.ws.addEventListener('open', resolve, { once: true });
        this.ws.addEventListener('error', reject, { once: true });
      });
    }
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }
  call(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const response = await this.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text ?? 'Browser evaluation failed');
    return response.result.value;
  }
  close() { this.ws.close(); }
}

const chrome = findChrome();
if (!chrome) {
  console.error('Example render audit requires Chrome, Chromium, or Edge.');
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const server = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(serverPort), '--strictPort'], {
  cwd: root,
  stdio: 'ignore',
});
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hardware-lab-example-audit-'));
const browser = spawn(chrome, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--remote-allow-origins=*',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`,
  '--window-size=1440,1000',
  serverUrl,
], { stdio: 'ignore' });

let cdp;
try {
  await waitFor(serverUrl);
  const targets = await (await waitFor(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const target = targets.find((item) => item.type === 'page' && item.url.includes(`127.0.0.1:${serverPort}`));
  if (!target) throw new Error('Could not find the Hardware Lab browser target.');
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.call('Page.enable');

  const readyDeadline = Date.now() + 10000;
  while (Date.now() < readyDeadline) {
    if (await cdp.evaluate("Boolean(document.querySelector('.canvas-world'))")) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const ids = await cdp.evaluate(`(async () => {
    const { CIRCUIT_PRESETS } = await import('/src/circuit/presets.ts');
    return CIRCUIT_PRESETS.map((preset) => preset.id);
  })()`);

  const rows = [];
  for (const id of ids) {
    const report = await cdp.evaluate(`(async () => {
      const [{ CIRCUIT_PRESETS }, { circuitStore }, { evaluateLayout }, { diagnoseCircuit }] = await Promise.all([
        import('/src/circuit/presets.ts'),
        import('/src/circuit/store.ts'),
        import('/src/layout/quality.ts'),
        import('/src/sim/diagnostics.ts'),
      ]);
      const preset = CIRCUIT_PRESETS.find((item) => item.id === ${JSON.stringify(id)});
      circuitStore.replaceDocument(preset);
      window.dispatchEvent(new Event('webmcp:frame-circuit'));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const state = circuitStore.getSnapshot();
      const quality = evaluateLayout(state);
      const diagnostics = diagnoseCircuit(state);
      return {
        id: preset.id,
        parts: state.parts.length,
        wires: state.connections.length,
        issues: quality.issues.length,
        issueKinds: quality.issues.map((item) => item.kind).join(','),
        issueDetails: quality.issues.map((item) => item.kind + ': ' + item.message),
        diagnosticErrors: diagnostics.filter((item) => item.severity === 'error').length,
        diagnosticWarnings: diagnostics.filter((item) => item.severity === 'warning').length,
      };
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const shot = await cdp.call('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(outDir, `${id}-authored.png`), Buffer.from(shot.data, 'base64'));
    rows.push({ ...report, mode: 'authored' });

  }

  // Keep one small production-tool fixture in the browser loop. It catches
  // regressions in exact pin leads and orthogonal routing without maintaining
  // a second audit-only router.
  const blockReport = await cdp.evaluate(`(async () => {
    const [{ createBuildCircuitTool }, { circuitStore }, { evaluateLayout }, { diagnoseCircuit }, { endpointPoint }, { connectionPolyline, isOrthogonalPair }] = await Promise.all([
      import('/src/agent/buildCircuit.ts'),
      import('/src/circuit/store.ts'),
      import('/src/layout/quality.ts'),
      import('/src/sim/diagnostics.ts'),
      import('/src/wires/geometry.ts'),
      import('/src/wires/path.ts'),
    ]);
    const tool = createBuildCircuitTool();
    await tool.execute({
      replace: true,
      parts: [
        { id: 'uno', type: 'arduino-uno', at: [-35, 0] },
        { id: 'servo', type: 'servo', at: [5, 0] },
      ],
      wires: [
        { id: 'pwm', from: 'uno:9', to: 'servo:PWM', role: 'signal', path: [[-5, -2], [3, -2], [3, 5]] },
      ],
    }, { signal: new AbortController().signal });
    window.dispatchEvent(new Event('webmcp:frame-circuit'));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const state = circuitStore.getSnapshot();
    const quality = evaluateLayout(state);
    const diagnostics = diagnoseCircuit(state);
    const wire = state.connections.find((item) => item.id === 'pwm');
    const start = endpointPoint(wire.from, state.parts);
    const end = endpointPoint(wire.to, state.parts);
    const points = connectionPolyline(start, wire.waypoints, end);
    return {
      id: 'exact-pin-routing',
      parts: state.parts.length,
      wires: state.connections.length,
      issues: quality.issues.length,
      issueKinds: quality.issues.map((item) => item.kind).join(','),
      issueDetails: quality.issues.map((item) => item.kind + ': ' + item.message),
      diagnosticErrors: diagnostics.filter((item) => item.severity === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.severity === 'warning').length,
      orthogonal: points.every((point, index) => index === points.length - 1 || isOrthogonalPair(point, points[index + 1])),
      points,
    };
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 120));
  const blockShot = await cdp.call('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(outDir, 'exact-pin-routing.png'), Buffer.from(blockShot.data, 'base64'));
  if (blockReport.issues > 0 || blockReport.diagnosticErrors > 0 || !blockReport.orthogonal) {
    throw new Error(`Exact-pin visual fixture failed: ${JSON.stringify(blockReport)}`);
  }
  rows.push({ ...blockReport, mode: 'block-fixture' });

  const alignedPinReport = await cdp.evaluate(`(async () => {
    const [{ createBuildCircuitTool }, { circuitStore }, { endpointPoint }, { connectionPolyline }] = await Promise.all([
      import('/src/agent/buildCircuit.ts'),
      import('/src/circuit/store.ts'),
      import('/src/wires/geometry.ts'),
      import('/src/wires/path.ts'),
    ]);
    await createBuildCircuitTool().execute({
      replace: true,
      parts: [
        { id: 'uno', type: 'arduino-uno', at: [-25, -20] },
        { id: 'pot', type: 'potentiometer', at: [-11, 25], rotate: 180 },
      ],
      align: [{ from: 'pot:VCC', to: 'uno:5V', axis: 'x' }],
      wires: [{ id: 'power', from: 'uno:5V', to: 'pot:VCC', role: 'power' }],
    }, { signal: new AbortController().signal });
    window.dispatchEvent(new Event('webmcp:frame-circuit'));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const state = circuitStore.getSnapshot();
    const wire = state.connections.find((item) => item.id === 'power');
    const start = endpointPoint(wire.from, state.parts);
    const end = endpointPoint(wire.to, state.parts);
    const points = connectionPolyline(start, wire.waypoints, end);
    return {
      id: 'aligned-pin-axis',
      parts: state.parts.length,
      wires: state.connections.length,
      straight: points.every((point) => Math.abs(point.x - start.x) < 0.01),
      points,
    };
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 120));
  const alignedPinShot = await cdp.call('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(outDir, 'aligned-pin-axis.png'), Buffer.from(alignedPinShot.data, 'base64'));
  if (!alignedPinReport.straight) throw new Error(`Aligned-pin visual fixture failed: ${JSON.stringify(alignedPinReport)}`);
  rows.push({ ...alignedPinReport, mode: 'block-fixture' });

  const blockServoReport = await cdp.evaluate(`(async () => {
    const input = ${JSON.stringify(DENSE_NET_SERVO_INPUT)};
    const [{ createBuildCircuitTool }, { circuitStore }, { evaluateLayout }, { diagnoseCircuit }, { endpointPoint }, { connectionPolyline, isOrthogonalPair }] = await Promise.all([
      import('/src/agent/buildCircuit.ts'),
      import('/src/circuit/store.ts'),
      import('/src/layout/quality.ts'),
      import('/src/sim/diagnostics.ts'),
      import('/src/wires/geometry.ts'),
      import('/src/wires/path.ts'),
    ]);
    await createBuildCircuitTool().execute(input, { signal: new AbortController().signal });
    window.dispatchEvent(new Event('webmcp:frame-circuit'));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const state = circuitStore.getSnapshot();
    const quality = evaluateLayout(state);
    const diagnostics = diagnoseCircuit(state);
    const orthogonal = state.connections.every((wire) => {
      const start = endpointPoint(wire.from, state.parts);
      const end = endpointPoint(wire.to, state.parts);
      if (!start || !end) return false;
      const points = connectionPolyline(start, wire.waypoints, end);
      return points.every((point, index) => index === points.length - 1 || isOrthogonalPair(point, points[index + 1]));
    });
    return {
      id: 'multi-net-servo-control',
      parts: state.parts.length,
      wires: state.connections.length,
      issues: quality.issues.length,
      issueKinds: quality.issues.map((item) => item.kind).join(','),
      issueDetails: quality.issues.map((item) => item.kind + ': ' + item.message),
      diagnosticErrors: diagnostics.filter((item) => item.severity === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.severity === 'warning').length,
      orthogonal,
      seatedParts: state.parts.filter((part) => part.seating?.breadboardId === 'bb').map((part) => part.id),
    };
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 120));
  const blockServoShot = await cdp.call('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(outDir, 'multi-net-servo-control.png'), Buffer.from(blockServoShot.data, 'base64'));
  if (blockServoReport.diagnosticErrors > 0 || blockServoReport.diagnosticWarnings > 0 || !blockServoReport.orthogonal) {
    throw new Error(`Production servo-control visual fixture failed: ${JSON.stringify(blockServoReport)}`);
  }
  if (blockServoReport.parts !== 4 || blockServoReport.wires !== 9 || blockServoReport.seatedParts.length !== 0) {
    throw new Error(`Production servo-control fixture changed shape unexpectedly: ${JSON.stringify(blockServoReport)}`);
  }
  rows.push({ ...blockServoReport, mode: 'block-servo-fixture' });

  const blockInspect = await cdp.evaluate(`(async () => {
    const raw = await window.webmcp_call_tool('inspect-circuit', {
      includePins: true,
      pinPartIds: ['uno'],
      includeLayout: true,
      catalogTypes: ['servo'],
    });
    const report = raw?.structuredContent ?? raw;
    const uno = report.parts.find((part) => part.id === 'uno');
    const servoCatalog = report.catalog?.find((part) => part.type === 'wokwi-servo' || part.type === 'servo');
    const wire = report.connections.find((item) => item.id === 'servo-pwm');
    return {
      cellPixels: report.coordinateSystem?.cellPixels,
      componentCoordinate: report.coordinateSystem?.componentCoordinate,
      uno,
      servoCatalog,
      wire,
      layoutKind: report.layout?.kind,
    };
  })()`);
  if (blockInspect.cellPixels !== 9.6 || blockInspect.componentCoordinate !== 'block top-left cell') {
    throw new Error(`Production inspection must stay in one physical block coordinate system: ${JSON.stringify(blockInspect)}`);
  }
  if (!blockInspect.uno?.blockAt || !blockInspect.uno?.blockSize || 'grid' in blockInspect.uno || 'centerGrid' in blockInspect.uno || 'gridSize' in blockInspect.uno) {
    throw new Error(`Production inspection leaked the old 32px component grid: ${JSON.stringify(blockInspect.uno)}`);
  }
  if (!Array.isArray(blockInspect.wire?.routePx) || 'gridWaypoints' in (blockInspect.wire ?? {}) || 'routeCells' in (blockInspect.wire ?? {})) {
    throw new Error(`Production inspection must report exact routePx instead of legacy grid routes: ${JSON.stringify(blockInspect.wire)}`);
  }
  if (!blockInspect.servoCatalog?.blockSize || blockInspect.servoCatalog?.gridSize || blockInspect.layoutKind !== 'block-grid') {
    throw new Error(`Production catalog/layout metadata must use block-world geometry: ${JSON.stringify(blockInspect)}`);
  }

  const motorReport = await cdp.evaluate(`(async () => {
    const input = ${JSON.stringify(MOTOR_SWITCH_INPUT)};
    const [{ createBuildCircuitTool }, { circuitStore }, { evaluateLayout }, { diagnoseCircuit }] = await Promise.all([
      import('/src/agent/buildCircuit.ts'),
      import('/src/circuit/store.ts'),
      import('/src/layout/quality.ts'),
      import('/src/sim/diagnostics.ts'),
    ]);
    await createBuildCircuitTool().execute(input, { signal: new AbortController().signal });
    window.dispatchEvent(new Event('webmcp:frame-circuit'));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const state = circuitStore.getSnapshot();
    const quality = evaluateLayout(state);
    const diagnostics = diagnoseCircuit(state);
    return {
      id: 'motor-switch',
      parts: state.parts.length,
      wires: state.connections.length,
      issues: quality.issues.length,
      issueKinds: quality.issues.map((item) => item.kind).join(','),
      issueDetails: quality.issues.map((item) => item.kind + ': ' + item.message),
      diagnosticErrors: diagnostics.filter((item) => item.severity === 'error').length,
      diagnosticWarnings: diagnostics.filter((item) => item.severity === 'warning').length,
    };
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 120));
  const motorShot = await cdp.call('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(outDir, 'motor-switch.png'), Buffer.from(motorShot.data, 'base64'));
  rows.push({ ...motorReport, mode: 'block-motor-fixture' });

  const interactionCheck = await cdp.evaluate(`(async () => {
    const [{ CIRCUIT_PRESETS }, { circuitStore }] = await Promise.all([
      import('/src/circuit/presets.ts'),
      import('/src/circuit/store.ts'),
    ]);
    const preset = CIRCUIT_PRESETS.find((item) => item.id === 'button-led');
    circuitStore.replaceDocument(preset);
    circuitStore.select('uno1');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const part = document.querySelector('[data-part-id="uno1"]');
    const wireLayer = document.querySelector('.wire-layer');
    const partZ = part ? Number.parseInt(getComputedStyle(part).zIndex || '0', 10) : -1;
    const wireZ = wireLayer ? Number.parseInt(getComputedStyle(wireLayer).zIndex || '0', 10) : -1;

    circuitStore.select('wire1');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      partZ,
      wireZ,
      endpoints: document.querySelectorAll('.wire-endpoint').length,
      waypointHandles: document.querySelectorAll('.wire-waypoint').length,
    };
  })()`);
  if (interactionCheck.wireZ <= interactionCheck.partZ) {
    throw new Error(`Selected components must remain below wires (part z=${interactionCheck.partZ}, wire z=${interactionCheck.wireZ}).`);
  }
  if (interactionCheck.endpoints !== 2) {
    throw new Error(`Selected wires must expose exactly two rewiring endpoint handles; found ${interactionCheck.endpoints}.`);
  }

  const runtimeFixture = HEX_FIXTURES.blink;
  const runtimeAudit = await cdp.evaluate(`(async () => {
    const fixture = ${JSON.stringify(runtimeFixture)};
    const hash = (source) => {
      let value = 2166136261;
      for (let index = 0; index < source.length; index++) {
        value ^= source.charCodeAt(index);
        value = Math.imul(value, 16777619);
      }
      return (value >>> 0).toString(36);
    };
    localStorage.setItem(
      'hardware-lab:hex:v2:' + hash(fixture.sketch),
      JSON.stringify({ source: fixture.sketch, result: { stdout: '', stderr: '', hex: fixture.hex } }),
    );
    const [{ circuitStore }, { simulator }] = await Promise.all([
      import('/src/circuit/store.ts'),
      import('/src/sim/simulator.ts'),
    ]);
    circuitStore.replaceDocument({
      parts: [{
        id: 'runtime-uno',
        type: 'wokwi-arduino-uno',
        left: 520,
        top: 300,
        rotate: 0,
        attrs: {},
        code: fixture.sketch,
      }],
      connections: [],
    });
    circuitStore.select(null);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const started = await simulator.start();
    const observation = await simulator.observe(900, 14);
    const board = observation.parts.find((part) => part.id === 'runtime-uno');
    const stopped = simulator.stop();
    return { started, observation, board, stopped, finalStatus: circuitStore.getSnapshot().simulation.status };
  })()`);
  const ledValues = runtimeAudit.board?.observed?.led13 ?? [];
  if (!ledValues.includes(true) || !ledValues.includes(false)) {
    throw new Error(`Runtime observation must see the Blink sketch drive LED13 both HIGH and LOW; saw ${JSON.stringify(ledValues)}.`);
  }
  if (!(runtimeAudit.board?.observed?.powerLed ?? []).includes(true)) {
    throw new Error('Runtime observation must report the Uno power LED while simulation is running.');
  }
  if (runtimeAudit.finalStatus !== 'stopped') {
    throw new Error(`Simulation runtime audit must stop cleanly; final status was ${runtimeAudit.finalStatus}.`);
  }
  console.table(rows.map(({ issueDetails: _issueDetails, ...row }) => row));
  for (const row of rows.filter((item) => item.issues > 0)) {
    console.log(`\n${row.id} [${row.mode}]`);
    for (const issue of row.issueDetails) console.log(`  - ${issue}`);
  }
  console.log(`Interaction layering checks passed: wire z=${interactionCheck.wireZ} > selected part z=${interactionCheck.partZ}, 2 endpoint handles visible.`);
  console.log(`Rendered ${rows.length} examples to ${outDir}`);
} finally {
  try { cdp?.close(); } catch {}
  try { browser.kill(); } catch {}
  try { server.kill(); } catch {}
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
}
