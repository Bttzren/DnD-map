// Dice expressions like "d20", "2d6+3", "1d8 + 1d6 - 1", "d20 adv".
// Parsing is shared; the rolling itself happens on the server, so nobody can
// fake a result from their browser.

export const MAX_DICE = 20;
export const MAX_FACES = 100;
const MAX_TERMS = 8;

export interface DiceTerm { n: number; faces: number; sign: 1 | -1 }
export interface DicePlan { terms: DiceTerm[]; mod: number; mode: 'normal' | 'adv' | 'dis'; text: string }

export interface DiceGroup { faces: number; sign: 1 | -1; rolls: number[]; dropped?: number[] }
export interface RollResult {
  id: string;
  /** Character or player name. */
  by: string;
  color: string | null;
  text: string;
  label: string;
  groups: DiceGroup[];
  mod: number;
  total: number;
  mode: DicePlan['mode'];
  /** DM-only roll: never sent to players. */
  secret: boolean;
  /** True when every d20 kept was a 20 (or a 1). */
  crit: 'hit' | 'miss' | null;
  at: number;
}

/** Parse a dice expression, or return null if it isn't one we accept. */
export function parseDice(input: string): DicePlan | null {
  let s = String(input ?? '').toLowerCase().replace(/\s+/g, '');
  if (!s || s.length > 60) return null;
  let mode: DicePlan['mode'] = 'normal';
  const m = /(adv|advantage|dis|disadvantage)$/.exec(s);
  if (m) { mode = m[1].startsWith('adv') ? 'adv' : 'dis'; s = s.slice(0, -m[1].length); }
  if (!s) s = 'd20';
  if (!/^[+-]?(\d*d\d+|\d+)([+-](\d*d\d+|\d+))*$/.test(s)) return null;
  const terms: DiceTerm[] = [];
  let mod = 0, dice = 0, count = 0;
  for (const part of s.match(/[+-]?[^+-]+/g) ?? []) {
    if (++count > MAX_TERMS) return null;
    const sign: 1 | -1 = part.startsWith('-') ? -1 : 1;
    const body = part.replace(/^[+-]/, '');
    const d = /^(\d*)d(\d+)$/.exec(body);
    if (d) {
      const n = d[1] ? parseInt(d[1], 10) : 1, faces = parseInt(d[2], 10);
      if (n < 1 || faces < 2 || faces > MAX_FACES) return null;
      dice += n;
      terms.push({ n, faces, sign });
    } else {
      const k = parseInt(body, 10);
      if (!Number.isFinite(k) || k > 999) return null;
      mod += sign * k;
    }
  }
  if (!terms.length || dice > MAX_DICE) return null;
  // Advantage only makes sense with a single d20.
  if (mode !== 'normal' && !(terms.length === 1 && terms[0].n === 1 && terms[0].faces === 20)) return null;
  const text = terms.map((t, i) => `${t.sign < 0 ? '-' : i ? '+' : ''}${t.n}d${t.faces}`).join('') + (mod ? `${mod > 0 ? '+' : ''}${mod}` : '') + (mode === 'normal' ? '' : ` ${mode}`);
  return { terms, mod, mode, text };
}

/** Roll a plan with the given source of integers in [1, faces]. */
export function rollPlan(plan: DicePlan, die: (faces: number) => number): Pick<RollResult, 'groups' | 'mod' | 'total' | 'mode' | 'text' | 'crit'> {
  const groups: DiceGroup[] = [];
  let total = plan.mod;
  let crit: RollResult['crit'] = null;
  for (const t of plan.terms) {
    if (plan.mode !== 'normal') {
      const a = die(20), b = die(20);
      const keep = plan.mode === 'adv' ? Math.max(a, b) : Math.min(a, b);
      groups.push({ faces: 20, sign: 1, rolls: [keep], dropped: [keep === a ? b : a] });
      total += keep;
      crit = keep === 20 ? 'hit' : keep === 1 ? 'miss' : null;
      continue;
    }
    const rolls = Array.from({ length: t.n }, () => die(t.faces));
    groups.push({ faces: t.faces, sign: t.sign, rolls });
    total += t.sign * rolls.reduce((x, y) => x + y, 0);
    if (t.faces === 20 && t.n === 1 && plan.terms.length === 1) crit = rolls[0] === 20 ? 'hit' : rolls[0] === 1 ? 'miss' : null;
  }
  return { groups, mod: plan.mod, total, mode: plan.mode, text: plan.text, crit };
}

/** "12 + 5" style breakdown. */
export function rollBreakdown(r: Pick<RollResult, 'groups' | 'mod'>): string {
  const parts = r.groups.map((g, i) => `${g.sign < 0 ? '− ' : i ? '+ ' : ''}${g.rolls.length > 1 ? `(${g.rolls.join('+')})` : g.rolls[0]}${g.dropped ? ` [${g.dropped.join(',')}]` : ''}`);
  if (r.mod) parts.push(`${r.mod > 0 ? '+' : '−'} ${Math.abs(r.mod)}`);
  return parts.join(' ');
}
