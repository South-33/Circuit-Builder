#!/usr/bin/env node
// SPDX-License-Identifier: MIT

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parseArgs(argv) {
  const options = { out: '' };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--out') options.out = argv[++index] ?? '';
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function findBrowser() {
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

async function waitForHttp(url, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Child process exited with code ${child.exitCode} before ${url} was ready.`);
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

class CDP {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
  }

  async open() {
    if (this.socket.readyState !== WebSocket.OPEN) {
      await new Promise((resolve, reject) => {
        this.socket.addEventListener('open', resolve, { once: true });
        this.socket.addEventListener('error', reject, { once: true });
      });
    }
    this.socket.addEventListener('message', (event) => {
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
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) {
      const detail = response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? 'Browser evaluation failed';
      throw new Error(detail);
    }
    return response.result.value;
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function errorResponse(id, error) {
  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
  };
}

const options = parseArgs(process.argv.slice(2));
const browserPath = findBrowser();
if (!browserPath) throw new Error('Install Chrome, Chromium, or Edge.');

const outputDir = path.resolve(root, options.out || `benchmark-results/mcp-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(outputDir, { recursive: true });
const callsPath = path.join(outputDir, 'calls.jsonl');
const profileRoot = path.join(root, 'benchmark-results', '.tmp');
fs.mkdirSync(profileRoot, { recursive: true });
const profileDir = fs.mkdtempSync(path.join(profileRoot, 'tinkercad-mcp-'));
const serverPort = 5100 + Math.floor(Math.random() * 300);
const debugPort = 10100 + Math.floor(Math.random() * 250);
const serverUrl = `http://127.0.0.1:${serverPort}/`;
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

const server = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(serverPort), '--strictPort'], {
  cwd: root,
  stdio: ['ignore', 'ignore', 'pipe'],
  windowsHide: true,
});
const browser = spawn(browserPath, [
  '--headless=new',
  '--disable-gpu',
  '--disable-background-networking',
  '--no-first-run',
  '--no-default-browser-check',
  '--remote-allow-origins=*',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`,
  '--window-size=1440,1000',
  serverUrl,
], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });

let cdp;
let renderIndex = 0;
let constructionStarted = false;

async function browserTool(name, input = {}) {
  return cdp.evaluate(`window.webmcp_call_tool(${JSON.stringify(name)}, ${JSON.stringify(input)})`);
}

async function blankBench() {
  await cdp.evaluate('window.__webmcp_benchmark_reset__()');
  const inspected = await browserTool('inspect-circuit', { includeLayout: true, includeGuidance: false });
  const data = inspected?.structuredContent ?? inspected;
  const parts = Array.isArray(data?.parts) ? data.parts : [];
  const connections = Array.isArray(data?.connections) ? data.connections : [];
  if (parts.length || connections.length) {
    throw new Error(`Benchmark bench did not reset cleanly (${parts.length} parts, ${connections.length} wires).`);
  }
}

async function start() {
  await waitForHttp(serverUrl, 20_000, server);
  const targets = await (await waitForHttp(`http://127.0.0.1:${debugPort}/json/list`, 20_000, browser)).json();
  const target = targets.find((item) => item.type === 'page' && item.url.includes(`127.0.0.1:${serverPort}`));
  if (!target) throw new Error('Could not find workbench page.');
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.call('Page.enable');
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await cdp.evaluate('typeof window.webmcp_call_tool === "function"')) {
      // A benchmark session always owns a blank document. Clear once after the
      // app has registered its tools, then verify again immediately before the
      // agent's first construction call. This prevents any UI/CLI startup race
      // or stale scene from contaminating a blind run.
      await new Promise((resolve) => setTimeout(resolve, 250));
      await blankBench();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('WebMCP tools did not register.');
}

async function listTools() {
  const browserTools = await cdp.evaluate('window.webmcp_list_tools()');
  const productionNames = new Set(['inspect-circuit', 'build-circuit', 'set-code', 'simulate', 'focus']);
  const tools = browserTools.filter((tool) => productionNames.has(tool.name));
  tools.push({
    name: 'render-circuit',
    description: 'Render the current workbench exactly as the user sees it. Use this after meaningful edits and visually inspect the image before deciding the next change.',
    inputSchema: { type: 'object', properties: {} },
  });
  return tools;
}

async function renderCircuit() {
  await new Promise((resolve) => setTimeout(resolve, 250));
  const screenshot = await cdp.call('Page.captureScreenshot', { format: 'png', fromSurface: true });
  renderIndex += 1;
  const filename = `render-${String(renderIndex).padStart(2, '0')}.png`;
  fs.writeFileSync(path.join(outputDir, filename), Buffer.from(screenshot.data, 'base64'));
  fs.writeFileSync(path.join(outputDir, 'render-latest.png'), Buffer.from(screenshot.data, 'base64'));
  return {
    content: [
      { type: 'text', text: `Current workbench render. Saved as ${filename}. Judge the actual image, not only diagnostics or scores.` },
      { type: 'image', data: screenshot.data, mimeType: 'image/png' },
    ],
  };
}

function compactInspectResult(input, data) {
  if (!data || typeof data !== 'object') return data;

  const focused = Boolean(
    (Array.isArray(input.catalogTypes) && input.catalogTypes.length)
    || (Array.isArray(input.catalogPinTypes) && input.catalogPinTypes.length)
    || (Array.isArray(input.pinEndpoints) && input.pinEndpoints.length)
    || input.netOf
    || (Array.isArray(input.partIds) && input.partIds.length)
    || input.includePins
    || input.includeCode
    || input.includeLayout
  );

  const out = {};
  if (data.coordinateSystem && !focused) out.coordinateSystem = data.coordinateSystem;
  if (data.catalog) out.catalog = data.catalog;
  if (data.pinEndpoints) out.pinEndpoints = data.pinEndpoints;
  if (data.net) out.net = data.net;
  if (input.includeLayout && data.layout) out.layout = data.layout;

  if (Array.isArray(data.parts)) {
    const requestedIds = Array.isArray(input.partIds) ? new Set(input.partIds) : null;
    if (input.includePins) {
      // A blind `includePins:true` request used to dump every breadboard hole.
      // Keep it useful for discovering ordinary component pins, but force
      // breadboard geometry to stay symbolic (A20, +top12, etc.).
      const selected = requestedIds?.size
        ? data.parts.filter((part) => requestedIds.has(part.id))
        : data.parts;
      out.parts = selected
        .map((part) => ({
          id: part.id,
          type: part.type,
          ...(part.blockAt ? { blockAt: part.blockAt } : {}),
          ...(part.blockSize ? { blockSize: part.blockSize } : {}),
          ...(part.rotate ? { rotate: part.rotate } : {}),
          ...(part.seating ? { seating: part.seating } : {}),
          ...(part.pinGeometry ? { pinGeometry: part.pinGeometry } : {}),
          pins: Array.isArray(part.pins)
            ? part.pins.map((pin) => ({
                name: pin.name,
                ...(pin.exit ? { exit: pin.exit } : {}),
                ...(pin.globalUnitAt ? { globalUnitAt: pin.globalUnitAt } : {}),
              }))
            : undefined,
          ...(input.includeCode && part.code !== undefined ? { code: part.code } : {}),
        }));
      if (selected.some((part) => String(part.type ?? '').startsWith('breadboard'))) {
        out.breadboardPinsOmitted = true;
        out.hint = 'Breadboard holes are regular symbolic endpoints such as board:A20, board:J20, board:+top20, and board:-bottom20. Request specific holes with pinEndpoints only when numeric coordinates are truly needed.';
      }
    } else if (requestedIds?.size || input.includeCode) {
      out.parts = requestedIds?.size ? data.parts.filter((part) => requestedIds.has(part.id)) : data.parts;
    } else if (!focused) {
      out.parts = data.parts.map((part) => ({
        id: part.id,
        type: part.type,
        ...(part.blockAt ? { blockAt: part.blockAt } : {}),
        ...(part.blockSize ? { blockSize: part.blockSize } : {}),
        ...(part.rotate ? { rotate: part.rotate } : {}),
        ...(part.seating ? { seating: part.seating } : {}),
      }));
    }
  }

  if (!focused && Array.isArray(data.connections)) {
    out.connections = data.connections.map((wire) => ({
      id: wire.id,
      from: wire.from,
      to: wire.to,
      color: wire.color,
      ...(wire.points?.length ? { points: wire.points } : {}),
    }));
  }

  if (Array.isArray(data.diagnostics) && data.diagnostics.length) out.diagnostics = data.diagnostics;
  // Do not expose the aesthetic layout score to the blind authoring agent.
  // It is an evaluator signal, not a control signal. The model should judge
  // visual quality from render-circuit and use diagnostics for correctness.
  if (data.simulation && !focused) out.simulation = data.simulation;
  return out;
}

function normalizeToolArgs(name, args) {
  let value = args;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof value === 'string') {
      const text = value.trim();
      if (!text) return {};
      try {
        value = JSON.parse(text);
        continue;
      } catch {
        return name === 'build-circuit' ? { script: text } : {};
      }
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const keys = Object.keys(value);
    if (keys.length === 1 && ['Arguments', 'arguments', 'input', 'args'].includes(keys[0])) {
      value = value[keys[0]];
      continue;
    }
    return value;
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

async function callTool(name, args) {
  const startedAt = performance.now();
  let result;
  const normalizedArgs = normalizeToolArgs(name, args);
  const toolArgs = name === 'inspect-circuit'
    ? { ...normalizedArgs, includeGuidance: false }
    : normalizedArgs;
  try {
    if (name === 'render-circuit') {
      result = await renderCircuit();
    } else {
      const tools = await listTools();
      if (!tools.some((tool) => tool.name === name)) throw new Error(`Tool is not available: ${name}`);
      if (!constructionStarted && name === 'build-circuit') {
        await blankBench();
        constructionStarted = true;
      }
      result = await browserTool(name, toolArgs);
      if (name === 'inspect-circuit') {
        const compact = compactInspectResult(toolArgs, result?.structuredContent ?? result);
        result = {
          content: [{ type: 'text', text: JSON.stringify(compact) }],
          structuredContent: compact,
        };
      }
    }
  } catch (error) {
    fs.appendFileSync(callsPath, `${JSON.stringify({
      at: new Date().toISOString(),
      tool: name,
      input: toolArgs,
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      error: error instanceof Error ? error.message : String(error),
    })}\n`);
    throw error;
  }
  fs.appendFileSync(callsPath, `${JSON.stringify({
    at: new Date().toISOString(),
    tool: name,
    input: toolArgs,
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    result: name === 'render-circuit' ? { render: renderIndex } : result?.structuredContent ?? result,
  })}\n`);
  return result?.content ? result : { content: [{ type: 'text', text: JSON.stringify(result?.structuredContent ?? result) }], structuredContent: result?.structuredContent ?? result };
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0') return;
  if (message.method === 'notifications/initialized' || message.method === 'notifications/cancelled') return;
  if (message.id === undefined) return;
  try {
    if (message.method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: message.params?.protocolVersion ?? '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'tinkercad-webmcp-bridge', version: '0.1.0' },
        },
      });
      return;
    }
    if (message.method === 'ping') {
      send({ jsonrpc: '2.0', id: message.id, result: {} });
      return;
    }
    if (message.method === 'tools/list') {
      send({ jsonrpc: '2.0', id: message.id, result: { tools: await listTools() } });
      return;
    }
    if (message.method === 'tools/call') {
      const result = await callTool(message.params?.name, message.params?.arguments ?? {});
      send({ jsonrpc: '2.0', id: message.id, result });
      return;
    }
    send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
  } catch (error) {
    send(errorResponse(message.id, error));
  }
}

async function stop() {
  try { cdp?.socket?.close(); } catch {}
  for (const child of [browser, server]) {
    try {
      if (child.exitCode === null && process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      } else if (child.exitCode === null) child.kill();
    } catch {}
  }
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
}

await start();
process.stderr.write(`TinkerCad WebMCP bridge ready. Output: ${outputDir}\n`);

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  try {
    await handle(JSON.parse(line));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  }
}

await stop();
