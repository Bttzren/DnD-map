import type { Rng } from './rng';
import type { Theme } from './types';

const ROOM_NAMES: Record<Theme, string[]> = {
  dungeon: ['Guard Room', 'Armory', 'Barracks', 'Prison Cells', 'Torture Chamber', 'Storeroom', 'Shrine', 'Throne Room',
    'Mess Hall', 'Library', 'Workshop', 'Treasury', 'Well Room', 'Kennel', 'Captain\'s Quarters', 'Gatehouse', 'Laboratory'],
  crypt: ['Ossuary', 'Burial Niche', 'Embalming Room', 'Chapel', 'Reliquary', 'Mourners\' Hall', 'Sarcophagus Chamber',
    'Bone Pit', 'Sealed Tomb', 'Priest\'s Cell', 'Hall of Effigies', 'Catacomb', 'Altar of Rest'],
  sewer: ['Cistern', 'Overflow Chamber', 'Pump Room', 'Junction', 'Smugglers\' Den', 'Collapsed Tunnel', 'Grate Room',
    'Sluice Gate', 'Rat Nest', 'Maintenance Room', 'Outflow'],
  cave: ['Grotto', 'Crystal Hollow', 'Fungus Garden', 'Echoing Cavern', 'Bat Roost', 'Underground Lake', 'Chasm Edge',
    'Den', 'Glowworm Gallery', 'Collapsed Hall', 'Stalagmite Forest', 'Hot Spring'],
  forest: ['Clearing', 'Glade', 'Hunters\' Camp', 'Stone Circle', 'Fallen Oak', 'Bandit Camp', 'Mossy Hollow',
    'Fairy Ring', 'Old Shrine', 'Woodcutter\'s Site', 'Sunlit Meadow'],
  tavern: ['Common Room', 'Kitchen', 'Cellar Stairs', 'Guest Room', 'Storeroom', 'Hallway', 'Street'],
};

const NOTES: Record<Theme, string[]> = {
  dungeon: ['Smells of damp straw and old smoke.', 'Scratches on the floor lead to the east wall.', 'A torch still burns here.',
    'Bloodstains, a day old.', 'Rusted weapons on a rack.', 'Water drips steadily from the ceiling.', 'Muffled voices from beyond the door.'],
  crypt: ['Cold air, breath fogs.', 'Names chiselled off every plaque.', 'Fresh candles, recently lit.', 'Bones arranged in patterns.',
    'A faint chanting echoes.', 'Dust undisturbed for centuries — except one set of footprints.'],
  sewer: ['Ankle-deep sludge. Disgusting.', 'Something large moved through here recently.', 'Faint daylight from a grate above.',
    'The current is strong.', 'Smugglers\' crates, half-rotten.'],
  cave: ['Faint glow from fungus on the walls.', 'Loose rocks: noisy to cross.', 'A cool draft from somewhere deeper.',
    'Bones of small animals.', 'Water echoes in the dark.', 'Crystal veins glitter in torchlight.'],
  forest: ['Birdsong stops suddenly.', 'Tracks: boots, at least five sets.', 'A cold campfire, still warm ashes.',
    'Mushrooms in a perfect ring.', 'Thick undergrowth muffles footsteps.'],
  tavern: ['Rowdy and loud.', 'A bard tunes a lute in the corner.', 'Smells of stew and spilled ale.', 'Quiet. Too quiet.'],
};

export function roomName(theme: Theme, rng: Rng, used: Set<string>): string {
  const pool = ROOM_NAMES[theme].filter((n) => !used.has(n));
  const name = pool.length ? rng.pick(pool) : `${rng.pick(ROOM_NAMES[theme])} ${used.size + 1}`;
  used.add(name);
  return name;
}

export function roomNote(theme: Theme, rng: Rng): string {
  return rng.chance(0.6) ? rng.pick(NOTES[theme]) : '';
}

const MAP_NAMES: Record<Theme, [string[], string[]]> = {
  dungeon: [['The Sunken', 'The Forgotten', 'The Iron', 'The Broken', 'The Black', 'The Warden\'s', 'The Silent'], ['Keep', 'Halls', 'Bastion', 'Undercroft', 'Stronghold', 'Vaults', 'Dungeon']],
  crypt: [['The Weeping', 'The Hollow', 'The Ashen', 'The Last', 'The Pale', 'The Nameless'], ['Crypt', 'Tomb', 'Catacombs', 'Ossuary', 'Mausoleum', 'Sepulchre']],
  cave: [['The Glittering', 'The Drowned', 'The Howling', 'The Deep', 'The Fungal', 'The Whispering'], ['Caverns', 'Grottoes', 'Depths', 'Hollows', 'Warrens', 'Delve']],
  sewer: [['The Rotting', 'The Old', 'The Flooded', 'The Rat King\'s', 'The Lower', 'The Forsaken'], ['Sewers', 'Cisterns', 'Drains', 'Tunnels', 'Undercity', 'Sluices']],
  forest: [['The Thornwood', 'The Mossy', 'The Whispering', 'The Old', 'The Moonlit', 'The Tangled'], ['Glade', 'Clearing', 'Thicket', 'Crossing', 'Hollow', 'Wilds']],
  tavern: [['The Prancing', 'The Gilded', 'The Drowned', 'The Sleeping', 'The Rusty', 'The Laughing'], ['Stag', 'Tankard', 'Rat', 'Giant', 'Lantern', 'Wyvern']],
};

export function mapName(theme: Theme, rng: Rng): string {
  const [a, b] = MAP_NAMES[theme];
  return `${rng.pick(a)} ${rng.pick(b)}`;
}
