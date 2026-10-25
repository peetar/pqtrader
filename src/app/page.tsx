'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Coins,
  Store,
  PackageSearch,
  Radio,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';
import {
  BzrTraderFile,
  MarketListing,
  OwnedInventoryItem,
  QuarmItem,
} from '@/types/pqtrader';
import {
  ParsedCharacterInventory,
  buildOwnedInventoryCatalog,
  parseBzrIni,
  parseInventoryTxt,
  serializeBzrIni,
} from '@/lib/takp/takpFileSystem';
import { MarketExplorer } from '@/components/market/MarketExplorer';
import { MyItemsTab } from '@/components/my-items/MyItemsTab';
import { DiscordScraperTab } from '@/components/scraper/DiscordScraperTab';

// Type declarations for Chromium File System Access API
interface FileSystemWritableStream {
  write: (data: string) => Promise<void>;
  close: () => Promise<void>;
}

interface FsFileHandle {
  kind: 'file';
  name: string;
  getFile: () => Promise<File>;
  createWritable: () => Promise<FileSystemWritableStream>;
}

interface FsDirHandle {
  kind: 'directory';
  name: string;
  values: () => AsyncIterable<FsFileHandle | FsDirHandle>;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<FsFileHandle>;
}

interface MarketRollupEntry {
  itemId: number;
  lastWtsPp: number | null;
  lastWtbPp: number | null;
  wtsCount: number;
  wtbCount: number;
  wttCount: number;
  lastSeenAt: string;
}

