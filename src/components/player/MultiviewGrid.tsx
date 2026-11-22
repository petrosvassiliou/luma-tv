import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpLeft,
  Columns2,
  Grid2x2,
  ListVideo,
  Maximize2,
  PanelLeftOpen,
  Search,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { getCurrentAndNextProgram } from '../../data/mockCatalog';
import { LumaPlayerEngine } from '../../engine/LumaPlayerEngine';
import type {
  Channel,
  EngineProxyConfig,
  MultiviewLayoutMode,
  PlatformDesignMode,
  StreamTelemetry,
} from '../../types/luma';
import { BroadcastSynthCanvas } from './BroadcastSynthCanvas';

interface MultiviewTileProps {
  designMode: PlatformDesignMode;
  slotIndex: number;
  channel: Channel;
  isAudioActive: boolean;
  isHeroSlot?: boolean;
  showPromoteHero?: boolean;
  globalMuted: boolean;
  proxyConfig: EngineProxyConfig;
  nowMs: number;
  className?: string;
  onActivateAudio: () => void;
  onOpenPicker: () => void;
  onPromoteToHero?: () => void;
  onExpandToSingle: () => void;
}

const MultiviewTile: React.FC<MultiviewTileProps> = ({
  designMode,
  slotIndex,
  channel,
  isAudioActive,
  showPromoteHero = false,
  globalMuted,
  proxyConfig,
  nowMs,
  className = '',
  onActivateAudio,
  onOpenPicker,
  onPromoteToHero,
  onExpandToSingle,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const engineRef = useRef<LumaPlayerEngine | null>(null);
  const [state, setState] = useState<StreamTelemetry['state']>('connecting');
  const [engineBadge, setEngineBadge] = useState<string>('HLS');

  useEffect(() => {
    const engine = new LumaPlayerEngine((t) => {
      setState(t.state);
      setEngineBadge(t.engine.startsWith('MPEG-TS') ? 'MPEG-TS' : 'HLS');
    });
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    const engine = engineRef.current;
    if (!video || !engine) return;
    engine.load(video, channel.streamUrl, proxyConfig, true, channel.streamType);
  }, [channel.streamUrl, channel.streamType, proxyConfig]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = !isAudioActive || globalMuted;
    }
  }, [isAudioActive, globalMuted]);

  const { current, progressPct } = getCurrentAndNextProgram(channel, nowMs);

  return (
    <div
      id={`multiview-slot-${slotIndex + 1}`}
      onClick={onActivateAudio}
      className={`group relative flex cursor-pointer flex-col overflow-hidden bg-[#0B0E14] transition-all duration-200 ${
        isM3 ? 'rounded-[28px]' : 'rounded-[22px]'
      } ${
        isAudioActive
          ? isM3
            ? 'ring-[3px] ring-[#7FD4FF] shadow-lg'
            : 'ring-2 ring-sky-300 shadow-[0_0_36px_rgba(56,189,248,0.28)]'
          : 'ring-1 ring-white/10 hover:ring-white/25'
      } ${className}`}
    >
      {state !== 'playing' && (
        <BroadcastSynthCanvas channel={channel} programTitle={current.title} compact />
      )}

      <video
        ref={videoRef}
        playsInline
        autoPlay
        muted={!isAudioActive || globalMuted}
        className={`relative z-10 h-full w-full object-cover transition-opacity ${
          state === 'playing' ? 'opacity-100' : 'opacity-0'
        }`}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-16 bg-gradient-to-b from-black/80 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-24 bg-gradient-to-t from-black/90 via-black/45 to-transparent" />

      <div className="absolute inset-x-3.5 top-3 z-20 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold luma-tabular ${
              isAudioActive
                ? isM3
                  ? 'bg-[#7FD4FF] text-[#00354A]'
                  : 'lg-pill-active text-white'
                : 'bg-black/60 text-slate-300 ring-1 ring-white/15'
            }`}
          >
            {slotIndex + 1}
          </span>
          <span
            className={`truncate ${
              isM3
                ? 'rounded-full bg-[#1A202E]/90 px-3 py-1 text-[11px] font-semibold text-white'
                : 'lg-capsule rounded-full px-3 py-1 text-[11px] font-medium text-white'
            }`}
          >
            {channel.name}
          </span>
          <span className="hidden rounded-full bg-black/50 px-2 py-0.5 text-[9px] font-semibold text-sky-300 sm:inline-block">
            {engineBadge}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {showPromoteHero && onPromoteToHero && (
            <button
              type="button"
              onClick={onPromoteToHero}
              className={`flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] text-white opacity-0 transition group-hover:opacity-100 ${
                isM3 ? 'm3-secondary-tonal' : 'lg-capsule'
              }`}
              title="Als großen Haupt-Stream (Slot 1) setzen"
            >
              <ArrowUpLeft className="h-3 w-3" />
              <span className="hidden lg:inline">Fokus</span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenPicker}
            className={`flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] text-white opacity-0 transition group-hover:opacity-100 ${
              isM3 ? 'm3-secondary-tonal' : 'lg-capsule'
            }`}
            title="Kanal für diesen Multiview-Slot auswählen"
          >
            <ListVideo className="h-3.5 w-3.5" />
            <span>Kanal</span>
          </button>

          <button
            type="button"
            onClick={onExpandToSingle}
            className={`flex h-7 w-7 items-center justify-center rounded-full text-white opacity-0 transition group-hover:opacity-100 ${
              isM3 ? 'm3-secondary-tonal' : 'lg-capsule'
            }`}
            title="Im Einzel-Player öffnen"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="absolute inset-x-3.5 bottom-3 z-20 flex items-end justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-white">{current.title}</p>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/15">
            <div
              className={
                isM3 ? 'h-full rounded-full bg-[#7FD4FF]' : 'luma-accent-gradient h-full rounded-full'
              }
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-bold tracking-wide ${
            isAudioActive && !globalMuted
              ? isM3
                ? 'bg-[#7FD4FF] text-[#00354A]'
                : 'lg-pill-active text-white'
              : 'bg-black/60 text-slate-300 ring-1 ring-white/15'
          }`}
        >
          {isAudioActive && !globalMuted ? (
            <>
              <Volume2 className="h-3 w-3" />
              <span>TON AKTIV</span>
            </>
          ) : (
            <>
              <VolumeX className="h-3 w-3" />
              <span>STUMM</span>
            </>
          )}
        </span>
      </div>
    </div>
  );
};

