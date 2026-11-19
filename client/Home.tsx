import { useEffect, useState } from 'preact/hooks';
import { normalizeCode } from '../shared/types';
import { forgetGame, myGames, pref, rememberGame } from './local';
import { navigate } from './nav';
import { isLocalPage } from './origin';
import { AppearanceButton } from './theme';

/** Running inside the DnD Map desktop app. */
export const isDesktopApp = () => typeof navigator !== 'undefined' && /Electron/.test(navigator.userAgent);
/** Where the DM can download the desktop app. */
const APP_DOWNLOAD = 'https://github.com/bttzren/dnd-map/releases/latest';
import { Icon, Logo, toast } from './ui';

export function Home() {
  const [cfg, setCfg] = useState<{ aiEnabled: boolean; passwordRequired: boolean } | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState(pref.get('name', ''));
  const [games, setGames] = useState(myGames());

  useEffect(() => {
    fetch('/api/config').then((r) => r.json()).then(setCfg).catch(() => setCfg({ aiEnabled: false, passwordRequired: false }));
  }, []);

  const create = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await fetch('/api/games', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? 'Could not start a game');
      rememberGame(body.code, body.dmSecret);
      navigate(`/dm/${body.code}`);
    } catch (err) {
      toast((err as Error).message, 'error', 4000);
    } finally { setBusy(false); }
  };

  const join = (e: Event) => {
    e.preventDefault();
    const c = normalizeCode(code);
    if (c.length < 4) return toast('Enter the code your DM shared', 'error');
    pref.set('name', name.trim());
    navigate(`/play/${c}`);
  };

  return (
    <main class="home">
      <div class="home-inner">
        <div class="home-appearance"><AppearanceButton /></div>
        <header class="hero">
          <Logo />
          <h1>DnD Map</h1>
          <p>Conjure a battle map in seconds, fix it by hand, and put it on every player's screen. They see what you reveal, and nothing more.</p>
        </header>

        <div class="home-grid">
          <form class="card home-card" onSubmit={create}>
            <div class="row"><Icon name="wand" size={22} style={{ color: 'var(--gold-2)' }} /><h2>Run a game</h2></div>
            <p>Start a table, generate a map, and share the code with your players.</p>
            {cfg?.passwordRequired && (
              <label class="field"><span>Host password</span>
                <input class="input" type="password" value={password} onInput={(e) => setPassword(e.currentTarget.value)} autoComplete="current-password" required />
              </label>
            )}
            <button class="btn primary block" style={{ height: '44px' }} disabled={busy || !cfg}>{busy ? <span class="spinner" /> : <Icon name="sparkle" />} Start a new game</button>
            {cfg && <p class="hint">{cfg.aiEnabled ? 'AI map generation is on.' : isLocalPage() ? 'For free AI maps, install Ollama (see Generate). The built-in generator is free and always works.' : 'AI generation is off on this server. The built-in generator is free and always works.'}</p>}
            {games.length > 0 && (
              <div class="stack tight">
                <span class="label">Your games</span>
                <div class="recent">
                  {games.slice(0, 5).map((g) => (
                    <a key={g.code} href={`/dm/${g.code}`} onClick={(e) => { e.preventDefault(); navigate(`/dm/${g.code}`); }}>
                      <span><b style={{ letterSpacing: '0.15em' }}>{g.code}</b> <span class="muted">{g.name}</span></span>
                      <span class="row">
                        <span class="faint small">{new Date(g.at).toLocaleDateString()}</span>
                        <button type="button" class="btn ghost sm icon" title="Forget this game on this device" onClick={(e) => { e.preventDefault(); e.stopPropagation(); forgetGame(g.code); setGames(myGames()); }}><Icon name="x" size={14} /></button>
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </form>

          {isDesktopApp() ? (
            <div class="card home-card">
              <div class="row"><Icon name="users" size={22} style={{ color: 'var(--gold-2)' }} /><h2>Your players</h2></div>
              <p>They don't install anything. Start a game, press <b>Invite</b>, and they scan the QR code with their phone camera (or type the link). They need to be on the same wifi as this computer.</p>
              <p class="hint">The first time, your computer may ask whether DnD Map can accept connections. Choose <b>Allow</b>, or phones won't be able to join.</p>
            </div>
          ) : (
          <form class="card home-card" onSubmit={join}>
            <div class="row"><Icon name="users" size={22} style={{ color: 'var(--gold-2)' }} /><h2>Join a game</h2></div>
            <p>Got a code from your DM? Pop it in. No account needed.</p>
            <label class="field"><span>Game code</span>
              <input class="input big-code" value={code} maxLength={9} placeholder="ABC123" autoCapitalize="characters" autoComplete="off" spellcheck={false}
                onInput={(e) => setCode(e.currentTarget.value.toUpperCase())} />
            </label>
            <label class="field"><span>Your name <span class="faint" style={{ textTransform: 'none', letterSpacing: 0 }}>(optional)</span></span>
              <input class="input" value={name} maxLength={24} placeholder="e.g. Thalia the Bold" onInput={(e) => setName(e.currentTarget.value)} />
            </label>
            <button class="btn primary block" style={{ height: '44px' }}><Icon name="play" /> Join</button>
          </form>
          )}
        </div>

        {!isDesktopApp() && !isLocalPage() && (
          <p class="hint" style={{ textAlign: 'center' }}>
            DM running games at home? <a href={APP_DOWNLOAD} target="_blank" rel="noreferrer">Get the DnD Map app</a> for your computer. Players never need it.
          </p>
        )}

        <div class="feature-row">
          <div class="feature"><b>Instant maps</b><span>Dungeons, caves, crypts, sewers, forests and taverns.</span></div>
          <div class="feature"><b>Fog of war</b><span>Reveal rooms as the party explores. Hidden stays hidden.</span></div>
          <div class="feature"><b>Live on phones</b><span>Players join by code or QR and see moves as you make them.</span></div>
          <div class="feature"><b>Every tool</b><span>Initiative, HP, conditions, spell areas, pings, weather.</span></div>
        </div>
      </div>
    </main>
  );
}