export default function PQTraderApp() {
  const [activeTab, setActiveTab] = useState<'MARKET' | 'MY_ITEMS' | 'SCRAPER'>('MARKET');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Full 26,972 Quarm Item Catalog
  const [catalogById, setCatalogById] = useState<Record<string, QuarmItem>>({});
  const [loadingCatalog, setLoadingCatalog] = useState(true);

  // Market Listings & Rollups
  const [recentListings, setRecentListings] = useState<MarketListing[]>([]);
  const [rollups, setRollups] = useState<Record<number, MarketRollupEntry>>({});

  // TAKP Folder State
  const [folderMode, setFolderMode] = useState<'NONE' | 'BROWSER_FS' | 'LOCAL_HOST'>('NONE');
  const [folderLabel, setFolderLabel] = useState<string>('');
  const [inventories, setInventories] = useState<ParsedCharacterInventory[]>([]);
  const [bzrFiles, setBzrFiles] = useState<BzrTraderFile[]>([]);
  const [activeTraders, setActiveTraders] = useState<Set<string>>(
    new Set(['Derpydoodle', 'Zondrop', 'Zondromule'])
  );
  const [jumpToMyItemId, setJumpToMyItemId] = useState<number | null>(null);

  const browserDirHandleRef = useRef<FsDirHandle | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 4000);
    return () => clearTimeout(t);
  }, [toastMessage]);

  // Load saved active traders & cached TAKP inventories/BZR files from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('pqtrader_active_traders');
    if (saved) {
      try {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr)) setActiveTraders(new Set(arr));
      } catch {}
    }

    try {
      const cachedInvs = localStorage.getItem('pqtrader_cached_inventories');
      const cachedBzrs = localStorage.getItem('pqtrader_cached_bzrs');
      const cachedLabel = localStorage.getItem('pqtrader_cached_folder_label');
      if (cachedInvs) {
        const parsedInvs = JSON.parse(cachedInvs);
        if (Array.isArray(parsedInvs) && parsedInvs.length > 0) {
          setInventories(parsedInvs);
          setFolderMode('BROWSER_FS');
          setFolderLabel(cachedLabel || 'TAKPv22');
        }
      }
      if (cachedBzrs) {
        const parsedBzrs = JSON.parse(cachedBzrs);
        if (Array.isArray(parsedBzrs) && parsedBzrs.length > 0) {
          setBzrFiles(parsedBzrs);
        }
      }
    } catch {}
  }, []);

  const persistTakpCache = useCallback(
    (
      nextInvs: ParsedCharacterInventory[],
      nextBzrs: BzrTraderFile[],
      label: string
    ) => {
      try {
        localStorage.setItem('pqtrader_cached_inventories', JSON.stringify(nextInvs));
        localStorage.setItem('pqtrader_cached_bzrs', JSON.stringify(nextBzrs));
        localStorage.setItem('pqtrader_cached_folder_label', label);
      } catch {}
    },
    []
  );

  // Load 26,972 Item Catalog
  useEffect(() => {
    fetch('/data/items_catalog.json')
      .then((r) => r.json())
      .then((data) => {
        setCatalogById(data);
      })
      .catch(() => {
        showToast('Failed to load items_catalog.json');
      })
      .finally(() => {
        setLoadingCatalog(false);
      });
  }, [showToast]);

  const fetchMarketData = useCallback(async () => {
    try {
      const res = await fetch('/api/listings?includeRollups=true&limit=150');
      const data = await res.json();
      if (data.listings) setRecentListings(data.listings);
      if (data.rollups) setRollups(data.rollups);
    } catch {}
  }, []);

  useEffect(() => {
    fetchMarketData();
  }, [fetchMarketData]);

  // Automatically load C:\TAKPv22 if available on local dev host
  const handleConnectLocalTakp = useCallback(
    async (silent = false) => {
      try {
        const res = await fetch('/api/local-takp');
        if (!res.ok) {
          if (!silent) {
            showToast(
              'Local C:\\TAKPv22 shortcut is only available when running locally. Use "Pick TAKP Folder" instead!'
            );
          }
          return;
        }
        const data = await res.json();
        if (!data.available) return;

        const parsedInvs: ParsedCharacterInventory[] = (data.inventoryFiles || []).map(
          (f: { fileName: string; content: string }) =>
            parseInventoryTxt(f.fileName, f.content)
        );
        const parsedBzrs: BzrTraderFile[] = (data.bzrFiles || []).map(
          (f: { fileName: string; content: string }) =>
            parseBzrIni(f.fileName, f.content)
        );

        const label = data.dirPath || 'C:\\TAKPv22';
        setInventories(parsedInvs);
        setBzrFiles(parsedBzrs);
        setFolderMode('LOCAL_HOST');
        setFolderLabel(label);
        persistTakpCache(parsedInvs, parsedBzrs, label);
        if (!silent) {
          showToast(
            `Loaded ${parsedInvs.length} character inventories and ${parsedBzrs.length} BZR INI files from ${label}!`
          );
        }
      } catch {
        if (!silent) showToast('Could not load local C:\\TAKPv22 directory.');
      }
    },
    [showToast, persistTakpCache]
  );

  useEffect(() => {
    handleConnectLocalTakp(true);
  }, [handleConnectLocalTakp]);

  /**
   * Scans a FileList from <input type="file" webkitdirectory /> or <input type="file" multiple accept=".ini,.txt" />.
   * Unlike window.showDirectoryPicker() (where Chromium on Windows blocks .ini files),
   * standard <input type="file"> reads both *-Inventory.txt and BZR_*_pq.proj.ini files on Vercel!
   */
  const handleUploadTakpFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;

      const invByFileName = new Map<string, ParsedCharacterInventory>();
      for (const existing of inventories) {
        invByFileName.set(existing.fileName.toLowerCase(), existing);
      }

      const bzrByFileName = new Map<string, BzrTraderFile>();
      for (const existing of bzrFiles) {
        bzrByFileName.set(existing.fileName.toLowerCase(), existing);
      }

      let scannedInvs = 0;
      let scannedBzrs = 0;
      let detectedFolderName = folderLabel || 'TAKPv22';

      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        const relPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || '';
        if (relPath) {
          const parts = relPath.split('/');
          // Skip nested subfolders (like uifiles/, maps/, logs/) for instant scanning
          if (parts.length > 2) continue;
          if (parts[0]) detectedFolderName = parts[0];
        }

        const name = file.name;
        if (/-Inventory\.txt$/i.test(name)) {
          const content = await file.text();
          invByFileName.set(name.toLowerCase(), parseInventoryTxt(name, content));
          scannedInvs++;
        } else if (/^BZR_.+?\.ini$/i.test(name)) {
          const content = await file.text();
          bzrByFileName.set(name.toLowerCase(), parseBzrIni(name, content));
          scannedBzrs++;
        }
      }

      const nextInvs = Array.from(invByFileName.values()).sort((a, b) =>
        a.characterName.localeCompare(b.characterName)
      );
      const nextBzrs = Array.from(bzrByFileName.values()).sort((a, b) =>
        a.traderName.localeCompare(b.traderName)
      );

      setInventories(nextInvs);
      setBzrFiles(nextBzrs);
      setFolderMode('BROWSER_FS');
      setFolderLabel(detectedFolderName);
      persistTakpCache(nextInvs, nextBzrs, detectedFolderName);

      const traderIniCount = nextBzrs.filter((b) => !b.isUtilityIni).length;
      showToast(
        `Loaded ${scannedInvs} inventory file(s) and ${scannedBzrs} BZR INI file(s) (${nextInvs.length} chars · ${traderIniCount} trader INIs total)!`
      );
    },
    [inventories, bzrFiles, folderLabel, persistTakpCache, showToast]
  );

  // Connect TAKP Folder via Chromium File System Access API
  const scanBrowserDirHandle = useCallback(
    async (dirHandle: FsDirHandle) => {
      const parsedInvs: ParsedCharacterInventory[] = [];
      const parsedBzrs: BzrTraderFile[] = [];

      for await (const entry of dirHandle.values()) {
        if (entry.kind !== 'file') continue;
        const fHandle = entry as FsFileHandle;
        try {
          if (/-Inventory\.txt$/i.test(fHandle.name)) {
            const file = await fHandle.getFile();
            const content = await file.text();
            parsedInvs.push(parseInventoryTxt(fHandle.name, content));
          } else if (/^BZR_.+?\.ini$/i.test(fHandle.name)) {
            const file = await fHandle.getFile();
            const content = await file.text();
            parsedBzrs.push(parseBzrIni(fHandle.name, content));
          }
        } catch {}
      }

      // Preserve any previously loaded BZR files if Chromium's showDirectoryPicker filtered out .ini files
      const finalBzrs = parsedBzrs.length > 0 ? parsedBzrs : bzrFiles;

      setInventories(parsedInvs);
      setBzrFiles(finalBzrs);
      setFolderMode('BROWSER_FS');
      setFolderLabel(dirHandle.name);
      persistTakpCache(parsedInvs, finalBzrs, dirHandle.name);
      showToast(
        `Scanned ${parsedInvs.length} character inventories and ${finalBzrs.filter((b) => !b.isUtilityIni).length} trader BZR INI files from "${dirHandle.name}"!`
      );
    },
    [bzrFiles, persistTakpCache, showToast]
  );

  const handleConnectBrowserFolder = async () => {
    try {
      const win = window as unknown as {
        showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FsDirHandle>;
      };
      if (!win.showDirectoryPicker) {
        showToast(
          'Your browser does not support window.showDirectoryPicker(). Please use "Pick TAKP Folder" instead.'
        );
        return;
      }
      const dirHandle = await win.showDirectoryPicker({ mode: 'read' });
      browserDirHandleRef.current = dirHandle;
      await scanBrowserDirHandle(dirHandle);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      showToast('Folder selection was cancelled or denied.');
    }
  };

  const handleRescanFolder = async () => {
    if (folderMode === 'LOCAL_HOST') {
      await handleConnectLocalTakp(false);
    } else if (folderMode === 'BROWSER_FS' && browserDirHandleRef.current) {
      await scanBrowserDirHandle(browserDirHandleRef.current);
    } else {
      showToast('Use "Pick TAKP Folder" or "Load BZR .ini Files" to refresh files from disk.');
    }
  };

  const handleToggleActiveTrader = (traderName: string) => {
    setActiveTraders((prev) => {
      const next = new Set(prev);
      if (next.has(traderName)) next.delete(traderName);
      else next.add(traderName);
      localStorage.setItem('pqtrader_active_traders', JSON.stringify(Array.from(next)));
      return next;
    });
  };

  // Write updated copper price (PP * 1000) to selected BZR_<char>_pq.proj.ini files
  const handleUpdateBzrFiles = async (
    itemName: string,
    pricePp: number,
    targetTraderNames: string[]
  ) => {
    const priceCp = Math.max(0, Math.round(pricePp * 1000));
    const targetLower = new Set(targetTraderNames.map((n) => n.toLowerCase()));

    const updatedBzrFiles = bzrFiles.map((bzr) => {
      if (!targetLower.has(bzr.traderName.toLowerCase())) return bzr;
      return {
        ...bzr,
        pricesByItemName: {
          ...bzr.pricesByItemName,
          [itemName]: priceCp,
        },
      };
    });

    setBzrFiles(updatedBzrFiles);
    persistTakpCache(inventories, updatedBzrFiles, folderLabel);

    if (folderMode === 'LOCAL_HOST') {
      const updates = updatedBzrFiles
        .filter((bzr) => targetLower.has(bzr.traderName.toLowerCase()))
        .map((bzr) => ({
          fileName: bzr.fileName,
          pricesByItemName: bzr.pricesByItemName,
        }));

      const res = await fetch('/api/local-takp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dirPath: folderLabel,
          updates,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update BZR INI files');
      showToast(
        `Updated ${data.updatedFiles.join(', ')} with ${itemName}=${priceCp} (${pricePp.toLocaleString()} pp)!`
      );
      return;
    }

    // In Browser mode (Vercel), Chromium blocks direct writes to .ini files via FileSystemAccess API,
    // so we try direct write first and fall back to downloading the updated BZR_<char>_pq.proj.ini file.
    let wroteDirectly = false;
    if (browserDirHandleRef.current) {
      try {
        const dirHandle = browserDirHandleRef.current;
        for (const bzr of updatedBzrFiles) {
          if (!targetLower.has(bzr.traderName.toLowerCase())) continue;
          const fileHandle = await dirHandle.getFileHandle(bzr.fileName, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(serializeBzrIni(bzr.pricesByItemName));
          await writable.close();
        }
        wroteDirectly = true;
      } catch {
        wroteDirectly = false;
      }
    }

    if (wroteDirectly) {
      showToast(
        `Wrote ${itemName}=${priceCp} (${pricePp.toLocaleString()} pp) to ${
          targetTraderNames.length
        } BZR_*.ini file(s)!`
      );
      return;
    }

    // Trigger clean file download for each updated BZR_<char>_pq.proj.ini
    for (const bzr of updatedBzrFiles) {
      if (!targetLower.has(bzr.traderName.toLowerCase())) continue;
      const content = serializeBzrIni(bzr.pricesByItemName);
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = bzr.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
    showToast(
      `Updated ${itemName}=${priceCp} (${pricePp.toLocaleString()} pp) and downloaded updated BZR_*.ini file(s)!`
    );
  };

  const catalogList = useMemo(() => Object.values(catalogById), [catalogById]);

  const ownedItems: OwnedInventoryItem[] = useMemo(() => {
    if (inventories.length === 0) return [];
    return buildOwnedInventoryCatalog(
      inventories,
      bzrFiles,
      activeTraders,
      catalogById
    );
  }, [inventories, bzrFiles, activeTraders, catalogById]);

  const ownedByItemId = useMemo(() => {
    const map = new Map<number, OwnedInventoryItem>();
    for (const item of ownedItems) {
      map.set(item.itemId, item);
    }
    return map;
  }, [ownedItems]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Top Header & Navigation */}
      <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3">
          {/* Brand Title */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-500/40 bg-amber-500/15 text-amber-400 shadow">
              <Coins className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-extrabold tracking-tight text-amber-300">
                  PQ TRADER
                </h1>
                <span className="rounded border border-amber-500/30 bg-amber-950/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                  Planes of Power
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Project Quarm WTS / WTB / WTT Market Intelligence, PoP Parchment Swaps &amp; TAKP
                Bazaar Manager
              </p>
            </div>
          </div>

          {/* Primary Navigation Tabs */}
          <nav className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveTab('MARKET')}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition ${
                activeTab === 'MARKET'
                  ? 'bg-amber-500 text-slate-950 shadow'
                  : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Store className="h-4 w-4" />
              Market Explorer &amp; WTB/WTS
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('MY_ITEMS')}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition ${
                activeTab === 'MY_ITEMS'
                  ? 'bg-amber-500 text-slate-950 shadow'
                  : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <PackageSearch className="h-4 w-4" />
              My Items &amp; BZR Manager
              {ownedItems.length > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                    activeTab === 'MY_ITEMS'
                      ? 'bg-slate-950 text-amber-300'
                      : 'bg-emerald-950 text-emerald-300'
                  }`}
                >
                  {ownedItems.filter((i) => !i.nodrop).length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('SCRAPER')}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition ${
                activeTab === 'SCRAPER'
                  ? 'bg-amber-500 text-slate-950 shadow'
                  : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Radio className="h-4 w-4" />
              Discord Scraper &amp; Parser Lab
            </button>
          </nav>
        </div>
      </header>

      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-xl border border-amber-500/50 bg-slate-900/95 px-4 py-3 text-xs font-semibold text-amber-200 shadow-2xl">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Content Container */}
      <main className="mx-auto max-w-7xl px-4 py-6">
        {loadingCatalog ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Sparkles className="mb-3 h-8 w-8 animate-spin text-amber-400" />
            <div className="text-sm font-semibold text-slate-200">
              Loading 26,972 Project Quarm Items &amp; Drop Tables...
            </div>
          </div>
        ) : (
          <>
            {activeTab === 'MARKET' && (
              <MarketExplorer
                catalogList={catalogList}
                catalogById={catalogById}
                ownedByItemId={ownedByItemId}
                recentListings={recentListings}
                rollups={rollups}
                onRefreshMarket={fetchMarketData}
                onJumpToMyItem={(itemId) => {
                  setJumpToMyItemId(itemId);
                  setActiveTab('MY_ITEMS');
                }}
                onToast={showToast}
              />
            )}

            {activeTab === 'MY_ITEMS' && (
              <MyItemsTab
                catalogById={catalogById}
                inventories={inventories}
                bzrFiles={bzrFiles}
                ownedItems={ownedItems}
                activeTraders={activeTraders}
                folderMode={folderMode}
                folderLabel={folderLabel}
                rollups={rollups}
                initialSelectedItemId={jumpToMyItemId}
                onConnectBrowserFolder={handleConnectBrowserFolder}
                onUploadTakpFiles={handleUploadTakpFiles}
                onConnectLocalTakp={() => handleConnectLocalTakp(false)}
                onRescanFolder={handleRescanFolder}
                onToggleActiveTrader={handleToggleActiveTrader}
                onUpdateBzrFiles={handleUpdateBzrFiles}
                onRefreshMarket={fetchMarketData}
                onToast={showToast}
              />
            )}

            {activeTab === 'SCRAPER' && (
              <DiscordScraperTab
                onRefreshMarket={fetchMarketData}
                onToast={showToast}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
