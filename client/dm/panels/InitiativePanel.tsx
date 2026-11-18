import { useState } from 'preact/hooks';
import { uid, type Initiative, type InitiativeEntry, type MapData } from '../../../shared/types';
import { Avatar, Icon, NumField, Switch, toast, useStore } from '../../ui';
import type { MapView } from '../../render/mapView';
import type { DmCtl } from '../state';

const d20 = () => 1 + Math.floor(Math.random() * 20);

/** Highest first. Ties keep their current order, so moving entries by hand sticks. */
export function sortEntries(init: Initiative, _map?: MapData): Initiative {
  const active = init.entries[init.turn]?.tokenId;
  const entries = init.entries.slice().sort((a, b) => b.init - a.init);
  return { ...init, entries, turn: active ? entries.findIndex((e) => e.tokenId === active) : init.turn };
}

const CUSTOM_COLORS = ['#71717a', '#a855f7', '#0ea5e9', '#f59e0b', '#ef4444', '#10b981'];

/** "Thalia 18", "Lair actions 20", "Goblins": a name and an optional number. */
export function parseEntry(text: string): { name: string; init: number | null } | null {
  const m = /^(.*?)\s*(-?\d{1,3})?\s*$/.exec(text.trim());
  const name = (m?.[1] ?? '').replace(/[,:;=-]+$/, '').trim();
  if (!name) return null;
  return { name: name.slice(0, 30), init: m?.[2] !== undefined ? parseInt(m[2], 10) : null };
}

export function advance(ctl: DmCtl, dir: 1 | -1, view?: MapView | null) {
  const map = ctl.map;
  if (!map || !map.initiative.entries.length) return;
  const init = map.initiative;
  const n = init.entries.length;
  let turn = init.turn, round = init.round;
  if (turn < 0) { turn = 0; round = 1; }
  else {
    turn += dir;
    if (turn >= n) { turn = 0; round++; }
    if (turn < 0) { turn = n - 1; round = Math.max(1, round - 1); }
  }
  ctl.dispatch({ t: 'map.patch', mapId: map.id, patch: { initiative: { ...init, turn, round } } }, { undoable: false });
  const tk = map.tokens.find((t) => t.id === init.entries[turn]?.tokenId);
  if (tk && view) view.centerOn(tk.x + tk.size / 2, tk.y + tk.size / 2, view.cam.z);
}

