import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarClock,
  FolderHeart,
  Layers,
  Lock,
  MoreVertical,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Star,
} from 'lucide-react';
import {
  LOCALE_META,
  TRANSLATIONS,
  type LumaLocale,
} from '../../i18n/translations';
import { searchChannelsRanked } from '../../services/channelSearch';
import type {
  Channel,
  CustomBouquet,
  PlatformDesignMode,
} from '../../types/luma';
import type { ChannelContextMenuTarget } from '../common/ChannelContextMenu';

interface LiveTvViewProps {
  designMode: PlatformDesignMode;
  locale: LumaLocale;
  channels: Channel[];
  activeGroupLabel: string;
  selectedGroupId?: string;
  collections?: CustomBouquet[];
  onSelectGroup?: (groupId: string) => void;
  activeChannelId: string;
  isOnDemandActive?: boolean;
  favoriteIds: Set<string>;
  onSelectChannel: (channel: Channel) => void;
  onToggleFavorite: (channelId: string) => void;
  onOpenChannelMenu?: (target: ChannelContextMenuTarget) => void;
  onOpenEpgView: () => void;
  isStageFullscreen?: boolean;
  revealDrawerSignal?: number;
  children: React.ReactNode; // Renders the cinema-sized PlayerStage
}

const ROW_HEIGHT = 48;
const OVERSCAN = 10;

