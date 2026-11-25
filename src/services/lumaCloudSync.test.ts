import { describe, expect, it } from 'vitest';
import {
  decryptSyncVault,
  decryptVaultWithMasterKey,
  deriveAccountMasterKeyRecord,
  encryptSyncVault,
  encryptVaultWithMasterKey,
  LUMA_DEFAULT_FIREBASE_CONFIG,
  resolveEnvFirebaseConfig,
  type LumaSyncPlainPayload,
} from './lumaCloudSync';

describe('lumaCloudSync v2 (Account-Keyed AES-256-GCM & Full Payload Roundtrip)', () => {
  const samplePayload: LumaSyncPlainPayload = {
    schemaVersion: 2,
    exportedAt: 1795600000000,
    favorites: ['ch-redbull-tv', 'xtream-100:live:36037'],
    favoriteVodIds: ['vod-tears-of-steel'],
    favoriteSeriesIds: ['ser-orbital-horizon'],
    customBouquets: [
      {
        id: 'bq-greek',
        name: 'Greek & Sports',
        channelIds: ['xtream-100:live:36037'],
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

    // Encrypt on Mac, decrypt on Googlebook
    const envelope = await encryptVaultWithMasterKey({
      payload: samplePayload,
      masterKeyBase64: macKey.masterKeyBase64,
      saltBase64: macKey.saltBase64,
      deviceId: 'luma-mac-01',
      deviceLabel: 'macOS',
    });

    // Ciphertext must never leak raw Xtream password or M3U URLs in cleartext
    expect(envelope.cipherBase64).not.toContain('super-secret-xtream-password');
    expect(envelope.version).toBe(2);
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
});
