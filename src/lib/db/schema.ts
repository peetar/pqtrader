import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const listings = pgTable(
  'listings',
  {
    id: serial('id').primaryKey(),
    listingType: text('listing_type').notNull(), // 'WTS' | 'WTB' | 'WTT'
    itemId: integer('item_id').notNull(),
    itemName: text('item_name').notNull(),
    actorName: text('actor_name').notNull(),
    currencyType: text('currency_type').notNull(), // 'PP' | 'SIMILAR_SPELL' | 'ETHEREAL_PARCHMENT' | 'SPECTRAL_PARCHMENT' | 'GLYPHED_RUNE_WORD' | 'OTHER_TRADE'
    pricePp: integer('price_pp'),
    priceQuantity: integer('price_quantity').default(1).notNull(),
    tradeMetadata: text('trade_metadata'),
    source: text('source').notNull(),
    rawMessage: text('raw_message'),
    discordMessageId: text('discord_message_id'),
    firstSeenAt: timestamp('first_seen_at').defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
    dedupeDayBucket: text('dedupe_day_bucket').notNull(), // YYYY-MM-DD
  },
  (table) => ({
    itemIdx: index('idx_listings_item_id').on(table.itemId, table.lastSeenAt),
    actorIdx: index('idx_listings_actor').on(table.actorName),
    typeIdx: index('idx_listings_type').on(table.listingType, table.lastSeenAt),
    dedupeIdx: uniqueIndex('uq_actor_item_type_day').on(
      table.actorName,
      table.itemId,
      table.listingType,
      table.dedupeDayBucket
    ),
  })
);

export const parserReviewLogs = pgTable('parser_review_logs', {
  id: serial('id').primaryKey(),
  channelName: text('channel_name').notNull(),
  authorName: text('author_name').notNull(),
  rawMessage: text('raw_message').notNull(),
  reason: text('reason').notNull(),
  candidateItemsJson: text('candidate_items_json'),
  discordMessageId: text('discord_message_id').unique(),
  status: text('status').default('PENDING').notNull(), // 'PENDING' | 'RESOLVED' | 'IGNORED'
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
