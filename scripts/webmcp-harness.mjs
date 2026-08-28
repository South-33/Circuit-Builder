// WebMCP Autonomous Agent Benchmark & Evaluation Harness
// Evaluates LLM agent ergonomics, latency, token payload efficiency, layout scoring, and fine-grained workbench control.

import {
  callWebMcp,
  webMcpToolRegistry,
  circuitStore,
  evaluateLayout,
  diagnoseCircuit,
} from './test-circuits.mjs';

export class WebMcpHarness {
  constructor(sessionName = 'Autonomous Agent Session') {
    this.sessionName = sessionName;
    this.history = [];
    this.startTime = performance.now();
    this.metrics = {
      calls: 0,
      totalLatencyMs: 0,
      bytesSent: 0,
      bytesReceived: 0,
      errors: 0,
    };
  }

  getToolSchemas() {
    return Array.from(webMcpToolRegistry.values()).map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }

  async call(toolName, input = {}) {
    const start = performance.now();
    const inputJson = JSON.stringify(input);
    this.metrics.calls += 1;
    this.metrics.bytesSent += inputJson.length;

    try {
      const output = await callWebMcp(toolName, input);
      const elapsed = performance.now() - start;
      const outputJson = JSON.stringify(output);
      this.metrics.totalLatencyMs += elapsed;
      this.metrics.bytesReceived += outputJson.length;

      this.history.push({
        step: this.metrics.calls,
        tool: toolName,
        input,
        output,
        latencyMs: Math.round(elapsed * 10) / 10,
        payloadSize: { inputBytes: inputJson.length, outputBytes: outputJson.length },
        status: 'success',
      });

      return output;
    } catch (error) {
      const elapsed = performance.now() - start;
      this.metrics.errors += 1;
      this.history.push({
        step: this.metrics.calls,
        tool: toolName,
        input,
        error: error.message,
        latencyMs: Math.round(elapsed * 10) / 10,
        status: 'error',
      });
      throw error;
    }
  }

  getReport() {
    const doc = circuitStore.getSnapshot();
    const layout = evaluateLayout(doc);
    const diagnostics = diagnoseCircuit(doc);
    const totalDurationMs = Math.round(performance.now() - this.startTime);

    return {
      sessionName: this.sessionName,
      durationMs: totalDurationMs,
      totalCalls: this.metrics.calls,
      failedCalls: this.metrics.errors,
      avgLatencyPerCallMs: Math.round((this.metrics.totalLatencyMs / (this.metrics.calls || 1)) * 10) / 10,
      totalTrafficKb: Math.round(((this.metrics.bytesSent + this.metrics.bytesReceived) / 1024) * 10) / 10,
      circuitState: {
        partsCount: doc.parts.length,
        wiresCount: doc.connections.length,
        layoutScore: layout.score,
        layoutGrade: layout.grade,
        layoutIssuesCount: layout.issues.length,
        diagnosticErrors: diagnostics.filter((d) => d.severity === 'error').length,
        diagnosticWarnings: diagnostics.filter((d) => d.severity === 'warning').length,
        simulationStatus: doc.simulation.status,
      },
    };
  }
}

