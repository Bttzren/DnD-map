// Built-in, free, deterministic map generators. Each produces a LayoutPlan
// which the shared builder turns into a map.
import { buildMapFromPlan } from './build';
import { roomName, roomNote } from './names';
import type { LayoutPlan, PlanConnection, PlanCreature, PlanObject, PlanPatch, PlanRoom } from './plan';
import { PRESETS } from './presets';
import { makeRng, type Rng } from './rng';
import type { DoorState, MapData, ObjectKind, Theme } from './types';

export type Density = 'sparse' | 'normal' | 'packed';

export interface GenerateOptions {
  theme: Theme;
  width: number;
  height: number;
  seed: string;
  density?: Density;
  encounter?: boolean;
}

const DENSITY: Record<Density, number> = { sparse: 0.6, normal: 1, packed: 1.5 };

type Rect = { x: number; y: number; w: number; h: number };
const overlaps = (a: Rect, b: Rect, gap: number) =>
  a.x - gap < b.x + b.w && b.x - gap < a.x + a.w && a.y - gap < b.y + b.h && b.y - gap < a.y + a.h;

function placeRects(rng: Rng, W: number, H: number, count: number, size: (rng: Rng) => [number, number], gap: number): Rect[] {
  const out: Rect[] = [];
  for (let tries = 0; tries < count * 60 && out.length < count; tries++) {
    let [w, h] = size(rng);
    w = Math.min(w, W - 4); h = Math.min(h, H - 4);
    if (w < 3 || h < 3) continue;
    const r = { x: rng.int(2, W - 2 - w), y: rng.int(2, H - 2 - h), w, h };
    if (out.every((o) => !overlaps(o, r, gap))) out.push(r);
  }
  return out;
}

/** Minimum spanning tree over room centres plus a share of extra loops. */
function connect(rng: Rng, rooms: Rect[], ids: string[], extra: number, door: () => DoorState | 'none'): PlanConnection[] {
  const c = rooms.map((r) => [r.x + r.w / 2, r.y + r.h / 2]);
  const d = (i: number, j: number) => Math.hypot(c[i][0] - c[j][0], c[i][1] - c[j][1]);
  const inTree = new Set([0]);
  const edges: [number, number][] = [];
  while (inTree.size < rooms.length) {
    let best: [number, number] | null = null, bd = Infinity;
    for (const i of inTree) for (let j = 0; j < rooms.length; j++) if (!inTree.has(j) && d(i, j) < bd) { bd = d(i, j); best = [i, j]; }
    edges.push(best!); inTree.add(best![1]);
  }
  const has = (i: number, j: number) => edges.some(([a, b]) => (a === i && b === j) || (a === j && b === i));
  const candidates: [number, number][] = [];
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) if (!has(i, j) && d(i, j) < 22) candidates.push([i, j]);
  rng.shuffle(candidates);
  edges.push(...candidates.slice(0, Math.round(rooms.length * extra)));
  return edges.map(([a, b]) => ({ from: ids[a], to: ids[b], door: door() }));
}

function weighted<T>(rng: Rng, items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rng.next() * total;
  for (const [v, w] of items) if ((r -= w) < 0) return v;
  return items[items.length - 1][0];
}

function encounterFor(rng: Rng, theme: Theme, rooms: PlanRoom[]): PlanCreature[] {
  const pool = PRESETS.filter((p) => p.kind === 'enemy' && p.themes.includes(theme));
  const out: PlanCreature[] = [];
  rooms.slice(1).forEach((room) => {
    if (!rng.chance(0.55) || pool.length === 0) return;
    const preset = rng.pick(pool);
    const count = preset.hp > 50 ? 1 : preset.hp > 20 ? rng.int(1, 2) : rng.int(2, 4);
    out.push({ room: room.id, preset: preset.id, count });
  });
  if (out.length === 0 && rooms.length > 1 && pool.length) out.push({ room: rooms[rooms.length - 1].id, preset: pool[0].id, count: 2 });
  return out;
}

