import {
  bulkSaveChannelsChunked,
  bulkSaveEpgChunked,
  bulkSaveSeriesChunked,
  bulkSaveVodChunked,
  lumaDb,
  type StoredChannel,
  type StoredEpgProgram,
  type StoredPlaylistSource,
  type StoredSeriesItem,
  type StoredVodItem,
} from '../db/lumaDb';
import { VERIFIED_HLS_STREAMS } from '../data/mockCatalog';
import { parseXtreamLiveStreamUrl } from '../engine/catchupUrlBuilder';
import type {
  PlaylistAccountInfo,
  SeriesEpisode,
  SeriesItem,
  SeriesSeason,
} from '../types/luma';
import type { WorkerIngestRequest, WorkerIngestResponse } from '../workers/ingest.worker';

function formatSyncTimestamp(ms = Date.now()): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(ms);
}

export function parseXtreamAccountInfoPayload(
  raw: unknown,
  fallbackUsername?: string,
  checkedAtMs = Date.now()
): PlaylistAccountInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as {
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
  const ui = record.user_info;
  if (!ui) return null;

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

  return {
    status: String(ui.status || 'Active'),
    username: ui.username || fallbackUsername,
    expiresAtMs: parseEpoch(ui.exp_date),
    createdAtMs: parseEpoch(ui.created_at),
    isTrial: String(ui.is_trial) === '1',
    activeConnections: Number.isFinite(activeCons) ? activeCons : undefined,
    maxConnections: Number.isFinite(maxCons) && maxCons > 0 ? maxCons : undefined,
    serverTimezone: record.server_info?.timezone || undefined,
    checkedAtMs,
  };
}

function extractXtreamCredentialsFromUrl(
  rawUrl?: string
): { origin: string; username: string; password: string } | null {
  if (!rawUrl || !rawUrl.startsWith('http')) return null;
  try {
    const u = new URL(rawUrl);
    const username = u.searchParams.get('username');
    const password = u.searchParams.get('password');
    if (username && password) {
      return { origin: u.origin, username, password };
    }
  } catch {
    // Ignore invalid URL
  }
  const liveParsed = parseXtreamLiveStreamUrl(rawUrl);
  if (liveParsed) {
    return {
      origin: liveParsed.origin,
      username: decodeURIComponent(liveParsed.username),
      password: decodeURIComponent(liveParsed.password),
    };
  }
  return null;
}

export async function refreshSourceAccountInfo(params: {
  source: StoredPlaylistSource;
  fallbackChannelUrl?: string;
  proxyEndpoint?: string;
}): Promise<PlaylistAccountInfo | null> {
  const { source, fallbackChannelUrl, proxyEndpoint } = params;
  let origin = '';
  let username = source.username?.trim() || '';
  let password = source.password ?? '';

  if (source.type === 'xtream' && source.rawUrlOrHost && username && password) {
    origin = source.rawUrlOrHost.trim().replace(/\/+$/, '');
  } else {
    const fromUrl =
      extractXtreamCredentialsFromUrl(source.rawUrlOrHost) ??
      extractXtreamCredentialsFromUrl(fallbackChannelUrl);
    if (fromUrl) {
      origin = fromUrl.origin;
      username = fromUrl.username;
      password = fromUrl.password;
    }
  }

  if (!origin || !username || !password) return null;

  const encUser = encodeURIComponent(username);
  const encPass = encodeURIComponent(password);
  const rawApiUrl = `${origin}/player_api.php?username=${encUser}&password=${encPass}`;
  const finalUrl =
    proxyEndpoint && proxyEndpoint.trim()
      ? `${proxyEndpoint.trim().replace(/\/+$/, '')}?url=${encodeURIComponent(rawApiUrl)}`
      : rawApiUrl;

  const res = await fetch(finalUrl);
  if (!res.ok) return null;

  const json: unknown = await res.json();
  const parsed = parseXtreamAccountInfoPayload(json, username);
  if (parsed) {
    await lumaDb.sources.update(source.id, { accountInfo: parsed }).catch(() => undefined);
  }
  return parsed;
}

export interface IngestProgressState {
  active: boolean;
  phase: string;
  percent: number;
  lastSummary?: string;
  error?: string;
}

