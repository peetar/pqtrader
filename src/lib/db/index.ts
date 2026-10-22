import path from 'path';
import type Database from 'better-sqlite3';
import { neon } from '@neondatabase/serverless';
import {
  CurrencyType,
  DailyPriceTrendPoint,
  ItemMarketSummary,
  ListingType,
  MarketListing,
  ParserReviewLog,
} from '@/types/pqtrader';

export interface UpsertListingInput {
  listingType: ListingType;
  itemId: number;
  itemName: string;
  actorName: string;
  currencyType: CurrencyType;
  pricePp: number | null;
  priceQuantity?: number;
  tradeMetadata?: string | null;
  source: string;
  rawMessage?: string | null;
  discordMessageId?: string | null;
  timestampIso?: string;
}

export interface InsertReviewLogInput {
  channelName: string;
  authorName: string;
  rawMessage: string;
  reason: string;
  candidateTokens?: string[];
  discordMessageId?: string | null;
}

let sqliteInstance: Database.Database | null = null;
let pgSchemaReady = false;

function getPostgresUrl(): string | null {
  const url =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.STORAGE_URL ||
    '';
  return url.startsWith('postgres') ? url : null;
}

function isPostgresConfigured(): boolean {
  return Boolean(getPostgresUrl());
}

async function ensurePostgresSchema() {
  const pgUrl = getPostgresUrl();
  if (pgSchemaReady || !pgUrl) return;
  const sql = neon(pgUrl);
  await sql`
    CREATE TABLE IF NOT EXISTS listings (
      id SERIAL PRIMARY KEY,
      listing_type TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      currency_type TEXT NOT NULL,
      price_pp INTEGER,
      price_quantity INTEGER NOT NULL DEFAULT 1,
      trade_metadata TEXT,
      source TEXT NOT NULL,
      raw_message TEXT,
      discord_message_id TEXT,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      dedupe_day_bucket TEXT NOT NULL,
      UNIQUE(actor_name, item_id, listing_type, dedupe_day_bucket)
    );
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_listings_item_id ON listings(item_id, last_seen_at DESC);`;
  await sql`
    CREATE TABLE IF NOT EXISTS parser_review_logs (
      id SERIAL PRIMARY KEY,
      channel_name TEXT NOT NULL,
      author_name TEXT NOT NULL,
      raw_message TEXT NOT NULL,
      reason TEXT NOT NULL,
      candidate_items_json TEXT,
      discord_message_id TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `;
  pgSchemaReady = true;
}

