import { useEffect, useReducer, useRef, useState } from 'preact/hooks';
import type { ComponentChildren, CSSProperties } from 'preact';
import qrcode from 'qrcode-generator';

// ---------------------------------------------------------------- tiny store

export class Store<T> {
  private subs = new Set<() => void>();
  constructor(public state: T) {}
  set(patch: Partial<T>) { this.state = { ...this.state, ...patch }; this.emit(); }
  emit() { for (const s of this.subs) s(); }
  subscribe(fn: () => void) { this.subs.add(fn); return () => { this.subs.delete(fn); }; }
}

/** Re-render when the selected value changes (compared with Object.is). */
export function useStore<T, R>(store: Store<T>, sel: (s: T) => R): R {
  const [, force] = useReducer((n: number) => n + 1, 0);
  const selRef = useRef(sel);
  selRef.current = sel;
  const val = sel(store.state);
  const last = useRef(val);
  last.current = val;
  useEffect(() => store.subscribe(() => {
    const next = selRef.current(store.state);
    if (!Object.is(next, last.current)) force(0);
  }), [store]);
  return val;
}

// ---------------------------------------------------------------- toasts

export interface Toast { id: number; text: string; kind: 'info' | 'ok' | 'error' }
export const toasts = new Store<{ list: Toast[] }>({ list: [] });
let toastId = 0;
export function toast(text: string, kind: Toast['kind'] = 'info', ms = 2600) {
  const id = ++toastId;
  toasts.set({ list: [...toasts.state.list.slice(-1), { id, text, kind }] });
  setTimeout(() => toasts.set({ list: toasts.state.list.filter((t) => t.id !== id) }), ms);
}

export function Toasts() {
  const list = useStore(toasts, (s) => s.list);
  return (
    <div class="toasts" role="status" aria-live="polite">
      {list.map((t) => <div key={t.id} class={`toast ${t.kind}`}>{t.text}</div>)}
    </div>
  );
}

// ---------------------------------------------------------------- confirm / prompt

interface Dialog { title: string; body?: string; confirm: string; danger?: boolean; input?: string; resolve: (v: string | null) => void }
const dialogs = new Store<{ d: Dialog | null }>({ d: null });

export function confirmDialog(title: string, body: string, confirm = 'Confirm', danger = true): Promise<boolean> {
  return new Promise((res) => dialogs.set({ d: { title, body, confirm, danger, resolve: (v) => res(v !== null) } }));
}
export function promptDialog(title: string, initial = '', confirm = 'Save'): Promise<string | null> {
  return new Promise((res) => dialogs.set({ d: { title, confirm, input: initial, resolve: res } }));
}

export function Dialogs() {
  const d = useStore(dialogs, (s) => s.d);
  const [val, setVal] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (d) { setVal(d.input ?? ''); setTimeout(() => inputRef.current?.select(), 30); } }, [d]);
  if (!d) return null;
  const close = (v: string | null) => { dialogs.set({ d: null }); d.resolve(v); };
  return (
    <div class="modal-back" onClick={(e) => e.target === e.currentTarget && close(null)} onKeyDown={(e) => e.key === 'Escape' && close(null)}>
      <form class="card modal" onSubmit={(e) => { e.preventDefault(); close(d.input !== undefined ? val : 'ok'); }}>
        <h2>{d.title}</h2>
        {d.body && <p class="muted" style={{ margin: 0 }}>{d.body}</p>}
        {d.input !== undefined && <input ref={inputRef} class="input" value={val} onInput={(e) => setVal(e.currentTarget.value)} autoFocus maxLength={80} />}
        <div class="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" class="btn" onClick={() => close(null)}>Cancel</button>
          <button type="submit" class={`btn ${d.danger ? 'danger' : 'primary'}`}>{d.confirm}</button>
        </div>
      </form>
    </div>
  );
}

