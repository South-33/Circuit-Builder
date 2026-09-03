import { BREADBOARD_HOLE_PITCH, breadboardHoleNet, getBreadboardGeometry, isBreadboardType } from '../breadboard/geometry';
import { seatPartAtHole } from '../breadboard/placement';
import { getPartBounds, getPartPins, PART_DEFINITIONS, resolvePinName } from '../components/parts';
import { circuitStore } from '../circuit/store';
import type { CircuitPart, PartAttrs, PartType } from '../circuit/types';
import { evaluateLayout } from '../layout/quality';
import { diagnoseCircuit } from '../sim/diagnostics';
import { classifyPowerPin } from '../sim/pins';
import { endpointParts, endpointPoint, partRect, pinExitDirection } from '../wires/geometry';
import { connectionPolyline } from '../wires/path';
import type { WireRole } from '../wires/conventions';
import { createBuildCircuitTool } from './buildCircuit';
import { BLOCK_CELL_PX, blockDefinition, blockPlacement, partBlockAt, type BlockCell } from './geometry';
import { agentPartTypeEnum, requireId, requirePartType, requireString } from './input';
import { toolResult } from './protocol';
import type { ToolDefinition } from './types';

type Side = 'left' | 'right' | 'above' | 'below';
type ScriptPart = { id:string; type:string; attrs?:Record<string,unknown>; rotate?:number; near?:{anchorId:string;side:Side}; place?:{x:number;y:number;rotate?:number}; boardId?:string; seat?:{boardId:string;pin:string;hole:string} };
type ScriptNet = { id:string; role?:WireRole; endpoints:string[]; source?:string };
type ScriptStage = { id:string; members:string[] };
type ScriptFlow = { refs:string[] };
type ScriptDesign = { parts:ScriptPart[]; nets:ScriptNet[]; stages:ScriptStage[]; flows:ScriptFlow[]; code:Array<{boardId:string;text:string}> };
type SemanticPart = Omit<ScriptPart,'type'|'attrs'> & { type:PartType; attrs:PartAttrs };
type SemanticNet = { id:string; role?:WireRole; endpoints:string[]; source?:string };
type SemanticDesign = { parts:SemanticPart[]; nets:SemanticNet[]; stages:ScriptStage[]; flows:ScriptFlow[]; code:Array<{boardId:string;text:string}> };
type Model = { groupOf:Map<string,string>; members:Map<string,string[]>; role:Map<string,WireRole|undefined>; source:Map<string,string|undefined>; name:Map<string,string> };
type ConnectorFieldAlignment = { controllerId:string; boardId:string; busIds:string[]; half:'upper'|'lower'; offsetCells:number };
type CompositionAdvice = { kind:'parallel-bus-flow'|'incomplete-local-stage'|'oversized-explicit-board'; itemIds:string[]; message:string };
type Plan = { program:string; codeBoardId?:string; code?:string; autoBoard:boolean; autoBoards:string[]; autoSeated:string[]; autoPlaced:string[]; composition:{stages:ScriptStage[];flows:ScriptFlow[];boardWindows:Array<{boardId:string;stageId?:string;members:string[];min:number;max:number}>;connectorAlignments:ConnectorFieldAlignment[]} };
type Composition = { stageOf:Map<string,string>; stages:Map<string,ScriptStage>; stageRank:Map<string,number>; partRank:Map<string,number> };

const buildTool = createBuildCircuitTool();
const VALID_SIDES = new Set<Side>(['left','right','above','below']);
const GAP = 3;
const ACCESS_CLEARANCE = BLOCK_CELL_PX * 0.55;

function workerSource(code:string) {
  return `
const __code=${JSON.stringify(code)}; const __d={parts:[],nets:[],stages:[],flows:[],code:[]}; let __n=0,__ops=0;
const __partTypes=new Set(${JSON.stringify(agentPartTypeEnum)});
const budget=()=>{if(++__ops>600)throw new Error('Too many semantic operations')};
const id=v=>typeof v==='string'?v:(v&&typeof v.id==='string'?v.id:String(v??''));
const ep=v=>typeof v==='string'?v:(v&&typeof v.endpoint==='string'?v.endpoint:String(v??''));
const handle=i=>Object.freeze({id:i,pin(n){return Object.freeze({endpoint:i+':'+String(n),toString(){return this.endpoint}})},toString(){return i}});
const part=(a,b,c={})=>{
  budget();
  let i,t,attrs;
  if(typeof b==='string'){
    // Canonical: part(id,type,attrs). Also accept the natural part(type,id,attrs)
    // form when the first argument is a known component type and the second is not.
    if(__partTypes.has(a)&&!__partTypes.has(b)){t=a;i=b;attrs=c}
    else{i=a;t=b;attrs=c}
  }else{
    // Shorthand: part(type) or part(type,{id, ...attrs}).
    t=a;attrs=b&&typeof b==='object'?{...b}:{};i=typeof attrs.id==='string'?attrs.id:String(a);delete attrs.id;
  }
  i=String(i);t=String(t);
  if(__d.parts.some(x=>x.id===i))throw new Error('Duplicate part '+i+'. Give repeated component types unique ids, e.g. part("baseResistor","resistor",{resistance:1000}) or part("resistor",{id:"baseResistor",resistance:1000}).');
  __d.parts.push({id:i,type:t,attrs:attrs&&typeof attrs==='object'?attrs:{}});return handle(i)
};
const connect=(a,b,o={})=>{budget();o=typeof o==='string'?{id:o}:o||{};__d.nets.push({id:o.id||'wire'+(++__n),...(o.role?{role:o.role}:{}),endpoints:[ep(a),ep(b)]})};
const wire=connect;
const net=(i,...p)=>{budget();__d.nets.push({id:String(i),role:'signal',endpoints:p.map(ep)})};
const power=(s,...c)=>{budget();__d.nets.push({id:'power'+(++__n),role:'power',source:ep(s),endpoints:[s,...c].map(ep)})};
const ground=(s,...c)=>{budget();__d.nets.push({id:'ground'+(++__n),role:'ground',source:ep(s),endpoints:[s,...c].map(ep)})};
const code=(b,t)=>{budget();__d.code.push({boardId:id(b),text:String(t)})};
const near=(p,a,s)=>{budget();const x=__d.parts.find(v=>v.id===id(p));if(!x)throw new Error('near unknown '+id(p));x.near={anchorId:id(a),side:String(s)}};
const place=(p,x,y,r=0)=>{budget();const v=__d.parts.find(z=>z.id===id(p));if(!v)throw new Error('place unknown '+id(p));v.place=x&&typeof x==='object'?{x:Number(x.x),y:Number(x.y),rotate:Number(x.rotate??0)}:{x:Number(x),y:Number(y),rotate:Number(r)}};
const rotate=(p,r)=>{budget();const v=__d.parts.find(z=>z.id===id(p));if(!v)throw new Error('rotate unknown '+id(p));v.rotate=Number(r)};
const mount=(p,b)=>{budget();const v=__d.parts.find(z=>z.id===id(p));if(!v)throw new Error('mount unknown '+id(p));v.boardId=id(b)};
const seat=(p,b,pin,hole)=>{budget();const v=__d.parts.find(z=>z.id===id(p));if(!v)throw new Error('seat unknown '+id(p));v.boardId=id(b);v.seat={boardId:id(b),pin:String(pin),hole:String(hole)}};
const stage=(i,...members)=>{budget();i=String(i);if(__d.stages.some(x=>x.id===i))throw new Error('Duplicate stage '+i);const refs=members.flat(Infinity).map(id);if(!refs.length)throw new Error('Stage '+i+' needs at least one part');__d.stages.push({id:i,members:refs});return Object.freeze({id:i,toString(){return i}})};
const flow=(...refs)=>{budget();const ids=refs.flat(Infinity).map(id);if(ids.length<2)throw new Error('flow needs at least two stages or parts');__d.flows.push({refs:ids})};
self.fetch=undefined;self.XMLHttpRequest=undefined;self.WebSocket=undefined;self.importScripts=undefined;
(async()=>{const fn=new Function('part','connect','wire','net','power','ground','code','near','place','rotate','mount','seat','stage','flow','"use strict";return(async()=>{\\n'+__code+'\\n})()');await fn(part,connect,wire,net,power,ground,code,near,place,rotate,mount,seat,stage,flow);postMessage({ok:true,design:__d})})().catch(e=>postMessage({ok:false,error:e?.message||String(e)}));`;
}

async function runScript(code:string):Promise<ScriptDesign> {
  const url=URL.createObjectURL(new Blob([workerSource(code)],{type:'text/javascript'}));
  try { return await new Promise((resolve,reject)=>{
    const worker=new Worker(url); const timer=setTimeout(()=>{worker.terminate();reject(new Error('Circuit script exceeded 1500ms'))},1500);
    worker.onmessage=(e:MessageEvent<{ok:boolean;design?:ScriptDesign;error?:string}>)=>{clearTimeout(timer);worker.terminate();e.data?.ok&&e.data.design?resolve(e.data.design):reject(new Error(e.data?.error??'Circuit script failed'))};
    worker.onerror=e=>{clearTimeout(timer);worker.terminate();reject(new Error(e.message||'Circuit worker failed'))};
  }); } finally { URL.revokeObjectURL(url); }
}

function angle(value:unknown){const d=Number(value??0);if(!Number.isFinite(d))throw new Error('rotation must be numeric');return ((Math.round(d/90)*90)%360+360)%360}

function normalize(raw:ScriptDesign):SemanticDesign {
  const ids=new Set<string>();
  const parts=raw.parts.map((item,index):SemanticPart=>{
    const id=requireId(item.id,`parts[${index}].id`); if(ids.has(id))throw new Error(`Duplicate part ${id}`); ids.add(id);
    const type=requirePartType(item.type,`parts[${index}].type`);
    if(item.near&&!VALID_SIDES.has(item.near.side))throw new Error(`${id}: invalid near side`);
    if(item.place&&(!Number.isInteger(item.place.x)||!Number.isInteger(item.place.y)))throw new Error(`${id}: place requires integer cells`);
    return {id,type,attrs:{...PART_DEFINITIONS[type].defaults,...(item.attrs??{})} as PartAttrs,
      ...(item.rotate!==undefined?{rotate:angle(item.rotate)}:{}),
      ...(item.near?{near:{anchorId:requireId(item.near.anchorId,`${id}.near.anchorId`),side:item.near.side}}:{}),
      ...(item.place?{place:{x:item.place.x,y:item.place.y,rotate:angle(item.place.rotate)}}:{}),
      ...(item.boardId?{boardId:requireId(item.boardId,`${id}.boardId`)}:{}),
      ...(item.seat?{seat:{boardId:requireId(item.seat.boardId,`${id}.seat.boardId`),pin:requireString(item.seat.pin,`${id}.seat.pin`),hole:requireString(item.seat.hole,`${id}.seat.hole`)}}:{})};
  });
  for(const p of parts)if(p.near&&!ids.has(p.near.anchorId))throw new Error(`${p.id}.near references unknown ${p.near.anchorId}`);
  const temp:CircuitPart[]=parts.map(p=>({id:p.id,type:p.type,left:0,top:0,rotate:p.rotate??p.place?.rotate??0,attrs:p.attrs}));
  const canonical=(rawEp:string)=>{const parsed=endpointParts(requireString(rawEp,'endpoint'));if(!parsed)throw new Error(`Invalid endpoint ${rawEp}`);const p=temp.find(x=>x.id===parsed.partId);if(!p)throw new Error(`Unknown part ${parsed.partId}`);const pin=resolvePinName(p,parsed.pinName);if(!pin)throw new Error(`Unknown pin ${parsed.pinName} on ${parsed.partId}`);return `${p.id}:${pin}`};
  const netIds=new Set<string>();
  const nets=raw.nets.map((n,index):SemanticNet=>{
    const id=requireId(n.id||`net${index+1}`,`nets[${index}].id`);if(netIds.has(id))throw new Error(`Duplicate net ${id}`);netIds.add(id);
    if(!Array.isArray(n.endpoints)||n.endpoints.length<2)throw new Error(`${id} needs 2+ endpoints`);if(n.role&&!['signal','power','ground'].includes(n.role))throw new Error(`${id}: bad role`);
    const endpoints=Array.from(new Set(n.endpoints.map(canonical)));
    let role=n.role;
    if(!role){
      const hasPositiveSource=endpoints.some(endpoint=>{
        const parsed=endpointParts(endpoint),part=temp.find(candidate=>candidate.id===parsed?.partId);
        if(!parsed||!part)return false;
        const classification=classifyPowerPin(part.type,parsed.pinName);
        return classification!==null&&classification!=='gnd';
      });
      if(hasPositiveSource)role='power';
    }
    return {id,...(role?{role}:{}),endpoints,...(n.source?{source:canonical(n.source)}:{})};
  });
  const stageIds=new Set<string>(),stageOwner=new Map<string,string>();
  const stages=(raw.stages??[]).map((rawStage,index):ScriptStage=>{
    const id=requireId(rawStage.id,`stages[${index}].id`);if(stageIds.has(id)||ids.has(id))throw new Error(`Stage id ${id} must be unique and cannot reuse a part id`);stageIds.add(id);
    const members=Array.from(new Set((rawStage.members??[]).map((member,memberIndex)=>requireId(member,`stages[${index}].members[${memberIndex}]`))));if(!members.length)throw new Error(`Stage ${id} needs at least one part`);
    for(const member of members){if(!ids.has(member))throw new Error(`Stage ${id} references unknown part ${member}`);const owner=stageOwner.get(member);if(owner)throw new Error(`${member} belongs to both ${owner} and ${id}. A physical part can belong to only one functional stage.`);stageOwner.set(member,id)}
    return {id,members};
  });
  const flows=(raw.flows??[]).map((rawFlow,index):ScriptFlow=>{
    const refs=Array.from(new Set((rawFlow.refs??[]).map((ref,refIndex)=>requireId(ref,`flows[${index}].refs[${refIndex}]`))));if(refs.length<2)throw new Error(`Flow ${index+1} needs at least two stages or parts`);
    for(const ref of refs)if(!ids.has(ref)&&!stageIds.has(ref))throw new Error(`Flow ${index+1} references unknown stage or part ${ref}`);
    return {refs};
  });
  return {parts,nets,stages,flows,code:raw.code.map((c,i)=>({boardId:requireId(c.boardId,`code[${i}].boardId`),text:String(c.text??'')}))};
}

function compositionOf(design:SemanticDesign):Composition {
  const stageOf=new Map<string,string>(),stages=new Map(design.stages.map(stage=>[stage.id,stage]));
  for(const stage of design.stages)for(const member of stage.members)stageOf.set(member,stage.id);
  const stageRank=new Map<string,number>(),partRank=new Map<string,number>();
  // flow() is deliberately ordinal, not geometric. The compiler can mirror the
  // physical direction around the substrate, while the semantic source still
  // says only "this stage comes before that stage".
  for(const flow of design.flows)for(const [rank,ref] of flow.refs.entries()){
    const stageId=stages.has(ref)?ref:stageOf.get(ref);
    if(stageId&&!stageRank.has(stageId))stageRank.set(stageId,rank);
    if(!stages.has(ref)&&!partRank.has(ref))partRank.set(ref,rank);
  }
  return {stageOf,stages,stageRank,partRank};
}

