'use client';

import React, { useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import {
  Copy,
  Check,
  TrendingUp,
  Shield,
  Sparkles,
  Tag,
  MapPin,
  Clock,
  ShoppingBag,
  ArrowLeftRight,
  Coins,
} from 'lucide-react';
import {
  CURRENCY_SHORT_LABELS,
  ItemMarketSummary,
  MarketListing,
  QuarmItem,
} from '@/types/pqtrader';
import {
  decodeClasses,
  decodeItemType,
  decodeRaces,
  decodeSize,
  decodeSlots,
} from '@/lib/items/eqBitmasks';

interface ItemDetailPanelProps {
  item: QuarmItem;
  market: ItemMarketSummary | null;
  loadingMarket?: boolean;
  onCopyToast?: (msg: string) => void;
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const diffMs = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diffMs)) return iso;
  const mins = Math.max(1, Math.floor(diffMs / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatListingPriceBadge(listing: MarketListing): {
  primary: string;
  sub: string | null;
  isNonPp: boolean;
} {
  if (listing.currencyType === 'PP') {
    return {
      primary:
        listing.pricePp && listing.pricePp > 0
          ? `${listing.pricePp.toLocaleString()} pp`
          : 'Offer (PST)',
      sub: listing.tradeMetadata || null,
      isNonPp: false,
    };
  }
  const qty = listing.priceQuantity || 1;
  const label = CURRENCY_SHORT_LABELS[listing.currencyType] || 'Trade';
  return {
    primary: `${qty}x ${label}`,
    sub: listing.tradeMetadata || null,
    isNonPp: true,
  };
}

export function buildWhisperCommand(listing: MarketListing): string {
  if (listing.listingType === 'WTB') {
    const pricePart =
      listing.currencyType === 'PP' && listing.pricePp
        ? ` for ${listing.pricePp.toLocaleString()}pp`
        : '';
    return `/t ${listing.actorName} Hi! I have ${listing.itemName} available if you're still WTB${pricePart}.`;
  }
  if (listing.listingType === 'WTT' || listing.currencyType !== 'PP') {
    const meta = listing.tradeMetadata ? ` (${listing.tradeMetadata})` : '';
    return `/t ${listing.actorName} Hi! I'm interested in trading for your ${listing.itemName}${meta}.`;
  }
  const pricePart = listing.pricePp ? ` listed for ${listing.pricePp.toLocaleString()}pp` : '';
  return `/t ${listing.actorName} Hi! I'd like to buy your ${listing.itemName}${pricePart}.`;
}

export const ItemDetailPanel: React.FC<ItemDetailPanelProps> = ({
  item,
  market,
  loadingMarket = false,
  onCopyToast,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const slots = decodeSlots(item.slots);
  const classesStr = decodeClasses(item.classes);
  const racesStr = decodeRaces(item.races);
  const itemTypeStr = decodeItemType(item.itemtype, item.bagslots);
  const sizeStr = decodeSize(item.size);
  const ratio =
    item.damage && item.delay && item.delay > 0
      ? (item.damage / item.delay).toFixed(2)
      : null;

  const handleCopy = (text: string, idKey: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(idKey);
    if (onCopyToast) onCopyToast(`Copied: ${text}`);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Classic EverQuest Item Inspection Card */}
      <div className="rounded-xl border border-amber-500/30 bg-slate-950/90 p-4 shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-800 pb-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-bold tracking-wide text-amber-300">
                {item.name}
              </h3>
              <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs text-slate-400">
                ID #{item.id}
              </span>
              {item.nodrop ? (
                <span className="rounded border border-rose-500/40 bg-rose-950/60 px-2 py-0.5 text-xs font-semibold text-rose-300">
                  NO DROP
                </span>
              ) : (
                <span className="rounded border border-emerald-500/40 bg-emerald-950/50 px-2 py-0.5 text-xs font-semibold text-emerald-300">
                  TRADEABLE
                </span>
              )}
              {item.magic && (
                <span className="rounded border border-sky-500/30 bg-sky-950/50 px-2 py-0.5 text-xs text-sky-300">
                  MAGIC ITEM
                </span>
              )}
              {item.lore && (
                <span className="rounded border border-purple-500/30 bg-purple-950/50 px-2 py-0.5 text-xs text-purple-300">
                  LORE ITEM
                </span>
              )}
              {item.norent && (
                <span className="rounded border border-orange-500/30 bg-orange-950/50 px-2 py-0.5 text-xs text-orange-300">
                  NO RENT
                </span>
              )}
            </div>

            {slots.length > 0 && (
              <p className="mt-1 text-xs font-medium text-slate-300">
                <span className="text-slate-400">Slot:</span> {slots.join(', ')}
              </p>
            )}
          </div>

          <div className="text-right text-xs text-slate-400">
            <div>{itemTypeStr}</div>
            <div>
              WT: {item.weight ?? 0.0} | Size: {sizeStr}
            </div>
          </div>
        </div>

        {/* Core Combat & Heroic Stats Grid */}
        <div className="mt-3 grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
          {/* Primary / Weapon / AC / HP / Mana */}
          <div className="space-y-1 rounded-lg bg-slate-900/70 p-2.5">
            <div className="font-semibold uppercase tracking-wider text-slate-400">
              Primary Stats
            </div>
            {item.ac !== undefined && (
              <div className="flex justify-between">
                <span className="text-slate-400">AC:</span>
                <span className="font-semibold text-amber-200">{item.ac}</span>
              </div>
            )}
            {item.hp !== undefined && (
              <div className="flex justify-between">
                <span className="text-slate-400">HP:</span>
                <span className="font-semibold text-emerald-300">
                  {item.hp > 0 ? `+${item.hp}` : item.hp}
                </span>
              </div>
            )}
            {item.mana !== undefined && (
              <div className="flex justify-between">
                <span className="text-slate-400">MANA:</span>
                <span className="font-semibold text-sky-300">
                  {item.mana > 0 ? `+${item.mana}` : item.mana}
                </span>
              </div>
            )}
            {item.damage !== undefined && item.delay !== undefined && (
              <>
                <div className="flex justify-between">
                  <span className="text-slate-400">Skill:</span>
                  <span className="text-slate-200">{itemTypeStr}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Dmg / Delay:</span>
                  <span className="font-semibold text-amber-300">
                    {item.damage} / {item.delay} ({ratio} ratio)
                  </span>
                </div>
              </>
            )}
            {item.bagslots && item.bagslots > 0 && (
              <div className="flex justify-between">
                <span className="text-slate-400">Container:</span>
                <span className="font-semibold text-amber-200">
                  {item.bagslots} Slots ({item.bagwr || 0}% WR)
                </span>
              </div>
            )}
            {item.ac === undefined &&
              item.hp === undefined &&
              item.mana === undefined &&
              item.damage === undefined &&
              !item.bagslots && (
                <div className="text-slate-500">Scroll / Utility / Tradeskill Item</div>
              )}
          </div>

          {/* Attributes */}
          <div className="space-y-1 rounded-lg bg-slate-900/70 p-2.5">
            <div className="font-semibold uppercase tracking-wider text-slate-400">
              Attributes
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {[
                ['STR', item.str],
                ['STA', item.sta],
                ['AGI', item.agi],
                ['DEX', item.dex],
                ['WIS', item.wis],
                ['INT', item.int],
                ['CHA', item.cha],
              ].map(([label, val]) =>
                val !== undefined ? (
                  <div key={label as string} className="flex justify-between">
                    <span className="text-slate-400">{label}:</span>
                    <span
                      className={
                        Number(val) > 0
                          ? 'font-medium text-emerald-300'
                          : 'font-medium text-rose-400'
                      }
                    >
                      {Number(val) > 0 ? `+${val}` : val}
                    </span>
                  </div>
                ) : null
              )}
            </div>
            {![item.str, item.sta, item.agi, item.dex, item.wis, item.int, item.cha].some(
              (v) => v !== undefined
            ) && <div className="text-slate-500">No attribute modifiers</div>}
          </div>

          {/* Resists */}
          <div className="space-y-1 rounded-lg bg-slate-900/70 p-2.5">
            <div className="font-semibold uppercase tracking-wider text-slate-400">
              Resists
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {[
                ['SV MAGIC', item.mr],
                ['SV FIRE', item.fr],
                ['SV COLD', item.cr],
                ['SV DISEASE', item.dr],
                ['SV POISON', item.pr],
              ].map(([label, val]) =>
                val !== undefined ? (
                  <div key={label as string} className="flex justify-between">
                    <span className="text-slate-400">{label}:</span>
                    <span
                      className={
                        Number(val) > 0
                          ? 'font-medium text-sky-300'
                          : 'font-medium text-rose-400'
                      }
                    >
                      {Number(val) > 0 ? `+${val}` : val}
                    </span>
                  </div>
                ) : null
              )}
            </div>
            {![item.mr, item.fr, item.cr, item.dr, item.pr].some((v) => v !== undefined) && (
              <div className="text-slate-500">No resist modifiers</div>
            )}
          </div>
        </div>

        {/* Effects, Classes, Races, and Drop Sources */}
        <div className="mt-3 space-y-1.5 border-t border-slate-800/80 pt-2.5 text-xs">
          {(item.click || item.proc || item.worn || item.focus || item.scroll) && (
            <div className="flex flex-wrap gap-2">
              {item.scroll && (
                <span className="inline-flex items-center gap-1 rounded bg-indigo-950/70 px-2 py-0.5 text-indigo-300">
                  <Sparkles className="h-3 w-3" /> Spell Scroll: {item.scroll}
                </span>
              )}
              {item.click && (
                <span className="inline-flex items-center gap-1 rounded bg-amber-950/70 px-2 py-0.5 text-amber-300">
                  <Sparkles className="h-3 w-3" /> Click Effect: {item.click}
                </span>
              )}
              {item.proc && (
                <span className="inline-flex items-center gap-1 rounded bg-purple-950/70 px-2 py-0.5 text-purple-300">
                  <Sparkles className="h-3 w-3" /> Combat Proc: {item.proc}
                </span>
              )}
              {item.worn && (
                <span className="inline-flex items-center gap-1 rounded bg-emerald-950/70 px-2 py-0.5 text-emerald-300">
                  <Shield className="h-3 w-3" /> Worn Effect: {item.worn}
                </span>
              )}
              {item.focus && (
                <span className="inline-flex items-center gap-1 rounded bg-sky-950/70 px-2 py-0.5 text-sky-300">
                  <Sparkles className="h-3 w-3" /> Focus: {item.focus}
                </span>
              )}
            </div>
          )}

          <div className="flex flex-wrap justify-between gap-2 text-slate-300">
            <div>
              <span className="text-slate-400">Class:</span> {classesStr}
            </div>
            <div>
              <span className="text-slate-400">Race:</span> {racesStr}
            </div>
          </div>

          {/* Known Quarm NPC Drop Sources */}
          {item.drops && item.drops.length > 0 && (
            <div className="mt-2 rounded-lg border border-slate-800 bg-slate-900/50 p-2">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <MapPin className="h-3 w-3 text-amber-400" /> Known Project Quarm Drop Sources
              </div>
              <div className="flex flex-wrap gap-1.5">
                {item.drops.map((d, i) => (
                  <span
                    key={`${d.npc}-${d.zone}-${i}`}
                    className="rounded border border-slate-700/80 bg-slate-800/80 px-2 py-0.5 text-[11px] text-slate-200"
                  >
                    <strong className="text-amber-200">{d.npc}</strong> (Lvl {d.lvl},{' '}
                    <span className="uppercase text-sky-300">{d.zone}</span>) —{' '}
                    <span className="text-emerald-300">{d.rate}%</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Market Summary & Price Trends (Includes Tradeable + No-Drop MQ / Loot Rights) */}
      <>
        {/* Market Overview KPI Strip */}
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3">
              <div className="text-[11px] uppercase tracking-wider text-slate-400">
                Last Seen PP
              </div>
              <div className="mt-1 text-base font-bold text-amber-300">
                {market?.lastSeenPricePp
                  ? `${market.lastSeenPricePp.toLocaleString()} pp`
                  : 'No PP Data'}
              </div>
              <div className="text-[11px] text-slate-500">
                {market?.lastSeenAt ? formatRelativeTime(market.lastSeenAt) : '—'}
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3">
              <div className="text-[11px] uppercase tracking-wider text-slate-400">
                30d Avg Price
              </div>
              <div className="mt-1 text-base font-bold text-emerald-300">
                {market?.avg30dPp ? `${market.avg30dPp.toLocaleString()} pp` : '—'}
              </div>
              <div className="text-[11px] text-slate-500">
                Median: {market?.median30dPp ? `${market.median30dPp.toLocaleString()} pp` : '—'}
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3">
              <div className="text-[11px] uppercase tracking-wider text-slate-400">
                30d Low – High
              </div>
              <div className="mt-1 text-sm font-bold text-slate-200">
                {market?.min30dPp && market?.max30dPp
                  ? `${market.min30dPp.toLocaleString()} – ${market.max30dPp.toLocaleString()} pp`
                  : '—'}
              </div>
              <div className="text-[11px] text-slate-500">PP sightings range</div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3">
              <div className="text-[11px] uppercase tracking-wider text-slate-400">
                Sellers (WTS/WTT)
              </div>
              <div className="mt-1 text-base font-bold text-emerald-400">
                {(market?.activeWtsCount || 0) + (market?.activeWttCount || 0)}
              </div>
              <div className="text-[11px] text-slate-500">
                {market?.activeWtsCount || 0} WTS · {market?.activeWttCount || 0} WTT
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-3">
              <div className="text-[11px] uppercase tracking-wider text-slate-400">
                Buyers (WTB)
              </div>
              <div className="mt-1 text-base font-bold text-sky-400">
                {market?.activeWtbCount || 0}
              </div>
              <div className="text-[11px] text-slate-500">Recent WTB offers</div>
            </div>
          </div>

          {/* Historical PP Price Trend Chart */}
          {market && market.trendPoints.length > 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-300">
                  <TrendingUp className="h-4 w-4 text-amber-400" />
                  Historical Platinum (PP) Price Trend
                </div>
                <span className="text-[11px] text-slate-400">
                  Excludes non-PP parchment/spell trades
                </span>
              </div>
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={market.trendPoints}>
                    <defs>
                      <linearGradient id="ppGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis
                      dataKey="date"
                      stroke="#64748b"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v: string) => v.slice(5)}
                    />
                    <YAxis
                      stroke="#64748b"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v: number) =>
                        v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`
                      }
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#0f172a',
                        borderColor: '#334155',
                        borderRadius: '0.5rem',
                        fontSize: '12px',
                      }}
                      formatter={(value: number) => [`${value.toLocaleString()} pp`, 'Avg PP']}
                    />
                    <Area
                      type="monotone"
                      dataKey="avgPp"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#ppGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Side-by-side Who's Selling (WTS/WTT) & Who's Buying (WTB) */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Sellers Column */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-400">
                  <ShoppingBag className="h-4 w-4" />
                  Who&apos;s Selling / Trading ({market?.sellers.length || 0})
                </div>
                <span className="text-[11px] text-slate-400">WTS &amp; WTT Offers</span>
              </div>

              {loadingMarket ? (
                <div className="py-6 text-center text-xs text-slate-400">
                  Loading seller offers...
                </div>
              ) : !market || market.sellers.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-800 py-6 text-center text-xs text-slate-500">
                  No recent WTS or WTT offers recorded for {item.name}.
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {market.sellers.map((s) => {
                    const priceInfo = formatListingPriceBadge(s);
                    const whisper = buildWhisperCommand(s);
                    const copyKey = `seller-${s.id}`;
                    return (
                      <div
                        key={s.id}
                        className="flex flex-col gap-1.5 rounded-lg border border-slate-800/90 bg-slate-950/70 p-2.5 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                s.listingType === 'WTT'
                                  ? 'bg-purple-950 text-purple-300 border border-purple-500/30'
                                  : 'bg-emerald-950 text-emerald-300 border border-emerald-500/30'
                              }`}
                            >
                              {s.listingType}
                            </span>
                            <span className="font-bold text-slate-100">{s.actorName}</span>
                            {s.source === 'app:bzr-sync' && (
                              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                                BZR Trader
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-semibold ${
                                priceInfo.isNonPp
                                  ? 'bg-indigo-950/90 text-indigo-300 border border-indigo-500/30'
                                  : 'bg-amber-950/70 text-amber-300 border border-amber-500/30'
                              }`}
                            >
                              {priceInfo.isNonPp ? (
                                <ArrowLeftRight className="h-3 w-3" />
                              ) : (
                                <Coins className="h-3 w-3" />
                              )}
                              {priceInfo.primary}
                            </span>

                            <button
                              type="button"
                              onClick={() => handleCopy(whisper, copyKey)}
                              title={whisper}
                              className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-200 hover:border-amber-500/50 hover:text-amber-300"
                            >
                              {copiedId === copyKey ? (
                                <>
                                  <Check className="h-3 w-3 text-emerald-400" /> Copied
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3 w-3" /> /t {s.actorName}
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        {priceInfo.sub && (
                          <div className="text-[11px] text-indigo-200/90">
                            <span className="text-slate-400">Details:</span> {priceInfo.sub}
                          </div>
                        )}

                        <div className="flex items-center justify-between text-[11px] text-slate-500">
                          <span className="truncate max-w-[260px]" title={s.rawMessage || ''}>
                            {s.source}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" /> {formatRelativeTime(s.lastSeenAt)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Buyers Column */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sky-400">
                  <Tag className="h-4 w-4" />
                  Who&apos;s Buying ({market?.buyers.length || 0})
                </div>
                <span className="text-[11px] text-slate-400">WTB Offers</span>
              </div>

              {loadingMarket ? (
                <div className="py-6 text-center text-xs text-slate-400">
                  Loading buyer offers...
                </div>
              ) : !market || market.buyers.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-800 py-6 text-center text-xs text-slate-500">
                  No recent WTB offers recorded for {item.name}.
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {market.buyers.map((b) => {
                    const priceInfo = formatListingPriceBadge(b);
                    const whisper = buildWhisperCommand(b);
                    const copyKey = `buyer-${b.id}`;
                    return (
                      <div
                        key={b.id}
                        className="flex flex-col gap-1.5 rounded-lg border border-slate-800/90 bg-slate-950/70 p-2.5 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="rounded border border-sky-500/30 bg-sky-950 px-1.5 py-0.5 text-[10px] font-bold text-sky-300">
                              WTB
                            </span>
                            <span className="font-bold text-slate-100">{b.actorName}</span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1 rounded border border-sky-500/30 bg-sky-950/70 px-2 py-0.5 font-semibold text-sky-300">
                              {priceInfo.primary}
                            </span>

                            <button
                              type="button"
                              onClick={() => handleCopy(whisper, copyKey)}
                              title={whisper}
                              className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-200 hover:border-sky-500/50 hover:text-sky-300"
                            >
                              {copiedId === copyKey ? (
                                <>
                                  <Check className="h-3 w-3 text-emerald-400" /> Copied
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3 w-3" /> /t {b.actorName}
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        {priceInfo.sub && (
                          <div className="text-[11px] text-slate-300">
                            <span className="text-slate-400">Note:</span> {priceInfo.sub}
                          </div>
                        )}

                        <div className="flex items-center justify-between text-[11px] text-slate-500">
                          <span>{b.source}</span>
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" /> {formatRelativeTime(b.lastSeenAt)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
    </div>
  );
};
