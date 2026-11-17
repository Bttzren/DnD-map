// Every change to a game is an Op. The DM client applies ops locally and
// sends them; the server applies the same ops with the same reducer.
import {
  MAP_MAX, MAP_MIN, TERRAINS,
  type AreaTemplate, type Door, type Drawing, type Game, type Label, type MapData,
  type MapObject, type Room, type ScreenState, type Terrain, type Token,
} from './types';

export interface CollTypes {
  tokens: Token;
  doors: Door;
  objects: MapObject;
  templates: AreaTemplate;
  drawings: Drawing;
  labels: Label;
  rooms: Room;
}
export type Coll = keyof CollTypes;
export const COLLS: Coll[] = ['tokens', 'doors', 'objects', 'templates', 'drawings', 'labels', 'rooms'];

export type MapPatch = Partial<Pick<MapData, 'name' | 'settings' | 'initiative' | 'theme'>>;

export type Op =
  | { t: 'map.put'; map: MapData }
  | { t: 'map.delete'; mapId: string }
  | { t: 'map.patch'; mapId: string; patch: MapPatch }
  | { t: 'terrain.set'; mapId: string; cells: [number, Terrain][] }
  | { t: 'fog.set'; mapId: string; cells: number[]; revealed: boolean }
  | { t: 'fog.all'; mapId: string; revealed: boolean }
  | { [K in Coll]: { t: 'item.put'; mapId: string; coll: K; item: CollTypes[K] } }[Coll]
  | { t: 'item.delete'; mapId: string; coll: Coll; id: string }
  | { t: 'game.patch'; liveMapId?: string | null; screen?: Partial<ScreenState> };

const TERRAIN_SET: ReadonlySet<string> = new Set(TERRAINS);
const MAX_ITEMS = 2000;

export function validateMap(m: unknown): asserts m is MapData {
  const map = m as MapData;
  const ok = map && typeof map === 'object'
    && typeof map.id === 'string' && map.id.length > 0 && map.id.length < 80
    && Number.isInteger(map.width) && Number.isInteger(map.height)
    && map.width >= MAP_MIN && map.width <= MAP_MAX && map.height >= MAP_MIN && map.height <= MAP_MAX
    && Array.isArray(map.terrain) && map.terrain.length === map.width * map.height
    && map.terrain.every((t) => TERRAIN_SET.has(t))
    && Array.isArray(map.fog) && map.fog.length === map.width * map.height
    && COLLS.every((c) => Array.isArray(map[c]) && map[c].length <= MAX_ITEMS)
    && map.initiative && Array.isArray(map.initiative.entries)
    && map.settings && typeof map.settings === 'object';
  if (!ok) throw new Error('invalid map');
}

export function findMap(game: Game, id: string | null | undefined): MapData | undefined {
  return id ? game.maps.find((m) => m.id === id) : undefined;
}

/** Apply an op to a game in place and return it. Throws only on a malformed map.put. */
export function applyOp(game: Game, op: Op): Game {
  switch (op.t) {
    case 'map.put': {
      validateMap(op.map);
      const i = game.maps.findIndex((m) => m.id === op.map.id);
      if (i >= 0) game.maps[i] = op.map; else game.maps.push(op.map);
      if (!game.liveMapId) game.liveMapId = op.map.id;
      break;
    }
    case 'map.delete': {
      game.maps = game.maps.filter((m) => m.id !== op.mapId);
      if (game.liveMapId === op.mapId) game.liveMapId = game.maps[0]?.id ?? null;
      break;
    }
    case 'game.patch': {
      if (op.liveMapId === null || (op.liveMapId && findMap(game, op.liveMapId))) game.liveMapId = op.liveMapId;
      if (op.screen) game.screen = { ...game.screen, ...op.screen };
      break;
    }
    default: {
      const map = findMap(game, op.mapId);
      if (!map) break;
      applyMapOp(map, op);
    }
  }
  game.updatedAt = Date.now();
  return game;
}

function applyMapOp(map: MapData, op: Exclude<Op, { t: 'map.put' | 'map.delete' | 'game.patch' }>) {
  const n = map.width * map.height;
  const okCell = (c: number) => Number.isInteger(c) && c >= 0 && c < n;
  switch (op.t) {
    case 'map.patch':
      if (typeof op.patch.name === 'string') map.name = op.patch.name.slice(0, 80);
      if (op.patch.settings) map.settings = { ...map.settings, ...op.patch.settings };
      if (op.patch.initiative) map.initiative = op.patch.initiative;
      if (op.patch.theme) map.theme = op.patch.theme;
      break;
    case 'terrain.set':
      for (const [c, t] of op.cells) if (okCell(c) && TERRAIN_SET.has(t)) map.terrain[c] = t;
      break;
    case 'fog.set':
      for (const c of op.cells) if (okCell(c)) map.fog[c] = op.revealed ? 1 : 0;
      break;
    case 'fog.all':
      map.fog.fill(op.revealed ? 1 : 0);
      break;
    case 'item.put': {
      const list = map[op.coll] as { id: string }[];
      if (!op.item || typeof op.item.id !== 'string') break;
      const i = list.findIndex((x) => x.id === op.item.id);
      if (i >= 0) list[i] = op.item; else if (list.length < MAX_ITEMS) list.push(op.item);
      break;
    }
    case 'item.delete': {
      (map as unknown as Record<Coll, { id: string }[]>)[op.coll] = (map[op.coll] as { id: string }[]).filter((x) => x.id !== op.id);
      if (op.coll === 'tokens') {
        const init = map.initiative;
        const active = init.entries[init.turn]?.tokenId;
        init.entries = init.entries.filter((e) => e.tokenId !== op.id);
        if (init.turn >= 0) {
          const ni = init.entries.findIndex((e) => e.tokenId === active);
          init.turn = ni >= 0 ? ni : Math.min(init.turn, init.entries.length - 1);
        }
      }
      break;
    }
  }
}
