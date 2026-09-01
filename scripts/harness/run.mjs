#!/usr/bin/env node
// SPDX-License-Identifier: MIT

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parseArgs(argv) {
  const options = { list: false, input: '', out: '' };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--list') options.list = true;
    else if (arg === '--input') options.input = argv[++index] ?? '';
    else if (arg === '--out') options.out = argv[++index] ?? '';
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.list && !options.input) {
    throw new Error('Usage: pnpm harness -- --input <scenario.json> [--out <directory>]\n       pnpm harness:list');
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

async function waitForHttp(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
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
    const response = await this.call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      const detail = response.exceptionDetails.exception?.description
        ?? response.exceptionDetails.text
        ?? 'Browser evaluation failed';
      throw new Error(detail);
    }
    return response.result.value;
  }

  close() {
    this.socket.close();
  }
}

async function waitForTools(cdp, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdp.evaluate('typeof window.webmcp_call_tool === "function"')) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('The app loaded, but the WebMCP tools did not register.');
}

function readScenario(file) {
  const absolute = path.resolve(root, file);
  const scenario = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  if (!Array.isArray(scenario.calls) || !scenario.calls.length) {
    throw new Error(`${file} must contain a non-empty calls array.`);
  }
  for (const [index, call] of scenario.calls.entries()) {
    if (!call || typeof call.tool !== 'string' || !call.tool.trim()) {
      throw new Error(`calls[${index}].tool must be a tool name.`);
    }
    if (call.input !== undefined && (!call.input || typeof call.input !== 'object' || Array.isArray(call.input))) {
      throw new Error(`calls[${index}].input must be an object.`);
    }
  }
  return { absolute, scenario };
}

const options = parseArgs(process.argv.slice(2));
const browserPath = findBrowser();
if (!browserPath) throw new Error('Install Chrome, Chromium, or Edge to run the exact browser harness.');

const serverPort = 4700 + Math.floor(Math.random() * 400);
const debugPort = 9700 + Math.floor(Math.random() * 250);
const serverUrl = `http://127.0.0.1:${serverPort}/`;
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tinkercad-harness-'));
const server = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(serverPort), '--strictPort'], {
  cwd: root,
  stdio: 'ignore',
});
const browser = spawn(browserPath, [
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
  await waitForHttp(serverUrl);
  const targets = await (await waitForHttp(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const target = targets.find((item) => item.type === 'page' && item.url.includes(`127.0.0.1:${serverPort}`));
  if (!target) throw new Error('Could not find the headless workbench page.');
  cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.call('Page.enable');
  await waitForTools(cdp);

  if (options.list) {
    const tools = await cdp.evaluate('window.webmcp_list_tools()');
    process.stdout.write(`${JSON.stringify(tools, null, 2)}\n`);
  } else {
    const { absolute, scenario } = readScenario(options.input);
    const outputDir = path.resolve(root, options.out || `benchmark-results/harness-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    fs.mkdirSync(outputDir, { recursive: true });
    const calls = [];
    for (const call of scenario.calls) {
      const startedAt = performance.now();
      const result = await cdp.evaluate(`window.webmcp_call_tool(${JSON.stringify(call.tool)}, ${JSON.stringify(call.input ?? {})})`);
      calls.push({
        tool: call.tool,
        input: call.input ?? {},
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
        result: result?.structuredContent ?? result,
      });
    }

    const finalInspectionResult = await cdp.evaluate('window.webmcp_call_tool("inspect-circuit", {includeLayout:true, includeCode:true})');
    await new Promise((resolve) => setTimeout(resolve, 350));
    const screenshot = await cdp.call('Page.captureScreenshot', { format: 'png', fromSurface: true });
    const screenshotPath = path.join(outputDir, 'render.png');
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));

    const report = {
      scenario: scenario.name ?? path.basename(absolute, path.extname(absolute)),
      source: path.relative(root, absolute).replaceAll('\\', '/'),
      generatedAt: new Date().toISOString(),
      calls,
      finalInspection: finalInspectionResult?.structuredContent ?? finalInspectionResult,
      render: path.relative(root, screenshotPath).replaceAll('\\', '/'),
    };
    const reportPath = path.join(outputDir, 'report.json');
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ report: reportPath, render: screenshotPath }, null, 2)}\n`);
  }
} finally {
  try { cdp?.close(); } catch {}
  try { browser.kill(); } catch {}
  try { server.kill(); } catch {}
  if (path.dirname(profileDir) === os.tmpdir() && path.basename(profileDir).startsWith('tinkercad-harness-')) {
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
  }
}