function runWorkerTask<T extends WorkerIngestResponse['type']>(
  request: WorkerIngestRequest,
  expectedType: T,
  onProgress?: (phase: string, percent: number) => void
): Promise<Extract<WorkerIngestResponse, { type: T }>> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/ingest.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (e: MessageEvent<WorkerIngestResponse>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        onProgress?.(msg.phase, msg.percent);
      } else if (msg.type === 'error') {
        worker.terminate();
        reject(new Error(msg.message));
      } else if (msg.type === expectedType) {
        worker.terminate();
        resolve(msg as Extract<WorkerIngestResponse, { type: T }>);
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(err.message || 'WebWorker Ausführungsfehler'));
    };

    if (request.type === 'parse-xmltv' && request.rawBuffer) {
      worker.postMessage(request, [request.rawBuffer]);
    } else {
      worker.postMessage(request);
    }
  });
}

export async function importM3uPlaylist(params: {
  name: string;
  rawText?: string;
  url?: string;
  xmltvUrl?: string;
  proxyEndpoint?: string;
  onProgress?: (phase: string, percent: number) => void;
}): Promise<StoredPlaylistSource> {
  const sourceId = `src-${Date.now()}`;

  const res = await runWorkerTask(
    {
      type: 'parse-m3u',
      sourceId,
      rawText: params.rawText,
      url: params.url,
      proxyEndpoint: params.proxyEndpoint,
    },
    'm3u-result',
    params.onProgress
  );

  params.onProgress?.(
    `Indexiere ${res.channels.length.toLocaleString('de-DE')} Kanäle in IndexedDB…`,
    92
  );

  await bulkSaveChannelsChunked(res.channels);
  if (res.vodItems.length > 0) {
    await bulkSaveVodChunked(res.vodItems);
  }
  if (res.seriesItems && res.seriesItems.length > 0) {
    await bulkSaveSeriesChunked(res.seriesItems);
  }

  const resolvedXmltv = params.xmltvUrl?.trim() || res.discoveredXmltvUrl;
  const source: StoredPlaylistSource = {
    id: sourceId,
    name: params.name.trim() || 'M3U_Plus Playlist',
    type: 'm3u_plus',
    endpoint: params.url?.trim() || `Lokaler M3U-Import (${res.channels.length} Kanäle)`,
    rawUrlOrHost: params.url?.trim() || 'local://m3u',
    xmltvUrl: resolvedXmltv,
    channelCount: res.channels.length,
    vodCount: res.vodItems.length,
    seriesCount: res.seriesItems?.length ?? 0,
    epgStatus: 'synced',
    epgOffsetHours: 0,
    hiddenGroupIds: [],
    lastUpdated: formatSyncTimestamp(),
    accountInfo: res.accountInfo,
    createdAt: Date.now(),
  };

  await lumaDb.sources.put(source);

  if (resolvedXmltv && resolvedXmltv.startsWith('http')) {
    try {
      await importXmltvForSource({
        sourceId,
        url: resolvedXmltv,
        proxyEndpoint: params.proxyEndpoint,
        onProgress: params.onProgress,
      });
    } catch {
      // Keep playlist active even if remote XMLTV fails CORS
    }
  }

  params.onProgress?.('Abgeschlossen', 100);
  return source;
}

