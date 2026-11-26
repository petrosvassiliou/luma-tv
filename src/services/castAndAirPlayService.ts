import { launchNativeChromecastSender } from '../engine/tauriNativeBridge';
import type { LumaPlayerEngine } from '../engine/LumaPlayerEngine';

interface WebKitVideoElement extends HTMLVideoElement {
  webkitShowPlaybackTargetPicker?: () => void;
  webkitCurrentPlaybackTargetIsWireless?: boolean;
}

interface LumaAndroidCastBridge {
  openCastSettings?: () => boolean;
  launchExternalCastChooser?: (
    streamUrl: string,
    title: string,
    mimeType: string
  ) => boolean;
}

interface GoogleCastSession {
  loadMedia: (request: unknown) => Promise<unknown>;
  getCastDevice?: () => { friendlyName?: string };
}

interface GoogleCastContext {
  setOptions: (options: Record<string, unknown>) => void;
  requestSession: () => Promise<unknown>;
  getCurrentSession: () => GoogleCastSession | null;
  endCurrentSession?: (stopCasting: boolean) => void;
}

interface CastGlobalWindow {
  LumaAndroidWindow?: LumaAndroidCastBridge;
  __onGCastApiAvailable?: (isAvailable: boolean) => void;
  cast?: {
    framework?: {
      CastContext?: {
        getInstance: () => GoogleCastContext;
      };
    };
  };
  chrome?: {
    cast?: {
      AutoJoinPolicy?: {
        ORIGIN_SCOPED?: string;
      };
      media?: {
        DEFAULT_MEDIA_RECEIVER_APP_ID?: string;
        StreamType?: {
          LIVE?: string;
          BUFFERED?: string;
        };
        MediaInfo?: new (contentId: string, contentType: string) => {
          streamType?: string;
          metadata?: unknown;
        };
        GenericMediaMetadata?: new () => {
          title?: string;
          subtitle?: string;
        };
        LoadRequest?: new (mediaInfo: unknown) => {
          autoplay?: boolean;
          currentTime?: number;
        };
      };
    };
  };
}

/**
 * Converts raw IPTV / Xtream MPEG-TS live URLs (`http://host:port/live/u/p/12345.ts`
 * or `http://host:port/u/p/12345`) into HLS `.m3u8` URLs when appropriate so Apple TV
 * (AirPlay 2) and Chromecast Default Media Receiver can decode live streams natively.
 */
export function toCastableHlsOrMediaUrl(
  rawUrl: string,
  streamType?: 'hls' | 'mpegts'
): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return trimmed;

  try {
    const parsed = new URL(trimmed);
    const path = parsed.pathname;

    // Preserve explicit VOD containers (.mp4, .mkv, .webm, .m4v, .mov) and existing .m3u8
    if (/\.(m3u8|mp4|m4v|mov|webm|mkv)(\?|$)/i.test(path)) {
      return trimmed;
    }

    // Xtream live stream ending in .ts -> swap extension to .m3u8 (supported by Xtream servers)
    if (/\/live\/[^/]+\/[^/]+\/\d+\.ts$/i.test(path)) {
      parsed.pathname = path.replace(/\.ts$/i, '.m3u8');
      return parsed.toString();
    }

    // Extensionless Xtream live path `/live/user/pass/12345` -> append `.m3u8`
    if (/\/live\/[^/]+\/[^/]+\/\d+$/i.test(path)) {
      parsed.pathname = `${path}.m3u8`;
      return parsed.toString();
    }

    // Short Xtream live path `/user/pass/12345.ts` -> `/live/user/pass/12345.m3u8`
    const shortTsMatch = path.match(/^\/([^/]+)\/([^/]+)\/(\d+)\.ts$/i);
    if (shortTsMatch) {
      parsed.pathname = `/live/${shortTsMatch[1]}/${shortTsMatch[2]}/${shortTsMatch[3]}.m3u8`;
      return parsed.toString();
    }

    // Short extensionless Xtream live path `/user/pass/12345` when marked mpegts
    const shortBareMatch = path.match(/^\/([^/]+)\/([^/]+)\/(\d+)$/);
    if (shortBareMatch && streamType === 'mpegts') {
      parsed.pathname = `/live/${shortBareMatch[1]}/${shortBareMatch[2]}/${shortBareMatch[3]}.m3u8`;
      return parsed.toString();
    }
  } catch {
    // Keep raw URL if not standard URL
  }

  return trimmed;
}

