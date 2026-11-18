import { useEffect, useState } from 'preact/hooks';
import { Icon, QR, Switch, copy, toast, useStore } from '../../ui';
import { DicePad, RollLine } from '../../dice';
import type { DmCtl } from '../state';

export const playerLink = (code: string) => `${location.origin}/play/${code}`;

export function TablePanel({ ctl }: { ctl: DmCtl }) {
  useStore(ctl, (s) => s.ver);
  const players = useStore(ctl, (s) => s.players);
  const rolls = useStore(ctl, (s) => s.rolls);
  const [secret, setSecret] = useState(true);
  const game = ctl.state.game;
  const [banner, setBanner] = useState(game?.screen.banner ?? '');
  const [message, setMessage] = useState(game?.screen.message ?? '');
  useEffect(() => { setBanner(game?.screen.banner ?? ''); }, [game?.screen.banner]);
  if (!game) return null;
  const screen = game.screen;
  const patch = (s: Partial<typeof screen>) => ctl.dispatch({ t: 'game.patch', screen: s }, { undoable: false });
  const link = playerLink(game.code);

  return (
    <div>
      <div class="section">
        <h3>Invite players</h3>
        <div class="row" style={{ alignItems: 'stretch' }}>
          <div class="stack tight grow">
            <span class="label">Game code</span>
            <div style={{ font: '700 28px var(--ui)', letterSpacing: '0.25em', color: 'var(--gold-2)' }}>{game.code}</div>
            <button class="btn sm" onClick={() => copy(link)}><Icon name="link" size={14} /> Copy player link</button>
            <button class="btn sm" onClick={() => ctl.set({ share: true })}>Show QR for the table</button>
          </div>
          <button class="btn ghost" style={{ height: 'auto', padding: '0' }} onClick={() => ctl.set({ share: true })} title="Show a big QR code"><QR text={link} size={104} /></button>
        </div>
      </div>

      <div class="section">
        <div class="row between"><h3>Dice</h3><Switch checked={secret} onChange={setSecret} label="Secret" /></div>
        <DicePad onRoll={(expr, label) => ctl.roll(expr, label, secret)} />
        <span class="hint">{secret ? 'Only you see these rolls.' : 'Everyone at the table sees these rolls.'} Players' rolls show up here too.</span>
        {rolls.length > 0 && (
          <div class="roll-log" aria-label="Recent rolls">
            {rolls.map((r) => <RollLine key={r.id} r={r} mine={r.by === 'DM'} />)}
          </div>
        )}
      </div>

      <div class="section">
        <h3>At the table ({players.length})</h3>
        {players.length === 0 ? <span class="hint">Nobody yet. Players appear here when they open the link.</span> : (
          <div class="watchers">{players.map((p) => <span key={p.id} class="badge"><span class="dot open" />{p.name}</span>)}</div>
        )}
      </div>

      <div class="section">
        <h3>Player screens</h3>
        <Switch checked={screen.blank} onChange={(v) => { patch({ blank: v, message }); toast(v ? 'Player screens blanked' : 'Map is back on player screens', 'ok'); }} label="Blank screens (hide the map)" />
        <label class="field"><span>Message while blank</span>
          <input class="input sm" value={message} maxLength={140} onInput={(e) => setMessage(e.currentTarget.value)} onBlur={() => patch({ message })} placeholder="The story continues shortly…" />
        </label>
        <div class="divider" />
        <label class="field"><span>Banner over the map</span>
          <div class="row">
            <input class="input sm grow" value={banner} maxLength={140} placeholder="e.g. Roll for initiative!" onInput={(e) => setBanner(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && patch({ banner })} />
            <button class="btn sm primary" onClick={() => patch({ banner })} disabled={!banner.trim()}>Show</button>
            {screen.banner && <button class="btn sm" onClick={() => { setBanner(''); patch({ banner: '' }); }}>Clear</button>}
          </div>
        </label>
        <div class="row wrap">
          {['Roll for initiative!', 'Make a Perception check', 'Long rest', 'Session over. Thanks for playing!'].map((b) => (
            <button key={b} class="chip" onClick={() => { setBanner(b); patch({ banner: b }); }}>{b}</button>
          ))}
        </div>
        <div class="divider" />
        <Switch checked={screen.followDm} onChange={(v) => patch({ followDm: v })} label="Players follow my view" />
        <span class="hint">When on, player screens pan and zoom with yours while you're on the live map. Ping a spot with <span class="kbd">G</span>; hold <span class="kbd">Shift</span> to also pull everyone's view there.</span>
      </div>
    </div>
  );
}
