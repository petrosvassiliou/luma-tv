import type { EngineProxyConfig } from '../types/luma';

export type StreamDriverKind = 'mpegts' | 'hls' | 'progressive';

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
