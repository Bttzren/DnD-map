// Turns a LayoutPlan into a playable MapData: carves rooms and corridors,
// places doors, walls, objects and (optionally) creatures, and guarantees
// every room can be reached.
import { cellNoise, makeRng, type Rng } from './rng';
import { DIRS4, DIRS8, flood, footprint, idx, inBounds, isOpen } from './grid';
import { sanitizePlan, type LayoutPlan, type PlanRoom } from './plan';
import { presetById } from './presets';
import {
  blankMap, makeToken,
  type Door, type DoorState, type MapData, type MapObject, type Terrain, type Theme,
} from './types';

export interface BuildOptions {
  width: number;
  height: number;
  theme: Theme;
  seed: string;
  placeCreatures?: boolean;
}

export const THEME_LABEL: Record<Theme, string> = {
  dungeon: 'Dungeon', cave: 'Caverns', crypt: 'Crypt', forest: 'Forest Clearing', tavern: 'Tavern', sewer: 'Sewers',
};

export function themeProfile(theme: Theme) {
  const outdoor = theme === 'forest';
  return {
    base: (outdoor ? 'trees' : 'void') as Terrain,
    floor: (outdoor ? 'grass' : 'floor') as Terrain,
    corridor: (outdoor ? 'dirt' : 'floor') as Terrain,
    walls: !outdoor,
  };
}

/** Smooth value noise in [0,1). */
export function valueNoise(x: number, y: number, scale: number, salt: number): number {
  const gx = x / scale, gy = y / scale;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const fx = gx - x0, fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = cellNoise(x0, y0, salt), b = cellNoise(x0 + 1, y0, salt);
  const c = cellNoise(x0, y0 + 1, salt), d = cellNoise(x0 + 1, y0 + 1, salt);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

function blobCells(map: MapData, x: number, y: number, w: number, h: number, salt: number): number[] {
  const cx = x + w / 2 - 0.5, cy = y + h / 2 - 0.5;
  const rx = w / 2, ry = h / 2;
  const inside: number[] = [];
  const mark = new Uint8Array(map.width * map.height);
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) {
      const d = ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2;
      if (d < 1.05 - 0.55 * valueNoise(xx, yy, 2.5, salt)) { mark[idx(map, xx, yy)] = 1; inside.push(idx(map, xx, yy)); }
    }
  const centre = idx(map, Math.round(cx), Math.round(cy));
  mark[centre] = 1;
  const reach = flood(map, [centre], (i) => mark[i] === 1);
  return Array.from(reach.keys()).filter((i) => reach[i]);
}

