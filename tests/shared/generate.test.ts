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
