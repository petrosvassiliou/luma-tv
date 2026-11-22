import { onRequest } from 'firebase-functions/v2/https';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

/**
 * Blocks SSRF attempts targeting loopback, link-local, or RFC1918 private networks.
 */
function isSafePublicStreamUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Rewrites relative & absolute URLs inside HLS .m3u8 manifests so all variant
 * playlists, AES-128 keys, audio renditions, and .ts/.m4s media segments flow
 * seamlessly through the CORS proxy.
 */
export function rewriteHlsManifestForProxy(
  manifestText: string,
  upstreamBaseUrl: URL,
  proxyEndpointBase: string,
  customUa?: string
): string {
  const buildProxied = (target: string): string => {
    const resolved = new URL(target, upstreamBaseUrl).toString();
    const uaSuffix = customUa ? `&ua=${encodeURIComponent(customUa)}` : '';
    return `${proxyEndpointBase}?url=${encodeURIComponent(resolved)}${uaSuffix}`;
  };

  return manifestText
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      // Rewrite URI="..." inside #EXT-X-KEY, #EXT-X-MAP, #EXT-X-MEDIA
      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/gi, (_full, uri: string) => {
          return `URI="${buildProxied(uri)}"`;
        });
      }

      // Segment or variant playlist URI line
      return buildProxied(trimmed);
    })
    .join('\n');
}

export const lumaStreamProxy = onRequest(
  {
    region: 'europe-west1',
    memory: '512MiB',
    timeoutSeconds: 300,
    cors: false,
  },
  async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type, X-Luma-User-Agent');
    res.setHeader(
      'Access-Control-Expose-Headers',
      'Content-Length, Content-Range, Content-Type, Accept-Ranges'
    );

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    const rawTarget = typeof req.query.url === 'string' ? req.query.url : '';
    if (req.query.health === '1') {
      res.status(200).json({
        ok: true,
        service: 'lumaStreamProxy',
        version: '3.0.0',
      });
      return;
    }

    const targetUrl = isSafePublicStreamUrl(rawTarget);
    if (!targetUrl) {
      res.status(400).json({
        error: 'Invalid or disallowed upstream stream URL.',
      });
      return;
    }

    const customUa =
      (typeof req.query.ua === 'string' && req.query.ua) ||
      req.header('x-luma-user-agent') ||
      'LumaTV/1.0 (Cross-Platform Stream Engine)';

    const upstreamHeaders: Record<string, string> = {
      'User-Agent': customUa,
      Accept: '*/*',
    };

    const rangeHeader = req.header('range');
    if (rangeHeader) {
      upstreamHeaders['Range'] = rangeHeader;
    }

    try {
      const upstream = await fetch(targetUrl.toString(), {
        method: req.method === 'HEAD' ? 'HEAD' : 'GET',
        headers: upstreamHeaders,
        redirect: 'follow',
      });

      const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
      const finalUpstreamUrl = new URL(upstream.url || targetUrl.toString());

      const isHlsPlaylist =
        contentType.toLowerCase().includes('mpegurl') ||
        finalUpstreamUrl.pathname.toLowerCase().endsWith('.m3u8');

      if (isHlsPlaylist && req.method !== 'HEAD') {
        const text = await upstream.text();
        const proto = req.header('x-forwarded-proto') || req.protocol || 'https';
        const host = req.header('x-forwarded-host') || req.header('host') || '';
        const proxyBase = `${proto}://${host}/api/stream-proxy`;

        const rewritten = rewriteHlsManifestForProxy(
          text,
          finalUpstreamUrl,
          proxyBase,
          customUa
        );

        res.status(upstream.status);
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, max-age=0');
        res.send(rewritten);
        return;
      }

      // Binary MPEG-TS (.ts), fMP4 (.m4s), or XMLTV stream passthrough
      res.status(upstream.status);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-store');

      const contentRange = upstream.headers.get('content-range');
      if (contentRange) res.setHeader('Content-Range', contentRange);
      const acceptRanges = upstream.headers.get('accept-ranges');
      if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);

      if (!upstream.body || req.method === 'HEAD') {
        res.end();
        return;
      }

      const nodeStream = Readable.fromWeb(upstream.body as unknown as WebReadableStream);
      req.on('close', () => {
        nodeStream.destroy();
      });
      nodeStream.pipe(res);
    } catch (err) {
      res.status(502).json({
        error: 'Upstream stream gateway error',
        detail: err instanceof Error ? err.message : 'Unknown fetch error',
      });
    }
  }
);
