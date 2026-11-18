import type { PlayerDynamic, PlayerStatic } from '../../shared/protocol';
import type { MapData } from '../../shared/types';
import type { ImageResolver } from '../images';
import type { RenderMap } from './types';

export function fromDmMap(m: MapData, img: ImageResolver): RenderMap {
  const init = m.initiative;
  return {
    id: m.id, name: m.name, width: m.width, height: m.height, theme: m.theme, settings: m.settings,
    terrain: m.terrain, fog: m.fog, doors: m.doors, objects: m.objects, rooms: m.rooms,
    templates: m.templates, drawings: m.drawings, labels: m.labels,
    activeTokenId: init.turn >= 0 ? init.entries[init.turn]?.tokenId ?? null : null,
    tokens: m.tokens.map((t) => ({
      id: t.id, name: t.name, label: t.label, color: t.color, size: t.size, kind: t.kind, x: t.x, y: t.y,
      down: t.down, hidden: t.hidden, conditions: t.conditions,
      hpRatio: t.hp !== null && t.maxHp ? t.hp / t.maxHp : null,
      hpText: t.hp !== null && t.maxHp ? `${t.hp}/${t.maxHp}` : null,
      image: img(t.image),
    })),
  };
}

export function fromPlayerView(s: PlayerStatic, d: PlayerDynamic, img: ImageResolver): RenderMap {
  return {
    id: s.id, name: s.name, width: s.width, height: s.height, theme: s.theme, settings: d.settings,
    terrain: s.terrain, fog: null, doors: s.doors, objects: s.objects, rooms: [],
    templates: d.templates, drawings: d.drawings, labels: d.labels,
    activeTokenId: d.initiative?.activeTokenId ?? null,
    tokens: d.tokens.map((t) => ({
      id: t.id, name: t.name, label: t.label, color: t.color, size: t.size, kind: t.kind, x: t.x, y: t.y,
      down: t.down, hidden: false, conditions: t.conditions,
      hpRatio: t.hp ? t.hp.cur / t.hp.max : t.hpBar,
      hpText: t.hp ? `${t.hp.cur}/${t.hp.max}` : t.hpLabel,
      image: img(t.image),
    })),
  };
}
