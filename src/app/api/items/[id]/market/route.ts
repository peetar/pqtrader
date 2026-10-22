import { NextRequest, NextResponse } from 'next/server';
import { getItemMarketSummary } from '@/lib/db';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const itemId = parseInt(id, 10);
    if (Number.isNaN(itemId) || itemId <= 0) {
      return NextResponse.json({ error: 'Invalid item ID' }, { status: 400 });
    }

    const summary = await getItemMarketSummary(itemId);
    return NextResponse.json(summary);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to load item market summary';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