export async function importXtreamSource(params: {
  name: string;
  serverUrl: string;
  username: string;
  password: string;
  outputFormat: 'm3u8' | 'ts';
  proxyEndpoint?: string;
  onProgress?: (phase: string, percent: number) => void;
}): Promise<StoredPlaylistSource> {
  const sourceId = `xtream-${Date.now()}`;

  const res = await runWorkerTask(
    {
      type: 'ingest-xtream',
      sourceId,
      serverUrl: params.serverUrl,
      username: params.username,
      password: params.password,
      outputFormat: params.outputFormat,
      proxyEndpoint: params.proxyEndpoint,
    },
    'm3u-result',
    params.onProgress
  );

  const seriesItems = res.seriesItems ?? [];
  params.onProgress?.(
    `Speichere ${res.channels.length.toLocaleString('de-DE')} Live, ${res.vodItems.length.toLocaleString('de-DE')} VOD & ${seriesItems.length.toLocaleString('de-DE')} Serien…`,
    92
  );
  await bulkSaveChannelsChunked(res.channels);
  if (res.vodItems.length > 0) {
    await bulkSaveVodChunked(res.vodItems);
  }
  if (seriesItems.length > 0) {
    await bulkSaveSeriesChunked(seriesItems);
  }

  const source: StoredPlaylistSource = {
    id: sourceId,
    name: params.name.trim() || 'Xtream Codes Server',
    type: 'xtream',
    endpoint: params.serverUrl.trim(),
    rawUrlOrHost: params.serverUrl.trim(),
    username: params.username.trim(),
    password: params.password,
    outputFormat: params.outputFormat,
    xmltvUrl: res.discoveredXmltvUrl,
    channelCount: res.channels.length,
    vodCount: res.vodItems.length,
    seriesCount: seriesItems.length,
    epgStatus: 'synced',
    epgOffsetHours: 0,
    hiddenGroupIds: [],
    lastUpdated: formatSyncTimestamp(),
    accountInfo: res.accountInfo,
    createdAt: Date.now(),
  };

  await lumaDb.sources.put(source);

  if (res.discoveredXmltvUrl && res.discoveredXmltvUrl.startsWith('http')) {
    try {
      await importXmltvForSource({
        sourceId,
        url: res.discoveredXmltvUrl,
        proxyEndpoint: params.proxyEndpoint,
        onProgress: params.onProgress,
      });
    } catch {
      // Keep source active even if provider XMLTV endpoint times out
    }
  }

  params.onProgress?.('Abgeschlossen', 100);
  return source;
}

