import { Fragment } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { OBJECT_KINDS, TEMPLATE_EFFECTS, TEMPLATE_SHAPES, TERRAINS, type Terrain } from '../../shared/types';
import { EFFECTS, SPELLS, spellByName } from '../render/spells';
import { secretFor } from '../local';
import { navigate } from '../nav';
import { fromDmMap } from '../render/adapt';
import { dmImages } from '../images';
import { MapView } from '../render/mapView';
import { PALETTES, TERRAIN_LABEL, swatch } from '../render/palette';
import { Icon, Logo, Modal, NumField, QR, Seg, Switch, confirmDialog, copy, useStore } from '../ui';
import { Inspector } from './Inspector';
import { GeneratePanel } from './panels/GeneratePanel';
import { InitiativePanel, advance } from './panels/InitiativePanel';
import { MapPanel } from './panels/MapPanel';
import { TablePanel, playerLink } from './panels/TablePanel';
import { TokensPanel } from './panels/TokensPanel';
import { DmCtl, type Tab, type Tool } from './state';
import { attachTools } from './tools';

const TOOLS: { id: Tool; icon: string; label: string; key: string }[] = [
  { id: 'select', icon: 'select', label: 'Select & move', key: 'V' },
  { id: 'paint', icon: 'brush', label: 'Paint terrain', key: 'B' },
  { id: 'door', icon: 'door', label: 'Doors', key: 'D' },
  { id: 'object', icon: 'box', label: 'Objects', key: 'O' },
  { id: 'fog', icon: 'eye', label: 'Fog of war', key: 'F' },
  { id: 'ruler', icon: 'ruler', label: 'Measure', key: 'R' },
  { id: 'template', icon: 'circle', label: 'Spell areas', key: 'T' },
  { id: 'draw', icon: 'pen', label: 'Draw', key: 'P' },
  { id: 'label', icon: 'text', label: 'Label', key: 'L' },
  { id: 'ping', icon: 'ping', label: 'Ping players', key: 'G' },
];

const TABS: { id: Tab; label: string }[] = [
  { id: 'generate', label: 'Generate' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'initiative', label: 'Initiative' },
  { id: 'map', label: 'Map' },
  { id: 'table', label: 'Table' },
];

const OBJECT_EMOJI: Record<string, string> = { stairs: '🪜', chest: '🧰', table: '🪵', pillar: '🏛️', altar: '🕯️', statue: '🗿', bed: '🛏️', barrel: '🛢️', campfire: '🔥', trap: '⚠️' };
const COLORS = ['#f97316', '#ef4444', '#facc15', '#22c55e', '#38bdf8', '#a855f7', '#f4ead5'];

export function DmApp({ code }: { code: string }) {
  const ctl = useMemo(() => new DmCtl(code), [code]);
  useEffect(() => () => ctl.destroy(), [ctl]);
  const fatal = useStore(ctl, (s) => s.fatal);
  if (fatal) return <Fatal code={code} reason={fatal} />;
  return <DmScreen ctl={ctl} />;
}

function Fatal({ code, reason }: { code: string; reason: string }) {
  return (
    <div class="home">
      <div class="card home-card" style={{ width: 'min(480px, 100%)' }}>
        <div class="row"><Logo class="logo" /><h2>{reason === 'bad-secret' ? 'This key doesn’t open that game' : 'You’re not the DM here (yet)'}</h2></div>
        <p>This browser doesn't hold the DM key for game <b style={{ letterSpacing: '0.15em' }}>{code}</b>. Open the DM link from the device that started the game (it's under <b>Table → Copy DM link</b>), or join as a player.</p>
        <div class="row">
          <button class="btn grow" onClick={() => navigate('/')}>Home</button>
          <button class="btn primary grow" onClick={() => navigate(`/play/${code}`)}>Join as player</button>
        </div>
      </div>
    </div>
  );
}

