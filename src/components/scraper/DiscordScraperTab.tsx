'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Radio,
  KeyRound,
  Plus,
  Trash2,
  Play,
  Square,
  History,
  FileUp,
  HelpCircle,
  CheckCircle2,
  XCircle,
  FlaskConical,
  UploadCloud,
  AlertCircle,
} from 'lucide-react';
import {
  parseAuctionMessage,
  ParsedListingCandidate,
  MaybeReviewCandidate,
  splitDiscordPasteIntoMessages,
} from '@/lib/parser/auctionParser';
import { CURRENCY_SHORT_LABELS, ParserReviewLog } from '@/types/pqtrader';

export interface DiscordChannelConfig {
  id: string;
  name: string;
  channelId: string;
  enabled: boolean;
}

const DEFAULT_CHANNELS: DiscordChannelConfig[] = [
  {
    id: 'ch-1',
    name: 'ingame-auctions',
    channelId: '1133452007412334642',
    enabled: true,
  },
  {
    id: 'ch-2',
    name: 'trade',
    channelId: '1133451958120878150',
    enabled: true,
  },
  {
    id: 'ch-3',
    name: 'ingame-general',
    channelId: '1133451899505479780',
    enabled: true,
  },
];

interface DiscordScraperTabProps {
  onRefreshMarket: () => Promise<void>;
  onToast: (msg: string) => void;
}