function getSqliteDb(): Database.Database {
  if (sqliteInstance) return sqliteInstance;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BetterSqlite3 = require('better-sqlite3') as typeof Database;
  const baseDir = process.env.VERCEL ? '/tmp' : process.cwd();
  const dbPath = path.resolve(baseDir, 'pqtrader_local.sqlite');
  const db = new BetterSqlite3(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS listings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      listing_type TEXT NOT NULL,
      item_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      currency_type TEXT NOT NULL,
      price_pp INTEGER,
      price_quantity INTEGER NOT NULL DEFAULT 1,
      trade_metadata TEXT,
      source TEXT NOT NULL,
      raw_message TEXT,
      discord_message_id TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      dedupe_day_bucket TEXT NOT NULL,
      UNIQUE(actor_name, item_id, listing_type, dedupe_day_bucket)
    );

    CREATE INDEX IF NOT EXISTS idx_listings_item_id ON listings(item_id, last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_listings_type ON listings(listing_type, last_seen_at DESC);

    CREATE TABLE IF NOT EXISTS parser_review_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_name TEXT NOT NULL,
      author_name TEXT NOT NULL,
      raw_message TEXT NOT NULL,
      reason TEXT NOT NULL,
      candidate_items_json TEXT,
      discord_message_id TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL
    );
  `);

  sqliteInstance = db;
  return db;
}

function toDayBucket(iso: string): string {
  return iso.slice(0, 10);
}

function mapRowToListing(row: Record<string, unknown>): MarketListing {
  return {
    id: Number(row.id),
    listingType: row.listing_type as ListingType,
    itemId: Number(row.item_id),
    itemName: String(row.item_name),
    actorName: String(row.actor_name),
    currencyType: row.currency_type as CurrencyType,
    pricePp: row.price_pp !== null && row.price_pp !== undefined ? Number(row.price_pp) : null,
    priceQuantity: Number(row.price_quantity || 1),
    tradeMetadata: row.trade_metadata ? String(row.trade_metadata) : null,
    source: String(row.source),
    rawMessage: row.raw_message ? String(row.raw_message) : null,
    discordMessageId: row.discord_message_id ? String(row.discord_message_id) : null,
    firstSeenAt: String(row.first_seen_at),
    lastSeenAt: String(row.last_seen_at),
    dedupeDayBucket: String(row.dedupe_day_bucket),
  };
}

export async function upsertListingsBatch(inputs: UpsertListingInput[]): Promise<number> {
  if (inputs.length === 0) return 0;

  if (isPostgresConfigured()) {
    await ensurePostgresSchema();
    const sql = neon(getPostgresUrl()!);
    let count = 0;
    for (const s of inputs) {
      const ts = s.timestampIso || new Date().toISOString();
      const bucket = toDayBucket(ts);
      await sql`
        INSERT INTO listings (
          listing_type, item_id, item_name, actor_name, currency_type,
          price_pp, price_quantity, trade_metadata, source, raw_message,
          discord_message_id, first_seen_at, last_seen_at, dedupe_day_bucket
        ) VALUES (
          ${s.listingType}, ${s.itemId}, ${s.itemName}, ${s.actorName}, ${s.currencyType},
          ${s.pricePp}, ${s.priceQuantity || 1}, ${s.tradeMetadata || null}, ${s.source}, ${s.rawMessage || null},
          ${s.discordMessageId || null}, ${ts}, ${ts}, ${bucket}
        )
        ON CONFLICT (actor_name, item_id, listing_type, dedupe_day_bucket)
        DO UPDATE SET
          price_pp = EXCLUDED.price_pp,
          currency_type = EXCLUDED.currency_type,
          price_quantity = EXCLUDED.price_quantity,
          trade_metadata = EXCLUDED.trade_metadata,
          source = EXCLUDED.source,
          raw_message = EXCLUDED.raw_message,
          last_seen_at = EXCLUDED.last_seen_at;
      `;
      count++;
    }
    return count;
  }

  const db = getSqliteDb();
  const stmt = db.prepare(`
    INSERT INTO listings (
      listing_type, item_id, item_name, actor_name, currency_type,
      price_pp, price_quantity, trade_metadata, source, raw_message,
      discord_message_id, first_seen_at, last_seen_at, dedupe_day_bucket
    ) VALUES (
      @listingType, @itemId, @itemName, @actorName, @currencyType,
      @pricePp, @priceQuantity, @tradeMetadata, @source, @rawMessage,
      @discordMessageId, @firstSeenAt, @lastSeenAt, @dedupeDayBucket
    )
    ON CONFLICT(actor_name, item_id, listing_type, dedupe_day_bucket)
    DO UPDATE SET
      price_pp = excluded.price_pp,
      currency_type = excluded.currency_type,
      price_quantity = excluded.price_quantity,
      trade_metadata = excluded.trade_metadata,
      source = excluded.source,
      raw_message = excluded.raw_message,
      last_seen_at = excluded.last_seen_at
  `);

  const tx = db.transaction((rows: UpsertListingInput[]) => {
    for (const s of rows) {
      const ts = s.timestampIso || new Date().toISOString();
      stmt.run({
        listingType: s.listingType,
        itemId: s.itemId,
        itemName: s.itemName,
        actorName: s.actorName,
        currencyType: s.currencyType,
        pricePp: s.pricePp,
        priceQuantity: s.priceQuantity || 1,
        tradeMetadata: s.tradeMetadata || null,
        source: s.source,
        rawMessage: s.rawMessage || null,
        discordMessageId: s.discordMessageId || null,
        firstSeenAt: ts,
        lastSeenAt: ts,
        dedupeDayBucket: toDayBucket(ts),
      });
    }
  });

  tx(inputs);
  return inputs.length;
}

export async function queryRecentListings(params: {
  q?: string;
  itemId?: number;
  listingType?: ListingType;
  currencyType?: string;
  actorName?: string;
  limit?: number;
}): Promise<MarketListing[]> {
  const limit = Math.min(params.limit || 100, 500);

  if (isPostgresConfigured()) {
    await ensurePostgresSchema();
    const sql = neon(getPostgresUrl()!);
    const rows = await sql`
      SELECT * FROM listings
      ORDER BY last_seen_at DESC
      LIMIT ${limit}
    `;
    return rows.map((r) => mapRowToListing(r as Record<string, unknown>)).filter((l) => {
      if (params.itemId && l.itemId !== params.itemId) return false;
      if (params.listingType && l.listingType !== params.listingType) return false;
      if (params.currencyType && l.currencyType !== params.currencyType) return false;
      if (params.actorName && !l.actorName.toLowerCase().includes(params.actorName.toLowerCase()))
        return false;
      if (
        params.q &&
        !l.itemName.toLowerCase().includes(params.q.toLowerCase()) &&
        !l.actorName.toLowerCase().includes(params.q.toLowerCase())
      )
        return false;
      return true;
    });
  }

  const db = getSqliteDb();
  const clauses: string[] = [];
  const bind: Record<string, unknown> = { limit };

  if (params.itemId) {
    clauses.push('item_id = @itemId');
    bind.itemId = params.itemId;
  }
  if (params.listingType) {
    clauses.push('listing_type = @listingType');
    bind.listingType = params.listingType;
  }
  if (params.currencyType) {
    clauses.push('currency_type = @currencyType');
    bind.currencyType = params.currencyType;
  }
  if (params.actorName) {
    clauses.push('LOWER(actor_name) LIKE @actorName');
    bind.actorName = `%${params.actorName.toLowerCase()}%`;
  }
  if (params.q) {
    clauses.push('(LOWER(item_name) LIKE @q OR LOWER(actor_name) LIKE @q OR LOWER(COALESCE(trade_metadata, "")) LIKE @q)');
    bind.q = `%${params.q.toLowerCase()}%`;
  }

  const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM listings ${whereSql} ORDER BY last_seen_at DESC LIMIT @limit`)
    .all(bind) as Record<string, unknown>[];

  return rows.map(mapRowToListing);
}