function anchorOf(map: MapData, cells: number[], r: { x: number; y: number; w: number; h: number }): number {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  let best = cells[0], bd = Infinity;
  for (const c of cells) {
    const d = (c % map.width - cx) ** 2 + (Math.floor(c / map.width) - cy) ** 2;
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

function lPath(map: MapData, a: number, b: number, rng: Rng): number[] {
  let x = a % map.width, y = Math.floor(a / map.width);
  const tx = b % map.width, ty = Math.floor(b / map.width);
  const path = [a];
  const horizFirst = rng.chance(0.5);
  const stepX = () => { while (x !== tx) { x += Math.sign(tx - x); path.push(idx(map, x, y)); } };
  const stepY = () => { while (y !== ty) { y += Math.sign(ty - y); path.push(idx(map, x, y)); } };
  if (horizFirst) { stepX(); stepY(); } else { stepY(); stepX(); }
  return path;
}

function wanderPath(map: MapData, a: number, b: number, rng: Rng): number[] {
  let x = a % map.width, y = Math.floor(a / map.width);
  const tx = b % map.width, ty = Math.floor(b / map.width);
  const path = [a];
  for (let steps = 0; (x !== tx || y !== ty) && steps < 4000; steps++) {
    let dx = 0, dy = 0;
    if (rng.chance(0.68)) {
      const ax = Math.abs(tx - x), ay = Math.abs(ty - y);
      if (ax && (!ay || rng.next() < ax / (ax + ay))) dx = Math.sign(tx - x); else dy = Math.sign(ty - y);
    } else [dx, dy] = rng.pick(DIRS4);
    const nx = Math.max(1, Math.min(map.width - 2, x + dx)), ny = Math.max(1, Math.min(map.height - 2, y + dy));
    x = nx; y = ny;
    path.push(idx(map, x, y));
  }
  if (x !== tx || y !== ty) return path.concat(lPath(map, idx(map, x, y), b, rng).slice(1));
  return path;
}

export function buildMapFromPlan(raw: unknown, opts: BuildOptions): MapData {
  const prof = themeProfile(opts.theme);
  const plan: LayoutPlan = sanitizePlan(raw, opts.width, opts.height, prof.floor);
  const rng = makeRng(`${opts.seed}:build`);
  const salt = Math.floor(rng.next() * 1e6);
  const map = blankMap({
    width: opts.width, height: opts.height, theme: opts.theme, seed: opts.seed,
    name: plan.name || THEME_LABEL[opts.theme], fill: prof.base,
  });
  const T = map.terrain;
  const roomCells = new Map<string, number[]>();
  const roomById = new Map<string, PlanRoom>();

  // 1. Rooms.
  for (const r of plan.rooms) {
    roomById.set(r.id, r);
    let cells: number[];
    if (r.shape === 'cave') cells = blobCells(map, r.x, r.y, r.w, r.h, salt + roomCells.size * 7);
    else {
      cells = [];
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) cells.push(idx(map, x, y));
    }
    for (const c of cells) T[c] = r.terrain;
    roomCells.set(r.id, cells);
  }
  const anchors = new Map<string, number>();
  for (const r of plan.rooms) anchors.set(r.id, anchorOf(map, roomCells.get(r.id)!, r));

  // 2. Corridors and door candidates.
  const pendingDoors: { cell: number; state: DoorState }[] = [];
  const carve = (path: number[], wide: boolean, terrain: Terrain) => {
    for (const c of path) {
      if (!isOpen(T[c])) T[c] = terrain;
      if (wide) {
        const x = c % map.width, y = Math.floor(c / map.width);
        for (const [dx, dy] of [[1, 0], [0, 1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx <= map.width - 2 && ny <= map.height - 2 && !isOpen(T[idx(map, nx, ny)])) T[idx(map, nx, ny)] = terrain;
        }
      }
    }
  };
  for (const c of plan.connections) {
    const A = roomById.get(c.from)!, B = roomById.get(c.to)!;
    const cave = A.shape === 'cave' || B.shape === 'cave';
    const path = cave
      ? wanderPath(map, anchors.get(A.id)!, anchors.get(B.id)!, rng)
      : lPath(map, anchors.get(A.id)!, anchors.get(B.id)!, rng);
    carve(path, cave, prof.corridor);
    if (c.door !== 'none' && !cave && prof.walls) {
      const inB = new Set(roomCells.get(B.id)), inA = new Set(roomCells.get(A.id));
      let cell = -1;
      for (let k = 0; k < path.length - 1; k++) if (!inB.has(path[k]) && inB.has(path[k + 1])) { cell = path[k]; break; }
      if (cell < 0) for (let k = 1; k < path.length; k++) if (!inA.has(path[k]) && inA.has(path[k - 1])) { cell = path[k]; break; }
      if (cell >= 0) pendingDoors.push({ cell, state: c.door });
    }
  }

  // 3. Terrain patches.
  for (const p of plan.patches) {
    const cells = p.shape === 'blob'
      ? blobCells(map, p.x, p.y, Math.max(2, p.w), Math.max(2, p.h), salt + 991).filter((c) => inBounds(map, c % map.width, Math.floor(c / map.width)))
      : (() => { const o: number[] = []; for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) o.push(idx(map, x, y)); return o; })();
    for (const c of cells) T[c] = p.terrain;
  }

  // 4. Every room reachable; stray open pockets joined or filled.
  const first = plan.rooms[0].id;
  const ensureOpen = (cells: number[], fallback: number) => {
    if (!cells.some((c) => isOpen(T[c]))) T[fallback] = prof.floor;
  };
  for (const r of plan.rooms) ensureOpen(roomCells.get(r.id)!, anchors.get(r.id)!);
  const join = (from: number, reached: Uint8Array) => {
    const fx = from % map.width, fy = Math.floor(from / map.width);
    let best = -1, bd = Infinity;
    for (let i = 0; i < reached.length; i++) if (reached[i]) {
      const d = Math.abs(i % map.width - fx) + Math.abs(Math.floor(i / map.width) - fy);
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) for (const c of lPath(map, from, best, rng)) if (!isOpen(T[c])) T[c] = prof.corridor;
  };
  const startCell = () => {
    const a = anchors.get(first)!;
    return isOpen(T[a]) ? a : roomCells.get(first)!.find((c) => isOpen(T[c]))!;
  };
  let reached = flood(map, [startCell()], (i) => isOpen(T[i]));
  for (const r of plan.rooms) {
    const cells = roomCells.get(r.id)!;
    if (cells.some((c) => reached[c])) continue;
    const from = cells.find((c) => isOpen(T[c]))!;
    join(from, reached);
    reached = flood(map, [startCell()], (i) => isOpen(T[i]));
  }
  for (let i = 0; i < T.length; i++) {
    if (reached[i] || !isOpen(T[i])) continue;
    const pocket = flood(map, [i], (j) => isOpen(T[j]));
    const cells: number[] = [];
    pocket.forEach((v, j) => { if (v) cells.push(j); });
    if (cells.length >= 4) join(i, reached);
    else for (const c of cells) T[c] = prof.base;
    reached = flood(map, [startCell()], (j) => isOpen(T[j]));
  }

  // 5. Walls.
  if (prof.walls) {
    const next = T.slice();
    for (let y = 0; y < map.height; y++)
      for (let x = 0; x < map.width; x++) {
        const i = idx(map, x, y);
        if (T[i] !== 'void') continue;
        for (const [dx, dy] of DIRS8) {
          const nx = x + dx, ny = y + dy;
          if (inBounds(map, nx, ny) && T[idx(map, nx, ny)] !== 'void' && T[idx(map, nx, ny)] !== 'wall') { next[i] = 'wall'; break; }
        }
      }
    map.terrain = next;
  }
  const M = map.terrain;

  // 6. Doors, kept only where they sit in a wall gap.
  const tAt = (x: number, y: number): Terrain => (inBounds(map, x, y) ? M[idx(map, x, y)] : 'void');
  const doorCells = new Set<number>();
  const doors: Door[] = [];
  for (const d of pendingDoors) {
    if (doorCells.has(d.cell) || !isOpen(M[d.cell])) continue;
    const x = d.cell % map.width, y = Math.floor(d.cell / map.width);
    const horiz = tAt(x - 1, y) === 'wall' && tAt(x + 1, y) === 'wall' && isOpen(tAt(x, y - 1)) && isOpen(tAt(x, y + 1));
    const vert = tAt(x, y - 1) === 'wall' && tAt(x, y + 1) === 'wall' && isOpen(tAt(x - 1, y)) && isOpen(tAt(x + 1, y));
    if (!horiz && !vert) continue;
    M[d.cell] = 'floor';
    doorCells.add(d.cell);
    doors.push({ id: `door${doors.length + 1}`, x, y, state: d.state });
  }
  map.doors = doors;

  // 7. Rooms as stored on the map.
  map.rooms = plan.rooms.map((r) => ({
    id: r.id, name: r.name, note: r.note, x: r.x, y: r.y, w: r.w, h: r.h,
    cells: roomCells.get(r.id)!.filter((c) => M[c] !== 'wall' && M[c] !== 'void'),
  }));
  for (const r of map.rooms) if (r.cells.length === 0) r.cells = [anchors.get(r.id)!];

  // 8. Objects.
  const occupied = new Set<number>(doorCells);
  const nearDoor = (c: number) => {
    const x = c % map.width, y = Math.floor(c / map.width);
    return DIRS8.some(([dx, dy]) => inBounds(map, x + dx, y + dy) && doorCells.has(idx(map, x + dx, y + dy)));
  };
  const free = (c: number) => isOpen(M[c]) && !occupied.has(c);
  const objects: MapObject[] = [];
  for (const o of plan.objects) {
    let cell = -1;
    if (o.room) {
      const options = rng.shuffle(map.rooms.find((r) => r.id === o.room)!.cells.filter((c) => free(c) && M[c] !== 'water'));
      cell = options.find((c) => !nearDoor(c)) ?? options[0] ?? -1;
    } else if (o.x !== undefined && o.y !== undefined) {
      outer: for (let rad = 0; rad <= 3; rad++)
        for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
          const x = o.x + dx, y = o.y + dy;
          if (inBounds(map, x, y) && free(idx(map, x, y))) { cell = idx(map, x, y); break outer; }
        }
    }
    if (cell < 0) continue;
    occupied.add(cell);
    objects.push({ id: `obj${objects.length + 1}`, x: cell % map.width, y: Math.floor(cell / map.width), kind: o.kind, ...(o.hidden ? { hidden: true } : {}) });
  }
  map.objects = objects;

  // 9. Creatures.
  if (opts.placeCreatures) {
    const counts = new Map<string, number>();
    for (const c of plan.creatures) {
      const preset = presetById(c.preset)!;
      const room = map.rooms.find((r) => r.id === c.room)!;
      const candidates = rng.shuffle(room.cells.slice());
      for (let n = 0; n < c.count; n++) {
        const spot = candidates.find((cell) => {
          const x = cell % map.width, y = Math.floor(cell / map.width);
          const fp = footprint(map, x, y, preset.size);
          return fp.length === preset.size ** 2 && fp.every((f) => free(f) && M[f] !== 'water');
        });
        if (spot === undefined) break;
        const x = spot % map.width, y = Math.floor(spot / map.width);
        for (const f of footprint(map, x, y, preset.size)) occupied.add(f);
        const num = (counts.get(preset.id) ?? 0) + 1;
        counts.set(preset.id, num);
        map.tokens.push(makeToken({
          name: `${preset.name} ${num}`, label: preset.emoji, color: preset.color, size: preset.size,
          kind: preset.kind, x, y, hp: preset.hp, maxHp: preset.hp, ac: preset.ac,
        }));
      }
    }
  }
  return map;
}
