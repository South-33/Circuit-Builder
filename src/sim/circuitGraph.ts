import type { CircuitConnection, CircuitDocument, CircuitPart } from '../circuit/types';
import { getBreadboardGeometry, isBreadboardType } from '../breadboard/geometry';
import { classifyArduinoPowerPin } from './pins';

export type GraphEdge = {
  to: string;
  kind: 'wire' | 'breadboard' | 'seat' | 'resistor';
  itemId?: string;
};

export type TraceResult = {
  node: string;
  part: CircuitPart;
  pin: string;
  resistance: number;
  resistorIds: string[];
  connectionIds: string[];
};

export type CircuitGraph = {
  adjacency: Map<string, GraphEdge[]>;
  parts: Map<string, CircuitPart>;
  connections: Map<string, CircuitConnection>;
};

export function nodeRef(partId: string, pin: string) {
  return `${partId}:${pin}`;
}

export function parseNodeRef(node: string) {
  const colon = node.indexOf(':');
  return {
    partId: colon === -1 ? node : node.slice(0, colon),
    pin: colon === -1 ? '' : node.slice(colon + 1),
  };
}

function addEdge(graph: CircuitGraph, from: string, edge: GraphEdge) {
  const list = graph.adjacency.get(from) ?? [];
  list.push(edge);
  graph.adjacency.set(from, list);
}

function connect(
  graph: CircuitGraph,
  from: string,
  to: string,
  kind: GraphEdge['kind'],
  itemId?: string,
) {
  addEdge(graph, from, { to, kind, itemId });
  addEdge(graph, to, { to: from, kind, itemId });
}

function addBreadboardEdges(graph: CircuitGraph, breadboard: CircuitPart) {
  const id = breadboard.id;
  const geometry = getBreadboardGeometry(breadboard.type);
  if (!geometry) return;
  for (let column = 1; column <= geometry.columns; column++) {
    const left = ['A', 'B', 'C', 'D', 'E'].map((row) => nodeRef(id, `${row}${column}`));
    const right = ['F', 'G', 'H', 'I', 'J'].map((row) => nodeRef(id, `${row}${column}`));
    for (let index = 1; index < left.length; index++) connect(graph, left[0], left[index], 'breadboard', id);
    for (let index = 1; index < right.length; index++) connect(graph, right[0], right[index], 'breadboard', id);
  }

  for (const rail of ['+top', '-top', '+bottom', '-bottom']) {
    const first = nodeRef(id, `${rail}1`);
    for (let column = 2; column <= geometry.railHoles; column++) {
      connect(graph, first, nodeRef(id, `${rail}${column}`), 'breadboard', id);
    }
  }
}

export function buildCircuitGraph(document: Pick<CircuitDocument, 'parts' | 'connections'>): CircuitGraph {
  const graph: CircuitGraph = {
    adjacency: new Map(),
    parts: new Map(document.parts.map((part) => [part.id, part])),
    connections: new Map(document.connections.map((connection) => [connection.id, connection])),
  };

  for (const connection of document.connections) {
    connect(graph, connection.from, connection.to, 'wire', connection.id);
  }

  for (const part of document.parts) {
    if (isBreadboardType(part.type)) addBreadboardEdges(graph, part);
    if (part.type === 'wokwi-resistor') connect(graph, nodeRef(part.id, '1'), nodeRef(part.id, '2'), 'resistor', part.id);
    if (part.seating) {
      for (const [pin, hole] of Object.entries(part.seating.pins)) {
        connect(graph, nodeRef(part.id, pin), nodeRef(part.seating.breadboardId, hole), 'seat', part.id);
      }
    }
  }

  return graph;
}

function resistorValue(part: CircuitPart | undefined) {
  if (!part || part.type !== 'wokwi-resistor') return 0;
  const raw = part.attrs.value;
  const value = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? '220'));
  return Number.isFinite(value) && value > 0 ? value : 220;
}

export function traceFrom(
  graph: CircuitGraph,
  startNode: string,
  predicate: (part: CircuitPart, pin: string) => boolean,
  maxDepth = 80,
): TraceResult[] {
  type QueueItem = {
    node: string;
    depth: number;
    resistance: number;
    resistorIds: string[];
    connectionIds: string[];
  };
  const queue: QueueItem[] = [{ node: startNode, depth: 0, resistance: 0, resistorIds: [], connectionIds: [] }];
  const bestResistance = new Map<string, number>();
  const results: TraceResult[] = [];

  while (queue.length) {
    const current = queue.shift()!;
    if (current.depth > maxDepth) continue;
    const previousBest = bestResistance.get(current.node);
    if (previousBest !== undefined && previousBest <= current.resistance) continue;
    bestResistance.set(current.node, current.resistance);

    if (current.node !== startNode) {
      const { partId, pin } = parseNodeRef(current.node);
      const part = graph.parts.get(partId);
      if (part && predicate(part, pin)) {
        results.push({
          node: current.node,
          part,
          pin,
          resistance: current.resistance,
          resistorIds: current.resistorIds,
          connectionIds: current.connectionIds,
        });
        continue;
      }
    }

    for (const edge of graph.adjacency.get(current.node) ?? []) {
      const resistor = edge.kind === 'resistor' ? graph.parts.get(edge.itemId ?? '') : undefined;
      queue.push({
        node: edge.to,
        depth: current.depth + 1,
        resistance: current.resistance + resistorValue(resistor),
        resistorIds: edge.kind === 'resistor' && edge.itemId
          ? [...current.resistorIds, edge.itemId]
          : current.resistorIds,
        connectionIds: edge.kind === 'wire' && edge.itemId
          ? [...current.connectionIds, edge.itemId]
          : current.connectionIds,
      });
    }
  }

  return results;
}

export function traceToArduinoPin(graph: CircuitGraph, startNode: string) {
  return traceFrom(graph, startNode, (part, pin) =>
    part.type === 'wokwi-arduino-uno'
    && classifyArduinoPowerPin(pin) === null
    && (/^\d+$/.test(pin) || /^A[0-5]$/i.test(pin)),
  );
}

export function traceToPower(graph: CircuitGraph, startNode: string) {
  return traceFrom(graph, startNode, (part, pin) =>
    part.type === 'wokwi-arduino-uno' && classifyArduinoPowerPin(pin) !== null,
  );
}

export function directlyConnectedNodes(graph: CircuitGraph, startNode: string) {
  const queue = [startNode];
  const visited = new Set<string>();
  while (queue.length) {
    const node = queue.shift()!;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const edge of graph.adjacency.get(node) ?? []) {
      if (edge.kind === 'resistor') continue;
      if (!visited.has(edge.to)) queue.push(edge.to);
    }
  }
  return visited;
}

