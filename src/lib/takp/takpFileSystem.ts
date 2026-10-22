import {
  BzrTraderFile,
  CharacterItemInstance,
  InventorySlotCategory,
  OwnedInventoryItem,
  QuarmItem,
} from '@/types/pqtrader';

export const TRADERS_SATCHEL_ITEM_ID = 17899;

export const UTILITY_BZR_TRADERS = new Set([
  'remoteaverage',
  'remotelow',
  'remoterecent',
]);

export interface ParsedCharacterInventory {
  characterName: string;
  fileName: string;
  items: {
    location: string;
    name: string;
    id: number;
    count: number;
    slots: number;
    slotCategory: InventorySlotCategory;
    inTradersSatchel: boolean;
  }[];
}

export function extractCharacterFromInventoryFileName(fileName: string): string | null {
  const match = fileName.match(/^(.+)-Inventory\.txt$/i);
  return match ? match[1] : null;
}

export function extractTraderFromBzrFileName(fileName: string): string | null {
  const match = fileName.match(/^BZR_(.+)_pq\.proj\.ini$/i);
  return match ? match[1] : null;
}

export function categorizeInventoryLocation(
  location: string,
  satchelGeneralSlots: Set<string>
): { slotCategory: InventorySlotCategory; inTradersSatchel: boolean } {
  const loc = location.trim();
  const generalBagMatch = loc.match(/^(General\d+)-Slot\d+$/i);
  if (generalBagMatch) {
    const parentSlot = generalBagMatch[1];
    if (satchelGeneralSlots.has(parentSlot.toLowerCase())) {
      return { slotCategory: 'TRADER_SATCHEL', inTradersSatchel: true };
    }
    return { slotCategory: 'GENERAL', inTradersSatchel: false };
  }
  if (/^General\d+$/i.test(loc)) {
    return { slotCategory: 'GENERAL', inTradersSatchel: false };
  }
  if (/^SharedBank/i.test(loc)) {
    return { slotCategory: 'SHARED_BANK', inTradersSatchel: false };
  }
  if (/^Bank/i.test(loc)) {
    return { slotCategory: 'BANK', inTradersSatchel: false };
  }
  if (/^(Held|Cursor)/i.test(loc)) {
    return { slotCategory: 'HELD', inTradersSatchel: false };
  }
  return { slotCategory: 'EQUIPPED', inTradersSatchel: false };
}

/**
 * Parses a TAKP <charname>-Inventory.txt TSV file.
 * Includes both tradeable and No-Drop items so users can track full inventory.
 */
export function parseInventoryTxt(
  fileName: string,
  content: string
): ParsedCharacterInventory {
  const characterName = extractCharacterFromInventoryFileName(fileName) || fileName.replace(/\.txt$/i, '');
  const lines = content.split(/\r?\n/);

  // First pass: identify which General1..General8 slots contain a Trader's Satchel (ID 17899)
  const satchelGeneralSlots = new Set<string>();
  const rawRows: {
    location: string;
    name: string;
    id: number;
    count: number;
    slots: number;
  }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (i === 0 && line.toLowerCase().startsWith('location\t')) continue;

    const parts = line.split('\t');
    if (parts.length < 4) continue;

    const location = parts[0].trim();
    const rawName = parts[1].trim();
    const id = parseInt(parts[2].trim(), 10);
    const count = parseInt(parts[3].trim(), 10) || 1;
    const slots = parts[4] ? parseInt(parts[4].trim(), 10) || 0 : 0;

    if (!id || id <= 0 || rawName === 'Empty') continue;

    if (/^General\d+$/i.test(location) && id === TRADERS_SATCHEL_ITEM_ID) {
      satchelGeneralSlots.add(location.toLowerCase());
    }

    rawRows.push({
      location,
      name: rawName.replace(/\*+$/, '').trim(),
      id,
      count: Math.max(1, count),
      slots,
    });
  }

  const items = rawRows.map((row) => {
    const { slotCategory, inTradersSatchel } = categorizeInventoryLocation(
      row.location,
      satchelGeneralSlots
    );
    return {
      ...row,
      slotCategory,
      inTradersSatchel,
    };
  });

  return {
    characterName,
    fileName,
    items,
  };
}

