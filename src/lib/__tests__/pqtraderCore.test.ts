import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseAuctionMessage } from '@/lib/parser/auctionParser';
import {
  parseInventoryTxt,
  parseBzrIni,
  buildOwnedInventoryCatalog,
  buildActiveTraderSyncPayload,
  serializeBzrIni,
} from '@/lib/takp/takpFileSystem';
import { QuarmItem } from '@/types/pqtrader';

const catalogPath = path.resolve(__dirname, '../../../public/data/items_catalog.json');
const catalogById: Record<string, QuarmItem> = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));

describe('PQ Trader — High-Precision Auction Parser', () => {
  it("parses the user's exact PoP spell swap example (Spell: Karana's Renewal -> 21657 + WTB Command of Tunare)", () => {
    const msg =
      "Beab [65 Wood Elf Druid] WTT Spell: Karana's Renewal for command of tunare, pst if interested";
    const res = parseAuctionMessage(msg, 'ingame-auctions');

    expect(res.isTradeRelated).toBe(true);
    expect(res.actorName).toBe('Beab');
    expect(res.listings).toHaveLength(2);
    expect(res.listings[0]).toMatchObject({
      listingType: 'WTT',
      itemId: 21657,
      itemName: "Spell: Karana's Renewal",
      actorName: 'Beab',
      currencyType: 'SIMILAR_SPELL',
      pricePp: null,
      priceQuantity: 1,
      tradeMetadata: 'for command of tunare, pst if interested',
    });
    expect(res.listings[1]).toMatchObject({
      listingType: 'WTB',
      itemName: 'Spell: Command of Tunare',
      actorName: 'Beab',
      pricePp: null,
    });
    expect(res.maybeLog).toBeNull();
  });

  it('parses Aurthur WTT Blood of Saryn (with 1-char typo -> #26916) and logs WTB for #19292 and #28570 while discarding "7th"', () => {
    const msg = `Aurthur <Erud's Crossing Guard> — 5:56 PM
WTT:  Blood of Saryn, will accept 65 Avatar or 7th or Hand of Virtue`;
    const res = parseAuctionMessage(msg, 'trade');

    expect(res.isTradeRelated).toBe(true);
    expect(res.actorName).toBe('Aurthur');
    expect(res.listings).toHaveLength(3);

    // 1) Has #26916 Spell: Blood of Saryrn and is looking to trade for other spells
    expect(res.listings[0]).toMatchObject({
      listingType: 'WTT',
      itemId: 26916,
      itemName: 'Spell: Blood of Saryrn',
      actorName: 'Aurthur',
      currencyType: 'SIMILAR_SPELL',
      pricePp: null,
      tradeMetadata: 'will accept 65 Avatar or 7th or Hand of Virtue',
    });

    // 2) WTB Spell: Avatar (#19292) no price offered
    expect(res.listings[1]).toMatchObject({
      listingType: 'WTB',
      itemId: 19292,
      itemName: 'Spell: Avatar',
      actorName: 'Aurthur',
      pricePp: null,
      tradeMetadata: 'WTT offering Spell: Blood of Saryrn',
    });

    // 3) WTB Spell: Hand of Virtue (#28570) no price offered ("7th" discarded)
    expect(res.listings[2]).toMatchObject({
      listingType: 'WTB',
      itemId: 28570,
      itemName: 'Spell: Hand of Virtue',
      actorName: 'Aurthur',
      pricePp: null,
      tradeMetadata: 'WTT offering Spell: Blood of Saryrn',
    });
  });

  it("parses Karcist WTB with dropped possessive 's (Mrylokar Greaves -> Mrylokar's Greaves #4555) and no price", () => {
    const msg = `Karcist — 2:24 PM
WTB Barbed Rubicite Pauldrons, Mrylokar Greaves`;
    const res = parseAuctionMessage(msg, 'trade');

    expect(res.isTradeRelated).toBe(true);
    expect(res.actorName).toBe('Karcist');
    expect(res.listings).toHaveLength(2);

    expect(res.listings[0]).toMatchObject({
      listingType: 'WTB',
      itemId: 27943,
      itemName: 'Barbed Rubicite Pauldrons',
      actorName: 'Karcist',
      currencyType: 'PP',
      pricePp: null,
      tradeMetadata: null,
    });

    expect(res.listings[1]).toMatchObject({
      listingType: 'WTB',
      itemId: 4555,
      itemName: "Mrylokar's Greaves",
      actorName: 'Karcist',
      currencyType: 'PP',
      pricePp: null,
      tradeMetadata: null,
    });
  });

  it('parses LegendSham 4-item WTB with omitted "the" (Shield of Immaculate -> #11551, Earring of Frozen Skull -> #1744)', () => {
    const msg = `LegendSham / LegendStab / Beast [Zek],  — 12:33 PM
WTB Amulet of Necropotence, 80k obo, negotiable  -  Shield of Immaculate 40k obo - Earring of Frozen Skull 40k obo - Puppet Strings 45k`;
    const res = parseAuctionMessage(msg, 'trade');

    expect(res.isTradeRelated).toBe(true);
    expect(res.actorName).toBe('LegendSham');
    expect(res.listings).toHaveLength(4);

    expect(res.listings[0]).toMatchObject({
      listingType: 'WTB',
      itemId: 11646,
      itemName: 'Amulet of Necropotence',
      actorName: 'LegendSham',
      pricePp: 80000,
      tradeMetadata: 'obo, negotiable',
    });

    expect(res.listings[1]).toMatchObject({
      listingType: 'WTB',
      itemId: 11551,
      itemName: 'Shield of the Immaculate',
      actorName: 'LegendSham',
      pricePp: 40000,
      tradeMetadata: 'obo',
    });

    expect(res.listings[2]).toMatchObject({
      listingType: 'WTB',
      itemId: 1744,
      itemName: 'Earring of the Frozen Skull',
      actorName: 'LegendSham',
      pricePp: 40000,
      tradeMetadata: 'obo',
    });

    expect(res.listings[3]).toMatchObject({
      listingType: 'WTB',
      itemId: 11643,
      itemName: 'Puppet Strings',
      actorName: 'LegendSham',
      pricePp: 45000,
      tradeMetadata: null,
    });
  });

  it("parses bvne WTB No-Drop Multi-Quest (MQ) item (Spiritualist's Ring -> #20844)", () => {
    const msg = `bvne — 9:06 PM
WTB Spiritualist's Ring MQ (posky)`;
    const res = parseAuctionMessage(msg, 'trade');

    expect(res.isTradeRelated).toBe(true);
    expect(res.actorName).toBe('bvne');
    expect(res.listings).toHaveLength(1);
    expect(res.listings[0]).toMatchObject({
      listingType: 'WTB',
      itemId: 20844,
      itemName: 'Spiritualist`s Ring',
      actorName: 'bvne',
      currencyType: 'PP',
      pricePp: null,
      tradeMetadata: 'MQ (posky)',
    });
  });

  it('strips pqdi.cc markdown URLs, matches Words of Terris -> Spell: Word of Terris (#28427), and does not assume Similar Spell on plain WTB', () => {
    const sentaiMsg =
      'Sentai [65 Iksar Necromancer] WTT [Glyphed Rune Word](https://www.pqdi.cc/item/0029132) for Words of Terris';
    const sentaiRes = parseAuctionMessage(sentaiMsg, 'ingame-auctions');

    expect(sentaiRes.actorName).toBe('Sentai');
    expect(sentaiRes.listings).toHaveLength(2);
    expect(sentaiRes.listings[0]).toMatchObject({
      listingType: 'WTT',
      itemId: 29132,
      itemName: 'Glyphed Rune Word',
      actorName: 'Sentai',
      tradeMetadata: 'for Words of Terris',
    });
    expect(sentaiRes.listings[1]).toMatchObject({
      listingType: 'WTB',
      itemId: 28427,
      itemName: 'Spell: Word of Terris',
      actorName: 'Sentai',
      currencyType: 'PP',
      pricePp: null,
      tradeMetadata: 'WTT offering Glyphed Rune Word',
    });

    const kodyakMsg =
      'Kodyak [62 Ogre Beastlord] WTB [Spell: Spirit of Arag](https://www.pqdi.cc/item/0028548)';
    const kodyakRes = parseAuctionMessage(kodyakMsg, 'ingame-auctions');

    expect(kodyakRes.actorName).toBe('Kodyak');
    expect(kodyakRes.listings).toHaveLength(1);
    expect(kodyakRes.listings[0]).toMatchObject({
      listingType: 'WTB',
      itemId: 28548,
      itemName: 'Spell: Spirit of Arag',
      actorName: 'Kodyak',
      currencyType: 'PP',
      pricePp: null,
      tradeMetadata: null,
    });
  });

  it('parses multi-item WTS + WTB compound messages with k and pp prices and aliases', () => {
    const msg =
      "Traderdude auctions, 'WTS Cloak of Flames 7.5k / Hierophant's Cloak 1200pp | WTB FBSS 2.2k'";
    const res = parseAuctionMessage(msg, 'ingame-auctions');

    expect(res.isTradeRelated).toBe(true);
    expect(res.actorName).toBe('Traderdude');
    expect(res.listings).toHaveLength(3);

    expect(res.listings[0]).toMatchObject({
      listingType: 'WTS',
      itemName: 'Cloak of Flames',
      currencyType: 'PP',
      pricePp: 7500,
    });
    expect(res.listings[1]).toMatchObject({
      listingType: 'WTS',
      itemName: "Hierophant's Cloak",
      currencyType: 'PP',
      pricePp: 1200,
    });
    expect(res.listings[2]).toMatchObject({
      listingType: 'WTB',
      itemName: 'Flowing Black Silk Sash',
      currencyType: 'PP',
      pricePp: 2200,
    });
  });

  it('parses PoP parchment trade offers (Spectral / Ethereal / Glyphed)', () => {
    const msg = 'Zondro [65 High Elf Cleric] WTS Spell: Judgement for 1 spectral parchment pst';
    const res = parseAuctionMessage(msg, 'trade');

    expect(res.listings).toHaveLength(1);
    expect(res.listings[0]).toMatchObject({
      listingType: 'WTS',
      itemId: 7608,
      itemName: 'Spell: Judgement',
      actorName: 'Zondro',
      currencyType: 'SPECTRAL_PARCHMENT',
      pricePp: null,
      priceQuantity: 1,
    });
  });

  it('ignores non-trade chat noise in #ingame-general and logs ambiguous trade posts to Maybes', () => {
    const chatNoise =
      'Steps [65 Monk] Anyone know if Trakanon is in window or did he die earlier tonight?';
    const resNoise = parseAuctionMessage(chatNoise, 'ingame-general');
    expect(resNoise.isTradeRelated).toBe(false);
    expect(resNoise.listings).toHaveLength(0);
    expect(resNoise.maybeLog).toBeNull();

    const mysteryTrade = 'Mysteryguy [60 Warrior] WTS super rare mystery widget 500p pst';
    const resMaybe = parseAuctionMessage(mysteryTrade, 'trade');
    expect(resMaybe.isTradeRelated).toBe(true);
    expect(resMaybe.listings).toHaveLength(0);
    expect(resMaybe.maybeLog).not.toBeNull();
    expect(resMaybe.maybeLog?.reason).toBe('UNMATCHED_ITEM_WITH_TRADE_INTENT');
  });
});