async function runBenchmarkExperiments() {
  console.log('====================================================');
  console.log('      WebMCP Autonomous Agent Benchmark Harness     ');
  console.log('====================================================\n');

  // Experiment A: Multi-turn Sequential Assembly
  console.log('--- EXPERIMENT A: Multi-turn Sequential Assembly ---');
  const multiTurn = new WebMcpHarness('Multi-Turn Sequential Assembly');

  await multiTurn.call('inspect-circuit');
  await multiTurn.call('edit-circuit', {
    replace: true,
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', grid: { x: 2, y: 8 } },
      { id: 'bb1', type: 'breadboard-half', grid: { x: 14, y: 8 } },
      { id: 'bat1', type: 'battery-9v', grid: { x: 24, y: 1 } },
      { id: 'motor1', type: 'dc-motor', grid: { x: 18, y: 20 } },
      { id: 'remote1', type: 'wokwi-ir-remote', grid: { x: 29, y: 8 } },
      { id: 't1', type: 'npn-transistor', seat: { breadboardId: 'bb1', pin: 'B', hole: 'E18' } },
      { id: 'd1', type: 'rectifier-diode', seat: { breadboardId: 'bb1', pin: 'C', hole: 'C14' } },
      { id: 'r_base', type: 'wokwi-resistor', seat: { breadboardId: 'bb1', pin: '1', hole: 'B10' }, attrs: { value: '1000' } },
      { id: 'led1', type: 'wokwi-led', seat: { breadboardId: 'bb1', pin: 'A', hole: 'E5' } },
      { id: 'r_led', type: 'wokwi-resistor', seat: { breadboardId: 'bb1', pin: '1', hole: 'A5' }, attrs: { value: '220' } },
    ],
  });
  await multiTurn.call('connect-pins', {
    connections: [
      { from: 'uno1:5V', to: 'bb1:+bottom1', role: 'power', gridWaypoints: [{ x: 8, y: 18 }, { x: 14, y: 18 }] },
      { from: 'uno1:GND.1', to: 'bb1:-bottom1', role: 'ground', gridWaypoints: [{ x: 8, y: 19 }, { x: 14, y: 19 }] },
      { from: 'bat1:+', to: 'bb1:+top20', role: 'power', gridWaypoints: [{ x: 26, y: 6 }, { x: 21, y: 6 }] },
      { from: 'bat1:-', to: 'bb1:-top20', role: 'ground', gridWaypoints: [{ x: 24, y: 6 }, { x: 20, y: 6 }] },
      { from: 'bb1:-top25', to: 'bb1:-bottom25', role: 'ground', gridWaypoints: [{ x: 23, y: 7 }, { x: 23, y: 19 }] },
      { from: 'uno1:3', to: 'bb1:E10', role: 'signal', gridWaypoints: [{ x: 8, y: 9 }, { x: 17, y: 9 }] },
      { from: 'uno1:13', to: 'bb1:E5', role: 'signal', gridWaypoints: [{ x: 8, y: 8 }, { x: 15, y: 8 }] },
      { from: 'motor1:1', to: 'bb1:B18', role: 'signal', gridWaypoints: [{ x: 19, y: 17 }, { x: 19, y: 14 }] },
      { from: 'motor1:2', to: 'bb1:+top18', role: 'power', gridWaypoints: [{ x: 21, y: 17 }, { x: 22, y: 17 }, { x: 22, y: 6 }] },
    ],
  });
  await multiTurn.call('set-code', {
    boardId: 'uno1',
    code: `
      const int motorPin = 3;
      const int ledPin = 13;
      void setup() { pinMode(motorPin, OUTPUT); pinMode(ledPin, OUTPUT); analogWrite(motorPin, 180); digitalWrite(ledPin, HIGH); }
      void loop() { delay(100); }
    `,
  });
  await multiTurn.call('simulate', { action: 'start' });
  await multiTurn.call('simulate', { action: 'stop' });

  const reportA = multiTurn.getReport();
  console.log(`  -> Duration: ${reportA.durationMs}ms | Calls: ${reportA.totalCalls} | Traffic: ${reportA.totalTrafficKb}KB | Score: ${reportA.circuitState.layoutScore}/100\n`);

  // Experiment B: Atomic 1-Call Whole-Circuit Assembly
  console.log('--- EXPERIMENT B: Atomic 1-Call Whole-Circuit Assembly ---');
  const atomicTurn = new WebMcpHarness('Atomic 1-Call Whole-Circuit Assembly');

  await atomicTurn.call('edit-circuit', {
    replace: true,
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', grid: { x: 2, y: 8 } },
      { id: 'bb1', type: 'breadboard-half', grid: { x: 14, y: 8 } },
      { id: 'bat1', type: 'battery-9v', grid: { x: 24, y: 1 } },
      { id: 'motor1', type: 'dc-motor', grid: { x: 18, y: 20 } },
      { id: 'remote1', type: 'wokwi-ir-remote', grid: { x: 29, y: 8 } },
      { id: 't1', type: 'npn-transistor', seat: { breadboardId: 'bb1', pin: 'B', hole: 'E18' } },
      { id: 'd1', type: 'rectifier-diode', seat: { breadboardId: 'bb1', pin: 'C', hole: 'C14' } },
      { id: 'r_base', type: 'wokwi-resistor', seat: { breadboardId: 'bb1', pin: '1', hole: 'B10' }, attrs: { value: '1000' } },
      { id: 'led1', type: 'wokwi-led', seat: { breadboardId: 'bb1', pin: 'A', hole: 'E5' } },
      { id: 'r_led', type: 'wokwi-resistor', seat: { breadboardId: 'bb1', pin: '1', hole: 'A5' }, attrs: { value: '220' } },
    ],
    connections: [
      { from: 'uno1:5V', to: 'bb1:+bottom1', role: 'power', gridWaypoints: [{ x: 8, y: 18 }, { x: 14, y: 18 }] },
      { from: 'uno1:GND.1', to: 'bb1:-bottom1', role: 'ground', gridWaypoints: [{ x: 8, y: 19 }, { x: 14, y: 19 }] },
      { from: 'bat1:+', to: 'bb1:+top20', role: 'power', gridWaypoints: [{ x: 26, y: 6 }, { x: 21, y: 6 }] },
      { from: 'bat1:-', to: 'bb1:-top20', role: 'ground', gridWaypoints: [{ x: 24, y: 6 }, { x: 20, y: 6 }] },
      { from: 'bb1:-top25', to: 'bb1:-bottom25', role: 'ground', gridWaypoints: [{ x: 23, y: 7 }, { x: 23, y: 19 }] },
      { from: 'uno1:3', to: 'bb1:E10', role: 'signal', gridWaypoints: [{ x: 8, y: 9 }, { x: 17, y: 9 }] },
      { from: 'uno1:13', to: 'bb1:E5', role: 'signal', gridWaypoints: [{ x: 8, y: 8 }, { x: 15, y: 8 }] },
      { from: 'motor1:1', to: 'bb1:B18', role: 'signal', gridWaypoints: [{ x: 19, y: 17 }, { x: 19, y: 14 }] },
      { from: 'motor1:2', to: 'bb1:+top18', role: 'power', gridWaypoints: [{ x: 21, y: 17 }, { x: 22, y: 17 }, { x: 22, y: 6 }] },
    ],
    code: `
      const int motorPin = 3;
      const int ledPin = 13;
      void setup() { pinMode(motorPin, OUTPUT); pinMode(ledPin, OUTPUT); analogWrite(motorPin, 180); digitalWrite(ledPin, HIGH); }
      void loop() { delay(100); }
    `,
  });

  await atomicTurn.call('simulate', { action: 'start' });
  await atomicTurn.call('simulate', { action: 'stop' });

  const reportB = atomicTurn.getReport();
  console.log(`  -> Duration: ${reportB.durationMs}ms | Calls: ${reportB.totalCalls} | Traffic: ${reportB.totalTrafficKb}KB | Score: ${reportB.circuitState.layoutScore}/100\n`);

  // Experiment C: Fine-Grained Agentic Micro-Operations (Nudge, Rotate, Net Trace, Rewire)
  console.log('--- EXPERIMENT C: Fine-Grained Agentic Micro-Operations (Nudge, Rotate, Net Trace, In-Place Rewiring) ---');
  const fineGrained = new WebMcpHarness('Fine-Grained Micro-Operations');

  // 1. Initial layout
  await fineGrained.call('edit-circuit', {
    replace: true,
    parts: [
      { id: 'uno1', type: 'wokwi-arduino-uno', grid: { x: 2, y: 8 } },
      { id: 'bb1', type: 'breadboard-half', grid: { x: 14, y: 8 } },
      { id: 'bat1', type: 'battery-9v', grid: { x: 24, y: 1 } },
      { id: 'motor1', type: 'dc-motor', grid: { x: 18, y: 20 } },
      { id: 'remote1', type: 'wokwi-ir-remote', grid: { x: 29, y: 8 } },
    ],
    connections: [
      { id: 'w_pwr', from: 'uno1:5V', to: 'bb1:+bottom1', role: 'power' },
      { id: 'w_gnd', from: 'uno1:GND.1', to: 'bb1:-bottom1', role: 'ground' },
    ],
  });

  // 2. Net Trace probe: what is connected to 5V?
  const inspectNet = await fineGrained.call('inspect-circuit', { netOf: 'uno1:5V' });
  console.log(`     [Probe] Net Trace on uno1:5V found ${inspectNet.net?.connectedNodes?.length || 0} connected nodes`);

  // 3. Agent nudges DC Motor right by 2 grid units and rotates remote by +45 degrees
  await fineGrained.call('edit-circuit', {
    parts: [
      { id: 'motor1', type: 'dc-motor', nudge: { dx: 2, dy: 0 } },
      { id: 'remote1', type: 'wokwi-ir-remote', rotateBy: 45 },
    ],
  });

  // 4. Agent reroutes w_pwr with explicit orthogonal pipe waypoints in-place
  await fineGrained.call('connect-pins', {
    connections: [
      { id: 'w_pwr', gridWaypoints: [{ x: 8, y: 18 }, { x: 14, y: 18 }] },
    ],
  });

  // 5. Agent inspects only motor1 and remote1
  const selectiveInspect = await fineGrained.call('inspect-circuit', { partIds: ['motor1', 'remote1'] });
  console.log(`     [Inspect] Selective filter returned ${selectiveInspect.parts?.length} parts`);

  const reportC = fineGrained.getReport();
  console.log(`  -> Duration: ${reportC.durationMs}ms | Calls: ${reportC.totalCalls} | Traffic: ${reportC.totalTrafficKb}KB | Score: ${reportC.circuitState.layoutScore}/100\n`);

  // Comparison Matrix
  console.log('====================================================');
  console.log('              HARNESS COMPARISON MATRIX             ');
  console.log('====================================================');
  console.table([
    { Strategy: 'Multi-Turn Sequential', Calls: reportA.totalCalls, TimeMs: reportA.durationMs, TrafficKB: reportA.totalTrafficKb, Score: reportA.circuitState.layoutScore },
    { Strategy: 'Atomic 1-Call Assembly', Calls: reportB.totalCalls, TimeMs: reportB.durationMs, TrafficKB: reportB.totalTrafficKb, Score: reportB.circuitState.layoutScore },
    { Strategy: 'Fine-Grained Micro-Ops', Calls: reportC.totalCalls, TimeMs: reportC.durationMs, TrafficKB: reportC.totalTrafficKb, Score: reportC.circuitState.layoutScore },
  ]);
}

if (process.argv[1]?.endsWith('webmcp-harness.mjs')) {
  runBenchmarkExperiments().catch((err) => {
    console.error('Benchmark experiment failed:', err);
    process.exit(1);
  });
}