export async function fetchXtreamSeriesEpisodes(params: {
  source?: StoredPlaylistSource | null;
  series: SeriesItem;
  fallbackChannelUrl?: string;
  proxyEndpoint?: string;
}): Promise<SeriesSeason[]> {
  const { source, series, fallbackChannelUrl, proxyEndpoint } = params;
  if (!series.xtreamSeriesId) {
    return series.seasons;
  }

  let origin = source?.rawUrlOrHost?.trim().replace(/\/+$/, '') || '';
  let username = source?.username?.trim() || '';
  let password = source?.password ?? '';

  if ((!origin || !username || !password) && fallbackChannelUrl) {
    const parsed = parseXtreamLiveStreamUrl(fallbackChannelUrl);
    if (parsed) {
      origin = origin || parsed.origin;
      username = username || decodeURIComponent(parsed.username);
      password = password || decodeURIComponent(parsed.password);
    }
  }

  if (!origin || !username || !password) {
    return series.seasons;
  }

  const encUser = encodeURIComponent(username);
  const encPass = encodeURIComponent(password);
  const rawApiUrl = `${origin}/player_api.php?username=${encUser}&password=${encPass}&action=get_series_info&series_id=${series.xtreamSeriesId}`;
  const finalUrl =
    proxyEndpoint && proxyEndpoint.trim()
      ? `${proxyEndpoint.trim().replace(/\/+$/, '')}?url=${encodeURIComponent(rawApiUrl)}`
      : rawApiUrl;

  const res = await fetch(finalUrl);
  if (!res.ok) {
    throw new Error(`Xtream get_series_info HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    episodes?: Record<
      string,
      {
        id: string | number;
        episode_num?: number | string;
        title?: string;
        container_extension?: string;
        info?: {
          plot?: string;
          duration_secs?: number;
        };
      }[]
    >;
  };

  const episodesBySeason = data.episodes ?? {};
  const seasonKeys = Object.keys(episodesBySeason).sort((a, b) => Number(a) - Number(b));

  const seasons: SeriesSeason[] = seasonKeys
    .map((seasonKey) => {
      const seasonNum = Math.max(1, Number(seasonKey) || 1);
      const rawEps = Array.isArray(episodesBySeason[seasonKey])
        ? episodesBySeason[seasonKey]
        : [];
      const episodes: SeriesEpisode[] = rawEps.map((ep, idx) => {
        const epNum = Number(ep.episode_num) || idx + 1;
        const ext = (ep.container_extension || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4';
        const durSec = Number(ep.info?.duration_secs) || 0;
        const durationMin = durSec > 60 ? Math.round(durSec / 60) : 45;
        const epTitle = ep.title?.trim() || `Episode ${epNum}`;
        const is4k = epTitle.toUpperCase().includes('4K') || series.badge.includes('4K');

        return {
          id: `${series.id}-s${seasonNum}e${ep.id}`,
          episodeNumber: epNum,
          title: epTitle,
          durationMin,
          synopsis: ep.info?.plot?.trim() || `${series.title} · S${seasonNum}E${epNum}`,
          streamUrl: `${origin}/series/${encUser}/${encPass}/${ep.id}.${ext}`,
          resolution: is4k ? '4K HDR' : '1080p',
        };
      });

      return {
        seasonNumber: seasonNum,
        title: `Season ${seasonNum}`,
        episodes,
      };
    })
    .filter((s) => s.episodes.length > 0);

  if (seasons.length > 0) {
    await lumaDb.seriesItems
      .update(series.id, {
        seasons,
        seasonsLoaded: true,
      })
      .catch(() => undefined);
    return seasons;
  }

  return series.seasons;
}

export async function importXmltvForSource(params: {
  sourceId: string;
  url?: string;
  rawBuffer?: ArrayBuffer;
  rawText?: string;
  proxyEndpoint?: string;
  onProgress?: (phase: string, percent: number) => void;
}): Promise<number> {
  const res = await runWorkerTask(
    {
      type: 'parse-xmltv',
      sourceId: params.sourceId,
      url: params.url,
      rawBuffer: params.rawBuffer,
      rawText: params.rawText,
      proxyEndpoint: params.proxyEndpoint,
    },
    'xmltv-result',
    params.onProgress
  );

  params.onProgress?.(
    `Schreibe ${res.programs.length.toLocaleString('de-DE')} EPG-Sendungen in IndexedDB…`,
    94
  );
  await lumaDb.epgPrograms.where('sourceId').equals(params.sourceId).delete();
  await bulkSaveEpgChunked(res.programs);
  params.onProgress?.('XMLTV synchronisiert', 100);
  return res.programs.length;
}

/**
 * Generates a real M3U_Plus playlist AND a real gzipped .xml.gz XMLTV EPG archive,
 * then runs both through the dedicated WebWorker + DecompressionStream + Dexie IndexedDB!
 */
export async function runEndToEndWorkerDemoImport(
  onProgress?: (phase: string, percent: number) => void
): Promise<{ source: StoredPlaylistSource; epgCount: number }> {
  const sampleM3u = [
    '#EXTM3U x-tvg-url="local://sample.xml.gz"',
    `#EXTINF:-1 tvg-id="rbtv.at" tvg-chno="1" group-title="Live Sport & Action" catchup="default" catchup-days="7",Red Bull TV Master HD`,
    VERIFIED_HLS_STREAMS.redBullLive,
    `#EXTINF:-1 tvg-id="cinema4k.de" tvg-chno="2" group-title="4K Referenz Kino" catchup="default" catchup-days="14",Luma Director’s 4K UHD`,
    VERIFIED_HLS_STREAMS.tearsOfSteel,
    `#EXTINF:-1 tvg-id="dw.de" tvg-chno="3" group-title="Weltnachrichten" catchup="default" catchup-days="3",DW World News HD`,
    VERIFIED_HLS_STREAMS.dwLive,
    `#EXTINF:-1 tvg-id="nasa.us" tvg-chno="4" group-title="Wissenschaft & Orbit" catchup="default" catchup-days="7",NASA Public Mission Control HD`,
    VERIFIED_HLS_STREAMS.nasaLive,
    `#EXTINF:-1 tvg-id="blender.nl" tvg-chno="5" group-title="Open Studio & VFX" catchup="default" catchup-days="7",Blender Open Movie Broadcast`,
    VERIFIED_HLS_STREAMS.blenderLive,
    `#EXTINF:-1 tvg-id="scifi.us" tvg-chno="6" group-title="4K Referenz Kino" catchup="default" catchup-days="7",Federation Classics Remastered`,
    VERIFIED_HLS_STREAMS.angelOne,
  ].join('\n');

  const source = await importM3uPlaylist({
    name: 'Worker-Import · M3U_Plus + XMLTV.gz',
    rawText: sampleM3u,
    onProgress,
  });

  // Build real XMLTV schedule around current UTC clock and GZIP-compress it in-memory
  const fmtXmlDate = (ms: number) => {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
      `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())} +0000`
    );
  };

  const baseHour = Math.floor(Date.now() / 3600_000) * 3600_000 - 4 * 3600_000;
  const tvgIds = [
    ['rbtv.at', 'Red Bull Rampage Live', 'Freeride Finals aus Utah (XMLTV.gz Import)', 'Live Sport'],
    ['cinema4k.de', 'Tears of Steel 4K Master', 'Open Movie HDR10+ Ausstrahlung (XMLTV.gz)', 'Movie'],
    ['dw.de', 'DW Global Journal', 'Live-Nachrichten aus Berlin (XMLTV.gz)', 'News'],
    ['nasa.us', 'ISS Live Orbital Pass', 'Telemetrie & Außenkameras (XMLTV.gz)', 'Science'],
    ['blender.nl', 'Blender Studio Featurette', 'Open-Source VFX Pipeline (XMLTV.gz)', 'Animation'],
    ['scifi.us', 'Starfleet Archive: Angel One', 'Remastered Broadcast (XMLTV.gz)', 'Sci-Fi'],
  ];

  const xmlItems: string[] = ['<?xml version="1.0" encoding="UTF-8"?><tv>'];
  for (const [tvgId, title, desc, cat] of tvgIds) {
    for (let slot = 0; slot < 16; slot++) {
      const s = baseHour + slot * 45 * 60_000;
      const e = s + 45 * 60_000;
      xmlItems.push(
        `<programme start="${fmtXmlDate(s)}" stop="${fmtXmlDate(e)}" channel="${tvgId}">` +
          `<title>${title} #${slot + 1}</title>` +
          `<sub-title>XMLTV.gz WebWorker Dekomprimiert</sub-title>` +
          `<desc>${desc}</desc>` +
          `<category>${cat}</category>` +
          `</programme>`
      );
    }
  }
  xmlItems.push('</tv>');
  const xmlString = xmlItems.join('\n');

  let gzOrRawBuffer: ArrayBuffer;
  if (typeof CompressionStream !== 'undefined') {
    const cs = new CompressionStream('gzip');
    const compressed = new Blob([xmlString]).stream().pipeThrough(cs);
    gzOrRawBuffer = await new Response(compressed).arrayBuffer();
  } else {
    gzOrRawBuffer = new TextEncoder().encode(xmlString).buffer;
  }

  const epgCount = await importXmltvForSource({
    sourceId: source.id,
    rawBuffer: gzOrRawBuffer,
    onProgress,
  });

  return { source, epgCount };
}