export const LiveTvView: React.FC<LiveTvViewProps> = ({
  designMode,
  locale,
  channels,
  activeGroupLabel,
  selectedGroupId = 'all',
  collections = [],
  onSelectGroup,
  activeChannelId,
  isOnDemandActive = false,
  favoriteIds,
  onSelectChannel,
  onToggleFavorite,
  onOpenChannelMenu,
  onOpenEpgView,
  isStageFullscreen = false,
  revealDrawerSignal = 0,
  children,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const t = TRANSLATIONS[locale];
  const bcp47 = LOCALE_META[locale].bcp47;

  const [drawerPref, setDrawerPref] = useState<{
    onDemand: boolean;
    signal: number;
    open: boolean;
  }>({ onDemand: isOnDemandActive, signal: revealDrawerSignal, open: !isOnDemandActive });
  const drawerOpen =
    drawerPref.signal !== revealDrawerSignal
      ? true
      : drawerPref.onDemand === isOnDemandActive
        ? drawerPref.open
        : !isOnDemandActive;
  const setDrawerOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    const resolved = typeof next === 'function' ? next(drawerOpen) : next;
    setDrawerPref({
      onDemand: isOnDemandActive,
      signal: revealDrawerSignal,
      open: resolved,
    });
  };
  const [filterQuery, setFilterQuery] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const listRef = useRef<HTMLDivElement | null>(null);

  const filteredChannels = useMemo(() => {
    if (!filterQuery.trim()) return channels;
    return searchChannelsRanked(channels, filterQuery, channels.length).items;
  }, [channels, filterQuery]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => {
      setViewportHeight(el.clientHeight || 600);
      setScrollTop(el.scrollTop);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [drawerOpen]);

  // Keep active channel scrolled into view when group/collection changes
  useEffect(() => {
    const el = listRef.current;
    if (!el || filterQuery.trim()) return;
    const idx = filteredChannels.findIndex((c) => c.id === activeChannelId);
    if (idx < 0) return;
    const targetTop = idx * ROW_HEIGHT;
    if (
      targetTop < el.scrollTop ||
      targetTop + ROW_HEIGHT > el.scrollTop + el.clientHeight
    ) {
      el.scrollTop = Math.max(0, targetTop - el.clientHeight / 2 + ROW_HEIGHT);
    }
  }, [activeChannelId, filteredChannels, filterQuery, drawerOpen]);

  const isCollectionActive = collections.some((c) => c.id === selectedGroupId);

  const totalHeight = filteredChannels.length * ROW_HEIGHT;
  const clampedScrollTop = Math.min(
    scrollTop,
    Math.max(0, totalHeight - viewportHeight)
  );
  const startIndex = Math.max(
    0,
    Math.floor(clampedScrollTop / ROW_HEIGHT) - OVERSCAN
  );
  const endIndex = Math.min(
    filteredChannels.length - 1,
    Math.ceil((clampedScrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN
  );

  const visibleSlice =
    filteredChannels.length > 0 ? filteredChannels.slice(startIndex, endIndex + 1) : [];

  const handleQuickCollectionToggle = () => {
    setDrawerOpen(true);
    if (!onSelectGroup || collections.length === 0) return;
    if (isCollectionActive) {
      const idx = collections.findIndex((c) => c.id === selectedGroupId);
      const next = collections[(idx + 1) % collections.length];
      if (next) onSelectGroup(next.id);
    } else {
      onSelectGroup(collections[0].id);
    }
  };

  return (
    <div
      className={`relative flex min-h-0 flex-1 overflow-hidden ${
        isStageFullscreen ? 'gap-0 p-0' : 'gap-2.5 p-2.5'
      }`}
    >
      {/* Main Cinema Video Stage */}
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        {children}

        {/* Subtle Top-Right Collections, EPG & Drawer Quick Switcher */}
        {!isStageFullscreen && (
          <div className="absolute top-3.5 right-3.5 z-30 flex items-center gap-1.5">
            {!isOnDemandActive && collections.length > 0 && onSelectGroup && (
              <button
                type="button"
                onClick={handleQuickCollectionToggle}
                className={
                  isM3
                    ? `hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold shadow-md sm:inline-flex ${
                        isCollectionActive ? 'm3-primary-pill' : 'm3-secondary-tonal'
                      }`
                    : `hidden items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium shadow-md sm:inline-flex ${
                        isCollectionActive
                          ? 'lg-pill-active'
                          : 'lg-capsule text-white/90'
                      }`
                }
                title={t.collections}
              >
                <FolderHeart className="h-3.5 w-3.5 text-sky-300" />
                <span>{t.collections}</span>
              </button>
            )}

            {!isOnDemandActive && (
              <button
                type="button"
                onClick={onOpenEpgView}
                className={
                  isM3
                    ? 'm3-secondary-tonal hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold shadow-md sm:inline-flex'
                    : 'lg-capsule hidden items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium text-white/90 shadow-md sm:inline-flex'
                }
                title={t.navLive}
              >
                <CalendarClock className="h-3.5 w-3.5 text-sky-300" />
                <span>EPG</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setDrawerOpen((v) => !v)}
              className={
                isM3
                  ? 'm3-secondary-tonal flex h-8 w-8 items-center justify-center rounded-full shadow-md'
                  : 'lg-capsule flex h-8 w-8 items-center justify-center rounded-full text-white/90 shadow-md'
              }
              title={t.channelListToggle}
            >
              {drawerOpen ? (
                <PanelRightClose className="h-4 w-4" />
              ) : (
                <PanelRightOpen className="h-4 w-4" />
              )}
            </button>
          </div>
        )}
      </div>

      {/* Collapsible Virtualized 54,000+ Channel & Collection Zapper Drawer */}
      {!isStageFullscreen && drawerOpen && (
        <aside
          className={`flex w-72 shrink-0 flex-col overflow-hidden xl:w-80 ${
            isM3
              ? 'rounded-[26px] bg-[#161B28] ring-1 ring-white/[0.06]'
              : 'lg-pane rounded-[22px]'
          }`}
        >
          <div className="border-b border-white/[0.08] p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-semibold text-white">
                {activeGroupLabel}
              </span>
              <span className="shrink-0 text-[11px] text-slate-400 luma-tabular">
                {filteredChannels.length.toLocaleString(bcp47)}
              </span>
            </div>

            {/* Quick Collection & Favorites Switcher Strip inside Live TV (Wraps cleanly so all collections stay visible without horizontal scrolling) */}
            {onSelectGroup && (
              <div className="luma-scroll flex max-h-32 flex-wrap items-center gap-1.5 overflow-y-auto">
                <button
                  type="button"
                  aria-pressed={selectedGroupId === 'all'}
                  onClick={() => {
                    onSelectGroup('all');
                    if (listRef.current) listRef.current.scrollTop = 0;
                  }}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                    selectedGroupId === 'all'
                      ? isM3
                        ? 'm3-primary-pill font-bold shadow-sm'
                        : 'lg-pill-active font-bold'
                      : 'bg-white/[0.07] text-slate-300 ring-1 ring-white/10 hover:bg-white/14 hover:text-white'
                  }`}
                >
                  <Layers className="h-3 w-3 shrink-0" />
                  <span>{t.allChannels}</span>
                </button>

                <button
                  type="button"
                  aria-pressed={selectedGroupId === 'favorites'}
                  onClick={() => {
                    onSelectGroup('favorites');
                    if (listRef.current) listRef.current.scrollTop = 0;
                  }}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                    selectedGroupId === 'favorites'
                      ? isM3
                        ? 'm3-primary-pill font-bold shadow-sm'
                        : 'lg-pill-active font-bold'
                      : 'bg-white/[0.07] text-slate-300 ring-1 ring-white/10 hover:bg-white/14 hover:text-white'
                  }`}
                >
                  <Star
                    className={`h-3 w-3 shrink-0 ${
                      selectedGroupId === 'favorites'
                        ? 'fill-amber-300 text-amber-300'
                        : 'text-amber-300'
                    }`}
                  />
                  <span>{t.favorites}</span>
                </button>

                {collections.map((col) => {
                  const active = selectedGroupId === col.id;
                  return (
                    <button
                      key={col.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        onSelectGroup(col.id);
                        if (listRef.current) listRef.current.scrollTop = 0;
                      }}
                      title={col.name}
                      className={`inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                        active
                          ? isM3
                            ? 'm3-primary-pill font-bold shadow-sm'
                            : 'lg-pill-active font-bold'
                          : 'bg-white/[0.07] text-slate-200 ring-1 ring-white/10 hover:bg-white/14 hover:text-white'
                      }`}
                    >
                      {col.isPinLocked ? (
                        <Lock className="h-3 w-3 shrink-0 text-amber-300" />
                      ) : (
                        <FolderHeart
                          className={`h-3 w-3 shrink-0 ${
                            active && isM3 ? 'text-[#00354A]' : 'text-sky-300'
                          }`}
                        />
                      )}
                      <span className="max-w-[160px] truncate">{col.name}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="relative flex items-center">
              <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={filterQuery}
                onChange={(e) => {
                  setFilterQuery(e.target.value);
                  if (listRef.current) listRef.current.scrollTop = 0;
                }}
                placeholder={t.epgFilter}
                className={
                  isM3
                    ? 'h-8 w-full rounded-full bg-[#232B3D] pl-8 pr-7 text-xs text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#7FD4FF]/60'
                    : 'lg-capsule h-8 w-full rounded-full pl-8 pr-7 text-xs text-white placeholder:text-white/45 focus:outline-none'
                }
              />
              {filterQuery && (
                <button
                  type="button"
                  onClick={() => setFilterQuery('')}
                  className="absolute right-2.5 text-xs text-slate-400 hover:text-white"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          <div
            ref={listRef}
            onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            className="luma-scroll relative flex-1 overflow-y-auto"
          >
            {filteredChannels.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                0 {t.channelsUnit}
              </div>
            ) : (
              <div style={{ height: `${totalHeight}px`, position: 'relative' }}>
                {visibleSlice.map((ch, localIdx) => {
                  const index = startIndex + localIdx;
                  const isActive = ch.id === activeChannelId;
                  const isFav = favoriteIds.has(ch.id);

                  return (
                    <div
                      key={ch.id}
                      style={{
                        position: 'absolute',
                        top: `${index * ROW_HEIGHT}px`,
                        left: '6px',
                        right: '6px',
                        height: `${ROW_HEIGHT - 4}px`,
                      }}
                      onClick={() => onSelectChannel(ch)}
                      onContextMenu={(e) => {
                        if (!onOpenChannelMenu) return;
                        e.preventDefault();
                        onOpenChannelMenu({ channel: ch, x: e.clientX, y: e.clientY });
                      }}
                      className={`group flex cursor-pointer items-center justify-between gap-2 px-3 text-xs transition ${
                        isM3 ? 'rounded-full' : 'rounded-[13px]'
                      } ${
                        isActive
                          ? isM3
                            ? 'm3-tonal-active font-semibold'
                            : 'lg-pill-active font-semibold'
                          : 'text-slate-200 hover:bg-white/[0.06]'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        {isActive ? (
                          <span
                            className="h-2 w-2 shrink-0 rounded-full bg-sky-300 animate-luma-live"
                            aria-hidden="true"
                          />
                        ) : null}
                        <span
                          className={`w-8 shrink-0 font-mono text-[11px] luma-tabular ${
                            isActive ? 'font-bold text-sky-200' : 'opacity-60'
                          }`}
                        >
                          {ch.number}
                        </span>
                        <span className="truncate">{ch.name}</span>
                      </div>

                      <div
                        className="flex shrink-0 items-center gap-0.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {ch.resolution === '4K HDR' && (
                          <span className="mr-1 rounded bg-sky-400/15 px-1.5 py-0.5 text-[9px] font-bold text-sky-300">
                            4K
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => onToggleFavorite(ch.id)}
                          className={`rounded-full p-1 transition ${
                            isFav
                              ? 'text-amber-400'
                              : 'text-slate-500 opacity-0 group-hover:opacity-100 hover:text-amber-300'
                          }`}
                          title={t.favorites}
                        >
                          <Star className={`h-3.5 w-3.5 ${isFav ? 'fill-amber-400' : ''}`} />
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
                            className="rounded-full p-1 text-slate-400 opacity-0 transition group-hover:opacity-100 hover:bg-white/10 hover:text-white"
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
            )}
          </div>
        </aside>
      )}
    </div>
  );
};
