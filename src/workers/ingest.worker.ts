/// <reference lib="webworker" />

import type { StoredChannel, StoredEpgProgram, StoredVodItem } from '../db/lumaDb';
import {
  makeChannelShortCode,
  parseM3uContent,
  parseXmltvDocument,
  slugifyGroup,
} from './parsers';

export type WorkerIngestRequest =
  | {
      type: 'parse-m3u';
      sourceId: string;
      rawText?: string;
      url?: string;
      proxyEndpoint?: string;
    }
  | {
      type: 'ingest-xtream';
      sourceId: string;
      serverUrl: string;
      username: string;
      password: string;
      outputFormat: 'm3u8' | 'ts';
      proxyEndpoint?: string;
    }
  | {
      type: 'parse-xmltv';
      sourceId: string;
      rawBuffer?: ArrayBuffer;
      rawText?: string;
      url?: string;
      proxyEndpoint?: string;
    };

export type WorkerIngestResponse =
  | {
      type: 'progress';
      phase: string;
      percent: number;
    }
  | {
      type: 'm3u-result';
      sourceId: string;
      channels: StoredChannel[];
      vodItems: StoredVodItem[];
      discoveredXmltvUrl?: string;
      elapsedMs: number;
    }
  | {
      type: 'xmltv-result';
      sourceId: string;
      programs: StoredEpgProgram[];
      elapsedMs: number;
    }
  | {
      type: 'error';
      message: string;
    };

const ACCENT_PALETTE = ['#38BDF8', '#60A5FA', '#22D3EE', '#818CF8', '#34D399', '#0EA5E9'];

function wrapProxy(url: string, proxyEndpoint?: string): string {
  if (!proxyEndpoint || !proxyEndpoint.trim()) return url;
  const clean = proxyEndpoint.trim().replace(/\/+$/, '');
  return `${clean}?url=${encodeURIComponent(url)}`;
}

async function decompressIfGzip(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

  if (isGzip && typeof DecompressionStream !== 'undefined') {
    self.postMessage({
      type: 'progress',
      phase: 'Dekomprimiere .xml.gz Stream im WebWorker…',
      percent: 28,
    } satisfies WorkerIngestResponse);

    const ds = new DecompressionStream('gzip');
    const decompressedStream = new Blob([buffer]).stream().pipeThrough(ds);
    return await new Response(decompressedStream).text();
  }

  return new TextDecoder('utf-8').decode(buffer);
}