function compositionAdvice(design:SemanticDesign):CompositionAdvice[] {
  const advice:CompositionAdvice[]=[];
  const composition=compositionOf(design),partById=new Map(design.parts.map(part=>[part.id,part]));
  const membersForRef=(ref:string)=>composition.stages.get(ref)?.members??(partById.has(ref)?[ref]:[]);
  const sharedSignalNets=design.nets.filter(net=>{
    if((net.role??'signal')!=='signal')return false;
    const partIds=new Set(net.endpoints.map(endpoint=>endpointParts(endpoint)?.partId).filter((id):id is string=>Boolean(id)));
    return partIds.size>=3;
  });
  const sharedNetIdsForRef=(ref:string)=>{
    const ids=new Set(membersForRef(ref));
    return new Set(sharedSignalNets.filter(net=>net.endpoints.some(endpoint=>ids.has(endpointParts(endpoint)?.partId??''))).map(net=>net.id));
  };

  // flow() means visible/causal progression. Parallel devices that sit on the
  // same multi-drop bus do not progress through one another, even when they
  // perform different application functions. A cold agent sequencing I2C peers
  // caused the physicalizer to spread one bus across unrelated stage windows.
  for(const flow of design.flows){
    const candidates=flow.refs.filter(ref=>membersForRef(ref).some(id=>partById.get(id)?.type!=='wokwi-arduino-uno'));
    const groups:Array<{refs:string[];netIds:string[]}>=[];
    for(let i=0;i<candidates.length;i++)for(let j=i+1;j<candidates.length;j++){
      const a=sharedNetIdsForRef(candidates[i]),b=sharedNetIdsForRef(candidates[j]);
      const common=[...a].filter(id=>b.has(id));if(common.length<2)continue;
      let group=groups.find(item=>item.netIds.length===common.length&&item.netIds.every(id=>common.includes(id)));
      if(!group){group={refs:[],netIds:common};groups.push(group)}
      for(const ref of [candidates[i],candidates[j]])if(!group.refs.includes(ref))group.refs.push(ref);
    }
    for(const group of groups.filter(item=>item.refs.length>=2)){
      const peerParts=group.refs.flatMap(membersForRef);
      advice.push({kind:'parallel-bus-flow',itemIds:[...group.refs,...group.netIds],message:`${group.refs.join(', ')} are sequenced in flow(), but their parts (${peerParts.join(', ')}) are peers on the same shared signal bus (${group.netIds.join(', ')}). flow() is for real source -> stage -> load progression, not arbitrary order among parallel bus devices. Put these peers in one functional bus stage, for example stage("shared-bus", ${peerParts.join(', ')}), and give unrelated branches such as a status indicator their own flow.`});
    }
  }

  // Local companion passives should travel with the function they implement.
  // Otherwise stage windows can intentionally separate an LED from its series
  // resistor, or a transistor from its base resistor, while every wire remains
  // electrically valid.
  for(const stage of design.stages){
    const stageMembers=new Set(stage.members);
    const companions=new Set<string>();
    for(const net of design.nets){
      if((net.role??'signal')!=='signal'||net.endpoints.length!==2)continue;
      const ids=net.endpoints.map(endpoint=>endpointParts(endpoint)?.partId).filter((id):id is string=>Boolean(id));
      if(ids.length!==2)continue;
      const inside=ids.find(id=>stageMembers.has(id)),outside=ids.find(id=>!stageMembers.has(id));
      if(!inside||!outside||composition.stageOf.has(outside))continue;
      const part=partById.get(outside);if(!part||!PART_DEFINITIONS[part.type].breadboardMount||part.type==='wokwi-arduino-uno')continue;
      companions.add(outside);
    }
    if(companions.size)advice.push({kind:'incomplete-local-stage',itemIds:[stage.id,...stage.members,...companions],message:`Stage ${stage.id} contains ${stage.members.join(', ')}, but directly connected breadboard companion${companions.size>1?'s':''} ${[...companions].join(', ')} ${companions.size>1?'are':'is'} left outside every stage. If they implement the same local function, include them in stage(${JSON.stringify(stage.id)}, ...) so the physicalizer keeps the complete functional unit together.`});
  }

  // Explicit board size is a model-owned decision. Flag obviously sparse full
  // boards before routing expands their occupied span and hides the bad choice.
  const explicitBoards=design.parts.filter(part=>part.type==='breadboard');
  const mountable=design.parts.filter(part=>!isBreadboardType(part.type)&&PART_DEFINITIONS[part.type].breadboardMount);
  for(const board of explicitBoards){
    const local=mountable.filter(part=>{
      const requested=part.seat?.boardId??part.boardId;
      return requested?requested===board.id:explicitBoards.length===1;
    });
    const hasDensePart=local.some(part=>getPartPins(part.type).length>=12);
    if(local.length>0&&local.length<=4&&!hasDensePart)advice.push({kind:'oversized-explicit-board',itemIds:[board.id,...local.map(part=>part.id)],message:`${board.id} is an explicit 63-column full breadboard for only ${local.length} modest mounted part${local.length===1?'':'s'} (${local.map(part=>part.id).join(', ')}). Start with breadboard-half, or omit the breadboard and let the physicalizer choose the smallest substrate. Keep the full board only when the rendered functional zones actually need the extra space.`});
  }
  return advice;
}

