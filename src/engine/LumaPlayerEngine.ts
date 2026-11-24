import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import {
  buildProxiedStreamUrl,
  buildRustTranscodeStreamUrl,
  detectStreamDriver,
  isLocalRustProxyEndpoint,
  isNonNativeBrowserContainer,
  resolveBufferProfileSettings,
  shouldProactivelyProxyStream,
  type StreamDriverKind,
} from './corsProxy';
import {
  convertSubtitleToWebVtt,
  type ExternalSubtitleEntry,
} from '../services/subtitleConverter';
import type {
  EngineProxyConfig,
  NativeTranscodeMode,
  QualityLevelOption,
  StreamTelemetry,
  SubtitleTrackOption,
} from '../types/luma';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function isTauriNativeRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
}

const EXTERNAL_SUB_BASE_INDEX = 1000;

const INITIAL_TELEMETRY: StreamTelemetry = {
  engine: 'WebHLS · MSE Worker',
  state: 'idle',
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
  subtitleOffsetSec: 0,
  activeSubtitleText: '',
  activeTranscodeMode: 'auto',
  proxyActive: false,
};

interface AttachedExternalSubtitle extends ExternalSubtitleEntry {
  index: number;
  blobUrl: string;
  trackEl: HTMLTrackElement | null;
}

export class LumaPlayerEngine {
  private hls: Hls | null = null;
  private mpegtsPlayer: mpegts.Player | null = null;
  private video: HTMLVideoElement | null = null;
  private statsTimer: number | null = null;
  private fallbackTimer: number | null = null;
  private unlockAudioCleanup: (() => void) | null = null;
  private retriedWithProxy = false;
  private retriedTranscodeStage: 'none' | 'remux' | 'hw' = 'none';
  private userTranscodeMode: NativeTranscodeMode = 'auto';
  private lastLoadArgs: {
    rawStreamUrl: string;
    proxyConfig: EngineProxyConfig;
    autoPlay: boolean;
    explicitStreamType?: 'hls' | 'mpegts';
  } | null = null;

  private embeddedSubtitleTracks: SubtitleTrackOption[] = [];
  private externalSubtitles: AttachedExternalSubtitle[] = [];
  private subtitleOffsetSec = 0;

  private telemetry: StreamTelemetry = { ...INITIAL_TELEMETRY };
  private onTelemetry: (telemetry: StreamTelemetry) => void;

  constructor(onTelemetry: (telemetry: StreamTelemetry) => void) {
    this.onTelemetry = onTelemetry;
  }

  private emit(patch: Partial<StreamTelemetry>) {
    this.telemetry = { ...this.telemetry, ...patch };
    this.onTelemetry(this.telemetry);
  }

  private combinedSubtitleTracks(): SubtitleTrackOption[] {
    const extOptions: SubtitleTrackOption[] = this.externalSubtitles.map((ext) => ({
      index: ext.index,
      name: ext.name,
      lang: ext.lang,
      isExternal: true,
      id: ext.id,
    }));
    return [...this.embeddedSubtitleTracks, ...extOptions];
  }

  private mountExternalTracksOnVideo(video: HTMLVideoElement) {
    for (const ext of this.externalSubtitles) {
      if (ext.trackEl && ext.trackEl.parentElement === video) continue;
      if (ext.trackEl && ext.trackEl.parentElement) {
        ext.trackEl.parentElement.removeChild(ext.trackEl);
      }
      const trackEl = document.createElement('track');
      trackEl.kind = 'subtitles';
      trackEl.label = ext.name;
      trackEl.srclang = ext.lang;
      trackEl.src = ext.blobUrl;
      video.appendChild(trackEl);
      ext.trackEl = trackEl;

      const textTrack = trackEl.track;
      const isSelected = this.telemetry.currentSubtitleTrack === ext.index;
      textTrack.mode = isSelected ? 'hidden' : 'disabled';
      textTrack.oncuechange = () => {
        if (this.telemetry.currentSubtitleTrack !== ext.index) return;
        const activeCues = textTrack.activeCues;
        if (!activeCues || activeCues.length === 0) {
          this.emit({ activeSubtitleText: '' });
          return;
        }
        const lines: string[] = [];
        for (let i = 0; i < activeCues.length; i++) {
          const cue = activeCues[i] as VTTCue;
          if (cue && typeof cue.text === 'string' && cue.text.trim()) {
            lines.push(cue.text.trim());
          }
        }
        this.emit({ activeSubtitleText: lines.join('\n') });
      };
    }
  }

