import { blockDefinition, type BlockCell } from './geometry';
import { agentPartType, requireId, requirePartType, requireString } from './input';

type ProgramPart = {
  id: string;
  type: string;
  at?: [number, number];
  rotate?: number;
  attrs?: Record<string, unknown>;
  seat?: { breadboardId: string; pin: string; hole: string };
};

type ProgramWire = { id: string; from: string; to: string; role?: string; color?: string; via?: [number, number][] };
type ProgramNet = { id: string; role?: string; endpoints: string[]; color?: string };
export type ProgramRail = { id: string; breadboardId: string; rail: string; source: string; consumers: string[] };
export type ProgramRailBridge = { id: string; breadboardId: string; polarity: '+' | '-'; side: 'left' | 'right' };
type ProgramAlignment = { from: string; to: string; axis: 'x' | 'y' };

function integer(value: unknown, name: string) {
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer.`);
  return value as number;
}

function parseCalls(program: string) {
  return program.split(/\r?\n/).flatMap((raw, lineIndex) => {
    const line = raw.replace(/\/\/.*$/, '').trim().replace(/;$/, '');
    if (!line) return [];
    const match = /^(?:(?:const|let)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=\s*)?([A-Za-z][A-Za-z0-9]*)\s*\((.*)\)$/.exec(line);
    if (!match) throw new Error(`program line ${lineIndex + 1} must be one function call.`);
    try {
      return [{ name: match[1], args: JSON.parse(`[${match[2]}]`) as unknown[], line: lineIndex + 1 }];
    } catch {
      throw new Error(`program line ${lineIndex + 1} arguments must use JSON literals with double-quoted strings.`);
    }
  });
}

function endpoint(value: unknown, name: string) {
  const raw = requireString(value, name);
  if (raw.includes(':')) return raw;
  const dot = raw.indexOf('.');
  return dot > 0 ? `${raw.slice(0, dot)}:${raw.slice(dot + 1)}` : raw;
}

/**
 * Parse a deliberately tiny, code-shaped scene language without evaluating
 * model-authored JavaScript. It is a familiar planning surface over the same
 * canonical build transaction, not a second geometry or routing system.
 */
export function parseCircuitProgram(program: string) {
  const parts = new Map<string, ProgramPart>();
  const wires: ProgramWire[] = [];
  const nets: ProgramNet[] = [];
  const rails: ProgramRail[] = [];
  const bridges: ProgramRailBridge[] = [];
  const align: ProgramAlignment[] = [];
  const viaPoints = (value: unknown, line: number) => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) throw new Error(`program line ${line} wire corridor must be an array.`);
    return value.map((point, index): [number, number] => {
      if (!Array.isArray(point) || point.length !== 2) throw new Error(`program line ${line} corridor point ${index + 1} must be [x,y].`);
      return [integer(point[0], `program line ${line} corridor x`), integer(point[1], `program line ${line} corridor y`)];
    });
  };

  const part = (value: unknown, name: string) => {
    const id = requireId(value, name);
    const found = parts.get(id);
    if (!found) throw new Error(`${name} refers to unknown part ${id}. Declare it first with part().`);
    return found;
  };
  const at = (item: ProgramPart, name: string): BlockCell => {
    if (!item.at) throw new Error(`${name} requires ${item.id} to be placed first.`);
    return { x: item.at[0], y: item.at[1] };
  };
  const placeRelative = (movingRaw: unknown, anchorRaw: unknown, gapRaw: unknown, offsetRaw: unknown, direction: 'right' | 'left' | 'above' | 'below', line: number) => {
    const moving = part(movingRaw, `program line ${line}`);
    const anchor = part(anchorRaw, `program line ${line}`);
    const gap = gapRaw === undefined ? 3 : integer(gapRaw, `program line ${line} gap`);
    const offset = offsetRaw === undefined ? 0 : integer(offsetRaw, `program line ${line} offset`);
    const anchorAt = at(anchor, `program line ${line}`);
    const movingDef = blockDefinition(requirePartType(moving.type), moving.rotate ?? 0);
    const anchorDef = blockDefinition(requirePartType(anchor.type), anchor.rotate ?? 0);
    if (direction === 'right') moving.at = [anchorAt.x + anchorDef.w + gap, anchorAt.y + offset];
    if (direction === 'left') moving.at = [anchorAt.x - movingDef.w - gap, anchorAt.y + offset];
    if (direction === 'above') moving.at = [anchorAt.x + offset, anchorAt.y - movingDef.h - gap];
    if (direction === 'below') moving.at = [anchorAt.x + offset, anchorAt.y + anchorDef.h + gap];
  };

  const calls = parseCalls(program);

  // This is a declarative scene format, despite its familiar call syntax.
  // Resolve declarations first so agents can group placement statements by
  // intent without learning an arbitrary JavaScript-style ordering rule.
  for (const call of calls) {
    if (call.name !== 'part') continue;
    const [first, second, third] = call.args;
    const id = requireId(first, `program line ${call.line} part id`);
    if (parts.has(id)) throw new Error(`program line ${call.line} redeclares ${id}.`);
    const type = agentPartType(requirePartType(second, `program line ${call.line} part type`));
    const options = third && typeof third === 'object' && !Array.isArray(third) ? third as Record<string, unknown> : {};
    const item: ProgramPart = { id, type };
    if (Array.isArray(options.at) && options.at.length === 2) item.at = [integer(options.at[0], 'part at x'), integer(options.at[1], 'part at y')];
    if (options.rotate !== undefined) item.rotate = integer(options.rotate, 'part rotate');
    if (options.attrs && typeof options.attrs === 'object' && !Array.isArray(options.attrs)) item.attrs = options.attrs as Record<string, unknown>;
    parts.set(id, item);
  }

  for (const call of calls) {
    const [first, second, third, fourth] = call.args;
    if (call.name === 'part') {
      const [first, , third] = call.args;
      const options = third && typeof third === 'object' && !Array.isArray(third) ? third as Record<string, unknown> : {};
      if (options.rightOf) placeRelative(first, options.rightOf, options.gap, options.offset, 'right', call.line);
      else if (options.leftOf) placeRelative(first, options.leftOf, options.gap, options.offset, 'left', call.line);
      else if (options.above) placeRelative(first, options.above, options.gap, options.offset, 'above', call.line);
      else if (options.below) placeRelative(first, options.below, options.gap, options.offset, 'below', call.line);
      if (options.seat && typeof options.seat === 'object') {
        const seatOpt = options.seat as Record<string, unknown>;
        const item = part(first, `program line ${call.line}`);
        item.at = undefined;
        item.seat = {
          breadboardId: requireId(seatOpt.breadboard ?? seatOpt.breadboardId, `program line ${call.line} seat breadboard`),
          pin: requireString(seatOpt.pin ?? seatOpt.anchorPin, `program line ${call.line} seat pin`),
          hole: requireString(seatOpt.hole, `program line ${call.line} seat hole`),
        };
      }
      continue;
    }
    if (call.name === 'place') {
      const item = part(first, `program line ${call.line}`);
      item.at = [integer(second, 'place x'), integer(third, 'place y')];
      if (fourth !== undefined) item.rotate = integer(fourth, 'place rotation');
      continue;
    }
    if (call.name === 'rightOf' || call.name === 'leftOf' || call.name === 'above' || call.name === 'below') {
      placeRelative(first, second, third, fourth, call.name === 'rightOf' ? 'right' : call.name === 'leftOf' ? 'left' : call.name, call.line);
      continue;
    }
    if (call.name === 'seat') {
      const item = part(first, `program line ${call.line}`);
      item.at = undefined;
      item.seat = {
        breadboardId: requireId(second, `program line ${call.line} breadboard`),
        pin: requireString(third, `program line ${call.line} anchor pin`),
        hole: requireString(fourth, `program line ${call.line} hole`),
      };
      continue;
    }
    if (call.name === 'wire' || call.name === 'connect') {
      let via: [number, number][] | undefined;
      let color: string | undefined;
      if (Array.isArray(call.args[4])) {
        via = viaPoints(call.args[4], call.line);
        if (typeof call.args[5] === 'string') color = call.args[5];
      } else if (typeof call.args[4] === 'string') {
        color = call.args[4];
      }
      wires.push({
        id: requireId(first, `program line ${call.line} wire id`),
        from: endpoint(second, `program line ${call.line} from`),
        to: endpoint(third, `program line ${call.line} to`),
        ...(fourth !== undefined ? { role: requireString(fourth, `program line ${call.line} role`) } : {}),
        ...(color ? { color } : {}),
        ...(via ? { via } : {}),
      });
      continue;
    }
    if (call.name === 'net') {
      if (!Array.isArray(third)) throw new Error(`program line ${call.line} net endpoints must be an array.`);
      const color = call.args[3] === undefined ? undefined : requireString(call.args[3], `program line ${call.line} net color`);
      nets.push({
        id: requireId(first, `program line ${call.line} net id`),
        ...(second !== undefined ? { role: requireString(second, `program line ${call.line} role`) } : {}),
        endpoints: third.map((value) => endpoint(value, `program line ${call.line} endpoint`)),
        ...(color ? { color } : {}),
      });
      continue;
    }
    if (call.name === 'rail') {
      if (!Array.isArray(call.args[4]) || !call.args[4].length) {
        throw new Error(`program line ${call.line} rail consumers must be a non-empty array.`);
      }
      rails.push({
        id: requireId(first, `program line ${call.line} rail id`),
        breadboardId: requireId(second, `program line ${call.line} breadboard`),
        rail: requireString(third, `program line ${call.line} rail name`),
        source: endpoint(fourth, `program line ${call.line} rail source`),
        consumers: (call.args[4] as unknown[]).map((value) => endpoint(value, `program line ${call.line} rail consumer`)),
      });
      continue;
    }
    if (call.name === 'bridge') {
      const polarity = requireString(third, `program line ${call.line} bridge polarity`);
      const side = requireString(fourth, `program line ${call.line} bridge side`);
      if (polarity !== '+' && polarity !== '-') throw new Error(`program line ${call.line} bridge polarity must be + or -.`);
      if (side !== 'left' && side !== 'right') throw new Error(`program line ${call.line} bridge side must be left or right.`);
      bridges.push({
        id: requireId(first, `program line ${call.line} bridge id`),
        breadboardId: requireId(second, `program line ${call.line} breadboard`),
        polarity,
        side,
      });
      continue;
    }
    if (call.name === 'align') {
      const axis = requireString(third, `program line ${call.line} alignment axis`);
      if (axis !== 'x' && axis !== 'y') throw new Error(`program line ${call.line} alignment axis must be x or y.`);
      align.push({
        from: endpoint(first, `program line ${call.line} alignment from`),
        to: endpoint(second, `program line ${call.line} alignment to`),
        axis,
      });
      continue;
    }
    throw new Error(`program line ${call.line} uses unknown function ${call.name}.`);
  }

  for (const item of parts.values()) {
    if (!item.at && !item.seat) throw new Error(`Part ${item.id} needs place()/relative placement or seat().`);
  }
  return { parts: Array.from(parts.values()), wires, nets, rails, bridges, align };
}
