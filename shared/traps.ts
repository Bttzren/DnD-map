// Traps: what kinds there are, sensible defaults, and spotting when a token
// walks onto one. Only the DM sees DCs, damage and notes.
import { cellNoise } from './rng';
import type { MapData, Theme, Token } from './types';

export const TRAP_TYPES = ['spikes', 'pit', 'darts', 'fire', 'net', 'glyph', 'blade', 'gas', 'alarm', 'collapse'] as const;
export type TrapType = (typeof TRAP_TYPES)[number];
export const TRAP_STATES = ['armed', 'triggered', 'disarmed'] as const;
export type TrapState = (typeof TRAP_STATES)[number];

export interface TrapInfo {
  type: TrapType;
  state: TrapState;
  /** Save or check DC. DM only. */
  dc?: number;
  /** Damage or effect, e.g. "2d10 piercing". DM only. */
  damage?: string;
  /** Anything else for the DM: how it's spotted or disarmed. */
  note?: string;
}

export const TRAPS: Record<TrapType, { label: string; dc: number; damage: string; save: string; hint: string }> = {
  spikes: { label: 'Spike plate', dc: 13, damage: '2d6 piercing', save: 'Dex', hint: 'Spikes shoot up from a pressure plate.' },
  pit: { label: 'Hidden pit', dc: 12, damage: '2d6 falling (10 ft)', save: 'Dex', hint: 'A false floor over a pit.' },
  darts: { label: 'Poison darts', dc: 14, damage: '1d4 piercing + 2d10 poison', save: 'Con', hint: 'Darts from holes in the wall.' },
  fire: { label: 'Fire jet', dc: 15, damage: '4d6 fire', save: 'Dex', hint: 'Flame bursts from hidden vents.' },
  net: { label: 'Falling net', dc: 12, damage: 'restrained (DC 12 Str to escape)', save: 'Dex', hint: 'A weighted net drops from above.' },
  glyph: { label: 'Glyph of warding', dc: 15, damage: '5d8 (choose a type)', save: 'Dex', hint: 'A faint rune; Investigation spots it.' },
  blade: { label: 'Swinging blade', dc: 15, damage: '3d10 slashing', save: 'Dex', hint: 'A scything blade sweeps the corridor.' },
  gas: { label: 'Poison gas', dc: 13, damage: '3d6 poison, poisoned 1 min', save: 'Con', hint: 'Vents fill the room with gas.' },
  alarm: { label: 'Alarm', dc: 12, damage: 'alerts nearby enemies', save: 'Perception', hint: 'A tripwire rings bells somewhere.' },
  collapse: { label: 'Collapsing ceiling', dc: 15, damage: '4d10 bludgeoning, rubble', save: 'Dex', hint: 'The roof comes down; leaves difficult terrain.' },
};

export const trapLabel = (t: TrapInfo) => TRAPS[t.type].label;
/** "DC 14 Con · 1d4 piercing + 2d10 poison" */
export const trapSummary = (t: TrapInfo) => `DC ${t.dc ?? TRAPS[t.type].dc} ${TRAPS[t.type].save} · ${t.damage || TRAPS[t.type].damage}`;

const BY_THEME: Record<Theme, TrapType[]> = {
  dungeon: ['spikes', 'darts', 'pit', 'blade', 'alarm', 'net'],
  crypt: ['glyph', 'darts', 'gas', 'pit', 'blade', 'collapse'],
  sewer: ['gas', 'pit', 'net', 'alarm'],
  cave: ['collapse', 'pit', 'net', 'alarm'],
  forest: ['net', 'pit', 'alarm', 'spikes'],
  tavern: ['alarm', 'darts'],
};

/** A trap that suits the setting, picked from the map's seed. */
export function trapFor(theme: Theme, seed: number, i: number): TrapInfo {
  const list = BY_THEME[theme];
  return { type: list[Math.floor(cellNoise(seed, i, 71) * list.length)], state: 'armed' };
}

/** Squares on the straight line between two cells, both ends included. */
export function lineCells(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  let x = a.x, y = a.y;
  const dx = Math.abs(b.x - a.x), dy = -Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1, sy = a.y < b.y ? 1 : -1;
  let err = dx + dy;
  for (let n = 0; n < 400; n++) {
    out.push({ x, y });
    if (x === b.x && y === b.y) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return out;
}

/** Armed traps a token passes over or lands on when it moves from `from` to its new spot (not where it started). */
export function trapsCrossed(map: Pick<MapData, 'objects'>, token: Pick<Token, 'size'>, from: { x: number; y: number }, to: { x: number; y: number }) {
  if (from.x === to.x && from.y === to.y) return [];
  const start = new Set<string>();
  for (let dy = 0; dy < token.size; dy++) for (let dx = 0; dx < token.size; dx++) start.add(`${from.x + dx},${from.y + dy}`);
  const hit = new Set<string>();
  for (const p of lineCells(from, to)) for (let dy = 0; dy < token.size; dy++) for (let dx = 0; dx < token.size; dx++) {
    const k = `${p.x + dx},${p.y + dy}`;
    if (!start.has(k)) hit.add(k);
  }
  return map.objects.filter((o) => o.kind === 'trap' && o.trap?.state !== 'disarmed' && o.trap?.state !== 'triggered' && hit.has(`${o.x},${o.y}`));
}
