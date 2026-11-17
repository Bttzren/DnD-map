// The ONLY path from game state to a player's screen. Anything the DM has
// not revealed is stripped here, so it never leaves the server.
import { DIRS8, footprint, inBounds } from './grid';
import { findMap } from './ops';
import type {
  AreaTemplate, Drawing, Game, Label, MapData, MapSettings, ObjectKind,
  ScreenState, Terrain, Theme, Token, TokenKind,
} from './types';

export interface PlayerToken {
  id: string; name: string; label: string; color: string; size: number; kind: TokenKind;
  x: number; y: number; down: boolean; conditions: string[];
  hp: { cur: number; max: number } | null;
  hpBar: number | null;
  hpLabel: string | null;
}

export interface PlayerInitiative {
  entries: { tokenId: string; name: string; label: string; color: string }[];
  activeTokenId: string | null;
  round: number;
}

export interface PlayerMap {
  id: string; name: string; width: number; height: number; theme: Theme; settings: MapSettings;
  terrain: Terrain[];
  fog: number[];
  doors: { id: string; x: number; y: number; state: 'open' | 'closed' }[];
  objects: { id: string; x: number; y: number; kind: ObjectKind }[];
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
    x: t.x, y: t.y, down: t.down, conditions: t.conditions.slice(),
    hp: hasHp && t.hpVisibility === 'exact' ? { cur: t.hp!, max: t.maxHp! } : null,
    hpBar: hasHp && t.hpVisibility === 'bar' ? ratio : null,
    hpLabel: hasHp && t.hpVisibility === 'vague' ? hpLabel(ratio) : null,
  };
}

export function visibleTokens(map: MapData): Token[] {
  return map.tokens.filter((t) =>
    !t.hidden && (t.kind === 'player' || footprint(map, t.x, t.y, t.size).some((c) => map.fog[c] === 1)));
}

export function playerMap(map: MapData): PlayerMap {
  const W = map.width;
  const secret = new Set(map.doors.filter((d) => d.state === 'secret').map((d) => d.y * W + d.x));
  const terrain = map.terrain.map((t, i) => {
    if (secret.has(i)) return map.fog[i] === 1 || nearRevealed(map, i) ? 'wall' : 'void';
    if (map.fog[i] === 1) return t;
    if ((t === 'wall' || t === 'void') && nearRevealed(map, i)) return t;
    return 'void';
  });
  const tokens = visibleTokens(map);
  const shownIds = new Set(tokens.map((t) => t.id));
  const init = map.initiative;
  let initiative: PlayerInitiative | null = null;
  if (init.visible) {
    const entries = init.entries.filter((e) => shownIds.has(e.tokenId));
    const active = init.entries[init.turn]?.tokenId;
    initiative = {
      entries: entries.map((e) => {
        const t = tokens.find((x) => x.id === e.tokenId)!;
        return { tokenId: t.id, name: t.name, label: t.label, color: t.color };
      }),
      activeTokenId: active && shownIds.has(active) ? active : null,
      round: init.round,
    };
  }
  return {
    id: map.id, name: map.name, width: map.width, height: map.height, theme: map.theme,
    settings: { ...map.settings },
    terrain,
    fog: map.fog.slice(),
    doors: map.doors
      .filter((d) => d.state !== 'secret' && map.fog[d.y * W + d.x] === 1)
      .map((d) => ({ id: d.id, x: d.x, y: d.y, state: d.state as 'open' | 'closed' })),
    objects: map.objects
      .filter((o) => !o.hidden && map.fog[o.y * W + o.x] === 1)
      .map((o) => ({ id: o.id, x: o.x, y: o.y, kind: o.kind })),
    tokens: tokens.map(tokenForPlayers),
    templates: map.templates.filter((t) => !t.hidden).map((t) => ({ ...t })),
    drawings: map.drawings.filter((d) => !d.hidden).map((d) => ({ ...d })),
    labels: map.labels.filter((l) => !l.hidden).map((l) => ({ ...l })),
    initiative,
  };
}

function nearRevealed(map: MapData, i: number): boolean {
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
