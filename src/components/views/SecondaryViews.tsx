import React, { useMemo, useState } from 'react';
import {
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Database,
  Eye,
  EyeOff,
  FileUp,
  Globe,
  History,
  Layers,
  Loader2,
  MoreVertical,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  Sliders,
  Trash2,
  UserCheck,
  Users,
} from 'lucide-react';
import type {
  StoredChannel,
  StoredEpgProgram,
  StoredPlaylistSource,
} from '../../db/lumaDb';
import { getChannelProgramsInRange } from '../../data/mockCatalog';
import {
  LOCALE_META,
  TRANSLATIONS,
  type LumaLocale,
} from '../../i18n/translations';
import {
  isProviderDividerChannel,
  matchesNormalizedQuery,
  searchChannelsRanked,
  tokenizeSearchQuery,
} from '../../services/channelSearch';
import {
  buildCountryBuckets,
  computeExclusiveGroupVisibility,
  filterCountryBuckets,
} from '../../services/countryGroupMatcher';
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
import type { ChannelContextMenuTarget } from '../common/ChannelContextMenu';
import { Phase4PlatformSyncPanel } from './Phase4PlatformSyncPanel';

interface VodViewProps {
  designMode: PlatformDesignMode;
  vodCatalog: VodItem[];
  watchHistory?: WatchHistoryEntry[];
  locale?: LumaLocale;
  onPlayVod: (vod: VodItem, resumeSec?: number) => void;
  onInspectVod?: (vod: VodItem) => void;
}

