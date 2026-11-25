import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BellRing,
  Clock,
  Crosshair,
  History,
  MoreVertical,
  Play,
  Radio,
  Search,
  Star,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { StoredChannel, StoredEpgProgram } from '../../db/lumaDb';
import { getChannelProgramsInRange } from '../../data/mockCatalog';
import {
  LOCALE_META,
  TRANSLATIONS,
  type LumaLocale,
} from '../../i18n/translations';
import { searchChannelsRanked } from '../../services/channelSearch';
import type { Channel, EpgProgram, PlatformDesignMode } from '../../types/luma';
import type { ChannelContextMenuTarget } from '../common/ChannelContextMenu';

interface VirtualizedEpgGridProps {
  designMode: PlatformDesignMode;
  channels: (Channel & Partial<Pick<StoredChannel, 'tvgId'>>)[];
  xmltvMap?: Map<string, StoredEpgProgram[]>;
  activeChannelId: string;
  favoriteIds: Set<string>;
  reminderProgramIds?: Set<string>;
  epgOffsetHours: number;
  nowMs: number;
  locale?: LumaLocale;
  onSelectChannel: (channel: Channel) => void;
  onStartTimeshift: (channel: Channel, program: EpgProgram) => void;
  onToggleFavorite: (channelId: string) => void;
  onOpenChannelMenu?: (target: ChannelContextMenuTarget) => void;
  onToggleReminder?: (channel: Channel, program: EpgProgram) => void;
}

const ROW_HEIGHT = 60;
const HEADER_HEIGHT = 42;
const CHANNEL_COL_WIDTH = 244;
const OVERSCAN_ROWS = 6;

