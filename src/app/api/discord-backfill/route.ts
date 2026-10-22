import { NextRequest, NextResponse } from 'next/server';
import { parseAuctionMessage } from '@/lib/parser/auctionParser';
import {
  insertReviewLogsBatch,
  InsertReviewLogInput,
  upsertListingsBatch,
  UpsertListingInput,
} from '@/lib/db';

interface DiscordApiMessage {
  id: string;
  content: string;
  timestamp: string;
  author?: {
    username?: string;
    global_name?: string;
  };
}

/**
 * Fetches historical messages from a Discord channel using the user's token
 * (performed server-side to avoid browser CORS restrictions on discord.com/api/v10),
 * parses them with the high-precision auction parser, and optionally saves them to DB.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const discordToken = String(body.discordToken || '').trim();
    const channelId = String(body.channelId || '').trim();
    const channelName = String(body.channelName || 'ingame-auctions').trim();
    const maxPages = Math.min(Math.max(Number(body.maxPages || 1), 1), 30); // 1 page = 100 messages
    const commitToDb = Boolean(body.commitToDb);
    const apiKey = req.headers.get('x-api-key') || String(body.apiKey || '');
    const configuredKey = process.env.PQ_INGEST_API_KEY;

    if (!discordToken || !channelId) {
      return NextResponse.json(
        { error: 'Both discordToken and channelId are required.' },
        { status: 400 }
      );
    }

    if (commitToDb) {
      if (!configuredKey) {
        return NextResponse.json(
          { error: 'Server misconfigured: PQ_INGEST_API_KEY environment variable is not set.' },
          { status: 500 }
        );
      }
      if (!apiKey || apiKey !== configuredKey) {
        return NextResponse.json(
          { error: 'Valid Ingest API Key is required when committing backfill results to the database.' },
          { status: 401 }
        );
      }
    }

    const allMessages: DiscordApiMessage[] = [];
    let beforeId: string | null = null;

    for (let page = 0; page < maxPages; page++) {
      const url = new URL(`https://discord.com/api/v10/channels/${channelId}/messages`);
      url.searchParams.set('limit', '100');
      if (beforeId) {
        url.searchParams.set('before', beforeId);
      }

      const res = await fetch(url.toString(), {
        headers: {
          Authorization: discordToken,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
      });

      if (!res.ok) {
        const errText = await res.text();
        return NextResponse.json(
          { error: `Discord API returned ${res.status}: ${errText.slice(0, 200)}` },
          { status: res.status }
        );
      }

      const batch = (await res.json()) as DiscordApiMessage[];
      if (!Array.isArray(batch) || batch.length === 0) break;

      allMessages.push(...batch);
      beforeId = batch[batch.length - 1].id;

      if (batch.length < 100) break;
      // Gentle jitter delay between pages to respect Discord rate limits
      if (page + 1 < maxPages) {
        await new Promise((r) => setTimeout(r, 850));
      }
    }

    const listingsToUpsert: UpsertListingInput[] = [];
    const maybesToInsert: InsertReviewLogInput[] = [];
    let noiseSkipped = 0;

    for (const msg of allMessages) {
      const content = (msg.content || '').trim();
      if (!content) {
        noiseSkipped++;
        continue;
      }
      const author = msg.author?.global_name || msg.author?.username || 'Unknown';
      const parsed = parseAuctionMessage(content, channelName, author, msg.id);

      if (!parsed.isTradeRelated) {
        noiseSkipped++;
        continue;
      }

      const timestampIso = msg.timestamp
        ? new Date(msg.timestamp).toISOString()
        : new Date().toISOString();

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
        maybesToInsert.push({
          channelName: parsed.maybeLog.channelName,
          authorName: parsed.maybeLog.authorName,
          rawMessage: parsed.maybeLog.rawMessage,
          reason: parsed.maybeLog.reason,
          candidateTokens: parsed.maybeLog.candidateTokens,
          discordMessageId: parsed.maybeLog.discordMessageId,
        });
      }
    }

    let upsertedCount = 0;
    let loggedMaybesCount = 0;
    if (commitToDb) {
      upsertedCount = await upsertListingsBatch(listingsToUpsert);
      loggedMaybesCount = await insertReviewLogsBatch(maybesToInsert);
    }

    return NextResponse.json({
      ok: true,
      messagesFetched: allMessages.length,
      noiseSkipped,
      extractedListingsCount: listingsToUpsert.length,
      maybesCount: maybesToInsert.length,
      committedToDb: commitToDb,
      upsertedCount,
      loggedMaybesCount,
      sampleListings: listingsToUpsert.slice(0, 100),
      sampleMaybes: maybesToInsert.slice(0, 50),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Backfill request failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