export function InitiativePanel({ ctl, view }: { ctl: DmCtl; view: MapView | null }) {
  useStore(ctl, (s) => s.ver);
  const selected = useStore(ctl, (s) => s.selected);
  const map = ctl.map;
  if (!map) return <div class="section"><p class="muted">Generate or create a map first.</p></div>;
  const init = map.initiative;
  const set = (next: Initiative) => ctl.dispatch({ t: 'map.patch', mapId: map.id, patch: { initiative: next } }, { undoable: false });
  const active = init.entries[init.turn]?.tokenId;
  const withEntries = (entries: InitiativeEntry[]): Initiative => {
    let turn = active ? entries.findIndex((e) => e.tokenId === active) : init.turn;
    // If the current turn's entry was removed, the next one in line is up.
    if (turn < 0 && init.turn >= 0) turn = entries.length ? Math.min(init.turn, entries.length - 1) : -1;
    return { ...init, entries, turn };
  };

  /** Type a name (and roll): a token on the map with that name joins; anything else is added as written. */
  const typeIn = (text: string) => {
    // A whole token name wins first, so "Goblin 2" is that goblin, not "Goblin" rolling 2.
    const whole = text.trim().toLowerCase();
    const named = map.tokens.find((t) => t.name.toLowerCase() === whole);
    const p = named ? { name: named.name, init: null } : parseEntry(text);
    if (!p) return false;
    const lower = p.name.toLowerCase();
    const exact = map.tokens.filter((t) => t.name.toLowerCase() === lower);
    const starts = map.tokens.filter((t) => t.name.toLowerCase().startsWith(lower));
    const tok = exact[0] ?? (starts.length === 1 ? starts[0] : undefined);
    const value = p.init ?? (tok && tok.kind !== 'player' ? d20() + (tok.initMod ?? 0) : 0);
    if (tok) {
      const there = init.entries.some((e) => e.tokenId === tok.id);
      const entries = there ? init.entries.map((e) => (e.tokenId === tok.id ? { ...e, init: value } : e)) : [...init.entries, { tokenId: tok.id, init: value }];
      set(sortEntries(withEntries(entries)));
    } else {
      const color = CUSTOM_COLORS[init.entries.filter((e) => e.name).length % CUSTOM_COLORS.length];
      set(sortEntries(withEntries([...init.entries, { tokenId: uid('ent'), init: value, name: p.name, color }])));
    }
    return true;
  };
  const [typed, setTyped] = useState('');

  /** Move an entry up or down by hand. It takes its new neighbour's number, so later sorting keeps it there. */
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= init.entries.length) return;
    const entries = init.entries.slice();
    const [e] = entries.splice(i, 1);
    entries.splice(j, 0, { ...e, init: entries[dir < 0 ? j : j - 1].init });
    set(withEntries(entries));
  };

  const add = (ids: string[], roll: boolean) => {
    const have = new Set(init.entries.map((e) => e.tokenId));
    const fresh = ids.filter((id) => !have.has(id));
    if (!fresh.length) return toast('Already in the order');
    const entries = [...init.entries, ...fresh.map((id) => {
      const t = map.tokens.find((x) => x.id === id)!;
      return { tokenId: id, init: roll || t.kind !== 'player' ? d20() + (t.initMod ?? 0) : 0 };
    })];
    set(sortEntries({ ...init, entries }, map));
  };

  const rollNpcs = () => {
    const entries = init.entries.map((e) => {
      const t = map.tokens.find((x) => x.id === e.tokenId);
      return t && t.kind !== 'player' ? { ...e, init: d20() + (t.initMod ?? 0) } : e;
    });
    set(sortEntries({ ...init, entries }, map));
    toast('Rolled for everyone but the party', 'ok');
  };

  const party = map.tokens.filter((t) => t.kind === 'player').map((t) => t.id);
  const foes = map.tokens.filter((t) => t.kind !== 'player' && !t.down).map((t) => t.id);
  const visibleFoes = map.tokens.filter((t) => t.kind !== 'player' && !t.down && !t.hidden).map((t) => t.id);

  return (
    <div>
      <div class="section">
        <div class="row between">
          <h3>Combat {init.turn >= 0 && <span class="badge" style={{ marginLeft: '6px' }}>Round {init.round}</span>}</h3>
          <Switch checked={init.visible} onChange={(v) => set({ ...init, visible: v })} label="Players see it" />
        </div>
        <div class="row wrap">
          <button class="btn sm" onClick={() => add(party, false)} disabled={!party.length}><Icon name="users" size={15} /> Party</button>
          <button class="btn sm" onClick={() => add(visibleFoes, true)} disabled={!visibleFoes.length} title="Add every visible non-party token and roll for them">Visible foes</button>
          <button class="btn sm" onClick={() => add(foes, true)} disabled={!foes.length} title="Including hidden ones. Players never see hidden tokens in the order.">All foes</button>
          <button class="btn sm" onClick={() => add(selected, true)} disabled={!selected.length}>Selected</button>
        </div>
      </div>

      <div class="section">
        <form class="row" onSubmit={(ev) => { ev.preventDefault(); if (typeIn(typed)) setTyped(''); }}>
          <input class="input sm grow" value={typed} maxLength={40} placeholder="Type a name and roll, e.g. Thalia 18" onInput={(ev) => setTyped(ev.currentTarget.value)} aria-label="Add to the turn order" />
          <button class="btn sm primary" disabled={!parseEntry(typed)}>Add</button>
        </form>
        {init.entries.length === 0 && <p class="hint" style={{ margin: 0 }}>Type names (a token's name adds that token; anything else, like "Lair actions 20", is added as written), or use the buttons above. Use the arrows to reorder. Press <span class="kbd">N</span> for the next turn.</p>}
        <div class="list">
          {init.entries.map((e, i) => {
            const t = map.tokens.find((x) => x.id === e.tokenId);
            const arrows = (
              <span class="init-move" onClick={(ev) => ev.stopPropagation()}>
                <button class="btn ghost sm icon" disabled={i === 0} onClick={() => move(i, -1)} title="Move up" aria-label="Move up">▲</button>
                <button class="btn ghost sm icon" disabled={i === init.entries.length - 1} onClick={() => move(i, 1)} title="Move down" aria-label="Move down">▼</button>
              </span>
            );
            const num = (
              <span onClick={(ev) => ev.stopPropagation()}>
                <NumField class="init-num" value={e.init} onCommit={(v) => set(sortEntries(withEntries(init.entries.map((x) => (x.tokenId === e.tokenId ? { ...x, init: v ?? 0 } : x)))))} />
              </span>
            );
            const remove = (
              <button class="btn ghost sm icon" title="Remove from order" onClick={(ev) => { ev.stopPropagation(); set(withEntries(init.entries.filter((x) => x.tokenId !== e.tokenId))); }}><Icon name="x" size={14} /></button>
            );
            if (!t) {
              if (!e.name) return null;
              return (
                <div key={e.tokenId} class={`item${i === init.turn ? ' active' : ''}${e.hidden ? ' dim' : ''}`}>
                  {num}
                  <Avatar label={e.name.slice(0, 1).toUpperCase()} color={e.color ?? '#71717a'} />
                  <span class="name">{e.name}{e.hidden && <span class="faint"> · hidden</span>}</span>
                  {arrows}
                  <button class="btn ghost sm icon" title={e.hidden ? 'Hidden from players. Click to show' : 'Players see it. Click to hide'}
                    onClick={() => set(withEntries(init.entries.map((x) => (x.tokenId === e.tokenId ? { ...x, hidden: !x.hidden } : x))))}>
                    <Icon name={e.hidden ? 'eyeOff' : 'eye'} size={15} />
                  </button>
                  {remove}
                </div>
              );
            }
            return (
              <div key={e.tokenId} class={`item${i === init.turn ? ' active' : ''}${t.hidden || t.down ? ' dim' : ''}`}
                onClick={() => { ctl.set({ selected: [t.id], other: null }); view?.centerOn(t.x + t.size / 2, t.y + t.size / 2, view.cam.z); }}>
                {num}
                <Avatar label={t.label} color={t.color} image={t.image ? ctl.state.game?.images?.[t.image] : null} />
                <span class="name">{t.name}{t.hidden && <span class="faint"> · hidden</span>}</span>
                {t.hp !== null && <span class="small muted">{t.hp}/{t.maxHp}</span>}
                {arrows}
                {remove}
              </div>
            );
          })}
        </div>
        {init.entries.length > 0 && (
          <>
            <div class="row">
              <button class="btn" onClick={() => advance(ctl, -1, view)} disabled={init.turn < 0} title="Previous turn"><Icon name="prev" /></button>
              <button class="btn primary grow" onClick={() => advance(ctl, 1, view)}>{init.turn < 0 ? <><Icon name="swords" /> Start combat</> : <><Icon name="next" /> Next turn</>}</button>
            </div>
            <div class="row">
              <button class="btn sm grow" onClick={rollNpcs}><Icon name="dice" size={15} /> Reroll foes</button>
              <button class="btn sm danger grow" onClick={() => set({ ...init, entries: [], turn: -1, round: 0 })}>End combat</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
