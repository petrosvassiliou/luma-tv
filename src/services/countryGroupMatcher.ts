import { matchesNormalizedQuery, tokenizeSearchQuery } from './channelSearch';

export interface SourceGroupSummary {
  id: string;
  name: string;
  count: number;
}

export interface CountryBucket {
  code: string;
  label: string;
  searchAliases: string;
  groupIds: string[];
  channelCount: number;
}

const COUNTRY_DIRECTORY: Record<string, { label: string; aliases: string }> = {
  DE: { label: 'Germany (DE)', aliases: 'de deu ger germany deutschland deutsch dach' },
  AT: { label: 'Austria (AT)', aliases: 'at aut austria oesterreich österreich' },
  CH: { label: 'Switzerland (CH)', aliases: 'ch che switzerland schweiz suisse svizzera' },
  UK: { label: 'United Kingdom (UK)', aliases: 'uk gb gbr united kingdom britain england english' },
  US: { label: 'United States (US)', aliases: 'us usa united states america american' },
  CA: { label: 'Canada (CA)', aliases: 'ca can canada canadian' },
  GR: { label: 'Greece (GR)', aliases: 'gr grc el greece griechenland hellas ελληνικα ελλαδα' },
  CY: { label: 'Cyprus (CY)', aliases: 'cy cyp cyprus zypern κυπρος' },
  IT: { label: 'Italy (IT)', aliases: 'it ita italy italien italia italiano' },
  FR: { label: 'France (FR)', aliases: 'fr fra france frankreich francais' },
  ES: { label: 'Spain (ES)', aliases: 'es esp spain spanien espana español' },
  PT: { label: 'Portugal (PT)', aliases: 'pt prt portugal portuguese' },
  NL: { label: 'Netherlands (NL)', aliases: 'nl nld netherlands holland niederlande dutch' },
  BE: { label: 'Belgium (BE)', aliases: 'be bel belgium belgien belgique' },
  PL: { label: 'Poland (PL)', aliases: 'pl pol poland polen polska' },
  TR: { label: 'Turkey (TR)', aliases: 'tr tur turkey tuerkei türkei turkiye' },
  SE: { label: 'Sweden (SE)', aliases: 'se swe sweden schweden sverige' },
  NO: { label: 'Norway (NO)', aliases: 'no nor norway norwegen norge' },
  DK: { label: 'Denmark (DK)', aliases: 'dk dnk denmark daenemark dänemark danmark' },
  FI: { label: 'Finland (FI)', aliases: 'fi fin finland finnland suomi' },
  RO: { label: 'Romania (RO)', aliases: 'ro rou romania rumaenien rumänien' },
  BG: { label: 'Bulgaria (BG)', aliases: 'bg bgr bulgaria bulgarien' },
  HR: { label: 'Croatia (HR)', aliases: 'hr hrv croatia kroatien hrvatska' },
  RS: { label: 'Serbia (RS)', aliases: 'rs srb serbia serbien srbija' },
  BA: { label: 'Bosnia (BA)', aliases: 'ba bih bosnia bosnien' },
  AL: { label: 'Albania (AL)', aliases: 'al alb albania albanien shqip' },
  HU: { label: 'Hungary (HU)', aliases: 'hu hun hungary ungarn magyar' },
  CZ: { label: 'Czechia (CZ)', aliases: 'cz cze czechia czech tschechien' },
  SK: { label: 'Slovakia (SK)', aliases: 'sk svk slovakia slowakei' },
  UA: { label: 'Ukraine (UA)', aliases: 'ua ukr ukraine' },
  IE: { label: 'Ireland (IE)', aliases: 'ie irl ireland irland' },
  BR: { label: 'Brazil (BR)', aliases: 'br bra brazil brasilien brasil' },
  AR: { label: 'Argentina (AR)', aliases: 'ar arg argentina argentinien' },
  MX: { label: 'Mexico (MX)', aliases: 'mx mex mexico mexiko' },
  AU: { label: 'Australia (AU)', aliases: 'au aus australia australien' },
  IN: { label: 'India (IN)', aliases: 'in ind india indien' },
  ARAB: { label: 'Arabic (ARAB)', aliases: 'ar arab arabic mena middle east' },
  LATAM: { label: 'Latin America (LATAM)', aliases: 'latam latino latin america' },
  EXYU: { label: 'Ex-Yu / Balkan', aliases: 'exyu ex-yu balkan' },
  '4K': { label: '4K / UHD', aliases: '4k uhd 3840p ultra hd' },
  VIP: { label: 'VIP / Featured', aliases: 'vip premium featured' },
};

