import { describe, expect, it } from 'vitest';
import { distanceFt } from '../../shared/distance';
import { makeRng } from '../../shared/rng';
import { normalizeCode } from '../../shared/types';

describe('distanceFt', () => {
  it('counts diagonals as 5 ft under the 5e rule', () => {
    expect(distanceFt({ x: 0, y: 0 }, { x: 3, y: 3 }, '5e')).toBe(15);
    expect(distanceFt({ x: 0, y: 0 }, { x: 4, y: 1 }, '5e')).toBe(20);
  });
  it('alternates 5/10 for diagonals under the alt rule', () => {
    expect(distanceFt({ x: 0, y: 0 }, { x: 3, y: 3 }, 'alt')).toBe(20);
    expect(distanceFt({ x: 0, y: 0 }, { x: 1, y: 1 }, 'alt')).toBe(5);
    expect(distanceFt({ x: 0, y: 0 }, { x: 2, y: 2 }, 'alt')).toBe(15);
  });
  it('uses straight-line feet under euclid', () => {
    expect(distanceFt({ x: 0, y: 0 }, { x: 3, y: 3 }, 'euclid')).toBe(21);
    expect(distanceFt({ x: 0, y: 0 }, { x: 0, y: 6 }, 'euclid')).toBe(30);
  });
  it('is symmetric', () => {
    expect(distanceFt({ x: 7, y: 2 }, { x: 1, y: 5 }, '5e')).toBe(distanceFt({ x: 1, y: 5 }, { x: 7, y: 2 }, '5e'));
  });
});

describe('makeRng', () => {
  it('is deterministic per seed', () => {
    const a = makeRng('a'); const b = makeRng('a');
    const sa = Array.from({ length: 5 }, () => a.next());
    const sb = Array.from({ length: 5 }, () => b.next());
    expect(sa).toEqual(sb);
    expect(makeRng('b').next()).not.toBe(sa[0]);
  });
  it('keeps int() in range', () => {
    const r = makeRng(1);
    for (let i = 0; i < 1000; i++) {
      const v = r.int(1, 6);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
    }
  });
});

describe('normalizeCode', () => {
  it('uppercases and strips spaces', () => {
    expect(normalizeCode(' abc 123 ')).toBe('ABC123');
    expect(normalizeCode('ab-c1.23')).toBe('ABC123');
  });
});
