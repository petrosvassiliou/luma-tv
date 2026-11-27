import type { BufferProfile } from '../i18n/translations';
import type { EngineProxyConfig } from '../types/luma';

export type StreamDriverKind = 'mpegts' | 'hls' | 'progressive';

export interface BufferProfileTuning {
  hlsLowLatencyMode: boolean;
  hlsMaxBufferLength: number;
  hlsBackBufferLength: number;
  mpegtsMaxLatency: number;
  mpegtsMinRemain: number;
  mpegtsStashKB: number;
}

export function resolveBufferProfileSettings(
  profile: BufferProfile = 'balanced'
): BufferProfileTuning {
  switch (profile) {
    case 'low-latency':
      return {
        hlsLowLatencyMode: true,
        hlsMaxBufferLength: 6,
        hlsBackBufferLength: 15,
        mpegtsMaxLatency: 1.5,
        mpegtsMinRemain: 0.3,
        mpegtsStashKB: 64,
      };
    case 'cinema-max':
      return {
        hlsLowLatencyMode: false,
        hlsMaxBufferLength: 60,
        hlsBackBufferLength: 120,
        mpegtsMaxLatency: 6.0,
        mpegtsMinRemain: 1.5,
        mpegtsStashKB: 512,
      };
    case 'balanced':
    default:
      return {
        hlsLowLatencyMode: true,
        hlsMaxBufferLength: 24,
        hlsBackBufferLength: 60,
        mpegtsMaxLatency: 2.5,
        mpegtsMinRemain: 0.5,
        mpegtsStashKB: 128,
      };
  }
}

export function isLocalRustProxyEndpoint(endpointUrl: string): boolean {
  const trimmed = endpointUrl.trim();
  return trimmed.startsWith('http://127.0.0.1:') && trimmed.includes('/luma-proxy/');
}

export function shouldProactivelyProxyStream(
  rawUrl: string,
  proxy: EngineProxyConfig,
  currentProtocol?: string
): boolean {
  const endpoint = proxy.endpointUrl.trim();
  if (!endpoint) return false;
  if (proxy.enabled) return true;
  if (proxy.autoFallbackOnCors === false) return false;

  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'http:') {
      const host = parsed.hostname.toLowerCase();
      const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '[::1]';
      if (!isLoopback) {
        if (isLocalRustProxyEndpoint(endpoint)) {
          return true;
        }
        const proto =
          currentProtocol ??
          (typeof window !== 'undefined' ? window.location?.protocol : '');
        if (proto === 'https:') {
          return true;
        }
      }
    }
  } catch {
    // Fall through to standard direct load + on-error fallback
  }

  return false;
}

export function detectStreamDriver(
  rawUrl: string,
  explicitHint?: 'hls' | 'mpegts'
): StreamDriverKind {
  if (explicitHint === 'mpegts') return 'mpegts';
  try {
    const u = new URL(rawUrl);
    const p = u.pathname.toLowerCase();
    if (
      p.endsWith('.ts') ||
      u.searchParams.get('output') === 'ts' ||
      u.searchParams.get('output') === 'mpegts'
    ) {
      return 'mpegts';
    }
    if (p.endsWith('.mp4') || p.endsWith('.webm') || p.endsWith('.mkv')) {
      return 'progressive';
    }
  } catch {
    const lower = rawUrl.toLowerCase();
    if (lower.endsWith('.ts')) return 'mpegts';
  }
  return 'hls';
}

export function isNonNativeBrowserContainer(rawUrl: string): boolean {
  try {
    const p = new URL(rawUrl).pathname.toLowerCase();
    return (
      p.endsWith('.mkv') ||
      p.endsWith('.avi') ||
      p.endsWith('.flv') ||
      p.endsWith('.divx') ||
      p.endsWith('.wmv')
    );
  } catch {
    const lower = rawUrl.toLowerCase();
    return lower.endsWith('.mkv') || lower.endsWith('.avi') || lower.endsWith('.flv');
  }
}

/**
 * Converts an Xtream Codes or M3U live MPEG-TS URL (`.../12345.ts` or `?output=ts`)
 * into its HLS `.m3u8` equivalent so hardware native HLS/Stagefright decoders on
 * Android TV & Apple devices can decode HEVC/H.265 video when MSE only plays audio.
 */
export function tryConvertXtreamTsToHlsUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    let changed = false;
    if (/\.ts$/i.test(parsed.pathname)) {
      parsed.pathname = parsed.pathname.replace(/\.ts$/i, '.m3u8');
      changed = true;
    }
    const out = parsed.searchParams.get('output')?.toLowerCase();
    if (out === 'ts' || out === 'mpegts') {
      parsed.searchParams.set('output', 'm3u8');
      changed = true;
    }
    return changed ? parsed.toString() : null;
  } catch {
    if (/\.ts($|\?)/i.test(trimmed)) {
      return trimmed.replace(/\.ts($|\?)/i, '.m3u8$1');
    }
    return null;
  }
}

export function buildRustTranscodeStreamUrl(
  rawUrl: string,
  proxy: EngineProxyConfig,
  mode: 'remux' | 'hw',
  startSec = 0
): string {
  const base = proxy.endpointUrl.trim().replace(/\/+$/, '');
  if (!base || !isLocalRustProxyEndpoint(base)) {
    return rawUrl;
  }
  const uaParam =
    proxy.customUserAgent && proxy.customUserAgent.trim()
      ? `&ua=${encodeURIComponent(proxy.customUserAgent.trim())}`
      : '';
  const startParam = startSec > 0.5 ? `&start=${Math.round(startSec)}` : '';
  return `${base}?url=${encodeURIComponent(rawUrl)}&transcode=${mode}${startParam}${uaParam}`;
}

export function buildProxiedStreamUrl(rawUrl: string, proxy: EngineProxyConfig): string {
  if (!proxy.enabled || !proxy.endpointUrl.trim()) {
    return rawUrl;
  }
  const base = proxy.endpointUrl.trim().replace(/\/+$/, '');
  if (rawUrl.startsWith(base)) {
    return rawUrl;
  }
  const uaParam =
    proxy.customUserAgent && proxy.customUserAgent.trim()
      ? `&ua=${encodeURIComponent(proxy.customUserAgent.trim())}`
      : '';
  return `${base}?url=${encodeURIComponent(rawUrl)}${uaParam}`;
}

/**
 * Rewrites relative & absolute segment/variant URLs and #EXT-X-KEY URI="..." tags
 * inside an HLS .m3u8 playlist so every sub-request routes through the proxy.
 */
export function rewriteHlsManifestUrls(
  manifestText: string,
  upstreamBaseUrl: string,
  proxyEndpointBase: string,
  customUa?: string
): string {
  const baseObj = new URL(upstreamBaseUrl);
  const cleanProxy = proxyEndpointBase.trim().replace(/\/+$/, '');

  const buildProxied = (target: string): string => {
    const resolved = new URL(target, baseObj).toString();
    const uaSuffix = customUa ? `&ua=${encodeURIComponent(customUa)}` : '';
    return `${cleanProxy}?url=${encodeURIComponent(resolved)}${uaSuffix}`;
  };

  return manifestText
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/gi, (_full, uri: string) => {
          return `URI="${buildProxied(uri)}"`;
        });
      }
      return buildProxied(trimmed);
    })
    .join('\n');
}

export interface ProxyProbeResult {
  ok: boolean;
  latencyMs: number;
  detail: string;
}

export async function probeCorsStreamProxy(
  endpointUrl: string
): Promise<ProxyProbeResult> {
  const trimmed = endpointUrl.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return { ok: false, latencyMs: 0, detail: 'Keine Proxy-URL angegeben.' };
  }
  const t0 = performance.now();
  try {
    const res = await fetch(`${trimmed}?health=1`, {
      method: 'GET',
      mode: 'cors',
    });
    const latencyMs = Math.round(performance.now() - t0);
    if (res.ok) {
      let service = '';
      try {
        const json = (await res.json()) as { service?: string };
        service = json.service ?? '';
      } catch {
        // Non-JSON 200 OK
      }
      if (service === 'lumaNativeRustProxy') {
        return {
          ok: true,
          latencyMs,
          detail: `Tauri Rust Loopback-Proxy aktiv (${latencyMs} ms · CORS & HLS-Rewriter bereit)`,
        };
      }
      return {
        ok: true,
        latencyMs,
        detail: `Edge-Proxy erreichbar (${latencyMs} ms · CORS OK)`,
      };
    }
    return {
      ok: false,
      latencyMs,
      detail: `Endpoint antwortete mit HTTP ${res.status} (${latencyMs} ms)`,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - t0),
      detail:
        err instanceof Error
          ? `Nicht erreichbar (${err.message}) — bereit nach Firebase Deploy`
          : 'Verbindungsfehler',
    };
  }
}
