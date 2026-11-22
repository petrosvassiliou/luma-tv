import type { StoredChannel, StoredEpgProgram, StoredVodItem } from '../db/lumaDb';
import type { Channel, ProgramCategory } from '../types/luma';

const ACCENT_PALETTE = ['#38BDF8', '#60A5FA', '#22D3EE', '#818CF8', '#34D399', '#0EA5E9'];

export function slugifyGroup(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'uncategorized'
  );
}

export function extractM3uAttr(line: string, attr: string): string {
  const regex = new RegExp(`${attr}="([^"]*)"`, 'i');
  const match = regex.exec(line);
  return match ? match[1].trim() : '';
}

export function makeChannelShortCode(name: string, index: number): string {
  const letters = name
    .replace(/[^A-Za-z0-9 ]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (letters.length >= 2) {
    return (letters[0].slice(0, 2) + letters[1].slice(0, 2)).toUpperCase();
  }
  if (letters.length === 1 && letters[0].length >= 2) {
    return letters[0].slice(0, 4).toUpperCase();
  }
  return `CH${(index % 99) + 1}`;
}

export function parseM3uContent(
  sourceId: string,
  content: string,
  onProgress?: (count: number, percent: number) => void
): {
  channels: StoredChannel[];
  vodItems: StoredVodItem[];
  discoveredXmltvUrl?: string;
} {
  const lines = content.split(/\r?\n/);
  const channels: StoredChannel[] = [];
  const vodItems: StoredVodItem[] = [];
  let discoveredXmltvUrl: string | undefined;

  let pendingInf: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith('#EXTM3U')) {
      const urlTvg = extractM3uAttr(line, 'url-tvg') || extractM3uAttr(line, 'x-tvg-url');
      if (urlTvg) {
        discoveredXmltvUrl = urlTvg.split(',')[0].trim();
      }
      continue;
    }

    if (line.startsWith('#EXTINF:')) {
      pendingInf = line;
      continue;
    }

    if (line.startsWith('#')) {
      continue;
    }

    const streamUrl = line;
    const inf = pendingInf ?? '#EXTINF:-1,Unbenannter Kanal';
    pendingInf = null;

    const commaIndex = inf.lastIndexOf(',');
    const rawTitle =
      commaIndex >= 0 ? inf.slice(commaIndex + 1).trim() : `Stream ${channels.length + 1}`;
    const tvgId = extractM3uAttr(inf, 'tvg-id');
    const tvgLogo = extractM3uAttr(inf, 'tvg-logo');
    const groupTitle = extractM3uAttr(inf, 'group-title') || 'Allgemein';
    const catchupMode = extractM3uAttr(inf, 'catchup') || extractM3uAttr(inf, 'tvg-rec');
    const catchupDaysRaw = Number(extractM3uAttr(inf, 'catchup-days') || '0');
    const chNoRaw = Number(extractM3uAttr(inf, 'tvg-chno') || '0');

    const lowerUrl = streamUrl.toLowerCase();
    const isVod =
      lowerUrl.endsWith('.mp4') ||
      lowerUrl.endsWith('.mkv') ||
      lowerUrl.includes('/movie/');

    if (isVod) {
      const idx = vodItems.length;
      const upper = rawTitle.toUpperCase();
      vodItems.push({
        id: `${sourceId}-vod-${idx + 1}`,
        sourceId,
        title: rawTitle,
        year: 2025,
        genre: groupTitle,
        durationMin: 95,
        rating: '8.3',
        resolution: upper.includes('4K') || upper.includes('UHD') ? '4K HDR' : '1080p',
        codec: upper.includes('HEVC') || upper.includes('4K') ? 'HEVC' : 'H.264',
        streamUrl,
        synopsis: `Importierter VOD-Stream aus Gruppe „${groupTitle}“.`,
        accentFrom: ACCENT_PALETTE[idx % ACCENT_PALETTE.length],
        accentTo: '#0F172A',
      });
    } else {
      const idx = channels.length;
      const number = chNoRaw > 0 ? chNoRaw : idx + 1;
      const upper = rawTitle.toUpperCase();
      const is4k = upper.includes('4K') || upper.includes('UHD');
      const isTs = lowerUrl.endsWith('.ts') && !lowerUrl.endsWith('.m3u8');

      channels.push({
        id: `${sourceId}-ch-${idx + 1}`,
        sourceId,
        number,
        sortOrder: idx,
        name: rawTitle,
        shortCode: makeChannelShortCode(rawTitle, idx),
        groupId: slugifyGroup(groupTitle),
        groupName: groupTitle,
        streamUrl,
        streamType: isTs ? 'mpegts' : 'hls',
        resolution: is4k ? '4K HDR' : upper.includes('720') ? '720p' : '1080p',
        audioBadge: is4k ? 'Dolby Atmos' : 'EAC3 5.1',
        codec: is4k || upper.includes('HEVC') ? 'HEVC' : 'H.264',
        hasCatchup: Boolean(catchupMode) || catchupDaysRaw > 0,
        catchupDays: catchupDaysRaw > 0 ? catchupDaysRaw : catchupMode ? 7 : 0,
        accentColor: ACCENT_PALETTE[idx % ACCENT_PALETTE.length],
        country: 'INT',
        epgArchetype: idx % 6,
        tvgId: tvgId || undefined,
        logoUrl: tvgLogo || undefined,
      });
    }

    const total = channels.length + vodItems.length;
    if (onProgress && total % 1500 === 0) {
      const pct = Math.min(88, Math.round((i / Math.max(1, lines.length)) * 88));
      onProgress(total, pct);
    }
  }

  return { channels, vodItems, discoveredXmltvUrl };
}

