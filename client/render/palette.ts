import type { Terrain, Theme } from '../../shared/types';

export interface Palette {
  void: string;
  floor: string;
  floorAlt: string;
  floorLine: string;
  wall: string;
  wallTop: string;
  wallEdge: string;
  shadow: string;
  water: string;
  waterDeep: string;
  waterHi: string;
  lava: string;
  lavaHi: string;
  grass: string;
  grassAlt: string;
  dirt: string;
  dirtAlt: string;
  trees: string;
  treesHi: string;
  rubble: string;
  pit: string;
  grid: string;
  /** Floor pattern style. */
  pattern: 'flagstone' | 'planks' | 'rough' | 'none';
}

const base: Palette = {
  void: '#0d0c10',
  floor: '#6d655b', floorAlt: '#625a51', floorLine: 'rgba(20,16,12,0.28)',
  wall: '#2a2522', wallTop: '#3b3430', wallEdge: '#7b7067', shadow: 'rgba(0,0,0,0.38)',
  water: '#2e6f8e', waterDeep: '#183f5c', waterHi: 'rgba(190,230,255,0.35)',
  lava: '#c2410c', lavaHi: '#fbbf24',
  grass: '#4f7a3a', grassAlt: '#5a8742', dirt: '#8a6a45', dirtAlt: '#7c5e3c',
  trees: '#24461f', treesHi: '#3a6b2e',
  rubble: '#80786e', pit: '#050406',
  grid: 'rgba(0,0,0,0.55)',
  pattern: 'flagstone',
};

export const PALETTES: Record<Theme, Palette> = {
  dungeon: base,
  crypt: { ...base, floor: '#5f6168', floorAlt: '#565860', wall: '#22232a', wallTop: '#30323a', wallEdge: '#80838f', void: '#0a0a0e', rubble: '#7a7c84' },
  cave: { ...base, floor: '#5d4e3f', floorAlt: '#554738', wall: '#2b2219', wallTop: '#3a2e22', wallEdge: '#7a6450', pattern: 'rough', rubble: '#776655' },
  sewer: { ...base, floor: '#55604f', floorAlt: '#4c5647', wall: '#232b22', wallTop: '#30392e', wallEdge: '#6f7d68', water: '#3b5a50', waterDeep: '#243f39', waterHi: 'rgba(190,230,200,0.28)' },
  tavern: { ...base, floor: '#80583a', floorAlt: '#744f33', floorLine: 'rgba(40,22,10,0.45)', wall: '#3a2a1e', wallTop: '#4c3726', wallEdge: '#a07a55', pattern: 'planks' },
  forest: { ...base, floor: '#6e6a52', floorAlt: '#646049', pattern: 'none', void: '#10170d', grid: 'rgba(0,0,0,0.45)' },
};

export const TERRAIN_LABEL: Record<Terrain, string> = {
  void: 'Solid rock', floor: 'Floor', wall: 'Wall', water: 'Shallow water', deepwater: 'Deep water', lava: 'Lava',
  grass: 'Grass', dirt: 'Dirt', trees: 'Trees', rubble: 'Rubble (difficult)', pit: 'Pit',
};

/** Swatch colour for UI pickers. */
export function swatch(t: Terrain, p: Palette): string {
  switch (t) {
    case 'void': return p.void;
    case 'floor': return p.floor;
    case 'wall': return p.wallTop;
    case 'water': return p.water;
    case 'deepwater': return p.waterDeep;
    case 'lava': return p.lava;
    case 'grass': return p.grass;
    case 'dirt': return p.dirt;
    case 'trees': return p.trees;
    case 'rubble': return p.rubble;
    case 'pit': return p.pit;
  }
}

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}
