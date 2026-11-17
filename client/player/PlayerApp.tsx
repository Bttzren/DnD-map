import { useEffect, useRef, useState } from 'preact/hooks';
import { distanceFt } from '../../shared/distance';
import type { PlayerDynamic, PlayerStatic, ServerMsg } from '../../shared/protocol';
import { defaultScreen, type ScreenState } from '../../shared/types';
import { pref } from '../local';
import { Connection, type Status } from '../net';
import { fromPlayerView } from '../render/adapt';
import { MapView } from '../render/mapView';
import type { Ping, RenderToken } from '../render/types';
import { Icon, Logo } from '../ui';
import { navigate } from '../nav';

export function PlayerApp(p: { code: string }) {
  const [name, setName] = useState<string>(pref.get('name', ''));
  const [asked, setAsked] = useState<boolean>(!!pref.get('name', '') || pref.get('skipName', false));
  if (!asked) return <NameSheet onDone={(n) => { if (n) { pref.set('name', n); setName(n); } else pref.set('skipName', true); setAsked(true); }} />;
  return <PlayerView code={p.code} name={name} />;
}

function NameSheet(p: { onDone: (name: string) => void }) {
  const [v, setV] = useState('');
  return (
    <div class="home">
      <form class="card home-card" style={{ width: 'min(420px, 100%)' }} onSubmit={(e) => { e.preventDefault(); p.onDone(v.trim()); }}>
        <div class="row"><Logo class="logo" /><h2>Joining the table</h2></div>
        <label class="field"><span>What should the DM call you?</span>
          <input class="input" value={v} maxLength={24} autoFocus placeholder="Your character's name" onInput={(e) => setV(e.currentTarget.value)} />
        </label>
        <div class="row"><button type="button" class="btn" onClick={() => p.onDone('')}>Skip</button><button class="btn primary grow">Join</button></div>
      </form>
    </div>
  );
}

interface TokenTip { token: RenderToken; sx: number; sy: number }

