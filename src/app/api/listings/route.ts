import { NextRequest, NextResponse } from 'next/server';
import {
  getAllItemMarketRollups,
  queryRecentListings,
  upsertListingsBatch,
  UpsertListingInput,
} from '@/lib/db';
import { ListingType } from '@/types/pqtrader';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q') || undefined;
    const itemIdParam = searchParams.get('itemId');
    const itemId = itemIdParam ? parseInt(itemIdParam, 10) : undefined;
    const listingType = (searchParams.get('listingType') as ListingType) || undefined;
    const currencyType = searchParams.get('currencyType') || undefined;
    const actorName = searchParams.get('actorName') || undefined;
    const includeRollups = searchParams.get('includeRollups') === 'true';
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? parseInt(limitParam, 10) : 100;

    const listings = await queryRecentListings({
      q,
      itemId,
      listingType,
      currencyType,
      actorName,
      limit,
    });

    const rollups = includeRollups ? await getAllItemMarketRollups() : undefined;

    return NextResponse.json({
      listings,
      rollups,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch listings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawItems: UpsertListingInput[] = Array.isArray(body.listings)
      ? body.listings
      : [body];

    const validItems: UpsertListingInput[] = [];
    for (const item of rawItems) {
      if (!item.itemId || !item.itemName || !item.actorName || !item.listingType) {
        continue;
      }
      validItems.push({
        listingType: item.listingType,
        itemId: Number(item.itemId),
        itemName: String(item.itemName).trim(),
        actorName: String(item.actorName).trim(),
        currencyType: item.currencyType || 'PP',
        pricePp:
          item.pricePp !== null && item.pricePp !== undefined && item.pricePp !== ('' as unknown)
            ? Number(item.pricePp)
            : null,
        priceQuantity: Number(item.priceQuantity || 1),
        tradeMetadata: item.tradeMetadata ? String(item.tradeMetadata).trim() : null,
        source: item.source || 'app:manual',
        rawMessage: item.rawMessage || null,
        timestampIso: item.timestampIso || new Date().toISOString(),
      });
    }

    if (validItems.length === 0) {
      return NextResponse.json(
        { error: 'No valid listings provided. Require itemId, itemName, actorName, listingType.' },
        { status: 400 }
      );
    }

    const upsertedCount = await upsertListingsBatch(validItems);
    return NextResponse.json({
      ok: true,
      upsertedCount,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to post listings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
