import React, { useState } from 'react';
import {
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  FileUp,
  History,
  Loader2,
  Pencil,
  Play,
  Plus,
  Server,
  ShieldCheck,
  Sliders,
  Trash2,
  Zap,
} from 'lucide-react';
import type { StoredChannel, StoredPlaylistSource } from '../../db/lumaDb';
import { getChannelProgramsInRange } from '../../data/mockCatalog';
import {
  isLocalRustProxyEndpoint,
  probeCorsStreamProxy,
} from '../../engine/corsProxy';
import type {
  LumaSyncPlainPayload,
  WatchHistoryEntry,
} from '../../services/lumaCloudSync';
import type { IngestProgressState } from '../../services/playlistService';
import type {
  Channel,
  EngineProxyConfig,
  EpgProgram,
  PlatformDesignMode,
  VodItem,
} from '../../types/luma';
import { Phase4PlatformSyncPanel } from './Phase4PlatformSyncPanel';

interface VodViewProps {
  designMode: PlatformDesignMode;
  vodCatalog: VodItem[];
  onPlayVod: (vod: VodItem) => void;
  onInspectVod?: (vod: VodItem) => void;
}

export const VodCatalogView: React.FC<VodViewProps> = ({
  designMode,
  vodCatalog,
  onPlayVod,
  onInspectVod,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const cardSurface = isM3
    ? 'rounded-[28px] bg-[#1A202E] hover:bg-[#232B3D]'
    : 'lg-pane rounded-[24px] hover:ring-1 hover:ring-white/30';

  return (
    <div className="luma-scroll flex-1 overflow-y-auto p-5">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-white">Cinema VOD &amp; 4K Referenz-Master</h2>
        <p className="text-xs text-slate-400">
          Direkt abspielbare HLS- &amp; importierte M3U/Xtream-VOD-Master inkl. TMDB-Metadaten &amp; Trailer.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {vodCatalog.map((vod) => (
          <div
            key={vod.id}
            onClick={() => onPlayVod(vod)}
            className={`group flex cursor-pointer flex-col justify-between overflow-hidden transition duration-200 hover:-translate-y-0.5 ${cardSurface}`}
          >
            <div
              className="relative flex h-36 flex-col justify-between p-4"
              style={{
                background: `linear-gradient(135deg, ${vod.accentFrom}55 0%, ${vod.accentTo}BB 100%)`,
              }}
            >
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-black/55 px-2.5 py-0.5 text-[10px] font-semibold text-sky-200">
                  {vod.resolution} · {vod.codec}
                </span>
                <span className="rounded-full bg-black/55 px-2.5 py-0.5 text-[10px] font-semibold text-amber-300 luma-tabular">
                  ★ {vod.rating}
                </span>
              </div>

              <div className="flex items-end justify-between gap-2">
                <div>
                  <div className="text-[11px] font-medium text-sky-200/90">{vod.genre}</div>
                  <h3 className="text-sm font-semibold text-white">{vod.title}</h3>
                </div>
                <span
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full shadow-lg transition group-hover:scale-105 ${
                    isM3 ? 'm3-primary-pill' : 'lg-pill-active'
                  }`}
                >
                  <Play className="h-4 w-4 fill-current" />
                </span>
              </div>
            </div>

            <div className="p-4">
              <p className="line-clamp-2 text-xs leading-relaxed text-slate-300">{vod.synopsis}</p>
              <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400 luma-tabular">
                <span>
                  Jahr {vod.year} · {vod.durationMin} Min.
                </span>
                {onInspectVod && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onInspectVod(vod);
                    }}
                    className="rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-semibold text-sky-300 hover:bg-sky-400/25 hover:text-white"
                  >
                    Cast &amp; Trailer
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

interface CatchupViewProps {
  designMode: PlatformDesignMode;
  channels: Channel[];
  nowMs: number;
  onStartTimeshift: (channel: Channel, program: EpgProgram) => void;
}

export const CatchupArchiveView: React.FC<CatchupViewProps> = ({
  designMode,
  channels,
  nowMs,
  onStartTimeshift,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const catchupChannels = channels.slice(0, 8).filter((c) => c.hasCatchup);
  const fmt = (ms: number) =>
    new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(ms);

  return (
    <div className="luma-scroll flex-1 overflow-y-auto p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold text-white">Xtream Catch-Up &amp; Timeshift Archiv</h2>
        <p className="text-xs text-slate-400">
          Vergangene Sendungen direkt aus dem Cloud-Archiv abspielen.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        {catchupChannels.map((ch) => {
          const pastPrograms = getChannelProgramsInRange(
            ch,
            nowMs - 5 * 3600_000,
            nowMs - 5 * 60_000,
            nowMs
          )
            .filter((p) => p.endMs <= nowMs)
            .slice(-3)
            .reverse();

          return (
            <div
              key={ch.id}
              className={
                isM3
                  ? 'rounded-[28px] bg-[#1A202E] p-4'
                  : 'lg-pane rounded-[24px] p-4'
              }
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-11 items-center justify-center rounded-full bg-white/10 text-[11px] font-bold text-sky-300">
                    {ch.shortCode}
                  </span>
                  <div>
                    <h3 className="text-xs font-semibold text-white">{ch.name}</h3>
                    <span className="text-[10px] text-slate-400 luma-tabular">
                      {ch.catchupDays} Tage Rückschau-Puffer aktiv
                    </span>
                  </div>
                </div>
                <History className="h-4 w-4 text-sky-400" />
              </div>

              <div className="space-y-1.5">
                {pastPrograms.map((prog) => (
                  <button
                    key={prog.id}
                    type="button"
                    onClick={() => onStartTimeshift(ch, prog)}
                    className={`flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition ${
                      isM3
                        ? 'rounded-full bg-[#232B3D] hover:bg-[#2E384F]'
                        : 'lg-capsule rounded-[16px]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-white">
                        {prog.title}
                      </div>
                      <div className="truncate text-[10px] text-slate-300/80 luma-tabular">
                        {fmt(prog.startMs)} – {fmt(prog.endMs)} · {prog.subtitle}
                      </div>
                    </div>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-[10px] font-bold ${
                        isM3 ? 'm3-primary-pill' : 'lg-pill-active'
                      }`}
                    >
                      <Play className="h-3 w-3" />
                      Re-Live
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

interface SourcesEngineViewProps {
  designMode: PlatformDesignMode;
  activeSourceId: string;
  persistedSources: StoredPlaylistSource[];
  storedChannelsForActive: StoredChannel[];
  ingestState: IngestProgressState;
  onSelectSourceId: (sourceId: string) => void;
  onDeleteSource: (sourceId: string) => void;
  onRunWorkerDemoImport: () => void;
  onImportM3u: (params: {
    name: string;
    url?: string;
    rawText?: string;
    xmltvUrl?: string;
  }) => void;
  onImportXtream: (params: {
    name: string;
    serverUrl: string;
    username: string;
    password: string;
    outputFormat: 'm3u8' | 'ts';
  }) => void;
  onUploadXmltvBuffer: (buffer: ArrayBuffer) => void;
  onRenameChannel: (channelId: string, nextName: string) => void;
  onToggleHideChannel: (channelId: string, hidden: boolean) => void;
  epgOffsetHours: number;
  onChangeEpgOffset: (hours: number) => void;
  proxyConfig: EngineProxyConfig;
  onChangeProxyConfig: (next: EngineProxyConfig) => void;
  localRustProxyUrl?: string | null;
  favoriteIds: Set<string>;
  watchHistory: WatchHistoryEntry[];
  onRestoreFromSync: (payload: LumaSyncPlainPayload) => void;
}

export const SourcesEngineView: React.FC<SourcesEngineViewProps> = ({
  designMode,
  activeSourceId,
  persistedSources,
  storedChannelsForActive,
  ingestState,
  onSelectSourceId,
  onDeleteSource,
  onRunWorkerDemoImport,
  onImportM3u,
  onImportXtream,
  onUploadXmltvBuffer,
  onRenameChannel,
  onToggleHideChannel,
  epgOffsetHours,
  onChangeEpgOffset,
  proxyConfig,
  onChangeProxyConfig,
  localRustProxyUrl = null,
  favoriteIds,
  watchHistory,
  onRestoreFromSync,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const panelClass = isM3 ? 'rounded-[28px] bg-[#1A202E] p-5' : 'lg-pane rounded-[24px] p-5';
  const inputClass = isM3
    ? 'h-9 w-full rounded-full bg-[#232B3D] px-4 text-xs text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#7FD4FF]/60'
    : 'lg-capsule h-9 w-full rounded-full px-4 text-xs text-white placeholder:text-white/45 focus:outline-none';

  const [tab, setTab] = useState<'m3u' | 'xtream'>('m3u');

  // M3U form state
  const [m3uName, setM3uName] = useState('');
  const [m3uUrl, setM3uUrl] = useState('');
  const [m3uXmltvUrl, setM3uXmltvUrl] = useState('');
  const [m3uRawText, setM3uRawText] = useState('');

  // Xtream form state
  const [xtName, setXtName] = useState('');
  const [xtServer, setXtServer] = useState('');
  const [xtUser, setXtUser] = useState('');
  const [xtPass, setXtPass] = useState('');
  const [xtFormat, setXtFormat] = useState<'m3u8' | 'ts'>('m3u8');

  // Channel organization editing
  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [proxyProbeMsg, setProxyProbeMsg] = useState<string>('');

  const handleM3uFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    onImportM3u({
      name: m3uName.trim() || file.name.replace(/\.(m3u8?|txt)$/i, ''),
      rawText: text,
      xmltvUrl: m3uXmltvUrl,
    });
    e.target.value = '';
  };

  const handleXmltvFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    onUploadXmltvBuffer(buf);
    e.target.value = '';
  };

  return (
    <div className="luma-scroll flex-1 overflow-y-auto p-5 space-y-5">
      {/* Header + 1-Click End-to-End Worker + IndexedDB Demo */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">
            Phase 2 · WebWorker Ingest-Engine &amp; Dexie IndexedDB
          </h2>
          <p className="text-xs text-slate-400">
            Hintergrund-Parsing für M3U_Plus, Xtream Codes API und komprimiertes{' '}
            <code className="text-sky-300">.xml.gz</code> XMLTV ohne Main-Thread-Blockade.
          </p>
        </div>

        <button
          id="btn-worker-demo-import"
          type="button"
          disabled={ingestState.active}
          onClick={onRunWorkerDemoImport}
          className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold shadow-lg disabled:opacity-50 ${
            isM3 ? 'm3-primary-pill' : 'lg-pill-active'
          }`}
        >
          <Zap className="h-4 w-4" />
          <span>M3U_Plus + XMLTV.gz Worker-Import testen</span>
        </button>
      </div>

      {/* Live WebWorker Progress Banner */}
      {(ingestState.active || ingestState.lastSummary || ingestState.error) && (
        <div
          className={`p-4 ${
            isM3 ? 'rounded-[24px] bg-[#232B3D]' : 'lg-capsule rounded-[20px]'
          }`}
        >
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 font-semibold text-white">
              {ingestState.active ? (
                <Loader2 className="h-4 w-4 animate-spin text-sky-300" />
              ) : (
                <Database className="h-4 w-4 text-emerald-400" />
              )}
              <span>
                {ingestState.error
                  ? `Fehler: ${ingestState.error}`
                  : ingestState.active
                    ? ingestState.phase
                    : ingestState.lastSummary}
              </span>
            </span>
            {ingestState.active && (
              <span className="font-mono text-sky-300 luma-tabular">{ingestState.percent}%</span>
            )}
          </div>
          {ingestState.active && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-black/35">
              <div
                className="luma-accent-gradient h-full transition-all duration-200"
                style={{ width: `${ingestState.percent}%` }}
              />
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Left Column: Multi-Playlist Switcher (IndexedDB Persisted) */}
        <div className={`${panelClass} space-y-3`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white">
              Aktive Playlists (IndexedDB Persistenz)
            </span>
            <span className="rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-300 luma-tabular">
              {persistedSources.length + 1} Quellen
            </span>
          </div>

          {/* Built-in Reference Showcase */}
          <div
            onClick={() => onSelectSourceId('builtin-reference')}
            className={`cursor-pointer p-3.5 transition ${
              isM3 ? 'rounded-[20px]' : 'rounded-[18px]'
            } ${
              activeSourceId === 'builtin-reference'
                ? isM3
                  ? 'm3-tonal-active ring-1 ring-[#7FD4FF]/60'
                  : 'lg-pill-active'
                : isM3
                  ? 'bg-[#232B3D] hover:bg-[#2E384F]'
                  : 'lg-capsule'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white">
                Luma Reference Broadcast (Built-in)
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-sky-300">
                <CheckCircle2 className="h-3 w-3" />
                DEMO
              </span>
            </div>
            <div className="mt-1 text-[11px] opacity-80 luma-tabular">
              2.400 / 20.400 Referenz-Kanäle · 6 VOD Master
            </div>
          </div>

          {/* IndexedDB Stored Playlists */}
          {persistedSources.map((src) => {
            const isActive = activeSourceId === src.id;
            return (
              <div
                key={src.id}
                onClick={() => onSelectSourceId(src.id)}
                className={`cursor-pointer p-3.5 transition ${
                  isM3 ? 'rounded-[20px]' : 'rounded-[18px]'
                } ${
                  isActive
                    ? isM3
                      ? 'm3-tonal-active ring-1 ring-[#7FD4FF]/60'
                      : 'lg-pill-active'
                    : isM3
                      ? 'bg-[#232B3D] hover:bg-[#2E384F]'
                      : 'lg-capsule'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold text-white">{src.name}</span>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <span className="text-[10px] font-bold uppercase text-sky-300">
                      {src.type}
                    </span>
                    <button
                      type="button"
                      onClick={() => onDeleteSource(src.id)}
                      className="rounded-full p-1 text-slate-300 hover:bg-rose-500/25 hover:text-rose-200"
                      title="Playlist aus IndexedDB löschen"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px] opacity-75">
                  {src.endpoint}
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px] opacity-80 luma-tabular">
                  <span>
                    {src.channelCount.toLocaleString('de-DE')} Kanäle · {src.vodCount} VOD
                  </span>
                  <span>{src.lastUpdated}</span>
                </div>
              </div>
            );
          })}

          {/* Upload Extra XMLTV (.xml / .xml.gz) for Active Persisted Source */}
          {activeSourceId !== 'builtin-reference' && (
            <div className="pt-2">
              <label
                className={`inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold ${
                  isM3 ? 'm3-secondary-tonal' : 'lg-capsule text-white'
                }`}
              >
                <FileUp className="h-3.5 w-3.5 text-sky-300" />
                <span>XMLTV (.xml / .xml.gz) Datei für aktive Playlist laden</span>
                <input
                  type="file"
                  accept=".xml,.gz"
                  onChange={handleXmltvFileUpload}
                  className="hidden"
                />
              </label>
            </div>
          )}
        </div>

        {/* Right Column: Add New M3U_Plus or Xtream Codes Source */}
        <div className={`${panelClass} space-y-3.5`}>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-semibold text-white">
              <Plus className="h-4 w-4 text-sky-400" />
              <span>Neue Quelle verbinden</span>
            </span>

            <div
              className={`flex rounded-full p-0.5 ${
                isM3 ? 'bg-[#232B3D]' : 'lg-capsule'
              }`}
            >
              <button
                type="button"
                onClick={() => setTab('m3u')}
                className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                  tab === 'm3u'
                    ? isM3
                      ? 'bg-[#7FD4FF] text-[#00354A]'
                      : 'lg-pill-active'
                    : 'text-slate-300'
                }`}
              >
                M3U / M3U_Plus
              </button>
              <button
                type="button"
                onClick={() => setTab('xtream')}
                className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                  tab === 'xtream'
                    ? isM3
                      ? 'bg-[#7FD4FF] text-[#00354A]'
                      : 'lg-pill-active'
                    : 'text-slate-300'
                }`}
              >
                Xtream Codes API
              </button>
            </div>
          </div>

          {tab === 'm3u' ? (
            <div className="space-y-2.5">
              <input
                type="text"
                value={m3uName}
                onChange={(e) => setM3uName(e.target.value)}
                placeholder="Playlist-Name (z.B. Heim-IPTV HD)"
                className={inputClass}
              />
              <input
                type="url"
                value={m3uUrl}
                onChange={(e) => setM3uUrl(e.target.value)}
                placeholder="M3U / M3U_Plus URL (https://…/playlist.m3u8)"
                className={inputClass}
              />
              <input
                type="url"
                value={m3uXmltvUrl}
                onChange={(e) => setM3uXmltvUrl(e.target.value)}
                placeholder="Optional: XMLTV URL (.xml oder .xml.gz)"
                className={inputClass}
              />
              <textarea
                rows={3}
                value={m3uRawText}
                onChange={(e) => setM3uRawText(e.target.value)}
                placeholder="Oder direkten #EXTM3U Text hier einfügen…"
                className={`w-full p-3 font-mono text-xs text-white placeholder:text-slate-400 focus:outline-none ${
                  isM3 ? 'rounded-[20px] bg-[#232B3D]' : 'lg-capsule rounded-[18px]'
                }`}
              />

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <label
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold ${
                    isM3 ? 'm3-secondary-tonal' : 'lg-capsule text-white'
                  }`}
                >
                  <FileUp className="h-3.5 w-3.5" />
                  <span>.m3u / .m3u8 Datei öffnen</span>
                  <input
                    type="file"
                    accept=".m3u,.m3u8,.txt"
                    onChange={handleM3uFileUpload}
                    className="hidden"
                  />
                </label>

                <button
                  type="button"
                  disabled={ingestState.active || (!m3uUrl.trim() && !m3uRawText.trim())}
                  onClick={() => {
                    onImportM3u({
                      name: m3uName || 'M3U_Plus Quelle',
                      url: m3uUrl.trim() || undefined,
                      rawText: m3uRawText.trim() || undefined,
                      xmltvUrl: m3uXmltvUrl.trim() || undefined,
                    });
                    setM3uRawText('');
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold disabled:opacity-40 ${
                    isM3 ? 'm3-primary-pill' : 'lg-pill-active'
                  }`}
                >
                  <span>Im WebWorker importieren</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              <input
                type="text"
                value={xtName}
                onChange={(e) => setXtName(e.target.value)}
                placeholder="Anzeigename (z.B. Xtream Hauptserver)"
                className={inputClass}
              />
              <input
                type="url"
                value={xtServer}
                onChange={(e) => setXtServer(e.target.value)}
                placeholder="Server-URL (https://provider.example:8443)"
                className={inputClass}
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={xtUser}
                  onChange={(e) => setXtUser(e.target.value)}
                  placeholder="Benutzername"
                  className={inputClass}
                />
                <input
                  type="password"
                  value={xtPass}
                  onChange={(e) => setXtPass(e.target.value)}
                  placeholder="Passwort"
                  className={inputClass}
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2 text-xs text-slate-300">
                  <Server className="h-3.5 w-3.5 text-sky-400" />
                  <span>Stream-Container:</span>
                  <button
                    type="button"
                    onClick={() => setXtFormat(xtFormat === 'm3u8' ? 'ts' : 'm3u8')}
                    className="rounded-full bg-white/10 px-2.5 py-0.5 font-mono text-[11px] text-sky-300"
                  >
                    .{xtFormat}
                  </button>
                </div>

                <button
                  type="button"
                  disabled={
                    ingestState.active || !xtServer.trim() || !xtUser.trim() || !xtPass.trim()
                  }
                  onClick={() =>
                    onImportXtream({
                      name: xtName || 'Xtream Codes',
                      serverUrl: xtServer,
                      username: xtUser,
                      password: xtPass,
                      outputFormat: xtFormat,
                    })
                  }
                  className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold disabled:opacity-40 ${
                    isM3 ? 'm3-primary-pill' : 'lg-pill-active'
                  }`}
                >
                  <span>Xtream API synchronisieren</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* TiviMate-Parity Channel Organization (for Persisted Playlists) */}
      {activeSourceId !== 'builtin-reference' && storedChannelsForActive.length > 0 && (
        <div className={`${panelClass} space-y-3`}>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-semibold text-white">
                Kanal-Organisation (Umbenennen &amp; Ein-/Ausblenden in IndexedDB)
              </h3>
              <p className="text-[11px] text-slate-400">
                Änderungen werden sofort lokal in Dexie.js gespeichert und im 2D-EPG angewendet.
              </p>
            </div>
            <span className="text-xs text-slate-300 luma-tabular">
              {storedChannelsForActive.filter((c) => !c.isHidden).length} sichtbar /{' '}
              {storedChannelsForActive.length} gesamt
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {storedChannelsForActive.slice(0, 24).map((ch) => {
              const isEditing = editingChannelId === ch.id;
              return (
                <div
                  key={ch.id}
                  className={`flex items-center justify-between gap-2 px-3.5 py-2 ${
                    isM3 ? 'rounded-full bg-[#232B3D]' : 'lg-capsule rounded-[16px]'
                  } ${ch.isHidden ? 'opacity-50' : ''}`}
                >
                  {isEditing ? (
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          onRenameChannel(ch.id, editingName);
                          setEditingChannelId(null);
                        }
                      }}
                      className="flex-1 bg-transparent text-xs font-semibold text-sky-300 focus:outline-none"
                      autoFocus
                    />
                  ) : (
                    <div className="min-w-0 flex-1">
                      <span className="mr-2 font-mono text-[11px] text-slate-400 luma-tabular">
                        #{ch.number}
                      </span>
                      <span className="truncate text-xs font-medium text-white">{ch.name}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (isEditing) {
                          onRenameChannel(ch.id, editingName);
                          setEditingChannelId(null);
                        } else {
                          setEditingChannelId(ch.id);
                          setEditingName(ch.name);
                        }
                      }}
                      className="rounded-full p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
                      title="Kanal umbenennen"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => onToggleHideChannel(ch.id, !ch.isHidden)}
                      className="rounded-full p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
                      title={ch.isHidden ? 'Kanal einblenden' : 'Kanal ausblenden'}
                    >
                      {ch.isHidden ? (
                        <EyeOff className="h-3.5 w-3.5 text-amber-300" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* CORS Stream Proxy & Global EPG Offset */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={`${panelClass} space-y-3`}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-white">
              <ShieldCheck className="h-4 w-4 text-sky-400" />
              <span>
                {isLocalRustProxyEndpoint(proxyConfig.endpointUrl)
                  ? 'Tauri Rust Loopback-Proxy (127.0.0.1 · HLS & TS)'
                  : 'Firebase / Edge Stream-Proxy (CORS & Manifest-Rewriter)'}
              </span>
            </div>
            <button
              type="button"
              onClick={async () => {
                setProxyProbeMsg('Prüfe Endpoint…');
                const res = await probeCorsStreamProxy(proxyConfig.endpointUrl);
                setProxyProbeMsg(res.detail);
              }}
              className={`rounded-full px-3 py-1 text-[11px] font-semibold ${
                isM3 ? 'm3-secondary-tonal' : 'lg-capsule text-sky-200'
              }`}
            >
              Proxy prüfen
            </button>
          </div>

          {localRustProxyUrl && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  onChangeProxyConfig({
                    ...proxyConfig,
                    endpointUrl: localRustProxyUrl,
                  })
                }
                className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                  isLocalRustProxyEndpoint(proxyConfig.endpointUrl)
                    ? isM3
                      ? 'm3-primary-pill'
                      : 'lg-pill-active'
                    : isM3
                      ? 'm3-secondary-tonal'
                      : 'lg-capsule text-slate-200'
                }`}
              >
                Lokal · Tauri Rust (0 ms)
              </button>
              <button
                type="button"
                onClick={() =>
                  onChangeProxyConfig({
                    ...proxyConfig,
                    endpointUrl: 'https://luma-tv-app.web.app/api/stream-proxy',
                  })
                }
                className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                  !isLocalRustProxyEndpoint(proxyConfig.endpointUrl)
                    ? isM3
                      ? 'm3-primary-pill'
                      : 'lg-pill-active'
                    : isM3
                      ? 'm3-secondary-tonal'
                      : 'lg-capsule text-slate-200'
                }`}
              >
                Cloud · Firebase Edge
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={proxyConfig.enabled}
                onChange={(e) =>
                  onChangeProxyConfig({ ...proxyConfig, enabled: e.target.checked })
                }
                className="h-4 w-4 accent-sky-400"
              />
              <span>Immer über Proxy leiten</span>
            </label>

            <label className="flex items-center gap-2 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={proxyConfig.autoFallbackOnCors ?? true}
                onChange={(e) =>
                  onChangeProxyConfig({
                    ...proxyConfig,
                    autoFallbackOnCors: e.target.checked,
                  })
                }
                className="h-4 w-4 accent-sky-400"
              />
              <span>Auto-Fallback bei CORS-Blockade</span>
            </label>
          </div>

          <input
            type="text"
            value={proxyConfig.endpointUrl}
            onChange={(e) =>
              onChangeProxyConfig({ ...proxyConfig, endpointUrl: e.target.value })
            }
            placeholder="https://luma-tv-app.web.app/api/stream-proxy"
            className={inputClass}
          />

          <input
            type="text"
            value={proxyConfig.customUserAgent ?? 'LumaTV/1.0 (TiviMate-Compatible)'}
            onChange={(e) =>
              onChangeProxyConfig({ ...proxyConfig, customUserAgent: e.target.value })
            }
            placeholder="Custom IPTV User-Agent (z.B. TiviMate/4.7.0 oder VLC/3.0.20)"
            className={inputClass}
          />

          {proxyProbeMsg && (
            <div className="text-[11px] font-medium text-sky-300">{proxyProbeMsg}</div>
          )}
        </div>

        <div className={`${panelClass} space-y-3`}>
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 font-semibold text-white">
              <Sliders className="h-4 w-4 text-sky-400" />
              Globale XMLTV EPG-Offset-Korrektur
            </span>
            <span className="rounded-full bg-sky-400/15 px-2.5 py-0.5 font-mono text-[11px] text-sky-300 luma-tabular">
              {epgOffsetHours >= 0 ? `+${epgOffsetHours}h` : `${epgOffsetHours}h`}
            </span>
          </div>
          <input
            type="range"
            min={-3}
            max={3}
            step={1}
            value={epgOffsetHours}
            onChange={(e) => onChangeEpgOffset(Number(e.target.value))}
            className="mt-2 h-1.5 w-full cursor-pointer accent-sky-400"
          />
          <p className="text-[11px] text-slate-400">
            Verschiebt XMLTV-Sendungszeiten in Echtzeit zur Zeitzonen-Anpassung.
          </p>
        </div>
      </div>

      {/* Phase 4: Encrypted Luma Cloud Sync & Multi-Target Native/PWA Matrix */}
      <Phase4PlatformSyncPanel
        designMode={designMode}
        favoriteIds={favoriteIds}
        persistedSources={persistedSources}
        epgOffsetHours={epgOffsetHours}
        watchHistory={watchHistory}
        onRestoreFromSync={onRestoreFromSync}
      />
    </div>
  );
};
