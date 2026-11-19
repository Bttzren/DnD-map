// AI map layout: asks Claude for a LayoutPlan as structured JSON. The plan
// still goes through sanitizePlan + buildMapFromPlan, so a sloppy answer
// still yields a valid, connected map.
import Anthropic from '@anthropic-ai/sdk';
import type { AiRequest } from '../shared/protocol';
import { PRESETS } from '../shared/presets';
import { DOOR_STATES, OBJECT_KINDS, TERRAINS } from '../shared/types';
import type { AiProvider } from './hub';

export const DEFAULT_MODEL = 'claude-opus-5-5';

const int = { type: 'integer' };
const PATCH_TERRAINS = TERRAINS.filter((t) => t !== 'void');

export const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'rooms', 'connections', 'patches', 'objects', 'creatures'],
  properties: {
    name: { type: 'string', description: 'Evocative map name, at most 5 words.' },
    rooms: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'name', 'shape', 'x', 'y', 'w', 'h', 'terrain', 'note'],
        properties: {
          id: { type: 'string' }, name: { type: 'string' },
          shape: { type: 'string', enum: ['rect', 'cave'] },
          x: int, y: int, w: int, h: int,
          terrain: { type: 'string', enum: ['floor', 'wood', 'tile', 'water', 'grass', 'dirt', 'sand', 'snow', 'mud', 'rubble'] },
          note: { type: 'string', description: 'One short sentence for the DM only.' },
        },
      },
    },
    connections: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['from', 'to', 'door'],
        properties: { from: { type: 'string' }, to: { type: 'string' }, door: { type: 'string', enum: [...DOOR_STATES, 'none'] } },
      },
    },
    patches: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['terrain', 'x', 'y', 'w', 'h', 'shape'],
        properties: {
          terrain: { type: 'string', enum: PATCH_TERRAINS }, x: int, y: int, w: int, h: int,
          shape: { type: 'string', enum: ['rect', 'blob'] },
        },
      },
    },
    objects: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['kind', 'room', 'hidden'],
        properties: {
          kind: { type: 'string', enum: [...OBJECT_KINDS] },
          room: { type: 'string', description: 'Room id the object goes in.' },
          hidden: { type: 'boolean', description: 'True for things players should not see yet (e.g. traps).' },
        },
      },
    },
    creatures: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['room', 'preset', 'count'],
        properties: {
          room: { type: 'string' },
          preset: { type: 'string', enum: PRESETS.map((p) => p.id) },
          count: int,
        },
      },
    },
  },
} as const;

export function systemPrompt(): string {
  return [
    'You design tabletop RPG battle maps on a square grid where one cell is 5 feet.',
    'You output a layout plan; a program carves it into a map, adds walls around everything open,',
    'and connects rooms with corridors along each connection.',
    '',
    'Rules for a good plan:',
    '- Coordinates are integer cells; (0,0) is the top-left corner. Keep every room at least 1 cell from the map edge.',
    '- Leave at least 2 cells between rectangular rooms so walls form between them. Rooms must not overlap.',
    '- A typical room is 4 to 12 cells per side. A huge hall can be larger. Use shape "cave" for natural, irregular spaces.',
    '- Every room should be reachable through connections. Add a loop or two in bigger maps so it is not a straight line.',
    '- Doors: "closed" for most built doorways, "open" for archways, "secret" sparingly, "none" for open passages and caves.',
    '- A room\'s terrain is its floor: "floor" (the setting\'s usual stone), "wood" (planks: libraries, barracks, inns),',
    '  "tile" (checkered stone: throne rooms, temples, grand halls), "sand", "snow", "mud", "grass", "dirt".',
    '- Patches paint terrain over an area: water/deepwater pools, lava, pits, rubble (difficult terrain), trees, sand, snow, mud.',
    '  Use deepwater only inside a larger water patch. Do not block the only route between rooms with lava, pits or deep water.',
    '- Objects go inside a room by room id: stairs, chest, table, pillar, altar, statue, bed, barrel, campfire, trap.',
    '  Mark traps hidden. Use objects to make rooms readable at a glance, a few per room.',
    '- Room names are short and evocative. Notes are one short sentence for the Dungeon Master: what is here, a hook or a hazard.',
    '- Only add creatures if asked. Then use the preset ids given, with counts that suit a fair fight.',
    '- Match the description closely: if it names rooms, features or a shape, include them.',
  ].join('\n');
}

export function userPrompt(req: AiRequest): string {
  return [
    `Map size: ${req.width} cells wide by ${req.height} cells tall.`,
    `Theme: ${req.theme}${req.theme === 'forest' ? ' (outdoors: rooms are grass clearings surrounded by trees, connected by dirt paths; no doors)' : ''}.`,
    `Creatures: ${req.placeCreatures ? 'yes, populate rooms with fitting creatures.' : 'no, leave creatures empty.'}`,
    '',
    'The Dungeon Master asks for:',
    req.prompt.trim() || `A classic ${req.theme} encounter map.`,
  ].join('\n');
}

/** Minimal shape of the client we call, so tests can pass a fake. */
export interface MessagesClient {
  beta: { messages: { create(body: Record<string, unknown>, opts?: Record<string, unknown>): Promise<unknown> } };
}

export function makeAi(o: { apiKey?: string | null; model?: string | null; client?: MessagesClient }): AiProvider | null {
  if (!o.client && !o.apiKey) return null;
  const client = o.client ?? (new Anthropic({ apiKey: o.apiKey! }) as unknown as MessagesClient);
  const model = o.model || DEFAULT_MODEL;
  return {
    info: async () => ({ kind: 'claude', model, ready: true }),
    async generate(req: AiRequest) {
      const res = (await client.beta.messages.create(
        {
          model,
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'medium', format: { type: 'json_schema', schema: PLAN_SCHEMA } },
          system: systemPrompt(),
          messages: [{ role: 'user', content: userPrompt(req) }],
        },
        { timeout: 120_000 },
      )) as { stop_reason?: string; content?: { type: string; text?: string }[] };
      if (res.stop_reason === 'refusal') throw new Error('The AI declined that request.');
      const text = (res.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
      if (!text) throw new Error(`No plan returned (stop_reason ${res.stop_reason ?? 'unknown'}).`);
      return JSON.parse(text) as unknown;
    },
  };
}
