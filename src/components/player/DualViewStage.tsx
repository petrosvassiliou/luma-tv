import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronUp,
  Columns2,
  Expand,
  FolderHeart,
  Layers,
  Maximize2,
  Minimize2,
  Rows2,
  Search,
  Star,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { getCurrentAndNextProgram } from '../../data/mockCatalog';
import { LumaPlayerEngine } from '../../engine/LumaPlayerEngine';
import {
  TRANSLATIONS,
  type LumaLocale,
} from '../../i18n/translations';
import { searchChannelsRanked } from '../../services/channelSearch';
import {
  enterLumaFullscreen,
  exitLumaFullscreen,
  getNativeDomFullscreenElement,
} from '../../services/fullscreenService';
import type {
  Channel,
  CustomBouquet,
  DualViewOrientation,
  EngineProxyConfig,
  PlatformDesignMode,
  StreamTelemetry,
} from '../../types/luma';
import { BroadcastSynthCanvas } from './BroadcastSynthCanvas';

interface DualChannelPaneProps {
  designMode: PlatformDesignMode;
  slotIndex: 0 | 1;
  channel: Channel;
  isAudioActive: boolean;
  globalMuted: boolean;
  fitMode: 'contain' | 'cover';
  hudVisible: boolean;
  proxyConfig: EngineProxyConfig;
  nowMs: number;
  style?: React.CSSProperties;
  onActivateAudio: () => void;
  onToggleSlotMute: () => void;
  onOpenChannelPicker: () => void;
  onZapRelative: (delta: number) => void;
  onExpandSingle: () => void;
  onDoubleClickFullscreen: () => void;
}

