import Dexie, { type Table } from 'dexie';
import type {
  Channel,
  EpgProgram,
  PlaylistSource,
  SeriesItem,
  VodItem,
} from '../types/luma';

export interface StoredPlaylistSource extends PlaylistSource {
  rawUrlOrHost: string;
  username?: string;
  password?: string;
  outputFormat?: 'm3u8' | 'ts';
  xmltvUrl?: string;
  hiddenGroupIds: string[];
  createdAt: number;
  lastSyncedAtMs?: number;
  updatedAtMs?: number;
}

export interface StoredChannel extends Channel {
  sourceId: string;
  tvgId?: string;
  logoUrl?: string;
  customName?: string;
  isHidden?: boolean;
  sortOrder: number;
}

export interface StoredVodItem extends VodItem {
  sourceId: string;
}

export interface StoredSeriesItem extends SeriesItem {
  sourceId: string;
}

export interface StoredEpgProgram extends EpgProgram {
  sourceId: string;
  tvgId: string;
}

export class LumaDatabase extends Dexie {
  public sources!: Table<StoredPlaylistSource, string>;
  public channels!: Table<StoredChannel, string>;
  public vodItems!: Table<StoredVodItem, string>;
  public seriesItems!: Table<StoredSeriesItem, string>;
  public epgPrograms!: Table<StoredEpgProgram, string>;

  constructor() {
    super('LumaTvDatabaseV2');
    this.version(1).stores({
      sources: 'id, type, name, createdAt',
      channels: 'id, sourceId, [sourceId+groupId], number, tvgId, name, sortOrder',
      vodItems: 'id, sourceId, genre, title',
      epgPrograms: 'id, sourceId, [tvgId+startMs], tvgId, startMs, endMs',
    });
    this.version(2).stores({
      sources: 'id, type, name, createdAt',
      channels: 'id, sourceId, [sourceId+groupId], number, tvgId, name, sortOrder',
      vodItems: 'id, sourceId, genre, title',
      seriesItems: 'id, sourceId, genre, title',
      epgPrograms: 'id, sourceId, [tvgId+startMs], tvgId, startMs, endMs',
    });
  }
}

export const lumaDb = new LumaDatabase();

export async function bulkSaveChannelsChunked(
  items: StoredChannel[],
  chunkSize = 2000,
  onProgress?: (written: number, total: number) => void
): Promise<void> {
  for (let i = 0; i < items.length; i += chunkSize) {
    const slice = items.slice(i, i + chunkSize);
    await lumaDb.channels.bulkPut(slice);
    onProgress?.(Math.min(items.length, i + slice.length), items.length);
  }
}

export async function bulkSaveVodChunked(
  items: StoredVodItem[],
  chunkSize = 1500
): Promise<void> {
  for (let i = 0; i < items.length; i += chunkSize) {
    await lumaDb.vodItems.bulkPut(items.slice(i, i + chunkSize));
  }
}

export async function bulkSaveSeriesChunked(
  items: StoredSeriesItem[],
  chunkSize = 1500
): Promise<void> {
  for (let i = 0; i < items.length; i += chunkSize) {
    await lumaDb.seriesItems.bulkPut(items.slice(i, i + chunkSize));
  }
}

export async function bulkSaveEpgChunked(
  items: StoredEpgProgram[],
  chunkSize = 2500,
  onProgress?: (written: number, total: number) => void
): Promise<void> {
  for (let i = 0; i < items.length; i += chunkSize) {
    const slice = items.slice(i, i + chunkSize);
    await lumaDb.epgPrograms.bulkPut(slice);
    onProgress?.(Math.min(items.length, i + slice.length), items.length);
  }
}
