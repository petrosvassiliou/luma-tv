import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  lumaDb,
  type StoredChannel,
  type StoredEpgProgram,
  type StoredPlaylistSource,
  type StoredSeriesItem,
  type StoredVodItem,
} from './db/lumaDb';
import {
  buildChannelCatalog,
  DEMO_SERIES_CATALOG,
  DEMO_VOD_CATALOG,
  getCurrentAndNextProgram,
  VERIFIED_HLS_STREAMS,
} from './data/mockCatalog';
import { buildCatchupStreamUrl } from './engine/catchupUrlBuilder';
import { isLocalRustProxyEndpoint } from './engine/corsProxy';
import {
  probeTauriNativeEngine,
  type NativeEngineProbe,
} from './engine/tauriNativeBridge';
import {
  cycleNextLocale,
  detectSystemLocale,
  normalizeLocale,
  TRANSLATIONS,
  type LumaPreferences,
} from './i18n/translations';
import { isProviderDividerChannel } from './services/channelSearch';
import type {
  LumaSyncPlainPayload,
  WatchHistoryEntry,
} from './services/lumaCloudSync';
import { syncOsMediaSession } from './services/mediaSession';
import { useSpatialDpadFocus } from './services/spatialNavigation';
import {
  useCrossPlatformFileDropAndLaunch,
  useUniversalGamepadControls,
} from './services/universalInput';
import {
  detectPlatformEnvironment,
  resolveAllowedDesignMode,
} from './services/platformDetection';
import {
  bulkSetChannelsHidden,
  deletePersistedSource,
  fetchXtreamSeriesEpisodes,
  importM3uPlaylist,
  importXmltvForSource,
  importXtreamSource,
  loadPersistedSourceBundle,
  refreshSourceAccountInfo,
  renamePersistedSource,
  renameStoredChannel,
  resyncPersistedSource,
  toggleHideStoredChannel,
  updateSourceHiddenGroups,
  type IngestProgressState,
} from './services/playlistService';
import {
  ChannelContextMenu,
  type ChannelContextMenuTarget,
} from './components/common/ChannelContextMenu';
import { CommandBar } from './components/command/CommandBar';
import { VirtualizedEpgGrid } from './components/epg/VirtualizedEpgGrid';
import { CustomTitlebar } from './components/layout/CustomTitlebar';
import { Sidebar } from './components/layout/Sidebar';
import { InAppPipWindow } from './components/player/InAppPipWindow';
import { MultiviewGrid } from './components/player/MultiviewGrid';
import { PlayerStage } from './components/player/PlayerStage';
import { ParentalPinModal } from './components/views/ChannelStudioView';
import {
  CollectionsView,
  FavoritesView,
} from './components/views/FavoritesAndCollectionsViews';
import {
  HomeHubView,
  SeriesBrowserView,
} from './components/views/HomeAndSeriesHub';
import { LiveTvView } from './components/views/LiveTvView';
import {
  MediaDetailModal,
  type MediaInspectTarget,
} from './components/views/MediaDetailModal';
import {
  CatchupArchiveView,
  SourcesEngineView,
  VodCatalogView,
} from './components/views/SecondaryViews';
import { SettingsHubView } from './components/views/SettingsHubView';
import type {
  Channel,
  ChannelGroup,
  CustomBouquet,
  EngineProxyConfig,
  EpgProgram,
  EpgReminder,
  NavigationSection,
  ParentalControlConfig,
  PlatformDesignMode,
  SeriesEpisode,
  SeriesItem,
  VodItem,
} from './types/luma';

const DEFAULT_FAVORITES = [
  'ch-redbull-tv',
  'ch-luma-cinema-4k',
  'ch-dw-global',
  'ch-nasa-public',
];

const DEFAULT_BOUQUETS: CustomBouquet[] = [
  {
    id: 'bq-weekend-sport',
    name: 'Wochenende Live-Sport',
    channelIds: ['ch-redbull-tv', 'ch-mux-motorsport', 'ch-nasa-public'],
    isPinLocked: false,
  },
];

const DEFAULT_PARENTAL: ParentalControlConfig = {
  enabled: true,
  pin: '0000',
  lockedGroupIds: [],
};