  public addExternalSubtitle(params: {
    name: string;
    lang: string;
    rawText: string;
    selectImmediately?: boolean;
  }): number {
    const vttText = convertSubtitleToWebVtt(params.rawText, this.subtitleOffsetSec);
    const blob = new Blob([vttText], { type: 'text/vtt;charset=utf-8' });
    const blobUrl =
      typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
        ? URL.createObjectURL(blob)
        : '';
    const nextIndex = EXTERNAL_SUB_BASE_INDEX + this.externalSubtitles.length;
    const entry: AttachedExternalSubtitle = {
      id: `ext-sub-${Date.now()}-${this.externalSubtitles.length}`,
      index: nextIndex,
      name: params.name,
      lang: params.lang,
      rawText: params.rawText,
      blobUrl,
      trackEl: null,
    };
    this.externalSubtitles.push(entry);

    if (this.video) {
      this.mountExternalTracksOnVideo(this.video);
    }

    const merged = this.combinedSubtitleTracks();
    this.emit({ subtitleTracks: merged });

    if (params.selectImmediately !== false) {
      this.setSubtitleTrack(nextIndex);
    }

    return nextIndex;
  }

  public setSubtitleOffset(offsetSec: number) {
    const clamped = Math.max(-15, Math.min(15, Number(offsetSec.toFixed(1))));
    this.subtitleOffsetSec = clamped;

    for (const ext of this.externalSubtitles) {
      if (ext.blobUrl && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(ext.blobUrl);
      }
      const vttText = convertSubtitleToWebVtt(ext.rawText, clamped);
      const blob = new Blob([vttText], { type: 'text/vtt;charset=utf-8' });
      ext.blobUrl =
        typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function'
          ? URL.createObjectURL(blob)
          : '';
      if (ext.trackEl) {
        if (ext.trackEl.parentElement) {
          ext.trackEl.parentElement.removeChild(ext.trackEl);
        }
        ext.trackEl = null;
      }
    }

    if (this.video) {
      this.mountExternalTracksOnVideo(this.video);
    }

    this.emit({ subtitleOffsetSec: clamped });
  }

  public clearExternalSubtitles() {
    for (const ext of this.externalSubtitles) {
      if (ext.trackEl && ext.trackEl.parentElement) {
        ext.trackEl.parentElement.removeChild(ext.trackEl);
      }
      if (ext.blobUrl && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(ext.blobUrl);
      }
    }
    this.externalSubtitles = [];
    this.subtitleOffsetSec = 0;
    this.emit({
      subtitleTracks: this.combinedSubtitleTracks(),
      subtitleOffsetSec: 0,
      activeSubtitleText: '',
      ...(this.telemetry.currentSubtitleTrack >= EXTERNAL_SUB_BASE_INDEX
        ? { currentSubtitleTrack: -1 }
        : {}),
    });
  }

  public setTranscodeMode(mode: NativeTranscodeMode) {
    this.userTranscodeMode = mode;
    this.retriedTranscodeStage = 'none';
    if (this.video && this.lastLoadArgs) {
      const resumeAt =
        this.video.currentTime && Number.isFinite(this.video.currentTime)
          ? this.video.currentTime
          : 0;
      const { rawStreamUrl, proxyConfig, autoPlay, explicitStreamType } = this.lastLoadArgs;
      this.loadInternal(
        this.video,
        rawStreamUrl,
        { ...proxyConfig, transcodeMode: mode },
        autoPlay,
        explicitStreamType,
        false,
        mode === 'auto' ? 'none' : mode,
        resumeAt
      );
    } else {
      this.emit({ activeTranscodeMode: mode });
    }
  }

