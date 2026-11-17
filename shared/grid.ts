import type { MapData, Terrain } from './types';

type Dims = Pick<MapData, 'width' | 'height'>;

export const idx = (m: Dims, x: number, y: number) => y * m.width + x;
export const cellX = (m: Dims, i: number) => i % m.width;
export const cellY = (m: Dims, i: number) => Math.floor(i / m.width);
export const inBounds = (m: Dims, x: number, y: number) => x >= 0 && y >= 0 && x < m.width && y < m.height;

/** Terrain a creature can stand on and walk through (difficult terrain included). */
const OPEN: ReadonlySet<Terrain> = new Set(['floor', 'water', 'grass', 'dirt', 'rubble']);
export const isOpen = (t: Terrain) => OPEN.has(t);

/** Terrain that blocks sight on the map (walls and solid rock). */
export const isSolid = (t: Terrain) => t === 'wall' || t === 'void';

export const DIRS4: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const DIRS8: readonly [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** Cell indices covered by a token footprint, clipped to the map. */
export function footprint(m: Dims, x: number, y: number, size: number): number[] {
  const out: number[] = [];
  for (let dy = 0; dy < size; dy++)
    for (let dx = 0; dx < size; dx++)
      if (inBounds(m, x + dx, y + dy)) out.push(idx(m, x + dx, y + dy));
  return out;
}

/** Flood fill over cells accepted by `pass`, starting from `starts`. */
export function flood(m: Dims, starts: number[], pass: (i: number) => boolean): Uint8Array {
  const seen = new Uint8Array(m.width * m.height);
  const stack: number[] = [];
  for (const s of starts) if (pass(s) && !seen[s]) { seen[s] = 1; stack.push(s); }
  while (stack.length) {
    const c = stack.pop()!;
    const x = c % m.width, y = (c - x) / m.width;
    for (const [dx, dy] of DIRS4) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(m, nx, ny)) continue;
      const n = ny * m.width + nx;
      if (!seen[n] && pass(n)) { seen[n] = 1; stack.push(n); }
    }
  }
  return seen;
}