/**
 * Parses a TAKP BZR_<charname>_pq.proj.ini file.
 * Note: Prices in BZR INI files are stored in Copper Pieces (1 PP = 1000 CP).
 */
export function parseBzrIni(fileName: string, content: string): BzrTraderFile {
  const traderName = extractTraderFromBzrFileName(fileName) || fileName.replace(/\.ini$/i, '');
  const isUtilityIni = UTILITY_BZR_TRADERS.has(traderName.toLowerCase());
  const pricesByItemName: Record<string, number> = {};

  const lines = content.split(/\r?\n/);
  let inItemSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;

    if (line.startsWith('[') && line.endsWith(']')) {
      const section = line.slice(1, -1).trim().toLowerCase();
      inItemSection = section === 'itemtosell';
      continue;
    }

    if (inItemSection) {
      const eqIdx = line.lastIndexOf('=');
      if (eqIdx <= 0) continue;
      const itemName = line.slice(0, eqIdx).trim();
      const rawVal = line.slice(eqIdx + 1).trim();
      const cpVal = parseInt(rawVal, 10);
      if (itemName && !Number.isNaN(cpVal) && cpVal >= 0) {
        pricesByItemName[itemName] = cpVal;
      }
    }
  }

  return {
    fileName,
    traderName,
    isUtilityIni,
    pricesByItemName,
  };
}

/**
 * Serializes a BzrTraderFile back to TAKP BZR_<charname>_pq.proj.ini format.
 * Sorts items alphabetically under [ItemToSell] and uses CRLF line endings.
 */
export function serializeBzrIni(pricesByItemName: Record<string, number>): string {
  const sortedEntries = Object.entries(pricesByItemName).sort(([a], [b]) =>
    a.localeCompare(b, 'en', { sensitivity: 'base' })
  );
  const lines = ['[ItemToSell]'];
  for (const [name, cp] of sortedEntries) {
    const cleanCp = Math.max(0, Math.round(cp));
    lines.push(`${name}=${cleanCp}`);
  }
  return lines.join('\r\n') + '\r\n';
}

