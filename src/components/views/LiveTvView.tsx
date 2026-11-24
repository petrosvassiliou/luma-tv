import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarClock,
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
import type { Channel, PlatformDesignMode } from '../../types/luma';
import type { ChannelContextMenuTarget } from '../common/ChannelContextMenu';

interface LiveTvViewProps {
  designMode: PlatformDesignMode;
  locale: LumaLocale;
  channels: Channel[];
  activeGroupLabel: string;
  activeChannelId: string;
  favoriteIds: Set<string>;
  onSelectChannel: (channel: Channel) => void;
  onToggleFavorite: (channelId: string) => void;
  onOpenChannelMenu?: (target: ChannelContextMenuTarget) => void;
  onOpenEpgView: () => void;
  children: React.ReactNode; // Renders the cinema-sized PlayerStage
}

const ROW_HEIGHT = 48;
const OVERSCAN = 10;

export const LiveTvView: React.FC<LiveTvViewProps> = ({
  designMode,
  locale,
  channels,
  activeGroupLabel,
  activeChannelId,
  favoriteIds,
  onSelectChannel,
  onToggleFavorite,
  onOpenChannelMenu,
  onOpenEpgView,
  children,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const t = TRANSLATIONS[locale];
  const bcp47 = LOCALE_META[locale].bcp47;

  const [drawerOpen, setDrawerOpen] = useState(true);
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
    const measure = () => setViewportHeight(el.clientHeight || 600);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [drawerOpen]);

  // Keep active channel scrolled into view when group changes
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
  }, [activeChannelId, filteredChannels, filterQuery]);

  const totalHeight = filteredChannels.length * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(
    filteredChannels.length - 1,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN
  );

  const visibleSlice =
    filteredChannels.length > 0 ? filteredChannels.slice(startIndex, endIndex + 1) : [];

  return (
    <div className="relative flex min-h-0 flex-1 gap-2.5 overflow-hidden p-2.5">
      {/* Main Cinema Video Stage */}
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        {children}

        {/* Subtle Top-Right Drawer & EPG Quick Switcher */}
        <div className="absolute top-3.5 right-3.5 z-30 flex items-center gap-1.5">
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
      </div>

      {/* Collapsible Virtualized 54,000+ Channel Zapper Drawer */}
      {drawerOpen && (
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
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="w-8 shrink-0 font-mono text-[11px] opacity-60 luma-tabular">
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
          </div>
        </aside>
      )}
    </div>
  );
};
