import { NextRequest, NextResponse } from 'next/server';
import { listReviewLogs, updateReviewLogStatus } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || undefined;
    const logs = await listReviewLogs(status);
    return NextResponse.json({ logs });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to list review logs';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const id = Number(body.id);
    const status = body.status as 'PENDING' | 'RESOLVED' | 'IGNORED';
    if (!id || !['PENDING', 'RESOLVED', 'IGNORED'].includes(status)) {
      return NextResponse.json({ error: 'Invalid id or status' }, { status: 400 });
    }
    await updateReviewLogStatus(id, status);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to update review log';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