class UF { parent=new Map<string,string>(); add(v:string){if(!this.parent.has(v))this.parent.set(v,v)} find(v:string):string{this.add(v);const p=this.parent.get(v)!;if(p===v)return v;const r=this.find(p);this.parent.set(v,r);return r} union(a:string,b:string){const x=this.find(a),y=this.find(b);if(x!==y)this.parent.set(y,x)} }
function modelOf(nets:SemanticNet[]):Model {
  const uf=new UF();let groundAnchor:string|undefined;
  for(const n of nets){
    for(const e of n.endpoints)uf.add(e);
    for(const e of n.endpoints.slice(1))uf.union(n.endpoints[0],e);
    // Every semantic ground() call describes the same electrical reference.
    // Merge those calls before physical rail compilation so several equivalent
    // controller GND pins do not become several separate ground backbones.
    if(n.role==='ground'){
      if(groundAnchor)uf.union(groundAnchor,n.endpoints[0]);
      else groundAnchor=n.endpoints[0];
    }
  }
  const rawMembers=new Map<string,string[]>(); for(const n of nets)for(const e of n.endpoints){const r=uf.find(e),list=rawMembers.get(r)??[];if(!list.includes(e))list.push(e);rawMembers.set(r,list)}
  const role=new Map<string,WireRole|undefined>(),source=new Map<string,string|undefined>(),name=new Map<string,string>();
  for(const n of nets){const r=uf.find(n.endpoints[0]),old=role.get(r);if(n.role&&old&&old!==n.role&&old!=='signal'&&n.role!=='signal')throw new Error(`Conflicting roles in ${n.id}`);if(n.role&&n.role!=='signal')role.set(r,n.role);else if(!role.has(r))role.set(r,n.role);if(!name.has(r))name.set(r,n.id);if(n.source&&!source.has(r))source.set(r,n.source)}
  const members=new Map<string,string[]>();
  for(const [r,endpoints] of rawMembers){
    const preferred=source.get(r),ordered=preferred?[preferred,...endpoints.filter(endpoint=>endpoint!==preferred)]:endpoints;
    const seenEquivalentGroundPins=new Set<string>(),collapsed:string[]=[];
    for(const endpoint of ordered){
      const parsed=endpointParts(endpoint);
      // GND, GND.1, GND.2, ... on one physical device are equivalent ground
      // terminals. Keep one visible lead while retaining every alias in groupOf.
      const equivalentKey=parsed&&/^GND(?:\.\d+)?$/i.test(parsed.pinName)?`${parsed.partId}:GND`:undefined;
      if(equivalentKey){if(seenEquivalentGroundPins.has(equivalentKey))continue;seenEquivalentGroundPins.add(equivalentKey)}
      collapsed.push(endpoint);
    }
    members.set(r,collapsed);
  }
  const groupOf=new Map<string,string>();for(const [r,es] of rawMembers)for(const e of es)groupOf.set(e,r);return {groupOf,members,role,source,name};
}
function group(ep:string,m:Model){return m.groupOf.get(ep)??`isolated:${ep}`}
function degree(p:SemanticPart,m:Model){return getPartPins(p.type).reduce((s,pin)=>{const g=m.groupOf.get(`${p.id}:${pin.name}`);return s+(g?Math.max(0,(m.members.get(g)?.length??1)-1):0)},0)}
function strip(part:CircuitPart,endpoint:string){const p=endpointParts(endpoint);if(!p||p.partId!==part.id||!part.seating)return undefined;const h=part.seating.pins[p.pinName];return h?`${part.seating.breadboardId}:${breadboardHoleNet(h)}`:undefined}
function overlap(a:CircuitPart,b:CircuitPart,margin=2){const x=partRect(a),y=partRect(b);return x.x<y.x+y.width+margin&&x.x+x.width+margin>y.x&&x.y<y.y+y.height+margin&&x.y+x.height+margin>y.y}
function badSeat(candidate:CircuitPart,placed:CircuitPart[],m:Model,allowRails=false){if(!candidate.seating)return true;const pins=Object.entries(candidate.seating.pins);if(!allowRails&&pins.some(([,hole])=>{const net=breadboardHoleNet(hole);return Boolean(net&&(net.startsWith('+')||net.startsWith('-')))}))return true;for(let a=0;a<pins.length;a++)for(let b=a+1;b<pins.length;b++){if(breadboardHoleNet(pins[a][1])===breadboardHoleNet(pins[b][1])&&group(`${candidate.id}:${pins[a][0]}`,m)!==group(`${candidate.id}:${pins[b][0]}`,m))return true}for(const other of placed.filter(p=>p.seating?.breadboardId===candidate.seating?.breadboardId)){if(overlap(candidate,other,8))return true;for(const [cp,ch] of pins)for(const [op,oh] of Object.entries(other.seating!.pins)){if(breadboardHoleNet(ch)===breadboardHoleNet(oh)&&group(`${candidate.id}:${cp}`,m)!==group(`${other.id}:${op}`,m))return true}}return false}
function rows(bias:'upper'|'lower'){return bias==='upper'?['C','B','D','A','E','H','G','I','F','J']:['H','G','I','F','J','C','B','D','A','E']}
function seatCost(candidate:CircuitPart,board:CircuitPart,placed:CircuitPart[],m:Model,bias:'upper'|'lower'){
  let score=0;const first=candidate.seating?Object.values(candidate.seating.pins)[0]:undefined;const upper=Boolean(first&&'ABCDE'.includes(first[0].toUpperCase()));if(upper!==(bias==='upper'))score+=1400;
  if(candidate.seating){const halves=new Set(Object.values(candidate.seating.pins).map(hole=>'ABCDE'.includes(hole[0].toUpperCase())?'upper':'lower'));if(halves.size>1)score+=1800;}
  const parts=[board,...placed,candidate];
  for(const pin of getPartPins(candidate)){
    const ep=`${candidate.id}:${pin.name}`,g=m.groupOf.get(ep);if(!g)continue;
    const point=endpointPoint(ep,parts);if(!point)continue;
    const role=m.role.get(g);
    if(role==='power'||role==='ground'){
      const sign=role==='ground'?'-':'+';
      const top=endpointPoint(`${board.id}:${sign}top1`,parts),bottom=endpointPoint(`${board.id}:${sign}bottom1`,parts);
      if(top&&bottom)score+=Math.min(Math.abs(point.y-top.y),Math.abs(point.y-bottom.y))*.5;
    }
    for(const n of m.members.get(g)??[]){
      if(n===ep)continue;
      const parsed=endpointParts(n),other=placed.find(p=>p.id===parsed?.partId);if(!other)continue;
      const target=endpointPoint(n,parts);if(!target)continue;
      if(strip(candidate,ep)&&strip(candidate,ep)===strip(other,n)){score-=2200;continue}
      const distance=Math.abs(point.x-target.x)+Math.abs(point.y-target.y);
      // A direct signal/current path to a flexible external load is also a
      // physical cable-entry constraint. Give it more weight than an ordinary
      // board-local signal so motor/actuator stages face their load instead of
      // drifting to the rail-facing edge just because that edge is electrically
      // convenient. Power and ground still use their distribution rails.
      const externalFlexibleSignal=(role??'signal')==='signal'&&!other.seating&&!isBreadboardType(other.type)&&Boolean(PART_DEFINITIONS[other.type].flexibleLeadPins?.length);
      score+=1600+distance*(externalFlexibleSignal?3:1);
      if((role??'signal')==='signal'){
        const dir=pinExitDirection(ep,parts);
        if(dir==='left'&&target.x>point.x)score+=1800;
        if(dir==='right'&&target.x<point.x)score+=1800;
        if(dir==='up'&&target.y>point.y)score+=1800;
        if(dir==='down'&&target.y<point.y)score+=1800;
      }
    }
  }
  return score;
}
type ColumnWindow={min:number;max:number;target?:number;flowOrder?:number};
function seatMounts(specs:SemanticPart[],board:CircuitPart,anchors:CircuitPart[],m:Model,bias:'upper'|'lower',columnWindows?:Map<string,ColumnWindow>,halfPreferences?:Map<string,'upper'|'lower'>){
  const geom=getBreadboardGeometry(board.type)!;
  const placed:CircuitPart[]=[];
  const chosen=new Map<string,{pin:string;hole:string;part:CircuitPart}>();
  const specById=new Map(specs.map(spec=>[spec.id,spec]));
  const relationPenalty=(candidate:CircuitPart)=>{
    let penalty=0;
    const known=[board,...placed,candidate];
    const byId=(id:string)=>known.find(part=>part.id===id);
    const center=(part:CircuitPart)=>{const r=partRect(part);return {x:r.x+r.width/2,y:r.y+r.height/2,r}};
    for(const moverSpec of specs){
      const relation=moverSpec.near;if(!relation)continue;
      // near() on a mounted part is semantic composition intent too. Previously
      // these hints were silently ignored once the part was seated, which made
      // the model's stage-level planning ineffective.
      if(moverSpec.id!==candidate.id&&relation.anchorId!==candidate.id)continue;
      const mover=byId(moverSpec.id),anchor=byId(relation.anchorId);if(!mover||!anchor)continue;
      const mc=center(mover),ac=center(anchor);
      if(anchor.id===board.id){
        const br=ac.r;
        const target=relation.side==='left'?{x:br.x+br.width*.16,y:mc.y}
          :relation.side==='right'?{x:br.x+br.width*.84,y:mc.y}
            :relation.side==='above'?{x:mc.x,y:br.y+br.height*.27}
              :{x:mc.x,y:br.y+br.height*.73};
        const delta=relation.side==='left'||relation.side==='right'?Math.abs(mc.x-target.x):Math.abs(mc.y-target.y);
        penalty+=delta*2.2;
        continue;
      }
      const horizontal=relation.side==='left'||relation.side==='right';
      const signed=relation.side==='left'?ac.x-mc.x
        :relation.side==='right'?mc.x-ac.x
          :relation.side==='above'?ac.y-mc.y
            :mc.y-ac.y;
      if(signed<0)penalty+=2600+Math.abs(signed)*8;
      const cross=horizontal?Math.abs(mc.y-ac.y):Math.abs(mc.x-ac.x);
      penalty+=cross*.28;
    }
    return penalty;
  };
  const edgeReserve=geom.columns>40?7:2;const allColumns=Array.from({length:Math.max(1,geom.columns-edgeReserve*2)},(_,i)=>i+1+edgeReserve);
  const hasRailConstraint=(part:SemanticPart)=>getPartPins(part.type).some(pin=>{
    const g=m.groupOf.get(`${part.id}:${pin.name}`),role=g?m.role.get(g):undefined;
    return role==='power'||role==='ground';
  });
  const seatSpecs=[...specs].sort((a,b)=>{
    // Establish the supply/return skeleton before pure signal-chain parts. A
    // ground-referenced switch is just as geometrically constrained as a powered
    // sensor: seating it first lets an adjacent resistor land directly on the
    // eventual control strip instead of routing back across rail drops later.
    const ap=hasRailConstraint(a),bp=hasRailConstraint(b);if(ap!==bp)return ap?-1:1;
    const aw=columnWindows?.get(a.id),bw=columnWindows?.get(b.id);
    if(aw?.flowOrder!==undefined&&bw?.flowOrder!==undefined&&aw.flowOrder!==bw.flowOrder)return aw.flowOrder-bw.flowOrder;
    if(aw?.flowOrder!==undefined&&bw?.flowOrder===undefined)return -1;
    if(bw?.flowOrder!==undefined&&aw?.flowOrder===undefined)return 1;
    return degree(b,m)-degree(a,m);
  });
  for(const spec of seatSpecs){
    const window=columnWindows?.get(spec.id);
    const specBias=halfPreferences?.get(spec.id)??bias;
    const powerHalfLocked=Boolean(halfPreferences?.has(spec.id)&&getPartPins(spec.type).some(pin=>{
      const g=m.groupOf.get(`${spec.id}:${pin.name}`);return g&&m.role.get(g)==='power';
    }));
    const allowedColumns=window?allColumns.filter(column=>column>=window.min&&column<=window.max):allColumns;
    const known=[...anchors,...placed,board];
    const targetXs:number[]=[];
    const priority:Array<{pin:string;hole:string}>=[];
    for(const pin of getPartPins(spec.type)){
      const endpoint=`${spec.id}:${pin.name}`,g=m.groupOf.get(endpoint);
      if(!g)continue;
      const localStripNet=(m.role.get(g)??'signal')==='signal';
      for(const n of m.members.get(g)??[]){
        const parsed=endpointParts(n);if(parsed?.partId===spec.id)continue;
        const other=placed.find(p=>p.id===parsed?.partId);
        const point=endpointPoint(n,known);if(point)targetXs.push(point.x);
        if(localStripNet&&other?.seating?.breadboardId===board.id&&parsed){
          const hole=other.seating.pins[parsed.pinName],net=hole?breadboardHoleNet(hole):undefined;
          const match=/terminal-(upper|lower):(\d+)/.exec(net??'');
          if(match){const rowSet=match[1]==='upper'?['A','B','C','D','E']:['F','G','H','I','J'];for(const row of rowSet)priority.push({pin:pin.name,hole:`${row}${match[2]}`})}
        }
      }
    }
    const boardRect=partRect(board),targetX=targetXs.length?targetXs.reduce((sum,x)=>sum+x,0)/targetXs.length:boardRect.x+boardRect.width/2;
    const candidateLimit=geom.columns>40?24:12;
    const columns=allowedColumns.map(column=>({column,point:endpointPoint(`${board.id}:A${column}`,known)})).sort((a,b)=>Math.abs((a.point?.x??targetX)-targetX)-Math.abs((b.point?.x??targetX)-targetX)).slice(0,Math.min(candidateLimit,allowedColumns.length)).map(item=>item.column);
    const hasVerticalMountedPeer=specs.some(peer=>{
      const relation=peer.near;if(!relation||(relation.side!=='above'&&relation.side!=='below'))return false;
      return (peer.id===spec.id&&specById.has(relation.anchorId))||relation.anchorId===spec.id;
    });
    const orderedRows=hasVerticalMountedPeer
      ? specBias==='upper'
        ? ['E','D','C','B','A','F','G','H','I','J']
        : ['F','G','H','I','J','E','D','C','B','A']
      : rows(specBias);
    const primaryRowCount=hasVerticalMountedPeer?2:5;
    const generalPrimary=columns.flatMap(c=>orderedRows.slice(0,primaryRowCount).map(row=>({pin:'',hole:`${row}${c}`})));
    const generalFallback=columns.flatMap(c=>orderedRows.slice(5).map(row=>({pin:'',hole:`${row}${c}`})));
    let best:{score:number;pin:string;hole:string;part:CircuitPart}|undefined;
    const tryGeneral=(general:Array<{pin:string;hole:string}>)=>{
      for(const rotate of spec.rotate!==undefined?[spec.rotate]:[0,90,180,270]){
        const draft:CircuitPart={id:spec.id,type:spec.type,left:0,top:0,rotate,attrs:spec.attrs};
        const defaultPin=spec.seat?.pin??getPartPins(draft)[0]?.name;if(!defaultPin)continue;
        const candidates=spec.seat?[{pin:spec.seat.pin,hole:spec.seat.hole,priority:true}]:[
          ...priority.map(item=>({...item,priority:true})),
          ...general.map(item=>({pin:defaultPin,hole:item.hole,priority:false})),
        ];
        const seen=new Set<string>();
        for(const item of candidates){
          const key=`${item.pin}|${item.hole}`;if(seen.has(key))continue;seen.add(key);
          if(spec.seat&&spec.seat.boardId!==board.id)throw new Error(`${spec.id} asks for another breadboard`);
          let candidate:CircuitPart;try{candidate=seatPartAtHole(draft,[board,...anchors,...placed],{breadboardId:board.id,pin:item.pin,hole:item.hole})}catch{continue}
          if(badSeat(candidate,placed,m,Boolean(spec.seat)))continue;
          if(powerHalfLocked&&candidate.seating){
            const halves=new Set(Object.values(candidate.seating.pins).map(hole=>'ABCDE'.includes(hole[0].toUpperCase())?'upper':'lower'));
            if(halves.size!==1||![...halves].includes(specBias))continue;
          }
          if(window&&!spec.seat&&candidate.seating){
            const seatedColumns=Object.values(candidate.seating.pins).map(hole=>Number(/(\d+)$/.exec(hole)?.[1])).filter(Number.isFinite);
            // A local-strip priority fixes one electrical endpoint to an already
            // seated peer. Let the rest of the component extend by its real
            // seated span instead of forcing a long part to rotate across the
            // breadboard trench merely to stay inside an abstract stage window.
            // The anchored pin still stays in the stage and normal candidates
            // remain strict, so this does not turn windows into loose placement.
            const seatedSpan=seatedColumns.length?Math.max(...seatedColumns)-Math.min(...seatedColumns):0;
            const spill=item.priority?Math.max(1,seatedSpan):0;
            if(seatedColumns.some(column=>column<window.min-spill||column>window.max+spill))continue;
          }
          const holeColumn=Number(/([0-9]+)$/.exec(item.hole)?.[1]);
          const zoneCenter=window?(window.target??(window.min+window.max)/2):undefined;
          const zonePenalty=zoneCenter&&Number.isFinite(holeColumn)?Math.abs(holeColumn-zoneCenter)*22:0;
          const seatedColumns=candidate.seating?Object.values(candidate.seating.pins).map(hole=>Number(/(\d+)$/.exec(hole)?.[1])).filter(Number.isFinite):[];
          const horizontalSpan=seatedColumns.length?Math.max(...seatedColumns)-Math.min(...seatedColumns):0;
          const compactPenalty=window&&!spec.seat?horizontalSpan*120:0;
          const trenchPenalty=hasVerticalMountedPeer?Math.abs((partRect(candidate).y+partRect(candidate).height/2)-(partRect(board).y+partRect(board).height/2))*3.2:0;
          const score=seatCost(candidate,board,[...anchors,...placed],m,specBias)+relationPenalty(candidate)+zonePenalty+compactPenalty+trenchPenalty-(item.priority?2600:0);
          if(!best||score<best.score)best={score,pin:item.pin,hole:item.hole,part:candidate};
        }
      }
    };
    tryGeneral(generalPrimary);
    if(!best&&!spec.seat)tryGeneral(generalFallback);
    if(!best)throw new Error(`No legal breadboard seat for ${spec.id}`);
    placed.push(best.part);chosen.set(spec.id,best);
  }
  return {placed,chosen};
}
function relCells(anchor:CircuitPart,type:PartType,rotate:number,side:Side,gap=GAP){
  const a=partBlockAt(anchor),ad=blockDefinition(anchor.type,anchor.rotate??0),d=blockDefinition(type,rotate),out:BlockCell[]=[];
  if(side==='left'||side==='right'){
    const start=a.y-Math.max(0,d.h-ad.h),end=a.y+Math.max(0,ad.h-d.h),step=Math.max(1,Math.floor(Math.max(ad.h,d.h)/4));
    for(let y=start;y<=end;y+=step)out.push({x:side==='left'?a.x-d.w-gap:a.x+ad.w+gap,y});
  }else{
    const start=a.x-Math.max(0,d.w-ad.w),end=a.x+Math.max(0,ad.w-d.w),step=Math.max(1,Math.floor(Math.max(ad.w,d.w)/4));
    for(let x=start;x<=end;x+=step)out.push({x,y:side==='above'?a.y-d.h-gap:a.y+ad.h+gap});
  }
  return out.length?out:[{x:a.x,y:a.y}];
}
function targets(spec:SemanticPart,placed:CircuitPart[],m:Model){const out:Array<{endpoint:string;target:string}>=[];for(const pin of getPartPins(spec.type)){const ep=`${spec.id}:${pin.name}`,g=m.groupOf.get(ep);if(!g)continue;for(const n of m.members.get(g)??[]){const p=endpointParts(n);if(p?.partId!==spec.id&&placed.some(x=>x.id===p?.partId))out.push({endpoint:ep,target:n})}}return out}
function placeCost(candidate:CircuitPart,placed:CircuitPart[],pairs:Array<{endpoint:string;target:string}>){const parts=[...placed,candidate];let score=0;for(const pair of pairs){const a=endpointPoint(pair.endpoint,parts),b=endpointPoint(pair.target,parts);if(!a||!b)continue;score+=Math.abs(a.x-b.x)+Math.abs(a.y-b.y);const dir=pinExitDirection(pair.endpoint,parts);if(dir==='left'&&b.x>a.x)score+=450;if(dir==='right'&&b.x<a.x)score+=450;if(dir==='up'&&b.y>a.y)score+=450;if(dir==='down'&&b.y<a.y)score+=450}return score}
function connectorFace(part:CircuitPart){
  const pins=PART_DEFINITIONS[part.type].flexibleLeadPins??[];if(!pins.length)return undefined;
  const points=pins.map(pin=>endpointPoint(`${part.id}:${pin}`,[part])).filter((point):point is {x:number;y:number}=>Boolean(point));if(!points.length)return undefined;
  const rect=partRect(part),cx=points.reduce((sum,p)=>sum+p.x,0)/points.length,cy=points.reduce((sum,p)=>sum+p.y,0)/points.length;
  const choices=[
    {side:'left' as const,distance:Math.abs(cx-rect.x)},
    {side:'right' as const,distance:Math.abs(cx-(rect.x+rect.width))},
    {side:'up' as const,distance:Math.abs(cy-rect.y)},
    {side:'down' as const,distance:Math.abs(cy-(rect.y+rect.height))},
  ].sort((a,b)=>a.distance-b.distance);
  return {side:choices[0].side,point:{x:cx,y:cy}};
}
function externalAffordanceCost(candidate:CircuitPart,placed:CircuitPart[],pairs:Array<{endpoint:string;target:string}>){
  const parts=[...placed,candidate];let score=0;
  const face=connectorFace(candidate);
  if(face&&pairs.length){
    const targets=pairs.map(pair=>endpointPoint(pair.target,parts)).filter((point):point is {x:number;y:number}=>Boolean(point));
    if(targets.length){
      const target={x:targets.reduce((sum,p)=>sum+p.x,0)/targets.length,y:targets.reduce((sum,p)=>sum+p.y,0)/targets.length};
      const dx=target.x-face.point.x,dy=target.y-face.point.y;
      const forward=face.side==='left'?-dx:face.side==='right'?dx:face.side==='up'?-dy:dy;
      const lateral=face.side==='left'||face.side==='right'?Math.abs(dy):Math.abs(dx);
      // The cable bundle should leave the side that faces its stage. This is much
      // stronger than raw endpoint distance because the opposite orientation
      // creates a hairpin across the component body before routing even begins.
      if(forward<0)score+=5200+Math.abs(forward)*3;
      score+=lateral*.35;
    }
  }
  return score;
}
function collides(at:BlockCell,type:PartType,rotate:number,placed:CircuitPart[]){const d=blockDefinition(type,rotate);return placed.filter(p=>!p.seating).some(p=>{const a=partBlockAt(p),b=blockDefinition(p.type,p.rotate??0);return at.x<a.x+b.w+1&&at.x+d.w+1>a.x&&at.y<a.y+b.h+1&&at.y+d.h+1>a.y})}
function placeExternal(specs:SemanticPart[],board:CircuitPart|undefined,anchors:CircuitPart[],m:Model,variant=0){
  const placed=[...anchors],chosen=new Map<string,{at:BlockCell;rotate:number}>(),remaining=[...specs];
  while(remaining.length){
remaining.sort((a,b)=>{
      const aBlocked=Boolean(a.near&&!placed.some(p=>p.id===a.near!.anchorId));
      const bBlocked=Boolean(b.near&&!placed.some(p=>p.id===b.near!.anchorId));
      if(aBlocked!==bBlocked)return aBlocked?1:-1;
      return targets(b,placed,m).length-targets(a,placed,m).length||degree(b,m)-degree(a,m);
    });
    const spec=remaining.shift()!,pairs=targets(spec,placed,m);
    const valid:Array<{score:number;at:BlockCell;rotate:number;part:CircuitPart;nearPenalty:number}>=[];let attempted=0,collisionRejects=0,spacingRejects=0;let bounds={minX:Number.POSITIVE_INFINITY,maxX:Number.NEGATIVE_INFINITY,minY:Number.POSITIVE_INFINITY,maxY:Number.NEGATIVE_INFINITY};
    const rotations = spec.place
      ? [spec.place.rotate ?? spec.rotate ?? 0]
      : spec.rotate !== undefined
        ? [spec.rotate]
        : PART_DEFINITIONS[spec.type].userFacing
          ? [0]
          : [0,90,180,270];
    // User-facing artwork has a real physical "upright" state. Do not make the
    // model fight a soft geometry score to keep a display, keypad, or handheld
    // control readable. The natural rotation is the deterministic default; an
    // intentional rotate(...) remains available when the requested interaction
    // genuinely needs another orientation.
    for(const rotate of rotations){
      const candidates:Array<{at:BlockCell;nearPenalty:number}>=[];
      if(spec.place)candidates.push({at:{x:spec.place.x,y:spec.place.y},nearPenalty:0});
      else if(spec.near){
        const anchor=placed.find(p=>p.id===spec.near!.anchorId);
        if(anchor){
          // Unwired accessories such as a handheld IR remote should not consume
          // the first routing lane beside a breadboard. Give above/below decor
          // one extra cell of breathing room while electrically connected loads
          // remain as close as their leads permit.
          const baseGap = pairs.length===0 && (spec.near.side==='above'||spec.near.side==='below') ? GAP+1 : GAP;
          for(const gap of [baseGap,baseGap+4,baseGap+8,baseGap+12,baseGap+18])for(const at of relCells(anchor,spec.type,rotate,spec.near.side,gap))candidates.push({at,nearPenalty:gap-baseGap});
          for(const side of ['left','right','above','below'] as const)if(side!==spec.near.side)for(const at of relCells(anchor,spec.type,rotate,side,baseGap+8))candidates.push({at,nearPenalty:240});
        }
      }else{
        const targetParts=pairs.flatMap(pair=>{const p=endpointParts(pair.target),x=placed.find(v=>v.id===p?.partId);return x?[x]:[]});
        const bases=targetParts.length?targetParts:board?[board]:placed;
        for(const anchor of bases)for(const side of ['left','right','above','below'] as const)for(const gap of [GAP,GAP+5,GAP+10])for(const at of relCells(anchor,spec.type,rotate,side,gap))candidates.push({at,nearPenalty:gap-GAP});
      }
      if(!candidates.length)candidates.push({at:{x:0,y:0},nearPenalty:0});
      const seen=new Set<string>();
      for(const {at,nearPenalty} of candidates){
        const key=`${at.x},${at.y}`;if(seen.has(key))continue;seen.add(key);attempted++;bounds.minX=Math.min(bounds.minX,at.x);bounds.maxX=Math.max(bounds.maxX,at.x);bounds.minY=Math.min(bounds.minY,at.y);bounds.maxY=Math.max(bounds.maxY,at.y);
        if(collides(at,spec.type,rotate,placed)){collisionRejects++;continue;}
        const part:CircuitPart={id:spec.id,type:spec.type,...blockPlacement(spec.type,at,rotate),rotate,attrs:spec.attrs};
        if(placed.some(o=>!o.seating&&overlap(part,o,4))){spacingRejects++;continue;}
        let score=placeCost(part,placed,pairs)+externalAffordanceCost(part,placed,pairs)+nearPenalty*4;
        if(spec.near){
          const anchor=placed.find(p=>p.id===spec.near!.anchorId);
          if(anchor){const ar=partRect(anchor),r=partRect(part);const acx=ar.x+ar.width/2,acy=ar.y+ar.height/2,rcx=r.x+r.width/2,rcy=r.y+r.height/2;score+=(spec.near.side==='above'||spec.near.side==='below'?Math.abs(rcx-acx):Math.abs(rcy-acy))*2.2;}
        } else if(!pairs.length&&board){const br=partRect(board),r=partRect(part);score+=Math.abs((r.x+r.width/2)-(br.x+br.width/2))+Math.abs((r.y+r.height/2)-(br.y+br.height/2))}
        if(spec.type==='wokwi-arduino-uno'&&rotate!==0)score+=500;
        if(spec.near&&nearPenalty===0)score-=200;
        valid.push({score,at,rotate,part,nearPenalty});
      }
    }
    if(!valid.length)throw new Error(`No collision-free placement for ${spec.id}. Tried ${attempted} candidates in x=${bounds.minX}..${bounds.maxX}, y=${bounds.minY}..${bounds.maxY}; block collisions=${collisionRejects}, spacing conflicts=${spacingRejects}. Move its semantic anchor or give the group more room.`);
    const preferred=spec.near&&valid.some(item=>item.nearPenalty<240)?valid.filter(item=>item.nearPenalty<240):valid;
    preferred.sort((a,b)=>a.score-b.score);const rank=pairs.length>=2?Math.min(variant,Math.min(3,preferred.length-1)):0;const best=preferred[rank];
    chosen.set(spec.id,best);placed.push(best.part);
  }
  return {placed:placed.slice(anchors.length),chosen};
}function signalMountClusters(mounts:SemanticPart[],m:Model){
  const ids=new Set(mounts.map(p=>p.id)),uf=new UF();for(const id of ids)uf.add(id);
  for(const [g,endpoints] of m.members){if((m.role.get(g)??'signal')!=='signal')continue;const parts=Array.from(new Set(endpoints.map(e=>endpointParts(e)?.partId).filter((id):id is string=>Boolean(id&&ids.has(id)))));for(const id of parts.slice(1))uf.union(parts[0],id)}
  const groups=new Map<string,SemanticPart[]>();for(const part of mounts){const root=uf.find(part.id),list=groups.get(root)??[];list.push(part);groups.set(root,list)}return [...groups.values()].sort((a,b)=>b.length-a.length);
}
function clusterSignalFlow(cluster:SemanticPart[],board:CircuitPart,anchors:CircuitPart[],m:Model,originalOrder:Map<string,number>,composition?:Composition){
  const ids=new Set(cluster.map(part=>part.id));
  const anchorById=new Map(anchors.map(part=>[part.id,part]));
  const geometry=[board,...anchors];
  const adjacency=new Map(cluster.map(part=>[part.id,new Set<string>()]));
  const leftAffinity=new Map(cluster.map(part=>[part.id,0]));
  const rightAffinity=new Map(cluster.map(part=>[part.id,0]));
  const br=partRect(board),leftEdge=br.x,rightEdge=br.x+br.width;
  for(const part of cluster)for(const pin of getPartPins(part.type)){
    const g=m.groupOf.get(`${part.id}:${pin.name}`);if(!g||(m.role.get(g)??'signal')!=='signal')continue;
    for(const endpoint of m.members.get(g)??[]){
      const parsed=endpointParts(endpoint);if(!parsed||parsed.partId===part.id)continue;
      if(ids.has(parsed.partId)){adjacency.get(part.id)!.add(parsed.partId);adjacency.get(parsed.partId)!.add(part.id);continue}
      const anchor=anchorById.get(parsed.partId);if(!anchor)continue;
      const point=endpointPoint(endpoint,geometry);if(!point)continue;
      if(point.x<leftEdge-BREADBOARD_HOLE_PITCH*.5)leftAffinity.set(part.id,(leftAffinity.get(part.id)??0)+1);
      else if(point.x>rightEdge+BREADBOARD_HOLE_PITCH*.5)rightAffinity.set(part.id,(rightAffinity.get(part.id)??0)+1);
    }
  }
  const leftTotal=[...leftAffinity.values()].reduce((a,b)=>a+b,0),rightTotal=[...rightAffinity.values()].reduce((a,b)=>a+b,0);
  const direction:'ltr'|'rtl' = rightTotal>leftTotal?'rtl':'ltr';
  const affinity=direction==='ltr'?leftAffinity:rightAffinity;
  const seeds=cluster.filter(part=>(affinity.get(part.id)??0)>0);
  const distance=new Map<string,number>();const queue:string[]=[];
  for(const seed of seeds){distance.set(seed.id,0);queue.push(seed.id)}
  while(queue.length){const id=queue.shift()!,next=(distance.get(id)??0)+1;for(const neighbor of adjacency.get(id)??[]){if(distance.has(neighbor))continue;distance.set(neighbor,next);queue.push(neighbor)}}
  const effectiveDirection=seeds.length?direction:'ltr' as const;
  const base=[...cluster].sort((a,b)=>{
    const ar=composition?.partRank.get(a.id),brank=composition?.partRank.get(b.id);
    if(ar!==undefined||brank!==undefined){const rankDelta=(ar??999)-(brank??999);if(rankDelta)return rankDelta}
    return seeds.length
      ?(distance.get(a.id)??999)-(distance.get(b.id)??999)||(originalOrder.get(a.id)??999)-(originalOrder.get(b.id)??999)
      :(originalOrder.get(a.id)??999)-(originalOrder.get(b.id)??999);
  });
  // Preserve electrical-flow ordering, but honor explicit mounted left/right
  // composition constraints when the model supplies them. Kahn ordering keeps
  // unrelated nodes in their original flow order and gracefully ignores cycles.
  const rank=new Map(base.map((part,index)=>[part.id,index]));
  const edges=new Map(base.map(part=>[part.id,new Set<string>()]));
  const indegree=new Map(base.map(part=>[part.id,0]));
  for(const part of cluster){
    const relation=part.near;if(!relation||!ids.has(relation.anchorId)||(relation.side!=='left'&&relation.side!=='right'))continue;
    const physicalBefore=relation.side==='left'?[part.id,relation.anchorId]:[relation.anchorId,part.id];
    const [before,after]=effectiveDirection==='ltr'?physicalBefore:[physicalBefore[1],physicalBefore[0]];
    if(edges.get(before)?.has(after))continue;
    edges.get(before)?.add(after);indegree.set(after,(indegree.get(after)??0)+1);
  }
  const ready=base.filter(part=>(indegree.get(part.id)??0)===0).sort((a,b)=>(rank.get(a.id)??999)-(rank.get(b.id)??999));
  const logical:SemanticPart[]=[];
  while(ready.length){
    const part=ready.shift()!;logical.push(part);
    for(const next of edges.get(part.id)??[]){indegree.set(next,(indegree.get(next)??1)-1);if(indegree.get(next)===0){const candidate=cluster.find(item=>item.id===next);if(candidate){ready.push(candidate);ready.sort((a,b)=>(rank.get(a.id)??999)-(rank.get(b.id)??999))}}}
  }
  if(logical.length<base.length)for(const part of base)if(!logical.some(item=>item.id===part.id))logical.push(part);
  return {logical,direction:effectiveDirection};
}
function compositionMountGroups(mounts:SemanticPart[],m:Model,composition:Composition){
  const byStage=new Map<string,SemanticPart[]>(),assigned=new Set<string>();
  for(const part of mounts){const stageId=composition.stageOf.get(part.id);if(!stageId)continue;const list=byStage.get(stageId)??[];list.push(part);byStage.set(stageId,list);assigned.add(part.id)}
  const groups:Array<{stageId?:string;cluster:SemanticPart[]}>=Array.from(byStage,([stageId,cluster])=>({stageId,cluster}));
  const remaining=mounts.filter(part=>!assigned.has(part.id));
  for(const cluster of signalMountClusters(remaining,m))groups.push({stageId:undefined,cluster});
  return groups;
}
function compositionFlowDirection(board:CircuitPart,anchors:CircuitPart[],composition:Composition):'ltr'|'rtl'{
  const br=partRect(board),left=br.x,right=br.x+br.width;
  const ranked=anchors.flatMap(part=>{const stageId=composition.stageOf.get(part.id),rank=composition.partRank.get(part.id)??(stageId?composition.stageRank.get(stageId):undefined);return rank===undefined?[]:[{part,rank}] as Array<{part:CircuitPart;rank:number}>}).sort((a,b)=>a.rank-b.rank);
  for(const entry of ranked){const r=partRect(entry.part),center=r.x+r.width/2;if(center<left-BREADBOARD_HOLE_PITCH*.5)return 'ltr';if(center>right+BREADBOARD_HOLE_PITCH*.5)return 'rtl'}
  return 'ltr';
}
function functionalColumnWindows(mounts:SemanticPart[],board:CircuitPart,anchors:CircuitPart[],m:Model,composition:Composition){
  const geom=getBreadboardGeometry(board.type);if(!geom||geom.columns<20)return undefined;
  const groups=compositionMountGroups(mounts,m,composition);if(groups.length<2)return undefined;
  const order=new Map(mounts.map((part,index)=>[part.id,index]));
  const anchorById=new Map(anchors.map(part=>[part.id,part]));
  const geometry=[board,...anchors];
  const infos=groups.map(({stageId,cluster})=>{
    const ids=new Set(cluster.map(part=>part.id));
    const externalXs:number[]=[];
    const boardRect=partRect(board);
    for(const part of cluster){
      if(part.near?.anchorId!==board.id)continue;
      if(part.near.side==='left')externalXs.push(boardRect.x-BREADBOARD_HOLE_PITCH*8);
      else if(part.near.side==='right')externalXs.push(boardRect.x+boardRect.width+BREADBOARD_HOLE_PITCH*8);
    }
    for(const part of cluster)for(const pin of getPartPins(part.type)){
      const g=m.groupOf.get(`${part.id}:${pin.name}`);if(!g)continue;
      for(const endpoint of m.members.get(g)??[]){
        const parsed=endpointParts(endpoint);if(!parsed||ids.has(parsed.partId))continue;
        const anchor=anchorById.get(parsed.partId);if(!anchor)continue;
        const point=endpointPoint(endpoint,geometry);if(point)externalXs.push(point.x);
      }
    }
    const compactColumns=cluster.reduce((sum,part)=>{
      const bounds=getPartBounds(part.type);
      return sum+Math.max(2,Math.ceil(Math.min(bounds.width,bounds.height)/BREADBOARD_HOLE_PITCH));
    },0);
    const desired=Math.max(5,Math.min(12,compactColumns+(cluster.length>1?1:0)));
    return {stageId,cluster,stageRank:stageId?composition.stageRank.get(stageId):undefined,desired,targetX:externalXs.length?externalXs.reduce((sum,x)=>sum+x,0)/externalXs.length:partRect(board).x+partRect(board).width/2,first:Math.min(...cluster.map(part=>order.get(part.id)??999))};
  });
  const tiePx=BREADBOARD_HOLE_PITCH*6;
  const flowDirection=compositionFlowDirection(board,anchors,composition);
  infos.sort((a,b)=>{
    if(a.stageRank!==undefined||b.stageRank!==undefined){const rankDelta=(a.stageRank??999)-(b.stageRank??999);if(rankDelta)return flowDirection==='ltr'?rankDelta:-rankDelta}
    return Math.abs(a.targetX-b.targetX)<=tiePx?a.first-b.first:a.targetX-b.targetX;
  });
  // near() may relate two separate functional clusters. Preserve the normal
  // connectivity-derived ordering, then apply only the explicit left/right
  // constraints between clusters.
  const infoOfPart=new Map<string,number>();infos.forEach((info,index)=>info.cluster.forEach(part=>infoOfPart.set(part.id,index)));
  const baseRank=new Map(infos.map((info,index)=>[info,index]));
  const infoEdges=new Map(infos.map(info=>[info,new Set<(typeof infos)[number]>()]));
  const infoIndegree=new Map(infos.map(info=>[info,0]));
  for(const part of mounts){
    const relation=part.near;if(!relation||(relation.side!=='left'&&relation.side!=='right'))continue;
    const moverIndex=infoOfPart.get(part.id),anchorIndex=infoOfPart.get(relation.anchorId);if(moverIndex===undefined||anchorIndex===undefined||moverIndex===anchorIndex)continue;
    const before=relation.side==='left'?infos[moverIndex]:infos[anchorIndex],after=relation.side==='left'?infos[anchorIndex]:infos[moverIndex];
    if(infoEdges.get(before)?.has(after))continue;infoEdges.get(before)?.add(after);infoIndegree.set(after,(infoIndegree.get(after)??0)+1);
  }
  const readyInfos=infos.filter(info=>(infoIndegree.get(info)??0)===0).sort((a,b)=>(baseRank.get(a)??999)-(baseRank.get(b)??999));
  const orderedInfos:typeof infos=[];
  while(readyInfos.length){const info=readyInfos.shift()!;orderedInfos.push(info);for(const next of infoEdges.get(info)??[]){infoIndegree.set(next,(infoIndegree.get(next)??1)-1);if(infoIndegree.get(next)===0){readyInfos.push(next);readyInfos.sort((a,b)=>(baseRank.get(a)??999)-(baseRank.get(b)??999))}}}
  if(orderedInfos.length===infos.length)infos.splice(0,infos.length,...orderedInfos);
  const edge=geom.columns>40?7:2,gutter=geom.columns>40?2:1;
  const available=Math.max(infos.length*4,geom.columns-edge*2-gutter*(infos.length-1));
  const widths=infos.map(info=>info.desired);
  let used=widths.reduce((a,b)=>a+b,0);
  while(used>available){let best=-1;for(let i=0;i<widths.length;i++)if(widths[i]>4&&(best<0||widths[i]>widths[best]))best=i;if(best<0)break;widths[best]--;used--}
  const growth=new Array(widths.length).fill(0),growthOrder=infos.map((info,index)=>({index,size:info.cluster.length,desired:info.desired})).sort((a,b)=>b.size-a.size||b.desired-a.desired||a.index-b.index);
  while(used<available&&growthOrder.some(item=>growth[item.index]<2))for(const item of growthOrder){if(used>=available)break;if(growth[item.index]>=2)continue;widths[item.index]++;growth[item.index]++;used++}
  const windows=new Map<string,ColumnWindow>();let start=edge+1;
  for(const [index,info] of infos.entries()){
    const max=Math.min(geom.columns-edge,start+widths[index]-1);
    const flow=clusterSignalFlow(info.cluster,board,anchors,m,order,composition),count=Math.max(1,flow.logical.length),span=Math.max(0,max-start);
    for(const [flowIndex,part] of flow.logical.entries()){
      const fraction=count===1?.5:(flowIndex+.5)/count;
      const physicalFraction=flow.direction==='ltr'?fraction:1-fraction;
      windows.set(part.id,{min:start,max,target:start+span*physicalFraction,flowOrder:flowIndex});
    }
    start=max+1+gutter;
  }
  return windows;
}
function rigidConnectorStageSide(spec:SemanticPart,m:Model):Side|undefined {
  if(!PART_DEFINITIONS[spec.type].userFacing||spec.rotate!==undefined)return undefined;
  const draft:CircuitPart={id:spec.id,type:spec.type,...blockPlacement(spec.type,{x:0,y:0},0),rotate:0,attrs:spec.attrs};
  const exits=getPartPins(spec.type).flatMap(pin=>{
    if(!m.groupOf.has(`${spec.id}:${pin.name}`))return [] as Array<'left'|'right'|'up'|'down'>;
    const exit=pinExitDirection(`${spec.id}:${pin.name}`,[draft]);
    return exit?[exit]:[];
  });
  if(exits.length<2||new Set(exits).size!==1)return undefined;
  const face=exits[0];
  return face==='up'?'below':face==='down'?'above':face==='left'?'right':'left';
}
function roughExternalSpecs(specs:SemanticPart[],mountsByBoard:Map<string,SemanticPart[]>,boards:CircuitPart[],anchors:CircuitPart[],composition:Composition,m:Model){
  const boardOf=new Map<string,string>();for(const [boardId,mounts] of mountsByBoard)for(const part of mounts)boardOf.set(part.id,boardId);
  const maxStageRank=Math.max(-1,...composition.stageRank.values());
  return specs.map(spec=>{
    const proxy=spec.near?boardOf.get(spec.near.anchorId):undefined;if(proxy)return {...spec,near:{...spec.near!,anchorId:proxy}};
    if(spec.near||spec.place)return spec;
    const stageId=composition.stageOf.get(spec.id),rank=stageId?composition.stageRank.get(stageId):undefined;if(stageId===undefined||rank===undefined||rank!==maxStageRank)return spec;
    const stage=composition.stages.get(stageId),boardId=stage?.members.map(member=>boardOf.get(member)).find(Boolean);if(!boardId)return spec;
    const board=boards.find(candidate=>candidate.id===boardId);if(!board)return spec;
    const connectorSide=rigidConnectorStageSide(spec,m);if(connectorSide)return {...spec,near:{anchorId:boardId,side:connectorSide}};
    const direction=compositionFlowDirection(board,anchors,composition);
    const side:Side=direction==='ltr'?'right':'left';return {...spec,near:{anchorId:boardId,side}};
  });
}
function finalExternalSpecs(specs:SemanticPart[],seated:CircuitPart[],boards:CircuitPart[],anchors:CircuitPart[],composition:Composition,m:Model){
  const seatedById=new Map(seated.map(part=>[part.id,part]));
  return specs.map(spec=>{
    if(spec.near||spec.place)return spec;
    const stageId=composition.stageOf.get(spec.id);if(!stageId)return spec;
    const stage=composition.stages.get(stageId);if(!stage)return spec;
    const mounted=stage.members.map(member=>seatedById.get(member)).filter((part):part is CircuitPart=>Boolean(part));if(!mounted.length)return spec;
    const boardId=mounted.map(part=>part.seating?.breadboardId).find(Boolean);const board=boards.find(candidate=>candidate.id===boardId);if(!board)return spec;
    const connectorSide=rigidConnectorStageSide(spec,m);if(connectorSide)return {...spec,near:{anchorId:board.id,side:connectorSide}};
    const direction=compositionFlowDirection(board,anchors,composition);
    // The stage window lives on the substrate, not on one mounted component.
    // Anchor stage-level peripherals to the board edge so several related
    // modules can share that side without one tiny package forcing the next
    // module above/below the board and across its power rails.
    const side:Side=direction==='ltr'?'right':'left';return {...spec,near:{anchorId:board.id,side}};
  });
}
function makeBoards(design:SemanticDesign,m:Model){
  const explicit=design.parts.filter(p=>isBreadboardType(p.type));
  const mounts=design.parts.filter(p=>!isBreadboardType(p.type)&&PART_DEFINITIONS[p.type].breadboardMount);
  let specs=[...explicit],auto=false;
  if(!specs.length&&mounts.length){
    const count=1;auto=true;
    for(let i=0;i<count;i++){let id=count===1?'board':`board${i+1}`;while(design.parts.some(p=>p.id===id)||specs.some(p=>p.id===id))id=`auto_${id}`;const type:PartType=count>1?'breadboard-half':(mounts.some(p=>getPartPins(p.type).length>=12)?'breadboard':'breadboard-half');specs.push({id,type,attrs:{...PART_DEFINITIONS[type].defaults}})}
  }
  if(!specs.length)return {boards:[] as CircuitPart[],specs,mountsByBoard:new Map<string,SemanticPart[]>(),auto};
  const widths=specs.map(spec=>blockDefinition(spec.type,spec.place?.rotate??spec.rotate??0).w),gap=10,total=widths.reduce((a,b)=>a+b,0)+gap*(widths.length-1);let x=-Math.round(total/2);
  const boards=specs.map((spec,index)=>{const rotate=spec.place?.rotate??spec.rotate??0,d=blockDefinition(spec.type,rotate),at=spec.place?{x:spec.place.x,y:spec.place.y}:{x,y:-Math.round(d.h/2)};if(!spec.place)x+=d.w+gap;return {id:spec.id,type:spec.type,...blockPlacement(spec.type,at,rotate),rotate,attrs:spec.attrs} as CircuitPart});
  const byId=new Map(boards.map(b=>[b.id,b])),mountsByBoard=new Map(boards.map(b=>[b.id,[] as SemanticPart[]]));
  const assigned=new Set<string>();
  for(const part of mounts){const requested=part.seat?.boardId??part.boardId;if(!requested)continue;if(!byId.has(requested))throw new Error(`${part.id} references unknown breadboard ${requested}`);mountsByBoard.get(requested)!.push(part);assigned.add(part.id)}
  const remaining=mounts.filter(p=>!assigned.has(p.id));
  if(boards.length===1)mountsByBoard.get(boards[0].id)!.push(...remaining);
  else {
    const clusters=signalMountClusters(remaining,m);
    for(const cluster of clusters){
      let best=boards[0],bestScore=Number.POSITIVE_INFINITY;
      for(const board of boards){const local=mountsByBoard.get(board.id)!;let affinity=0;for(const part of cluster)for(const pin of getPartPins(part.type)){const g=m.groupOf.get(`${part.id}:${pin.name}`);if(!g)continue;for(const endpoint of m.members.get(g)??[]){const otherId=endpointParts(endpoint)?.partId;if(otherId&&local.some(x=>x.id===otherId))affinity++}}const score=local.length*100+cluster.length*25-affinity*500;if(score<bestScore){best=board;bestScore=score}}
      mountsByBoard.get(best.id)!.push(...cluster);
    }
  }
  return {boards,specs,mountsByBoard,auto};
}
function controllerAnchors(design:SemanticDesign,boards:CircuitPart[],mountIds:Set<string>,mountsByBoard:Map<string,SemanticPart[]>,m:Model){
  const specs=design.parts.filter(p=>p.type==='wokwi-arduino-uno'&&!mountIds.has(p.id));
  const parts:CircuitPart[]=[],chosen=new Map<string,{at:BlockCell;rotate:number}>(),alignments:ConnectorFieldAlignment[]=[];
  const leftBoard=[...boards].sort((a,b)=>partBlockAt(a).x-partBlockAt(b).x)[0];
  for(const [index,spec] of specs.entries()){
    const rotate=spec.place?.rotate??spec.rotate??0;
    let at:BlockCell;
    if(spec.place)at={x:spec.place.x,y:spec.place.y};
    else if(leftBoard){
      const ba=partBlockAt(leftBoard),bd=blockDefinition(leftBoard.type,leftBoard.rotate??0),d=blockDefinition(spec.type,rotate);
      at={x:ba.x-d.w-4,y:ba.y+Math.round((bd.h-d.h)/2)+index*(d.h+3)};
      const localMountIds=new Set((mountsByBoard.get(leftBoard.id)??[]).map(part=>part.id));
      const buses:Array<{id:string;controllerEndpoints:string[]}>=[];
      for(const [group,endpoints] of m.members){
        if((m.role.get(group)??'signal')!=='signal'||endpoints.length<4)continue;
        const controllerEndpoints=endpoints.filter(endpoint=>endpointParts(endpoint)?.partId===spec.id);
        if(!controllerEndpoints.length)continue;
        if(!endpoints.some(endpoint=>localMountIds.has(endpointParts(endpoint)?.partId??'')))continue;
        buses.push({id:m.name.get(group)??group,controllerEndpoints});
      }
      if(buses.length){
        const draft:CircuitPart={id:spec.id,type:spec.type,...blockPlacement(spec.type,at,rotate),rotate,attrs:spec.attrs};
        const rect=partRect(draft),midY=rect.y+rect.height/2;
        const sourcePoints=buses.flatMap(bus=>bus.controllerEndpoints
          .map(endpoint=>endpointPoint(endpoint,[draft,leftBoard]))
          .filter((point):point is {x:number;y:number}=>Boolean(point)));
        if(sourcePoints.length){
          const upperVotes=sourcePoints.filter(point=>point.y<midY).length;
          const half:'upper'|'lower'=upperVotes>sourcePoints.length/2?'upper':'lower';
          const rows=half==='upper'?['A','B','C','D','E']:['F','G','H','I','J'];
          const rowYs=rows.map(row=>endpointPoint(`${leftBoard.id}:${row}1`,[draft,leftBoard])?.y)
            .filter((value):value is number=>Number.isFinite(value));
          if(rowYs.length){
            const sourceY=sourcePoints.reduce((sum,point)=>sum+point.y,0)/sourcePoints.length;
            const targetY=[...rowYs].sort((a,b)=>Math.abs(a-sourceY)-Math.abs(b-sourceY))[0];
            const offsetCells=Math.round((targetY-sourceY)/BLOCK_CELL_PX);
            if(offsetCells){
              at={...at,y:at.y+offsetCells};
              alignments.push({controllerId:spec.id,boardId:leftBoard.id,busIds:buses.map(bus=>bus.id),half,offsetCells});
            }
          }
        }
      }
    }else at={x:index*35,y:0};
    const part:CircuitPart={id:spec.id,type:spec.type,...blockPlacement(spec.type,at,rotate),rotate,attrs:spec.attrs};
    parts.push(part);chosen.set(spec.id,{at,rotate});
  }
  return {parts,chosen,alignments};
}
function railSideCosts(board:CircuitPart,endpoints:string[],role:'power'|'ground',parts:CircuitPart[]){
  const sign=role==='ground'?'-':'+';
  const local=endpoints.slice(1).flatMap(endpoint=>{
    const parsed=endpointParts(endpoint);if(!parsed)return [] as Array<{endpoint:string;hole:string}>;
    const part=parts.find(p=>p.id===parsed.partId);if(part?.seating?.breadboardId!==board.id)return [] as Array<{endpoint:string;hole:string}>;
    const hole=part.seating.pins[parsed.pinName];return hole?[{endpoint,hole}]:[];
  });
  let top=0,bottom=0;
  if(local.length){
    for(const {endpoint,hole} of local){
      const upper='ABCDE'.includes(hole[0].toUpperCase());
      if(upper)bottom+=1200;else top+=1200;
      const dir=pinExitDirection(endpoint,parts);if(dir==='up')bottom+=180;else if(dir==='down')top+=180;
    }
  }
  // The source cable is visually important even when mounted consumers already
  // vote for a rail side. Without this term a battery could be placed beside the
  // lower rail while its + lead was pulled all the way to the top rail simply
  // because a load happened to be seated above the trench.
  const topPoint=endpointPoint(`${board.id}:${sign}top1`,parts),bottomPoint=endpointPoint(`${board.id}:${sign}bottom1`,parts);
  if(topPoint&&bottomPoint){
    const source=endpoints[0],sourcePoint=endpointPoint(source,parts),sourceId=endpointParts(source)?.partId,sourcePart=parts.find(part=>part.id===sourceId);
    const sourceWeight=sourcePart&&PART_DEFINITIONS[sourcePart.type].flexibleLeadPins?.length?2.6:1.15;
    if(sourcePoint){top+=Math.abs(sourcePoint.y-topPoint.y)*sourceWeight;bottom+=Math.abs(sourcePoint.y-bottomPoint.y)*sourceWeight}
    if(!local.length)for(const endpoint of endpoints.slice(1)){const point=endpointPoint(endpoint,parts);if(!point)continue;top+=Math.abs(point.y-topPoint.y);bottom+=Math.abs(point.y-bottomPoint.y)}
  }
  return {top,bottom};
}
function railFor(board:CircuitPart,endpoints:string[],role:'power'|'ground',parts:CircuitPart[]){
  const sign=role==='ground'?'-':'+';const costs=railSideCosts(board,endpoints,role,parts);return `${sign}${costs.top<=costs.bottom?'top':'bottom'}`;
}

