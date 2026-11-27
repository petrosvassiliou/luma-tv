import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Clock,
  FolderHeart,
  Grid2x2,
  Layers,
  Loader2,
  MoreVertical,
  Play,
  Radio,
  RotateCcw,
  Search,
  Sparkles,
  Star,
  Tv,
} from 'lucide-react';
import { getCurrentAndNextProgram } from '../../data/mockCatalog';
import {
  LOCALE_META,
  TRANSLATIONS,
  type LumaLocale,
} from '../../i18n/translations';
import { searchSeriesRanked } from '../../services/channelSearch';
import type { WatchHistoryEntry } from '../../services/lumaCloudSync';
import type {
  Channel,
  CustomBouquet,
  PlatformDesignMode,
  SeriesEpisode,
  SeriesItem,
  VodItem,
} from '../../types/luma';
import type { ChannelContextMenuTarget } from '../common/ChannelContextMenu';

interface HomeHubViewProps {
  designMode: PlatformDesignMode;
  channels: Channel[];
  vodCatalog: VodItem[];
  seriesCatalog: SeriesItem[];
  watchHistory: WatchHistoryEntry[];
  nowMs: number;
  locale?: LumaLocale;
  onSelectChannel: (channel: Channel) => void;
  onPlayVod: (vod: VodItem, resumeSec?: number) => void;
  onPlaySeriesEpisode: (
    series: SeriesItem,
    seasonNum: number,
    episode: SeriesEpisode,
    resumeSec?: number
  ) => void;
  onOpenMultiview: () => void;
  onOpenSeriesHub: (seriesId?: string) => void;
}