export function inferCastContentType(streamUrl: string): string {
  const lower = streamUrl.split('?')[0].toLowerCase();
  if (lower.endsWith('.mp4') || lower.endsWith('.m4v') || lower.endsWith('.mov')) {
    return 'video/mp4';
  }
  if (lower.endsWith('.webm')) {
    return 'video/webm';
  }
  if (lower.endsWith('.mkv')) {
    return 'video/x-matroska';
  }
  if (lower.endsWith('.ts')) {
    return 'video/mp2t';
  }
  return 'application/x-mpegurl';
}

export function isAppleAirPlaySupported(video: HTMLVideoElement | null): boolean {
  if (!video) return false;
  return typeof (video as WebKitVideoElement).webkitShowPlaybackTargetPicker === 'function';
}

export function isAndroidCastBridgeAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as CastGlobalWindow;
  return Boolean(
    w.LumaAndroidWindow &&
      (typeof w.LumaAndroidWindow.launchExternalCastChooser === 'function' ||
        typeof w.LumaAndroidWindow.openCastSettings === 'function')
  );
}

let castSdkLoadPromise: Promise<boolean> | null = null;

export function ensureGoogleCastSdkLoaded(timeoutMs = 3500): Promise<boolean> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(false);
  }

  const w = window as unknown as CastGlobalWindow;
  if (w.cast?.framework?.CastContext && w.chrome?.cast?.media) {
    return Promise.resolve(true);
  }

  if (castSdkLoadPromise) return castSdkLoadPromise;

  castSdkLoadPromise = new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (available: boolean) => {
      if (settled) return;
      settled = true;
      if (!available) castSdkLoadPromise = null;
      resolve(available);
    };

    const timer = window.setTimeout(() => {
      finish(Boolean(w.cast?.framework?.CastContext && w.chrome?.cast?.media));
    }, timeoutMs);

    const prevHook = w.__onGCastApiAvailable;
    w.__onGCastApiAvailable = (isAvailable: boolean) => {
      prevHook?.(isAvailable);
      window.clearTimeout(timer);
      if (isAvailable && w.cast?.framework?.CastContext && w.chrome?.cast) {
        try {
          const ctx = w.cast.framework.CastContext.getInstance();
          ctx.setOptions({
            receiverApplicationId:
              w.chrome.cast.media?.DEFAULT_MEDIA_RECEIVER_APP_ID || 'CC1AD845',
            autoJoinPolicy:
              w.chrome.cast.AutoJoinPolicy?.ORIGIN_SCOPED || 'origin_scoped',
          });
        } catch {
          // Ignore duplicate setOptions calls
        }
        finish(true);
      } else {
        finish(false);
      }
    };

    const existing = document.querySelector('script[data-luma-cast-sdk="1"]');
    if (!existing) {
      const script = document.createElement('script');
      script.src =
        'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
      script.async = true;
      script.dataset.lumaCastSdk = '1';
      script.onerror = () => {
        window.clearTimeout(timer);
        finish(false);
      };
      document.head.appendChild(script);
    }
  });

  return castSdkLoadPromise;
}

export async function triggerAppleTvAirPlay(params: {
  video: HTMLVideoElement | null;
  engine: LumaPlayerEngine | null;
  rawStreamUrl: string;
  streamType?: 'hls' | 'mpegts';
}): Promise<{ ok: boolean; message: string }> {
  const { video, engine, rawStreamUrl, streamType } = params;
  const wkVideo = video as WebKitVideoElement | null;

  if (!wkVideo || typeof wkVideo.webkitShowPlaybackTargetPicker !== 'function') {
    return {
      ok: false,
      message:
        'Native AirPlay picker requires macOS (Luma.app / Safari) or iOS/iPadOS.',
    };
  }

  const airplayUrl = toCastableHlsOrMediaUrl(rawStreamUrl, streamType);

  // Switch <video> from MSE blob: to direct HLS/MP4 URL so Apple TV receives full video + audio
  engine?.prepareDirectRemotePlayback(wkVideo, airplayUrl);

  try {
    wkVideo.webkitShowPlaybackTargetPicker();
    return {
      ok: true,
      message: 'Select your Apple TV or AirPlay 2 TV from the system picker.',
    };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error ? err.message : 'Unable to open AirPlay target picker.',
    };
  }
}

