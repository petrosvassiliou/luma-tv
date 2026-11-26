import {
  playOnNativeLanCastDevice,
  scanNativeLanCastDevices,
  stopNativeLanCastDevice,
} from '../engine/tauriNativeBridge';
import type { LumaPlayerEngine } from '../engine/LumaPlayerEngine';

export interface DiscoveredCastDevice {
  id: string;
  name: string;
  model: string;
  protocol: 'chromecast' | 'airplay';
  source: 'android-mediarouter' | 'android-nsd' | 'rust-mdns';
  host?: string;
  port?: number;
  isSelected?: boolean;
}

export interface AndroidCastStateSnapshot {
  devices?: DiscoveredCastDevice[];
  connectedDeviceName?: string | null;
}

interface WebKitVideoElement extends HTMLVideoElement {
  webkitShowPlaybackTargetPicker?: () => void;
  webkitCurrentPlaybackTargetIsWireless?: boolean;
}

interface LumaAndroidCastBridge {
  startCastScan?: () => string;
  stopCastScan?: () => void;
  getCastStateJson?: () => string;
  connectAndCastRoute?: (
    deviceId: string,
    streamUrl: string,
    title: string,
    subtitle: string,
    mimeType: string,
    isLive: boolean,
    positionSec: number
  ) => boolean;
  stopCasting?: () => void;
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

    if (/\.(m3u8|mp4|m4v|mov|webm|mkv)(\?|$)/i.test(path)) {
      return trimmed;
    }

    if (/\/live\/[^/]+\/[^/]+\/\d+\.ts$/i.test(path)) {
      parsed.pathname = path.replace(/\.ts$/i, '.m3u8');
      return parsed.toString();
    }

    if (/\/live\/[^/]+\/[^/]+\/\d+$/i.test(path)) {
      parsed.pathname = `${path}.m3u8`;
      return parsed.toString();
    }

    const shortTsMatch = path.match(/^\/([^/]+)\/([^/]+)\/(\d+)\.ts$/i);
    if (shortTsMatch) {
      parsed.pathname = `/live/${shortTsMatch[1]}/${shortTsMatch[2]}/${shortTsMatch[3]}.m3u8`;
      return parsed.toString();
    }

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

/**
 * Pre-warms a dedicated native WebKit `<video x-webkit-airplay="allow">` element with the
 * direct castable HLS/MP4 URL as soon as the Cast menu opens on macOS/iOS so `AVFoundation`
 * already has a live `AVPlayerItem` ready before the user clicks an Apple TV target.
 */
export function prewarmNativeAirPlayVideo(params: {
  airplayVideo: HTMLVideoElement | null;
  rawStreamUrl: string;
  streamType?: 'hls' | 'mpegts';
  isLive: boolean;
  startTimeSec?: number;
}): void {
  const {
    airplayVideo,
    rawStreamUrl,
    streamType,
    isLive,
    startTimeSec = 0,
  } = params;
  if (!airplayVideo || !isAppleAirPlaySupported(airplayVideo)) return;

  const airplayUrl = toCastableHlsOrMediaUrl(rawStreamUrl, streamType);
  if (!airplayUrl) return;

  airplayVideo.setAttribute('x-webkit-airplay', 'allow');
  airplayVideo.disableRemotePlayback = false;

  if (airplayVideo.getAttribute('data-luma-airplay-src') !== airplayUrl) {
    airplayVideo.setAttribute('data-luma-airplay-src', airplayUrl);
    airplayVideo.src = airplayUrl;
    airplayVideo.load();
    if (!isLive && startTimeSec > 2) {
      airplayVideo.addEventListener(
        'loadedmetadata',
        () => {
          try {
            airplayVideo.currentTime = Math.floor(startTimeSec);
          } catch {
            // Ignore seek before ready
          }
        },
        { once: true }
      );
    }
  }
}

/**
 * Invokes macOS / iOS native AirPlay 2 picker (`webkitShowPlaybackTargetPicker`)
 * SYNCHRONOUSLY inside the user's click gesture so WebKit never drops the gesture token.
 */
export function triggerAppleTvAirPlaySync(params: {
  airplayVideo: HTMLVideoElement | null;
  fallbackMainVideo?: HTMLVideoElement | null;
  engine?: LumaPlayerEngine | null;
  rawStreamUrl: string;
  streamType?: 'hls' | 'mpegts';
  isLive?: boolean;
  startTimeSec?: number;
}): { ok: boolean; message: string } {
  const {
    airplayVideo,
    fallbackMainVideo = null,
    engine = null,
    rawStreamUrl,
    streamType,
    isLive = true,
    startTimeSec = 0,
  } = params;

  const targetVideo = (
    isAppleAirPlaySupported(airplayVideo) ? airplayVideo : fallbackMainVideo
  ) as WebKitVideoElement | null;

  if (!targetVideo || typeof targetVideo.webkitShowPlaybackTargetPicker !== 'function') {
    return {
      ok: false,
      message: 'Select your Apple TV from the discovered Wi-Fi devices list.',
    };
  }

  const airplayUrl = toCastableHlsOrMediaUrl(rawStreamUrl, streamType);
  if (targetVideo === airplayVideo) {
    prewarmNativeAirPlayVideo({
      airplayVideo: targetVideo,
      rawStreamUrl,
      streamType,
      isLive,
      startTimeSec,
    });
  } else {
    engine?.prepareDirectRemotePlayback(targetVideo, airplayUrl);
  }

  try {
    targetVideo.webkitShowPlaybackTargetPicker();
    return {
      ok: true,
      message: 'Choose your Apple TV in the native macOS AirPlay menu.',
    };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error ? err.message : 'Unable to open macOS AirPlay picker.',
    };
  }
}