export async function loadPersistedSourceBundle(sourceId: string): Promise<{
  channels: StoredChannel[];
  vodItems: StoredVodItem[];
  seriesItems: StoredSeriesItem[];
  epgByTvgId: Map<string, StoredEpgProgram[]>;
}> {
  const [channels, vodItems, seriesItems, epgList] = await Promise.all([
    lumaDb.channels.where('sourceId').equals(sourceId).sortBy('sortOrder'),
    lumaDb.vodItems.where('sourceId').equals(sourceId).toArray(),
    lumaDb.seriesItems.where('sourceId').equals(sourceId).toArray(),
    lumaDb.epgPrograms.where('sourceId').equals(sourceId).toArray(),
  ]);

  const epgByTvgId = new Map<string, StoredEpgProgram[]>();
  for (const p of epgList) {
    const bucket = epgByTvgId.get(p.tvgId);
    if (bucket) bucket.push(p);
    else epgByTvgId.set(p.tvgId, [p]);
  }
  for (const bucket of epgByTvgId.values()) {
    bucket.sort((a, b) => a.startMs - b.startMs);
  }

  return { channels, vodItems, seriesItems, epgByTvgId };
}

export async function deletePersistedSource(sourceId: string): Promise<void> {
  await Promise.all([
    lumaDb.sources.delete(sourceId),
    lumaDb.channels.where('sourceId').equals(sourceId).delete(),
    lumaDb.vodItems.where('sourceId').equals(sourceId).delete(),
    lumaDb.seriesItems.where('sourceId').equals(sourceId).delete(),
    lumaDb.epgPrograms.where('sourceId').equals(sourceId).delete(),
  ]);
}

