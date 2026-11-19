import { useState } from 'preact/hooks';
import { findMap } from '../../shared/ops';
import { HP_VISIBILITY, TEMPLATE_EFFECTS, TEMPLATE_SHAPES, TOKEN_KINDS, uid, type AreaTemplate, type HpVisibility, type MapObject, type Token } from '../../shared/types';
import { footprint } from '../../shared/grid';
import { templateCells } from '../../shared/templates';
import { EFFECTS } from '../render/spells';
import { TRAPS, TRAP_TYPES, trapSummary, type TrapInfo } from '../../shared/traps';
import { hpLabel } from '../../shared/view';
import { EFFECTS as STATUS_EFFECTS, effectDef, type EffectInfo } from '../../shared/effects';
import { Avatar, Icon, NumField, Seg, Switch, confirmDialog, toast, useStore } from '../ui';
import { fileToIcon, pickImage } from '../images';
import type { DmCtl } from './state';
import { freeSpots } from './tools';

const HPV_LABEL: Record<HpVisibility, string> = { exact: 'Numbers', bar: 'Bar', vague: 'Words', none: 'Nothing' };

export function Inspector({ ctl }: { ctl: DmCtl }) {
  useStore(ctl, (s) => s.ver);
  const selected = useStore(ctl, (s) => s.selected);
  const other = useStore(ctl, (s) => s.other);
  const map = ctl.map;
  const [amount, setAmount] = useState('');
  if (!map) return null;

  if (other) return <OtherCard ctl={ctl} />;
  if (selected.length > 1) {
    const toks = map.tokens.filter((t) => selected.includes(t.id));
    const allHidden = toks.every((t) => t.hidden);
    return (
      <div class="card inspector">
        <div class="head"><Icon name="users" /><b class="grow">{toks.length} tokens selected</b><button class="btn ghost sm icon" onClick={() => ctl.set({ selected: [] })} aria-label="Deselect"><Icon name="x" size={15} /></button></div>
        <div class="section">
          <span class="hint">Drag any of them to move the group. Shift-click to add or remove.</span>
          <div class="row">
            <select class="input sm grow" value="" aria-label="Add an effect to all of them" onChange={(e) => {
              const name = e.currentTarget.value;
              if (!name) return;
              ctl.begin(); toks.forEach((t) => ctl.dispatch({ t: 'item.put', mapId: map.id, coll: 'tokens', item: withEffect(t, name) })); ctl.end();
              toast(`${effectDef(name).label} on ${toks.length} tokens`, 'ok');
              e.currentTarget.value = '';
            }}>
              <option value="">Add an effect to all…</option>
              {GROUPS.map((g) => (
                <optgroup key={g.id} label={g.label}>
                  {STATUS_EFFECTS.filter((x) => x.group === g.id).map((x) => <option key={x.id} value={x.id}>{x.icon} {x.label}</option>)}
                </optgroup>
              ))}
            </select>
            {toks.some((t) => t.conditions.length) && (
              <button class="btn sm" onClick={() => { ctl.begin(); toks.forEach((t) => { const { effectInfo: _e, ...rest } = t; ctl.dispatch({ t: 'item.put', mapId: map.id, coll: 'tokens', item: { ...rest, conditions: [] } }); }); ctl.end(); }}>Clear effects</button>
            )}
          </div>
          <div class="row wrap">
            <button class="btn sm" onClick={() => { ctl.begin(); toks.forEach((t) => ctl.dispatch({ t: 'item.put', mapId: map.id, coll: 'tokens', item: { ...t, hidden: !allHidden } })); ctl.end(); }}>
              <Icon name={allHidden ? 'eye' : 'eyeOff'} size={15} /> {allHidden ? 'Reveal all' : 'Hide all'}
            </button>
            <button class="btn sm danger" onClick={async () => {
              if (!(await confirmDialog(`Delete ${toks.length} tokens?`, 'You can undo this with Ctrl+Z.', 'Delete'))) return;
              ctl.begin(); toks.forEach((t) => ctl.dispatch({ t: 'item.delete', mapId: map.id, coll: 'tokens', id: t.id })); ctl.end();
              ctl.set({ selected: [] });
            }}><Icon name="trash" size={14} /> Delete</button>
          </div>
        </div>
      </div>
    );
  }
  const t = map.tokens.find((x) => x.id === selected[0]);
  if (!t) return null;
  const put = (patch: Partial<Token>, undoable = true) => ctl.dispatch({ t: 'item.put', mapId: map.id, coll: 'tokens', item: { ...t, ...patch } }, { undoable });
  const ratio = t.hp !== null && t.maxHp ? t.hp / t.maxHp : null;

  const applyHp = (sign: 1 | -1) => {
    const n = Math.abs(parseInt(amount, 10));
    if (!Number.isFinite(n) || n === 0 || t.hp === null) return;
    const hp = Math.max(0, Math.min(t.maxHp ?? Infinity, t.hp + sign * n));
    put({ hp, down: hp === 0 ? true : t.down && hp > 0 ? false : t.down });
    setAmount('');
    if (hp === 0) toast(`${t.name} is down!`, 'error');
  };

  const inInit = map.initiative.entries.some((e) => e.tokenId === t.id);
  // Tokens added in a batch are named "Goblin 1", "Goblin 2"...: offer to share a picture with the rest.
  const base = t.name.replace(/\s*\d+$/, '');
  const kin = map.tokens.filter((x) => x.id !== t.id && x.name.replace(/\s*\d+$/, '') === base && x.image !== t.image);
  const pic = t.image ? ctl.state.game?.images?.[t.image] ?? null : null;
  const choosePicture = async () => {
    const file = await pickImage();
    if (!file) return;
    try {
      const icon = await fileToIcon(file);
      ctl.begin();
      ctl.dispatch({ t: 'image.put', id: icon.id, data: icon.data });
      put({ image: icon.id });
      ctl.end();
    } catch (e) { toast((e as Error).message, 'error'); }
  };

  return (
    <div class="card inspector" onKeyDown={(e) => e.stopPropagation()}>
      <div class="head">
        <input class="input sm" style={{ width: '46px', textAlign: 'center', fontSize: '18px', padding: 0 }} value={t.label} maxLength={3} onChange={(e) => put({ label: e.currentTarget.value || '?' })} title="Emoji or initials" />
        <input class="input sm grow" value={t.name} maxLength={40} onChange={(e) => put({ name: e.currentTarget.value || 'Token' })} style={{ fontWeight: 600 }} />
        <button class="btn ghost sm icon" onClick={() => ctl.set({ selected: [] })} aria-label="Close"><Icon name="x" size={15} /></button>
      </div>

      <div class="section">
        <span class="label">Picture</span>
        <div class="pic-row">
          <Avatar label={t.label} color={t.color} image={pic} />
          <button class="btn sm" onClick={() => void choosePicture()}><Icon name="camera" size={15} /> {pic ? 'Change' : 'Upload'}</button>
          {pic && <button class="btn ghost sm" onClick={() => { const { image: _i, ...rest } = t; ctl.dispatch({ t: 'item.put', mapId: map.id, coll: 'tokens', item: rest }); }}>Remove</button>}
        </div>
        {t.image && kin.length > 0 && (
          <button class="btn ghost sm" onClick={() => { ctl.begin(); kin.forEach((x) => ctl.dispatch({ t: 'item.put', mapId: map.id, coll: 'tokens', item: { ...x, image: t.image } })); ctl.end(); toast(`Picture used for ${kin.length} more`, 'ok'); }}>
            Use for the other {kin.length} “{base}”
          </button>
        )}
      </div>

      <div class="section">
        <div class="row between">
          <span class="label">Hit points</span>
          <span class="small muted">Players see: <b style={{ color: 'var(--text)' }}>{t.hidden ? 'nothing (hidden)' : t.hp === null ? 'no HP' : t.hpVisibility === 'exact' ? `${t.hp}/${t.maxHp}` : t.hpVisibility === 'bar' ? 'a bar' : t.hpVisibility === 'vague' ? hpLabel(ratio ?? 1) : 'nothing'}</b></span>
        </div>
        <div class="hp-big">
          <NumField value={t.hp} onCommit={(v) => put({ hp: v, down: v === 0 ? true : t.down })} allowRelative placeholder="HP" title="Current HP (type +5 or -7 to adjust)" />
          <span class="muted">/</span>
          <NumField value={t.maxHp} onCommit={(v) => put({ maxHp: v, hp: t.hp ?? v })} placeholder="max" title="Max HP" />
          <span class="muted small" style={{ marginLeft: '6px' }}>AC</span>
          <NumField value={t.ac} onCommit={(v) => put({ ac: v })} placeholder="–" title="Armor class" />
        </div>
        {ratio !== null && <div class="hpbar"><div style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%`, background: ratio > 0.5 ? '#22c55e' : ratio > 0.25 ? '#f59e0b' : '#ef4444' }} /></div>}
        {t.hp !== null && (
          <div class="row">
            <input class="input sm" style={{ width: '70px' }} inputMode="numeric" placeholder="amount" value={amount} onInput={(e) => setAmount(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyHp(-1); }} />
            <button class="btn sm danger grow" onClick={() => applyHp(-1)}>Damage</button>
            <button class="btn sm grow" style={{ color: '#86efac' }} onClick={() => applyHp(1)}>Heal</button>
          </div>
        )}
        <div class="field"><span>Show players</span>
          <Seg full value={t.hpVisibility} onChange={(v) => put({ hpVisibility: v })} options={HP_VISIBILITY.map((v) => ({ v, label: HPV_LABEL[v] }))} />
        </div>
      </div>

      <EffectsSection t={t} put={put} />

      <div class="section">
        <div class="row wrap">
          <Switch checked={!t.hidden} onChange={(v) => put({ hidden: !v })} label={t.hidden ? 'Hidden from players' : 'Visible to players'} />
          <Switch checked={t.down} onChange={(v) => put({ down: v })} label="Down" />
        </div>
        <div class="row wrap">
          <Seg value={t.kind} onChange={(k) => put({ kind: k })} options={TOKEN_KINDS.map((k) => ({ v: k, label: k[0].toUpperCase() + k.slice(1) }))} />
        </div>
        <div class="row">
          <Seg value={t.size} onChange={(s) => put({ size: Math.min(s, map.width - t.x, map.height - t.y) })} options={[1, 2, 3, 4].map((s) => ({ v: s, label: `${s}×`, title: ['Medium', 'Large', 'Huge', 'Gargantuan'][s - 1] }))} />
          <input type="color" value={t.color.length === 7 ? t.color : '#888888'} onInput={(e) => put({ color: e.currentTarget.value }, false)} title="Colour" style={{ width: '34px', height: '28px', border: 0, background: 'none', padding: 0 }} />
          <span class="small muted">Init</span>
          <NumField class="init-num" value={t.initMod ?? 0} onCommit={(v) => put({ initMod: v ?? 0 })} title="Initiative bonus" />
        </div>
        <label class="field"><span>Notes (only you)</span>
          <textarea class="input" rows={2} value={t.note} maxLength={1000} onChange={(e) => put({ note: e.currentTarget.value })} placeholder="Tactics, loot, secrets…" />
        </label>
        <div class="row wrap">
          {!inInit && <button class="btn sm" onClick={() => {
            const init = map.initiative;
            const roll = t.kind === 'player' ? 0 : 1 + Math.floor(Math.random() * 20) + (t.initMod ?? 0);
            ctl.dispatch({ t: 'map.patch', mapId: map.id, patch: { initiative: { ...init, entries: [...init.entries, { tokenId: t.id, init: roll }].sort((a, b) => b.init - a.init) } } }, { undoable: false });
            toast(t.kind === 'player' ? 'Added. Set their roll in the Initiative tab.' : `Rolled ${roll} for ${t.name}`, 'ok');
          }}><Icon name="swords" size={14} /> To initiative</button>}
          <button class="btn sm" onClick={() => {
            const [spot] = freeSpots(map, t.x, t.y, 1, t.size);
            if (!spot) return;
            const n = map.tokens.filter((x) => x.name.replace(/ \d+$/, '') === t.name.replace(/ \d+$/, '')).length + 1;
            const copy = { ...structuredClone(t), id: uid('tok'), ...spot, name: `${t.name.replace(/ \d+$/, '')} ${n}` };
            ctl.dispatch({ t: 'item.put', mapId: map.id, coll: 'tokens', item: copy });
            ctl.set({ selected: [copy.id] });
          }}><Icon name="copy" size={14} /> Duplicate</button>
          <button class="btn sm danger" onClick={() => { ctl.dispatch({ t: 'item.delete', mapId: map.id, coll: 'tokens', id: t.id }); ctl.set({ selected: [] }); }}><Icon name="trash" size={14} /> Delete</button>
        </div>
      </div>
    </div>
  );
}

function OtherCard({ ctl }: { ctl: DmCtl }) {
  const other = ctl.state.other!;
  const map = ctl.map!;
  const item = (map[other.coll] as { id: string; hidden?: boolean }[]).find((x) => x.id === other.id);
  if (!item || !findMap(ctl.state.game!, map.id)) return null;
  const trapObj = other.coll === 'objects' ? (item as unknown as MapObject) : null;
  const name = other.coll === 'templates' ? 'Spell area' : other.coll === 'drawings' ? 'Drawing' : trapObj?.trap ? TRAPS[trapObj.trap.type].label : other.coll === 'objects' ? 'Object' : 'Label';
  const put = (patch: Record<string, unknown>) => ctl.dispatch({ t: 'item.put', mapId: map.id, coll: other.coll, item: { ...item, ...patch } } as never);
  return (
    <div class="card inspector" style={{ width: '260px' }}>
      <div class="head"><b class="grow">{name}</b><button class="btn ghost sm icon" onClick={() => ctl.set({ other: null })} aria-label="Close"><Icon name="x" size={15} /></button></div>
      <div class="section">
        {other.coll === 'templates' && (() => {
          const t = item as unknown as AreaTemplate;
          const cells = new Set(templateCells(t, map));
          const caught = map.tokens.filter((tk) => footprint(map, tk.x, tk.y, tk.size).some((c) => cells.has(c)));
          const aimed = t.shape === 'cone' || t.shape === 'line';
          return (
            <>
              <input class="input sm" placeholder="Name (e.g. Fireball)" value={t.label ?? ''} maxLength={24} onChange={(e) => put({ label: e.currentTarget.value })} />
              <Seg value={t.shape} onChange={(v) => put({ shape: v })} options={TEMPLATE_SHAPES.map((s) => ({ v: s, label: s[0].toUpperCase() + s.slice(1) }))} />
              <div class="row">
                <span class="small muted">Size</span>
                <NumField class="init-num" value={t.sizeFt} onCommit={(v) => put({ sizeFt: Math.max(5, Math.min(300, Math.round((v ?? 5) / 5) * 5)) })} />
                <span class="small muted">ft</span>
                {aimed && (
                  <>
                    <button class="btn sm icon" title="Turn left 15°" onClick={() => put({ angle: (t.angle - 15 + 360) % 360 })}>↺</button>
                    <button class="btn sm icon" title="Turn right 15°" onClick={() => put({ angle: (t.angle + 15) % 360 })}>↻</button>
                  </>
                )}
              </div>
              <div class="row">
                <span class="small muted">Look</span>
                <select class="input sm grow" value={t.effect ?? 'plain'} onChange={(e) => { const fx = e.currentTarget.value as AreaTemplate['effect'] & string; put({ effect: fx, ...(fx !== 'plain' ? { color: EFFECTS[fx].swatch } : {}) }); }}>
                  {TEMPLATE_EFFECTS.map((fx) => <option key={fx} value={fx}>{EFFECTS[fx].label}</option>)}
                </select>
              </div>
              <div class="small">
                <span class="muted">Caught ({caught.length}): </span>
                {caught.length ? caught.map((tk) => tk.name).join(', ') : <span class="faint">nobody</span>}
              </div>
              {caught.length > 0 && (
                <button class="btn sm" onClick={() => ctl.set({ other: null, selected: caught.map((tk) => tk.id) })}>Select them</button>
              )}
            </>
          );
        })()}
        {trapObj?.trap && (() => {
          const t = trapObj.trap;
          const info = TRAPS[t.type];
          const setTrap = (patch: Partial<TrapInfo>) => put({ trap: { ...t, ...patch } });
          return (
            <>
              <select class="input sm" value={t.type} onChange={(e) => setTrap({ type: e.currentTarget.value as TrapInfo['type'] })} aria-label="Trap type">
                {TRAP_TYPES.map((k) => <option key={k} value={k}>{TRAPS[k].label}</option>)}
              </select>
              <span class="hint" style={{ margin: 0 }}>{info.hint}</span>
              <Seg full value={t.state} onChange={(v) => setTrap({ state: v })} options={[{ v: 'armed', label: 'Armed' }, { v: 'triggered', label: 'Sprung' }, { v: 'disarmed', label: 'Disarmed' }]} />
              <div class="row">
                <span class="small muted">DC</span>
                <NumField class="init-num" value={t.dc ?? info.dc} onCommit={(v) => setTrap({ dc: Math.max(1, Math.min(40, v ?? info.dc)) })} />
                <span class="small muted">{info.save}</span>
              </div>
              <input class="input sm" value={t.damage ?? ''} placeholder={info.damage} maxLength={60} onChange={(e) => setTrap({ damage: e.currentTarget.value })} aria-label="Damage or effect" title="Damage or effect" />
              <textarea class="input sm" rows={2} value={t.note ?? ''} placeholder="Notes: how to spot or disarm it (only you see this)" maxLength={300} onChange={(e) => setTrap({ note: e.currentTarget.value })} />
              {t.state === 'armed' && (
                <button class="btn sm danger" onClick={() => {
                  // Sprung: show it to everyone and point it out.
                  put({ hidden: false, trap: { ...t, state: 'triggered' } });
                  ctl.ping(trapObj.x, trapObj.y, false);
                  toast(`${info.label} sprung: ${trapSummary(t)}`, 'error', 5000);
                }}><Icon name="trap" size={14} /> Spring it (show players)</button>
              )}
              {t.state !== 'armed' && <button class="btn sm" onClick={() => setTrap({ state: 'armed' })}>Re-arm</button>}
            </>
          );
        })()}
        {other.coll === 'labels' && (
          <input class="input sm" value={(item as unknown as { text: string }).text} maxLength={60} onChange={(e) => put({ text: e.currentTarget.value || '…' })} />
        )}
        <Switch checked={!item.hidden} onChange={(v) => put({ hidden: !v })} label={item.hidden ? 'Only you see it' : 'Players see it'} />
        <button class="btn sm danger" onClick={() => { ctl.dispatch({ t: 'item.delete', mapId: map.id, coll: other.coll, id: item.id }); ctl.set({ other: null }); }}><Icon name="trash" size={14} /> Delete</button>
      </div>
    </div>
  );
}

const GROUPS: { id: 'condition' | 'helpful' | 'harmful'; label: string }[] = [
  { id: 'condition', label: 'Conditions' }, { id: 'helpful', label: 'Helpful' }, { id: 'harmful', label: 'Harmful' },
];

/** Add an effect to a token (or several): with an optional duration, and secret from players if wanted. */
export function withEffect(t: Token, name: string, info: EffectInfo = {}): Token {
  const conditions = t.conditions.includes(name) ? t.conditions : [...t.conditions, name];
  const effectInfo = { ...(t.effectInfo ?? {}) };
  if (info.rounds !== undefined || info.hidden) effectInfo[name] = { ...effectInfo[name], ...info };
  return { ...t, conditions, ...(Object.keys(effectInfo).length ? { effectInfo } : {}) };
}
function withoutEffect(t: Token, name: string): Token {
  const { effectInfo: old, ...rest } = t;
  const effectInfo = { ...(old ?? {}) };
  delete effectInfo[name];
  return { ...rest, conditions: t.conditions.filter((c) => c !== name), ...(Object.keys(effectInfo).length ? { effectInfo } : {}) };
}

function EffectsSection({ t, put }: { t: Token; put: (patch: Partial<Token>) => void }) {
  const [group, setGroup] = useState<'condition' | 'helpful' | 'harmful'>('condition');
  const [custom, setCustom] = useState('');
  const set = (next: Token) => put({ conditions: next.conditions, effectInfo: next.effectInfo });
  const setInfo = (c: string, patch: EffectInfo) => {
    const cur = { ...(t.effectInfo?.[c] ?? {}), ...patch };
    if (cur.rounds === undefined) delete cur.rounds;
    if (!cur.hidden) delete cur.hidden;
    const effectInfo = { ...(t.effectInfo ?? {}) };
    if (Object.keys(cur).length) effectInfo[c] = cur; else delete effectInfo[c];
    put({ effectInfo: Object.keys(effectInfo).length ? effectInfo : undefined });
  };
  return (
    <div class="section">
      <span class="label">Effects</span>
      {t.conditions.length > 0 && (
        <div class="effect-list">
          {t.conditions.map((c) => {
            const d = effectDef(c), info = t.effectInfo?.[c] ?? {};
            return (
              <div key={c} class={`effect-row${info.hidden ? ' secret' : ''}`} title={d.info}>
                <span class="effect-icon" style={{ background: d.color }}>{d.icon}</span>
                <span class="grow">{d.label}</span>
                <span class="effect-rounds" title="Rounds left (counts down on its turn)">
                  <button class="btn ghost sm icon" onClick={() => setInfo(c, { rounds: info.rounds ? (info.rounds > 1 ? info.rounds - 1 : undefined) : undefined })} aria-label="Fewer rounds">−</button>
                  <b>{info.rounds ? `${info.rounds}r` : '∞'}</b>
                  <button class="btn ghost sm icon" onClick={() => setInfo(c, { rounds: Math.min(99, (info.rounds ?? 0) + 1) })} aria-label="More rounds">+</button>
                </span>
                <button class="btn ghost sm icon" onClick={() => setInfo(c, { hidden: !info.hidden })} title={info.hidden ? 'Secret: only you see it. Click to show players' : 'Players see it. Click to keep it secret'}>
                  <Icon name={info.hidden ? 'eyeOff' : 'eye'} size={14} />
                </button>
                <button class="btn ghost sm icon" onClick={() => set(withoutEffect(t, c))} aria-label={`Remove ${d.label}`}><Icon name="x" size={14} /></button>
              </div>
            );
          })}
        </div>
      )}
      <Seg full value={group} onChange={setGroup} options={GROUPS.map((g) => ({ v: g.id, label: g.label }))} />
      <div class="conds">
        {STATUS_EFFECTS.filter((e) => e.group === group).map((e) => {
          const on = t.conditions.includes(e.id);
          return (
            <button key={e.id} class={`chip effect-chip${on ? ' on' : ''}`} style={on ? { background: e.color } : undefined} title={e.info}
              onClick={() => set(on ? withoutEffect(t, e.id) : withEffect(t, e.id))}>{e.icon} {e.label}</button>
          );
        })}
      </div>
      <form class="row" onSubmit={(ev) => { ev.preventDefault(); const n = custom.trim(); if (n) { set(withEffect(t, n.slice(0, 24))); setCustom(''); } }}>
        <input class="input sm grow" value={custom} maxLength={24} placeholder="Other effect, e.g. Turned" onInput={(ev) => setCustom(ev.currentTarget.value)} />
        <button class="btn sm" disabled={!custom.trim()}>Add</button>
      </form>
    </div>
  );
}
