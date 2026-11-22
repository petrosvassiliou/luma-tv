import React, { useState } from 'react';
import {
  Clock,
  Grid2x2,
  Layers,
  Play,
  Radio,
  RotateCcw,
  Sparkles,
  Tv,
} from 'lucide-react';
import { getCurrentAndNextProgram } from '../../data/mockCatalog';
import type { WatchHistoryEntry } from '../../services/lumaCloudSync';
import type {
  Channel,
  PlatformDesignMode,
  SeriesEpisode,
  SeriesItem,
  VodItem,
} from '../../types/luma';

interface HomeHubViewProps {
  designMode: PlatformDesignMode;
  channels: Channel[];
  vodCatalog: VodItem[];
  seriesCatalog: SeriesItem[];
  watchHistory: WatchHistoryEntry[];
  nowMs: number;
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
  onSelectChannel,
  onPlayVod,
  onPlaySeriesEpisode,
  onOpenMultiview,
  onOpenSeriesHub,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const heroChannel = channels[0];
  const { current: heroProg } = getCurrentAndNextProgram(heroChannel, nowMs);

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
              LIVE HIGHLIGHT · {heroChannel.resolution}
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
              <span>Jetzt live einschalten</span>
            </button>

            <button
              type="button"
              onClick={onOpenMultiview}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-xs font-semibold ${
                isM3 ? 'm3-secondary-tonal' : 'lg-capsule text-white'
              }`}
            >
              <Grid2x2 className="h-4 w-4" />
              <span>4x Sport Multiview</span>
            </button>
          </div>
        </div>
      </div>

      {/* Continue Watching ("Weiterschauen") with Per-Episode / VOD Resume Bars */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4 text-sky-400" />
            <h3 className="text-sm font-semibold text-white">
              Weiterschauen &amp; Zuletzt gesehen
            </h3>
          </div>
          <span className="text-[11px] text-slate-400 luma-tabular">
            Sync-fähig via Luma Vault
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          {watchHistory.slice(0, 4).map((entry) => {
            const pct =
              entry.durationSec > 0
                ? Math.min(98, Math.max(8, Math.round((entry.resumeSec / entry.durationSec) * 100)))
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
                  <div className="truncate text-xs font-semibold text-white">{entry.title}</div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400 luma-tabular">
                    <span>
                      {entry.kind === 'live'
                        ? 'Sofort-Zapping'
                        : remainMin
                          ? `Noch ${remainMin} Min.`
                          : 'Bereit'}
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

      {/* Live Now on Flagship Channels */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-emerald-400" />
          <h3 className="text-sm font-semibold text-white">Jetzt live auf Top-Sendern</h3>
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
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-sky-300">
                    #{ch.number} · {ch.name}
                  </span>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-300">
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

      {/* Xtream Series Spotlight */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-sky-400" />
            <h3 className="text-sm font-semibold text-white">Xtream Serien-Highlights</h3>
          </div>
          <button
            type="button"
            onClick={() => onOpenSeriesHub()}
            className="text-xs font-semibold text-sky-300 hover:text-white"
          >
            Alle Serien öffnen →
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {seriesCatalog.map((ser) => (
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
                  <div className="text-[11px] text-sky-200/90">{ser.genre}</div>
                  <div className="text-sm font-semibold text-white">{ser.title}</div>
                </div>
              </div>
              <div className="flex items-center justify-between px-4 py-3 text-[11px] text-slate-400 luma-tabular">
                <span>{ser.seasons.length} Staffeln</span>
                <span>
                  {ser.seasons.reduce((acc, s) => acc + s.episodes.length, 0)} Episoden
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

interface SeriesBrowserViewProps {
  designMode: PlatformDesignMode;
  seriesCatalog: SeriesItem[];
  initialSeriesId?: string | null;
  watchHistory: WatchHistoryEntry[];
  onPlayEpisode: (
    series: SeriesItem,
    seasonNumber: number,
    episode: SeriesEpisode,
    resumeSec?: number
  ) => void;
}

export const SeriesBrowserView: React.FC<SeriesBrowserViewProps> = ({
  designMode,
  seriesCatalog,
  initialSeriesId,
  watchHistory,
  onPlayEpisode,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const [selectedSeriesId, setSelectedSeriesId] = useState<string>(
    initialSeriesId || seriesCatalog[0]?.id || ''
  );
  const [selectedSeasonNum, setSelectedSeasonNum] = useState<number>(1);

  const activeSeries =
    seriesCatalog.find((s) => s.id === selectedSeriesId) ?? seriesCatalog[0];
  const activeSeason =
    activeSeries?.seasons.find((s) => s.seasonNumber === selectedSeasonNum) ??
    activeSeries?.seasons[0];

  if (!activeSeries) return null;

  return (
    <div className="luma-scroll flex-1 overflow-y-auto p-5 space-y-5">
      {/* Series Selector Pills */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">
            Xtream Serien-Mediathek · Staffeln &amp; Episoden
          </h2>
          <p className="text-xs text-slate-400">
            Episoden-genaue Fortschrittsbalken und nahtloses Weiterschauen.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {seriesCatalog.map((ser) => {
            const active = ser.id === activeSeries.id;
            return (
              <button
                key={ser.id}
                type="button"
                onClick={() => {
                  setSelectedSeriesId(ser.id);
                  setSelectedSeasonNum(1);
                }}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  active
                    ? isM3
                      ? 'm3-primary-pill'
                      : 'lg-pill-active'
                    : isM3
                      ? 'm3-secondary-tonal'
                      : 'lg-capsule text-slate-200'
                }`}
              >
                {ser.title.split('·')[0].trim()}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Series Banner */}
      <div
        className={`p-6 ${
          isM3 ? 'rounded-[28px]' : 'lg-pane rounded-[24px]'
        }`}
        style={{
          background: `linear-gradient(135deg, ${activeSeries.accentFrom}44 0%, ${activeSeries.accentTo}CC 100%)`,
        }}
      >
        <div className="flex flex-wrap items-center gap-2 text-xs">
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
                  hist?.resumeSec ?? 360
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
                  <h4 className="truncate text-sm font-semibold text-white">{ep.title}</h4>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-300">
                    {ep.resolution}
                  </span>
                </div>

                <p className="text-xs text-slate-300/85">{ep.synopsis}</p>

                {pct > 0 && (
                  <div className="pt-1">
                    <div className="h-1.5 w-48 overflow-hidden rounded-full bg-white/10">
                      <div
                        className={isM3 ? 'h-full bg-[#7FD4FF]' : 'luma-accent-gradient h-full'}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-3">
                <span className="inline-flex items-center gap-1 text-xs text-slate-400 luma-tabular">
                  <Clock className="h-3.5 w-3.5" />
                  {ep.durationMin} Min.
                </span>

                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition group-hover:scale-105 ${
                    isM3 ? 'm3-primary-pill' : 'lg-pill-active'
                  }`}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>{pct > 0 ? 'Fortsetzen' : 'Abspielen'}</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