export async function renameStoredChannel(channelId: string, customName: string): Promise<void> {
  await lumaDb.channels.update(channelId, {
    customName: customName.trim() || undefined,
    name: customName.trim(),
  });
}

export async function toggleHideStoredChannel(
  channelId: string,
  hidden: boolean
): Promise<void> {
  await lumaDb.channels.update(channelId, { isHidden: hidden });
}

export async function bulkSetChannelsHidden(
  channelIds: string[],
  hidden: boolean
): Promise<void> {
  const chunkSize = 2500;
  for (let i = 0; i < channelIds.length; i += chunkSize) {
    const slice = channelIds.slice(i, i + chunkSize);
    await lumaDb.channels.where('id').anyOf(slice).modify({ isHidden: hidden });
  }
}

export async function renamePersistedSource(
  sourceId: string,
  nextName: string
): Promise<void> {
  const trimmed = nextName.trim();
  if (!trimmed) return;
  await lumaDb.sources.update(sourceId, { name: trimmed });
}

export async function updateSourceHiddenGroups(
  sourceId: string,
  hiddenGroupIds: string[]
): Promise<void> {
  await lumaDb.sources.update(sourceId, { hiddenGroupIds });
}

export async function resyncPersistedSource(params: {
  source: StoredPlaylistSource;
  proxyEndpoint?: string;
  onProgress?: (phase: string, percent: number) => void;
}): Promise<void> {
  const { source, proxyEndpoint, onProgress } = params;
  const existingChannels = await lumaDb.channels
    .where('sourceId')
    .equals(source.id)
    .toArray();

  const overridesByStream = new Map<
    string,
    { customName?: string; isHidden?: boolean }
  >();
  for (const ch of existingChannels) {
    if (ch.customName || ch.isHidden) {
      overridesByStream.set(ch.streamUrl, {
        customName: ch.customName,
        isHidden: ch.isHidden,
      });
    }
  }

  let res: Extract<WorkerIngestResponse, { type: 'm3u-result' }>;
  if (
    source.type === 'xtream' &&
    source.rawUrlOrHost &&
    source.username &&
    source.password
  ) {
    res = await runWorkerTask(
      {
        type: 'ingest-xtream',
        sourceId: source.id,
        serverUrl: source.rawUrlOrHost,
        username: source.username,
        password: source.password,
        outputFormat: source.outputFormat ?? 'm3u8',
        proxyEndpoint,
      },
      'm3u-result',
      onProgress
    );
  } else if (source.rawUrlOrHost && source.rawUrlOrHost.startsWith('http')) {
    res = await runWorkerTask(
      {
        type: 'parse-m3u',
        sourceId: source.id,
        url: source.rawUrlOrHost,
        proxyEndpoint,
      },
      'm3u-result',
      onProgress
    );
  } else {
    throw new Error('Lokale Datei-Quelle kann nicht per URL aktualisiert werden.');
  }

  const mergedChannels = res.channels.map((ch) => {
    const prev = overridesByStream.get(ch.streamUrl);
    if (!prev) return ch;
    return {
      ...ch,
      customName: prev.customName,
      name: prev.customName || ch.name,
      isHidden: prev.isHidden,
    };
  });

  await Promise.all([
    lumaDb.channels.where('sourceId').equals(source.id).delete(),
    lumaDb.vodItems.where('sourceId').equals(source.id).delete(),
    lumaDb.seriesItems.where('sourceId').equals(source.id).delete(),
  ]);

  await bulkSaveChannelsChunked(mergedChannels);
  if (res.vodItems.length > 0) await bulkSaveVodChunked(res.vodItems);
  if (res.seriesItems && res.seriesItems.length > 0) {
    await bulkSaveSeriesChunked(res.seriesItems);
  }

  await lumaDb.sources.update(source.id, {
    channelCount: mergedChannels.length,
    vodCount: res.vodItems.length,
    seriesCount: res.seriesItems?.length ?? 0,
    lastUpdated: formatSyncTimestamp(),
    ...(res.accountInfo ? { accountInfo: res.accountInfo } : {}),
  });
}
