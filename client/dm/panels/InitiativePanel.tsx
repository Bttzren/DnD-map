import type { Initiative, MapData } from '../../../shared/types';
import { Avatar, Icon, NumField, Switch, toast, useStore } from '../../ui';
import type { MapView } from '../../render/mapView';
import type { DmCtl } from '../state';

const d20 = () => 1 + Math.floor(Math.random() * 20);

export function sortEntries(init: Initiative, map: MapData): Initiative {
  const active = init.entries[init.turn]?.tokenId;
  const mod = (id: string) => map.tokens.find((t) => t.id === id)?.initMod ?? 0;
  const entries = init.entries.slice().sort((a, b) => b.init - a.init || mod(b.tokenId) - mod(a.tokenId));
  return { ...init, entries, turn: active ? entries.findIndex((e) => e.tokenId === active) : init.turn };
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
        {init.entries.length === 0 && <p class="hint" style={{ margin: 0 }}>Add tokens, type the party's rolls, then start. Press <span class="kbd">N</span> for the next turn.</p>}
        <div class="list">
          {init.entries.map((e, i) => {
            const t = map.tokens.find((x) => x.id === e.tokenId);
            if (!t) return null;
            return (
              <div key={e.tokenId} class={`item${i === init.turn ? ' active' : ''}${t.hidden || t.down ? ' dim' : ''}`}
                onClick={() => { ctl.set({ selected: [t.id], other: null }); view?.centerOn(t.x + t.size / 2, t.y + t.size / 2, view.cam.z); }}>
                <span onClick={(ev) => ev.stopPropagation()}>
                  <NumField class="init-num" value={e.init} onCommit={(v) => {
                    const entries = init.entries.map((x) => (x.tokenId === e.tokenId ? { ...x, init: v ?? 0 } : x));
                    set(sortEntries({ ...init, entries }, map));
                  }} />
                </span>
                <Avatar label={t.label} color={t.color} image={t.image ? ctl.state.game?.images?.[t.image] : null} />
                <span class="name">{t.name}{t.hidden && <span class="faint"> · hidden</span>}</span>
                {t.hp !== null && <span class="small muted">{t.hp}/{t.maxHp}</span>}
                <button class="btn ghost sm icon" title="Remove from order" onClick={(ev) => {
                  ev.stopPropagation();
                  const entries = init.entries.filter((x) => x.tokenId !== e.tokenId);
                  const active = init.entries[init.turn]?.tokenId;
                  set({ ...init, entries, turn: active ? Math.min(entries.findIndex((x) => x.tokenId === active), entries.length - 1) : init.turn });
                }}><Icon name="x" size={14} /></button>
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