const DualChannelPane: React.FC<DualChannelPaneProps> = ({
  designMode,
  slotIndex,
  channel,
  isAudioActive,
  globalMuted,
  fitMode,
  hudVisible,
  proxyConfig,
  nowMs,
  style,
  onActivateAudio,
  onToggleSlotMute,
  onOpenChannelPicker,
  onZapRelative,
  onExpandSingle,
  onDoubleClickFullscreen,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const engineRef = useRef<LumaPlayerEngine | null>(null);
  const [state, setState] = useState<StreamTelemetry['state']>('connecting');

  useEffect(() => {
    const engine = new LumaPlayerEngine((telemetry) => {
      setState(telemetry.state);
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

  const effectiveMuted = !isAudioActive || globalMuted;

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = effectiveMuted;
    }
  }, [effectiveMuted]);

  const { current } = getCurrentAndNextProgram(channel, nowMs);

  return (
    <div
      id={`dualview-pane-${slotIndex + 1}`}
      style={style}
      onClick={onActivateAudio}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement | null)?.closest('button')) return;
        onDoubleClickFullscreen();
      }}
      className="relative flex min-h-0 min-w-0 select-none items-center justify-center overflow-hidden bg-black"
    >
      {state !== 'playing' && (
        <BroadcastSynthCanvas channel={channel} programTitle={current.title} compact />
      )}

      <video
        ref={videoRef}
        playsInline
        autoPlay
        muted={effectiveMuted}
        className={`relative z-10 h-full w-full transition-opacity duration-200 ${
          fitMode === 'cover' ? 'object-cover' : 'object-contain'
        } ${state === 'playing' ? 'opacity-100' : 'opacity-0'}`}
      />

      {/* Subtle audio-focus hairline (only visible while HUD is awake, zero visual clutter when idle) */}
      <div
        className={`pointer-events-none absolute inset-0 z-20 transition-opacity duration-300 ${
          hudVisible && isAudioActive && !globalMuted
            ? isM3
              ? 'ring-2 ring-inset ring-[#7FD4FF]/75'
              : 'ring-1 ring-inset ring-sky-300/75'
            : 'opacity-0'
        }`}
      />

      {/* Ultra-minimal auto-hiding top-left channel pill */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`absolute top-2.5 left-2.5 z-30 flex max-w-[calc(100%-1.25rem)] items-center gap-1 transition-all duration-250 ${
          hudVisible
            ? 'translate-y-0 opacity-100'
            : 'pointer-events-none -translate-y-1.5 opacity-0'
        }`}
      >
        <div
          className={`flex min-w-0 items-center gap-1 rounded-full p-0.5 pr-1.5 shadow-lg backdrop-blur-md ${
            isM3
              ? 'bg-[#131722]/85 ring-1 ring-white/10'
              : 'bg-black/65 ring-1 ring-white/15'
          }`}
        >
          {/* Audio Slot / Mute Toggle */}
          <button
            id={`btn-dual-audio-${slotIndex + 1}`}
            type="button"
            onClick={onToggleSlotMute}
            className={`inline-flex h-6 items-center gap-1 rounded-full px-2 text-[10px] font-bold transition luma-tabular ${
              !effectiveMuted
                ? isM3
                  ? 'bg-[#7FD4FF] text-[#00354A]'
                  : 'bg-sky-400 text-slate-950'
                : 'bg-white/10 text-slate-300 hover:bg-white/20 hover:text-white'
            }`}
            title={
              !effectiveMuted
                ? 'Mute audio'
                : `Activate audio on Stream ${slotIndex + 1}`
            }
          >
            <span>{slotIndex + 1}</span>
            {!effectiveMuted ? (
              <Volume2 className="h-3 w-3" />
            ) : (
              <VolumeX className="h-3 w-3 opacity-80" />
            )}
          </button>

          {/* Channel Name Trigger -> Opens Quick Searchable Channel Picker */}
          <button
            id={`btn-dual-pick-${slotIndex + 1}`}
            type="button"
            onClick={onOpenChannelPicker}
            className="flex min-w-0 items-center gap-1 rounded-full px-2 py-0.5 text-left text-[11px] font-semibold text-white transition hover:bg-white/10"
            title={`${channel.name} — ${current.title}`}
          >
            <span className="max-w-[160px] truncate sm:max-w-[220px]">
              {channel.name}
            </span>
            <ChevronDown className="h-3 w-3 shrink-0 opacity-65" />
          </button>

          {/* Compact Prev / Next Zappers */}
          <button
            type="button"
            onClick={() => onZapRelative(-1)}
            className="rounded-full p-1 text-slate-300 transition hover:bg-white/15 hover:text-white"
            title="Previous channel"
          >
            <ChevronUp className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => onZapRelative(1)}
            className="rounded-full p-1 text-slate-300 transition hover:bg-white/15 hover:text-white"
            title="Next channel"
          >
            <ChevronDown className="h-3 w-3" />
          </button>

          {/* Expand this stream to Single Live TV */}
          <button
            type="button"
            onClick={onExpandSingle}
            className="rounded-full p-1 text-slate-300 transition hover:bg-white/15 hover:text-white"
            title="Open single channel view"
          >
            <Maximize2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
};

interface DualViewStageProps {
  designMode: PlatformDesignMode;
  locale?: LumaLocale;
  channels: Channel[];
  favoriteIds: Set<string>;
  collections: CustomBouquet[];
  slotChannelIds: [string, string];
  activeAudioSlot: 0 | 1;
  globalMuted: boolean;
  isStageFullscreen: boolean;
  favoriteAndCollectionPool?: Channel[];
  onChangeStageFullscreen: (fullscreen: boolean) => void;
  onSelectAudioSlot: (slot: 0 | 1) => void;
  onChangeGlobalMuted: (muted: boolean) => void;
  onChangeSlotChannel: (slot: 0 | 1, channelId: string) => void;
  onSwapSlots: () => void;
  onExpandSingleChannel: (channel: Channel) => void;
  proxyConfig: EngineProxyConfig;
  nowMs: number;
}

