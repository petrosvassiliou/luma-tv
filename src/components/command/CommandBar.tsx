import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Clapperboard,
  CornerDownLeft,
  Film,
  Search,
  Sparkles,
  Tv,
} from 'lucide-react';
import { TRANSLATIONS, type LumaLocale } from '../../i18n/translations';
import {
  searchChannelsRanked,
  searchSeriesRanked,
  searchVodRanked,
} from '../../services/channelSearch';
import type {
  Channel,
  PlatformDesignMode,
  SeriesEpisode,
  SeriesItem,
  VodItem,
} from '../../types/luma';

interface CommandBarProps {
  designMode: PlatformDesignMode;
  isAppleDevice?: boolean;
  locale?: LumaLocale;
  onClose: () => void;
  channels: Channel[];
  vodCatalog: VodItem[];
  seriesCatalog?: SeriesItem[];
  onSelectChannel: (channel: Channel) => void;
  onSelectVod: (vod: VodItem) => void;
  onOpenSeries?: (seriesId: string) => void;
  onSelectSeriesEpisode?: (
    series: SeriesItem,
    seasonNum: number,
    episode: SeriesEpisode
  ) => void;
  onTriggerAction: (
    action: 'dualview' | 'multiview' | 'ambilight' | 'stress20k' | 'toggleDesign'
  ) => void;
}

type SearchScope = 'all' | 'channels' | 'vod' | 'series';

interface SearchHit {
  id: string;
  kind: 'channel' | 'vod' | 'series' | 'action';
  title: string;
  subtitle: string;
  badge: string;
  onExecute: () => void;
}

