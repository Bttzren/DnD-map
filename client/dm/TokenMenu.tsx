// The right-click (or long-press) menu for a token: quick damage and
// healing, common effects, and everyday actions, without opening the
// full inspector.
import { useEffect, useRef, useState } from 'preact/hooks';
import { effectDef } from '../../shared/effects';
import { uid, type Token } from '../../shared/types';
import { Avatar, Icon, toast, useStore } from '../ui';
import { withEffect } from './Inspector';
import type { DmCtl } from './state';
import { freeSpots } from './tools';

const QUICK = ['prone', 'poisoned', 'frightened', 'stunned', 'restrained', 'burning', 'blessed', 'concentrating', 'invisible', 'unconscious'];

export function TokenMenu({ ctl, host }: { ctl: DmCtl; host: HTMLElement | null }) {
  useStore(ctl, (s) => s.ver);
  const menu = useStore(ctl, (s) => s.menu);
  const [amount, setAmount] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const map = ctl.map;
  const t = menu && map?.tokens.find((x) => x.id === menu.tokenId);

  useEffect(() => {
    if (!menu) return;
    setAmount('');
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) ctl.set({ menu: null }); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') ctl.set({ menu: null }); };
    setTimeout(() => document.addEventListener('pointerdown', close), 0);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [menu?.tokenId, menu?.sx, menu?.sy]);

  if (!menu || !t || !map) return null;
  const put = (item: Token) => ctl.dispatch({ t: 'item.put', mapId: map.id, coll: 'tokens', item });
  const close = () => ctl.set({ menu: null });
  const hp = (sign: 1 | -1) => {
    const n = Math.abs(parseInt(amount, 10));
    if (!Number.isFinite(n) || !n || t.hp === null) return;
    const next = Math.max(0, Math.min(t.maxHp ?? Infinity, t.hp + sign * n));
    put({ ...t, hp: next, down: next === 0 ? true : t.down && next > 0 ? false : t.down });
    if (next === 0) toast(`${t.name} is down!`, 'error');
    setAmount('');
  };
  const toggle = (c: string) => {
    if (t.conditions.includes(c)) {
      const { effectInfo: old, ...rest } = t;
      const info = { ...(old ?? {}) }; delete info[c];
      put({ ...rest, conditions: t.conditions.filter((x) => x !== c), ...(Object.keys(info).length ? { effectInfo: info } : {}) });
    } else put(withEffect(t, c));
  };
  const inInit = map.initiative.entries.some((e) => e.tokenId === t.id);

  // Keep the menu on screen.
  const W = 260, H = 330;
  const bw = host?.clientWidth ?? 1000, bh = host?.clientHeight ?? 800;
  const left = Math.max(8, Math.min(menu.sx + 12, bw - W - 8));
  const top = Math.max(8, Math.min(menu.sy - 20, bh - H - 8));

  return (
    <div class="card token-menu" ref={ref} style={{ left: `${left}px`, top: `${top}px` }} role="menu" aria-label={`${t.name} actions`} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
      <div class="tm-head">
        <Avatar label={t.label} color={t.color} image={t.image ? ctl.state.game?.images?.[t.image] : null} />
        <b class="grow">{t.name}</b>
        {t.hp !== null && <span class="small muted">{t.hp}/{t.maxHp}</span>}
        <button class="btn ghost sm icon" onClick={close} aria-label="Close"><Icon name="x" size={14} /></button>
      </div>
      {t.hp !== null && (
        <form class="row" onSubmit={(e) => { e.preventDefault(); hp(-1); }}>
          <input class="input sm grow" inputMode="numeric" value={amount} placeholder="amount" onInput={(e) => setAmount(e.currentTarget.value.replace(/[^0-9]/g, ''))} autoFocus aria-label="Amount" />
          <button class="btn sm danger" type="submit">Damage</button>
          <button class="btn sm ok" type="button" onClick={() => hp(1)}>Heal</button>
        </form>
      )}
      <div class="tm-effects">
        {QUICK.map((c) => {
          const d = effectDef(c), on = t.conditions.includes(c);
          return <button key={c} class={`tm-fx${on ? ' on' : ''}`} style={on ? { background: d.color } : undefined} title={`${d.label}: ${d.info}`} onClick={() => toggle(c)} aria-pressed={on}>{d.icon}</button>;
        })}
      </div>
      <div class="tm-actions">
        <button class="btn sm" onClick={() => put({ ...t, hidden: !t.hidden })}><Icon name={t.hidden ? 'eye' : 'eyeOff'} size={14} /> {t.hidden ? 'Show' : 'Hide'}</button>
        <button class="btn sm" onClick={() => put({ ...t, down: !t.down })}>{t.down ? 'Stand up' : 'Knock down'}</button>
        {!inInit && (
          <button class="btn sm" onClick={() => {
            const init = map.initiative;
            const roll = t.kind === 'player' ? 0 : 1 + Math.floor(Math.random() * 20) + (t.initMod ?? 0);
            const entries = [...init.entries, { tokenId: t.id, init: roll }].sort((a, b) => b.init - a.init);
            const active = init.entries[init.turn]?.tokenId;
            ctl.dispatch({ t: 'map.patch', mapId: map.id, patch: { initiative: { ...init, entries, turn: active ? entries.findIndex((e) => e.tokenId === active) : init.turn } } }, { undoable: false });
            toast(`${t.name} joins the turn order${roll ? ` (${roll})` : ''}`, 'ok');
          }}><Icon name="swords" size={14} /> Initiative</button>
        )}
        <button class="btn sm" onClick={() => {
          const spot = freeSpots(map, t.x, t.y, 1, t.size)[0];
          if (!spot) return toast('No room next to it', 'error');
          put({ ...t, id: uid('tok'), name: t.name.replace(/\s*\d+$/, '') + ` ${map.tokens.filter((x) => x.name.replace(/\s*\d+$/, '') === t.name.replace(/\s*\d+$/, '')).length + 1}`, ...spot, conditions: [], effectInfo: undefined });
        }}><Icon name="copy" size={14} /> Copy</button>
        <button class="btn sm" onClick={() => { close(); ctl.set({ selected: [t.id], panelOpen: ctl.state.panelOpen }); }}>Details…</button>
        <button class="btn sm danger" onClick={() => { ctl.dispatch({ t: 'item.delete', mapId: map.id, coll: 'tokens', id: t.id }); ctl.set({ menu: null, selected: [] }); }}><Icon name="trash" size={14} /> Remove</button>
      </div>
    </div>
  );
}
