/**
 * PQ Trader — 1-Month Discord Channel Backfill & Parser Evaluation CLI
 *
 * Usage Option A (From local Discord export JSON/TXT file):
 *   npx tsx scripts/backfill_discord_history.ts --file ./discord_export.json --channel-name ingame-auctions --commit
 *
 * Usage Option B (Fetch directly from Discord Channel API going back N days):
 *   npx tsx scripts/backfill_discord_history.ts --token "YOUR_DISCORD_TOKEN" --channel-id "123456789" --channel-name "ingame-auctions" --days 30 --commit
 */

import fs from 'fs';
import { parseAuctionMessage } from '../src/lib/parser/auctionParser';
import {
  insertReviewLogsBatch,
  InsertReviewLogInput,
  upsertListingsBatch,
  UpsertListingInput,
} from '../src/lib/db';

interface RawExportMessage {
  id?: string;
  content: string;
  timestamp?: string;
  author?: { username?: string; global_name?: string; name?: string } | string;
}

function getArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return null;
}

async function fetchDiscordChannelHistory(
  token: string,
  channelId: string,
  daysBack: number
): Promise<RawExportMessage[]> {
  const cutoffMs = Date.now() - daysBack * 24 * 3600 * 1000;
  const collected: RawExportMessage[] = [];
  let beforeId: string | null = null;
  let page = 0;

  console.log(`Fetching up to ${daysBack} days of history from Discord channel ${channelId}...`);
  while (page < 150) {
    page++;
    const url = new URL(`https://discord.com/api/v10/channels/${channelId}/messages`);
    url.searchParams.set('limit', '100');
    if (beforeId) url.searchParams.set('before', beforeId);

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: token,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
    });

    if (!res.ok) {
      throw new Error(`Discord HTTP ${res.status}: ${await res.text()}`);
    }

    const batch = (await res.json()) as RawExportMessage[];
    if (!Array.isArray(batch) || batch.length === 0) break;

    let reachedCutoff = false;
    for (const msg of batch) {
      const tsMs = msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now();
      if (tsMs < cutoffMs) {
        reachedCutoff = true;
        break;
      }
      collected.push(msg);
    }

    beforeId = batch[batch.length - 1].id || null;
    process.stdout.write(`  Page ${page}: ${collected.length} messages collected...\r`);

    if (reachedCutoff || batch.length < 100) break;
    await new Promise((r) => setTimeout(r, 900));
  }
  console.log(`\nFinished fetching ${collected.length} messages.`);
  return collected;
}

function loadMessagesFromFile(filePath: string): RawExportMessage[] {
  const raw = fs.readFileSync(filePath, 'utf-8');
  if (filePath.endsWith('.json')) {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.messages)) return parsed.messages;
  }
  // Plain text / log lines fallback
  return raw
    .split(/\r?\n/)
    .map((line, i) => ({ id: `line-${i + 1}`, content: line.trim() }))
    .filter((m) => m.content.length > 0);
}

async function main() {
  const filePath = getArg('--file');
  const token = getArg('--token') || process.env.DISCORD_USER_TOKEN;
  const channelId = getArg('--channel-id');
  const channelName = getArg('--channel-name') || 'ingame-auctions';
  const days = parseInt(getArg('--days') || '30', 10);
  const commit = process.argv.includes('--commit');

  let messages: RawExportMessage[] = [];
  if (filePath) {
    messages = loadMessagesFromFile(filePath);
  } else if (token && channelId) {
    messages = await fetchDiscordChannelHistory(token, channelId, days);
  } else {
    console.log(
      'Usage:\n' +
        '  1) From exported file: npx tsx scripts/backfill_discord_history.ts --file <path.json|path.txt> [--channel-name ingame-auctions] [--commit]\n' +
        '  2) From Discord API:   npx tsx scripts/backfill_discord_history.ts --token <TOKEN> --channel-id <ID> [--days 30] [--commit]'
    );
    return;
  }

  const listingsToUpsert: UpsertListingInput[] = [];
  const maybesToInsert: InsertReviewLogInput[] = [];
  let noiseSkipped = 0;

  for (const m of messages) {
    const content = (m.content || '').trim();
    if (!content) {
      noiseSkipped++;
      continue;
    }
    const author =
      typeof m.author === 'string'
        ? m.author
        : m.author?.global_name || m.author?.username || m.author?.name || 'Unknown';

    const res = parseAuctionMessage(content, channelName, author, m.id || null);
    if (!res.isTradeRelated) {
      noiseSkipped++;
      continue;
    }

    const ts = m.timestamp ? new Date(m.timestamp).toISOString() : new Date().toISOString();
    for (const l of res.listings) {
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
        timestampIso: ts,
      });
    }

    if (res.maybeLog) {
      maybesToInsert.push({
        channelName: res.maybeLog.channelName,
        authorName: res.maybeLog.authorName,
        rawMessage: res.maybeLog.rawMessage,
        reason: res.maybeLog.reason,
        candidateTokens: res.maybeLog.candidateTokens,
        discordMessageId: res.maybeLog.discordMessageId,
      });
    }
  }

  console.log('\n================ PARSER EVALUATION SUMMARY ================');
  console.log(`Channel:              #${channelName}`);
  console.log(`Total Messages:       ${messages.length.toLocaleString()}`);
  console.log(`Noise Skipped:        ${noiseSkipped.toLocaleString()}`);
  console.log(`Extracted Listings:   ${listingsToUpsert.length.toLocaleString()}`);
  console.log(
    `  - WTS:              ${listingsToUpsert.filter((l) => l.listingType === 'WTS').length}`
  );
  console.log(
    `  - WTB:              ${listingsToUpsert.filter((l) => l.listingType === 'WTB').length}`
  );
  console.log(
    `  - WTT:              ${listingsToUpsert.filter((l) => l.listingType === 'WTT').length}`
  );
  console.log(`"Maybes" For Review:  ${maybesToInsert.length.toLocaleString()}`);

  if (maybesToInsert.length > 0) {
    console.log('\n--- Sample "Maybes" (Ambiguous / Unrecognized Trade Posts) ---');
    for (const mb of maybesToInsert.slice(0, 15)) {
      console.log(`  [${mb.authorName}] ${mb.rawMessage}`);
    }
  }

  if (commit) {
    const upserted = await upsertListingsBatch(listingsToUpsert);
    const logged = await insertReviewLogsBatch(maybesToInsert);
    console.log(`\nCommitted ${upserted} listings and ${logged} review logs to database.`);
  } else {
    console.log('\n(Dry run — pass --commit to save extracted listings & Maybes to the database.)');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
