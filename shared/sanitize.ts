// Everything that arrives over the wire is untrusted, even from the DM:
// clean it into the exact shapes the rest of the code relies on.
import type { Coll, CollTypes } from './ops';
import {
  AMBIENCES, DISTANCE_RULES, DOOR_STATES, HP_VISIBILITY, OBJECT_KINDS, TEMPLATE_EFFECTS, TEMPLATE_SHAPES, THEMES, TOKEN_KINDS,
  MAX_IMAGES, defaultScreen, defaultSettings, isImageData, isImageId,
  type AreaTemplate, type Door, type Drawing, type Initiative, type Label, type MapData, type MapObject,
  type InitiativeEntry, type MapSettings, type Room, type ScreenState, type Token,
} from './types';

type Dims = { width: number; height: number };
type Raw = Record<string, unknown>;

const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {});
const str = (v: unknown, max: number, d = '') => (typeof v === 'string' ? v.slice(0, max) : d);
const num = (v: unknown, d: number, lo = -1e6, hi = 1e6) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const int = (v: unknown, d: number, lo = -1e6, hi = 1e6) => Math.round(num(v, d, lo, hi));
const intOrNull = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.max(lo, Math.min(hi, v))) : null);
const bool = (v: unknown) => v === true;
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);
const color = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : typeof v === 'string' && /^#[0-9a-f]{3}$/i.test(v) ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : d);
const id = (v: unknown) => (typeof v === 'string' && v.length > 0 && v.length <= 80 ? v : null);

function token(r: Raw, m: Dims): Token | null {
  const tid = id(r.id);
  if (!tid) return null;
  const size = int(r.size, 1, 1, 4);
  const kind = oneOf(r.kind, TOKEN_KINDS, 'enemy');
  const out: Token = {
    id: tid,
    name: str(r.name, 40, 'Token'),
    label: str(r.label, 4, '?') || '?',
    color: color(r.color, '#888888'),
    size,
    kind,
    x: int(r.x, 0, 0, Math.max(0, m.width - size)),
    y: int(r.y, 0, 0, Math.max(0, m.height - size)),
    hidden: bool(r.hidden),
    hp: intOrNull(r.hp, -9999, 99999),
    maxHp: intOrNull(r.maxHp, 0, 99999),
    ac: intOrNull(r.ac, 0, 99),
    conditions: Array.isArray(r.conditions) ? r.conditions.filter((c): c is string => typeof c === 'string').slice(0, 20).map((c) => c.slice(0, 24)) : [],
    note: str(r.note, 1000),
    down: bool(r.down),
    hpVisibility: oneOf(r.hpVisibility, HP_VISIBILITY, kind === 'player' || kind === 'ally' ? 'exact' : 'vague'),
  };
  if (typeof r.initMod === 'number') out.initMod = int(r.initMod, 0, -20, 20);
  if (isImageId(r.image)) out.image = r.image;
  return out;
}

function door(r: Raw, m: Dims): Door | null {
  const did = id(r.id);
  const x = int(r.x, -1), y = int(r.y, -1);
  if (!did || x < 0 || y < 0 || x >= m.width || y >= m.height) return null;
  return { id: did, x, y, state: oneOf(r.state, DOOR_STATES, 'closed') };
}

function object(r: Raw, m: Dims): MapObject | null {
  const oid = id(r.id);
  const x = int(r.x, -1), y = int(r.y, -1);
  if (!oid || x < 0 || y < 0 || x >= m.width || y >= m.height || !(OBJECT_KINDS as readonly string[]).includes(r.kind as string)) return null;
  const o: MapObject = { id: oid, x, y, kind: r.kind as MapObject['kind'] };
  if (bool(r.hidden)) o.hidden = true;
  return o;
}

function template(r: Raw, m: Dims): AreaTemplate | null {
  const tid = id(r.id);
  if (!tid) return null;
  const t: AreaTemplate = {
    id: tid, shape: oneOf(r.shape, TEMPLATE_SHAPES, 'circle'),
    x: num(r.x, 0, -10, m.width + 10), y: num(r.y, 0, -10, m.height + 10),
    sizeFt: int(r.sizeFt, 20, 5, 300), angle: num(r.angle, 0, -720, 720),
    color: color(r.color, '#f97316'), hidden: bool(r.hidden),
  };
  const label = str(r.label, 24);
  if (label) t.label = label;
  const effect = oneOf(r.effect, TEMPLATE_EFFECTS, 'plain');
  if (effect !== 'plain') t.effect = effect;
  return t;
}

function drawing(r: Raw, m: Dims): Drawing | null {
  const did = id(r.id);
  if (!did || !Array.isArray(r.points)) return null;
  const points = r.points.slice(0, 2000)
    .filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n)))
    .map(([x, y]) => [Math.max(-5, Math.min(m.width + 5, x)), Math.max(-5, Math.min(m.height + 5, y))] as [number, number]);
  if (points.length < 2) return null;
  return { id: did, points, color: color(r.color, '#facc15'), width: num(r.width, 2, 0.5, 10), hidden: bool(r.hidden) };
}