self.onmessage = async (event: MessageEvent<WorkerIngestRequest>) => {
  const req = event.data;
  const t0 = performance.now();

  try {
    if (req.type === 'parse-m3u') {
      self.postMessage({
        type: 'progress',
        phase: req.url ? 'Lade M3U_Plus Playlist…' : 'Analysiere M3U_Plus Struktur…',
        percent: 15,
      } satisfies WorkerIngestResponse);

      let text = req.rawText ?? '';
      if (!text && req.url) {
        const res = await fetch(wrapProxy(req.url, req.proxyEndpoint));
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} beim Laden der M3U-URL`);
        }
        text = await res.text();
      }

      const parsed = parseM3uContent(req.sourceId, text, (total, percent) => {
        self.postMessage({
          type: 'progress',
          phase: `${total.toLocaleString('de-DE')} Einträge geparst…`,
          percent,
        } satisfies WorkerIngestResponse);
      });

      self.postMessage({
        type: 'm3u-result',
        sourceId: req.sourceId,
        channels: parsed.channels,
        vodItems: parsed.vodItems,
        discoveredXmltvUrl: parsed.discoveredXmltvUrl,
        elapsedMs: Math.round(performance.now() - t0),
      } satisfies WorkerIngestResponse);
      return;
    }

    if (req.type === 'ingest-xtream') {
      const base = req.serverUrl.trim().replace(/\/+$/, '');
      const authParams = `username=${encodeURIComponent(req.username)}&password=${encodeURIComponent(req.password)}`;

      self.postMessage({
        type: 'progress',
        phase: 'Authentifiziere Xtream Codes API…',
        percent: 18,
      } satisfies WorkerIngestResponse);

      const [catsRes, streamsRes] = await Promise.all([
        fetch(
          wrapProxy(
            `${base}/player_api.php?${authParams}&action=get_live_categories`,
            req.proxyEndpoint
          )
        ),
        fetch(
          wrapProxy(
            `${base}/player_api.php?${authParams}&action=get_live_streams`,
            req.proxyEndpoint
          )
        ),
      ]);

      if (!catsRes.ok || !streamsRes.ok) {
        throw new Error(`Xtream Server antwortete mit HTTP ${streamsRes.status}`);
      }

      const categories = (await catsRes.json()) as {
        category_id: string;
        category_name: string;
      }[];
      const streams = (await streamsRes.json()) as {
        num?: number;
        name: string;
        stream_id: number;
        stream_icon?: string;
        epg_channel_id?: string;
        category_id?: string;
        tv_archive?: number;
        tv_archive_duration?: number;
      }[];

      const catMap = new Map<string, string>();
      for (const c of categories) {
        catMap.set(String(c.category_id), c.category_name);
      }

      const ext = req.outputFormat === 'ts' ? 'ts' : 'm3u8';
      const channels: StoredChannel[] = streams.map((s, idx) => {
        const groupName = catMap.get(String(s.category_id ?? '')) || 'Xtream Live';
        const upper = (s.name || '').toUpperCase();
        const is4k = upper.includes('4K') || upper.includes('UHD');

        return {
          id: `${req.sourceId}-xt-${s.stream_id}`,
          sourceId: req.sourceId,
          number: s.num || idx + 1,
          sortOrder: idx,
          name: s.name || `Stream ${s.stream_id}`,
          shortCode: makeChannelShortCode(s.name || 'XT', idx),
          groupId: slugifyGroup(groupName),
          groupName,
          streamUrl: `${base}/live/${encodeURIComponent(req.username)}/${encodeURIComponent(req.password)}/${s.stream_id}.${ext}`,
          streamType: ext === 'ts' ? 'mpegts' : 'hls',
          resolution: is4k ? '4K HDR' : '1080p',
          audioBadge: is4k ? 'Dolby Atmos' : 'EAC3 5.1',
          codec: is4k ? 'HEVC' : 'H.264',
          hasCatchup: Number(s.tv_archive) === 1,
          catchupDays: Number(s.tv_archive_duration) || 0,
          accentColor: ACCENT_PALETTE[idx % ACCENT_PALETTE.length],
          country: 'INT',
          epgArchetype: idx % 6,
          tvgId: s.epg_channel_id || undefined,
          logoUrl: s.stream_icon || undefined,
        };
      });

      self.postMessage({
        type: 'm3u-result',
        sourceId: req.sourceId,
        channels,
        vodItems: [],
        discoveredXmltvUrl: `${base}/xmltv.php?${authParams}`,
        elapsedMs: Math.round(performance.now() - t0),
      } satisfies WorkerIngestResponse);
      return;
    }

    if (req.type === 'parse-xmltv') {
      self.postMessage({
        type: 'progress',
        phase: 'Verarbeite XMLTV EPG-Daten im Hintergrund…',
        percent: 20,
      } satisfies WorkerIngestResponse);

      let xmlText = req.rawText ?? '';
      if (!xmlText && req.rawBuffer) {
        xmlText = await decompressIfGzip(req.rawBuffer);
      } else if (!xmlText && req.url) {
        const res = await fetch(wrapProxy(req.url, req.proxyEndpoint));
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} beim Laden von XMLTV`);
        }
        const buf = await res.arrayBuffer();
        xmlText = await decompressIfGzip(buf);
      }

      const programs = parseXmltvDocument(req.sourceId, xmlText, Date.now(), (count) => {
        self.postMessage({
          type: 'progress',
          phase: `${count.toLocaleString('de-DE')} XMLTV-Sendungen extrahiert…`,
          percent: 72,
        } satisfies WorkerIngestResponse);
      });

      self.postMessage({
        type: 'xmltv-result',
        sourceId: req.sourceId,
        programs,
        elapsedMs: Math.round(performance.now() - t0),
      } satisfies WorkerIngestResponse);
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : 'Unbekannter Fehler im Ingest-Worker',
    } satisfies WorkerIngestResponse);
  }
};