export async function getItemMarketSummary(itemId: number): Promise<ItemMarketSummary> {
  const allItemListings = await queryRecentListings({ itemId, limit: 300 });

  const sellers = allItemListings.filter(
    (l) => l.listingType === 'WTS' || l.listingType === 'WTT'
  );
  const buyers = allItemListings.filter((l) => l.listingType === 'WTB');

  const ppListings = allItemListings.filter(
    (l) => l.currencyType === 'PP' && l.pricePp !== null && l.pricePp > 0
  );

  const nowMs = Date.now();
  const ms7d = 7 * 24 * 3600 * 1000;
  const ms30d = 30 * 24 * 3600 * 1000;

  const pp7d = ppListings
    .filter((l) => nowMs - new Date(l.lastSeenAt).getTime() <= ms7d)
    .map((l) => l.pricePp as number);
  const pp30d = ppListings
    .filter((l) => nowMs - new Date(l.lastSeenAt).getTime() <= ms30d)
    .map((l) => l.pricePp as number);

  const calcAvg = (arr: number[]) =>
    arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

  const calcMedian = (arr: number[]) => {
    if (arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
      ? sorted[mid]
      : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  };

  // Group PP prices by YYYY-MM-DD for the trend chart
  const byDate = new Map<string, { wtsPrices: number[]; wtbPrices: number[]; allPrices: number[] }>();
  for (const l of ppListings) {
    const day = l.dedupeDayBucket || l.lastSeenAt.slice(0, 10);
    let bucket = byDate.get(day);
    if (!bucket) {
      bucket = { wtsPrices: [], wtbPrices: [], allPrices: [] };
      byDate.set(day, bucket);
    }
    bucket.allPrices.push(l.pricePp as number);
    if (l.listingType === 'WTB') {
      bucket.wtbPrices.push(l.pricePp as number);
    } else {
      bucket.wtsPrices.push(l.pricePp as number);
    }
  }

  const trendPoints: DailyPriceTrendPoint[] = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, b]) => ({
      date,
      avgPp: calcAvg(b.allPrices) || 0,
      minPp: Math.min(...b.allPrices),
      maxPp: Math.max(...b.allPrices),
      medianPp: calcMedian(b.allPrices) || 0,
      wtsCount: b.wtsPrices.length,
      wtbCount: b.wtbPrices.length,
    }));

  const latestPp = ppListings.length > 0 ? ppListings[0] : null;

  return {
    itemId,
    lastSeenPricePp: latestPp ? latestPp.pricePp : null,
    lastSeenAt: allItemListings.length > 0 ? allItemListings[0].lastSeenAt : null,
    avg7dPp: calcAvg(pp7d),
    avg30dPp: calcAvg(pp30d.length > 0 ? pp30d : ppListings.map((l) => l.pricePp as number)),
    median30dPp: calcMedian(pp30d.length > 0 ? pp30d : ppListings.map((l) => l.pricePp as number)),
    min30dPp:
      ppListings.length > 0 ? Math.min(...ppListings.map((l) => l.pricePp as number)) : null,
    max30dPp:
      ppListings.length > 0 ? Math.max(...ppListings.map((l) => l.pricePp as number)) : null,
    activeWtsCount: allItemListings.filter((l) => l.listingType === 'WTS').length,
    activeWtbCount: buyers.length,
    activeWttCount: allItemListings.filter((l) => l.listingType === 'WTT').length,
    sellers,
    buyers,
    trendPoints,
  };
}

