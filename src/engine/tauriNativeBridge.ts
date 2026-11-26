export interface NativeEngineProbe {
  available: boolean;
  bundleId: string;
  platform: string;
  arch: string;
  hwDecoder: string;
  mpvAvailable: boolean;
  mpvPath?: string | null;
  ffmpegAvailable?: boolean;
  ffmpegPath?: string | null;
  localProxyUrl?: string | null;
  corsFreeNetwork: boolean;
  supportedCodecs: string[];
}

interface TauriInternalsWindow {
  __TAURI_INTERNALS__?: {
    invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  };
}

function getTauriInvoke() {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as TauriInternalsWindow;
  return w.__TAURI_INTERNALS__?.invoke ?? null;
}

export function isTauriDesktopOrMobile(): boolean {
  return getTauriInvoke() !== null;
}

let cachedNativeProbePromise: Promise<NativeEngineProbe> | null = null;

export async function probeTauriNativeEngine(
  forceRefresh = false
): Promise<NativeEngineProbe> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    return {
      available: false,
      bundleId: 'app.lumatv.client',
      platform: 'web-pwa',
      arch: 'wasm-mse',
      hwDecoder: 'WebCodecs / MSE Hardware Accelerated',
      mpvAvailable: false,
      mpvPath: null,
      localProxyUrl: null,
      corsFreeNetwork: false,
      supportedCodecs: ['H.264 / AVC', 'HEVC (Platform GPU)', 'AAC / MP3', 'HLS + MPEG-TS'],
    };
  }

  if (!forceRefresh && cachedNativeProbePromise) {
    return cachedNativeProbePromise;
  }

  cachedNativeProbePromise = (async () => {
    try {
      const res = await invoke<Omit<NativeEngineProbe, 'available'>>(
        'luma_native_probe_engine'
      );
      return {
        available: true,
        ...res,
      };
    } catch {
      return {
        available: true,
        bundleId: 'app.lumatv.client',
        platform: 'tauri-native',
        arch: 'native',
        hwDecoder: 'Hardware Accelerated',
        mpvAvailable: false,
        mpvPath: null,
        localProxyUrl: null,
        corsFreeNetwork: true,
        supportedCodecs: ['HEVC 10-bit', 'H.264', 'MPEG-TS', 'MKV', 'AC3/EAC3'],
      };
    }
  })();

  return cachedNativeProbePromise;
}

export async function launchNativeMpvStream(
  streamUrl: string,
  title: string,
  userAgent?: string
): Promise<string> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    throw new Error('MPV Hardware-Bridge ist nur im nativen Tauri-Build (macOS/Desktop) aktiv.');
  }
  return await invoke<string>('luma_native_launch_mpv', {
    streamUrl,
    title,
    userAgent,
  });
}

export interface NativeLanCastDevice {
  id: string;
  name: string;
  model: string;
  protocol: 'chromecast' | 'airplay';
  source: string;
  host: string;
  port: number;
}

export async function scanNativeLanCastDevices(
  timeoutMs = 1800
): Promise<NativeLanCastDevice[]> {
  const invoke = getTauriInvoke();
  if (!invoke) return [];
  try {
    return await invoke<NativeLanCastDevice[]>('luma_native_scan_cast_devices', {
      timeoutMs,
    });
  } catch {
    return [];
  }
}

export async function playOnNativeLanCastDevice(params: {
  protocol: 'chromecast' | 'airplay';
  host: string;
  port: number;
  streamUrl: string;
  title: string;
  subtitle?: string;
  contentType: string;
  isLive: boolean;
  positionSec?: number;
}): Promise<string> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    throw new Error('Native LAN Cast requires Tauri runtime.');
  }
  return await invoke<string>('luma_native_cast_play_on_device', {
    protocol: params.protocol,
    host: params.host,
    port: params.port,
    streamUrl: params.streamUrl,
    title: params.title,
    subtitle: params.subtitle ?? '',
    contentType: params.contentType,
    isLive: params.isLive,
    positionSec: params.positionSec ?? 0,
  });
}

export async function stopNativeLanCastDevice(): Promise<void> {
  const invoke = getTauriInvoke();
  if (!invoke) return;
  try {
    await invoke('luma_native_cast_stop_device');
  } catch {
    // Ignore
  }
}

export async function launchNativeChromecastSender(params: {
  streamUrl: string;
  title: string;
  subtitle?: string;
  contentType: string;
  isLive: boolean;
}): Promise<string> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    throw new Error('Native Chromecast bridge requires Tauri runtime.');
  }
  return await invoke<string>('luma_native_launch_chromecast_sender', {
    streamUrl: params.streamUrl,
    title: params.title,
    subtitle: params.subtitle ?? '',
    contentType: params.contentType,
    isLive: params.isLive,
  });
}
