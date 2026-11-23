import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  lumaDb,
  type StoredChannel,
  type StoredEpgProgram,
  type StoredPlaylistSource,
  type StoredVodItem,
} from './db/lumaDb';
import {
  buildChannelCatalog,
  DEMO_SERIES_CATALOG,
  DEMO_VOD_CATALOG,
  getCurrentAndNextProgram,
  VERIFIED_HLS_STREAMS,
} from './data/mockCatalog';
import { isLocalRustProxyEndpoint } from './engine/corsProxy';
import {
  probeTauriNativeEngine,
  type NativeEngineProbe,
} from './engine/tauriNativeBridge';
import {
  detectSystemLocale,
  TRANSLATIONS,
  type LumaPreferences,
} from './i18n/translations';
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
  deletePersistedSource,
  importM3uPlaylist,
  importXmltvForSource,
  importXtreamSource,
  loadPersistedSourceBundle,
  renameStoredChannel,
  runEndToEndWorkerDemoImport,
  toggleHideStoredChannel,
  type IngestProgressState,
} from './services/playlistService';
import { CommandBar } from './components/command/CommandBar';
import { VirtualizedEpgGrid } from './components/epg/VirtualizedEpgGrid';
import { CustomTitlebar } from './components/layout/CustomTitlebar';
import { Sidebar } from './components/layout/Sidebar';
import { InAppPipWindow } from './components/player/InAppPipWindow';
import { MultiviewGrid } from './components/player/MultiviewGrid';
import { PlayerStage } from './components/player/PlayerStage';
import {
  ChannelStudioView,
  ParentalPinModal,
} from './components/views/ChannelStudioView';
import {
  HomeHubView,
  SeriesBrowserView,
} from './components/views/HomeAndSeriesHub';
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

function detectInitialDesignMode(): PlatformDesignMode {
  if (typeof navigator === 'undefined') return 'm3-expressive';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('macintosh') || ua.includes('mac os')) return 'liquid-glass';
  return 'm3-expressive';
}