export function exportChannelsToM3uPlus(bouquetName: string, channels: Channel[]): string {
  const lines = [`#EXTM3U x-luma-bouquet="${bouquetName}"`];
  for (const ch of channels) {
    const attrs = [
      `tvg-chno="${ch.number}"`,
      ch.tvgId ? `tvg-id="${ch.tvgId}"` : '',
      `group-title="${bouquetName}"`,
      ch.hasCatchup ? `catchup="default" catchup-days="${ch.catchupDays}"` : '',
    ]
      .filter(Boolean)
      .join(' ');
    lines.push(`#EXTINF:-1 ${attrs},${ch.name}`);
    lines.push(ch.streamUrl);
  }
  return lines.join('\n');
}

export function parseXmltvTimestamp(raw: string): number {
  const cleaned = raw.trim();
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?/.exec(
    cleaned
  );
  if (!match) return Date.now();
  const [, yr, mo, da, hr, mi, se, sign, tzH, tzM] = match;
  const utcMs = Date.UTC(
    Number(yr),
    Number(mo) - 1,
    Number(da),
    Number(hr),
    Number(mi),
    Number(se)
  );
  if (!sign || !tzH || !tzM) return utcMs;
  const offsetMinutes = Number(tzH) * 60 + Number(tzM);
  return sign === '+' ? utcMs - offsetMinutes * 60_000 : utcMs + offsetMinutes * 60_000;
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function mapXmlCategory(cat: string): ProgramCategory {
  const c = cat.toLowerCase();
  if (c.includes('sport')) return 'Live Sport';
  if (c.includes('movie') || c.includes('film')) return 'Spielfilm';
  if (c.includes('news') || c.includes('nachricht')) return 'Nachrichten';
  if (c.includes('space') || c.includes('science') || c.includes('wissen'))
    return 'Wissen & Raumfahrt';
  if (c.includes('doc') || c.includes('doku')) return 'Dokumentation';
  if (c.includes('sci') || c.includes('serie')) return 'Sci-Fi & Serie';
  if (c.includes('anim') || c.includes('kids')) return 'Animation';
  return 'Kultur & Musik';
}

export function parseXmltvDocument(
  sourceId: string,
  xmlText: string,
  nowMs = Date.now(),
  onProgress?: (count: number) => void
): StoredEpgProgram[] {
  const programs: StoredEpgProgram[] = [];
  const progRegex = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi;
  let match: RegExpExecArray | null;
  let count = 0;

  while ((match = progRegex.exec(xmlText)) !== null) {
    const attrs = match[1];
    const inner = match[2];

    const startRaw = extractM3uAttr(attrs, 'start');
    const stopRaw = extractM3uAttr(attrs, 'stop');
    const channelAttr = extractM3uAttr(attrs, 'channel');
    if (!startRaw || !channelAttr) continue;

    const startMs = parseXmltvTimestamp(startRaw);
    const endMs = stopRaw ? parseXmltvTimestamp(stopRaw) : startMs + 45 * 60_000;

    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(inner);
    const subMatch = /<sub-title[^>]*>([\s\S]*?)<\/sub-title>/i.exec(inner);
    const descMatch = /<desc[^>]*>([\s\S]*?)<\/desc>/i.exec(inner);
    const catMatch = /<category[^>]*>([\s\S]*?)<\/category>/i.exec(inner);

    const title = titleMatch ? decodeXmlEntities(titleMatch[1].trim()) : 'Sendung';
    const subtitle = subMatch ? decodeXmlEntities(subMatch[1].trim()) : 'Live-Übertragung';
    const description = descMatch
      ? decodeXmlEntities(descMatch[1].trim())
      : 'XMLTV Programminformation.';
    const category = mapXmlCategory(catMatch ? catMatch[1] : '');

    programs.push({
      id: `${sourceId}-epg-${channelAttr}-${startMs}`,
      sourceId,
      channelId: channelAttr,
      tvgId: channelAttr,
      title,
      subtitle,
      description,
      category,
      startMs,
      endMs,
      hasCatchup: endMs <= nowMs,
    });

    count++;
    if (onProgress && count % 2500 === 0) {
      onProgress(count);
    }
  }

  return programs;
}