function nearestEquivalentGroundEndpoint(source:string,board:CircuitPart,rail:string,parts:CircuitPart[],pairedPowerSource?:string){
  const parsed=endpointParts(source);if(!parsed||!/^GND(?:\.\d+)?$/i.test(parsed.pinName))return source;
  const part=parts.find(candidate=>candidate.id===parsed.partId);if(!part)return source;
  const candidates=getPartPins(part).filter(pin=>/^GND(?:\.\d+)?$/i.test(pin.name));if(candidates.length<2)return source;
  const geom=getBreadboardGeometry(board.type);if(!geom)return source;
  const pairedPoint=pairedPowerSource?endpointPoint(pairedPowerSource,parts):undefined;
  const pairedExit=pairedPowerSource?pinExitDirection(pairedPowerSource,parts):undefined;
  let best=source,bestCost=Number.POSITIVE_INFINITY;
  for(const pin of candidates){
    const endpoint=`${part.id}:${pin.name}`,point=endpointPoint(endpoint,parts);if(!point)continue;
    let railCost=Number.POSITIVE_INFINITY;
    for(let hole=1;hole<=geom.railHoles;hole++){
      const railPoint=endpointPoint(`${board.id}:${rail}${hole}`,parts);if(!railPoint)continue;
      railCost=Math.min(railCost,Math.abs(point.x-railPoint.x)+Math.abs(point.y-railPoint.y));
    }
    const exit=pinExitDirection(endpoint,parts);
    // Power and ground from the same physical source are one cable bundle. Keep
    // equivalent ground aliases on the same connector side as the paired power
    // pin whenever possible, then prefer the closest pin on that side. This is
    // more important than shaving a few pixels off the run to the rail.
    const pairCost=pairedPoint&&pairedExit
      ? exit===pairedExit
        ? (Math.abs(point.x-pairedPoint.x)+Math.abs(point.y-pairedPoint.y))*4
        : BREADBOARD_HOLE_PITCH*80
      : 0;
    const cost=pairCost+railCost;
    if(cost<bestCost){bestCost=cost;best=endpoint}
  }
  return best;
}

