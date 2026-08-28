import { PART_ORDER } from '../../components/parts';
import { circuitStore } from '../../circuit/store';
import type { PartAttrs, PartType, WirePoint } from '../../circuit/types';
import { diagnoseCircuit } from '../../sim/diagnostics';
import { canonicalEndpoint, defaultWireColor, requireString } from '../core/actions';
import { buildAgentLayout, gridPartPlacement, gridPointToCanvas } from '../core/layout';
import { toolResult } from '../core/protocol';
import type { ToolDefinition } from '../types';

const partTypeEnum = [...PART_ORDER];

function validateOrthogonalGridWaypoints(points: Array<Record<string, unknown>>, connectionIndex: number) {
  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index];
    const b = points[index + 1];
    if (typeof a.x !== 'number' || typeof a.y !== 'number' || typeof b.x !== 'number' || typeof b.y !== 'number') continue;
    if (a.x !== b.x && a.y !== b.y) {
      throw new Error(`connections[${connectionIndex}].gridWaypoints must route like pipes: waypoint ${index} to ${index + 1} must share x or y (90-degree routing, no diagonals).`);
    }
  }
}

function parseLegacyConnections(raw: unknown[]) {
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`connections[${index}] must be an object.`);
    const value = entry as Record<string, unknown>;
    const id = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : undefined;
    const from = value.from !== undefined ? canonicalEndpoint(value.from) : undefined;
    const to = value.to !== undefined ? canonicalEndpoint(value.to) : undefined;
    if (!id && (!from || !to)) throw new Error('Connection requires both from and to endpoints when id is omitted.');
    if (from && to && from === to) throw new Error(`connections[${index}] connects a pin to itself.`);
    if (Array.isArray(value.waypoints) && Array.isArray(value.gridWaypoints)) {
      throw new Error(`connections[${index}] cannot specify both waypoints and gridWaypoints.`);
    }
    if (Array.isArray(value.gridWaypoints)) {
      validateOrthogonalGridWaypoints(value.gridWaypoints as Array<Record<string, unknown>>, index);
    }
    const rawWaypoints = Array.isArray(value.gridWaypoints)
      ? value.gridWaypoints.map((point, pointIndex) => {
          if (!point || typeof point !== 'object') throw new Error(`connections[${index}].gridWaypoints[${pointIndex}] must be a point.`);
          const rawPoint = point as Record<string, unknown>;
          if (typeof rawPoint.x !== 'number' || typeof rawPoint.y !== 'number') {
            throw new Error(`connections[${index}].gridWaypoints[${pointIndex}] requires numeric x and y.`);
          }
          return gridPointToCanvas({ x: rawPoint.x, y: rawPoint.y });
        })
      : value.waypoints;
    const waypoints = Array.isArray(rawWaypoints)
      ? rawWaypoints.map((point, pointIndex) => {
          if (!point || typeof point !== 'object') throw new Error(`connections[${index}].waypoints[${pointIndex}] must be a point.`);
          const rawPoint = point as Record<string, unknown>;
          if (typeof rawPoint.x !== 'number' || typeof rawPoint.y !== 'number') {
            throw new Error(`connections[${index}].waypoints[${pointIndex}] requires numeric x and y.`);
          }
          return { x: rawPoint.x, y: rawPoint.y } satisfies WirePoint;
        })
      : undefined;
    return {
      ...(id ? { id } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(typeof value.color === 'string'
        ? { color: value.color }
        : from && to
          ? { color: defaultWireColor(from, to, typeof value.role === 'string' ? value.role : undefined) }
          : {}),
      ...(waypoints !== undefined ? { waypoints } : {}),
    };
  });
}