function DmScreen({ ctl }: { ctl: DmCtl }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<MapView | null>(null);
  const s = useStore(ctl, (st) => st);
  const game = s.game;
  const map = ctl.map;

  // Canvas lifecycle.
  useEffect(() => {
    const v = new MapView(hostRef.current!);
    v.dm = true;
    attachTools(v, ctl);
    setView(v);
    // Handle for end-to-end tests and debugging from the console.
    (window as unknown as { __dm: unknown }).__dm = { ctl, view: v };
    return () => v.destroy();
  }, [ctl]);

  // Feed state into the canvas.
  useEffect(() => {
    if (!view) return;
    view.setMap(map ? fromDmMap(map, dmImages(s.game?.images)) : null, `${map?.id}:${s.staticVer}`, `${map?.id}:${s.fogVer}`);
    view.overlay = {
      ...view.overlay,
      selectedTokenId: s.selected[0] ?? null,
      selectedIds: new Set(s.selected),
      pings: s.pings,
      showRoomNames: s.showRooms,
      showFogTint: s.fogTint,
    };
  }, [view, s.ver, s.staticVer, s.fogVer, s.mapId, s.selected, s.pings, s.showRooms, s.fogTint]);

  useEffect(() => { if (view) view.overlay = { ...view.overlay, brush: null, hoverCell: null }; }, [view, s.tool]);

  // Keyboard shortcuts.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable]')) return;
      const m = ctl.map;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? ctl.redoStep() : ctl.undoStep(); return; }
      if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); ctl.redoStep(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ' ') { if (view) view.spaceDown = true; e.preventDefault(); return; }
      const tool = TOOLS.find((t) => t.key.toLowerCase() === k);
      if (tool) { ctl.setTool(tool.id); return; }
      if (e.key === 'Escape') { ctl.set({ selected: [], other: null }); ctl.setTool('select'); return; }
      if (k === 'n' && m?.initiative.entries.length) { advance(ctl, e.shiftKey ? -1 : 1, view); return; }
      if (k === '0' && view) { view.fit(); return; }
      if ((k === '=' || k === '+') && view) { view.zoomBy(1.25); return; }
      if (k === '-' && view) { view.zoomBy(0.8); return; }
      if (k === '[') { ctl.setOpts({ brush: Math.max(1, ctl.state.opts.brush - (ctl.state.opts.brush > 3 ? 2 : 1)) }); return; }
      if (k === ']') { ctl.setOpts({ brush: Math.min(7, ctl.state.opts.brush + (ctl.state.opts.brush >= 3 ? 2 : 1)) }); return; }
      if (k === 'tab') { e.preventDefault(); ctl.togglePanel(); return; }
      if (!m) return;
      const sel = m.tokens.filter((t) => ctl.state.selected.includes(t.id));
      if ((e.key === 'Delete' || e.key === 'Backspace')) {
        if (ctl.state.other) { ctl.dispatch({ t: 'item.delete', mapId: m.id, coll: ctl.state.other.coll, id: ctl.state.other.id }); ctl.set({ other: null }); }
        else if (sel.length) { ctl.begin(); sel.forEach((t) => ctl.dispatch({ t: 'item.delete', mapId: m.id, coll: 'tokens', id: t.id })); ctl.end(); ctl.set({ selected: [] }); }
        return;
      }
      if (k === 'h' && sel.length) { ctl.begin(); sel.forEach((t) => ctl.dispatch({ t: 'item.put', mapId: m.id, coll: 'tokens', item: { ...t, hidden: !t.hidden } })); ctl.end(); return; }
      const dir: Record<string, [number, number]> = { arrowup: [0, -1], arrowdown: [0, 1], arrowleft: [-1, 0], arrowright: [1, 0] };
      if (dir[k] && sel.length) {
        e.preventDefault();
        const [dx, dy] = dir[k];
        ctl.begin();
        sel.forEach((t) => ctl.dispatch({ t: 'item.put', mapId: m.id, coll: 'tokens', item: { ...t, x: Math.max(0, Math.min(m.width - t.size, t.x + dx)), y: Math.max(0, Math.min(m.height - t.size, t.y + dy)) } }));
        ctl.end();
      }
    };
    const up = (e: KeyboardEvent) => { if (e.key === ' ' && view) view.spaceDown = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [ctl, view]);

  const live = ctl.live;
  const editingLive = !!map && map.id === game?.liveMapId;
  const link = playerLink(s.code);

  return (
    <div class="dm">
      <header class="topbar">
        <a class="brand" href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}><Logo class="" /> <span class="hide-sm">DnD Map</span></a>
        <button class="code-pill" onClick={() => ctl.set({ share: true })} title="Invite players">
          {s.code}<span class="btn sm" style={{ letterSpacing: 0, height: '24px' }}><Icon name="users" size={14} /> Invite</span>
        </button>
        <span class="badge" title={`${s.players.length} player${s.players.length === 1 ? '' : 's'} connected`} onClick={() => ctl.openTab('table')} style={{ cursor: 'pointer' }}>
          <Icon name="users" size={13} /> {s.players.length}
        </span>
        {game?.screen.blank && <span class="badge" style={{ color: '#fde68a', borderColor: '#6b5a22' }}>Screens blank</span>}
        <div class="spacer" />
        {map && (
          editingLive ? <span class="badge live hide-sm" title="Players are looking at this map">Players see this map</span> : (
            <span class="row hide-sm">
              <span class="small muted">Editing privately · players see <b style={{ color: 'var(--text)' }}>{live?.name ?? 'nothing'}</b></span>
              <button class="btn sm primary" onClick={() => ctl.dispatch({ t: 'game.patch', liveMapId: map.id })}>Show this map</button>
            </span>
          )
        )}
        <span class={`dot ${s.status}`} title={s.status === 'open' ? 'Connected' : s.status === 'connecting' ? 'Connecting…' : 'Offline: changes will sync when you reconnect'} />
        <button class="btn ghost icon" disabled={!s.canUndo} onClick={() => ctl.undoStep()} title="Undo (Ctrl+Z)"><Icon name="undo" /></button>
        <button class="btn ghost icon" disabled={!s.canRedo} onClick={() => ctl.redoStep()} title="Redo (Ctrl+Shift+Z)"><Icon name="redo" /></button>
        <button class={`btn ghost icon${s.panelOpen ? ' on' : ''}`} onClick={() => ctl.togglePanel()} title="Toggle side panel (Tab)"><Icon name="panel" /></button>
      </header>

      <div class="dm-body">
        <nav class="rail" aria-label="Tools">
          {TOOLS.map((t, i) => (
            <Fragment key={t.id}>
              {(i === 5) && <span class="sep" />}
              <button class={`tool${s.tool === t.id ? ' on' : ''}`} onClick={() => ctl.setTool(t.id)} aria-label={t.label} aria-pressed={s.tool === t.id}>
                <Icon name={t.icon} />
                <span class="tip">{t.label} <span class="kbd">{t.key}</span></span>
              </button>
            </Fragment>
          ))}
        </nav>

        <div class="stage" ref={hostRef}>
          {map && <ToolBar ctl={ctl} />}
          {map && (s.selected.length > 0 || s.other) && <Inspector ctl={ctl} />}
          {map && game?.screen.banner && <div class="banner banner-preview" title="Players see this banner">{game.screen.banner}</div>}
          {map && (
            <div class="map-chip">
              <b style={{ color: 'var(--text)' }}>{map.name}</b> · {map.width}×{map.height} · 1 square = 5 ft
            </div>
          )}
          {map && view && (
            <div class="zoom-ctl">
              <button class="btn icon" onClick={() => view.zoomBy(1.25)} title="Zoom in (+)"><Icon name="plus" /></button>
              <button class="btn icon" onClick={() => view.zoomBy(0.8)} title="Zoom out (-)"><Icon name="minus" /></button>
              <button class="btn icon" onClick={() => view.fit()} title="Fit map (0)"><Icon name="fit" /></button>
            </div>
          )}
          {!map && (
            <div class="stage-empty">
              <div class="card">
                <Logo />
                <h2>{s.status === 'open' || game ? 'Your table is ready' : 'Connecting to your table…'}</h2>
                <p class="muted" style={{ margin: 0 }}>Generate a map from the panel on the right, describe one to the AI, or start blank. Players can already join with code <b style={{ letterSpacing: '0.15em', color: 'var(--gold-2)' }}>{s.code}</b>.</p>
                <div class="row" style={{ justifyContent: 'center' }}>
                  <button class="btn primary" onClick={() => ctl.openTab('generate')}><Icon name="sparkle" /> Make a map</button>
                  <button class="btn" onClick={() => ctl.set({ share: true })}><Icon name="users" /> Invite players</button>
                </div>
              </div>
            </div>
          )}
        </div>

        <aside class={`panel${s.panelOpen ? '' : ' collapsed'}`}>
          <div class="tabs" role="tablist">
            {TABS.map((t) => <button key={t.id} role="tab" aria-selected={s.tab === t.id} class={s.tab === t.id ? 'on' : ''} onClick={() => ctl.set({ tab: t.id })}>{t.label}</button>)}
          </div>
          <div class="panel-body">
            {s.tab === 'generate' && <GeneratePanel ctl={ctl} />}
            {s.tab === 'tokens' && <TokensPanel ctl={ctl} view={view} />}
            {s.tab === 'initiative' && <InitiativePanel ctl={ctl} view={view} />}
            {s.tab === 'map' && <MapPanel ctl={ctl} />}
            {s.tab === 'table' && <TablePanel ctl={ctl} />}
          </div>
        </aside>
      </div>

      {s.share && (
        <Modal title="Invite your players" onClose={() => ctl.set({ share: false })}>
          <p class="muted" style={{ margin: 0 }}>Scan with a phone, or open the link and enter the code.</p>
          <QR text={link} />
          <div style={{ textAlign: 'center', font: '700 34px var(--ui)', letterSpacing: '0.3em', color: 'var(--gold-2)' }}>{s.code}</div>
          <div class="copyline"><input class="input" readOnly value={link} onFocus={(e) => e.currentTarget.select()} /><button class="btn" onClick={() => copy(link)}><Icon name="copy" size={15} /> Copy</button></div>
          <div class="divider" />
          <details>
            <summary class="small muted" style={{ cursor: 'pointer' }}>Run this game from another device (DM link)</summary>
            <p class="hint">This link gives full DM control. Don't share it with players.</p>
            <button class="btn sm" onClick={() => copy(`${location.origin}/dm/${s.code}#${secretFor(s.code) ?? s.secret}`, 'DM link')}><Icon name="link" size={14} /> Copy DM link</button>
          </details>
        </Modal>
      )}
    </div>
  );
}

