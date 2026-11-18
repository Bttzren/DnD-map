import { useEffect, useRef, useState } from 'preact/hooks';
import { distanceFt } from '../../shared/distance';
import type { PlayerDynamic, PlayerStatic, ServerMsg } from '../../shared/protocol';
import { defaultScreen, type ScreenState } from '../../shared/types';
import { pref } from '../local';
import { Connection, type Status } from '../net';
import { fromPlayerView } from '../render/adapt';
import { MapView, conditionColor } from '../render/mapView';
import type { Ping, RenderToken } from '../render/types';
import { Avatar, Icon, Logo, Modal, toast } from '../ui';
import { fileToIcon, pickImage, playerImages, type ImageResolver } from '../images';
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
  const rulerRef = useRef(ruler); rulerRef.current = ruler;
  const pings = useRef<Ping[]>([]);
  const screenRef = useRef(screen); screenRef.current = screen;
  const connRef = useRef<Connection | null>(null);
  const [picSheet, setPicSheet] = useState(false);
  // Toasts float just above the buttons and party chips here.
  useEffect(() => { document.body.classList.add('is-player'); return () => document.body.classList.remove('is-player'); }, []);
  const meKey = `me:${p.code}`;
  const [me, setMeState] = useState<string | null>(() => pref.get<string | null>(meKey, null));
  const meRef = useRef(me); meRef.current = me;
  const setMe = (id: string | null) => { pref.set(meKey, id); setMeState(id); };
  const dynRef = useRef<PlayerDynamic | null>(null);
  const img = playerImages(p.code);

  useEffect(() => {
    const view = new MapView(hostRef.current!);
    viewRef.current = view;
    (window as unknown as { __pl: unknown }).__pl = { view };
    const conn = new Connection(
      () => ({ type: 'join', code: p.code, role: 'player', name: p.name }),
      (m: ServerMsg) => {
        if (m.type === 'error' && (m.code === 'not-allowed' || m.code === 'bad-message') && m.message) toast(m.message, 'error');
        if (m.type === 'error' && m.code === 'no-room') { setWaiting(true); setTimeout(() => conn.reconnect(), 4000); }
        if (m.type === 'pview') {
          setWaiting(false);
          if (m.screen) setScreen(m.screen);
          if (m.static !== undefined) { setStat(m.static); setStaticVer((v) => v + 1); }
          if (m.dynamic !== undefined) setDyn(m.dynamic);
        }
        if (m.type === 'ping') {
          pings.current = [...pings.current.filter((x) => performance.now() - x.t0 < 2500), { x: m.x, y: m.y, t0: performance.now(), color: m.color ?? '#facc15', label: m.by && m.by !== 'DM' ? m.by : undefined }];
          view.overlay = { ...view.overlay, pings: pings.current };
          if (m.focus) view.centerOn(m.x + 0.5, m.y + 0.5);
          navigator.vibrate?.(30);
        }
        // `zoom` is how many cells across the DM can see; fit the same span here.
        if (m.type === 'view' && screenRef.current.followDm) view.animateTo({ x: m.cx, y: m.cy, z: Math.max(5, Math.min(140, view.size.w / Math.max(4, m.zoom))) });
      },
      setStatus,
    );
    connRef.current = conn;
    return () => { conn.close(); view.destroy(); };
  }, [p.code]);

  // Push map changes into the canvas.
  useEffect(() => {
    const view = viewRef.current!;
    if (!stat || !dyn || screen.blank) { view.setMap(null, '', ''); return; }
    view.setMap(fromPlayerView(stat, dyn, playerImages(p.code)), `${stat.id}:${staticVer}`, '');
  }, [stat, dyn, staticVer, screen.blank]);

  // Keep the map clear of the turn order above and the party chips below.
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const view = viewRef.current!;
    const measure = () => {
      const next = { top: topRef.current?.getBoundingClientRect().bottom ?? 0, bottom: bottomRef.current ? window.innerHeight - bottomRef.current.getBoundingClientRect().top : 0 };
      const changed = Math.abs(next.top - view.insets.top) > 4 || Math.abs(next.bottom - view.insets.bottom) > 4;
      view.insets = next;
      if (changed) { document.body.style.setProperty('--pl-bottom', `${Math.round(next.bottom)}px`); }
      if (changed && stat && !view.userMoved && !screenRef.current.followDm) view.fit();
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (topRef.current) ro.observe(topRef.current);
    if (bottomRef.current) ro.observe(bottomRef.current);
    return () => ro.disconnect();
  });

  // Once, the first time a map shows up: how to point at things.
  useEffect(() => {
    if (!stat || pref.get('pingTip', false)) return;
    pref.set('pingTip', true);
    setTimeout(() => toast('Tip: press and hold the map to point at a spot for everyone', 'info', 5000), 1200);
  }, [!!stat]);

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
      // Press and hold to point something out to everyone.
      longpress: (e) => {
        if (rulerRef.current) return;
        const mine = dynRef.current?.tokens.find((t) => t.id === meRef.current && t.kind === 'player');
        connRef.current?.send({ type: 'ping', x: e.x, y: e.y, focus: false, ...(mine ? { as: mine.id } : {}) }, false);
        pings.current = [...pings.current.filter((x) => performance.now() - x.t0 < 2500), { x: e.x, y: e.y, t0: performance.now(), color: mine?.color ?? '#7dd3fc' }];
        view.overlay = { ...view.overlay, pings: pings.current };
      },
    };
  }, []);

  dynRef.current = dyn;
  const nothingYet = !!stat && !stat.terrain.some((t) => t !== 'void') && !(dyn?.tokens.length);
  const init = dyn?.initiative;
  const map = stat;
  const party = (dyn?.tokens ?? []).filter((t) => t.kind === 'player');
  const fighting = !!init && init.entries.length > 0;
  const focus = (t: { x: number; y: number; size: number }) => viewRef.current?.centerOn(t.x + t.size / 2, t.y + t.size / 2);
  return (
    <div class="player">
      <div class="stage" ref={hostRef} />

      {!screen.blank && map && (
        <div class="pl-top" ref={topRef}>
          <div class="pl-chip pl-title">
            <span class={`dot ${status}`} title={status === 'open' ? 'Connected' : 'Reconnecting…'} />
            <b>{map.name}</b>
            <span class="scale" title="Each grid square is 5 feet"><i /> 5 ft</span>
            {screen.followDm && <span class="faint small">· following DM</span>}
          </div>
          {fighting && <TurnOrder init={init!} tokens={dyn!.tokens} img={img} onPick={focus} />}
          {screen.banner && <div class="banner">{screen.banner}</div>}
        </div>
      )}

      {!screen.blank && nothingYet && (
        <div class="pl-nothing"><span class="muted">The DM hasn’t revealed any of the map yet.</span></div>
      )}

      {tip && (
        <div class="tooltip" style={{ left: `${tip.sx}px`, top: `${tip.sy}px` }}>
          <b>{tip.token.name}</b>
          {tip.token.hpText && <span class="muted"> · {tip.token.hpText}</span>}
          {tip.token.conditions.length > 0 && <div class="small muted">{tip.token.conditions.join(', ')}</div>}
          {tip.token.down && <div class="small" style={{ color: '#f87171' }}>Down</div>}
        </div>
      )}

      {!screen.blank && map && (
        <div class="pl-bottom" ref={bottomRef}>
          <div class="pl-tools">
            {ruler && <span class="pl-hint">Drag on the map to measure</span>}
            <button class={`round-btn${ruler ? ' on' : ''}`} onClick={() => setRuler(!ruler)} aria-pressed={ruler} aria-label="Measure distance" title="Measure distance"><Icon name="ruler" /></button>
            <button class="round-btn" onClick={() => viewRef.current?.fit()} aria-label="Fit map to screen" title="Fit map to screen"><Icon name="fit" /></button>
            {party.length > 0 && <button class="round-btn" onClick={() => setPicSheet(true)} aria-label="Set your character’s picture" title="Set your character’s picture"><Icon name="camera" /></button>}
          </div>
          {party.length > 0 && (
            <div class="party" aria-label="Party">
              {party.map((t) => <PartyChip key={t.id} t={t} img={img} active={init?.activeTokenId === t.id} onClick={() => focus(t)} />)}
            </div>
          )}
        </div>
      )}

      {picSheet && (
        <PictureSheet code={p.code} party={party} img={img} onClose={() => { setPicSheet(false); setMeState(pref.get<string | null>(meKey, null)); }}
          onSet={(tokenId, pic) => connRef.current?.send(pic ? { type: 'icon', tokenId, id: pic.id, data: pic.data } : { type: 'icon', tokenId, id: null }, false)} />
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

type PToken = PlayerDynamic['tokens'][number];

function hpOf(t: PToken): { ratio: number | null; text: string | null } {
  if (t.hp) return { ratio: t.hp.max ? t.hp.cur / t.hp.max : null, text: `${t.hp.cur}/${t.hp.max}` };
  if (t.hpBar !== null) return { ratio: t.hpBar, text: null };
  return { ratio: null, text: t.hpLabel };
}

const hpColor = (r: number) => (r > 0.5 ? '#22c55e' : r > 0.25 ? '#f59e0b' : '#ef4444');

function PartyChip({ t, img, active, onClick }: { t: PToken; img: ImageResolver; active: boolean; onClick: () => void }) {
  const hp = hpOf(t);
  return (
    <button class={`pchip${active ? ' active' : ''}${t.down ? ' down' : ''}`} onClick={onClick} title={`Show ${t.name} on the map`}>
      <Avatar label={t.label} color={t.color} image={img(t.image)} />
      <span class="pchip-body">
        <span class="pchip-name">{t.name}{t.down && <span class="pchip-down"> · down</span>}</span>
        {hp.ratio !== null && <span class="pchip-bar"><span style={{ width: `${Math.max(0, Math.min(1, hp.ratio)) * 100}%`, background: hpColor(hp.ratio) }} /></span>}
        <span class="pchip-meta">
          {hp.text && <span>{hp.text}</span>}
          {t.conditions.slice(0, 3).map((c) => <span key={c} class="pchip-cond" title={c} style={{ background: conditionColor(c) }}>{c}</span>)}
          {t.conditions.length > 3 && <span class="faint">+{t.conditions.length - 3}</span>}
        </span>
      </span>
    </button>
  );
}

function TurnOrder({ init, tokens, img, onPick }: { init: NonNullable<PlayerDynamic['initiative']>; tokens: PToken[]; img: ImageResolver; onPick: (t: PToken) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector('.turn.active')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [init.activeTokenId]);
  return (
    <div class="turns" ref={ref} aria-label="Turn order">
      <span class="turns-round">Round {init.round || 1}</span>
      {init.entries.map((e) => {
        const t = tokens.find((x) => x.id === e.tokenId);
        const active = e.tokenId === init.activeTokenId;
        return (
          <button key={e.tokenId} class={`turn${active ? ' active' : ''}${t?.kind === 'enemy' ? ' foe' : t?.kind === 'player' ? ' pc' : ''}${t?.down ? ' down' : ''}`}
            onClick={() => t && onPick(t)} aria-current={active ? 'true' : undefined}>
            <Avatar label={e.label} color={e.color} image={img(e.image)} />
            <span class="turn-name">{e.name}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Pick your character, then a photo from the camera roll, the camera or your files. */
function PictureSheet(p: { code: string; party: PToken[]; img: ImageResolver; onClose: () => void; onSet: (tokenId: string, pic: { id: string; data: string } | null) => void }) {
  const key = `me:${p.code}`;
  const [me, setMe] = useState<string | null>(() => pref.get<string | null>(key, null));
  const [busy, setBusy] = useState(false);
  const choose = async (t: PToken) => {
    setMe(t.id); pref.set(key, t.id);
    const file = await pickImage();
    if (!file) return;
    setBusy(true);
    try {
      const pic = await fileToIcon(file);
      p.onSet(t.id, pic);
      toast(`Picture set for ${t.name}`, 'ok');
      p.onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally { setBusy(false); }
  };
  const mine = p.party.find((t) => t.id === me);
  return (
    <Modal title="Your character’s picture" onClose={p.onClose}>
      <div class="stack">
        <p class="muted" style={{ margin: 0 }}>Tap your character, then choose a photo. On a phone you can take one or pick from your camera roll.</p>
        <div class="pic-pick">
          {p.party.map((t) => (
            <button key={t.id} class={`pic-opt${t.id === me ? ' on' : ''}`} disabled={busy} onClick={() => void choose(t)}>
              <Avatar label={t.label} color={t.color} image={p.img(t.image)} />
              <span>{t.name}</span>
              <Icon name="camera" size={16} />
            </button>
          ))}
        </div>
        {busy && <span class="hint">Preparing picture…</span>}
        {mine?.image && (
          <button class="btn ghost" disabled={busy} onClick={() => { p.onSet(mine.id, null); toast(`Picture removed from ${mine.name}`); p.onClose(); }}>
            <Icon name="trash" size={15} /> Remove {mine.name}’s picture
          </button>
        )}
      </div>
    </Modal>
  );
}