export function App() {
  const [designMode, setDesignMode] = useState<PlatformDesignMode>(detectInitialDesignMode);
  const [preferences, setPreferences] = useState<LumaPreferences>(() => {
    try {
      const raw = localStorage.getItem('luma.prefs.v3');
      if (raw) return JSON.parse(raw) as LumaPreferences;
    } catch {
      // Ignore
    }
    return {
      locale: detectSystemLocale(),
      bufferProfile: 'balanced',
      sleepTimerMinutes: 0,
      spatialDpadEnabled: true,
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

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeSection, setActiveSection] = useState<NavigationSection>('live-epg');
  const [selectedGroupId, setSelectedGroupId] = useState<string>('all');
  const [focusedSeriesId, setFocusedSeriesId] = useState<string | null>(null);
  const [stressMode20k, setStressMode20k] = useState<boolean>(false);
  const [ambilightEnabled, setAmbilightEnabled] = useState<boolean>(true);
  const [theaterExpanded, setTheaterExpanded] = useState<boolean>(false);
  const [commandBarOpen, setCommandBarOpen] = useState<boolean>(false);
  const [globalAmbientRgb, setGlobalAmbientRgb] = useState<string>('56, 189, 248');

  const [detachedPipInEpg, setDetachedPipInEpg] = useState<boolean>(false);
  const [autoPipWhenBrowsing, setAutoPipWhenBrowsing] = useState<boolean>(true);

  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [epgOffsetHours, setEpgOffsetHours] = useState<number>(0);
  const [nativeProbe, setNativeProbe] = useState<NativeEngineProbe | null>(null);
  const [proxyConfig, setProxyConfig] = useState<EngineProxyConfig>({
    enabled: false,
    endpointUrl: 'https://luma-tv-app.web.app/api/stream-proxy',
    customUserAgent: 'LumaTV/0.4-beta (TiviMate-Compatible)',
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

  const handleUpdateParental = useCallback((next: ParentalControlConfig) => {
    setParentalConfig(next);
    try {
      localStorage.setItem('luma.parental.v1', JSON.stringify(next));
    } catch {
      // Ignore
    }
  }, []);

  const [activeSourceId, setActiveSourceId] = useState<string>('builtin-reference');
  const [persistedSources, setPersistedSources] = useState<StoredPlaylistSource[]>([]);
  const [persistedChannels, setPersistedChannels] = useState<StoredChannel[]>([]);
  const [persistedVod, setPersistedVod] = useState<StoredVodItem[]>([]);
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

  useEffect(() => {
    lumaDb.sources
      .orderBy('createdAt')
      .reverse()
      .toArray()
      .then((list) => setPersistedSources(list))
      .catch(() => undefined);
  }, []);

  const refreshActiveSourceBundle = useCallback(async (sourceId: string) => {
    if (sourceId === 'builtin-reference') return;
    const bundle = await loadPersistedSourceBundle(sourceId);
    setPersistedChannels(bundle.channels);
    setPersistedVod(bundle.vodItems);
    setXmltvMap(bundle.epgByTvgId);
  }, []);

  useEffect(() => {
    if (activeSourceId === 'builtin-reference') return;
    let cancelled = false;
    loadPersistedSourceBundle(activeSourceId)
      .then((bundle) => {
        if (cancelled) return;
        setPersistedChannels(bundle.channels);
        setPersistedVod(bundle.vodItems);
        setXmltvMap(bundle.epgByTvgId);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeSourceId]);

  const builtinCatalog = useMemo(
    () => buildChannelCatalog(stressMode20k ? 20_400 : 2_400),
    [stressMode20k]
  );

  const { channels, baseGroups }: { channels: Channel[]; baseGroups: ChannelGroup[] } =
    useMemo(() => {
      if (activeSourceId === 'builtin-reference') {
        return { channels: builtinCatalog.channels, baseGroups: builtinCatalog.groups };
      }
      const visibleStored = persistedChannels.filter((c) => !c.isHidden);
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
        channels: visibleStored.length > 0 ? visibleStored : builtinCatalog.channels,
        baseGroups: derivedGroups,
      };
    }, [activeSourceId, persistedChannels, builtinCatalog]);

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

  const combinedVodCatalog: VodItem[] = useMemo(
    () =>
      activeSourceId === 'builtin-reference' || persistedVod.length === 0
        ? DEMO_VOD_CATALOG
        : [...persistedVod, ...DEMO_VOD_CATALOG],
    [activeSourceId, persistedVod]
  );

  const [activeChannelId, setActiveChannelId] = useState<string>('ch-redbull-tv');
  const [activeOnDemand, setActiveOnDemand] = useState<{
    title: string;
    subtitle: string;
    streamUrl: string;
  } | null>(null);
  const [timeshiftProgram, setTimeshiftProgram] = useState<EpgProgram | null>(null);

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
      return channels.filter((c) => favoriteIds.has(c.id));
    }
    const customBq = customBouquets.find((b) => b.id === selectedGroupId);
    if (customBq) {
      const byId = new Map(channels.map((c) => [c.id, c]));
      return customBq.channelIds
        .map((id) => byId.get(id))
        .filter((c): c is Channel => Boolean(c));
    }
    return channels.filter((c) => c.groupId === selectedGroupId);
  }, [channels, selectedGroupId, favoriteIds, customBouquets]);

  const activeChannel: Channel = useMemo(
    () => channels.find((c) => c.id === activeChannelId) ?? channels[0],
    [channels, activeChannelId]
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
      setActiveChannelId(ch.id);
      setActiveOnDemand(null);
      setTimeshiftProgram(null);
      setDetachedPipInEpg(false);
      setActiveSection('live-epg');
      recordHistory({
        itemId: ch.id,
        title: ch.name,
        kind: 'live',
        resumeSec: 0,
        durationSec: 0,
        updatedAt: Date.now(),
      });
    },
    [recordHistory]
  );

  const handleSelectSidebarGroup = useCallback(
    (groupId: string) => {
      if (groupId === 'all' || groupId === 'favorites') {
        setSelectedGroupId(groupId);
        setActiveSection('live-epg');
        return;
      }
      const grp = groups.find((g) => g.id === groupId);
      if (grp?.isPinLocked && !unlockedGroupIds.has(groupId)) {
        setPendingPinGroup({ id: grp.id, name: grp.name });
        return;
      }
      setSelectedGroupId(groupId);
      setActiveSection('live-epg');
    },
    [groups, unlockedGroupIds]
  );

  const handleStartTimeshift = useCallback(
    (ch: Channel, program: EpgProgram) => {
      setActiveChannelId(ch.id);
      setActiveOnDemand(null);
      setTimeshiftProgram(program);
      setDetachedPipInEpg(false);
      recordHistory({
        itemId: program.id,
        title: `${ch.shortCode}: ${program.title}`,
        kind: 'catchup',
        resumeSec: 180,
        durationSec: Math.round((program.endMs - program.startMs) / 1000),
        updatedAt: Date.now(),
      });
      setActiveSection('live-epg');
    },
    [recordHistory]
  );

  const handlePlayVod = useCallback(
    (vod: VodItem, resumeSec = 240) => {
      setActiveOnDemand({
        title: vod.title,
        subtitle: `${vod.genre} · ${vod.year} · ${vod.durationMin} Min.`,
        streamUrl: vod.streamUrl,
      });
      setTimeshiftProgram(null);
      setDetachedPipInEpg(false);
      setActiveSection('live-epg');
      recordHistory({
        itemId: vod.id,
        title: vod.title,
        kind: 'vod',
        resumeSec,
        durationSec: vod.durationMin * 60,
        updatedAt: Date.now(),
      });
    },
    [recordHistory]
  );

  const handlePlaySeriesEpisode = useCallback(
    (series: SeriesItem, seasonNum: number, ep: SeriesEpisode, resumeSec = 420) => {
      const code = `S${String(seasonNum).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')}`;
      setActiveOnDemand({
        title: `${series.title.split('·')[0].trim()} · ${code} ${ep.title}`,
        subtitle: `${series.genre} · ${ep.durationMin} Min. · ${ep.resolution}`,
        streamUrl: ep.streamUrl,
      });
      setTimeshiftProgram(null);
      setDetachedPipInEpg(false);
      setActiveSection('live-epg');
      recordHistory({
        itemId: ep.id,
        title: `${series.title.split('·')[0].trim()} · ${code} ${ep.title}`,
        kind: 'vod',
        resumeSec,
        durationSec: ep.durationMin * 60,
        updatedAt: Date.now(),
      });
    },
    [recordHistory]
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

  const handleRestoreFromSync = useCallback((payload: LumaSyncPlainPayload) => {
    const restoredFavs = new Set(payload.favorites);
    setFavoriteIds(restoredFavs);
    setWatchHistory(payload.watchHistory);
    setEpgOffsetHours(payload.epgOffsetHours);
    setDesignMode(payload.preferredDesign);
    try {
      localStorage.setItem('luma.favorites.v1', JSON.stringify(payload.favorites));
      localStorage.setItem('luma.watch.history.v1', JSON.stringify(payload.watchHistory));
    } catch {
      // Ignore
    }
  }, []);

  const reloadSourcesList = async () => {
    const list = await lumaDb.sources.orderBy('createdAt').reverse().toArray();
    setPersistedSources(list);
  };

  const handleWorkerDemoImport = async () => {
    setIngestState({ active: true, phase: 'Starte WebWorker…', percent: 5 });
    try {
      const { source, epgCount } = await runEndToEndWorkerDemoImport((phase, percent) =>
        setIngestState({ active: true, phase, percent })
      );
      await reloadSourcesList();
      setActiveSourceId(source.id);
      setSelectedGroupId('all');
      await refreshActiveSourceBundle(source.id);
      setIngestState({
        active: false,
        phase: '',
        percent: 100,
        lastSummary: `Importiert: ${source.channelCount} Kanäle + ${epgCount} dekomprimierte XMLTV.gz Sendungen in IndexedDB!`,
      });
    } catch (err) {
      setIngestState({
        active: false,
        phase: '',
        percent: 0,
        error: err instanceof Error ? err.message : 'Fehler beim Import',
      });
    }
  };

  const resolveIngestProxyEndpoint = () =>
    proxyConfig.enabled || isLocalRustProxyEndpoint(proxyConfig.endpointUrl)
      ? proxyConfig.endpointUrl
      : undefined;

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
      setActiveSourceId(source.id);
      setSelectedGroupId('all');
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
      setActiveSourceId(source.id);
      setSelectedGroupId('all');
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
    await reloadSourcesList();
    if (activeSourceId === sourceId) {
      setActiveSourceId('builtin-reference');
    }
  };

  const handleRenameChannel = async (channelId: string, nextName: string) => {
    if (!nextName.trim()) return;
    await renameStoredChannel(channelId, nextName);
    await refreshActiveSourceBundle(activeSourceId);
  };

  const handleToggleHideChannel = async (channelId: string, hidden: boolean) => {
    await toggleHideStoredChannel(channelId, hidden);
    await refreshActiveSourceBundle(activeSourceId);
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
      'home',
      'live-epg',
      'multiview',
      'vod',
      'series',
      'catchup',
      'studio',
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

      if (
        activeSection === 'live-epg' &&
        (e.key === 'ChannelUp' || (e.altKey && e.key === 'ArrowUp'))
      ) {
        e.preventDefault();
        zapRelative(-1);
        return;
      }
      if (
        activeSection === 'live-epg' &&
        (e.key === 'ChannelDown' || (e.altKey && e.key === 'ArrowDown'))
      ) {
        e.preventDefault();
        zapRelative(1);
        return;
      }

      if (activeSection === 'live-epg' && /^[0-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey) {
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
    activeSection === 'home' ||
    activeSection === 'vod' ||
    activeSection === 'series' ||
    activeSection === 'catchup' ||
    activeSection === 'studio' ||
    activeSection === 'sources' ||
    activeSection === 'settings';

  const showFloatingInAppPip =
    (activeSection === 'live-epg' && detachedPipInEpg) ||
    (isBrowsingSecondarySection && autoPipWhenBrowsing);

  const t = TRANSLATIONS[preferences.locale];

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
        onChangeDesignMode={setDesignMode}
        locale={preferences.locale}
        onToggleLocale={() =>
          handleUpdatePreferences({
            ...preferences,
            locale: preferences.locale === 'de' ? 'en' : 'de',
          })
        }
        sleepRemainingSec={sleepRemainingSec}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
        onOpenCommandBar={() => setCommandBarOpen(true)}
        activeSection={activeSection}
        onSelectSection={(sec) => {
          setActiveSection(sec);
          if (sec !== 'live-epg') {
            setAutoPipWhenBrowsing(true);
          }
        }}
        ambilightEnabled={ambilightEnabled}
        onToggleAmbilight={() => setAmbilightEnabled((v) => !v)}
        stressMode20k={stressMode20k}
        onToggleStressMode20k={() => {
          setActiveSourceId('builtin-reference');
          setStressMode20k((v) => !v);
        }}
        totalChannels={channels.length}
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
            if (sec !== 'live-epg') {
              setAutoPipWhenBrowsing(true);
            }
          }}
          selectedGroupId={selectedGroupId}
          onSelectGroup={handleSelectSidebarGroup}
          onOpenCommandBar={() => setCommandBarOpen(true)}
          groups={groups}
          totalChannelCount={channels.length}
          favoritesCount={favoriteIds.size}
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
              seriesCatalog={DEMO_SERIES_CATALOG}
              watchHistory={watchHistory}
              nowMs={nowMs}
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

          {activeSection === 'live-epg' && (
            <>
              {!detachedPipInEpg && (
                <PlayerStage
                  designMode={designMode}
                  channel={activeChannel}
                  overrideTitle={activeOnDemand?.title}
                  overrideSubtitle={activeOnDemand?.subtitle}
                  overrideStreamUrl={activeOnDemand?.streamUrl}
                  timeshiftProgram={timeshiftProgram}
                  onExitTimeshift={() => setTimeshiftProgram(null)}
                  isFavorite={favoriteIds.has(activeChannel.id)}
                  onToggleFavorite={toggleFavorite}
                  onPrevChannel={() => zapRelative(-1)}
                  onNextChannel={() => zapRelative(1)}
                  onDetachInAppPip={() => setDetachedPipInEpg(true)}
                  ambilightEnabled={ambilightEnabled}
                  theaterExpanded={theaterExpanded}
                  onToggleTheaterExpanded={() => setTheaterExpanded((v) => !v)}
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
              )}

              <VirtualizedEpgGrid
                designMode={designMode}
                channels={visibleChannels}
                xmltvMap={activeSourceId === 'builtin-reference' ? undefined : xmltvMap}
                activeChannelId={activeChannel.id}
                favoriteIds={favoriteIds}
                reminderProgramIds={reminderProgramIds}
                epgOffsetHours={epgOffsetHours}
                nowMs={nowMs}
                onSelectChannel={selectLiveChannel}
                onStartTimeshift={handleStartTimeshift}
                onToggleFavorite={toggleFavorite}
                onToggleReminder={handleToggleReminder}
              />
            </>
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
              onPlayVod={(vod) => handlePlayVod(vod)}
              onInspectVod={(vod) => setInspectMedia({ kind: 'vod', vod })}
            />
          )}

          {activeSection === 'series' && (
            <SeriesBrowserView
              designMode={designMode}
              seriesCatalog={DEMO_SERIES_CATALOG}
              initialSeriesId={focusedSeriesId}
              watchHistory={watchHistory}
              onPlayEpisode={handlePlaySeriesEpisode}
              onInspectSeries={(series) => setInspectMedia({ kind: 'series', series })}
            />
          )}

          {activeSection === 'catchup' && (
            <CatchupArchiveView
              designMode={designMode}
              channels={channels}
              nowMs={nowMs}
              onStartTimeshift={handleStartTimeshift}
            />
          )}

          {activeSection === 'studio' && (
            <ChannelStudioView
              designMode={designMode}
              channels={channels}
              groups={baseGroups}
              customBouquets={customBouquets}
              onChangeCustomBouquets={handleUpdateBouquets}
              parentalConfig={parentalConfig}
              onChangeParentalConfig={handleUpdateParental}
            />
          )}

          {activeSection === 'sources' && (
            <SourcesEngineView
              designMode={designMode}
              activeSourceId={activeSourceId}
              persistedSources={persistedSources}
              storedChannelsForActive={persistedChannels}
              ingestState={ingestState}
              onSelectSourceId={(id) => {
                setActiveSourceId(id);
                setSelectedGroupId('all');
              }}
              onDeleteSource={handleDeleteSource}
              onRunWorkerDemoImport={handleWorkerDemoImport}
              onImportM3u={handleImportM3u}
              onImportXtream={handleImportXtream}
              onUploadXmltvBuffer={handleUploadXmltvBuffer}
              onRenameChannel={handleRenameChannel}
              onToggleHideChannel={handleToggleHideChannel}
              epgOffsetHours={epgOffsetHours}
              onChangeEpgOffset={setEpgOffsetHours}
              proxyConfig={proxyConfig}
              onChangeProxyConfig={setProxyConfig}
              localRustProxyUrl={nativeProbe?.localProxyUrl ?? null}
              favoriteIds={favoriteIds}
              watchHistory={watchHistory}
              onRestoreFromSync={handleRestoreFromSync}
            />
          )}

          {activeSection === 'settings' && (
            <SettingsHubView
              designMode={designMode}
              onChangeDesignMode={setDesignMode}
              preferences={preferences}
              onChangePreferences={handleUpdatePreferences}
              sleepRemainingSec={sleepRemainingSec}
              favoriteIds={favoriteIds}
              customBouquets={customBouquets}
              parentalConfig={parentalConfig}
              onImportFullBackup={(backup) => {
                if (backup.favorites) setFavoriteIds(new Set(backup.favorites));
                if (backup.bouquets) handleUpdateBouquets(backup.bouquets);
                if (backup.parental) handleUpdateParental(backup.parental);
                if (backup.preferences) handleUpdatePreferences(backup.preferences);
                setToastMessage('Backup erfolgreich wiederhergestellt!');
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
          overrideTitle={activeOnDemand?.title}
          overrideStreamUrl={activeOnDemand?.streamUrl}
          proxyConfig={effectiveProxyConfig}
          nowMs={nowMs}
          onPrevChannel={() => zapRelative(-1)}
          onNextChannel={() => zapRelative(1)}
          onRestoreStage={() => {
            setDetachedPipInEpg(false);
            setActiveSection('live-epg');
          }}
          onClose={() => {
            if (activeSection === 'live-epg') {
              setDetachedPipInEpg(false);
            } else {
              setAutoPipWhenBrowsing(false);
            }
          }}
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
            setActiveSection('live-epg');
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
            setActiveOnDemand({
              title: `Trailer · ${inspectMedia.vod?.title ?? inspectMedia.series?.title ?? 'Preview'}`,
              subtitle: 'Offizieller 4K HDR Studio-Trailer',
              streamUrl: VERIFIED_HLS_STREAMS.tearsOfSteel,
            });
            setInspectMedia(null);
            setDetachedPipInEpg(false);
            setActiveSection('live-epg');
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
          onClose={() => setCommandBarOpen(false)}
          channels={channels}
          vodCatalog={combinedVodCatalog}
          seriesCatalog={DEMO_SERIES_CATALOG}
          nowMs={nowMs}
          onSelectChannel={(ch) => selectLiveChannel(ch)}
          onSelectVod={(vod) => handlePlayVod(vod)}
          onSelectSeriesEpisode={(ser, sNum, ep) => handlePlaySeriesEpisode(ser, sNum, ep)}
          onTriggerAction={(act) => {
            if (act === 'multiview') {
              setActiveSection((prev) => (prev === 'multiview' ? 'live-epg' : 'multiview'));
            } else if (act === 'ambilight') {
              setAmbilightEnabled((v) => !v);
            } else if (act === 'stress20k') {
              setActiveSourceId('builtin-reference');
              setStressMode20k((v) => !v);
            } else if (act === 'toggleDesign') {
              setDesignMode((prev) =>
                prev === 'm3-expressive' ? 'liquid-glass' : 'm3-expressive'
              );
            }
          }}
        />
      )}
    </div>
  );
}

export default App;
