import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Database,
  Download,
  Film,
  FolderHeart,
  FolderPlus,
  Globe,
  Layers,
  Lock,
  MoreVertical,
  Pencil,
  Play,
  Plus,
  Search,
  Star,
  Trash2,
} from 'lucide-react';
import { lumaDb, type StoredPlaylistSource } from '../../db/lumaDb';
import { getCurrentAndNextProgram } from '../../data/mockCatalog';
import {
  LOCALE_META,
  TRANSLATIONS,
  type LumaLocale,
} from '../../i18n/translations';
import {
  isProviderDividerChannel,
  matchesNormalizedQuery,
  searchChannelsRanked,
  searchSeriesRanked,
  searchVodRanked,
  tokenizeSearchQuery,
} from '../../services/channelSearch';
import {
  buildCountryBuckets,
  filterCountryBuckets,
} from '../../services/countryGroupMatcher';
import { exportChannelsToM3uPlus } from '../../workers/parsers';
import type {
  Channel,
  CustomBouquet,
  PlatformDesignMode,
  SeriesItem,
  VodItem,
} from '../../types/luma';
import type { ChannelContextMenuTarget } from '../common/ChannelContextMenu';

interface FavoritesViewProps {
  designMode: PlatformDesignMode;
  locale: LumaLocale;
  channels: Channel[];
  vodCatalog?: VodItem[];
  seriesCatalog: SeriesItem[];
  favoriteIds: Set<string>;
  favoriteVodIds?: Set<string>;
  favoriteSeriesIds: Set<string>;
  activeChannelId: string;
  nowMs: number;
  epgOffsetHours: number;
  onSelectChannel: (channel: Channel) => void;
  onPlayVod?: (vod: VodItem) => void;
  onOpenSeries: (seriesId: string) => void;
  onToggleFavorite: (channelId: string) => void;
  onToggleFavoriteVod?: (vodId: string) => void;
  onToggleFavoriteSeries: (seriesId: string) => void;
  onOpenChannelMenu: (target: ChannelContextMenuTarget) => void;
}

