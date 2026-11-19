import { useState } from 'preact/hooks';
import { THEME_LABEL } from '../../../shared/build';
import { idx } from '../../../shared/grid';
import { validateMap } from '../../../shared/ops';
import { AMBIENCES, THEMES, uid, type Ambience, type MapData } from '../../../shared/types';
import { Icon, Seg, Switch, confirmDialog, promptDialog, toast, useStore } from '../../ui';
import type { DmCtl } from '../state';
import type { MapView } from '../../render/mapView';
import { TRAPS } from '../../../shared/traps';
import { freeSpots } from '../tools';

const AMBIENCE_LABEL: Record<Ambience, string> = { none: 'Clear', rain: '🌧️ Rain', snow: '❄️ Snow', fog: '🌫️ Mist', embers: '🔥 Embers', dark: '🌑 Dark' };

export function MapPanel({ ctl, view }: { ctl: DmCtl; view?: MapView | null }) {
  useStore(ctl, (s) => s.ver);
  const mapId = useStore(ctl, (s) => s.mapId);
  const showRooms = useStore(ctl, (s) => s.showRooms);
  const fogTint = useStore(ctl, (s) => s.fogTint);
  const game = ctl.state.game;
  const map = ctl.map;
  const [moveTo, setMoveTo] = useState('');
  if (!game) return null;

  const patchSettings = (p: Partial<MapData['settings']>) => map && ctl.dispatch({ t: 'map.patch', mapId: map.id, patch: { settings: { ...map.settings, ...p } } }, { undoable: false });

  const duplicate = (m: MapData) => {
    const copy = { ...structuredClone(m), id: uid('map'), name: `${m.name} (copy)` };
    ctl.addMap(copy, false);
    toast('Duplicated', 'ok');
  };
  const rename = async (m: MapData) => {
    const name = await promptDialog('Rename map', m.name);
    if (name?.trim()) ctl.dispatch({ t: 'map.patch', mapId: m.id, patch: { name: name.trim() } }, { undoable: false });
  };
  const remove = async (m: MapData) => {
    if (!(await confirmDialog(`Delete "${m.name}"?`, 'This removes the map and everything on it. It cannot be undone.', 'Delete map'))) return;
    ctl.dispatch({ t: 'map.delete', mapId: m.id }, { undoable: false });
    const next = ctl.state.game?.liveMapId ?? ctl.state.game?.maps[0]?.id;
    if (next) ctl.editMap(next); else ctl.set({ mapId: null, tab: 'generate' });
  };
  const exportMap = (m: MapData) => {
    const blob = new Blob([JSON.stringify(m)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${m.name.replace(/[^\w\- ]+/g, '').trim() || 'map'}.dndmap.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const importMap = async (file: File) => {
    try {
      const m = JSON.parse(await file.text());
      m.id = uid('map');
      validateMap(m);
      ctl.addMap(m, false);
      toast(`Imported "${m.name}"`, 'ok');
    } catch { toast('That file is not a DnD Map export', 'error'); }
  };
  const moveParty = () => {
    const target = game.maps.find((m) => m.id === moveTo);
    if (!map || !target) return;
    const party = map.tokens.filter((t) => t.kind === 'player');
    if (!party.length) return toast('No player tokens on this map', 'error');
    const room = target.rooms[0];
    const start = room ? room.cells[Math.floor(room.cells.length / 2)] : idx(target, Math.floor(target.width / 2), Math.floor(target.height / 2));
    const spots = freeSpots(target, start % target.width, Math.floor(start / target.width), party.length);
    ctl.begin();
    party.forEach((t, i) => {
      if (!spots[i]) return;
      ctl.dispatch({ t: 'item.delete', mapId: map.id, coll: 'tokens', id: t.id });
      ctl.dispatch({ t: 'item.put', mapId: target.id, coll: 'tokens', item: { ...t, ...spots[i] } });
    });
    ctl.end();
    ctl.dispatch({ t: 'game.patch', liveMapId: target.id });
    ctl.editMap(target.id);
    toast(`The party travels to ${target.name}`, 'ok');
  };

  return (
    <div>
      <div class="section">
        <div class="row between"><h3>Maps</h3>
          <label class="btn sm" title="Import a map file"><Icon name="upload" size={15} /> Import
            <input type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.currentTarget.files?.[0]; if (f) importMap(f); e.currentTarget.value = ''; }} />
          </label>
        </div>
        <div class="list">
          {game.maps.map((m) => (
            <div key={m.id} class={`item${m.id === mapId ? ' on' : ''}`} onClick={() => ctl.editMap(m.id)}>
              <Icon name="map" size={16} />
              <span class="name">{m.name}</span>
              {m.id === game.liveMapId ? <span class="badge live">Live</span> : (
                <button class="btn sm" title="Show this map to players" onClick={(e) => { e.stopPropagation(); ctl.dispatch({ t: 'game.patch', liveMapId: m.id }); toast(`Players now see ${m.name}`, 'ok'); }}>Go live</button>
              )}
            </div>
          ))}
        </div>
        {map && (
          <div class="row wrap">
            <button class="btn sm" onClick={() => rename(map)}>Rename</button>
            <button class="btn sm" onClick={() => duplicate(map)}><Icon name="copy" size={14} /> Duplicate</button>
            <button class="btn sm" onClick={() => exportMap(map)}><Icon name="download" size={14} /> Export</button>
            <button class="btn sm danger" onClick={() => remove(map)}><Icon name="trash" size={14} /> Delete</button>
          </div>
        )}
        <span class="hint">Edit any map privately. Players only ever see the <b>Live</b> one.</span>
      </div>

      {map && (
        <>
          {map.objects.some((o) => o.kind === 'trap') && (() => {
            const traps = map.objects.filter((o) => o.kind === 'trap');
            const armed = traps.filter((o) => o.trap?.state === 'armed').length;
            return (
              <div class="section">
                <h3>Traps ({armed} armed{traps.length > armed ? ` of ${traps.length}` : ''})</h3>
                <div class="list">
                  {traps.map((o) => {
                    const t = o.trap ?? { type: 'spikes' as const, state: 'armed' as const };
                    return (
                      <div key={o.id} class={`item${t.state !== 'armed' ? ' dim' : ''}`} onClick={() => { ctl.set({ other: { coll: 'objects', id: o.id }, selected: [] }); view?.centerOn(o.x + 0.5, o.y + 0.5, view.cam.z); }}>
                        <span class={`trap-dot ${t.state}`} />
                        <span class="name">{TRAPS[t.type].label}{o.hidden ? <span class="faint"> · hidden</span> : <span class="faint"> · players see it</span>}</span>
                        <span class="small muted">{t.state === 'triggered' ? 'sprung' : t.state}</span>
                      </div>
                    );
                  })}
                </div>
                <span class="hint">Set traps with the trap tool (<span class="kbd">X</span>). You're warned when a token steps on an armed one.</span>
              </div>
            );
          })()}
          <div class="section">
            <h3>Fog of war</h3>
            <div class="row">
              <button class="btn sm grow" onClick={() => ctl.dispatch({ t: 'fog.all', mapId: map.id, revealed: true })}><Icon name="eye" size={15} /> Reveal all</button>
              <button class="btn sm grow" onClick={() => ctl.dispatch({ t: 'fog.all', mapId: map.id, revealed: false })}><Icon name="eyeOff" size={15} /> Hide all</button>
            </div>
            <Switch checked={fogTint} onChange={(v) => ctl.set({ fogTint: v })} label="Tint fogged areas on my screen" />
            <Switch checked={showRooms} onChange={(v) => { ctl.set({ showRooms: v }); }} label="Show room names (only you see them)" />
          </div>

          <div class="section">
            <h3>Atmosphere</h3>
            <div class="row wrap">
              {AMBIENCES.map((a) => (
                <button key={a} class={`chip${map.settings.ambience === a ? ' on' : ''}`} style={map.settings.ambience === a ? { background: 'var(--gold-2)' } : undefined} onClick={() => patchSettings({ ambience: a })}>{AMBIENCE_LABEL[a]}</button>
              ))}
            </div>
            <label class="field"><span>Look</span>
              <select class="input sm" value={map.theme} onChange={(e) => ctl.setTheme(e.currentTarget.value as MapData['theme'])}>
                {THEMES.map((t) => <option key={t} value={t}>{THEME_LABEL[t]}</option>)}
              </select>
            </label>
          </div>

          <div class="section">
            <h3>Grid &amp; distance</h3>
            <Switch checked={map.settings.grid} onChange={(v) => patchSettings({ grid: v })} label="Show grid" />
            <label class="field"><span>Grid strength</span>
              <input type="range" min={0.1} max={0.8} step={0.05} value={map.settings.gridOpacity} onInput={(e) => patchSettings({ gridOpacity: Number(e.currentTarget.value) })} />
            </label>
            <div class="field"><span>Diagonals</span>
              <Seg full value={map.settings.distanceRule} onChange={(v) => patchSettings({ distanceRule: v })} options={[
                { v: '5e', label: '5 ft', title: 'Every diagonal square is 5 ft (5e default)' },
                { v: 'alt', label: '5 / 10', title: 'Alternate 5 ft and 10 ft (variant rule)' },
                { v: 'euclid', label: 'Exact', title: 'True straight-line distance' },
              ]} />
            </div>
            <span class="hint">{map.width} × {map.height} squares ({map.width * 5} × {map.height * 5} ft).</span>
          </div>

          {game.maps.length > 1 && (
            <div class="section">
              <h3>Travel</h3>
              <div class="row">
                <select class="input sm grow" value={moveTo} onChange={(e) => setMoveTo(e.currentTarget.value)}>
                  <option value="">Choose a destination…</option>
                  {game.maps.filter((m) => m.id !== map.id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <button class="btn sm" disabled={!moveTo} onClick={moveParty}>Move party</button>
              </div>
              <span class="hint">Moves every player token to the destination's first room and makes it live.</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
