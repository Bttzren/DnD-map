// Dice pad and roll display, shared by the DM and player screens. Rolls are
// made on the server; this only sends what to roll and shows the result.
import { useState } from 'preact/hooks';
import { rollBreakdown, type RollResult } from '../shared/dice';

const QUICK = [4, 6, 8, 10, 12, 20, 100];

export function DicePad(p: { onRoll: (expr: string, label: string) => void; compact?: boolean }) {
  const [mod, setMod] = useState(0);
  const [custom, setCustom] = useState('');
  const m = mod ? `${mod > 0 ? '+' : ''}${mod}` : '';
  const roll = (expr: string, label = '') => p.onRoll(expr, label);
  return (
    <div class={`dicepad${p.compact ? ' compact' : ''}`}>
      <div class="dice-quick">
        {QUICK.map((f) => <button key={f} class="die" onClick={() => roll(`d${f}${m}`)} title={`Roll d${f}${m}`}>d{f}</button>)}
      </div>
      <div class="dice-row">
        <button class="btn sm" onClick={() => roll(`d20${m} adv`, 'Advantage')} title="Roll two d20, keep the higher">Advantage</button>
        <button class="btn sm" onClick={() => roll(`d20${m} dis`, 'Disadvantage')} title="Roll two d20, keep the lower">Disadvantage</button>
        <span class="dice-mod" title="Added to every quick roll">
          <button class="btn ghost sm icon" onClick={() => setMod(Math.max(-20, mod - 1))} aria-label="Lower modifier">−</button>
          <b>{m || '+0'}</b>
          <button class="btn ghost sm icon" onClick={() => setMod(Math.min(20, mod + 1))} aria-label="Raise modifier">+</button>
        </span>
      </div>
      <form class="dice-row" onSubmit={(e) => { e.preventDefault(); if (custom.trim()) roll(custom.trim()); }}>
        <input class="input sm grow" value={custom} maxLength={60} placeholder="e.g. 2d6+3 or 8d6" onInput={(e) => setCustom(e.currentTarget.value)} aria-label="Dice to roll" />
        <button class="btn sm primary" disabled={!custom.trim()}>Roll</button>
      </form>
    </div>
  );
}

/** One roll: who, what, the total, and how it came out. */
export function RollLine({ r, mine }: { r: RollResult; mine?: boolean }) {
  return (
    <div class={`roll-line${r.crit ? ` crit-${r.crit}` : ''}${r.secret ? ' secret' : ''}${mine ? ' mine' : ''}`}>
      <span class="roll-who" style={r.color ? { color: r.color } : undefined}>{r.by}</span>
      <span class="roll-what">{r.label ? `${r.label} · ` : ''}{r.text}{r.secret ? ' · secret' : ''}</span>
      <span class="roll-total">{r.total}</span>
      <span class="roll-detail">{rollBreakdown(r)}{r.crit === 'hit' ? ' · natural 20!' : r.crit === 'miss' ? ' · natural 1' : ''}</span>
    </div>
  );
}