  /**
   * Starts playback while preserving the caller's desired `video.muted` state.
   * Never mutes on `AbortError` (which fires routinely during channel zapping / MSE swaps).
   */
  private attemptPlayRespectingMute(
    video: HTMLVideoElement,
    desiredMuted: boolean,
    playAction?: () => Promise<void> | void
  ) {
    video.muted = desiredMuted;
    const playPromise = Promise.resolve(playAction ? playAction() : video.play());
    playPromise.catch((err: unknown) => {
      const errName =
        err && typeof err === 'object' && 'name' in err
          ? String((err as { name?: unknown }).name)
          : '';

      if (errName === 'NotAllowedError' && !desiredMuted) {
        video.muted = true;
        Promise.resolve(playAction ? playAction() : video.play()).catch(() => undefined);

        if (typeof window !== 'undefined' && !this.unlockAudioCleanup) {
          const unlock = () => {
            if (this.video) {
              this.video.muted = false;
            }
            this.unlockAudioCleanup?.();
          };
          window.addEventListener('pointerdown', unlock, { once: true, capture: true });
          window.addEventListener('keydown', unlock, { once: true, capture: true });
          this.unlockAudioCleanup = () => {
            window.removeEventListener('pointerdown', unlock, { capture: true });
            window.removeEventListener('keydown', unlock, { capture: true });
            this.unlockAudioCleanup = null;
          };
        }
      }
    });
  }

  public load(
    video: HTMLVideoElement,
    rawStreamUrl: string,
    proxyConfig: EngineProxyConfig = { enabled: false, endpointUrl: '' },
    autoPlay = true,
    explicitStreamType?: 'hls' | 'mpegts'
  ) {
    const streamChanged = this.lastLoadArgs?.rawStreamUrl !== rawStreamUrl;
    if (streamChanged) {
      this.clearExternalSubtitles();
      this.userTranscodeMode = proxyConfig.transcodeMode ?? 'auto';
    }
    this.lastLoadArgs = {
      rawStreamUrl,
      proxyConfig,
      autoPlay,
      explicitStreamType,
    };
    this.retriedWithProxy = false;
    this.retriedTranscodeStage = 'none';
    const initialForced =
      this.userTranscodeMode === 'auto' ? 'none' : this.userTranscodeMode;
    this.loadInternal(
      video,
      rawStreamUrl,
      proxyConfig,
      autoPlay,
      explicitStreamType,
      false,
      initialForced,
      0
    );
  }

  private tryEscalateToRustFfmpeg(
    video: HTMLVideoElement,
    rawStreamUrl: string,
    proxyConfig: EngineProxyConfig,
    autoPlay: boolean,
    explicitStreamType: 'hls' | 'mpegts' | undefined,
    canUseRustFfmpeg: boolean
  ): boolean {
    if (!canUseRustFfmpeg) return false;
    if (this.retriedTranscodeStage === 'none') {
      this.retriedTranscodeStage = 'remux';
      this.loadInternal(
        video,
        rawStreamUrl,
        proxyConfig,
        autoPlay,
        explicitStreamType,
        true,
        'remux',
        0
      );
      return true;
    }
    if (this.retriedTranscodeStage === 'remux') {
      this.retriedTranscodeStage = 'hw';
      this.loadInternal(
        video,
        rawStreamUrl,
        proxyConfig,
        autoPlay,
        explicitStreamType,
        true,
        'hw',
        0
      );
      return true;
    }
    return false;
  }