function preSeatHalfPreferences(board:CircuitPart,mounts:SemanticPart[],m:Model,parts:CircuitPart[],fallback:'upper'|'lower'){
  const mountedIds=new Set(mounts.map(part=>part.id));
  const prefs=new Map<string,'upper'|'lower'>();
  const powerLocked=new Set<string>();
  const powerGroups:Array<{g:string;source:string;members:string[];costs:{top:number;bottom:number}}>=[];
  for(const [g,members] of m.members){
    if((m.role.get(g)??'signal')!=='power')continue;
    const local=members.filter(endpoint=>{const id=endpointParts(endpoint)?.partId;return Boolean(id&&mountedIds.has(id))});
    if(!local.length)continue;
    const source=m.source.get(g)??members[0];
    const costs=railSideCosts(board,[source,...members.filter(endpoint=>endpoint!==source)],'power',parts);
    powerGroups.push({g,source,members:local,costs});
  }
  const assigned=new Map<string,'upper'|'lower'>();
  if(powerGroups.length===1){const a=powerGroups[0];assigned.set(a.g,a.costs.top<=a.costs.bottom?'upper':'lower')}
  else if(powerGroups.length===2){
    const [a,b]=powerGroups,topBottom=a.costs.top+b.costs.bottom,bottomTop=a.costs.bottom+b.costs.top;
    if(topBottom<=bottomTop){assigned.set(a.g,'upper');assigned.set(b.g,'lower')}else{assigned.set(a.g,'lower');assigned.set(b.g,'upper')}
  }else if(powerGroups.length>2){
    throw new Error(`${board.id} has more independent positive power domains than its two isolated rail pairs. Split the powered stages across boards.`);
  }
  for(const entry of powerGroups){const half=assigned.get(entry.g);if(!half)continue;for(const endpoint of entry.members){const id=endpointParts(endpoint)?.partId;if(id){prefs.set(id,half);powerLocked.add(id)}}}
  for(const cluster of signalMountClusters(mounts,m)){
    const boardMid=(()=>{const r=partRect(board);return r.y+r.height/2})();
    const clusterIds=new Set(cluster.map(part=>part.id));
    for(const part of cluster){
      if(prefs.has(part.id))continue;
      const externalSignalYs:number[]=[];
      for(const pin of getPartPins(part.type)){
        const g=m.groupOf.get(`${part.id}:${pin.name}`);if(!g||(m.role.get(g)??'signal')!=='signal')continue;
        for(const endpoint of m.members.get(g)??[]){
          const parsed=endpointParts(endpoint);if(!parsed||clusterIds.has(parsed.partId))continue;
          const external=parts.find(candidate=>candidate.id===parsed.partId);
          if(external?.type!=='wokwi-arduino-uno')continue;
          const point=endpointPoint(endpoint,parts);if(point)externalSignalYs.push(point.y)
        }
      }
      if(externalSignalYs.length){const y=externalSignalYs.reduce((sum,value)=>sum+value,0)/externalSignalYs.length;prefs.set(part.id,y<boardMid?'upper':'lower')}
    }
    const known=cluster.map(part=>prefs.get(part.id)).filter((value):value is 'upper'|'lower'=>Boolean(value));
    const upper=known.filter(value=>value==='upper').length,lower=known.length-upper;
    const inherited=known.length?(upper>=lower?'upper':'lower'):fallback;
    for(const part of cluster)if(!prefs.has(part.id))prefs.set(part.id,inherited);
  }
  // near(..., 'above'|'below') is a local composition hint, not a request to
  // cross the breadboard trench. Half choice comes from power domains and
  // controller-facing signal flow; seatMounts then satisfies the relative
  // vertical relationship within that half when possible. This keeps simple
  // serial stages such as resistor -> LED in one readable strip region.
  return prefs;
}
function safeRailHole(board:CircuitPart,rail:string,endpoint:string,parts:CircuitPart[],used:Set<number>,avoidXs:number[]=[]){
  const geom=getBreadboardGeometry(board.type)!;
  const target=endpointPoint(endpoint,parts)??{x:partRect(board).x+partRect(board).width/2,y:partRect(board).y};
  let best:{hole:number;cost:number}|undefined;
  for(let hole=1;hole<=geom.railHoles;hole++){
    if(used.has(hole))continue;
    const point=endpointPoint(`${board.id}:${rail}${hole}`,parts);if(!point)continue;
    const blocked=parts.some(part=>part.id!==board.id&&part.seating?.breadboardId===board.id&&(()=>{const r=partRect(part),m=5;return point.x>=r.x-m&&point.x<=r.x+r.width+m&&point.y>=r.y-m&&point.y<=r.y+r.height+m})());
    if(blocked)continue;
    const nearestProtected=avoidXs.length?Math.min(...avoidXs.map(x=>Math.abs(point.x-x))):Number.POSITIVE_INFINITY;
    const protectedPenalty=nearestProtected<BREADBOARD_HOLE_PITCH*1.25
      ? BREADBOARD_HOLE_PITCH*14+(BREADBOARD_HOLE_PITCH*1.25-nearestProtected)*40
      : 0;
    const cost=Math.abs(point.x-target.x)+Math.abs(point.y-target.y)+protectedPenalty;
    if(!best||cost<best.cost)best={hole,cost};
  }
  if(!best)throw new Error(`No clear ${rail} rail hole for ${endpoint}`);
  used.add(best.hole);return `${rail}${best.hole}`;
}
function safeRailBridgeHole(board:CircuitPart,polarity:'+'|'-',parts:CircuitPart[],usedTop:Set<number>,usedBottom:Set<number>,avoidXs:number[]=[]){
  const geom=getBreadboardGeometry(board.type)!;let best:{hole:number;cost:number}|undefined;
  for(let hole=1;hole<=geom.railHoles;hole++){
    if(usedTop.has(hole)||usedBottom.has(hole))continue;
    const top=endpointPoint(`${board.id}:${polarity}top${hole}`,parts),bottom=endpointPoint(`${board.id}:${polarity}bottom${hole}`,parts);if(!top||!bottom)continue;
    const x=top.x;
    const blocked=parts.some(part=>part.seating?.breadboardId===board.id&&(()=>{const r=partRect(part),margin=3;return x>=r.x-margin&&x<=r.x+r.width+margin})());
    if(blocked)continue;
    const nearestProtected=avoidXs.length?Math.min(...avoidXs.map(value=>Math.abs(x-value))):Number.POSITIVE_INFINITY;
    const protectedPenalty=nearestProtected<BREADBOARD_HOLE_PITCH*1.25?BREADBOARD_HOLE_PITCH*18:0;
    const cost=hole*BREADBOARD_HOLE_PITCH*.35+protectedPenalty;
    if(!best||cost<best.cost)best={hole,cost};
  }
  if(!best)throw new Error(`No clear ${polarity==='-'?'ground':'power'} bridge column on ${board.id}`);
  usedTop.add(best.hole);usedBottom.add(best.hole);return best.hole;
}
function q(v:unknown){return JSON.stringify(v)}
const SEMANTIC_SIGNAL_PALETTE=['#2f9e44','#1971c2','#7b2cbf','#0b7285','#c2255c','#5f3dc4','#087f5b','#364fc7','#a61e4d','#1864ab'] as const;
function semanticSignalColors(m:Model){const out=new Map<string,string>();let index=0;for(const [g] of m.members)if((m.role.get(g)??'signal')==='signal'){out.set(g,SEMANTIC_SIGNAL_PALETTE[index%SEMANTIC_SIGNAL_PALETTE.length]);index++}return out}

