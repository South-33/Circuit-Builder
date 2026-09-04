import { circuitStore } from '../circuit/store';
import { BREADBOARD_HOLE_PITCH } from '../breadboard/geometry';
import { evaluateLayout } from '../layout/quality';
import { CANVAS_CENTER_X, CANVAS_CENTER_Y } from '../layout/placement';
import { diagnoseCircuit } from '../sim/diagnostics';
import { endpointPoint } from '../wires/geometry';
import { BLOCK_UNITS_PER_CELL } from './geometry';
import { createRawCircuitTool } from './rawCircuit';
import { requireString } from './input';
import { toolResult } from './protocol';
import type { ToolDefinition } from './types';

type SceneOp =
  | { kind: 'part'; id: string; type: string; at: [number, number]; rotate?: number; attrs?: Record<string, unknown> }
  | { kind: 'move'; id: string; at: [number, number]; rotate?: number }
  | { kind: 'seat'; id: string; type: string; breadboardId: string; pin: string; hole: string; rotate?: number; attrs?: Record<string, unknown> }
  | { kind: 'wire'; id: string; from: string; to: string; color?: string; points?: ScenePoint[] }
  | { kind: 'wireH'; id: string; from: string; to: string; color?: string; lane: number | string }
  | { kind: 'wireV'; id: string; from: string; to: string; color?: string; lane: number | string }
  | { kind: 'removePart'; id: string }
  | { kind: 'removeWire'; id: string };

type AxisRef = { axis: 'x' | 'y'; endpoint: string };
type SceneCoordinate = number | AxisRef;
type ScenePoint = [SceneCoordinate, SceneCoordinate];

const rawTool = createRawCircuitTool();
const UNIT_PX = BREADBOARD_HOLE_PITCH / BLOCK_UNITS_PER_CELL;

function endpointUnit(endpoint: string): [number, number] {
  const point = endpointPoint(endpoint, circuitStore.getSnapshot().parts);
  if (!point) throw new Error(`Could not resolve endpoint ${endpoint}.`);
  return [
    (point.x - CANVAS_CENTER_X) / UNIT_PX,
    (point.y - CANVAS_CENTER_Y) / UNIT_PX,
  ];
}

function resolveCoordinate(value: SceneCoordinate, axis: 'x' | 'y') {
  if (typeof value === 'number') return value;
  if (value.axis !== axis) throw new Error(`Waypoint ${axis} coordinate cannot use ${value.axis}().`);
  return endpointUnit(value.endpoint)[axis === 'x' ? 0 : 1];
}

function resolveScenePoint(point: ScenePoint): [number, number] {
  return [resolveCoordinate(point[0], 'x'), resolveCoordinate(point[1], 'y')];
}

function workerSource(code: string) {
  return `
const __code=${JSON.stringify(code)}; const __ops=[]; let __count=0;
const budget=()=>{if(++__count>500)throw new Error('Too many scene operations')};
const id=v=>typeof v==='string'?v:(v&&typeof v.id==='string'?v.id:String(v??''));
const endpoint=v=>typeof v==='string'?v:(v&&typeof v.endpoint==='string'?v.endpoint:String(v??''));
const axis=(a,v)=>Object.freeze({axis:a,endpoint:endpoint(v)});
const x=v=>axis('x',v); const y=v=>axis('y',v);
const coord=v=>typeof v==='number'?v:(v&&((v.axis==='x')||(v.axis==='y'))&&typeof v.endpoint==='string'?v:Number(v));
const point=v=>{if(!Array.isArray(v)||v.length!==2)throw new Error('Expected [x,y]');return [coord(v[0]),coord(v[1])]};
const lane=v=>typeof v==='number'?v:endpoint(v);
const handle=i=>Object.freeze({id:i,pin(n){return Object.freeze({endpoint:i+':'+String(n),toString(){return this.endpoint}})},toString(){return i}});
const part=(i,t,at,r=0,a={})=>{budget();i=String(i);__ops.push({kind:'part',id:i,type:String(t),at:point(at),rotate:Number(r),attrs:a&&typeof a==='object'?a:{}});return handle(i)};
const move=(i,at,r)=>{budget();const op={kind:'move',id:id(i),at:point(at)};if(r!==undefined)op.rotate=Number(r);__ops.push(op)};
const seat=(i,t,b,p,h,a={},r=0)=>{budget();i=String(i);__ops.push({kind:'seat',id:i,type:String(t),breadboardId:id(b),pin:String(p),hole:String(h),attrs:a&&typeof a==='object'?a:{},rotate:Number(r)});return handle(i)};
const wire=(i,a,b,c='green',pts=[])=>{budget();if(!Array.isArray(pts))throw new Error('wire points must be an array');__ops.push({kind:'wire',id:String(i),from:endpoint(a),to:endpoint(b),color:String(c),points:pts.map(point)})};
const wireH=(i,a,b,c='green',yLane)=>{budget();const from=endpoint(a);__ops.push({kind:'wireH',id:String(i),from,to:endpoint(b),color:String(c),lane:yLane===undefined?from:lane(yLane)})};
const wireV=(i,a,b,c='green',xLane)=>{budget();const from=endpoint(a);__ops.push({kind:'wireV',id:String(i),from,to:endpoint(b),color:String(c),lane:xLane===undefined?from:lane(xLane)})};
const removePart=i=>{budget();__ops.push({kind:'removePart',id:id(i)})};
const removeWire=i=>{budget();__ops.push({kind:'removeWire',id:String(i)})};
self.fetch=undefined;self.XMLHttpRequest=undefined;self.WebSocket=undefined;self.importScripts=undefined;
(async()=>{const fn=new Function('part','move','seat','wire','wireH','wireV','x','y','removePart','removeWire','"use strict";return(async()=>{\\n'+__code+'\\n})()');await fn(part,move,seat,wire,wireH,wireV,x,y,removePart,removeWire);postMessage({ok:true,ops:__ops})})().catch(e=>postMessage({ok:false,error:e?.message||String(e)}));`;
}

