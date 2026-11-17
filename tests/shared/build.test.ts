import { describe, expect, it } from 'vitest';
import { buildMapFromPlan } from '../../shared/build';
import { isOpen, idx } from '../../shared/grid';
import type { MapData } from '../../shared/types';

const opts = { width: 40, height: 30, theme: 'dungeon' as const, seed: 's1' };

/** Number of separate open regions (doors count as open). */
export function openRegions(map: MapData): number {
  const seen = new Uint8Array(map.width * map.height);
  let regions = 0;
  for (let i = 0; i < seen.length; i++) {
    if (seen[i] || !isOpen(map.terrain[i])) continue;
    regions++;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      const x = c % map.width, y = Math.floor(c / map.width);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
        const n = idx(map, nx, ny);
        if (!seen[n] && isOpen(map.terrain[n])) { seen[n] = 1; stack.push(n); }
      }
    }
  }
  return regions;
}

function stripIds(m: MapData) {
  return { ...m, id: '', tokens: m.tokens.map((t) => ({ ...t, id: '' })) };
}

describe('buildMapFromPlan', () => {
  const plan = {
    name: 'Test Keep',
    rooms: [
      { id: 'a', name: 'Hall', x: 3, y: 3, w: 8, h: 6, note: 'start' },
      { id: 'b', name: 'Vault', x: 25, y: 4, w: 6, h: 6 },
      { id: 'c', name: 'Pool', x: 12, y: 18, w: 9, h: 7, shape: 'cave', terrain: 'water' },
    ],
    connections: [
      { from: 'a', to: 'b', door: 'closed' },
      { from: 'a', to: 'c', door: 'secret' },
    ],
    objects: [{ kind: 'chest', room: 'b' }, { kind: 'trap', room: 'a', hidden: true }],
    creatures: [{ room: 'b', preset: 'goblin', count: 3 }],
  };

  it('builds the rooms it was given, connected', () => {
    const m = buildMapFromPlan(plan, opts);
    expect(m.width).toBe(40);
    expect(m.height).toBe(30);
    expect(m.terrain).toHaveLength(1200);
    expect(m.name).toBe('Test Keep');
    expect(m.rooms.map((r) => r.name)).toEqual(['Hall', 'Vault', 'Pool']);
    expect(m.rooms[0].note).toBe('start');
    expect(openRegions(m)).toBe(1);
    expect(m.objects.some((o) => o.kind === 'chest')).toBe(true);
    expect(m.objects.find((o) => o.kind === 'trap')?.hidden).toBe(true);
  });

  it('puts doors on walls between two wall cells', () => {
    const m = buildMapFromPlan(plan, opts);
    expect(m.doors.length).toBeGreaterThan(0);
    for (const d of m.doors) {
      const t = (x: number, y: number) => m.terrain[idx(m, x, y)];
      const horiz = t(d.x - 1, d.y) === 'wall' && t(d.x + 1, d.y) === 'wall';
      const vert = t(d.x, d.y - 1) === 'wall' && t(d.x, d.y + 1) === 'wall';
      expect(horiz || vert).toBe(true);
      expect(isOpen(t(d.x, d.y))).toBe(true);
    }
  });

  it('places creatures only when asked', () => {
    expect(buildMapFromPlan(plan, opts).tokens).toHaveLength(0);
    const m = buildMapFromPlan(plan, { ...opts, placeCreatures: true });
    expect(m.tokens.map((t) => t.name)).toEqual(['Goblin 1', 'Goblin 2', 'Goblin 3']);
    const vault = m.rooms[1];
    for (const t of m.tokens) expect(vault.cells).toContain(idx(m, t.x, t.y));
  });

  it('survives a junk plan', () => {
    const junk = {
      rooms: [
        { x: -50, y: 999, w: 0, h: 3 },
        { id: 'a', x: 5, y: 5, w: 6, h: 6, terrain: 'lava-ish' },
        'not a room',
        { id: 'a', x: 30, y: 20, w: 200, h: 200 },
      ],
      connections: [{ from: 'zz', to: 'a' }, null],
      objects: [{ kind: 'spaceship', x: 3, y: 3 }, { kind: 'chest', x: 9999, y: 2 }],
      patches: [{ terrain: 'lava', x: 6, y: 6, w: 40, h: 1 }],
      creatures: [{ room: 'a', preset: 'nope', count: 1000 }],
    };
    const m = buildMapFromPlan(junk, { ...opts, placeCreatures: true });
    expect(m.rooms.length).toBeGreaterThanOrEqual(1);
    for (const r of m.rooms) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(40);
      expect(r.y + r.h).toBeLessThanOrEqual(30);
      expect(r.cells.length).toBeGreaterThan(0);
    }
    expect(new Set(m.rooms.map((r) => r.id)).size).toBe(m.rooms.length);
    expect(openRegions(m)).toBe(1);
    expect(m.objects.every((o) => o.kind === 'chest')).toBe(true);
    expect(m.objects.find((o) => (o.kind as string) === 'spaceship')).toBeUndefined();
    expect(m.tokens).toHaveLength(0);
  });

  it('gives a usable map for a null plan', () => {
    const m = buildMapFromPlan(null, opts);
    expect(m.rooms.length).toBeGreaterThanOrEqual(1);
    expect(m.terrain.some((t) => t === 'floor')).toBe(true);
  });

  it('is deterministic', () => {
    const a = buildMapFromPlan(plan, { ...opts, placeCreatures: true });
    const b = buildMapFromPlan(plan, { ...opts, placeCreatures: true });
    expect(stripIds(a)).toEqual(stripIds(b));
  });

  it('starts fully fogged', () => {
    const m = buildMapFromPlan(plan, opts);
    expect(m.fog.every((f) => f === 0)).toBe(true);
  });
});
