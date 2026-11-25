import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Clapperboard,
  Columns2,
  FolderHeart,
  FolderPlus,
  Play,
  Plus,
  Star,
} from 'lucide-react';
import { TRANSLATIONS, type LumaLocale } from '../../i18n/translations';
import type {
  Channel,
  CustomBouquet,
  PlatformDesignMode,
  SeriesItem,
  VodItem,
} from '../../types/luma';

export interface ChannelContextMenuTarget {
  channel?: Channel;
  vod?: VodItem;
  series?: SeriesItem;
  x: number;
  y: number;
}

interface ChannelContextMenuProps {
  designMode: PlatformDesignMode;
  locale: LumaLocale;
  target: ChannelContextMenuTarget;
  isFavorite: boolean;
  collections: CustomBouquet[];
  onClose: () => void;
  onPlayChannel?: (channel: Channel) => void;
  onOpenDualChannel?: (channel: Channel) => void;
  onPlayVod?: (vod: VodItem) => void;
  onOpenSeries?: (series: SeriesItem) => void;
  onToggleFavorite: () => void;
  onToggleInCollection: (collectionId: string) => void;
  onCreateCollectionWithTarget: (name: string) => void;
}

export const ChannelContextMenu: React.FC<ChannelContextMenuProps> = ({
  designMode,
  locale,
  target,
  isFavorite,
  collections,
  onClose,
  onPlayChannel,
  onOpenDualChannel,
  onPlayVod,
  onOpenSeries,
  onToggleFavorite,
  onToggleInCollection,
  onCreateCollectionWithTarget,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const t = TRANSLATIONS[locale];
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [newCollectionName, setNewCollectionName] = useState('');

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const menuWidth = 268;
  const estimatedHeight = 220 + Math.min(collections.length, 6) * 34;
  const clampedLeft =
    typeof window !== 'undefined'
      ? Math.max(12, Math.min(target.x, window.innerWidth - menuWidth - 12))
      : target.x;
  const clampedTop =
    typeof window !== 'undefined'
      ? Math.max(12, Math.min(target.y, window.innerHeight - estimatedHeight - 12))
      : target.y;

  const handleCreate = () => {
    const trimmed = newCollectionName.trim();
    if (!trimmed) return;
    onCreateCollectionWithTarget(trimmed);
    setNewCollectionName('');
  };

  const title = target.channel
    ? `#${target.channel.number} · ${target.channel.name}`
    : target.vod
      ? target.vod.title
      : target.series?.title ?? '';
  const subtitle = target.channel
    ? target.channel.groupName
    : target.vod
      ? `${target.vod.genre} · ${target.vod.year}`
      : `${target.series?.genre ?? ''} · ${target.series?.year ?? ''}`;

  return (
    <div
      className="fixed inset-0 z-50"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={menuRef}
        style={{ left: `${clampedLeft}px`, top: `${clampedTop}px`, width: `${menuWidth}px` }}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}
        className={`fixed z-50 overflow-hidden p-2 shadow-2xl ${
          isM3
            ? 'rounded-[22px] bg-[#1E2536] ring-1 ring-white/15'
            : 'lg-modal rounded-[20px]'
        }`}
      >
        {/* Header */}
        <div className="border-b border-white/10 px-3 py-2">
          <div className="truncate text-xs font-semibold text-white">{title}</div>
          <div className="truncate text-[10px] text-slate-400">{subtitle}</div>
        </div>

        {/* Primary Actions */}
        <div className="py-1 space-y-0.5">
          {target.channel && onPlayChannel && (
            <button
              type="button"
              onClick={() => {
                onPlayChannel(target.channel!);
                onClose();
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-medium text-slate-100 hover:bg-white/10"
            >
              <Play className="h-3.5 w-3.5 text-sky-300" />
              <span>{t.playNow}</span>
            </button>
          )}

          {target.channel && onOpenDualChannel && (
            <button
              type="button"
              onClick={() => {
                onOpenDualChannel(target.channel!);
                onClose();
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-medium text-slate-100 hover:bg-white/10"
            >
              <Columns2 className="h-3.5 w-3.5 text-sky-300" />
              <span>{t.navDualview}</span>
            </button>
          )}

          {target.vod && onPlayVod && (
            <button
              type="button"
              onClick={() => {
                onPlayVod(target.vod!);
                onClose();
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-medium text-slate-100 hover:bg-white/10"
            >
              <Play className="h-3.5 w-3.5 text-sky-300" />
              <span>{t.playNow}</span>
            </button>
          )}

          {target.series && onOpenSeries && (
            <button
              type="button"
              onClick={() => {
                onOpenSeries(target.series!);
                onClose();
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs font-medium text-slate-100 hover:bg-white/10"
            >
              <Clapperboard className="h-3.5 w-3.5 text-sky-300" />
              <span>{t.seasonsUnit} &amp; {t.episodesUnit}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              onToggleFavorite();
              onClose();
            }}
            className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs font-medium text-slate-100 hover:bg-white/10"
          >
            <span className="flex items-center gap-2.5">
              <Star
                className={`h-3.5 w-3.5 ${
                  isFavorite ? 'fill-amber-400 text-amber-400' : 'text-amber-300'
                }`}
              />
              <span>{isFavorite ? t.removeFromFavorites : t.addToFavorites}</span>
            </span>
            {isFavorite && <Check className="h-3.5 w-3.5 text-amber-300" />}
          </button>
        </div>

        {/* Collections Sublist */}
        <div className="border-t border-white/10 pt-1.5">
          <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            <FolderHeart className="h-3 w-3 text-sky-300" />
            <span>{t.addToCollectionHeader}</span>
          </div>

          {collections.length > 0 && (
            <div className="luma-scroll max-h-44 overflow-y-auto py-0.5 space-y-0.5">
              {collections.map((col) => {
                const inCollection = target.channel
                  ? col.channelIds.includes(target.channel.id)
                  : target.vod
                    ? Boolean(col.vodIds?.includes(target.vod.id))
                    : target.series
                      ? Boolean(col.seriesIds?.includes(target.series.id))
                      : false;
                return (
                  <button
                    key={col.id}
                    type="button"
                    onClick={() => onToggleInCollection(col.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-left text-xs transition ${
                      inCollection
                        ? 'bg-sky-400/15 font-semibold text-sky-200'
                        : 'text-slate-200 hover:bg-white/10'
                    }`}
                  >
                    <span className="truncate">{col.name}</span>
                    {inCollection ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-sky-300" />
                    ) : (
                      <Plus className="h-3.5 w-3.5 shrink-0 opacity-50" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Quick Create Collection Input */}
          <div className="mt-1 flex items-center gap-1.5 px-1.5 pt-1">
            <div className="relative flex-1">
              <FolderPlus className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCreate();
                  }
                }}
                placeholder={t.newCollectionPlaceholder}
                className={
                  isM3
                    ? 'h-7.5 w-full rounded-full bg-[#283249] pl-8 pr-2.5 text-[11px] text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#7FD4FF]/60'
                    : 'lg-capsule h-7.5 w-full rounded-full pl-8 pr-2.5 text-[11px] text-white placeholder:text-white/45 focus:outline-none'
                }
              />
            </div>
            <button
              type="button"
              disabled={!newCollectionName.trim()}
              onClick={handleCreate}
              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold disabled:opacity-40 ${
                isM3 ? 'm3-primary-pill' : 'lg-pill-active'
              }`}
            >
              +
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
