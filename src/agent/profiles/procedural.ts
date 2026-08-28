import { circuitStore } from '../../circuit/store';
import type { PartType } from '../../circuit/types';
import { agentPartTypeEnum, applyArduinoCode, connectionFromInput, parseAttrs, requireGridPoint, requireId, requirePartType, requireString } from '../core/actions';
import { gridCenterPlacement, normalizeRightAngle, partCenterGrid } from '../core/grid';
import { toolResult } from '../core/protocol';
import { buildMutationSummary } from '../core/summary';
import type { ToolDefinition } from '../types';

function currentType(id: string): PartType {
  const part = circuitStore.getSnapshot().parts.find((candidate) => candidate.id === id);
  if (!part) throw new Error(`Part "${id}" does not exist.`);
  return part.type;
}

export function createProceduralHarnessTool(): ToolDefinition {
  return {
    name: 'build-circuit',
    description: 'Harness A, procedural grid. Build like MineBench with a small ordered operation language. All x/y coordinates are integer grid cells centered on workbench (0,0), and component coordinates mean component centers. You own placement, rotation, and wire path geometry. Plan the complete scene first and batch the initial placement, wiring, and code into one call when possible. Use role=power/ground/signal and normally omit color: supply/ground colors are standardized automatically. Route from each pin outward before turning, prefer monotonic source-to-destination paths, and use adjacent separate lanes instead of crossings or overlap.',
    inputSchema: {
      type: 'object',
      properties: {
        replace: { type: 'boolean', description: 'Clear the workbench first.' },
        boardId: { type: 'string', description: 'Optional Arduino board ID when supplying code. Defaults to the first Arduino Uno.' },
        code: { type: 'string', description: 'Optional complete Arduino sketch to set in this same build call.' },
        operations: {
          type: 'array',
          description: 'Ordered operations. Use stable IDs so later operations can refer to earlier parts.',
          items: {
            type: 'object',
            properties: {
              op: { type: 'string', enum: ['place', 'move', 'rotate', 'seat', 'connect', 'remove-part', 'remove-wire'] },
              id: { type: 'string' },
              type: { type: 'string', enum: agentPartTypeEnum, description: 'Agent-facing component type ID. Use one of these exact values.' },
              center: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
              rotate: { type: 'number', description: 'Right-angle rotation. Values snap to 0/90/180/270.' },
              attrs: { type: 'object' },
              breadboardId: { type: 'string' },
              pin: { type: 'string' },
              hole: { type: 'string' },
              from: { type: 'string' },
              to: { type: 'string' },
              role: { type: 'string', enum: ['signal', 'power', 'ground'] },
              color: { type: 'string' },
              via: {
                type: 'array',
                description: 'Optional grid turn points for the wire. Consecutive points must share x or y.',
                items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
              },
            },
            required: ['op'],
          },
        },
      },
      required: ['operations'],
    },
    async execute(input) {
      if (input.replace === true) circuitStore.replaceDocument({ parts: [], connections: [] });
      const operations = Array.isArray(input.operations) ? input.operations : [];
      const changed: string[] = [];

      for (let index = 0; index < operations.length; index++) {
        const raw = operations[index];
        if (!raw || typeof raw !== 'object') throw new Error(`operations[${index}] must be an object.`);
        const operation = raw as Record<string, unknown>;
        const op = requireString(operation.op, `operations[${index}].op`);

        if (op === 'place') {
          const id = requireId(operation.id, `operations[${index}].id`);
          const type = requirePartType(operation.type, `operations[${index}].type`);
          const center = requireGridPoint(operation.center, `operations[${index}].center`);
          const rotation = normalizeRightAngle(typeof operation.rotate === 'number' ? operation.rotate : 0);
          const placement = gridCenterPlacement(type, center, rotation);
          circuitStore.applyParts([{
            id,
            type,
            ...placement,
            rotate: rotation,
            ...(parseAttrs(operation.attrs) ? { attrs: parseAttrs(operation.attrs) } : {}),
          }]);
          changed.push(id);
          continue;
        }

        if (op === 'move') {
          const id = requireId(operation.id, `operations[${index}].id`);
          const type = currentType(id);
          const center = requireGridPoint(operation.center, `operations[${index}].center`);
          const existingRotation = circuitStore.getSnapshot().parts.find((part) => part.id === id)?.rotate ?? 0;
          circuitStore.applyParts([{ id, type, ...gridCenterPlacement(type, center, existingRotation) }]);
          changed.push(id);
          continue;
        }

        if (op === 'rotate') {
          const id = requireId(operation.id, `operations[${index}].id`);
          const type = currentType(id);
          if (typeof operation.rotate !== 'number') throw new Error(`operations[${index}].rotate must be a number.`);
          const existing = circuitStore.getSnapshot().parts.find((part) => part.id === id)!;
          const center = partCenterGrid(existing);
          circuitStore.applyParts([{
            id,
            type,
            ...gridCenterPlacement(type, center, normalizeRightAngle(operation.rotate)),
            rotate: normalizeRightAngle(operation.rotate),
          }]);
          changed.push(id);
          continue;
        }

        if (op === 'seat') {
          const id = requireId(operation.id, `operations[${index}].id`);
          const existing = circuitStore.getSnapshot().parts.find((part) => part.id === id);
          const type = existing?.type ?? requirePartType(operation.type, `operations[${index}].type`);
          circuitStore.applyParts([{
            id,
            type,
            seat: {
              breadboardId: requireString(operation.breadboardId, `operations[${index}].breadboardId`),
              pin: requireString(operation.pin, `operations[${index}].pin`),
              hole: requireString(operation.hole, `operations[${index}].hole`),
            },
            ...(parseAttrs(operation.attrs) ? { attrs: parseAttrs(operation.attrs) } : {}),
          }]);
          changed.push(id);
          continue;
        }

        if (op === 'connect') {
          const connection = connectionFromInput({ ...operation, path: operation.via }, 'path', true);
          const [wire] = circuitStore.applyConnections([connection]);
          changed.push(wire.id);
          continue;
        }

        if (op === 'remove-part') {
          const id = requireId(operation.id, `operations[${index}].id`);
          circuitStore.removePart(id);
          changed.push(id);
          continue;
        }

        if (op === 'remove-wire') {
          const id = requireId(operation.id, `operations[${index}].id`);
          circuitStore.removeConnection(id);
          changed.push(id);
          continue;
        }

        throw new Error(`Unsupported procedural op "${op}".`);
      }

      const boardId = applyArduinoCode(input);

      const state = circuitStore.getSnapshot();
      return toolResult({ harness: 'a', changed, ...(boardId ? { codeBoardId: boardId } : {}), ...buildMutationSummary(state) });
    },
  };
}