  private loadInternal(
    video: HTMLVideoElement,
    rawStreamUrl: string,
    proxyConfig: EngineProxyConfig,
    autoPlay: boolean,
    explicitStreamType: 'hls' | 'mpegts' | undefined,
    forceProxy: boolean,
    transcodeStage: 'none' | 'remux' | 'hw',
    startOffsetSec: number
  ) {
    const desiredMuted = video.muted;
    this.destroyDriversOnly();
    this.video = video;
    video.muted = desiredMuted;
    this.embeddedSubtitleTracks = [];

    const hasLocalRustEndpoint = isLocalRustProxyEndpoint(proxyConfig.endpointUrl);
    const canUseRustFfmpeg = Boolean(
      hasLocalRustEndpoint && proxyConfig.ffmpegAvailable
    );

    // Proactively remux .mkv / .avi / .flv containers via zero-CPU FFmpeg remux when available
    let activeTranscode: 'none' | 'remux' | 'hw' = transcodeStage;
    if (
      activeTranscode === 'none' &&
      canUseRustFfmpeg &&
      isNonNativeBrowserContainer(rawStreamUrl)
    ) {
      activeTranscode = 'remux';
      this.retriedTranscodeStage = 'remux';
    }

    const useProxy =
      activeTranscode !== 'none' ||
      forceProxy ||
      shouldProactivelyProxyStream(rawStreamUrl, proxyConfig);
    const effectiveProxy: EngineProxyConfig = useProxy
      ? { ...proxyConfig, enabled: true }
      : proxyConfig;
    const isProxied = Boolean(
      effectiveProxy.enabled && effectiveProxy.endpointUrl && effectiveProxy.endpointUrl.trim()
    );
    const isRustLoopback =
      isProxied && isLocalRustProxyEndpoint(effectiveProxy.endpointUrl);

    let finalUrl: string;
    let driver: StreamDriverKind;
    if (activeTranscode === 'remux' && isRustLoopback) {
      finalUrl = buildRustTranscodeStreamUrl(
        rawStreamUrl,
        effectiveProxy,
        'remux',
        startOffsetSec
      );
      driver = 'mpegts';
    } else if (activeTranscode === 'hw' && isRustLoopback) {
      finalUrl = buildRustTranscodeStreamUrl(
        rawStreamUrl,
        effectiveProxy,
        'hw',
        startOffsetSec
      );
      driver = 'progressive';
    } else {
      finalUrl = buildProxiedStreamUrl(rawStreamUrl, effectiveProxy);
      driver = detectStreamDriver(rawStreamUrl, explicitStreamType);
    }

    const bufferTuning = resolveBufferProfileSettings(effectiveProxy.bufferProfile);

    const engineLabel: StreamTelemetry['engine'] =
      activeTranscode !== 'none'
        ? 'Tauri Rust · FFmpeg Remux'
        : isRustLoopback
          ? driver === 'mpegts'
            ? 'Tauri Rust · MPEG-TS'
            : 'Tauri Rust · HLS MSE'
          : driver === 'mpegts'
            ? 'MPEG-TS · MSE Worker'
            : 'WebHLS · MSE Worker';

    this.mountExternalTracksOnVideo(video);

    this.emit({
      ...INITIAL_TELEMETRY,
      engine: engineLabel,
      state: 'connecting',
      subtitleTracks: this.combinedSubtitleTracks(),
      currentSubtitleTrack:
        this.telemetry.currentSubtitleTrack >= EXTERNAL_SUB_BASE_INDEX
          ? this.telemetry.currentSubtitleTrack
          : -1,
      subtitleOffsetSec: this.subtitleOffsetSec,
      activeTranscodeMode:
        activeTranscode === 'none' ? this.userTranscodeMode : activeTranscode,
      proxyActive: isProxied,
      proxyMode: isProxied ? (isRustLoopback ? 'local-rust' : 'cloud-edge') : 'none',
      errorMessage: undefined,
    });

    const fallbackDelayMs = activeTranscode !== 'none' ? 8500 : 3400;

    // Graceful Studio Synth Fallback if external media CDN is blocked by sandbox/firewall
    this.fallbackTimer = window.setTimeout(() => {
      if (this.telemetry.state !== 'playing') {
        if (
          this.tryEscalateToRustFfmpeg(
            video,
            rawStreamUrl,
            proxyConfig,
            autoPlay,
            explicitStreamType,
            canUseRustFfmpeg
          )
        ) {
          return;
        }
        this.emit({
          engine: 'Luma Studio Synth',
          state: 'synth-fallback',
          width: 3840,
          height: 2160,
          bitrateKbps: 14800,
          bufferSec: 12.0,
          levels: [
            { index: 0, height: 2160, bitrateKbps: 14800, label: '2160p · 14.8 Mbps' },
            { index: 1, height: 1080, bitrateKbps: 6800, label: '1080p · 6.8 Mbps' },
          ],
          audioTracks: [{ index: 0, name: 'Studio Master 5.1', lang: 'de' }],
          subtitleTracks:
            this.externalSubtitles.length > 0
              ? this.combinedSubtitleTracks()
              : [{ index: 0, name: 'Deutsch (DVB/VTT)', lang: 'de' }],
        });
      }
    }, fallbackDelayMs);

    const markPlaying = () => {
      if (!video.muted && this.unlockAudioCleanup) {
        this.unlockAudioCleanup();
      }
      if (this.fallbackTimer !== null) {
        window.clearTimeout(this.fallbackTimer);
        this.fallbackTimer = null;
      }
      this.emit({
        engine: engineLabel,
        state: 'playing',
        width: video.videoWidth || this.telemetry.width,
        height: video.videoHeight || this.telemetry.height,
      });
    };

    video.onplaying = markPlaying;
    video.onloadeddata = () => {
      if (autoPlay && video.paused) {
        this.attemptPlayRespectingMute(video, desiredMuted);
      }
      if (!video.paused) markPlaying();
    };
    video.onwaiting = () => {
      if (this.telemetry.state === 'playing') {
        this.emit({ state: 'buffering' });
      }
    };

    // 1. MPEG-TS Live / Remux Driver (mpegts.js + MSE Worker)
    if (driver === 'mpegts' && mpegts.isSupported()) {
      const player = mpegts.createPlayer(
        {
          type: 'mpegts',
          isLive: startOffsetSec <= 0,
          cors: true,
          url: finalUrl,
        },
        {
          enableWorker: true,
          enableStashBuffer: bufferTuning.mpegtsStashKB >= 512,
          stashInitialSize: bufferTuning.mpegtsStashKB * 1024,
          liveBufferLatencyChasing: activeTranscode === 'none',
          liveBufferLatencyMaxLatency: bufferTuning.mpegtsMaxLatency,
          liveBufferLatencyMinRemain: bufferTuning.mpegtsMinRemain,
        }
      );

      this.mpegtsPlayer = player;
      player.attachMediaElement(video);
      player.load();

      if (autoPlay) {
        this.attemptPlayRespectingMute(video, desiredMuted, () => player.play());
      }

      player.on(mpegts.Events.MEDIA_INFO, (info: { width?: number; height?: number }) => {
        this.emit({
          width: info.width || video.videoWidth || 1920,
          height: info.height || video.videoHeight || 1080,
          audioTracks: [
            {
              index: 0,
              name:
                activeTranscode !== 'none'
                  ? 'FFmpeg AAC Stereo Remux'
                  : 'MPEG-TS PID Audio',
              lang: 'live',
            },
          ],
        });
      });

      player.on(mpegts.Events.STATISTICS_INFO, (stats: { speed?: number }) => {
        if (typeof stats.speed === 'number') {
          this.emit({
            bitrateKbps: Math.round(stats.speed * 8),
          });
        }
      });

      player.on(mpegts.Events.ERROR, () => {
        if (
          !isProxied &&
          !this.retriedWithProxy &&
          proxyConfig.autoFallbackOnCors &&
          proxyConfig.endpointUrl.trim()
        ) {
          this.retriedWithProxy = true;
          this.loadInternal(
            video,
            rawStreamUrl,
            proxyConfig,
            autoPlay,
            explicitStreamType,
            true,
            'none',
            0
          );
          return;
        }
        if (
          this.tryEscalateToRustFfmpeg(
            video,
            rawStreamUrl,
            proxyConfig,
            autoPlay,
            explicitStreamType,
            canUseRustFfmpeg
          )
        ) {
          return;
        }
        this.emit({
          engine: 'Luma Studio Synth',
          state: 'synth-fallback',
        });
      });

      this.startTelemetryLoop();
      return;
    }

    // 2. Progressive MP4 / WebM / Hardware Transcoded fMP4 Driver
    if (driver === 'progressive') {
      video.onerror = () => {
        if (
          !isProxied &&
          !this.retriedWithProxy &&
          proxyConfig.autoFallbackOnCors &&
          proxyConfig.endpointUrl.trim()
        ) {
          this.retriedWithProxy = true;
          this.loadInternal(
            video,
            rawStreamUrl,
            proxyConfig,
            autoPlay,
            explicitStreamType,
            true,
            'none',
            0
          );
          return;
        }
        if (
          this.tryEscalateToRustFfmpeg(
            video,
            rawStreamUrl,
            proxyConfig,
            autoPlay,
            explicitStreamType,
            canUseRustFfmpeg
          )
        ) {
          return;
        }
        this.emit({
          engine: 'Luma Studio Synth',
          state: 'synth-fallback',
        });
      };
      video.src = finalUrl;
      if (autoPlay) {
        this.attemptPlayRespectingMute(video, desiredMuted);
      }
      this.startTelemetryLoop();
      return;
    }

    // 3. HLS Driver (hls.js + MSE Worker + Subtitles + Audio + ABR)
    if (Hls.isSupported()) {
      const customUa = effectiveProxy.customUserAgent?.trim();
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: bufferTuning.hlsLowLatencyMode,
        backBufferLength: bufferTuning.hlsBackBufferLength,
        maxBufferLength: bufferTuning.hlsMaxBufferLength,
        startLevel: -1,
        xhrSetup: (xhr) => {
          if (isProxied && customUa) {
            xhr.setRequestHeader('X-Luma-User-Agent', customUa);
          }
        },
      });

