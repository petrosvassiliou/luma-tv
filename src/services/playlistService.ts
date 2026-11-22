import {
  bulkSaveChannelsChunked,
  bulkSaveEpgChunked,
  lumaDb,
  type StoredChannel,
  type StoredEpgProgram,
  type StoredPlaylistSource,
  type StoredVodItem,
} from '../db/lumaDb';
import { VERIFIED_HLS_STREAMS } from '../data/mockCatalog';
import type { WorkerIngestRequest, WorkerIngestResponse } from '../workers/ingest.worker';

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
    await lumaDb.vodItems.bulkPut(res.vodItems);
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
    epgStatus: 'synced',
    epgOffsetHours: 0,
    hiddenGroupIds: [],
    lastUpdated: `${res.elapsedMs} ms Worker`,
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

  params.onProgress?.(
    `Speichere ${res.channels.length.toLocaleString('de-DE')} Xtream-Streams in IndexedDB…`,
    92
  );
  await bulkSaveChannelsChunked(res.channels);

  const source: StoredPlaylistSource = {
    id: sourceId,
    name: params.name.trim() || 'Xtream Codes Server',
    type: 'xtream',
    endpoint: params.serverUrl.trim(),
    rawUrlOrHost: params.serverUrl.trim(),
    username: params.username.trim(),
    xmltvUrl: res.discoveredXmltvUrl,
    channelCount: res.channels.length,
    vodCount: 0,
    epgStatus: 'synced',
    epgOffsetHours: 0,
    hiddenGroupIds: [],
    lastUpdated: `${res.elapsedMs} ms Worker`,
    createdAt: Date.now(),
  };

  await lumaDb.sources.put(source);
  params.onProgress?.('Abgeschlossen', 100);
  return source;
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
  epgByTvgId: Map<string, StoredEpgProgram[]>;
}> {
  const [channels, vodItems, epgList] = await Promise.all([
    lumaDb.channels.where('sourceId').equals(sourceId).sortBy('sortOrder'),
    lumaDb.vodItems.where('sourceId').equals(sourceId).toArray(),
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

  return { channels, vodItems, epgByTvgId };
}

export async function deletePersistedSource(sourceId: string): Promise<void> {
  await Promise.all([
    lumaDb.sources.delete(sourceId),
    lumaDb.channels.where('sourceId').equals(sourceId).delete(),
    lumaDb.vodItems.where('sourceId').equals(sourceId).delete(),
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