/**
 * Returns aggregated market pulse counts per itemId so search tables can display
 * latest WTS / WTB prices and offer counts at a glance.
 */
export async function getAllItemMarketRollups(): Promise<
  Record<
    number,
    {
      itemId: number;
      lastWtsPp: number | null;
      lastWtbPp: number | null;
      wtsCount: number;
      wtbCount: number;
      wttCount: number;
      lastSeenAt: string;
    }
  >
> {
  const recent = await queryRecentListings({ limit: 500 });
  const rollups: Record<
    number,
    {
      itemId: number;
      lastWtsPp: number | null;
      lastWtbPp: number | null;
      wtsCount: number;
      wtbCount: number;
      wttCount: number;
      lastSeenAt: string;
    }
  > = {};

  for (const l of recent) {
    let entry = rollups[l.itemId];
    if (!entry) {
      entry = {
        itemId: l.itemId,
        lastWtsPp: null,
        lastWtbPp: null,
        wtsCount: 0,
        wtbCount: 0,
        wttCount: 0,
        lastSeenAt: l.lastSeenAt,
      };
      rollups[l.itemId] = entry;
    }
    if (l.listingType === 'WTS') {
      entry.wtsCount++;
      if (entry.lastWtsPp === null && l.currencyType === 'PP' && l.pricePp) {
        entry.lastWtsPp = l.pricePp;
      }
    } else if (l.listingType === 'WTB') {
      entry.wtbCount++;
      if (entry.lastWtbPp === null && l.currencyType === 'PP' && l.pricePp) {
        entry.lastWtbPp = l.pricePp;
      }
    } else if (l.listingType === 'WTT') {
      entry.wttCount++;
    }
  }

  return rollups;
}