export const VodCatalogView: React.FC<VodViewProps> = ({
  designMode,
  vodCatalog,
  watchHistory = [],
  locale = 'de',
  onPlayVod,
  onInspectVod,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const t = TRANSLATIONS[locale];
  const cardSurface = isM3
    ? 'rounded-[28px] bg-[#1A202E] hover:bg-[#232B3D]'
    : 'lg-pane rounded-[24px] hover:ring-1 hover:ring-white/30';

  return (
    <div className="luma-scroll flex-1 overflow-y-auto p-5">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-white">{t.navVod}</h2>
        <p className="text-xs text-slate-400 luma-tabular">
          {vodCatalog.length.toLocaleString()} Titles
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {vodCatalog.slice(0, 120).map((vod) => {
          const hist = watchHistory.find((w) => w.itemId === vod.id);
          const pct =
            hist && hist.durationSec > 0
              ? Math.min(98, Math.round((hist.resumeSec / hist.durationSec) * 100))
              : 0;
          return (
            <div
              key={vod.id}
              onClick={() => onPlayVod(vod, hist?.resumeSec ?? 0)}
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
                  <div className="min-w-0">
                    <div className="truncate text-[11px] font-medium text-sky-200/90">
                      {vod.genre}
                    </div>
                    <h3 className="truncate text-sm font-semibold text-white">{vod.title}</h3>
                  </div>
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full shadow-lg transition group-hover:scale-105 ${
                      isM3 ? 'm3-primary-pill' : 'lg-pill-active'
                    }`}
                  >
                    <Play className="h-4 w-4 fill-current" />
                  </span>
                </div>

                {pct > 0 && (
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-white/15">
                    <div
                      className={isM3 ? 'h-full bg-[#7FD4FF]' : 'luma-accent-gradient h-full'}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </div>

              <div className="p-4">
                <p className="line-clamp-2 text-xs leading-relaxed text-slate-300">
                  {vod.synopsis}
                </p>
                <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400 luma-tabular">
                  <span>
                    {vod.year} · {vod.durationMin} min{pct > 0 ? ` · ${pct}%` : ''}
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
                      Details
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

interface CatchupViewProps {
  designMode: PlatformDesignMode;
  channels: Channel[];
  xmltvMap?: Map<string, StoredEpgProgram[]>;
  epgOffsetHours?: number;
  nowMs: number;
  locale?: LumaLocale;
  onStartTimeshift: (channel: Channel, program: EpgProgram) => void;
}

export const CatchupArchiveView: React.FC<CatchupViewProps> = ({
  designMode,
  channels,
  xmltvMap,
  epgOffsetHours = 0,
  nowMs,
  locale = 'de',
  onStartTimeshift,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const t = TRANSLATIONS[locale];
  const bcp47 = LOCALE_META[locale].bcp47;
  const catchupChannels = channels.filter((c) => c.hasCatchup).slice(0, 24);
  const offsetMs = epgOffsetHours * 3600_000;
  const fmt = (ms: number) =>
    new Intl.DateTimeFormat(bcp47, { hour: '2-digit', minute: '2-digit' }).format(ms);

  return (
    <div className="luma-scroll flex-1 overflow-y-auto p-5 space-y-4">
      <div>
        <h2 className="text-base font-semibold text-white">{t.catchupTitle}</h2>
        <p className="text-xs text-slate-400">{t.catchupSubtitle}</p>
      </div>

      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-2">
        {catchupChannels.map((ch) => {
          const xmlBucket = ch.tvgId ? xmltvMap?.get(ch.tvgId) : undefined;
          const maxWindowMs = Math.max(1, ch.catchupDays || 3) * 86_400_000;

          const pastPrograms: EpgProgram[] =
            xmlBucket && xmlBucket.length > 0
              ? xmlBucket
                  .map((p) =>
                    offsetMs !== 0
                      ? { ...p, startMs: p.startMs + offsetMs, endMs: p.endMs + offsetMs }
                      : p
                  )
                  .filter((p) => p.endMs <= nowMs && p.startMs >= nowMs - maxWindowMs)
                  .slice(-4)
                  .reverse()
              : getChannelProgramsInRange(
                  ch,
                  nowMs - 5 * 3600_000,
                  nowMs - 5 * 60_000,
                  nowMs,
                  epgOffsetHours
                )
                  .filter((p) => p.endMs <= nowMs)
                  .slice(-4)
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
                      {ch.catchupDays} {t.catchupDaysActive}
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
                      {t.reLiveBtn}
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
  locale?: LumaLocale;
  nowMs: number;
  activeSourceId: string;
  persistedSources: StoredPlaylistSource[];
  storedChannelsForActive: StoredChannel[];
  ingestState: IngestProgressState;
  onSelectSourceId: (sourceId: string) => void;
  onDeleteSource: (sourceId: string) => void;
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
  onRenameSource?: (sourceId: string, nextName: string) => void;
  onResyncSource?: (source: StoredPlaylistSource) => void;
  onRefreshAccountInfo?: (source: StoredPlaylistSource) => Promise<void>;
  onUpdateHiddenGroups?: (sourceId: string, hiddenGroupIds: string[]) => void;
  onBulkSetChannelsHidden?: (channelIds: string[], hidden: boolean) => void;
  onPlayChannel?: (channel: Channel) => void;
  onOpenChannelMenu?: (target: ChannelContextMenuTarget) => void;
  onRenameChannel: (channelId: string, nextName: string) => void;
  onToggleHideChannel: (channelId: string, hidden: boolean) => void;
  epgOffsetHours: number;
  onChangeEpgOffset: (hours: number) => void;
  proxyConfig: EngineProxyConfig;
  onChangeProxyConfig: (next: EngineProxyConfig) => void;
  favoriteIds: Set<string>;
  watchHistory: WatchHistoryEntry[];
  onRestoreFromSync: (payload: LumaSyncPlainPayload) => void;
}

const USER_AGENT_PRESETS: { label: string; value: string }[] = [
  { label: 'Default (Luma TV)', value: 'LumaTV/0.7 (TiviMate-Compatible)' },
  { label: 'TiviMate', value: 'TiviMate/4.7.0 (Android 13)' },
  { label: 'VLC Player', value: 'VLC/3.0.20 LibVLC/3.0.20' },
];

export const SourcesEngineView: React.FC<SourcesEngineViewProps> = ({
  designMode,
  locale = 'de',
  nowMs,
  activeSourceId,
  persistedSources,
  storedChannelsForActive,
  ingestState,
  onSelectSourceId,
  onDeleteSource,
  onImportM3u,
  onImportXtream,
  onUploadXmltvBuffer,
  onRenameSource,
  onResyncSource,
  onRefreshAccountInfo,
  onUpdateHiddenGroups,
  onBulkSetChannelsHidden,
  onPlayChannel,
  onOpenChannelMenu,
  onRenameChannel,
  onToggleHideChannel,
  epgOffsetHours,
  onChangeEpgOffset,
  proxyConfig,
  onChangeProxyConfig,
  favoriteIds,
  watchHistory,
  onRestoreFromSync,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const t = TRANSLATIONS[locale];
  const bcp47 = LOCALE_META[locale].bcp47;
  const panelClass = isM3 ? 'rounded-[28px] bg-[#1A202E] p-5' : 'lg-pane rounded-[24px] p-5';
  const inputClass = isM3
    ? 'h-9 w-full rounded-full bg-[#232B3D] px-4 text-xs text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#7FD4FF]/60'
    : 'lg-capsule h-9 w-full rounded-full px-4 text-xs text-white placeholder:text-white/45 focus:outline-none';

  const [tab, setTab] = useState<'m3u' | 'xtream'>('xtream');

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

  // Playlist, Multi-Country & 54k+ Channel Organization state
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [editingSourceName, setEditingSourceName] = useState('');
  const [refreshingAccount, setRefreshingAccount] = useState(false);

  const [orgMode, setOrgMode] = useState<'countries' | 'groups' | 'channels'>('countries');
  const [countrySearch, setCountrySearch] = useState('');
  const [selectedCountryCodes, setSelectedCountryCodes] = useState<Set<string>>(
    () => new Set()
  );
  const [groupFilterQuery, setGroupFilterQuery] = useState('');
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(() => new Set());

  const [chFilterQuery, setChFilterQuery] = useState('');
  const [chGroupFilter, setChGroupFilter] = useState<string>('all');
  const [chVisFilter, setChVisFilter] = useState<
    'all' | 'visible' | 'hidden' | 'dividers'
  >('all');
  const [chPage, setChPage] = useState(0);
  const CH_PAGE_SIZE = 60;

  const [editingChannelId, setEditingChannelId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const activeStoredSource = useMemo(
    () => persistedSources.find((s) => s.id === activeSourceId) ?? null,
    [persistedSources, activeSourceId]
  );

  const hiddenGroupSet = useMemo(
    () => new Set(activeStoredSource?.hiddenGroupIds ?? []),
    [activeStoredSource]
  );

  const derivedSourceGroups = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();
    for (let i = 0; i < storedChannelsForActive.length; i++) {
      const ch = storedChannelsForActive[i];
      const existing = map.get(ch.groupId);
      if (existing) existing.count += 1;
      else map.set(ch.groupId, { id: ch.groupId, name: ch.groupName, count: 1 });
    }
    return Array.from(map.values());
  }, [storedChannelsForActive]);

  const allSourceGroupIds = useMemo(
    () => derivedSourceGroups.map((g) => g.id),
    [derivedSourceGroups]
  );

  const countryBuckets = useMemo(
    () => buildCountryBuckets(derivedSourceGroups),
    [derivedSourceGroups]
  );

  const filteredCountries = useMemo(
    () => filterCountryBuckets(countryBuckets, countrySearch),
    [countryBuckets, countrySearch]
  );

  const filteredSourceGroups = useMemo(() => {
    const tokens = tokenizeSearchQuery(groupFilterQuery);
    if (tokens.length === 0) return derivedSourceGroups;
    return derivedSourceGroups.filter((g) => matchesNormalizedQuery(g.name, tokens));
  }, [derivedSourceGroups, groupFilterQuery]);

  // Group IDs belonging to currently selected countries
  const groupIdsFromSelectedCountries = useMemo(() => {
    const set = new Set<string>();
    for (const bucket of countryBuckets) {
      if (selectedCountryCodes.has(bucket.code)) {
        for (const gid of bucket.groupIds) set.add(gid);
      }
    }
    return set;
  }, [countryBuckets, selectedCountryCodes]);

  const filteredStoredChannels = useMemo(() => {
    let base = storedChannelsForActive;
    if (chGroupFilter !== 'all') {
      base = base.filter((c) => c.groupId === chGroupFilter);
    }
    if (chVisFilter === 'visible') {
      base = base.filter((c) => !c.isHidden && !hiddenGroupSet.has(c.groupId));
    } else if (chVisFilter === 'hidden') {
      base = base.filter((c) => Boolean(c.isHidden) || hiddenGroupSet.has(c.groupId));
    } else if (chVisFilter === 'dividers') {
      base = base.filter((c) => isProviderDividerChannel(c.name));
    }
    if (!chFilterQuery.trim()) return base;
    return searchChannelsRanked(base, chFilterQuery, base.length).items;
  }, [
    storedChannelsForActive,
    chGroupFilter,
    chVisFilter,
    chFilterQuery,
    hiddenGroupSet,
  ]);

  const totalChPages = Math.max(1, Math.ceil(filteredStoredChannels.length / CH_PAGE_SIZE));
  const safeChPage = Math.min(chPage, totalChPages - 1);
  const pagedStoredChannels = filteredStoredChannels.slice(
    safeChPage * CH_PAGE_SIZE,
    (safeChPage + 1) * CH_PAGE_SIZE
  );

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

  const toggleCountrySelection = (code: string) => {
    setSelectedCountryCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const toggleGroupSelection = (groupId: string) => {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const account = activeStoredSource?.accountInfo;
  const canQueryAccount = Boolean(
    activeStoredSource &&
      ((activeStoredSource.type === 'xtream' &&
        activeStoredSource.username &&
        activeStoredSource.password) ||
        activeStoredSource.rawUrlOrHost?.includes('username='))
  );

  const accountExpirySummary = useMemo(() => {
    if (!account) return null;
    if (account.expiresAtMs === null) {
      return {
        label: t.accountUnlimited,
        daysLeft: null as number | null,
        expired: false,
      };
    }
    const formattedDate = new Intl.DateTimeFormat(bcp47, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(account.expiresAtMs);
    const daysLeft = Math.ceil((account.expiresAtMs - nowMs) / 86_400_000);
    return {
      label: formattedDate,
      daysLeft,
      expired: daysLeft <= 0 || account.status.toLowerCase() !== 'active',
    };
  }, [account, bcp47, nowMs, t.accountUnlimited]);

  return (
    <div className="luma-scroll flex-1 overflow-y-auto p-5 space-y-5">
      {/* Clean Page Header */}
      <div>
        <h2 className="text-base font-semibold text-white">{t.navSources}</h2>
        <p className="text-xs text-slate-400">
          Connect M3U playlists or Xtream accounts, filter countries, and view your
          subscription status.
        </p>
      </div>

      {/* Live Import Progress Banner */}
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
                  ? ingestState.error
                  : ingestState.active
                    ? ingestState.phase
                    : ingestState.lastSummary}
              </span>
            </span>
            {ingestState.active && (
              <span className="font-mono text-sky-300 luma-tabular">
                {ingestState.percent}%
              </span>
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
        {/* Left Column: Connected Playlists */}
        <div className={`${panelClass} space-y-3`}>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white">Playlists</span>
            <span className="rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-300 luma-tabular">
              {persistedSources.length + 1}
            </span>
          </div>

          {/* Built-in Demo */}
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
                Luma Demo Channels (Built-in)
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-sky-300">
                <CheckCircle2 className="h-3 w-3" />
                DEMO
              </span>
            </div>
            <div className="mt-1 text-[11px] opacity-80 luma-tabular">
              2,400 Demo Channels · 6 Movies
            </div>
          </div>

          {/* User Playlists */}
          {persistedSources.map((src) => {
            const isActive = activeSourceId === src.id;
            const isRenamingSource = editingSourceId === src.id;
            const canResync =
              (src.type === 'xtream' && Boolean(src.username && src.password)) ||
              Boolean(src.rawUrlOrHost && src.rawUrlOrHost.startsWith('http'));
            return (
              <div
                key={src.id}
                onClick={() => {
                  onSelectSourceId(src.id);
                  setSelectedCountryCodes(new Set());
                  setSelectedGroupIds(new Set());
                  setChPage(0);
                }}
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
                  {isRenamingSource ? (
                    <input
                      type="text"
                      value={editingSourceName}
                      onChange={(e) => setEditingSourceName(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          onRenameSource?.(src.id, editingSourceName);
                          setEditingSourceId(null);
                        } else if (e.key === 'Escape') {
                          setEditingSourceId(null);
                        }
                      }}
                      autoFocus
                      className="flex-1 rounded-full bg-black/35 px-3 py-0.5 text-xs font-semibold text-sky-200 focus:outline-none"
                    />
                  ) : (
                    <span className="truncate text-xs font-semibold text-white">
                      {src.name}
                    </span>
                  )}
                  <div
                    className="flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="mr-1 text-[10px] font-bold uppercase text-sky-300">
                      {src.type === 'xtream' ? 'XTREAM' : 'M3U'}
                    </span>
                    {onRenameSource && (
                      <button
                        type="button"
                        onClick={() => {
                          if (isRenamingSource) {
                            onRenameSource(src.id, editingSourceName);
                            setEditingSourceId(null);
                          } else {
                            setEditingSourceId(src.id);
                            setEditingSourceName(src.name);
                          }
                        }}
                        className="rounded-full p-1 text-slate-300 hover:bg-white/10 hover:text-white"
                        title="Rename playlist"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {canResync && onResyncSource && (
                      <button
                        type="button"
                        disabled={ingestState.active}
                        onClick={() => onResyncSource(src)}
                        className="rounded-full p-1 text-slate-300 hover:bg-white/10 hover:text-sky-200 disabled:opacity-40"
                        title="Update channels from server"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onDeleteSource(src.id)}
                      className="rounded-full p-1 text-slate-300 hover:bg-rose-500/25 hover:text-rose-200"
                      title="Remove playlist"
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
                    {src.channelCount.toLocaleString(bcp47)} {t.channelsUnit} ·{' '}
                    {src.vodCount} VOD
                    {src.seriesCount ? ` · ${src.seriesCount} Series` : ''}
                  </span>
                  <span>{src.lastUpdated.replace(/\s*Worker|\s*Sync/gi, '')}</span>
                </div>
              </div>
            );
          })}

          {/* Upload Extra XMLTV (.xml / .xml.gz) */}
          {activeSourceId !== 'builtin-reference' && (
            <div className="pt-1">
              <label
                className={`inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold ${
                  isM3 ? 'm3-secondary-tonal' : 'lg-capsule text-white'
                }`}
              >
                <FileUp className="h-3.5 w-3.5 text-sky-300" />
                <span>Load XMLTV TV Guide (.xml / .xml.gz)</span>
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

        {/* Right Column: Connect New Playlist */}
        <div className={`${panelClass} space-y-3.5`}>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-semibold text-white">
              <Plus className="h-4 w-4 text-sky-400" />
              <span>Add Playlist</span>
            </span>

            <div
              className={`flex rounded-full p-0.5 ${
                isM3 ? 'bg-[#232B3D]' : 'lg-capsule'
              }`}
            >
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
                Xtream Codes
              </button>
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
                M3U Playlist
              </button>
            </div>
          </div>

          {tab === 'm3u' ? (
            <div className="space-y-2.5">
              <input
                type="text"
                value={m3uName}
                onChange={(e) => setM3uName(e.target.value)}
                placeholder="Playlist Name (e.g. Home TV)"
                className={inputClass}
              />
              <input
                type="url"
                value={m3uUrl}
                onChange={(e) => setM3uUrl(e.target.value)}
                placeholder="Playlist URL (https://…/playlist.m3u8)"
                className={inputClass}
              />
              <input
                type="url"
                value={m3uXmltvUrl}
                onChange={(e) => setM3uXmltvUrl(e.target.value)}
                placeholder="Optional: TV Guide XMLTV URL (.xml or .xml.gz)"
                className={inputClass}
              />
              <textarea
                rows={3}
                value={m3uRawText}
                onChange={(e) => setM3uRawText(e.target.value)}
                placeholder="Or paste #EXTM3U text directly…"
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
                  <span>Open .m3u / .m3u8 File</span>
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
                      name: m3uName || 'M3U Playlist',
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
                  <span>Connect Playlist</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              <input
                type="text"
                value={xtName}
                onChange={(e) => setXtName(e.target.value)}
                placeholder="Display Name (e.g. Main IPTV)"
                className={inputClass}
              />
              <input
                type="url"
                value={xtServer}
                onChange={(e) => setXtServer(e.target.value)}
                placeholder="Server URL (http://provider.example:8080)"
                className={inputClass}
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={xtUser}
                  onChange={(e) => setXtUser(e.target.value)}
                  placeholder="Username"
                  className={inputClass}
                />
                <input
                  type="password"
                  value={xtPass}
                  onChange={(e) => setXtPass(e.target.value)}
                  placeholder="Password"
                  className={inputClass}
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2 text-xs text-slate-300">
                  <Server className="h-3.5 w-3.5 text-sky-400" />
                  <span>Format:</span>
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
                    ingestState.active ||
                    !xtServer.trim() ||
                    !xtUser.trim() ||
                    !xtPass.trim()
                  }
                  onClick={() =>
                    onImportXtream({
                      name: xtName || 'Xtream TV',
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
                  <span>Connect Xtream</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Account & Subscription Info Card (Expiry Date, Status, Active / Max Connections) */}
      {activeStoredSource && (account || canQueryAccount) && (
        <div className={`${panelClass} space-y-3`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-white">
              <UserCheck className="h-4 w-4 text-sky-400" />
              <span>
                {t.accountInfoTitle} · {activeStoredSource.name}
              </span>
            </div>

            {canQueryAccount && onRefreshAccountInfo && (
              <button
                type="button"
                disabled={refreshingAccount}
                onClick={async () => {
                  setRefreshingAccount(true);
                  try {
                    await onRefreshAccountInfo(activeStoredSource);
                  } finally {
                    setRefreshingAccount(false);
                  }
                }}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold disabled:opacity-50 ${
                  isM3 ? 'm3-secondary-tonal' : 'lg-capsule text-sky-200'
                }`}
              >
                <RefreshCw
                  className={`h-3 w-3 ${refreshingAccount ? 'animate-spin' : ''}`}
                />
                <span>Refresh Status</span>
              </button>
            )}
          </div>

          {account ? (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {/* Status */}
              <div
                className={`p-3 ${
                  isM3 ? 'rounded-[20px] bg-[#232B3D]' : 'lg-capsule rounded-[16px]'
                }`}
              >
                <div className="text-[10px] text-slate-400">Status</div>
                <div className="mt-1 flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      accountExpirySummary?.expired
                        ? 'bg-rose-400'
                        : 'bg-emerald-400'
                    }`}
                  />
                  <span className="text-xs font-semibold text-white">
                    {accountExpirySummary?.expired ? t.accountExpired : account.status}
                    {account.isTrial ? ' (Trial)' : ''}
                  </span>
                </div>
              </div>

              {/* Expiry Date */}
              <div
                className={`p-3 ${
                  isM3 ? 'rounded-[20px] bg-[#232B3D]' : 'lg-capsule rounded-[16px]'
                }`}
              >
                <div className="flex items-center gap-1 text-[10px] text-slate-400">
                  <Calendar className="h-3 w-3 text-sky-300" />
                  <span>{t.accountExpiresLabel}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-semibold text-white luma-tabular">
                  <span>{accountExpirySummary?.label}</span>
                  {accountExpirySummary?.daysLeft !== null &&
                    accountExpirySummary?.daysLeft !== undefined && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          accountExpirySummary.daysLeft <= 0
                            ? 'bg-rose-500/20 text-rose-300'
                            : accountExpirySummary.daysLeft <= 14
                              ? 'bg-amber-400/20 text-amber-200'
                              : 'bg-emerald-500/20 text-emerald-300'
                        }`}
                      >
                        {accountExpirySummary.daysLeft > 0
                          ? `${accountExpirySummary.daysLeft}d`
                          : t.accountExpired}
                      </span>
                    )}
                </div>
              </div>

              {/* Connections */}
              <div
                className={`p-3 ${
                  isM3 ? 'rounded-[20px] bg-[#232B3D]' : 'lg-capsule rounded-[16px]'
                }`}
              >
                <div className="flex items-center gap-1 text-[10px] text-slate-400">
                  <Users className="h-3 w-3 text-sky-300" />
                  <span>{t.accountConnectionsLabel}</span>
                </div>
                <div className="mt-1 text-xs font-semibold text-white luma-tabular">
                  {account.maxConnections !== undefined
                    ? `${account.activeConnections ?? 0} / ${account.maxConnections}`
                    : '—'}
                </div>
              </div>

              {/* Account / Server */}
              <div
                className={`p-3 ${
                  isM3 ? 'rounded-[20px] bg-[#232B3D]' : 'lg-capsule rounded-[16px]'
                }`}
              >
                <div className="text-[10px] text-slate-400">Account</div>
                <div className="mt-1 truncate text-xs font-semibold text-white">
                  {account.username ?? activeStoredSource.username ?? '—'}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-400">
              {refreshingAccount
                ? 'Loading subscription details…'
                : 'Click "Refresh Status" to load your subscription expiry date and connection limit.'}
            </div>
          )}
        </div>
      )}

      {/* Multi-Country, Group & 54k+ Channel Manager */}
      {activeSourceId !== 'builtin-reference' && storedChannelsForActive.length > 0 && (
        <div className={`${panelClass} space-y-4`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-white">
                Channel &amp; Country Manager · {activeStoredSource?.name}
              </h3>
              <p className="text-xs text-slate-400 luma-tabular">
                {storedChannelsForActive
                  .filter((c) => !c.isHidden && !hiddenGroupSet.has(c.groupId))
                  .length.toLocaleString(bcp47)}{' '}
                enabled / {storedChannelsForActive.length.toLocaleString(bcp47)} total ·{' '}
                {derivedSourceGroups.length - hiddenGroupSet.size} /{' '}
                {derivedSourceGroups.length} groups enabled
              </p>
            </div>

            <div
              className={`flex flex-wrap items-center rounded-full p-1 ${
                isM3 ? 'bg-[#232B3D]' : 'lg-capsule'
              }`}
            >
              <button
                type="button"
                onClick={() => setOrgMode('countries')}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  orgMode === 'countries'
                    ? isM3
                      ? 'm3-primary-pill'
                      : 'lg-pill-active'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Globe className="h-3.5 w-3.5" />
                <span>Countries ({countryBuckets.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setOrgMode('groups')}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  orgMode === 'groups'
                    ? isM3
                      ? 'm3-primary-pill'
                      : 'lg-pill-active'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                <span>Groups ({derivedSourceGroups.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setOrgMode('channels')}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  orgMode === 'channels'
                    ? isM3
                      ? 'm3-primary-pill'
                      : 'lg-pill-active'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Eye className="h-3.5 w-3.5" />
                <span>
                  Channels ({storedChannelsForActive.length.toLocaleString(bcp47)})
                </span>
              </button>
            </div>
          </div>

          {orgMode === 'countries' && (
            <div className="space-y-3">
              {/* Search Countries + Persistent Selection Action Bar */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[240px] flex-1">
                  <Search className="pointer-events-none absolute left-3.5 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    value={countrySearch}
                    onChange={(e) => setCountrySearch(e.target.value)}
                    placeholder="Search countries (e.g. Germany, Greece, UK, Italy, US, 4K)…"
                    className={`${inputClass} pl-10`}
                  />
                  {countrySearch && (
                    <button
                      type="button"
                      onClick={() => setCountrySearch('')}
                      className="absolute right-3 top-2 text-xs text-slate-400 hover:text-white"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {countrySearch.trim() && filteredCountries.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCountryCodes((prev) => {
                        const next = new Set(prev);
                        for (const c of filteredCountries) next.add(c.code);
                        return next;
                      });
                    }}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                      isM3 ? 'm3-secondary-tonal' : 'lg-capsule text-sky-200'
                    }`}
                  >
                    + Select Matching ({filteredCountries.length})
                  </button>
                )}

                {onUpdateHiddenGroups && (
                  <button
                    type="button"
                    onClick={() => onUpdateHiddenGroups(activeSourceId, [])}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                      isM3 ? 'm3-secondary-tonal' : 'lg-capsule text-slate-200'
                    }`}
                  >
                    Enable All Countries
                  </button>
                )}
              </div>

              {/* Selected Countries Action Strip (Enable ONLY selected vs Disable ONLY selected) */}
              {selectedCountryCodes.size > 0 && onUpdateHiddenGroups && (
                <div
                  className={`flex flex-wrap items-center justify-between gap-2.5 p-3 ${
                    isM3
                      ? 'rounded-[20px] bg-[#232B3D] ring-1 ring-[#7FD4FF]/40'
                      : 'lg-capsule rounded-[18px]'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="font-semibold text-white">
                      Selected ({selectedCountryCodes.size}):
                    </span>
                    {Array.from(selectedCountryCodes).map((code) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => toggleCountrySelection(code)}
                        className="inline-flex items-center gap-1 rounded-full bg-sky-400/20 px-2.5 py-0.5 text-[11px] font-semibold text-sky-200 hover:bg-sky-400/35"
                      >
                        <span>{code}</span>
                        <span>✕</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setSelectedCountryCodes(new Set())}
                      className="ml-1 text-[11px] text-slate-400 underline hover:text-white"
                    >
                      Clear
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const nextHidden = computeExclusiveGroupVisibility(
                          allSourceGroupIds,
                          groupIdsFromSelectedCountries,
                          'enable-only-selected'
                        );
                        onUpdateHiddenGroups(activeSourceId, nextHidden);
                      }}
                      className={`rounded-full px-3.5 py-1.5 text-xs font-bold ${
                        isM3 ? 'm3-primary-pill' : 'lg-pill-active'
                      }`}
                    >
                      Enable Only Selected (Disable Others)
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const nextHidden = computeExclusiveGroupVisibility(
                          allSourceGroupIds,
                          groupIdsFromSelectedCountries,
                          'disable-only-selected'
                        );
                        onUpdateHiddenGroups(activeSourceId, nextHidden);
                      }}
                      className="rounded-full bg-amber-400/20 px-3.5 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-400/30"
                    >
                      Disable Selected (Enable Others)
                    </button>
                  </div>
                </div>
              )}

              {/* Country Grid */}
              <div className="luma-scroll grid max-h-[360px] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
                {filteredCountries.map((bucket) => {
                  const isSelected = selectedCountryCodes.has(bucket.code);
                  const enabledGroupsInCountry = bucket.groupIds.filter(
                    (id) => !hiddenGroupSet.has(id)
                  ).length;
                  const allDisabled = enabledGroupsInCountry === 0;
                  return (
                    <div
                      key={bucket.code}
                      onClick={() => toggleCountrySelection(bucket.code)}
                      className={`flex cursor-pointer items-center justify-between gap-2 px-3.5 py-2.5 text-xs transition ${
                        isM3 ? 'rounded-full' : 'rounded-[15px]'
                      } ${
                        isSelected
                          ? isM3
                            ? 'm3-tonal-active ring-1 ring-[#7FD4FF]/70'
                            : 'lg-pill-active'
                          : allDisabled
                            ? 'bg-white/[0.03] text-slate-500 opacity-60 hover:opacity-90'
                            : isM3
                              ? 'bg-[#232B3D] text-white hover:bg-[#2E384F]'
                              : 'lg-capsule text-white'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border ${
                            isSelected
                              ? 'border-sky-300 bg-sky-400 text-slate-950'
                              : 'border-white/25 bg-black/20'
                          }`}
                        >
                          {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
                        </span>
                        <span className="truncate font-semibold">{bucket.label}</span>
                      </div>

                      <div
                        className="flex shrink-0 items-center gap-2 text-[11px] luma-tabular"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="opacity-75">
                          {bucket.channelCount.toLocaleString(bcp47)}
                        </span>
                        {onUpdateHiddenGroups && (
                          <button
                            type="button"
                            onClick={() => {
                              const next = new Set(hiddenGroupSet);
                              if (allDisabled) {
                                for (const id of bucket.groupIds) next.delete(id);
                              } else {
                                for (const id of bucket.groupIds) next.add(id);
                              }
                              onUpdateHiddenGroups(activeSourceId, Array.from(next));
                            }}
                            className="rounded-full p-1 hover:bg-white/10"
                            title={
                              allDisabled ? 'Enable this country' : 'Disable this country'
                            }
                          >
                            {allDisabled ? (
                              <EyeOff className="h-3.5 w-3.5 text-amber-300" />
                            ) : (
                              <Eye className="h-3.5 w-3.5 text-emerald-300" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {orgMode === 'groups' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[220px] flex-1">
                  <Search className="pointer-events-none absolute left-3.5 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    value={groupFilterQuery}
                    onChange={(e) => setGroupFilterQuery(e.target.value)}
                    placeholder="Search groups (e.g. Sport, Cinema, Kids, News)…"
                    className={`${inputClass} pl-10`}
                  />
                </div>

                {groupFilterQuery.trim() && filteredSourceGroups.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedGroupIds((prev) => {
                        const next = new Set(prev);
                        for (const g of filteredSourceGroups) next.add(g.id);
                        return next;
                      });
                    }}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                      isM3 ? 'm3-secondary-tonal' : 'lg-capsule text-sky-200'
                    }`}
                  >
                    + Select Matching ({filteredSourceGroups.length})
                  </button>
                )}

                {onUpdateHiddenGroups && (
                  <button
                    type="button"
                    onClick={() => onUpdateHiddenGroups(activeSourceId, [])}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                      isM3 ? 'm3-secondary-tonal' : 'lg-capsule text-slate-200'
                    }`}
                  >
                    Enable All Groups
                  </button>
                )}
              </div>

              {selectedGroupIds.size > 0 && onUpdateHiddenGroups && (
                <div
                  className={`flex flex-wrap items-center justify-between gap-2.5 p-3 ${
                    isM3
                      ? 'rounded-[20px] bg-[#232B3D] ring-1 ring-[#7FD4FF]/40'
                      : 'lg-capsule rounded-[18px]'
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-semibold text-white luma-tabular">
                      {selectedGroupIds.size} groups selected
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedGroupIds(new Set())}
                      className="text-[11px] text-slate-400 underline hover:text-white"
                    >
                      Clear
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const nextHidden = computeExclusiveGroupVisibility(
                          allSourceGroupIds,
                          selectedGroupIds,
                          'enable-only-selected'
                        );
                        onUpdateHiddenGroups(activeSourceId, nextHidden);
                      }}
                      className={`rounded-full px-3.5 py-1.5 text-xs font-bold ${
                        isM3 ? 'm3-primary-pill' : 'lg-pill-active'
                      }`}
                    >
                      Enable Only Selected (Disable Others)
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const nextHidden = computeExclusiveGroupVisibility(
                          allSourceGroupIds,
                          selectedGroupIds,
                          'disable-only-selected'
                        );
                        onUpdateHiddenGroups(activeSourceId, nextHidden);
                      }}
                      className="rounded-full bg-amber-400/20 px-3.5 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-400/30"
                    >
                      Disable Selected (Enable Others)
                    </button>
                  </div>
                </div>
              )}

              <div className="luma-scroll grid max-h-[380px] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
                {filteredSourceGroups.map((grp) => {
                  const isHidden = hiddenGroupSet.has(grp.id);
                  const isSelected = selectedGroupIds.has(grp.id);
                  return (
                    <div
                      key={grp.id}
                      onClick={() => toggleGroupSelection(grp.id)}
                      className={`flex cursor-pointer items-center justify-between gap-2 px-3.5 py-2 text-left text-xs transition ${
                        isM3 ? 'rounded-full' : 'rounded-[14px]'
                      } ${
                        isSelected
                          ? isM3
                            ? 'm3-tonal-active ring-1 ring-[#7FD4FF]/70'
                            : 'lg-pill-active'
                          : isHidden
                            ? 'bg-white/[0.03] text-slate-500 opacity-60 hover:opacity-90'
                            : isM3
                              ? 'bg-[#232B3D] text-white hover:bg-[#2E384F]'
                              : 'lg-capsule text-white'
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                            isSelected
                              ? 'border-sky-300 bg-sky-400 text-slate-950'
                              : 'border-white/25 bg-black/20'
                          }`}
                        >
                          {isSelected && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                        </span>
                        <span className="truncate font-medium">{grp.name}</span>
                      </span>

                      <span
                        className="flex shrink-0 items-center gap-1.5 text-[11px] luma-tabular"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="opacity-70">{grp.count.toLocaleString()}</span>
                        <button
                          type="button"
                          onClick={() => {
                            if (!onUpdateHiddenGroups) return;
                            const next = new Set(hiddenGroupSet);
                            if (next.has(grp.id)) next.delete(grp.id);
                            else next.add(grp.id);
                            onUpdateHiddenGroups(activeSourceId, Array.from(next));
                          }}
                          className="rounded-full p-1 hover:bg-white/10"
                        >
                          {isHidden ? (
                            <EyeOff className="h-3.5 w-3.5 text-amber-300" />
                          ) : (
                            <Eye className="h-3.5 w-3.5 text-emerald-300" />
                          )}
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {orgMode === 'channels' && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[220px] flex-1">
                  <Search className="pointer-events-none absolute left-3.5 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    value={chFilterQuery}
                    onChange={(e) => {
                      setChFilterQuery(e.target.value);
                      setChPage(0);
                    }}
                    placeholder="Search all channels (e.g. Sky F1, UHD, ERT, Rai)…"
                    className={`${inputClass} pl-10`}
                  />
                </div>

                <select
                  value={chGroupFilter}
                  onChange={(e) => {
                    setChGroupFilter(e.target.value);
                    setChPage(0);
                  }}
                  className={`h-9 max-w-[220px] rounded-full px-3.5 text-xs text-white focus:outline-none ${
                    isM3 ? 'bg-[#232B3D]' : 'lg-capsule bg-[#121826]'
                  }`}
                >
                  <option value="all">All Groups ({derivedSourceGroups.length})</option>
                  {derivedSourceGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.count})
                    </option>
                  ))}
                </select>

                <div className="flex flex-wrap items-center gap-1 text-[11px]">
                  {(
                    [
                      ['all', 'All'],
                      ['visible', 'Enabled'],
                      ['hidden', 'Hidden'],
                      ['dividers', '### Dividers'],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setChVisFilter(mode);
                        setChPage(0);
                      }}
                      className={`rounded-full px-3 py-1.5 font-semibold transition ${
                        chVisFilter === mode
                          ? isM3
                            ? 'm3-primary-pill'
                            : 'lg-pill-active'
                          : 'bg-white/[0.06] text-slate-300 hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="luma-tabular">
                    <strong>{filteredStoredChannels.length.toLocaleString()}</strong>{' '}
                    channels
                  </span>
                  {onBulkSetChannelsHidden && filteredStoredChannels.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          onBulkSetChannelsHidden(
                            filteredStoredChannels.map((c) => c.id),
                            true
                          )
                        }
                        className="rounded-full bg-white/[0.07] px-3 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/20"
                      >
                        Hide Shown ({filteredStoredChannels.length.toLocaleString()})
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onBulkSetChannelsHidden(
                            filteredStoredChannels.map((c) => c.id),
                            false
                          )
                        }
                        className="rounded-full bg-white/[0.07] px-3 py-1 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-500/20"
                      >
                        Enable Shown
                      </button>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-1.5 luma-tabular">
                  <button
                    type="button"
                    disabled={safeChPage === 0}
                    onClick={() => setChPage((p) => Math.max(0, p - 1))}
                    className="rounded-full bg-white/10 p-1.5 text-white disabled:opacity-30"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <span>
                    Page {safeChPage + 1} / {totalChPages.toLocaleString()}
                  </span>
                  <button
                    type="button"
                    disabled={safeChPage >= totalChPages - 1}
                    onClick={() => setChPage((p) => Math.min(totalChPages - 1, p + 1))}
                    className="rounded-full bg-white/10 p-1.5 text-white disabled:opacity-30"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="luma-scroll grid max-h-[420px] grid-cols-1 gap-2 overflow-y-auto pr-1 md:grid-cols-2">
                {pagedStoredChannels.map((ch) => {
                  const isEditing = editingChannelId === ch.id;
                  const groupHidden = hiddenGroupSet.has(ch.groupId);
                  return (
                    <div
                      key={ch.id}
                      onContextMenu={(e) => {
                        if (!onOpenChannelMenu) return;
                        e.preventDefault();
                        onOpenChannelMenu({ channel: ch, x: e.clientX, y: e.clientY });
                      }}
                      className={`flex items-center justify-between gap-2 px-3.5 py-2 ${
                        isM3 ? 'rounded-full bg-[#232B3D]' : 'lg-capsule rounded-[15px]'
                      } ${ch.isHidden || groupHidden ? 'opacity-50' : ''}`}
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
                            } else if (e.key === 'Escape') {
                              setEditingChannelId(null);
                            }
                          }}
                          className="flex-1 bg-transparent text-xs font-semibold text-sky-300 focus:outline-none"
                          autoFocus
                        />
                      ) : (
                        <div className="min-w-0 flex-1">
                          <div className="truncate">
                            <span className="mr-2 font-mono text-[11px] text-slate-400 luma-tabular">
                              #{ch.number}
                            </span>
                            <span className="text-xs font-medium text-white">{ch.name}</span>
                          </div>
                          <div className="truncate text-[10px] text-slate-400">
                            {ch.groupName}
                          </div>
                        </div>
                      )}

                      <div className="flex shrink-0 items-center gap-0.5">
                        {onPlayChannel && (
                          <button
                            type="button"
                            onClick={() => onPlayChannel(ch)}
                            className="rounded-full p-1.5 text-sky-300 hover:bg-sky-400/20 hover:text-white"
                            title={t.playNow}
                          >
                            <Play className="h-3.5 w-3.5 fill-current" />
                          </button>
                        )}
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
                          title="Rename channel"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => onToggleHideChannel(ch.id, !ch.isHidden)}
                          className="rounded-full p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
                          title={ch.isHidden ? 'Enable channel' : 'Hide channel'}
                        >
                          {ch.isHidden ? (
                            <EyeOff className="h-3.5 w-3.5 text-amber-300" />
                          ) : (
                            <Eye className="h-3.5 w-3.5" />
                          )}
                        </button>

                        {onOpenChannelMenu && (
                          <button
                            type="button"
                            onClick={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect();
                              onOpenChannelMenu({
                                channel: ch,
                                x: rect.left,
                                y: rect.bottom + 4,
                              });
                            }}
                            className="rounded-full p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
                            title={t.addToCollectionHeader}
                          >
                            <MoreVertical className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Simplified Stream Compatibility & TV Guide Time Shift */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className={`${panelClass} space-y-3`}>
          <div className="flex items-center gap-2 text-xs font-semibold text-white">
            <ShieldCheck className="h-4 w-4 text-sky-400" />
            <span>Stream Compatibility</span>
          </div>

          <p className="text-[11px] leading-relaxed text-slate-400">
            Helps channels play smoothly when IPTV servers use HTTP redirects or expect a
            specific TV app profile.
          </p>

          <div className="space-y-2 pt-0.5">
            <label className="flex items-center gap-2.5 text-xs text-slate-200">
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
              <span>Automatic stream compatibility (Recommended)</span>
            </label>

            <label className="flex items-center gap-2.5 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={proxyConfig.enabled}
                onChange={(e) =>
                  onChangeProxyConfig({ ...proxyConfig, enabled: e.target.checked })
                }
                className="h-4 w-4 accent-sky-400"
              />
              <span>Force compatibility mode for all channels</span>
            </label>
          </div>

          <div className="pt-1">
            <div className="mb-1.5 text-[11px] text-slate-400">Player Identification</div>
            <div className="flex flex-wrap gap-1.5">
              {USER_AGENT_PRESETS.map((preset) => {
                const isSelected =
                  (proxyConfig.customUserAgent ?? USER_AGENT_PRESETS[0].value) ===
                  preset.value;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() =>
                      onChangeProxyConfig({
                        ...proxyConfig,
                        customUserAgent: preset.value,
                      })
                    }
                    className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                      isSelected
                        ? isM3
                          ? 'm3-primary-pill'
                          : 'lg-pill-active'
                        : isM3
                          ? 'm3-secondary-tonal'
                          : 'lg-capsule text-slate-300'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className={`${panelClass} space-y-3`}>
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-2 font-semibold text-white">
              <Sliders className="h-4 w-4 text-sky-400" />
              TV Guide Time Offset
            </span>
            <span className="rounded-full bg-sky-400/15 px-2.5 py-0.5 font-mono text-[11px] text-sky-300 luma-tabular">
              {epgOffsetHours === 0
                ? 'Auto (0h)'
                : epgOffsetHours > 0
                  ? `+${epgOffsetHours}h`
                  : `${epgOffsetHours}h`}
            </span>
          </div>

          <p className="text-[11px] leading-relaxed text-slate-400">
            Adjust program times forward or backward if your provider&apos;s TV guide is
            shifted by a time zone.
          </p>

          <div className="flex flex-wrap gap-1.5 pt-1">
            {[-3, -2, -1, 0, 1, 2, 3].map((hrs) => (
              <button
                key={hrs}
                type="button"
                onClick={() => onChangeEpgOffset(hrs)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold luma-tabular ${
                  epgOffsetHours === hrs
                    ? isM3
                      ? 'm3-primary-pill'
                      : 'lg-pill-active'
                    : isM3
                      ? 'm3-secondary-tonal'
                      : 'lg-capsule text-slate-300'
                }`}
              >
                {hrs === 0 ? '0h' : hrs > 0 ? `+${hrs}h` : `${hrs}h`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Password-Protected Sync & App Status */}
      <Phase4PlatformSyncPanel
        designMode={designMode}
        locale={locale}
        favoriteIds={favoriteIds}
        persistedSources={persistedSources}
        epgOffsetHours={epgOffsetHours}
        watchHistory={watchHistory}
        onRestoreFromSync={onRestoreFromSync}
      />
    </div>
  );
};