export function normalizeBzrItemKey(name: string): string {
  return name.toLowerCase().replace(/`/g, "'").replace(/\s+/g, ' ').trim();
}

/**
 * Combines all parsed <charname>-Inventory.txt files and BZR_<charname>_pq.proj.ini files.
 * Strictly separates:
 *  - activeBzrPrices: BZR prices on characters who CURRENTLY hold the item in their Inventory.txt
 *  - staleBzrMemory: BZR prices from BZR_*.ini files where that character does NOT currently hold the item
 */
export function buildOwnedInventoryCatalog(
  inventories: ParsedCharacterInventory[],
  bzrFiles: BzrTraderFile[],
  activeTraderNames: Set<string>,
  catalogById?: Record<string, QuarmItem>
): OwnedInventoryItem[] {
  const byItemId = new Map<number, OwnedInventoryItem>();

  // Build normalized item name -> trader BZR price map for each character BZR file
  const bzrNormalizedMap = new Map<
    string, // lower(traderName)
    { traderName: string; isUtilityIni: boolean; byNormName: Map<string, number> }
  >();

  for (const bzr of bzrFiles) {
    if (bzr.isUtilityIni) continue;
    const normMap = new Map<string, number>();
    for (const [itemName, cp] of Object.entries(bzr.pricesByItemName)) {
      normMap.set(normalizeBzrItemKey(itemName), cp);
    }
    bzrNormalizedMap.set(bzr.traderName.toLowerCase(), {
      traderName: bzr.traderName,
      isUtilityIni: bzr.isUtilityIni,
      byNormName: normMap,
    });
  }

  // Aggregate owned items across all character inventories
  for (const inv of inventories) {
    for (const row of inv.items) {
      const catItem = catalogById ? catalogById[String(row.id)] : undefined;
      const canonicalName = catItem?.name || row.name;
      // In Quarm catalog: nodrop === true means NO DROP
      const isNoDrop = catItem ? Boolean(catItem.nodrop) : false;

      let entry = byItemId.get(row.id);
      if (!entry) {
        entry = {
          itemId: row.id,
          itemName: canonicalName,
          nodrop: isNoDrop,
          totalCount: 0,
          instances: [],
          activeBzrPrices: [],
          staleBzrMemory: [],
        };
        byItemId.set(row.id, entry);
      }

      entry.totalCount += row.count;
      entry.instances.push({
        characterName: inv.characterName,
        location: row.location,
        slotCategory: row.slotCategory,
        inTradersSatchel: row.inTradersSatchel,
        count: row.count,
      });
    }
  }

  // Intersect each owned item with BZR_*.ini files
  const activeLowerSet = new Set(Array.from(activeTraderNames).map((n) => n.toLowerCase()));

  for (const item of byItemId.values()) {
    if (item.nodrop) continue; // No-Drop items cannot have BZR prices

    const normName = normalizeBzrItemKey(item.itemName);
    const owningCharsMap = new Map<string, { charName: string; inTradersSatchel: boolean }>();

    for (const inst of item.instances) {
      const key = inst.characterName.toLowerCase();
      const prev = owningCharsMap.get(key);
      if (!prev || inst.inTradersSatchel) {
        owningCharsMap.set(key, {
          charName: inst.characterName,
          inTradersSatchel: Boolean(prev?.inTradersSatchel || inst.inTradersSatchel),
        });
      }
    }

    for (const [traderKey, bzrInfo] of bzrNormalizedMap.entries()) {
      const cp = bzrInfo.byNormName.get(normName);
      if (cp === undefined || cp <= 0) continue;
      const pp = Math.floor(cp / 1000);
      if (pp <= 0) continue;

      const ownerInfo = owningCharsMap.get(traderKey);
      if (ownerInfo) {
        // Character CURRENTLY owns this item AND has a BZR price > 0
        item.activeBzrPrices.push({
          characterName: ownerInfo.charName,
          priceCp: cp,
          pricePp: pp,
          isActiveTrader: activeLowerSet.has(traderKey),
          inTradersSatchel: ownerInfo.inTradersSatchel,
        });
      } else {
        // Trader does NOT currently hold this item in their Inventory.txt -> stale BZR memory!
        item.staleBzrMemory.push({
          traderName: bzrInfo.traderName,
          priceCp: cp,
          pricePp: pp,
        });
      }
    }
  }

  return Array.from(byItemId.values()).sort((a, b) =>
    a.itemName.localeCompare(b.itemName, 'en', { sensitivity: 'base' })
  );
}

/**
 * Extracts ONLY currently owned, tradeable items on designated Active Traders that have a valid PP price > 0.
 * Never includes unowned items from BZR_*.ini files.
 */
export function buildActiveTraderSyncPayload(ownedItems: OwnedInventoryItem[]) {
  const payload: {
    listingType: 'WTS';
    itemId: number;
    itemName: string;
    actorName: string;
    currencyType: 'PP';
    pricePp: number;
    priceQuantity: number;
    tradeMetadata: string | null;
    source: string;
    inTradersSatchel: boolean;
  }[] = [];

  for (const item of ownedItems) {
    if (item.nodrop) continue;
    for (const bzr of item.activeBzrPrices) {
      if (!bzr.isActiveTrader || bzr.pricePp <= 0) continue;
      payload.push({
        listingType: 'WTS',
        itemId: item.itemId,
        itemName: item.itemName,
        actorName: bzr.characterName,
        currencyType: 'PP',
        pricePp: bzr.pricePp,
        priceQuantity: 1,
        tradeMetadata: bzr.inTradersSatchel ? 'In Bazaar Trader Satchel' : 'In Trader Inventory',
        source: 'app:bzr-sync',
        inTradersSatchel: bzr.inTradersSatchel,
      });
    }
  }

  return payload;
}
