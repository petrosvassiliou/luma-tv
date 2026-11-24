/// <reference lib="webworker" />

import type {
  StoredChannel,
  StoredEpgProgram,
  StoredSeriesItem,
  StoredVodItem,
} from '../db/lumaDb';
import type { PlaylistAccountInfo } from '../types/luma';
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
      seriesItems?: StoredSeriesItem[];
      discoveredXmltvUrl?: string;
      accountInfo?: PlaylistAccountInfo;
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

async function fetchJsonArraySafe<T>(url: string): Promise<T[]> {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data: unknown = await res.json();
    return Array.isArray(data) ? (data as T[]) : [];
  } catch {
    return [];
  }
}

function extractYearFromText(text?: string): number {
  if (!text) return 2025;
  const m = /\b(19\d{2}|20\d{2})\b/.exec(text);
  return m ? Number(m[1]) : 2025;
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
        seriesItems: [],
        discoveredXmltvUrl: parsed.discoveredXmltvUrl,
        elapsedMs: Math.round(performance.now() - t0),
      } satisfies WorkerIngestResponse);
      return;
    }

    if (req.type === 'ingest-xtream') {
      const base = req.serverUrl.trim().replace(/\/+$/, '');
      const encUser = encodeURIComponent(req.username);
      const encPass = encodeURIComponent(req.password);
      const authParams = `username=${encUser}&password=${encPass}`;

      self.postMessage({
        type: 'progress',
        phase: 'Authentifiziere Xtream Codes API (Live, VOD & Serien)…',
        percent: 18,
      } satisfies WorkerIngestResponse);

      const [authInfoRes, catsRes, streamsRes] = await Promise.all([
        fetch(
          wrapProxy(`${base}/player_api.php?${authParams}`, req.proxyEndpoint)
        ).catch(() => null),
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

      let accountInfo: PlaylistAccountInfo | undefined;
      if (authInfoRes && authInfoRes.ok) {
        try {
          const authJson = (await authInfoRes.json()) as {
            user_info?: {
              username?: string;
              status?: string;
              exp_date?: string | number | null;
              created_at?: string | number | null;
              is_trial?: string | number;
              active_cons?: string | number;
              max_connections?: string | number;
            };
            server_info?: {
              timezone?: string;
            };
          };
          const ui = authJson.user_info;
          if (ui) {
            const parseEpoch = (val: unknown): number | null => {
              if (val === null || val === undefined || val === '' || val === 'null') {
                return null;
              }
              const n = Number(val);
              if (!Number.isFinite(n) || n <= 0) return null;
              return n < 1e11 ? n * 1000 : n;
            };
            const activeCons = Number(ui.active_cons);
            const maxCons = Number(ui.max_connections);
            accountInfo = {
              status: String(ui.status || 'Active'),
              username: ui.username || req.username,
              expiresAtMs: parseEpoch(ui.exp_date),
              createdAtMs: parseEpoch(ui.created_at),
              isTrial: String(ui.is_trial) === '1',
              activeConnections: Number.isFinite(activeCons) ? activeCons : undefined,
              maxConnections: Number.isFinite(maxCons) && maxCons > 0 ? maxCons : undefined,
              serverTimezone: authJson.server_info?.timezone || undefined,
              checkedAtMs: Date.now(),
            };
          }
        } catch {
          // Optional account metadata
        }
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

      self.postMessage({
        type: 'progress',
        phase: 'Synchronisiere Xtream VOD-Filme & Serien-Katalog…',
        percent: 52,
      } satisfies WorkerIngestResponse);

      const [vodCats, vodStreams, seriesCats, seriesStreams] = await Promise.all([
        fetchJsonArraySafe<{ category_id: string; category_name: string }>(
          wrapProxy(
            `${base}/player_api.php?${authParams}&action=get_vod_categories`,
            req.proxyEndpoint
          )
        ),
        fetchJsonArraySafe<{
          stream_id: number;
          name: string;
          stream_icon?: string;
          rating?: string | number;
          category_id?: string;
          container_extension?: string;
        }>(
          wrapProxy(
            `${base}/player_api.php?${authParams}&action=get_vod_streams`,
            req.proxyEndpoint
          )
        ),
        fetchJsonArraySafe<{ category_id: string; category_name: string }>(
          wrapProxy(
            `${base}/player_api.php?${authParams}&action=get_series_categories`,
            req.proxyEndpoint
          )
        ),
        fetchJsonArraySafe<{
          series_id: number;
          name: string;
          cover?: string;
          plot?: string;
          genre?: string;
          releaseDate?: string;
          rating?: string | number;
          category_id?: string;
        }>(
          wrapProxy(
            `${base}/player_api.php?${authParams}&action=get_series`,
            req.proxyEndpoint
          )
        ),
      ]);

      const catMap = new Map<string, string>();
      for (const c of Array.isArray(categories) ? categories : []) {
        catMap.set(String(c.category_id), c.category_name);
      }

      const vodCatMap = new Map<string, string>();
      for (const c of vodCats) {
        vodCatMap.set(String(c.category_id), c.category_name);
      }

      const seriesCatMap = new Map<string, string>();
      for (const c of seriesCats) {
        seriesCatMap.set(String(c.category_id), c.category_name);
      }

      const ext = req.outputFormat === 'ts' ? 'ts' : 'm3u8';
      const channels: StoredChannel[] = (Array.isArray(streams) ? streams : []).map(
        (s, idx) => {
          const groupName = catMap.get(String(s.category_id ?? '')) || 'Xtream Live';
          const upper = (s.name || '').toUpperCase();
          const is4k = upper.includes('4K') || upper.includes('UHD');
          const hasArchive = Number(s.tv_archive) === 1;

          return {
            id: `${req.sourceId}-xt-${s.stream_id}`,
            sourceId: req.sourceId,
            number: s.num || idx + 1,
            sortOrder: idx,
            name: s.name || `Stream ${s.stream_id}`,
            shortCode: makeChannelShortCode(s.name || 'XT', idx),
            groupId: slugifyGroup(groupName),
            groupName,
            streamUrl: `${base}/live/${encUser}/${encPass}/${s.stream_id}.${ext}`,
            streamType: ext === 'ts' ? 'mpegts' : 'hls',
            resolution: is4k ? '4K HDR' : '1080p',
            audioBadge: is4k ? 'Dolby Atmos' : 'EAC3 5.1',
            codec: is4k ? 'HEVC' : 'H.264',
            hasCatchup: hasArchive,
            catchupDays: Number(s.tv_archive_duration) || (hasArchive ? 7 : 0),
            catchupMode: hasArchive ? 'xc' : undefined,
            xtreamStreamId: s.stream_id,
            accentColor: ACCENT_PALETTE[idx % ACCENT_PALETTE.length],
            country: 'INT',
            epgArchetype: idx % 6,
            tvgId: s.epg_channel_id || undefined,
            logoUrl: s.stream_icon || undefined,
          };
        }
      );

      const vodItems: StoredVodItem[] = vodStreams.slice(0, 6000).map((v, idx) => {
        const title = v.name || `VOD #${v.stream_id}`;
        const upper = title.toUpperCase();
        const is4k = upper.includes('4K') || upper.includes('UHD');
        const vExt = (v.container_extension || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4';
        const genre = vodCatMap.get(String(v.category_id ?? '')) || 'Xtream Cinema';
        const rawRating = v.rating !== undefined && v.rating !== '' ? String(v.rating) : '8.2';

        return {
          id: `${req.sourceId}-xvod-${v.stream_id}`,
          sourceId: req.sourceId,
          title,
          year: extractYearFromText(title),
          genre,
          durationMin: 110,
          rating: rawRating.slice(0, 4),
          resolution: is4k ? '4K HDR' : '1080p',
          codec: is4k || upper.includes('HEVC') ? 'HEVC' : 'H.264',
          streamUrl: `${base}/movie/${encUser}/${encPass}/${v.stream_id}.${vExt}`,
          synopsis: `${genre} · Xtream VOD Stream #${v.stream_id}`,
          accentFrom: ACCENT_PALETTE[idx % ACCENT_PALETTE.length],
          accentTo: '#0F172A',
          coverUrl: v.stream_icon || undefined,
          xtreamVodId: v.stream_id,
        };
      });

      const seriesItems: StoredSeriesItem[] = seriesStreams.slice(0, 25000).map((s, idx) => {
        const title = s.name || `Serie #${s.series_id}`;
        const upper = title.toUpperCase();
        const is4k = upper.includes('4K') || upper.includes('UHD');
        const genre =
          (s.genre && s.genre.trim()) ||
          seriesCatMap.get(String(s.category_id ?? '')) ||
          'Xtream Series';
        const rawRating = s.rating !== undefined && s.rating !== '' ? String(s.rating) : '8.5';

        return {
          id: `${req.sourceId}-xser-${s.series_id}`,
          sourceId: req.sourceId,
          title,
          year: extractYearFromText(s.releaseDate || title),
          genre,
          rating: rawRating.slice(0, 4),
          badge: is4k ? '4K HDR · XTREAM' : 'XTREAM SERIES',
          synopsis: s.plot?.trim() || `${genre} · Xtream On-Demand Serie`,
          accentFrom: ACCENT_PALETTE[idx % ACCENT_PALETTE.length],
          accentTo: '#0F172A',
          coverUrl: s.cover || undefined,
          xtreamSeriesId: Number(s.series_id),
          seasonsLoaded: false,
          seasons: [
            {
              seasonNumber: 1,
              title: 'Season 1',
              episodes: [],
            },
          ],
        };
      });

      self.postMessage({
        type: 'm3u-result',
        sourceId: req.sourceId,
        channels,
        vodItems,
        seriesItems,
        discoveredXmltvUrl: `${base}/xmltv.php?${authParams}`,
        accountInfo,
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