export const FavoritesView: React.FC<FavoritesViewProps> = ({
  designMode,
  locale,
  channels,
  vodCatalog = [],
  seriesCatalog,
  favoriteIds,
  favoriteVodIds = new Set(),
  favoriteSeriesIds,
  activeChannelId,
  nowMs,
  epgOffsetHours,
  onSelectChannel,
  onPlayVod,
  onOpenSeries,
  onToggleFavorite,
  onToggleFavoriteVod,
  onToggleFavoriteSeries,
  onOpenChannelMenu,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const t = TRANSLATIONS[locale];
  const bcp47 = LOCALE_META[locale].bcp47;
  const [query, setQuery] = useState('');

  const favoriteChannels = useMemo(
    () => channels.filter((c) => favoriteIds.has(c.id)),
    [channels, favoriteIds]
  );

  const favoriteVod = useMemo(
    () => vodCatalog.filter((v) => favoriteVodIds.has(v.id)),
    [vodCatalog, favoriteVodIds]
  );

  const favoriteSeries = useMemo(
    () => seriesCatalog.filter((s) => favoriteSeriesIds.has(s.id)),
    [seriesCatalog, favoriteSeriesIds]
  );

  const filteredChannels = useMemo(() => {
    if (!query.trim()) return favoriteChannels;
    return searchChannelsRanked(favoriteChannels, query, favoriteChannels.length).items;
  }, [favoriteChannels, query]);

  const filteredVod = useMemo(() => {
    if (!query.trim()) return favoriteVod;
    return searchVodRanked(favoriteVod, query, favoriteVod.length).items;
  }, [favoriteVod, query]);

  const filteredSeries = useMemo(() => {
    if (!query.trim()) return favoriteSeries;
    return searchSeriesRanked(favoriteSeries, query, favoriteSeries.length).items;
  }, [favoriteSeries, query]);

  const totalFavorites =
    favoriteChannels.length + favoriteVod.length + favoriteSeries.length;

  return (
    <div className="luma-scroll flex-1 overflow-y-auto p-5 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-full ${
              isM3 ? 'bg-[#283249] text-amber-300' : 'lg-capsule text-amber-300'
            }`}
          >
            <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">
              {t.favorites} ({totalFavorites.toLocaleString(bcp47)})
            </h2>
            <p className="text-xs text-slate-400">{t.favoritesEmptyHint}</p>
          </div>
        </div>

        {totalFavorites > 0 && (
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.searchPlaceholder}
              className={
                isM3
                  ? 'h-8.5 w-full rounded-full bg-[#232B3D] pl-9 pr-4 text-xs text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#7FD4FF]/60'
                  : 'lg-capsule h-8.5 w-full rounded-full pl-9 pr-4 text-xs text-white placeholder:text-white/45 focus:outline-none'
              }
            />
          </div>
        )}
      </div>

      {totalFavorites === 0 ? (
        <div
          className={`flex flex-col items-center justify-center py-16 text-center ${
            isM3 ? 'rounded-[28px] bg-[#1A202E]' : 'lg-pane rounded-[24px]'
          }`}
        >
          <Star className="h-8 w-8 text-amber-300/60" />
          <p className="mt-3 max-w-md text-xs text-slate-300">{t.favoritesEmptyHint}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Favorite Channels */}
          {filteredChannels.length > 0 && (
            <section className="space-y-2.5">
              <div className="text-xs font-semibold text-slate-300">
                {t.channelsUnit} ({filteredChannels.length})
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredChannels.map((ch) => {
                  const isActive = ch.id === activeChannelId;
                  const { current, progressPct } = getCurrentAndNextProgram(
                    ch,
                    nowMs,
                    epgOffsetHours
                  );
                  return (
                    <div
                      key={ch.id}
                      onClick={() => onSelectChannel(ch)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        onOpenChannelMenu({ channel: ch, x: e.clientX, y: e.clientY });
                      }}
                      className={`group flex cursor-pointer flex-col justify-between p-4 transition ${
                        isM3 ? 'rounded-[24px]' : 'rounded-[20px]'
                      } ${
                        isActive
                          ? isM3
                            ? 'm3-tonal-active ring-1 ring-[#7FD4FF]/60'
                            : 'lg-pill-active'
                          : isM3
                            ? 'bg-[#1A202E] hover:bg-[#232B3D]'
                            : 'lg-pane hover:bg-white/[0.08]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-[11px] text-sky-300 luma-tabular">
                            <span className="font-mono opacity-80">#{ch.number}</span>
                            <span>·</span>
                            <span className="truncate opacity-80">{ch.groupName}</span>
                          </div>
                          <div className="mt-0.5 truncate text-sm font-semibold text-white">
                            {ch.name}
                          </div>
                        </div>

                        <div
                          className="flex shrink-0 items-center gap-0.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => onToggleFavorite(ch.id)}
                            className="rounded-full p-1.5 text-amber-400 hover:bg-white/10"
                            title={t.removeFromFavorites}
                          >
                            <Star className="h-3.5 w-3.5 fill-amber-400" />
                          </button>
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
                        </div>
                      </div>

                      <div className="mt-3">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="truncate text-slate-200">{current.title}</span>
                          <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-sky-200">
                            {ch.resolution}
                          </span>
                        </div>
                        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10">
                          <div
                            className={
                              isM3 ? 'h-full bg-[#7FD4FF]' : 'luma-accent-gradient h-full'
                            }
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Favorite Movies (VOD) */}
          {filteredVod.length > 0 && (
            <section className="space-y-2.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                <Film className="h-3.5 w-3.5 text-sky-300" />
                <span>
                  {t.navVod} ({filteredVod.length})
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredVod.map((vod) => (
                  <div
                    key={vod.id}
                    onClick={() => onPlayVod?.(vod)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onOpenChannelMenu({ vod, x: e.clientX, y: e.clientY });
                    }}
                    className={`group flex cursor-pointer flex-col justify-between p-4 transition ${
                      isM3
                        ? 'rounded-[24px] bg-[#1A202E] hover:bg-[#232B3D]'
                        : 'lg-pane rounded-[20px] hover:bg-white/[0.08]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[11px] text-sky-300">
                          {vod.genre}
                        </div>
                        <div className="mt-0.5 line-clamp-2 text-sm font-semibold text-white">
                          {vod.title}
                        </div>
                      </div>
                      <div
                        className="flex shrink-0 items-center gap-0.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {onToggleFavoriteVod && (
                          <button
                            type="button"
                            onClick={() => onToggleFavoriteVod(vod.id)}
                            className="rounded-full p-1.5 text-amber-400 hover:bg-white/10"
                            title={t.removeFromFavorites}
                          >
                            <Star className="h-3.5 w-3.5 fill-amber-400" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            onOpenChannelMenu({
                              vod,
                              x: rect.left,
                              y: rect.bottom + 4,
                            });
                          }}
                          className="rounded-full p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400 luma-tabular">
                      <span>
                        {vod.year} · {vod.resolution}
                      </span>
                      <span className="text-amber-300">★ {vod.rating}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Favorite Series */}
          {filteredSeries.length > 0 && (
            <section className="space-y-2.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                <Clapperboard className="h-3.5 w-3.5 text-sky-300" />
                <span>
                  {t.navSeries} ({filteredSeries.length})
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredSeries.map((ser) => (
                  <div
                    key={ser.id}
                    onClick={() => onOpenSeries(ser.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onOpenChannelMenu({ series: ser, x: e.clientX, y: e.clientY });
                    }}
                    className={`group flex cursor-pointer flex-col justify-between p-4 transition ${
                      isM3
                        ? 'rounded-[24px] bg-[#1A202E] hover:bg-[#232B3D]'
                        : 'lg-pane rounded-[20px] hover:bg-white/[0.08]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[11px] text-sky-300">
                          {ser.genre}
                        </div>
                        <div className="mt-0.5 line-clamp-2 text-sm font-semibold text-white">
                          {ser.title}
                        </div>
                      </div>
                      <div
                        className="flex shrink-0 items-center gap-0.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => onToggleFavoriteSeries(ser.id)}
                          className="rounded-full p-1.5 text-amber-400 hover:bg-white/10"
                          title={t.removeFromFavorites}
                        >
                          <Star className="h-3.5 w-3.5 fill-amber-400" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            onOpenChannelMenu({
                              series: ser,
                              x: rect.left,
                              y: rect.bottom + 4,
                            });
                          }}
                          className="rounded-full p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400 luma-tabular">
                      <span>{ser.year}</span>
                      <span className="text-amber-300">★ {ser.rating}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
};

interface CollectionsViewProps {
  designMode: PlatformDesignMode;
  locale: LumaLocale;
  channels: Channel[];
  vodCatalog?: VodItem[];
  seriesCatalog: SeriesItem[];
  persistedSources: StoredPlaylistSource[];
  activeSourceId: string;
  demoSourceDeleted: boolean;
  demoChannels: Channel[];
  collections: CustomBouquet[];
  activeChannelId: string;
  unlockedGroupIds: Set<string>;
  parentalEnabled: boolean;
  lockedGroupIds: string[];
  nowMs: number;
  epgOffsetHours: number;
  onChangeCollections: (next: CustomBouquet[]) => void;
  onSelectChannel: (channel: Channel) => void;
  onPlayVod?: (vod: VodItem) => void;
  onOpenSeries: (seriesId: string) => void;
  onRequestUnlockCollection: (id: string, name: string) => void;
  onOpenChannelMenu: (target: ChannelContextMenuTarget) => void;
}

const PICKER_CH_PAGE_SIZE = 60;

export const CollectionsView: React.FC<CollectionsViewProps> = ({
  designMode,
  locale,
  channels,
  vodCatalog = [],
  seriesCatalog,
  persistedSources,
  activeSourceId,
  demoSourceDeleted,
  demoChannels,
  collections,
  activeChannelId,
  unlockedGroupIds,
  parentalEnabled,
  lockedGroupIds,
  nowMs,
  epgOffsetHours,
  onChangeCollections,
  onSelectChannel,
  onPlayVod,
  onOpenSeries,
  onRequestUnlockCollection,
  onOpenChannelMenu,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const t = TRANSLATIONS[locale];
  const bcp47 = LOCALE_META[locale].bcp47;
  const panelClass = isM3 ? 'rounded-[26px] bg-[#1A202E] p-4' : 'lg-pane rounded-[22px] p-4';
  const inputClass = isM3
    ? 'h-8.5 rounded-full bg-[#232B3D] px-3.5 text-xs text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#7FD4FF]/60'
    : 'lg-capsule h-8.5 rounded-full px-3.5 text-xs text-white placeholder:text-white/45 focus:outline-none';

  const [selectedId, setSelectedId] = useState<string>(() => {
    const latestUserCreated = [...collections]
      .reverse()
      .find((c) => c.id.startsWith('col-'));
    return latestUserCreated?.id ?? collections[0]?.id ?? '';
  });
  const [newName, setNewName] = useState('');
  const [newPinLocked, setNewPinLocked] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');

  // Structured Playlist -> Country -> Group -> Channels Picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSourceId, setPickerSourceId] = useState<string>(() =>
    activeSourceId !== 'none'
      ? activeSourceId
      : persistedSources[0]?.id ?? (demoSourceDeleted ? '' : 'builtin-reference')
  );
  const [loadedDbPickerChannels, setLoadedDbPickerChannels] = useState<Channel[]>([]);
  const [pickerCountryQuery, setPickerCountryQuery] = useState('');
  const [pickerCountryCode, setPickerCountryCode] = useState<string>('all');
  const [pickerGroupQuery, setPickerGroupQuery] = useState('');
  const [pickerGroupId, setPickerGroupId] = useState<string>('all');
  const [pickerChannelQuery, setPickerChannelQuery] = useState('');
  const [pickerChPage, setPickerChPage] = useState(0);

  // Load channels from IndexedDB when a stored playlist is selected in the Collection Picker
  useEffect(() => {
    if (!pickerOpen || !pickerSourceId || pickerSourceId === 'builtin-reference') {
      return;
    }
    let cancelled = false;
    lumaDb.channels
      .where('sourceId')
      .equals(pickerSourceId)
      .sortBy('sortOrder')
      .then((rows) => {
        if (!cancelled) setLoadedDbPickerChannels(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [pickerOpen, pickerSourceId]);

  const pickerSourceChannels =
    pickerSourceId === 'builtin-reference' ? demoChannels : loadedDbPickerChannels;

  const channelById = useMemo(() => {
    const map = new Map(channels.map((c) => [c.id, c]));
    for (const pc of pickerSourceChannels) {
      if (!map.has(pc.id)) map.set(pc.id, pc);
    }
    return map;
  }, [channels, pickerSourceChannels]);

  const vodById = useMemo(
    () => new Map(vodCatalog.map((v) => [v.id, v])),
    [vodCatalog]
  );

  const seriesById = useMemo(
    () => new Map(seriesCatalog.map((s) => [s.id, s])),
    [seriesCatalog]
  );

  const activeCollection =
    collections.find((c) => c.id === selectedId) ?? collections[0] ?? null;

  const isCollectionLocked = Boolean(
    activeCollection &&
      parentalEnabled &&
      (activeCollection.isPinLocked || lockedGroupIds.includes(activeCollection.id)) &&
      !unlockedGroupIds.has(activeCollection.id)
  );

  const collectionChannels = useMemo(() => {
    if (!activeCollection) return [];
    return activeCollection.channelIds
      .map((id) => channelById.get(id))
      .filter((c): c is Channel => Boolean(c));
  }, [activeCollection, channelById]);

  const collectionVod = useMemo(() => {
    if (!activeCollection?.vodIds) return [];
    return activeCollection.vodIds
      .map((id) => vodById.get(id))
      .filter((v): v is VodItem => Boolean(v));
  }, [activeCollection, vodById]);

  const collectionSeries = useMemo(() => {
    if (!activeCollection?.seriesIds) return [];
    return activeCollection.seriesIds
      .map((id) => seriesById.get(id))
      .filter((s): s is SeriesItem => Boolean(s));
  }, [activeCollection, seriesById]);

  const existingChannelIdSet = useMemo(
    () => new Set(activeCollection?.channelIds ?? []),
    [activeCollection]
  );

  // Clean (non-divider) channels for the chosen playlist in the picker
  const cleanPickerChannels = useMemo(
    () => pickerSourceChannels.filter((c) => !isProviderDividerChannel(c.name)),
    [pickerSourceChannels]
  );

  const pickerGroups = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();
    for (let i = 0; i < cleanPickerChannels.length; i++) {
      const ch = cleanPickerChannels[i];
      const ex = map.get(ch.groupId);
      if (ex) ex.count += 1;
      else map.set(ch.groupId, { id: ch.groupId, name: ch.groupName, count: 1 });
    }
    return Array.from(map.values());
  }, [cleanPickerChannels]);

  const pickerCountries = useMemo(
    () => buildCountryBuckets(pickerGroups),
    [pickerGroups]
  );

  const filteredPickerCountries = useMemo(
    () => filterCountryBuckets(pickerCountries, pickerCountryQuery),
    [pickerCountries, pickerCountryQuery]
  );

  const activeCountryBucket = useMemo(
    () =>
      pickerCountryCode === 'all'
        ? null
        : pickerCountries.find((b) => b.code === pickerCountryCode) ?? null,
    [pickerCountries, pickerCountryCode]
  );

  const visiblePickerGroups = useMemo(() => {
    let base = pickerGroups;
    if (activeCountryBucket) {
      const allowed = new Set(activeCountryBucket.groupIds);
      base = base.filter((g) => allowed.has(g.id));
    }
    const tokens = tokenizeSearchQuery(pickerGroupQuery);
    if (tokens.length === 0) return base;
    return base.filter((g) => matchesNormalizedQuery(g.name, tokens));
  }, [pickerGroups, activeCountryBucket, pickerGroupQuery]);

  const visiblePickerChannels = useMemo(() => {
    let base = cleanPickerChannels;
    if (pickerGroupId !== 'all') {
      base = base.filter((c) => c.groupId === pickerGroupId);
    } else if (activeCountryBucket) {
      const allowed = new Set(activeCountryBucket.groupIds);
      base = base.filter((c) => allowed.has(c.groupId));
    }
    if (!pickerChannelQuery.trim()) return base;
    return searchChannelsRanked(base, pickerChannelQuery, base.length).items;
  }, [cleanPickerChannels, pickerGroupId, activeCountryBucket, pickerChannelQuery]);

  const totalPickerPages = Math.max(
    1,
    Math.ceil(visiblePickerChannels.length / PICKER_CH_PAGE_SIZE)
  );
  const safePickerPage = Math.min(pickerChPage, totalPickerPages - 1);
  const pagedPickerChannels = visiblePickerChannels.slice(
    safePickerPage * PICKER_CH_PAGE_SIZE,
    (safePickerPage + 1) * PICKER_CH_PAGE_SIZE
  );

  const playlistChoices = useMemo(() => {
    const list: { id: string; name: string; count: number }[] = persistedSources.map(
      (s) => ({
        id: s.id,
        name: s.name,
        count: s.channelCount,
      })
    );
    if (!demoSourceDeleted) {
      list.push({
        id: 'builtin-reference',
        name: 'Luma Demo',
        count: demoChannels.length,
      });
    }
    return list;
  }, [persistedSources, demoSourceDeleted, demoChannels.length]);

  const handleCreateCollection = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const created: CustomBouquet = {
      id: `col-${Date.now()}`,
      name: trimmed,
      channelIds: [],
      seriesIds: [],
      isPinLocked: newPinLocked,
    };
    onChangeCollections([...collections, created]);
    setSelectedId(created.id);
    setNewName('');
    setNewPinLocked(false);

    // Open the Playlist / Country / Group Picker automatically and pre-match country if applicable!
    setPickerOpen(true);
    setPickerCountryQuery('');
    setPickerGroupId('all');
    const matchedCountries = filterCountryBuckets(pickerCountries, trimmed);
    if (matchedCountries.length === 1) {
      setPickerCountryCode(matchedCountries[0].code);
    } else {
      setPickerCountryCode('all');
    }
  };

  const updateChannelIds = (nextIds: string[]) => {
    if (!activeCollection) return;
    onChangeCollections(
      collections.map((c) =>
        c.id === activeCollection.id ? { ...c, channelIds: nextIds } : c
      )
    );
  };

  const addManyChannelsToCollection = (newChannelIds: string[]) => {
    if (!activeCollection || newChannelIds.length === 0) return;
    const merged = [...activeCollection.channelIds];
    const seen = new Set(merged);
    for (const id of newChannelIds) {
      if (!seen.has(id)) {
        seen.add(id);
        merged.push(id);
      }
    }
    updateChannelIds(merged);
  };

  const toggleSingleChannelInCollection = (channelId: string) => {
    if (!activeCollection) return;
    if (existingChannelIdSet.has(channelId)) {
      updateChannelIds(activeCollection.channelIds.filter((id) => id !== channelId));
    } else {
      updateChannelIds([...activeCollection.channelIds, channelId]);
    }
  };

  const removeVodFromCollection = (vodId: string) => {
    if (!activeCollection) return;
    onChangeCollections(
      collections.map((c) =>
        c.id === activeCollection.id
          ? { ...c, vodIds: (c.vodIds ?? []).filter((id) => id !== vodId) }
          : c
      )
    );
  };

  const removeSeriesFromCollection = (seriesId: string) => {
    if (!activeCollection) return;
    onChangeCollections(
      collections.map((c) =>
        c.id === activeCollection.id
          ? { ...c, seriesIds: (c.seriesIds ?? []).filter((id) => id !== seriesId) }
          : c
      )
    );
  };

  const moveChannel = (from: number, to: number) => {
    if (!activeCollection || to < 0 || to >= activeCollection.channelIds.length) return;
    const copy = [...activeCollection.channelIds];
    const [moved] = copy.splice(from, 1);
    copy.splice(to, 0, moved);
    updateChannelIds(copy);
  };

  const exportCollectionM3u = () => {
    if (!activeCollection) return;
    const m3u = exportChannelsToM3uPlus(activeCollection.name, collectionChannels);
    const blob = new Blob([m3u], { type: 'audio/x-mpegurl;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeCollection.name.toLowerCase().replace(/\s+/g, '-')}.m3u8`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="luma-scroll flex-1 overflow-y-auto p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-full ${
              isM3 ? 'bg-[#283249] text-sky-300' : 'lg-capsule text-sky-300'
            }`}
          >
            <FolderHeart className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">
              {t.collections} ({collections.length})
            </h2>
            <p className="text-xs text-slate-400">{t.collectionsEmptyHint}</p>
          </div>
        </div>

        {/* Create New Collection Inline */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <FolderPlus className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateCollection();
              }}
              placeholder={t.newCollectionPlaceholder}
              className={`${inputClass} w-48 pl-8.5 sm:w-56`}
            />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={newPinLocked}
              onChange={(e) => setNewPinLocked(e.target.checked)}
              className="h-3.5 w-3.5 accent-sky-400"
            />
            <span>PIN</span>
          </label>
          <button
            type="button"
            disabled={!newName.trim()}
            onClick={handleCreateCollection}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold disabled:opacity-40 ${
              isM3 ? 'm3-primary-pill' : 'lg-pill-active'
            }`}
          >
            <Plus className="h-3.5 w-3.5" />
            <span>{t.createCollectionBtn}</span>
          </button>
        </div>
      </div>

      {/* Collection Selector Strip */}
      {collections.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {collections.map((col) => {
            const isSelected = activeCollection?.id === col.id;
            const resolvedChannels = col.channelIds.reduce(
              (acc, id) => (channelById.has(id) ? acc + 1 : acc),
              0
            );
            const resolvedVod = (col.vodIds ?? []).reduce(
              (acc, id) => (vodById.has(id) ? acc + 1 : acc),
              0
            );
            const resolvedSeries = (col.seriesIds ?? []).reduce(
              (acc, id) => (seriesById.has(id) ? acc + 1 : acc),
              0
            );
            const resolvedCount = resolvedChannels + resolvedVod + resolvedSeries;
            const locked =
              parentalEnabled &&
              (col.isPinLocked || lockedGroupIds.includes(col.id)) &&
              !unlockedGroupIds.has(col.id);
            return (
              <button
                key={col.id}
                type="button"
                onClick={() => {
                  if (locked) {
                    onRequestUnlockCollection(col.id, col.name);
                  }
                  setSelectedId(col.id);
                }}
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold transition ${
                  isSelected
                    ? isM3
                      ? 'm3-primary-pill'
                      : 'lg-pill-active'
                    : isM3
                      ? 'm3-secondary-tonal'
                      : 'lg-capsule text-slate-200'
                }`}
              >
                {locked && <Lock className="h-3.5 w-3.5 text-amber-300" />}
                <span>{col.name}</span>
                <span className="rounded-full bg-black/25 px-2 py-0.5 text-[10px] luma-tabular">
                  {resolvedCount}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {!activeCollection ? (
        <div
          className={`flex flex-col items-center justify-center py-16 text-center ${panelClass}`}
        >
          <FolderHeart className="h-8 w-8 text-sky-300/60" />
          <p className="mt-3 max-w-md text-xs text-slate-300">{t.collectionsEmptyHint}</p>
        </div>
      ) : isCollectionLocked ? (
        <div
          className={`flex flex-col items-center justify-center py-16 text-center ${panelClass}`}
        >
          <Lock className="h-8 w-8 text-amber-300" />
          <p className="mt-2 text-sm font-semibold text-white">{activeCollection.name}</p>
          <button
            type="button"
            onClick={() =>
              onRequestUnlockCollection(activeCollection.id, activeCollection.name)
            }
            className={`mt-3 rounded-full px-4 py-2 text-xs font-bold ${
              isM3 ? 'm3-primary-pill' : 'lg-pill-active'
            }`}
          >
            Unlock with PIN
          </button>
        </div>
      ) : (
        <div className={`${panelClass} space-y-4`}>
          {/* Active Collection Header Actions */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              {renamingId === activeCollection.id ? (
                <input
                  type="text"
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && renameText.trim()) {
                      onChangeCollections(
                        collections.map((c) =>
                          c.id === activeCollection.id
                            ? { ...c, name: renameText.trim() }
                            : c
                        )
                      );
                      setRenamingId(null);
                    } else if (e.key === 'Escape') {
                      setRenamingId(null);
                    }
                  }}
                  autoFocus
                  className={`${inputClass} w-52`}
                />
              ) : (
                <h3 className="text-sm font-semibold text-white">
                  {activeCollection.name}{' '}
                  <span className="text-xs font-normal text-slate-400 luma-tabular">
                    ({collectionChannels.length} {t.channelsUnit}
                    {collectionSeries.length > 0
                      ? ` · ${collectionSeries.length} ${t.navSeries}`
                      : ''}
                    )
                  </span>
                </h3>
              )}

              <button
                type="button"
                onClick={() => {
                  if (renamingId === activeCollection.id) {
                    if (renameText.trim()) {
                      onChangeCollections(
                        collections.map((c) =>
                          c.id === activeCollection.id
                            ? { ...c, name: renameText.trim() }
                            : c
                        )
                      );
                    }
                    setRenamingId(null);
                  } else {
                    setRenamingId(activeCollection.id);
                    setRenameText(activeCollection.name);
                  }
                }}
                className="rounded-full p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
                title="Rename collection"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setPickerOpen((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                  pickerOpen
                    ? isM3
                      ? 'm3-primary-pill'
                      : 'lg-pill-active'
                    : isM3
                      ? 'm3-secondary-tonal'
                      : 'lg-capsule text-white'
                }`}
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Countries, Groups &amp; Channels</span>
              </button>

              {collectionChannels.length > 0 && (
                <button
                  type="button"
                  onClick={exportCollectionM3u}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                    isM3 ? 'm3-secondary-tonal' : 'lg-capsule text-sky-200'
                  }`}
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>.m3u8</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  const remaining = collections.filter((c) => c.id !== activeCollection.id);
                  onChangeCollections(remaining);
                  setSelectedId(remaining[0]?.id ?? '');
                }}
                className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/30"
                title="Delete collection"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Structured Playlist -> Country -> Group -> Channels Picker */}
          {pickerOpen && (
            <div
              className={`p-4 space-y-3.5 ${
                isM3
                  ? 'rounded-[22px] bg-[#232B3D] ring-1 ring-white/10'
                  : 'lg-capsule rounded-[20px]'
              }`}
            >
              {/* Row 1: Choose Playlist */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-white">
                    <Database className="h-3.5 w-3.5 text-sky-300" />
                    <span>Playlist:</span>
                  </span>
                  {playlistChoices.map((pl) => {
                    const active = pickerSourceId === pl.id;
                    return (
                      <button
                        key={pl.id}
                        type="button"
                        onClick={() => {
                          setPickerSourceId(pl.id);
                          setPickerCountryCode('all');
                          setPickerGroupId('all');
                          setPickerChPage(0);
                        }}
                        className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                          active
                            ? isM3
                              ? 'm3-primary-pill'
                              : 'lg-pill-active'
                            : 'bg-black/25 text-slate-300 hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        {pl.name} ({pl.count.toLocaleString(bcp47)})
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => setPickerOpen(false)}
                  className="rounded-full px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10 hover:text-white"
                >
                  Done
                </button>
              </div>

              {/* Row 2: 3-Column Cascading Browser (Countries -> Groups -> Channels) */}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                {/* Column A: Countries */}
                <div className="flex flex-col rounded-2xl bg-black/25 p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-white">
                    <span className="flex items-center gap-1.5">
                      <Globe className="h-3.5 w-3.5 text-sky-300" />
                      <span>1. Country</span>
                    </span>
                    {activeCountryBucket && (
                      <button
                        type="button"
                        onClick={() => {
                          const allowed = new Set(activeCountryBucket.groupIds);
                          const ids = cleanPickerChannels
                            .filter((c) => allowed.has(c.groupId))
                            .map((c) => c.id);
                          addManyChannelsToCollection(ids);
                        }}
                        className="rounded-full bg-sky-400/20 px-2.5 py-0.5 text-[10px] font-bold text-sky-200 hover:bg-sky-400/35"
                      >
                        + Add All {activeCountryBucket.code}
                      </button>
                    )}
                  </div>

                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-2 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      value={pickerCountryQuery}
                      onChange={(e) => setPickerCountryQuery(e.target.value)}
                      placeholder="Search country (e.g. GR, IT, DE)…"
                      className="h-7.5 w-full rounded-full bg-white/[0.07] pl-8 pr-3 text-[11px] text-white placeholder:text-slate-400 focus:outline-none"
                    />
                  </div>

                  <div className="luma-scroll max-h-56 overflow-y-auto space-y-1 pr-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setPickerCountryCode('all');
                        setPickerGroupId('all');
                        setPickerChPage(0);
                      }}
                      className={`flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-xs ${
                        pickerCountryCode === 'all'
                          ? 'bg-sky-400/20 font-semibold text-sky-200'
                          : 'text-slate-300 hover:bg-white/10'
                      }`}
                    >
                      <span>All Countries</span>
                      <span className="text-[10px] opacity-70 luma-tabular">
                        {cleanPickerChannels.length.toLocaleString(bcp47)}
                      </span>
                    </button>

                    {filteredPickerCountries.map((bucket) => {
                      const active = pickerCountryCode === bucket.code;
                      return (
                        <div
                          key={bucket.code}
                          onClick={() => {
                            setPickerCountryCode(bucket.code);
                            setPickerGroupId('all');
                            setPickerChPage(0);
                          }}
                          className={`flex cursor-pointer items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-xs ${
                            active
                              ? 'bg-sky-400/20 font-semibold text-sky-200'
                              : 'text-slate-200 hover:bg-white/10'
                          }`}
                        >
                          <span className="truncate">{bucket.label}</span>
                          <div
                            className="flex shrink-0 items-center gap-1.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="text-[10px] opacity-70 luma-tabular">
                              {bucket.channelCount.toLocaleString(bcp47)}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                const allowed = new Set(bucket.groupIds);
                                const ids = cleanPickerChannels
                                  .filter((c) => allowed.has(c.groupId))
                                  .map((c) => c.id);
                                addManyChannelsToCollection(ids);
                              }}
                              className="rounded-full bg-white/10 p-1 text-sky-300 hover:bg-sky-400/30 hover:text-white"
                              title={`Add all ${bucket.label} channels to ${activeCollection.name}`}
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Column B: Groups */}
                <div className="flex flex-col rounded-2xl bg-black/25 p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-white">
                    <span className="flex items-center gap-1.5">
                      <Layers className="h-3.5 w-3.5 text-sky-300" />
                      <span>2. Group ({visiblePickerGroups.length})</span>
                    </span>
                  </div>

                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-2 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      value={pickerGroupQuery}
                      onChange={(e) => setPickerGroupQuery(e.target.value)}
                      placeholder="Filter groups (e.g. Sport, Cinema)…"
                      className="h-7.5 w-full rounded-full bg-white/[0.07] pl-8 pr-3 text-[11px] text-white placeholder:text-slate-400 focus:outline-none"
                    />
                  </div>

                  <div className="luma-scroll max-h-56 overflow-y-auto space-y-1 pr-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setPickerGroupId('all');
                        setPickerChPage(0);
                      }}
                      className={`flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-xs ${
                        pickerGroupId === 'all'
                          ? 'bg-sky-400/20 font-semibold text-sky-200'
                          : 'text-slate-300 hover:bg-white/10'
                      }`}
                    >
                      <span>All Matching Groups</span>
                      <span className="text-[10px] opacity-70 luma-tabular">
                        {visiblePickerGroups.length}
                      </span>
                    </button>

                    {visiblePickerGroups.map((grp) => {
                      const active = pickerGroupId === grp.id;
                      return (
                        <div
                          key={grp.id}
                          onClick={() => {
                            setPickerGroupId(grp.id);
                            setPickerChPage(0);
                          }}
                          className={`flex cursor-pointer items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-xs ${
                            active
                              ? 'bg-sky-400/20 font-semibold text-sky-200'
                              : 'text-slate-200 hover:bg-white/10'
                          }`}
                        >
                          <span className="truncate">{grp.name}</span>
                          <div
                            className="flex shrink-0 items-center gap-1.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="text-[10px] opacity-70 luma-tabular">
                              {grp.count}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                const ids = cleanPickerChannels
                                  .filter((c) => c.groupId === grp.id)
                                  .map((c) => c.id);
                                addManyChannelsToCollection(ids);
                              }}
                              className="rounded-full bg-white/10 p-1 text-sky-300 hover:bg-sky-400/30 hover:text-white"
                              title={`Add entire group "${grp.name}"`}
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Column C: Filtered Channels */}
                <div className="flex flex-col rounded-2xl bg-black/25 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold text-white">
                    <span className="truncate">
                      3. Channels ({visiblePickerChannels.length.toLocaleString(bcp47)})
                    </span>
                    {visiblePickerChannels.length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          addManyChannelsToCollection(
                            visiblePickerChannels.map((c) => c.id)
                          )
                        }
                        className="shrink-0 rounded-full bg-sky-400/20 px-2.5 py-0.5 text-[10px] font-bold text-sky-200 hover:bg-sky-400/35"
                      >
                        + Add Shown ({visiblePickerChannels.length.toLocaleString(bcp47)})
                      </button>
                    )}
                  </div>

                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-2 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      value={pickerChannelQuery}
                      onChange={(e) => {
                        setPickerChannelQuery(e.target.value);
                        setPickerChPage(0);
                      }}
                      placeholder="Search channels…"
                      className="h-7.5 w-full rounded-full bg-white/[0.07] pl-8 pr-3 text-[11px] text-white placeholder:text-slate-400 focus:outline-none"
                    />
                  </div>

                  <div className="luma-scroll max-h-48 overflow-y-auto space-y-1 pr-0.5">
                    {pagedPickerChannels.map((ch) => {
                      const added = existingChannelIdSet.has(ch.id);
                      return (
                        <button
                          key={ch.id}
                          type="button"
                          onClick={() => toggleSingleChannelInCollection(ch.id)}
                          className={`flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs transition ${
                            added
                              ? 'bg-emerald-500/15 font-semibold text-emerald-200'
                              : 'text-slate-200 hover:bg-white/10'
                          }`}
                        >
                          <span className="truncate">{ch.name}</span>
                          {added ? (
                            <Check className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
                          ) : (
                            <Plus className="h-3.5 w-3.5 shrink-0 text-sky-300" />
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {totalPickerPages > 1 && (
                    <div className="flex items-center justify-end gap-1.5 pt-1 text-[11px] text-slate-300 luma-tabular">
                      <button
                        type="button"
                        disabled={safePickerPage === 0}
                        onClick={() => setPickerChPage((p) => Math.max(0, p - 1))}
                        className="rounded-full bg-white/10 p-1 disabled:opacity-30"
                      >
                        <ChevronLeft className="h-3 w-3" />
                      </button>
                      <span>
                        {safePickerPage + 1} / {totalPickerPages.toLocaleString(bcp47)}
                      </span>
                      <button
                        type="button"
                        disabled={safePickerPage >= totalPickerPages - 1}
                        onClick={() =>
                          setPickerChPage((p) => Math.min(totalPickerPages - 1, p + 1))
                        }
                        className="rounded-full bg-white/10 p-1 disabled:opacity-30"
                      >
                        <ChevronRight className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Channels, Movies & Series in Active Collection */}
          {collectionChannels.length === 0 &&
          collectionVod.length === 0 &&
          collectionSeries.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400">
              Click &ldquo;Add Countries, Groups &amp; Channels&rdquo; above to populate{' '}
              <strong className="text-white">{activeCollection.name}</strong>.
            </div>
          ) : (
            <div className="space-y-5">
              {collectionChannels.length > 0 && (
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {collectionChannels.map((ch, idx) => {
                    const isActive = ch.id === activeChannelId;
                    const { current, progressPct } = getCurrentAndNextProgram(
                      ch,
                      nowMs,
                      epgOffsetHours
                    );
                    return (
                      <div
                        key={ch.id}
                        onClick={() => onSelectChannel(ch)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          onOpenChannelMenu({ channel: ch, x: e.clientX, y: e.clientY });
                        }}
                        className={`flex cursor-pointer flex-col justify-between p-3.5 transition ${
                          isM3 ? 'rounded-[20px]' : 'rounded-[18px]'
                        } ${
                          isActive
                            ? isM3
                              ? 'm3-tonal-active ring-1 ring-[#7FD4FF]/60'
                              : 'lg-pill-active'
                            : isM3
                              ? 'bg-[#232B3D] hover:bg-[#2C364C]'
                              : 'lg-capsule hover:bg-white/[0.1]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 text-[11px] text-sky-300 luma-tabular">
                              <span className="font-mono">{idx + 1}.</span>
                              <span className="truncate opacity-75">{ch.groupName}</span>
                            </div>
                            <div className="mt-0.5 truncate text-xs font-semibold text-white">
                              {ch.name}
                            </div>
                          </div>

                          <div
                            className="flex shrink-0 items-center gap-0.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => onSelectChannel(ch)}
                              className="rounded-full p-1 text-sky-300 hover:bg-white/10"
                              title={t.playNow}
                            >
                              <Play className="h-3.5 w-3.5 fill-current" />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveChannel(idx, idx - 1)}
                              className="rounded-full p-1 text-slate-300 hover:bg-white/10"
                              title="Move up"
                            >
                              <ArrowUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveChannel(idx, idx + 1)}
                              className="rounded-full p-1 text-slate-300 hover:bg-white/10"
                              title="Move down"
                            >
                              <ArrowDown className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                updateChannelIds(
                                  activeCollection.channelIds.filter((id) => id !== ch.id)
                                )
                              }
                              className="rounded-full p-1 text-slate-300 hover:bg-rose-500/20 hover:text-rose-200"
                              title="Remove from collection"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
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
                              className="rounded-full p-1 text-slate-300 hover:bg-white/10"
                            >
                              <MoreVertical className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="mt-2.5">
                          <div className="truncate text-[11px] text-slate-300">
                            {current.title}
                          </div>
                          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
                            <div
                              className={
                                isM3 ? 'h-full bg-[#7FD4FF]' : 'luma-accent-gradient h-full'
                              }
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {collectionVod.length > 0 && (
                <div className="space-y-2.5 border-t border-white/10 pt-4">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                    <Film className="h-3.5 w-3.5 text-sky-300" />
                    <span>
                      {t.navVod} ({collectionVod.length})
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    {collectionVod.map((vod) => (
                      <div
                        key={vod.id}
                        onClick={() => onPlayVod?.(vod)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          onOpenChannelMenu({ vod, x: e.clientX, y: e.clientY });
                        }}
                        className={`flex cursor-pointer items-center justify-between gap-2 p-3.5 transition ${
                          isM3
                            ? 'rounded-[20px] bg-[#232B3D] hover:bg-[#2C364C]'
                            : 'lg-capsule rounded-[18px] hover:bg-white/[0.1]'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-[10px] text-sky-300">
                            {vod.genre} · {vod.year} · {vod.resolution}
                          </div>
                          <div className="truncate text-xs font-semibold text-white">
                            {vod.title}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeVodFromCollection(vod.id);
                          }}
                          className="shrink-0 rounded-full p-1.5 text-slate-300 hover:bg-rose-500/20 hover:text-rose-200"
                          title="Remove from collection"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {collectionSeries.length > 0 && (
                <div className="space-y-2.5 border-t border-white/10 pt-4">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300">
                    <Clapperboard className="h-3.5 w-3.5 text-sky-300" />
                    <span>
                      {t.navSeries} ({collectionSeries.length})
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    {collectionSeries.map((ser) => (
                      <div
                        key={ser.id}
                        onClick={() => onOpenSeries(ser.id)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          onOpenChannelMenu({ series: ser, x: e.clientX, y: e.clientY });
                        }}
                        className={`flex cursor-pointer items-center justify-between gap-2 p-3.5 transition ${
                          isM3
                            ? 'rounded-[20px] bg-[#232B3D] hover:bg-[#2C364C]'
                            : 'lg-capsule rounded-[18px] hover:bg-white/[0.1]'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-[10px] text-sky-300">
                            {ser.genre} · {ser.year}
                          </div>
                          <div className="truncate text-xs font-semibold text-white">
                            {ser.title}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeSeriesFromCollection(ser.id);
                          }}
                          className="shrink-0 rounded-full p-1.5 text-slate-300 hover:bg-rose-500/20 hover:text-rose-200"
                          title="Remove from collection"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