function PlayerView(p: { code: string; name: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MapView | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [waiting, setWaiting] = useState(false);
  const [screen, setScreen] = useState<ScreenState>(defaultScreen());
  const [stat, setStat] = useState<PlayerStatic | null>(null);
  const [dyn, setDyn] = useState<PlayerDynamic | null>(null);
  const [staticVer, setStaticVer] = useState(0);
  const [ruler, setRuler] = useState(false);
  const [tip, setTip] = useState<TokenTip | null>(null);
  const [showInit, setShowInit] = useState(true);
  const rulerRef = useRef(ruler); rulerRef.current = ruler;
  const pings = useRef<Ping[]>([]);
  const screenRef = useRef(screen); screenRef.current = screen;

  useEffect(() => {
    const view = new MapView(hostRef.current!);
    viewRef.current = view;
    (window as unknown as { __pl: unknown }).__pl = { view };
    const conn = new Connection(
      () => ({ type: 'join', code: p.code, role: 'player', name: p.name }),
      (m: ServerMsg) => {
        if (m.type === 'error' && m.code === 'no-room') { setWaiting(true); setTimeout(() => conn.reconnect(), 4000); }
        if (m.type === 'pview') {
          setWaiting(false);
          if (m.screen) setScreen(m.screen);
          if (m.static !== undefined) { setStat(m.static); setStaticVer((v) => v + 1); }
          if (m.dynamic !== undefined) setDyn(m.dynamic);
        }
        if (m.type === 'ping') {
          pings.current = [...pings.current.filter((x) => performance.now() - x.t0 < 2500), { x: m.x, y: m.y, t0: performance.now(), color: '#facc15' }];
          view.overlay = { ...view.overlay, pings: pings.current };
          if (m.focus) view.centerOn(m.x + 0.5, m.y + 0.5);
          navigator.vibrate?.(30);
        }
        // `zoom` is how many cells across the DM can see; fit the same span here.
        if (m.type === 'view' && screenRef.current.followDm) view.animateTo({ x: m.cx, y: m.cy, z: Math.max(5, Math.min(140, view.size.w / Math.max(4, m.zoom))) });
      },
      setStatus,
    );
    return () => { conn.close(); view.destroy(); };
  }, [p.code]);

  // Push map changes into the canvas.
  useEffect(() => {
    const view = viewRef.current!;
    if (!stat || !dyn || screen.blank) { view.setMap(null, '', ''); return; }
    view.setMap(fromPlayerView(stat, dyn), `${stat.id}:${staticVer}`, '');
  }, [stat, dyn, staticVer, screen.blank]);

  // Until the player pans or zooms, keep what's revealed framed nicely.
  useEffect(() => {
    const view = viewRef.current!;
    if (stat && !view.userMoved && !screen.followDm) view.fit();
  }, [staticVer]);

  // Tools: ruler drags measure; taps on tokens show details.
  useEffect(() => {
    const view = viewRef.current!;
    let from: { x: number; y: number } | null = null;
    const tokenAt = (x: number, y: number) => view.map?.tokens.find((t) => x >= t.x && x < t.x + t.size && y >= t.y && y < t.y + t.size);
    view.handlers = {
      down: (e) => {
        if (!rulerRef.current) return false;
        const t = tokenAt(e.x, e.y);
        from = t ? { x: t.x + (t.size - 1) / 2, y: t.y + (t.size - 1) / 2 } : { x: e.x, y: e.y };
        return true;
      },
      move: (e) => {
        if (!from || !view.map) return;
        const ft = distanceFt(from, { x: e.x, y: e.y }, view.map.settings.distanceRule);
        view.overlay = { ...view.overlay, ruler: { from, to: { x: e.x, y: e.y }, text: `${ft} ft · ${ft / 5} sq` } };
      },
      up: () => { from = null; setTimeout(() => { view.overlay = { ...view.overlay, ruler: null }; }, 1600); },
      cancel: () => { from = null; view.overlay = { ...view.overlay, ruler: null }; },
      tap: (e) => {
        const t = tokenAt(e.x, e.y);
        if (!t) return setTip(null);
        const s = view.toScreen(t.x + t.size / 2, t.y);
        setTip({ token: t, sx: s.x, sy: s.y });
        setTimeout(() => setTip((cur) => (cur?.token.id === t.id ? null : cur)), 3500);
      },
      camera: () => setTip(null),
    };
  }, []);

  const init = dyn?.initiative;
  const map = stat;
  return (
    <div class="player">
      <div class="stage" ref={hostRef} />

      {!screen.blank && map && (
        <div class="pl-top">
          <div class="pl-chip">
            <span class={`dot ${status}`} title={status} />
            <b>{map.name}</b>
          </div>
          <div class="pl-chip scale" title="Each grid square is 5 feet">
            <i style={{ width: '22px' }} /> 5 ft
            {screen.followDm && <span class="badge" style={{ marginLeft: '4px' }}>Following DM</span>}
          </div>
        </div>
      )}

      {screen.banner && !screen.blank && <div class="banner">{screen.banner}</div>}

      {tip && (
        <div class="tooltip" style={{ left: tip.sx, top: tip.sy }}>
          <b>{tip.token.name}</b>
          {tip.token.hpText && <span class="muted"> · {tip.token.hpText}</span>}
          {tip.token.conditions.length > 0 && <div class="small muted">{tip.token.conditions.join(', ')}</div>}
          {tip.token.down && <div class="small" style={{ color: '#f87171' }}>Down</div>}
        </div>
      )}

      {!screen.blank && map && (
        <div class="pl-bottom">
          {init && init.entries.length > 0 && showInit && (
            <div class="init-strip" aria-label="Initiative order">
              <span class="round">Round {init.round || 1}</span>
              {init.entries.map((e) => (
                <span key={e.tokenId} class={`who${e.tokenId === init.activeTokenId ? ' active' : ''}`}>
                  <span class="avatar" style={{ background: e.color, width: '24px', height: '24px', fontSize: '13px' }}>{e.label}</span>{e.name}
                </span>
              ))}
            </div>
          )}
          <div class="pl-actions">
            <button class={`btn${ruler ? ' on' : ''}`} onClick={() => setRuler(!ruler)} aria-pressed={ruler}><Icon name="ruler" /> {ruler ? 'Drag to measure' : 'Measure'}</button>
            <button class="btn icon" style={{ width: '42px' }} onClick={() => viewRef.current?.fit()} aria-label="Fit map to screen"><Icon name="fit" /></button>
            {init && init.entries.length > 0 && <button class={`btn icon${showInit ? ' on' : ''}`} style={{ width: '42px' }} onClick={() => setShowInit(!showInit)} aria-label="Toggle initiative"><Icon name="swords" /></button>}
          </div>
        </div>
      )}

      {screen.blank && (
        <div class="blank"><div class="stack" style={{ justifyItems: 'center' }}><Logo /><h2>{screen.message || 'The story continues shortly…'}</h2><span class={`dot ${status}`} /></div></div>
      )}

      {!screen.blank && !map && (
        <div class="waiting">
          <div class="stack" style={{ justifyItems: 'center', maxWidth: '380px' }}>
            <Logo />
            <h2 style={{ fontSize: '22px' }}>{waiting ? 'Waiting for the DM' : status === 'open' ? 'The DM is preparing the map' : 'Connecting…'}</h2>
            <p class="muted" style={{ margin: 0 }}>
              {waiting ? <>No game with code <b style={{ letterSpacing: '0.15em' }}>{p.code}</b> is running right now. This page will join as soon as the DM opens it.</> : 'Hang tight. The map will appear here the moment it goes live.'}
            </p>
            <button class="btn" onClick={() => navigate('/')}>Use a different code</button>
          </div>
        </div>
      )}
    </div>
  );
}
