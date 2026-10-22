# PQ Trader — Project Quarm Auction Intelligence & TAKP Bazaar Manager

**PQ Trader** is a Next.js web application for tracking, searching, pricing, and managing **Project Quarm (EverQuest)** item auctions (`WTS`, `WTB`, `WTT`), **Planes of Power (PoP) spell/parchment trades**, and local **TAKP `<char>-Inventory.txt` & `BZR_<char>_pq.proj.ini`** trader files.

---

## Key Features

1. **Market Explorer & Item Inspector (All 26,972 Quarm Items)**:
   - Instant search across all **16,978 tradeable** and **9,994 No-Drop** items exported from `quarm.db`, complete with classic EverQuest stat cards and NPC loot drop sources/rates.
   - Side-by-side **Who's Selling (`WTS` / `WTT`)** and **Who's Buying (`WTB`)** boards with relative timestamps and one-click `/t <Player>` whisper buttons.
   - Interactive **Historical Platinum (PP) Price Trend Charts** (30d/7d averages, median, min/max range).
   - **Direct `WTB` / `WTS` / `WTT` Poster**: Post offers directly from the web app in either **Platinum (`PP`)** or **PoP Currencies** (`Similar Tier Spell`, `Ethereal Parchment`, `Spectral Parchment`, `Glyphed Rune Word`).
2. **My Items & Active Trader `BZR_*.ini` Manager**:
   - Connects to your local TAKP directory (`C:\TAKPv22`) via the browser **File System Access API (`window.showDirectoryPicker()`)** when hosted on Vercel (or one-click local loader during local dev).
   - Tracks all owned items across all `<char>-Inventory.txt` files (with a toggle to show/hide **No-Drop** items for alt inventory tracking, while disabling pricing on No-Drop items).
   - **Strict Active Trader Intersection**: Flag specific characters as **Active Traders** (`Derpydoodle`, `Zondrop`, `Zondromule`, etc.). Only items **currently held in an Active Trader's `<char>-Inventory.txt` right now** with a price $>0$ in `BZR_<char>_pq.proj.ini` are synced to the market DB—stale historical prices in `BZR_*.ini` for sold/unowned items are never uploaded.
   - **Explicit Seller Controls**: Compare your current BZR price against recent market `WTS` and `WTB` offers, stage a new price, and explicitly choose when to **Update Selected `BZR_*.ini` File(s)** (written in copper pieces: $\text{CP} = \text{PP} \times 1000$) vs. **Push to PQ Trader DB** vs. **Copy In-Game `/auc` Macro**.
3. **Discord Scraper, 1-Month Backfill & "Maybes" Review Lab**:
   - Configurable Discord Channel IDs (pre-filled with `#ingame-auctions`, `#trade`, `#ingame-general`, and extensible to custom servers).
   - High-precision auction parser that filters out `#ingame-general` noise, splits compound `WTS` + `WTB` + `WTT` posts, matches tradeable items & PoP spell swaps, and routes ambiguous trade messages to a **"Maybes" Review Queue** (`parser_review_logs`) instead of polluting live prices.

---

## Quick Start

```powershell
# 1. Install dependencies
npm install

# 2. (Optional) Re-export the 26,972 item catalog from C:\code\eqpetfinder\quarm.db
npm run export-items

# 3. Run unit tests
npm test

# 4. Start development server on http://localhost:3000
npm run dev
```

---

## Running the 1-Month Discord Channel Backfill CLI

```powershell
# Option A: Evaluate & seed from a local Discord export file (.json or .txt)
npx tsx scripts/backfill_discord_history.ts --file ./discord_export.json --channel-name ingame-auctions --commit

# Option B: Fetch up to 30 days directly from Discord's Channel API
npx tsx scripts/backfill_discord_history.ts --token "YOUR_DISCORD_TOKEN" --channel-id "1133452007412334642" --channel-name "ingame-auctions" --days 30 --commit
```

---

## Deploying to Vercel (Free Tier)

1. Push this repository to GitHub and import into **Vercel**.
2. In the Vercel dashboard, add a free **Neon Serverless Postgres** database from the Vercel Marketplace (which automatically sets `DATABASE_URL`).
3. Set `PQ_INGEST_API_KEY` in Vercel Environment Variables to gate the `/api/ingest` endpoint.