export const DiscordScraperTab: React.FC<DiscordScraperTabProps> = ({
  onRefreshMarket,
  onToast,
}) => {
  const [discordToken, setDiscordToken] = useState('');
  const [apiKey, setApiKey] = useState('pqtrader-dev-key-2026');
  const [channels, setChannels] = useState<DiscordChannelConfig[]>(DEFAULT_CHANNELS);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelId, setNewChannelId] = useState('');

  // Sub-tab selection
  const [activeSubTab, setActiveSubTab] = useState<'SANDBOX' | 'MAYBES' | 'LIVE_FEED'>('SANDBOX');

  // Gateway WebSocket Live Listener State
  const [wsConnected, setWsConnected] = useState(false);
  const [wsStatusText, setWsStatusText] = useState('Disconnected');
  const [autoIngestLive, setAutoIngestLive] = useState(true);
  const [liveListings, setLiveListings] = useState<ParsedListingCandidate[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const hbIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Backfill State
  const [selectedBackfillChannelId, setSelectedBackfillChannelId] = useState(
    DEFAULT_CHANNELS[0].channelId
  );
  const [backfillPages, setBackfillPages] = useState(3);
  const [runningBackfill, setRunningBackfill] = useState(false);
  const [backfillSummary, setBackfillSummary] = useState<{
    messagesFetched: number;
    noiseSkipped: number;
    extractedListingsCount: number;
    maybesCount: number;
    committedToDb: boolean;
  } | null>(null);

  // Sandbox State
  const [sandboxInput, setSandboxInput] = useState('');
  const [sandboxChannelName, setSandboxChannelName] = useState('ingame-auctions');
  const [pushingSandbox, setPushingSandbox] = useState(false);

  // Maybes Review Queue State
  const [reviewLogs, setReviewLogs] = useState<ParserReviewLog[]>([]);
  const [loadingReviewLogs, setLoadingReviewLogs] = useState(false);

  useEffect(() => {
    const savedToken = localStorage.getItem('pqtrader_discord_token');
    if (savedToken) setDiscordToken(savedToken);
    const savedKey = localStorage.getItem('pqtrader_ingest_api_key');
    if (savedKey) setApiKey(savedKey);
    const savedCh = localStorage.getItem('pqtrader_discord_channels');
    if (savedCh) {
      try {
        const parsed = JSON.parse(savedCh);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setChannels(parsed);
          setSelectedBackfillChannelId(parsed[0].channelId);
        }
      } catch {}
    }
    fetchReviewLogs();
    return () => {
      stopWebSocket();
    };
  }, []);

  const saveSettings = (
    nextToken = discordToken,
    nextKey = apiKey,
    nextChannels = channels
  ) => {
    localStorage.setItem('pqtrader_discord_token', nextToken);
    localStorage.setItem('pqtrader_ingest_api_key', nextKey);
    localStorage.setItem('pqtrader_discord_channels', JSON.stringify(nextChannels));
  };

  const fetchReviewLogs = async () => {
    setLoadingReviewLogs(true);
    try {
      const res = await fetch('/api/review-logs');
      const data = await res.json();
      if (data.logs) setReviewLogs(data.logs);
    } catch {
    } finally {
      setLoadingReviewLogs(false);
    }
  };

  // Evaluate Sandbox Lines Live
  const sandboxEvaluation = React.useMemo(() => {
    const logicalMessages = splitDiscordPasteIntoMessages(sandboxInput);

    const extracted: ParsedListingCandidate[] = [];
    const maybes: MaybeReviewCandidate[] = [];
    let noiseCount = 0;

    for (let i = 0; i < logicalMessages.length; i++) {
      const { content, author } = logicalMessages[i];
      const res = parseAuctionMessage(
        content,
        sandboxChannelName,
        author || 'DiscordUser',
        `sandbox-${i + 1}`
      );
      if (!res.isTradeRelated) {
        noiseCount++;
        continue;
      }
      extracted.push(...res.listings);
      if (res.maybeLog) {
        maybes.push(res.maybeLog);
      }
    }

    return {
      totalLines: logicalMessages.length,
      noiseCount,
      extracted,
      maybes,
    };
  }, [sandboxInput, sandboxChannelName]);

  const handlePushSandboxToApi = async () => {
    const logicalMessages = splitDiscordPasteIntoMessages(sandboxInput);
    if (logicalMessages.length === 0) return;

    setPushingSandbox(true);
    try {
      const rawMessages = logicalMessages.map((m, idx) => ({
        id: `batch-${Date.now()}-${idx}`,
        content: m.content,
        channelName: sandboxChannelName,
        author: m.author || 'DiscordScraper',
        timestamp: new Date().toISOString(),
      }));

      const res = await fetch('/api/ingest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({ rawMessages }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ingest API returned an error');

      onToast(
        `Ingested ${data.upsertedListings} listings (${data.noiseSkipped} noise skipped, ${data.loggedMaybes} Maybes logged)!`
      );
      await onRefreshMarket();
      await fetchReviewLogs();
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : 'Failed to push to Ingest API');
    } finally {
      setPushingSandbox(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    try {
      if (file.name.endsWith('.json')) {
        const parsed = JSON.parse(text);
        const arr = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed.messages)
          ? parsed.messages
          : [];
        const lines = arr
          .map((m: { content?: string }) => (m.content || '').trim())
          .filter(Boolean);
        setSandboxInput(lines.slice(0, 1000).join('\n'));
        onToast(
          `Loaded ${lines.length.toLocaleString()} messages from ${file.name} into Parser Lab!`
        );
      } else {
        setSandboxInput(text);
        onToast(`Loaded ${file.name} into Parser Lab!`);
      }
      setActiveSubTab('SANDBOX');
    } catch {
      onToast('Could not parse file as JSON; loaded as raw text.');
      setSandboxInput(text);
    }
  };

  // Live Discord Gateway WebSocket Listener
  const startWebSocket = () => {
    if (!discordToken.trim()) {
      onToast('Please enter your Discord User Token first.');
      return;
    }
    saveSettings();
    stopWebSocket();

    const enabledChannelMap = new Map<string, string>();
    for (const c of channels) {
      if (c.enabled && c.channelId.trim()) {
        enabledChannelMap.set(c.channelId.trim(), c.name);
      }
    }

    setWsStatusText('Connecting to wss://gateway.discord.gg...');
    const ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      setWsStatusText(`Connected — watching ${enabledChannelMap.size} channel(s)`);
    };

    ws.onmessage = async (event) => {
      try {
        const payload = JSON.parse(event.data);
        const { op, d, t } = payload;

        // OP 10: Hello -> start heartbeat & send OP 2 Identify
        if (op === 10 && d?.heartbeat_interval) {
          if (hbIntervalRef.current) clearInterval(hbIntervalRef.current);
          hbIntervalRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ op: 1, d: null }));
            }
          }, d.heartbeat_interval);

          ws.send(
            JSON.stringify({
              op: 2,
              d: {
                token: discordToken.trim(),
                capabilities: 16381,
                properties: {
                  os: 'Windows',
                  browser: 'Chrome',
                  device: '',
                },
              },
            })
          );
        }

        // Dispatch MESSAGE_CREATE
        if (t === 'MESSAGE_CREATE' && d?.channel_id) {
          const chName = enabledChannelMap.get(String(d.channel_id));
          if (!chName) return;

          const content = String(d.content || '').trim();
          const author = d.author?.global_name || d.author?.username || 'DiscordUser';
          const msgId = String(d.id || '');
          const parsed = parseAuctionMessage(content, chName, author, msgId);

          if (parsed.listings.length > 0) {
            setLiveListings((prev) => [...parsed.listings, ...prev].slice(0, 100));
          }

          if (autoIngestLive && parsed.isTradeRelated) {
            await fetch('/api/ingest', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
              },
              body: JSON.stringify({
                rawMessages: [
                  {
                    id: msgId,
                    content,
                    channelName: chName,
                    author,
                    timestamp: d.timestamp || new Date().toISOString(),
                  },
                ],
              }),
            });
            await onRefreshMarket();
          }
        }
      } catch {}
    };

    ws.onerror = () => {
      setWsStatusText('WebSocket error — verify token & network');
    };

    ws.onclose = () => {
      setWsConnected(false);
      setWsStatusText('Disconnected');
      if (hbIntervalRef.current) clearInterval(hbIntervalRef.current);
    };
  };

  const stopWebSocket = () => {
    if (hbIntervalRef.current) {
      clearInterval(hbIntervalRef.current);
      hbIntervalRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setWsConnected(false);
    setWsStatusText('Disconnected');
  };

  const handleRunBackfill = async (commitToDb: boolean) => {
    if (!discordToken.trim()) {
      onToast('Enter your Discord Token to fetch channel history.');
      return;
    }
    saveSettings();
    const chObj = channels.find((c) => c.channelId === selectedBackfillChannelId);
    const channelName = chObj?.name || 'ingame-auctions';

    setRunningBackfill(true);
    try {
      const res = await fetch('/api/discord-backfill', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          discordToken: discordToken.trim(),
          channelId: selectedBackfillChannelId,
          channelName,
          maxPages: backfillPages,
          commitToDb,
          apiKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Backfill failed');

      setBackfillSummary({
        messagesFetched: data.messagesFetched,
        noiseSkipped: data.noiseSkipped,
        extractedListingsCount: data.extractedListingsCount,
        maybesCount: data.maybesCount,
        committedToDb: data.committedToDb,
      });

      if (Array.isArray(data.sampleListings)) {
        setLiveListings(data.sampleListings);
      }

      onToast(
        `Scanned ${data.messagesFetched} Discord messages from #${channelName}: ${data.extractedListingsCount} listings extracted, ${data.maybesCount} Maybes!`
      );
      if (commitToDb) {
        await onRefreshMarket();
        await fetchReviewLogs();
      }
    } catch (err: unknown) {
      onToast(err instanceof Error ? err.message : 'Backfill failed');
    } finally {
      setRunningBackfill(false);
    }
  };

  const handleAddChannel = () => {
    if (!newChannelName.trim() || !newChannelId.trim()) return;
    const next: DiscordChannelConfig[] = [
      ...channels,
      {
        id: `ch-${Date.now()}`,
        name: newChannelName.trim().replace(/^#/, ''),
        channelId: newChannelId.trim(),
        enabled: true,
      },
    ];
    setChannels(next);
    saveSettings(discordToken, apiKey, next);
    setNewChannelName('');
    setNewChannelId('');
    onToast('Added Discord channel to scraper list.');
  };

  const handleUpdateReviewLog = async (
    id: number,
    status: 'RESOLVED' | 'IGNORED'
  ) => {
    await fetch('/api/review-logs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    await fetchReviewLogs();
  };

  return (
    <div className="space-y-6">
      {/* Top Configuration Card: Discord Token, API Key & Editable Channels */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left 6 cols: Credentials & Live Gateway Controls */}
        <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/90 p-4 shadow lg:col-span-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-amber-400" />
              <h2 className="text-base font-bold text-slate-100">
                Discord Token &amp; Authorized Ingest API Key
              </h2>
            </div>
            <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-400">
              Saved in Browser localStorage Only
            </span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                Personal Discord Token (Local Browser Only)
              </label>
              <input
                type="password"
                value={discordToken}
                onChange={(e) => {
                  setDiscordToken(e.target.value);
                  saveSettings(e.target.value, apiKey, channels);
                }}
                placeholder="Paste Discord authorization token..."
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-300">
                PQ Trader Ingest API Key (<code className="text-amber-300">x-api-key</code>)
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  saveSettings(discordToken, e.target.value, channels);
                }}
                placeholder="pqtrader-dev-key-2026"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Live WebSocket Listener & Backfill Controls */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs">
                <Radio
                  className={`h-4 w-4 ${
                    wsConnected ? 'animate-pulse text-emerald-400' : 'text-slate-500'
                  }`}
                />
                <span className="font-semibold text-slate-200">
                  Live Gateway Listener:
                </span>
                <span
                  className={wsConnected ? 'text-emerald-400 font-medium' : 'text-slate-400'}
                >
                  {wsStatusText}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={autoIngestLive}
                    onChange={(e) => setAutoIngestLive(e.target.checked)}
                    className="rounded border-slate-600 text-amber-500"
                  />
                  Auto-push to DB
                </label>

                {!wsConnected ? (
                  <button
                    type="button"
                    onClick={startWebSocket}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500"
                  >
                    <Play className="h-3.5 w-3.5" /> Start Live Listener
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopWebSocket}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-500"
                  >
                    <Square className="h-3.5 w-3.5" /> Stop
                  </button>
                )}
              </div>
            </div>

            {/* Historical Channel Backfill Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <History className="h-4 w-4 text-sky-400" />
                <span className="font-semibold text-slate-300">Backfill Channel:</span>
                <select
                  value={selectedBackfillChannelId}
                  onChange={(e) => setSelectedBackfillChannelId(e.target.value)}
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                >
                  {channels.map((c) => (
                    <option key={c.id} value={c.channelId}>
                      #{c.name} ({c.channelId})
                    </option>
                  ))}
                </select>
                <select
                  value={backfillPages}
                  onChange={(e) => setBackfillPages(Number(e.target.value))}
                  className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                >
                  <option value={1}>Last 100 msgs</option>
                  <option value={5}>Last 500 msgs</option>
                  <option value={10}>Last 1,000 msgs</option>
                  <option value={25}>Last 2,500 msgs (~1 mo)</option>
                </select>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={runningBackfill}
                  onClick={() => handleRunBackfill(false)}
                  className="rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                >
                  Dry Run
                </button>
                <button
                  type="button"
                  disabled={runningBackfill}
                  onClick={() => handleRunBackfill(true)}
                  className="rounded bg-sky-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-50"
                >
                  {runningBackfill ? 'Fetching...' : 'Fetch & Seed DB'}
                </button>
              </div>
            </div>

            {backfillSummary && (
              <div className="rounded bg-slate-900 px-3 py-2 text-[11px] text-slate-300">
                Backfill Result: Scanned <strong>{backfillSummary.messagesFetched}</strong> msgs ·
                Skipped <strong>{backfillSummary.noiseSkipped}</strong> noise · Extracted{' '}
                <strong className="text-emerald-400">
                  {backfillSummary.extractedListingsCount}
                </strong>{' '}
                listings · Logged{' '}
                <strong className="text-amber-300">{backfillSummary.maybesCount}</strong> Maybes
                {backfillSummary.committedToDb ? ' (Saved to DB)' : ' (Dry Run)'}
              </div>
            )}
          </div>
        </div>

        {/* Right 6 cols: Configurable Target Discord Channels */}
        <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/90 p-4 shadow lg:col-span-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-100">
                Configurable Discord Channels
              </h2>
              <p className="text-xs text-slate-400">
                Pre-configured for Project Quarm&apos;s <code className="text-amber-300">#ingame-auctions</code>,{' '}
                <code className="text-amber-300">#trade</code>, and{' '}
                <code className="text-amber-300">#ingame-general</code>. You can edit IDs or add
                channels from any server.
              </p>
            </div>
          </div>

          <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
            {channels.map((ch) => (
              <div
                key={ch.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs"
              >
                <label className="flex items-center gap-2 font-medium text-slate-200">
                  <input
                    type="checkbox"
                    checked={ch.enabled}
                    onChange={() => {
                      const next = channels.map((c) =>
                        c.id === ch.id ? { ...c, enabled: !c.enabled } : c
                      );
                      setChannels(next);
                      saveSettings(discordToken, apiKey, next);
                    }}
                    className="rounded border-slate-600 text-amber-500"
                  />
                  <span className="font-bold text-amber-300">#{ch.name}</span>
                </label>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={ch.channelId}
                    onChange={(e) => {
                      const next = channels.map((c) =>
                        c.id === ch.id ? { ...c, channelId: e.target.value } : c
                      );
                      setChannels(next);
                      saveSettings(discordToken, apiKey, next);
                    }}
                    className="w-44 rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-slate-200"
                    placeholder="Discord Channel ID"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const next = channels.filter((c) => c.id !== ch.id);
                      setChannels(next);
                      saveSettings(discordToken, apiKey, next);
                    }}
                    className="rounded p-1 text-slate-500 hover:bg-rose-950/50 hover:text-rose-400"
                    title="Remove channel"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Add New Channel Row */}
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 pt-2.5">
            <input
              type="text"
              value={newChannelName}
              onChange={(e) => setNewChannelName(e.target.value)}
              placeholder="Channel label (e.g. custom-auctions)"
              className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100"
            />
            <input
              type="text"
              value={newChannelId}
              onChange={(e) => setNewChannelId(e.target.value)}
              placeholder="Channel ID (e.g. 123456789012345678)"
              className="w-48 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-slate-100"
            />
            <button
              type="button"
              onClick={handleAddChannel}
              className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400"
            >
              <Plus className="h-3.5 w-3.5" /> Add Channel
            </button>
          </div>
        </div>
      </div>

      {/* Sub-Tabs Navigation: Parser Sandbox / Export Importer | "Maybes" Review Queue | Live Feed */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setActiveSubTab('SANDBOX')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold transition ${
              activeSubTab === 'SANDBOX'
                ? 'bg-amber-500 text-slate-950'
                : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <FlaskConical className="h-4 w-4" />
            Parser Lab &amp; 1-Month Export Seeder
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveSubTab('MAYBES');
              fetchReviewLogs();
            }}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold transition ${
              activeSubTab === 'MAYBES'
                ? 'bg-amber-500 text-slate-950'
                : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <HelpCircle className="h-4 w-4" />
            &ldquo;Maybes&rdquo; Review Queue ({
              reviewLogs.filter((r) => r.status === 'PENDING').length
            }{' '}
            Pending)
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('LIVE_FEED')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-bold transition ${
              activeSubTab === 'LIVE_FEED'
                ? 'bg-amber-500 text-slate-950'
                : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Radio className="h-4 w-4" />
            Live / Backfilled Listings ({liveListings.length})
          </button>
        </div>

        {/* Upload 1-Month Export File Shortcut */}
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-xs font-semibold text-sky-300 hover:bg-sky-500/25">
          <FileUp className="h-4 w-4" />
          Load Discord Export (.json / .txt)
          <input
            type="file"
            accept=".json,.txt,.log,.csv"
            onChange={handleFileUpload}
            className="hidden"
          />
        </label>
      </div>

      {/* SUB-TAB 1: PARSER LAB & BATCH SEEDER */}
      {activeSubTab === 'SANDBOX' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/80 p-4 lg:col-span-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Raw Discord / EQ Auction Messages (One per line)
              </span>
              <select
                value={sandboxChannelName}
                onChange={(e) => setSandboxChannelName(e.target.value)}
                className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
              >
                {channels.map((c) => (
                  <option key={c.id} value={c.name}>
                    Source: #{c.name}
                  </option>
                ))}
              </select>
            </div>

            <textarea
              rows={12}
              value={sandboxInput}
              onChange={(e) => setSandboxInput(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
              placeholder="Paste Discord messages or load a 1-month channel export..."
            />

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex gap-3 text-slate-400">
                <span>
                  Lines: <strong className="text-slate-200">{sandboxEvaluation.totalLines}</strong>
                </span>
                <span>
                  Noise Ignored:{' '}
                  <strong className="text-slate-300">{sandboxEvaluation.noiseCount}</strong>
                </span>
                <span>
                  Parsed:{' '}
                  <strong className="text-emerald-400">
                    {sandboxEvaluation.extracted.length}
                  </strong>
                </span>
                <span>
                  Maybes:{' '}
                  <strong className="text-amber-300">
                    {sandboxEvaluation.maybes.length}
                  </strong>
                </span>
              </div>

              <button
                type="button"
                disabled={pushingSandbox}
                onClick={handlePushSandboxToApi}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                <UploadCloud className="h-4 w-4" />
                {pushingSandbox
                  ? 'Ingesting...'
                  : `Ingest ${sandboxEvaluation.extracted.length} Listings & ${sandboxEvaluation.maybes.length} Maybes to DB`}
              </button>
            </div>
          </div>

          {/* Live Evaluation Preview */}
          <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/80 p-4 lg:col-span-6">
            <div>
              <div className="mb-2 text-xs font-bold uppercase tracking-wider text-emerald-400">
                High-Confidence Extracted Listings ({sandboxEvaluation.extracted.length})
              </div>
              <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                {sandboxEvaluation.extracted.map((l, idx) => (
                  <div
                    key={`${l.itemId}-${idx}`}
                    title={l.rawMessage}
                    className="group relative flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/80 p-2.5 text-xs transition hover:border-amber-500/50"
                  >
                    {l.rawMessage && (
                      <div
                        className={`pointer-events-none invisible absolute left-2 right-2 z-30 rounded-lg border border-amber-500/40 bg-slate-950/95 p-2.5 shadow-xl backdrop-blur-sm group-hover:visible ${
                          idx === 0 ? 'top-full mt-1' : 'bottom-full mb-1'
                        }`}
                      >
                        <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-amber-400">
                          Source Message
                        </div>
                        <div className="whitespace-pre-wrap break-words font-mono text-[11px] text-slate-100">
                          {l.rawMessage}
                        </div>
                      </div>
                    )}
                    <div>
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
                        <span className="font-bold text-amber-200">{l.itemName}</span>
                        <span className="font-mono text-[10px] text-slate-400">
                          item:{String(l.itemId).padStart(7, '0')}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-400">
                        player: <strong className="text-slate-200">{l.actorName}</strong>
                        {l.tradeMetadata ? ` · metadata: "${l.tradeMetadata}"` : ''}
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="rounded bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-300">
                        {l.currencyType === 'PP'
                          ? l.pricePp
                            ? `${l.pricePp.toLocaleString()} pp`
                            : 'No Price Listed'
                          : `${l.priceQuantity}x ${CURRENCY_SHORT_LABELS[l.currencyType]}`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {sandboxEvaluation.maybes.length > 0 && (
              <div className="border-t border-slate-800 pt-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-300">
                  <AlertCircle className="h-4 w-4" />
                  Routed to &ldquo;Maybes&rdquo; Queue ({sandboxEvaluation.maybes.length})
                </div>
                <div className="space-y-1.5">
                  {sandboxEvaluation.maybes.map((m, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-amber-500/30 bg-amber-950/20 p-2 text-xs text-amber-200"
                    >
                      <div className="font-semibold">
                        [{m.authorName}] {m.rawMessage}
                      </div>
                      <div className="text-[11px] text-slate-400">Reason: {m.reason}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 2: "MAYBES" REVIEW QUEUE */}
      {activeSubTab === 'MAYBES' && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-amber-300">
                Ambiguous / Unrecognized Trade Messages (&ldquo;Maybes&rdquo; Queue)
              </h3>
              <p className="text-xs text-slate-400">
                Messages with <code className="text-amber-300">WTS</code>,{' '}
                <code className="text-amber-300">WTB</code>, or{' '}
                <code className="text-amber-300">WTT</code> that didn&apos;t match a known tradeable
                item cleanly are quarantined here instead of polluting live prices.
              </p>
            </div>
          </div>

          {loadingReviewLogs ? (
            <div className="py-8 text-center text-xs text-slate-400">
              Loading review logs...
            </div>
          ) : reviewLogs.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">
              No review logs in the queue.
            </div>
          ) : (
            <div className="space-y-2">
              {reviewLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                          log.status === 'PENDING'
                            ? 'bg-amber-950 text-amber-300'
                            : log.status === 'RESOLVED'
                            ? 'bg-emerald-950 text-emerald-300'
                            : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {log.status}
                      </span>
                      <span className="font-bold text-slate-200">{log.authorName}</span>
                      <span className="text-slate-500">in #{log.channelName}</span>
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                        {log.reason}
                      </span>
                    </div>
                    <div className="font-mono text-slate-100">{log.rawMessage}</div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setSandboxInput(log.rawMessage);
                        setActiveSubTab('SANDBOX');
                      }}
                      className="rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:border-amber-500/40"
                    >
                      Test in Sandbox
                    </button>
                    {log.status === 'PENDING' && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleUpdateReviewLog(log.id, 'RESOLVED')}
                          className="inline-flex items-center gap-1 rounded bg-emerald-950/80 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-900"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUpdateReviewLog(log.id, 'IGNORED')}
                          className="inline-flex items-center gap-1 rounded bg-rose-950/80 px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-900"
                        >
                          <XCircle className="h-3.5 w-3.5" /> Ignore
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 3: LIVE / BACKFILLED FEED */}
      {activeSubTab === 'LIVE_FEED' && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-bold text-slate-200">
              Session Extracted Listings ({liveListings.length})
            </span>
            <span className="text-xs text-slate-400">
              Hover any row to inspect the original plain-text Discord message
            </span>
          </div>
          {liveListings.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">
              Start the Live Gateway Listener or run a Channel Backfill above to see incoming
              Discord listings here.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
              {liveListings.map((l, idx) => (
                <div
                  key={idx}
                  title={l.rawMessage || ''}
                  className="group relative flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs transition hover:border-amber-500/50"
                >
                  {l.rawMessage && (
                    <div
                      className={`pointer-events-none invisible absolute left-2 right-2 z-30 rounded-lg border border-amber-500/40 bg-slate-950/95 p-2.5 shadow-xl backdrop-blur-sm group-hover:visible ${
                        idx === 0 ? 'top-full mt-1' : 'bottom-full mb-1'
                      }`}
                    >
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-amber-400">
                        Source Message
                      </div>
                      <div className="whitespace-pre-wrap break-words font-mono text-[11px] text-slate-100">
                        {l.rawMessage}
                      </div>
                    </div>
                  )}
                  <div>
                    <span className="font-bold text-amber-300">{l.listingType}</span>{' '}
                    <span className="font-semibold text-slate-100">{l.itemName}</span> (#{l.itemId})
                    by <strong className="text-emerald-300">{l.actorName}</strong>
                    {l.tradeMetadata ? ` — ${l.tradeMetadata}` : ''}
                  </div>
                  <div className="font-semibold text-amber-200">
                    {l.currencyType === 'PP'
                      ? l.pricePp
                        ? `${l.pricePp.toLocaleString()} pp`
                        : 'No Price Listed'
                      : `${l.priceQuantity}x ${CURRENCY_SHORT_LABELS[l.currencyType]}`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