function compile(design:SemanticDesign,bias:'upper'|'lower',externalVariant=0):Plan {
  const m=modelOf(design.nets),composition=compositionOf(design),signalColors=semanticSignalColors(m),boardPlan=makeBoards(design,m),boards=boardPlan.boards,mounts=[...boardPlan.mountsByBoard.values()].flat(),mountIds=new Set<string>(mounts.map(p=>p.id)),controllers=controllerAnchors(design,boards,mountIds,boardPlan.mountsByBoard,m);
  const fixed=new Set<string>([...boards.map(b=>b.id),...mountIds,...controllers.parts.map(p=>p.id)]),externalSpecs=design.parts.filter(p=>!fixed.has(p.id)),fallback=[...boards].sort((a,b)=>partBlockAt(b).x-partBlockAt(a).x)[0];
  // Roughly place external loads/sources first so breadboard seating can aim each
  // functional stage toward the side where its real cable will enter. This is
  // only an anchor pass; the final external placement is recomputed after seats.
  const roughExternal=placeExternal(roughExternalSpecs(externalSpecs,boardPlan.mountsByBoard,boards,[...controllers.parts,...boards],composition,m),fallback,[...controllers.parts,...boards],m,0);
  const seated:CircuitPart[]=[],chosen=new Map<string,{pin:string;hole:string;part:CircuitPart}>();
  const boardWindows:Plan['composition']['boardWindows']=[];
  for(const board of boards){
    const local=boardPlan.mountsByBoard.get(board.id)??[];if(!local.length)continue;
    const anchors=[...controllers.parts,...roughExternal.placed,...seated,...boards.filter(b=>b.id!==board.id)];
    const windows=functionalColumnWindows(local,board,anchors,m,composition);
    if(windows){
      const grouped=new Map<string,{stageId?:string;members:string[];min:number;max:number}>();
      for(const part of local){const window=windows.get(part.id);if(!window)continue;const stageId=composition.stageOf.get(part.id),key=stageId??`part:${part.id}`,entry=grouped.get(key)??{stageId,members:[],min:window.min,max:window.max};entry.members.push(part.id);entry.min=Math.min(entry.min,window.min);entry.max=Math.max(entry.max,window.max);grouped.set(key,entry)}
      for(const entry of grouped.values())boardWindows.push({boardId:board.id,...entry});
    }
    const halfPreferences=preSeatHalfPreferences(board,local,m,[board,...anchors],bias);
    const result=seatMounts(local,board,anchors,m,bias,windows,halfPreferences);
    seated.push(...result.placed);for(const [id,value] of result.chosen)chosen.set(id,value)
  }
  const finalSpecs=finalExternalSpecs(externalSpecs,seated,boards,[...controllers.parts,...seated,...boards],composition,m);
  const external=placeExternal(finalSpecs,fallback,[...controllers.parts,...seated,...boards],m,externalVariant),all=[...controllers.parts,...seated,...external.placed,...boards],lines:string[]=[];
  for(const board of boards){const at=partBlockAt(board);lines.push(`part(${q(board.id)},${q(board.type)},${q({at:[at.x,at.y],rotate:board.rotate??0,attrs:board.attrs})})`)}
  for(const p of controllers.parts){const c=controllers.chosen.get(p.id)!;lines.push(`part(${q(p.id)},${q(p.type)},${q({at:[c.at.x,c.at.y],rotate:c.rotate,attrs:p.attrs})})`)}
  for(const spec of mounts){const s=chosen.get(spec.id);if(!s)throw new Error(`Missing seat ${spec.id}`);const boardId=s.part.seating?.breadboardId;if(!boardId)throw new Error(`Missing board for ${spec.id}`);lines.push(`part(${q(spec.id)},${q(spec.type)},${q({attrs:spec.attrs,rotate:s.part.rotate??0})})`);lines.push(`seat(${q(spec.id)},${q(boardId)},${q(s.pin)},${q(s.hole)})`)}
  for(const p of external.placed){const c=external.chosen.get(p.id)!;lines.push(`part(${q(p.id)},${q(p.type)},${q({at:[c.at.x,c.at.y],rotate:c.rotate,attrs:p.attrs})})`)}
  const partById=new Map(all.map(p=>[p.id,p]));
  const boardOfEndpoint=(endpoint:string)=>{const parsed=endpointParts(endpoint),part=partById.get(parsed?.partId??'');return part?.seating?.breadboardId};
  const inferBoard=(endpoint:string)=>{const direct=boardOfEndpoint(endpoint);if(direct)return direct;const g=m.groupOf.get(endpoint),counts=new Map<string,number>();if(g&&(m.role.get(g)??'signal')==='signal')for(const other of m.members.get(g)??[]){const b=boardOfEndpoint(other);if(b)counts.set(b,(counts.get(b)??0)+1)}if(counts.size)return [...counts].sort((a,b)=>b[1]-a[1])[0][0];const point=endpointPoint(endpoint,all);if(point&&boards.length)return [...boards].sort((a,b)=>{const ar=partRect(a),br=partRect(b),ac={x:ar.x+ar.width/2,y:ar.y+ar.height/2},bc={x:br.x+br.width/2,y:br.y+br.height/2};return Math.abs(point.x-ac.x)+Math.abs(point.y-ac.y)-Math.abs(point.x-bc.x)-Math.abs(point.y-bc.y)})[0].id;return undefined};
  const stripKey=(endpoint:string)=>{const parsed=endpointParts(endpoint),part=partById.get(parsed?.partId??'');if(!parsed||!part?.seating)return endpoint;const hole=part.seating.pins[parsed.pinName],net=hole?breadboardHoleNet(hole):undefined;return net?`${part.seating.breadboardId}:${net}`:endpoint};
  const spareStripLanding=(seatedEndpoint:string,towardEndpoint:string)=>{
    const parsed=endpointParts(seatedEndpoint),part=partById.get(parsed?.partId??'');
    if(!parsed||!part?.seating)return undefined;
    const hubHole=part.seating.pins[parsed.pinName],boardId=part.seating.breadboardId,hubNet=hubHole?breadboardHoleNet(hubHole):undefined;
    if(!hubHole||!hubNet)return undefined;
    const column=/([0-9]+)$/.exec(hubHole)?.[1],upper='ABCDE'.includes(hubHole[0].toUpperCase());if(!column)return undefined;
    const occupied=new Set<string>();for(const p of all)if(p.seating?.breadboardId===boardId)for(const hole of Object.values(p.seating.pins))occupied.add(hole);
    const target=endpointPoint(towardEndpoint,all);const rowPool=upper?['A','B','C','D','E']:['F','G','H','I','J'];
    const candidates=rowPool.map(row=>`${row}${column}`).filter(hole=>{
      if(breadboardHoleNet(hole)!==hubNet||occupied.has(hole))return false;
      const point=endpointPoint(`${boardId}:${hole}`,all);if(!point)return false;
      return !all.some(p=>p.seating?.breadboardId===boardId&&(()=>{const r=partRect(p),margin=ACCESS_CLEARANCE;return point.x>=r.x-margin&&point.x<=r.x+r.width+margin&&point.y>=r.y-margin&&point.y<=r.y+r.height+margin})());
    });
    candidates.sort((a,b)=>{const ap=endpointPoint(`${boardId}:${a}`,all),bp=endpointPoint(`${boardId}:${b}`,all);if(!target||!ap||!bp)return 0;return Math.abs(ap.x-target.x)+Math.abs(ap.y-target.y)-Math.abs(bp.x-target.x)-Math.abs(bp.y-target.y)});
    return candidates[0]?`${boardId}:${candidates[0]}`:undefined;
  };
  const nearbyJunctionBreakout=(seatedEndpoint:string,towardEndpoint:string)=>{
    const parsed=endpointParts(seatedEndpoint),part=partById.get(parsed?.partId??'');
    if(!parsed||!part?.seating)return undefined;
    const hubHole=part.seating.pins[parsed.pinName],boardId=part.seating.breadboardId;if(!hubHole)return undefined;
    const hubColumn=Number(/([0-9]+)$/.exec(hubHole)?.[1]);if(!Number.isFinite(hubColumn))return undefined;
    const board=partById.get(boardId);if(!board||!isBreadboardType(board.type))return undefined;
    const geom=getBreadboardGeometry(board.type)!;const upper='ABCDE'.includes(hubHole[0].toUpperCase()),rowsPool=upper?['A','B','C','D','E']:['F','G','H','I','J'];
    const occupied=new Set<string>();for(const p of all)if(p.seating?.breadboardId===boardId)for(const hole of Object.values(p.seating.pins))occupied.add(hole);
    const hubPoint=endpointPoint(seatedEndpoint,all),target=endpointPoint(towardEndpoint,all);if(!hubPoint)return undefined;
    const columnOrder:Array<number>=[];for(let delta=1;delta<=8;delta++){for(const column of [hubColumn-delta,hubColumn+delta])if(column>=1&&column<=geom.columns)columnOrder.push(column)}
    let best:{cost:number;jump:string;landing:string}|undefined;
    for(const column of columnOrder){
      // A breakout strip must be electrically unused before we claim it.
      if(rowsPool.some(row=>occupied.has(`${row}${column}`)))continue;
      const clear=rowsPool.map(row=>`${row}${column}`).filter(hole=>{
        const point=endpointPoint(`${boardId}:${hole}`,all);if(!point)return false;
        return !all.some(p=>p.seating?.breadboardId===boardId&&(()=>{const r=partRect(p),margin=ACCESS_CLEARANCE;return point.x>=r.x-margin&&point.x<=r.x+r.width+margin&&point.y>=r.y-margin&&point.y<=r.y+r.height+margin})());
      });
      if(clear.length<2)continue;
      for(const jump of clear)for(const landing of clear){if(jump===landing)continue;const jp=endpointPoint(`${boardId}:${jump}`,all)!,lp=endpointPoint(`${boardId}:${landing}`,all)!;const cost=Math.abs(jp.x-hubPoint.x)+Math.abs(jp.y-hubPoint.y)+(target?Math.abs(lp.x-target.x)+Math.abs(lp.y-target.y):0);if(!best||cost<best.cost)best={cost,jump:`${boardId}:${jump}`,landing:`${boardId}:${landing}`}}
      if(best&&Math.abs(column-hubColumn)<=2)break;
    }
    return best;
  };
  const reservedSignalJunctionColumns=new Map<string,Set<number>>();
  const freeSignalJunction=(reps:string[],boardId:string)=>{
    const board=partById.get(boardId);if(!board||!isBreadboardType(board.type))return undefined;
    const geom=getBreadboardGeometry(board.type)!;
    const seated=reps.flatMap(endpoint=>{const parsed=endpointParts(endpoint),part=partById.get(parsed?.partId??'');if(!parsed||part?.seating?.breadboardId!==boardId)return [] as Array<{endpoint:string;hole:string}>;const hole=part.seating.pins[parsed.pinName];return hole?[{endpoint,hole}]:[]});
    if(!seated.length)return undefined;
    const upperVotes=seated.filter(item=>'ABCDE'.includes(item.hole[0].toUpperCase())).length;
    const half=upperVotes>=Math.ceil(seated.length/2)?'upper':'lower';
    const rowPool=half==='upper'?['A','B','C','D','E']:['F','G','H','I','J'];
    const occupied=new Set<string>();for(const p of all)if(p.seating?.breadboardId===boardId)for(const hole of Object.values(p.seating.pins))occupied.add(hole);
    const targetPoints=reps.map(endpoint=>endpointPoint(endpoint,all)).filter((point):point is {x:number;y:number}=>Boolean(point));
    const targetX=targetPoints.length?targetPoints.reduce((sum,p)=>sum+p.x,0)/targetPoints.length:partRect(board).x+partRect(board).width/2;
    const columns=Array.from({length:geom.columns},(_,i)=>i+1).sort((a,b)=>{
      const ap=endpointPoint(`${boardId}:${rowPool[2]}${a}`,all),bp=endpointPoint(`${boardId}:${rowPool[2]}${b}`,all);
      return Math.abs((ap?.x??targetX)-targetX)-Math.abs((bp?.x??targetX)-targetX);
    });
    const reserved=reservedSignalJunctionColumns.get(boardId)??new Set<number>();reservedSignalJunctionColumns.set(boardId,reserved);
    for(const column of columns){
      if(reserved.has(column))continue;
      const holes=rowPool.map(row=>`${row}${column}`).filter(hole=>{
        if(occupied.has(hole))return false;
        const point=endpointPoint(`${boardId}:${hole}`,all);if(!point)return false;
        return !all.some(p=>p.seating?.breadboardId===boardId&&(()=>{const r=partRect(p),margin=ACCESS_CLEARANCE;return point.x>=r.x-margin&&point.x<=r.x+r.width+margin&&point.y>=r.y-margin&&point.y<=r.y+r.height+margin})());
      });
      if(holes.length<reps.length)continue;
      const sortedReps=[...reps].sort((a,b)=>(endpointPoint(a,all)?.y??0)-(endpointPoint(b,all)?.y??0));
      const sortedHoles=[...holes].sort((a,b)=>(endpointPoint(`${boardId}:${a}`,all)?.y??0)-(endpointPoint(`${boardId}:${b}`,all)?.y??0));
      reserved.add(column);
      return sortedReps.map((endpoint,index)=>({endpoint,landing:`${boardId}:${sortedHoles[index]}`}));
    }
    return undefined;
  };  const signalIngressXsByBoard=new Map<string,number[]>();
  const fineAlignedExternalAxes=new Set<string>();
  const maybeFineAlignExternal=(from:string,to:string)=>{
    for(const [externalEndpoint,targetEndpoint] of [[from,to],[to,from]] as const){
      const externalParsed=endpointParts(externalEndpoint),targetParsed=endpointParts(targetEndpoint);
      const externalPart=partById.get(externalParsed?.partId??''),targetPart=partById.get(targetParsed?.partId??'');
      if(!externalParsed||!externalPart||!targetPart||externalPart.seating||isBreadboardType(externalPart.type))continue;
      if(!(PART_DEFINITIONS[externalPart.type].flexibleLeadPins??[]).includes(externalParsed.pinName))continue;
      if(!isBreadboardType(targetPart.type)&&!targetPart.seating)continue;
      const externalPoint=endpointPoint(externalEndpoint,all),targetPoint=endpointPoint(targetEndpoint,all);if(!externalPoint||!targetPoint)continue;
      // The block grid picks the scene. Exact flexible terminals can land a few
      // pixels off the breadboard phase, which otherwise creates a tiny adapter
      // jog at the end of an otherwise straight lead. Fine-align only the axis
      // perpendicular to the long cable run, and only for a sub-cell correction.
      const axis: 'x'|'y'=Math.abs(externalPoint.x-targetPoint.x)>=Math.abs(externalPoint.y-targetPoint.y)?'y':'x';
      const delta=targetPoint[axis]-externalPoint[axis],key=`${externalPart.id}:${axis}`;
      if(fineAlignedExternalAxes.has(key)||Math.abs(delta)<.05||Math.abs(delta)>BREADBOARD_HOLE_PITCH*.65)continue;
      fineAlignedExternalAxes.add(key);
      lines.push(`align(${q(externalEndpoint)},${q(targetEndpoint)},${q(axis)})`);
    }
  };
  for(const [g,endpoints] of m.members){
    if((m.role.get(g)??'signal')!=='signal')continue;
    const hasExternal=endpoints.some(endpoint=>{const parsed=endpointParts(endpoint),part=partById.get(parsed?.partId??'');return Boolean(part&&!part.seating&&!isBreadboardType(part.type))});
    if(!hasExternal)continue;
    for(const endpoint of endpoints){
      const boardId=boardOfEndpoint(endpoint);if(!boardId)continue;
      const point=endpointPoint(endpoint,all);if(!point)continue;
      const list=signalIngressXsByBoard.get(boardId)??[];list.push(point.x);signalIngressXsByBoard.set(boardId,list);
    }
  }  const railReservations=new Map<string,Set<number>>();
  const railFeedReservations=new Map<string,Set<number>>();
  const powerRailAssignment=new Map<string,string>();
  const groundRailAssignment=new Map<string,string>();
  const powerGroupsByBoard=new Map<string,Array<{g:string;endpoints:string[]}>>();
  const groundGroupsByBoard=new Map<string,Array<{g:string;endpoints:string[]}>>();
  for(const [g,endpoints] of m.members){
    const role=m.role.get(g)??'signal';if(role!=='power'&&role!=='ground')continue;
    const source=m.source.get(g)??endpoints[0],ordered=endpoints.includes(source)?[source,...endpoints.filter(e=>e!==source)]:endpoints;
    const byBoard=new Map<string,string[]>();for(const endpoint of ordered.slice(1)){const b=inferBoard(endpoint);if(b){const list=byBoard.get(b)??[];list.push(endpoint);byBoard.set(b,list)}}
    for(const [boardId,consumers] of byBoard){
      if(role==='power'){const list=powerGroupsByBoard.get(boardId)??[];list.push({g,endpoints:[source,...consumers]});powerGroupsByBoard.set(boardId,list)}
      else {const list=groundGroupsByBoard.get(boardId)??[];list.push({g,endpoints:[source,...consumers]});groundGroupsByBoard.set(boardId,list)}
    }
  }
  const mountedPowerSide=(board:CircuitPart,endpoints:string[])=>{
    const sides=new Set<'top'|'bottom'>();
    for(const endpoint of endpoints.slice(1)){
      const parsed=endpointParts(endpoint),part=partById.get(parsed?.partId??'');
      if(!parsed||part?.seating?.breadboardId!==board.id)continue;
      const hole=part.seating.pins[parsed.pinName];if(!hole)continue;
      sides.add('ABCDE'.includes(hole[0].toUpperCase())?'top':'bottom');
    }
    if(sides.size>1)throw new Error(`${board.id} has one positive power domain seated across both breadboard halves. Keep that domain on one terminal half so its rail drops do not cross the center divider.`);
    return [...sides][0];
  };
  for(const [boardId,groups] of powerGroupsByBoard){
    const board=boards.find(b=>b.id===boardId)!;if(groups.length>2)throw new Error(`${boardId} has more independent power domains than isolated positive rails. Split the power stages across boards.`);
    if(groups.length===1){
      const mounted=mountedPowerSide(board,groups[0].endpoints);
      powerRailAssignment.set(`${groups[0].g}:${boardId}`,mounted?`+${mounted}`:railFor(board,groups[0].endpoints,'power',all));
    }
    else if(groups.length===2){
      const aMounted=mountedPowerSide(board,groups[0].endpoints),bMounted=mountedPowerSide(board,groups[1].endpoints);
      if(aMounted&&bMounted&&aMounted===bMounted)throw new Error(`${boardId} has two independent positive power domains seated on the same terminal half. Keep the domains on opposite halves so their isolated positive rails cannot be mixed.`);
      if(aMounted||bMounted){
        const aSide=aMounted??(bMounted==='top'?'bottom':'top'),bSide=bMounted??(aSide==='top'?'bottom':'top');
        powerRailAssignment.set(`${groups[0].g}:${boardId}`,`+${aSide}`);powerRailAssignment.set(`${groups[1].g}:${boardId}`,`+${bSide}`);
      }else{
        const a=railSideCosts(board,groups[0].endpoints,'power',all),b=railSideCosts(board,groups[1].endpoints,'power',all);
        const topBottom=a.top+b.bottom,bottomTop=a.bottom+b.top;
        if(topBottom<=bottomTop){powerRailAssignment.set(`${groups[0].g}:${boardId}`,'+top');powerRailAssignment.set(`${groups[1].g}:${boardId}`,'+bottom')}
        else {powerRailAssignment.set(`${groups[0].g}:${boardId}`,'+bottom');powerRailAssignment.set(`${groups[1].g}:${boardId}`,'+top')}
      }
    }
  }
  // Remember which positive rail side belongs to each source part. Ground is a
  // shared net, but a physical source cable is still a pair: battery +/- and a
  // controller's 5V/GND should enter the same side of the board whenever that
  // does not mix positive domains. Ground consumers/sources from that same part
  // follow the assigned positive side, then the common ground rails can bridge
  // internally at a quiet column.
  const powerSideByPartBoard=new Map<string,'top'|'bottom'>();
  for(const [boardId,groups] of powerGroupsByBoard){
    const board=boards.find(candidate=>candidate.id===boardId)!;
    const br=partRect(board),singleDomain=groups.length===1;
    for(const entry of groups){
      const rail=powerRailAssignment.get(`${entry.g}:${boardId}`);if(!rail)continue;
      const feedSide: 'top'|'bottom'=rail.endsWith('bottom')?'bottom':'top';
      for(const [index,endpoint] of entry.endpoints.entries()){
        const parsed=endpointParts(endpoint),part=partById.get(parsed?.partId??'');if(!parsed||!part)continue;
        let side=feedSide;
        if(singleDomain&&index>0){
          if(part.seating?.breadboardId===boardId){
            const hole=part.seating.pins[parsed.pinName];if(hole)side='ABCDE'.includes(hole[0].toUpperCase())?'top':'bottom';
          }else{
            const point=endpointPoint(endpoint,all);
            if(point&&point.y<br.y-BREADBOARD_HOLE_PITCH*.5)side='top';
            else if(point&&point.y>br.y+br.height+BREADBOARD_HOLE_PITCH*.5)side='bottom';
          }
        }
        powerSideByPartBoard.set(`${part.id}:${boardId}`,side);
      }
    }
  }
  for(const [boardId,groups] of groundGroupsByBoard){const board=boards.find(b=>b.id===boardId)!;for(const entry of groups)groundRailAssignment.set(`${entry.g}:${boardId}`,railFor(board,entry.endpoints,'ground',all))}
  for(const [g,endpoints] of m.members){
    const role=m.role.get(g)??'signal',id=m.name.get(g)??`net${lines.length}`,source=m.source.get(g)??endpoints[0],ordered=endpoints.includes(source)?[source,...endpoints.filter(e=>e!==source)]:endpoints;
    const emitWire=(wireId:string,from:string,to:string)=>{maybeFineAlignExternal(from,to);const color=role==='signal'?signalColors.get(g):undefined;lines.push(`wire(${q(wireId)},${q(from)},${q(to)},${q(role)}${color?`,${q(color)}`:''})`)};
    if((role==='power'||role==='ground')&&boards.length){
      const byBoard=new Map<string,string[]>(),direct:string[]=[];
      for(const endpoint of ordered.slice(1)){const b=inferBoard(endpoint);if(b){const list=byBoard.get(b)??[];list.push(endpoint);byBoard.set(b,list)}else direct.push(endpoint)}
      let boardEntries=[...byBoard.entries()];
      if(role==='ground'&&boardEntries.length>1){
        // One common return should look like one common return. Walk outward
        // from the source through the nearest boards instead of pulling an
        // independent controller ground cable to every substrate. This removes
        // long ground runs from GPIO fan-out and makes the return backbone
        // visually traceable across multi-board builds.
        const remaining=[...boardEntries],orderedBoards:typeof boardEntries=[];
        let cursor=endpointPoint(source,all);
        while(remaining.length){
          remaining.sort((a,b)=>{
            const center=(entry:typeof remaining[number])=>{const board=boards.find(candidate=>candidate.id===entry[0])!,r=partRect(board);return {x:r.x+r.width/2,y:r.y+r.height/2}};
            const ac=center(a),bc=center(b);if(!cursor)return ac.x-bc.x;
            return Math.abs(ac.x-cursor.x)+Math.abs(ac.y-cursor.y)-Math.abs(bc.x-cursor.x)-Math.abs(bc.y-cursor.y);
          });
          const next=remaining.shift()!;orderedBoards.push(next);const board=boards.find(candidate=>candidate.id===next[0])!,r=partRect(board);cursor={x:r.x+r.width/2,y:r.y+r.height/2};
        }
        boardEntries=orderedBoards;
      }
      let previousGroundBoard:{board:CircuitPart;rail:string}|undefined;
      for(const [boardId,consumers] of boardEntries){
        const board=boards.find(b=>b.id===boardId)!;
        if(role==='ground'){
          const upper:string[]=[],lower:string[]=[];const br=partRect(board),midY=br.y+br.height/2;
          for(const consumer of consumers){
            const parsed=endpointParts(consumer),part=partById.get(parsed?.partId??'');
            const pairedSide=part?powerSideByPartBoard.get(`${part.id}:${boardId}`):undefined;
            if(pairedSide){(pairedSide==='top'?upper:lower).push(consumer)}
            else if(parsed&&part?.seating?.breadboardId===boardId){
              const hole=part.seating.pins[parsed.pinName];
              if(hole&&'ABCDE'.includes(hole[0].toUpperCase()))upper.push(consumer);else lower.push(consumer);
            }else{
              const point=endpointPoint(consumer,all);(point&&point.y>midY?lower:upper).push(consumer);
            }
          }
          const sourcePartId=endpointParts(source)?.partId,pairedSourceSide=sourcePartId?powerSideByPartBoard.get(`${sourcePartId}:${boardId}`):undefined;
          const sourceRail=groundRailAssignment.get(`${g}:${boardId}`)??railFor(board,[source],'ground',all),feedSide=pairedSourceSide??(sourceRail.endsWith('bottom')?'bottom':'top');
          const usedTop=railReservations.get(`${boardId}:top`)??new Set<number>(),usedBottom=railReservations.get(`${boardId}:bottom`)??new Set<number>();
          railReservations.set(`${boardId}:top`,usedTop);railReservations.set(`${boardId}:bottom`,usedBottom);
          const feedUsed=railFeedReservations.get(boardId)??new Set<number>();railFeedReservations.set(boardId,feedUsed);
          const feedLocal=feedSide==='top'?usedTop:usedBottom,feedRail=`-${feedSide}`;
          // Ground aliases on boards such as the Arduino Uno are electrically
          // equivalent. Let the physicalizer choose the terminal nearest the
          // assigned ground rail instead of dragging an arbitrary model-picked
          // GND header across unrelated GPIO fan-out.
          const pairedPowerSource=(powerGroupsByBoard.get(boardId)??[])
            .map(entry=>entry.endpoints[0])
            .find(endpoint=>endpointParts(endpoint)?.partId===sourcePartId);
          const physicalSource=nearestEquivalentGroundEndpoint(source,board,feedRail,all,pairedPowerSource);
          let feedSource=physicalSource;
          if(previousGroundBoard){
            const previousSide=previousGroundBoard.rail.endsWith('bottom')?'bottom':'top';
            const previousUsed=railReservations.get(`${previousGroundBoard.board.id}:${previousSide}`)??new Set<number>();railReservations.set(`${previousGroundBoard.board.id}:${previousSide}`,previousUsed);
            const previousFeedUsed=railFeedReservations.get(previousGroundBoard.board.id)??new Set<number>();railFeedReservations.set(previousGroundBoard.board.id,previousFeedUsed);
            const previousCombined=new Set<number>([...previousUsed,...previousFeedUsed]);
            const previousHole=safeRailHole(previousGroundBoard.board,previousGroundBoard.rail,`${board.id}:${feedRail}1`,all,previousCombined,signalIngressXsByBoard.get(previousGroundBoard.board.id)??[]);
            const previousNumber=Number(/(\d+)$/.exec(previousHole)?.[1]);if(Number.isFinite(previousNumber)){previousUsed.add(previousNumber);previousFeedUsed.add(previousNumber)}
            feedSource=`${previousGroundBoard.board.id}:${previousHole}`;
          }
          const feed=safeRailHole(board,feedRail,feedSource,all,new Set<number>([...feedLocal,...feedUsed]));
          const feedHole=Number(/(\d+)$/.exec(feed)?.[1]);if(Number.isFinite(feedHole)){feedLocal.add(feedHole);feedUsed.add(feedHole)}
          emitWire(previousGroundBoard?`${id}-${previousGroundBoard.board.id}-${boardId}-backbone`:`${id}-${boardId}-feed`,feedSource,`${board.id}:${feed}`);
          if(upper.length&&lower.length){
            const bridgeHole=safeRailBridgeHole(board,'-',all,usedTop,usedBottom,signalIngressXsByBoard.get(boardId)??[]);
            emitWire(`${id}-${boardId}-bridge`,`${board.id}:-top${bridgeHole}`,`${board.id}:-bottom${bridgeHole}`);
          }
          for(const [side,list] of [['top',upper],['bottom',lower]] as const){
            if(!list.length)continue;const rail=`-${side}`,used=side==='top'?usedTop:usedBottom;
            for(const [index,consumer] of list.entries()){
              const parsedConsumer=endpointParts(consumer);
              if(parsedConsumer?.partId===board.id&&breadboardHoleNet(parsedConsumer.pinName)===rail)continue;
              const hole=safeRailHole(board,rail,consumer,all,used,signalIngressXsByBoard.get(boardId)??[]),railEndpoint=`${board.id}:${hole}`;
              const landing=boardOfEndpoint(consumer)?(spareStripLanding(consumer,railEndpoint)??consumer):consumer;
              emitWire(`${id}-${boardId}-${side}-${index+1}`,railEndpoint,landing);
            }
          }
          previousGroundBoard={board,rail:feedRail};
          continue;
        }
        const rail=powerRailAssignment.get(`${g}:${boardId}`)??railFor(board,[source,...consumers],role,all);
        const feedSide: 'top'|'bottom'=rail.endsWith('top')?'top':'bottom';
        const usedTop=railReservations.get(`${boardId}:top`)??new Set<number>(),usedBottom=railReservations.get(`${boardId}:bottom`)??new Set<number>();
        railReservations.set(`${boardId}:top`,usedTop);railReservations.set(`${boardId}:bottom`,usedBottom);
        const used=feedSide==='top'?usedTop:usedBottom;
        // Feed cables from external sources share the same space around a board
        // even when they terminate on opposite rail pairs. Reserve their visible
        // entry columns globally so 5V, ground, and a second supply never stack.
        const feedUsed=railFeedReservations.get(boardId)??new Set<number>();
        railFeedReservations.set(boardId,feedUsed);
        const combinedFeedUsed=new Set<number>([...used,...feedUsed]);
        const feed=safeRailHole(board,rail,source,all,combinedFeedUsed);
        const feedHole=Number(/(\d+)$/.exec(feed)?.[1]);
        if(Number.isFinite(feedHole)){used.add(feedHole);feedUsed.add(feedHole)}
        emitWire(`${id}-${boardId}-feed`,source,`${board.id}:${feed}`);
        const canSplit=(powerGroupsByBoard.get(boardId)?.length??0)===1;
        const upper:string[]=[],lower:string[]=[];
        for(const consumer of consumers){
          const partId=endpointParts(consumer)?.partId,preferred=partId?powerSideByPartBoard.get(`${partId}:${boardId}`):undefined;
          (canSplit&&preferred==='top'?upper:canSplit&&preferred==='bottom'?lower:feedSide==='top'?upper:lower).push(consumer);
        }
        if(canSplit&&upper.length&&lower.length){
          const bridgeHole=safeRailBridgeHole(board,'+',all,usedTop,usedBottom,signalIngressXsByBoard.get(boardId)??[]);
          emitWire(`${id}-${boardId}-bridge`,`${board.id}:+top${bridgeHole}`,`${board.id}:+bottom${bridgeHole}`);
        }
        for(const [side,list] of [['top',upper],['bottom',lower]] as const){
          if(!list.length)continue;const branchRail=`+${side}`,branchUsed=side==='top'?usedTop:usedBottom;
          for(const [index,consumer] of list.entries()){
            const parsedConsumer=endpointParts(consumer);
            if(parsedConsumer?.partId===board.id&&breadboardHoleNet(parsedConsumer.pinName)===branchRail)continue;
            const hole=safeRailHole(board,branchRail,consumer,all,branchUsed,signalIngressXsByBoard.get(boardId)??[]);
            const railEndpoint=`${board.id}:${hole}`;
            const landing=boardOfEndpoint(consumer)?(spareStripLanding(consumer,railEndpoint)??consumer):consumer;
            emitWire(`${id}-${boardId}-${side}-${index+1}`,railEndpoint,landing)
          }
        }
      }
      for(const [index,consumer] of direct.entries())emitWire(`${id}-direct-${index+1}`,source,consumer);
      continue;
    }
    const reps:string[]=[];const seen=new Set<string>();for(const endpoint of ordered){const key=stripKey(endpoint);if(seen.has(key))continue;seen.add(key);reps.push(endpoint)}
    // Larger shared signal buses are already a first-class low-level `net`.
    // Keep them as one semantic net through routing so every branch retains the
    // same netId, and let the low-level physicalizer allocate one electrically
    // isolated strip per bus. Three-terminal local stage nodes still use the
    // nearby-strip logic below because they benefit from a component-local hub.
    if(role==='signal'&&reps.length>=4&&boards.length===1){
      const color=signalColors.get(g);
      lines.push(`net(${q(id)},${q('signal')},${q(reps)}${color?`,${q(color)}`:''})`);
      continue;
    }
    if(reps.length===2){
      const [first,second]=reps,firstBoard=boardOfEndpoint(first),secondBoard=boardOfEndpoint(second);
      if(firstBoard&&!secondBoard){const landing=spareStripLanding(first,second);if(landing){emitWire(`${id}-1`,second,landing);continue}const breakout=endpoints.length>2?nearbyJunctionBreakout(first,second):undefined;if(breakout){emitWire(`${id}-jump`,first,breakout.jump);emitWire(`${id}-1`,second,breakout.landing);continue}}
      if(secondBoard&&!firstBoard){const landing=spareStripLanding(second,first);if(landing){emitWire(`${id}-1`,first,landing);continue}const breakout=endpoints.length>2?nearbyJunctionBreakout(second,first):undefined;if(breakout){emitWire(`${id}-jump`,second,breakout.jump);emitWire(`${id}-1`,first,breakout.landing);continue}}
    }
    if(reps.length>2){
      const hubCandidates=reps.filter(endpoint=>Boolean(boardOfEndpoint(endpoint))&&Boolean(endpointPoint(endpoint,all)));
      const hub=hubCandidates.sort((a,b)=>{
        const ap=endpointPoint(a,all)!,bp=endpointPoint(b,all)!;
        const cost=(point:{x:number;y:number})=>reps.reduce((sum,endpoint)=>{const target=endpointPoint(endpoint,all);return sum+(target?Math.abs(point.x-target.x)+Math.abs(point.y-target.y):0)},0);
        return cost(ap)-cost(bp);
      })[0];
      if(hub){
        const parsed=endpointParts(hub),part=partById.get(parsed?.partId??'');
        const hubHole=parsed&&part?.seating?part.seating.pins[parsed.pinName]:undefined;
        const boardId=part?.seating?.breadboardId,hubNet=hubHole?breadboardHoleNet(hubHole):undefined;
        if(boardId&&hubHole&&hubNet){
          const column=/([0-9]+)$/.exec(hubHole)?.[1],upper='ABCDE'.includes(hubHole[0].toUpperCase());
          const occupied=new Set<string>();
          for(const p of all)if(p.seating?.breadboardId===boardId)for(const hole of Object.values(p.seating.pins))occupied.add(hole);
          const rowPool=upper?['A','B','C','D','E']:['F','G','H','I','J'];
const access=(column?rowPool.map(row=>`${row}${column}`):[]).filter(hole=>{
            if(breadboardHoleNet(hole)!==hubNet||occupied.has(hole))return false;
            const point=endpointPoint(`${boardId}:${hole}`,all);if(!point)return false;
            return !all.some(p=>p.seating?.breadboardId===boardId&&(()=>{const r=partRect(p),margin=ACCESS_CLEARANCE;return point.x>=r.x-margin&&point.x<=r.x+r.width+margin&&point.y>=r.y-margin&&point.y<=r.y+r.height+margin})());
          });
          const targets=reps.filter(endpoint=>endpoint!==hub);
          if(access.length>=targets.length){
            for(const [index,target] of targets.entries())emitWire(`${id}-${index+1}`,`${boardId}:${access[index]}`,target);
            continue;
          }          const junction=freeSignalJunction(reps,boardId);
          if(junction){for(const [index,branch] of junction.entries())emitWire(`${id}-junction-${index+1}`,branch.endpoint,branch.landing);continue}
        }
      }
    }
    if(reps.length>1){const root=reps[0];for(const [index,target] of reps.slice(1).entries())emitWire(`${id}-${index+1}`,root,target)}  }
  if(design.code.length>1)throw new Error('The production harness currently supports one Arduino sketch');const code=design.code[0];
  return {program:lines.join('\n'),...(code?{codeBoardId:code.boardId,code:code.text}:{}),autoBoard:boardPlan.auto,autoBoards:boardPlan.auto?boards.map(b=>b.id):[],autoSeated:mounts.filter(p=>!p.seat).map(p=>p.id),autoPlaced:[...controllers.parts,...external.placed].filter(p=>!design.parts.find(s=>s.id===p.id)?.place).map(p=>p.id),composition:{stages:design.stages,flows:design.flows,boardWindows,connectorAlignments:controllers.alignments}};
}