export const VirtualizedEpgGrid: React.FC<VirtualizedEpgGridProps> = ({
  designMode,
  channels,
  xmltvMap,
  activeChannelId,
  favoriteIds,
  reminderProgramIds,
  epgOffsetHours,
  nowMs,
  locale = 'de',
  onSelectChannel,
  onStartTimeshift,
  onToggleFavorite,
  onOpenChannelMenu,
  onToggleReminder,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const t = TRANSLATIONS[locale];
  const bcp47 = LOCALE_META[locale].bcp47;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const didInitialCenter = useRef(false);

  const [pxPerMin, setPxPerMin] = useState<number>(4.4);
  const [quickFilter, setQuickFilter] = useState<string>('');
  const [scrollTop, setScrollTop] = useState<number>(0);
  const [scrollLeft, setScrollLeft] = useState<number>(0);
  const [viewportWidth, setViewportWidth] = useState<number>(1100);
  const [viewportHeight, setViewportHeight] = useState<number>(420);
  const [inspected, setInspected] = useState<{
    channel: Channel;
    program: EpgProgram;
  } | null>(null);

  const halfHourBucket = Math.floor(nowMs / (30 * 60_000));
  const timelineStartMs = useMemo(() => {
    return (halfHourBucket - 12) * 30 * 60_000;
  }, [halfHourBucket]);

  const totalMinutes = 24 * 60;
  const timelineWidthPx = Math.round(totalMinutes * pxPerMin);
  const timelineEndMs = timelineStartMs + totalMinutes * 60_000;

  const filteredChannels = useMemo(() => {
    const q = quickFilter.trim();
    if (!q) return channels;
    return searchChannelsRanked(channels, q, channels.length).items;
  }, [channels, quickFilter]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const updateSize = () => {
      setViewportWidth(el.clientWidth);
      setViewportHeight(el.clientHeight);
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scrollToNow = useCallback(
    (smooth = true) => {
      const el = scrollRef.current;
      if (!el) return;
      const minutesFromStart = (nowMs - timelineStartMs) / 60_000;
      const nowX = minutesFromStart * pxPerMin;
      const availableTimelineViewport = Math.max(240, el.clientWidth - CHANNEL_COL_WIDTH);
      const targetLeft = Math.max(0, nowX - availableTimelineViewport * 0.28);
      if (typeof el.scrollTo === 'function') {
        el.scrollTo({
          left: targetLeft,
          behavior: smooth ? 'smooth' : 'auto',
        });
      } else {
        el.scrollLeft = targetLeft;
      }
    },
    [nowMs, pxPerMin, timelineStartMs]
  );

  useEffect(() => {
    if (!didInitialCenter.current && viewportWidth > 0) {
      didInitialCenter.current = true;
      scrollToNow(false);
    }
  }, [viewportWidth, scrollToNow]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    setScrollTop(target.scrollTop);
    setScrollLeft(target.scrollLeft);
  };

  const changeZoom = (nextZoom: number) => {
    const clamped = Math.min(8.5, Math.max(2.4, Number(nextZoom.toFixed(1))));
    const el = scrollRef.current;
    if (el) {
      const centerPx = el.scrollLeft + (el.clientWidth - CHANNEL_COL_WIDTH) * 0.35;
      const centerMin = centerPx / pxPerMin;
      setPxPerMin(clamped);
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollLeft = Math.max(
            0,
            centerMin * clamped - (scrollRef.current.clientWidth - CHANNEL_COL_WIDTH) * 0.35
          );
        }
      });
    } else {
      setPxPerMin(clamped);
    }
  };

  const totalRows = filteredChannels.length;
  const totalHeightPx = totalRows * ROW_HEIGHT;
  const startRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS);
  const endRow = Math.min(
    totalRows - 1,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN_ROWS
  );

  const visibleStartMin = Math.max(0, scrollLeft / pxPerMin - 90);
  const visibleEndMin = Math.min(
    totalMinutes,
    (scrollLeft + Math.max(300, viewportWidth - CHANNEL_COL_WIDTH)) / pxPerMin + 90
  );
  const visibleWindowStartMs = timelineStartMs + visibleStartMin * 60_000;
  const visibleWindowEndMs = timelineStartMs + visibleEndMin * 60_000;

  const timeTicks = useMemo(() => {
    const ticks: { ms: number; leftPx: number; label: string }[] = [];
    const stepMs = 30 * 60_000;
    const firstTick = Math.max(
      timelineStartMs,
      Math.floor(visibleWindowStartMs / stepMs) * stepMs
    );
    const fmt = new Intl.DateTimeFormat(bcp47, {
      hour: '2-digit',
      minute: '2-digit',
    });
    for (let tTick = firstTick; tTick <= Math.min(timelineEndMs, visibleWindowEndMs); tTick += stepMs) {
      const leftPx = ((tTick - timelineStartMs) / 60_000) * pxPerMin;
      ticks.push({
        ms: tTick,
        leftPx,
        label: fmt.format(tTick),
      });
    }
    return ticks;
  }, [timelineStartMs, timelineEndMs, visibleWindowStartMs, visibleWindowEndMs, pxPerMin, bcp47]);

  const nowLeftPx = ((nowMs - timelineStartMs) / 60_000) * pxPerMin;
  const fmtClock = (ms: number) =>
    new Intl.DateTimeFormat(bcp47, { hour: '2-digit', minute: '2-digit' }).format(ms);

  const visibleRows: Channel[] = [];
  for (let r = startRow; r <= endRow; r++) {
    const ch = filteredChannels[r];
    if (ch) visibleRows.push(ch);
  }

  return (
    <section
      id="luma-epg-section"
      className={`relative flex min-h-0 flex-1 flex-col overflow-hidden ${
        isM3
          ? 'mx-3 mb-2.5 rounded-[28px] bg-[#161B28]'
          : 'lg-pane mx-2.5 my-2 rounded-[24px]'
      }`}
    >
      {/* EPG Control Strip */}
      <div
        className={`flex h-12 shrink-0 items-center justify-between gap-3 px-4 ${
          isM3
            ? 'border-b border-white/[0.06] bg-[#1A202E]'
            : 'border-b border-white/10 bg-white/[0.03]'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="relative flex items-center">
            <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-slate-400" />
            <input
              id="input-epg-quick-filter"
              type="text"
              value={quickFilter}
              onChange={(e) => setQuickFilter(e.target.value)}
              placeholder={t.epgFilter}
              className={
                isM3
                  ? 'h-8 w-48 rounded-full bg-[#232B3D] pl-8 pr-3 text-xs text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#7FD4FF]/60 sm:w-56'
                  : 'lg-capsule h-8 w-48 rounded-full pl-8 pr-3 text-xs text-white placeholder:text-white/45 focus:outline-none sm:w-56'
              }
            />
          </div>

          <span className="hidden text-[11px] text-slate-300/80 md:inline luma-tabular">
            <strong className="font-semibold text-white">{visibleRows.length}</strong> /{' '}
            {filteredChannels.length.toLocaleString(bcp47)} {t.channelsUnit}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            id="btn-epg-jump-now"
            type="button"
            onClick={() => scrollToNow(true)}
            className={
              isM3
                ? 'm3-primary-pill inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[11px] font-bold'
                : 'lg-pill-active inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium'
            }
          >
            <Crosshair className="h-3.5 w-3.5" />
            <span>{t.epgNow}</span>
          </button>

          <div
            className={
              isM3
                ? 'hidden h-8 items-center gap-2 rounded-full bg-[#232B3D] px-3 sm:flex'
                : 'lg-capsule hidden h-7 items-center gap-2 rounded-full px-2.5 sm:flex'
            }
          >
            <button
              id="btn-epg-zoom-out"
              type="button"
              onClick={() => changeZoom(pxPerMin - 0.8)}
              className="text-slate-300 hover:text-white"
              title="Herauszoomen"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <input
              id="slider-epg-zoom"
              type="range"
              min={2.4}
              max={8.5}
              step={0.2}
              value={pxPerMin}
              onChange={(e) => changeZoom(Number(e.target.value))}
              className="h-1 w-20 cursor-pointer accent-sky-400"
              aria-label="EPG Zeitachsen-Zoom"
            />
            <button
              id="btn-epg-zoom-in"
              type="button"
              onClick={() => changeZoom(pxPerMin + 0.8)}
              className="text-slate-300 hover:text-white"
              title="Hineinzoomen"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Unified 2D Virtualized Viewport */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="luma-scroll relative flex-1 overflow-auto"
      >
        <div
          style={{
            width: `${CHANNEL_COL_WIDTH + timelineWidthPx}px`,
            height: `${HEADER_HEIGHT + totalHeightPx}px`,
          }}
          className="relative"
        >
          {/* Sticky Top Timeline Ruler */}
          <div
            style={{ height: `${HEADER_HEIGHT}px` }}
            className={`sticky top-0 z-30 flex border-b ${
              isM3
                ? 'border-white/[0.07] bg-[#1A202E]'
                : 'border-white/10 bg-[#0D111C]/85 backdrop-blur-2xl'
            }`}
          >
            <div
              style={{ width: `${CHANNEL_COL_WIDTH}px` }}
              className={`sticky left-0 z-40 flex shrink-0 items-center justify-between border-r px-4 text-[11px] font-semibold ${
                isM3
                  ? 'border-white/[0.07] bg-[#1A202E] text-[#C4E8FF]'
                  : 'border-white/10 bg-[#0D111C]/90 text-white/75 backdrop-blur-2xl'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-sky-400" />
                <span>Sender</span>
              </span>
              <span className="text-[10px] opacity-60 luma-tabular">24h EPG</span>
            </div>

            <div
              style={{ width: `${timelineWidthPx}px` }}
              className="relative shrink-0 overflow-hidden"
            >
              {timeTicks.map((tick) => (
                <div
                  key={tick.ms}
                  style={{ left: `${tick.leftPx}px` }}
                  className="absolute top-0 bottom-0 flex items-center border-l border-white/[0.07] pl-2.5 text-[11px] font-medium text-slate-300/80 luma-tabular"
                >
                  {tick.label}
                </div>
              ))}

              {nowLeftPx >= 0 && nowLeftPx <= timelineWidthPx && (
                <div
                  style={{ left: `${nowLeftPx}px` }}
                  className={`pointer-events-none absolute top-1.5 z-20 -translate-x-1/2 rounded-full px-2.5 py-0.5 text-[10px] font-bold luma-tabular ${
                    isM3
                      ? 'bg-[#7FD4FF] text-[#00354A]'
                      : 'bg-sky-300 text-slate-950 shadow-[0_0_16px_rgba(125,211,252,0.8)]'
                  }`}
                >
                  {fmtClock(nowMs)}
                </div>
              )}
            </div>
          </div>

          {/* Live Now-Line */}
          {nowLeftPx >= 0 && nowLeftPx <= timelineWidthPx && (
            <div
              style={{
                left: `${CHANNEL_COL_WIDTH + nowLeftPx}px`,
                top: `${HEADER_HEIGHT}px`,
                height: `${totalHeightPx}px`,
              }}
              className={`pointer-events-none absolute z-10 w-[2px] ${
                isM3
                  ? 'bg-[#7FD4FF]'
                  : 'bg-gradient-to-b from-sky-300 via-sky-400/80 to-indigo-400/60 shadow-[0_0_12px_rgba(56,189,248,0.75)]'
              }`}
            />
          )}

          {/* Virtualized Rows */}
          {visibleRows.map((ch, idx) => {
            const rowIndex = startRow + idx;
            const topPx = HEADER_HEIGHT + rowIndex * ROW_HEIGHT;
            const isSelectedChannel = ch.id === activeChannelId;
            const isFav = favoriteIds.has(ch.id);

            const offsetMs = epgOffsetHours * 3600_000;
            const importedBucket =
              ch.tvgId && xmltvMap ? xmltvMap.get(ch.tvgId) : undefined;
            const programs: EpgProgram[] =
              importedBucket && importedBucket.length > 0
                ? importedBucket
                    .map((p) => ({
                      ...p,
                      startMs: p.startMs + offsetMs,
                      endMs: p.endMs + offsetMs,
                    }))
                    .filter(
                      (p) =>
                        p.endMs > visibleWindowStartMs && p.startMs < visibleWindowEndMs
                    )
                : getChannelProgramsInRange(
                    ch,
                    visibleWindowStartMs,
                    visibleWindowEndMs,
                    nowMs,
                    epgOffsetHours
                  );

            return (
              <div
                key={ch.id}
                style={{
                  top: `${topPx}px`,
                  height: `${ROW_HEIGHT}px`,
                  width: `${CHANNEL_COL_WIDTH + timelineWidthPx}px`,
                }}
                className={`absolute left-0 flex border-b border-white/[0.045] ${
                  isSelectedChannel ? 'bg-sky-400/[0.05]' : ''
                }`}
              >
                {/* Sticky Channel Column */}
                <div
                  style={{ width: `${CHANNEL_COL_WIDTH}px` }}
                  onClick={() => onSelectChannel(ch)}
                  onContextMenu={(e) => {
                    if (!onOpenChannelMenu) return;
                    e.preventDefault();
                    onOpenChannelMenu({ channel: ch, x: e.clientX, y: e.clientY });
                  }}
                  className={`group/ch sticky left-0 z-20 flex shrink-0 cursor-pointer items-center justify-between gap-1.5 border-r px-3 transition ${
                    isM3
                      ? isSelectedChannel
                        ? 'border-white/[0.07] bg-[#232B3D] text-white'
                        : 'border-white/[0.06] bg-[#161B28] text-slate-200 hover:bg-[#1E2536]'
                      : isSelectedChannel
                        ? 'border-white/15 bg-[#161E31]/90 text-white backdrop-blur-xl'
                        : 'border-white/10 bg-[#0B0E17]/85 text-white/85 backdrop-blur-xl hover:bg-[#141A29]/90'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={`w-8 text-right text-[11px] font-bold luma-tabular ${
                        isSelectedChannel ? 'text-[#7FD4FF]' : 'text-slate-400'
                      }`}
                    >
                      {ch.number}
                    </span>

                    <div
                      className={`flex h-9 w-10 shrink-0 items-center justify-center text-[10px] font-bold tracking-tight text-white ${
                        isM3
                          ? 'rounded-[12px] bg-[#29354D]'
                          : 'rounded-[11px] border border-white/15 bg-white/[0.08]'
                      }`}
                    >
                      {ch.shortCode}
                    </div>

                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold">{ch.name}</div>
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                        <span>{ch.resolution}</span>
                        {ch.hasCatchup && (
                          <span className="inline-flex items-center gap-0.5 text-sky-300">
                            · <History className="h-2.5 w-2.5" /> {ch.catchupDays}d
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div
                    className="flex shrink-0 items-center gap-0.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => onToggleFavorite(ch.id)}
                      className="shrink-0 p-1 text-slate-400 hover:text-amber-300"
                      title={t.favorites}
                    >
                      <Star
                        className={`h-3.5 w-3.5 ${
                          isFav ? 'fill-amber-400 text-amber-400' : ''
                        }`}
                      />
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
                        className="shrink-0 rounded-full p-1 text-slate-400 opacity-0 transition group-hover/ch:opacity-100 hover:bg-white/10 hover:text-white"
                        title={t.addToCollectionHeader}
                      >
                        <MoreVertical className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Program Tiles */}
                <div
                  style={{ width: `${timelineWidthPx}px` }}
                  className="relative h-full shrink-0"
                >
                  {programs.map((prog) => {
                    const clampedStart = Math.max(timelineStartMs, prog.startMs);
                    const clampedEnd = Math.min(timelineEndMs, prog.endMs);
                    const leftPx = ((clampedStart - timelineStartMs) / 60_000) * pxPerMin;
                    const widthPx = Math.max(
                      28,
                      ((clampedEnd - clampedStart) / 60_000) * pxPerMin - 4
                    );

                    const isAiringNow = prog.startMs <= nowMs && prog.endMs > nowMs;
                    const isPast = prog.endMs <= nowMs;
                    const liveProgress = isAiringNow
                      ? Math.round(
                          ((nowMs - prog.startMs) / Math.max(1, prog.endMs - prog.startMs)) * 100
                        )
                      : 0;

                    return (
                      <div
                        key={prog.id}
                        style={{
                          left: `${leftPx}px`,
                          width: `${widthPx}px`,
                        }}
                        onClick={() => {
                          if (isAiringNow) {
                            onSelectChannel(ch);
                          } else {
                            setInspected({ channel: ch, program: prog });
                          }
                        }}
                        onDoubleClick={() => {
                          if (isPast && prog.hasCatchup) {
                            onStartTimeshift(ch, prog);
                          } else {
                            onSelectChannel(ch);
                          }
                        }}
                        className={`group absolute top-1 bottom-1 cursor-pointer overflow-hidden px-3 py-1.5 transition ${
                          isM3 ? 'rounded-[16px]' : 'rounded-[13px]'
                        } ${
                          isM3
                            ? isAiringNow && isSelectedChannel
                              ? 'm3-tonal-active ring-1 ring-[#7FD4FF]/60'
                              : isAiringNow
                                ? 'bg-[#263148] text-white hover:bg-[#313F5C]'
                                : isPast
                                  ? 'bg-[#121621] text-slate-400 hover:bg-[#1D2434]'
                                  : 'bg-[#1C2333] text-slate-200 hover:bg-[#252E42]'
                            : isAiringNow && isSelectedChannel
                              ? 'lg-pill-active'
                              : isAiringNow
                                ? 'border border-white/20 bg-white/[0.11] text-white hover:bg-white/[0.16]'
                                : isPast
                                  ? 'border border-white/[0.05] bg-white/[0.03] text-white/55 hover:bg-white/[0.07]'
                                  : 'border border-white/[0.08] bg-white/[0.05] text-white/85 hover:bg-white/[0.10]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="truncate text-xs font-semibold leading-tight">
                            {prog.title}
                          </span>
                          {prog.hasCatchup && isPast && widthPx > 95 && (
                            <History className="h-3 w-3 shrink-0 text-sky-300" />
                          )}
                          {isAiringNow && widthPx > 110 && (
                            <Radio className="h-3 w-3 shrink-0 text-sky-300" />
                          )}
                        </div>

                        {widthPx > 88 && (
                          <div className="mt-0.5 flex items-center gap-1.5 truncate text-[10px] opacity-75 luma-tabular">
                            <span>
                              {fmtClock(prog.startMs)}–{fmtClock(prog.endMs)}
                            </span>
                            {widthPx > 155 && (
                              <>
                                <span>·</span>
                                <span className="truncate">{prog.subtitle}</span>
                              </>
                            )}
                          </div>
                        )}

                        {isAiringNow && (
                          <div className="absolute inset-x-0 bottom-0 h-[2.5px] bg-black/25">
                            <div
                              className={isM3 ? 'h-full bg-[#7FD4FF]' : 'luma-accent-gradient h-full'}
                              style={{ width: `${liveProgress}%` }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Program Inspector Card */}
      {inspected && (
        <div
          className={`absolute right-4 bottom-4 z-40 w-full max-w-md p-4 ${
            isM3
              ? 'rounded-[28px] bg-[#232B3D] shadow-2xl ring-1 ring-white/10'
              : 'lg-modal rounded-[24px]'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[11px] text-sky-300 luma-tabular">
                <span className="font-semibold">{inspected.channel.name}</span>
                <span>·</span>
                <span>
                  {fmtClock(inspected.program.startMs)} – {fmtClock(inspected.program.endMs)}
                </span>
              </div>
              <h3 className="mt-1 text-sm font-semibold text-white">
                {inspected.program.title}
              </h3>
              <p className="text-xs text-slate-300/80">{inspected.program.subtitle}</p>
            </div>
            <button
              type="button"
              onClick={() => setInspected(null)}
              className="rounded-full px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10 hover:text-white"
            >
              ✕
            </button>
          </div>

          <p className="mt-2.5 text-xs leading-relaxed text-slate-200/90">
            {inspected.program.description}
          </p>

          <div className="mt-3.5 flex flex-wrap items-center justify-end gap-2">
            {inspected.program.startMs > nowMs && onToggleReminder && (
              <button
                type="button"
                onClick={() => onToggleReminder(inspected.channel, inspected.program)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  reminderProgramIds?.has(inspected.program.id)
                    ? 'bg-amber-400/20 text-amber-200 ring-1 ring-amber-400/50'
                    : isM3
                      ? 'm3-secondary-tonal'
                      : 'lg-capsule text-white'
                }`}
              >
                {reminderProgramIds?.has(inspected.program.id) ? (
                  <>
                    <BellRing className="h-3.5 w-3.5 text-amber-300" />
                    <span>Erinnerung aktiv</span>
                  </>
                ) : (
                  <>
                    <Bell className="h-3.5 w-3.5" />
                    <span>Erinnern</span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                onSelectChannel(inspected.channel);
                setInspected(null);
              }}
              className={
                isM3
                  ? 'm3-secondary-tonal inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold'
                  : 'lg-capsule inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium text-white'
              }
            >
              <Play className="h-3.5 w-3.5" />
              <span>Live zu {inspected.channel.shortCode}</span>
            </button>

            {inspected.program.hasCatchup && (
              <button
                type="button"
                onClick={() => {
                  onStartTimeshift(inspected.channel, inspected.program);
                  setInspected(null);
                }}
                className={
                  isM3
                    ? 'm3-primary-pill inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold'
                    : 'lg-pill-active inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold'
                }
              >
                <History className="h-3.5 w-3.5" />
                <span>Catch-Up starten</span>
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