export function App() {
  const platformEnv = useMemo(() => detectPlatformEnvironment(), []);
  const [designMode, setDesignModeState] = useState<PlatformDesignMode>(() => {
    try {
      const saved = localStorage.getItem('luma.design.v1') as PlatformDesignMode | null;
      return resolveAllowedDesignMode(
        saved ?? platformEnv.defaultDesignMode,
        platformEnv.isApple
      );
    } catch {
      return platformEnv.defaultDesignMode;
    }
  });

  const handleChangeDesignMode = useCallback(
    (requested: PlatformDesignMode) => {
      const allowed = resolveAllowedDesignMode(requested, platformEnv.isApple);
      setDesignModeState(allowed);
      try {
        localStorage.setItem('luma.design.v1', allowed);
      } catch {
        // Ignore
      }
    },
    [platformEnv.isApple]
  );
  const [preferences, setPreferences] = useState<LumaPreferences>(() => {
    try {
      const raw = localStorage.getItem('luma.prefs.v3');
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<LumaPreferences>;
        return {
          locale: normalizeLocale(parsed.locale ?? detectSystemLocale()),
          bufferProfile: parsed.bufferProfile ?? 'balanced',
          sleepTimerMinutes: parsed.sleepTimerMinutes ?? 0,
          spatialDpadEnabled: parsed.spatialDpadEnabled ?? true,
          autoMiniPlayerOnSwitch: Boolean(parsed.autoMiniPlayerOnSwitch ?? false),
        };
      }
    } catch {
      // Ignore
    }
    return {
      locale: detectSystemLocale(),
      bufferProfile: 'balanced',
      sleepTimerMinutes: 0,
      spatialDpadEnabled: true,
      autoMiniPlayerOnSwitch: false,
    };
  });

  const handleUpdatePreferences = useCallback((next: LumaPreferences) => {
    setPreferences(next);
    try {
      localStorage.setItem('luma.prefs.v3', JSON.stringify(next));
    } catch {
      // Ignore
    }
  }, []);

  const [sleepDeadlineMs, setSleepDeadlineMs] = useState<number | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState<boolean>(false);
  const [inspectMedia, setInspectMedia] = useState<MediaInspectTarget | null>(null);
  const [channelMenuTarget, setChannelMenuTarget] =
    useState<ChannelContextMenuTarget | null>(null);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeSection, setActiveSection] = useState<NavigationSection>('live');
  const [selectedGroupId, setSelectedGroupId] = useState<string>('all');
  const [focusedSeriesId, setFocusedSeriesId] = useState<string | null>(null);
  const [stressMode20k, setStressMode20k] = useState<boolean>(false);
  const [ambilightEnabled, setAmbilightEnabled] = useState<boolean>(true);
  const [theaterExpanded, setTheaterExpanded] = useState<boolean>(false);
  const [commandBarOpen, setCommandBarOpen] = useState<boolean>(false);
  const [globalAmbientRgb, setGlobalAmbientRgb] = useState<string>('56, 189, 248');

  // Persistent Player Audio State (defaults unmuted; unmutes cleanly on channel selection)
  const [playerAudio, setPlayerAudio] = useState<{ muted: boolean; volume: number }>(() => {
    try {
      const raw = localStorage.getItem('luma.audio.v2');
      if (raw) {
        const parsed = JSON.parse(raw) as { muted?: boolean; volume?: number };
        const vol =
          typeof parsed.volume === 'number' && parsed.volume > 0 ? parsed.volume : 0.85;
        return {
          muted: Boolean(parsed.muted ?? false),
          volume: vol,
        };
      }
    } catch {
      // Ignore
    }
    return { muted: false, volume: 0.85 };
  });

  const handleChangeMuted = useCallback((muted: boolean) => {
    setPlayerAudio((prev) => {
      const next = { ...prev, muted };
      try {
        localStorage.setItem('luma.audio.v2', JSON.stringify(next));
      } catch {
        // Ignore
      }
      return next;
    });
  }, []);

  const handleChangeVolume = useCallback((volume: number) => {
    setPlayerAudio((prev) => {
      const next = { ...prev, volume };
      try {
        localStorage.setItem('luma.audio.v2', JSON.stringify(next));
      } catch {
        // Ignore
      }
      return next;
    });
  }, []);

  const ensureAudioUnmutedForSwitch = useCallback(() => {
    setPlayerAudio((prev) => {
      if (!prev.muted && prev.volume > 0) return prev;
      const next = {
        muted: false,
        volume: prev.volume > 0 ? prev.volume : 0.85,
      };
      try {
        localStorage.setItem('luma.audio.v2', JSON.stringify(next));
      } catch {
        // Ignore
      }
      return next;
    });
  }, []);

  const [detachedPipInEpg, setDetachedPipInEpg] = useState<boolean>(false);
  const [pipDismissedWhileBrowsing, setPipDismissedWhileBrowsing] =
    useState<boolean>(false);

  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [epgOffsetHours, setEpgOffsetHours] = useState<number>(0);
  const [nativeProbe, setNativeProbe] = useState<NativeEngineProbe | null>(null);
  const [proxyConfig, setProxyConfig] = useState<EngineProxyConfig>({
    enabled: false,
    endpointUrl: 'https://luma-tv-app.web.app/api/stream-proxy',
    customUserAgent: 'LumaTV/0.7 (TiviMate-Compatible)',
    autoFallbackOnCors: true,
  });

  useEffect(() => {
    let cancelled = false;
    probeTauriNativeEngine()
      .then((probe) => {
        if (cancelled) return;
        setNativeProbe(probe);
        if (probe.available && probe.localProxyUrl) {
          setProxyConfig((prev) => {
            const cur = prev.endpointUrl.trim();
            const isDefaultOrStaleLoopback =
              !cur ||
              cur === 'https://luma-tv-app.web.app/api/stream-proxy' ||
              isLocalRustProxyEndpoint(cur);
            return isDefaultOrStaleLoopback
              ? { ...prev, endpointUrl: probe.localProxyUrl! }
              : prev;
          });
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const effectiveProxyConfig = useMemo<EngineProxyConfig>(
    () => ({
      ...proxyConfig,
      bufferProfile: preferences.bufferProfile,
    }),
    [proxyConfig, preferences.bufferProfile]
  );

  // Sync Sleep Timer Deadline
  useEffect(() => {
    if (preferences.sleepTimerMinutes <= 0) {
      setSleepDeadlineMs(null);
    } else {
      setSleepDeadlineMs(Date.now() + preferences.sleepTimerMinutes * 60_000);
    }
  }, [preferences.sleepTimerMinutes]);

  const sleepRemainingSec =
    sleepDeadlineMs !== null ? Math.max(0, Math.round((sleepDeadlineMs - nowMs) / 1000)) : null;

  const [customBouquets, setCustomBouquets] = useState<CustomBouquet[]>(() => {
    try {
      const raw = localStorage.getItem('luma.bouquets.v1');
      if (raw) return JSON.parse(raw) as CustomBouquet[];
    } catch {
      // Ignore
    }
    return DEFAULT_BOUQUETS;
  });

  const [parentalConfig, setParentalConfig] = useState<ParentalControlConfig>(() => {
    try {
      const raw = localStorage.getItem('luma.parental.v1');
      if (raw) return JSON.parse(raw) as ParentalControlConfig;
    } catch {
      // Ignore
    }
    return DEFAULT_PARENTAL;
  });

  const [unlockedGroupIds, setUnlockedGroupIds] = useState<Set<string>>(() => new Set());
  const [pendingPinGroup, setPendingPinGroup] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const handleUpdateBouquets = useCallback((next: CustomBouquet[]) => {
    setCustomBouquets(next);
    try {
      localStorage.setItem('luma.bouquets.v1', JSON.stringify(next));
    } catch {
      // Ignore
    }
  }, []);

  const handleToggleTargetInCollection = useCallback(
    (collectionId: string, target: ChannelContextMenuTarget) => {
      setCustomBouquets((prev) => {
        const next = prev.map((col) => {
          if (col.id !== collectionId) return col;
          if (target.channel) {
            const cid = target.channel.id;
            const exists = col.channelIds.includes(cid);
            return {
              ...col,
              channelIds: exists
                ? col.channelIds.filter((id) => id !== cid)
                : [...col.channelIds, cid],
            };
          }
          if (target.series) {
            const sid = target.series.id;
            const prevSeries = col.seriesIds ?? [];
            const exists = prevSeries.includes(sid);
            return {
              ...col,
              seriesIds: exists
                ? prevSeries.filter((id) => id !== sid)
                : [...prevSeries, sid],
            };
          }
          return col;
        });
        try {
          localStorage.setItem('luma.bouquets.v1', JSON.stringify(next));
        } catch {
          // Ignore
        }
        return next;
      });
    },
    []
  );

  const handleCreateCollectionWithTarget = useCallback(
    (name: string, target: ChannelContextMenuTarget) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setCustomBouquets((prev) => {
        const created: CustomBouquet = {
          id: `col-${Date.now()}`,
          name: trimmed,
          channelIds: target.channel ? [target.channel.id] : [],
          seriesIds: target.series ? [target.series.id] : [],
          isPinLocked: false,
        };
        const next = [...prev, created];
        try {
          localStorage.setItem('luma.bouquets.v1', JSON.stringify(next));
        } catch {
          // Ignore
        }
        return next;
      });
      setToastMessage(`Added to "${trimmed}"`);
      window.setTimeout(() => setToastMessage(null), 2600);
    },
    []
  );

  const handleUpdateParental = useCallback((next: ParentalControlConfig) => {
    setParentalConfig(next);
    try {
      localStorage.setItem('luma.parental.v1', JSON.stringify(next));
    } catch {
      // Ignore
    }
  }, []);

  const [demoSourceDeleted, setDemoSourceDeleted] = useState<boolean>(() => {
    try {
      return localStorage.getItem('luma.demoDeleted.v1') === '1';
    } catch {
      return false;
    }
  });

  const [activeSourceId, setActiveSourceIdState] = useState<string>(() => {
    try {
      const demoRemoved = localStorage.getItem('luma.demoDeleted.v1') === '1';
      const saved = localStorage.getItem('luma.activeSource.v1');
      if (saved && !(demoRemoved && saved === 'builtin-reference')) {
        return saved;
      }
      return demoRemoved ? 'none' : 'builtin-reference';
    } catch {
      return 'builtin-reference';
    }
  });

  const handleSelectSourceId = useCallback((nextId: string) => {
    setActiveSourceIdState(nextId);
    setSelectedGroupId('all');
    try {
      localStorage.setItem('luma.activeSource.v1', nextId);
    } catch {
      // Ignore
    }
  }, []);

  const [persistedSources, setPersistedSources] = useState<StoredPlaylistSource[]>([]);
  const [persistedChannels, setPersistedChannels] = useState<StoredChannel[]>([]);
  const [crossSourceLookupChannels, setCrossSourceLookupChannels] = useState<
    StoredChannel[]
  >([]);
  const [persistedVod, setPersistedVod] = useState<StoredVodItem[]>([]);
  const [persistedSeries, setPersistedSeries] = useState<StoredSeriesItem[]>([]);
  const [crossSourceLookupSeries, setCrossSourceLookupSeries] = useState<
    StoredSeriesItem[]
  >([]);
  const [loadingSeriesIds, setLoadingSeriesIds] = useState<Set<string>>(() => new Set());
  const [xmltvMap, setXmltvMap] = useState<Map<string, StoredEpgProgram[]>>(() => new Map());
  const [ingestState, setIngestState] = useState<IngestProgressState>({
    active: false,
    phase: '',
    percent: 0,
  });

  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('luma.favorites.v1');
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch {
      // Ignore
    }
    return new Set(DEFAULT_FAVORITES);
  });

  const [favoriteSeriesIds, setFavoriteSeriesIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('luma.favoriteSeries.v1');
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch {
      // Ignore
    }
    return new Set();
  });

  const toggleFavoriteSeries = useCallback((seriesId: string) => {
    setFavoriteSeriesIds((prev) => {
      const next = new Set(prev);
      if (next.has(seriesId)) next.delete(seriesId);
      else next.add(seriesId);
      try {
        localStorage.setItem('luma.favoriteSeries.v1', JSON.stringify(Array.from(next)));
      } catch {
        // Ignore
      }
      return next;
    });
  }, []);

  useEffect(() => {
    lumaDb.sources
      .orderBy('createdAt')
      .reverse()
      .toArray()
      .then((list) => {
        setPersistedSources(list);
        setActiveSourceIdState((cur) => {
          if (list.some((s) => s.id === cur)) return cur;
          // Auto-select user's real playlist if no explicit valid playlist was active
          if (list.length > 0) {
            const saved = localStorage.getItem('luma.activeSource.v1');
            if (!saved || cur === 'none' || demoSourceDeleted) {
              localStorage.setItem('luma.activeSource.v1', list[0].id);
              return list[0].id;
            }
          }
          if (!demoSourceDeleted && cur !== 'none') return 'builtin-reference';
          return list[0]?.id ?? 'none';
        });
      })
      .catch(() => undefined);
  }, [demoSourceDeleted]);

  const refreshActiveSourceBundle = useCallback(async (sourceId: string) => {
    if (sourceId === 'builtin-reference' || sourceId === 'none') {
      if (sourceId === 'none') {
        setPersistedChannels([]);
        setPersistedVod([]);
        setPersistedSeries([]);
        setXmltvMap(new Map());
      }
      return;
    }
    const bundle = await loadPersistedSourceBundle(sourceId);
    setPersistedChannels(bundle.channels);
    setPersistedVod(bundle.vodItems);
    setPersistedSeries(bundle.seriesItems);
    setXmltvMap(bundle.epgByTvgId);
  }, []);

  useEffect(() => {
    if (activeSourceId === 'builtin-reference' || activeSourceId === 'none') return;
    let cancelled = false;
    loadPersistedSourceBundle(activeSourceId)
      .then((bundle) => {
        if (cancelled) return;
        setPersistedChannels(bundle.channels);
        setPersistedVod(bundle.vodItems);
        setPersistedSeries(bundle.seriesItems);
        setXmltvMap(bundle.epgByTvgId);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeSourceId]);

  // Resolve any Favorite or Collection channel IDs stored in IndexedDB across ALL playlists
  useEffect(() => {
    const neededIds = new Set<string>(favoriteIds);
    for (const bq of customBouquets) {
      for (const cid of bq.channelIds) neededIds.add(cid);
    }
    if (neededIds.size === 0) {
      setCrossSourceLookupChannels([]);
      return;
    }
    let cancelled = false;
    lumaDb.channels
      .bulkGet(Array.from(neededIds))
      .then((rows) => {
        if (cancelled) return;
        setCrossSourceLookupChannels(
          rows.filter((r): r is StoredChannel => Boolean(r))
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [favoriteIds, customBouquets, persistedSources]);

  // Resolve any Favorite or Collection series IDs stored in IndexedDB across ALL playlists
  useEffect(() => {
    const neededSeriesIds = new Set<string>(favoriteSeriesIds);
    for (const bq of customBouquets) {
      for (const sid of bq.seriesIds ?? []) neededSeriesIds.add(sid);
    }
    if (neededSeriesIds.size === 0) {
      setCrossSourceLookupSeries([]);
      return;
    }
    let cancelled = false;
    lumaDb.seriesItems
      .bulkGet(Array.from(neededSeriesIds))
      .then((rows) => {
        if (cancelled) return;
        setCrossSourceLookupSeries(
          rows.filter((r): r is StoredSeriesItem => Boolean(r))
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [favoriteSeriesIds, customBouquets, persistedSources]);

  const builtinCatalog = useMemo(
    () => buildChannelCatalog(stressMode20k ? 20_400 : 2_400),
    [stressMode20k]
  );

  const activeStoredSource = useMemo(
    () => persistedSources.find((s) => s.id === activeSourceId) ?? null,
    [persistedSources, activeSourceId]
  );

  const quickPlaylistOptions = useMemo(() => {
    const list: { id: string; name: string; channelCount: number }[] =
      persistedSources.map((s) => ({
        id: s.id,
        name: s.name,
        channelCount: s.channelCount,
      }));
    if (!demoSourceDeleted) {
      list.push({
        id: 'builtin-reference',
        name: 'Luma Demo',
        channelCount: builtinCatalog.channels.length,
      });
    }
    return list;
  }, [persistedSources, demoSourceDeleted, builtinCatalog.channels.length]);

  const { channels, baseGroups }: { channels: Channel[]; baseGroups: ChannelGroup[] } =
    useMemo(() => {
      if (activeSourceId === 'none') {
        return { channels: [], baseGroups: [] };
      }
      if (activeSourceId === 'builtin-reference' && !demoSourceDeleted) {
        return { channels: builtinCatalog.channels, baseGroups: builtinCatalog.groups };
      }
      const hiddenGroups = new Set(activeStoredSource?.hiddenGroupIds ?? []);
      const visibleStored = persistedChannels.filter(
        (c) => !c.isHidden && !hiddenGroups.has(c.groupId)
      );
      const counts = new Map<string, { name: string; count: number }>();
      for (const ch of visibleStored) {
        const prev = counts.get(ch.groupId);
        if (prev) prev.count += 1;
        else counts.set(ch.groupId, { name: ch.groupName, count: 1 });
      }
      const derivedGroups: ChannelGroup[] = Array.from(counts.entries()).map(
        ([id, meta]) => ({
          id,
          name: meta.name,
          icon: 'Tv',
          count: meta.count,
        })
      );
      return {
        channels:
          visibleStored.length > 0
            ? visibleStored
            : persistedChannels.length > 0
              ? persistedChannels.slice(0, 1)
              : demoSourceDeleted
                ? []
                : builtinCatalog.channels,
        baseGroups: derivedGroups,
      };
    }, [
      activeSourceId,
      demoSourceDeleted,
      activeStoredSource,
      persistedChannels,
      builtinCatalog,
    ]);

  // Unified lookup pool for Favorites & Collections (includes hidden-group & cross-playlist channels)
  const collectionAndFavoritePool: Channel[] = useMemo(() => {
    const map = new Map<string, Channel>();
    for (const ch of persistedChannels) map.set(ch.id, ch);
    for (const ch of crossSourceLookupChannels) map.set(ch.id, ch);
    if (!demoSourceDeleted) {
      for (const ch of builtinCatalog.channels) {
        if (!map.has(ch.id)) map.set(ch.id, ch);
      }
    }
    return Array.from(map.values());
  }, [persistedChannels, crossSourceLookupChannels, demoSourceDeleted, builtinCatalog]);

  const groups: ChannelGroup[] = useMemo(() => {
    const bouquetGroups: ChannelGroup[] = customBouquets.map((bq) => ({
      id: bq.id,
      name: bq.name,
      icon: 'FolderHeart',
      count: bq.channelIds.length,
      isCustomBouquet: true,
      isPinLocked:
        parentalConfig.enabled &&
        (bq.isPinLocked || parentalConfig.lockedGroupIds.includes(bq.id)),
    }));

    const standardGroups: ChannelGroup[] = baseGroups.map((g) => ({
      ...g,
      isPinLocked:
        parentalConfig.enabled && parentalConfig.lockedGroupIds.includes(g.id),
    }));

    return [...bouquetGroups, ...standardGroups];
  }, [customBouquets, baseGroups, parentalConfig]);

  const collectionAndFavoriteSeriesPool: SeriesItem[] = useMemo(() => {
    const map = new Map<string, SeriesItem>();
    for (const ser of persistedSeries) map.set(ser.id, ser);
    for (const ser of crossSourceLookupSeries) map.set(ser.id, ser);
    if (!demoSourceDeleted) {
      for (const ser of DEMO_SERIES_CATALOG) {
        if (!map.has(ser.id)) map.set(ser.id, ser);
      }
    }
    return Array.from(map.values());
  }, [persistedSeries, crossSourceLookupSeries, demoSourceDeleted]);

  const combinedVodCatalog: VodItem[] = useMemo(
    () =>
      activeSourceId === 'builtin-reference' && !demoSourceDeleted
        ? DEMO_VOD_CATALOG
        : persistedVod,
    [activeSourceId, demoSourceDeleted, persistedVod]
  );

  const combinedSeriesCatalog: SeriesItem[] = useMemo(
    () =>
      activeSourceId === 'builtin-reference' && !demoSourceDeleted
        ? DEMO_SERIES_CATALOG
        : persistedSeries,
    [activeSourceId, demoSourceDeleted, persistedSeries]
  );

  const [activeChannelId, setActiveChannelId] = useState<string>('ch-redbull-tv');
  const [activeOnDemand, setActiveOnDemand] = useState<{
    itemId: string;
    kind: 'vod' | 'catchup';
    title: string;
    subtitle: string;
    streamUrl: string;
    initialResumeSec: number;
    fallbackDurationSec: number;
    nextEpisode?: {
      label: string;
      series: SeriesItem;
      seasonNumber: number;
      episode: SeriesEpisode;
    };
  } | null>(null);
  const [timeshiftProgram, setTimeshiftProgram] = useState<EpgProgram | null>(null);
  const [timeshiftStreamUrl, setTimeshiftStreamUrl] = useState<string | null>(null);
  const [timeshiftResumeSec, setTimeshiftResumeSec] = useState<number>(0);

  const [multiviewSlotIds, setMultiviewSlotIds] = useState<string[]>([
    'ch-redbull-tv',
    'ch-luma-cinema-4k',
    'ch-dw-global',
    'ch-nasa-public',
  ]);
  const [multiviewAudioSlot, setMultiviewAudioSlot] = useState<number>(0);
  const [multiviewMuted, setMultiviewMuted] = useState<boolean>(true);

  const [numericBuffer, setNumericBuffer] = useState<string>('');
  const numericTimerRef = useRef<number | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNowMs(current);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Trigger Sleep Timer Pause when countdown hits zero
  useEffect(() => {
    if (sleepRemainingSec === 0 && sleepDeadlineMs !== null) {
      document.querySelectorAll('video').forEach((v) => v.pause());
      handleUpdatePreferences({ ...preferences, sleepTimerMinutes: 0 });
      setSleepDeadlineMs(null);
      setToastMessage(
        preferences.locale === 'de'
          ? 'Sleep-Timer abgelaufen — Wiedergabe pausiert.'
          : 'Sleep Timer reached — playback paused.'
      );
      window.setTimeout(() => setToastMessage(null), 4000);
    }
  }, [sleepRemainingSec, sleepDeadlineMs, preferences, handleUpdatePreferences]);

  const toggleFavorite = useCallback((channelId: string) => {
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (next.has(channelId)) next.delete(channelId);
      else next.add(channelId);
      try {
        localStorage.setItem('luma.favorites.v1', JSON.stringify(Array.from(next)));
      } catch {
        // Ignore
      }
      return next;
    });
  }, []);

  const visibleChannels = useMemo(() => {
    if (selectedGroupId === 'all') return channels;
    if (selectedGroupId === 'favorites') {
      return collectionAndFavoritePool.filter((c) => favoriteIds.has(c.id));
    }
    const customBq = customBouquets.find((b) => b.id === selectedGroupId);
    if (customBq) {
      const byId = new Map(collectionAndFavoritePool.map((c) => [c.id, c]));
      return customBq.channelIds
        .map((id) => byId.get(id))
        .filter((c): c is Channel => Boolean(c));
    }
    return channels.filter((c) => c.groupId === selectedGroupId);
  }, [channels, collectionAndFavoritePool, selectedGroupId, favoriteIds, customBouquets]);

  const activeChannel: Channel = useMemo(
    () =>
      channels.find((c) => c.id === activeChannelId) ??
      collectionAndFavoritePool.find((c) => c.id === activeChannelId) ??
      channels.find((c) => !isProviderDividerChannel(c.name)) ??
      channels[0] ??
      builtinCatalog.channels[0],
    [channels, collectionAndFavoritePool, activeChannelId, builtinCatalog.channels]
  );

  const [watchHistory, setWatchHistory] = useState<WatchHistoryEntry[]>(() => {
    try {
      const raw = localStorage.getItem('luma.watch.history.v1');
      if (raw) return JSON.parse(raw) as WatchHistoryEntry[];
    } catch {
      // Ignore
    }
    return [
      {
        itemId: 'ep-orb-s1e1',
        title: 'Orbital Horizon · S01E01 Apogäum 420 km',
        kind: 'vod',
        resumeSec: 1140,
        durationSec: 3120,
        updatedAt: Date.now() - 120_000,
      },
      {
        itemId: 'vod-tears-of-steel',
        title: 'Tears of Steel (4K Open Master)',
        kind: 'vod',
        resumeSec: 1620,
        durationSec: 4440,
        updatedAt: Date.now() - 360_000,
      },
      {
        itemId: 'ch-redbull-tv',
        title: 'Red Bull TV HD',
        kind: 'live',
        resumeSec: 0,
        durationSec: 0,
        updatedAt: Date.now() - 600_000,
      },
    ];
  });

  const recordHistory = useCallback((entry: WatchHistoryEntry) => {
    setWatchHistory((prev) => {
      const next = [entry, ...prev.filter((x) => x.itemId !== entry.itemId)].slice(0, 24);
      try {
        localStorage.setItem('luma.watch.history.v1', JSON.stringify(next));
      } catch {
        // Ignore
      }
      return next;
    });
  }, []);

  const selectLiveChannel = useCallback(
    (ch: Channel) => {
      ensureAudioUnmutedForSwitch();
      setActiveChannelId(ch.id);
      setActiveOnDemand(null);
      setTimeshiftProgram(null);
      setTimeshiftStreamUrl(null);
      setTimeshiftResumeSec(0);
      setDetachedPipInEpg(false);
      setActiveSection((cur) => (cur === 'live-epg' ? 'live-epg' : 'live'));
      recordHistory({
        itemId: ch.id,
        title: ch.name,
        kind: 'live',
        resumeSec: 0,
        durationSec: 0,
        updatedAt: Date.now(),
      });
    },
    [ensureAudioUnmutedForSwitch, recordHistory]
  );

  const handleSelectSidebarGroup = useCallback(
    (groupId: string) => {
      if (groupId === 'all' || groupId === 'favorites') {
        setSelectedGroupId(groupId);
        setActiveSection((cur) => (cur === 'live-epg' ? 'live-epg' : 'live'));
        return;
      }
      const grp = groups.find((g) => g.id === groupId);
      if (grp?.isPinLocked && !unlockedGroupIds.has(groupId)) {
        setPendingPinGroup({ id: grp.id, name: grp.name });
        return;
      }
      setSelectedGroupId(groupId);
      setActiveSection((cur) => (cur === 'live-epg' ? 'live-epg' : 'live'));
    },
    [groups, unlockedGroupIds]
  );

  const handleStartTimeshift = useCallback(
    (ch: Channel, program: EpgProgram) => {
      ensureAudioUnmutedForSwitch();
      const catchupUrl = buildCatchupStreamUrl(ch, program, Date.now());
      const durationSec = Math.max(60, Math.round((program.endMs - program.startMs) / 1000));
      const existingResume =
        watchHistory.find((w) => w.itemId === program.id)?.resumeSec ?? 0;

      setActiveChannelId(ch.id);
      setActiveOnDemand(null);
      setTimeshiftProgram(program);
      setTimeshiftStreamUrl(catchupUrl);
      setTimeshiftResumeSec(existingResume);
      setDetachedPipInEpg(false);
      recordHistory({
        itemId: program.id,
        title: `${ch.shortCode}: ${program.title}`,
        kind: 'catchup',
        resumeSec: existingResume,
        durationSec,
        updatedAt: Date.now(),
      });
      setActiveSection((cur) => (cur === 'live-epg' ? 'live-epg' : 'live'));
    },
    [ensureAudioUnmutedForSwitch, recordHistory, watchHistory]
  );

  const handlePlayVod = useCallback(
    (vod: VodItem, explicitResumeSec?: number) => {
      ensureAudioUnmutedForSwitch();
      const existingResume =
        explicitResumeSec ??
        watchHistory.find((w) => w.itemId === vod.id)?.resumeSec ??
        0;
      const durationSec = Math.max(60, vod.durationMin * 60);

      setActiveOnDemand({
        itemId: vod.id,
        kind: 'vod',
        title: vod.title,
        subtitle: `${vod.genre} · ${vod.year} · ${vod.durationMin} min`,
        streamUrl: vod.streamUrl,
        initialResumeSec: existingResume,
        fallbackDurationSec: durationSec,
      });
      setTimeshiftProgram(null);
      setTimeshiftStreamUrl(null);
      setDetachedPipInEpg(false);
      setActiveSection('live');
      recordHistory({
        itemId: vod.id,
        title: vod.title,
        kind: 'vod',
        resumeSec: existingResume,
        durationSec,
        updatedAt: Date.now(),
      });
    },
    [ensureAudioUnmutedForSwitch, recordHistory, watchHistory]
  );

  const handlePlaySeriesEpisode = useCallback(
    (
      series: SeriesItem,
      seasonNum: number,
      ep: SeriesEpisode,
      explicitResumeSec?: number
    ) => {
      const existingResume =
        explicitResumeSec ??
        watchHistory.find((w) => w.itemId === ep.id)?.resumeSec ??
        0;
      const durationSec = Math.max(60, ep.durationMin * 60);
      const code = `S${String(seasonNum).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')}`;
      const fullTitle = `${series.title.split('·')[0].trim()} · ${code} ${ep.title}`;

      // Resolve next episode in current season or first episode of next season
      let nextEpisode:
        | {
            label: string;
            series: SeriesItem;
            seasonNumber: number;
            episode: SeriesEpisode;
          }
        | undefined;
      const sIdx = series.seasons.findIndex((s) => s.seasonNumber === seasonNum);
      if (sIdx >= 0) {
        const curSeason = series.seasons[sIdx];
        const eIdx = curSeason.episodes.findIndex((e) => e.id === ep.id);
        if (eIdx >= 0 && eIdx + 1 < curSeason.episodes.length) {
          const nextEp = curSeason.episodes[eIdx + 1];
          nextEpisode = {
            label: `S${String(seasonNum).padStart(2, '0')}E${String(nextEp.episodeNumber).padStart(2, '0')}`,
            series,
            seasonNumber: seasonNum,
            episode: nextEp,
          };
        } else if (sIdx + 1 < series.seasons.length) {
          const nextSea = series.seasons[sIdx + 1];
          const firstEp = nextSea.episodes[0];
          if (firstEp) {
            nextEpisode = {
              label: `S${String(nextSea.seasonNumber).padStart(2, '0')}E${String(firstEp.episodeNumber).padStart(2, '0')}`,
              series,
              seasonNumber: nextSea.seasonNumber,
              episode: firstEp,
            };
          }
        }
      }

      ensureAudioUnmutedForSwitch();
      setActiveOnDemand({
        itemId: ep.id,
        kind: 'vod',
        title: fullTitle,
        subtitle: `${series.genre} · ${ep.durationMin} min · ${ep.resolution}`,
        streamUrl: ep.streamUrl,
        initialResumeSec: existingResume,
        fallbackDurationSec: durationSec,
        nextEpisode,
      });
      setTimeshiftProgram(null);
      setTimeshiftStreamUrl(null);
      setDetachedPipInEpg(false);
      setActiveSection('live');
      recordHistory({
        itemId: ep.id,
        title: fullTitle,
        kind: 'vod',
        resumeSec: existingResume,
        durationSec,
        updatedAt: Date.now(),
      });
    },
    [ensureAudioUnmutedForSwitch, recordHistory, watchHistory]
  );

  const handleEnsureSeriesLoaded = useCallback(
    async (series: SeriesItem) => {
      if (!series.xtreamSeriesId || series.seasonsLoaded) return;
      let shouldFetch = false;
      setLoadingSeriesIds((prev) => {
        if (prev.has(series.id)) return prev;
        shouldFetch = true;
        return new Set([...prev, series.id]);
      });
      if (!shouldFetch) return;

      try {
        const src = persistedSources.find((s) => s.id === activeSourceId) ?? null;
        const proxyEndpoint =
          proxyConfig.enabled || isLocalRustProxyEndpoint(proxyConfig.endpointUrl)
            ? proxyConfig.endpointUrl
            : undefined;
        const seasons = await fetchXtreamSeriesEpisodes({
          source: src,
          series,
          fallbackChannelUrl: persistedChannels[0]?.streamUrl,
          proxyEndpoint,
        });
        setPersistedSeries((prev) =>
          prev.map((s) =>
            s.id === series.id ? { ...s, seasons, seasonsLoaded: true } : s
          )
        );
      } catch {
        // Keep series card browsable even if provider series_info fails
      } finally {
        setLoadingSeriesIds((prev) => {
          const next = new Set(prev);
          next.delete(series.id);
          return next;
        });
      }
    },
    [activeSourceId, persistedChannels, persistedSources, proxyConfig]
  );

  const zapRelative = useCallback(
    (delta: number) => {
      const list = visibleChannels.length > 0 ? visibleChannels : channels;
      const idx = list.findIndex((c) => c.id === activeChannel.id);
      const nextIdx = idx >= 0 ? (idx + delta + list.length) % list.length : 0;
      const target = list[nextIdx];
      if (target) selectLiveChannel(target);
    },
    [visibleChannels, channels, activeChannel.id, selectLiveChannel]
  );

  useEffect(() => {
    const { current } = getCurrentAndNextProgram(activeChannel, nowMs, epgOffsetHours);
    const title = activeOnDemand?.title ?? timeshiftProgram?.title ?? current.title;
    syncOsMediaSession(activeChannel, title, {
      onPrevChannel: () => zapRelative(-1),
      onNextChannel: () => zapRelative(1),
    });
  }, [activeChannel, activeOnDemand, timeshiftProgram, nowMs, epgOffsetHours, zapRelative]);

  const handleRestoreFromSync = useCallback(
    (payload: LumaSyncPlainPayload) => {
      const restoredFavs = new Set(payload.favorites);
      setFavoriteIds(restoredFavs);
      setWatchHistory(payload.watchHistory);
      setEpgOffsetHours(payload.epgOffsetHours);
      handleChangeDesignMode(payload.preferredDesign);
      try {
        localStorage.setItem('luma.favorites.v1', JSON.stringify(payload.favorites));
        localStorage.setItem(
          'luma.watch.history.v1',
          JSON.stringify(payload.watchHistory)
        );
      } catch {
        // Ignore
      }
    },
    [handleChangeDesignMode]
  );

  const reloadSourcesList = async () => {
    const list = await lumaDb.sources.orderBy('createdAt').reverse().toArray();
    setPersistedSources(list);
  };

  const resolveIngestProxyEndpoint = useCallback(
    () =>
      proxyConfig.enabled || isLocalRustProxyEndpoint(proxyConfig.endpointUrl)
        ? proxyConfig.endpointUrl
        : undefined,
    [proxyConfig.enabled, proxyConfig.endpointUrl]
  );

  const handleRefreshAccountInfo = useCallback(
    async (source: StoredPlaylistSource) => {
      const info = await refreshSourceAccountInfo({
        source,
        fallbackChannelUrl: persistedChannels[0]?.streamUrl,
        proxyEndpoint: resolveIngestProxyEndpoint(),
      });
      if (info) {
        setPersistedSources((prev) =>
          prev.map((s) => (s.id === source.id ? { ...s, accountInfo: info } : s))
        );
      }
    },
    [persistedChannels, resolveIngestProxyEndpoint]
  );

  // Automatically fetch Xtream subscription expiry & connections for existing playlists
  useEffect(() => {
    if (!activeStoredSource || activeStoredSource.accountInfo) return;
    const hasXtreamCreds =
      (activeStoredSource.type === 'xtream' &&
        Boolean(activeStoredSource.username && activeStoredSource.password)) ||
      Boolean(activeStoredSource.rawUrlOrHost?.includes('username='));
    if (!hasXtreamCreds) return;

    let cancelled = false;
    refreshSourceAccountInfo({
      source: activeStoredSource,
      fallbackChannelUrl: persistedChannels[0]?.streamUrl,
      proxyEndpoint: resolveIngestProxyEndpoint(),
    })
      .then((info) => {
        if (cancelled || !info) return;
        setPersistedSources((prev) =>
          prev.map((s) =>
            s.id === activeStoredSource.id ? { ...s, accountInfo: info } : s
          )
        );
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [activeStoredSource, persistedChannels, resolveIngestProxyEndpoint]);

  const handleImportM3u = async (params: {
    name: string;
    url?: string;
    rawText?: string;
    xmltvUrl?: string;
  }) => {
    setIngestState({ active: true, phase: 'Starte M3U_Plus WebWorker…', percent: 8 });
    try {
      const source = await importM3uPlaylist({
        ...params,
        proxyEndpoint: resolveIngestProxyEndpoint(),
        onProgress: (phase, percent) => setIngestState({ active: true, phase, percent }),
      });
      await reloadSourcesList();
      handleSelectSourceId(source.id);
      await refreshActiveSourceBundle(source.id);
      setIngestState({
        active: false,
        phase: '',
        percent: 100,
        lastSummary: `M3U_Plus aktiv: ${source.channelCount.toLocaleString('de-DE')} Kanäle in IndexedDB gespeichert.`,
      });
    } catch (err) {
      setIngestState({
        active: false,
        phase: '',
        percent: 0,
        error: err instanceof Error ? err.message : 'M3U-Import fehlgeschlagen',
      });
    }
  };

  const handleImportXtream = async (params: {
    name: string;
    serverUrl: string;
    username: string;
    password: string;
    outputFormat: 'm3u8' | 'ts';
  }) => {
    setIngestState({ active: true, phase: 'Verbinde mit Xtream Codes API…', percent: 10 });
    try {
      const source = await importXtreamSource({
        ...params,
        proxyEndpoint: resolveIngestProxyEndpoint(),
        onProgress: (phase, percent) => setIngestState({ active: true, phase, percent }),
      });
      await reloadSourcesList();
      handleSelectSourceId(source.id);
      await refreshActiveSourceBundle(source.id);
      setIngestState({
        active: false,
        phase: '',
        percent: 100,
        lastSummary: `Xtream aktiv: ${source.channelCount.toLocaleString('de-DE')} Streams synchronisiert.`,
      });
    } catch (err) {
      setIngestState({
        active: false,
        phase: '',
        percent: 0,
        error: err instanceof Error ? err.message : 'Xtream-Verbindung fehlgeschlagen',
      });
    }
  };

  const handleUploadXmltvBuffer = async (buffer: ArrayBuffer) => {
    if (activeSourceId === 'builtin-reference') return;
    setIngestState({ active: true, phase: 'Lese XMLTV Datei im WebWorker…', percent: 15 });
    try {
      const count = await importXmltvForSource({
        sourceId: activeSourceId,
        rawBuffer: buffer,
        onProgress: (phase, percent) => setIngestState({ active: true, phase, percent }),
      });
      await refreshActiveSourceBundle(activeSourceId);
      setIngestState({
        active: false,
        phase: '',
        percent: 100,
        lastSummary: `${count.toLocaleString('de-DE')} XMLTV-Sendungen in IndexedDB gespeichert.`,
      });
    } catch (err) {
      setIngestState({
        active: false,
        phase: '',
        percent: 0,
        error: err instanceof Error ? err.message : 'XMLTV-Fehler',
      });
    }
  };

  const handleDeleteSource = async (sourceId: string) => {
    await deletePersistedSource(sourceId);
    const remaining = await lumaDb.sources.orderBy('createdAt').reverse().toArray();
    setPersistedSources(remaining);
    if (activeSourceId === sourceId) {
      const nextId =
        remaining[0]?.id ?? (demoSourceDeleted ? 'none' : 'builtin-reference');
      handleSelectSourceId(nextId);
    }
  };

  const handleDeleteDemoSource = useCallback(() => {
    setDemoSourceDeleted(true);
    try {
      localStorage.setItem('luma.demoDeleted.v1', '1');
    } catch {
      // Ignore
    }
    // Remove built-in demo favorites & default demo bouquet so ghost demo items don't linger
    setFavoriteIds((prev) => {
      const next = new Set(Array.from(prev).filter((id) => !id.startsWith('ch-')));
      try {
        localStorage.setItem('luma.favorites.v1', JSON.stringify(Array.from(next)));
      } catch {
        // Ignore
      }
      return next;
    });
    setCustomBouquets((prev) => {
      const next = prev.filter((b) => b.id !== 'bq-weekend-sport');
      try {
        localStorage.setItem('luma.bouquets.v1', JSON.stringify(next));
      } catch {
        // Ignore
      }
      return next;
    });
    if (activeSourceId === 'builtin-reference') {
      handleSelectSourceId(persistedSources[0]?.id ?? 'none');
    }
  }, [activeSourceId, persistedSources, handleSelectSourceId]);

  const handleRestoreDemoSource = useCallback(() => {
    setDemoSourceDeleted(false);
    try {
      localStorage.removeItem('luma.demoDeleted.v1');
    } catch {
      // Ignore
    }
    handleSelectSourceId('builtin-reference');
  }, [handleSelectSourceId]);

  const handleRenameChannel = async (channelId: string, nextName: string) => {
    if (!nextName.trim()) return;
    await renameStoredChannel(channelId, nextName);
    await refreshActiveSourceBundle(activeSourceId);
  };

  const handleToggleHideChannel = async (channelId: string, hidden: boolean) => {
    await toggleHideStoredChannel(channelId, hidden);
    await refreshActiveSourceBundle(activeSourceId);
  };

  const handleBulkSetChannelsHidden = async (channelIds: string[], hidden: boolean) => {
    if (channelIds.length === 0) return;
    await bulkSetChannelsHidden(channelIds, hidden);
    await refreshActiveSourceBundle(activeSourceId);
    setToastMessage(
      hidden
        ? `${channelIds.length.toLocaleString()} channels hidden`
        : `${channelIds.length.toLocaleString()} channels restored`
    );
    window.setTimeout(() => setToastMessage(null), 2800);
  };

  const handleRenameSource = async (sourceId: string, nextName: string) => {
    if (!nextName.trim()) return;
    await renamePersistedSource(sourceId, nextName);
    await reloadSourcesList();
  };

  const handleUpdateHiddenGroups = async (sourceId: string, hiddenGroupIds: string[]) => {
    await updateSourceHiddenGroups(sourceId, hiddenGroupIds);
    await reloadSourcesList();
    if (selectedGroupId !== 'all' && hiddenGroupIds.includes(selectedGroupId)) {
      setSelectedGroupId('all');
    }
  };

  const handleResyncSource = async (source: StoredPlaylistSource) => {
    setIngestState({
      active: true,
      phase: `Syncing ${source.name}…`,
      percent: 15,
    });
    try {
      await resyncPersistedSource({
        source,
        proxyEndpoint: resolveIngestProxyEndpoint(),
        onProgress: (phase, percent) => setIngestState({ active: true, phase, percent }),
      });
      await reloadSourcesList();
      if (activeSourceId === source.id) {
        await refreshActiveSourceBundle(source.id);
      }
      setIngestState({
        active: false,
        phase: '',
        percent: 100,
        lastSummary: `${source.name} updated.`,
      });
    } catch (err) {
      setIngestState({
        active: false,
        phase: '',
        percent: 0,
        error: err instanceof Error ? err.message : 'Sync failed',
      });
    }
  };

  const [reminders, setReminders] = useState<EpgReminder[]>(() => {
    try {
      const raw = localStorage.getItem('luma.reminders.v1');
      if (raw) return JSON.parse(raw) as EpgReminder[];
    } catch {
      // Ignore
    }
    return [];
  });

  const reminderProgramIds = useMemo(
    () => new Set(reminders.map((r) => r.programId)),
    [reminders]
  );

  const handleToggleReminder = useCallback((channel: Channel, program: EpgProgram) => {
    setReminders((prev) => {
      const exists = prev.some((r) => r.programId === program.id);
      const next = exists
        ? prev.filter((r) => r.programId !== program.id)
        : [
            ...prev,
            {
              programId: program.id,
              channelId: channel.id,
              channelName: channel.name,
              title: program.title,
              startMs: program.startMs,
            },
          ];
      try {
        localStorage.setItem('luma.reminders.v1', JSON.stringify(next));
      } catch {
        // Ignore
      }
      setToastMessage(
        exists
          ? `Erinnerung entfernt: ${program.title}`
          : `Erinnerung aktiviert: ${program.title} auf ${channel.name}`
      );
      window.setTimeout(() => setToastMessage(null), 3200);
      return next;
    });

    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => undefined);
    }
  }, []);

  const sectionOrder: NavigationSection[] = useMemo(
    () => [
      'live',
      'live-epg',
      'favorites',
      'collections',
      'vod',
      'series',
      'catchup',
      'multiview',
      'home',
      'sources',
      'settings',
    ],
    []
  );

  const gamepadHandlers = useMemo(
    () => ({
      onChannelPrev: () => zapRelative(-1),
      onChannelNext: () => zapRelative(1),
      onCycleSectionPrev: () =>
        setActiveSection((cur) => {
          const i = sectionOrder.indexOf(cur);
          return sectionOrder[(i - 1 + sectionOrder.length) % sectionOrder.length];
        }),
      onCycleSectionNext: () =>
        setActiveSection((cur) => {
          const i = sectionOrder.indexOf(cur);
          return sectionOrder[(i + 1) % sectionOrder.length];
        }),
      onToggleSearch: () => setCommandBarOpen((v) => !v),
    }),
    [sectionOrder, zapRelative]
  );
  useUniversalGamepadControls(gamepadHandlers);

  // 10-Foot Spatial Arrow Focus Engine
  useSpatialDpadFocus(
    preferences.spatialDpadEnabled,
    Boolean(commandBarOpen || pendingPinGroup || shortcutsOpen || inspectMedia)
  );

  const fileDropHandlers = useMemo(
    () => ({
      onImportM3uFile: (name: string, content: string) => {
        setToastMessage(`Importiere Playlist „${name}“ im Hintergrund…`);
        handleImportM3u({ name, rawText: content });
        setActiveSection('sources');
      },
      onImportXmltvBuffer: (buffer: ArrayBuffer) => {
        setToastMessage('Importiere XMLTV EPG-Datei…');
        handleUploadXmltvBuffer(buffer);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeSourceId, proxyConfig]
  );
  useCrossPlatformFileDropAndLaunch(fileDropHandlers);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandBarOpen((v) => !v);
        return;
      }

      const targetTag = (e.target as HTMLElement | null)?.tagName;
      if (targetTag === 'INPUT' || targetTag === 'TEXTAREA') return;

      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }

      if (commandBarOpen || pendingPinGroup || shortcutsOpen || inspectMedia) return;

      if (activeSection === 'multiview' && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        setMultiviewAudioSlot(Number(e.key) - 1);
        setMultiviewMuted(false);
        return;
      }

      const isLiveStage = activeSection === 'live' || activeSection === 'live-epg';

      if (
        isLiveStage &&
        (e.key === 'ChannelUp' || (e.altKey && e.key === 'ArrowUp'))
      ) {
        e.preventDefault();
        zapRelative(-1);
        return;
      }
      if (
        isLiveStage &&
        (e.key === 'ChannelDown' || (e.altKey && e.key === 'ArrowDown'))
      ) {
        e.preventDefault();
        zapRelative(1);
        return;
      }

      if (isLiveStage && /^[0-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setNumericBuffer((prev) => {
          const next = (prev + e.key).slice(0, 5);
          if (numericTimerRef.current) window.clearTimeout(numericTimerRef.current);
          numericTimerRef.current = window.setTimeout(() => {
            const num = Number(next);
            const match = channels.find((c) => c.number === num);
            if (match) selectLiveChannel(match);
            setNumericBuffer('');
          }, 850);
          return next;
        });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    commandBarOpen,
    pendingPinGroup,
    shortcutsOpen,
    inspectMedia,
    activeSection,
    zapRelative,
    channels,
    selectLiveChannel,
  ]);

  const numericPreviewChannel = numericBuffer
    ? channels.find((c) => c.number === Number(numericBuffer))
    : undefined;

  const isM3 = designMode === 'm3-expressive';

  const isBrowsingSecondarySection =
    activeSection === 'favorites' ||
    activeSection === 'collections' ||
    activeSection === 'home' ||
    activeSection === 'vod' ||
    activeSection === 'series' ||
    activeSection === 'catchup' ||
    activeSection === 'studio' ||
    activeSection === 'sources' ||
    activeSection === 'settings';

  const isLiveSectionActive = activeSection === 'live' || activeSection === 'live-epg';

  const showFloatingInAppPip =
    (isLiveSectionActive && detachedPipInEpg) ||
    (isBrowsingSecondarySection &&
      Boolean(preferences.autoMiniPlayerOnSwitch) &&
      !pipDismissedWhileBrowsing);

  const t = TRANSLATIONS[preferences.locale];

  const activeGroupLabel = useMemo(() => {
    if (selectedGroupId === 'all') return t.allChannels;
    if (selectedGroupId === 'favorites') return t.favorites;
    return groups.find((g) => g.id === selectedGroupId)?.name ?? t.allChannels;
  }, [selectedGroupId, groups, t.allChannels, t.favorites]);

  const renderMainPlayerStage = (layoutVariant: 'cinema' | 'split') => (
    <PlayerStage
      designMode={designMode}
      channel={activeChannel}
      overrideTitle={activeOnDemand?.title}
      overrideSubtitle={activeOnDemand?.subtitle}
      overrideStreamUrl={activeOnDemand?.streamUrl ?? timeshiftStreamUrl ?? undefined}
      timeshiftProgram={timeshiftProgram}
      onExitTimeshift={() => {
        setActiveOnDemand(null);
        setTimeshiftProgram(null);
        setTimeshiftStreamUrl(null);
        setTimeshiftResumeSec(0);
      }}
      sessionKey={
        activeOnDemand?.itemId ??
        timeshiftProgram?.id ??
        `live-${activeChannel.id}`
      }
      initialResumeSec={
        activeOnDemand?.initialResumeSec ??
        (timeshiftProgram ? timeshiftResumeSec : 0)
      }
      fallbackDurationSec={
        activeOnDemand?.fallbackDurationSec ??
        (timeshiftProgram
          ? Math.max(
              60,
              Math.round((timeshiftProgram.endMs - timeshiftProgram.startMs) / 1000)
            )
          : 0)
      }
      onPlaybackProgress={(curSec, durSec) => {
        if (activeOnDemand) {
          recordHistory({
            itemId: activeOnDemand.itemId,
            title: activeOnDemand.title,
            kind: activeOnDemand.kind,
            resumeSec: curSec,
            durationSec: durSec,
            updatedAt: Date.now(),
          });
        } else if (timeshiftProgram) {
          recordHistory({
            itemId: timeshiftProgram.id,
            title: `${activeChannel.shortCode}: ${timeshiftProgram.title}`,
            kind: 'catchup',
            resumeSec: curSec,
            durationSec: durSec,
            updatedAt: Date.now(),
          });
        }
      }}
      nextEpisodeLabel={activeOnDemand?.nextEpisode?.label}
      onPlayNextEpisode={
        activeOnDemand?.nextEpisode
          ? () => {
              const ne = activeOnDemand.nextEpisode!;
              handlePlaySeriesEpisode(ne.series, ne.seasonNumber, ne.episode, 0);
            }
          : undefined
      }
      isFavorite={favoriteIds.has(activeChannel.id)}
      onToggleFavorite={toggleFavorite}
      onPrevChannel={() => zapRelative(-1)}
      onNextChannel={() => zapRelative(1)}
      onDetachInAppPip={() => setDetachedPipInEpg(true)}
      ambilightEnabled={ambilightEnabled}
      theaterExpanded={theaterExpanded}
      onToggleTheaterExpanded={() => setTheaterExpanded((v) => !v)}
      layoutVariant={layoutVariant}
      isMuted={playerAudio.muted}
      onChangeMuted={handleChangeMuted}
      volume={playerAudio.volume}
      onChangeVolume={handleChangeVolume}
      proxyConfig={effectiveProxyConfig}
      nowMs={nowMs}
      locale={preferences.locale}
      mpvAvailable={Boolean(nativeProbe?.mpvAvailable)}
      onToast={(msg) => {
        setToastMessage(msg);
        window.setTimeout(() => setToastMessage(null), 3200);
      }}
      onAmbientRgbChange={setGlobalAmbientRgb}
    />
  );

  return (
    <div
      data-design={designMode}
      className={`relative flex h-screen w-screen flex-col overflow-hidden text-slate-100 transition-colors duration-300 ${
        isM3 ? 'bg-[#131722]' : 'bg-[#05070C]'
      }`}
    >
      {!isM3 && ambilightEnabled && (
        <div
          className="pointer-events-none absolute inset-0 transition-all duration-1000"
          style={{
            background: `
              radial-gradient(circle at 22% 28%, rgba(${globalAmbientRgb}, 0.24) 0%, transparent 52%),
              radial-gradient(circle at 78% 68%, rgba(96, 165, 250, 0.16) 0%, transparent 55%)
            `,
          }}
        />
      )}

      <CustomTitlebar
        designMode={designMode}
        locale={preferences.locale}
        onToggleLocale={() =>
          handleUpdatePreferences({
            ...preferences,
            locale: cycleNextLocale(preferences.locale),
          })
        }
        sleepRemainingSec={sleepRemainingSec}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
        onOpenCommandBar={() => setCommandBarOpen(true)}
        activeSection={activeSection}
        onSelectSection={(sec) => {
          setActiveSection(sec);
          setPipDismissedWhileBrowsing(false);
        }}
        playlists={quickPlaylistOptions}
        activeSourceId={activeSourceId}
        onSelectSourceId={handleSelectSourceId}
        nowMs={nowMs}
      />

      <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden">
        <Sidebar
          designMode={designMode}
          locale={preferences.locale}
          collapsed={sidebarCollapsed}
          activeSection={activeSection}
          onSelectSection={(sec) => {
            setActiveSection(sec);
            setPipDismissedWhileBrowsing(false);
          }}
          selectedGroupId={selectedGroupId}
          onSelectGroup={handleSelectSidebarGroup}
          groups={groups}
          totalChannelCount={channels.length}
          favoritesCount={favoriteIds.size + favoriteSeriesIds.size}
          collectionsCount={customBouquets.length}
        />

        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          {numericBuffer && (
            <div
              className={`pointer-events-none absolute top-5 right-6 z-50 px-5 py-3.5 ${
                isM3
                  ? 'rounded-[24px] bg-[#232B3D] shadow-2xl'
                  : 'lg-modal rounded-[22px]'
              }`}
            >
              <div className="text-[10px] font-semibold uppercase tracking-wider text-sky-300">
                Direktwahl
              </div>
              <div className="mt-0.5 text-2xl font-bold text-white luma-tabular">
                #{numericBuffer}
              </div>
              <div className="mt-0.5 text-xs text-slate-300">
                {numericPreviewChannel ? numericPreviewChannel.name : 'Kanal nicht belegt'}
              </div>
            </div>
          )}

          {activeSection === 'home' && (
            <HomeHubView
              designMode={designMode}
              channels={channels}
              vodCatalog={combinedVodCatalog}
              seriesCatalog={combinedSeriesCatalog}
              watchHistory={watchHistory}
              nowMs={nowMs}
              locale={preferences.locale}
              onSelectChannel={selectLiveChannel}
              onPlayVod={handlePlayVod}
              onPlaySeriesEpisode={handlePlaySeriesEpisode}
              onOpenMultiview={() => setActiveSection('multiview')}
              onOpenSeriesHub={(serId) => {
                if (serId) setFocusedSeriesId(serId);
                setActiveSection('series');
              }}
            />
          )}

          {activeSection === 'live' && (
            <LiveTvView
              designMode={designMode}
              locale={preferences.locale}
              channels={visibleChannels}
              activeGroupLabel={activeGroupLabel}
              selectedGroupId={selectedGroupId}
              collections={customBouquets}
              onSelectGroup={handleSelectSidebarGroup}
              activeChannelId={activeChannel.id}
              favoriteIds={favoriteIds}
              onSelectChannel={selectLiveChannel}
              onToggleFavorite={toggleFavorite}
              onOpenChannelMenu={setChannelMenuTarget}
              onOpenEpgView={() => setActiveSection('live-epg')}
            >
              {!detachedPipInEpg && renderMainPlayerStage('cinema')}
            </LiveTvView>
          )}

          {activeSection === 'live-epg' && (
            <>
              {!detachedPipInEpg && renderMainPlayerStage('split')}

              <VirtualizedEpgGrid
                designMode={designMode}
                channels={visibleChannels}
                xmltvMap={activeSourceId === 'builtin-reference' ? undefined : xmltvMap}
                activeChannelId={activeChannel.id}
                favoriteIds={favoriteIds}
                reminderProgramIds={reminderProgramIds}
                epgOffsetHours={epgOffsetHours}
                nowMs={nowMs}
                locale={preferences.locale}
                onSelectChannel={selectLiveChannel}
                onStartTimeshift={handleStartTimeshift}
                onToggleFavorite={toggleFavorite}
                onOpenChannelMenu={setChannelMenuTarget}
                onToggleReminder={handleToggleReminder}
              />
            </>
          )}

          {activeSection === 'favorites' && (
            <FavoritesView
              designMode={designMode}
              locale={preferences.locale}
              channels={collectionAndFavoritePool}
              seriesCatalog={collectionAndFavoriteSeriesPool}
              favoriteIds={favoriteIds}
              favoriteSeriesIds={favoriteSeriesIds}
              activeChannelId={activeChannel.id}
              nowMs={nowMs}
              epgOffsetHours={epgOffsetHours}
              onSelectChannel={selectLiveChannel}
              onOpenSeries={(serId) => {
                setFocusedSeriesId(serId);
                setActiveSection('series');
              }}
              onToggleFavorite={toggleFavorite}
              onToggleFavoriteSeries={toggleFavoriteSeries}
              onOpenChannelMenu={setChannelMenuTarget}
            />
          )}

          {(activeSection === 'collections' || activeSection === 'studio') && (
            <CollectionsView
              designMode={designMode}
              locale={preferences.locale}
              channels={collectionAndFavoritePool}
              seriesCatalog={collectionAndFavoriteSeriesPool}
              persistedSources={persistedSources}
              activeSourceId={activeSourceId}
              demoSourceDeleted={demoSourceDeleted}
              demoChannels={builtinCatalog.channels}
              collections={customBouquets}
              activeChannelId={activeChannel.id}
              unlockedGroupIds={unlockedGroupIds}
              parentalEnabled={parentalConfig.enabled}
              lockedGroupIds={parentalConfig.lockedGroupIds}
              nowMs={nowMs}
              epgOffsetHours={epgOffsetHours}
              onChangeCollections={handleUpdateBouquets}
              onSelectChannel={selectLiveChannel}
              onOpenSeries={(serId) => {
                setFocusedSeriesId(serId);
                setActiveSection('series');
              }}
              onRequestUnlockCollection={(id, name) => setPendingPinGroup({ id, name })}
              onOpenChannelMenu={setChannelMenuTarget}
            />
          )}

          {activeSection === 'multiview' && (
            <MultiviewGrid
              designMode={designMode}
              channels={channels}
              slotChannelIds={multiviewSlotIds}
              activeAudioSlot={multiviewAudioSlot}
              globalMuted={multiviewMuted}
              onToggleGlobalMuted={() => setMultiviewMuted((v) => !v)}
              onSelectAudioSlot={(slot) => {
                setMultiviewAudioSlot(slot);
                setMultiviewMuted(false);
              }}
              onChangeSlotChannel={(slot, nextId) => {
                setMultiviewSlotIds((prev) => {
                  const copy = [...prev];
                  copy[slot] = nextId;
                  return copy;
                });
              }}
              onSwapSlots={(slotA, slotB) => {
                setMultiviewSlotIds((prev) => {
                  const copy = [...prev];
                  const tmp = copy[slotA];
                  copy[slotA] = copy[slotB];
                  copy[slotB] = tmp;
                  return copy;
                });
              }}
              onExpandChannel={(ch) => selectLiveChannel(ch)}
              proxyConfig={effectiveProxyConfig}
              nowMs={nowMs}
            />
          )}

          {activeSection === 'vod' && (
            <VodCatalogView
              designMode={designMode}
              vodCatalog={combinedVodCatalog}
              watchHistory={watchHistory}
              locale={preferences.locale}
              onPlayVod={(vod, resumeSec) => handlePlayVod(vod, resumeSec)}
              onInspectVod={(vod) => setInspectMedia({ kind: 'vod', vod })}
            />
          )}

          {activeSection === 'series' && (
            <SeriesBrowserView
              designMode={designMode}
              seriesCatalog={combinedSeriesCatalog}
              initialSeriesId={focusedSeriesId}
              onClearInitialSeries={() => setFocusedSeriesId(null)}
              favoriteSeriesIds={favoriteSeriesIds}
              collections={customBouquets}
              onToggleFavoriteSeries={toggleFavoriteSeries}
              onOpenItemMenu={setChannelMenuTarget}
              watchHistory={watchHistory}
              locale={preferences.locale}
              loadingSeriesIds={loadingSeriesIds}
              onEnsureSeriesLoaded={handleEnsureSeriesLoaded}
              onPlayEpisode={handlePlaySeriesEpisode}
              onInspectSeries={(series) => setInspectMedia({ kind: 'series', series })}
            />
          )}

          {activeSection === 'catchup' && (
            <CatchupArchiveView
              designMode={designMode}
              channels={channels}
              xmltvMap={activeSourceId === 'builtin-reference' ? undefined : xmltvMap}
              epgOffsetHours={epgOffsetHours}
              nowMs={nowMs}
              locale={preferences.locale}
              onStartTimeshift={handleStartTimeshift}
            />
          )}

          {activeSection === 'sources' && (
            <SourcesEngineView
              designMode={designMode}
              locale={preferences.locale}
              nowMs={nowMs}
              activeSourceId={activeSourceId}
              demoSourceDeleted={demoSourceDeleted}
              onDeleteDemoSource={handleDeleteDemoSource}
              onRestoreDemoSource={handleRestoreDemoSource}
              persistedSources={persistedSources}
              storedChannelsForActive={persistedChannels}
              ingestState={ingestState}
              onSelectSourceId={handleSelectSourceId}
              onDeleteSource={handleDeleteSource}
              onImportM3u={handleImportM3u}
              onImportXtream={handleImportXtream}
              onUploadXmltvBuffer={handleUploadXmltvBuffer}
              onRenameSource={handleRenameSource}
              onResyncSource={handleResyncSource}
              onRefreshAccountInfo={handleRefreshAccountInfo}
              onUpdateHiddenGroups={handleUpdateHiddenGroups}
              onBulkSetChannelsHidden={handleBulkSetChannelsHidden}
              onPlayChannel={(ch) => selectLiveChannel(ch)}
              onOpenChannelMenu={setChannelMenuTarget}
              onRenameChannel={handleRenameChannel}
              onToggleHideChannel={handleToggleHideChannel}
              epgOffsetHours={epgOffsetHours}
              onChangeEpgOffset={setEpgOffsetHours}
              proxyConfig={proxyConfig}
              onChangeProxyConfig={setProxyConfig}
              favoriteIds={favoriteIds}
              watchHistory={watchHistory}
              onRestoreFromSync={handleRestoreFromSync}
            />
          )}

          {activeSection === 'settings' && (
            <SettingsHubView
              designMode={designMode}
              isAppleDevice={platformEnv.isApple}
              detectedPlatformLabel={platformEnv.label}
              onChangeDesignMode={handleChangeDesignMode}
              preferences={preferences}
              onChangePreferences={handleUpdatePreferences}
              sleepRemainingSec={sleepRemainingSec}
              favoriteIds={favoriteIds}
              customBouquets={customBouquets}
              groups={baseGroups}
              parentalConfig={parentalConfig}
              onChangeParentalConfig={handleUpdateParental}
              onImportFullBackup={(backup) => {
                if (backup.favorites) setFavoriteIds(new Set(backup.favorites));
                if (backup.bouquets) handleUpdateBouquets(backup.bouquets);
                if (backup.parental) handleUpdateParental(backup.parental);
                if (backup.preferences) handleUpdatePreferences(backup.preferences);
                setToastMessage('Backup restored');
                window.setTimeout(() => setToastMessage(null), 3200);
              }}
              onOpenShortcutsModal={() => setShortcutsOpen(true)}
            />
          )}
        </main>
      </div>

      {showFloatingInAppPip && (
        <InAppPipWindow
          designMode={designMode}
          channel={activeChannel}
          overrideTitle={activeOnDemand?.title ?? timeshiftProgram?.title}
          overrideStreamUrl={activeOnDemand?.streamUrl ?? timeshiftStreamUrl ?? undefined}
          isMuted={playerAudio.muted}
          volume={playerAudio.volume}
          onChangeMuted={handleChangeMuted}
          proxyConfig={effectiveProxyConfig}
          nowMs={nowMs}
          onPrevChannel={() => zapRelative(-1)}
          onNextChannel={() => zapRelative(1)}
          onRestoreStage={() => {
            setDetachedPipInEpg(false);
            setActiveSection('live');
          }}
          onClose={() => {
            if (isLiveSectionActive) {
              setDetachedPipInEpg(false);
            } else {
              setPipDismissedWhileBrowsing(true);
            }
          }}
        />
      )}

      {channelMenuTarget && (
        <ChannelContextMenu
          designMode={designMode}
          locale={preferences.locale}
          target={channelMenuTarget}
          isFavorite={
            channelMenuTarget.channel
              ? favoriteIds.has(channelMenuTarget.channel.id)
              : channelMenuTarget.series
                ? favoriteSeriesIds.has(channelMenuTarget.series.id)
                : false
          }
          collections={customBouquets}
          onClose={() => setChannelMenuTarget(null)}
          onPlayChannel={(ch) => selectLiveChannel(ch)}
          onOpenSeries={(ser) => {
            setFocusedSeriesId(ser.id);
            setActiveSection('series');
          }}
          onToggleFavorite={() => {
            if (channelMenuTarget.channel) {
              toggleFavorite(channelMenuTarget.channel.id);
            } else if (channelMenuTarget.series) {
              toggleFavoriteSeries(channelMenuTarget.series.id);
            }
          }}
          onToggleInCollection={(collectionId) =>
            handleToggleTargetInCollection(collectionId, channelMenuTarget)
          }
          onCreateCollectionWithTarget={(name) =>
            handleCreateCollectionWithTarget(name, channelMenuTarget)
          }
        />
      )}

      {toastMessage && (
        <div
          className={`fixed bottom-5 left-1/2 z-50 -translate-x-1/2 px-4 py-2.5 text-xs font-semibold text-white shadow-2xl ${
            isM3 ? 'rounded-full bg-[#232B3D] ring-1 ring-[#7FD4FF]/50' : 'lg-modal rounded-full'
          }`}
        >
          {toastMessage}
        </div>
      )}

      {pendingPinGroup && (
        <ParentalPinModal
          designMode={designMode}
          expectedPin={parentalConfig.pin}
          groupName={pendingPinGroup.name}
          onSuccess={() => {
            setUnlockedGroupIds((prev) => new Set([...prev, pendingPinGroup.id]));
            setSelectedGroupId(pendingPinGroup.id);
            setPendingPinGroup(null);
            setActiveSection((cur) => (cur === 'live-epg' ? 'live-epg' : 'live'));
          }}
          onCancel={() => setPendingPinGroup(null)}
        />
      )}

      {inspectMedia && (
        <MediaDetailModal
          designMode={designMode}
          target={inspectMedia}
          onClose={() => setInspectMedia(null)}
          onPlayPrimary={() => {
            if (inspectMedia.vod) {
              handlePlayVod(inspectMedia.vod);
            } else if (inspectMedia.series) {
              const s1 = inspectMedia.series.seasons[0];
              const ep1 = s1?.episodes[0];
              if (s1 && ep1) handlePlaySeriesEpisode(inspectMedia.series, s1.seasonNumber, ep1);
            }
            setInspectMedia(null);
          }}
          onPlayTrailer={() => {
            const targetId = inspectMedia.vod?.id ?? inspectMedia.series?.id ?? 'preview';
            setActiveOnDemand({
              itemId: `trailer-${targetId}`,
              kind: 'vod',
              title: `Trailer · ${inspectMedia.vod?.title ?? inspectMedia.series?.title ?? 'Preview'}`,
              subtitle: 'Offizieller 4K HDR Studio-Trailer',
              streamUrl: VERIFIED_HLS_STREAMS.tearsOfSteel,
              initialResumeSec: 0,
              fallbackDurationSec: 734,
            });
            setTimeshiftProgram(null);
            setTimeshiftStreamUrl(null);
            setInspectMedia(null);
            setDetachedPipInEpg(false);
            setActiveSection('live');
          }}
        />
      )}

      {/* Cross-Platform Shortcuts, Touch & Remote Cheat-Sheet Modal */}
      {shortcutsOpen && (
        <div
          onClick={() => setShortcutsOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-md"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-lg p-6 text-xs ${
              isM3
                ? 'rounded-[28px] bg-[#1E2536] shadow-2xl ring-1 ring-white/10'
                : 'lg-modal rounded-[26px]'
            }`}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">{t.shortcutsHelpTitle}</h3>
              <button
                type="button"
                onClick={() => setShortcutsOpen(false)}
                className="rounded-full px-2.5 py-1 text-slate-300 hover:bg-white/10"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2.5 text-slate-200">
              <div className="flex justify-between border-b border-white/10 pb-2">
                <span>Globale Suche (Kanäle, EPG, VOD, Serien)</span>
                <kbd className="rounded bg-white/10 px-2 py-0.5 font-mono">⌘K / Ctrl+K</kbd>
              </div>
              <div className="flex justify-between border-b border-white/10 pb-2">
                <span>Sofort-Zapping (Vorheriger / Nächster Kanal)</span>
                <kbd className="rounded bg-white/10 px-2 py-0.5 font-mono">Alt + ↑ / ↓</kbd>
              </div>
              <div className="flex justify-between border-b border-white/10 pb-2">
                <span>10-Foot Spatial TV / Remote Fokus starten</span>
                <kbd className="rounded bg-white/10 px-2 py-0.5 font-mono">Shift + Pfeiltasten</kbd>
              </div>
              <div className="flex justify-between border-b border-white/10 pb-2">
                <span>Direkte Kanalnummernwahl im Live-TV</span>
                <kbd className="rounded bg-white/10 px-2 py-0.5 font-mono">0 – 9</kbd>
              </div>
              <div className="flex justify-between border-b border-white/10 pb-2">
                <span>Multiview Tonfokus wechseln</span>
                <kbd className="rounded bg-white/10 px-2 py-0.5 font-mono">1 – 4</kbd>
              </div>
              <div className="flex justify-between">
                <span>Android / Tablet Touch-Zapping</span>
                <span className="text-sky-300">Vertikal auf Player wischen</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {commandBarOpen && (
        <CommandBar
          designMode={designMode}
          isAppleDevice={platformEnv.isApple}
          locale={preferences.locale}
          onClose={() => setCommandBarOpen(false)}
          channels={channels}
          vodCatalog={combinedVodCatalog}
          seriesCatalog={combinedSeriesCatalog}
          onSelectChannel={(ch) => selectLiveChannel(ch)}
          onSelectVod={(vod) => handlePlayVod(vod)}
          onOpenSeries={(serId) => {
            setFocusedSeriesId(serId);
            setActiveSection('series');
          }}
          onSelectSeriesEpisode={(ser, sNum, ep) => handlePlaySeriesEpisode(ser, sNum, ep)}
          onTriggerAction={(act) => {
            if (act === 'multiview') {
              setActiveSection((prev) => (prev === 'multiview' ? 'live' : 'multiview'));
            } else if (act === 'ambilight') {
              setAmbilightEnabled((v) => !v);
            } else if (act === 'stress20k') {
              handleRestoreDemoSource();
              setStressMode20k((v) => !v);
            } else if (act === 'toggleDesign') {
              handleChangeDesignMode(
                designMode === 'm3-expressive' ? 'liquid-glass' : 'm3-expressive'
              );
            }
          }}
        />
      )}
    </div>
  );
}

export default App;