/** Options for the active tool, floating over the map. */
function ToolBar({ ctl }: { ctl: DmCtl }) {
  const tool = useStore(ctl, (s) => s.tool);
  const o = useStore(ctl, (s) => s.opts);
  const theme = ctl.map?.theme ?? 'dungeon';
  const pal = PALETTES[theme];
  const brush = (
    <Seg value={o.brush} onChange={(b) => ctl.setOpts({ brush: b })} options={[1, 2, 3, 5, 7].map((b) => ({ v: b, label: `${b}`, title: `${b}×${b} brush ([ and ])` }))} />
  );
  let body = null;
  switch (tool) {
    case 'select':
      body = <span class="small muted">Click a token to select · drag to move · shift-click for groups · click doors to open/close · arrows nudge · <span class="kbd">H</span> hide · <span class="kbd">Del</span> remove</span>;
      break;
    case 'paint':
      body = (
        <>
          <div class="swatches">
            {(TERRAINS as readonly Terrain[]).map((t) => (
              <button key={t} class={`sw${o.terrain === t ? ' on' : ''}`} style={{ background: swatch(t, pal) }} title={`${TERRAIN_LABEL[t]}${t === 'void' ? ' (eraser)' : ''}`} aria-label={TERRAIN_LABEL[t]} onClick={() => ctl.setOpts({ terrain: t })} />
            ))}
          </div>
          <span class="small" style={{ minWidth: '92px' }}>{TERRAIN_LABEL[o.terrain]}</span>
          {brush}
          <Switch checked={o.autoWalls} onChange={(v) => ctl.setOpts({ autoWalls: v })} label={<span class="small">Auto walls</span>} title="Wrap new ground in walls automatically" />
          <span class="small faint">Alt-click picks</span>
        </>
      );
      break;
    case 'door':
      body = (
        <>
          <span class="small muted">New doors:</span>
          <Seg value={o.doorState} onChange={(d) => ctl.setOpts({ doorState: d })} options={[{ v: 'closed', label: 'Closed' }, { v: 'open', label: 'Open' }, { v: 'secret', label: 'Secret' }]} />
          <span class="small faint">Click a door to cycle closed → open → secret → gone · shift-click removes</span>
        </>
      );
      break;
    case 'object':
      body = (
        <>
          <div class="row wrap" style={{ gap: '4px' }}>
            {OBJECT_KINDS.map((k) => (
              <button key={k} class={`btn sm${o.objectKind === k ? ' on' : ''}`} onClick={() => ctl.setOpts({ objectKind: k })} title={k}>{OBJECT_EMOJI[k]} <span class="hide-sm">{k}</span></button>
            ))}
          </div>
          <Switch checked={o.objectHidden} onChange={(v) => ctl.setOpts({ objectHidden: v })} label={<span class="small">Hidden</span>} />
          <span class="small faint">Click empty floor to place, click an object to remove, alt-click to hide/show</span>
        </>
      );
      break;
    case 'fog':
      body = (
        <>
          <Seg value={o.fogMode} onChange={(m) => ctl.setOpts({ fogMode: m })} options={[{ v: 'reveal', label: 'Reveal' }, { v: 'hide', label: 'Hide' }]} />
          <Seg value={o.fogShape} onChange={(m) => ctl.setOpts({ fogShape: m })} options={[{ v: 'room', label: 'Whole room' }, { v: 'brush', label: 'Brush' }]} />
          {o.fogShape === 'brush' && brush}
          <span class="small faint">Alt inverts · rooms fall back to the brush in corridors</span>
        </>
      );
      break;
    case 'ruler':
      body = <span class="small muted">Drag to measure. Start on a token to measure from it.</span>;
      break;
    case 'template': {
      const count = ctl.map?.templates.length ?? 0;
      body = (
        <>
          <select class="input sm" style={{ width: 'auto' }} value={spellByName(o.tplLabel) ? o.tplLabel : ''} aria-label="Spell"
            onChange={(e) => {
              const sp = spellByName(e.currentTarget.value);
              if (sp) ctl.setOpts({ tplShape: sp.shape, tplSize: sp.sizeFt, tplEffect: sp.effect, tplLabel: sp.name, tplColor: EFFECTS[sp.effect].swatch });
              else ctl.setOpts({ tplLabel: '', tplEffect: 'plain' });
            }}>
            <option value="">Any area…</option>
            {SPELLS.map((s) => <option key={s.name} value={s.name}>{s.name} · {s.sizeFt} ft {s.shape}</option>)}
          </select>
          <Seg value={o.tplShape} onChange={(t) => ctl.setOpts({ tplShape: t, tplLabel: spellByName(o.tplLabel) ? '' : o.tplLabel })} options={TEMPLATE_SHAPES.map((t) => ({ v: t, label: t[0].toUpperCase() + t.slice(1) }))} />
          <NumField class="init-num" value={o.tplSize} title="Size in feet (radius for circles, length for cones and lines, side for squares)"
            onCommit={(v) => ctl.setOpts({ tplSize: Math.max(5, Math.min(300, Math.round((v ?? 5) / 5) * 5)) })} />
          <span class="small muted">ft</span>
          <select class="input sm" style={{ width: 'auto' }} value={o.tplEffect} aria-label="Look" onChange={(e) => { const fx = e.currentTarget.value as typeof o.tplEffect; ctl.setOpts({ tplEffect: fx, ...(fx !== 'plain' ? { tplColor: EFFECTS[fx].swatch } : {}) }); }}>
            {TEMPLATE_EFFECTS.map((fx) => <option key={fx} value={fx}>{EFFECTS[fx].label}</option>)}
          </select>
          {o.tplEffect === 'plain' && <div class="swatches">{COLORS.map((c) => <button key={c} class={`sw${o.tplColor === c ? ' on' : ''}`} style={{ background: c }} onClick={() => ctl.setOpts({ tplColor: c })} aria-label={c} />)}</div>}
          {count > 0 && (
            <button class="btn ghost sm" onClick={async () => {
              const map = ctl.map;
              if (!map || !(await confirmDialog(`Clear all ${count} spell areas?`, 'You can undo this with Ctrl+Z.', 'Clear'))) return;
              ctl.begin(); map.templates.forEach((t) => ctl.dispatch({ t: 'item.delete', mapId: map.id, coll: 'templates', id: t.id })); ctl.end();
              ctl.set({ other: null });
            }}><Icon name="trash" size={14} /> Clear all</button>
          )}
          <span class="small faint">Click to place, drag to aim or size · drag a placed area's centre to move it</span>
        </>
      );
      break;
    }
    case 'draw':
      body = (
        <>
          <div class="swatches">{COLORS.map((c) => <button key={c} class={`sw${o.drawColor === c ? ' on' : ''}`} style={{ background: c }} onClick={() => ctl.setOpts({ drawColor: c })} aria-label={c} />)}</div>
          <Seg value={o.drawWidth} onChange={(v) => ctl.setOpts({ drawWidth: v })} options={[{ v: 1, label: 'Thin' }, { v: 2, label: 'Mid' }, { v: 4, label: 'Thick' }]} />
          <Switch checked={o.drawHidden} onChange={(v) => ctl.setOpts({ drawHidden: v })} label={<span class="small">Only me</span>} />
        </>
      );
      break;
    case 'label':
      body = (
        <>
          <div class="swatches">{COLORS.map((c) => <button key={c} class={`sw${o.labelColor === c ? ' on' : ''}`} style={{ background: c }} onClick={() => ctl.setOpts({ labelColor: c })} aria-label={c} />)}</div>
          <Switch checked={o.labelHidden} onChange={(v) => ctl.setOpts({ labelHidden: v })} label={<span class="small">Only me</span>} />
          <span class="small faint">Click the map to place text</span>
        </>
      );
      break;
    case 'ping':
      body = <span class="small muted">Click to ping players · <span class="kbd">Shift</span>-click to also move their view there</span>;
      break;
  }
  return <div class="toolbar-float">{body}</div>;
}