async function runSceneScript(code: string): Promise<SceneOp[]> {
  const url = URL.createObjectURL(new Blob([workerSource(code)], { type: 'text/javascript' }));
  try {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(url);
      const timer = setTimeout(() => {
        worker.terminate();
        reject(new Error('Scene script exceeded 1500ms.'));
      }, 1500);
      worker.onmessage = (event: MessageEvent<{ ok: boolean; ops?: SceneOp[]; error?: string }>) => {
        clearTimeout(timer);
        worker.terminate();
        if (event.data?.ok && event.data.ops) resolve(event.data.ops);
        else reject(new Error(event.data?.error ?? 'Scene script failed.'));
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        worker.terminate();
        reject(new Error(event.message || 'Scene worker failed.'));
      };
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function opInput(op: SceneOp): Record<string, unknown> {
  switch (op.kind) {
    case 'part':
      return { parts: [{ id: op.id, type: op.type, at: op.at, rotate: op.rotate ?? 0, attrs: op.attrs ?? {} }] };
    case 'move':
      return { parts: [{ id: op.id, at: op.at, ...(op.rotate !== undefined ? { rotate: op.rotate } : {}) }] };
    case 'seat':
      return {
        parts: [{
          id: op.id,
          type: op.type,
          rotate: op.rotate ?? 0,
          attrs: op.attrs ?? {},
          seat: { breadboardId: op.breadboardId, pin: op.pin, hole: op.hole },
        }],
      };
    case 'wire':
      return { wires: [{ id: op.id, from: op.from, to: op.to, color: op.color, points: (op.points ?? []).map(resolveScenePoint) }] };
    case 'wireH': {
      const [fromX] = endpointUnit(op.from);
      const [toX] = endpointUnit(op.to);
      const laneY = typeof op.lane === 'number' ? op.lane : endpointUnit(op.lane)[1];
      return { wires: [{ id: op.id, from: op.from, to: op.to, color: op.color, points: [[fromX, laneY], [toX, laneY]] }] };
    }
    case 'wireV': {
      const [, fromY] = endpointUnit(op.from);
      const [, toY] = endpointUnit(op.to);
      const laneX = typeof op.lane === 'number' ? op.lane : endpointUnit(op.lane)[0];
      return { wires: [{ id: op.id, from: op.from, to: op.to, color: op.color, points: [[laneX, fromY], [laneX, toY]] }] };
    }
    case 'removePart':
      return { removePartIds: [op.id] };
    case 'removeWire':
      return { removeWireIds: [op.id] };
  }
}

function isWireOp(op: SceneOp): op is Extract<SceneOp, { kind: 'wire' | 'wireH' | 'wireV' }> {
  return op.kind === 'wire' || op.kind === 'wireH' || op.kind === 'wireV';
}

function isPartOp(op: SceneOp): op is Extract<SceneOp, { kind: 'part' | 'seat' }> {
  return op.kind === 'part' || op.kind === 'seat';
}

function mergePartInputs(ops: Array<Extract<SceneOp, { kind: 'part' | 'seat' }>>) {
  return {
    parts: ops.flatMap((op) => {
      const input = opInput(op);
      return Array.isArray(input.parts) ? input.parts : [];
    }),
  };
}

function mergeWireInputs(ops: Array<Extract<SceneOp, { kind: 'wire' | 'wireH' | 'wireV' }>>) {
  return {
    wires: ops.flatMap((op) => {
      const input = opInput(op);
      return Array.isArray(input.wires) ? input.wires : [];
    }),
  };
}

export function createSceneBuildCircuitTool(): ToolDefinition {
  return {
    name: 'build-circuit',
    description: `Build and revise the literal 2D circuit scene with a tiny JavaScript API. Place components, seat breadboard parts, and draw the visible wire paths yourself. There is no semantic compiler and no auto-router.

Coordinates: component positions are [x,y] breadboard-pitch cells from workbench center. Wire points are fine-grid coordinates where 10 units = 1 component cell. The normal routing primitive is wire(..., points): give the visible orthogonal polyline explicitly from source pin toward destination. In a waypoint, x(endpoint) borrows that pin/hole's exact x coordinate and y(endpoint) borrows its exact y coordinate, so dense buses do not require decimal coordinate lookup/copying. Write an entire cable bundle or bus in one script with arrays/loops instead of probing one wire at a time. Route bundles from the connector toward the destination through the nearest open corridor; do not wrap a bus around or enclose a component merely to keep parallel lanes. wireH/wireV are only shortcuts for simple one-lane cables.

Available functions:
part(id, type, [x,y], rotate=0, attrs={})
move(id, [x,y], rotate?)
seat(id, type, breadboardId, anchorPin, hole, attrs={}, rotate=0)
wire(id, from, to, color='green', points=[])
wireH(id, from, to, color='green', yLaneOrEndpoint?)
wireV(id, from, to, color='green', xLaneOrEndpoint?)
removePart(id)
removeWire(id)

Calls edit the current scene atomically. There is no replace/clear operation. Make a rough composition, inspect the rendered workbench, then make small local edits. Every authored wire segment, including pin-to-first-point and last-point-to-pin, must be exactly horizontal or vertical. Prefer a small number of purposeful bends. Treat electrical diagnostics as correctness checks, not visual-quality scores. Example:
const uno = part('uno','arduino-uno',[-52,-10]);
part('board','breadboard',[-21,-10]);
seat('q1','npn-transistor','board','E','E30');
wire('sig', uno.pin('5'), 'board:A20', 'blue', [[x(uno.pin('5')),-120],[x('board:A20'),-120]]);

// Dense wiring should be authored as a bundle, not discovered wire-by-wire.
const bus = [
  ['row1','keypad:R1','uno:2','blue', 260],
  ['row2','keypad:R2','uno:3','blue', 270],
  ['row3','keypad:R3','uno:4','blue', 280],
];
for (const [id, from, to, color, laneY] of bus) {
  wire(id, from, to, color, [[x(from),laneY],[x(to),laneY]]);
}

// Convenience shortcuts remain available for a genuinely simple cable:
wireV('battery', 'bat:+', 'board:+top26', 'red', 'board:+top26');`,
    inputSchema: {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'JavaScript using only part, move, seat, wire, wireH, wireV, removePart, and removeWire.' },
      },
      required: ['script'],
    },
    async execute(input, options) {
      const script = requireString(input.script, 'script');
      const ops = await runSceneScript(script);
      const before = structuredClone(circuitStore.getSnapshot());
      try {
        let partBatch: Array<Extract<SceneOp, { kind: 'part' | 'seat' }>> = [];
        let wireBatch: Array<Extract<SceneOp, { kind: 'wire' | 'wireH' | 'wireV' }>> = [];
        const flushParts = async () => {
          if (!partBatch.length) return;
          const batch = partBatch;
          partBatch = [];
          await rawTool.execute(mergePartInputs(batch), options);
        };
        const flushWires = async () => {
          if (!wireBatch.length) return;
          const batch = wireBatch;
          wireBatch = [];
          await rawTool.execute(mergeWireInputs(batch), options);
        };

        for (const op of ops) {
          if (isPartOp(op)) {
            await flushWires();
            partBatch.push(op);
            continue;
          }
          if (isWireOp(op)) {
            await flushParts();
            wireBatch.push(op);
            continue;
          }
          await flushParts();
          await flushWires();
          await rawTool.execute(opInput(op), options);
        }
        await flushParts();
        await flushWires();
      } catch (error) {
        circuitStore.replaceDocument({ parts: before.parts, connections: before.connections });
        throw error;
      }

      const state = circuitStore.getSnapshot();
      const diagnostics = diagnoseCircuit(state);
      const layout = evaluateLayout(state);
      const hardPlacementErrors = layout.issues.filter((item) => item.severity === 'error');
      return toolResult({
        harness: 'direct-scene',
        operations: ops.length,
        state: { parts: state.parts.length, wires: state.connections.length },
        diagnostics: {
          errors: diagnostics.filter((item) => item.severity === 'error').length,
          warnings: diagnostics.filter((item) => item.severity === 'warning').length,
          ...(diagnostics.length <= 4 ? { items: diagnostics } : {}),
        },
        ...(hardPlacementErrors.length ? { hardPlacementErrors } : {}),
      });
    },
  };
}