const CODE_NORMALIZATION: Record<string, string> = {
  GER: 'DE',
  DEU: 'DE',
  GERMANY: 'DE',
  DEUTSCHLAND: 'DE',
  AUT: 'AT',
  AUSTRIA: 'AT',
  CHE: 'CH',
  SWITZERLAND: 'CH',
  GB: 'UK',
  GBR: 'UK',
  ENGLAND: 'UK',
  USA: 'US',
  CAN: 'CA',
  CANADA: 'CA',
  GRC: 'GR',
  EL: 'GR',
  GREECE: 'GR',
  HELLAS: 'GR',
  CYP: 'CY',
  CYPRUS: 'CY',
  ITA: 'IT',
  ITALY: 'IT',
  ITALIA: 'IT',
  FRA: 'FR',
  FRANCE: 'FR',
  ESP: 'ES',
  SPAIN: 'ES',
  ESPANA: 'ES',
  PRT: 'PT',
  PORTUGAL: 'PT',
  NLD: 'NL',
  HOLLAND: 'NL',
  NETHERLANDS: 'NL',
  BEL: 'BE',
  BELGIUM: 'BE',
  POL: 'PL',
  POLAND: 'PL',
  TUR: 'TR',
  TURKEY: 'TR',
  SWE: 'SE',
  SWEDEN: 'SE',
  NOR: 'NO',
  NORWAY: 'NO',
  DNK: 'DK',
  DENMARK: 'DK',
  FIN: 'FI',
  FINLAND: 'FI',
  ROU: 'RO',
  ROMANIA: 'RO',
  BGR: 'BG',
  BULGARIA: 'BG',
  HRV: 'HR',
  CROATIA: 'HR',
  SRB: 'RS',
  SERBIA: 'RS',
  ALB: 'AL',
  ALBANIA: 'AL',
  UHD: '4K',
  'EX-YU': 'EXYU',
  ARABIC: 'ARAB',
};

/**
 * Extracts a country / region prefix code from common IPTV group naming conventions:
 * e.g. `DE | SPORT`, `|GR| CINEMA`, `[UK] ENTERTAINMENT`, `IT: SKY`, `4K: SPORT`, `US - NEWS`.
 */
export function detectCountryCodeFromGroupName(groupName: string): string | null {
  const cleaned = groupName
    .replace(/^[\s#*•\-_|[\]()]+/, '')
    .trim()
    .toUpperCase();
  if (!cleaned) return null;

  // Match explicit delimiter patterns first: `XX | ...`, `XX : ...`, `XX - ...`, `XX / ...`
  const delimiterMatch = /^([A-Z0-9-]{2,11})\s*(?:\||:|\/|¦|»|-|\])\s+/.exec(cleaned);
  const rawCandidate = delimiterMatch ? delimiterMatch[1] : cleaned.split(/\s+/)[0];
  const candidate = rawCandidate.replace(/[^A-Z0-9-]/g, '');

  const normalized = CODE_NORMALIZATION[candidate] ?? candidate;
  if (COUNTRY_DIRECTORY[normalized]) {
    return normalized;
  }

  // If explicit 2-letter uppercase prefix was separated by `|` or `:` (e.g. `ZA | SPORTS`), keep it
  if (delimiterMatch && /^[A-Z]{2}$/.test(normalized)) {
    return normalized;
  }

  // Fallback: check full-word country name anywhere in the group title
  for (const [key, mapped] of Object.entries(CODE_NORMALIZATION)) {
    if (key.length >= 5 && cleaned.includes(key)) {
      return mapped;
    }
  }

  return null;
}

/**
 * Aggregates playlist groups into searchable Country / Region buckets.
 */
export function buildCountryBuckets(groups: SourceGroupSummary[]): CountryBucket[] {
  const map = new Map<string, CountryBucket>();

  for (const grp of groups) {
    const code = detectCountryCodeFromGroupName(grp.name) ?? 'OTHER';
    const meta =
      COUNTRY_DIRECTORY[code] ??
      (code === 'OTHER'
        ? { label: 'Other / International', aliases: 'other international general misc' }
        : { label: code, aliases: code.toLowerCase() });

    const existing = map.get(code);
    if (existing) {
      existing.groupIds.push(grp.id);
      existing.channelCount += grp.count;
    } else {
      map.set(code, {
        code,
        label: meta.label,
        searchAliases: `${code} ${meta.label} ${meta.aliases}`,
        groupIds: [grp.id],
        channelCount: grp.count,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    if (a.code === 'OTHER') return 1;
    if (b.code === 'OTHER') return -1;
    return b.channelCount - a.channelCount;
  });
}

export function filterCountryBuckets(
  buckets: CountryBucket[],
  query: string
): CountryBucket[] {
  const tokens = tokenizeSearchQuery(query);
  if (tokens.length === 0) return buckets;
  return buckets.filter((b) => matchesNormalizedQuery(b.searchAliases, tokens));
}

/**
 * Computes the next `hiddenGroupIds` array when either:
 * - `enable-only`: ONLY `selectedGroupIds` remain enabled, and all other groups are disabled
 * - `disable-only`: `selectedGroupIds` are disabled, and all other groups are enabled (vice versa)
 */
export function computeExclusiveGroupVisibility(
  allGroupIds: string[],
  selectedGroupIds: Iterable<string>,
  mode: 'enable-only-selected' | 'disable-only-selected'
): string[] {
  const selected = new Set(selectedGroupIds);
  if (mode === 'enable-only-selected') {
    return allGroupIds.filter((id) => !selected.has(id));
  }
  return allGroupIds.filter((id) => selected.has(id));
}
