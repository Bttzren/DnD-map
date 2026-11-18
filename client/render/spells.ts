// Ready-made spell areas and how each kind of effect looks on the map.
import type { TemplateEffect, TemplateShape } from '../../shared/types';

export type EffectStyle = 'glow' | 'cloud' | 'bolt' | 'rings' | 'rays' | 'sparkle' | 'dark' | 'plain';

/** Colours from the hot centre outwards, plus how it moves. */
export const EFFECTS: Record<TemplateEffect, { label: string; core: string; mid: string; edge: string; style: EffectStyle; swatch: string }> = {
  plain: { label: 'Plain', core: '', mid: '', edge: '', style: 'plain', swatch: '#f97316' },
  fire: { label: 'Fire', core: '#fff3b0', mid: '#fb923c', edge: '#b91c1c', style: 'glow', swatch: '#f97316' },
  cold: { label: 'Cold', core: '#f0f9ff', mid: '#7dd3fc', edge: '#0369a1', style: 'sparkle', swatch: '#38bdf8' },
  lightning: { label: 'Lightning', core: '#ffffff', mid: '#93c5fd', edge: '#1d4ed8', style: 'bolt', swatch: '#60a5fa' },
  acid: { label: 'Acid', core: '#ecfccb', mid: '#a3e635', edge: '#3f6212', style: 'cloud', swatch: '#84cc16' },
  poison: { label: 'Poison', core: '#dcfce7', mid: '#4ade80', edge: '#14532d', style: 'cloud', swatch: '#22c55e' },
  necrotic: { label: 'Necrotic', core: '#e9d5ff', mid: '#7e22ce', edge: '#1e1b4b', style: 'cloud', swatch: '#7e22ce' },
  radiant: { label: 'Radiant', core: '#fffbeb', mid: '#fde68a', edge: '#d97706', style: 'rays', swatch: '#facc15' },
  thunder: { label: 'Thunder', core: '#eef2ff', mid: '#a5b4fc', edge: '#4338ca', style: 'rings', swatch: '#818cf8' },
  force: { label: 'Force', core: '#fdf4ff', mid: '#e879f9', edge: '#86198f', style: 'rings', swatch: '#d946ef' },
  darkness: { label: 'Darkness', core: '#18181b', mid: '#09090b', edge: '#000000', style: 'dark', swatch: '#27272a' },
  fog: { label: 'Fog / web', core: '#fafafa', mid: '#d4d4d8', edge: '#71717a', style: 'cloud', swatch: '#a1a1aa' },
};

export interface SpellPreset { name: string; shape: TemplateShape; sizeFt: number; effect: TemplateEffect }

/** Common area spells, by their usual size. */
export const SPELLS: SpellPreset[] = [
  { name: 'Fireball', shape: 'circle', sizeFt: 20, effect: 'fire' },
  { name: 'Burning Hands', shape: 'cone', sizeFt: 15, effect: 'fire' },
  { name: 'Wall of Fire', shape: 'line', sizeFt: 60, effect: 'fire' },
  { name: 'Fire Breath', shape: 'cone', sizeFt: 30, effect: 'fire' },
  { name: 'Lightning Bolt', shape: 'line', sizeFt: 100, effect: 'lightning' },
  { name: 'Lightning Breath', shape: 'line', sizeFt: 60, effect: 'lightning' },
  { name: 'Cone of Cold', shape: 'cone', sizeFt: 60, effect: 'cold' },
  { name: 'Ice Storm', shape: 'circle', sizeFt: 20, effect: 'cold' },
  { name: 'Sleet Storm', shape: 'circle', sizeFt: 40, effect: 'cold' },
  { name: 'Thunderwave', shape: 'square', sizeFt: 15, effect: 'thunder' },
  { name: 'Shatter', shape: 'circle', sizeFt: 10, effect: 'thunder' },
  { name: 'Silence', shape: 'circle', sizeFt: 20, effect: 'force' },
  { name: 'Spirit Guardians', shape: 'circle', sizeFt: 15, effect: 'radiant' },
  { name: 'Moonbeam', shape: 'circle', sizeFt: 5, effect: 'radiant' },
  { name: 'Faerie Fire', shape: 'square', sizeFt: 20, effect: 'radiant' },
  { name: 'Cloudkill', shape: 'circle', sizeFt: 20, effect: 'poison' },
  { name: 'Stinking Cloud', shape: 'circle', sizeFt: 20, effect: 'poison' },
  { name: 'Entangle', shape: 'square', sizeFt: 20, effect: 'acid' },
  { name: 'Hunger of Hadar', shape: 'circle', sizeFt: 20, effect: 'necrotic' },
  { name: 'Darkness', shape: 'circle', sizeFt: 15, effect: 'darkness' },
  { name: 'Fog Cloud', shape: 'circle', sizeFt: 20, effect: 'fog' },
  { name: 'Web', shape: 'square', sizeFt: 20, effect: 'fog' },
];

export const spellByName = (name: string) => SPELLS.find((s) => s.name === name);