export const HomeHubView: React.FC<HomeHubViewProps> = ({
  designMode,
  channels,
  vodCatalog,
  seriesCatalog,
  watchHistory,
  nowMs,
  locale = 'de',
  onSelectChannel,
  onPlayVod,
  onPlaySeriesEpisode,
  onOpenMultiview,
  onOpenSeriesHub,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const t = TRANSLATIONS[locale];
  const heroChannel = channels[0];
  const heroProg = heroChannel
    ? getCurrentAndNextProgram(heroChannel, nowMs).current
    : null;

  const cardSurface = isM3
    ? 'rounded-[26px] bg-[#1A202E] hover:bg-[#232B3D]'
    : 'lg-pane rounded-[22px] hover:ring-1 hover:ring-white/30';

  const handleResumeItem = (entry: WatchHistoryEntry) => {
    const ch = channels.find((c) => c.id === entry.itemId);
    if (ch) {
      onSelectChannel(ch);
      return;
    }
    const vod = vodCatalog.find((v) => v.id === entry.itemId);
    if (vod) {
      onPlayVod(vod, entry.resumeSec);
      return;
    }
    for (const ser of seriesCatalog) {
      for (const sea of ser.seasons) {
        const ep = sea.episodes.find((e) => e.id === entry.itemId);
        if (ep) {
          onPlaySeriesEpisode(ser, sea.seasonNumber, ep, entry.resumeSec);
          return;
        }
      }
    }
    if (channels[0]) onSelectChannel(channels[0]);
  };

  return (
    <div className="luma-scroll flex-1 overflow-y-auto p-5 space-y-6">
      {/* Featured Spotlight Hero */}
      {heroChannel && heroProg && (
        <div
          className={`relative overflow-hidden p-6 sm:p-8 ${
            isM3
              ? 'rounded-[32px] bg-gradient-to-br from-[#0F2942] via-[#172136] to-[#121624]'
              : 'lg-pane rounded-[28px]'
          }`}
        >
          <div
            className="pointer-events-none absolute -top-20 -right-20 h-72 w-72 rounded-full opacity-35 blur-3xl"
            style={{ background: 'radial-gradient(circle, #38BDF8 0%, transparent 70%)' }}
          />

          <div className="relative z-10 max-w-2xl space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={
                  isM3
                    ? 'm3-tertiary-badge rounded-full px-3 py-1 text-[11px] font-bold'
                    : 'lg-capsule rounded-full px-3 py-1 text-[11px] font-semibold text-sky-200'
                }
              >
                {t.liveBadge} · {heroChannel.resolution}
              </span>
              <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-medium text-slate-200">
                {heroChannel.name}
              </span>
            </div>

            <h2 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
              {heroProg.title}
            </h2>
            <p className="text-xs leading-relaxed text-slate-200/85 sm:text-sm">
              {heroProg.description}
            </p>

            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => onSelectChannel(heroChannel)}
                className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-bold shadow-lg ${
                  isM3 ? 'm3-primary-pill' : 'lg-pill-active'
                }`}
              >
                <Play className="h-4 w-4 fill-current" />
                <span>{t.playNow}</span>
              </button>

              <button
                type="button"
                onClick={onOpenMultiview}
                className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-xs font-semibold ${
                  isM3 ? 'm3-secondary-tonal' : 'lg-capsule text-white'
                }`}
              >
                <Grid2x2 className="h-4 w-4" />
                <span>{t.navMultiview}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Continue Watching */}
      {watchHistory.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-sky-400" />
            <h3 className="text-sm font-semibold text-white">
              {t.continueWatchingHeader}
            </h3>
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            {watchHistory.slice(0, 4).map((entry) => {
              const pct =
                entry.durationSec > 0
                  ? Math.min(
                      98,
                      Math.max(8, Math.round((entry.resumeSec / entry.durationSec) * 100))
                    )
                  : 100;
              const remainMin =
                entry.durationSec > entry.resumeSec
                  ? Math.max(1, Math.round((entry.durationSec - entry.resumeSec) / 60))
                  : null;

              return (
                <button
                  key={entry.itemId}
                  type="button"
                  onClick={() => handleResumeItem(entry)}
                  className={`group flex flex-col justify-between p-4 text-left transition hover:-translate-y-0.5 ${cardSurface}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="rounded-full bg-sky-400/15 px-2.5 py-0.5 text-[10px] font-bold uppercase text-sky-300">
                      {entry.kind}
                    </span>
                    <span
                      className={`flex h-8 w-8 items-center justify-center rounded-full transition group-hover:scale-105 ${
                        isM3 ? 'm3-primary-pill' : 'lg-pill-active'
                      }`}
                    >
                      <Play className="h-3.5 w-3.5 fill-current" />
                    </span>
                  </div>

                  <div className="mt-4">
                    <div className="truncate text-xs font-semibold text-white">
                      {entry.title}
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400 luma-tabular">
                      <span>
                        {entry.kind === 'live'
                          ? t.liveBadge
                          : remainMin
                            ? `${remainMin} min left`
                            : t.playNow}
                      </span>
                      {entry.durationSec > 0 && <span>{pct}%</span>}
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                      <div
                        className={isM3 ? 'h-full bg-[#7FD4FF]' : 'luma-accent-gradient h-full'}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Live Now */}
      {channels.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-white">{t.navLiveTv}</h3>
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            {channels.slice(0, 4).map((ch) => {
              const { current, progressPct } = getCurrentAndNextProgram(ch, nowMs);
              return (
                <div
                  key={ch.id}
                  onClick={() => onSelectChannel(ch)}
                  className={`cursor-pointer p-4 transition hover:-translate-y-0.5 ${cardSurface}`}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="truncate font-semibold text-sky-300">
                      #{ch.number} · {ch.name}
                    </span>
                    <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-300">
                      {ch.resolution}
                    </span>
                  </div>
                  <div className="mt-2.5 truncate text-xs font-semibold text-white">
                    {current.title}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-slate-400">
                    {current.subtitle}
                  </div>
                  <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className={isM3 ? 'h-full bg-[#7FD4FF]' : 'luma-accent-gradient h-full'}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Series Highlights */}
      {seriesCatalog.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-sky-400" />
              <h3 className="text-sm font-semibold text-white">
                {t.seriesHighlightsHeader}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onOpenSeriesHub()}
              className="text-xs font-semibold text-sky-300 hover:text-white"
            >
              {t.openAllSeries}
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {seriesCatalog.slice(0, 6).map((ser) => (
              <div
                key={ser.id}
                onClick={() => onOpenSeriesHub(ser.id)}
                className={`cursor-pointer overflow-hidden transition hover:-translate-y-0.5 ${cardSurface}`}
              >
                <div
                  className="flex h-28 flex-col justify-between p-4"
                  style={{
                    background: `linear-gradient(135deg, ${ser.accentFrom}55 0%, ${ser.accentTo}CC 100%)`,
                  }}
                >
                  <div className="flex items-center justify-between text-[10px] font-semibold">
                    <span className="rounded-full bg-black/55 px-2.5 py-0.5 text-sky-200">
                      {ser.badge}
                    </span>
                    <span className="rounded-full bg-black/55 px-2.5 py-0.5 text-amber-300 luma-tabular">
                      ★ {ser.rating}
                    </span>
                  </div>
                  <div>
                    <div className="truncate text-[11px] text-sky-200/90">{ser.genre}</div>
                    <div className="truncate text-sm font-semibold text-white">
                      {ser.title}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between px-4 py-3 text-[11px] text-slate-400 luma-tabular">
                  <span>{ser.year}</span>
                  <span>
                    {ser.seasonsLoaded === false
                      ? t.seasonsUnit
                      : `${ser.seasons.length} ${t.seasonsUnit}`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

interface SeriesBrowserViewProps {
  designMode: PlatformDesignMode;
  seriesCatalog: SeriesItem[];
  initialSeriesId?: string | null;
  onClearInitialSeries?: () => void;
  favoriteSeriesIds?: Set<string>;
  collections?: CustomBouquet[];
  onToggleFavoriteSeries?: (seriesId: string) => void;
  onOpenItemMenu?: (target: ChannelContextMenuTarget) => void;
  watchHistory: WatchHistoryEntry[];
  locale?: LumaLocale;
  loadingSeriesIds?: Set<string>;
  onEnsureSeriesLoaded?: (series: SeriesItem) => void;
  onPlayEpisode: (
    series: SeriesItem,
    seasonNumber: number,
    episode: SeriesEpisode,
    resumeSec?: number
  ) => void;
  onInspectSeries?: (series: SeriesItem) => void;
}

const SERIES_PAGE_SIZE = 48;

export const SeriesBrowserView: React.FC<SeriesBrowserViewProps> = ({
  designMode,
  seriesCatalog,
  initialSeriesId,
  onClearInitialSeries,
  favoriteSeriesIds = new Set(),
  collections = [],
  onToggleFavoriteSeries,
  onOpenItemMenu,
  watchHistory,
  locale = 'de',
  loadingSeriesIds,
  onEnsureSeriesLoaded,
  onPlayEpisode,
  onInspectSeries,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const t = TRANSLATIONS[locale];
  const bcp47 = LOCALE_META[locale].bcp47;

  // Browse vs Detail state (`null` = searchable card grid!)
  const [openedSeriesId, setOpenedSeriesId] = useState<string | null>(null);
  const [selectedSeasonNum, setSelectedSeasonNum] = useState<number>(1);
  const [query, setQuery] = useState('');
  const [scopeFilter, setScopeFilter] = useState<string>('all'); // 'all' | 'favorites' | `col:...`
  const [genreFilter, setGenreFilter] = useState<string>('all');
  const [page, setPage] = useState(0);

  const effectiveSeriesId = openedSeriesId ?? initialSeriesId ?? null;

  const activeSeries = useMemo(
    () =>
      effectiveSeriesId
        ? seriesCatalog.find((s) => s.id === effectiveSeriesId) ?? null
        : null,
    [effectiveSeriesId, seriesCatalog]
  );

  const activeSeason =
    activeSeries?.seasons.find((s) => s.seasonNumber === selectedSeasonNum) ??
    activeSeries?.seasons[0];

  useEffect(() => {
    if (
      activeSeries &&
      activeSeries.xtreamSeriesId &&
      activeSeries.seasonsLoaded === false
    ) {
      onEnsureSeriesLoaded?.(activeSeries);
    }
  }, [activeSeries, onEnsureSeriesLoaded]);

  const derivedGenres = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < seriesCatalog.length; i++) {
      const g = seriesCatalog[i].genre || 'Other';
      map.set(g, (map.get(g) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [seriesCatalog]);

  const filteredSeries = useMemo(() => {
    let base = seriesCatalog;

    if (scopeFilter === 'favorites') {
      base = base.filter((s) => favoriteSeriesIds.has(s.id));
    } else if (scopeFilter.startsWith('col:')) {
      const colId = scopeFilter.slice(4);
      const col = collections.find((c) => c.id === colId);
      const set = new Set(col?.seriesIds ?? []);
      base = base.filter((s) => set.has(s.id));
    }

    if (genreFilter !== 'all') {
      base = base.filter((s) => s.genre === genreFilter);
    }

    if (!query.trim()) return base;
    return searchSeriesRanked(base, query, base.length).items;
  }, [seriesCatalog, scopeFilter, genreFilter, query, favoriteSeriesIds, collections]);

  const totalPages = Math.max(1, Math.ceil(filteredSeries.length / SERIES_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pagedSeries = filteredSeries.slice(
    safePage * SERIES_PAGE_SIZE,
    (safePage + 1) * SERIES_PAGE_SIZE
  );

  const isLoadingActiveSeries = Boolean(
    activeSeries && loadingSeriesIds?.has(activeSeries.id)
  );

  // -------------------------------------------------------------------------
  // 1. SERIES DETAIL & EPISODES VIEW
  // -------------------------------------------------------------------------
  if (activeSeries) {
    const isFav = favoriteSeriesIds.has(activeSeries.id);
    return (
      <div className="luma-scroll flex-1 overflow-y-auto p-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            id="btn-series-back-catalog"
            type="button"
            onClick={() => {
              setOpenedSeriesId(null);
              onClearInitialSeries?.();
            }}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold ${
              isM3 ? 'm3-secondary-tonal' : 'lg-capsule text-white'
            }`}
          >
            <ArrowLeft className="h-4 w-4" />
            <span>{t.navSeries}</span>
          </button>

          <div className="flex items-center gap-2">
            {onToggleFavoriteSeries && (
              <button
                type="button"
                onClick={() => onToggleFavoriteSeries(activeSeries.id)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold ${
                  isFav
                    ? 'bg-amber-400/20 text-amber-200 ring-1 ring-amber-400/40'
                    : isM3
                      ? 'm3-secondary-tonal'
                      : 'lg-capsule text-white'
                }`}
              >
                <Star className={`h-3.5 w-3.5 ${isFav ? 'fill-amber-400 text-amber-400' : ''}`} />
                <span>{isFav ? t.removeFromFavorites : t.addToFavorites}</span>
              </button>
            )}

            {onOpenItemMenu && (
              <button
                type="button"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  onOpenItemMenu({
                    series: activeSeries,
                    x: rect.left,
                    y: rect.bottom + 6,
                  });
                }}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold ${
                  isM3 ? 'm3-secondary-tonal' : 'lg-capsule text-sky-200'
                }`}
              >
                <FolderHeart className="h-3.5 w-3.5" />
                <span>{t.addToCollectionHeader}</span>
              </button>
            )}
          </div>
        </div>

        {/* Selected Series Banner */}
        <div
          className={`p-6 ${isM3 ? 'rounded-[28px]' : 'lg-pane rounded-[24px]'}`}
          style={{
            background: `linear-gradient(135deg, ${activeSeries.accentFrom}44 0%, ${activeSeries.accentTo}CC 100%)`,
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-black/50 px-3 py-0.5 font-semibold text-sky-200">
                {activeSeries.badge}
              </span>
              <span className="rounded-full bg-black/50 px-3 py-0.5 font-semibold text-amber-300 luma-tabular">
                ★ {activeSeries.rating}
              </span>
              <span className="text-sky-100/80">
                {activeSeries.genre} · {activeSeries.year}
              </span>
            </div>

            {onInspectSeries && (
              <button
                type="button"
                onClick={() => onInspectSeries(activeSeries)}
                className="rounded-full bg-black/50 px-3 py-1 text-xs font-semibold text-sky-200 hover:bg-black/75 hover:text-white"
              >
                Details
              </button>
            )}
          </div>

          <h3 className="mt-2 text-xl font-bold text-white">{activeSeries.title}</h3>
          <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-slate-200">
            {activeSeries.synopsis}
          </p>

          {/* Season Tabs */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {activeSeries.seasons.map((sea) => {
              const isActive = sea.seasonNumber === activeSeason?.seasonNumber;
              return (
                <button
                  key={sea.seasonNumber}
                  type="button"
                  onClick={() => setSelectedSeasonNum(sea.seasonNumber)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                    isActive
                      ? isM3
                        ? 'bg-[#7FD4FF] text-[#00354A]'
                        : 'lg-pill-active'
                      : 'bg-black/45 text-slate-200 hover:bg-black/65'
                  }`}
                >
                  <Tv className="h-3.5 w-3.5" />
                  <span>{sea.title}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Episode List */}
        {isLoadingActiveSeries && (
          <div className="flex items-center gap-2.5 rounded-2xl bg-white/[0.04] px-4 py-3 text-xs text-sky-300">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{t.loadingEpisodes}</span>
          </div>
        )}

        <div className="space-y-2.5">
          {activeSeason?.episodes.map((ep) => {
            const hist = watchHistory.find((w) => w.itemId === ep.id);
            const pct =
              hist && hist.durationSec > 0
                ? Math.min(98, Math.round((hist.resumeSec / hist.durationSec) * 100))
                : 0;

            return (
              <div
                key={ep.id}
                onClick={() =>
                  onPlayEpisode(
                    activeSeries,
                    activeSeason.seasonNumber,
                    ep,
                    hist?.resumeSec ?? 0
                  )
                }
                className={`group flex cursor-pointer flex-col justify-between gap-3 p-4 transition sm:flex-row sm:items-center ${
                  isM3
                    ? 'rounded-[24px] bg-[#1A202E] hover:bg-[#232B3D]'
                    : 'lg-pane rounded-[20px] hover:ring-1 hover:ring-white/25'
                }`}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-sky-400/15 px-2.5 py-0.5 font-mono text-[11px] font-bold text-sky-300 luma-tabular">
                      S{String(activeSeason.seasonNumber).padStart(2, '0')}E
                      {String(ep.episodeNumber).padStart(2, '0')}
                    </span>
                    <h4 className="truncate text-sm font-semibold text-white">
                      {ep.title}
                    </h4>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-300">
                      {ep.resolution}
                    </span>
                  </div>

                  <p className="text-xs text-slate-300/85">{ep.synopsis}</p>

                  {pct > 0 && (
                    <div className="pt-1">
                      <div className="h-1.5 w-48 overflow-hidden rounded-full bg-white/10">
                        <div
                          className={
                            isM3 ? 'h-full bg-[#7FD4FF]' : 'luma-accent-gradient h-full'
                          }
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  <span className="inline-flex items-center gap-1 text-xs text-slate-400 luma-tabular">
                    <Clock className="h-3.5 w-3.5" />
                    {ep.durationMin} min
                  </span>

                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition group-hover:scale-105 ${
                      isM3 ? 'm3-primary-pill' : 'lg-pill-active'
                    }`}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>{pct > 0 ? t.resumePlayback : t.playNow}</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // 2. SEARCHABLE SERIES LIBRARY GRID (WITH FAVORITES & COLLECTIONS)
  // -------------------------------------------------------------------------
  const cardSurface = isM3
    ? 'rounded-[24px] bg-[#1A202E] hover:bg-[#232B3D]'
    : 'lg-pane rounded-[20px] hover:ring-1 hover:ring-white/25';

  const collectionsWithSeries = collections.filter(
    (c) => (c.seriesIds?.length ?? 0) > 0
  );

  return (
    <div className="luma-scroll flex-1 overflow-y-auto p-5 space-y-4">
      {/* Header + Search + Category Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-full ${
              isM3 ? 'bg-[#283249] text-sky-300' : 'lg-capsule text-sky-300'
            }`}
          >
            <Clapperboard className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-white">
              {t.navSeries} ({filteredSeries.length.toLocaleString(bcp47)})
            </h2>
            <p className="text-xs text-slate-400">
              Search series, filter by category, or save series to Favorites &amp; Collections.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-64 sm:w-72">
            <Search className="pointer-events-none absolute left-3.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder={t.searchPlaceholder}
              className={
                isM3
                  ? 'h-9 w-full rounded-full bg-[#232B3D] pl-9 pr-7 text-xs text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#7FD4FF]/60'
                  : 'lg-capsule h-9 w-full rounded-full pl-9 pr-7 text-xs text-white placeholder:text-white/45 focus:outline-none'
              }
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setPage(0);
                }}
                className="absolute right-3 top-2 text-xs text-slate-400 hover:text-white"
              >
                ✕
              </button>
            )}
          </div>

          {derivedGenres.length > 1 && (
            <select
              value={genreFilter}
              onChange={(e) => {
                setGenreFilter(e.target.value);
                setPage(0);
              }}
              className={`h-9 max-w-[220px] rounded-full px-3.5 text-xs text-white focus:outline-none ${
                isM3 ? 'bg-[#232B3D]' : 'lg-capsule bg-[#121826]'
              }`}
            >
              <option value="all">All Categories ({derivedGenres.length})</option>
              {derivedGenres.map((g) => (
                <option key={g.name} value={g.name}>
                  {g.name} ({g.count})
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Scope Pills (All · ★ Favorites · Collections) + Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setScopeFilter('all');
              setPage(0);
            }}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
              scopeFilter === 'all'
                ? isM3
                  ? 'm3-primary-pill'
                  : 'lg-pill-active'
                : 'bg-white/[0.06] text-slate-300 hover:text-white'
            }`}
          >
            All ({seriesCatalog.length.toLocaleString(bcp47)})
          </button>

          <button
            type="button"
            onClick={() => {
              setScopeFilter('favorites');
              setPage(0);
            }}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
              scopeFilter === 'favorites'
                ? isM3
                  ? 'm3-primary-pill'
                  : 'lg-pill-active'
                : 'bg-white/[0.06] text-slate-300 hover:text-white'
            }`}
          >
            <Star className="h-3.5 w-3.5 text-amber-300" />
            <span>
              {t.favorites} ({favoriteSeriesIds.size})
            </span>
          </button>

          {collectionsWithSeries.map((col) => {
            const key = `col:${col.id}`;
            const active = scopeFilter === key;
            return (
              <button
                key={col.id}
                type="button"
                onClick={() => {
                  setScopeFilter(key);
                  setPage(0);
                }}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  active
                    ? isM3
                      ? 'm3-primary-pill'
                      : 'lg-pill-active'
                    : 'bg-white/[0.06] text-slate-300 hover:text-white'
                }`}
              >
                <FolderHeart className="h-3.5 w-3.5 text-sky-300" />
                <span>
                  {col.name} ({col.seriesIds?.length ?? 0})
                </span>
              </button>
            );
          })}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center gap-1.5 text-xs text-slate-300 luma-tabular">
            <button
              type="button"
              disabled={safePage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded-full bg-white/10 p-1.5 text-white disabled:opacity-30"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span>
              {safePage + 1} / {totalPages.toLocaleString(bcp47)}
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              className="rounded-full bg-white/10 p-1.5 text-white disabled:opacity-30"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Series Cards Grid */}
      {pagedSeries.length === 0 ? (
        <div
          className={`flex flex-col items-center justify-center py-16 text-center ${
            isM3 ? 'rounded-[28px] bg-[#1A202E]' : 'lg-pane rounded-[24px]'
          }`}
        >
          <Clapperboard className="h-8 w-8 text-sky-300/60" />
          <p className="mt-3 text-xs text-slate-300">No matching series found.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {pagedSeries.map((ser) => {
            const isFav = favoriteSeriesIds.has(ser.id);
            return (
              <div
                key={ser.id}
                onClick={() => {
                  setOpenedSeriesId(ser.id);
                  setSelectedSeasonNum(1);
                }}
                onContextMenu={(e) => {
                  if (!onOpenItemMenu) return;
                  e.preventDefault();
                  onOpenItemMenu({ series: ser, x: e.clientX, y: e.clientY });
                }}
                className={`group flex cursor-pointer flex-col justify-between overflow-hidden transition hover:-translate-y-0.5 ${cardSurface}`}
              >
                <div
                  className="relative flex h-36 flex-col justify-between p-4"
                  style={{
                    background: `linear-gradient(135deg, ${ser.accentFrom}55 0%, ${ser.accentTo}DD 100%)`,
                  }}
                >
                  {ser.coverUrl && (
                    <img
                      src={ser.coverUrl}
                      alt=""
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                      className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-35 transition group-hover:opacity-50"
                    />
                  )}

                  <div className="relative z-10 flex items-center justify-between gap-2">
                    <span className="truncate rounded-full bg-black/60 px-2.5 py-0.5 text-[10px] font-semibold text-sky-200">
                      {ser.genre}
                    </span>

                    <div
                      className="flex shrink-0 items-center gap-0.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {onToggleFavoriteSeries && (
                        <button
                          type="button"
                          onClick={() => onToggleFavoriteSeries(ser.id)}
                          className="rounded-full bg-black/55 p-1.5 text-slate-200 hover:bg-black/80 hover:text-amber-300"
                          title={isFav ? t.removeFromFavorites : t.addToFavorites}
                        >
                          <Star
                            className={`h-3.5 w-3.5 ${
                              isFav ? 'fill-amber-400 text-amber-400' : ''
                            }`}
                          />
                        </button>
                      )}
                      {onOpenItemMenu && (
                        <button
                          type="button"
                          onClick={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            onOpenItemMenu({
                              series: ser,
                              x: rect.left,
                              y: rect.bottom + 4,
                            });
                          }}
                          className="rounded-full bg-black/55 p-1.5 text-slate-200 hover:bg-black/80 hover:text-white"
                          title={t.addToCollectionHeader}
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="relative z-10">
                    <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-white drop-shadow">
                      {ser.title}
                    </h3>
                  </div>
                </div>

                <div className="flex items-center justify-between px-4 py-2.5 text-[11px] text-slate-400 luma-tabular">
                  <span>{ser.year}</span>
                  <span className="font-semibold text-amber-300">★ {ser.rating}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
