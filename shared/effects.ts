// Status effects the DM can put on tokens: the 5e conditions, helpful
// effects and harmful ones. A token's `conditions` lists their ids (or any
// name the DM typed); `effectInfo` adds a duration in rounds or hides an
// effect from players.

/** How an effect shows on the token itself. */
export type EffectLook =
  | 'fire' | 'ice' | 'poison' | 'invisible' | 'flying' | 'glow' | 'curse' | 'stun' | 'sleep'
  | 'web' | 'stone' | 'rage' | 'focus' | 'blood' | 'fear' | 'slow' | 'haste' | 'shield' | 'mark';

export interface EffectDef {
  id: string;
  label: string;
  icon: string;
  color: string;
  group: 'condition' | 'helpful' | 'harmful';
  info: string;
  look?: EffectLook;
}

const def = (group: EffectDef['group']) => (id: string, label: string, icon: string, color: string, info: string, look?: EffectLook): EffectDef => ({ id, label, icon, color, group, info, look });
const C = def('condition'), H = def('helpful'), X = def('harmful');

export const EFFECTS: EffectDef[] = [
  C('blinded', 'Blinded', '🙈', '#94a3b8', 'Can’t see. Attacks against it have advantage; its attacks have disadvantage.'),
  C('charmed', 'Charmed', '💕', '#f472b6', 'Can’t attack the charmer, who has advantage on social checks.'),
  C('deafened', 'Deafened', '🔇', '#a8a29e', 'Can’t hear.'),
  C('frightened', 'Frightened', '😱', '#c084fc', 'Disadvantage while the source is in sight; can’t move closer.', 'fear'),
  C('grappled', 'Grappled', '✊', '#fb923c', 'Speed 0.'),
  C('incapacitated', 'Incapacitated', '💫', '#94a3b8', 'Can’t take actions or reactions.', 'stun'),
  C('invisible', 'Invisible', '👻', '#e5e7eb', 'Unseen without magic. Its attacks have advantage.', 'invisible'),
  C('paralyzed', 'Paralyzed', '⚡', '#fde047', 'Incapacitated, can’t move. Hits within 5 ft are crits.', 'stun'),
  C('petrified', 'Petrified', '🗿', '#a8a29e', 'Turned to stone. Resistant to all damage.', 'stone'),
  C('poisoned', 'Poisoned', '🤢', '#84cc16', 'Disadvantage on attacks and ability checks.', 'poison'),
  C('prone', 'Prone', '🛌', '#d6d3d1', 'Crawls. Melee attacks against it have advantage.'),
  C('restrained', 'Restrained', '⛓️', '#f59e0b', 'Speed 0. Disadvantage on attacks and Dex saves.', 'web'),
  C('stunned', 'Stunned', '💫', '#facc15', 'Incapacitated, can’t move, fails Str and Dex saves.', 'stun'),
  C('unconscious', 'Unconscious', '💤', '#64748b', 'Drops prone, unaware. Hits within 5 ft are crits.', 'sleep'),
  C('exhaustion', 'Exhausted', '😩', '#a16207', 'Levels of exhaustion: note the level.'),
  H('blessed', 'Blessed', '✨', '#fde68a', '+1d4 to attacks and saves.', 'glow'),
  H('hasted', 'Hasted', '🏃', '#38bdf8', 'Double speed, +2 AC, an extra action.', 'haste'),
  H('raging', 'Raging', '😡', '#ef4444', 'Bonus damage, resists physical damage.', 'rage'),
  H('concentrating', 'Concentrating', '🧠', '#60a5fa', 'Holding a spell; damage means a Con save.', 'focus'),
  H('shielded', 'Shielded', '🛡️', '#93c5fd', 'A magical ward: bonus to AC.', 'shield'),
  H('flying', 'Flying', '🪽', '#e0f2fe', 'In the air: note its height.', 'flying'),
  H('hidden', 'Hidden', '🫥', '#a1a1aa', 'Stealthy: unseen until found.', 'invisible'),
  H('inspired', 'Inspired', '🎵', '#f0abfc', 'Has a Bardic Inspiration die.', 'glow'),
  H('regenerating', 'Regenerating', '💚', '#4ade80', 'Heals at the start of its turn.', 'glow'),
  H('sanctuary', 'Sanctuary', '🕊️', '#fef9c3', 'Attackers must make a Wis save first.', 'shield'),
  X('burning', 'Burning', '🔥', '#f97316', 'Takes fire damage at the start of its turn until put out.', 'fire'),
  X('bleeding', 'Bleeding', '🩸', '#dc2626', 'Loses HP each turn until healed.', 'blood'),
  X('frozen', 'Frozen', '🧊', '#7dd3fc', 'Encased in ice or chilled: slowed or stuck.', 'ice'),
  X('slowed', 'Slowed', '🐌', '#a78bfa', 'Half speed, −2 AC and Dex saves, fewer actions.', 'slow'),
  X('cursed', 'Cursed', '💀', '#7e22ce', 'Under a curse.', 'curse'),
  X('hexed', 'Hexed', '🔮', '#9333ea', 'Takes extra necrotic damage from the caster.', 'curse'),
  X('marked', 'Marked', '🎯', '#ef4444', 'Hunter’s Mark or similar: extra damage from the marker.', 'mark'),
  X('confused', 'Confused', '😵‍💫', '#f9a8d4', 'Acts at random.', 'stun'),
  X('silenced', 'Silenced', '🤐', '#94a3b8', 'Can’t speak or cast verbal spells.'),
  X('weakened', 'Weakened', '🥀', '#b45309', 'Deals less damage.'),
  X('diseased', 'Diseased', '🦠', '#65a30d', 'Sick: note the disease.', 'poison'),
  X('asleep', 'Asleep', '😴', '#818cf8', 'Magically asleep until hurt or shaken.', 'sleep'),
  X('webbed', 'Webbed', '🕸️', '#e7e5e4', 'Stuck in webbing: restrained.', 'web'),
];

const BY_ID = new Map(EFFECTS.map((e) => [e.id, e]));
/** The catalogue entry, or a plain one for a name the DM typed. */
export function effectDef(name: string): EffectDef {
  return BY_ID.get(name) ?? { id: name, label: name.charAt(0).toUpperCase() + name.slice(1), icon: '•', color: '#e5e7eb', group: 'harmful', info: 'Custom effect.' };
}

export interface EffectInfo { rounds?: number; hidden?: boolean }

/** Count down durations for a token whose turn just began. Returns what wore off. */
export function tickEffects(conditions: string[], info: Record<string, EffectInfo> | undefined): { conditions: string[]; effectInfo: Record<string, EffectInfo> | undefined; expired: string[] } {
  if (!info) return { conditions, effectInfo: info, expired: [] };
  const next: Record<string, EffectInfo> = {};
  const expired: string[] = [];
  for (const c of conditions) {
    const i = info[c];
    if (!i) continue;
    if (i.rounds !== undefined) {
      if (i.rounds <= 1) { expired.push(c); continue; }
      next[c] = { ...i, rounds: i.rounds - 1 };
    } else next[c] = i;
  }
  return { conditions: conditions.filter((c) => !expired.includes(c)), effectInfo: Object.keys(next).length ? next : undefined, expired };
}
