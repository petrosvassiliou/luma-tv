import type { Channel, SeriesItem, VodItem } from '../types/luma';

/**
 * Maps Unicode phonetic modifier / small-cap characters commonly used in IPTV
 * channel titles (e.g. `ᵁᴴᴰ`, `ᶠᴴᴰ`, `³⁸⁴⁰ᴾ`, `ꜱᴋʏ`) that standard NFKD does not
 * decompose into ASCII letters.
 */
const IPTV_UNICODE_MAP: Record<string, string> = {
  ᵃ: 'a',
  ᵇ: 'b',
  ᶜ: 'c',
  ᵈ: 'd',
  ᵉ: 'e',
  ᶠ: 'f',
  ᵍ: 'g',
  ʰ: 'h',
  ⁱ: 'i',
  ʲ: 'j',
  ᵏ: 'k',
  ˡ: 'l',
  ᵐ: 'm',
  ⁿ: 'n',
  ᵒ: 'o',
  ᵖ: 'p',
  ʳ: 'r',
  ˢ: 's',
  ᵗ: 't',
  ᵘ: 'u',
  ᵛ: 'v',
  ʷ: 'w',
  ˣ: 'x',
  ʸ: 'y',
  ᶻ: 'z',
  ᴬ: 'a',
  ᴮ: 'b',
  ᴰ: 'd',
  ᴱ: 'e',
  ᴳ: 'g',
  ᴴ: 'h',
  ᴵ: 'i',
  ᴶ: 'j',
  ᴷ: 'k',
  ᴸ: 'l',
  ᴹ: 'm',
  ᴺ: 'n',
  ᴼ: 'o',
  ᴾ: 'p',
  ᴿ: 'r',
  ᵀ: 't',
  ᵁ: 'u',
  ⱽ: 'v',
  ᵂ: 'w',
  ᴀ: 'a',
  ʙ: 'b',
  ᴄ: 'c',
  ᴅ: 'd',
  ᴇ: 'e',
  ꜰ: 'f',
  ɢ: 'g',
  ʜ: 'h',
  ɪ: 'i',
  ᴊ: 'j',
  ᴋ: 'k',
  ʟ: 'l',
  ᴍ: 'm',
  ɴ: 'n',
  ᴏ: 'o',
  ᴘ: 'p',
  ʀ: 'r',
  ꜱ: 's',
  ᴛ: 't',
  ᴜ: 'u',
  ᴠ: 'v',
  ᴡ: 'w',
  ʏ: 'y',
  ᴢ: 'z',
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
};

const IPTV_CHAR_REGEX = new RegExp(`[${Object.keys(IPTV_UNICODE_MAP).join('')}]`, 'g');

