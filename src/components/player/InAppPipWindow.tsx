import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  GripHorizontal,
  Maximize2,
  Minus,
  PictureInPicture2,
  Plus,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { getCurrentAndNextProgram } from '../../data/mockCatalog';
import { LumaPlayerEngine } from '../../engine/LumaPlayerEngine';
import type {
  Channel,
  EngineProxyConfig,
  PlatformDesignMode,
  StreamTelemetry,
} from '../../types/luma';
import { BroadcastSynthCanvas } from './BroadcastSynthCanvas';

interface InAppPipWindowProps {
  designMode: PlatformDesignMode;
  channel: Channel;
  overrideTitle?: string;
  overrideStreamUrl?: string;
  isMuted: boolean;
  volume: number;
  onChangeMuted: (muted: boolean) => void;
  proxyConfig: EngineProxyConfig;
  nowMs: number;
  onPrevChannel: () => void;
  onNextChannel: () => void;
  onRestoreStage: () => void;
  onClose: () => void;
}

const MIN_PIP_WIDTH = 260;
const DEFAULT_PIP_WIDTH = 384;
const PIP_SIZE_STORAGE_KEY = 'luma.pip.size.v1';

function clampPipWidth(width: number): number {
  const maxAllowed =
    typeof window !== 'undefined'
      ? Math.max(MIN_PIP_WIDTH, Math.min(920, window.innerWidth - 32))
      : 920;
  return Math.round(Math.max(MIN_PIP_WIDTH, Math.min(maxAllowed, width)));
}

