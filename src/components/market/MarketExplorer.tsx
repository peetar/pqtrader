'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Search,
  Filter,
  Send,
  Copy,
  Check,
  Sparkles,
  PackageCheck,
  Tag,
  ShoppingBag,
  ArrowLeftRight,
  Lock,
} from 'lucide-react';
import {
  CURRENCY_LABELS,
  CURRENCY_SHORT_LABELS,
  CurrencyType,
  ItemMarketSummary,
  ListingType,
  MarketListing,
  OwnedInventoryItem,
  QuarmItem,
} from '@/types/pqtrader';
import { EQ_CLASSES, EQ_SLOTS, decodeClasses, decodeSlots } from '@/lib/items/eqBitmasks';
import {
  ItemDetailPanel,
  formatListingPriceBadge,
  formatRelativeTime,
} from '@/components/shared/ItemDetailPanel';

interface MarketRollupEntry {
  itemId: number;
  lastWtsPp: number | null;
  lastWtbPp: number | null;
  wtsCount: number;
  wtbCount: number;
  wttCount: number;
  lastSeenAt: string;
}

interface MarketExplorerProps {
  catalogList: QuarmItem[];
  catalogById: Record<string, QuarmItem>;
  ownedByItemId: Map<number, OwnedInventoryItem>;
  recentListings: MarketListing[];
  rollups: Record<number, MarketRollupEntry>;
  onRefreshMarket: () => Promise<void>;
  onJumpToMyItem?: (itemId: number) => void;
  onToast: (msg: string) => void;
}