const OBJECT_TABLE: Record<Theme, [ObjectKind, number][]> = {
  dungeon: [['chest', 3], ['table', 3], ['barrel', 3], ['pillar', 2], ['statue', 1], ['bed', 1], ['trap', 2]],
  crypt: [['altar', 2], ['statue', 3], ['pillar', 3], ['chest', 1], ['trap', 3]],
  sewer: [['barrel', 4], ['chest', 1], ['trap', 1], ['table', 1]],
  cave: [['campfire', 1], ['chest', 1], ['pillar', 3], ['trap', 1], ['barrel', 1]],
  forest: [['campfire', 2], ['statue', 1], ['chest', 1], ['trap', 2], ['barrel', 1]],
  tavern: [['table', 4], ['barrel', 2], ['bed', 1], ['chest', 1]],
};

function furnish(rng: Rng, theme: Theme, rooms: PlanRoom[], density: number): PlanObject[] {
  const objects: PlanObject[] = [];
  rooms.forEach((r, i) => {
    const area = r.w * r.h;
    const n = Math.min(6, Math.floor((area / 18) * density * rng.next()) + (rng.chance(0.5) ? 1 : 0));
    for (let k = 0; k < n; k++) {
      const kind = weighted(rng, OBJECT_TABLE[theme]);
      objects.push({ kind, room: r.id, hidden: kind === 'trap' });
    }
    if (i === 0 && theme !== 'forest') objects.push({ kind: 'stairs', room: r.id, hidden: false });
  });
  if (rooms.length > 2 && theme !== 'forest' && theme !== 'tavern') objects.push({ kind: 'stairs', room: rooms[rooms.length - 1].id, hidden: false });
  return objects;
}

function named(theme: Theme, rng: Rng, rects: Rect[], shape: 'rect' | 'cave', terrain: PlanRoom['terrain']): PlanRoom[] {
  const used = new Set<string>();
  return rects.map((r, i) => ({ id: `r${i + 1}`, name: roomName(theme, rng, used), shape, terrain, note: roomNote(theme, rng), ...r }));
}

function roomsAndCorridors(o: GenerateOptions, rng: Rng, dens: number): LayoutPlan {
  const { width: W, height: H, theme } = o;
  const big = theme === 'crypt' ? [3, 7] : theme === 'sewer' ? [4, 8] : [4, 10];
  const count = Math.max(2, Math.round(((W * H) / 110) * dens));
  const rects = placeRects(rng, W, H, count, (r) => [r.int(big[0], big[1]), r.int(big[0], Math.max(big[0], big[1] - 2))], 2);
  if (rects.length < 2) rects.push(...placeRects(rng, W, H, 2 - rects.length + 1, () => [3, 3], 1));
  const rooms = named(theme, rng, rects, 'rect', 'floor');
  const door = (): DoorState | 'none' =>
    theme === 'sewer' ? weighted(rng, [['none', 6], ['open', 2], ['closed', 1], ['secret', 1]])
      : theme === 'crypt' ? weighted(rng, [['closed', 5], ['open', 1], ['secret', 3], ['none', 1]])
        : weighted(rng, [['closed', 6], ['open', 2], ['secret', 1], ['none', 1]]);
  const patches: PlanPatch[] = [];
  if (theme === 'sewer') {
    for (const r of rooms) if (rng.chance(0.6)) patches.push({ terrain: 'water', x: r.x + 1, y: r.y + Math.floor(r.h / 2), w: Math.max(1, r.w - 2), h: 1, shape: 'rect' });
    for (const r of rooms) if (rng.chance(0.35)) patches.push({ terrain: 'rubble', x: r.x + rng.int(0, Math.max(0, r.w - 3)), y: r.y, w: 3, h: 2, shape: 'blob' });
  }
  if (theme === 'crypt') for (const r of rooms) if (r.w >= 6 && r.h >= 5 && rng.chance(0.3)) patches.push({ terrain: 'pit', x: r.x + 2, y: r.y + 2, w: r.w - 4, h: r.h - 4, shape: 'rect' });
  if (theme === 'dungeon') for (const r of rooms) if (rng.chance(0.15)) patches.push({ terrain: 'rubble', x: r.x + rng.int(0, Math.max(0, r.w - 3)), y: r.y + rng.int(0, Math.max(0, r.h - 3)), w: 3, h: 3, shape: 'blob' });
  return {
    name: '', rooms, connections: connect(rng, rects, rooms.map((r) => r.id), theme === 'crypt' ? 0.1 : 0.2, door),
    patches, objects: furnish(rng, theme, rooms, dens), creatures: [],
  };
}

