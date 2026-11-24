export interface ExternalSubtitleEntry {
  id: string;
  name: string;
  lang: string;
  rawText: string;
}

function parseTimestampToMs(raw: string): number | null {
  const clean = raw.trim().replace(',', '.');
  const parts = clean.split(':');
  if (parts.length === 3) {
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    const s = Number(parts[2]);
    if (Number.isFinite(h) && Number.isFinite(m) && Number.isFinite(s)) {
      return Math.round((h * 3600 + m * 60 + s) * 1000);
    }
  } else if (parts.length === 2) {
    const m = Number(parts[0]);
    const s = Number(parts[1]);
    if (Number.isFinite(m) && Number.isFinite(s)) {
      return Math.round((m * 60 + s) * 1000);
    }
  }
  return null;
}

export function formatWebVttTimestamp(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const hours = Math.floor(clamped / 3_600_000);
  const minutes = Math.floor((clamped % 3_600_000) / 60_000);
  const seconds = Math.floor((clamped % 60_000) / 1000);
  const millis = clamped % 1000;

  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  const mmm = String(millis).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${mmm}`;
}

function shiftTimingLine(line: string, offsetMs: number): string | null {
  const arrowIdx = line.indexOf('-->');
  if (arrowIdx < 0) return null;

  const left = line.slice(0, arrowIdx).trim();
  const rightFull = line.slice(arrowIdx + 3).trim();
  const spaceIdx = rightFull.search(/\s/);
  const rightTs = spaceIdx >= 0 ? rightFull.slice(0, spaceIdx) : rightFull;
  const settingsSuffix = spaceIdx >= 0 ? rightFull.slice(spaceIdx) : '';

  const startMs = parseTimestampToMs(left);
  const endMs = parseTimestampToMs(rightTs);
  if (startMs === null || endMs === null) return null;

  const shiftedStart = Math.max(0, startMs + offsetMs);
  const shiftedEnd = Math.max(shiftedStart + 100, endMs + offsetMs);

  return `${formatWebVttTimestamp(shiftedStart)} --> ${formatWebVttTimestamp(shiftedEnd)}${settingsSuffix}`;
}

function convertAssOrSsaToWebVtt(normalized: string, offsetMs: number): string {
  const lines = normalized.split('\n');
  const cues: string[] = ['WEBVTT', ''];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('Dialogue:')) continue;
    const afterPrefix = line.slice('Dialogue:'.length).trim();
    // Standard ASS Dialogue has 9 commas before the Text field:
    // Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
    const parts: string[] = [];
    let cursor = 0;
    for (let commaCount = 0; commaCount < 9; commaCount++) {
      const nextComma = afterPrefix.indexOf(',', cursor);
      if (nextComma < 0) break;
      parts.push(afterPrefix.slice(cursor, nextComma).trim());
      cursor = nextComma + 1;
    }
    if (parts.length < 9) continue;
    const rawDialogueText = afterPrefix.slice(cursor);
    const startMs = parseTimestampToMs(parts[1]);
    const endMs = parseTimestampToMs(parts[2]);
    if (startMs === null || endMs === null) continue;

    const cleanText = rawDialogueText
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\[Nn]/g, '\n')
      .replace(/\\h/g, ' ')
      .trim();
    if (!cleanText) continue;

    const sStart = Math.max(0, startMs + offsetMs);
    const sEnd = Math.max(sStart + 100, endMs + offsetMs);
    cues.push(`${formatWebVttTimestamp(sStart)} --> ${formatWebVttTimestamp(sEnd)}`);
    cues.push(cleanText);
    cues.push('');
  }

  return cues.join('\n');
}

/**
 * Converts SubRip (.srt), SubStation Alpha (.ass / .ssa), or WebVTT (.vtt) text
 * into valid W3C WebVTT and applies an optional timing offset (in seconds).
 */
export function convertSubtitleToWebVtt(rawText: string, offsetSec = 0): string {
  const normalized = rawText
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  if (!normalized) {
    return 'WEBVTT\n\n';
  }

  const offsetMs = Math.round(offsetSec * 1000);

  if (/^\[Script Info\]/i.test(normalized) || /\nDialogue:\s*\d+,/i.test(normalized)) {
    return convertAssOrSsaToWebVtt(normalized, offsetMs);
  }

  const rawLines = normalized.split('\n');
  const outLines: string[] = ['WEBVTT', ''];

  let startIdx = 0;
  if (/^WEBVTT\b/i.test(rawLines[0].trim())) {
    startIdx = 1;
    while (startIdx < rawLines.length && rawLines[startIdx].trim() === '') {
      startIdx++;
    }
  }

  for (let i = startIdx; i < rawLines.length; i++) {
    const line = rawLines[i];
    const trimmed = line.trim();

    // Skip standalone numeric SRT sequence indices immediately preceding a timing line
    if (
      /^\d+$/.test(trimmed) &&
      i + 1 < rawLines.length &&
      rawLines[i + 1].includes('-->')
    ) {
      continue;
    }

    if (trimmed.includes('-->')) {
      const converted = shiftTimingLine(trimmed, offsetMs);
      if (converted) {
        outLines.push(converted);
        continue;
      }
    }

    outLines.push(line);
  }

  return `${outLines.join('\n').trim()}\n`;
}

export function detectSubtitleLanguageFromFilename(filename: string): {
  lang: string;
  label: string;
} {
  const clean = filename.replace(/\.(srt|vtt|ass|ssa)$/i, '');
  const lower = clean.toLowerCase();

  const patterns: [RegExp, string, string][] = [
    [/(?:^|[._\-\s])(de|deu|ger|german|deutsch)(?:$|[._\-\s])/i, 'de', 'Deutsch'],
    [/(?:^|[._\-\s])(en|eng|english)(?:$|[._\-\s])/i, 'en', 'English'],
    [/(?:^|[._\-\s])(el|ell|gre|gr|greek)(?:$|[._\-\s])/i, 'el', 'Ελληνικά'],
    [/(?:^|[._\-\s])(it|ita|italian|italiano)(?:$|[._\-\s])/i, 'it', 'Italiano'],
    [/(?:^|[._\-\s])(fr|fra|fre|french|francais)(?:$|[._\-\s])/i, 'fr', 'Français'],
    [/(?:^|[._\-\s])(es|spa|spanish|espanol)(?:$|[._\-\s])/i, 'es', 'Español'],
  ];

  for (const [regex, lang, langName] of patterns) {
    if (regex.test(lower)) {
      return { lang, label: `${langName} (${filename.slice(0, 28)})` };
    }
  }

  return {
    lang: 'ext',
    label: clean.length > 32 ? `${clean.slice(0, 30)}…` : clean || filename,
  };
}

export async function fetchRemoteSubtitleText(
  rawUrl: string,
  proxyEndpoint?: string
): Promise<string> {
  const trimmed = rawUrl.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    throw new Error('Subtitle URL must start with http:// or https://');
  }

  // 1. Prefer CORS-free Tauri native Rust fetch when running in native window
  if (typeof window !== 'undefined') {
    const w = window as unknown as {
      __TAURI_INTERNALS__?: {
        invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
      };
    };
    const invoke = w.__TAURI_INTERNALS__?.invoke;
    if (invoke) {
      return await invoke<string>('luma_native_fetch_text', { url: trimmed });
    }
  }

  // 2. Try direct CORS fetch, then fallback to configured stream proxy
  try {
    const directRes = await fetch(trimmed);
    if (directRes.ok) {
      return await directRes.text();
    }
  } catch {
    // Fall through to proxy fetch
  }

  if (proxyEndpoint && proxyEndpoint.trim()) {
    const cleanProxy = proxyEndpoint.trim().replace(/\/+$/, '');
    const proxiedRes = await fetch(`${cleanProxy}?url=${encodeURIComponent(trimmed)}`);
    if (proxiedRes.ok) {
      return await proxiedRes.text();
    }
  }

  throw new Error('Could not download remote subtitle file.');
}