      this.hls = hls;
      hls.attachMedia(video);

      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        hls.loadSource(finalUrl);
      });

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        const levels: QualityLevelOption[] = data.levels.map((lvl, index) => ({
          index,
          height: lvl.height || 0,
          bitrateKbps: Math.round((lvl.bitrate || 0) / 1000),
          label: lvl.height
            ? `${lvl.height}p · ${(lvl.bitrate / 1_000_000).toFixed(1)} Mbps`
            : `${Math.round(lvl.bitrate / 1000)} kbps`,
        }));

        const audioTracks = hls.audioTracks.map((t, index) => ({
          index,
          name: t.name || `Track ${index + 1}`,
          lang: t.lang || 'und',
        }));

        this.embeddedSubtitleTracks = hls.subtitleTracks.map((s, index) => ({
          index,
          name: s.name || `Untertitel ${index + 1}`,
          lang: s.lang || 'und',
        }));

        this.emit({
          levels,
          currentLevel: hls.currentLevel,
          audioTracks:
            audioTracks.length > 0
              ? audioTracks
              : [{ index: 0, name: 'Master Stereo / Surround', lang: 'auto' }],
          currentAudioTrack: Math.max(0, hls.audioTrack),
          subtitleTracks: this.combinedSubtitleTracks(),
          currentSubtitleTrack:
            this.telemetry.currentSubtitleTrack >= EXTERNAL_SUB_BASE_INDEX
              ? this.telemetry.currentSubtitleTrack
              : hls.subtitleTrack,
        });

        if (autoPlay) {
          this.attemptPlayRespectingMute(video, desiredMuted);
        }
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        const lvl = hls.levels[data.level];
        if (lvl) {
          this.emit({
            width: lvl.width || video.videoWidth || this.telemetry.width,
            height: lvl.height || video.videoHeight || this.telemetry.height,
            bitrateKbps: Math.round((lvl.bitrate || 0) / 1000),
            currentLevel: hls.autoLevelEnabled ? -1 : data.level,
          });
        }
      });

      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_event, data) => {
        const audioTracks = data.audioTracks.map((t, index) => ({
          index,
          name: t.name || `Audio ${index + 1}`,
          lang: t.lang || 'auto',
        }));
        if (audioTracks.length > 0) {
          this.emit({
            audioTracks,
            currentAudioTrack: Math.max(0, hls.audioTrack),
          });
        }
      });

      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_event, data) => {
        this.embeddedSubtitleTracks = data.subtitleTracks.map((s, index) => ({
          index,
          name: s.name || `Untertitel ${index + 1}`,
          lang: s.lang || 'auto',
        }));
        this.emit({
          subtitleTracks: this.combinedSubtitleTracks(),
          currentSubtitleTrack:
            this.telemetry.currentSubtitleTrack >= EXTERNAL_SUB_BASE_INDEX
              ? this.telemetry.currentSubtitleTrack
              : hls.subtitleTrack,
        });
      });

      let mediaRecoveryAttempted = false;
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            if (
              !isProxied &&
              !this.retriedWithProxy &&
              proxyConfig.autoFallbackOnCors &&
              proxyConfig.endpointUrl.trim()
            ) {
              this.retriedWithProxy = true;
              this.loadInternal(
                video,
                rawStreamUrl,
                proxyConfig,
                autoPlay,
                explicitStreamType,
                true,
                'none',
                0
              );
              return;
            }
            if (
              this.tryEscalateToRustFfmpeg(
                video,
                rawStreamUrl,
                proxyConfig,
                autoPlay,
                explicitStreamType,
                canUseRustFfmpeg
              )
            ) {
              return;
            }
            this.emit({
              engine: 'Luma Studio Synth',
              state: 'synth-fallback',
              width: 3840,
              height: 2160,
              bitrateKbps: 14800,
              bufferSec: 12.0,
            });
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            if (!mediaRecoveryAttempted) {
              mediaRecoveryAttempted = true;
              hls.recoverMediaError();
              return;
            }
            if (
              this.tryEscalateToRustFfmpeg(
                video,
                rawStreamUrl,
                proxyConfig,
                autoPlay,
                explicitStreamType,
                canUseRustFfmpeg
              )
            ) {
              return;
            }
            this.emit({
              engine: 'Luma Studio Synth',
              state: 'synth-fallback',
            });
            break;
          default:
            if (
              this.tryEscalateToRustFfmpeg(
                video,
                rawStreamUrl,
                proxyConfig,
                autoPlay,
                explicitStreamType,
                canUseRustFfmpeg
              )
            ) {
              return;
            }
            this.emit({
              engine: 'Luma Studio Synth',
              state: 'synth-fallback',
            });
            hls.destroy();
            break;
        }
      });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      this.emit({
        engine: 'Native Safari HLS',
        audioTracks: [{ index: 0, name: 'System Audio', lang: 'auto' }],
      });
      video.src = finalUrl;
      if (autoPlay) {
        this.attemptPlayRespectingMute(video, desiredMuted);
      }
    } else {
      this.emit({
        engine: 'Luma Studio Synth',
        state: 'synth-fallback',
      });
    }

    this.startTelemetryLoop();
  }

  public setQualityLevel(levelIndex: number) {
    if (!this.hls) return;
    this.hls.currentLevel = levelIndex;
    this.emit({ currentLevel: levelIndex });
  }

  public setAudioTrack(trackIndex: number) {
    if (!this.hls) return;
    this.hls.audioTrack = trackIndex;
    this.emit({ currentAudioTrack: trackIndex });
  }

  public setSubtitleTrack(trackIndex: number) {
    const isExternal = trackIndex >= EXTERNAL_SUB_BASE_INDEX;
    if (this.hls) {
      if (isExternal || trackIndex < 0) {
        this.hls.subtitleTrack = -1;
        this.hls.subtitleDisplay = false;
      } else {
        this.hls.subtitleTrack = trackIndex;
        this.hls.subtitleDisplay = true;
      }
    }

    for (const ext of this.externalSubtitles) {
      if (!ext.trackEl) continue;
      ext.trackEl.track.mode = ext.index === trackIndex ? 'hidden' : 'disabled';
    }

    this.emit({
      currentSubtitleTrack: trackIndex,
      activeSubtitleText: '',
    });
  }

  private startTelemetryLoop() {
    if (this.statsTimer !== null) {
      window.clearInterval(this.statsTimer);
    }
    this.statsTimer = window.setInterval(() => {
      const video = this.video;
      if (!video || this.telemetry.state === 'synth-fallback') return;

      let bufferSec = 0;
      if (video.buffered.length > 0) {
        const end = video.buffered.end(video.buffered.length - 1);
        bufferSec = Math.max(0, Number((end - video.currentTime).toFixed(1)));
      }

      const latencySec =
        this.hls && typeof this.hls.latency === 'number' && Number.isFinite(this.hls.latency)
          ? Number(this.hls.latency.toFixed(1))
          : 0;

      const activeLevel =
        this.hls && this.hls.loadLevel >= 0 ? this.hls.levels[this.hls.loadLevel] : undefined;

      this.emit({
        width: video.videoWidth || activeLevel?.width || this.telemetry.width,
        height: video.videoHeight || activeLevel?.height || this.telemetry.height,
        bitrateKbps: activeLevel?.bitrate
          ? Math.round(activeLevel.bitrate / 1000)
          : this.telemetry.bitrateKbps,
        bufferSec,
        latencySec,
      });
    }, 1000);
  }

  public markExternalMpvSession() {
    if (this.unlockAudioCleanup) {
      this.unlockAudioCleanup();
    }
    if (this.fallbackTimer !== null) {
      window.clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    if (this.video) {
      this.video.pause();
    }
    this.emit({
      engine: 'Tauri v2 Native MPV',
      state: 'synth-fallback',
    });
  }

  private destroyDriversOnly() {
    if (this.unlockAudioCleanup) {
      this.unlockAudioCleanup();
    }
    if (this.fallbackTimer !== null) {
      window.clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    if (this.statsTimer !== null) {
      window.clearInterval(this.statsTimer);
      this.statsTimer = null;
    }
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (this.mpegtsPlayer) {
      this.mpegtsPlayer.unload();
      this.mpegtsPlayer.detachMediaElement();
      this.mpegtsPlayer.destroy();
      this.mpegtsPlayer = null;
    }
    if (this.video) {
      this.video.onplaying = null;
      this.video.onloadeddata = null;
      this.video.onwaiting = null;
      this.video.onerror = null;
    }
  }

  public destroy() {
    this.clearExternalSubtitles();
    this.destroyDriversOnly();
    this.video = null;
  }
}
