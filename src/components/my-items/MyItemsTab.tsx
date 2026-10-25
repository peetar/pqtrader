'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  FolderOpen,
  RefreshCw,
  Search,
  Save,
  UploadCloud,
  Copy,
  Check,
  Package,
  AlertTriangle,
  Lock,
  Sparkles,
  Coins,
  CheckCircle2,
  HardDrive,
} from 'lucide-react';
import {
  BzrTraderFile,
  CURRENCY_LABELS,
  CURRENCY_SHORT_LABELS,
  CurrencyType,
  ItemMarketSummary,
  OwnedInventoryItem,
  QuarmItem,
} from '@/types/pqtrader';
import {
  ParsedCharacterInventory,
  buildActiveTraderSyncPayload,
} from '@/lib/takp/takpFileSystem';
import {
  ItemDetailPanel,
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

interface MyItemsTabProps {
  catalogById: Record<string, QuarmItem>;
  inventories: ParsedCharacterInventory[];
  bzrFiles: BzrTraderFile[];
  ownedItems: OwnedInventoryItem[];
  activeTraders: Set<string>;
  folderMode: 'NONE' | 'BROWSER_FS' | 'LOCAL_HOST';
  folderLabel: string;
  rollups: Record<number, MarketRollupEntry>;
  initialSelectedItemId?: number | null;
  onConnectBrowserFolder: () => Promise<void>;
  onUploadTakpFiles: (files: FileList | null) => Promise<void>;
  onConnectLocalTakp: () => Promise<void>;
  onRescanFolder: () => Promise<void>;
  onToggleActiveTrader: (traderName: string) => void;
  onUpdateBzrFiles: (
    itemName: string,
    pricePp: number,
    targetTraderNames: string[]
  ) => Promise<void>;
  onRefreshMarket: () => Promise<void>;
  onToast: (msg: string) => void;
}

export const MyItemsTab: React.FC<MyItemsTabProps> = ({
  catalogById,
  inventories,
  bzrFiles,
  ownedItems,
  activeTraders,
  folderMode,
  folderLabel,
  rollups,
  initialSelectedItemId,
  onConnectBrowserFolder,
  onUploadTakpFiles,
  onConnectLocalTakp,
  onRescanFolder,
  onToggleActiveTrader,
  onUpdateBzrFiles,
  onRefreshMarket,
  onToast,
}) => {
  const folderInputRef = React.useRef<HTMLInputElement | null>(null);
  const filesInputRef = React.useRef<HTMLInputElement | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [showNoDrop, setShowNoDrop] = useState(false);
  const [selectedCharFilter, setSelectedCharFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<
    'ALL' | 'IN_SATCHEL' | 'PRICED_ACTIVE' | 'UNPRICED_SATCHEL' | 'SPELLS'
  >('ALL');

  const [selectedItemId, setSelectedItemId] = useState<number | null>(
    initialSelectedItemId || null
  );
  const [itemMarket, setItemMarket] = useState<ItemMarketSummary | null>(null);
  const [loadingMarket, setLoadingMarket] = useState(false);

  // Seller Pricing & BZR Manager State
  const [sellCurrency, setSellCurrency] = useState<CurrencyType>('PP');
  const [sellPricePp, setSellPricePp] = useState<string>('');
  const [sellQty, setSellQty] = useState<string>('1');
  const [sellMetadata, setSellMetadata] = useState<string>('');
  const [sellActorName, setSellActorName] = useState<string>('Derpydoodle');
  const [selectedBzrTargets, setSelectedBzrTargets] = useState<Set<string>>(new Set());
  const [savingBzr, setSavingBzr] = useState(false);
  const [pushingSingle, setPushingSingle] = useState(false);
  const [syncingBatch, setSyncingBatch] = useState(false);
  const [copiedWts, setCopiedWts] = useState(false);

  // Character BZR files (excluding RemoteAverage, RemoteLow, RemoteRecent)
  const characterBzrFiles = useMemo(
    () => bzrFiles.filter((b) => !b.isUtilityIni),
    [bzrFiles]
  );

  // Sync payload of ONLY currently owned items on Active Traders with BZR price > 0
  const activeTraderSyncPayload = useMemo(
    () => buildActiveTraderSyncPayload(ownedItems),
    [ownedItems]
  );

  useEffect(() => {
    if (initialSelectedItemId) {
      setSelectedItemId(initialSelectedItemId);
    }
  }, [initialSelectedItemId]);

  // Select first tradeable owned item by default once loaded
  useEffect(() => {
    if (!selectedItemId && ownedItems.length > 0) {
      const preferred =
        ownedItems.find((i) => !i.nodrop && i.activeBzrPrices.length > 0) ||
        ownedItems.find((i) => !i.nodrop) ||
        ownedItems[0];
      if (preferred) setSelectedItemId(preferred.itemId);
    }
  }, [ownedItems, selectedItemId]);

  const selectedOwnedItem = useMemo(
    () => ownedItems.find((i) => i.itemId === selectedItemId) || null,
    [ownedItems, selectedItemId]
  );

  // When selected item changes, pre-populate price & target BZR traders
  useEffect(() => {
    if (!selectedOwnedItem) return;

    // Fetch market stats & history for this item
    let cancelled = false;
    setLoadingMarket(true);
    fetch(`/api/items/${selectedOwnedItem.itemId}/market`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setItemMarket(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingMarket(false);
      });

    // Prefer the currently filtered character's BZR price if one is selected
    const charFilterLower =
      selectedCharFilter !== 'ALL' ? selectedCharFilter.toLowerCase() : null;
    const preferredActivePrice = charFilterLower
      ? selectedOwnedItem.activeBzrPrices.find(
          (ap) => ap.characterName.toLowerCase() === charFilterLower
        ) || selectedOwnedItem.activeBzrPrices[0]
      : selectedOwnedItem.activeBzrPrices[0];

    const preferredInstance = charFilterLower
      ? selectedOwnedItem.instances.find(
          (inst) => inst.characterName.toLowerCase() === charFilterLower
        ) || selectedOwnedItem.instances[0]
      : selectedOwnedItem.instances[0];

    // Pre-fill price from active BZR price or stale BZR memory
    if (preferredActivePrice) {
      setSellPricePp(String(preferredActivePrice.pricePp));
      setSellActorName(preferredActivePrice.characterName);
    } else if (selectedOwnedItem.staleBzrMemory.length > 0) {
      setSellPricePp(String(selectedOwnedItem.staleBzrMemory[0].pricePp));
      setSellActorName(preferredInstance?.characterName || 'Zondrop');
    } else {
      setSellPricePp('');
      setSellActorName(preferredInstance?.characterName || 'Zondrop');
    }

    // Pre-select BZR files for active traders (prioritizing traders who actually hold this item!)
    const nextTargets = new Set<string>();
    const holdingSet = new Set(
      selectedOwnedItem.instances.map((inst) => inst.characterName.toLowerCase())
    );
    for (const bzr of characterBzrFiles) {
      if (
        holdingSet.has(bzr.traderName.toLowerCase()) ||
        activeTraders.has(bzr.traderName)
      ) {
        nextTargets.add(bzr.traderName);
      }
    }
    setSelectedBzrTargets(nextTargets);

    return () => {
      cancelled = true;
    };
  }, [selectedOwnedItem, characterBzrFiles, activeTraders, selectedCharFilter]);

  const filteredOwnedItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const charLower =
      selectedCharFilter !== 'ALL' ? selectedCharFilter.toLowerCase() : null;

    return ownedItems.filter((item) => {
      if (!showNoDrop && item.nodrop) return false;

      if (charLower) {
        const hasChar = item.instances.some(
          (inst) => inst.characterName.toLowerCase() === charLower
        );
        if (!hasChar) return false;
      }

      if (statusFilter === 'IN_SATCHEL') {
        const inSatchel = item.instances.some(
          (inst) =>
            inst.inTradersSatchel &&
            (!charLower || inst.characterName.toLowerCase() === charLower)
        );
        if (!inSatchel) return false;
      } else if (statusFilter === 'PRICED_ACTIVE') {
        const pricedOnActive = item.activeBzrPrices.some(
          (b) =>
            b.isActiveTrader &&
            b.pricePp > 0 &&
            (!charLower || b.characterName.toLowerCase() === charLower)
        );
        if (!pricedOnActive) return false;
      } else if (statusFilter === 'UNPRICED_SATCHEL') {
        const inSatchel = item.instances.some(
          (inst) =>
            inst.inTradersSatchel &&
            (!charLower || inst.characterName.toLowerCase() === charLower)
        );
        const hasPrice = item.activeBzrPrices.some(
          (b) =>
            b.pricePp > 0 &&
            (!charLower || b.characterName.toLowerCase() === charLower)
        );
        if (!inSatchel || hasPrice) return false;
      } else if (statusFilter === 'SPELLS') {
        if (
          !item.itemName.startsWith('Spell:') &&
          !item.itemName.startsWith('Song:') &&
          !item.itemName.includes('Parchment')
        )
          return false;
      }

      if (q) {
        const matchName = item.itemName.toLowerCase().includes(q);
        const matchId = String(item.itemId).includes(q);
        const matchChar = item.instances.some((inst) =>
          inst.characterName.toLowerCase().includes(q)
        );
        if (!matchName && !matchId && !matchChar) return false;
      }

      return true;
    });
  }, [ownedItems, showNoDrop, selectedCharFilter, statusFilter, searchQuery]);

  const selectedCatalogItem: QuarmItem | null = useMemo(() => {
    if (!selectedOwnedItem) return null;
    return (
      catalogById[String(selectedOwnedItem.itemId)] || {
        id: selectedOwnedItem.itemId,
        name: selectedOwnedItem.itemName,
        nodrop: selectedOwnedItem.nodrop,
      }
    );
  }, [selectedOwnedItem, catalogById]);

  const generatedSellString = useMemo(() => {
    if (!selectedOwnedItem) return '';
    if (sellCurrency === 'PP') {
      const p = parseInt(sellPricePp, 10);
      const pStr = !Number.isNaN(p) && p > 0 ? ` ${p}pp` : '';
      const note = sellMetadata.trim() ? ` (${sellMetadata.trim()})` : '';
      return `/auc WTS ${selectedOwnedItem.itemName}${pStr}${note}`;
    } else {
      const qty = parseInt(sellQty, 10) || 1;
      const label = CURRENCY_SHORT_LABELS[sellCurrency];
      const detail = sellMetadata.trim()
        ? ` ${sellMetadata.trim()}`
        : ` for ${qty}x ${label}`;
      return `/auc WTT ${selectedOwnedItem.itemName}${detail}`;
    }
  }, [selectedOwnedItem, sellCurrency, sellPricePp, sellQty, sellMetadata]);

  const handleSaveToBzrIni = async () => {
    if (!selectedOwnedItem || selectedOwnedItem.nodrop) return;
    if (sellCurrency !== 'PP') {
      onToast('Bazaar INI files only support Platinum (PP) prices (stored as copper pieces).');
      return;
    }
    const p = parseInt(sellPricePp, 10);
    if (Number.isNaN(p) || p < 0) {
      onToast('Please enter a valid Platinum (PP) price >= 0.');
      return;
    }
    const targets = Array.from(selectedBzrTargets);
    if (targets.length === 0) {
      onToast('Please check at least one BZR_<char>_pq.proj.ini file to update.');
      return;
    }

    setSavingBzr(true);
    try {
      await onUpdateBzrFiles(selectedOwnedItem.itemName, p, targets);
    } finally {
      setSavingBzr(false);
    }
  };

  const handlePushSingleOfferToDb = async () => {
    if (!selectedOwnedItem || selectedOwnedItem.nodrop) return;
    const isPp = sellCurrency === 'PP';
    const p = parseInt(sellPricePp, 10);
    if (isPp && (Number.isNaN(p) || p <= 0)) {
      onToast('Please enter a Platinum (PP) price > 0 before pushing to the PQ Trader DB.');
      return;
    }

    setPushingSingle(true);
    try {
      const listingType = isPp ? 'WTS' : 'WTT';
      const res = await fetch('/api/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingType,
          itemId: selectedOwnedItem.itemId,
          itemName: selectedOwnedItem.itemName,
          actorName: sellActorName.trim() || 'Derpydoodle',
          currencyType: sellCurrency,
          pricePp: isPp ? p : null,
          priceQuantity: parseInt(sellQty, 10) || 1,
          tradeMetadata: sellMetadata.trim() || null,
          source: 'app:manual',
          rawMessage: generatedSellString,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to push listing');
      onToast(
        `Pushed ${listingType} for ${selectedOwnedItem.itemName} (${
          isPp ? `${p.toLocaleString()} pp` : CURRENCY_SHORT_LABELS[sellCurrency]
        }) to PQ Trader DB!`
      );
      await onRefreshMarket();
      const mRes = await fetch(`/api/items/${selectedOwnedItem.itemId}/market`);
      if (mRes.ok) setItemMarket(await mRes.json());
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : 'Failed to push listing');
    } finally {
      setPushingSingle(false);
    }
  };

  const handleBatchSyncActiveTraders = async () => {
    if (activeTraderSyncPayload.length === 0) {
      onToast('No owned + priced items found on currently checked Active Traders.');
      return;
    }
    setSyncingBatch(true);
    try {
      const res = await fetch('/api/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listings: activeTraderSyncPayload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Batch sync failed');
      onToast(
        `Synced ${data.upsertedCount} owned & priced Active Trader items to PQ Trader DB! (Stale/unowned BZR items excluded)`
      );
      await onRefreshMarket();
      if (selectedOwnedItem) {
        const mRes = await fetch(`/api/items/${selectedOwnedItem.itemId}/market`);
        if (mRes.ok) setItemMarket(await mRes.json());
      }
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : 'Batch sync failed');
    } finally {
      setSyncingBatch(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Bar: TAKP Folder Connection + Active Traders Selection */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4 shadow">
        {/* Hidden inputs that read both *-Inventory.txt and BZR_*.ini files without Chrome's showDirectoryPicker .ini block */}
        <input
          ref={folderInputRef}
          type="file"
          multiple
          // @ts-expect-error webkitdirectory is supported in all modern browsers
          webkitdirectory=""
          className="hidden"
          onChange={(e) => {
            onUploadTakpFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={filesInputRef}
          type="file"
          multiple
          accept=".ini,.txt"
          className="hidden"
          onChange={(e) => {
            onUploadTakpFiles(e.target.files);
            e.target.value = '';
          }}
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5 text-amber-400" />
              <h2 className="text-base font-bold text-slate-100">
                TAKP Inventory &amp; Bazaar (`BZR_*.ini`) Manager
              </h2>
              {folderMode !== 'NONE' && (
                <span className="rounded-full border border-emerald-500/40 bg-emerald-950/60 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
                  Connected: {folderLabel} ({inventories.length} chars · {characterBzrFiles.length}{' '}
                  trader INIs)
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Scans all <code className="text-amber-300">&lt;char&gt;-Inventory.txt</code> and{' '}
              <code className="text-amber-300">BZR_&lt;char&gt;_pq.proj.ini</code> files. Only BZR
              prices for items <strong>currently in an Active Trader&apos;s inventory</strong> are
              synced to the market DB.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => folderInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/50 bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/25"
              title="Reads all *-Inventory.txt and BZR_*_pq.proj.ini files from your TAKP folder"
            >
              <FolderOpen className="h-4 w-4" />
              Pick TAKP Folder (.txt + .ini)
            </button>

            <button
              type="button"
              onClick={() => filesInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25"
              title="Select one or more BZR_<char>_pq.proj.ini or <char>-Inventory.txt files directly"
            >
              <UploadCloud className="h-4 w-4" />
              Load BZR_*.ini Files
            </button>

            <button
              type="button"
              onClick={onConnectLocalTakp}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 py-2 text-xs font-semibold text-sky-300 hover:bg-sky-500/25"
              title="Only works when running PQ Trader locally on your PC"
            >
              <HardDrive className="h-4 w-4" />
              Local C:\TAKPv22
            </button>

            {folderMode !== 'NONE' && (
              <button
                type="button"
                onClick={onRescanFolder}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Rescan
              </button>
            )}
          </div>
        </div>

        {/* Helpful alert if inventories are loaded but 0 BZR INI files were loaded */}
        {inventories.length > 0 && characterBzrFiles.length === 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-950/30 px-3.5 py-2.5 text-xs text-amber-200">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
              <span>
                <strong>0 Trader INI files loaded:</strong> Windows browsers block{' '}
                <code>.ini</code> files in the older Directory Picker API. Click{' '}
                <strong>Pick TAKP Folder (.txt + .ini)</strong> or{' '}
                <strong>Load BZR_*.ini Files</strong> to import your{' '}
                <code>BZR_Zondrop_pq.proj.ini</code> prices!
              </span>
            </div>
            <button
              type="button"
              onClick={() => filesInputRef.current?.click()}
              className="rounded-md bg-amber-500 px-2.5 py-1 text-xs font-bold text-slate-950 hover:bg-amber-400"
            >
              Select BZR_*.ini Files Now
            </button>
          </div>
        )}

        {/* Active Traders Selector & Batch Sync Controls */}
        {characterBzrFiles.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Active Traders:
              </span>
              {characterBzrFiles.map((bzr) => {
                const isActive = activeTraders.has(bzr.traderName);
                const totalIniCount = Object.values(bzr.pricesByItemName).filter(
                  (cp) => cp > 0
                ).length;
                const currentlyOwnedAndPricedCount = ownedItems.filter(
                  (item) =>
                    !item.nodrop &&
                    item.activeBzrPrices.some(
                      (ap) =>
                        ap.characterName.toLowerCase() === bzr.traderName.toLowerCase() &&
                        ap.pricePp > 0
                    )
                ).length;

                return (
                  <label
                    key={bzr.fileName}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition ${
                      isActive
                        ? 'border-emerald-500/50 bg-emerald-950/30 text-emerald-200'
                        : 'border-slate-800 bg-slate-950/60 text-slate-400'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={() => onToggleActiveTrader(bzr.traderName)}
                      className="rounded border-slate-600 text-emerald-500 focus:ring-emerald-500"
                    />
                    <div>
                      <span className="font-bold">{bzr.traderName}</span>
                      <span className="ml-1.5 text-[11px] text-slate-400">
                        ({currentlyOwnedAndPricedCount} owned priced / {totalIniCount} old INI
                        entries)
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>

            <button
              type="button"
              disabled={syncingBatch || activeTraderSyncPayload.length === 0}
              onClick={handleBatchSyncActiveTraders}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              <UploadCloud className="h-4 w-4" />
              {syncingBatch
                ? 'Syncing...'
                : `Push ${activeTraderSyncPayload.length} Owned Active Trader WTS to DB`}
            </button>
          </div>
        )}
      </div>

      {/* Main Content Grid: Left = Owned Inventory Table, Right = Seller Pricing + Item Detail */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Left Column: Owned Items Search & Table */}
        <div className="space-y-4 xl:col-span-5">
          <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search owned items by name, ID, or character..."
                className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2.5 pl-9 pr-4 text-sm text-slate-100 placeholder-slate-500 focus:border-amber-500 focus:outline-none"
              />
            </div>

            {/* Filter Pills */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {(
                [
                  ['ALL', 'All Owned'],
                  ['IN_SATCHEL', "In Trader's Satchel"],
                  ['PRICED_ACTIVE', 'Priced on Active Trader'],
                  ['UNPRICED_SATCHEL', 'Satchel (Unpriced)'],
                  ['SPELLS', 'Spells & Parchments'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStatusFilter(key)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    statusFilter === key
                      ? 'bg-amber-500 text-slate-950 font-semibold'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Character Dropdown + Show No-Drop Toggle */}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <select
                value={selectedCharFilter}
                onChange={(e) => setSelectedCharFilter(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200"
              >
                <option value="ALL">All Characters ({inventories.length})</option>
                {inventories.map((inv) => (
                  <option key={inv.characterName} value={inv.characterName}>
                    {inv.characterName} ({inv.items.length} slots)
                  </option>
                ))}
              </select>

              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-1.5 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={showNoDrop}
                  onChange={(e) => setShowNoDrop(e.target.checked)}
                  className="rounded border-slate-600 text-amber-500 focus:ring-amber-500"
                />
                <span>Include No-Drop Items</span>
              </label>
            </div>
          </div>

          {/* Owned Items List */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3 shadow">
            <div className="mb-2 flex items-center justify-between px-1 text-xs text-slate-400">
              <span className="font-semibold uppercase tracking-wider">
                Owned Items ({filteredOwnedItems.length})
              </span>
              <span>Click item to price &amp; inspect</span>
            </div>

            {ownedItems.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-800 py-12 text-center text-xs text-slate-400">
                <Package className="mx-auto mb-2 h-8 w-8 text-slate-600" />
                Connect your TAKP folder above to scan all{' '}
                <code className="text-amber-300">&lt;char&gt;-Inventory.txt</code> and{' '}
                <code className="text-amber-300">BZR_&lt;char&gt;_pq.proj.ini</code> files.
              </div>
            ) : (
              <div className="max-h-[600px] space-y-1.5 overflow-y-auto pr-1">
                {filteredOwnedItems.slice(0, 200).map((item) => {
                  const isSelected = selectedItemId === item.itemId;
                  const r = rollups[item.itemId];
                  const charLower =
                    selectedCharFilter !== 'ALL' ? selectedCharFilter.toLowerCase() : null;
                  const primaryActivePrice = charLower
                    ? item.activeBzrPrices.find(
                        (ap) => ap.characterName.toLowerCase() === charLower
                      ) || item.activeBzrPrices[0]
                    : item.activeBzrPrices[0];
                  const stalePrices = item.staleBzrMemory;
                  const sortedInstances = charLower
                    ? [
                        ...item.instances.filter(
                          (inst) => inst.characterName.toLowerCase() === charLower
                        ),
                        ...item.instances.filter(
                          (inst) => inst.characterName.toLowerCase() !== charLower
                        ),
                      ]
                    : item.instances;

                  return (
                    <button
                      key={item.itemId}
                      type="button"
                      onClick={() => setSelectedItemId(item.itemId)}
                      className={`w-full rounded-lg border p-2.5 text-left transition ${
                        isSelected
                          ? 'border-amber-500/80 bg-amber-950/25'
                          : 'border-slate-800/80 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-900'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-semibold text-slate-100">
                              {item.itemName}
                            </span>
                            <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                              #{item.itemId}
                            </span>
                            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                              {item.totalCount}x
                            </span>
                            {item.nodrop && (
                              <span className="rounded bg-rose-950/80 border border-rose-500/30 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">
                                NO DROP
                              </span>
                            )}
                          </div>

                          {/* Character & Slot Breakdown Badges */}
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {sortedInstances.slice(0, 4).map((inst, idx) => (
                              <span
                                key={`${inst.characterName}-${inst.location}-${idx}`}
                                className={`rounded px-1.5 py-0.5 text-[10px] ${
                                  inst.inTradersSatchel
                                    ? 'bg-emerald-950/90 text-emerald-300 border border-emerald-500/30 font-medium'
                                    : 'bg-slate-800/90 text-slate-300'
                                }`}
                              >
                                {inst.characterName}: {inst.location}
                                {inst.count > 1 ? ` (${inst.count})` : ''}
                              </span>
                            ))}
                            {sortedInstances.length > 4 && (
                              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                                +{sortedInstances.length - 4} more
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Right Side: My BZR Price & Market Summary */}
                        <div className="flex flex-col items-end gap-1 text-right text-[11px]">
                          {primaryActivePrice ? (
                            <span className="rounded border border-emerald-500/40 bg-emerald-950/70 px-2 py-0.5 font-semibold text-emerald-300">
                              {primaryActivePrice.characterName} BZR:{' '}
                              {primaryActivePrice.pricePp.toLocaleString()} pp
                            </span>
                          ) : stalePrices.length > 0 ? (
                            <span
                              title={`Stale price in BZR_${stalePrices[0].traderName}_pq.proj.ini (item not held by ${stalePrices[0].traderName})`}
                              className="rounded border border-slate-700 bg-slate-800/80 px-2 py-0.5 text-[10px] text-slate-400"
                            >
                              Old INI ({stalePrices[0].traderName}):{' '}
                              {stalePrices[0].pricePp.toLocaleString()}p
                            </span>
                          ) : !item.nodrop ? (
                            <span className="text-[10px] text-slate-500">Unpriced</span>
                          ) : null}

                          {r && (
                            <div className="text-[10px] text-slate-400">
                              {r.lastWtsPp ? `Mkt WTS: ${r.lastWtsPp.toLocaleString()}p` : ''}
                              {r.lastWtbPp ? ` · WTB: ${r.lastWtbPp.toLocaleString()}p` : ''}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Seller Pricing & BZR Manager + Full ItemDetailPanel */}
        <div className="space-y-4 xl:col-span-7">
          {selectedOwnedItem && selectedCatalogItem ? (
            <>
              {/* Seller Pricing & BZR File Manager Card */}
              <div className="rounded-xl border border-amber-500/40 bg-slate-900/95 p-4 shadow-lg">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                  <div>
                    <h3 className="text-base font-bold text-amber-300">
                      Sell &amp; Bazaar Price Manager — {selectedOwnedItem.itemName}
                    </h3>
                    <p className="text-xs text-slate-400">
                      Owned: <strong>{selectedOwnedItem.totalCount}x</strong> across{' '}
                      {selectedOwnedItem.instances.map((i) => i.characterName).join(', ')}
                    </p>
                  </div>
                  <span className="rounded bg-slate-800 px-2 py-1 font-mono text-xs text-slate-300">
                    Item ID #{selectedOwnedItem.itemId}
                  </span>
                </div>

                {selectedOwnedItem.nodrop ? (
                  <div className="mt-3 flex items-center gap-2.5 rounded-lg border border-rose-500/30 bg-rose-950/30 p-3 text-xs text-rose-200">
                    <Lock className="h-4 w-4 shrink-0 text-rose-400" />
                    <div>
                      <strong>NO DROP Item:</strong> You can track which characters hold this item
                      and where it is stored below, but Bazaar pricing and WTS/WTT publishing are
                      disabled.
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 space-y-4">
                    {/* Quick Price Intelligence Comparison Strip */}
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                      {/* My Current BZR Price */}
                      <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-2.5 text-xs">
                        <div className="text-[11px] font-semibold uppercase text-slate-400">
                          My Active Trader BZR Price
                        </div>
                        {selectedOwnedItem.activeBzrPrices.length > 0 ? (
                          <div className="mt-1 space-y-1">
                            {selectedOwnedItem.activeBzrPrices.map((ap) => (
                              <div
                                key={ap.characterName}
                                className="flex items-center justify-between"
                              >
                                <span className="text-slate-300">{ap.characterName}:</span>
                                <span className="font-bold text-emerald-300">
                                  {ap.pricePp.toLocaleString()} pp
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-1 text-slate-500">
                            Not priced on holding trader
                          </div>
                        )}
                        {selectedOwnedItem.staleBzrMemory.length > 0 && (
                          <div className="mt-1.5 border-t border-slate-800 pt-1 text-[11px] text-amber-300/80">
                            <AlertTriangle className="mr-1 inline h-3 w-3" />
                            Stale INI memory (unowned on{' '}
                            {selectedOwnedItem.staleBzrMemory[0].traderName}):{' '}
                            {selectedOwnedItem.staleBzrMemory[0].pricePp.toLocaleString()} pp
                          </div>
                        )}
                      </div>

                      {/* Recent Market WTS Prices */}
                      <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-2.5 text-xs">
                        <div className="flex items-center justify-between text-[11px] font-semibold uppercase text-emerald-400">
                          <span>Recent Market WTS</span>
                          {itemMarket?.avg30dPp && (
                            <span className="text-slate-400">
                              Avg: {itemMarket.avg30dPp.toLocaleString()}p
                            </span>
                          )}
                        </div>
                        {itemMarket && itemMarket.sellers.length > 0 ? (
                          <div className="mt-1 space-y-1">
                            {itemMarket.sellers.slice(0, 3).map((s) => (
                              <div key={s.id} className="flex items-center justify-between">
                                <span className="truncate text-slate-300">{s.actorName}</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (s.pricePp) setSellPricePp(String(s.pricePp));
                                  }}
                                  className="font-semibold text-amber-300 hover:underline"
                                  title="Click to use this price"
                                >
                                  {s.pricePp
                                    ? `${s.pricePp.toLocaleString()} pp`
                                    : CURRENCY_SHORT_LABELS[s.currencyType]}
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-1 text-slate-500">No recent WTS listings</div>
                        )}
                      </div>

                      {/* Recent Market WTB Offers */}
                      <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-2.5 text-xs">
                        <div className="text-[11px] font-semibold uppercase text-sky-400">
                          Recent Buyers (WTB)
                        </div>
                        {itemMarket && itemMarket.buyers.length > 0 ? (
                          <div className="mt-1 space-y-1">
                            {itemMarket.buyers.slice(0, 3).map((b) => (
                              <div key={b.id} className="flex items-center justify-between">
                                <span className="truncate text-slate-300">{b.actorName}</span>
                                <span className="font-semibold text-sky-300">
                                  {b.pricePp
                                    ? `${b.pricePp.toLocaleString()} pp`
                                    : 'Offer'}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="mt-1 text-slate-500">No active WTB buyers</div>
                        )}
                      </div>
                    </div>

                    {/* Price & Currency Inputs */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
                      <div className="sm:col-span-3">
                        <label className="mb-1 block text-[11px] font-medium text-slate-400">
                          Selling Character
                        </label>
                        <input
                          type="text"
                          value={sellActorName}
                          onChange={(e) => setSellActorName(e.target.value)}
                          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                        />
                      </div>

                      <div className="sm:col-span-4">
                        <label className="mb-1 block text-[11px] font-medium text-slate-400">
                          Price Currency
                        </label>
                        <select
                          value={sellCurrency}
                          onChange={(e) => setSellCurrency(e.target.value as CurrencyType)}
                          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                        >
                          {(Object.keys(CURRENCY_LABELS) as CurrencyType[]).map((c) => (
                            <option key={c} value={c}>
                              {CURRENCY_LABELS[c]}
                            </option>
                          ))}
                        </select>
                      </div>

                      {sellCurrency === 'PP' ? (
                        <div className="sm:col-span-2">
                          <label className="mb-1 block text-[11px] font-medium text-slate-400">
                            Price in PP
                          </label>
                          <input
                            type="number"
                            min={0}
                            value={sellPricePp}
                            onChange={(e) => setSellPricePp(e.target.value)}
                            placeholder="e.g. 1000"
                            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs font-semibold text-amber-300 focus:border-amber-500 focus:outline-none"
                          />
                        </div>
                      ) : (
                        <div className="sm:col-span-2">
                          <label className="mb-1 block text-[11px] font-medium text-slate-400">
                            Quantity
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={20}
                            value={sellQty}
                            onChange={(e) => setSellQty(e.target.value)}
                            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                          />
                        </div>
                      )}

                      <div className="sm:col-span-3">
                        <label className="mb-1 block text-[11px] font-medium text-slate-400">
                          Trade Note (Optional)
                        </label>
                        <input
                          type="text"
                          value={sellMetadata}
                          onChange={(e) => setSellMetadata(e.target.value)}
                          placeholder={
                            sellCurrency === 'SIMILAR_SPELL'
                              ? 'for Command of Tunare'
                              : 'In Bazaar / PST'
                          }
                          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
                        />
                      </div>
                    </div>

                    {/* Select Target BZR_<char>_pq.proj.ini Files to Update */}
                    {sellCurrency === 'PP' && characterBzrFiles.length > 0 && (
                      <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                        <div className="mb-2 flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-300">
                            Select <code className="text-amber-300">BZR_&lt;char&gt;_pq.proj.ini</code>{' '}
                            Files to Update (
                            {sellPricePp && !Number.isNaN(parseInt(sellPricePp, 10))
                              ? `${(parseInt(sellPricePp, 10) * 1000).toLocaleString()} copper pieces`
                              : '0 cp'}
                            ):
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {characterBzrFiles.map((bzr) => {
                            const checked = selectedBzrTargets.has(bzr.traderName);
                            const holdsItem = selectedOwnedItem.instances.some(
                              (inst) =>
                                inst.characterName.toLowerCase() ===
                                bzr.traderName.toLowerCase()
                            );
                            return (
                              <label
                                key={bzr.fileName}
                                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
                                  checked
                                    ? 'border-amber-500/60 bg-amber-950/30 text-amber-200'
                                    : 'border-slate-800 bg-slate-900 text-slate-400'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {
                                    const next = new Set(selectedBzrTargets);
                                    if (next.has(bzr.traderName)) next.delete(bzr.traderName);
                                    else next.add(bzr.traderName);
                                    setSelectedBzrTargets(next);
                                  }}
                                  className="rounded border-slate-600 text-amber-500"
                                />
                                <span>BZR_{bzr.traderName}_pq.proj.ini</span>
                                {holdsItem && (
                                  <span className="rounded bg-emerald-950 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                                    Holds Item
                                  </span>
                                )}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Explicit Action Buttons */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-3">
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(generatedSellString);
                          setCopiedWts(true);
                          onToast(`Copied: ${generatedSellString}`);
                          setTimeout(() => setCopiedWts(false), 2000);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:border-amber-500/40"
                      >
                        {copiedWts ? (
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        Copy In-Game &ldquo;{generatedSellString}&rdquo;
                      </button>

                      <div className="flex flex-wrap items-center gap-2">
                        {sellCurrency === 'PP' && (
                          <button
                            type="button"
                            disabled={savingBzr}
                            onClick={handleSaveToBzrIni}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
                          >
                            <Save className="h-3.5 w-3.5" />
                            {savingBzr
                              ? 'Writing INI...'
                              : `1. Update Selected BZR_*.ini (${selectedBzrTargets.size})`}
                          </button>
                        )}

                        <button
                          type="button"
                          disabled={pushingSingle}
                          onClick={handlePushSingleOfferToDb}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                        >
                          <UploadCloud className="h-3.5 w-3.5" />
                          {pushingSingle
                            ? 'Pushing...'
                            : `2. Push My ${
                                sellCurrency === 'PP' ? 'WTS' : 'WTT'
                              } to PQ Trader DB`}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Detailed Character Slot Breakdown for Selected Item */}
              <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-3.5 text-xs">
                <div className="mb-2 font-semibold uppercase tracking-wider text-slate-400">
                  Where You Hold {selectedOwnedItem.itemName} ({selectedOwnedItem.totalCount}{' '}
                  Total)
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {selectedOwnedItem.instances.map((inst, i) => (
                    <div
                      key={`${inst.characterName}-${inst.location}-${i}`}
                      className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2"
                    >
                      <div>
                        <span className="font-bold text-amber-200">
                          {inst.characterName}
                        </span>
                        <span className="ml-2 text-slate-400">{inst.location}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {inst.inTradersSatchel && (
                          <span className="rounded bg-emerald-950 border border-emerald-500/30 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                            Trader&apos;s Satchel
                          </span>
                        )}
                        <span className="font-mono font-semibold text-slate-200">
                          x{inst.count}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Full Item Stats, Price Trend Chart, and Market WTS/WTB Lists */}
              <ItemDetailPanel
                item={selectedCatalogItem}
                market={itemMarket}
                loadingMarket={loadingMarket}
                onCopyToast={onToast}
              />
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-800 py-16 text-center text-sm text-slate-500">
              Select any owned item on the left to inspect its stats, price trends, and manage
              Bazaar INI prices.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
