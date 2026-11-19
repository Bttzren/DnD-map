import { describe, expect, it } from 'vitest';
import { generateMap, generatePlan } from '../../shared/generate';
import { presetById, PRESETS } from '../../shared/presets';
import { THEMES } from '../../shared/types';
import { openRegions } from './helpers';

describe('generateMap', () => {
  for (const theme of THEMES) {
    for (const seed of ['alpha', 'beta', 'gamma']) {
      it(`${theme}/${seed} is a connected map of the right size`, () => {
        const m = generateMap({ theme, width: 40, height: 30, seed });
        expect(m.width).toBe(40);
        expect(m.height).toBe(30);
        expect(m.rooms.length).toBeGreaterThanOrEqual(2);
        expect(openRegions(m)).toBe(1);
      });
    }
    it(`${theme} is deterministic per seed`, () => {
      const a = generateMap({ theme, width: 50, height: 40, seed: 'x', encounter: true, placeCreatures: true });
      const b = generateMap({ theme, width: 50, height: 40, seed: 'x', encounter: true, placeCreatures: true });
      const strip = (m: typeof a) => ({ ...m, id: '', tokens: m.tokens.map((t) => ({ ...t, id: '' })) });
      expect(strip(a)).toEqual(strip(b));
    });
  }

  it('works at the smallest and largest sizes', () => {
    for (const theme of THEMES) {
      expect(openRegions(generateMap({ theme, width: 10, height: 10, seed: 's' }))).toBe(1);
      expect(openRegions(generateMap({ theme, width: 80, height: 80, seed: 's' }))).toBe(1);
    }
  });

  it('packs more rooms at higher density', () => {
    const sparse = generateMap({ theme: 'dungeon', width: 60, height: 50, seed: 'd', density: 'sparse' });
    const packed = generateMap({ theme: 'dungeon', width: 60, height: 50, seed: 'd', density: 'packed' });
    expect(packed.rooms.length).toBeGreaterThan(sparse.rooms.length);
  });
});

describe('generatePlan encounters', () => {
  it('references real rooms and presets', () => {
    const plan = generatePlan({ theme: 'crypt', width: 40, height: 30, seed: 'e', encounter: true });
    expect(plan.creatures.length).toBeGreaterThan(0);
    const roomIds = new Set(plan.rooms.map((r) => r.id));
    for (const c of plan.creatures) {
      expect(roomIds.has(c.room)).toBe(true);
      expect(presetById(c.preset)).toBeDefined();
    }
  });
  it('has no creatures without encounter', () => {
    expect(generatePlan({ theme: 'crypt', width: 40, height: 30, seed: 'e' }).creatures).toHaveLength(0);
  });
});

describe('presets', () => {
  it('has a usable library', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(24);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    expect(PRESETS.filter((p) => p.kind === 'player').length).toBeGreaterThanOrEqual(4);
  });
});

describe('room floors', () => {
  it('gives fitting rooms wooden or checkered floors', async () => {
    const { floorFor } = await import('../../shared/generate');
    expect(floorFor('Throne Room', 'dungeon', 'floor')).toBe('tile');
    expect(floorFor('Library', 'dungeon', 'floor')).toBe('wood');
    expect(floorFor('Chapel', 'crypt', 'floor')).toBe('tile');
    expect(floorFor('Priest\'s Cell', 'crypt', 'floor')).toBe('floor');
    expect(floorFor('Grotto', 'cave', 'floor')).toBe('floor');
    expect(floorFor('Clearing', 'forest', 'grass')).toBe('grass');
  });
  it('puts the new floors on generated maps, and they count as open ground', async () => {
    const { generateMap } = await import('../../shared/generate');
    const { isOpen } = await import('../../shared/grid');
    let seen = new Set<string>();
    for (let i = 0; i < 12; i++) for (const t of generateMap({ theme: 'dungeon', width: 50, height: 40, seed: `floors${i}` }).terrain) seen.add(t);
    expect(seen.has('wood') || seen.has('tile')).toBe(true);
    seen = new Set();
    for (let i = 0; i < 12; i++) for (const t of generateMap({ theme: 'cave', width: 50, height: 40, seed: `shore${i}` }).terrain) seen.add(t);
    expect(seen.has('sand')).toBe(true);
    for (const t of ['wood', 'tile', 'sand', 'snow', 'mud'] as const) expect(isOpen(t)).toBe(true);
  });
});
