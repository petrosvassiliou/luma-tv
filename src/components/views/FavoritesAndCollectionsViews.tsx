import React, { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Download,
  FolderHeart,
  FolderPlus,
  Lock,
  MoreVertical,
  Pencil,
  Play,
  Plus,
  Search,
  Star,
  Trash2,
} from 'lucide-react';
import { getCurrentAndNextProgram } from '../../data/mockCatalog';
import {
  LOCALE_META,
  TRANSLATIONS,
  type LumaLocale,
} from '../../i18n/translations';
import { searchChannelsRanked } from '../../services/channelSearch';
import { exportChannelsToM3uPlus } from '../../workers/parsers';
import type {
  Channel,
  CustomBouquet,
  PlatformDesignMode,
} from '../../types/luma';
import type { ChannelContextMenuTarget } from '../common/ChannelContextMenu';

interface FavoritesViewProps {
  designMode: PlatformDesignMode;
  locale: LumaLocale;
  channels: Channel[];
  favoriteIds: Set<string>;
  activeChannelId: string;
  nowMs: number;
  epgOffsetHours: number;
  onSelectChannel: (channel: Channel) => void;
  onToggleFavorite: (channelId: string) => void;
  onOpenChannelMenu: (target: ChannelContextMenuTarget) => void;
}

export const FavoritesView: React.FC<FavoritesViewProps> = ({
  designMode,
  locale,
  channels,
  favoriteIds,
  activeChannelId,
  nowMs,
  epgOffsetHours,
  onSelectChannel,
  onToggleFavorite,
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

  const filtered = useMemo(() => {
    if (!query.trim()) return favoriteChannels;
    return searchChannelsRanked(favoriteChannels, query, favoriteChannels.length).items;
  }, [favoriteChannels, query]);

  return (
    <div className="luma-scroll flex-1 overflow-y-auto p-5 space-y-4">
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
              {t.favorites} ({favoriteChannels.length.toLocaleString(bcp47)})
            </h2>
            <p className="text-xs text-slate-400">{t.favoritesEmptyHint}</p>
          </div>
        </div>

        {favoriteChannels.length > 0 && (
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

      {favoriteChannels.length === 0 ? (
        <div
          className={`flex flex-col items-center justify-center py-16 text-center ${
            isM3 ? 'rounded-[28px] bg-[#1A202E]' : 'lg-pane rounded-[24px]'
          }`}
        >
          <Star className="h-8 w-8 text-amber-300/60" />
          <p className="mt-3 max-w-md text-xs text-slate-300">{t.favoritesEmptyHint}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((ch) => {
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
                      className={isM3 ? 'h-full bg-[#7FD4FF]' : 'luma-accent-gradient h-full'}
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

interface CollectionsViewProps {
  designMode: PlatformDesignMode;
  locale: LumaLocale;
  channels: Channel[];
  collections: CustomBouquet[];
  activeChannelId: string;
  unlockedGroupIds: Set<string>;
  parentalEnabled: boolean;
  lockedGroupIds: string[];
  nowMs: number;
  epgOffsetHours: number;
  onChangeCollections: (next: CustomBouquet[]) => void;
  onSelectChannel: (channel: Channel) => void;
  onRequestUnlockCollection: (id: string, name: string) => void;
  onOpenChannelMenu: (target: ChannelContextMenuTarget) => void;
}

export const CollectionsView: React.FC<CollectionsViewProps> = ({
  designMode,
  locale,
  channels,
  collections,
  activeChannelId,
  unlockedGroupIds,
  parentalEnabled,
  lockedGroupIds,
  nowMs,
  epgOffsetHours,
  onChangeCollections,
  onSelectChannel,
  onRequestUnlockCollection,
  onOpenChannelMenu,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const t = TRANSLATIONS[locale];
  const panelClass = isM3 ? 'rounded-[26px] bg-[#1A202E] p-4' : 'lg-pane rounded-[22px] p-4';
  const inputClass = isM3
    ? 'h-8.5 rounded-full bg-[#232B3D] px-3.5 text-xs text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#7FD4FF]/60'
    : 'lg-capsule h-8.5 rounded-full px-3.5 text-xs text-white placeholder:text-white/45 focus:outline-none';

  const [selectedId, setSelectedId] = useState<string>(collections[0]?.id ?? '');
  const [newName, setNewName] = useState('');
  const [newPinLocked, setNewPinLocked] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [addSearchOpen, setAddSearchOpen] = useState(false);
  const [addQuery, setAddQuery] = useState('');

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
    const byId = new Map(channels.map((c) => [c.id, c]));
    return activeCollection.channelIds
      .map((id) => byId.get(id))
      .filter((c): c is Channel => Boolean(c));
  }, [activeCollection, channels]);

  const candidateChannels = useMemo(() => {
    if (!addSearchOpen || !activeCollection) return [];
    const existing = new Set(activeCollection.channelIds);
    return searchChannelsRanked(channels, addQuery, 80)
      .items.filter((c) => !existing.has(c.id))
      .slice(0, 36);
  }, [addSearchOpen, activeCollection, channels, addQuery]);

  const handleCreateCollection = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const created: CustomBouquet = {
      id: `col-${Date.now()}`,
      name: trimmed,
      channelIds: [],
      isPinLocked: newPinLocked,
    };
    onChangeCollections([...collections, created]);
    setSelectedId(created.id);
    setNewName('');
    setNewPinLocked(false);
  };

  const updateChannelIds = (nextIds: string[]) => {
    if (!activeCollection) return;
    onChangeCollections(
      collections.map((c) =>
        c.id === activeCollection.id ? { ...c, channelIds: nextIds } : c
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
                  {col.channelIds.length}
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
                    ({collectionChannels.length} {t.channelsUnit})
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
                onClick={() => setAddSearchOpen((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                  addSearchOpen
                    ? isM3
                      ? 'm3-primary-pill'
                      : 'lg-pill-active'
                    : isM3
                      ? 'm3-secondary-tonal'
                      : 'lg-capsule text-white'
                }`}
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Channels</span>
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
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Optional Quick-Add Channel Drawer */}
          {addSearchOpen && (
            <div
              className={`p-3.5 space-y-2.5 ${
                isM3 ? 'rounded-[20px] bg-[#232B3D]' : 'lg-capsule rounded-[18px]'
              }`}
            >
              <div className="relative flex items-center">
                <Search className="pointer-events-none absolute left-3.5 h-3.5 w-3.5 text-slate-400" />
                <input
                  type="text"
                  value={addQuery}
                  onChange={(e) => setAddQuery(e.target.value)}
                  placeholder={t.searchPlaceholder}
                  autoFocus
                  className={`${inputClass} w-full pl-9`}
                />
              </div>
              <div className="luma-scroll flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
                {candidateChannels.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() =>
                      updateChannelIds([...activeCollection.channelIds, c.id])
                    }
                    className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-[11px] text-slate-100 hover:bg-sky-400/25"
                  >
                    <Plus className="h-3 w-3 text-sky-300" />
                    <span>{c.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Channels in Active Collection */}
          {collectionChannels.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400">
              {t.collectionsEmptyHint}
            </div>
          ) : (
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
        </div>
      )}
    </div>
  );
};