export function createLegacyHarnessTools(inspectCircuit: () => unknown): ToolDefinition[] {
  return [
    {
      name: 'edit-circuit',
      description: 'Legacy control. Place, move, nudge, rotate, update, or remove circuit parts and wires in one batch. Grid coordinates use the historical top-left convention. Supports breadboard seating and whole-circuit atomic assembly.',
      inputSchema: {
        type: 'object',
        properties: {
          replace: { type: 'boolean', description: 'Clear all existing parts and wires before adding the supplied parts.' },
          parts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Stable part ID. Omit to auto-generate.' },
                type: { type: 'string', enum: partTypeEnum },
                left: { type: 'number', description: 'X position in canvas pixels.' },
                top: { type: 'number', description: 'Y position in canvas pixels.' },
                grid: {
                  type: 'object',
                  description: 'Legacy top-left coordinate on the planning grid.',
                  properties: { x: { type: 'number' }, y: { type: 'number' } },
                  required: ['x', 'y'],
                },
                nudge: {
                  type: 'object',
                  description: 'Relative nudge in planning grid units.',
                  properties: { dx: { type: 'number' }, dy: { type: 'number' } },
                  required: ['dx', 'dy'],
                },
                rotate: { type: 'number' },
                rotateBy: { type: 'number' },
                attrs: { type: 'object' },
                seating: {
                  type: 'object',
                  properties: {
                    breadboardId: { type: 'string' },
                    pins: { type: 'object', additionalProperties: { type: 'string' } },
                  },
                  required: ['breadboardId', 'pins'],
                },
                seat: {
                  type: 'object',
                  description: 'Align one component pin to one named breadboard hole and infer the rest from physical geometry.',
                  properties: {
                    breadboardId: { type: 'string' },
                    pin: { type: 'string' },
                    hole: { type: 'string' },
                  },
                  required: ['breadboardId', 'pin', 'hole'],
                },
                code: { type: 'string' },
              },
              required: ['type'],
            },
          },
          removePartIds: { type: 'array', items: { type: 'string' } },
          connections: {
            type: 'array',
            description: 'Optional wires to create atomically alongside parts.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                from: { type: 'string' },
                to: { type: 'string' },
                color: { type: 'string' },
                role: { type: 'string', enum: ['signal', 'power', 'ground'] },
                gridWaypoints: {
                  type: 'array',
                  items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
                },
              },
            },
          },
          removeConnectionIds: { type: 'array', items: { type: 'string' } },
          code: { type: 'string', description: 'Optional Arduino sketch for the primary Uno.' },
        },
      },
      async execute(input) {
        const rawParts = Array.isArray(input.parts) ? input.parts : [];
        const parts = rawParts.map((raw, index) => {
          if (!raw || typeof raw !== 'object') throw new Error(`parts[${index}] must be an object.`);
          const value = raw as Record<string, unknown>;
          if (!partTypeEnum.includes(value.type as PartType)) throw new Error(`Unsupported part type: ${String(value.type)}`);
          if (value.id !== undefined && !/^[A-Za-z][A-Za-z0-9_-]*$/.test(String(value.id))) throw new Error(`Invalid part id: ${String(value.id)}`);
          const grid = value.grid && typeof value.grid === 'object' ? value.grid as Record<string, unknown> : null;
          const gridPlacement = grid && typeof grid.x === 'number' && typeof grid.y === 'number'
            ? gridPartPlacement({ x: grid.x, y: grid.y })
            : null;
          const nudge = value.nudge && typeof value.nudge === 'object'
            ? { dx: Number((value.nudge as Record<string, unknown>).dx || 0), dy: Number((value.nudge as Record<string, unknown>).dy || 0) }
            : undefined;
          if (value.seating && value.seat) throw new Error(`parts[${index}] cannot specify both seating and seat.`);
          const seat = value.seat && typeof value.seat === 'object' ? value.seat as Record<string, unknown> : null;
          return {
            ...(value.id !== undefined ? { id: String(value.id) } : {}),
            type: value.type as PartType,
            ...(gridPlacement ? gridPlacement : {}),
            ...(!gridPlacement && typeof value.left === 'number' ? { left: value.left } : {}),
            ...(!gridPlacement && typeof value.top === 'number' ? { top: value.top } : {}),
            ...(nudge ? { nudge } : {}),
            ...(typeof value.rotate === 'number' ? { rotate: value.rotate } : {}),
            ...(typeof value.rotateBy === 'number' ? { rotateBy: value.rotateBy } : {}),
            ...(value.attrs && typeof value.attrs === 'object' ? { attrs: value.attrs as PartAttrs } : {}),
            ...(value.seating && typeof value.seating === 'object'
              ? { seating: value.seating as { breadboardId: string; pins: Record<string, string> } }
              : {}),
            ...(seat ? {
              seat: {
                breadboardId: requireString(seat.breadboardId, `parts[${index}].seat.breadboardId`),
                pin: requireString(seat.pin, `parts[${index}].seat.pin`),
                hole: requireString(seat.hole, `parts[${index}].seat.hole`),
              },
            } : {}),
            ...(typeof value.code === 'string' ? { code: value.code } : {}),
          };
        });
        const removePartIds = Array.isArray(input.removePartIds)
          ? input.removePartIds.map((value) => requireString(value, 'removePartId'))
          : [];
        const changed = circuitStore.applyParts(parts, removePartIds, input.replace === true);

        let changedWires: string[] = [];
        if (Array.isArray(input.connections) || Array.isArray(input.removeConnectionIds)) {
          const connections = parseLegacyConnections(Array.isArray(input.connections) ? input.connections : []);
          const removeIds = Array.isArray(input.removeConnectionIds)
            ? input.removeConnectionIds.map((value) => requireString(value, 'removeConnectionId'))
            : [];
          changedWires = circuitStore.applyConnections(connections, removeIds).map((wire) => wire.id);
        }

        if (typeof input.code === 'string') {
          const uno = circuitStore.getSnapshot().parts.find((part) => part.type === 'wokwi-arduino-uno');
          if (uno) circuitStore.setCode(uno.id, input.code);
        }

        return toolResult({
          changed: changed.map((part) => part.id),
          ...(changedWires.length ? { changedWires } : {}),
          circuit: inspectCircuit(),
        });
      },
    },
    {
      name: 'connect-pins',
      description: 'Legacy control. Create, update, rewire, reroute, recolor, or remove wires. Agent-authored grid waypoints are authoritative and must be orthogonal.',
      inputSchema: {
        type: 'object',
        properties: {
          connections: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Wire ID to update in-place, or omit to create.' },
                from: { type: 'string' },
                to: { type: 'string' },
                color: { type: 'string' },
                role: { type: 'string', enum: ['signal', 'power', 'ground'] },
                waypoints: {
                  type: 'array',
                  description: 'Exact bend points in canvas pixels.',
                  items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
                },
                gridWaypoints: {
                  type: 'array',
                  description: 'Agent-authored path on the planning grid. Consecutive points must share x or y.',
                  items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
                },
              },
            },
          },
          removeConnectionIds: { type: 'array', items: { type: 'string' } },
        },
      },
      async execute(input) {
        const connections = parseLegacyConnections(Array.isArray(input.connections) ? input.connections : []);
        const removeIds = Array.isArray(input.removeConnectionIds)
          ? input.removeConnectionIds.map((value) => requireString(value, 'removeConnectionId'))
          : [];
        const changed = circuitStore.applyConnections(connections, removeIds);
        const state = circuitStore.getSnapshot();
        return toolResult({ changed: changed.map((wire) => wire.id), diagnostics: diagnoseCircuit(state), layout: buildAgentLayout(state) });
      },
    },
  ];
}