export async function insertReviewLogsBatch(logs: InsertReviewLogInput[]): Promise<number> {
  if (logs.length === 0) return 0;

  if (isPostgresConfigured()) {
    await ensurePostgresSchema();
    const sql = neon(getPostgresUrl()!);
    let count = 0;
    for (const l of logs) {
      await sql`
        INSERT INTO parser_review_logs (
          channel_name, author_name, raw_message, reason, candidate_items_json, discord_message_id
        ) VALUES (
          ${l.channelName}, ${l.authorName}, ${l.rawMessage}, ${l.reason},
          ${JSON.stringify(l.candidateTokens || [])}, ${l.discordMessageId || null}
        )
        ON CONFLICT (discord_message_id) DO NOTHING;
      `;
      count++;
    }
    return count;
  }

  const db = getSqliteDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO parser_review_logs (
      channel_name, author_name, raw_message, reason, candidate_items_json, discord_message_id, status, created_at
    ) VALUES (
      @channelName, @authorName, @rawMessage, @reason, @candidateItemsJson, @discordMessageId, 'PENDING', @createdAt
    )
  `);

  const nowIso = new Date().toISOString();
  for (const l of logs) {
    stmt.run({
      channelName: l.channelName,
      authorName: l.authorName,
      rawMessage: l.rawMessage,
      reason: l.reason,
      candidateItemsJson: JSON.stringify(l.candidateTokens || []),
      discordMessageId: l.discordMessageId || null,
      createdAt: nowIso,
    });
  }
  return logs.length;
}

export async function listReviewLogs(statusFilter?: string): Promise<ParserReviewLog[]> {
  if (isPostgresConfigured()) {
    await ensurePostgresSchema();
    const sql = neon(getPostgresUrl()!);
    const rows = await sql`SELECT * FROM parser_review_logs ORDER BY created_at DESC LIMIT 100`;
    return rows
      .map((r) => ({
        id: Number(r.id),
        channelName: String(r.channel_name),
        authorName: String(r.author_name),
        rawMessage: String(r.raw_message),
        reason: String(r.reason),
        candidateItemsJson: r.candidate_items_json ? String(r.candidate_items_json) : null,
        discordMessageId: r.discord_message_id ? String(r.discord_message_id) : null,
        status: r.status as 'PENDING' | 'RESOLVED' | 'IGNORED',
        createdAt: String(r.created_at),
      }))
      .filter((r) => !statusFilter || r.status === statusFilter);
  }

  const db = getSqliteDb();
  const rows = db
    .prepare(
      statusFilter
        ? 'SELECT * FROM parser_review_logs WHERE status = ? ORDER BY created_at DESC LIMIT 100'
        : 'SELECT * FROM parser_review_logs ORDER BY created_at DESC LIMIT 100'
    )
    .all(...(statusFilter ? [statusFilter] : [])) as Record<string, unknown>[];

  return rows.map((r) => ({
    id: Number(r.id),
    channelName: String(r.channel_name),
    authorName: String(r.author_name),
    rawMessage: String(r.raw_message),
    reason: String(r.reason),
    candidateItemsJson: r.candidate_items_json ? String(r.candidate_items_json) : null,
    discordMessageId: r.discord_message_id ? String(r.discord_message_id) : null,
    status: r.status as 'PENDING' | 'RESOLVED' | 'IGNORED',
    createdAt: String(r.created_at),
  }));
}

export async function updateReviewLogStatus(
  id: number,
  status: 'PENDING' | 'RESOLVED' | 'IGNORED'
): Promise<void> {
  if (isPostgresConfigured()) {
    await ensurePostgresSchema();
    const sql = neon(getPostgresUrl()!);
    await sql`UPDATE parser_review_logs SET status = ${status} WHERE id = ${id}`;
    return;
  }
  const db = getSqliteDb();
  db.prepare('UPDATE parser_review_logs SET status = ? WHERE id = ?').run(status, id);
}