export function isAndroidNativeCastAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as CastGlobalWindow;
  return typeof w.LumaAndroidWindow?.startCastScan === 'function';
}

/**
 * Deduplicates discovered Chromecast & AirPlay receivers across Android MediaRouter,
 * Android NsdManager, and Rust mDNS, preferring `android-mediarouter` routes when both
 * report the same Chromecast TV.
 */
export function mergeDiscoveredCastDevices(
  androidDevices: DiscoveredCastDevice[],
  rustLanDevices: DiscoveredCastDevice[]
): DiscoveredCastDevice[] {
  const merged: DiscoveredCastDevice[] = [];
  const seenIds = new Set<string>();
  const mediaRouterChromecastNames = new Set<string>();

  for (const d of androidDevices) {
    if (!d?.id || !d?.name || seenIds.has(d.id)) continue;
    seenIds.add(d.id);
    if (d.source === 'android-mediarouter' && d.protocol === 'chromecast') {
      mediaRouterChromecastNames.add(d.name.trim().toLowerCase());
    }
    merged.push(d);
  }

  for (const r of rustLanDevices) {
    if (!r?.id || !r?.name || seenIds.has(r.id)) continue;
    if (
      r.protocol === 'chromecast' &&
      mediaRouterChromecastNames.has(r.name.trim().toLowerCase())
    ) {
      continue;
    }
    seenIds.add(r.id);
    merged.push(r);
  }

  return merged.sort((a, b) => a.name.localeCompare(b.name));
}

export function parseAndroidCastStateJson(
  rawJson: string | null | undefined
): AndroidCastStateSnapshot {
  if (!rawJson) return { devices: [], connectedDeviceName: null };
  try {
    const parsed = JSON.parse(rawJson) as AndroidCastStateSnapshot;
    return {
      devices: Array.isArray(parsed.devices) ? parsed.devices : [],
      connectedDeviceName:
        typeof parsed.connectedDeviceName === 'string' && parsed.connectedDeviceName
          ? parsed.connectedDeviceName
          : null,
    };
  } catch {
    return { devices: [], connectedDeviceName: null };
  }
}

/**
 * Starts automatic Wi-Fi network scanning across Android MediaRouter/CastContext + NSD
 * AND Native Rust mDNS (`_googlecast._tcp.local` + `_airplay._tcp.local`).
 */
export async function scanNetworkCastDevices(
  timeoutMs = 1800
): Promise<{
  devices: DiscoveredCastDevice[];
  connectedDeviceName: string | null;
}> {
  const w = (typeof window !== 'undefined' ? window : {}) as unknown as CastGlobalWindow;

  let androidDevices: DiscoveredCastDevice[] = [];
  let connectedDeviceName: string | null = null;

  if (typeof w.LumaAndroidWindow?.startCastScan === 'function') {
    const initialSnap = parseAndroidCastStateJson(w.LumaAndroidWindow.startCastScan());
    androidDevices = initialSnap.devices ?? [];
    connectedDeviceName = initialSnap.connectedDeviceName ?? null;
  }

  const rustRaw = await scanNativeLanCastDevices(timeoutMs);
  const rustDevices: DiscoveredCastDevice[] = rustRaw.map((d) => ({
    id: d.id,
    name: d.name,
    model: d.model,
    protocol: d.protocol,
    source: 'rust-mdns',
    host: d.host,
    port: d.port,
  }));

  // Refresh Android snapshot after mDNS window so newly found MediaRouter/NSD routes are included too
  if (typeof w.LumaAndroidWindow?.getCastStateJson === 'function') {
    const afterSnap = parseAndroidCastStateJson(w.LumaAndroidWindow.getCastStateJson());
    androidDevices = afterSnap.devices ?? androidDevices;
    connectedDeviceName = afterSnap.connectedDeviceName ?? connectedDeviceName;
  }

  return {
    devices: mergeDiscoveredCastDevices(androidDevices, rustDevices),
    connectedDeviceName,
  };
}