export async function triggerChromecastStream(params: {
  video: HTMLVideoElement | null;
  engine: LumaPlayerEngine | null;
  rawStreamUrl: string;
  streamType?: 'hls' | 'mpegts';
  title: string;
  subtitle?: string;
  isLive: boolean;
  startTimeSec?: number;
}): Promise<{ ok: boolean; deviceName?: string; message: string }> {
  const {
    video,
    engine,
    rawStreamUrl,
    streamType,
    title,
    subtitle,
    isLive,
    startTimeSec = 0,
  } = params;

  const castUrl = toCastableHlsOrMediaUrl(rawStreamUrl, streamType);
  const contentType = inferCastContentType(castUrl);
  const w = (typeof window !== 'undefined' ? window : {}) as unknown as CastGlobalWindow;

  // 1. Native Google Cast Framework (Chrome, ChromeOS PWA, Edge, Brave)
  const castSdkReady = await ensureGoogleCastSdkLoaded(2600);
  if (
    castSdkReady &&
    w.cast?.framework?.CastContext &&
    w.chrome?.cast?.media?.MediaInfo &&
    w.chrome.cast.media.GenericMediaMetadata &&
    w.chrome.cast.media.LoadRequest
  ) {
    try {
      const ctx = w.cast.framework.CastContext.getInstance();
      ctx.setOptions({
        receiverApplicationId:
          w.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID || 'CC1AD845',
        autoJoinPolicy:
          w.chrome.cast.AutoJoinPolicy?.ORIGIN_SCOPED || 'origin_scoped',
      });

      let session = ctx.getCurrentSession();
      if (!session) {
        await ctx.requestSession();
        session = ctx.getCurrentSession();
      }

      if (session) {
        const mediaInfo = new w.chrome.cast.media.MediaInfo(castUrl, contentType);
        mediaInfo.streamType = isLive
          ? (w.chrome.cast.media.StreamType?.LIVE ?? 'LIVE')
          : (w.chrome.cast.media.StreamType?.BUFFERED ?? 'BUFFERED');

        const metadata = new w.chrome.cast.media.GenericMediaMetadata();
        metadata.title = title;
        if (subtitle) metadata.subtitle = subtitle;
        mediaInfo.metadata = metadata;

        const request = new w.chrome.cast.media.LoadRequest(mediaInfo);
        request.autoplay = true;
        if (!isLive && startTimeSec > 2) {
          request.currentTime = Math.floor(startTimeSec);
        }

        await session.loadMedia(request);
        video?.pause();
        const friendly =
          session.getCastDevice?.()?.friendlyName || 'Chromecast';
        return {
          ok: true,
          deviceName: friendly,
          message: `Streaming "${title}" to ${friendly}`,
        };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('cancel')) {
        return { ok: false, message: 'Chromecast selection cancelled.' };
      }
    }
  }

  // 2. Android / Googlebook Native Cast App Chooser (VLC, Web Video Caster, LocalCast, etc.)
  if (w.LumaAndroidWindow?.launchExternalCastChooser) {
    const launched = w.LumaAndroidWindow.launchExternalCastChooser(
      castUrl,
      title,
      contentType
    );
    if (launched) {
      video?.pause();
      return {
        ok: true,
        deviceName: 'Chromecast / Cast Player',
        message: `Opened Android / Googlebook Cast chooser for "${title}"`,
      };
    }
  }

  // 3. W3C RemotePlayback API (`video.remote.prompt()`) on Mobile / Chromium WebViews
  if (video && 'remote' in video && typeof video.remote?.prompt === 'function') {
    try {
      engine?.prepareDirectRemotePlayback(video, castUrl);
      await video.remote.prompt();
      return {
        ok: true,
        deviceName: 'Remote TV',
        message: `Remote playback started for "${title}"`,
      };
    } catch {
      // Fall through to native desktop Chrome Cast sender bridge
    }
  }

  // 4. macOS / Desktop Tauri Native Bridge -> Launches embedded localhost Chromecast Controller in Chrome/Edge/Brave
  try {
    const msg = await launchNativeChromecastSender({
      streamUrl: castUrl,
      title,
      subtitle: subtitle ?? '',
      contentType,
      isLive,
    });
    video?.pause();
    return {
      ok: true,
      deviceName: 'Chrome Cast Sender',
      message: msg,
    };
  } catch {
    // Fall through if not in Tauri desktop or Chrome isn't installed
  }

  // 5. Android / Googlebook System Cast Screen fallback
  if (w.LumaAndroidWindow?.openCastSettings?.()) {
    return {
      ok: true,
      deviceName: 'System Cast',
      message: 'Opened system Chromecast / Cast Display settings.',
    };
  }

  return {
    ok: false,
    message:
      'Chromecast requires Google Chrome / ChromeOS or a Cast app (VLC / Web Video Caster). Use Copy Stream URL below if needed.',
  };
}

export function triggerAndroidSystemCastSettings(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as CastGlobalWindow;
  return Boolean(w.LumaAndroidWindow?.openCastSettings?.());
}
