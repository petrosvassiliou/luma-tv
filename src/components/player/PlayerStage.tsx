import React, { useEffect, useRef, useState } from 'react';
import {
  AppWindow,
  Captions,
  ChevronDown,
  ChevronUp,
  Circle,
  Expand,
  ExternalLink,
  Maximize2,
  Minimize2,
  Pause,
  PictureInPicture2,
  Play,
  Radio,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sliders,
  Square,
  Star,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { getCurrentAndNextProgram } from '../../data/mockCatalog';
import {
  AUDIO_DSP_PRESETS,
  LumaAudioProcessor,
  type AudioDspPreset,
} from '../../engine/audioProcessor';
import { LumaDvrRecorder } from '../../engine/dvrRecorder';
import { LumaPlayerEngine } from '../../engine/LumaPlayerEngine';
import { launchNativeMpvStream } from '../../engine/tauriNativeBridge';
import { TRANSLATIONS, type LumaLocale } from '../../i18n/translations';
import type {
  AspectRatioMode,
  Channel,
  EngineProxyConfig,
  EpgProgram,
  PlatformDesignMode,
  StreamTelemetry,
} from '../../types/luma';
import { BroadcastSynthCanvas } from './BroadcastSynthCanvas';

interface PlayerStageProps {
  designMode: PlatformDesignMode;
  channel: Channel;
  overrideTitle?: string;
  overrideSubtitle?: string;
  overrideStreamUrl?: string;
  timeshiftProgram?: EpgProgram | null;
  onExitTimeshift?: () => void;
  isFavorite: boolean;
  onToggleFavorite: (channelId: string) => void;
  onPrevChannel: () => void;
  onNextChannel: () => void;
  onDetachInAppPip: () => void;
  ambilightEnabled: boolean;
  theaterExpanded: boolean;
  onToggleTheaterExpanded: () => void;
  proxyConfig: EngineProxyConfig;
  nowMs: number;
  locale?: LumaLocale;
  mpvAvailable?: boolean;
  onToast?: (message: string) => void;
  onAmbientRgbChange?: (rgb: string) => void;
}

export const PlayerStage: React.FC<PlayerStageProps> = ({
  designMode,
  channel,
  overrideTitle,
  overrideSubtitle,
  overrideStreamUrl,
  timeshiftProgram,
  onExitTimeshift,
  isFavorite,
  onToggleFavorite,
  onPrevChannel,
  onNextChannel,
  onDetachInAppPip,
  ambilightEnabled,
  theaterExpanded,
  onToggleTheaterExpanded,
  proxyConfig,
  nowMs,
  locale = 'de',
  mpvAvailable = false,
  onToast,
  onAmbientRgbChange,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const t = TRANSLATIONS[locale];
  const stageRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const synthCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<LumaPlayerEngine | null>(null);
  const audioDspRef = useRef<LumaAudioProcessor | null>(null);
  const dvrRef = useRef<LumaDvrRecorder | null>(null);
  const touchStartY = useRef<number | null>(null);

  const [telemetry, setTelemetry] = useState<StreamTelemetry>({
    engine: 'WebHLS · MSE Worker',
    state: 'connecting',
    width: 0,
    height: 0,
    bitrateKbps: 0,
    bufferSec: 0,
    latencySec: 0,
    levels: [],
    currentLevel: -1,
    audioTracks: [],
    currentAudioTrack: 0,
    subtitleTracks: [],
    currentSubtitleTrack: -1,
    proxyActive: false,
  });

  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [volume, setVolume] = useState(0.85);
  const [audioPreset, setAudioPreset] = useState<AudioDspPreset>('direct');
  const [preAmpBoost, setPreAmpBoost] = useState<number>(1.0);
  const [aspectMode, setAspectMode] = useState<AspectRatioMode>('16:9');
  const [showQualityMenu, setShowQualityMenu] = useState(false);

  // Live DVR Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);

  const [sampledStreamState, setSampledStreamState] = useState<{
    url: string;
    rgb: string;
  } | null>(null);

  const activeUrl = overrideStreamUrl ?? channel.streamUrl;

  const fallbackRgb = (() => {
    const clean = channel.accentColor.replace('#', '');
    const num = parseInt(clean, 16);
    if (Number.isNaN(num)) return '56, 189, 248';
    return `${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}`;
  })();

  const ambientRgb =
    sampledStreamState && sampledStreamState.url === activeUrl
      ? sampledStreamState.rgb
      : fallbackRgb;

  useEffect(() => {
    onAmbientRgbChange?.(ambientRgb);
  }, [ambientRgb, onAmbientRgbChange]);

  useEffect(() => {
    const engine = new LumaPlayerEngine((nextTelemetry) => {
      setTelemetry(nextTelemetry);
    });
    const dsp = new LumaAudioProcessor();
    const dvr = new LumaDvrRecorder();
    engineRef.current = engine;
    audioDspRef.current = dsp;
    dvrRef.current = dvr;

    return () => {
      dvr.stopAndDownload();
      dsp.destroy();
      engine.destroy();
      engineRef.current = null;
      audioDspRef.current = null;
      dvrRef.current = null;
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
    const video = videoRef.current;
    if (!video) return;
    video.muted = isMuted;
    video.volume = volume;
  }, [isMuted, volume]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !audioDspRef.current) return;
    audioDspRef.current.attachAndConfigure(video, audioPreset, preAmpBoost);
  }, [audioPreset, preAmpBoost]);

  useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(() => setRecSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  useEffect(() => {
    if (!ambilightEnabled) return;

    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 9;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const interval = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || video.paused || video.readyState < 2 || !ctx) return;
      try {
        ctx.drawImage(video, 0, 0, 16, 9);
        const data = ctx.getImageData(0, 0, 16, 9).data;
        let r = 0;
        let g = 0;
        let b = 0;
        let count = 0;
        for (let i = 0; i < data.length; i += 16) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          count++;
        }
        if (count > 0) {
          const avgR = Math.min(255, Math.round((r / count) * 1.15 + 14));
          const avgG = Math.min(255, Math.round((g / count) * 1.15 + 18));
          const avgB = Math.min(255, Math.round((b / count) * 1.2 + 28));
          setSampledStreamState({ url: activeUrl, rgb: `${avgR}, ${avgG}, ${avgB}` });
        }
      } catch {
        // Cross-origin frame fallback
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [ambilightEnabled, activeUrl]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (video && telemetry.state === 'playing') {
      if (video.paused) {
        video.play().catch(() => undefined);
        setIsPlaying(true);
      } else {
        video.pause();
        setIsPlaying(false);
      }
    } else {
      setIsPlaying((v) => !v);
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    const nextMuted = !isMuted;
    if (video) {
      video.muted = nextMuted;
      if (!nextMuted && volume === 0) {
        video.volume = 0.8;
        setVolume(0.8);
      }
    }
    setIsMuted(nextMuted);
  };

  const handleVolumeChange = (nextVol: number) => {
    const video = videoRef.current;
    setVolume(nextVol);
    if (video) {
      video.volume = nextVol;
      video.muted = nextVol === 0;
    }
    setIsMuted(nextVol === 0);
  };

  const toggleDvrRecording = () => {
    const dvr = dvrRef.current;
    if (!dvr) return;

    if (isRecording) {
      dvr.stopAndDownload();
      setIsRecording(false);
      setRecSeconds(0);
      return;
    }

    const targetEl =
      telemetry.state === 'playing' && videoRef.current
        ? videoRef.current
        : synthCanvasRef.current;
    if (!targetEl) return;

    const ok = dvr.startRecording(targetEl, channel.shortCode);
    if (ok) {
      setRecSeconds(0);
      setIsRecording(true);
    }
  };

  const handleOsPip = async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled && telemetry.state === 'playing') {
        await video.requestPictureInPicture();
      } else {
        onDetachInAppPip();
      }
    } catch {
      onDetachInAppPip();
    }
  };

  const handleLaunchMpv = async () => {
    try {
      engineRef.current?.markExternalMpvSession();
      setIsPlaying(false);
      const msg = await launchNativeMpvStream(
        activeUrl,
        `${channel.name} · ${displayTitle}`,
        proxyConfig.customUserAgent
      );
      onToast?.(msg);
    } catch (err) {
      onToast?.(err instanceof Error ? err.message : 'MPV Start fehlgeschlagen');
    }
  };

  const handleFullscreen = async () => {
    const container = stageRef.current;
    if (!container) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await container.requestFullscreen();
      }
    } catch {
      // Ignore
    }
  };

  const cycleAspect = () => {
    setAspectMode((prev) =>
      prev === '16:9' ? 'cover' : prev === 'cover' ? '21:9' : '16:9'
    );
  };

  // Android / Tablet Touch Vertical Swipe Zapping
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0]?.clientY ?? null;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    const endY = e.changedTouches[0]?.clientY ?? touchStartY.current;
    const dy = endY - touchStartY.current;
    touchStartY.current = null;
    if (Math.abs(dy) > 60) {
      if (dy < 0) onNextChannel();
      else onPrevChannel();
    }
  };

  const { current, next, progressPct } = getCurrentAndNextProgram(channel, nowMs);
  const displayTitle = overrideTitle ?? timeshiftProgram?.title ?? current.title;
  const displaySubtitle =
    overrideSubtitle ??
    (timeshiftProgram
      ? `Catch-Up Archiv · ${timeshiftProgram.subtitle}`
      : `${current.subtitle} · Danach: ${next.title}`);

  const fmtTime = (ms: number) =>
    new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(ms);

  const fmtRecTimer = (secs: number) => {
    const m = String(Math.floor(secs / 60)).padStart(2, '0');
    const s = String(secs % 60).padStart(2, '0');
    return `${m}:${s}`;
  };

  const resolutionLabel =
    telemetry.height >= 2160
      ? '4K UHD'
      : telemetry.height >= 1080
        ? '1080p HD'
        : telemetry.height > 0
          ? `${telemetry.height}p`
          : channel.resolution;

  const showSynthVisual = telemetry.state !== 'playing';

  return (
    <section
      ref={stageRef}
      id="luma-player-stage"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className={`relative shrink-0 overflow-hidden transition-all duration-300 ${
        theaterExpanded ? 'h-[60vh] min-h-[350px]' : 'h-[37vh] min-h-[250px] max-h-[385px]'
      } ${
        isM3
          ? 'mx-3 mt-1 mb-2 rounded-[28px] bg-[#0B0E14] ring-1 ring-white/[0.06]'
          : 'mx-2.5 mt-2 rounded-[24px] bg-[#06080E] shadow-[0_20px_50px_-15px_rgba(0,0,0,0.85)] ring-1 ring-white/15'
      }`}
    >
      {ambilightEnabled && (
        <div
          className="pointer-events-none absolute inset-0 transition-all duration-1000"
          style={{
            background: `radial-gradient(circle at 50% 45%, rgba(${ambientRgb}, 0.36) 0%, rgba(96, 165, 250, 0.12) 52%, rgba(9, 10, 15, 0.94) 88%)`,
          }}
        />
      )}

      <div className="relative flex h-full w-full items-center justify-center">
        {showSynthVisual && (
          <BroadcastSynthCanvas
            channel={channel}
            programTitle={displayTitle}
            paused={!isPlaying}
            externalCanvasRef={synthCanvasRef}
          />
        )}

        <video
          ref={videoRef}
          crossOrigin="anonymous"
          playsInline
          autoPlay
          muted={isMuted}
          onClick={togglePlay}
          className={`relative z-10 h-full w-full cursor-pointer transition-opacity duration-300 ${
            showSynthVisual ? 'opacity-0' : 'opacity-100'
          } ${
            aspectMode === 'cover'
              ? 'object-cover'
              : aspectMode === '21:9'
                ? 'max-h-[78%] object-cover'
                : 'object-contain'
          }`}
        />

        {telemetry.currentSubtitleTrack >= 0 && (
          <div className="pointer-events-none absolute bottom-28 z-20 rounded-xl bg-black/75 px-4 py-1.5 text-xs font-medium text-white shadow-lg backdrop-blur-md">
            [CC] {displayTitle} — Live-Untertitelspur aktiv
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-20 bg-gradient-to-b from-black/70 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-36 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />

        {isMuted && (
          <button
            id="btn-quick-unmute"
            type="button"
            onClick={toggleMute}
            className={
              isM3
                ? 'm3-primary-pill absolute top-3.5 right-4 z-20 flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold shadow-lg'
                : 'lg-capsule absolute top-3.5 right-4 z-20 flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium text-white'
            }
          >
            <VolumeX className="h-3.5 w-3.5" />
            <span>Ton aktivieren</span>
          </button>
        )}

        {/* Top-Left Stream Telemetry + DVR + DSP Badges */}
        <div className="absolute top-3.5 left-4 z-20 flex flex-wrap items-center gap-2">
          <span
            className={
              isM3
                ? 'm3-tertiary-badge inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold tracking-wide'
                : 'lg-capsule inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold text-white'
            }
          >
            <span
              className={`h-2 w-2 rounded-full ${
                timeshiftProgram ? 'bg-amber-300' : 'bg-sky-300 animate-luma-live'
              }`}
            />
            {timeshiftProgram ? 'CATCH-UP' : overrideStreamUrl ? 'ON DEMAND' : 'LIVE'}
          </span>

          {isRecording && (
            <button
              type="button"
              onClick={toggleDvrRecording}
              className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/90 px-3 py-1 text-[11px] font-bold text-white shadow-lg luma-tabular"
              title="Aufnahme beenden & speichern"
            >
              <span className="h-2 w-2 rounded-full bg-white animate-luma-live" />
              <span>REC {fmtRecTimer(recSeconds)}</span>
            </button>
          )}

          <span
            className={
              isM3
                ? 'hidden items-center gap-1.5 rounded-full bg-[#1A202E]/90 px-3 py-1 text-[11px] font-medium text-[#C4E8FF] sm:inline-flex luma-tabular'
                : 'lg-capsule hidden items-center gap-1.5 rounded-full px-3 py-1 text-[11px] text-white/90 sm:inline-flex luma-tabular'
            }
          >
            <span className="font-semibold">{resolutionLabel}</span>
            <span className="opacity-35">·</span>
            <span>{channel.streamType === 'mpegts' ? 'MPEG-TS' : channel.codec}</span>
            {telemetry.bitrateKbps > 0 && (
              <>
                <span className="opacity-35">·</span>
                <span>{(telemetry.bitrateKbps / 1000).toFixed(1)} Mbps</span>
              </>
            )}
            <span className="opacity-35">·</span>
            <span className="opacity-75">{telemetry.engine}</span>
          </span>

          {audioPreset !== 'direct' && (
            <span className="hidden items-center gap-1 rounded-full bg-sky-400/20 px-2.5 py-1 text-[10px] font-semibold text-sky-200 ring-1 ring-sky-400/35 md:inline-flex">
              <Sliders className="h-3 w-3" />
              {AUDIO_DSP_PRESETS[audioPreset].label}
            </span>
          )}

          {telemetry.proxyActive && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-1 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-400/30">
              <ShieldCheck className="h-3 w-3" />
              {telemetry.proxyMode === 'local-rust'
                ? t.localRustProxyBadge
                : t.cloudCorsProxyBadge}
            </span>
          )}

          {timeshiftProgram && onExitTimeshift && (
            <button
              type="button"
              onClick={onExitTimeshift}
              className={
                isM3
                  ? 'm3-secondary-tonal inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold'
                  : 'lg-capsule inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium text-amber-200'
              }
            >
              <RotateCcw className="h-3 w-3" />
              <span>Zurück zu Live</span>
            </button>
          )}
        </div>

        {/* Bottom HUD */}
        <div
          className={
            isM3
              ? 'absolute inset-x-3 bottom-3 z-20 rounded-[24px] bg-[#161B28]/95 px-4 py-3 shadow-xl ring-1 ring-white/[0.06]'
              : 'lg-pane absolute inset-x-3.5 bottom-3 z-20 rounded-[22px] px-4 py-2.5'
          }
        >
          <div className="mb-2.5 flex items-center gap-2.5 text-[10px] text-slate-300 luma-tabular">
            <span>{fmtTime(current.startMs)}</span>
            <div
              className={`relative flex-1 overflow-hidden rounded-full ${
                isM3 ? 'h-2 bg-[#29354D]' : 'h-1 bg-white/15'
              }`}
            >
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  isM3 ? 'bg-[#7FD4FF]' : 'luma-accent-gradient'
                }`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span>{fmtTime(current.endMs)}</span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Channel Identity */}
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div
                className={
                  isM3
                    ? 'flex h-11 w-14 shrink-0 flex-col items-center justify-center rounded-[16px] bg-[#232B3D] text-center'
                    : 'lg-capsule flex h-10 w-12 shrink-0 flex-col items-center justify-center rounded-[14px] text-center'
                }
              >
                <span className="text-[9px] font-semibold text-slate-400 luma-tabular">
                  #{String(channel.number).padStart(3, '0')}
                </span>
                <span className="text-[11px] font-bold tracking-tight text-white">
                  {channel.shortCode}
                </span>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-sm font-semibold tracking-[-0.01em] text-white">
                    {channel.name}
                  </h1>
                  <span
                    className={
                      isM3
                        ? 'hidden rounded-full bg-[#29354D] px-2.5 py-0.5 text-[10px] font-semibold text-[#D6E3FF] md:inline-block'
                        : 'hidden rounded-full bg-white/12 px-2 py-0.5 text-[10px] font-medium text-white/85 md:inline-block'
                    }
                  >
                    {channel.audioBadge}
                  </span>
                  <button
                    id="btn-hud-favorite"
                    type="button"
                    onClick={() => onToggleFavorite(channel.id)}
                    className="text-slate-300 transition hover:text-amber-300"
                    title="Favorit umschalten"
                  >
                    <Star
                      className={`h-4 w-4 ${
                        isFavorite ? 'fill-amber-400 text-amber-400' : ''
                      }`}
                    />
                  </button>
                </div>
                <p className="truncate text-xs text-slate-200">
                  <span
                    className={
                      isM3 ? 'font-semibold text-[#7FD4FF]' : 'font-medium text-sky-300'
                    }
                  >
                    {displayTitle}
                  </span>
                  <span className="mx-1.5 opacity-35">—</span>
                  <span className="text-slate-300/80">{displaySubtitle}</span>
                </p>
              </div>
            </div>

            {/* Transport, DVR, Audio DSP & Spatial Controls */}
            <div className="flex items-center gap-1.5">
              <div
                className={
                  isM3
                    ? 'mr-1 hidden items-center rounded-full bg-[#232B3D] p-1 sm:flex'
                    : 'lg-capsule mr-1 hidden items-center rounded-full p-0.5 sm:flex'
                }
              >
                <button
                  id="btn-zap-prev"
                  type="button"
                  onClick={onPrevChannel}
                  className="rounded-full p-1.5 text-slate-200 transition hover:bg-white/10 hover:text-white"
                  title="Vorheriger Kanal"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <span className="px-1 text-[10px] font-semibold text-slate-300">CH</span>
                <button
                  id="btn-zap-next"
                  type="button"
                  onClick={onNextChannel}
                  className="rounded-full p-1.5 text-slate-200 transition hover:bg-white/10 hover:text-white"
                  title="Nächster Kanal"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>

              <button
                id="btn-play-pause"
                type="button"
                onClick={togglePlay}
                className={
                  isM3
                    ? `m3-primary-pill flex h-10 w-12 items-center justify-center ${
                        isPlaying ? 'rounded-[14px]' : 'rounded-full'
                      }`
                    : 'lg-pill-active flex h-9 w-9 items-center justify-center rounded-full'
                }
                title={isPlaying ? 'Pause' : 'Wiedergabe'}
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>

              {/* Live DVR Record Button */}
              <button
                id="btn-dvr-record"
                type="button"
                onClick={toggleDvrRecording}
                className={`flex items-center justify-center rounded-full transition ${
                  isM3 ? 'h-10 w-10' : 'h-9 w-9'
                } ${
                  isRecording
                    ? 'bg-rose-500 text-white shadow-[0_0_16px_rgba(244,63,94,0.65)]'
                    : isM3
                      ? 'm3-secondary-tonal'
                      : 'lg-capsule text-rose-300'
                }`}
                title={
                  isRecording
                    ? 'Live-DVR Aufnahme stoppen & auf Gerät speichern'
                    : 'Sofort-DVR Aufnahme starten (macOS / Android / PWA)'
                }
              >
                {isRecording ? (
                  <Square className="h-3.5 w-3.5 fill-current" />
                ) : (
                  <Circle className="h-3.5 w-3.5 fill-rose-400 text-rose-400" />
                )}
              </button>

              {/* Volume */}
              <div
                className={
                  isM3
                    ? 'flex h-10 items-center gap-2 rounded-full bg-[#232B3D] px-3'
                    : 'lg-capsule flex h-9 items-center gap-1.5 rounded-full px-2.5'
                }
              >
                <button
                  id="btn-mute-toggle"
                  type="button"
                  onClick={toggleMute}
                  className="text-slate-100 hover:text-white"
                  title="Stummschalten"
                >
                  {isMuted ? (
                    <VolumeX className="h-4 w-4 text-[#7FD4FF]" />
                  ) : (
                    <Volume2 className="h-4 w-4" />
                  )}
                </button>
                <input
                  id="slider-volume"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={(e) => handleVolumeChange(Number(e.target.value))}
                  className="hidden h-1 w-16 cursor-pointer accent-sky-400 md:block"
                  aria-label="Lautstärke"
                />
              </div>

              {/* Aspect Ratio */}
              <button
                id="btn-aspect-ratio"
                type="button"
                onClick={cycleAspect}
                className={
                  isM3
                    ? 'm3-secondary-tonal hidden h-10 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold lg:inline-flex luma-tabular'
                    : 'lg-capsule hidden h-9 items-center gap-1 rounded-full px-3 text-[11px] font-medium text-white/90 lg:inline-flex luma-tabular'
                }
                title="Seitenverhältnis wechseln"
              >
                <Expand className="h-3.5 w-3.5" />
                <span>{aspectMode.toUpperCase()}</span>
              </button>

              {/* Quality, Audio DSP, Audio Tracks & Subtitles Menu */}
              <div className="relative">
                <button
                  id="btn-stream-settings"
                  type="button"
                  onClick={() => setShowQualityMenu((v) => !v)}
                  className={
                    isM3
                      ? 'm3-secondary-tonal flex h-10 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold'
                      : 'lg-capsule flex h-9 items-center gap-1 rounded-full px-3 text-[11px] font-medium text-white/90'
                  }
                  title="Qualität, Studio Audio-DSP & Untertitel"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  <span className="hidden xl:inline">DSP &amp; Spuren</span>
                </button>

                {showQualityMenu && (
                  <div
                    className={`luma-scroll absolute right-0 bottom-12 z-30 max-h-96 w-72 overflow-y-auto p-3.5 text-xs ${
                      isM3
                        ? 'rounded-[24px] bg-[#232B3D] shadow-2xl ring-1 ring-white/10'
                        : 'lg-modal rounded-[22px]'
                    }`}
                  >
                    {/* Luma Studio Audio DSP */}
                    <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-sky-300">
                      <span>Studio Audio-DSP &amp; Nachtmodus</span>
                      <Sliders className="h-3 w-3" />
                    </div>
                    <div className="space-y-1">
                      {(Object.keys(AUDIO_DSP_PRESETS) as AudioDspPreset[]).map((key) => {
                        const meta = AUDIO_DSP_PRESETS[key];
                        const active = audioPreset === key;
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => setAudioPreset(key)}
                            className={`flex w-full flex-col rounded-2xl px-3 py-1.5 text-left transition ${
                              active
                                ? isM3
                                  ? 'm3-tonal-active font-semibold'
                                  : 'lg-pill-active'
                                : 'text-slate-200 hover:bg-white/10'
                            }`}
                          >
                            <span className="text-xs font-semibold">{meta.label}</span>
                            <span className="text-[10px] opacity-75">{meta.description}</span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-2 flex items-center justify-between px-1 text-[11px] text-slate-300 luma-tabular">
                      <span>Pre-Amp Boost</span>
                      <span>{Math.round(preAmpBoost * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0.8}
                      max={1.6}
                      step={0.1}
                      value={preAmpBoost}
                      onChange={(e) => setPreAmpBoost(Number(e.target.value))}
                      className="mt-1 h-1 w-full cursor-pointer accent-sky-400"
                    />

                    <div className="my-2.5 border-t border-white/10" />

                    {/* Quality Levels */}
                    <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-300">
                      <span>Qualitätsstufe</span>
                      <Radio className="h-3 w-3 text-sky-400" />
                    </div>
                    <div className="space-y-1">
                      <button
                        type="button"
                        onClick={() => {
                          engineRef.current?.setQualityLevel(-1);
                          setShowQualityMenu(false);
                        }}
                        className={`flex w-full items-center justify-between rounded-full px-3 py-1.5 text-left ${
                          telemetry.currentLevel === -1
                            ? isM3
                              ? 'm3-tonal-active font-semibold'
                              : 'lg-pill-active'
                            : 'text-slate-200 hover:bg-white/10'
                        }`}
                      >
                        <span>Auto (ABR)</span>
                        <span className="text-[10px] opacity-75 luma-tabular">
                          {telemetry.bufferSec}s
                        </span>
                      </button>
                      {telemetry.levels.map((lvl) => (
                        <button
                          key={lvl.index}
                          type="button"
                          onClick={() => {
                            engineRef.current?.setQualityLevel(lvl.index);
                            setShowQualityMenu(false);
                          }}
                          className={`flex w-full items-center justify-between rounded-full px-3 py-1.5 text-left luma-tabular ${
                            telemetry.currentLevel === lvl.index
                              ? isM3
                                ? 'm3-tonal-active font-semibold'
                                : 'lg-pill-active'
                              : 'text-slate-200 hover:bg-white/10'
                          }`}
                        >
                          <span>{lvl.label}</span>
                        </button>
                      ))}
                    </div>

                    <div className="my-2.5 border-t border-white/10" />
                    <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-300">
                      <span>Untertitel / CC</span>
                      <Captions className="h-3 w-3 text-sky-400" />
                    </div>
                    <div className="space-y-1">
                      <button
                        type="button"
                        onClick={() => {
                          engineRef.current?.setSubtitleTrack(-1);
                          setShowQualityMenu(false);
                        }}
                        className={`flex w-full items-center justify-between rounded-full px-3 py-1.5 text-left ${
                          telemetry.currentSubtitleTrack === -1
                            ? isM3
                              ? 'm3-tonal-active font-semibold'
                              : 'lg-pill-active'
                            : 'text-slate-200 hover:bg-white/10'
                        }`}
                      >
                        <span>Aus</span>
                      </button>
                      {(telemetry.subtitleTracks.length > 0
                        ? telemetry.subtitleTracks
                        : [{ index: 0, name: 'Live CC / DVB-Sub', lang: 'de' }]
                      ).map((sub) => (
                        <button
                          key={sub.index}
                          type="button"
                          onClick={() => {
                            engineRef.current?.setSubtitleTrack(sub.index);
                            setShowQualityMenu(false);
                          }}
                          className={`flex w-full items-center justify-between rounded-full px-3 py-1.5 text-left ${
                            telemetry.currentSubtitleTrack === sub.index
                              ? isM3
                                ? 'm3-tonal-active font-semibold'
                                : 'lg-pill-active'
                              : 'text-slate-200 hover:bg-white/10'
                          }`}
                        >
                          <span className="truncate">{sub.name}</span>
                          <span className="text-[10px] uppercase opacity-70">{sub.lang}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Native MPV Hardware Handoff (macOS / Desktop Tauri) */}
              {mpvAvailable && (
                <button
                  id="btn-launch-mpv"
                  type="button"
                  onClick={handleLaunchMpv}
                  className={
                    isM3
                      ? 'm3-secondary-tonal hidden h-10 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold text-[#C4E8FF] sm:inline-flex'
                      : 'lg-capsule hidden h-9 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold text-sky-200 sm:inline-flex'
                  }
                  title={t.mpvLaunchTitle}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>{t.mpvLaunchBtn}</span>
                </button>
              )}

              {/* In-App Floating PiP */}
              <button
                id="btn-inapp-pip"
                type="button"
                onClick={onDetachInAppPip}
                className={
                  isM3
                    ? 'm3-secondary-tonal hidden h-10 w-10 items-center justify-center rounded-full sm:flex'
                    : 'lg-capsule hidden h-9 w-9 items-center justify-center rounded-full text-white/90 sm:flex'
                }
                title="Schwebendes In-App PiP Mini-Fenster öffnen"
              >
                <AppWindow className="h-3.5 w-3.5" />
              </button>

              {/* OS-Wide PiP */}
              <button
                id="btn-os-pip"
                type="button"
                onClick={handleOsPip}
                className={
                  isM3
                    ? 'm3-secondary-tonal hidden h-10 w-10 items-center justify-center rounded-full md:flex'
                    : 'lg-capsule hidden h-9 w-9 items-center justify-center rounded-full text-white/90 md:flex'
                }
                title="OS-weites Picture-in-Picture"
              >
                <PictureInPicture2 className="h-3.5 w-3.5" />
              </button>

              {/* Theater Toggle */}
              <button
                id="btn-theater-height"
                type="button"
                onClick={onToggleTheaterExpanded}
                className={
                  isM3
                    ? 'm3-secondary-tonal flex h-10 w-10 items-center justify-center rounded-full'
                    : 'lg-capsule flex h-9 w-9 items-center justify-center rounded-full text-white/90'
                }
                title={theaterExpanded ? 'EPG-Split vergrößern' : 'Kino-Stage vergrößern'}
              >
                {theaterExpanded ? (
                  <Minimize2 className="h-3.5 w-3.5" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" />
                )}
              </button>

              {/* Fullscreen */}
              <button
                id="btn-fullscreen"
                type="button"
                onClick={handleFullscreen}
                className={
                  isM3
                    ? 'm3-secondary-tonal hidden h-10 items-center rounded-full px-3.5 text-[11px] font-semibold lg:inline-flex'
                    : 'lg-capsule hidden h-9 items-center rounded-full px-3 text-[11px] font-medium text-white/90 lg:inline-flex'
                }
              >
                Vollbild
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
