import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  GripHorizontal,
  Maximize2,
  PictureInPicture2,
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
  proxyConfig: EngineProxyConfig;
  nowMs: number;
  onPrevChannel: () => void;
  onNextChannel: () => void;
  onRestoreStage: () => void;
  onClose: () => void;
}

export const InAppPipWindow: React.FC<InAppPipWindowProps> = ({
  designMode,
  channel,
  overrideTitle,
  overrideStreamUrl,
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
  const [engineName, setEngineName] = useState<string>('MSE');
  const [muted, setMuted] = useState<boolean>(true);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragOrigin = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const activeUrl = overrideStreamUrl ?? channel.streamUrl;

  useEffect(() => {
    const engine = new LumaPlayerEngine((t) => {
      setState(t.state);
      setEngineName(t.engine.split('·')[0].trim());
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
    engine.load(
      video,
      activeUrl,
      proxyConfig,
      true,
      overrideStreamUrl ? 'hls' : channel.streamType
    );
  }, [activeUrl, channel.streamType, overrideStreamUrl, proxyConfig]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.muted = muted;
    }
  }, [muted]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragOrigin.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: offset.x,
      origY: offset.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragOrigin.current) return;
    const dx = e.clientX - dragOrigin.current.startX;
    const dy = e.clientY - dragOrigin.current.startY;
    setOffset({
      x: dragOrigin.current.origX + dx,
      y: dragOrigin.current.origY + dy,
    });
  };

  const handlePointerUp = () => {
    dragOrigin.current = null;
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

  return (
    <div
      id="luma-inapp-pip"
      style={{
        transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
      }}
      className={`fixed right-5 bottom-5 z-50 w-80 overflow-hidden shadow-2xl sm:w-96 ${
        isM3
          ? 'rounded-[26px] bg-[#1E2536] ring-2 ring-[#7FD4FF]/50'
          : 'lg-modal rounded-[22px]'
      }`}
    >
      {/* Draggable Header Strip */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="flex cursor-grab items-center justify-between border-b border-white/10 bg-black/30 px-3.5 py-2 active:cursor-grabbing"
      >
        <div className="flex min-w-0 items-center gap-2">
          <GripHorizontal className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="h-2 w-2 shrink-0 rounded-full bg-sky-300 animate-luma-live" />
          <span className="truncate text-xs font-semibold text-white">
            #{channel.number} · {channel.name}
          </span>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[9px] font-semibold text-sky-200">
            {engineName}
          </span>
        </div>

        <div className="flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={triggerOsPip}
            className="rounded-full p-1 text-slate-300 hover:bg-white/10 hover:text-white"
            title="An OS Picture-in-Picture übergeben"
          >
            <PictureInPicture2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onRestoreStage}
            className="rounded-full p-1 text-slate-300 hover:bg-white/10 hover:text-white"
            title="Zur Haupt-Stage vergrößern"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-slate-300 hover:bg-rose-500/30 hover:text-white"
            title="In-App PiP schließen"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Mini Video Viewport */}
      <div className="relative aspect-video w-full bg-[#06080E]">
        {state !== 'playing' && (
          <BroadcastSynthCanvas channel={channel} programTitle={title} compact />
        )}
        <video
          ref={videoRef}
          playsInline
          autoPlay
          muted={muted}
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
            <button
              type="button"
              onClick={onPrevChannel}
              className="rounded-full bg-black/55 p-1.5 text-slate-200 hover:bg-white/20 hover:text-white"
              title="Vorheriger Kanal"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onNextChannel}
              className="rounded-full bg-black/55 p-1.5 text-slate-200 hover:bg-white/20 hover:text-white"
              title="Nächster Kanal"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setMuted((v) => !v)}
              className={`rounded-full p-1.5 ${
                muted
                  ? 'bg-black/55 text-sky-300 hover:bg-white/20'
                  : 'bg-sky-400 text-slate-950'
              }`}
              title="Ton umschalten"
            >
              {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
