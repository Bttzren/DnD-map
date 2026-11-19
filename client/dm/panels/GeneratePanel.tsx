import { useEffect, useState } from 'preact/hooks';
import { isLocalPage } from '../../origin';
import { THEME_LABEL } from '../../../shared/build';
import { generateMap, type Density } from '../../../shared/generate';
import { idx } from '../../../shared/grid';
import { THEMES, blankMap, uid, type MapData, type Theme } from '../../../shared/types';
import { pref } from '../../local';
import { PALETTES } from '../../render/palette';
import { THEME_TEXTURES } from '../../render/textures';
import { Icon, Seg, Switch, toast, useStore } from '../../ui';
import type { DmCtl } from '../state';
import { freeSpots } from '../tools';

const SIZES = [
  { id: 'S', label: 'Small', w: 24, h: 18 },
  { id: 'M', label: 'Medium', w: 40, h: 30 },
  { id: 'L', label: 'Large', w: 60, h: 44 },
  { id: 'XL', label: 'Huge', w: 80, h: 60 },
];

const EXAMPLES = [
  'A flooded crypt with three burial chambers and a secret vault behind the altar',
  'Goblin warren in a cave: a guard post, a fungus garden, the chief’s throne room over a chasm',
  'Wizard tower basement: library, alchemy lab with a lava forge, summoning circle room',
  'Forest crossroads ambush: a broken wagon, a stream with a ford, bandits hidden in the trees',
  'Smugglers’ sewer junction with a sluice gate, a hidden dock, and a collapsed tunnel',
];

const THEME_EMOJI: Record<Theme, string> = { dungeon: '🏰', cave: '🕳️', crypt: '⚰️', forest: '🌲', tavern: '🍺', sewer: '🐀' };

const randomSeed = () => Math.random().toString(36).slice(2, 8);