export const MarketExplorer: React.FC<MarketExplorerProps> = ({
  catalogList,
  catalogById,
  ownedByItemId,
  recentListings,
  rollups,
  onRefreshMarket,
  onJumpToMyItem,
  onToast,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [includeNoDrop, setIncludeNoDrop] = useState(true);
  const [marketFilter, setMarketFilter] = useState<
    'ALL' | 'HAS_OFFERS' | 'HAS_WTS' | 'HAS_WTB' | 'POP_SPELLS'
  >('HAS_OFFERS');
  const [selectedClassBit, setSelectedClassBit] = useState<number>(0);
  const [selectedSlotBit, setSelectedSlotBit] = useState<number>(0);

  // Selected item for inspection (default to Cloak of Flames 11621 or Karana's Renewal 21657)
  const [selectedItemId, setSelectedItemId] = useState<number>(11621);
  const [itemMarket, setItemMarket] = useState<ItemMarketSummary | null>(null);
  const [loadingItemMarket, setLoadingItemMarket] = useState(false);

  // Direct Offer Poster State (WTB / WTS / WTT from Market Explorer)
  const [postType, setPostType] = useState<ListingType>('WTB');
  const [postActorName, setPostActorName] = useState('');
  const [postCurrency, setPostCurrency] = useState<CurrencyType>('PP');
  const [postPricePp, setPostPricePp] = useState('');
  const [postQty, setPostQty] = useState('1');
  const [postMetadata, setPostMetadata] = useState('');
  const [postingOffer, setPostingOffer] = useState(false);
  const [copiedMacro, setCopiedMacro] = useState(false);

  useEffect(() => {
    const savedChar = localStorage.getItem('pqtrader_default_char');
    if (savedChar) setPostActorName(savedChar);
  }, []);

  useEffect(() => {
    if (!selectedItemId) return;
    let cancelled = false;
    setLoadingItemMarket(true);
    fetch(`/api/items/${selectedItemId}/market`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setItemMarket(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingItemMarket(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedItemId, recentListings]);

  // Switch filter automatically to ALL when user types a specific item search query
  const effectiveMarketFilter = searchQuery.trim().length > 0 ? 'ALL' : marketFilter;

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const results: QuarmItem[] = [];

    for (const item of catalogList) {
      if (!includeNoDrop && item.nodrop) continue;

      if (q) {
        const matchName = item.name.toLowerCase().includes(q);
        const matchId = String(item.id) === q;
        const matchEffect =
          item.click?.toLowerCase().includes(q) ||
          item.proc?.toLowerCase().includes(q) ||
          item.worn?.toLowerCase().includes(q) ||
          item.focus?.toLowerCase().includes(q);
        if (!matchName && !matchId && !matchEffect) continue;
      }

      if (selectedClassBit > 0) {
        if (!item.classes || (item.classes & selectedClassBit) === 0) continue;
      }

      if (selectedSlotBit > 0) {
        if (!item.slots || (item.slots & selectedSlotBit) === 0) continue;
      }

      const r = rollups[item.id];
      if (effectiveMarketFilter === 'HAS_OFFERS') {
        if (!r || r.wtsCount + r.wtbCount + r.wttCount === 0) continue;
      } else if (effectiveMarketFilter === 'HAS_WTS') {
        if (!r || r.wtsCount + r.wttCount === 0) continue;
      } else if (effectiveMarketFilter === 'HAS_WTB') {
        if (!r || r.wtbCount === 0) continue;
      } else if (effectiveMarketFilter === 'POP_SPELLS') {
        const isSpellOrParchment =
          item.name.startsWith('Spell:') ||
          item.name.startsWith('Song:') ||
          item.name.includes('Parchment') ||
          item.name.includes('Rune Word');
        if (!isSpellOrParchment) continue;
      }

      results.push(item);
      if (results.length >= 120) break;
    }

    // Sort items with active offers first when browsing
    results.sort((a, b) => {
      const ra = rollups[a.id];
      const rb = rollups[b.id];
      const scoreA = ra ? ra.wtsCount + ra.wtbCount + ra.wttCount : 0;
      const scoreB = rb ? rb.wtsCount + rb.wtbCount + rb.wttCount : 0;
      if (scoreA !== scoreB) return scoreB - scoreA;
      return a.name.localeCompare(b.name);
    });

    return results;
  }, [
    catalogList,
    searchQuery,
    includeNoDrop,
    selectedClassBit,
    selectedSlotBit,
    effectiveMarketFilter,
    rollups,
  ]);

  const selectedItem = catalogById[String(selectedItemId)] || catalogList[0];
  const ownedInfo = selectedItem ? ownedByItemId.get(selectedItem.id) : undefined;

  const generatedInGameString = useMemo(() => {
    if (!selectedItem) return '';
    if (postCurrency === 'PP') {
      const p = parseInt(postPricePp, 10);
      const priceStr = !Number.isNaN(p) && p > 0 ? ` ${p}pp` : '';
      const noteStr = postMetadata.trim() ? ` (${postMetadata.trim()})` : '';
      return `/auc ${postType} ${selectedItem.name}${priceStr}${noteStr}`;
    } else {
      const qty = parseInt(postQty, 10) || 1;
      const currName = CURRENCY_SHORT_LABELS[postCurrency];
      const detail = postMetadata.trim()
        ? ` ${postMetadata.trim()}`
        : ` for ${qty}x ${currName}`;
      return `/auc ${postType} ${selectedItem.name}${detail}`;
    }
  }, [selectedItem, postType, postCurrency, postPricePp, postQty, postMetadata]);

  const handlePublishOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;
    if (!postActorName.trim()) {
      onToast('Please enter your in-game character name first.');
      return;
    }

    localStorage.setItem('pqtrader_default_char', postActorName.trim());
    setPostingOffer(true);
    try {
      const res = await fetch('/api/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingType: postType,
          itemId: selectedItem.id,
          itemName: selectedItem.name,
          actorName: postActorName.trim(),
          currencyType: postCurrency,
          pricePp:
            postCurrency === 'PP' && postPricePp.trim()
              ? parseInt(postPricePp.trim(), 10)
              : null,
          priceQuantity: parseInt(postQty, 10) || 1,
          tradeMetadata: postMetadata.trim() || null,
          source: 'app:manual',
          rawMessage: generatedInGameString,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to publish offer');
      onToast(
        `Posted ${postType} offer for ${selectedItem.name} as ${postActorName.trim()}!`
      );
      setPostMetadata('');
      await onRefreshMarket();
      // Refresh current item market summary
      const mRes = await fetch(`/api/items/${selectedItem.id}/market`);
      if (mRes.ok) {
        setItemMarket(await mRes.json());
      }
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : 'Failed to post offer');
    } finally {
      setPostingOffer(false);
    }
  };

  // Deduplicate slots for filter dropdown
  const uniqueSlots = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of EQ_SLOTS) {
      if (!map.has(s.name)) map.set(s.name, s.bit);
    }
    return Array.from(map.entries());
  }, []);

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
      {/* Left Column: Search, Filters, Item Results & Live Activity Feed */}
      <div className="space-y-4 xl:col-span-5">
        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search 26,972 Quarm items by name, ID, or effect..."
              className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2.5 pl-9 pr-4 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:outline-none"
            />
          </div>

          {/* Filter Pills */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {(
              [
                ['HAS_OFFERS', 'Active Market Items'],
                ['HAS_WTS', 'Has Sellers (WTS/WTT)'],
                ['HAS_WTB', 'Has Buyers (WTB)'],
                ['POP_SPELLS', 'PoP Spells & Parchments'],
                ['ALL', 'All Catalog Items'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setMarketFilter(key)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  effectiveMarketFilter === key
                    ? 'bg-amber-500 text-slate-950 font-semibold'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Class, Slot, and No-Drop Toggles */}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <select
              value={selectedClassBit}
              onChange={(e) => setSelectedClassBit(Number(e.target.value))}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value={0}>All Classes</option>
              {EQ_CLASSES.map((c) => (
                <option key={c.bit} value={c.bit}>
                  {c.short} — {c.name}
                </option>
              ))}
            </select>

            <select
              value={selectedSlotBit}
              onChange={(e) => setSelectedSlotBit(Number(e.target.value))}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value={0}>All Slots</option>
              {uniqueSlots.map(([name, bit]) => (
                <option key={name} value={bit}>
                  {name}
                </option>
              ))}
            </select>

            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-1.5 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={includeNoDrop}
                onChange={(e) => setIncludeNoDrop(e.target.checked)}
                className="rounded border-slate-600 text-amber-500 focus:ring-amber-500"
              />
              <span>Show No-Drop</span>
            </label>
          </div>
        </div>

        {/* Matching Items List */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3 shadow">
          <div className="mb-2 flex items-center justify-between px-1 text-xs text-slate-400">
            <span className="font-semibold uppercase tracking-wider">
              Matching Items ({filteredItems.length})
            </span>
            <span>Click to inspect stats &amp; offers</span>
          </div>

          <div className="max-h-[380px] space-y-1.5 overflow-y-auto pr-1">
            {filteredItems.length === 0 ? (
              <div className="rounded-lg border border-slate-800/60 bg-slate-950/40 px-3 py-6 text-center text-xs text-slate-500">
                No matching offers yet. Search for an item above, switch the filter to{' '}
                <strong className="text-slate-300">All 26,972 Items</strong>, or ingest messages in
                the <strong className="text-amber-300">Discord Scraper</strong> tab.
              </div>
            ) : (
              filteredItems.map((item) => {
                const r = rollups[item.id];
                const owned = ownedByItemId.get(item.id);
                const isSelected = selectedItem?.id === item.id;
                const slots = decodeSlots(item.slots).slice(0, 2).join('/');

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedItemId(item.id)}
                    className={`w-full rounded-lg border p-2.5 text-left transition ${
                      isSelected
                        ? 'border-amber-500/80 bg-amber-950/25'
                        : 'border-slate-800/80 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-900'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-semibold text-slate-100">
                            {item.name}
                          </span>
                          {item.nodrop && (
                            <span className="rounded bg-rose-950/80 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">
                              NO DROP
                            </span>
                          )}
                          {owned && (
                            <span className="rounded bg-emerald-950/80 border border-emerald-500/30 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                              Owned: {owned.totalCount}x
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-400">
                          ID #{item.id}
                          {slots ? ` · ${slots}` : ''}
                          {item.classes ? ` · ${decodeClasses(item.classes)}` : ''}
                        </div>
                      </div>

                      {/* Market Offer Pill Summary */}
                      <div className="flex flex-col items-end gap-1 text-right text-[11px]">
                        {r ? (
                          <>
                            <div className="flex items-center gap-1">
                              {r.wtsCount + r.wttCount > 0 && (
                                <span className="rounded bg-emerald-950/90 px-1.5 py-0.5 font-medium text-emerald-300">
                                  {r.wtsCount + r.wttCount} Selling
                                  {r.lastWtsPp ? ` (${r.lastWtsPp.toLocaleString()}p)` : ''}
                                </span>
                              )}
                              {r.wtbCount > 0 && (
                                <span className="rounded bg-sky-950/90 px-1.5 py-0.5 font-medium text-sky-300">
                                  {r.wtbCount} WTB
                                  {r.lastWtbPp ? ` (${r.lastWtbPp.toLocaleString()}p)` : ''}
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-500">
                              {formatRelativeTime(r.lastSeenAt)}
                            </span>
                          </>
                        ) : (
                          <span className="text-[11px] text-slate-600">No recent offers</span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Recent Server-Wide Ticker */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3 shadow">
          <div className="mb-2 flex items-center justify-between px-1 text-xs">
            <span className="font-semibold uppercase tracking-wider text-amber-400">
              Recent Server Market Feed
            </span>
            <span className="text-slate-400">Latest WTS / WTB / WTT</span>
          </div>
          <div className="max-h-60 space-y-1.5 overflow-y-auto pr-1">
            {recentListings.length === 0 ? (
              <div className="rounded-lg border border-slate-800/60 bg-slate-950/40 px-3 py-4 text-center text-xs text-slate-500">
                No listings recorded in the database yet.
              </div>
            ) : (
              recentListings.slice(0, 20).map((l) => {
                const pBadge = formatListingPriceBadge(l);
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => setSelectedItemId(l.itemId)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-800/70 bg-slate-950/60 px-2.5 py-1.5 text-left text-xs hover:border-slate-700"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            l.listingType === 'WTB'
                              ? 'bg-sky-950 text-sky-300'
                              : l.listingType === 'WTT'
                              ? 'bg-purple-950 text-purple-300'
                              : 'bg-emerald-950 text-emerald-300'
                          }`}
                        >
                          {l.listingType}
                        </span>
                        <span className="truncate font-semibold text-slate-200">
                          {l.itemName}
                        </span>
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-slate-400">
                        by <strong className="text-slate-300">{l.actorName}</strong>
                        {pBadge.sub ? ` · ${pBadge.sub}` : ''}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-amber-300">{pBadge.primary}</div>
                      <div className="text-[10px] text-slate-500">
                        {formatRelativeTime(l.lastSeenAt)}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Right Column: Selected Item Inspector + Owned Banner + Direct WTB/WTS/WTT Publisher */}
      <div className="space-y-4 xl:col-span-7">
        {selectedItem && (
          <>
            {/* If User Owns This Item in Their Connected TAKP Folder */}
            {ownedInfo && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-3.5 text-xs">
                <div className="flex items-center gap-2.5">
                  <PackageCheck className="h-5 w-5 text-emerald-400" />
                  <div>
                    <div className="font-semibold text-emerald-200">
                      You own {ownedInfo.totalCount}x {selectedItem.name} across your TAKP
                      characters!
                    </div>
                    <div className="mt-0.5 text-slate-300">
                      Held by:{' '}
                      {ownedInfo.instances
                        .map((inst) => `${inst.characterName} (${inst.location})`)
                        .join(', ')}
                      {ownedInfo.activeBzrPrices.length > 0 && (
                        <span className="ml-2 font-semibold text-amber-300">
                          · Active BZR:{' '}
                          {ownedInfo.activeBzrPrices
                            .map((b) => `${b.characterName}: ${b.pricePp.toLocaleString()}pp`)
                            .join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {onJumpToMyItem && (
                  <button
                    type="button"
                    onClick={() => onJumpToMyItem(selectedItem.id)}
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-500"
                  >
                    Manage / Update BZR Price &rarr;
                  </button>
                )}
              </div>
            )}

            {/* Shared Item Detail & Market Intelligence Panel */}
            <ItemDetailPanel
              item={selectedItem}
              market={itemMarket}
              loadingMarket={loadingItemMarket}
              onCopyToast={onToast}
            />

            {/* Direct Post WTB / WTS / WTT Offer Form (Supports MQ / Loot Rights for No-Drop Items) */}
            <form
              onSubmit={handlePublishOffer}
              className="rounded-xl border border-amber-500/30 bg-slate-900/90 p-4 shadow-lg"
            >
              {selectedItem.nodrop && (
                <div className="mb-3 flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
                  <Lock className="h-4 w-4 shrink-0 text-rose-400" />
                  <span>
                    <strong>NO DROP Item:</strong> Offers posted here are for{' '}
                    <strong>Multi-Quest (MQ)</strong> or <strong>Loot Rights (LR)</strong>.
                    (Cannot be listed in local <code className="text-rose-300">BZR_*.ini</code>{' '}
                    files.)
                  </span>
                </div>
              )}
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-300">
                    <Send className="h-4 w-4" />
                    Post a WTB, WTS, or PoP Trade Offer for {selectedItem.name}
                  </div>
                  <div className="flex gap-1">
                    {(['WTB', 'WTS', 'WTT'] as ListingType[]).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          setPostType(t);
                          if (
                            t === 'WTT' &&
                            postCurrency === 'PP' &&
                            selectedItem.name.startsWith('Spell:')
                          ) {
                            setPostCurrency('SIMILAR_SPELL');
                          }
                        }}
                        className={`rounded px-3 py-1 text-xs font-bold transition ${
                          postType === t
                            ? t === 'WTB'
                              ? 'bg-sky-500 text-slate-950'
                              : t === 'WTT'
                              ? 'bg-purple-500 text-white'
                              : 'bg-emerald-500 text-slate-950'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        {t === 'WTB'
                          ? 'WTB (Want to Buy)'
                          : t === 'WTS'
                          ? 'WTS (Want to Sell)'
                          : 'WTT (Spell / Trade)'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                  <div className="sm:col-span-3">
                    <label className="mb-1 block text-[11px] font-medium text-slate-400">
                      Your Character Name
                    </label>
                    <input
                      type="text"
                      required
                      value={postActorName}
                      onChange={(e) => setPostActorName(e.target.value)}
                      placeholder="e.g. Derpydoodle"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-4">
                    <label className="mb-1 block text-[11px] font-medium text-slate-400">
                      Currency / PoP Trade Type
                    </label>
                    <select
                      value={postCurrency}
                      onChange={(e) => setPostCurrency(e.target.value as CurrencyType)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                    >
                      {(Object.keys(CURRENCY_LABELS) as CurrencyType[]).map((c) => (
                        <option key={c} value={c}>
                          {CURRENCY_LABELS[c]}
                        </option>
                      ))}
                    </select>
                  </div>

                  {postCurrency === 'PP' ? (
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-[11px] font-medium text-slate-400">
                        Price (PP)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={postPricePp}
                        onChange={(e) => setPostPricePp(e.target.value)}
                        placeholder="e.g. 7500"
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                      />
                    </div>
                  ) : (
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-[11px] font-medium text-slate-400">
                        Qty Required
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={postQty}
                        onChange={(e) => setPostQty(e.target.value)}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                      />
                    </div>
                  )}

                  <div className="sm:col-span-3">
                    <label className="mb-1 block text-[11px] font-medium text-slate-400">
                      Trade Details / Note (Optional)
                    </label>
                    <input
                      type="text"
                      value={postMetadata}
                      onChange={(e) => setPostMetadata(e.target.value)}
                      placeholder={
                        postCurrency === 'SIMILAR_SPELL'
                          ? 'for Command of Tunare, pst'
                          : 'OBO / PST in game'
                      }
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-3">
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="font-mono text-[11px] text-amber-200/90">
                      {generatedInGameString}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(generatedInGameString);
                        setCopiedMacro(true);
                        onToast(`Copied in-game macro: ${generatedInGameString}`);
                        setTimeout(() => setCopiedMacro(false), 2000);
                      }}
                      className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:border-amber-500/40"
                    >
                      {copiedMacro ? (
                        <Check className="h-3 w-3 text-emerald-400" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                      Copy /auc
                    </button>
                  </div>

                  <button
                    type="submit"
                    disabled={postingOffer}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {postingOffer
                      ? 'Publishing...'
                      : `Post ${postType} Offer to PQ Trader DB`}
                  </button>
                </div>
              </form>
          </>
        )}
      </div>
    </div>
  );
};
