// A short getting-started checklist for new DMs. Steps tick themselves off
// as they happen; it hides for good once done or dismissed.
import { useState } from 'preact/hooks';
import { pref } from '../local';
import { Icon, useStore } from '../ui';
import type { DmCtl } from './state';

export function Guide({ ctl }: { ctl: DmCtl }) {
  useStore(ctl, (s) => s.ver);
  const players = useStore(ctl, (s) => s.players);
  const [hidden, setHidden] = useState(() => pref.get('dm.guideHidden', false));
  const game = ctl.state.game;
  if (hidden || !game) return null;
  const live = ctl.live;
  const steps = [
    { done: game.maps.length > 0, label: 'Make a map', how: 'Generate, on the right', act: () => ctl.openTab('generate') },
    { done: players.length > 0, label: 'Invite your players', how: 'They scan the QR', act: () => ctl.set({ share: true }) },
    { done: !!live?.fog.includes(1), label: 'Reveal the first room', how: 'Fog tool (F), click a room', act: () => ctl.setTool('fog') },
    { done: !!live?.tokens.some((t) => t.kind === 'player'), label: 'Put the party on the map', how: 'Tokens tab, Party', act: () => ctl.openTab('tokens') },
    { done: !!live && live.initiative.turn >= 0, label: 'Roll for initiative', how: 'Initiative tab', act: () => ctl.openTab('initiative') },
  ];
  const left = steps.filter((s) => !s.done).length;
  const close = () => { pref.set('dm.guideHidden', true); setHidden(true); };
  if (!left) { pref.set('dm.guideHidden', true); return null; }
  return (
    <div class="card guide" role="region" aria-label="Getting started">
      <div class="row between">
        <b>Getting started <span class="faint small">{steps.length - left}/{steps.length}</span></b>
        <button class="btn ghost sm icon" onClick={close} aria-label="Hide the getting started list" title="Hide"><Icon name="x" size={14} /></button>
      </div>
      {steps.map((s) => (
        <button key={s.label} class={`guide-step${s.done ? ' done' : ''}`} onClick={s.act} disabled={s.done}>
          <span class="guide-check">{s.done ? '✓' : ''}</span>
          <span class="grow">{s.label}<span class="faint small"> · {s.how}</span></span>
        </button>
      ))}
      <span class="hint" style={{ margin: 0 }}>Tip: right-click a token for quick actions. Press <span class="kbd">?</span> for shortcuts.</span>
    </div>
  );
}
