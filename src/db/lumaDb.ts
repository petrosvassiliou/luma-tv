import Dexie, { type Table } from 'dexie';
import type { Channel, EpgProgram, PlaylistSource, VodItem } from '../types/luma';

export interface StoredPlaylistSource extends PlaylistSource {
  rawUrlOrHost: string;
  username?: string;
  xmltvUrl?: string;
  hiddenGroupIds: string[];
  createdAt: number;
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

export interface StoredEpgProgram extends EpgProgram {
  sourceId: string;
  tvgId: string;
}

export class LumaDatabase extends Dexie {
  public sources!: Table<StoredPlaylistSource, string>;
  public channels!: Table<StoredChannel, string>;
  public vodItems!: Table<StoredVodItem, string>;
  public epgPrograms!: Table<StoredEpgProgram, string>;

  constructor() {
    super('LumaTvDatabaseV2');
    this.version(1).stores({
      sources: 'id, type, name, createdAt',
      channels: 'id, sourceId, [sourceId+groupId], number, tvgId, name, sortOrder',
      vodItems: 'id, sourceId, genre, title',
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