function label(r: Raw, m: Dims): Label | null {
  const lid = id(r.id);
  if (!lid) return null;
  return {
    id: lid, x: num(r.x, 0, 0, m.width), y: num(r.y, 0, 0, m.height), text: str(r.text, 60),
    color: color(r.color, '#f4ead5'), size: num(r.size, 1, 0.5, 3), hidden: bool(r.hidden),
  };
}

function room(r: Raw, m: Dims): Room | null {
  const rid = id(r.id);
  if (!rid) return null;
  const n = m.width * m.height;
  return {
    id: rid, name: str(r.name, 40, 'Room'), note: str(r.note, 1000),
    x: int(r.x, 0, 0, m.width), y: int(r.y, 0, 0, m.height), w: int(r.w, 1, 0, m.width), h: int(r.h, 1, 0, m.height),
    cells: Array.isArray(r.cells) ? r.cells.filter((c): c is number => Number.isInteger(c) && (c as number) >= 0 && (c as number) < n).slice(0, n) : [],
  };
}

const ITEM: { [K in Coll]: (r: Raw, m: Dims) => CollTypes[K] | null } = {
  tokens: token, doors: door, objects: object, templates: template, drawings: drawing, labels: label, rooms: room,
};

export function sanitizeItem<K extends Coll>(coll: K, raw: unknown, m: Dims): CollTypes[K] | null {
  const fn = ITEM[coll] as (r: Raw, m: Dims) => CollTypes[K] | null;
  return fn ? fn(obj(raw), m) : null;
}

export function sanitizeSettings(raw: unknown, base: MapSettings = defaultSettings()): MapSettings {
  const r = obj(raw);
  return {
    grid: typeof r.grid === 'boolean' ? r.grid : base.grid,
    gridOpacity: num(r.gridOpacity, base.gridOpacity, 0, 1),
    distanceRule: oneOf(r.distanceRule, DISTANCE_RULES, base.distanceRule),
    ambience: oneOf(r.ambience, AMBIENCES, base.ambience),
  };
}

export function sanitizeInitiative(raw: unknown): Initiative {
  const r = obj(raw);
  const entries = (Array.isArray(r.entries) ? r.entries : []).slice(0, 200)
    .map((e) => {
      const o = obj(e); const tid = id(o.tokenId);
      if (!tid) return null;
      const out: InitiativeEntry = { tokenId: tid, init: int(o.init, 0, -99, 999) };
      const name = str(o.name, 30).trim();
      if (name) { out.name = name; out.color = color(o.color, '#71717a'); if (bool(o.hidden)) out.hidden = true; }
      return out;
    })
    .filter((e): e is InitiativeEntry => !!e);
  return { entries, turn: int(r.turn, -1, -1, Math.max(-1, entries.length - 1)), round: int(r.round, 0, 0, 9999), visible: bool(r.visible) };
}

export function sanitizeScreen(raw: unknown, base: ScreenState = defaultScreen()): ScreenState {
  const r = obj(raw);
  return {
    blank: 'blank' in r ? bool(r.blank) : base.blank,
    message: 'message' in r ? str(r.message, 140) : base.message,
    banner: 'banner' in r ? str(r.banner, 140) : base.banner,
    followDm: 'followDm' in r ? bool(r.followDm) : base.followDm,
  };
}

/** Clean a structurally valid map (see validateMap) item by item. */
export function sanitizeMap(m: MapData): MapData {
  const dims = { width: m.width, height: m.height };
  const clean = <K extends Coll>(coll: K) => {
    const seen = new Set<string>();
    return (m[coll] as unknown[]).map((x) => sanitizeItem(coll, x, dims)).filter((x): x is CollTypes[K] => {
      if (!x || seen.has(x.id)) return false;
      seen.add(x.id);
      return true;
    });
  };
  return {
    id: m.id, name: str(m.name, 80, 'Map'), width: m.width, height: m.height,
    theme: oneOf(m.theme, THEMES, 'dungeon'), seed: str(m.seed, 60),
    terrain: m.terrain, fog: m.fog.map((f) => (f === 1 ? 1 : 0)),
    doors: clean('doors'), objects: clean('objects'), rooms: clean('rooms'), tokens: clean('tokens'),
    templates: clean('templates'), drawings: clean('drawings'), labels: clean('labels'),
    initiative: sanitizeInitiative(m.initiative), settings: sanitizeSettings(m.settings),
  };
}

/** Keep only well-formed pictures, up to the limit. */
export function sanitizeImages(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  let n = 0;
  for (const [k, d] of Object.entries(obj(v))) {
    if (n >= MAX_IMAGES) break;
    if (isImageId(k) && isImageData(d)) { out[k] = d; n++; }
  }
  return out;
}
