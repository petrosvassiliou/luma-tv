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
  detectSystemLocale,
  normalizeLocale,
  TRANSLATIONS,
  type LumaPreferences,
} from './i18n/translations';
import { isProviderDividerChannel } from './services/channelSearch';
import {
  computePlaylistCanonicalKey,
  computeSyncContentDigest,
  loadDeviceCloudSyncState,
  parseSourcePrefixedMediaId,
  pullAccountCloudVault,
  pushAccountCloudVault,
  reconcileCloudSyncPayloads,
  recordLocalSyncMutation,
  remapEntityIdWithSourceMap,
  resolveMissingChannelsAndBuildHealMap,
  saveDeviceCloudSyncState,
  sendLumaPasswordReset,
  serializePlaylistForSync,
  signInLumaCloudAccount,
  signOutLumaCloudAccount,
  signUpLumaCloudAccount,
  subscribeAccountCloudVault,
  subscribeLumaAuthState,
  unlockExistingCloudSessionWithPassword,
  type EncryptedSyncEnvelope,
  type LumaCloudSessionInfo,
  type LumaSyncPlainPayload,
  type SyncedPlaylistSource,
  type WatchHistoryEntry,
} from './services/lumaCloudSync';
import { syncOsMediaSession } from './services/mediaSession';
import { useSpatialDpadFocus } from './services/spatialNavigation';
import {
  useCrossPlatformFileDropAndLaunch,
  useUniversalGamepadControls,
} from './services/universalInput';
import {
  enterLumaFullscreen,
  exitLumaFullscreen,
  getNativeDomFullscreenElement,
} from './services/fullscreenService';
import {
  detectPlatformEnvironment,
  resolveAllowedDesignMode,
} from './services/platformDetection';
import {
  bulkSetChannelsHidden,
  deduplicateStoredPlaylistSources,
  deletePersistedSource,
  fetchXtreamSeriesEpisodes,
  importM3uPlaylist,
  importXmltvForSource,
  importXtreamSource,
  isPlaylistSourceStale,
  loadPersistedSourceBundle,
  migratePersistedSourceId,
  refreshSourceAccountInfo,
  renamePersistedSource,
  renameStoredChannel,
  resyncPersistedSource,
  toggleHideStoredChannel,
  updateSourceHiddenGroups,
  type IngestProgressState,
} from './services/playlistService';
import {
  checkForLumaAppUpdate,
  triggerLumaUpdateInstall,
  type LumaUpdateCheckResult,
  type LumaUpdateProgressPayload,
} from './services/autoUpdater';
import { AppUpdateBanner } from './components/common/AppUpdateBanner';
import {
  ChannelContextMenu,
  type ChannelContextMenuTarget,
} from './components/common/ChannelContextMenu';
import type {
  CloudSyncActions,
  CloudSyncUiState,
} from './components/common/LumaCloudSyncCard';
import { CommandBar } from './components/command/CommandBar';
import { VirtualizedEpgGrid } from './components/epg/VirtualizedEpgGrid';
import { CustomTitlebar } from './components/layout/CustomTitlebar';
import { Sidebar } from './components/layout/Sidebar';
import { DualViewStage } from './components/player/DualViewStage';
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
  const activeCloudUidRef = useRef<string | null>(null);
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
    (requested: PlatformDesignMode, fromSync = false) => {
      const allowed = resolveAllowedDesignMode(requested, platformEnv.isApple);
      setDesignModeState(allowed);
      try {
        localStorage.setItem('luma.design.v1', allowed);
      } catch {
        // Ignore
      }
      if (!fromSync && platformEnv.isApple) {
        recordLocalSyncMutation(activeCloudUidRef.current, {
          scalarFields: ['preferredDesign'],
        });
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
          ...parsed,
          locale: normalizeLocale(parsed.locale ?? detectSystemLocale()),
          bufferProfile: parsed.bufferProfile ?? 'balanced',
          sleepTimerMinutes: parsed.sleepTimerMinutes ?? 0,
          spatialDpadEnabled: parsed.spatialDpadEnabled ?? true,
          autoMiniPlayerOnSwitch: Boolean(parsed.autoMiniPlayerOnSwitch ?? false),
          startupChannelId: parsed.startupChannelId ?? null,
          startupChannelName: parsed.startupChannelName ?? null,
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
      startupChannelId: null,
      startupChannelName: null,
    };
  });

  const handleUpdatePreferences = useCallback(
    (next: LumaPreferences, fromSync = false) => {
      setPreferences(next);
      try {
        localStorage.setItem('luma.prefs.v3', JSON.stringify(next));
      } catch {
        // Ignore
      }
      if (!fromSync) {
        recordLocalSyncMutation(activeCloudUidRef.current, {
          scalarFields: ['preferences'],
        });
      }
    },
    []
  );

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
  const [epgOffsetHours, setEpgOffsetHours] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('luma.epgOffset.v1');
      if (saved !== null) {
        const num = Number(saved);
        if (Number.isFinite(num)) return num;
      }
    } catch {
      // Ignore
    }
    return 0;
  });

  const handleChangeEpgOffset = useCallback((nextOffset: number) => {
    setEpgOffsetHours(nextOffset);
    try {
      localStorage.setItem('luma.epgOffset.v1', String(nextOffset));
    } catch {
      // Ignore
    }
    recordLocalSyncMutation(activeCloudUidRef.current, {
      scalarFields: ['epgOffsetHours'],
    });
  }, []);
  const [nativeProbe, setNativeProbe] = useState<NativeEngineProbe | null>(null);
  const [updateCheck, setUpdateCheck] = useState<LumaUpdateCheckResult | null>(null);
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string | null>(
    null
  );
  const [isCheckingUpdate, setIsCheckingUpdate] = useState<boolean>(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState<boolean>(false);
  const [updateProgress, setUpdateProgress] =
    useState<LumaUpdateProgressPayload | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
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

  const handleCheckForUpdates = useCallback(
    async (silent = false) => {
      if (!silent) {
        setIsCheckingUpdate(true);
        setUpdateError(null);
      }
      try {
        const res = await checkForLumaAppUpdate({
          includePrereleases: preferences.includeBetaUpdates !== false,
        });
        setUpdateCheck(res);
        if (!silent && !res.updateAvailable) {
          setToastMessage(`Luma TV is up to date (v${res.currentVersion})`);
          window.setTimeout(() => setToastMessage(null), 3000);
        }
      } catch (err) {
        if (!silent) {
          setUpdateError(
            err instanceof Error ? err.message : 'Could not check for updates.'
          );
        }
      } finally {
        if (!silent) {
          setIsCheckingUpdate(false);
        }
      }
    },
    [preferences.includeBetaUpdates]
  );

  const handleInstallAppUpdate = useCallback(async () => {
    if (!updateCheck || isInstallingUpdate) return;
    setIsInstallingUpdate(true);
    setUpdateError(null);
    try {
      await triggerLumaUpdateInstall(updateCheck, (prog) => {
        setUpdateProgress(prog);
      });
      if (updateCheck.strategy === 'android-play-protect-verified') {
        setToastMessage('Opened Android System Installer (Google Play Protect verified)');
        window.setTimeout(() => setToastMessage(null), 3600);
      }
    } catch (err) {
      setUpdateError(
        err instanceof Error ? err.message : 'Update installation failed.'
      );
    } finally {
      setIsInstallingUpdate(false);
    }
  }, [updateCheck, isInstallingUpdate]);

  useEffect(() => {
    if (preferences.autoCheckUpdates === false) return;
    const timer = window.setTimeout(() => {
      void handleCheckForUpdates(true);
    }, 4500);
    return () => window.clearTimeout(timer);
  }, [preferences.autoCheckUpdates, handleCheckForUpdates]);

  const effectiveProxyConfig = useMemo<EngineProxyConfig>(
    () => ({
      ...proxyConfig,
      bufferProfile: preferences.bufferProfile,
      ffmpegAvailable: Boolean(nativeProbe?.ffmpegAvailable),
    }),
    [proxyConfig, preferences.bufferProfile, nativeProbe?.ffmpegAvailable]
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

  const handleUpdateBouquets = useCallback(
    (next: CustomBouquet[], fromSync = false) => {
      setCustomBouquets((prev) => {
        if (!fromSync && activeCloudUidRef.current) {
          const nextIds = new Set(next.map((b) => b.id));
          const prevById = new Map(prev.map((b) => [b.id, b]));
          const tombstonedKeys: string[] = [];
          const updatedKeys: string[] = [];
          for (const oldB of prev) {
            if (!nextIds.has(oldB.id)) {
              tombstonedKeys.push(`bq:${oldB.id}`);
            }
          }
          for (const newB of next) {
            const oldB = prevById.get(newB.id);
            if (!oldB || JSON.stringify(oldB) !== JSON.stringify(newB)) {
              updatedKeys.push(`bq:${newB.id}`);
            }
          }
          if (tombstonedKeys.length > 0 || updatedKeys.length > 0) {
            recordLocalSyncMutation(activeCloudUidRef.current, {
              updatedKeys,
              tombstonedKeys,
            });
          }
        }
        return next;
      });
      try {
        localStorage.setItem('luma.bouquets.v1', JSON.stringify(next));
      } catch {
        // Ignore
      }
    },
    []
  );

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
          if (target.vod) {
            const vid = target.vod.id;
            const prevVod = col.vodIds ?? [];
            const exists = prevVod.includes(vid);
            return {
              ...col,
              vodIds: exists
                ? prevVod.filter((id) => id !== vid)
                : [...prevVod, vid],
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
        recordLocalSyncMutation(activeCloudUidRef.current, {
          updatedKeys: [`bq:${collectionId}`],
        });
        return next;
      });
    },
    []
  );

  const handleCreateCollectionWithTarget = useCallback(
    (name: string, target: ChannelContextMenuTarget) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const newId = `col-${Date.now()}`;
      setCustomBouquets((prev) => {
        const created: CustomBouquet = {
          id: newId,
          name: trimmed,
          channelIds: target.channel ? [target.channel.id] : [],
          vodIds: target.vod ? [target.vod.id] : [],
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
      recordLocalSyncMutation(activeCloudUidRef.current, {
        updatedKeys: [`bq:${newId}`],
      });
      setToastMessage(`Added to "${trimmed}"`);
      window.setTimeout(() => setToastMessage(null), 2600);
    },
    []
  );

  const handleUpdateParental = useCallback(
    (next: ParentalControlConfig, fromSync = false) => {
      setParentalConfig(next);
      try {
        localStorage.setItem('luma.parental.v1', JSON.stringify(next));
      } catch {
        // Ignore
      }
      if (!fromSync) {
        recordLocalSyncMutation(activeCloudUidRef.current, {
          scalarFields: ['parentalConfig'],
        });
      }
    },
    []
  );

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

  const handleSelectSourceId = useCallback((nextId: string, fromSync = false) => {
    setActiveSourceIdState(nextId);
    setSelectedGroupId('all');
    try {
      localStorage.setItem('luma.activeSource.v1', nextId);
    } catch {
      // Ignore
    }
    if (!fromSync) {
      recordLocalSyncMutation(activeCloudUidRef.current, {
        scalarFields: ['activeSourceId'],
      });
    }
  }, []);

  const [persistedSources, setPersistedSources] = useState<StoredPlaylistSource[]>([]);
  const [sourcesDbLoaded, setSourcesDbLoaded] = useState<boolean>(false);
  const [playlistHydrationEpoch, setPlaylistHydrationEpoch] = useState<number>(0);
  const [cloudHydratingPlaylists, setCloudHydratingPlaylists] =
    useState<boolean>(false);
  const [syncedMediaSnapshots, setSyncedMediaSnapshots] = useState<{
    channels: Record<string, Channel>;
    vod: Record<string, VodItem>;
    series: Record<string, SeriesItem>;
  }>(() => {
    try {
      const raw = localStorage.getItem('luma.cloud.mediaSnapshots.v1');
      if (raw) {
        const parsed = JSON.parse(raw) as {
          channels?: Record<string, Channel>;
          vod?: Record<string, VodItem>;
          series?: Record<string, SeriesItem>;
        };
        return {
          channels: parsed.channels ?? {},
          vod: parsed.vod ?? {},
          series: parsed.series ?? {},
        };
      }
    } catch {
      // Ignore
    }
    return { channels: {}, vod: {}, series: {} };
  });
  const [persistedChannels, setPersistedChannels] = useState<StoredChannel[]>([]);
  const [loadedBundleSourceId, setLoadedBundleSourceId] = useState<string | null>(null);
  const [crossSourceLookupChannels, setCrossSourceLookupChannels] = useState<
    StoredChannel[]
  >([]);
  const [favoritesLookupLoaded, setFavoritesLookupLoaded] = useState<boolean>(false);
  const [persistedVod, setPersistedVod] = useState<StoredVodItem[]>([]);
  const [crossSourceLookupVod, setCrossSourceLookupVod] = useState<
    StoredVodItem[]
  >([]);
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

  const [favoriteVodIds, setFavoriteVodIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('luma.favoriteVod.v1');
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch {
      // Ignore
    }
    return new Set();
  });

  const toggleFavoriteVod = useCallback((vodId: string) => {
    setFavoriteVodIds((prev) => {
      const next = new Set(prev);
      const removing = next.has(vodId);
      if (removing) next.delete(vodId);
      else next.add(vodId);
      try {
        localStorage.setItem('luma.favoriteVod.v1', JSON.stringify(Array.from(next)));
      } catch {
        // Ignore
      }
      recordLocalSyncMutation(
        activeCloudUidRef.current,
        removing
          ? { tombstonedKeys: [`vod:${vodId}`] }
          : { updatedKeys: [`vod:${vodId}`] }
      );
      return next;
    });
  }, []);

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
      const removing = next.has(seriesId);
      if (removing) next.delete(seriesId);
      else next.add(seriesId);
      try {
        localStorage.setItem('luma.favoriteSeries.v1', JSON.stringify(Array.from(next)));
      } catch {
        // Ignore
      }
      recordLocalSyncMutation(
        activeCloudUidRef.current,
        removing
          ? { tombstonedKeys: [`ser:${seriesId}`] }
          : { updatedKeys: [`ser:${seriesId}`] }
      );
      return next;
    });
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const startupRemap = await deduplicateStoredPlaylistSources();
        if (startupRemap.size > 0) {
          setFavoriteIds((prev) => {
            const remapped = Array.from(
              new Set(
                Array.from(prev).map((id) =>
                  remapEntityIdWithSourceMap(id, startupRemap)
                )
              )
            );
            try {
              localStorage.setItem('luma.favorites.v1', JSON.stringify(remapped));
            } catch {
              // Ignore
            }
            return new Set(remapped);
          });
          setFavoriteVodIds((prev) => {
            const remapped = Array.from(
              new Set(
                Array.from(prev).map((id) =>
                  remapEntityIdWithSourceMap(id, startupRemap)
                )
              )
            );
            try {
              localStorage.setItem('luma.favoriteVod.v1', JSON.stringify(remapped));
            } catch {
              // Ignore
            }
            return new Set(remapped);
          });
          setFavoriteSeriesIds((prev) => {
            const remapped = Array.from(
              new Set(
                Array.from(prev).map((id) =>
                  remapEntityIdWithSourceMap(id, startupRemap)
                )
              )
            );
            try {
              localStorage.setItem(
                'luma.favoriteSeries.v1',
                JSON.stringify(remapped)
              );
            } catch {
              // Ignore
            }
            return new Set(remapped);
          });
          setCustomBouquets((prev) => {
            const remapped = prev.map((bq) => ({
              ...bq,
              channelIds: Array.from(
                new Set(
                  bq.channelIds.map((id) =>
                    remapEntityIdWithSourceMap(id, startupRemap)
                  )
                )
              ),
              ...(bq.vodIds
                ? {
                    vodIds: Array.from(
                      new Set(
                        bq.vodIds.map((id) =>
                          remapEntityIdWithSourceMap(id, startupRemap)
                        )
                      )
                    ),
                  }
                : {}),
              ...(bq.seriesIds
                ? {
                    seriesIds: Array.from(
                      new Set(
                        bq.seriesIds.map((id) =>
                          remapEntityIdWithSourceMap(id, startupRemap)
                        )
                      )
                    ),
                  }
                : {}),
            }));
            try {
              localStorage.setItem('luma.bouquets.v1', JSON.stringify(remapped));
            } catch {
              // Ignore
            }
            return remapped;
          });
        }

        const list = await lumaDb.sources.orderBy('createdAt').reverse().toArray();
        setPersistedSources(list);
        setActiveSourceIdState((cur) => {
          const mappedCur = remapEntityIdWithSourceMap(cur, startupRemap);
          if (list.some((s) => s.id === mappedCur)) return mappedCur;
          if (list.length > 0) {
            const saved = localStorage.getItem('luma.activeSource.v1');
            if (!saved || mappedCur === 'none' || demoSourceDeleted) {
              localStorage.setItem('luma.activeSource.v1', list[0].id);
              return list[0].id;
            }
          }
          if (!demoSourceDeleted && mappedCur !== 'none') return 'builtin-reference';
          return list[0]?.id ?? 'none';
        });
      } catch {
        // Ignore IndexedDB init errors
      } finally {
        setSourcesDbLoaded(true);
      }
    })();
  }, [demoSourceDeleted]);

  const refreshActiveSourceBundle = useCallback(async (sourceId: string) => {
    if (sourceId === 'builtin-reference' || sourceId === 'none') {
      if (sourceId === 'none') {
        setPersistedChannels([]);
        setPersistedVod([]);
        setPersistedSeries([]);
        setXmltvMap(new Map());
      }
      setLoadedBundleSourceId(sourceId);
      return;
    }
    const bundle = await loadPersistedSourceBundle(sourceId);
    setPersistedChannels(bundle.channels);
    setPersistedVod(bundle.vodItems);
    setPersistedSeries(bundle.seriesItems);
    setXmltvMap(bundle.epgByTvgId);
    setLoadedBundleSourceId(sourceId);
  }, []);

  useEffect(() => {
    if (activeSourceId === 'builtin-reference' || activeSourceId === 'none') {
      setLoadedBundleSourceId(activeSourceId);
      return;
    }
    let cancelled = false;
    loadPersistedSourceBundle(activeSourceId)
      .then((bundle) => {
        if (cancelled) return;
        setPersistedChannels(bundle.channels);
        setPersistedVod(bundle.vodItems);
        setPersistedSeries(bundle.seriesItems);
        setXmltvMap(bundle.epgByTvgId);
        setLoadedBundleSourceId(activeSourceId);
      })
      .catch(() => {
        if (!cancelled) setLoadedBundleSourceId(activeSourceId);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSourceId]);

  // Resolve any Startup, Favorite, or Collection channel IDs stored in IndexedDB across ALL playlists,
  // and self-heal orphaned source prefixes (e.g. from deduplicated or re-imported playlists).
  useEffect(() => {
    const neededIds = new Set<string>(favoriteIds);
    if (preferences.startupChannelId) {
      neededIds.add(preferences.startupChannelId);
    }
    for (const bq of customBouquets) {
      for (const cid of bq.channelIds) neededIds.add(cid);
    }
    if (neededIds.size === 0) {
      setCrossSourceLookupChannels([]);
      setFavoritesLookupLoaded(true);
      return;
    }
    let cancelled = false;
    const neededArray = Array.from(neededIds);

    void (async () => {
      try {
        const rows = await lumaDb.channels.bulkGet(neededArray);
        if (cancelled) return;
        const exactFound = rows.filter((r): r is StoredChannel => Boolean(r));
        const exactFoundIds = new Set(exactFound.map((c) => c.id));

        const hasUnresolvedNonDemo = neededArray.some(
          (id) =>
            !exactFoundIds.has(id) && !(!demoSourceDeleted && id.startsWith('ch-'))
        );

        let healedResolved: StoredChannel[] = [];
        if (hasUnresolvedNonDemo) {
          const allDbChannels = await lumaDb.channels.toArray();
          if (cancelled) return;
          if (allDbChannels.length > 0) {
            const validSourceIds = new Set<string>();
            for (const ch of allDbChannels) validSourceIds.add(ch.sourceId);
            if (cloudHydratingPlaylists) {
              for (const s of persistedSources) validSourceIds.add(s.id);
            }
            const { resolvedChannels, healIdMap } =
              resolveMissingChannelsAndBuildHealMap({
                neededIds: neededArray,
                exactFoundIds,
                candidateChannels: allDbChannels,
                snapshots: syncedMediaSnapshots.channels,
                validSourceIds,
                demoSourceDeleted,
              });
            healedResolved = resolvedChannels;

            if (healIdMap.size > 0 && !cancelled) {
              setFavoriteIds((prev) => {
                let changed = false;
                const nextArr = Array.from(prev).map((id) => {
                  const mapped = healIdMap.get(id);
                  if (mapped && mapped !== id) {
                    changed = true;
                    return mapped;
                  }
                  return id;
                });
                if (!changed) return prev;
                const dedup = Array.from(new Set(nextArr));
                try {
                  localStorage.setItem('luma.favorites.v1', JSON.stringify(dedup));
                } catch {
                  // Ignore
                }
                return new Set(dedup);
              });

              setCustomBouquets((prev) => {
                let changed = false;
                const nextBq = prev.map((bq) => {
                  let bqChanged = false;
                  const mappedCh = bq.channelIds.map((id) => {
                    const mapped = healIdMap.get(id);
                    if (mapped && mapped !== id) {
                      changed = true;
                      bqChanged = true;
                      return mapped;
                    }
                    return id;
                  });
                  return bqChanged
                    ? { ...bq, channelIds: Array.from(new Set(mappedCh)) }
                    : bq;
                });
                if (!changed) return prev;
                try {
                  localStorage.setItem('luma.bouquets.v1', JSON.stringify(nextBq));
                } catch {
                  // Ignore
                }
                return nextBq;
              });

              if (
                preferences.startupChannelId &&
                healIdMap.has(preferences.startupChannelId)
              ) {
                const healedStartup = healIdMap.get(preferences.startupChannelId)!;
                handleUpdatePreferences(
                  { ...preferences, startupChannelId: healedStartup },
                  true
                );
              }
            }
          }
        }

        const mergedLookup = new Map<string, StoredChannel>();
        for (const ch of exactFound) mergedLookup.set(ch.id, ch);
        for (const ch of healedResolved) mergedLookup.set(ch.id, ch);
        if (!cancelled) {
          setCrossSourceLookupChannels(Array.from(mergedLookup.values()));
        }
      } catch {
        // Ignore lookup error
      } finally {
        if (!cancelled) setFavoritesLookupLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    favoriteIds,
    preferences,
    handleUpdatePreferences,
    customBouquets,
    persistedSources,
    persistedChannels.length,
    playlistHydrationEpoch,
    cloudHydratingPlaylists,
    demoSourceDeleted,
    syncedMediaSnapshots.channels,
  ]);

  // Resolve any Favorite or Collection VOD IDs stored in IndexedDB across ALL playlists
  useEffect(() => {
    const neededVodIds = new Set<string>(favoriteVodIds);
    for (const bq of customBouquets) {
      for (const vid of bq.vodIds ?? []) neededVodIds.add(vid);
    }
    if (neededVodIds.size === 0) {
      setCrossSourceLookupVod([]);
      return;
    }
    let cancelled = false;
    const neededArray = Array.from(neededVodIds);
    void (async () => {
      try {
        const rows = await lumaDb.vodItems.bulkGet(neededArray);
        if (cancelled) return;
        const exact = rows.filter((r): r is StoredVodItem => Boolean(r));
        const exactIds = new Set(exact.map((v) => v.id));
        const validSourceIds = new Set(persistedSources.map((s) => s.id));
        const missingOrphans = neededArray.filter((id) => {
          if (exactIds.has(id) || id.startsWith('vod-')) return false;
          const p = parseSourcePrefixedMediaId(id);
          return Boolean(p && !validSourceIds.has(p.sourcePrefix));
        });
        if (missingOrphans.length > 0) {
          const allVod = await lumaDb.vodItems.toArray();
          if (cancelled) return;
          const byTail = new Map<string, StoredVodItem>();
          for (const v of allVod) {
            const p = parseSourcePrefixedMediaId(v.id);
            if (p && !byTail.has(p.tail)) byTail.set(p.tail, v);
          }
          const healVodMap = new Map<string, string>();
          for (const mid of missingOrphans) {
            const p = parseSourcePrefixedMediaId(mid);
            const match = p ? byTail.get(p.tail) : undefined;
            if (match) {
              exact.push(match);
              healVodMap.set(mid, match.id);
            }
          }
          if (healVodMap.size > 0 && !cancelled) {
            setFavoriteVodIds((prev) => {
              const next = Array.from(
                new Set(Array.from(prev).map((id) => healVodMap.get(id) ?? id))
              );
              try {
                localStorage.setItem('luma.favoriteVod.v1', JSON.stringify(next));
              } catch {
                // Ignore
              }
              return new Set(next);
            });
          }
        }
        if (!cancelled) setCrossSourceLookupVod(exact);
      } catch {
        // Ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    favoriteVodIds,
    customBouquets,
    persistedSources,
    persistedVod.length,
    playlistHydrationEpoch,
  ]);

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
    const neededArray = Array.from(neededSeriesIds);
    void (async () => {
      try {
        const rows = await lumaDb.seriesItems.bulkGet(neededArray);
        if (cancelled) return;
        const exact = rows.filter((r): r is StoredSeriesItem => Boolean(r));
        const exactIds = new Set(exact.map((s) => s.id));
        const validSourceIds = new Set(persistedSources.map((s) => s.id));
        const missingOrphans = neededArray.filter((id) => {
          if (exactIds.has(id) || id.startsWith('ser-')) return false;
          const p = parseSourcePrefixedMediaId(id);
          return Boolean(p && !validSourceIds.has(p.sourcePrefix));
        });
        if (missingOrphans.length > 0) {
          const allSer = await lumaDb.seriesItems.toArray();
          if (cancelled) return;
          const byTail = new Map<string, StoredSeriesItem>();
          for (const s of allSer) {
            const p = parseSourcePrefixedMediaId(s.id);
            if (p && !byTail.has(p.tail)) byTail.set(p.tail, s);
          }
          const healSerMap = new Map<string, string>();
          for (const mid of missingOrphans) {
            const p = parseSourcePrefixedMediaId(mid);
            const match = p ? byTail.get(p.tail) : undefined;
            if (match) {
              exact.push(match);
              healSerMap.set(mid, match.id);
            }
          }
          if (healSerMap.size > 0 && !cancelled) {
            setFavoriteSeriesIds((prev) => {
              const next = Array.from(
                new Set(Array.from(prev).map((id) => healSerMap.get(id) ?? id))
              );
              try {
                localStorage.setItem('luma.favoriteSeries.v1', JSON.stringify(next));
              } catch {
                // Ignore
              }
              return new Set(next);
            });
          }
        }
        if (!cancelled) setCrossSourceLookupSeries(exact);
      } catch {
        // Ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    favoriteSeriesIds,
    customBouquets,
    persistedSources,
    persistedSeries.length,
    playlistHydrationEpoch,
  ]);

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

  // Unified lookup pool for Favorites & Collections (includes hidden-group, cross-playlist, and synced snapshot channels)
  const collectionAndFavoritePool: Channel[] = useMemo(() => {
    const map = new Map<string, Channel>();
    for (const ch of persistedChannels) map.set(ch.id, ch);
    for (const ch of crossSourceLookupChannels) map.set(ch.id, ch);
    for (const snapCh of Object.values(syncedMediaSnapshots.channels)) {
      if (!map.has(snapCh.id)) map.set(snapCh.id, snapCh);
    }
    if (!demoSourceDeleted) {
      for (const ch of builtinCatalog.channels) {
        if (!map.has(ch.id)) map.set(ch.id, ch);
      }
    }
    return Array.from(map.values());
  }, [
    persistedChannels,
    crossSourceLookupChannels,
    syncedMediaSnapshots.channels,
    demoSourceDeleted,
    builtinCatalog,
  ]);

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

  const collectionAndFavoriteVodPool: VodItem[] = useMemo(() => {
    const map = new Map<string, VodItem>();
    for (const vod of persistedVod) map.set(vod.id, vod);
    for (const vod of crossSourceLookupVod) map.set(vod.id, vod);
    for (const snapVod of Object.values(syncedMediaSnapshots.vod)) {
      if (!map.has(snapVod.id)) map.set(snapVod.id, snapVod);
    }
    if (!demoSourceDeleted) {
      for (const vod of DEMO_VOD_CATALOG) {
        if (!map.has(vod.id)) map.set(vod.id, vod);
      }
    }
    return Array.from(map.values());
  }, [
    persistedVod,
    crossSourceLookupVod,
    syncedMediaSnapshots.vod,
    demoSourceDeleted,
  ]);

  const collectionAndFavoriteSeriesPool: SeriesItem[] = useMemo(() => {
    const map = new Map<string, SeriesItem>();
    for (const ser of persistedSeries) map.set(ser.id, ser);
    for (const ser of crossSourceLookupSeries) map.set(ser.id, ser);
    for (const snapSer of Object.values(syncedMediaSnapshots.series)) {
      if (!map.has(snapSer.id)) map.set(snapSer.id, snapSer);
    }
    if (!demoSourceDeleted) {
      for (const ser of DEMO_SERIES_CATALOG) {
        if (!map.has(ser.id)) map.set(ser.id, ser);
      }
    }
    return Array.from(map.values());
  }, [
    persistedSeries,
    crossSourceLookupSeries,
    syncedMediaSnapshots.series,
    demoSourceDeleted,
  ]);

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

  const [activeChannelId, setActiveChannelId] = useState<string>(
    () =>
      preferences.startupChannelId ||
      Array.from(favoriteIds)[0] ||
      'ch-redbull-tv'
  );
  const userManuallySelectedChannelRef = useRef<boolean>(false);
  const startupChannelResolvedRef = useRef<boolean>(false);
  const [activeOnDemand, setActiveOnDemand] = useState<{
    itemId: string;
    kind: 'vod' | 'catchup';
    mediaKind: 'movie' | 'series';
    favoriteTargetId: string;
    returnSection: 'vod' | 'series';
    badgeTop: string;
    badgeCode: string;
    techBadge: string;
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

  const [dualSlotIds, setDualSlotIds] = useState<[string, string]>(() => {
    try {
      const raw = localStorage.getItem('luma.dualview.v1');
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (
          Array.isArray(parsed) &&
          typeof parsed[0] === 'string' &&
          typeof parsed[1] === 'string'
        ) {
          return [parsed[0], parsed[1]];
        }
      }
    } catch {
      // Ignore
    }
    return ['ch-redbull-tv', 'ch-luma-cinema-4k'];
  });
  const [dualAudioSlot, setDualAudioSlot] = useState<0 | 1>(0);
  const [dualMuted, setDualMuted] = useState<boolean>(false);
  const [dualSidebarOpen, setDualSidebarOpen] = useState<boolean>(false);

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
      const removing = next.has(channelId);
      if (removing) next.delete(channelId);
      else next.add(channelId);
      try {
        localStorage.setItem('luma.favorites.v1', JSON.stringify(Array.from(next)));
      } catch {
        // Ignore
      }
      recordLocalSyncMutation(
        activeCloudUidRef.current,
        removing
          ? { tombstonedKeys: [`fav:${channelId}`] }
          : { updatedKeys: [`fav:${channelId}`] }
      );
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

  // Automatically start on the user's configured Default Startup Channel, or otherwise the First Favorite channel
  useEffect(() => {
    if (userManuallySelectedChannelRef.current || startupChannelResolvedRef.current) {
      return;
    }
    if (!sourcesDbLoaded || !favoritesLookupLoaded) return;
    if (
      activeSourceId !== 'builtin-reference' &&
      activeSourceId !== 'none' &&
      loadedBundleSourceId !== activeSourceId
    ) {
      return;
    }

    const explicitId = preferences.startupChannelId?.trim() || '';
    const explicitMatch = explicitId
      ? (channels.find((c) => c.id === explicitId) ??
        collectionAndFavoritePool.find((c) => c.id === explicitId) ??
        null)
      : null;

    const firstFavoriteMatch =
      collectionAndFavoritePool.find((c) => favoriteIds.has(c.id)) ??
      channels.find((c) => favoriteIds.has(c.id)) ??
      null;

    const fallbackMatch =
      channels.find((c) => !isProviderDividerChannel(c.name)) ?? channels[0] ?? null;

    const chosen = explicitMatch ?? firstFavoriteMatch ?? fallbackMatch;
    startupChannelResolvedRef.current = true;
    if (chosen) {
      setActiveChannelId(chosen.id);
    }
  }, [
    sourcesDbLoaded,
    favoritesLookupLoaded,
    activeSourceId,
    loadedBundleSourceId,
    preferences.startupChannelId,
    channels,
    collectionAndFavoritePool,
    favoriteIds,
  ]);

  const activeChannel: Channel = useMemo(
    () =>
      channels.find((c) => c.id === activeChannelId) ??
      collectionAndFavoritePool.find((c) => c.id === activeChannelId) ??
      channels.find((c) => !isProviderDividerChannel(c.name)) ??
      channels[0] ??
      builtinCatalog.channels[0],
    [channels, collectionAndFavoritePool, activeChannelId, builtinCatalog.channels]
  );

  const updateDualSlotIds = useCallback(
    (updater: (prev: [string, string]) => [string, string]) => {
      setDualSlotIds((prev) => {
        const next = updater(prev);
        try {
          localStorage.setItem('luma.dualview.v1', JSON.stringify(next));
        } catch {
          // Ignore
        }
        recordLocalSyncMutation(activeCloudUidRef.current, {
          scalarFields: ['dualSlotIds'],
        });
        return next;
      });
    },
    []
  );

  const openDualView = useCallback(() => {
    const primaryId = activeChannel.id;
    const pool = visibleChannels.length > 1 ? visibleChannels : channels;
    updateDualSlotIds((prev) => {
      const existingSecond = prev[1];
      const secondValid =
        existingSecond &&
        existingSecond !== primaryId &&
        channels.some((c) => c.id === existingSecond);
      if (secondValid) {
        return [primaryId, existingSecond];
      }
      const primaryIdx = pool.findIndex((c) => c.id === primaryId);
      const fallbackSecond =
        (primaryIdx >= 0 ? pool[(primaryIdx + 1) % pool.length] : null) ??
        pool.find((c) => c.id !== primaryId && !isProviderDividerChannel(c.name)) ??
        channels.find((c) => c.id !== primaryId) ??
        activeChannel;
      return [primaryId, fallbackSecond.id];
    });
    setDualAudioSlot(0);
    setDualMuted(false);
    setDualSidebarOpen(false);
    setPipDismissedWhileBrowsing(false);
    setActiveSection('dualview');
  }, [activeChannel, visibleChannels, channels, updateDualSlotIds]);

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
      userManuallySelectedChannelRef.current = true;
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

  const [liveDrawerRevealSignal, setLiveDrawerRevealSignal] = useState(0);

  const handleSelectSidebarGroup = useCallback(
    (groupId: string) => {
      if (groupId === 'all' || groupId === 'favorites') {
        setSelectedGroupId(groupId);
        setLiveDrawerRevealSignal((n) => n + 1);
        setActiveSection((cur) => (cur === 'live-epg' ? 'live-epg' : 'live'));
        return;
      }
      const grp = groups.find((g) => g.id === groupId);
      if (grp?.isPinLocked && !unlockedGroupIds.has(groupId)) {
        setPendingPinGroup({ id: grp.id, name: grp.name });
        return;
      }
      setSelectedGroupId(groupId);
      setLiveDrawerRevealSignal((n) => n + 1);
      setActiveSection((cur) => (cur === 'live-epg' ? 'live-epg' : 'live'));
    },
    [groups, unlockedGroupIds]
  );

  const handleStartTimeshift = useCallback(
    (ch: Channel, program: EpgProgram) => {
      userManuallySelectedChannelRef.current = true;
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
      userManuallySelectedChannelRef.current = true;
      ensureAudioUnmutedForSwitch();
      const existingResume =
        explicitResumeSec ??
        watchHistory.find((w) => w.itemId === vod.id)?.resumeSec ??
        0;
      const durationSec = Math.max(60, vod.durationMin * 60);

      setActiveOnDemand({
        itemId: vod.id,
        kind: 'vod',
        mediaKind: 'movie',
        favoriteTargetId: vod.id,
        returnSection: 'vod',
        badgeTop: 'VOD',
        badgeCode: vod.resolution.includes('4K') ? '4K' : 'HD',
        techBadge: `${vod.resolution} · ${vod.codec}`,
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
        mediaKind: 'series',
        favoriteTargetId: series.id,
        returnSection: 'series',
        badgeTop: 'SERIES',
        badgeCode: code,
        techBadge: ep.resolution,
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
    syncOsMediaSession(
      activeChannel,
      title,
      {
        onPrevChannel: () => zapRelative(-1),
        onNextChannel: () => zapRelative(1),
      },
      activeOnDemand
        ? {
            title: activeOnDemand.title,
            subtitle: activeOnDemand.subtitle,
            badgeTop: activeOnDemand.badgeTop,
          }
        : null
    );
  }, [activeChannel, activeOnDemand, timeshiftProgram, nowMs, epgOffsetHours, zapRelative]);

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
      recordLocalSyncMutation(activeCloudUidRef.current, {
        updatedKeys: [`pl:${computePlaylistCanonicalKey(source)}`],
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
      recordLocalSyncMutation(activeCloudUidRef.current, {
        updatedKeys: [`pl:${computePlaylistCanonicalKey(source)}`],
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
    const existing = await lumaDb.sources.get(sourceId);
    if (existing) {
      recordLocalSyncMutation(activeCloudUidRef.current, {
        tombstonedKeys: [`pl:${computePlaylistCanonicalKey(existing)}`],
      });
    }
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
    const demoTombstones: string[] = ['bq:bq-weekend-sport'];
    // Remove built-in demo favorites & default demo bouquet so ghost demo items don't linger
    setFavoriteIds((prev) => {
      const arr = Array.from(prev);
      for (const id of arr) {
        if (id.startsWith('ch-')) demoTombstones.push(`fav:${id}`);
      }
      const next = new Set(arr.filter((id) => !id.startsWith('ch-')));
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
    recordLocalSyncMutation(activeCloudUidRef.current, {
      scalarFields: ['demoSourceDeleted'],
      tombstonedKeys: demoTombstones,
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
    recordLocalSyncMutation(activeCloudUidRef.current, {
      scalarFields: ['demoSourceDeleted'],
    });
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
    const updated = await lumaDb.sources.get(sourceId);
    if (updated) {
      recordLocalSyncMutation(activeCloudUidRef.current, {
        updatedKeys: [`pl:${computePlaylistCanonicalKey(updated)}`],
      });
    }
    await reloadSourcesList();
  };

  const handleUpdateHiddenGroups = async (sourceId: string, hiddenGroupIds: string[]) => {
    await updateSourceHiddenGroups(sourceId, hiddenGroupIds);
    const updated = await lumaDb.sources.get(sourceId);
    if (updated) {
      recordLocalSyncMutation(activeCloudUidRef.current, {
        updatedKeys: [`pl:${computePlaylistCanonicalKey(updated)}`],
      });
    }
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

  // Background Automatic Playlist & XMLTV Refresh Scheduler
  const autoRefreshingRef = useRef<boolean>(false);
  useEffect(() => {
    const intervalHours = preferences.autoRefreshHours ?? 12;
    if (intervalHours <= 0 || persistedSources.length === 0) return;

    let cancelled = false;

    const checkAndAutoRefresh = async () => {
      if (cancelled || autoRefreshingRef.current || ingestState.active) return;
      const now = Date.now();
      const staleSources = persistedSources.filter((src) =>
        isPlaylistSourceStale(src, intervalHours, now)
      );
      if (staleSources.length === 0) return;

      autoRefreshingRef.current = true;
      try {
        const proxyEndpoint =
          proxyConfig.enabled || isLocalRustProxyEndpoint(proxyConfig.endpointUrl)
            ? proxyConfig.endpointUrl
            : nativeProbe?.localProxyUrl || undefined;

        for (const src of staleSources) {
          if (cancelled) break;
          try {
            await resyncPersistedSource({
              source: src,
              proxyEndpoint,
            });
          } catch {
            // Silently skip offline/unreachable provider during background refresh
          }
        }

        if (!cancelled) {
          const updatedList = await lumaDb.sources.orderBy('createdAt').reverse().toArray();
          setPersistedSources(updatedList);
          if (staleSources.some((s) => s.id === activeSourceId)) {
            await refreshActiveSourceBundle(activeSourceId);
          }
          setToastMessage(
            `Auto-refreshed ${staleSources.map((s) => s.name).join(', ')}`
          );
          window.setTimeout(() => setToastMessage(null), 3200);
        }
      } finally {
        autoRefreshingRef.current = false;
      }
    };

    const startupTimer = window.setTimeout(() => {
      void checkAndAutoRefresh();
    }, 6000);

    const periodicTimer = window.setInterval(() => {
      void checkAndAutoRefresh();
    }, 15 * 60_000);

    return () => {
      cancelled = true;
      window.clearTimeout(startupTimer);
      window.clearInterval(periodicTimer);
    };
  }, [
    preferences.autoRefreshHours,
    persistedSources,
    ingestState.active,
    proxyConfig.enabled,
    proxyConfig.endpointUrl,
    nativeProbe?.localProxyUrl,
    activeSourceId,
    refreshActiveSourceBundle,
  ]);

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
      recordLocalSyncMutation(
        activeCloudUidRef.current,
        exists
          ? { tombstonedKeys: [`rem:${program.id}`] }
          : { updatedKeys: [`rem:${program.id}`] }
      );
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

  // =========================================================================
  // Firebase Cloud Sync (Incremental 3-Way + Tombstone + Deduplicated Vault)
  // =========================================================================
  const [cloudSession, setCloudSession] = useState<LumaCloudSessionInfo | null>(null);
  useEffect(() => {
    activeCloudUidRef.current = cloudSession?.uid ?? null;
  }, [cloudSession?.uid]);

  const [cloudAutoSyncEnabled, setCloudAutoSyncEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('luma.cloud.autoSync.v1') !== '0';
    } catch {
      return true;
    }
  });
  const [cloudSyncPlaylistsEnabled, setCloudSyncPlaylistsEnabled] = useState<boolean>(
    () => {
      try {
        return localStorage.getItem('luma.cloud.syncPlaylists.v1') !== '0';
      } catch {
        return true;
      }
    }
  );
  const [cloudBusy, setCloudBusy] = useState<boolean>(false);
  const [cloudLastSyncedAtMs, setCloudLastSyncedAtMs] = useState<number | null>(null);
  const [cloudLastDeviceLabel, setCloudLastDeviceLabel] = useState<string | null>(
    null
  );
  const [cloudStatusMessage, setCloudStatusMessage] = useState<string | null>(null);
  const [cloudErrorMessage, setCloudErrorMessage] = useState<string | null>(null);

  const suppressCloudAutoPushUntilRef = useRef<number>(0);
  const lastRemoteVaultUpdatedAtRef = useRef<number>(0);
  const lastSyncedContentDigestRef = useRef<string>('');
  const cloudSyncInFlightRef = useRef<Promise<void> | null>(null);
  const didMountCloudWatcherRef = useRef<boolean>(false);

  const reconcileSyncedPlaylists = useCallback(
    async (
      syncedPlaylists: SyncedPlaylistSource[],
      options?: {
        preferredActiveId?: string;
        deletedPlaylistIds?: readonly string[];
      }
    ) => {
      const preferredActiveId = options?.preferredActiveId;
      const deletedSet = new Set(options?.deletedPlaylistIds ?? []);

      if (deletedSet.size > 0) {
        for (const delId of deletedSet) {
          await deletePersistedSource(delId);
        }
      }

      // Clean up any local duplicates first, preferring the cloud canonical IDs
      const preferredCanonicalIds = new Set(syncedPlaylists.map((p) => p.id));
      await deduplicateStoredPlaylistSources(preferredCanonicalIds);

      const existing = await lumaDb.sources.toArray();
      const existingById = new Map(existing.map((s) => [s.id, s]));
      const existingByCanon = new Map(
        existing.map((s) => [computePlaylistCanonicalKey(s), s])
      );
      const toHydrate: StoredPlaylistSource[] = [];

      for (const sp of syncedPlaylists) {
        const canonKey = computePlaylistCanonicalKey(sp);
        let prev = existingById.get(sp.id);
        const canonMatch = existingByCanon.get(canonKey);

        // If local DB already has this exact playlist URL/server under a different ID,
        // migrate its IndexedDB channels/VOD/series/EPG in-place to `sp.id` (0 duplicates!).
        if (!prev && canonMatch && canonMatch.id !== sp.id) {
          const migrated = await migratePersistedSourceId(canonMatch.id, sp.id, {
            name: sp.name,
            endpoint: sp.endpoint,
            rawUrlOrHost: sp.rawUrlOrHost,
            username: sp.username,
            password: sp.password,
            outputFormat: sp.outputFormat,
            xmltvUrl: sp.xmltvUrl,
            hiddenGroupIds: sp.hiddenGroupIds ?? canonMatch.hiddenGroupIds,
            epgOffsetHours: sp.epgOffsetHours ?? canonMatch.epgOffsetHours,
            updatedAtMs: sp.updatedAt ?? Date.now(),
          });
          existingById.delete(canonMatch.id);
          if (migrated) {
            existingById.set(sp.id, migrated);
            prev = migrated;
          }
        }

        if (!prev) {
          const created: StoredPlaylistSource = {
            id: sp.id,
            name: sp.name,
            type: sp.type,
            endpoint: sp.endpoint,
            rawUrlOrHost: sp.rawUrlOrHost,
            username: sp.username,
            password: sp.password,
            outputFormat: sp.outputFormat,
            xmltvUrl: sp.xmltvUrl,
            hiddenGroupIds: sp.hiddenGroupIds ?? [],
            epgOffsetHours: sp.epgOffsetHours ?? 0,
            channelCount: 0,
            vodCount: 0,
            seriesCount: 0,
            epgStatus: 'syncing',
            lastUpdated: 'Cloud Sync',
            createdAt: sp.createdAt ?? Date.now(),
            updatedAtMs: sp.updatedAt ?? sp.createdAt ?? Date.now(),
          };
          await lumaDb.sources.put(created);
          if (
            (created.type === 'xtream' &&
              created.rawUrlOrHost &&
              created.username &&
              created.password) ||
            (created.rawUrlOrHost && created.rawUrlOrHost.startsWith('http'))
          ) {
            toHydrate.push(created);
          }
        } else {
          const actualStoredCount = await lumaDb.channels
            .where('sourceId')
            .equals(prev.id)
            .count();
          const credsChanged =
            computePlaylistCanonicalKey(prev) !== canonKey ||
            (prev.password ?? '') !== (sp.password ?? '') ||
            (prev.outputFormat ?? 'm3u8') !== (sp.outputFormat ?? 'm3u8') ||
            (prev.xmltvUrl ?? '') !== (sp.xmltvUrl ?? '');
          const updated: StoredPlaylistSource = {
            ...prev,
            channelCount: actualStoredCount > 0 ? actualStoredCount : prev.channelCount,
            name: sp.name,
            endpoint: sp.endpoint,
            rawUrlOrHost: sp.rawUrlOrHost,
            username: sp.username,
            password: sp.password,
            outputFormat: sp.outputFormat,
            xmltvUrl: sp.xmltvUrl,
            hiddenGroupIds: sp.hiddenGroupIds ?? prev.hiddenGroupIds,
            epgOffsetHours: sp.epgOffsetHours ?? prev.epgOffsetHours,
            updatedAtMs: sp.updatedAt ?? prev.updatedAtMs ?? Date.now(),
          };
          await lumaDb.sources.put(updated);
          if (
            (credsChanged || actualStoredCount === 0) &&
            ((updated.type === 'xtream' &&
              updated.rawUrlOrHost &&
              updated.username &&
              updated.password) ||
              (updated.rawUrlOrHost && updated.rawUrlOrHost.startsWith('http')))
          ) {
            toHydrate.push(updated);
          }
        }
      }

      const refreshedSources = await lumaDb.sources
        .orderBy('createdAt')
        .reverse()
        .toArray();
      setPersistedSources(refreshedSources);

      if (
        preferredActiveId &&
        (preferredActiveId === 'builtin-reference' ||
          preferredActiveId === 'none' ||
          refreshedSources.some((s) => s.id === preferredActiveId))
      ) {
        handleSelectSourceId(preferredActiveId, true);
        if (preferredActiveId !== 'builtin-reference' && preferredActiveId !== 'none') {
          await refreshActiveSourceBundle(preferredActiveId);
        }
      } else if (
        activeSourceId !== 'builtin-reference' &&
        activeSourceId !== 'none' &&
        !refreshedSources.some((s) => s.id === activeSourceId)
      ) {
        const fallbackId =
          refreshedSources[0]?.id ?? (demoSourceDeleted ? 'none' : 'builtin-reference');
        handleSelectSourceId(fallbackId, true);
      }

      if (toHydrate.length > 0) {
        setCloudHydratingPlaylists(true);
        try {
          const proxyEndpoint =
            proxyConfig.enabled || isLocalRustProxyEndpoint(proxyConfig.endpointUrl)
              ? proxyConfig.endpointUrl
              : nativeProbe?.localProxyUrl || undefined;
          let hydrationErrors: string[] = [];
          for (const src of toHydrate) {
            try {
              await resyncPersistedSource({ source: src, proxyEndpoint });
            } catch (err) {
              hydrationErrors.push(
                `${src.name}: ${err instanceof Error ? err.message : 'sync error'}`
              );
            }
          }
          const afterHydrate = await lumaDb.sources
            .orderBy('createdAt')
            .reverse()
            .toArray();
          setPersistedSources(afterHydrate);
          setPlaylistHydrationEpoch((n) => n + 1);
          const targetActive = preferredActiveId || activeSourceId;
          if (
            targetActive &&
            targetActive !== 'builtin-reference' &&
            targetActive !== 'none'
          ) {
            await refreshActiveSourceBundle(targetActive);
          }
          if (hydrationErrors.length > 0) {
            setCloudErrorMessage(
              `Playlist refresh issue — ${hydrationErrors[0]}`
            );
          }
        } finally {
          setCloudHydratingPlaylists(false);
        }
      }
    },
    [
      activeSourceId,
      demoSourceDeleted,
      handleSelectSourceId,
      nativeProbe?.localProxyUrl,
      proxyConfig.enabled,
      proxyConfig.endpointUrl,
      refreshActiveSourceBundle,
    ]
  );

  const handleRestoreFromSync = useCallback(
    (
      payload: LumaSyncPlainPayload,
      options?: { deletedPlaylistIds?: readonly string[] }
    ) => {
      suppressCloudAutoPushUntilRef.current = Date.now() + 3200;

      const restoredFavs = new Set(payload.favorites ?? []);
      setFavoriteIds(restoredFavs);

      if (payload.favoriteVodIds) {
        setFavoriteVodIds(new Set(payload.favoriteVodIds));
      }
      if (payload.favoriteSeriesIds) {
        setFavoriteSeriesIds(new Set(payload.favoriteSeriesIds));
      }
      if (payload.customBouquets) {
        handleUpdateBouquets(payload.customBouquets, true);
      }
      if (payload.watchHistory) {
        setWatchHistory(payload.watchHistory);
      }
      if (payload.reminders) {
        setReminders(payload.reminders);
      }
      if (payload.parentalConfig) {
        handleUpdateParental(payload.parentalConfig, true);
      }
      if (payload.preferences) {
        handleUpdatePreferences(payload.preferences, true);
      }
      if (typeof payload.epgOffsetHours === 'number') {
        setEpgOffsetHours(payload.epgOffsetHours);
        try {
          localStorage.setItem('luma.epgOffset.v1', String(payload.epgOffsetHours));
        } catch {
          // Ignore
        }
      }
      if (payload.preferredDesign && platformEnv.isApple) {
        handleChangeDesignMode(payload.preferredDesign, true);
      }
      if (
        payload.dualSlotIds &&
        payload.dualSlotIds.length === 2 &&
        payload.dualSlotIds[0] &&
        payload.dualSlotIds[1]
      ) {
        setDualSlotIds(payload.dualSlotIds);
      }
      if (payload.multiviewSlotIds && payload.multiviewSlotIds.length === 4) {
        setMultiviewSlotIds(payload.multiviewSlotIds);
      }
      if (
        payload.channelSnapshots ||
        payload.vodSnapshots ||
        payload.seriesSnapshots
      ) {
        setSyncedMediaSnapshots((prev) => {
          const next = {
            channels: {
              ...prev.channels,
              ...(payload.channelSnapshots ?? {}),
            },
            vod: {
              ...prev.vod,
              ...(payload.vodSnapshots ?? {}),
            },
            series: {
              ...prev.series,
              ...(payload.seriesSnapshots ?? {}),
            },
          };
          try {
            localStorage.setItem(
              'luma.cloud.mediaSnapshots.v1',
              JSON.stringify(next)
            );
          } catch {
            // Ignore
          }
          return next;
        });
      }

      if (typeof payload.demoSourceDeleted === 'boolean') {
        setDemoSourceDeleted(payload.demoSourceDeleted);
      }

      try {
        localStorage.setItem(
          'luma.favorites.v1',
          JSON.stringify(payload.favorites ?? [])
        );
        if (payload.favoriteVodIds) {
          localStorage.setItem(
            'luma.favoriteVod.v1',
            JSON.stringify(payload.favoriteVodIds)
          );
        }
        if (payload.favoriteSeriesIds) {
          localStorage.setItem(
            'luma.favoriteSeries.v1',
            JSON.stringify(payload.favoriteSeriesIds)
          );
        }
        if (payload.watchHistory) {
          localStorage.setItem(
            'luma.watch.history.v1',
            JSON.stringify(payload.watchHistory)
          );
        }
        if (payload.reminders) {
          localStorage.setItem(
            'luma.reminders.v1',
            JSON.stringify(payload.reminders)
          );
        }
        if (payload.dualSlotIds) {
          localStorage.setItem(
            'luma.dualview.v1',
            JSON.stringify(payload.dualSlotIds)
          );
        }
        if (typeof payload.demoSourceDeleted === 'boolean') {
          if (payload.demoSourceDeleted) {
            localStorage.setItem('luma.demoDeleted.v1', '1');
          } else {
            localStorage.removeItem('luma.demoDeleted.v1');
          }
        }
      } catch {
        // Ignore storage errors
      }

      if (
        payload.playlists !== undefined ||
        (options?.deletedPlaylistIds?.length ?? 0) > 0
      ) {
        void reconcileSyncedPlaylists(payload.playlists ?? [], {
          preferredActiveId: payload.activeSourceId,
          deletedPlaylistIds: options?.deletedPlaylistIds,
        });
      } else if (payload.activeSourceId === 'builtin-reference') {
        handleSelectSourceId('builtin-reference', true);
      }
    },
    [
      handleChangeDesignMode,
      handleSelectSourceId,
      handleUpdateBouquets,
      handleUpdateParental,
      handleUpdatePreferences,
      platformEnv.isApple,
      reconcileSyncedPlaylists,
    ]
  );

  const buildFullCloudSyncPayload = useCallback(
    (overrideSources?: StoredPlaylistSource[]): LumaSyncPlainPayload => {
      const effectiveSources = overrideSources ?? persistedSources;

      // Capture compact portable snapshots of favorited & collected items so any synced
      // device renders Favorites and Collections ("Greek", etc.) immediately with zero delay.
      const neededChIds = new Set<string>(favoriteIds);
      if (preferences.startupChannelId) {
        neededChIds.add(preferences.startupChannelId);
      }
      const neededVodIds = new Set<string>(favoriteVodIds);
      const neededSerIds = new Set<string>(favoriteSeriesIds);
      for (const bq of customBouquets) {
        for (const cid of bq.channelIds) neededChIds.add(cid);
        for (const vid of bq.vodIds ?? []) neededVodIds.add(vid);
        for (const sid of bq.seriesIds ?? []) neededSerIds.add(sid);
      }

      const chById = new Map(collectionAndFavoritePool.map((c) => [c.id, c]));
      const channelSnapshots: Record<string, Channel> = {};
      let chCount = 0;
      for (const cid of neededChIds) {
        if (chCount >= 500) break;
        if (cid.startsWith('ch-')) continue;
        const ch = chById.get(cid);
        if (ch) {
          channelSnapshots[cid] = {
            id: ch.id,
            number: ch.number,
            name: ch.name,
            shortCode: ch.shortCode,
            groupId: ch.groupId,
            groupName: ch.groupName,
            streamUrl: ch.streamUrl,
            streamType: ch.streamType,
            resolution: ch.resolution,
            audioBadge: ch.audioBadge,
            codec: ch.codec,
            hasCatchup: ch.hasCatchup,
            catchupDays: ch.catchupDays,
            ...(ch.catchupMode ? { catchupMode: ch.catchupMode } : {}),
            ...(ch.catchupSource ? { catchupSource: ch.catchupSource } : {}),
            ...(ch.xtreamStreamId ? { xtreamStreamId: ch.xtreamStreamId } : {}),
            ...(ch.tvgId ? { tvgId: ch.tvgId } : {}),
            ...(ch.logoUrl ? { logoUrl: ch.logoUrl } : {}),
            accentColor: ch.accentColor,
            country: ch.country,
            epgArchetype: ch.epgArchetype,
          };
          chCount += 1;
        }
      }

      const vodById = new Map(collectionAndFavoriteVodPool.map((v) => [v.id, v]));
      const vodSnapshots: Record<string, VodItem> = {};
      let vodCount = 0;
      for (const vid of neededVodIds) {
        if (vodCount >= 180) break;
        if (vid.startsWith('vod-')) continue;
        const vod = vodById.get(vid);
        if (vod) {
          vodSnapshots[vid] = vod;
          vodCount += 1;
        }
      }

      const serById = new Map(
        collectionAndFavoriteSeriesPool.map((s) => [s.id, s])
      );
      const seriesSnapshots: Record<string, SeriesItem> = {};
      let serCount = 0;
      for (const sid of neededSerIds) {
        if (serCount >= 180) break;
        if (sid.startsWith('ser-')) continue;
        const ser = serById.get(sid);
        if (ser) {
          seriesSnapshots[sid] = {
            ...ser,
            seasonsLoaded: false,
            seasons: [{ seasonNumber: 1, title: 'Season 1', episodes: [] }],
          };
          serCount += 1;
        }
      }

      return {
        schemaVersion: 3,
        exportedAt: Date.now(),
        favorites: Array.from(favoriteIds),
        favoriteVodIds: Array.from(favoriteVodIds),
        favoriteSeriesIds: Array.from(favoriteSeriesIds),
        customBouquets,
        watchHistory,
        reminders,
        parentalConfig,
        preferences,
        epgOffsetHours,
        preferredDesign: designMode,
        dualSlotIds,
        multiviewSlotIds,
        activeSourceId,
        demoSourceDeleted,
        playlists: cloudSyncPlaylistsEnabled
          ? effectiveSources.map(serializePlaylistForSync)
          : undefined,
        ...(chCount > 0 ? { channelSnapshots } : {}),
        ...(vodCount > 0 ? { vodSnapshots } : {}),
        ...(serCount > 0 ? { seriesSnapshots } : {}),
      };
    },
    [
      activeSourceId,
      cloudSyncPlaylistsEnabled,
      collectionAndFavoritePool,
      collectionAndFavoriteSeriesPool,
      collectionAndFavoriteVodPool,
      customBouquets,
      demoSourceDeleted,
      designMode,
      dualSlotIds,
      epgOffsetHours,
      favoriteIds,
      favoriteSeriesIds,
      favoriteVodIds,
      multiviewSlotIds,
      parentalConfig,
      persistedSources,
      preferences,
      reminders,
      watchHistory,
    ]
  );

  const buildFullCloudSyncPayloadRef = useRef(buildFullCloudSyncPayload);
  useEffect(() => {
    buildFullCloudSyncPayloadRef.current = buildFullCloudSyncPayload;
  }, [buildFullCloudSyncPayload]);

  const synchronizeWithCloudVault = useCallback(
    async (params: {
      uid: string;
      trigger: 'sign-in' | 'unlock' | 'pull' | 'push' | 'auto-push' | 'snapshot';
      incomingRemote?: {
        envelope: EncryptedSyncEnvelope;
        payload: LumaSyncPlainPayload;
      };
    }): Promise<string> => {
      const runSync = async (): Promise<string> => {
        const dbSources = await lumaDb.sources
          .orderBy('createdAt')
          .reverse()
          .toArray();
        const deviceState = loadDeviceCloudSyncState(params.uid);
        const rawLocal = buildFullCloudSyncPayloadRef.current(dbSources);
        const remote = params.incomingRemote ?? (await pullAccountCloudVault());

        // If playlist syncing is toggled off locally, preserve existing cloud playlists
        // rather than treating local `undefined` as deleting remote playlists.
        const effectiveLocal: LumaSyncPlainPayload = !cloudSyncPlaylistsEnabled
          ? {
              ...rawLocal,
              playlists:
                remote?.payload.playlists ?? deviceState?.basePayload?.playlists ?? [],
            }
          : rawLocal;

        let hasExplicitLocalPrefs = false;
        try {
          hasExplicitLocalPrefs = Boolean(localStorage.getItem('luma.prefs.v3'));
        } catch {
          hasExplicitLocalPrefs = false;
        }

        const reconciled = reconcileCloudSyncPayloads({
          uid: params.uid,
          local: effectiveLocal,
          remote: remote?.payload ?? null,
          deviceSyncState: deviceState,
          remoteUpdatedAtMs: remote?.envelope.updatedAt,
          isLocalAppleDevice: platformEnv.isApple,
          hasExplicitLocalPrefs,
        });

        if (reconciled.shouldApplyLocally) {
          handleRestoreFromSync(reconciled.mergedPayload, {
            deletedPlaylistIds: reconciled.deletedPlaylistIds,
          });
        }

        let syncedAtMs =
          remote?.envelope.updatedAt ??
          reconciled.nextDeviceSyncState.lastRemoteUpdatedAt;
        let syncedDeviceLabel = remote?.envelope.deviceLabel ?? null;

        if (reconciled.shouldPushToCloud && params.trigger !== 'pull') {
          const pushedEnv = await pushAccountCloudVault({
            payload: reconciled.mergedPayload,
            deviceLabel: platformEnv.label,
          });
          syncedAtMs = pushedEnv.updatedAt;
          syncedDeviceLabel = platformEnv.label;
        }

        const finalDeviceState = {
          ...reconciled.nextDeviceSyncState,
          lastRemoteUpdatedAt: Math.max(
            reconciled.nextDeviceSyncState.lastRemoteUpdatedAt,
            syncedAtMs
          ),
        };
        saveDeviceCloudSyncState(params.uid, finalDeviceState);

        lastRemoteVaultUpdatedAtRef.current = Math.max(
          lastRemoteVaultUpdatedAtRef.current,
          syncedAtMs
        );
        lastSyncedContentDigestRef.current = finalDeviceState.lastSyncedDigest;
        setCloudLastSyncedAtMs(syncedAtMs);
        if (syncedDeviceLabel) {
          setCloudLastDeviceLabel(syncedDeviceLabel);
        }
        setCloudErrorMessage(null);
        return reconciled.summary;
      };

      const prevFlight = cloudSyncInFlightRef.current;
      const currentPromise = (prevFlight
        ? prevFlight.catch(() => undefined)
        : Promise.resolve()
      ).then(runSync);

      const tracked = currentPromise.then(
        () => undefined,
        () => undefined
      );
      cloudSyncInFlightRef.current = tracked;
      try {
        return await currentPromise;
      } finally {
        if (cloudSyncInFlightRef.current === tracked) {
          cloudSyncInFlightRef.current = null;
        }
      }
    },
    [
      cloudSyncPlaylistsEnabled,
      handleRestoreFromSync,
      platformEnv.isApple,
      platformEnv.label,
    ]
  );

  // Observe Firebase Auth user session across app restarts
  useEffect(() => {
    try {
      return subscribeLumaAuthState((session) => {
        setCloudSession(session);
        if (session?.uid) {
          const saved = loadDeviceCloudSyncState(session.uid);
          if (saved) {
            lastSyncedContentDigestRef.current = saved.lastSyncedDigest;
            lastRemoteVaultUpdatedAtRef.current = saved.lastRemoteUpdatedAt;
            if (saved.lastRemoteUpdatedAt > 0) {
              setCloudLastSyncedAtMs(saved.lastRemoteUpdatedAt);
            }
          }
        }
      });
    } catch {
      return undefined;
    }
  }, []);

  // Real-time Firestore onSnapshot listener when signed in & unlocked
  useEffect(() => {
    if (
      !sourcesDbLoaded ||
      !cloudSession?.uid ||
      !cloudSession.hasVaultKey ||
      !cloudAutoSyncEnabled
    ) {
      return;
    }
    const uid = cloudSession.uid;
    try {
      return subscribeAccountCloudVault({
        uid,
        onRemoteVault: ({ envelope, payload }) => {
          const savedState = loadDeviceCloudSyncState(uid);
          const alreadyProcessed =
            Boolean(savedState?.hasCompletedInitialSync) &&
            envelope.updatedAt <= lastRemoteVaultUpdatedAtRef.current;
          if (alreadyProcessed) return;

          void synchronizeWithCloudVault({
            uid,
            trigger: 'snapshot',
            incomingRemote: { envelope, payload },
          }).catch((err) => {
            setCloudErrorMessage(
              err instanceof Error ? err.message : 'Incremental sync failed.'
            );
          });
        },
        onError: (msg) => {
          setCloudErrorMessage(msg);
        },
      });
    } catch {
      return undefined;
    }
  }, [
    cloudAutoSyncEnabled,
    cloudSession?.hasVaultKey,
    cloudSession?.uid,
    sourcesDbLoaded,
    synchronizeWithCloudVault,
  ]);

  // Debounced incremental auto-sync whenever syncable user data changes while signed in
  useEffect(() => {
    if (!didMountCloudWatcherRef.current) {
      didMountCloudWatcherRef.current = true;
      return;
    }
    if (
      !sourcesDbLoaded ||
      !cloudSession?.uid ||
      !cloudSession.hasVaultKey ||
      !cloudAutoSyncEnabled
    ) {
      return;
    }
    if (Date.now() < suppressCloudAutoPushUntilRef.current) {
      return;
    }

    const uid = cloudSession.uid;
    const timer = window.setTimeout(() => {
      if (Date.now() < suppressCloudAutoPushUntilRef.current) return;
      const savedState = loadDeviceCloudSyncState(uid);
      const candidate = {
        ...buildFullCloudSyncPayloadRef.current(),
        syncMeta: savedState?.localMeta,
      };
      const currentDigest = computeSyncContentDigest(candidate);
      if (
        savedState?.hasCompletedInitialSync &&
        currentDigest === lastSyncedContentDigestRef.current
      ) {
        return; // Zero-op: skip network call when canonical sync state is unchanged
      }

      void synchronizeWithCloudVault({
        uid,
        trigger: 'auto-push',
      }).catch(() => {
        // Transient offline state; Firestore retries or manual Sync Now handles it
      });
    }, 1500);

    return () => window.clearTimeout(timer);
  }, [
    activeSourceId,
    cloudAutoSyncEnabled,
    cloudSession?.hasVaultKey,
    cloudSession?.uid,
    cloudSyncPlaylistsEnabled,
    customBouquets,
    demoSourceDeleted,
    designMode,
    dualSlotIds,
    epgOffsetHours,
    favoriteIds,
    favoriteSeriesIds,
    favoriteVodIds,
    multiviewSlotIds,
    parentalConfig,
    persistedSources,
    preferences,
    reminders,
    sourcesDbLoaded,
    synchronizeWithCloudVault,
    watchHistory,
  ]);

  const cloudActions: CloudSyncActions = useMemo(
    () => ({
      onSignIn: async (email, password) => {
        setCloudBusy(true);
        setCloudErrorMessage(null);
        setCloudStatusMessage(null);
        try {
          const session = await signInLumaCloudAccount(email, password);
          setCloudSession(session);
          const summary = await synchronizeWithCloudVault({
            uid: session.uid,
            trigger: 'sign-in',
          });
          setCloudStatusMessage(summary);
        } catch (err) {
          setCloudErrorMessage(
            err instanceof Error ? err.message : 'Sign-in failed.'
          );
        } finally {
          setCloudBusy(false);
        }
      },
      onSignUp: async (email, password) => {
        setCloudBusy(true);
        setCloudErrorMessage(null);
        setCloudStatusMessage(null);
        try {
          const session = await signUpLumaCloudAccount(email, password);
          setCloudSession(session);
          const summary = await synchronizeWithCloudVault({
            uid: session.uid,
            trigger: 'sign-in',
          });
          setCloudStatusMessage(summary);
        } catch (err) {
          setCloudErrorMessage(
            err instanceof Error ? err.message : 'Account creation failed.'
          );
        } finally {
          setCloudBusy(false);
        }
      },
      onUnlockVault: async (password) => {
        setCloudBusy(true);
        setCloudErrorMessage(null);
        try {
          const session = await unlockExistingCloudSessionWithPassword(password);
          setCloudSession(session);
          const summary = await synchronizeWithCloudVault({
            uid: session.uid,
            trigger: 'unlock',
          });
          setCloudStatusMessage(summary);
        } catch (err) {
          setCloudErrorMessage(
            err instanceof Error ? err.message : 'Failed to unlock cloud vault.'
          );
        } finally {
          setCloudBusy(false);
        }
      },
      onSendPasswordReset: async (email) => {
        setCloudBusy(true);
        setCloudErrorMessage(null);
        try {
          await sendLumaPasswordReset(email);
          setCloudStatusMessage(`Password reset link sent to ${email.trim()}.`);
        } catch (err) {
          setCloudErrorMessage(
            err instanceof Error ? err.message : 'Failed to send reset link.'
          );
        } finally {
          setCloudBusy(false);
        }
      },
      onSignOut: async () => {
        setCloudBusy(true);
        setCloudErrorMessage(null);
        try {
          await signOutLumaCloudAccount();
          setCloudSession(null);
          setCloudStatusMessage('Signed out of Firebase Cloud Sync.');
        } catch (err) {
          setCloudErrorMessage(
            err instanceof Error ? err.message : 'Sign-out failed.'
          );
        } finally {
          setCloudBusy(false);
        }
      },
      onPushNow: async () => {
        if (!cloudSession?.uid) return;
        setCloudBusy(true);
        setCloudErrorMessage(null);
        try {
          const summary = await synchronizeWithCloudVault({
            uid: cloudSession.uid,
            trigger: 'push',
          });
          setCloudStatusMessage(summary);
        } catch (err) {
          setCloudErrorMessage(
            err instanceof Error ? err.message : 'Cloud sync failed.'
          );
        } finally {
          setCloudBusy(false);
        }
      },
      onPullNow: async () => {
        if (!cloudSession?.uid) return;
        setCloudBusy(true);
        setCloudErrorMessage(null);
        try {
          const summary = await synchronizeWithCloudVault({
            uid: cloudSession.uid,
            trigger: 'pull',
          });
          setCloudStatusMessage(summary);
        } catch (err) {
          setCloudErrorMessage(
            err instanceof Error ? err.message : 'Cloud sync pull failed.'
          );
        } finally {
          setCloudBusy(false);
        }
      },
      onToggleAutoSync: (enabled) => {
        setCloudAutoSyncEnabled(enabled);
        try {
          localStorage.setItem('luma.cloud.autoSync.v1', enabled ? '1' : '0');
        } catch {
          // Ignore
        }
      },
      onToggleSyncPlaylists: (enabled) => {
        setCloudSyncPlaylistsEnabled(enabled);
        try {
          localStorage.setItem('luma.cloud.syncPlaylists.v1', enabled ? '1' : '0');
        } catch {
          // Ignore
        }
      },
    }),
    [cloudSession?.uid, synchronizeWithCloudVault]
  );

  const cloudState: CloudSyncUiState = useMemo(
    () => ({
      session: cloudSession,
      autoSyncEnabled: cloudAutoSyncEnabled,
      syncPlaylistsEnabled: cloudSyncPlaylistsEnabled,
      isBusy: cloudBusy,
      isHydratingPlaylists: cloudHydratingPlaylists,
      lastSyncedAtMs: cloudLastSyncedAtMs,
      lastSyncedDeviceLabel: cloudLastDeviceLabel,
      statusMessage: cloudStatusMessage,
      errorMessage: cloudErrorMessage,
      summaryCounts: {
        playlists: persistedSources.length,
        favorites:
          favoriteIds.size + favoriteVodIds.size + favoriteSeriesIds.size,
        collections: customBouquets.length,
        history: watchHistory.length,
      },
    }),
    [
      cloudAutoSyncEnabled,
      cloudBusy,
      cloudErrorMessage,
      cloudHydratingPlaylists,
      cloudLastDeviceLabel,
      cloudLastSyncedAtMs,
      cloudSession,
      cloudStatusMessage,
      cloudSyncPlaylistsEnabled,
      customBouquets.length,
      favoriteIds.size,
      favoriteSeriesIds.size,
      favoriteVodIds.size,
      persistedSources.length,
      watchHistory.length,
    ]
  );

  const sectionOrder: NavigationSection[] = useMemo(
    () => [
      'live',
      'live-epg',
      'favorites',
      'collections',
      'vod',
      'series',
      'catchup',
      'dualview',
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

  const [stageFullscreen, setStageFullscreen] = useState(false);

  const handleChangeStageFullscreen = useCallback((next: boolean) => {
    setStageFullscreen(next);
  }, []);

  const toggleAppFullscreen = useCallback(async () => {
    const currentlyFullscreen =
      stageFullscreen || Boolean(getNativeDomFullscreenElement());
    if (currentlyFullscreen) {
      setStageFullscreen(false);
      await exitLumaFullscreen();
      return;
    }
    setStageFullscreen(true);
    const stageEl = document.getElementById('luma-player-stage');
    await enterLumaFullscreen(stageEl ?? document.documentElement);
  }, [stageFullscreen]);

  // Keep stageFullscreen synchronized with DOM fullscreenchange & Android/Googlebook Back exits
  useEffect(() => {
    const onDomFsChange = () => {
      const domEl = getNativeDomFullscreenElement();
      if (domEl) {
        setStageFullscreen(true);
      } else {
        // When exiting native browser fullscreen via Esc, also exit stageFullscreen
        setStageFullscreen(false);
      }
    };

    const onAndroidFsChange = (e: Event) => {
      const custom = e as CustomEvent<{ fullscreen?: boolean }>;
      if (typeof custom.detail?.fullscreen === 'boolean') {
        setStageFullscreen(custom.detail.fullscreen);
      }
    };

    document.addEventListener('fullscreenchange', onDomFsChange);
    document.addEventListener('webkitfullscreenchange', onDomFsChange);
    window.addEventListener('luma-native-fullscreen-change', onAndroidFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onDomFsChange);
      document.removeEventListener('webkitfullscreenchange', onDomFsChange);
      window.removeEventListener('luma-native-fullscreen-change', onAndroidFsChange);
    };
  }, []);

  // Automatically restore window chrome if the user navigates away from video sections while in Fullscreen
  useEffect(() => {
    const isVideoView =
      activeSection === 'live' ||
      activeSection === 'live-epg' ||
      activeSection === 'dualview' ||
      activeSection === 'multiview';
    if (!isVideoView && stageFullscreen) {
      setStageFullscreen(false);
      void exitLumaFullscreen();
    }
  }, [activeSection, stageFullscreen]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandBarOpen((v) => !v);
        return;
      }

      const targetTag = (e.target as HTMLElement | null)?.tagName;
      if (targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT') return;

      if (e.key === 'Escape' && (stageFullscreen || getNativeDomFullscreenElement())) {
        e.preventDefault();
        setStageFullscreen(false);
        void exitLumaFullscreen();
        return;
      }

      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }

      if (commandBarOpen || pendingPinGroup || shortcutsOpen || inspectMedia) return;

      const isVideoSection =
        activeSection === 'live' ||
        activeSection === 'live-epg' ||
        activeSection === 'dualview' ||
        activeSection === 'multiview';
      if (
        isVideoSection &&
        e.key.toLowerCase() === 'f' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault();
        void toggleAppFullscreen();
        return;
      }

      if (
        (activeSection === 'live' ||
          activeSection === 'live-epg' ||
          activeSection === 'dualview') &&
        e.key.toLowerCase() === 'd' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault();
        if (activeSection === 'dualview') {
          setActiveSection('live');
        } else {
          openDualView();
        }
        return;
      }

      if (activeSection === 'dualview') {
        if (e.key === '1' || e.key === '2') {
          e.preventDefault();
          setDualAudioSlot(e.key === '1' ? 0 : 1);
          setDualMuted(false);
          return;
        }
        if (
          e.key.toLowerCase() === 's' &&
          !e.metaKey &&
          !e.ctrlKey &&
          !e.altKey
        ) {
          e.preventDefault();
          updateDualSlotIds(([a, b]) => [b, a]);
          setDualAudioSlot((prev) => (prev === 0 ? 1 : 0));
          return;
        }
      }

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
    stageFullscreen,
    toggleAppFullscreen,
    openDualView,
    updateDualSlotIds,
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
      onDemandMeta={
        activeOnDemand
          ? {
              badgeTop: activeOnDemand.badgeTop,
              badgeCode: activeOnDemand.badgeCode,
              techBadge: activeOnDemand.techBadge,
              favoriteTargetId: activeOnDemand.favoriteTargetId,
              backLabel:
                activeOnDemand.returnSection === 'series' ? t.navSeries : t.navVod,
            }
          : null
      }
      onBackToCatalog={
        activeOnDemand
          ? () => {
              if (activeOnDemand.returnSection === 'series') {
                setFocusedSeriesId(activeOnDemand.favoriteTargetId);
              }
              setActiveSection(activeOnDemand.returnSection);
            }
          : undefined
      }
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
      isFavorite={
        activeOnDemand
          ? activeOnDemand.mediaKind === 'movie'
            ? favoriteVodIds.has(activeOnDemand.favoriteTargetId)
            : favoriteSeriesIds.has(activeOnDemand.favoriteTargetId)
          : favoriteIds.has(activeChannel.id)
      }
      onToggleFavorite={(targetId) => {
        if (activeOnDemand) {
          if (activeOnDemand.mediaKind === 'movie') {
            toggleFavoriteVod(targetId);
          } else {
            toggleFavoriteSeries(targetId);
          }
        } else {
          toggleFavorite(targetId);
        }
      }}
      onPrevChannel={() => zapRelative(-1)}
      onNextChannel={() => zapRelative(1)}
      onDetachInAppPip={() => setDetachedPipInEpg(true)}
      onOpenDualView={openDualView}
      ambilightEnabled={ambilightEnabled}
      theaterExpanded={theaterExpanded}
      onToggleTheaterExpanded={() => setTheaterExpanded((v) => !v)}
      isStageFullscreen={stageFullscreen}
      onChangeStageFullscreen={handleChangeStageFullscreen}
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
      className={`relative flex h-dvh w-screen flex-col overflow-hidden text-slate-100 transition-colors duration-300 ${
        stageFullscreen
          ? 'bg-black'
          : isM3
            ? 'bg-[#131722]'
            : 'bg-[#05070C]'
      }`}
    >
      {!stageFullscreen && !isM3 && ambilightEnabled && (
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

      {!stageFullscreen && (
        <CustomTitlebar
          designMode={designMode}
          locale={preferences.locale}
          onSelectLocale={(nextLocale) =>
            handleUpdatePreferences({
              ...preferences,
              locale: nextLocale,
            })
          }
          sleepRemainingSec={sleepRemainingSec}
          sidebarCollapsed={
            activeSection === 'dualview' ? !dualSidebarOpen : sidebarCollapsed
          }
          onToggleSidebar={() => {
            if (activeSection === 'dualview') {
              setDualSidebarOpen((v) => !v);
            } else {
              setSidebarCollapsed((v) => !v);
            }
          }}
          onOpenCommandBar={() => setCommandBarOpen(true)}
          activeSection={activeSection}
          onSelectSection={(sec) => {
            if (sec === 'dualview') {
              openDualView();
              return;
            }
            setActiveSection(sec);
            setPipDismissedWhileBrowsing(false);
          }}
          playlists={quickPlaylistOptions}
          activeSourceId={activeSourceId}
          onSelectSourceId={handleSelectSourceId}
          nowMs={nowMs}
        />
      )}

      {!stageFullscreen &&
        updateCheck?.updateAvailable &&
        dismissedUpdateVersion !== updateCheck.latestVersion && (
          <AppUpdateBanner
            designMode={designMode}
            updateInfo={updateCheck}
            installProgress={updateProgress}
            isInstalling={isInstallingUpdate}
            onInstallNow={() => void handleInstallAppUpdate()}
            onDismiss={() => setDismissedUpdateVersion(updateCheck.latestVersion)}
          />
        )}

      <div className="relative z-10 flex min-h-0 flex-1 overflow-hidden">
        {!stageFullscreen &&
          (activeSection !== 'dualview' || dualSidebarOpen) && (
            <Sidebar
              designMode={designMode}
              locale={preferences.locale}
              collapsed={activeSection === 'dualview' ? false : sidebarCollapsed}
              activeSection={activeSection}
              onSelectSection={(sec) => {
                if (sec === 'dualview') {
                  openDualView();
                  return;
                }
                setActiveSection(sec);
                setPipDismissedWhileBrowsing(false);
              }}
              selectedGroupId={selectedGroupId}
              onSelectGroup={handleSelectSidebarGroup}
              groups={groups}
              totalChannelCount={channels.length}
              favoritesCount={
                favoriteIds.size + favoriteVodIds.size + favoriteSeriesIds.size
              }
              collectionsCount={customBouquets.length}
            />
          )}

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
              activeChannelId={activeOnDemand ? '' : activeChannel.id}
              isOnDemandActive={Boolean(activeOnDemand)}
              favoriteIds={favoriteIds}
              onSelectChannel={selectLiveChannel}
              onToggleFavorite={toggleFavorite}
              onOpenChannelMenu={setChannelMenuTarget}
              onOpenEpgView={() => setActiveSection('live-epg')}
              isStageFullscreen={stageFullscreen}
              revealDrawerSignal={liveDrawerRevealSignal}
            >
              {!detachedPipInEpg && renderMainPlayerStage('cinema')}
            </LiveTvView>
          )}

          {activeSection === 'live-epg' && (
            <>
              {!detachedPipInEpg && renderMainPlayerStage('split')}

              {!stageFullscreen && (
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
              )}
            </>
          )}

          {activeSection === 'favorites' && (
            <FavoritesView
              designMode={designMode}
              locale={preferences.locale}
              channels={collectionAndFavoritePool}
              vodCatalog={collectionAndFavoriteVodPool}
              seriesCatalog={collectionAndFavoriteSeriesPool}
              favoriteIds={favoriteIds}
              favoriteVodIds={favoriteVodIds}
              favoriteSeriesIds={favoriteSeriesIds}
              activeChannelId={activeChannel.id}
              nowMs={nowMs}
              epgOffsetHours={epgOffsetHours}
              onSelectChannel={selectLiveChannel}
              onPlayVod={(vod) => handlePlayVod(vod, 0)}
              onOpenSeries={(serId) => {
                setFocusedSeriesId(serId);
                setActiveSection('series');
              }}
              onToggleFavorite={toggleFavorite}
              onToggleFavoriteVod={toggleFavoriteVod}
              onToggleFavoriteSeries={toggleFavoriteSeries}
              onOpenChannelMenu={setChannelMenuTarget}
            />
          )}

          {(activeSection === 'collections' || activeSection === 'studio') && (
            <CollectionsView
              designMode={designMode}
              locale={preferences.locale}
              channels={collectionAndFavoritePool}
              vodCatalog={collectionAndFavoriteVodPool}
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
              onPlayVod={(vod) => handlePlayVod(vod, 0)}
              onOpenSeries={(serId) => {
                setFocusedSeriesId(serId);
                setActiveSection('series');
              }}
              onRequestUnlockCollection={(id, name) => setPendingPinGroup({ id, name })}
              onOpenChannelMenu={setChannelMenuTarget}
            />
          )}

          {activeSection === 'dualview' && (
            <DualViewStage
              designMode={designMode}
              locale={preferences.locale}
              channels={channels}
              favoriteAndCollectionPool={collectionAndFavoritePool}
              favoriteIds={favoriteIds}
              collections={customBouquets}
              slotChannelIds={dualSlotIds}
              activeAudioSlot={dualAudioSlot}
              globalMuted={dualMuted}
              isStageFullscreen={stageFullscreen}
              onChangeStageFullscreen={handleChangeStageFullscreen}
              onSelectAudioSlot={setDualAudioSlot}
              onChangeGlobalMuted={setDualMuted}
              onChangeSlotChannel={(slot, nextId) => {
                updateDualSlotIds((prev) =>
                  slot === 0 ? [nextId, prev[1]] : [prev[0], nextId]
                );
              }}
              onSwapSlots={() => {
                updateDualSlotIds(([a, b]) => [b, a]);
                setDualAudioSlot((prev) => (prev === 0 ? 1 : 0));
              }}
              onExpandSingleChannel={(ch) => selectLiveChannel(ch)}
              proxyConfig={effectiveProxyConfig}
              nowMs={nowMs}
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
              favoriteVodIds={favoriteVodIds}
              collections={customBouquets}
              onToggleFavoriteVod={toggleFavoriteVod}
              onOpenItemMenu={setChannelMenuTarget}
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
              onChangeEpgOffset={handleChangeEpgOffset}
              proxyConfig={proxyConfig}
              onChangeProxyConfig={setProxyConfig}
              favoriteIds={favoriteIds}
              watchHistory={watchHistory}
              onRestoreFromSync={handleRestoreFromSync}
              cloudState={cloudState}
              cloudActions={cloudActions}
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
              channels={collectionAndFavoritePool}
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
              updateCheck={updateCheck}
              isCheckingUpdate={isCheckingUpdate}
              isInstallingUpdate={isInstallingUpdate}
              updateProgress={updateProgress}
              updateError={updateError}
              onCheckForUpdates={() => void handleCheckForUpdates(false)}
              onInstallUpdate={() => void handleInstallAppUpdate()}
              cloudState={cloudState}
              cloudActions={cloudActions}
            />
          )}
        </main>
      </div>

      {!stageFullscreen && showFloatingInAppPip && (
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
              : channelMenuTarget.vod
                ? favoriteVodIds.has(channelMenuTarget.vod.id)
                : channelMenuTarget.series
                  ? favoriteSeriesIds.has(channelMenuTarget.series.id)
                  : false
          }
          isStartupChannel={
            Boolean(
              channelMenuTarget.channel &&
                preferences.startupChannelId === channelMenuTarget.channel.id
            )
          }
          collections={customBouquets}
          onClose={() => setChannelMenuTarget(null)}
          onPlayChannel={(ch) => selectLiveChannel(ch)}
          onToggleStartupChannel={(ch) => {
            const clearing = preferences.startupChannelId === ch.id;
            handleUpdatePreferences({
              ...preferences,
              startupChannelId: clearing ? null : ch.id,
              startupChannelName: clearing ? null : ch.name,
            });
            setToastMessage(
              clearing
                ? 'Startup channel reset to First Favorite'
                : `Startup channel set to "${ch.name}"`
            );
            window.setTimeout(() => setToastMessage(null), 2800);
          }}
          onOpenDualChannel={(ch) => {
            const primaryId =
              activeChannel.id === ch.id
                ? (channels.find((c) => c.id !== ch.id)?.id ?? activeChannel.id)
                : activeChannel.id;
            updateDualSlotIds(() => [primaryId, ch.id]);
            setDualAudioSlot(0);
            setDualMuted(false);
            setDualSidebarOpen(false);
            setActiveSection('dualview');
          }}
          onPlayVod={(vod) => handlePlayVod(vod, 0)}
          onOpenSeries={(ser) => {
            setFocusedSeriesId(ser.id);
            setActiveSection('series');
          }}
          onToggleFavorite={() => {
            if (channelMenuTarget.channel) {
              toggleFavorite(channelMenuTarget.channel.id);
            } else if (channelMenuTarget.vod) {
              toggleFavoriteVod(channelMenuTarget.vod.id);
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
            setLiveDrawerRevealSignal((n) => n + 1);
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
            const isSeries = Boolean(inspectMedia.series && !inspectMedia.vod);
            setActiveOnDemand({
              itemId: `trailer-${targetId}`,
              kind: 'vod',
              mediaKind: isSeries ? 'series' : 'movie',
              favoriteTargetId: targetId,
              returnSection: isSeries ? 'series' : 'vod',
              badgeTop: 'TRAILER',
              badgeCode: '4K',
              techBadge: '4K HDR · Studio Preview',
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
            if (act === 'dualview') {
              if (activeSection === 'dualview') {
                setActiveSection('live');
              } else {
                openDualView();
              }
            } else if (act === 'multiview') {
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
