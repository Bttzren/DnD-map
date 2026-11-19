// The ONLY path from game state to a player's screen. Anything the DM has
// not revealed is stripped here, so it never leaves the server.
import { DIRS8, footprint, inBounds } from './grid';
import { findMap } from './ops';
import type { TrapInfo } from './traps';
import type {
  AreaTemplate, Drawing, Game, Label, MapData, MapSettings, ObjectKind,
  ScreenState, Terrain, Theme, Token, TokenKind,
} from './types';

export interface PlayerToken {
  id: string; name: string; label: string; color: string; size: number; kind: TokenKind;
  x: number; y: number; down: boolean; conditions: string[];
  /** Rounds left on effects that have a duration. */
  rounds?: Record<string, number>;
  hp: { cur: number; max: number } | null;
  hpBar: number | null;
  hpLabel: string | null;
  image?: string;
}

export interface PlayerInitiative {
  entries: { tokenId: string; name: string; label: string; color: string; image?: string }[];
  activeTokenId: string | null;
  round: number;
}

export interface PlayerMap {
  id: string; name: string; width: number; height: number; theme: Theme; settings: MapSettings;
  terrain: Terrain[];
  fog: number[];
  doors: { id: string; x: number; y: number; state: 'open' | 'closed' }[];
  /** Revealed traps carry only their type and state, never DCs or notes. */
  objects: { id: string; x: number; y: number; kind: ObjectKind; trap?: Pick<TrapInfo, 'type' | 'state'> }[];
  tokens: PlayerToken[];
  templates: AreaTemplate[];
  drawings: Drawing[];
  labels: Label[];
  initiative: PlayerInitiative | null;
}

export interface PlayerView { screen: ScreenState; map: PlayerMap | null }

export function hpLabel(ratio: number): string {
  if (ratio <= 0) return 'down';
  if (ratio >= 1) return 'unhurt';
  if (ratio > 0.5) return 'healthy';
  if (ratio > 0.25) return 'bloodied';
  return 'near death';
}

function tokenForPlayers(t: Token): PlayerToken {
  const hasHp = t.hp !== null && t.maxHp !== null && t.maxHp > 0;
  const ratio = hasHp ? Math.max(0, Math.min(1, t.hp! / t.maxHp!)) : 0;
  return {
    id: t.id, name: t.name, label: t.label, color: t.color, size: t.size, kind: t.kind,
    x: t.x, y: t.y, down: t.down,
    // Effects the DM keeps secret never leave the server.
    conditions: t.conditions.filter((c) => !t.effectInfo?.[c]?.hidden),
    ...roundsFor(t),
    hp: hasHp && t.hpVisibility === 'exact' ? { cur: t.hp!, max: t.maxHp! } : null,
    hpBar: hasHp && t.hpVisibility === 'bar' ? ratio : null,
    hpLabel: hasHp && t.hpVisibility === 'vague' ? hpLabel(ratio) : null,
    ...(t.image ? { image: t.image } : {}),
  };
}

function roundsFor(t: Token): { rounds?: Record<string, number> } {
  const out: Record<string, number> = {};
  for (const c of t.conditions) { const i = t.effectInfo?.[c]; if (i?.rounds && !i.hidden) out[c] = i.rounds; }
  return Object.keys(out).length ? { rounds: out } : {};
}

export function visibleTokens(map: MapData): Token[] {
  return map.tokens.filter((t) =>
    !t.hidden && (t.kind === 'player' || footprint(map, t.x, t.y, t.size).some((c) => map.fog[c] === 1)));
}

/** Revealed cells, plus the squares visible player tokens stand on. */
function seenCells(map: MapData): number[] {
  const seen = map.fog.slice();
  for (const t of map.tokens) {
    if (t.kind !== 'player' || t.hidden) continue;
    for (const c of footprint(map, t.x, t.y, t.size)) seen[c] = 1;
  }
  return seen;
}

export function playerMap(map: MapData): PlayerMap {
  const W = map.width;
  const seen = seenCells(map);
  const sm = { width: map.width, height: map.height, fog: seen };
  const secret = new Set(map.doors.filter((d) => d.state === 'secret').map((d) => d.y * W + d.x));
  const terrain = map.terrain.map((t, i) => {
    if (secret.has(i)) return seen[i] === 1 || nearRevealed(sm, i) ? 'wall' : 'void';
    if (seen[i] === 1) return t;
    if ((t === 'wall' || t === 'void') && nearRevealed(sm, i)) return t;
    return 'void';
  });
  const tokens = visibleTokens(map);
  const shownIds = new Set(tokens.map((t) => t.id));
  const init = map.initiative;
  let initiative: PlayerInitiative | null = null;
  if (init.visible) {
    // Tokens players can see, plus entries the DM typed in and didn't hide.
    const custom = (e: (typeof init.entries)[number]) => !!e.name && !map.tokens.some((t) => t.id === e.tokenId);
    const shown = (e: (typeof init.entries)[number]) => (custom(e) ? !e.hidden : shownIds.has(e.tokenId));
    const entries = init.entries.filter(shown);
    const activeEntry = init.entries[init.turn];
    initiative = {
      entries: entries.map((e) => {
        if (custom(e)) return { tokenId: e.tokenId, name: e.name!, label: e.name!.slice(0, 1).toUpperCase(), color: e.color ?? '#71717a' };
        const t = tokens.find((x) => x.id === e.tokenId)!;
        return { tokenId: t.id, name: t.name, label: t.label, color: t.color, ...(t.image ? { image: t.image } : {}) };
      }),
      activeTokenId: activeEntry && shown(activeEntry) ? activeEntry.tokenId : null,
      round: init.round,
    };
  }
  return {
    id: map.id, name: map.name, width: map.width, height: map.height, theme: map.theme,
    settings: { ...map.settings },
    terrain,
    fog: seen,
    doors: map.doors
      .filter((d) => d.state !== 'secret' && seen[d.y * W + d.x] === 1)
      .map((d) => ({ id: d.id, x: d.x, y: d.y, state: d.state as 'open' | 'closed' })),
    objects: map.objects
      .filter((o) => !o.hidden && seen[o.y * W + o.x] === 1)
      .map((o) => ({ id: o.id, x: o.x, y: o.y, kind: o.kind, ...(o.trap ? { trap: { type: o.trap.type, state: o.trap.state } } : {}) })),
    tokens: tokens.map(tokenForPlayers),
    templates: map.templates.filter((t) => !t.hidden).map((t) => ({ ...t })),
    drawings: map.drawings.filter((d) => !d.hidden).map((d) => ({ ...d })),
    labels: map.labels.filter((l) => !l.hidden).map((l) => ({ ...l })),
    initiative,
  };
}

function nearRevealed(map: { width: number; height: number; fog: number[] }, i: number): boolean {
  const x = i % map.width, y = (i - x) / map.width;
  for (const [dx, dy] of DIRS8) {
    const nx = x + dx, ny = y + dy;
    if (inBounds(map, nx, ny) && map.fog[ny * map.width + nx] === 1) return true;
  }
  return false;
}

export function playerView(game: Game): PlayerView {
  const screen = { ...game.screen };
  const map = findMap(game, game.liveMapId);
  if (!map || screen.blank) return { screen, map: null };
  return { screen, map: playerMap(map) };
}