export function normalizeSearchText(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(IPTV_CHAR_REGEX, (ch) => IPTV_UNICODE_MAP[ch] ?? ch)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[|:•·_\-/#[\]()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeSearchQuery(rawQuery: string): string[] {
  const norm = normalizeSearchText(rawQuery);
  return norm ? norm.split(' ').filter(Boolean) : [];
}

/**
 * Detects provider category banner/divider dummy channels like `##### 4K UHD #####`
 * or `--- UK SPORTS ---`.
 */
export function isProviderDividerChannel(name: string): boolean {
  const trimmed = name.trim();
  return /^([#=*~-]{3,}|\|[-=]{2,})/.test(trimmed) || /[#=*~-]{4,}$/.test(trimmed);
}

interface CachedChannelNorm {
  nameNorm: string;
  groupNorm: string;
  combinedNorm: string;
  numStr: string;
}

const channelNormCache = new WeakMap<object, CachedChannelNorm>();

function getChannelNorm(
  ch: Pick<Channel, 'name' | 'groupName' | 'number' | 'shortCode'>
): CachedChannelNorm {
  const cached = channelNormCache.get(ch as object);
  if (cached) return cached;
  const nameNorm = normalizeSearchText(ch.name);
  const groupNorm = normalizeSearchText(ch.groupName);
  const shortNorm = normalizeSearchText(ch.shortCode);
  const numStr = String(ch.number);
  const entry: CachedChannelNorm = {
    nameNorm,
    groupNorm,
    combinedNorm: `${nameNorm} ${groupNorm} ${shortNorm} ${numStr}`,
    numStr,
  };
  channelNormCache.set(ch as object, entry);
  return entry;
}

export interface RankedSearchResult<T> {
  items: T[];
  totalMatches: number;
}

/**
 * High-throughput multi-token ranked search across 50,000+ IPTV channels.
 * Scans the entire catalog (no premature 8-item cutoff), normalizes IPTV Unicode
 * superscripts (`ᵁᴴᴰ ³⁸⁴⁰ᴾ` -> `uhd 3840p`), and ranks exact/prefix/title hits first.
 */
export function searchChannelsRanked<
  T extends Pick<Channel, 'name' | 'groupName' | 'number' | 'shortCode'>,
>(channels: readonly T[], rawQuery: string, limit = 200): RankedSearchResult<T> {
  const trimmed = rawQuery.trim();
  if (!trimmed) {
    return {
      items: channels.slice(0, limit),
      totalMatches: channels.length,
    };
  }

  const cleanNumericQuery = trimmed.startsWith('#') ? trimmed.slice(1).trim() : trimmed;
  const isPureDigits = /^\d+$/.test(cleanNumericQuery);
  const fullQueryNorm = normalizeSearchText(trimmed);
  const tokens = fullQueryNorm ? fullQueryNorm.split(' ').filter(Boolean) : [];

  if (tokens.length === 0 && !isPureDigits) {
    return {
      items: channels.slice(0, limit),
      totalMatches: channels.length,
    };
  }

  const scored: { item: T; score: number }[] = [];

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    const norm = getChannelNorm(ch);

    if (isPureDigits && norm.numStr === cleanNumericQuery) {
      scored.push({ item: ch, score: 1000 });
      continue;
    }

    let allMatch = true;
    for (let t = 0; t < tokens.length; t++) {
      if (!norm.combinedNorm.includes(tokens[t])) {
        allMatch = false;
        break;
      }
    }
    if (!allMatch) continue;

    let score = 10;
    if (norm.nameNorm === fullQueryNorm) {
      score = 900;
    } else if (norm.nameNorm.startsWith(fullQueryNorm)) {
      score = 750;
    } else if (norm.nameNorm.includes(` ${fullQueryNorm}`)) {
      score = 620;
    } else if (norm.nameNorm.includes(fullQueryNorm)) {
      score = 500;
    } else {
      // Check if all tokens are inside the channel name itself (vs group only)
      let allInName = true;
      for (let t = 0; t < tokens.length; t++) {
        if (!norm.nameNorm.includes(tokens[t])) {
          allInName = false;
          break;
        }
      }
      if (allInName) score = 350;
    }

    scored.push({ item: ch, score });
  }

  scored.sort((a, b) => b.score - a.score);

  const out: T[] = new Array(Math.min(limit, scored.length));
  for (let i = 0; i < out.length; i++) {
    out[i] = scored[i].item;
  }

  return {
    items: out,
    totalMatches: scored.length,
  };
}

export function matchesNormalizedQuery(text: string, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return true;
  const norm = normalizeSearchText(text);
  for (let i = 0; i < tokens.length; i++) {
    if (!norm.includes(tokens[i])) return false;
  }
  return true;
}

export function searchVodRanked(
  vodCatalog: readonly VodItem[],
  rawQuery: string,
  limit = 100
): RankedSearchResult<VodItem> {
  const tokens = tokenizeSearchQuery(rawQuery);
  if (tokens.length === 0) {
    return { items: vodCatalog.slice(0, limit), totalMatches: vodCatalog.length };
  }
  const matches: VodItem[] = [];
  for (let i = 0; i < vodCatalog.length; i++) {
    const v = vodCatalog[i];
    if (matchesNormalizedQuery(`${v.title} ${v.genre} ${v.year}`, tokens)) {
      matches.push(v);
    }
  }
  return {
    items: matches.slice(0, limit),
    totalMatches: matches.length,
  };
}

export function searchSeriesRanked(
  seriesCatalog: readonly SeriesItem[],
  rawQuery: string,
  limit = 100
): RankedSearchResult<SeriesItem> {
  const tokens = tokenizeSearchQuery(rawQuery);
  if (tokens.length === 0) {
    return { items: seriesCatalog.slice(0, limit), totalMatches: seriesCatalog.length };
  }
  const matches: SeriesItem[] = [];
  for (let i = 0; i < seriesCatalog.length; i++) {
    const s = seriesCatalog[i];
    if (matchesNormalizedQuery(`${s.title} ${s.genre} ${s.year}`, tokens)) {
      matches.push(s);
    }
  }
  return {
    items: matches.slice(0, limit),
    totalMatches: matches.length,
  };
}