function review(){const state=circuitStore.getSnapshot(),quality=evaluateLayout(state);let length=0,bends=0,reversals=0;for(const wire of state.connections){const start=endpointPoint(wire.from,state.parts),end=endpointPoint(wire.to,state.parts);if(!start||!end)continue;const points=connectionPolyline(start,wire.waypoints,end),xs:number[]=[],ys:number[]=[];for(let i=0;i<points.length-1;i++){const dx=points[i+1].x-points[i].x,dy=points[i+1].y-points[i].y;length+=Math.abs(dx)+Math.abs(dy);if(Math.abs(dx)>.02)xs.push(Math.sign(dx));if(Math.abs(dy)>.02)ys.push(Math.sign(dy))}bends+=Math.max(0,points.length-2);if(xs.some((v,i)=>i>0&&v!==xs[i-1]))reversals++;if(ys.some((v,i)=>i>0&&v!==ys[i-1]))reversals++}
  const crossings=quality.issues.filter(i=>i.kind==='wire-crossing').length,wireOverlaps=quality.issues.filter(i=>i.kind==='wire-overlap').length,hits=quality.issues.filter(i=>i.kind==='wire-through-part'||i.kind==='wire-through-board').length;const score=Math.round((quality.score*100-length*.08-bends*10-reversals*65-crossings*120-wireOverlaps*100-hits*180)*10)/10;return {score,layoutScore:quality.score,wireLengthPx:Math.round(length),bends,reversals,crossings,overlaps:wireOverlaps,componentHits:hits,issues:quality.issues}}

