// Appearance: light or dark (or follow the device), and an accent colour.
// Each person picks their own; it's remembered on their device.
import { useEffect, useRef, useState } from 'preact/hooks';
import { pref } from './local';
import { Icon, Seg } from './ui';

export type Mode = 'dark' | 'light' | 'auto';
export const ACCENTS = [
  { id: 'gold', label: 'Gold', color: '#d8b25a' },
  { id: 'crimson', label: 'Crimson', color: '#d65a5f' },
  { id: 'emerald', label: 'Emerald', color: '#3fb27f' },
  { id: 'arcane', label: 'Arcane', color: '#a27cf0' },
  { id: 'frost', label: 'Frost', color: '#58aee6' },
] as const;
export type Accent = (typeof ACCENTS)[number]['id'];

const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;

export function applyTheme() {
  const mode = pref.get<Mode>('ui.mode', 'dark');
  const accent = pref.get<Accent>('ui.accent', 'gold');
  const light = mode === 'light' || (mode === 'auto' && !!media?.matches);
  const el = document.documentElement;
  el.dataset.mode = light ? 'light' : 'dark';
  if (accent === 'gold') delete el.dataset.accent; else el.dataset.accent = accent;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#f3ede1' : '#0e0d12');
}
media?.addEventListener?.('change', () => { if (pref.get<Mode>('ui.mode', 'dark') === 'auto') applyTheme(); });

/** A button that opens a small appearance menu. */
export function AppearanceButton(p: { class?: string; round?: boolean; up?: boolean }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>(() => pref.get<Mode>('ui.mode', 'dark'));
  const [accent, setAccent] = useState<Accent>(() => pref.get<Accent>('ui.accent', 'gold'));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const pickMode = (m: Mode) => { setMode(m); pref.set('ui.mode', m); applyTheme(); };
  const pickAccent = (a: Accent) => { setAccent(a); pref.set('ui.accent', a); applyTheme(); };
  return (
    <div class="appearance" ref={ref}>
      <button class={p.round ? `round-btn${open ? ' on' : ''}` : `btn ghost icon${open ? ' on' : ''} ${p.class ?? ''}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Appearance" title="Appearance: light, dark and colours">
        <Icon name="palette" />
      </button>
      {open && (
        <div class={`card appearance-menu${p.up ? ' up' : ''}`} role="dialog" aria-label="Appearance">
          <span class="label">Mode</span>
          <Seg full value={mode} onChange={pickMode} options={[{ v: 'dark', label: 'Dark' }, { v: 'light', label: 'Light' }, { v: 'auto', label: 'Auto', title: 'Follow this device' }]} />
          <span class="label">Colour</span>
          <div class="accent-row">
            {ACCENTS.map((a) => (
              <button key={a.id} class={`accent-sw${accent === a.id ? ' on' : ''}`} style={{ background: a.color }} onClick={() => pickAccent(a.id)} aria-label={a.label} title={a.label} aria-pressed={accent === a.id} />
            ))}
          </div>
          <span class="hint">Just for this device. The map itself looks the same for everyone.</span>
        </div>
      )}
    </div>
  );
}
