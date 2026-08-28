#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Render every built-in example through the real app so layout quality can be
// checked visually in addition to deterministic geometry/diagnostic scoring.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(.:)/, '$1')), '../..');
const serverPort = 4480 + Math.floor(Math.random() * 250);
const debugPort = 9680 + Math.floor(Math.random() * 250);
const serverUrl = `http://127.0.0.1:${serverPort}/?harness=c`;
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
        import('/src/agent/core/layout.ts'),
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
        score: quality.score,
        grade: quality.grade,
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

    const routedReport = await cdp.evaluate(`(async () => {
      const [{ circuitStore }, { autoRouteConnections }, { evaluateLayout }, { diagnoseCircuit }, { inferWireKind }] = await Promise.all([
        import('/src/circuit/store.ts'),
        import('/src/agent/core/router.ts'),
        import('/src/agent/core/layout.ts'),
        import('/src/sim/diagnostics.ts'),
        import('/src/agent/core/wiring.ts'),
      ]);
      const state = circuitStore.getSnapshot();
      const routed = autoRouteConnections(state.parts, state.connections.map((wire) => ({
        id: wire.id,
        from: wire.from,
        to: wire.to,
        color: wire.color,
        role: inferWireKind(wire.from, wire.to),
      })));
      circuitStore.replaceDocument({ parts: state.parts, connections: routed });
      window.dispatchEvent(new Event('webmcp:frame-circuit'));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const next = circuitStore.getSnapshot();
      const quality = evaluateLayout(next);
      const diagnostics = diagnoseCircuit(next);
      return {
        id: ${JSON.stringify(id)},
        parts: next.parts.length,
        wires: next.connections.length,
        score: quality.score,
        grade: quality.grade,
        issues: quality.issues.length,
        issueKinds: quality.issues.map((item) => item.kind).join(','),
        issueDetails: quality.issues.map((item) => item.kind + ': ' + item.message),
        diagnosticErrors: diagnostics.filter((item) => item.severity === 'error').length,
        diagnosticWarnings: diagnostics.filter((item) => item.severity === 'warning').length,
      };
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const routedShot = await cdp.call('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(outDir, `${id}-autorouted.png`), Buffer.from(routedShot.data, 'base64'));
    rows.push({ ...routedReport, mode: 'autorouted' });
  }

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
