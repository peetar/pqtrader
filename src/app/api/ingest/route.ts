import { NextRequest, NextResponse } from 'next/server';
import {
  insertReviewLogsBatch,
  InsertReviewLogInput,
  upsertListingsBatch,
  UpsertListingInput,
} from '@/lib/db';
import { parseAuctionMessage } from '@/lib/parser/auctionParser';

export async function POST(req: NextRequest) {
  try {
    const configuredKey = process.env.PQ_INGEST_API_KEY;
    if (!configuredKey) {
      return NextResponse.json(
        { error: 'Server misconfigured: PQ_INGEST_API_KEY environment variable is not set.' },
        { status: 500 }
      );
    }

    const apiKey = req.headers.get('x-api-key') || '';
    if (!apiKey || apiKey !== configuredKey) {
      return NextResponse.json(
        { error: 'Unauthorized: Invalid or missing x-api-key header' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const listingsToUpsert: UpsertListingInput[] = [];
    const reviewLogsToInsert: InsertReviewLogInput[] = [];
    let messagesScanned = 0;
    let noiseSkipped = 0;

    // Mode 1: Raw Discord messages array
    if (Array.isArray(body.rawMessages)) {
      for (const msg of body.rawMessages) {
        messagesScanned++;
        const content = String(msg.content || '').trim();
        if (!content) {
          noiseSkipped++;
          continue;
        }
        const channelName = String(msg.channelName || 'ingame-auctions');
        const author = String(msg.author || 'Unknown');
        const messageId = msg.id ? String(msg.id) : null;
        const timestampIso = msg.timestamp
          ? new Date(msg.timestamp).toISOString()
          : new Date().toISOString();

        const parsed = parseAuctionMessage(content, channelName, author, messageId);
        if (!parsed.isTradeRelated) {
          noiseSkipped++;
          continue;
        }

        for (const l of parsed.listings) {
          listingsToUpsert.push({
            listingType: l.listingType,
            itemId: l.itemId,
            itemName: l.itemName,
            actorName: l.actorName,
            currencyType: l.currencyType,
            pricePp: l.pricePp,
            priceQuantity: l.priceQuantity,
            tradeMetadata: l.tradeMetadata,
            source: `discord:${channelName}`,
            rawMessage: l.rawMessage,
            discordMessageId: l.discordMessageId,
            timestampIso,
          });
        }

        if (parsed.maybeLog) {
          reviewLogsToInsert.push({
            channelName: parsed.maybeLog.channelName,
            authorName: parsed.maybeLog.authorName,
            rawMessage: parsed.maybeLog.rawMessage,
            reason: parsed.maybeLog.reason,
            candidateTokens: parsed.maybeLog.candidateTokens,
            discordMessageId: parsed.maybeLog.discordMessageId,
          });
        }
      }
    }

    // Mode 2: Pre-parsed listings array
    if (Array.isArray(body.listings)) {
      for (const l of body.listings) {
        if (!l.itemId || !l.itemName || !l.actorName || !l.listingType) continue;
        listingsToUpsert.push({
          listingType: l.listingType,
          itemId: Number(l.itemId),
          itemName: String(l.itemName),
          actorName: String(l.actorName),
          currencyType: l.currencyType || 'PP',
          pricePp: l.pricePp !== undefined && l.pricePp !== null ? Number(l.pricePp) : null,
          priceQuantity: Number(l.priceQuantity || 1),
          tradeMetadata: l.tradeMetadata || null,
          source: l.source || 'discord:ingame-auctions',
          rawMessage: l.rawMessage || null,
          discordMessageId: l.discordMessageId || null,
          timestampIso: l.timestampIso || new Date().toISOString(),
        });
      }
    }

    // Mode 3: Explicit Maybe logs array
    if (Array.isArray(body.maybeLogs)) {
      for (const m of body.maybeLogs) {
        if (!m.rawMessage) continue;
        reviewLogsToInsert.push({
          channelName: m.channelName || 'trade',
          authorName: m.authorName || 'Unknown',
          rawMessage: m.rawMessage,
          reason: m.reason || 'UNMATCHED_ITEM_WITH_TRADE_INTENT',
          candidateTokens: m.candidateTokens || [],
          discordMessageId: m.discordMessageId || null,
        });
      }
    }

    const upsertedListings = await upsertListingsBatch(listingsToUpsert);
    const loggedMaybes = await insertReviewLogsBatch(reviewLogsToInsert);

    return NextResponse.json({
      ok: true,
      messagesScanned,
      noiseSkipped,
      upsertedListings,
      loggedMaybes,
      parsedPreview: listingsToUpsert.slice(0, 50),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Ingest failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