export function GeneratePanel({ ctl }: { ctl: DmCtl }) {
  const aiEnabled = useStore(ctl, (s) => s.aiEnabled);
  const aiBusy = useStore(ctl, (s) => s.aiBusy);
  const aiInfo = useStore(ctl, (s) => s.ai);
  const progress = useStore(ctl, (s) => s.aiProgress);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!aiBusy) return;
    const t0 = Date.now(); setElapsed(0);
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [aiBusy]);
  const local = aiInfo?.kind === 'ollama';
  const hasMap = useStore(ctl, (s) => !!s.mapId && !!s.game?.maps.length);
  const [theme, setTheme] = useState<Theme>(pref.get('gen.theme', 'dungeon'));
  const [size, setSize] = useState<string>(pref.get('gen.size', 'M'));
  const [density, setDensity] = useState<Density>(pref.get('gen.density', 'normal'));
  const [encounter, setEncounter] = useState<boolean>(pref.get('gen.encounter', false));
  const [bringParty, setBringParty] = useState<boolean>(pref.get('gen.party', true));
  const [seed, setSeed] = useState(randomSeed());
  const [target, setTarget] = useState<'new' | 'replace'>('new');
  const [prompt, setPrompt] = useState(pref.get('gen.prompt', ''));
  const dims = SIZES.find((s) => s.id === size) ?? SIZES[1];

  const save = () => { pref.set('gen.theme', theme); pref.set('gen.size', size); pref.set('gen.density', density); pref.set('gen.encounter', encounter); pref.set('gen.party', bringParty); };

  const finish = (map: MapData) => {
    if (bringParty) placeParty(ctl, map);
    const isFirst = !ctl.state.game?.maps.length;
    if (target === 'replace' && hasMap) {
      ctl.replaceMap(map);
      toast(`Replaced with "${map.name}"`, 'ok');
    } else {
      ctl.addMap(map, isFirst);
      toast(isFirst ? `"${map.name}" is ready. Players see it now, all fogged.` : `Created "${map.name}". Players still see the live map.`, 'ok', 4000);
    }
    ctl.setTool('select');
  };

  const builtIn = () => {
    save();
    const map = generateMap({ theme, width: dims.w, height: dims.h, seed, density, encounter });
    map.id = uid('map');
    finish(map);
    setSeed(randomSeed());
  };

  const ai = async () => {
    save();
    pref.set('gen.prompt', prompt);
    const map = await ctl.generateAi({ prompt, theme, width: dims.w, height: dims.h, placeCreatures: encounter });
    if (map) { map.id = uid('map'); finish(map); }
  };

  const blank = () => {
    const fill = theme === 'forest' ? 'grass' : 'void';
    const map = blankMap({ width: dims.w, height: dims.h, theme, name: 'Blank map', fill });
    finish(map);
    ctl.setTool('paint');
  };

  return (
    <div>
      <div class="section">
        <h3>Setting</h3>
        <div class="theme-grid">
          {THEMES.map((t) => (
            <button key={t} class={`theme-card${t === theme ? ' on' : ''}`} onClick={() => setTheme(t)} aria-pressed={t === theme}>
              <span class="tsw" style={{ backgroundColor: PALETTES[t].floor, backgroundImage: `url(/textures/${t === 'forest' ? 'grass' : THEME_TEXTURES[t].floor}.webp)` }}>
                <i style={{ backgroundColor: t === 'forest' ? PALETTES[t].trees : PALETTES[t].wallTop, backgroundImage: `url(/textures/${t === 'forest' ? 'grass-dark' : THEME_TEXTURES[t].wall}.webp)` }} />
              </span>
              <span>{THEME_EMOJI[t]} {THEME_LABEL[t].replace(' Clearing', '')}</span>
            </button>
          ))}
        </div>
        <div class="field"><span>Size</span>
          <Seg full value={size} onChange={setSize} options={SIZES.map((s) => ({ v: s.id, label: s.label, title: `${s.w} × ${s.h} squares (${s.w * 5} × ${s.h * 5} ft)` }))} />
          <span class="hint">{dims.w} × {dims.h} squares · {dims.w * 5} × {dims.h * 5} ft</span>
        </div>
        <div class="field"><span>Rooms</span>
          <Seg full value={density} onChange={setDensity} options={[{ v: 'sparse', label: 'Few' }, { v: 'normal', label: 'Some' }, { v: 'packed', label: 'Many' }]} />
        </div>
        <Switch checked={encounter} onChange={setEncounter} label="Add monsters to rooms" />
        <Switch checked={bringParty} onChange={setBringParty} label="Bring the party (player tokens start in the first room)" />
        {hasMap && (
          <div class="field"><span>Put it</span>
            <Seg full value={target} onChange={setTarget} options={[{ v: 'new', label: 'In a new map' }, { v: 'replace', label: 'Over this map' }]} />
          </div>
        )}
      </div>

      <div class="section">
        <h3>Quick generate <span class="faint" style={{ textTransform: 'none', letterSpacing: 0, fontFamily: 'var(--ui)', fontWeight: 500 }}>free · instant</span></h3>
        <div class="row">
          <label class="field grow"><span>Seed</span><input class="input sm" value={seed} onInput={(e) => setSeed(e.currentTarget.value)} /></label>
          <button class="btn sm icon" style={{ alignSelf: 'end' }} title="New random seed" onClick={() => setSeed(randomSeed())}><Icon name="dice" size={16} /></button>
        </div>
        <button class="btn primary block" style={{ height: '40px' }} onClick={builtIn}><Icon name="dice" /> Generate {THEME_LABEL[theme].toLowerCase()}</button>
        <span class="hint">Same seed, same map. Don't like it? Hit generate again.</span>
      </div>

      <div class="section">
        <div class="row between">
          <h3>Describe it to the AI</h3>
          {aiInfo && <span class="badge" style={{ whiteSpace: 'nowrap' }} title={local ? `${aiInfo.model}, free on this computer through Ollama` : `${aiInfo.model || 'Claude'}, through the Anthropic API`}>{local ? 'Local AI' : 'Claude'}</span>}
        </div>
        {local && !aiInfo!.ready && (
          <div class="ai-setup">
            {!aiInfo!.reachable ? (
              isLocalPage() ? (
                <>
                  <b>Free AI maps on this computer</b>
                  <span class="small muted">Install <a href="https://ollama.com/download" target="_blank" rel="noreferrer">Ollama</a> (free), open it, then press Check again. Nothing leaves your computer.</span>
                  <button class="btn sm" onClick={() => ctl.checkAi()}>Check again</button>
                </>
              ) : <span class="small muted">AI is off on this server.</span>
            ) : progress && !progress.error ? (
              <>
                <b>Downloading {aiInfo!.model}…</b>
                <div class="hpbar"><div style={{ width: `${progress.total ? (progress.completed / progress.total) * 100 : 3}%`, background: 'var(--gold)' }} /></div>
                <span class="small muted">{progress.total ? `${(progress.completed / 1e9).toFixed(2)} of ${(progress.total / 1e9).toFixed(2)} GB` : progress.status}. You can keep using the app.</span>
              </>
            ) : (
              <>
                <b>Ollama is running</b>
                <span class="small muted">Download the map model ({aiInfo!.model}, a few GB, once). After that, AI maps are free and work offline.</span>
                <button class="btn sm primary" onClick={() => ctl.pullAi()}><Icon name="download" size={15} /> Download the AI model</button>
              </>
            )}
          </div>
        )}
        <textarea class="input" rows={4} maxLength={1000} value={prompt} placeholder={EXAMPLES[0]} onInput={(e) => setPrompt(e.currentTarget.value)} disabled={!aiEnabled} />
        <div class="row wrap">
          {EXAMPLES.slice(1, 4).map((ex) => (
            <button key={ex} class="chip" disabled={!aiEnabled} onClick={() => setPrompt(ex)} title={ex}>{ex.split(':')[0].split(' with')[0].slice(0, 28)}…</button>
          ))}
        </div>
        <button class="btn primary block" style={{ height: '40px' }} disabled={!aiEnabled || aiBusy} onClick={ai}>
          {aiBusy ? <><span class="spinner" /> Drawing up plans… {elapsed}s{local ? ' (a local model can take a few minutes)' : ''}</> : <><Icon name="sparkle" /> Generate with AI</>}
        </button>
        {!aiEnabled && !local && <span class="hint">AI is off on this server. Whoever hosts it can turn it on by setting <code>ANTHROPIC_API_KEY</code>. The quick generator above is always free.</span>}
      </div>

      <div class="section">
        <h3>Start from scratch</h3>
        <button class="btn block" onClick={blank}><Icon name="brush" /> Blank {dims.label.toLowerCase()} map and paint it</button>
      </div>
    </div>
  );
}

/** Copy the party's tokens from the live map into the first room of a new map. */
function placeParty(ctl: DmCtl, map: MapData) {
  const source = ctl.live ?? ctl.map;
  const party = source?.tokens.filter((t) => t.kind === 'player') ?? [];
  if (!party.length || !map.rooms.length) return;
  const r = map.rooms[0];
  const start = r.cells[Math.floor(r.cells.length / 2)] ?? idx(map, r.x, r.y);
  const spots = freeSpots(map, start % map.width, Math.floor(start / map.width), party.length);
  party.forEach((t, i) => { if (spots[i]) map.tokens.push({ ...structuredClone(t), id: uid('tok'), ...spots[i] }); });
  // The party can see where they're standing.
  for (const s of spots) {
    const room = map.rooms.find((rm) => rm.cells.includes(idx(map, s.x, s.y)));
    for (const c of room?.cells ?? []) map.fog[c] = 1;
  }
}
