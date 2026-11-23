import type { Channel, EpgProgram } from '../types/luma';

export function formatPlaybackClock(rawSeconds: number): string {
  const total = Math.max(0, Math.floor(rawSeconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export interface ParsedXtreamCredentials {
  origin: string;
  username: string;
  password: string;
  streamId: string;
  extension: string;
}

const XTREAM_LIVE_URL_REGEX =
  /^(https?:\/\/[^/?#]+)\/(?:live\/)?([^/]+)\/([^/]+)\/(\d+)(?:\.(m3u8|ts))?(?:\?.*)?$/i;

export function parseXtreamLiveStreamUrl(rawUrl: string): ParsedXtreamCredentials | null {
  const match = XTREAM_LIVE_URL_REGEX.exec(rawUrl.trim());
  if (!match) return null;
  const [, origin, username, password, streamId, ext] = match;
  return {
    origin,
    username,
    password,
    streamId,
    extension: (ext || 'ts').toLowerCase(),
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function expandCatchupMacros(
  template: string,
  startMs: number,
  endMs: number,
  nowMs: number
): string {
  const startDate = new Date(startMs);
  const utc = Math.floor(startMs / 1000);
  const utcEnd = Math.floor(endMs / 1000);
  const lutc = Math.floor(nowMs / 1000);
  const offsetSec = Math.max(0, lutc - utc);
  const durationSec = Math.max(60, Math.round((endMs - startMs) / 1000));
  const durationMin = Math.max(1, Math.round((endMs - startMs) / 60_000));

  const Y = String(startDate.getUTCFullYear());
  const m = pad2(startDate.getUTCMonth() + 1);
  const d = pad2(startDate.getUTCDate());
  const H = pad2(startDate.getUTCHours());
  const M = pad2(startDate.getUTCMinutes());
  const S = pad2(startDate.getUTCSeconds());

  return template
    .replace(/\$\{start\}|\{utc\}/gi, String(utc))
    .replace(/\$\{end\}|\{utcend\}/gi, String(utcEnd))
    .replace(/\$\{timestamp\}|\{lutc\}/gi, String(lutc))
    .replace(/\$\{offset\}/gi, String(offsetSec))
    .replace(/\$\{duration:60\}|\{duration:60\}/gi, String(durationMin))
    .replace(/\$\{duration\}|\{duration\}/gi, String(durationSec))
    .replace(/\{Y\}/g, Y)
    .replace(/\{m\}/g, m)
    .replace(/\{d\}/g, d)
    .replace(/\{H\}/g, H)
    .replace(/\{M\}/g, M)
    .replace(/\{S\}/g, S);
}

/**
 * Builds a real provider Catch-Up / Timeshift playback URL for:
 * 1. M3U_Plus `catchup-source` macro templates (`default`, `append`, `flussonic`, `shift`)
 * 2. Xtream Codes `/timeshift/{user}/{pass}/{duration_min}/{YYYY-MM-DD:HH-mm}/{stream_id}.{ext}`
 * 3. Flussonic (`index-{utc}-{duration}.m3u8`) and Shift (`?utc=...&lutc=...`) conventions
 * Falls back cleanly to `channel.streamUrl` for reference/demo streams.
 */
export function buildCatchupStreamUrl(
  channel: Channel,
  program: EpgProgram,
  nowMs = Date.now()
): string {
  const startMs = program.startMs;
  const endMs = Math.max(program.endMs, startMs + 60_000);
  const mode = (channel.catchupMode || '').trim().toLowerCase();
  const customSource = (channel.catchupSource || '').trim();

  // 1. Explicit M3U_Plus `catchup-source="..."` template
  if (customSource) {
    const expanded = expandCatchupMacros(customSource, startMs, endMs, nowMs);
    if (
      mode === 'append' ||
      expanded.startsWith('?') ||
      expanded.startsWith('&') ||
      expanded.startsWith('/')
    ) {
      if (expanded.startsWith('?') && channel.streamUrl.includes('?')) {
        return `${channel.streamUrl}&${expanded.slice(1)}`;
      }
      return `${channel.streamUrl}${expanded}`;
    }
    return expanded;
  }

  // 2. Flussonic archive convention (`catchup="flussonic"` or `catchup="fs"`)
  if (mode === 'flussonic' || mode === 'fs') {
    const utc = Math.floor(startMs / 1000);
    const durationSec = Math.max(60, Math.round((endMs - startMs) / 1000));
    if (/\/(index|mono)\.m3u8(\?.*)?$/i.test(channel.streamUrl)) {
      return channel.streamUrl.replace(
        /\/(index|mono)\.m3u8(\?.*)?$/i,
        `/index-${utc}-${durationSec}.m3u8$2`
      );
    }
    const clean = channel.streamUrl.replace(/\/+$/, '');
    return `${clean}/index-${utc}-${durationSec}.m3u8`;
  }

  // 3. Shift query convention (`catchup="shift"`)
  if (mode === 'shift') {
    const utc = Math.floor(startMs / 1000);
    const lutc = Math.floor(nowMs / 1000);
    const sep = channel.streamUrl.includes('?') ? '&' : '?';
    return `${channel.streamUrl}${sep}utc=${utc}&lutc=${lutc}`;
  }

  // 4. Xtream Codes Timeshift endpoint (`/timeshift/{user}/{pass}/{duration}/{YYYY-MM-DD:HH-mm}/{id}.{ext}`)
  const xt = parseXtreamLiveStreamUrl(channel.streamUrl);
  if (xt) {
    const d = new Date(startMs);
    const startFormatted =
      `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}:` +
      `${pad2(d.getUTCHours())}-${pad2(d.getUTCMinutes())}`;
    const durationMin = Math.max(1, Math.round((endMs - startMs) / 60_000));
    const streamId = channel.xtreamStreamId ? String(channel.xtreamStreamId) : xt.streamId;
    return `${xt.origin}/timeshift/${xt.username}/${xt.password}/${durationMin}/${startFormatted}/${streamId}.${xt.extension}`;
  }

  // 5. Reference / Demo stream fallback
  return channel.streamUrl;
}