function caves(o: GenerateOptions, rng: Rng, dens: number): LayoutPlan {
  const { width: W, height: H, theme } = o;
  const forest = theme === 'forest';
  const count = Math.max(2, Math.round(((W * H) / 190) * dens));
  const rects = placeRects(rng, W, H, count, (r) => [r.int(6, 14), r.int(6, 12)], 1);
  if (rects.length < 2) rects.push(...placeRects(rng, W, H, 2, () => [4, 4], 0));
  const rooms = named(theme, rng, rects, 'cave', forest ? 'grass' : 'floor');
  const patches: PlanPatch[] = [];
  // A lake or pond with a deep middle.
  const lake = rng.pick(rooms);
  if (lake.w >= 7 && lake.h >= 7) {
    patches.push({ terrain: 'water', x: lake.x + 1, y: lake.y + 1, w: lake.w - 2, h: lake.h - 2, shape: 'blob' });
    patches.push({ terrain: 'deepwater', x: lake.x + 3, y: lake.y + 3, w: Math.max(2, lake.w - 6), h: Math.max(2, lake.h - 6), shape: 'blob' });
  }
  for (const r of rooms) {
    if (r === lake) continue;
    if (rng.chance(0.35)) patches.push({ terrain: 'rubble', x: r.x + rng.int(0, Math.max(0, r.w - 4)), y: r.y + rng.int(0, Math.max(0, r.h - 4)), w: 4, h: 3, shape: 'blob' });
    if (!forest && rng.chance(0.12)) patches.push({ terrain: 'lava', x: r.x + 2, y: r.y + 2, w: 3, h: 2, shape: 'blob' });
    if (forest) for (let k = 0; k < rng.int(0, 3); k++) patches.push({ terrain: 'trees', x: r.x + rng.int(1, Math.max(1, r.w - 2)), y: r.y + rng.int(1, Math.max(1, r.h - 2)), w: 1, h: 1, shape: 'rect' });
  }
  return {
    name: '', rooms, connections: connect(rng, rects, rooms.map((r) => r.id), 0.25, () => 'none'),
    patches, objects: furnish(rng, theme, rooms, dens), creatures: [],
  };
}

