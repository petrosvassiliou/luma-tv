import React, { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Download,
  FolderPlus,
  GripVertical,
  Lock,
  LockOpen,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { searchChannelsRanked } from '../../services/channelSearch';
import { exportChannelsToM3uPlus } from '../../workers/parsers';
import type {
  Channel,
  ChannelGroup,
  CustomBouquet,
  ParentalControlConfig,
  PlatformDesignMode,
} from '../../types/luma';

interface ChannelStudioViewProps {
  designMode: PlatformDesignMode;
  channels: Channel[];
  groups: ChannelGroup[];
  customBouquets: CustomBouquet[];
  onChangeCustomBouquets: (next: CustomBouquet[]) => void;
  parentalConfig: ParentalControlConfig;
  onChangeParentalConfig: (next: ParentalControlConfig) => void;
}

export const ChannelStudioView: React.FC<ChannelStudioViewProps> = ({
  designMode,
  channels,
  groups,
  customBouquets,
  onChangeCustomBouquets,
  parentalConfig,
  onChangeParentalConfig,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const panelClass = isM3 ? 'rounded-[28px] bg-[#1A202E] p-5' : 'lg-pane rounded-[24px] p-5';
  const inputClass = isM3
    ? 'h-9 rounded-full bg-[#232B3D] px-4 text-xs text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#7FD4FF]/60'
    : 'lg-capsule h-9 rounded-full px-4 text-xs text-white placeholder:text-white/45 focus:outline-none';

  const [newBouquetName, setNewBouquetName] = useState('');
  const [newBouquetPinLocked, setNewBouquetPinLocked] = useState(false);
  const [selectedBouquetId, setSelectedBouquetId] = useState<string>(
    customBouquets[0]?.id ?? ''
  );
  const [channelSearch, setChannelSearch] = useState('');
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [newPin, setNewPin] = useState(parentalConfig.pin);

  const activeBouquet =
    customBouquets.find((b) => b.id === selectedBouquetId) ?? customBouquets[0] ?? null;

  const bouquetChannels: Channel[] = useMemo(() => {
    if (!activeBouquet) return [];
    const byId = new Map(channels.map((c) => [c.id, c]));
    return activeBouquet.channelIds
      .map((id) => byId.get(id))
      .filter((c): c is Channel => Boolean(c));
  }, [activeBouquet, channels]);

  const candidateChannels = useMemo(() => {
    const existing = new Set(activeBouquet?.channelIds ?? []);
    const matched = searchChannelsRanked(channels, channelSearch, 120).items;
    return matched.filter((ch) => !existing.has(ch.id)).slice(0, 48);
  }, [channels, channelSearch, activeBouquet]);

  const handleCreateBouquet = () => {
    const trimmed = newBouquetName.trim();
    if (!trimmed) return;
    const created: CustomBouquet = {
      id: `bq-${Date.now()}`,
      name: trimmed,
      channelIds: channels.slice(0, 3).map((c) => c.id),
      isPinLocked: newBouquetPinLocked,
    };
    const next = [...customBouquets, created];
    onChangeCustomBouquets(next);
    setSelectedBouquetId(created.id);
    setNewBouquetName('');
    setNewBouquetPinLocked(false);
  };

  const updateActiveBouquetChannels = (nextIds: string[]) => {
    if (!activeBouquet) return;
    onChangeCustomBouquets(
      customBouquets.map((b) =>
        b.id === activeBouquet.id ? { ...b, channelIds: nextIds } : b
      )
    );
  };

  const moveChannelInBouquet = (fromIdx: number, toIdx: number) => {
    if (!activeBouquet) return;
    if (toIdx < 0 || toIdx >= activeBouquet.channelIds.length) return;
    const copy = [...activeBouquet.channelIds];
    const [moved] = copy.splice(fromIdx, 1);
    copy.splice(toIdx, 0, moved);
    updateActiveBouquetChannels(copy);
  };

  const exportBouquetM3u = () => {
    if (!activeBouquet) return;
    const m3u = exportChannelsToM3uPlus(activeBouquet.name, bouquetChannels);
    const blob = new Blob([m3u], { type: 'audio/x-mpegurl;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeBouquet.name.toLowerCase().replace(/\s+/g, '-')}.m3u8`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleGroupPinLock = (groupId: string) => {
    const set = new Set(parentalConfig.lockedGroupIds);
    if (set.has(groupId)) set.delete(groupId);
    else set.add(groupId);
    onChangeParentalConfig({
      ...parentalConfig,
      lockedGroupIds: Array.from(set),
    });
  };

  return (
    <div className="luma-scroll flex-1 overflow-y-auto p-5 space-y-5">
      <div>
        <h2 className="text-base font-semibold text-white">
          TiviMate Pro Channel Studio · Eigene Bouquets, Drag &amp; Drop &amp; Jugendschutz-PIN
        </h2>
        <p className="text-xs text-slate-400">
          Erstelle eigene Favoriten-Bouquets, sortiere Kanäle per Drag-and-Drop, exportiere M3U_Plus-Listen und schütze Gruppen per 4-stelliger PIN.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Column 1: Custom Bouquets List & Creator */}
        <div className={`${panelClass} space-y-3.5`}>
          <div className="flex items-center gap-2 text-xs font-semibold text-white">
            <FolderPlus className="h-4 w-4 text-sky-400" />
            <span>Eigene Bouquets ({customBouquets.length})</span>
          </div>

          <div className="space-y-2">
            <input
              type="text"
              value={newBouquetName}
              onChange={(e) => setNewBouquetName(e.target.value)}
              placeholder="Neues Bouquet (z.B. Samstag Sport)"
              className={`${inputClass} w-full`}
            />
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={newBouquetPinLocked}
                  onChange={(e) => setNewBouquetPinLocked(e.target.checked)}
                  className="h-4 w-4 accent-sky-400"
                />
                <span>Mit PIN sperren</span>
              </label>

              <button
                type="button"
                onClick={handleCreateBouquet}
                className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold ${
                  isM3 ? 'm3-primary-pill' : 'lg-pill-active'
                }`}
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Anlegen</span>
              </button>
            </div>
          </div>

          <div className="space-y-1.5 pt-1">
            {customBouquets.map((bq) => {
              const isSelected = activeBouquet?.id === bq.id;
              return (
                <div
                  key={bq.id}
                  onClick={() => setSelectedBouquetId(bq.id)}
                  className={`flex cursor-pointer items-center justify-between px-3.5 py-2.5 text-xs transition ${
                    isM3 ? 'rounded-full' : 'rounded-[16px]'
                  } ${
                    isSelected
                      ? isM3
                        ? 'm3-tonal-active font-semibold'
                        : 'lg-pill-active'
                      : isM3
                        ? 'bg-[#232B3D] hover:bg-[#2E384F]'
                        : 'lg-capsule'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    {bq.isPinLocked && <Lock className="h-3.5 w-3.5 text-amber-300" />}
                    <span className="truncate">{bq.name}</span>
                  </span>

                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <span className="text-[11px] opacity-75 luma-tabular">
                      {bq.channelIds.length}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        onChangeCustomBouquets(customBouquets.filter((x) => x.id !== bq.id))
                      }
                      className="rounded-full p-1 text-slate-300 hover:bg-rose-500/25 hover:text-rose-200"
                      title="Bouquet löschen"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Column 2: Drag-and-Drop Bouquet Channel Order + M3U Export */}
        <div className={`${panelClass} lg:col-span-2 space-y-3.5`}>
          {activeBouquet ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold text-white">
                    Drag &amp; Drop Sortierung: „{activeBouquet.name}“
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Ziehe Kanäle per Maus/Touch an die gewünschte Position oder nutze die Pfeile.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={exportBouquetM3u}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                    isM3 ? 'm3-secondary-tonal' : 'lg-capsule text-sky-200'
                  }`}
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Als .m3u8 exportieren</span>
                </button>
              </div>

              <div className="space-y-1.5">
                {bouquetChannels.map((ch, idx) => (
                  <div
                    key={ch.id}
                    draggable
                    onDragStart={() => setDragIndex(idx)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragIndex !== null && dragIndex !== idx) {
                        moveChannelInBouquet(dragIndex, idx);
                      }
                      setDragIndex(null);
                    }}
                    className={`flex cursor-grab items-center justify-between gap-2 px-3.5 py-2 active:cursor-grabbing ${
                      isM3 ? 'rounded-full bg-[#232B3D]' : 'lg-capsule rounded-[15px]'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <GripVertical className="h-4 w-4 shrink-0 text-slate-400" />
                      <span className="w-6 font-mono text-[11px] text-sky-300 luma-tabular">
                        {idx + 1}.
                      </span>
                      <span className="truncate text-xs font-semibold text-white">
                        {ch.name}
                      </span>
                      <span className="hidden text-[10px] text-slate-400 sm:inline">
                        ({ch.resolution})
                      </span>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => moveChannelInBouquet(idx, idx - 1)}
                        className="rounded-full p-1 text-slate-300 hover:bg-white/10"
                        title="Nach oben"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveChannelInBouquet(idx, idx + 1)}
                        className="rounded-full p-1 text-slate-300 hover:bg-white/10"
                        title="Nach unten"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateActiveBouquetChannels(
                            activeBouquet.channelIds.filter((id) => id !== ch.id)
                          )
                        }
                        className="rounded-full p-1 text-slate-300 hover:bg-rose-500/25 hover:text-rose-200"
                        title="Aus Bouquet entfernen"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Add Channels to Active Bouquet */}
              <div className="border-t border-white/10 pt-3 space-y-2">
                <div className="relative flex items-center">
                  <Search className="pointer-events-none absolute left-3.5 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    value={channelSearch}
                    onChange={(e) => setChannelSearch(e.target.value)}
                    placeholder="Weitere Kanäle zum Bouquet hinzufügen…"
                    className={`${inputClass} w-full pl-9`}
                  />
                </div>

                <div className="luma-scroll flex max-h-48 flex-wrap gap-1.5 overflow-y-auto pr-1">
                  {candidateChannels.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() =>
                        updateActiveBouquetChannels([...activeBouquet.channelIds, c.id])
                      }
                      className="inline-flex items-center gap-1 rounded-full bg-white/[0.07] px-3 py-1 text-[11px] text-slate-200 hover:bg-sky-400/20 hover:text-white"
                    >
                      <Plus className="h-3 w-3 text-sky-300" />
                      <span>{c.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="py-10 text-center text-xs text-slate-400">
              Erstelle links dein erstes eigenes Bouquet.
            </div>
          )}
        </div>
      </div>

      {/* Parental Control PIN Lock Center */}
      <div className={`${panelClass} space-y-3.5`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-white">
            <ShieldAlert className="h-4 w-4 text-amber-300" />
            <span>Jugendschutz &amp; PIN-Sperre (TiviMate Parental Lock)</span>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={parentalConfig.enabled}
                onChange={(e) =>
                  onChangeParentalConfig({
                    ...parentalConfig,
                    enabled: e.target.checked,
                  })
                }
                className="h-4 w-4 accent-sky-400"
              />
              <span>PIN-Schutz aktiv</span>
            </label>

            <input
              type="password"
              maxLength={4}
              value={newPin}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
                setNewPin(digits);
                if (digits.length === 4) {
                  onChangeParentalConfig({ ...parentalConfig, pin: digits });
                }
              }}
              placeholder="4-stellige PIN"
              className={`${inputClass} w-28 text-center font-mono luma-tabular`}
            />
          </div>
        </div>

        <p className="text-[11px] text-slate-400">
          Klicke auf eine Gruppe, um sie mit deiner 4-stelligen PIN (aktuell:{' '}
          <code className="text-sky-300">••••</code>) vor unbefugtem Zugriff in der Sidebar zu sperren.
        </p>

        <div className="flex flex-wrap gap-2">
          {groups.map((g) => {
            const locked = parentalConfig.lockedGroupIds.includes(g.id);
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => toggleGroupPinLock(g.id)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  locked
                    ? 'bg-amber-400/20 text-amber-200 ring-1 ring-amber-400/50'
                    : 'bg-white/[0.06] text-slate-300 hover:bg-white/10'
                }`}
              >
                {locked ? (
                  <Lock className="h-3.5 w-3.5 text-amber-300" />
                ) : (
                  <LockOpen className="h-3.5 w-3.5 text-slate-400" />
                )}
                <span>{g.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

interface ParentalPinModalProps {
  designMode: PlatformDesignMode;
  expectedPin: string;
  groupName: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export const ParentalPinModal: React.FC<ParentalPinModalProps> = ({
  designMode,
  expectedPin,
  groupName,
  onSuccess,
  onCancel,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const [entered, setEntered] = useState('');
  const [error, setError] = useState(false);

  const pushDigit = (d: string) => {
    const next = (entered + d).slice(0, 4);
    setEntered(next);
    setError(false);
    if (next.length === 4) {
      if (next === expectedPin) {
        onSuccess();
      } else {
        setError(true);
        setEntered('');
      }
    }
  };

  return (
    <div
      onClick={onCancel}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-md"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-xs p-5 text-center ${
          isM3
            ? 'rounded-[28px] bg-[#1E2536] shadow-2xl ring-1 ring-white/10'
            : 'lg-modal rounded-[26px]'
        }`}
      >
        <Lock className="mx-auto h-6 w-6 text-amber-300" />
        <h3 className="mt-2 text-sm font-semibold text-white">PIN-geschützte Gruppe</h3>
        <p className="mt-0.5 text-xs text-slate-400">
          Bitte 4-stellige PIN für „{groupName}“ eingeben
        </p>

        <div className="my-4 flex justify-center gap-2.5">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={`flex h-10 w-10 items-center justify-center rounded-2xl border text-lg font-bold ${
                error
                  ? 'border-rose-400 bg-rose-500/20 text-rose-200'
                  : entered.length > i
                    ? 'border-sky-400 bg-sky-400/20 text-white'
                    : 'border-white/15 bg-black/30 text-slate-500'
              }`}
            >
              {entered.length > i ? '•' : ''}
            </span>
          ))}
        </div>

        {error && (
          <div className="mb-3 text-xs font-medium text-rose-300">
            Falsche PIN — bitte erneut versuchen.
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '✕'].map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                if (key === 'C') setEntered('');
                else if (key === '✕') onCancel();
                else pushDigit(key);
              }}
              className={`h-11 text-sm font-semibold transition ${
                isM3
                  ? 'rounded-full bg-[#283249] text-white hover:bg-[#7FD4FF] hover:text-[#00354A]'
                  : 'lg-capsule rounded-2xl text-white'
              }`}
            >
              {key}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
