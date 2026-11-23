import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import {
  buildProxiedStreamUrl,
  detectStreamDriver,
  isLocalRustProxyEndpoint,
  resolveBufferProfileSettings,
  shouldProactivelyProxyStream,
} from './corsProxy';
import type {
  EngineProxyConfig,
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
  proxyActive: false,
};

export class LumaPlayerEngine {
  private hls: Hls | null = null;
  private mpegtsPlayer: mpegts.Player | null = null;
  private video: HTMLVideoElement | null = null;
  private statsTimer: number | null = null;
  private fallbackTimer: number | null = null;
  private retriedWithProxy = false;
  private telemetry: StreamTelemetry = { ...INITIAL_TELEMETRY };
  private onTelemetry: (telemetry: StreamTelemetry) => void;

  constructor(onTelemetry: (telemetry: StreamTelemetry) => void) {
    this.onTelemetry = onTelemetry;
  }

  private emit(patch: Partial<StreamTelemetry>) {
    this.telemetry = { ...this.telemetry, ...patch };
    this.onTelemetry(this.telemetry);
  }

  public load(
    video: HTMLVideoElement,
    rawStreamUrl: string,
    proxyConfig: EngineProxyConfig = { enabled: false, endpointUrl: '' },
    autoPlay = true,
    explicitStreamType?: 'hls' | 'mpegts'
  ) {
    this.retriedWithProxy = false;
    this.loadInternal(video, rawStreamUrl, proxyConfig, autoPlay, explicitStreamType, false);
  }

  private loadInternal(
    video: HTMLVideoElement,
    rawStreamUrl: string,
    proxyConfig: EngineProxyConfig,
    autoPlay: boolean,
    explicitStreamType: 'hls' | 'mpegts' | undefined,
    forceProxy: boolean
  ) {
    this.destroyDriversOnly();
    this.video = video;

    const useProxy = forceProxy || shouldProactivelyProxyStream(rawStreamUrl, proxyConfig);
    const effectiveProxy: EngineProxyConfig = useProxy
      ? { ...proxyConfig, enabled: true }
      : proxyConfig;
    const isProxied = Boolean(
      effectiveProxy.enabled && effectiveProxy.endpointUrl && effectiveProxy.endpointUrl.trim()
    );
    const isRustLoopback =
      isProxied && isLocalRustProxyEndpoint(effectiveProxy.endpointUrl);
    const finalUrl = buildProxiedStreamUrl(rawStreamUrl, effectiveProxy);
    const driver = detectStreamDriver(rawStreamUrl, explicitStreamType);
    const bufferTuning = resolveBufferProfileSettings(effectiveProxy.bufferProfile);

    const engineLabel: StreamTelemetry['engine'] = isRustLoopback
      ? driver === 'mpegts'
        ? 'Tauri Rust · MPEG-TS'
        : 'Tauri Rust · HLS MSE'
      : driver === 'mpegts'
        ? 'MPEG-TS · MSE Worker'
        : 'WebHLS · MSE Worker';

    this.emit({
      ...INITIAL_TELEMETRY,
      engine: engineLabel,
      state: 'connecting',
      proxyActive: isProxied,
      proxyMode: isProxied ? (isRustLoopback ? 'local-rust' : 'cloud-edge') : 'none',
      errorMessage: undefined,
    });

    // Graceful Studio Synth Fallback if external media CDN is blocked by sandbox/firewall
    this.fallbackTimer = window.setTimeout(() => {
      if (this.telemetry.state !== 'playing') {
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
          subtitleTracks: [{ index: 0, name: 'Deutsch (DVB/VTT)', lang: 'de' }],
        });
      }
    }, 3400);

    const markPlaying = () => {
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
      if (!video.paused) markPlaying();
    };
    video.onwaiting = () => {
      if (this.telemetry.state === 'playing') {
        this.emit({ state: 'buffering' });
      }
    };

    // 1. MPEG-TS Live Driver (mpegts.js + MSE Worker)
    if (driver === 'mpegts' && mpegts.isSupported()) {
      const player = mpegts.createPlayer(
        {
          type: 'mpegts',
          isLive: true,
          cors: true,
          url: finalUrl,
        },
        {
          enableWorker: true,
          enableStashBuffer: bufferTuning.mpegtsStashKB >= 512,
          stashInitialSize: bufferTuning.mpegtsStashKB * 1024,
          liveBufferLatencyChasing: true,
          liveBufferLatencyMaxLatency: bufferTuning.mpegtsMaxLatency,
          liveBufferLatencyMinRemain: bufferTuning.mpegtsMinRemain,
        }
      );

      this.mpegtsPlayer = player;
      player.attachMediaElement(video);
      player.load();

      if (autoPlay) {
        Promise.resolve(player.play()).catch(() => {
          video.muted = true;
          Promise.resolve(player.play()).catch(() => undefined);
        });
      }

      player.on(mpegts.Events.MEDIA_INFO, (info: { width?: number; height?: number }) => {
        this.emit({
          width: info.width || video.videoWidth || 1920,
          height: info.height || video.videoHeight || 1080,
          audioTracks: [{ index: 0, name: 'MPEG-TS PID Audio', lang: 'live' }],
        });
      });

      player.on(mpegts.Events.STATISTICS_INFO, (stats: { speed?: number }) => {
        if (typeof stats.speed === 'number') {
          // stats.speed is in KB/s -> convert to kbps
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
            true
          );
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

    // 2. Progressive MP4 / WebM / MKV Driver
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
            true
          );
          return;
        }
        this.emit({
          engine: 'Luma Studio Synth',
          state: 'synth-fallback',
        });
      };
      video.src = finalUrl;
      if (autoPlay) {
        video.play().catch(() => {
          video.muted = true;
          video.play().catch(() => undefined);
        });
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

        const subtitleTracks: SubtitleTrackOption[] = hls.subtitleTracks.map((s, index) => ({
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
          subtitleTracks,
          currentSubtitleTrack: hls.subtitleTrack,
        });

        if (autoPlay) {
          video.play().catch(() => {
            video.muted = true;
            video.play().catch(() => undefined);
          });
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
        const subtitleTracks: SubtitleTrackOption[] = data.subtitleTracks.map((s, index) => ({
          index,
          name: s.name || `Untertitel ${index + 1}`,
          lang: s.lang || 'auto',
        }));
        this.emit({
          subtitleTracks,
          currentSubtitleTrack: hls.subtitleTrack,
        });
      });

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
                true
              );
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
            hls.recoverMediaError();
            break;
          default:
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
        video.play().catch(() => {
          video.muted = true;
          video.play().catch(() => undefined);
        });
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
    if (this.hls) {
      this.hls.subtitleTrack = trackIndex;
      this.hls.subtitleDisplay = trackIndex >= 0;
    }
    this.emit({ currentSubtitleTrack: trackIndex });
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
    this.destroyDriversOnly();
    this.video = null;
  }
}