export function stopNetworkCastScan(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as CastGlobalWindow;
  try {
    w.LumaAndroidWindow?.stopCastScan?.();
  } catch {
    // Ignore
  }
}

/**
 * Streams directly to a discovered Chromecast / Google TV or Apple TV device on the Wi-Fi LAN
 * without opening any external app chooser.
 */
export async function connectAndStreamToDiscoveredDevice(params: {
  device: DiscoveredCastDevice;
  video: HTMLVideoElement | null;
  rawStreamUrl: string;
  streamType?: 'hls' | 'mpegts';
  title: string;
  subtitle?: string;
  isLive: boolean;
  startTimeSec?: number;
}): Promise<{ ok: boolean; deviceName: string; message: string }> {
  const {
    device,
    video,
    rawStreamUrl,
    streamType,
    title,
    subtitle = '',
    isLive,
    startTimeSec = 0,
  } = params;

  const castUrl = toCastableHlsOrMediaUrl(rawStreamUrl, streamType);
  const contentType = inferCastContentType(castUrl);
  const w = (typeof window !== 'undefined' ? window : {}) as unknown as CastGlobalWindow;

  // 1. Android MediaRouter / Google Play Services CastSession route (`route:...`)
  if (
    device.id.startsWith('route:') &&
    typeof w.LumaAndroidWindow?.connectAndCastRoute === 'function'
  ) {
    const handled = w.LumaAndroidWindow.connectAndCastRoute(
      device.id,
      castUrl,
      title,
      subtitle,
      contentType,
      isLive,
      startTimeSec
    );
    if (handled) {
      video?.pause();
      return {
        ok: true,
        deviceName: device.name,
        message: `Connecting to ${device.name}…`,
      };
    }
  }

  // 2. Direct LAN CastV2 TLS (port 8009) or AirPlay HTTP (port 7000) via Native Rust Bridge
  if (device.host && device.port) {
    try {
      const msg = await playOnNativeLanCastDevice({
        protocol: device.protocol,
        host: device.host,
        port: device.port,
        streamUrl: castUrl,
        title,
        subtitle,
        contentType,
        isLive,
        positionSec: startTimeSec,
      });
      video?.pause();
      return {
        ok: true,
        deviceName: device.name,
        message: msg,
      };
    } catch (err) {
      return {
        ok: false,
        deviceName: device.name,
        message:
          err instanceof Error
            ? err.message
            : `Failed to stream to ${device.name}.`,
      };
    }
  }

  return {
    ok: false,
    deviceName: device.name,
    message: `Device ${device.name} is missing network address details.`,
  };
}

export async function disconnectActiveCastSession(): Promise<void> {
  const w = (typeof window !== 'undefined' ? window : {}) as unknown as CastGlobalWindow;
  try {
    w.LumaAndroidWindow?.stopCasting?.();
  } catch {
    // Ignore
  }
  try {
    w.cast?.framework?.CastContext?.getInstance()?.endCurrentSession?.(true);
  } catch {
    // Ignore
  }
  await stopNativeLanCastDevice();
}

export async function triggerAppleTvAirPlay(params: {
  video: HTMLVideoElement | null;
  engine: LumaPlayerEngine | null;
  rawStreamUrl: string;
  streamType?: 'hls' | 'mpegts';
}): Promise<{ ok: boolean; message: string }> {
  return triggerAppleTvAirPlaySync({
    airplayVideo: params.video,
    fallbackMainVideo: params.video,
    engine: params.engine,
    rawStreamUrl: params.rawStreamUrl,
    streamType: params.streamType,
  });
}

let castSdkLoadPromise: Promise<boolean> | null = null;

export function ensureGoogleCastSdkLoaded(timeoutMs = 2600): Promise<boolean> {
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
          // Ignore
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

/**
 * Web Browser PWA Google Cast dialog (used only when running in desktop Chrome/Edge PWA).
 */
export async function triggerBrowserChromecastDialog(params: {
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
      // Ignore
    }
  }

  return {
    ok: false,
    message:
      'No browser Cast extension detected. Select a discovered Wi-Fi device from the list.',
  };
}