interface MultiviewGridProps {
  designMode: PlatformDesignMode;
  channels: Channel[];
  slotChannelIds: string[];
  activeAudioSlot: number;
  globalMuted: boolean;
  onToggleGlobalMuted: () => void;
  onSelectAudioSlot: (slot: number) => void;
  onChangeSlotChannel: (slot: number, nextChannelId: string) => void;
  onSwapSlots: (slotA: number, slotB: number) => void;
  onExpandChannel: (channel: Channel) => void;
  proxyConfig: EngineProxyConfig;
  nowMs: number;
}

export const MultiviewGrid: React.FC<MultiviewGridProps> = ({
  designMode,
  channels,
  slotChannelIds,
  activeAudioSlot,
  globalMuted,
  onToggleGlobalMuted,
  onSelectAudioSlot,
  onChangeSlotChannel,
  onSwapSlots,
  onExpandChannel,
  proxyConfig,
  nowMs,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const [layoutMode, setLayoutMode] = useState<MultiviewLayoutMode>('quad-2x2');
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const [pickerQuery, setPickerQuery] = useState<string>('');

  const resolveChannel = (id: string, fallbackIndex: number) =>
    channels.find((c) => c.id === id) ?? channels[fallbackIndex % channels.length];

  const pickerCandidates = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    const out: Channel[] = [];
    for (let i = 0; i < channels.length && out.length < 30; i++) {
      const c = channels[i];
      if (
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.groupName.toLowerCase().includes(q) ||
        String(c.number) === q
      ) {
        out.push(c);
      }
    }
    return out;
  }, [channels, pickerQuery]);

  const activeSlots = layoutMode === 'dual-2x1' ? [0, 1] : [0, 1, 2, 3];

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden p-3.5">
      {/* Multiview Header & Bento Layout Switcher */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">
            Luma Multiview · Flexibles Sport-Bento
          </h2>
          <p className="text-xs text-slate-400">
            Tasten{' '}
            <kbd className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[10px] text-sky-300">
              1–4
            </kbd>{' '}
            für sofortigen Tonwechsel · Jeder Slot frei mit HLS- oder MPEG-TS-Kanälen belegbar.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Bento Layout Selector */}
          <div
            className={`flex items-center rounded-full p-1 ${
              isM3 ? 'bg-[#232B3D]' : 'lg-capsule'
            }`}
          >
            <button
              type="button"
              onClick={() => setLayoutMode('quad-2x2')}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                layoutMode === 'quad-2x2'
                  ? isM3
                    ? 'bg-[#7FD4FF] text-[#00354A]'
                    : 'lg-pill-active'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Grid2x2 className="h-3.5 w-3.5" />
              <span>2×2 Quad</span>
            </button>

            <button
              type="button"
              onClick={() => setLayoutMode('focus-1+3')}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                layoutMode === 'focus-1+3'
                  ? isM3
                    ? 'bg-[#7FD4FF] text-[#00354A]'
                    : 'lg-pill-active'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <PanelLeftOpen className="h-3.5 w-3.5" />
              <span>1+3 Fokus</span>
            </button>

            <button
              type="button"
              onClick={() => setLayoutMode('dual-2x1')}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                layoutMode === 'dual-2x1'
                  ? isM3
                    ? 'bg-[#7FD4FF] text-[#00354A]'
                    : 'lg-pill-active'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Columns2 className="h-3.5 w-3.5" />
              <span>2×1 Split</span>
            </button>
          </div>

          <button
            id="btn-multiview-master-audio"
            type="button"
            onClick={onToggleGlobalMuted}
            className={
              isM3
                ? 'm3-primary-pill inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold'
                : 'lg-capsule inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium text-white'
            }
          >
            {globalMuted ? (
              <>
                <VolumeX className="h-4 w-4" />
                <span>Ton einschalten</span>
              </>
            ) : (
              <>
                <Volume2 className="h-4 w-4" />
                <span>Slot #{activeAudioSlot + 1} aktiv</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Bento Grid */}
      <div
        className={
          layoutMode === 'focus-1+3'
            ? 'grid flex-1 grid-cols-1 gap-3 lg:grid-cols-3 lg:grid-rows-3'
            : layoutMode === 'dual-2x1'
              ? 'grid flex-1 grid-cols-1 gap-3 md:grid-cols-2'
              : 'grid flex-1 grid-cols-1 gap-3 md:grid-cols-2 md:grid-rows-2'
        }
      >
        {activeSlots.map((slotIndex) => {
          const ch = resolveChannel(slotChannelIds[slotIndex], slotIndex);
          const focusSpanClass =
            layoutMode === 'focus-1+3' && slotIndex === 0
              ? 'lg:col-span-2 lg:row-span-3'
              : '';

          return (
            <MultiviewTile
              key={slotIndex}
              designMode={designMode}
              slotIndex={slotIndex}
              channel={ch}
              isAudioActive={activeAudioSlot === slotIndex}
              showPromoteHero={layoutMode === 'focus-1+3' && slotIndex > 0}
              globalMuted={globalMuted}
              proxyConfig={proxyConfig}
              nowMs={nowMs}
              className={focusSpanClass}
              onActivateAudio={() => onSelectAudioSlot(slotIndex)}
              onOpenPicker={() => {
                setPickerSlot(slotIndex);
                setPickerQuery('');
              }}
              onPromoteToHero={() => {
                onSwapSlots(0, slotIndex);
                onSelectAudioSlot(0);
              }}
              onExpandToSingle={() => onExpandChannel(ch)}
            />
          );
        })}
      </div>

      {/* Per-Slot Channel Picker Modal */}
      {pickerSlot !== null && (
        <div
          onClick={() => setPickerSlot(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-md"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-md overflow-hidden p-4 ${
              isM3
                ? 'rounded-[28px] bg-[#1E2536] shadow-2xl ring-1 ring-white/10'
                : 'lg-modal rounded-[24px]'
            }`}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">
                Kanal für Multiview Slot #{pickerSlot + 1} wählen
              </h3>
              <button
                type="button"
                onClick={() => setPickerSlot(null)}
                className="rounded-full px-2.5 py-0.5 text-xs text-slate-300 hover:bg-white/10"
              >
                ✕
              </button>
            </div>

            <div className="relative mb-3 flex items-center">
              <Search className="pointer-events-none absolute left-3.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                autoFocus
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                placeholder="Kanalname, Gruppe oder Nummer filtern…"
                className={`h-9 w-full rounded-full pl-9 pr-4 text-xs text-white focus:outline-none ${
                  isM3 ? 'bg-[#283249]' : 'lg-capsule'
                }`}
              />
            </div>

            <div className="luma-scroll max-h-72 overflow-y-auto space-y-1">
              {pickerCandidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    onChangeSlotChannel(pickerSlot, c.id);
                    setPickerSlot(null);
                  }}
                  className={`flex w-full items-center justify-between px-3.5 py-2 text-left text-xs transition ${
                    isM3 ? 'rounded-full hover:bg-[#29354D]' : 'rounded-[14px] hover:bg-white/10'
                  }`}
                >
                  <div className="min-w-0">
                    <span className="mr-2 font-mono text-[11px] text-sky-300 luma-tabular">
                      #{c.number}
                    </span>
                    <span className="font-semibold text-white">{c.name}</span>
                    <span className="ml-2 text-[11px] text-slate-400">({c.groupName})</span>
                  </div>
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-300">
                    {c.resolution}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