export const CommandBar: React.FC<CommandBarProps> = ({
  designMode,
  isAppleDevice = false,
  locale = 'de',
  onClose,
  channels,
  vodCatalog,
  seriesCatalog = [],
  onSelectChannel,
  onSelectVod,
  onOpenSeries,
  onSelectSeriesEpisode,
  onTriggerAction,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const t = TRANSLATIONS[locale];
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchScope>('all');
  const [visibleLimit, setVisibleLimit] = useState(80);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const inp = inputRef.current;
      if (!inp) return;
      inp.focus();
      if (document.documentElement.dataset.tv === 'true') {
        inp.dataset.tvEditing = 'true';
        (
          window as unknown as {
            LumaAndroidWindow?: { showTvKeyboard?: () => void };
          }
        ).LumaAndroidWindow?.showTvKeyboard?.();
      }
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const { hits, channelTotal, vodTotal, seriesTotal, hasMore } = useMemo(() => {
    const q = query.trim();
    const chLimit = scope === 'channels' ? visibleLimit : q ? Math.min(visibleLimit, 120) : 20;
    const vodLimit = scope === 'vod' ? visibleLimit : q ? 40 : 6;
    const serLimit = scope === 'series' ? visibleLimit : q ? 40 : 6;

    const chSearch = searchChannelsRanked(channels, q, chLimit);
    const vodSearch = searchVodRanked(vodCatalog, q, vodLimit);
    const serSearch = searchSeriesRanked(seriesCatalog, q, serLimit);

    const results: SearchHit[] = [];

    if (scope === 'all' || scope === 'channels') {
      for (const ch of chSearch.items) {
        results.push({
          id: `ch-${ch.id}`,
          kind: 'channel',
          title: `#${ch.number} · ${ch.name}`,
          subtitle: ch.groupName,
          badge: ch.resolution,
          onExecute: () => {
            onSelectChannel(ch);
            onClose();
          },
        });
      }
    }

    if (scope === 'all' || scope === 'vod') {
      for (const vod of vodSearch.items) {
        results.push({
          id: `vod-${vod.id}`,
          kind: 'vod',
          title: vod.title,
          subtitle: `${vod.genre} · ${vod.year}`,
          badge: `VOD ${vod.resolution}`,
          onExecute: () => {
            onSelectVod(vod);
            onClose();
          },
        });
      }
    }

    if (scope === 'all' || scope === 'series') {
      for (const ser of serSearch.items) {
        const firstEp = ser.seasons[0]?.episodes[0];
        results.push({
          id: `ser-${ser.id}`,
          kind: 'series',
          title: ser.title,
          subtitle: `${ser.genre} · ${ser.year}`,
          badge: ser.badge,
          onExecute: () => {
            if (firstEp && onSelectSeriesEpisode && ser.seasonsLoaded !== false) {
              onSelectSeriesEpisode(ser, ser.seasons[0].seasonNumber, firstEp);
            } else {
              onOpenSeries?.(ser.id);
            }
            onClose();
          },
        });
      }
    }

    if (scope === 'all' && !q) {
      if (isAppleDevice) {
        results.push({
          id: 'act-design',
          kind: 'action',
          title: isM3 ? 'Switch to Apple Liquid Glass' : 'Switch to Material 3 Expressive',
          subtitle: 'Design System',
          badge: 'THEME',
          onExecute: () => {
            onTriggerAction('toggleDesign');
            onClose();
          },
        });
      }
      results.push({
        id: 'act-dualview',
        kind: 'action',
        title: t.navDualview,
        subtitle: '2x Side-by-Side Live Streams',
        badge: '2X',
        onExecute: () => {
          onTriggerAction('dualview');
          onClose();
        },
      });
      results.push({
        id: 'act-multiview',
        kind: 'action',
        title: t.navMultiview,
        subtitle: '4x Simultaneous Streams',
        badge: '4X',
        onExecute: () => {
          onTriggerAction('multiview');
          onClose();
        },
      });
    }

    const totalMatchingInScope =
      scope === 'channels'
        ? chSearch.totalMatches
        : scope === 'vod'
          ? vodSearch.totalMatches
          : scope === 'series'
            ? serSearch.totalMatches
            : chSearch.totalMatches + vodSearch.totalMatches + serSearch.totalMatches;

    return {
      hits: results.slice(0, visibleLimit),
      channelTotal: chSearch.totalMatches,
      vodTotal: vodSearch.totalMatches,
      seriesTotal: serSearch.totalMatches,
      hasMore: Boolean(q) && totalMatchingInScope > visibleLimit,
    };
  }, [
    query,
    scope,
    visibleLimit,
    channels,
    vodCatalog,
    seriesCatalog,
    isM3,
    isAppleDevice,
    t.navDualview,
    t.navMultiview,
    onSelectChannel,
    onSelectVod,
    onOpenSeries,
    onSelectSeriesEpisode,
    onTriggerAction,
    onClose,
  ]);

  const safeSelected = hits.length > 0 ? Math.min(selectedIndex, hits.length - 1) : 0;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      if (document.documentElement.dataset.tv === 'true' && inputRef.current) {
        delete inputRef.current.dataset.tvEditing;
        (
          window as unknown as {
            LumaAndroidWindow?: { hideTvKeyboard?: () => void };
          }
        ).LumaAndroidWindow?.hideTvKeyboard?.();
      }
      setSelectedIndex((prev) => (hits.length ? (prev + 1) % hits.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      setSelectedIndex((prev) => (hits.length ? (prev - 1 + hits.length) % hits.length : 0));
    } else if (e.key === 'Enter' && hits[safeSelected]) {
      e.preventDefault();
      e.stopPropagation();
      hits[safeSelected].onExecute();
    }
  };

  const renderIcon = (kind: SearchHit['kind']) => {
    switch (kind) {
      case 'channel':
        return <Tv className="h-4 w-4 text-sky-300" />;
      case 'vod':
        return <Film className="h-4 w-4 text-indigo-300" />;
      case 'series':
        return <Clapperboard className="h-4 w-4 text-cyan-300" />;
      case 'action':
        return <Sparkles className="h-4 w-4 text-amber-300" />;
    }
  };

  return (
    <div
      id="luma-command-backdrop"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/65 px-4 pt-[8vh] backdrop-blur-md"
    >
      <div
        id="luma-command-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        className={`w-full max-w-2xl overflow-hidden ${
          isM3
            ? 'rounded-[28px] bg-[#1E2536] shadow-2xl ring-1 ring-white/10'
            : 'lg-modal rounded-[26px]'
        }`}
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-3.5">
          <Search className="h-4 w-4 shrink-0 text-sky-300" />
          <input
            ref={inputRef}
            id="input-command-bar"
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setVisibleLimit(80);
              setSelectedIndex(0);
            }}
            placeholder={t.searchPlaceholder}
            className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-400 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setVisibleLimit(80);
                setSelectedIndex(0);
                inputRef.current?.focus();
              }}
              className="rounded-full px-2 py-0.5 text-xs text-slate-400 hover:bg-white/10 hover:text-white"
            >
              ✕
            </button>
          )}
          <kbd className="rounded-full bg-black/35 px-2.5 py-0.5 font-mono text-[10px] text-slate-300">
            ESC
          </kbd>
        </div>

        {/* Scope Filter Pills with Exact Match Counts across all 54k+ items */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-white/[0.07] px-4 py-2 text-[11px]">
          {(
            [
              ['all', `All (${(channelTotal + vodTotal + seriesTotal).toLocaleString()})`],
              ['channels', `${t.channelsUnit} (${channelTotal.toLocaleString()})`],
              ['vod', `VOD (${vodTotal.toLocaleString()})`],
              ['series', `Series (${seriesTotal.toLocaleString()})`],
            ] as [SearchScope, string][]
          ).map(([id, label]) => {
            const active = scope === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setScope(id);
                  setVisibleLimit(100);
                  setSelectedIndex(0);
                }}
                className={`rounded-full px-3 py-1 font-semibold transition luma-tabular ${
                  active
                    ? isM3
                      ? 'm3-primary-pill'
                      : 'lg-pill-active'
                    : 'bg-white/[0.06] text-slate-300 hover:bg-white/12 hover:text-white'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="luma-scroll max-h-[58vh] overflow-y-auto p-2.5 space-y-1">
          {hits.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400">
              0 results for “{query}”.
            </div>
          ) : (
            <>
              {hits.map((hit, idx) => {
                const active = idx === safeSelected;
                return (
                  <button
                    key={hit.id}
                    type="button"
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onClick={hit.onExecute}
                    className={`flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left transition ${
                      isM3 ? 'rounded-full' : 'rounded-[14px]'
                    } ${
                      active
                        ? isM3
                          ? 'm3-tonal-active'
                          : 'lg-pill-active'
                        : 'text-slate-200 hover:bg-white/[0.06]'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div
                        className={`flex h-8 w-8 shrink-0 items-center justify-center ${
                          isM3 ? 'rounded-full bg-[#131722]' : 'rounded-xl bg-white/10'
                        }`}
                      >
                        {renderIcon(hit.kind)}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold text-white">
                          {hit.title}
                        </div>
                        <div className="truncate text-[11px] opacity-75">{hit.subtitle}</div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-medium luma-tabular">
                        {hit.badge}
                      </span>
                      {active && <CornerDownLeft className="h-3.5 w-3.5" />}
                    </div>
                  </button>
                );
              })}

              {hasMore && (
                <button
                  type="button"
                  onClick={() => setVisibleLimit((prev) => prev + 120)}
                  className={`mt-2 w-full py-2 text-center text-xs font-semibold transition ${
                    isM3
                      ? 'rounded-full bg-[#283249] text-[#C4E8FF] hover:bg-[#33405E]'
                      : 'lg-capsule rounded-xl text-sky-200 hover:text-white'
                  }`}
                >
                  Load 120 more results…
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
