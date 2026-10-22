export type ListingType = 'WTS' | 'WTB' | 'WTT';

export type CurrencyType =
  | 'PP'
  | 'SIMILAR_SPELL'
  | 'ETHEREAL_PARCHMENT'
  | 'SPECTRAL_PARCHMENT'
  | 'GLYPHED_RUNE_WORD'
  | 'OTHER_TRADE';

export const CURRENCY_LABELS: Record<CurrencyType, string> = {
  PP: 'Platinum (PP)',
  SIMILAR_SPELL: 'Similar Tier Spell',
  ETHEREAL_PARCHMENT: 'Ethereal Parchment',
  SPECTRAL_PARCHMENT: 'Spectral Parchment',
  GLYPHED_RUNE_WORD: 'Glyphed Rune Word',
  OTHER_TRADE: 'Item / Other Trade',
};

export const CURRENCY_SHORT_LABELS: Record<CurrencyType, string> = {
  PP: 'pp',
  SIMILAR_SPELL: 'Similar Spell',
  ETHEREAL_PARCHMENT: 'Ethereal Parch.',
  SPECTRAL_PARCHMENT: 'Spectral Parch.',
  GLYPHED_RUNE_WORD: 'Glyphed Word',
  OTHER_TRADE: 'Trade',
};

export interface QuarmDropSource {
  npc: string;
  lvl: number;
  zone: string;
  rate: number;
}

export interface QuarmItem {
  id: number;
  name: string;
  nodrop?: boolean;
  lore?: boolean;
  loreText?: string;
  magic?: boolean;
  norent?: boolean;
  icon?: number;
  itemtype?: number;
  slots?: number;
  classes?: number;
  races?: number;
  ac?: number;
  hp?: number;
  mana?: number;
  damage?: number;
  delay?: number;
  range?: number;
  str?: number;
  sta?: number;
  agi?: number;
  dex?: number;
  wis?: number;
  int?: number;
  cha?: number;
  mr?: number;
  fr?: number;
  cr?: number;
  dr?: number;
  pr?: number;
  reqlevel?: number;
  reclevel?: number;
  weight?: number;
  size?: number;
  bagslots?: number;
  bagsize?: number;
  bagwr?: number;
  elemdmg?: { type: number; amt: number };
  banedmg?: { body: number; race: number; amt: number };
  click?: string;
  proc?: string;
  worn?: string;
  focus?: string;
  scroll?: string;
  drops?: QuarmDropSource[];
}

export interface MarketListing {
  id: number;
  listingType: ListingType;
  itemId: number;
  itemName: string;
  actorName: string;
  currencyType: CurrencyType;
  pricePp: number | null;
  priceQuantity: number;
  tradeMetadata: string | null;
  source: string;
  rawMessage: string | null;
  discordMessageId?: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  dedupeDayBucket: string;
}

export interface DailyPriceTrendPoint {
  date: string;
  avgPp: number;
  minPp: number;
  maxPp: number;
  medianPp: number;
  wtsCount: number;
  wtbCount: number;
}

export interface ItemMarketSummary {
  itemId: number;
  lastSeenPricePp: number | null;
  lastSeenAt: string | null;
  avg7dPp: number | null;
  avg30dPp: number | null;
  median30dPp: number | null;
  min30dPp: number | null;
  max30dPp: number | null;
  activeWtsCount: number;
  activeWtbCount: number;
  activeWttCount: number;
  sellers: MarketListing[]; // WTS and WTT listings
  buyers: MarketListing[];  // WTB listings
  trendPoints: DailyPriceTrendPoint[];
}

export type InventorySlotCategory =
  | 'TRADER_SATCHEL'
  | 'GENERAL'
  | 'EQUIPPED'
  | 'BANK'
  | 'SHARED_BANK'
  | 'HELD';

export interface CharacterItemInstance {
  characterName: string;
  location: string;
  slotCategory: InventorySlotCategory;
  inTradersSatchel: boolean;
  count: number;
}

export interface OwnedInventoryItem {
  itemId: number;
  itemName: string;
  nodrop: boolean;
  totalCount: number;
  instances: CharacterItemInstance[];
  /** Prices on characters currently holding this item (Active Inventory BZR Prices) */
  activeBzrPrices: {
    characterName: string;
    priceCp: number;
    pricePp: number;
    isActiveTrader: boolean;
    inTradersSatchel: boolean;
  }[];
  /** Historical/stale BZR entries in BZR_*.ini files for characters NOT currently holding this item */
  staleBzrMemory: {
    traderName: string;
    priceCp: number;
    pricePp: number;
  }[];
}

export interface BzrTraderFile {
  fileName: string;
  traderName: string;
  isUtilityIni: boolean; // true for RemoteAverage, RemoteLow, RemoteRecent
  pricesByItemName: Record<string, number>; // ItemName -> Copper pieces (CP)
}

export interface ParserReviewLog {
  id: number;
  channelName: string;
  authorName: string;
  rawMessage: string;
  reason: string;
  candidateItemsJson: string | null;
  discordMessageId: string | null;
  status: 'PENDING' | 'RESOLVED' | 'IGNORED';
  createdAt: string;
}
