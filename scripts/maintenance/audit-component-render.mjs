#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Browser-level smoke audit for the real component renderer. This catches
// layout/CSS problems that the geometry-only audit cannot see (for example a
// shadow SVG being shifted away from its logical pin coordinates).

import { register } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register('../testing/loader.mjs', import.meta.url);

const { PART_TYPES } = await import('../../src/components/partTypes.ts');
const { PART_DEFINITIONS } = await import('../../src/components/parts.ts');
const { getBreadboardGeometry } = await import('../../src/breadboard/geometry.ts');

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(.:)/, '$1')), '../..');
const serverPort = 4179 + Math.floor(Math.random() * 300);
const debugPort = 9379 + Math.floor(Math.random() * 300);
const serverUrl = `http://127.0.0.1:${serverPort}/?harness=a`;

function findChrome() {
  const candidates = process.platform === 'win32'
    ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
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
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
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
    const result = await this.call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'Browser evaluation failed');
    }
    return result.result.value;
  }
  close() { this.ws.close(); }
}

const chrome = findChrome();
if (!chrome) {
  console.error('Component render audit requires Chrome, Chromium, or Edge.');
  process.exit(1);
}

const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const server = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(serverPort), '--strictPort'], {
  cwd: root,
  stdio: 'ignore',
});
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hardware-lab-grid-audit-'));
const browser = spawn(chrome, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--remote-allow-origins=*',
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`,
  '--window-size=1280,900',
  serverUrl,
], { stdio: 'ignore' });

let cdp;
try {
  await waitFor(serverUrl);
  const version = await (await waitFor(`http://127.0.0.1:${debugPort}/json/version`)).json();
  const targets = await (await waitFor(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const target = targets.find((item) => item.type === 'page' && item.url.includes(`127.0.0.1:${serverPort}`));
  if (!target) throw new Error('Could not find the Hardware Lab browser target.');
  cdp = new CDP(target.webSocketDebuggerUrl ?? version.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.call('Page.enable');
  const uiDeadline = Date.now() + 10000;
  while (Date.now() < uiDeadline) {
    if (await cdp.evaluate("Boolean(document.querySelector('.canvas-world'))")) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const grid = await cdp.evaluate(`(() => {
    const world = document.querySelector('.canvas-world');
    if (!world) return null;
    const style = getComputedStyle(world);
    return { size: style.backgroundSize, position: style.backgroundPosition };
  })()`);
  if (!grid || grid.size !== '9.6px 9.6px' || grid.position !== '-4.8px -4.8px') {
    throw new Error(`Visible grid is out of phase with connector lattice: ${JSON.stringify(grid)}`);
  }

  const metadata = PART_TYPES.map((type) => {
    const definition = PART_DEFINITIONS[type];
    const breadboard = getBreadboardGeometry(type);
    return {
      type,
      tag: definition.tag ?? null,
      asset: breadboard?.asset ?? definition.asset ?? (type === 'dc-motor' ? '/assets/fritzing/dc-motor.svg' : null),
      scale: definition.renderScale,
      width: definition.naturalSize.width,
      height: definition.naturalSize.height,
      defaults: definition.defaults,
    };
  });

  const rows = [];
  for (const definition of metadata) {
    const result = await cdp.evaluate(`(async () => {
      const d = ${JSON.stringify(definition)};
      const root = document.createElement('div');
      Object.assign(root.style, { position: 'fixed', left: '20px', top: '20px', width: '900px', height: '700px', zIndex: 999999, background: 'white' });
      document.body.append(root);
      const holder = document.createElement('div');
      holder.className = 'part-render';
      Object.assign(holder.style, { position: 'absolute', left: '100px', top: '100px' });
      root.append(holder);
      let output;
      try {
        if (d.tag) {
          await customElements.whenDefined(d.tag);
          const element = document.createElement(d.tag);
          for (const [key, value] of Object.entries(d.defaults || {})) {
            try { element[key] = value; } catch {}
          }
          element.style.transformOrigin = '0 0';
          element.style.transform = 'scale(' + d.scale + ')';
          holder.append(element);
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const host = element.getBoundingClientRect();
          const holderRect = holder.getBoundingClientRect();
          const outerVisuals = [...(element.shadowRoot?.children ?? [])]
            .filter((node) => !['STYLE', 'SCRIPT'].includes(node.tagName))
            .map((node) => {
              const rect = node.getBoundingClientRect();
              return { x: rect.x - holderRect.x, y: rect.y - holderRect.y, width: rect.width, height: rect.height, area: rect.width * rect.height };
            })
            .filter((item) => item.area > 0)
            .sort((a, b) => b.area - a.area);
          const outerVisual = outerVisuals[0] ?? null;
          const graphics = [...(element.shadowRoot?.querySelectorAll('svg,canvas,img') ?? [])]
            .map((node) => {
              const rect = node.getBoundingClientRect();
              return { x: rect.x - host.x, y: rect.y - host.y, width: rect.width, height: rect.height, area: rect.width * rect.height };
            })
            .filter((item) => item.area > 0);
          let resistorAxisError = null;
          if (d.tag === 'wokwi-resistor') {
            const lead = element.shadowRoot?.querySelector('rect');
            const pin = element.pinInfo?.[0];
            if (lead && pin) {
              const rect = lead.getBoundingClientRect();
              const leadCenter = rect.y + rect.height / 2 - host.y;
              resistorAxisError = Math.abs(leadCenter - pin.y * d.scale);
            }
          }
          output = {
            type: d.type,
            kind: 'element',
            width: host.width,
            height: host.height,
            graphics: graphics.length,
            outerVisual,
            resistorAxisError,
            ok: host.width > 0
              && host.height > 0
              && graphics.length > 0
              && outerVisual != null
              && Math.abs(outerVisual.x) <= 0.75
              && Math.abs(outerVisual.y) <= 0.75
              && (resistorAxisError == null || resistorAxisError <= 0.15),
          };
        } else if (d.asset) {
          const image = document.createElement('img');
          image.src = d.asset;
          image.style.width = (d.width * d.scale) + 'px';
          image.style.height = (d.height * d.scale) + 'px';
          holder.append(image);
          await new Promise((resolve) => {
            if (image.complete) resolve();
            else { image.onload = resolve; image.onerror = resolve; }
          });
          const rect = image.getBoundingClientRect();
          output = { type: d.type, kind: 'asset', width: rect.width, height: rect.height, loaded: image.naturalWidth > 0, ok: image.naturalWidth > 0 && rect.width > 0 && rect.height > 0 };
        } else {
          output = { type: d.type, kind: 'unknown', ok: false };
        }
      } finally {
        root.remove();
      }
      return output;
    })()`);
    rows.push(result);
  }

  const failures = rows.filter((row) => !row.ok);
  console.table(rows.map((row) => ({
    type: row.type,
    renderer: row.kind,
    width: Number((row.width ?? 0).toFixed(1)),
    height: Number((row.height ?? 0).toFixed(1)),
    status: row.ok ? 'ok' : 'FAIL',
  })));
  const suspiciousOrigins = rows.filter((row) => row.kind === 'element' && row.outerVisual && (Math.abs(row.outerVisual.x) > 0.75 || Math.abs(row.outerVisual.y) > 0.75));
  if (suspiciousOrigins.length) {
    console.log('Outer visual origins offset from the component wrapper:');
    console.table(suspiciousOrigins.map((row) => ({ type: row.type, x: Number(row.outerVisual.x.toFixed(2)), y: Number(row.outerVisual.y.toFixed(2)), width: Number(row.outerVisual.width.toFixed(1)), height: Number(row.outerVisual.height.toFixed(1)) })));
  }
  const resistor = rows.find((row) => row.type === 'wokwi-resistor');
  if (resistor?.resistorAxisError != null) {
    console.log(`Resistor visual lead/pin axis error: ${resistor.resistorAxisError.toFixed(4)}px`);
  }
  console.log(`\n${rows.length - failures.length}/${rows.length} components render successfully with the real app CSS and connector-grid phase.`);
  if (failures.length) {
    console.error(`Failures: ${failures.map((row) => row.type).join(', ')}`);
    process.exitCode = 1;
  }
} finally {
  try { cdp?.close(); } catch {}
  try { browser.kill(); } catch {}
  try { server.kill(); } catch {}
  try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
}