function tavern(o: GenerateOptions, rng: Rng): LayoutPlan {
  const { width: W, height: H } = o;
  const x0 = 2, y0 = 2;
  const bw = Math.max(12, Math.min(W - 4, 36));
  const bh = Math.max(12, Math.min(H - 8, 22));
  const rooms: PlanRoom[] = [];
  const conns: PlanConnection[] = [];
  const add = (id: string, name: string, x: number, y: number, w: number, h: number, terrain: PlanRoom['terrain'] = 'floor') =>
    rooms.push({ id, name, shape: 'rect', x, y, w, h, terrain, note: '' });
  const bedW = 4, bedH = 3;
  const hallY = y0 + bedH + 1;
  const nBeds = Math.max(1, Math.floor((bw + 1) / (bedW + 1)));
  for (let i = 0; i < nBeds; i++) add(`bed${i + 1}`, `Guest Room ${i + 1}`, x0 + i * (bedW + 1), y0, bedW, bedH);
  add('hall', 'Hallway', x0, hallY, bw, 2);
  const lowerY = hallY + 3, lowerH = Math.max(4, bh - (lowerY - y0));
  const commonW = Math.max(6, Math.round(bw * 0.62));
  add('common', 'Common Room', x0, lowerY, commonW, lowerH);
  const sideX = x0 + commonW + 1, sideW = Math.max(3, bw - commonW - 1);
  const kitchenH = Math.max(3, Math.floor((lowerH - 1) / 2));
  add('kitchen', 'Kitchen', sideX, lowerY, sideW, kitchenH);
  add('store', 'Storeroom', sideX, lowerY + kitchenH + 1, sideW, Math.max(3, lowerH - kitchenH - 1));
  add('street', 'Street', 1, lowerY + lowerH + 1, W - 2, Math.max(3, H - (lowerY + lowerH + 1) - 1), 'dirt');
  rooms.forEach((r) => (r.note = roomNote('tavern', rng)));
  for (let i = 0; i < nBeds; i++) conns.push({ from: `bed${i + 1}`, to: 'hall', door: 'closed' });
  conns.push({ from: 'hall', to: 'common', door: 'open' });
  conns.push({ from: 'common', to: 'kitchen', door: 'open' });
  conns.push({ from: 'kitchen', to: 'store', door: 'closed' });
  conns.push({ from: 'street', to: 'common', door: 'open' });
  const objects: PlanObject[] = [];
  const put = (kind: ObjectKind, room: string, n = 1) => { for (let i = 0; i < n; i++) objects.push({ kind, room, hidden: false }); };
  put('table', 'common', Math.max(2, Math.floor((commonW * lowerH) / 32)));
  put('campfire', 'common'); put('barrel', 'common', 2);
  for (let i = 0; i < nBeds; i++) { put('bed', `bed${i + 1}`); if (rng.chance(0.4)) put('chest', `bed${i + 1}`); }
  put('table', 'kitchen'); put('campfire', 'kitchen'); put('barrel', 'kitchen');
  put('barrel', 'store', 3); put('stairs', 'store'); put('chest', 'store');
  return { name: 'The Prancing Stag', rooms, connections: conns, patches: [], objects, creatures: [] };
}

const TAVERN_NAMES = ['The Prancing Stag', 'The Gilded Tankard', 'The Drowned Rat', 'The Sleeping Giant', 'The Rusty Lantern',
  'The Laughing Wyvern', 'The Last Candle', 'The Copper Kettle'];

export function generatePlan(o: GenerateOptions): LayoutPlan {
  const rng = makeRng(`${o.seed}:${o.theme}:plan`);
  const dens = DENSITY[o.density ?? 'normal'];
  let plan: LayoutPlan;
  if (o.theme === 'tavern') {
    plan = tavern(o, rng);
    plan.name = rng.pick(TAVERN_NAMES);
  } else if (o.theme === 'cave' || o.theme === 'forest') plan = caves(o, rng, dens);
  else plan = roomsAndCorridors(o, rng, dens);
  if (o.encounter) {
    plan.creatures = o.theme === 'tavern'
      ? [{ room: 'common', preset: 'innkeeper', count: 1 }, { room: 'common', preset: 'commoner', count: rng.int(2, 5) }, ...(rng.chance(0.5) ? [{ room: 'common', preset: 'bandit', count: rng.int(2, 3) }] : [])]
      : encounterFor(rng, o.theme, plan.rooms);
  }
  return plan;
}

export function generateMap(o: GenerateOptions & { placeCreatures?: boolean }): MapData {
  return buildMapFromPlan(generatePlan(o), {
    width: o.width, height: o.height, theme: o.theme, seed: o.seed,
    placeCreatures: o.placeCreatures ?? o.encounter ?? false,
  });
}
