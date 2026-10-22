import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { serializeBzrIni } from '@/lib/takp/takpFileSystem';

const DEFAULT_TAKP_DIR = 'C:\\TAKPv22';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const dirPath = searchParams.get('dir') || DEFAULT_TAKP_DIR;

    if (!fs.existsSync(dirPath)) {
      return NextResponse.json(
        { available: false, error: `Directory ${dirPath} not found on server host.` },
        { status: 404 }
      );
    }

    const entries = fs.readdirSync(dirPath);
    const inventoryFiles: { fileName: string; content: string }[] = [];
    const bzrFiles: { fileName: string; content: string }[] = [];

    for (const fileName of entries) {
      const fullPath = path.join(dirPath, fileName);
      if (/-Inventory\.txt$/i.test(fileName)) {
        inventoryFiles.push({
          fileName,
          content: fs.readFileSync(fullPath, 'utf-8'),
        });
      } else if (/^BZR_.+_pq\.proj\.ini$/i.test(fileName)) {
        bzrFiles.push({
          fileName,
          content: fs.readFileSync(fullPath, 'utf-8'),
        });
      }
    }

    return NextResponse.json({
      available: true,
      dirPath,
      inventoryFiles,
      bzrFiles,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to scan local TAKP directory';
    return NextResponse.json({ available: false, error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const dirPath = String(body.dirPath || DEFAULT_TAKP_DIR);
    const updates: { fileName: string; pricesByItemName: Record<string, number> }[] =
      body.updates || [];

    if (!fs.existsSync(dirPath)) {
      return NextResponse.json(
        { error: `TAKP directory not found: ${dirPath}` },
        { status: 404 }
      );
    }

    const updatedFiles: string[] = [];
    for (const u of updates) {
      if (!/^BZR_[A-Za-z0-9_]+_pq\.proj\.ini$/i.test(u.fileName)) {
        continue;
      }
      const targetPath = path.join(dirPath, path.basename(u.fileName));
      const serialized = serializeBzrIni(u.pricesByItemName);
      fs.writeFileSync(targetPath, serialized, 'utf-8');
      updatedFiles.push(u.fileName);
    }

    return NextResponse.json({
      ok: true,
      updatedFiles,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to write BZR INI files';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
