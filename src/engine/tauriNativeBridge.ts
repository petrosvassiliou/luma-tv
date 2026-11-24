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