export const DualViewStage: React.FC<DualViewStageProps> = ({
  designMode,
  locale = 'de',
  channels,
  favoriteAndCollectionPool,
  favoriteIds,
  collections,
  slotChannelIds,
  activeAudioSlot,
  globalMuted,
  isStageFullscreen,
  onChangeStageFullscreen,
  onSelectAudioSlot,
  onChangeGlobalMuted,
  onChangeSlotChannel,
  onSwapSlots,
  onExpandSingleChannel,
  proxyConfig,
  nowMs,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const t = TRANSLATIONS[locale];

  const containerRef = useRef<HTMLDivElement | null>(null);
  const hudTimerRef = useRef<number | null>(null);

  const [orientation, setOrientation] = useState<DualViewOrientation>('side-by-side');
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('contain');
  const [splitPct, setSplitPct] = useState<number>(50);
  const [isDraggingSplit, setIsDraggingSplit] = useState<boolean>(false);
  const [hudAwake, setHudAwake] = useState<boolean>(true);
  const [hudHovered, setHudHovered] = useState<boolean>(false);

  const [pickerSlot, setPickerSlot] = useState<0 | 1 | null>(null);
  const [pickerScope, setPickerScope] = useState<string>('all'); // 'all' | 'favorites' | bouquetId
  const [pickerQuery, setPickerQuery] = useState<string>('');

  const wakeHud = useCallback(() => {
    setHudAwake(true);
    if (hudTimerRef.current !== null) {
      window.clearTimeout(hudTimerRef.current);
    }
    hudTimerRef.current = window.setTimeout(() => {
      setHudAwake(false);
    }, 2400);
  }, []);

  useEffect(() => {
    hudTimerRef.current = window.setTimeout(() => {
      setHudAwake(false);
    }, 2400);
    return () => {
      if (hudTimerRef.current !== null) {
        window.clearTimeout(hudTimerRef.current);
      }
    };
  }, []);

  // Draggable split divider (supports mouse, Chromebook trackpad, and touch)
  useEffect(() => {
    if (!isDraggingSplit) return;

    const onPointerMove = (e: PointerEvent) => {
      const box = containerRef.current?.getBoundingClientRect();
      if (!box || box.width <= 0 || box.height <= 0) return;
      const rawPct =
        orientation === 'side-by-side'
          ? ((e.clientX - box.left) / box.width) * 100
          : ((e.clientY - box.top) / box.height) * 100;
      const clamped = Math.max(25, Math.min(75, Math.round(rawPct * 2) / 2));
      setSplitPct(clamped);
    };

    const onPointerUp = () => {
      setIsDraggingSplit(false);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [isDraggingSplit, orientation]);

  const resolveChannel = useCallback(
    (channelId: string, fallbackIndex: number): Channel | null => {
      const fromActive = channels.find((c) => c.id === channelId);
      if (fromActive) return fromActive;
      const fromSpecial = favoriteAndCollectionPool?.find((c) => c.id === channelId);
      if (fromSpecial) return fromSpecial;
      if (channels.length === 0) return favoriteAndCollectionPool?.[0] ?? null;
      return channels[fallbackIndex % channels.length] ?? channels[0];
    },
    [channels, favoriteAndCollectionPool]
  );

  const leftChannel = resolveChannel(slotChannelIds[0], 0);
  const rightChannel = resolveChannel(slotChannelIds[1], 1);

  const zapSlotRelative = useCallback(
    (slot: 0 | 1, delta: number) => {
      if (channels.length === 0) return;
      const currentId = slot === 0 ? leftChannel?.id : rightChannel?.id;
      const idx = channels.findIndex((c) => c.id === currentId);
      const nextIdx = idx >= 0 ? (idx + delta + channels.length) % channels.length : 0;
      const nextCh = channels[nextIdx];
      if (nextCh) {
        onChangeSlotChannel(slot, nextCh.id);
      }
    },
    [channels, leftChannel?.id, rightChannel?.id, onChangeSlotChannel]
  );

  const handleToggleFullscreen = useCallback(async () => {
    const active = isStageFullscreen || Boolean(getNativeDomFullscreenElement());
    if (active) {
      onChangeStageFullscreen(false);
      await exitLumaFullscreen();
      return;
    }
    onChangeStageFullscreen(true);
    wakeHud();
    await enterLumaFullscreen(containerRef.current);
  }, [isStageFullscreen, onChangeStageFullscreen, wakeHud]);

  const pickerPool = useMemo(() => {
    const specialPool =
      favoriteAndCollectionPool && favoriteAndCollectionPool.length > 0
        ? favoriteAndCollectionPool
        : channels;
    let base = channels;
    if (pickerScope === 'favorites') {
      base = specialPool.filter((c) => favoriteIds.has(c.id));
    } else if (pickerScope !== 'all') {
      const bq = collections.find((b) => b.id === pickerScope);
      if (bq) {
        const byId = new Map(specialPool.map((c) => [c.id, c]));
        base = bq.channelIds
          .map((id) => byId.get(id))
          .filter((c): c is Channel => Boolean(c));
      }
    }
    if (!pickerQuery.trim()) return base.slice(0, 120);
    return searchChannelsRanked(base, pickerQuery, 120).items;
  }, [
    channels,
    favoriteAndCollectionPool,
    favoriteIds,
    collections,
    pickerScope,
    pickerQuery,
  ]);

  const hudVisible = hudAwake || hudHovered || pickerSlot !== null || isDraggingSplit;

  if (!leftChannel || !rightChannel) {
    return (
      <div className="flex flex-1 items-center justify-center bg-black text-xs text-slate-400">
        0 {t.channelsUnit}
      </div>
    );
  }

  const isSideBySide = orientation === 'side-by-side';

  return (
    <section
      ref={containerRef}
      id="luma-player-stage"
      onPointerMove={wakeHud}
      onTouchStart={wakeHud}
      className={`relative flex h-full w-full flex-1 overflow-hidden bg-black ${
        isSideBySide ? 'flex-row' : 'flex-col'
      }`}
    >
      {/* Stream 1 */}
      <DualChannelPane
        designMode={designMode}
        slotIndex={0}
        channel={leftChannel}
        isAudioActive={activeAudioSlot === 0}
        globalMuted={globalMuted}
        fitMode={fitMode}
        hudVisible={hudVisible}
        proxyConfig={proxyConfig}
        nowMs={nowMs}
        style={
          isSideBySide
            ? { width: `${splitPct}%`, height: '100%' }
            : { height: `${splitPct}%`, width: '100%' }
        }
        onActivateAudio={() => {
          onSelectAudioSlot(0);
          if (globalMuted) onChangeGlobalMuted(false);
          wakeHud();
        }}
        onToggleSlotMute={() => {
          if (activeAudioSlot === 0) {
            onChangeGlobalMuted(!globalMuted);
          } else {
            onSelectAudioSlot(0);
            onChangeGlobalMuted(false);
          }
        }}
        onOpenChannelPicker={() => {
          setPickerSlot(0);
          setPickerQuery('');
        }}
        onZapRelative={(delta) => zapSlotRelative(0, delta)}
        onExpandSingle={() => onExpandSingleChannel(leftChannel)}
        onDoubleClickFullscreen={() => void handleToggleFullscreen()}
      />

      {/* Ultra-Thin 2px Interactive Split Divider (Double-click resets to 50:50) */}
      <div
        role="separator"
        aria-orientation={isSideBySide ? 'vertical' : 'horizontal'}
        onPointerDown={(e) => {
          e.preventDefault();
          setIsDraggingSplit(true);
        }}
        onDoubleClick={() => setSplitPct(50)}
        title="Drag to resize · Double-click for 50:50"
        className={`group relative z-30 shrink-0 touch-none bg-white/[0.12] transition-colors hover:bg-sky-400/70 ${
          isSideBySide
            ? 'h-full w-[2px] cursor-col-resize'
            : 'h-[2px] w-full cursor-row-resize'
        } ${isDraggingSplit ? '!bg-sky-400' : ''}`}
      >
        {/* Invisible wider hit-area so touch/trackpad dragging is effortless without taking visual pixels */}
        <div
          className={
            isSideBySide
              ? 'absolute inset-y-0 -left-2 -right-2'
              : 'absolute inset-x-0 -top-2 -bottom-2'
          }
        />
      </div>

      {/* Stream 2 */}
      <DualChannelPane
        designMode={designMode}
        slotIndex={1}
        channel={rightChannel}
        isAudioActive={activeAudioSlot === 1}
        globalMuted={globalMuted}
        fitMode={fitMode}
        hudVisible={hudVisible}
        proxyConfig={proxyConfig}
        nowMs={nowMs}
        style={
          isSideBySide
            ? { width: `${100 - splitPct}%`, height: '100%' }
            : { height: `${100 - splitPct}%`, width: '100%' }
        }
        onActivateAudio={() => {
          onSelectAudioSlot(1);
          if (globalMuted) onChangeGlobalMuted(false);
          wakeHud();
        }}
        onToggleSlotMute={() => {
          if (activeAudioSlot === 1) {
            onChangeGlobalMuted(!globalMuted);
          } else {
            onSelectAudioSlot(1);
            onChangeGlobalMuted(false);
          }
        }}
        onOpenChannelPicker={() => {
          setPickerSlot(1);
          setPickerQuery('');
        }}
        onZapRelative={(delta) => zapSlotRelative(1, delta)}
        onExpandSingle={() => onExpandSingleChannel(rightChannel)}
        onDoubleClickFullscreen={() => void handleToggleFullscreen()}
      />

      {/* Minimal Auto-Hiding Bottom-Center Micro-Capsule */}
      <div
        onMouseEnter={() => setHudHovered(true)}
        onMouseLeave={() => setHudHovered(false)}
        onClick={(e) => e.stopPropagation()}
        className={`absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full px-2 py-1 shadow-2xl backdrop-blur-md transition-all duration-250 ${
          hudVisible
            ? 'translate-y-0 opacity-100'
            : 'pointer-events-none translate-y-2 opacity-0'
        } ${
          isM3
            ? 'bg-[#131722]/90 ring-1 ring-white/10'
            : 'bg-black/70 ring-1 ring-white/15'
        }`}
      >
        <button
          id="btn-dual-swap"
          type="button"
          onClick={onSwapSlots}
          className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/15 hover:text-white"
          title="Swap channels (S)"
        >
          <ArrowLeftRight className="h-3.5 w-3.5 text-sky-300" />
          <span className="hidden sm:inline">Swap</span>
        </button>

        <button
          id="btn-dual-orientation"
          type="button"
          onClick={() =>
            setOrientation((prev) =>
              prev === 'side-by-side' ? 'stacked' : 'side-by-side'
            )
          }
          className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/15 hover:text-white"
          title={isSideBySide ? 'Stack top & bottom' : 'Side by side'}
        >
          {isSideBySide ? (
            <Rows2 className="h-3.5 w-3.5" />
          ) : (
            <Columns2 className="h-3.5 w-3.5" />
          )}
        </button>

        <button
          id="btn-dual-fit"
          type="button"
          onClick={() =>
            setFitMode((prev) => (prev === 'contain' ? 'cover' : 'contain'))
          }
          className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold text-slate-200 transition hover:bg-white/15 hover:text-white luma-tabular"
          title="Toggle video fit vs zoom fill"
        >
          <Expand className="h-3 w-3" />
          <span>{fitMode === 'contain' ? 'Fit' : 'Fill'}</span>
        </button>

        {splitPct !== 50 && (
          <button
            type="button"
            onClick={() => setSplitPct(50)}
            className="inline-flex h-7 items-center rounded-full bg-sky-400/20 px-2.5 text-[10px] font-bold text-sky-200 transition hover:bg-sky-400/30 luma-tabular"
            title="Reset 50:50 split"
          >
            50:50
          </button>
        )}

        <button
          id="btn-fullscreen"
          type="button"
          onClick={() => void handleToggleFullscreen()}
          aria-pressed={isStageFullscreen}
          className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold transition ${
            isStageFullscreen
              ? isM3
                ? 'bg-[#7FD4FF] text-[#00354A]'
                : 'bg-sky-400 text-slate-950'
              : 'text-slate-200 hover:bg-white/15 hover:text-white'
          }`}
          title={`${t.fullscreen} (F)`}
        >
          {isStageFullscreen ? (
            <Minimize2 className="h-3.5 w-3.5" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Compact Channel Switcher Modal for Slot 1 or Slot 2 */}
      {pickerSlot !== null && (
        <div
          onClick={() => setPickerSlot(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-md"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-md overflow-hidden p-4 ${
              isM3
                ? 'rounded-[26px] bg-[#1E2536] shadow-2xl ring-1 ring-white/10'
                : 'lg-modal rounded-[22px]'
            }`}
          >
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-xs font-semibold text-white">
                Stream #{pickerSlot + 1} · {t.channelListToggle}
              </span>
              <button
                type="button"
                onClick={() => setPickerSlot(null)}
                className="rounded-full px-2 py-0.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Quick Scope Strip: All / Favorites / Collections (Wraps cleanly so all collections remain visible) */}
            <div className="luma-scroll mb-2.5 flex max-h-28 flex-wrap items-center gap-1.5 overflow-y-auto">
              <button
                type="button"
                aria-pressed={pickerScope === 'all'}
                onClick={() => setPickerScope('all')}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  pickerScope === 'all'
                    ? isM3
                      ? 'm3-primary-pill font-bold'
                      : 'lg-pill-active font-bold'
                    : 'bg-white/10 text-slate-300 hover:text-white'
                }`}
              >
                <Layers className="h-3 w-3 shrink-0" />
                <span>{t.allChannels}</span>
              </button>

              <button
                type="button"
                aria-pressed={pickerScope === 'favorites'}
                onClick={() => setPickerScope('favorites')}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  pickerScope === 'favorites'
                    ? isM3
                      ? 'm3-primary-pill font-bold'
                      : 'lg-pill-active font-bold'
                    : 'bg-white/10 text-slate-300 hover:text-white'
                }`}
              >
                <Star className="h-3 w-3 shrink-0 text-amber-300" />
                <span>{t.favorites}</span>
              </button>

              {collections.map((col) => (
                <button
                  key={col.id}
                  type="button"
                  aria-pressed={pickerScope === col.id}
                  onClick={() => setPickerScope(col.id)}
                  title={col.name}
                  className={`inline-flex max-w-full items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                    pickerScope === col.id
                      ? isM3
                        ? 'm3-primary-pill font-bold'
                        : 'lg-pill-active font-bold'
                      : 'bg-white/10 text-slate-300 hover:text-white'
                  }`}
                >
                  <FolderHeart className="h-3 w-3 shrink-0 text-sky-300" />
                  <span className="max-w-[160px] truncate">{col.name}</span>
                </button>
              ))}
            </div>

            <div className="relative mb-2.5 flex items-center">
              <Search className="pointer-events-none absolute left-3.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                autoFocus
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                placeholder={t.epgFilter}
                className={`h-8.5 w-full rounded-full pl-9 pr-4 text-xs text-white focus:outline-none ${
                  isM3 ? 'bg-[#283249]' : 'lg-capsule'
                }`}
              />
            </div>

            <div className="luma-scroll max-h-72 overflow-y-auto space-y-0.5">
              {pickerPool.map((ch) => {
                const isSelected =
                  (pickerSlot === 0 ? leftChannel.id : rightChannel.id) === ch.id;
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => {
                      onChangeSlotChannel(pickerSlot, ch.id);
                      setPickerSlot(null);
                    }}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition ${
                      isM3 ? 'rounded-full' : 'rounded-[12px]'
                    } ${
                      isSelected
                        ? isM3
                          ? 'm3-tonal-active font-semibold'
                          : 'lg-pill-active font-semibold'
                        : 'text-slate-200 hover:bg-white/10'
                    }`}
                  >
                    <div className="min-w-0 truncate">
                      <span className="mr-2 font-mono text-[11px] text-sky-300 luma-tabular">
                        #{ch.number}
                      </span>
                      <span className="font-medium text-white">{ch.name}</span>
                    </div>
                    <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-300">
                      {ch.resolution}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