export const InAppPipWindow: React.FC<InAppPipWindowProps> = ({
  designMode,
  channel,
  overrideTitle,
  overrideStreamUrl,
  isMuted,
  volume,
  onChangeMuted,
  proxyConfig,
  nowMs,
  onPrevChannel,
  onNextChannel,
  onRestoreStage,
  onClose,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const engineRef = useRef<LumaPlayerEngine | null>(null);

  const [state, setState] = useState<StreamTelemetry['state']>('connecting');
  const [widthPx, setWidthPx] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(PIP_SIZE_STORAGE_KEY);
      if (raw) {
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed >= MIN_PIP_WIDTH) {
          return clampPipWidth(parsed);
        }
      }
    } catch {
      // Ignore
    }
    return DEFAULT_PIP_WIDTH;
  });

  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragOrigin = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const resizeOrigin = useRef<{
    edge: 'nw' | 'ne' | 'sw' | 'se' | 'w' | 'e';
    startX: number;
    origWidth: number;
    origOffsetX: number;
  } | null>(null);

  const activeUrl = overrideStreamUrl ?? channel.streamUrl;

  const persistWidth = (next: number) => {
    const clamped = clampPipWidth(next);
    setWidthPx(clamped);
    try {
      localStorage.setItem(PIP_SIZE_STORAGE_KEY, String(clamped));
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    const engine = new LumaPlayerEngine((t) => {
      setState(t.state);
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
    video.muted = isMuted;
    video.volume = volume;
    engine.load(
      video,
      activeUrl,
      proxyConfig,
      true,
      overrideStreamUrl ? undefined : channel.streamType
    );
    // Keep audio state synchronized across loads without re-reloading on mute toggle
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUrl, channel.streamType, overrideStreamUrl, proxyConfig]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = isMuted;
      videoRef.current.volume = volume;
    }
  }, [isMuted, volume]);

  const handleDragPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragOrigin.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: offset.x,
      origY: offset.y,
    };
  };

  const handleDragPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragOrigin.current) return;
    const dx = e.clientX - dragOrigin.current.startX;
    const dy = e.clientY - dragOrigin.current.startY;
    setOffset({
      x: dragOrigin.current.origX + dx,
      y: dragOrigin.current.origY + dy,
    });
  };

  const handleDragPointerUp = () => {
    dragOrigin.current = null;
  };

  const startResize =
    (edge: 'nw' | 'ne' | 'sw' | 'se' | 'w' | 'e') =>
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      resizeOrigin.current = {
        edge,
        startX: e.clientX,
        origWidth: widthPx,
        origOffsetX: offset.x,
      };
    };

  const moveResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const origin = resizeOrigin.current;
    if (!origin) return;
    const dx = e.clientX - origin.startX;
    const growsLeft =
      origin.edge === 'nw' || origin.edge === 'sw' || origin.edge === 'w';

    if (growsLeft) {
      // Window is anchored bottom-right (`right-5 bottom-5`), so widening left needs no offset shift!
      const nextW = clampPipWidth(origin.origWidth - dx);
      setWidthPx(nextW);
    } else {
      // Dragging the right edge shifts both width and horizontal offset so the left edge stays pinned
      const nextW = clampPipWidth(origin.origWidth + dx);
      const actualDelta = nextW - origin.origWidth;
      setWidthPx(nextW);
      setOffset((prev) => ({ ...prev, x: origin.origOffsetX + actualDelta }));
    }
  };

  const endResize = () => {
    if (resizeOrigin.current) {
      try {
        localStorage.setItem(PIP_SIZE_STORAGE_KEY, String(widthPx));
      } catch {
        // Ignore
      }
      resizeOrigin.current = null;
    }
  };

  const triggerOsPip = async () => {
    const video = videoRef.current;
    if (!video || !document.pictureInPictureEnabled) return;
    try {
      await video.requestPictureInPicture();
    } catch {
      // Ignore
    }
  };

  const { current, progressPct } = getCurrentAndNextProgram(channel, nowMs);
  const title = overrideTitle ?? current.title;
  const isOnDemand = Boolean(overrideStreamUrl && overrideTitle);

  return (
    <div
      id="luma-inapp-pip"
      style={{
        width: `${widthPx}px`,
        transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
      }}
      className={`group/pip fixed right-5 bottom-5 z-50 overflow-hidden shadow-2xl ${
        isM3
          ? 'rounded-[24px] bg-[#1E2536] ring-2 ring-[#7FD4FF]/50'
          : 'lg-modal rounded-[20px]'
      }`}
    >
      {/* Interactive Edge & Corner Resize Handles */}
      <div
        onPointerDown={startResize('nw')}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        className="absolute top-0 left-0 z-40 h-4 w-4 cursor-nwse-resize"
        title="Drag corner to resize"
      />
      <div
        onPointerDown={startResize('ne')}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        className="absolute top-0 right-0 z-40 h-4 w-4 cursor-nesw-resize"
        title="Drag corner to resize"
      />
      <div
        onPointerDown={startResize('sw')}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        className="absolute bottom-0 left-0 z-40 h-4 w-4 cursor-nesw-resize"
        title="Drag corner to resize"
      />
      <div
        onPointerDown={startResize('se')}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        className="absolute right-0 bottom-0 z-40 h-4 w-4 cursor-nwse-resize"
        title="Drag corner to resize"
      />
      <div
        onPointerDown={startResize('w')}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        className="absolute inset-y-4 left-0 z-30 w-2 cursor-ew-resize"
      />
      <div
        onPointerDown={startResize('e')}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        className="absolute inset-y-4 right-0 z-30 w-2 cursor-ew-resize"
      />

      {/* Draggable Header Strip */}
      <div
        onPointerDown={handleDragPointerDown}
        onPointerMove={handleDragPointerMove}
        onPointerUp={handleDragPointerUp}
        onDoubleClick={() => persistWidth(DEFAULT_PIP_WIDTH)}
        className="flex cursor-grab items-center justify-between border-b border-white/10 bg-black/35 px-3 py-1.5 active:cursor-grabbing"
      >
        <div className="flex min-w-0 items-center gap-2">
          <GripHorizontal className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="h-2 w-2 shrink-0 rounded-full bg-sky-300 animate-luma-live" />
          <span className="truncate text-xs font-semibold text-white">
            {isOnDemand ? title : `#${channel.number} · ${channel.name}`}
          </span>
        </div>

        <div
          className="flex shrink-0 items-center gap-0.5"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={() => persistWidth(widthPx - 64)}
            className="rounded-full p-1 text-slate-300 hover:bg-white/10 hover:text-white"
            title="Smaller mini player"
          >
            <Minus className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => persistWidth(widthPx + 64)}
            className="rounded-full p-1 text-slate-300 hover:bg-white/10 hover:text-white"
            title="Larger mini player"
          >
            <Plus className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={triggerOsPip}
            className="rounded-full p-1 text-slate-300 hover:bg-white/10 hover:text-white"
            title="System Picture-in-Picture"
          >
            <PictureInPicture2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onRestoreStage}
            className="rounded-full p-1 text-slate-300 hover:bg-white/10 hover:text-white"
            title="Expand to full player"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-slate-300 hover:bg-rose-500/30 hover:text-white"
            title="Close mini player"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Mini Video Viewport */}
      <div className="relative aspect-video w-full bg-[#06080E]">
        {state !== 'playing' && (
          <BroadcastSynthCanvas
            channel={channel}
            programTitle={title}
            badgeCodeOverride={isOnDemand ? 'VOD' : undefined}
            compact
          />
        )}
        <video
          ref={videoRef}
          playsInline
          autoPlay
          muted={isMuted}
          className={`relative z-10 h-full w-full object-cover transition-opacity ${
            state === 'playing' ? 'opacity-100' : 'opacity-0'
          }`}
        />

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-16 bg-gradient-to-t from-black/90 to-transparent" />

        {/* Mini Transport Overlay */}
        <div className="absolute inset-x-3 bottom-2 z-20 flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] font-medium text-white">{title}</div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/15">
              <div
                className={isM3 ? 'h-full bg-[#7FD4FF]' : 'luma-accent-gradient h-full'}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {!isOnDemand && (
              <>
                <button
                  type="button"
                  onClick={onPrevChannel}
                  className="rounded-full bg-black/55 p-1.5 text-slate-200 hover:bg-white/20 hover:text-white"
                  title="Previous channel"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={onNextChannel}
                  className="rounded-full bg-black/55 p-1.5 text-slate-200 hover:bg-white/20 hover:text-white"
                  title="Next channel"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => onChangeMuted(!isMuted)}
              className={`rounded-full p-1.5 ${
                isMuted
                  ? 'bg-black/55 text-sky-300 hover:bg-white/20'
                  : 'bg-sky-400 text-slate-950'
              }`}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? (
                <VolumeX className="h-3.5 w-3.5" />
              ) : (
                <Volume2 className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
