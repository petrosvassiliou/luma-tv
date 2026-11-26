import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { lumaDb } from '../db/lumaDb';
import type { Channel } from '../types/luma';
import {
  deduplicateStoredPlaylistSources,
  migratePersistedSourceId,
} from './playlistService';
import {
  arePlaylistSettingsEquivalent,
  computePlaylistCanonicalKey,
  computeSyncContentDigest,
  createEmptySyncMetadata,
  decryptSyncVault,
  decryptVaultWithMasterKey,
  deduplicatePlaylistsWithSettings,
  deriveAccountMasterKeyRecord,
  encryptSyncVault,
  encryptVaultWithMasterKey,
  isDefaultOnlyLocalPayload,
  LUMA_DEFAULT_FIREBASE_CONFIG,
  LUMA_FACTORY_DEFAULT_FAVORITES,
  reconcileCloudSyncPayloads,
  resolveEnvFirebaseConfig,
  resolveMissingChannelsAndBuildHealMap,
  type LumaSyncPlainPayload,
} from './lumaCloudSync';

describe('lumaCloudSync v3 (Zero-Knowledge Crypto, Playlist Deduplication & Incremental Sync)', () => {
  const samplePayload: LumaSyncPlainPayload = {
    schemaVersion: 3,
    exportedAt: 1795600000000,
    favorites: ['ch-redbull-tv', 'xtream-100-xt-36037'],
    favoriteVodIds: ['vod-tears-of-steel'],
    favoriteSeriesIds: ['ser-orbital-horizon'],
    customBouquets: [
      {
        id: 'bq-greek',
        name: 'Greek & Sports',
        channelIds: ['xtream-100-xt-36037'],
        vodIds: ['vod-tears-of-steel'],
        seriesIds: ['ser-orbital-horizon'],
        isPinLocked: true,
      },
    ],
    watchHistory: [
      {
        itemId: 'vod-tears-of-steel',
        title: 'Tears of Steel',
        kind: 'vod',
        resumeSec: 420,
        durationSec: 4440,
        updatedAt: 1795600000000,
      },
    ],
    reminders: [
      {
        programId: 'prog-1',
        channelId: 'ch-redbull-tv',
        channelName: 'Red Bull TV HD',
        title: 'UCI Downhill',
        startMs: 1795603600000,
      },
    ],
    parentalConfig: {
      enabled: true,
      pin: '2468',
      lockedGroupIds: ['bq-greek'],
    },
    preferences: {
      locale: 'en',
      bufferProfile: 'balanced',
      sleepTimerMinutes: 0,
      spatialDpadEnabled: true,
      autoMiniPlayerOnSwitch: false,
      autoRefreshHours: 12,
      autoCheckUpdates: true,
      includeBetaUpdates: true,
      startupChannelId: null,
      startupChannelName: null,
    },
    epgOffsetHours: 1,
    preferredDesign: 'liquid-glass',
    dualSlotIds: ['ch-redbull-tv', 'ch-luma-cinema-4k'],
    multiviewSlotIds: [
      'ch-redbull-tv',
      'ch-luma-cinema-4k',
      'ch-dw-global',
      'ch-nasa-public',
    ],
    activeSourceId: 'xtream-100',
    demoSourceDeleted: false,
    playlists: [
      {
        id: 'xtream-100',
        name: 'My Xtream Provider',
        type: 'xtream',
        endpoint: 'http://provider.example:8080',
        rawUrlOrHost: 'http://provider.example:8080',
        username: 'alice',
        password: 'super-secret-xtream-password',
        outputFormat: 'm3u8',
        xmltvUrl: 'http://provider.example:8080/xmltv.php',
        hiddenGroupIds: ['adult'],
        createdAt: 1795500000000,
      },
    ],
  };

  const makeFactoryDefaultLocalPayload = (): LumaSyncPlainPayload => ({
    schemaVersion: 3,
    exportedAt: 1795700000000,
    favorites: [...LUMA_FACTORY_DEFAULT_FAVORITES],
    favoriteVodIds: [],
    favoriteSeriesIds: [],
    customBouquets: [
      {
        id: 'bq-weekend-sport',
        name: 'Wochenende Live-Sport',
        channelIds: ['ch-redbull-tv', 'ch-mux-motorsport', 'ch-nasa-public'],
        isPinLocked: false,
      },
    ],
    watchHistory: [
      {
        itemId: 'ep-orb-s1e1',
        title: 'Orbital Horizon · S01E01 Apogäum 420 km',
        kind: 'vod',
        resumeSec: 1140,
        durationSec: 3120,
        updatedAt: 1795699800000,
      },
      {
        itemId: 'ch-redbull-tv',
        title: 'Red Bull TV HD',
        kind: 'live',
        resumeSec: 0,
        durationSec: 0,
        updatedAt: 1795699400000,
      },
    ],
    reminders: [],
    parentalConfig: {
      enabled: true,
      pin: '0000',
      lockedGroupIds: [],
    },
    preferences: {
      locale: 'de',
      bufferProfile: 'balanced',
      sleepTimerMinutes: 0,
      spatialDpadEnabled: true,
      autoMiniPlayerOnSwitch: false,
      autoRefreshHours: 12,
      startupChannelId: null,
      startupChannelName: null,
    },
    epgOffsetHours: 0,
    preferredDesign: 'm3-expressive',
    activeSourceId: 'builtin-reference',
    demoSourceDeleted: false,
    playlists: [],
  });

  it('derives identical 256-bit AES-GCM Master Keys across Mac and Googlebook for the same uid + password', async () => {
    const macKey = await deriveAccountMasterKeyRecord({
      uid: 'uid-user-12345',
      email: 'user@example.com',
      password: 'MyCloudPassword2026!',
    });
    const googlebookKey = await deriveAccountMasterKeyRecord({
      uid: 'uid-user-12345',
      email: 'user@example.com',
      password: 'MyCloudPassword2026!',
    });

    expect(macKey.masterKeyBase64).toEqual(googlebookKey.masterKeyBase64);
    expect(macKey.saltBase64).toEqual(googlebookKey.saltBase64);

    const envelope = await encryptVaultWithMasterKey({
      payload: samplePayload,
      masterKeyBase64: macKey.masterKeyBase64,
      saltBase64: macKey.saltBase64,
      deviceId: 'luma-mac-01',
      deviceLabel: 'macOS',
    });

    expect(envelope.cipherBase64).not.toContain('super-secret-xtream-password');
    expect(envelope.version).toBe(2);
    expect(envelope.schemaVersion).toBe(3);
    expect(envelope.kdf).toBe('PBKDF2-SHA256-150k');
    expect(envelope.alg).toBe('AES-256-GCM');

    const decryptedOnGooglebook = await decryptVaultWithMasterKey(
      envelope,
      googlebookKey.masterKeyBase64
    );
    expect(decryptedOnGooglebook).toEqual(samplePayload);
  });

  it('rejects decryption with a wrong account password', async () => {
    const aliceKey = await deriveAccountMasterKeyRecord({
      uid: 'uid-user-12345',
      email: 'alice@example.com',
      password: 'CorrectPassword123',
    });
    const wrongKey = await deriveAccountMasterKeyRecord({
      uid: 'uid-user-12345',
      email: 'alice@example.com',
      password: 'WrongPassword999',
    });

    const envelope = await encryptVaultWithMasterKey({
      payload: samplePayload,
      masterKeyBase64: aliceKey.masterKeyBase64,
      saltBase64: aliceKey.saltBase64,
    });

    await expect(
      decryptVaultWithMasterKey(envelope, wrongKey.masterKeyBase64)
    ).rejects.toThrow();
  });

  it('supports manual passphrase encryption/decryption and resolves default Firebase config', async () => {
    const cfg = resolveEnvFirebaseConfig();
    expect(cfg.projectId).toBe(LUMA_DEFAULT_FIREBASE_CONFIG.projectId);

    const env = await encryptSyncVault(samplePayload, 'LocalVaultPass!');
    const restored = await decryptSyncVault(env, 'LocalVaultPass!');
    expect(restored.playlists?.[0]?.password).toBe('super-secret-xtream-password');
    expect(restored.customBouquets?.[0]?.name).toBe('Greek & Sports');
  });

  it('matches canonical playlist URLs and settings without creating duplicate playlists', () => {
    const xtreamA = {
      id: 'xtream-1',
      name: 'Home TV',
      type: 'xtream' as const,
      endpoint: 'http://Line.Provider.TV:8080/',
      rawUrlOrHost: 'http://Line.Provider.TV:8080/player_api.php',
      username: ' Alice ',
      password: 'pw1',
      outputFormat: 'm3u8' as const,
      hiddenGroupIds: ['adult', 'ar'],
    };
    const xtreamB = {
      id: 'xtream-2',
      name: 'Home TV',
      type: 'xtream' as const,
      endpoint: 'http://line.provider.tv:8080',
      rawUrlOrHost: 'http://line.provider.tv:8080',
      username: 'alice',
      password: 'pw1',
      outputFormat: 'm3u8' as const,
      hiddenGroupIds: ['ar', 'adult'],
    };

    expect(computePlaylistCanonicalKey(xtreamA)).toBe(
      computePlaylistCanonicalKey(xtreamB)
    );
    expect(arePlaylistSettingsEquivalent(xtreamA, xtreamB)).toBe(true);

    const m3uA = {
      id: 'src-1',
      name: 'EU M3U',
      type: 'm3u_plus' as const,
      endpoint:
        'https://IPTV.Example.com:443/get.php?password=123&type=m3u_plus&output=ts&username=bob',
      rawUrlOrHost:
        'https://IPTV.Example.com:443/get.php?password=123&type=m3u_plus&output=ts&username=bob',
    };
    const m3uB = {
      id: 'src-2',
      name: 'EU M3U',
      type: 'm3u_plus' as const,
      endpoint:
        'https://iptv.example.com/get.php?username=bob&password=123&output=m3u8',
      rawUrlOrHost:
        'https://iptv.example.com/get.php?username=bob&password=123&output=m3u8',
    };

    expect(computePlaylistCanonicalKey(m3uA)).toBe(
      computePlaylistCanonicalKey(m3uB)
    );

    const dedup = deduplicatePlaylistsWithSettings([xtreamA, xtreamB, m3uA, m3uB]);
    expect(dedup.playlists).toHaveLength(2);
    expect(dedup.sourceIdRemap.get('xtream-2')).toBe('xtream-1');
    expect(dedup.sourceIdRemap.get('src-2')).toBe('src-1');
  });

  it('cleanly adopts remote cloud vault on first-time sync when local device has default configuration only', () => {
    const defaultLocal = makeFactoryDefaultLocalPayload();
    expect(isDefaultOnlyLocalPayload(defaultLocal)).toBe(true);

    const cloudPayload: LumaSyncPlainPayload = {
      ...samplePayload,
      demoSourceDeleted: true,
      favorites: ['xtream-100-xt-36037', 'xtream-100-xt-555'],
      customBouquets: [
        {
          id: 'bq-italian',
          name: 'Italian',
          channelIds: ['xtream-100-xt-555'],
          isPinLocked: false,
        },
      ],
    };

    const result = reconcileCloudSyncPayloads({
      uid: 'uid-user-1',
      local: defaultLocal,
      remote: cloudPayload,
      deviceSyncState: null,
      isLocalAppleDevice: false,
      hasExplicitLocalPrefs: false,
      nowMs: 1795800000000,
    });

    expect(result.mode).toBe('adopted-remote');
    expect(result.shouldApplyLocally).toBe(true);
    expect(result.shouldPushToCloud).toBe(false);
    // Factory demo favorites & demo collection must NOT pollute the adopted cloud config
    expect(result.mergedPayload.favorites).toEqual([
      'xtream-100-xt-36037',
      'xtream-100-xt-555',
    ]);
    expect(result.mergedPayload.customBouquets?.map((b) => b.id)).toEqual([
      'bq-italian',
    ]);
    expect(result.mergedPayload.playlists).toHaveLength(1);
    expect(result.mergedPayload.preferredDesign).toBe('liquid-glass');
  });

  it('compares local vs cloud on first-time sync for a configured device, deduplicates playlists, and remaps IDs', () => {
    const configuredLocal: LumaSyncPlainPayload = {
      ...makeFactoryDefaultLocalPayload(),
      favorites: [...LUMA_FACTORY_DEFAULT_FAVORITES, 'xtream-local-999-xt-777'],
      favoriteVodIds: ['xtream-local-999-xvod-42'],
      favoriteSeriesIds: ['xtream-local-999-xser-9'],
      customBouquets: [
        {
          id: 'bq-weekend-sport',
          name: 'Wochenende Live-Sport',
          channelIds: ['ch-redbull-tv', 'ch-mux-motorsport', 'ch-nasa-public'],
          isPinLocked: false,
        },
        {
          id: 'col-local-greek',
          name: 'Greek & Sports',
          channelIds: ['xtream-local-999-xt-888'],
          isPinLocked: false,
        },
        {
          id: 'col-local-cinema',
          name: 'Cinema UHD',
          channelIds: ['src-m3u-2-ch-10'],
          isPinLocked: false,
        },
      ],
      preferences: {
        locale: 'de',
        bufferProfile: 'low-latency',
        sleepTimerMinutes: 0,
        spatialDpadEnabled: true,
        autoMiniPlayerOnSwitch: false,
        autoRefreshHours: 12,
        startupChannelId: 'xtream-local-999-xt-777',
        startupChannelName: 'Mega Sport 4K',
      },
      activeSourceId: 'xtream-local-999',
      playlists: [
        {
          id: 'xtream-local-999',
          name: 'Xtream Codes Server',
          type: 'xtream',
          endpoint: 'http://PROVIDER.example:8080/',
          rawUrlOrHost: 'http://PROVIDER.example:8080/',
          username: ' ALICE ',
          password: 'super-secret-xtream-password',
          outputFormat: 'ts',
          hiddenGroupIds: ['adult', 'tr-vip'],
          epgOffsetHours: 2,
          createdAt: 1795650000000,
          updatedAt: 1795650000000,
        },
        {
          id: 'src-m3u-2',
          name: 'FTA Europe',
          type: 'm3u_plus',
          endpoint: 'https://streams.example.org/fta.m3u8',
          rawUrlOrHost: 'https://streams.example.org/fta.m3u8',
          hiddenGroupIds: [],
          createdAt: 1795660000000,
          updatedAt: 1795660000000,
        },
      ],
    };

    expect(isDefaultOnlyLocalPayload(configuredLocal)).toBe(false);

    const cloudPayload: LumaSyncPlainPayload = {
      ...samplePayload,
      demoSourceDeleted: true,
      favorites: ['xtream-100-xt-36037'],
      favoriteVodIds: [],
      favoriteSeriesIds: [],
    };

    const result = reconcileCloudSyncPayloads({
      uid: 'uid-user-1',
      local: configuredLocal,
      remote: cloudPayload,
      deviceSyncState: null,
      isLocalAppleDevice: false,
      hasExplicitLocalPrefs: true,
      nowMs: 1795850000000,
    });

    expect(result.mode).toBe('first-time-merge');
    expect(result.shouldPushToCloud).toBe(true);
    expect(result.shouldApplyLocally).toBe(true);
    expect(result.deduplicatedPlaylistCount).toBe(1);
    expect(result.sourceIdRemap.get('xtream-local-999')).toBe('xtream-100');

    // Only 2 unique playlists (no duplicate Xtream server entry!)
    expect(result.mergedPayload.playlists).toHaveLength(2);
    const mergedXtream = result.mergedPayload.playlists?.find(
      (p) => p.id === 'xtream-100'
    );
    expect(mergedXtream?.name).toBe('My Xtream Provider'); // Non-generic name wins over 'Xtream Codes Server'
    expect(mergedXtream?.outputFormat).toBe('ts');
    expect(mergedXtream?.epgOffsetHours).toBe(2);
    expect(mergedXtream?.hiddenGroupIds).toEqual(['adult', 'tr-vip']);

    // Local favorites/VOD/Series/startupChannel remapped from xtream-local-999 -> xtream-100
    expect(result.mergedPayload.favorites).toEqual([
      'xtream-100-xt-36037',
      'xtream-100-xt-777',
    ]);
    expect(result.mergedPayload.favoriteVodIds).toEqual(['xtream-100-xvod-42']);
    expect(result.mergedPayload.favoriteSeriesIds).toEqual(['xtream-100-xser-9']);
    expect(result.mergedPayload.preferences?.startupChannelId).toBe(
      'xtream-100-xt-777'
    );
    expect(result.mergedPayload.preferences?.bufferProfile).toBe('low-latency');
    expect(result.mergedPayload.activeSourceId).toBe('xtream-100');

    // Same-named 'Greek & Sports' collection merged without duplication; demo 'bq-weekend-sport' stripped
    expect(result.mergedPayload.customBouquets?.map((b) => b.name)).toEqual([
      'Greek & Sports',
      'Cinema UHD',
    ]);
    const mergedGreek = result.mergedPayload.customBouquets?.find(
      (b) => b.name === 'Greek & Sports'
    );
    expect(mergedGreek?.channelIds).toEqual([
      'xtream-100-xt-36037',
      'xtream-100-xt-888',
    ]);
  });

  it('performs true incremental 3-way + tombstone sync for concurrent additions, edits, and deletions', () => {
    const baseMeta = createEmptySyncMetadata(4);
    const sharedBase: LumaSyncPlainPayload = {
      ...samplePayload,
      schemaVersion: 3,
      demoSourceDeleted: true,
      favorites: ['xtream-100-xt-101', 'xtream-100-xt-102'],
      favoriteVodIds: ['xtream-100-xvod-1'],
      favoriteSeriesIds: [],
      customBouquets: [
        {
          id: 'bq-italian',
          name: 'Italian',
          channelIds: ['xtream-100-xt-101', 'xtream-100-xt-102'],
          isPinLocked: false,
        },
      ],
      playlists: [
        {
          id: 'xtream-100',
          name: 'Main Xtream',
          type: 'xtream',
          endpoint: 'http://provider.example:8080',
          rawUrlOrHost: 'http://provider.example:8080',
          username: 'alice',
          password: 'pw',
          outputFormat: 'm3u8',
          hiddenGroupIds: ['adult'],
          createdAt: 1795500000000,
          updatedAt: 1795500000000,
        },
        {
          id: 'src-old',
          name: 'Old Backup M3U',
          type: 'm3u_plus',
          endpoint: 'https://old.example.org/list.m3u8',
          rawUrlOrHost: 'https://old.example.org/list.m3u8',
          hiddenGroupIds: [],
          createdAt: 1795500000000,
          updatedAt: 1795500000000,
        },
      ],
      syncMeta: baseMeta,
    };

    const oldPlaylistCanon = computePlaylistCanonicalKey(sharedBase.playlists![1]);

    // Remote (Device A) unfavorited 101, deleted playlist 'src-old', and set startupChannelId
    const remotePayload: LumaSyncPlainPayload = {
      ...sharedBase,
      exportedAt: 1795900000000,
      favorites: ['xtream-100-xt-102'],
      preferences: {
        ...sharedBase.preferences!,
        startupChannelId: 'xtream-100-xt-102',
        startupChannelName: 'Rai 1 HD',
      },
      playlists: [sharedBase.playlists![0]],
      syncMeta: {
        revision: 5,
        fieldUpdatedAt: { preferences: 1795900000000 },
        itemUpdatedAt: {},
        tombstones: {
          'fav:xtream-100-xt-101': 1795900000000,
          [`pl:${oldPlaylistCanon}`]: 1795900000000,
        },
      },
    };

    // Local (Device B) added favorite 999, hid group 'kids' on xtream-100, and switched bufferProfile
    const localMeta = {
      revision: 5,
      fieldUpdatedAt: { preferences: 1795900050000 },
      itemUpdatedAt: {
        'fav:xtream-100-xt-999': 1795900050000,
        [`pl:${computePlaylistCanonicalKey(sharedBase.playlists![0])}`]: 1795900050000,
      },
      tombstones: {},
    };
    const localPayload: LumaSyncPlainPayload = {
      ...sharedBase,
      exportedAt: 1795900050000,
      favorites: [
        'xtream-100-xt-101',
        'xtream-100-xt-102',
        'xtream-100-xt-999',
      ],
      preferences: {
        ...sharedBase.preferences!,
        bufferProfile: 'cinema-max',
      },
      playlists: [
        {
          ...sharedBase.playlists![0],
          hiddenGroupIds: ['adult', 'kids'],
          updatedAt: 1795900050000,
        },
        sharedBase.playlists![1],
      ],
      syncMeta: localMeta,
    };

    const reconciled = reconcileCloudSyncPayloads({
      uid: 'uid-user-1',
      local: localPayload,
      remote: remotePayload,
      deviceSyncState: {
        uid: 'uid-user-1',
        hasCompletedInitialSync: true,
        lastSyncedDigest: computeSyncContentDigest(sharedBase),
        lastRemoteUpdatedAt: 1795600000000,
        basePayload: sharedBase,
        localMeta,
      },
      remoteUpdatedAtMs: 1795900000000,
      isLocalAppleDevice: true,
      hasExplicitLocalPrefs: true,
      nowMs: 1795900100000,
    });

    expect(reconciled.mode).toBe('incremental-merge');
    expect(reconciled.shouldApplyLocally).toBe(true);
    expect(reconciled.shouldPushToCloud).toBe(true);
    expect(reconciled.deletedPlaylistIds).toEqual(['src-old']);
    expect(reconciled.mergedPayload.playlists?.map((p) => p.id)).toEqual([
      'xtream-100',
    ]);
    expect(reconciled.mergedPayload.playlists?.[0]?.hiddenGroupIds).toEqual([
      'adult',
      'kids',
    ]);
    // 101 was deleted on Device A; 999 was added on Device B -> result has 102 + 999
    expect(reconciled.mergedPayload.favorites).toEqual([
      'xtream-100-xt-102',
      'xtream-100-xt-999',
    ]);
    // Per-property 3-way preference merge keeps BOTH startupChannelId (from A) and bufferProfile (from B)
    expect(reconciled.mergedPayload.preferences?.startupChannelId).toBe(
      'xtream-100-xt-102'
    );
    expect(reconciled.mergedPayload.preferences?.bufferProfile).toBe('cinema-max');

    // Subsequent sync with no new mutations is a zero-op ('up-to-date')
    const secondRun = reconcileCloudSyncPayloads({
      uid: 'uid-user-1',
      local: { ...reconciled.mergedPayload, exportedAt: 1795900999999 },
      remote: reconciled.mergedPayload,
      deviceSyncState: reconciled.nextDeviceSyncState,
      remoteUpdatedAtMs: 1795900100000,
      isLocalAppleDevice: true,
      hasExplicitLocalPrefs: true,
      nowMs: 1795901000000,
    });
    expect(secondRun.mode).toBe('up-to-date');
    expect(secondRun.shouldPushToCloud).toBe(false);
    expect(secondRun.shouldApplyLocally).toBe(false);
  });

  it('migrates cached IndexedDB channels, VOD, and series in-place and eliminates duplicate playlist rows', async () => {
    await Promise.all([
      lumaDb.sources.clear(),
      lumaDb.channels.clear(),
      lumaDb.vodItems.clear(),
      lumaDb.seriesItems.clear(),
      lumaDb.epgPrograms.clear(),
    ]);

    await lumaDb.sources.bulkPut([
      {
        id: 'xtream-local-dup',
        name: 'Xtream Codes Server',
        type: 'xtream',
        endpoint: 'http://provider.example:8080/',
        rawUrlOrHost: 'http://provider.example:8080/',
        username: 'alice',
        password: 'pw',
        outputFormat: 'm3u8',
        hiddenGroupIds: ['ar'],
        epgOffsetHours: 0,
        channelCount: 1,
        vodCount: 1,
        seriesCount: 1,
        epgStatus: 'synced',
        lastUpdated: 'Now',
        createdAt: 1795600000000,
      },
      {
        id: 'xtream-cloud-canon',
        name: 'Home Xtream',
        type: 'xtream',
        endpoint: 'http://PROVIDER.example:8080',
        rawUrlOrHost: 'http://PROVIDER.example:8080',
        username: ' ALICE ',
        password: 'pw',
        outputFormat: 'm3u8',
        hiddenGroupIds: ['adult'],
        epgOffsetHours: 1,
        channelCount: 0,
        vodCount: 0,
        seriesCount: 0,
        epgStatus: 'syncing',
        lastUpdated: 'Cloud Sync',
        createdAt: 1795500000000,
      },
    ]);

    await lumaDb.channels.put({
      id: 'xtream-local-dup-xt-501',
      sourceId: 'xtream-local-dup',
      number: 1,
      sortOrder: 0,
      name: 'Sky Cinema HD',
      shortCode: 'SKY',
      groupId: 'cinema',
      groupName: 'Cinema',
      streamUrl: 'http://provider.example:8080/live/alice/pw/501.m3u8',
      streamType: 'hls',
      resolution: '1080p',
      audioBadge: 'EAC3 5.1',
      codec: 'H.264',
      hasCatchup: true,
      catchupDays: 7,
      accentColor: '#38BDF8',
      country: 'DE',
      epgArchetype: 0,
    });

    await lumaDb.vodItems.put({
      id: 'xtream-local-dup-xvod-88',
      sourceId: 'xtream-local-dup',
      title: 'Dune',
      year: 2024,
      genre: 'Sci-Fi',
      durationMin: 155,
      rating: '8.6',
      resolution: '4K HDR',
      codec: 'HEVC',
      streamUrl: 'http://provider.example:8080/movie/alice/pw/88.mp4',
      synopsis: 'Sci-Fi epic',
      accentFrom: '#38BDF8',
      accentTo: '#0F172A',
    });

    await lumaDb.seriesItems.put({
      id: 'xtream-local-dup-xser-7',
      sourceId: 'xtream-local-dup',
      title: 'Severance',
      year: 2025,
      genre: 'Sci-Fi',
      rating: '8.9',
      badge: '4K HDR',
      synopsis: 'Lumon',
      accentFrom: '#38BDF8',
      accentTo: '#0F172A',
      seasonsLoaded: true,
      seasons: [
        {
          seasonNumber: 1,
          title: 'Season 1',
          episodes: [
            {
              id: 'xtream-local-dup-xser-7-s1e10',
              episodeNumber: 1,
              title: 'Good News',
              durationMin: 55,
              synopsis: 'S1E1',
              streamUrl: 'http://provider.example:8080/series/alice/pw/10.mp4',
              resolution: '4K HDR',
            },
          ],
        },
      ],
    });

    const remap = await deduplicateStoredPlaylistSources(
      new Set(['xtream-cloud-canon'])
    );
    expect(remap.get('xtream-local-dup')).toBe('xtream-cloud-canon');

    const remainingSources = await lumaDb.sources.toArray();
    expect(remainingSources).toHaveLength(1);
    expect(remainingSources[0].id).toBe('xtream-cloud-canon');
    expect(remainingSources[0].name).toBe('Home Xtream');
    expect(remainingSources[0].channelCount).toBe(1);
    expect(new Set(remainingSources[0].hiddenGroupIds)).toEqual(
      new Set(['adult', 'ar'])
    );

    const migratedChannel = await lumaDb.channels.get('xtream-cloud-canon-xt-501');
    expect(migratedChannel?.name).toBe('Sky Cinema HD');
    expect(migratedChannel?.sourceId).toBe('xtream-cloud-canon');
    expect(await lumaDb.channels.get('xtream-local-dup-xt-501')).toBeUndefined();

    const migratedVod = await lumaDb.vodItems.get('xtream-cloud-canon-xvod-88');
    expect(migratedVod?.title).toBe('Dune');

    const migratedSeries = await lumaDb.seriesItems.get('xtream-cloud-canon-xser-7');
    expect(migratedSeries?.seasons[0].episodes[0].id).toBe(
      'xtream-cloud-canon-xser-7-s1e10'
    );

    // Also verify no-op in-place metadata update via migratePersistedSourceId
    const updatedSame = await migratePersistedSourceId(
      'xtream-cloud-canon',
      'xtream-cloud-canon',
      { epgOffsetHours: 2 }
    );
    expect(updatedSame?.epgOffsetHours).toBe(2);
  });

  it('preserves channelSnapshots for Favorites & Greek collection and heals orphaned or shifted channel IDs on synced devices', () => {
    const ertChannel: Channel = {
      id: 'xtream-old-111-xt-9001',
      number: 1,
      name: 'GR| ERT 1 HD',
      shortCode: 'ERT1',
      groupId: 'gr-general',
      groupName: 'GR| GREECE',
      streamUrl: 'http://provider.example:8080/live/alice/pw/9001.m3u8',
      streamType: 'hls',
      resolution: '1080p',
      audioBadge: 'EAC3 5.1',
      codec: 'H.264',
      hasCatchup: true,
      catchupDays: 7,
      xtreamStreamId: 9001,
      tvgId: 'ert1.gr',
      accentColor: '#38BDF8',
      country: 'GR',
      epgArchetype: 0,
    };

    const megaChannel = {
      ...ertChannel,
      id: 'xtream-old-111-xt-9002',
      number: 2,
      name: 'GR| MEGA HD',
      shortCode: 'MEGA',
      streamUrl: 'http://provider.example:8080/live/alice/pw/9002.m3u8',
      xtreamStreamId: 9002,
      tvgId: 'mega.gr',
    };

    // 1. Syncing from Device 1 carries portable channelSnapshots to Device 2 for instant zero-wait display
    const device1CloudPayload: LumaSyncPlainPayload = {
      ...samplePayload,
      demoSourceDeleted: true,
      favorites: ['xtream-100-xt-9001'],
      customBouquets: [
        {
          id: 'col-greek',
          name: 'Greek',
          channelIds: ['xtream-100-xt-9001', 'xtream-100-xt-9002'],
          isPinLocked: false,
        },
      ],
      channelSnapshots: {
        'xtream-100-xt-9001': { ...ertChannel, id: 'xtream-100-xt-9001' },
        'xtream-100-xt-9002': { ...megaChannel, id: 'xtream-100-xt-9002' },
      },
    };

    const device2Sync = reconcileCloudSyncPayloads({
      uid: 'uid-user-gr',
      local: makeFactoryDefaultLocalPayload(),
      remote: device1CloudPayload,
      deviceSyncState: null,
      isLocalAppleDevice: false,
    });

    expect(device2Sync.mode).toBe('adopted-remote');
    expect(
      device2Sync.mergedPayload.channelSnapshots?.['xtream-100-xt-9001']?.name
    ).toBe('GR| ERT 1 HD');
    expect(
      device2Sync.mergedPayload.channelSnapshots?.['xtream-100-xt-9002']?.name
    ).toBe('GR| MEGA HD');

    // 2. Self-healing orphaned IDs (even WITHOUT snapshots, e.g. from older beta vaults)
    // where favorites/Greek collection hold `xtream-old-111-xt-*` while DB has `xtream-new-222-xt-*`
    const dbChannelsOnDevice2 = [
      { ...ertChannel, id: 'xtream-new-222-xt-9001' },
      { ...megaChannel, id: 'xtream-new-222-xt-9002' },
    ];

    const healed = resolveMissingChannelsAndBuildHealMap({
      neededIds: ['xtream-old-111-xt-9001', 'xtream-old-111-xt-9002'],
      exactFoundIds: new Set(),
      candidateChannels: dbChannelsOnDevice2,
      validSourceIds: new Set(['xtream-new-222']),
      demoSourceDeleted: true,
    });

    expect(healed.resolvedChannels.map((c) => c.name)).toEqual([
      'GR| ERT 1 HD',
      'GR| MEGA HD',
    ]);
    expect(healed.healIdMap.get('xtream-old-111-xt-9001')).toBe(
      'xtream-new-222-xt-9001'
    );
    expect(healed.healIdMap.get('xtream-old-111-xt-9002')).toBe(
      'xtream-new-222-xt-9002'
    );

    // 3. Self-healing M3U line-index shifts via snapshot stream/name matching
    const shiftedM3uDbChannels = [
      {
        ...ertChannel,
        id: 'src-500-ch-419',
        streamUrl: 'http://m3u.example.org/live/u/p/9001.ts',
      },
    ];
    const m3uHealed = resolveMissingChannelsAndBuildHealMap({
      neededIds: ['src-500-ch-412'],
      exactFoundIds: new Set(),
      candidateChannels: shiftedM3uDbChannels,
      snapshots: {
        'src-500-ch-412': {
          ...ertChannel,
          id: 'src-500-ch-412',
          streamUrl: 'http://m3u.example.org/live/u/p/9001.m3u8',
        },
      },
      validSourceIds: new Set(['src-500']),
      demoSourceDeleted: true,
    });
    expect(m3uHealed.healIdMap.get('src-500-ch-412')).toBe('src-500-ch-419');
  });
});
