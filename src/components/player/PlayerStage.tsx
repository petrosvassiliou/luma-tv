import React, { useEffect, useRef, useState } from 'react';
import {
  AppWindow,
  ArrowLeft,
  Captions,
  ChevronDown,
  ChevronUp,
  Circle,
  Cpu,
  Expand,
  ExternalLink,
  FileUp,
  Link2,
  Maximize2,
  Minimize2,
  Minus,
  Pause,
  PictureInPicture2,
  Play,
  Plus,
  Radio,
  RotateCcw,
  RotateCw,
  Settings2,
  ShieldCheck,
  SkipForward,
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
import { formatPlaybackClock } from '../../engine/catchupUrlBuilder';
import { LumaDvrRecorder } from '../../engine/dvrRecorder';
import { LumaPlayerEngine } from '../../engine/LumaPlayerEngine';
import { launchNativeMpvStream } from '../../engine/tauriNativeBridge';
import {
  LOCALE_META,
  TRANSLATIONS,
  type LumaLocale,
} from '../../i18n/translations';
import {
  detectSubtitleLanguageFromFilename,
  fetchRemoteSubtitleText,
} from '../../services/subtitleConverter';
import {
  enterLumaFullscreen,
  exitLumaFullscreen,
  getNativeDomFullscreenElement,
} from '../../services/fullscreenService';
import type {
  AspectRatioMode,
  Channel,
  EngineProxyConfig,
  EpgProgram,
  NativeTranscodeMode,
  PlatformDesignMode,
  StreamTelemetry,
} from '../../types/luma';
import { BroadcastSynthCanvas } from './BroadcastSynthCanvas';

export interface OnDemandHudMeta {
  badgeTop: string; // e.g. 'VOD' | 'SERIES'
  badgeCode: string; // e.g. '4K' | 'HD' | 'S01E01'
  techBadge: string; // e.g. '4K HDR · HEVC' | '1080p · H.264'
  favoriteTargetId: string;
  backLabel?: string; // e.g. 'Movies' | 'Series'
}

interface PlayerStageProps {
  designMode: PlatformDesignMode;
  channel: Channel;
  overrideTitle?: string;
  overrideSubtitle?: string;
  overrideStreamUrl?: string;
  onDemandMeta?: OnDemandHudMeta | null;
  onBackToCatalog?: () => void;
  timeshiftProgram?: EpgProgram | null;
  onExitTimeshift?: () => void;
  sessionKey?: string;
  initialResumeSec?: number;
  fallbackDurationSec?: number;
  onPlaybackProgress?: (currentSec: number, durationSec: number) => void;
  nextEpisodeLabel?: string;
  onPlayNextEpisode?: () => void;
  isFavorite: boolean;
  onToggleFavorite: (channelId: string) => void;
  onPrevChannel: () => void;
  onNextChannel: () => void;
  onDetachInAppPip: () => void;
  ambilightEnabled: boolean;
  theaterExpanded: boolean;
  onToggleTheaterExpanded: () => void;
  isStageFullscreen?: boolean;
  onChangeStageFullscreen?: (fullscreen: boolean) => void;
  layoutVariant?: 'split' | 'cinema';
  isMuted?: boolean;
  onChangeMuted?: (muted: boolean) => void;
  volume?: number;
  onChangeVolume?: (volume: number) => void;
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
  onDemandMeta,
  onBackToCatalog,
  timeshiftProgram,
  onExitTimeshift,
  sessionKey,
  initialResumeSec = 0,
  fallbackDurationSec = 0,
  onPlaybackProgress,
  nextEpisodeLabel,
  onPlayNextEpisode,
  isFavorite,
  onToggleFavorite,
  onPrevChannel,
  onNextChannel,
  onDetachInAppPip,
  ambilightEnabled,
  theaterExpanded,
  onToggleTheaterExpanded,
  isStageFullscreen,
  onChangeStageFullscreen,
  layoutVariant = 'split',
  isMuted: controlledMuted,
  onChangeMuted,
  volume: controlledVolume,
  onChangeVolume,
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
  const [fallbackMutedState, setFallbackMutedState] = useState(false);
  const [fallbackVolumeState, setFallbackVolumeState] = useState(0.85);
  const [hudVisible, setHudVisible] = useState(true);
  const [hudHovered, setHudHovered] = useState(false);
  const [localFullscreenState, setLocalFullscreenState] = useState(false);
  const hudHideTimerRef = useRef<number | null>(null);

  const effectiveFullscreen = isStageFullscreen ?? localFullscreenState;
  const setStageFullscreenValue = (next: boolean) => {
    setLocalFullscreenState(next);
    onChangeStageFullscreen?.(next);
  };
  const autoHideHudMode = layoutVariant === 'cinema' || effectiveFullscreen;

  const isMuted = controlledMuted ?? fallbackMutedState;
  const volume = controlledVolume ?? fallbackVolumeState;
  const effectiveMuted = isMuted;

  const setMutedValue = (next: boolean) => {
    setFallbackMutedState(next);
    onChangeMuted?.(next);
  };
  const setVolumeValue = (next: number) => {
    setFallbackVolumeState(next);
    onChangeVolume?.(next);
  };

  const [audioPreset, setAudioPreset] = useState<AudioDspPreset>('direct');
  const [preAmpBoost, setPreAmpBoost] = useState<number>(1.0);
  const [aspectMode, setAspectMode] = useState<AspectRatioMode>('16:9');
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [subtitleUrlInput, setSubtitleUrlInput] = useState('');
  const [isSubtitleDropActive, setIsSubtitleDropActive] = useState(false);

  // Live DVR Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);

  const activeUrl = overrideStreamUrl ?? channel.streamUrl;
  const activeSessionId = sessionKey ?? `${activeUrl}::${timeshiftProgram?.id ?? 'live'}`;

  const isOnDemandVod = Boolean(overrideStreamUrl && !timeshiftProgram);
  const isSeekable = Boolean(overrideStreamUrl || timeshiftProgram);
  const defaultSeekableDuration =
    fallbackDurationSec > 0
      ? fallbackDurationSec
      : timeshiftProgram
        ? Math.max(60, Math.round((timeshiftProgram.endMs - timeshiftProgram.startMs) / 1000))
        : 0;
  const initialResumeTarget =
    isSeekable && initialResumeSec > 2 ? Math.round(initialResumeSec) : 0;

  const [playbackTimeline, setPlaybackTimeline] = useState<{
    sessionId: string;
    positionSec: number;
    durationSec: number;
  }>(() => ({
    sessionId: activeSessionId,
    positionSec: initialResumeTarget,
    durationSec: defaultSeekableDuration,
  }));

  const mediaPositionSec =
    playbackTimeline.sessionId === activeSessionId
      ? playbackTimeline.positionSec
      : initialResumeTarget;
  const mediaDurationSec =
    playbackTimeline.sessionId === activeSessionId
      ? playbackTimeline.durationSec
      : defaultSeekableDuration;

  const pendingResumeRef = useRef<number>(initialResumeTarget);
  const lastReportedSecRef = useRef<number>(-1);
  const onPlaybackProgressRef = useRef(onPlaybackProgress);

  useEffect(() => {
    onPlaybackProgressRef.current = onPlaybackProgress;
  }, [onPlaybackProgress]);

  useEffect(() => {
    pendingResumeRef.current = initialResumeTarget;
    lastReportedSecRef.current = -1;
  }, [activeSessionId, initialResumeTarget]);

  const [sampledStreamState, setSampledStreamState] = useState<{
    url: string;
    rgb: string;
  } | null>(null);

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
    video.muted = isMuted;
    video.volume = volume;
    engine.load(
      video,
      activeUrl,
      proxyConfig,
      true,
      overrideStreamUrl ? undefined : channel.streamType
    );
    // Intentionally omit isMuted/volume from reload deps so volume adjustments don't reload MSE
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUrl, channel.streamType, overrideStreamUrl, proxyConfig]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isSeekable) return;

    const onLoadedMetadata = () => {
      const dur =
        Number.isFinite(video.duration) && video.duration > 0
          ? Math.round(video.duration)
          : defaultSeekableDuration;
      let nextPos = pendingResumeRef.current;

      if (pendingResumeRef.current > 2) {
        const target =
          Number.isFinite(video.duration) && video.duration > 10
            ? Math.min(pendingResumeRef.current, Math.floor(video.duration - 5))
            : pendingResumeRef.current;
        try {
          video.currentTime = target;
          nextPos = target;
        } catch {
          // Ignore seek before buffer ready
        }
        pendingResumeRef.current = 0;
      }

      setPlaybackTimeline((prev) => ({
        sessionId: activeSessionId,
        positionSec: nextPos > 0 ? nextPos : prev.sessionId === activeSessionId ? prev.positionSec : 0,
        durationSec: dur,
      }));
    };

    const onTimeUpdate = () => {
      const cur = Math.max(0, Math.floor(video.currentTime || 0));
      const dur =
        Number.isFinite(video.duration) && video.duration > 0
          ? Math.round(video.duration)
          : defaultSeekableDuration;
      setPlaybackTimeline({
        sessionId: activeSessionId,
        positionSec: cur,
        durationSec: dur,
      });

      if (dur > 0 && cur > 0 && Math.abs(cur - lastReportedSecRef.current) >= 4) {
        lastReportedSecRef.current = cur;
        onPlaybackProgressRef.current?.(cur, dur);
      }
    };

    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('timeupdate', onTimeUpdate);
    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('timeupdate', onTimeUpdate);
    };
  }, [isSeekable, activeSessionId, defaultSeekableDuration]);

  // Keep seekable clock advancing smoothly when in Studio Synth fallback mode
  useEffect(() => {
    if (!isSeekable || telemetry.state !== 'synth-fallback' || !isPlaying) return;
    const effectiveDur = mediaDurationSec > 0 ? mediaDurationSec : defaultSeekableDuration || 3600;
    const timer = window.setInterval(() => {
      setPlaybackTimeline((prev) => {
        const curBase =
          prev.sessionId === activeSessionId ? prev.positionSec : initialResumeTarget;
        const next = Math.min(effectiveDur, curBase + 1);
        if (Math.abs(next - lastReportedSecRef.current) >= 4) {
          lastReportedSecRef.current = next;
          onPlaybackProgressRef.current?.(next, effectiveDur);
        }
        return {
          sessionId: activeSessionId,
          positionSec: next,
          durationSec: effectiveDur,
        };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [
    isSeekable,
    telemetry.state,
    isPlaying,
    mediaDurationSec,
    defaultSeekableDuration,
    activeSessionId,
    initialResumeTarget,
  ]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = isMuted;
    video.volume = volume;
  }, [isMuted, volume, activeUrl]);

  const revealHud = () => {
    setHudVisible(true);
    if (hudHideTimerRef.current !== null) {
      window.clearTimeout(hudHideTimerRef.current);
    }
    if (autoHideHudMode) {
      hudHideTimerRef.current = window.setTimeout(() => {
        setHudVisible(false);
      }, 3200);
    }
  };

  useEffect(() => {
    return () => {
      if (hudHideTimerRef.current !== null) {
        window.clearTimeout(hudHideTimerRef.current);
      }
    };
  }, []);

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
    const nextMuted = !effectiveMuted;
    if (video) {
      video.muted = nextMuted;
      if (!nextMuted && volume === 0) {
        video.volume = 0.85;
        setVolumeValue(0.85);
      }
      if (!nextMuted && video.paused) {
        video.play().catch(() => undefined);
      }
    }
    setMutedValue(nextMuted);
  };

  const handleVolumeChange = (nextVol: number) => {
    const video = videoRef.current;
    setVolumeValue(nextVol);
    if (video) {
      video.volume = nextVol;
      video.muted = nextVol === 0;
    }
    setMutedValue(nextVol === 0);
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

    const clipSlug = isOnDemandVod
      ? (overrideTitle || 'VOD')
          .replace(/[^a-zA-Z0-9_-]+/g, '_')
          .slice(0, 24)
      : channel.shortCode;
    const ok = dvr.startRecording(targetEl, clipSlug);
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
      const mpvWindowTitle = isOnDemandVod
        ? displayTitle
        : `${channel.name} · ${displayTitle}`;
      const msg = await launchNativeMpvStream(
        activeUrl,
        mpvWindowTitle,
        proxyConfig.customUserAgent
      );
      onToast?.(msg);
    } catch (err) {
      onToast?.(err instanceof Error ? err.message : 'MPV Start fehlgeschlagen');
    }
  };

  const handleFullscreen = async () => {
    const container = stageRef.current;
    const currentlyFullscreen =
      effectiveFullscreen || Boolean(getNativeDomFullscreenElement());

    if (currentlyFullscreen) {
      setStageFullscreenValue(false);
      await exitLumaFullscreen();
      return;
    }

    setStageFullscreenValue(true);
    revealHud();
    await enterLumaFullscreen(container);
  };

  const cycleAspect = () => {
    setAspectMode((prev) =>
      prev === '16:9' ? 'cover' : prev === 'cover' ? '21:9' : '16:9'
    );
  };

  const ingestExternalSubtitleFile = async (file: File) => {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      const rawText = await file.text();
      const detected = detectSubtitleLanguageFromFilename(file.name);
      engine.addExternalSubtitle({
        name: detected.label,
        lang: detected.lang,
        rawText,
        selectImmediately: true,
      });
      onToast?.(`Subtitle loaded: ${detected.label}`);
    } catch {
      onToast?.('Failed to read subtitle file.');
    }
  };

  const handleSubtitleFileInputChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (file) {
      await ingestExternalSubtitleFile(file);
    }
    e.target.value = '';
  };

  const handleLoadRemoteSubtitleUrl = async () => {
    const trimmed = subtitleUrlInput.trim();
    if (!trimmed || !engineRef.current) return;
    try {
      const rawText = await fetchRemoteSubtitleText(trimmed, proxyConfig.endpointUrl);
      const filePart = trimmed.split('?')[0].split('/').pop() || 'Remote Subtitle.srt';
      const detected = detectSubtitleLanguageFromFilename(filePart);
      engineRef.current.addExternalSubtitle({
        name: detected.label,
        lang: detected.lang,
        rawText,
        selectImmediately: true,
      });
      setSubtitleUrlInput('');
      onToast?.(`Remote subtitle loaded: ${detected.label}`);
    } catch (err) {
      onToast?.(
        err instanceof Error ? err.message : 'Failed to fetch remote subtitle.'
      );
    }
  };

  const handleStageDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      setIsSubtitleDropActive(true);
    }
  };

  const handleStageDragLeave = () => {
    setIsSubtitleDropActive(false);
  };

  const handleStageDrop = async (e: React.DragEvent) => {
    setIsSubtitleDropActive(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (/\.(srt|vtt|ass|ssa)$/i.test(file.name)) {
      e.preventDefault();
      e.stopPropagation();
      await ingestExternalSubtitleFile(file);
    }
  };

  const handleSelectTranscodeMode = (mode: NativeTranscodeMode) => {
    engineRef.current?.setTranscodeMode(mode);
    const label =
      mode === 'remux'
        ? 'In-Window Dolby Audio Remux (AAC)'
        : mode === 'hw'
          ? 'In-Window Hardware VideoToolbox'
          : 'Auto Native MSE';
    onToast?.(`Playback engine: ${label}`);
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
    if (!isOnDemandVod && Math.abs(dy) > 60) {
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

  const effectiveDurationSec =
    mediaDurationSec > 0 ? mediaDurationSec : defaultSeekableDuration || 3600;

  const seekToSeconds = (targetSec: number) => {
    const clamped = Math.max(0, Math.min(effectiveDurationSec, Math.round(targetSec)));
    setPlaybackTimeline({
      sessionId: activeSessionId,
      positionSec: clamped,
      durationSec: effectiveDurationSec,
    });
    const video = videoRef.current;
    if (video && telemetry.state === 'playing') {
      try {
        video.currentTime = clamped;
      } catch {
        // Ignore unbuffered range error
      }
    }
    lastReportedSecRef.current = clamped;
    onPlaybackProgressRef.current?.(clamped, effectiveDurationSec);
  };

  const skipRelativeSeconds = (deltaSec: number) => {
    seekToSeconds(mediaPositionSec + deltaSec);
  };

  const fmtTime = (ms: number) =>
    new Intl.DateTimeFormat(LOCALE_META[locale].bcp47, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(ms);

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
  const showChrome =
    !autoHideHudMode ||
    hudVisible ||
    hudHovered ||
    !isPlaying ||
    showQualityMenu ||
    isRecording;

  return (
    <section
      ref={stageRef}
      id="luma-player-stage"
      onPointerMove={revealHud}
      onTouchStart={(e) => {
        revealHud();
        handleTouchStart(e);
      }}
      onTouchEnd={handleTouchEnd}
      onDragOver={handleStageDragOver}
      onDragLeave={handleStageDragLeave}
      onDrop={handleStageDrop}
      className={`@container relative overflow-hidden transition-all duration-300 ${
        effectiveFullscreen
          ? '!m-0 h-full w-full max-h-none flex-1 rounded-none bg-black'
          : layoutVariant === 'cinema'
            ? 'h-full min-h-[320px] flex-1'
            : theaterExpanded
              ? 'mx-3 mt-1 mb-2 h-[60vh] min-h-[350px] shrink-0'
              : 'mx-2.5 mt-2 h-[37vh] min-h-[250px] max-h-[385px] shrink-0'
      } ${
        effectiveFullscreen
          ? ''
          : isM3
            ? 'rounded-[26px] bg-[#0B0E14] ring-1 ring-white/[0.06]'
            : 'rounded-[22px] bg-[#06080E] shadow-[0_20px_50px_-15px_rgba(0,0,0,0.85)] ring-1 ring-white/15'
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

      <div
        onDoubleClick={(e) => {
          if (
            (e.target as HTMLElement | null)?.closest(
              'button, input, label, a, select'
            )
          ) {
            return;
          }
          void handleFullscreen();
        }}
        className="relative flex h-full w-full items-center justify-center"
      >
        {showSynthVisual && (
          <BroadcastSynthCanvas
            channel={channel}
            programTitle={displayTitle}
            badgeCodeOverride={
              isOnDemandVod ? (onDemandMeta?.badgeCode ?? 'VOD') : undefined
            }
            paused={!isPlaying}
            externalCanvasRef={synthCanvasRef}
          />
        )}

        <video
          ref={videoRef}
          playsInline
          autoPlay
          muted={effectiveMuted}
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

        {isSubtitleDropActive && (
          <div className="pointer-events-none absolute inset-4 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-sky-400/80 bg-black/70 backdrop-blur-md">
            <div className="flex items-center gap-2.5 text-sm font-semibold text-sky-200">
              <Captions className="h-5 w-5" />
              <span>Drop .srt, .vtt, or .ass subtitle file to attach</span>
            </div>
          </div>
        )}

        {telemetry.activeSubtitleText ? (
          <div
            className={`pointer-events-none absolute inset-x-8 z-20 flex justify-center transition-all duration-200 ${
              showChrome ? 'bottom-28' : 'bottom-8'
            }`}
          >
            <div className="max-w-3xl whitespace-pre-line rounded-xl bg-black/80 px-4 py-2 text-center text-sm font-medium leading-relaxed text-white shadow-xl backdrop-blur-md md:text-base">
              {telemetry.activeSubtitleText}
            </div>
          </div>
        ) : telemetry.currentSubtitleTrack >= 0 &&
          telemetry.currentSubtitleTrack < 1000 &&
          telemetry.state === 'synth-fallback' ? (
          <div className="pointer-events-none absolute bottom-28 z-20 rounded-xl bg-black/75 px-4 py-1.5 text-xs font-medium text-white shadow-lg backdrop-blur-md">
            [CC] {displayTitle}
          </div>
        ) : null}

        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-20 bg-gradient-to-b from-black/70 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-36 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />

        {/* Decluttered Top-Left Stream Status */}
        <div
          className={`absolute top-3.5 left-4 z-20 flex flex-wrap items-center gap-2 transition-opacity duration-300 ${
            showChrome || effectiveMuted ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          <span
            title={`${telemetry.engine}${telemetry.proxyActive ? ` · ${telemetry.proxyMode === 'local-rust' ? t.localRustProxyBadge : t.cloudCorsProxyBadge}` : ''}`}
            className={
              isM3
                ? 'm3-tertiary-badge inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold tracking-wide luma-tabular'
                : 'lg-capsule inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold text-white luma-tabular'
            }
          >
            <span
              className={`h-2 w-2 rounded-full ${
                timeshiftProgram ? 'bg-amber-300' : 'bg-sky-300 animate-luma-live'
              }`}
            />
            <span>
              {timeshiftProgram
                ? t.catchupBadge
                : overrideStreamUrl
                  ? t.onDemandBadge
                  : t.liveBadge}
            </span>
            <span className="opacity-40">·</span>
            <span className="font-medium opacity-90">{resolutionLabel}</span>
            {telemetry.proxyActive && (
              <ShieldCheck className="ml-0.5 h-3 w-3 text-emerald-300" />
            )}
          </span>

          {effectiveMuted && (
            <button
              id="btn-quick-unmute"
              type="button"
              onClick={toggleMute}
              className={
                isM3
                  ? 'm3-primary-pill inline-flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-bold shadow-lg'
                  : 'lg-capsule inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-white shadow-lg'
              }
            >
              <VolumeX className="h-3.5 w-3.5" />
              <span>{t.unmute}</span>
            </button>
          )}

          {isRecording && (
            <button
              type="button"
              onClick={toggleDvrRecording}
              className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/90 px-3 py-1 text-[11px] font-bold text-white shadow-lg luma-tabular"
              title="Stop & save recording"
            >
              <span className="h-2 w-2 rounded-full bg-white animate-luma-live" />
              <span>REC {fmtRecTimer(recSeconds)}</span>
            </button>
          )}

          {telemetry.engine === 'Tauri Rust · FFmpeg Remux' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/20 px-2.5 py-1 text-[10px] font-semibold text-emerald-200 ring-1 ring-emerald-400/35">
              <Cpu className="h-3 w-3" />
              <span>
                {telemetry.activeTranscodeMode === 'hw'
                  ? 'VideoToolbox HW'
                  : 'FFmpeg AAC Remux'}
              </span>
            </span>
          )}

          {audioPreset !== 'direct' && (
            <span className="hidden items-center gap-1 rounded-full bg-sky-400/20 px-2.5 py-1 text-[10px] font-semibold text-sky-200 ring-1 ring-sky-400/35 md:inline-flex">
              <Sliders className="h-3 w-3" />
              {AUDIO_DSP_PRESETS[audioPreset].label}
            </span>
          )}

          {isOnDemandVod && onBackToCatalog && (
            <button
              type="button"
              onClick={onBackToCatalog}
              className={
                isM3
                  ? 'm3-secondary-tonal inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold'
                  : 'lg-capsule inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium text-sky-200'
              }
            >
              <ArrowLeft className="h-3 w-3" />
              <span>{onDemandMeta?.backLabel || t.navVod}</span>
            </button>
          )}

          {isSeekable && onExitTimeshift && (
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
              <span>{t.backToLive}</span>
            </button>
          )}
        </div>

        {/* Bottom HUD (Auto-hides cleanly in Cinema Live TV mode when pointer is idle) */}
        <div
          onMouseEnter={() => setHudHovered(true)}
          onMouseLeave={() => setHudHovered(false)}
          className={`transition-all duration-300 ${
            showChrome
              ? 'translate-y-0 opacity-100'
              : 'pointer-events-none translate-y-2 opacity-0'
          } ${
            isM3
              ? 'absolute inset-x-3 bottom-3 z-20 rounded-[24px] bg-[#161B28]/95 px-4 py-3 shadow-xl ring-1 ring-white/[0.06]'
              : 'lg-pane absolute inset-x-3.5 bottom-3 z-20 rounded-[22px] px-4 py-2.5'
          }`}
        >
          {isSeekable ? (
            <div className="mb-2.5 flex items-center gap-3 text-[10px] text-slate-200 luma-tabular">
              <span className="font-semibold text-sky-300">
                {formatPlaybackClock(mediaPositionSec)}
              </span>
              <input
                id="slider-vod-scrubber"
                type="range"
                min={0}
                max={Math.max(1, effectiveDurationSec)}
                step={1}
                value={Math.min(mediaPositionSec, Math.max(1, effectiveDurationSec))}
                onChange={(e) => seekToSeconds(Number(e.target.value))}
                className="h-1.5 flex-1 cursor-pointer accent-sky-400"
                aria-label="Timeline Scrubber"
              />
              <span className="text-slate-300/90">
                -{formatPlaybackClock(Math.max(0, effectiveDurationSec - mediaPositionSec))} /{' '}
                {formatPlaybackClock(effectiveDurationSec)}
              </span>
            </div>
          ) : (
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
          )}

          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            {/* Media / Channel Identity (switches cleanly between Live TV and On-Demand Movies/Series) */}
            <div className="flex min-w-[200px] flex-1 items-center gap-2.5 overflow-hidden">
              <div
                className={
                  isM3
                    ? 'flex h-11 min-w-14 shrink-0 flex-col items-center justify-center rounded-[16px] bg-[#232B3D] px-2 text-center'
                    : 'lg-capsule flex h-10 min-w-13 shrink-0 flex-col items-center justify-center rounded-[14px] px-2 text-center'
                }
              >
                <span className="whitespace-nowrap text-[9px] font-semibold uppercase text-slate-400 luma-tabular">
                  {isOnDemandVod
                    ? (onDemandMeta?.badgeTop ?? 'VOD')
                    : `#${String(channel.number).padStart(3, '0')}`}
                </span>
                <span className="whitespace-nowrap text-[11px] font-bold tracking-tight text-white luma-tabular">
                  {isOnDemandVod
                    ? (onDemandMeta?.badgeCode ?? 'FILM')
                    : channel.shortCode}
                </span>
              </div>

              <div className="min-w-0 flex-1 overflow-hidden">
                <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                  <h1 className="min-w-0 truncate text-sm font-semibold tracking-[-0.01em] text-white">
                    {isOnDemandVod ? displayTitle : channel.name}
                  </h1>
                  <span
                    className={
                      isM3
                        ? 'hidden shrink-0 whitespace-nowrap rounded-full bg-[#29354D] px-2 py-0.5 text-[10px] font-semibold text-[#D6E3FF] @3xl:inline-block'
                        : 'hidden shrink-0 whitespace-nowrap rounded-full bg-white/12 px-2 py-0.5 text-[10px] font-medium text-white/85 @3xl:inline-block'
                    }
                  >
                    {isOnDemandVod
                      ? (onDemandMeta?.techBadge ?? resolutionLabel)
                      : channel.audioBadge}
                  </span>
                  <button
                    id="btn-hud-favorite"
                    type="button"
                    onClick={() =>
                      onToggleFavorite(
                        isOnDemandVod && onDemandMeta
                          ? onDemandMeta.favoriteTargetId
                          : channel.id
                      )
                    }
                    className="shrink-0 p-0.5 text-slate-300 transition hover:text-amber-300"
                    title={t.favorites}
                  >
                    <Star
                      className={`h-4 w-4 ${
                        isFavorite ? 'fill-amber-400 text-amber-400' : ''
                      }`}
                    />
                  </button>
                </div>
                {isOnDemandVod ? (
                  <p className="truncate text-xs text-slate-300/90">
                    {displaySubtitle}
                  </p>
                ) : (
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
                )}
              </div>
            </div>

            {/* Transport, DVR, Audio DSP & Spatial Controls (Container-responsive, never overlaps Identity) */}
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              {!isOnDemandVod && (
                <div
                  className={
                    isM3
                      ? 'hidden shrink-0 items-center rounded-full bg-[#232B3D] p-1 @sm:flex'
                      : 'lg-capsule hidden shrink-0 items-center rounded-full p-0.5 @sm:flex'
                  }
                >
                  <button
                    id="btn-zap-prev"
                    type="button"
                    onClick={onPrevChannel}
                    className="rounded-full p-1.5 text-slate-200 transition hover:bg-white/10 hover:text-white"
                    title="Previous channel"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <span className="px-1 text-[10px] font-semibold text-slate-300">CH</span>
                  <button
                    id="btn-zap-next"
                    type="button"
                    onClick={onNextChannel}
                    className="rounded-full p-1.5 text-slate-200 transition hover:bg-white/10 hover:text-white"
                    title="Next channel"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {isSeekable && (
                <button
                  id="btn-skip-back-10"
                  type="button"
                  onClick={() => skipRelativeSeconds(-10)}
                  className={
                    isM3
                      ? 'm3-secondary-tonal flex h-10 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold luma-tabular'
                      : 'lg-capsule flex h-9 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium text-white/90 luma-tabular'
                  }
                  title={t.skipBack10}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span className="hidden @lg:inline">10s</span>
                </button>
              )}

              <button
                id="btn-play-pause"
                type="button"
                onClick={togglePlay}
                className={
                  isM3
                    ? `m3-primary-pill flex h-10 w-12 shrink-0 items-center justify-center ${
                        isPlaying ? 'rounded-[14px]' : 'rounded-full'
                      }`
                    : 'lg-pill-active flex h-9 w-9 shrink-0 items-center justify-center rounded-full'
                }
                title={isPlaying ? 'Pause' : t.playNow}
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>

              {isSeekable && (
                <button
                  id="btn-skip-fwd-10"
                  type="button"
                  onClick={() => skipRelativeSeconds(10)}
                  className={
                    isM3
                      ? 'm3-secondary-tonal flex h-10 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold luma-tabular'
                      : 'lg-capsule flex h-9 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium text-white/90 luma-tabular'
                  }
                  title={t.skipFwd10}
                >
                  <span className="hidden @lg:inline">10s</span>
                  <RotateCw className="h-3.5 w-3.5" />
                </button>
              )}

              {nextEpisodeLabel && onPlayNextEpisode && (
                <button
                  id="btn-next-episode"
                  type="button"
                  onClick={onPlayNextEpisode}
                  className={
                    isM3
                      ? 'm3-secondary-tonal hidden h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold text-[#C4E8FF] @xl:inline-flex'
                      : 'lg-capsule hidden h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold text-sky-200 @xl:inline-flex'
                  }
                  title={`${t.nextEpisode}: ${nextEpisodeLabel}`}
                >
                  <SkipForward className="h-3.5 w-3.5" />
                  <span>{nextEpisodeLabel}</span>
                </button>
              )}

              {/* Live DVR Record Button */}
              <button
                id="btn-dvr-record"
                type="button"
                onClick={toggleDvrRecording}
                className={`flex shrink-0 items-center justify-center rounded-full transition ${
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
                    ? 'Stop & save recording'
                    : 'Start live recording'
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
                    ? 'flex h-10 shrink-0 items-center gap-2 rounded-full bg-[#232B3D] px-3'
                    : 'lg-capsule flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5'
                }
              >
                <button
                  id="btn-mute-toggle"
                  type="button"
                  onClick={toggleMute}
                  className="shrink-0 text-slate-100 hover:text-white"
                  title="Mute / Unmute"
                >
                  {effectiveMuted ? (
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
                  value={effectiveMuted ? 0 : volume}
                  onChange={(e) => handleVolumeChange(Number(e.target.value))}
                  className="hidden h-1 w-14 cursor-pointer accent-sky-400 @lg:block"
                  aria-label="Volume"
                />
              </div>

              {/* Aspect Ratio */}
              <button
                id="btn-aspect-ratio"
                type="button"
                onClick={cycleAspect}
                className={
                  isM3
                    ? 'm3-secondary-tonal hidden h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold @3xl:inline-flex luma-tabular'
                    : 'lg-capsule hidden h-9 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium text-white/90 @3xl:inline-flex luma-tabular'
                }
                title="Aspect Ratio"
              >
                <Expand className="h-3.5 w-3.5" />
                <span>{aspectMode.toUpperCase()}</span>
              </button>

              {/* Quality, Audio DSP, Audio Tracks & Subtitles Menu */}
              <div className="relative shrink-0">
                <button
                  id="btn-stream-settings"
                  type="button"
                  onClick={() => setShowQualityMenu((v) => !v)}
                  className={
                    isM3
                      ? 'm3-secondary-tonal flex h-10 items-center justify-center gap-1.5 rounded-full px-3 text-[11px] font-semibold'
                      : 'lg-capsule flex h-9 items-center justify-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium text-white/90'
                  }
                  title="Quality, Audio DSP & Subtitles"
                >
                  <Settings2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="hidden whitespace-nowrap @4xl:inline">DSP &amp; Spuren</span>
                </button>

                {showQualityMenu && (
                  <div
                    className={`luma-scroll absolute right-0 bottom-12 z-30 max-h-[420px] w-80 overflow-y-auto p-3.5 text-xs ${
                      isM3
                        ? 'rounded-[24px] bg-[#232B3D] shadow-2xl ring-1 ring-white/10'
                        : 'lg-modal rounded-[22px]'
                    }`}
                  >
                    {/* In-Window Native FFmpeg Remux / VideoToolbox Engine */}
                    {proxyConfig.ffmpegAvailable && (
                      <>
                        <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                          <span>In-Window Native Playback</span>
                          <Cpu className="h-3 w-3" />
                        </div>
                        <div className="grid grid-cols-3 gap-1">
                          {(
                            [
                              ['auto', 'Auto MSE'],
                              ['remux', 'Dolby AAC'],
                              ['hw', 'HW Decode'],
                            ] as [NativeTranscodeMode, string][]
                          ).map(([mode, label]) => {
                            const active = (telemetry.activeTranscodeMode ?? 'auto') === mode;
                            return (
                              <button
                                key={mode}
                                type="button"
                                onClick={() => handleSelectTranscodeMode(mode)}
                                className={`rounded-xl px-2 py-1.5 text-center text-[11px] font-semibold transition ${
                                  active
                                    ? isM3
                                      ? 'm3-tonal-active'
                                      : 'lg-pill-active'
                                    : 'bg-white/[0.05] text-slate-200 hover:bg-white/15'
                                }`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                        <div className="my-2.5 border-t border-white/10" />
                      </>
                    )}

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
                    <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-300">
                      <span>Subtitles / External .SRT &amp; .VTT</span>
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
                        <span>{t.sleepOff}</span>
                      </button>
                      {telemetry.subtitleTracks.map((sub) => (
                        <button
                          key={sub.index}
                          type="button"
                          onClick={() => {
                            engineRef.current?.setSubtitleTrack(sub.index);
                            setShowQualityMenu(false);
                          }}
                          className={`flex w-full items-center justify-between gap-2 rounded-full px-3 py-1.5 text-left ${
                            telemetry.currentSubtitleTrack === sub.index
                              ? isM3
                                ? 'm3-tonal-active font-semibold'
                                : 'lg-pill-active'
                              : 'text-slate-200 hover:bg-white/10'
                          }`}
                        >
                          <span className="truncate">{sub.name}</span>
                          <span className="shrink-0 text-[10px] uppercase opacity-70">
                            {sub.lang}
                          </span>
                        </button>
                      ))}
                    </div>

                    {/* Load Local .SRT / .VTT / .ASS + Remote Subtitle URL + Sync Offset */}
                    <div className="mt-2.5 space-y-2 rounded-2xl bg-black/25 p-2.5">
                      <div className="flex items-center gap-1.5">
                        <label
                          className={`flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-semibold ${
                            isM3 ? 'm3-secondary-tonal' : 'lg-capsule text-sky-200'
                          }`}
                        >
                          <FileUp className="h-3.5 w-3.5 shrink-0" />
                          <span>Load .SRT / .VTT</span>
                          <input
                            type="file"
                            accept=".srt,.vtt,.ass,.ssa"
                            onChange={handleSubtitleFileInputChange}
                            className="hidden"
                          />
                        </label>

                        <a
                          href={`https://www.opensubtitles.org/en/search2/sublanguageid-${
                            locale === 'de'
                              ? 'ger'
                              : locale === 'gr'
                                ? 'ell'
                                : locale === 'it'
                                  ? 'ita'
                                  : locale === 'fr'
                                    ? 'fre'
                                    : locale === 'es'
                                      ? 'spa'
                                      : 'eng'
                          }/moviename-${encodeURIComponent(
                            displayTitle.replace(/\(\d{4}\)/g, '').trim()
                          )}`}
                          target="_blank"
                          rel="noreferrer"
                          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-semibold ${
                            isM3 ? 'm3-secondary-tonal' : 'lg-capsule text-slate-200'
                          }`}
                          title="Find subtitles on OpenSubtitles"
                        >
                          <ExternalLink className="h-3 w-3" />
                          <span>Find</span>
                        </a>
                      </div>

                      <div className="flex items-center gap-1">
                        <div className="relative flex-1">
                          <Link2 className="pointer-events-none absolute left-2.5 top-2 h-3 w-3 text-slate-400" />
                          <input
                            type="url"
                            value={subtitleUrlInput}
                            onChange={(e) => setSubtitleUrlInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                void handleLoadRemoteSubtitleUrl();
                              }
                            }}
                            placeholder="Paste .srt / .vtt URL…"
                            className="h-7 w-full rounded-full bg-white/10 pl-7 pr-2 text-[11px] text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
                          />
                        </div>
                        <button
                          type="button"
                          disabled={!subtitleUrlInput.trim()}
                          onClick={() => void handleLoadRemoteSubtitleUrl()}
                          className={`rounded-full px-2.5 py-1 text-[10px] font-bold disabled:opacity-40 ${
                            isM3 ? 'm3-primary-pill' : 'lg-pill-active'
                          }`}
                        >
                          Add
                        </button>
                      </div>

                      {/* Timing Offset (-0.5s / +0.5s) */}
                      <div className="flex items-center justify-between pt-0.5 text-[11px] text-slate-300 luma-tabular">
                        <span>Sync Offset</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              engineRef.current?.setSubtitleOffset(
                                (telemetry.subtitleOffsetSec ?? 0) - 0.5
                              )
                            }
                            className="rounded-full bg-white/10 p-1 hover:bg-white/20"
                            title="-0.5s"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => engineRef.current?.setSubtitleOffset(0)}
                            className="min-w-12 rounded-full bg-white/10 px-2 py-0.5 text-center text-[10px] font-semibold hover:bg-white/20"
                            title="Reset offset"
                          >
                            {(telemetry.subtitleOffsetSec ?? 0) > 0 ? '+' : ''}
                            {(telemetry.subtitleOffsetSec ?? 0).toFixed(1)}s
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              engineRef.current?.setSubtitleOffset(
                                (telemetry.subtitleOffsetSec ?? 0) + 0.5
                              )
                            }
                            className="rounded-full bg-white/10 p-1 hover:bg-white/20"
                            title="+0.5s"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
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
                      ? 'm3-secondary-tonal hidden h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold text-[#C4E8FF] @md:inline-flex'
                      : 'lg-capsule hidden h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold text-sky-200 @md:inline-flex'
                  }
                  title={t.mpvLaunchTitle}
                >
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  <span className="hidden @2xl:inline">{t.mpvLaunchBtn}</span>
                </button>
              )}

              {/* In-App Floating PiP */}
              <button
                id="btn-inapp-pip"
                type="button"
                onClick={onDetachInAppPip}
                className={
                  isM3
                    ? 'm3-secondary-tonal hidden h-10 w-10 shrink-0 items-center justify-center rounded-full @md:flex'
                    : 'lg-capsule hidden h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/90 @md:flex'
                }
                title="Open Mini Player"
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
                    ? 'm3-secondary-tonal hidden h-10 w-10 shrink-0 items-center justify-center rounded-full @3xl:flex'
                    : 'lg-capsule hidden h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/90 @3xl:flex'
                }
                title="System Picture-in-Picture"
              >
                <PictureInPicture2 className="h-3.5 w-3.5" />
              </button>

              {/* Theater Toggle (only in EPG split view when not in Fullscreen) */}
              {layoutVariant === 'split' && !effectiveFullscreen && (
                <button
                  id="btn-theater-height"
                  type="button"
                  onClick={onToggleTheaterExpanded}
                  className={
                    isM3
                      ? 'm3-secondary-tonal flex h-10 w-10 shrink-0 items-center justify-center rounded-full'
                      : 'lg-capsule flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/90'
                  }
                  title={theaterExpanded ? 'Compact EPG split' : 'Expand stage'}
                >
                  {theaterExpanded ? (
                    <Minimize2 className="h-3.5 w-3.5" />
                  ) : (
                    <Maximize2 className="h-3.5 w-3.5" />
                  )}
                </button>
              )}

              {/* Fullscreen */}
              <button
                id="btn-fullscreen"
                type="button"
                onClick={() => void handleFullscreen()}
                aria-pressed={effectiveFullscreen}
                className={
                  isM3
                    ? `${
                        effectiveFullscreen ? 'm3-tonal-active' : 'm3-secondary-tonal'
                      } inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full px-3 text-[11px] font-semibold`
                    : `${
                        effectiveFullscreen ? 'lg-pill-active' : 'lg-capsule text-white/90'
                      } inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium`
                }
                title={t.fullscreen}
              >
                {effectiveFullscreen ? (
                  <Minimize2 className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="hidden whitespace-nowrap @4xl:inline">{t.fullscreen}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
