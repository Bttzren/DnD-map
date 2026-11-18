import { describe, expect, it } from 'vitest';
import { parseDice, rollBreakdown, rollPlan } from '../../shared/dice';

describe('dice', () => {
  it('parses common expressions', () => {
    expect(parseDice('d20')!.text).toBe('1d20');
    expect(parseDice(' 2D6 + 3 ')!.text).toBe('2d6+3');
    expect(parseDice('1d8+1d6-1')!.terms).toHaveLength(2);
    expect(parseDice('d20 adv')!.mode).toBe('adv');
    expect(parseDice('adv')!.text).toBe('1d20 adv');
    expect(parseDice('d20+5 dis')!.mode).toBe('dis');
  });
  it('rejects junk and oversized rolls', () => {
    for (const bad of ['', 'hello', '2d', 'd1', 'd1000', '21d6', '10d6+11d6', '2d20 adv', 'd6 adv', '1d6*2', '3+4', 'x'.repeat(80)]) {
      expect(parseDice(bad), bad).toBeNull();
    }
  });
  it('totals rolls and keeps the right die for advantage', () => {
    const seq = [4, 6, 2];
    const r = rollPlan(parseDice('2d6+3')!, () => seq.shift()!);
    expect(r.total).toBe(13);
    expect(rollBreakdown(r)).toBe('(4+6) + 3');
    const adv = [7, 18];
    const a = rollPlan(parseDice('d20 adv')!, () => adv.shift()!);
    expect(a.total).toBe(18);
    expect(a.groups[0].dropped).toEqual([7]);
    const dis = [7, 18];
    expect(rollPlan(parseDice('d20 dis')!, () => dis.shift()!).total).toBe(7);
    expect(rollPlan(parseDice('d20')!, () => 20).crit).toBe('hit');
    expect(rollPlan(parseDice('d20+4')!, () => 1).crit).toBe('miss');
    expect(rollPlan(parseDice('-1d4+2')!, () => 3).total).toBe(-1);
  });
});