describe('PQ Trader — TAKP Inventory.txt & BZR_*.ini Intersection Engine', () => {
  it('parses real Derpydoodle-Inventory.txt and BZR_Derpydoodle_pq.proj.ini and strictly intersects owned items', () => {
    const invFile = rTag('C:\\TAKPv22\\Derpydoodle-Inventory.txt');
    const bzrFile = rTag('C:\\TAKPv22\\BZR_Derpydoodle_pq.proj.ini');
    if (!fs.existsSync(invFile) || !fs.existsSync(bzrFile)) {
      return;
    }

    const invContent = fs.readFileSync(invFile, 'utf-8');
    const bzrContent = fs.readFileSync(bzrFile, 'utf-8');

    const parsedInv = parseInventoryTxt('Derpydoodle-Inventory.txt', invContent);
    const parsedBzr = parseBzrIni('BZR_Derpydoodle_pq.proj.ini', bzrContent);

    expect(parsedInv.characterName).toBe('Derpydoodle');
    expect(parsedBzr.traderName).toBe('Derpydoodle');
    expect(parsedBzr.isUtilityIni).toBe(false);

    // Cloak of Flames in BZR_Derpydoodle_pq.proj.ini is 7500000 CP (7500 PP)
    expect(parsedBzr.pricesByItemName['Cloak of Flames']).toBe(7500000);

    const owned = buildOwnedInventoryCatalog(
      [parsedInv],
      [parsedBzr],
      new Set(['Derpydoodle']),
      catalogById
    );

    // Hierophant's Cloak (ID 1622) is in Derpydoodle's General2-Slot2 (inside Trader's Satchel!)
    const hiero = owned.find((i) => i.itemId === 1622);
    expect(hiero).toBeDefined();
    expect(hiero?.nodrop).toBe(false);
    expect(hiero?.instances[0].inTradersSatchel).toBe(true);

    // Verify buildActiveTraderSyncPayload ONLY includes items Derpydoodle currently owns AND has priced > 0 in BZR
    const syncPayload = buildActiveTraderSyncPayload(owned);
    const totalBzrEntries = Object.keys(parsedBzr.pricesByItemName).length;
    expect(totalBzrEntries).toBeGreaterThan(200);
    // Sync payload must be strictly a subset of currently owned items (much smaller than all 236 historical BZR entries!)
    expect(syncPayload.length).toBeGreaterThan(0);
    expect(syncPayload.length).toBeLessThan(owned.length);

    // Verify serializeBzrIni round-trips copper prices accurately
    const serialized = serializeBzrIni({ 'Cloak of Flames': 7500000, 'Adamantite Band': 500000 });
    expect(serialized).toContain('[ItemToSell]\r\nAdamantite Band=500000\r\nCloak of Flames=7500000\r\n');
  });

  it('scans all 45 Inventory.txt and BZR_*.ini files in C:\\TAKPv22 and enforces No-Drop & Active Trader rules', () => {
    const takpDir = 'C:\\TAKPv22';
    if (!fs.existsSync(takpDir)) return;

    const files = fs.readdirSync(takpDir);
    const inventories = files
      .filter((f) => /-Inventory\.txt$/i.test(f))
      .map((f) => parseInventoryTxt(f, fs.readFileSync(path.join(takpDir, f), 'utf-8')));

    const bzrFiles = files
      .filter((f) => /^BZR_.+_pq\.proj\.ini$/i.test(f))
      .map((f) => parseBzrIni(f, fs.readFileSync(path.join(takpDir, f), 'utf-8')));

    expect(inventories.length).toBeGreaterThanOrEqual(40);
    expect(bzrFiles.filter((b) => !b.isUtilityIni).length).toBe(4); // Derpydoodle, Tweemule, Zondromule, Zondrop

    const owned = buildOwnedInventoryCatalog(
      inventories,
      bzrFiles,
      new Set(['Derpydoodle', 'Zondrop', 'Zondromule']),
      catalogById
    );

    const tradeableOwned = owned.filter((i) => !i.nodrop);
    const noDropOwned = owned.filter((i) => i.nodrop);

    // Ensure both tradeable and No-Drop items are tracked in inventory
    expect(tradeableOwned.length).toBeGreaterThan(100);
    expect(noDropOwned.length).toBeGreaterThan(20);

    // Ensure No-Drop items never have activeBzrPrices or appear in sync payload
    expect(noDropOwned.every((i) => i.activeBzrPrices.length === 0)).toBe(true);

    const syncPayload = buildActiveTraderSyncPayload(owned);
    expect(syncPayload.length).toBeGreaterThan(0);
    expect(syncPayload.every((p) => !catalogById[String(p.itemId)]?.nodrop)).toBe(true);
  });
});

function rTag(p: string) {
  return p;
}
