import { useState } from 'preact/hooks';
import { PRESETS, type Preset } from '../../../shared/presets';
import { makeToken, TOKEN_KINDS, type TokenKind } from '../../../shared/types';
import { Avatar, Icon, NumField, Seg, toast, useStore } from '../../ui';
import type { MapView } from '../../render/mapView';
import type { DmCtl } from '../state';
import { freeSpots } from '../tools';

const COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#ef4444', '#14b8a6', '#eab308', '#64748b', '#c0392b'];

export function TokensPanel({ ctl, view }: { ctl: DmCtl; view: MapView | null }) {
  useStore(ctl, (s) => s.ver);
  const selected = useStore(ctl, (s) => s.selected);
  const map = ctl.map;
  const [q, setQ] = useState('');
  const [count, setCount] = useState(1);
  const [hiddenAdd, setHiddenAdd] = useState(false);
  const [custom, setCustom] = useState({ name: '', label: '', color: COLORS[0], size: 1, kind: 'player' as TokenKind });

  if (!map) return <div class="section"><p class="muted">Generate or create a map first.</p></div>;

  const addTokens = (make: (n: number) => Parameters<typeof makeToken>[0], n: number, size: number, baseName: string) => {
    const c = view ? view.cam : { x: map.width / 2, y: map.height / 2 };
    const spots = freeSpots(map, Math.floor(c.x), Math.floor(c.y), n, size);
    if (!spots.length) return toast('No free floor near the middle of your view', 'error');
    const existing = map.tokens.filter((t) => t.name.startsWith(baseName)).length;
    ctl.begin();
    const ids: string[] = [];
    spots.forEach((s, i) => {
      const t = makeToken({ ...make(existing + i + 1), ...s });
      ids.push(t.id);
      ctl.dispatch({ t: 'item.put', mapId: map.id, coll: 'tokens', item: t });
    });
    ctl.end();
    ctl.set({ selected: ids, tool: 'select' });
    const outsideFog = spots.some((s) => map.fog[s.y * map.width + s.x] === 0);
    toast(`Added ${spots.length} ${baseName}${spots.length > 1 ? 's' : ''}${hiddenAdd ? ' (hidden)' : outsideFog ? ' in fog: players won’t see them yet' : ''}`, 'ok');
  };

  const addPreset = (p: Preset) => {
    const n = p.kind === 'player' ? 1 : count;
    addTokens((i) => ({
      name: n > 1 || map.tokens.some((t) => t.name.startsWith(p.name)) ? `${p.name} ${i}` : p.name,
      label: p.emoji, color: p.color, size: p.size, kind: p.kind, hp: p.hp, maxHp: p.hp, ac: p.ac, initMod: p.dex,
      hidden: p.kind === 'player' ? false : hiddenAdd, x: 0, y: 0,
    }), n, p.size, p.name);
  };

  const addCustom = (e: Event) => {
    e.preventDefault();
    const name = custom.name.trim() || 'Token';
    const label = custom.label.trim() || name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    addTokens(() => ({ name, label, color: custom.color, size: custom.size, kind: custom.kind, hidden: hiddenAdd && custom.kind !== 'player', x: 0, y: 0 }), 1, custom.size, name);
    setCustom({ ...custom, name: '', label: '' });
  };

  const ql = q.toLowerCase();
  const match = (p: Preset) => !ql || p.name.toLowerCase().includes(ql);
  const groups: [string, Preset[]][] = [
    ['Party', PRESETS.filter((p) => p.kind === 'player' && match(p))],
    ['Monsters', PRESETS.filter((p) => p.kind === 'enemy' && match(p))],
    ['Folk', PRESETS.filter((p) => (p.kind === 'neutral' || p.kind === 'ally') && match(p))],
  ];
  const sorted = map.tokens.slice().sort((a, b) => TOKEN_KINDS.indexOf(a.kind) - TOKEN_KINDS.indexOf(b.kind) || a.name.localeCompare(b.name));

  return (
    <div>
      <div class="section">
        <div class="row">
          <input class="input sm grow" placeholder="Search creatures…" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
          <span class="small muted">×</span>
          <NumField class="init-num" value={count} onCommit={(v) => setCount(Math.max(1, Math.min(12, v ?? 1)))} title="How many to add" />
        </div>
        <label class="switch"><input type="checkbox" checked={hiddenAdd} onChange={(e) => setHiddenAdd(e.currentTarget.checked)} /><span>Add hidden (ambush!)</span></label>
        {groups.map(([title, list]) => list.length > 0 && (
          <div key={title} class="stack tight">
            <span class="label">{title}</span>
            <div class="preset-grid">
              {list.map((p) => (
                <button key={p.id} class="preset" onClick={() => addPreset(p)} title={`${p.name} · HP ${p.hp} · AC ${p.ac}${p.size > 1 ? ` · ${p.size}×${p.size}` : ''}`}>
                  <span class="em">{p.emoji}</span>{p.name}
                </button>
              ))}
            </div>
          </div>
        ))}
        <span class="hint">New tokens appear near the middle of your view. Drag to place.</span>
      </div>

      <form class="section" onSubmit={addCustom}>
        <h3>Custom token</h3>
        <div class="row">
          <input class="input sm" style={{ width: '52px', textAlign: 'center' }} placeholder="🙂" maxLength={3} value={custom.label} onInput={(e) => setCustom({ ...custom, label: e.currentTarget.value })} title="Emoji or initials" />
          <input class="input sm grow" placeholder="Name, e.g. Thalia" maxLength={30} value={custom.name} onInput={(e) => setCustom({ ...custom, name: e.currentTarget.value })} />
        </div>
        <div class="swatches">
          {COLORS.map((c) => <button type="button" key={c} class={`sw${custom.color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => setCustom({ ...custom, color: c })} aria-label={`Colour ${c}`} />)}
        </div>
        <div class="row wrap">
          <Seg value={custom.kind} onChange={(k) => setCustom({ ...custom, kind: k })} options={TOKEN_KINDS.map((k) => ({ v: k, label: k[0].toUpperCase() + k.slice(1) }))} />
          <Seg value={custom.size} onChange={(s) => setCustom({ ...custom, size: s })} options={[1, 2, 3, 4].map((s) => ({ v: s, label: `${s}×`, title: ['Medium', 'Large', 'Huge', 'Gargantuan'][s - 1] }))} />
        </div>
        <button class="btn block"><Icon name="plus" /> Add token</button>
      </form>

      <div class="section">
        <h3>On this map ({map.tokens.length})</h3>
        {sorted.length === 0 && <span class="hint">No tokens yet.</span>}
        <div class="list">
          {sorted.map((t) => (
            <div key={t.id} class={`item${selected.includes(t.id) ? ' on' : ''}${t.hidden ? ' dim' : ''}`}
              onClick={() => { ctl.set({ selected: [t.id], other: null, tool: 'select' }); view?.centerOn(t.x + t.size / 2, t.y + t.size / 2); }}>
              <Avatar label={t.label} color={t.color} image={t.image ? ctl.state.game?.images?.[t.image] : null} />
              <span class="name">{t.name}{t.down && <span class="faint"> · down</span>}</span>
              {t.hp !== null && t.maxHp && <span class="small muted">{t.hp}/{t.maxHp}</span>}
              <button class="btn ghost sm icon" title={t.hidden ? 'Hidden from players. Click to show' : 'Visible to players. Click to hide'}
                onClick={(e) => { e.stopPropagation(); ctl.dispatch({ t: 'item.put', mapId: map.id, coll: 'tokens', item: { ...t, hidden: !t.hidden } }); }}>
                <Icon name={t.hidden ? 'eyeOff' : 'eye'} size={15} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