export function Modal(p: { title: string; onClose: () => void; children: ComponentChildren; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && p.onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  return (
    <div class="modal-back" onClick={(e) => e.target === e.currentTarget && p.onClose()}>
      <div class="card modal" style={p.wide ? { width: 'min(640px, 100%)' } : undefined} role="dialog" aria-label={p.title}>
        <div class="row between"><h2>{p.title}</h2><button class="btn ghost icon" onClick={p.onClose} aria-label="Close"><Icon name="x" /></button></div>
        {p.children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- bits

export function QR(p: { text: string; size?: number }) {
  const svg = (() => { const q = qrcode(0, 'M'); q.addData(p.text); q.make(); return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); })();
  const style = p.size ? { width: `${p.size}px`, height: `${p.size}px`, padding: `${Math.round(p.size / 20)}px` } : undefined;
  return <div class="qr" style={style} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export async function copy(text: string, what = 'Link') {
  try { await navigator.clipboard.writeText(text); toast(`${what} copied`, 'ok'); }
  catch { await promptDialog(`Copy this ${what.toLowerCase()}`, text, 'Done'); }
}

export function Switch(p: { checked: boolean; onChange: (v: boolean) => void; label: ComponentChildren; title?: string }) {
  return (
    <label class="switch" title={p.title}>
      <input type="checkbox" checked={p.checked} onChange={(e) => p.onChange(e.currentTarget.checked)} />
      <span>{p.label}</span>
    </label>
  );
}

export function Seg<T extends string | number>(p: { value: T; options: { v: T; label: ComponentChildren; title?: string }[]; onChange: (v: T) => void; full?: boolean }) {
  return (
    <div class={`seg${p.full ? ' full' : ''}`} role="radiogroup">
      {p.options.map((o) => (
        <button type="button" key={String(o.v)} class={o.v === p.value ? 'on' : ''} title={o.title} role="radio" aria-checked={o.v === p.value} onClick={() => p.onChange(o.v)}>{o.label}</button>
      ))}
    </div>
  );
}

/** Number input that commits on blur/enter and accepts +5 / -3 style edits. */
export function NumField(p: { value: number | null; onCommit: (v: number | null) => void; class?: string; placeholder?: string; title?: string; allowRelative?: boolean }) {
  const [v, setV] = useState(p.value === null ? '' : String(p.value));
  useEffect(() => setV(p.value === null ? '' : String(p.value)), [p.value]);
  const commit = () => {
    const s = v.trim();
    if (s === '') return p.onCommit(null);
    if (p.allowRelative && /^[+-]\d+$/.test(s) && p.value !== null) return p.onCommit(p.value + Number(s));
    const n = Number(s);
    if (Number.isFinite(n)) p.onCommit(Math.round(n)); else setV(p.value === null ? '' : String(p.value));
  };
  return (
    <input class={`input sm ${p.class ?? ''}`} value={v} inputMode="numeric" placeholder={p.placeholder} title={p.title}
      onInput={(e) => setV(e.currentTarget.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { commit(); (e.currentTarget as HTMLInputElement).blur(); } }} />
  );
}

// ---------------------------------------------------------------- icons

const PATHS: Record<string, string> = {
  select: 'M5 3l14 8-6 2-2 6z',
  hand: 'M8 13V5.5a1.5 1.5 0 013 0V12m0-7.5v-1a1.5 1.5 0 013 0V12m0-6.5a1.5 1.5 0 013 0V13m0-4.5a1.5 1.5 0 013 0V15a7 7 0 01-7 7h-1a7 7 0 01-5.7-3L4 15.5a1.6 1.6 0 012.4-2.1L8 15',
  brush: 'M9.5 14.5L19 5a2 2 0 00-3-3l-9.5 9.5M9.5 14.5c-.8 2.6-3 4.5-6.5 4.5 0 0 .5-4 3-6.5M9.5 14.5l-3-3',
  door: 'M5 21V4a1 1 0 011-1h10a1 1 0 011 1v17M3 21h18M14 12h.01',
  box: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  eyeOff: 'M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A10 10 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 005.4-1.6',
  ruler: 'M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
  circle: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 12h9',
  pen: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z',
  text: 'M4 7V5h16v2M9 19h6M12 5v14',
  ping: 'M12 13a1 1 0 100-2 1 1 0 000 2zM12 21a9 9 0 100-18 9 9 0 000 18zM12 17a5 5 0 100-10 5 5 0 000 10z',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3',
  x: 'M18 6L6 18M6 6l12 12',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  users: 'M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM22 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8',
  link: 'M10 13a5 5 0 007.5.5l3-3a5 5 0 00-7-7l-1.7 1.7M14 11a5 5 0 00-7.5-.5l-3 3a5 5 0 007 7l1.7-1.7',
  panel: 'M3 4h18v16H3zM15 4v16',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  dice: 'M12 2l9 5v10l-9 5-9-5V7zM12 2v20M3 7l9 5 9-5',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  play: 'M6 4l14 8-14 8z',
  next: 'M5 4l10 8-10 8zM19 5v14',
  prev: 'M19 20L9 12l10-8zM5 19V5',
  download: 'M12 3v12m0 0l-4-4m4 4l4-4M4 17v3h16v-3',
  upload: 'M12 21V9m0 0l-4 4m4-4l4 4M4 7V4h16v3',
  map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14',
  cloud: 'M7 18a5 5 0 01-.6-10 6 6 0 0111.5 1.5A4.3 4.3 0 0117.5 18z',
  screen: 'M3 4h18v12H3zM8 20h8M12 16v4',
  flag: 'M4 22V4M4 4h13l-2 4 2 4H4',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  swords: 'M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 17.5L21 6V3h-3L6.5 14.5M11 19l-6-6M8 16l-4 4M5 21l-2-2',
  wand: 'M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z',
  layers: 'M12 2l10 6-10 6L2 8zM2 16l10 6 10-6M2 12l10 6 10-6',
};

export function Icon(p: { name: keyof typeof PATHS | string; size?: number; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" width={p.size ?? 18} height={p.size ?? 18} fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" style={p.style} aria-hidden="true">
      <path d={PATHS[p.name] ?? ''} />
    </svg>
  );
}

export function Logo(p: { class?: string }) {
  return <img class={p.class ?? 'logo'} src="/favicon.svg" alt="" />;
}
