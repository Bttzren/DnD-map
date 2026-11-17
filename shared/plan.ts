// A layout plan is the shared language between generators (built-in and AI)
// and the map builder. Anything can produce one; sanitizePlan makes it safe.
import { presetById } from './presets';
import {
  DOOR_STATES, OBJECT_KINDS, TERRAINS,
  type DoorState, type ObjectKind, type Terrain,
} from './types';

export interface PlanRoom {
  id: string;
  name: string;
  shape: 'rect' | 'cave';
  x: number; y: number; w: number; h: number;
  terrain: Terrain;
  note: string;
}

export interface PlanConnection { from: string; to: string; door: DoorState | 'none' }

export interface PlanPatch { terrain: Terrain; x: number; y: number; w: number; h: number; shape: 'rect' | 'blob' }

export interface PlanObject { kind: ObjectKind; room?: string; x?: number; y?: number; hidden: boolean }

export interface PlanCreature { room: string; preset: string; count: number }

export interface LayoutPlan {
  name: string;
  rooms: PlanRoom[];
  connections: PlanConnection[];
  patches: PlanPatch[];
  objects: PlanObject[];
  creatures: PlanCreature[];
}

const ROOM_TERRAINS: ReadonlySet<string> = new Set(['floor', 'water', 'grass', 'dirt', 'rubble']);
const PATCH_TERRAINS: ReadonlySet<string> = new Set(TERRAINS.filter((t) => t !== 'void'));

const LIMITS = { rooms: 40, connections: 80, patches: 40, objects: 200, creatures: 40, perCreature: 12 };

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : d);
const str = (v: unknown, d: string, max: number) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : d;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Turn anything into a plan that fits a width x height map. Never throws. */
export function sanitizePlan(raw: unknown, width: number, height: number, defaultFloor: Terrain = 'floor'): LayoutPlan {
  const p = obj(raw) ?? {};
  const rooms: PlanRoom[] = [];
  const ids = new Set<string>();
  const byName = new Map<string, string>();

  for (const r0 of arr(p.rooms).slice(0, LIMITS.rooms)) {
    const r = obj(r0);
    if (!r) continue;
    const shape = r.shape === 'cave' ? 'cave' : 'rect';
    const minSide = shape === 'cave' ? 4 : 3;
    const w = clamp(num(r.w, 6), minSide, width - 2);
    const h = clamp(num(r.h, 5), minSide, height - 2);
    const x = clamp(num(r.x, 1), 1, width - 1 - w);
    const y = clamp(num(r.y, 1), 1, height - 1 - h);
    let id = str(r.id, '', 40) || `r${rooms.length + 1}`;
    while (ids.has(id)) id = `${id}_${rooms.length + 1}`;
    ids.add(id);
    const name = str(r.name, `Room ${rooms.length + 1}`, 40);
    const t = typeof r.terrain === 'string' && ROOM_TERRAINS.has(r.terrain) ? (r.terrain as Terrain) : defaultFloor;
    rooms.push({ id, name, shape, x, y, w, h, terrain: t, note: str(r.note, '', 500) });
    if (!byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), id);
  }

  if (rooms.length === 0) {
    const w = Math.min(10, width - 2), h = Math.min(8, height - 2);
    rooms.push({
      id: 'r1', name: 'Chamber', shape: 'rect', terrain: defaultFloor, note: '',
      x: Math.floor((width - w) / 2), y: Math.floor((height - h) / 2), w, h,
    });
    ids.add('r1');
  }

  const ref = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    if (ids.has(v)) return v;
    return byName.get(v.trim().toLowerCase()) ?? null;
  };

  const connections: PlanConnection[] = [];
  for (const c0 of arr(p.connections).slice(0, LIMITS.connections)) {
    const c = obj(c0);
    if (!c) continue;
    const from = ref(c.from), to = ref(c.to);
    if (!from || !to || from === to) continue;
    const door = c.door === 'none' ? 'none' : (DOOR_STATES as readonly string[]).includes(c.door as string) ? (c.door as DoorState) : 'closed';
    connections.push({ from, to, door });
  }

  const patches: PlanPatch[] = [];
  for (const q0 of arr(p.patches).slice(0, LIMITS.patches)) {
    const q = obj(q0);
    if (!q || typeof q.terrain !== 'string' || !PATCH_TERRAINS.has(q.terrain)) continue;
    const x = clamp(num(q.x, 0), 0, width - 1), y = clamp(num(q.y, 0), 0, height - 1);
    const w = clamp(num(q.w, 1), 1, width - x), h = clamp(num(q.h, 1), 1, height - y);
    patches.push({ terrain: q.terrain as Terrain, x, y, w, h, shape: q.shape === 'blob' ? 'blob' : 'rect' });
  }

  const objects: PlanObject[] = [];
  for (const o0 of arr(p.objects).slice(0, LIMITS.objects)) {
    const o = obj(o0);
    if (!o || !(OBJECT_KINDS as readonly string[]).includes(o.kind as string)) continue;
    const room = ref(o.room);
    const hidden = o.hidden === true;
    if (room) objects.push({ kind: o.kind as ObjectKind, room, hidden });
    else {
      const x = num(o.x, -1), y = num(o.y, -1);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      objects.push({ kind: o.kind as ObjectKind, x, y, hidden });
    }
  }

  const creatures: PlanCreature[] = [];
  for (const c0 of arr(p.creatures).slice(0, LIMITS.creatures)) {
    const c = obj(c0);
    if (!c) continue;
    const room = ref(c.room);
    const preset = typeof c.preset === 'string' ? c.preset : '';
    if (!room || !presetById(preset)) continue;
    creatures.push({ room, preset, count: clamp(num(c.count, 1), 1, LIMITS.perCreature) });
  }

  return { name: str(p.name, '', 60), rooms, connections, patches, objects, creatures };
}
