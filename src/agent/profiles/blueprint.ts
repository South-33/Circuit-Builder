import { circuitStore } from '../../circuit/store';
import type { PartAttrs, PartType } from '../../circuit/types';
import { agentPartTypeEnum, applyArduinoCode, connectionFromInput, parseAttrs, requireGridPoint, requireId, requirePartType, requireString } from '../core/actions';
import { gridCenterPlacement, normalizeRightAngle } from '../core/grid';
import { toolResult } from '../core/protocol';
import { buildMutationSummary } from '../core/summary';
import type { ToolDefinition } from '../types';

type BlueprintPart = {
  id: string;
  type: PartType;
  center?: { x: number; y: number };
  rotate: number;
  attrs?: PartAttrs;
  seat?: { breadboardId: string; pin: string; hole: string };
};

function parsePart(raw: unknown, index: number): BlueprintPart {
  if (!raw || typeof raw !== 'object') throw new Error(`parts[${index}] must be an object.`);
  const value = raw as Record<string, unknown>;
  const id = requireId(value.id, `parts[${index}].id`);
  const type = requirePartType(value.type, `parts[${index}].type`);
  const seatRaw = value.seat && typeof value.seat === 'object' ? value.seat as Record<string, unknown> : null;
  const seat = seatRaw ? {
    breadboardId: requireString(seatRaw.breadboardId, `parts[${index}].seat.breadboardId`),
    pin: requireString(seatRaw.pin, `parts[${index}].seat.pin`),
    hole: requireString(seatRaw.hole, `parts[${index}].seat.hole`),
  } : undefined;
  if (!seat && value.center === undefined) throw new Error(`parts[${index}] needs center or seat.`);
  return {
    id,
    type,
    ...(value.center !== undefined ? { center: requireGridPoint(value.center, `parts[${index}].center`) } : {}),
    rotate: normalizeRightAngle(typeof value.rotate === 'number' ? value.rotate : 0),
    ...(parseAttrs(value.attrs) ? { attrs: parseAttrs(value.attrs) } : {}),
    ...(seat ? { seat } : {}),
  };
}

export function createBlueprintHarnessTool(): ToolDefinition {
  return {
    name: 'build-circuit',
    description: 'Harness B, holistic blueprint grid. Submit the whole 2D scene as exact snapped component centers plus exact orthogonal wire paths. Grid (0,0) is workbench center. Plan the complete scene before submitting it and include code in the same call when possible. Use role=power/ground/signal and normally omit color: supply/ground colors are standardized automatically. Route from pins outward before turning, prefer monotonic source-to-destination travel, and use adjacent separate lanes instead of crossings or overlap. This harness intentionally does not solve placement or routing for you.',
    inputSchema: {
      type: 'object',
      properties: {
        replace: { type: 'boolean', description: 'Defaults to true. Set false only when intentionally patching an existing blueprint.' },
        boardId: { type: 'string', description: 'Optional Arduino board ID when supplying code. Defaults to the first Arduino Uno.' },
        code: { type: 'string', description: 'Optional complete Arduino sketch to set in this same blueprint call.' },
        parts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              type: { type: 'string', enum: agentPartTypeEnum, description: 'Agent-facing component type ID. Use one of these exact values.' },
              center: {
                type: 'object',
                description: 'Exact component center in integer grid cells.',
                properties: { x: { type: 'number' }, y: { type: 'number' } },
                required: ['x', 'y'],
              },
              rotate: { type: 'number', description: 'Right-angle rotation. Snaps to 0/90/180/270.' },
              attrs: { type: 'object' },
              seat: {
                type: 'object',
                description: 'For breadboard-mounted parts, seat by physical hole instead of center.',
                properties: { breadboardId: { type: 'string' }, pin: { type: 'string' }, hole: { type: 'string' } },
                required: ['breadboardId', 'pin', 'hole'],
              },
            },
            required: ['id', 'type'],
          },
        },
        connections: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              from: { type: 'string' },
              to: { type: 'string' },
              role: { type: 'string', enum: ['signal', 'power', 'ground'] },
              color: { type: 'string' },
              path: {
                type: 'array',
                description: 'Exact grid turn/anchor cells. Consecutive points must share x or y.',
                items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
              },
            },
            required: ['from', 'to'],
          },
        },
        removePartIds: { type: 'array', items: { type: 'string' } },
        removeConnectionIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['parts', 'connections'],
    },
    async execute(input) {
      const replace = input.replace !== false;
      if (replace) circuitStore.replaceDocument({ parts: [], connections: [] });
      const parts = (Array.isArray(input.parts) ? input.parts : []).map(parsePart);
      const normal = parts.filter((part) => !part.seat);
      const seated = parts.filter((part) => part.seat);

      if (normal.length) {
        circuitStore.applyParts(normal.map((part) => ({
          id: part.id,
          type: part.type,
          ...gridCenterPlacement(part.type, part.center!, part.rotate),
          rotate: part.rotate,
          ...(part.attrs ? { attrs: part.attrs } : {}),
        })));
      }
      for (const part of seated) {
        circuitStore.applyParts([{
          id: part.id,
          type: part.type,
          rotate: part.rotate,
          seat: part.seat!,
          ...(part.attrs ? { attrs: part.attrs } : {}),
        }]);
      }

      if (!replace && Array.isArray(input.removePartIds)) {
        for (const rawId of input.removePartIds) circuitStore.removePart(requireId(rawId, 'removePartId'));
      }
      const removeConnectionIds = !replace && Array.isArray(input.removeConnectionIds)
        ? input.removeConnectionIds.map((id) => requireId(id, 'removeConnectionId'))
        : [];
      const connections = (Array.isArray(input.connections) ? input.connections : []).map((raw, index) => {
        if (!raw || typeof raw !== 'object') throw new Error(`connections[${index}] must be an object.`);
        return connectionFromInput(raw as Record<string, unknown>, 'path', true);
      });
      circuitStore.applyConnections(connections, removeConnectionIds);
      const boardId = applyArduinoCode(input);

      const state = circuitStore.getSnapshot();
      return toolResult({ harness: 'b', ...(boardId ? { codeBoardId: boardId } : {}), ...buildMutationSummary(state) });
    },
  };
}
