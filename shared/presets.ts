import type { TokenKind } from './types';

export interface Preset {
  id: string;
  name: string;
  emoji: string;
  size: number;
  hp: number;
  ac: number;
  kind: TokenKind;
  color: string;
  /** Initiative bonus used when rolling. */
  dex: number;
  /** Themes this creature fits, for random encounters. */
  themes: string[];
}

const p = (
  id: string, name: string, emoji: string, size: number, hp: number, ac: number,
  dex: number, themes: string[], kind: TokenKind = 'enemy', color?: string,
): Preset => ({
  id, name, emoji, size, hp, ac, dex, themes, kind,
  color: color ?? (kind === 'player' ? '#4f9dde' : kind === 'ally' ? '#5cb85c' : kind === 'neutral' ? '#c9a227' : '#c0392b'),
});

export const PRESETS: Preset[] = [
  // Party
  p('fighter', 'Fighter', '🛡️', 1, 28, 18, 1, [], 'player', '#3b82f6'),
  p('wizard', 'Wizard', '🧙', 1, 16, 12, 2, [], 'player', '#8b5cf6'),
  p('rogue', 'Rogue', '🗡️', 1, 20, 15, 4, [], 'player', '#10b981'),
  p('cleric', 'Cleric', '✨', 1, 24, 16, 0, [], 'player', '#f59e0b'),
  p('ranger', 'Ranger', '🏹', 1, 24, 15, 3, [], 'player', '#22c55e'),
  p('bard', 'Bard', '🎻', 1, 20, 14, 2, [], 'player', '#ec4899'),
  p('barbarian', 'Barbarian', '🪓', 1, 34, 14, 2, [], 'player', '#ef4444'),
  p('paladin', 'Paladin', '⚔️', 1, 30, 18, 0, [], 'player', '#eab308'),
  // NPCs
  p('commoner', 'Commoner', '🧑', 1, 4, 10, 0, ['tavern'], 'neutral'),
  p('innkeeper', 'Innkeeper', '🍺', 1, 9, 11, 0, ['tavern'], 'neutral'),
  p('guard', 'Guard', '💂', 1, 11, 16, 1, ['tavern', 'dungeon'], 'neutral'),
  p('merchant', 'Merchant', '💰', 1, 9, 10, 0, ['tavern'], 'neutral'),
  p('dog', 'Dog', '🐕', 1, 5, 12, 2, ['tavern', 'forest'], 'ally'),
  // Monsters
  p('goblin', 'Goblin', '👺', 1, 7, 15, 2, ['dungeon', 'cave', 'forest', 'sewer']),
  p('hobgoblin', 'Hobgoblin', '👹', 1, 11, 18, 1, ['dungeon', 'forest']),
  p('kobold', 'Kobold', '🦎', 1, 5, 12, 2, ['dungeon', 'cave']),
  p('orc', 'Orc', '🪓', 1, 15, 13, 1, ['dungeon', 'cave', 'forest']),
  p('bandit', 'Bandit', '🦹', 1, 11, 12, 1, ['forest', 'tavern', 'sewer']),
  p('cultist', 'Cultist', '🕯️', 1, 9, 12, 1, ['crypt', 'dungeon', 'sewer']),
  p('skeleton', 'Skeleton', '💀', 1, 13, 13, 2, ['crypt', 'dungeon']),
  p('zombie', 'Zombie', '🧟', 1, 22, 8, -2, ['crypt', 'sewer']),
  p('ghoul', 'Ghoul', '👻', 1, 22, 12, 2, ['crypt']),
  p('wight', 'Wight', '☠️', 1, 45, 14, 2, ['crypt']),
  p('giant-rat', 'Giant Rat', '🐀', 1, 7, 12, 2, ['sewer', 'dungeon', 'cave']),
  p('spider', 'Giant Spider', '🕷️', 2, 26, 14, 3, ['cave', 'forest', 'crypt']),
  p('wolf', 'Wolf', '🐺', 1, 11, 13, 2, ['forest', 'cave']),
  p('bear', 'Brown Bear', '🐻', 2, 34, 11, 0, ['forest', 'cave']),
  p('owlbear', 'Owlbear', '🦉', 2, 59, 13, 1, ['forest', 'cave']),
  p('ooze', 'Gelatinous Cube', '🟩', 2, 84, 6, -4, ['dungeon', 'sewer']),
  p('otyugh', 'Otyugh', '🦑', 2, 114, 14, 0, ['sewer']),
  p('troll', 'Troll', '🧌', 2, 84, 15, 1, ['cave', 'forest']),
  p('ogre', 'Ogre', '👊', 2, 59, 11, -1, ['cave', 'forest', 'dungeon']),
  p('mimic', 'Mimic', '📦', 1, 58, 12, 1, ['dungeon', 'crypt']),
  p('beholder', 'Beholder', '👁️', 2, 180, 18, 2, ['dungeon', 'cave']),
  p('dragon', 'Young Dragon', '🐉', 2, 178, 18, 0, ['cave']),
  p('ancient-dragon', 'Ancient Dragon', '🐲', 4, 367, 22, 0, []),
  p('lich', 'Lich', '👑', 1, 135, 17, 3, ['crypt']),
];

export function presetById(id: string): Preset | undefined {
  return PRESETS.find((x) => x.id === id);
}
