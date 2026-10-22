export const EQ_CLASSES: { bit: number; short: string; name: string }[] = [
  { bit: 1, short: 'WAR', name: 'Warrior' },
  { bit: 2, short: 'CLR', name: 'Cleric' },
  { bit: 4, short: 'PAL', name: 'Paladin' },
  { bit: 8, short: 'RNG', name: 'Ranger' },
  { bit: 16, short: 'SHD', name: 'Shadowknight' },
  { bit: 32, short: 'DRU', name: 'Druid' },
  { bit: 64, short: 'MNK', name: 'Monk' },
  { bit: 128, short: 'BRD', name: 'Bard' },
  { bit: 256, short: 'ROG', name: 'Rogue' },
  { bit: 512, short: 'SHM', name: 'Shaman' },
  { bit: 1024, short: 'NEC', name: 'Necromancer' },
  { bit: 2048, short: 'WIZ', name: 'Wizard' },
  { bit: 4096, short: 'MAG', name: 'Magician' },
  { bit: 8192, short: 'ENC', name: 'Enchanter' },
  { bit: 16384, short: 'BST', name: 'Beastlord' },
];

export const ALL_CLASSES_MASK = 32767;

export const EQ_RACES: { bit: number; short: string; name: string }[] = [
  { bit: 1, short: 'HUM', name: 'Human' },
  { bit: 2, short: 'BAR', name: 'Barbarian' },
  { bit: 4, short: 'ERU', name: 'Erudite' },
  { bit: 8, short: 'ELF', name: 'Wood Elf' },
  { bit: 16, short: 'HIE', name: 'High Elf' },
  { bit: 32, short: 'DEF', name: 'Dark Elf' },
  { bit: 64, short: 'HEF', name: 'Half Elf' },
  { bit: 128, short: 'DWF', name: 'Dwarf' },
  { bit: 256, short: 'TRL', name: 'Troll' },
  { bit: 512, short: 'OGR', name: 'Ogre' },
  { bit: 1024, short: 'HFL', name: 'Halfling' },
  { bit: 2048, short: 'GNM', name: 'Gnome' },
  { bit: 4096, short: 'IKS', name: 'Iksar' },
  { bit: 8192, short: 'VAH', name: 'Vah Shir' },
];

export const ALL_RACES_MASK = 16383;

export const EQ_SLOTS: { bit: number; name: string }[] = [
  { bit: 1, name: 'CHARM' },
  { bit: 2, name: 'EAR' },
  { bit: 4, name: 'HEAD' },
  { bit: 8, name: 'FACE' },
  { bit: 16, name: 'EAR' },
  { bit: 32, name: 'NECK' },
  { bit: 64, name: 'SHOULDERS' },
  { bit: 128, name: 'ARMS' },
  { bit: 256, name: 'BACK' },
  { bit: 512, name: 'WRIST' },
  { bit: 1024, name: 'WRIST' },
  { bit: 2048, name: 'RANGE' },
  { bit: 4096, name: 'HANDS' },
  { bit: 8192, name: 'PRIMARY' },
  { bit: 16384, name: 'SECONDARY' },
  { bit: 32768, name: 'FINGERS' },
  { bit: 65536, name: 'FINGERS' },
  { bit: 131072, name: 'CHEST' },
  { bit: 262144, name: 'LEGS' },
  { bit: 524288, name: 'FEET' },
  { bit: 1048576, name: 'WAIST' },
  { bit: 2097152, name: 'AMMO' },
];

export const EQ_ITEM_TYPES: Record<number, string> = {
  0: '1H Slashing',
  1: '2H Slashing',
  2: 'Piercing',
  3: '1H Blunt',
  4: '2H Blunt',
  5: 'Archery',
  7: 'Throwing',
  8: 'Shield',
  10: 'Armor',
  11: 'Tradeskill / Misc',
  12: 'Lockpick',
  14: 'Food',
  15: 'Drink',
  16: 'Light Source',
  17: 'Combinable / Stackable',
  18: 'Bandage',
  19: 'Throwing',
  20: 'Spell / Scroll',
  21: 'Potion',
  23: 'Wind Instrument',
  24: 'Stringed Instrument',
  25: 'Brass Instrument',
  26: 'Percussion Instrument',
  27: 'Arrow',
  29: 'Jewelry',
  35: '2H Piercing',
  36: 'Fishing Pole',
  37: 'Fishing Bait',
  38: 'Alcohol',
  39: 'Key',
  40: 'Compass',
  42: 'Poison',
  45: 'Hand to Hand',
};

export const EQ_SIZES: Record<number, string> = {
  0: 'TINY',
  1: 'SMALL',
  2: 'MEDIUM',
  3: 'LARGE',
  4: 'GIANT',
  5: 'GIANT+',
};

export function decodeClasses(mask?: number): string {
  if (!mask || mask <= 0) return 'NONE';
  if ((mask & ALL_CLASSES_MASK) === ALL_CLASSES_MASK) return 'ALL';
  const matched = EQ_CLASSES.filter((c) => (mask & c.bit) !== 0).map((c) => c.short);
  return matched.length > 0 ? matched.join(' ') : 'NONE';
}

export function decodeRaces(mask?: number): string {
  if (!mask || mask <= 0) return 'NONE';
  if ((mask & ALL_RACES_MASK) === ALL_RACES_MASK) return 'ALL';
  const matched = EQ_RACES.filter((r) => (mask & r.bit) !== 0).map((r) => r.short);
  return matched.length > 0 ? matched.join(' ') : 'NONE';
}

export function decodeSlots(mask?: number): string[] {
  if (!mask || mask <= 0) return [];
  const seen = new Set<string>();
  for (const s of EQ_SLOTS) {
    if ((mask & s.bit) !== 0) {
      seen.add(s.name);
    }
  }
  return Array.from(seen);
}

export function decodeSize(size?: number): string {
  if (size === undefined || size === null) return 'SMALL';
  return EQ_SIZES[size] || 'MEDIUM';
}

export function decodeItemType(itemtype?: number, bagslots?: number): string {
  if (bagslots && bagslots > 0) return 'Container';
  if (itemtype === undefined || itemtype === null) return 'Armor / Equip';
  return EQ_ITEM_TYPES[itemtype] || 'Equipment';
}