function compositionReview(design:SemanticDesign,plan:Plan,base:ReturnType<typeof review>){
  const state=circuitStore.getSnapshot(),partById=new Map(state.parts.map(part=>[part.id,part]));
  const composition=compositionOf(design);
  const unionBounds=(ids:string[])=>{
    const rects=ids.map(id=>partById.get(id)).filter((part):part is CircuitPart=>Boolean(part)).map(partRect);
    if(!rects.length)return undefined;
    const minX=Math.min(...rects.map(rect=>rect.x)),minY=Math.min(...rects.map(rect=>rect.y));
    const maxX=Math.max(...rects.map(rect=>rect.x+rect.width)),maxY=Math.max(...rects.map(rect=>rect.y+rect.height));
    return {x:minX,y:minY,width:maxX-minX,height:maxY-minY,center:{x:(minX+maxX)/2,y:(minY+maxY)/2}};
  };
  const refBounds=(ref:string)=>{
    const stage=composition.stages.get(ref);return stage?unionBounds(stage.members):unionBounds([ref]);
  };
  const stages=design.stages.map(stage=>{
    const bounds=unionBounds(stage.members),centers=stage.members.map(id=>partById.get(id)).filter((part):part is CircuitPart=>Boolean(part)).map(part=>{const rect=partRect(part);return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}});
    const meanDistancePx=bounds&&centers.length?centers.reduce((sum,center)=>sum+Math.abs(center.x-bounds.center.x)+Math.abs(center.y-bounds.center.y),0)/centers.length:0;
    return {stageId:stage.id,members:stage.members,...(bounds?{bounds:{x:Math.round(bounds.x),y:Math.round(bounds.y),width:Math.round(bounds.width),height:Math.round(bounds.height)},meanDistancePx:Math.round(meanDistancePx)}:{missing:true})};
  });
  const flows=design.flows.map(flow=>{
    const points=flow.refs.map(ref=>({ref,bounds:refBounds(ref)})).filter((item):item is {ref:string;bounds:NonNullable<ReturnType<typeof refBounds>>}=>Boolean(item.bounds));
    if(points.length<2)return {refs:flow.refs,missingRefs:flow.refs.filter(ref=>!refBounds(ref)),violations:0};
    const first=points[0].bounds.center,last=points[points.length-1].bounds.center,axis: 'x'|'y'=Math.abs(last.x-first.x)>=Math.abs(last.y-first.y)?'x':'y';
    const sign=(last[axis]-first[axis])>=0?1:-1;let violations=0,minProgressPx=Number.POSITIVE_INFINITY;
    for(let index=0;index<points.length-1;index++){
      const progress=(points[index+1].bounds.center[axis]-points[index].bounds.center[axis])*sign;
      minProgressPx=Math.min(minProgressPx,progress);if(progress<-BREADBOARD_HOLE_PITCH*.5)violations++;
    }
    return {refs:flow.refs,axis,direction:sign>0?'positive':'negative',violations,minProgressPx:Math.round(Number.isFinite(minProgressPx)?minProgressPx:0)};
  });
  const gapsByBoard=Array.from(new Set(plan.composition.boardWindows.map(window=>window.boardId))).map(boardId=>{
    const windows=plan.composition.boardWindows.filter(window=>window.boardId===boardId&&window.stageId).sort((a,b)=>a.min-b.min);
    const gaps=windows.slice(0,-1).map((window,index)=>windows[index+1].min-window.max-1);
    return {boardId,stageWindows:windows.map(window=>({stageId:window.stageId,min:window.min,max:window.max})),minStageGapColumns:gaps.length?Math.min(...gaps):undefined};
  }).filter(entry=>entry.stageWindows.length>0);

  const boards=state.parts.filter(part=>isBreadboardType(part.type));let boardRouteLength=0,centerRouteLength=0;
  for(const wire of state.connections){
    const start=endpointPoint(wire.from,state.parts),end=endpointPoint(wire.to,state.parts);if(!start||!end)continue;
    const points=connectionPolyline(start,wire.waypoints,end);
    for(let index=0;index<points.length-1;index++){
      const a=points[index],b=points[index+1],length=Math.abs(b.x-a.x)+Math.abs(b.y-a.y);if(length<.01)continue;
      const midpoint={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
      for(const board of boards){
        const rect=partRect(board),pad=BREADBOARD_HOLE_PITCH*2;
        if(midpoint.x<rect.x-pad||midpoint.x>rect.x+rect.width+pad||midpoint.y<rect.y-pad||midpoint.y>rect.y+rect.height+pad)continue;
        boardRouteLength+=length;
        const centerLeft=rect.x+rect.width*.3,centerRight=rect.x+rect.width*.7;
        if(midpoint.x>=centerLeft&&midpoint.x<=centerRight&&midpoint.y>=rect.y-pad&&midpoint.y<=rect.y+rect.height+pad)centerRouteLength+=length;
        break;
      }
    }
  }
  const crossingIssues=base.issues.filter(issue=>issue.kind==='wire-crossing');
  const sourceFeedCrossings=crossingIssues.filter(issue=>issue.itemIds.some(id=>/-feed$|-backbone$/.test(id))).length;
  const busFeedCrossings=crossingIssues.filter(issue=>issue.itemIds.some(id=>/-tap-|-trunk-/.test(id))&&issue.itemIds.some(id=>/-feed$|-backbone$/.test(id))).length;
  const connectorIssues=base.issues.filter(issue=>issue.kind==='connector-facing-away'||issue.kind==='flexible-bundle-facing-away'||issue.kind==='user-facing-orientation').length;
  const railIssues=base.issues.filter(issue=>issue.kind==='perimeter-rail-detour'||issue.kind==='same-column-rail-congestion'||issue.kind==='split-source-cable').length;
  return {
    explicitStages:stages,
    flows,
    boardStageWindows:gapsByBoard,
    flowViolations:flows.reduce((sum,flow)=>sum+flow.violations,0),
    centerRoutingFraction:boardRouteLength?Math.round(centerRouteLength/boardRouteLength*1000)/1000:0,
    sourceFeedCrossings,busFeedCrossings,connectorIssues,railIssues,
    routeReversals:base.reversals,
  };
}
async function buildPlan(plan:Plan,design:SemanticDesign,signal:AbortSignal){await buildTool.execute({replace:true,program:plan.program,suggestPlacement:false,...(plan.code?{boardId:plan.codeBoardId,code:plan.code}:{})},{signal});const base=review();return {review:base,composition:compositionReview(design,plan,base),diagnostics:diagnoseCircuit(circuitStore.getSnapshot())}}
type BuiltAttempt = { bias:'upper'|'lower'; variant:number; plan:Plan; review:ReturnType<typeof review>; composition:ReturnType<typeof compositionReview>; diagnostics:ReturnType<typeof diagnoseCircuit> };
function structuralVector(attempt:BuiltAttempt){return [attempt.diagnostics.length,attempt.review.componentHits,attempt.review.overlaps,attempt.composition.connectorIssues,attempt.composition.railIssues,attempt.composition.flowViolations,attempt.composition.sourceFeedCrossings,attempt.composition.busFeedCrossings,attempt.review.crossings]}
function structurallyDominates(a:BuiltAttempt,b:BuiltAttempt){
  // Placement is only a hypothesis. Judge it after exact physicalization and
  // routing, but do not invent a priority order between different defect
  // classes. One routed result may displace another only when it is no worse
  // on every structural/electrical defect and strictly better on at least one.
  const av=structuralVector(a),bv=structuralVector(b);let better=false;
  for(let index=0;index<av.length;index++){if(av[index]>bv[index])return false;if(av[index]<bv[index])better=true}
  return better;
}
export const SEMANTIC_AGENT_GUIDANCE=`Design before physicalizing. First decide electrical topology and component values, then functional groups, then whether one half board, full board, or multiple boards makes the clearest build. Use stage(id,...parts) for one real physical/functional subsystem. Include local companion parts that implement the same function, such as an LED with its series resistor or a transistor switch with its base resistor and flyback diode. Use flow(...partsOrStages) only for genuine visible source -> stage -> load progression. Devices that are peers on one shared bus are parallel, not a serial flow: put the peer devices in one bus stage and give unrelated branches their own flow. When several external peers belong to that bus stage, normally anchor them to the same functional board or board edge rather than chaining near(peer,peer) just to impose order. These are macro composition declarations, not coordinate hints. Prefer them over long chains of near() calls when the circuit has several functional blocks. Use the smallest substrate that still leaves obvious functional zones; if board size is not itself an intentional design choice, omit the breadboard and let the physicalizer choose it. Split only when one board would genuinely make the paths harder to trace. Use build-circuit planOnly before the first final build and resolve any compositionCheck advice before building.

Think in visible flows, not coordinates. A good render should let a person trace source -> distribution -> load for each power domain, controller -> control element -> load for each signal chain, and every common return without mentally reconstructing hidden topology. Rails are distribution backbones, so feed and branch from them in a direction that reads naturally. Leave whitespace between stages and prefer straight drops or simple L paths when they expose the connection clearly; an extra bend is justified when it keeps a connector visible or avoids hiding a junction.

External parts are physical objects, not rectangles. Keep handheld/user-facing accessories in their natural usable orientation and put wireless accessories in unused side space rather than a wiring corridor. For batteries, motors, and other flexible-lead parts, let the connector bundle face its functional stage so the leads leave naturally instead of making a hairpin over the part body. Do not add rotate() merely to pack the scene more tightly; omit it unless the orientation is a real high-level decision and let the compiler choose the cable-facing orientation.

The compiler owns exact holes, safe rail allocation, local junctions, standard wire presentation, collision avoidance, and orthogonal routing. You own topology, component choice, board count, functional grouping, meaningful near() relationships, intentional orientation overrides, and controller GPIO assignment. Treat interchangeable GPIO choice as part of composition: choose pins whose visible fan-out does not interleave unrelated stages.

After every build, inspect the actual render. Ignore a high layout score if the picture is confusing. Specifically challenge: (1) whether each external object is usable and its leads face the circuit, (2) whether 5V/other supply/common-ground paths visibly read as coherent distribution, (3) whether each serial chain reads in order, (4) whether any stage is cramped while nearby space is wasted, and (5) whether any bend, perimeter run, reversal, or crossing exists without a visible reason. Fix the high-level near()/rotate()/board/GPIO decision that caused the problem. Only use place() or seat() when semantic layout truly cannot express a necessary physical choice; never hand-route wires.`;

export function createSemanticCircuitTool():ToolDefinition {
  return {
    name:'build-circuit',
    description:`Production semantic circuit builder. Write ordinary JavaScript that describes electrical intent and high-level composition, not exact geometry. If you omit breadboards the compiler chooses a sensible substrate. You may explicitly choose/mount functional groups when board count is itself a design decision. The compiler owns exact breadboard holes, safe rails, local junctions, default external-part orientation, collision avoidance, exact pin geometry, orthogonal routing, and wire presentation. The model owns topology, stage grouping, board choice, semantic near() relationships, intentional orientation overrides, and GPIO assignment. Use the rendered workbench as visual feedback after every build.\n\nScript API:\n- const x = part(id,type,attrs?)\n- x.pin(name)\n- connect(a,b,{id?,role?}) or wire(...)\n- net(id,...pins) for a shared signal node\n- power(source,...consumers), ground(source,...consumers)\n- stage(id,...parts) declares one complete functional subsystem; include local companion passives\n- flow(...partsOrStages) declares genuine visible source -> stage -> load order without coordinates; do not serialize parallel peers on one shared bus\n- code(board, completeArduinoSketch)\n- near(part,anchor,"left|right|above|below") for a real local relationship\n- rotate(part,0|90|180|270) only for an intentional high-level orientation\n- mount(part,board) chooses the breadboard for a mounted component when using multiple boards\n- place(part,x,y,rotate?) coarse-cell escape hatch\n- seat(part,board,pin,hole) breadboard escape hatch\n\nExpress topology first and plan before final build. A shared bus such as I2C is one parallel functional group, e.g. const i2cStage=stage("i2c-devices",imu,rtc,oled); flow(uno,i2cStage). Put a status LED and its resistor in a separate status stage/branch. For multiple external peers on that bus, normally relate each peer to the same functional board/edge rather than making a fake peer-to-peer near chain. Use stage()/flow() when there are multiple functional blocks instead of encoding the whole composition as pairwise near() calls. If board size is not a real design decision, omit the board and let the compiler pick the smallest suitable substrate. Resolve compositionCheck advice before accepting a plan. Do not rotate a remote, battery, motor, display, or other peripheral merely to make it fit; the compiler can orient user-facing objects and flexible lead bundles. After building, inspect the PNG and revise the semantic decision that caused any confusing flow. A clean build should visibly tell the source/distribution/load story, keep external objects usable, keep functional stages separated but related, and use bends only when they improve visibility or avoid a real obstacle. Never manually route wires.`,
    inputSchema:{type:'object',properties:{script:{type:'string',description:'JavaScript using the semantic circuit helpers. Loops, arrays, variables, and helper functions are allowed.'},planOnly:{type:'boolean',description:'Compile semantic placement and board choices without mutating the workbench.'}},required:['script']},
    async execute(input,options){
      const script=requireString(input.script,'script'),design=normalize(await runScript(script));if(!design.parts.length)throw new Error('Circuit script created no parts');const advice=compositionAdvice(design);const compositionCheck={status:advice.length?'revise-semantic-model':'ready',advice};if(input.planOnly===true){const plans=(['upper','lower'] as const).map(bias=>({bias,plan:compile(design,bias)}));return toolResult({harness:'semantic-flow-js-v1',planOnly:true,compositionCheck,plans})}const before=structuredClone(circuitStore.getSnapshot()),attempts:BuiltAttempt[]=[],errors:string[]=[];
for(const bias of ['upper','lower'] as const)for(const variant of [0,1]){try{const plan=compile(design,bias,variant),result=await buildPlan(plan,design,options.signal);attempts.push({bias,variant,plan,...result})}catch(error){errors.push(`${bias}/v${variant}: ${error instanceof Error?error.message:String(error)}`);circuitStore.replaceDocument({parts:before.parts,connections:before.connections})}}
      if(!attempts.length){circuitStore.replaceDocument({parts:before.parts,connections:before.connections});throw new Error(`Semantic compiler could not build the scene. ${errors.join(' | ')}`)}
      const frontier=attempts.filter(candidate=>!attempts.some(other=>other!==candidate&&structurallyDominates(other,candidate)));
      frontier.sort((a,b)=>b.review.score-a.review.score);const best=frontier[0],rebuilt=await buildPlan(best.plan,design,options.signal),state=circuitStore.getSnapshot(),final=rebuilt.review;
 return toolResult({harness:'semantic-flow-js-v1',selectedVariant:`${best.bias}/v${best.variant}`,variantsTried:attempts.map(a=>({bias:a.bias,variant:a.variant,diagnostics:a.diagnostics.length,componentHits:a.review.componentHits,overlaps:a.review.overlaps,connectorIssues:a.composition.connectorIssues,railIssues:a.composition.railIssues,flowViolations:a.composition.flowViolations,sourceFeedCrossings:a.composition.sourceFeedCrossings,busFeedCrossings:a.composition.busFeedCrossings,crossings:a.review.crossings,score:a.review.score,centerRoutingFraction:a.composition.centerRoutingFraction})),auto:{board:best.plan.autoBoard,seated:best.plan.autoSeated,placed:best.plan.autoPlaced},compositionCheck,compositionPlan:best.plan.composition,visualComposition:rebuilt.composition,review:final,diagnostics:rebuilt.diagnostics,parts:state.parts.map(p=>({id:p.id,type:p.type,rotate:p.rotate??0,...(p.seating?{seating:p.seating}:{at:partBlockAt(p)})})),wires:state.connections.length,visualChecks:[
   'Open the rendered PNG. Do not accept the build from layout score alone.',
   'Resolve compositionCheck advice before accepting the scene; do not use routing tweaks to hide a wrong functional model.',
   'Check every handheld/user-facing accessory is oriented naturally and kept out of the main wiring corridor.',
   'Trace each positive supply from source to rail/distribution to loads, then trace the common return. The visible path should read continuously.',
   'Trace each controller signal through its local stage to the load. Serial chains should read in physical order without unexplained reversals.',
   'Check batteries, motors, and other flexible-lead parts have their connector bundle facing the stage and do not make hairpins across their own bodies.',
   'Look for cramped stages beside unused space, unnecessary perimeter runs, hidden junctions, crossings, overlaps, and bends that do not improve readability.',
   'If any check fails, revise board choice, near(), intentional rotate(), grouping, or interchangeable GPIOs. Do not hand-route or micro-seat to cosmetically hide the problem.'
 ],visualInstruction:advice.length?'The semantic composition still has structural advice. Fix compositionCheck first, then inspect the rendered workbench. Do not accept a technically correct scene whose grouping, flow, or substrate choice is conceptually wrong.':'Inspect the rendered workbench now and revise the high-level composition if any visual check fails. A technically correct circuit that looks electrically confusing is not finished.'});
    }
  };
}
