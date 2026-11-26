import { getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import type { StoredPlaylistSource } from '../db/lumaDb';
import type { LumaPreferences } from '../i18n/translations';
import type {
  CustomBouquet,
  EpgReminder,
  ParentalControlConfig,
  PlatformDesignMode,
} from '../types/luma';

export interface WatchHistoryEntry {
  itemId: string;
  title: string;
  kind: 'live' | 'vod' | 'catchup';
  resumeSec: number;
  durationSec: number;
  updatedAt: number;
}

export interface SyncedPlaylistSource {
  id: string;
  name: string;
  type: StoredPlaylistSource['type'];
  endpoint: string;
  rawUrlOrHost: string;
  username?: string;
  password?: string;
  outputFormat?: 'm3u8' | 'ts';
  xmltvUrl?: string;
  hiddenGroupIds?: string[];
  epgOffsetHours?: number;
  createdAt?: number;
  updatedAt?: number;
}

export type SyncScalarField =
  | 'preferences'
  | 'parentalConfig'
  | 'epgOffsetHours'
  | 'preferredDesign'
  | 'dualSlotIds'
  | 'multiviewSlotIds'
  | 'activeSourceId'
  | 'demoSourceDeleted';

export interface EncryptedSyncMetadataV3 {
  revision: number;
  fieldUpdatedAt: Partial<Record<SyncScalarField, number>>;
  itemUpdatedAt: Record<string, number>;
  tombstones: Record<string, number>;
}

export interface LumaSyncPlainPayload {
  schemaVersion: 1 | 2 | 3;
  exportedAt: number;
  favorites: string[];
  favoriteVodIds?: string[];
  favoriteSeriesIds?: string[];
  customBouquets?: CustomBouquet[];
  watchHistory: WatchHistoryEntry[];
  reminders?: EpgReminder[];
  parentalConfig?: ParentalControlConfig;
  preferences?: LumaPreferences;
  epgOffsetHours: number;
  preferredDesign: PlatformDesignMode;
  dualSlotIds?: [string, string];
  multiviewSlotIds?: string[];
  activeSourceId?: string;
  demoSourceDeleted?: boolean;
  playlists?: SyncedPlaylistSource[];
  syncMeta?: EncryptedSyncMetadataV3;
}

export interface EncryptedSyncEnvelope {
  version: 1 | 2;
  kdf: 'PBKDF2-SHA256-150k';
  alg: 'AES-256-GCM';
  saltBase64: string;
  ivBase64: string;
  cipherBase64: string;
  updatedAt: number;
  deviceId?: string;
  deviceLabel?: string;
  schemaVersion?: number;
}

export interface LumaCloudSessionInfo {
  uid: string;
  email: string | null;
  hasVaultKey: boolean;
}

export interface DeviceCloudSyncStateV3 {
  uid: string;
  hasCompletedInitialSync: boolean;
  lastSyncedDigest: string;
  lastRemoteUpdatedAt: number;
  basePayload: LumaSyncPlainPayload | null;
  localMeta: EncryptedSyncMetadataV3;
}

export type CloudSyncReconcileMode =
  | 'initial-upload'
  | 'adopted-remote'
  | 'first-time-merge'
  | 'incremental-merge'
  | 'up-to-date';

export interface CloudSyncReconcileResult {
  mode: CloudSyncReconcileMode;
  mergedPayload: LumaSyncPlainPayload;
  shouldPushToCloud: boolean;
  shouldApplyLocally: boolean;
  sourceIdRemap: Map<string, string>;
  deletedPlaylistIds: string[];
  deduplicatedPlaylistCount: number;
  nextDeviceSyncState: DeviceCloudSyncStateV3;
  summary: string;
}

interface StoredMasterKeyRecord {
  uid: string;
  email: string | null;
  masterKeyBase64: string;
  saltBase64: string;
}

const SESSION_MASTER_KEY_STORAGE = 'luma.cloud.sessionKey.v2';
const DEVICE_ID_STORAGE = 'luma.cloud.deviceId.v1';
const DEVICE_SYNC_STATE_PREFIX = 'luma.cloud.syncState.v3:';
const TOMBSTONE_RETENTION_MS = 90 * 24 * 3_600_000;
const MAX_TOMBSTONE_ENTRIES = 1200;

export const LUMA_FACTORY_DEFAULT_FAVORITES = [
  'ch-redbull-tv',
  'ch-luma-cinema-4k',
  'ch-dw-global',
  'ch-nasa-public',
] as const;

export const LUMA_FACTORY_DEFAULT_BOUQUET_IDS = ['bq-weekend-sport'] as const;

export const LUMA_FACTORY_SEEDED_HISTORY_IDS = [
  'ep-orb-s1e1',
  'vod-tears-of-steel',
  'ch-redbull-tv',
] as const;

const GENERIC_PLAYLIST_NAMES = new Set([
  '',
  'xtream codes server',
  'm3u_plus playlist',
  'm3u playlist',
  'iptv playlist',
  'playlist',
]);

/**
 * Built-in dedicated Luma TV Cloud Sync Firebase configuration (Europe eur3).
 * Firebase Web API keys are public project identifiers; data access is strictly gated by
 * Firebase Auth JWTs (`request.auth.uid == userId`) AND client-side AES-256-GCM encryption.
 */
export const LUMA_DEFAULT_FIREBASE_CONFIG: FirebaseOptions = {
  apiKey: 'AIzaSyAPSfo-WtZkZ6wZ_4eeDSVfffHKP5i0Iz0',
  authDomain: 'luma-tv-sync-eu.firebaseapp.com',
  projectId: 'luma-tv-sync-eu',
  storageBucket: 'luma-tv-sync-eu.firebasestorage.app',
  messagingSenderId: '1047363615006',
  appId: '1:1047363615006:web:738a5c2075c4b6faceb10f',
};

export function createEmptySyncMetadata(revision = 0): EncryptedSyncMetadataV3 {
  return {
    revision,
    fieldUpdatedAt: {},
    itemUpdatedAt: {},
    tombstones: {},
  };
}

/**
 * Normalizes a playlist URL or server origin so equivalent URLs (different casing,
 * trailing slashes, default `:80`/`:443` ports, or reordered query params) match deterministically.
 */
export function normalizePlaylistServerOrUrl(
  rawUrl: string,
  options?: { stripXtreamApiPath?: boolean; ignoreM3uOutputVariant?: boolean }
): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed || trimmed === 'local://m3u') {
    return 'local://m3u';
  }

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : trimmed.includes('.') || trimmed.includes(':') || trimmed.startsWith('localhost')
      ? `http://${trimmed}`
      : trimmed;

  try {
    const parsed = new URL(withScheme);
    const protocol = parsed.protocol.toLowerCase();
    const hostname = parsed.hostname.toLowerCase();
    const isDefaultPort =
      (protocol === 'http:' && parsed.port === '80') ||
      (protocol === 'https:' && parsed.port === '443');
    const portPart = parsed.port && !isDefaultPort ? `:${parsed.port}` : '';

    let pathname = parsed.pathname.replace(/\/{2,}/g, '/');
    if (options?.stripXtreamApiPath) {
      pathname = pathname.replace(/\/(player_api|get|xmltv)\.php$/i, '');
    }
    if (pathname.length > 1) {
      pathname = pathname.replace(/\/+$/, '');
    }
    const cleanPath = pathname === '/' ? '' : pathname;

    if (options?.stripXtreamApiPath) {
      return `${protocol}//${hostname}${portPart}${cleanPath}`;
    }

    const entries = Array.from(parsed.searchParams.entries()).filter(([k]) => {
      if (!options?.ignoreM3uOutputVariant) return true;
      const lowerKey = k.toLowerCase();
      return lowerKey !== 'output' && lowerKey !== 'type';
    });

    entries.sort(([ka, va], [kb, vb]) => {
      const cmpKey = ka.localeCompare(kb);
      return cmpKey !== 0 ? cmpKey : va.localeCompare(vb);
    });

    const queryString =
      entries.length > 0
        ? `?${entries
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
            .join('&')}`
        : '';

    return `${protocol}//${hostname}${portPart}${cleanPath}${queryString}`;
  } catch {
    return trimmed.toLowerCase().replace(/\/+$/, '');
  }
}

/**
 * Computes a canonical identity key for a playlist based on its type, normalized URL/server,
 * and credentials so identical playlists across devices never create duplicate entries.
 */
export function computePlaylistCanonicalKey(
  source: Pick<
    SyncedPlaylistSource,
    'type' | 'rawUrlOrHost' | 'endpoint' | 'username' | 'name'
  >
): string {
  const raw = (source.rawUrlOrHost || source.endpoint || '').trim();

  if (source.type === 'xtream') {
    const normalizedBase = normalizePlaylistServerOrUrl(raw, {
      stripXtreamApiPath: true,
    });
    const normalizedUser = (source.username ?? '').trim().toLowerCase();
    return `xtream:${normalizedBase}|user:${normalizedUser}`;
  }

  if (/^https?:\/\//i.test(raw) || /^https?:\/\//i.test(source.endpoint || '')) {
    const targetUrl = /^https?:\/\//i.test(raw) ? raw : source.endpoint;
    const isXtreamM3uGetPhp =
      /\/get\.php\b/i.test(targetUrl) && /[?&]username=/i.test(targetUrl);
    const normalizedUrl = normalizePlaylistServerOrUrl(targetUrl, {
      ignoreM3uOutputVariant: isXtreamM3uGetPhp,
    });
    return `m3u:${normalizedUrl}`;
  }

  const normName = (source.name || '').trim().toLowerCase();
  const normEndpoint = (source.endpoint || raw || 'local://m3u').trim().toLowerCase();
  return `local:${normName}|${normEndpoint}`;
}

function normalizeSortedUniqueStrings(values?: readonly string[]): string[] {
  if (!values || values.length === 0) return [];
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean))).sort();
}

function normalizeUniquePreserveOrder(values?: readonly string[]): string[] {
  if (!values || values.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = raw.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * Compares both canonical playlist URLs and playlist settings (`username`, `password`,
 * `outputFormat`, `xmltvUrl`, `epgOffsetHours`, `hiddenGroupIds`, `name`).
 */
export function arePlaylistSettingsEquivalent(
  a: SyncedPlaylistSource,
  b: SyncedPlaylistSource
): boolean {
  if (computePlaylistCanonicalKey(a) !== computePlaylistCanonicalKey(b)) {
    return false;
  }
  const normXmltvA = a.xmltvUrl ? normalizePlaylistServerOrUrl(a.xmltvUrl) : '';
  const normXmltvB = b.xmltvUrl ? normalizePlaylistServerOrUrl(b.xmltvUrl) : '';
  const hiddenA = normalizeSortedUniqueStrings(a.hiddenGroupIds);
  const hiddenB = normalizeSortedUniqueStrings(b.hiddenGroupIds);

  const normUrlA = normalizePlaylistServerOrUrl(a.rawUrlOrHost, {
    stripXtreamApiPath: a.type === 'xtream',
  });
  const normUrlB = normalizePlaylistServerOrUrl(b.rawUrlOrHost, {
    stripXtreamApiPath: b.type === 'xtream',
  });
  const normUserA =
    a.type === 'xtream'
      ? (a.username ?? '').trim().toLowerCase()
      : (a.username ?? '').trim();
  const normUserB =
    b.type === 'xtream'
      ? (b.username ?? '').trim().toLowerCase()
      : (b.username ?? '').trim();

  return (
    a.name.trim() === b.name.trim() &&
    normUrlA === normUrlB &&
    normUserA === normUserB &&
    (a.password ?? '') === (b.password ?? '') &&
    (a.outputFormat ?? 'm3u8') === (b.outputFormat ?? 'm3u8') &&
    normXmltvA === normXmltvB &&
    (a.epgOffsetHours ?? 0) === (b.epgOffsetHours ?? 0) &&
    hiddenA.length === hiddenB.length &&
    hiddenA.every((g, idx) => g === hiddenB[idx])
  );
}

function isGenericPlaylistName(name: string): boolean {
  return GENERIC_PLAYLIST_NAMES.has(name.trim().toLowerCase());
}

function mergeTwoPlaylistEntries(params: {
  canonicalId: string;
  local?: SyncedPlaylistSource;
  remote?: SyncedPlaylistSource;
  base?: SyncedPlaylistSource;
  localUpdatedAt: number;
  remoteUpdatedAt: number;
  isFirstTimeMerge: boolean;
}): SyncedPlaylistSource {
  const {
    canonicalId,
    local,
    remote,
    base,
    localUpdatedAt,
    remoteUpdatedAt,
    isFirstTimeMerge,
  } = params;

  if (!local && remote) {
    return { ...remote, id: canonicalId };
  }
  if (local && !remote) {
    return { ...local, id: canonicalId };
  }
  const l = local!;
  const r = remote!;
  const localWinsTies = localUpdatedAt > remoteUpdatedAt;
  const primary = localWinsTies ? l : r;
  const secondary = localWinsTies ? r : l;

  const pick3Way = <T>(
    lVal: T,
    rVal: T,
    bVal: T | undefined,
    eq: (x: T, y: T) => boolean = (x, y) => x === y
  ): T => {
    if (eq(lVal, rVal)) return rVal;
    if (bVal !== undefined && !isFirstTimeMerge) {
      const lChanged = !eq(lVal, bVal);
      const rChanged = !eq(rVal, bVal);
      if (lChanged && !rChanged) return lVal;
      if (!lChanged && rChanged) return rVal;
    }
    return localWinsTies ? lVal : rVal;
  };

  let mergedName: string;
  const lGeneric = isGenericPlaylistName(l.name);
  const rGeneric = isGenericPlaylistName(r.name);
  if (lGeneric && !rGeneric) {
    mergedName = r.name.trim();
  } else if (!lGeneric && rGeneric) {
    mergedName = l.name.trim();
  } else {
    mergedName = pick3Way(l.name.trim(), r.name.trim(), base?.name?.trim());
  }

  const mergedRawUrl = pick3Way(
    l.rawUrlOrHost.trim(),
    r.rawUrlOrHost.trim(),
    base?.rawUrlOrHost?.trim()
  );
  const mergedEndpoint = pick3Way(
    l.endpoint.trim(),
    r.endpoint.trim(),
    base?.endpoint?.trim()
  );
  const mergedUsername =
    pick3Way(
      (l.username ?? '').trim(),
      (r.username ?? '').trim(),
      base?.username?.trim()
    ) || undefined;
  const mergedPassword =
    pick3Way(l.password ?? '', r.password ?? '', base?.password ?? '') ||
    (primary.password || secondary.password || undefined);

  const mergedFormat = isFirstTimeMerge
    ? (l.outputFormat && l.outputFormat !== 'm3u8'
        ? l.outputFormat
        : r.outputFormat) ?? 'm3u8'
    : pick3Way(
        l.outputFormat ?? 'm3u8',
        r.outputFormat ?? 'm3u8',
        base?.outputFormat ?? 'm3u8'
      );

  const lXml = l.xmltvUrl?.trim() || '';
  const rXml = r.xmltvUrl?.trim() || '';
  const mergedXmltv =
    (isFirstTimeMerge
      ? (localWinsTies ? lXml || rXml : rXml || lXml)
      : pick3Way(lXml, rXml, base?.xmltvUrl?.trim() ?? '')) || undefined;

  const lOffset = l.epgOffsetHours ?? 0;
  const rOffset = r.epgOffsetHours ?? 0;
  const mergedOffset = isFirstTimeMerge
    ? lOffset !== 0 && rOffset === 0
      ? lOffset
      : rOffset !== 0 && lOffset === 0
        ? rOffset
        : localWinsTies
          ? lOffset
          : rOffset
    : pick3Way(lOffset, rOffset, base?.epgOffsetHours ?? 0);

  let mergedHiddenGroups: string[];
  if (isFirstTimeMerge || !base) {
    mergedHiddenGroups = normalizeUniquePreserveOrder([
      ...(r.hiddenGroupIds ?? []),
      ...(l.hiddenGroupIds ?? []),
    ]);
  } else {
    const baseSet = new Set(base.hiddenGroupIds ?? []);
    const lSet = new Set(l.hiddenGroupIds ?? []);
    const rSet = new Set(r.hiddenGroupIds ?? []);
    const result = new Set<string>(baseSet);
    for (const g of lSet) {
      if (!baseSet.has(g)) result.add(g);
    }
    for (const g of rSet) {
      if (!baseSet.has(g)) result.add(g);
    }
    for (const g of baseSet) {
      if (!lSet.has(g) || !rSet.has(g)) {
        result.delete(g);
      }
    }
    mergedHiddenGroups = Array.from(result);
  }

  const createdCandidates = [l.createdAt, r.createdAt].filter(
    (n): n is number => typeof n === 'number' && n > 0
  );
  const mergedCreatedAt =
    createdCandidates.length > 0 ? Math.min(...createdCandidates) : Date.now();
  const mergedUpdatedAt =
    Math.max(
      localUpdatedAt,
      remoteUpdatedAt,
      l.updatedAt ?? 0,
      r.updatedAt ?? 0,
      mergedCreatedAt
    ) || Date.now();

  return {
    id: canonicalId,
    name: mergedName || primary.name,
    type: r.type || l.type,
    endpoint: mergedEndpoint || primary.endpoint,
    rawUrlOrHost: mergedRawUrl || primary.rawUrlOrHost,
    ...(mergedUsername ? { username: mergedUsername } : {}),
    ...(mergedPassword ? { password: mergedPassword } : {}),
    ...(mergedFormat ? { outputFormat: mergedFormat } : {}),
    ...(mergedXmltv ? { xmltvUrl: mergedXmltv } : {}),
    hiddenGroupIds: mergedHiddenGroups,
    epgOffsetHours: mergedOffset,
    createdAt: mergedCreatedAt,
    updatedAt: mergedUpdatedAt,
  };
}

/**
 * Deduplicates a single list of playlists by canonical URL & credentials, merging settings
 * and returning a `sourceIdRemap` from duplicate IDs to the winning canonical ID.
 */
export function deduplicatePlaylistsWithSettings(
  playlists: readonly SyncedPlaylistSource[],
  preferredCanonicalIds?: ReadonlySet<string>
): {
  playlists: SyncedPlaylistSource[];
  sourceIdRemap: Map<string, string>;
} {
  const byKey = new Map<string, SyncedPlaylistSource>();
  const sourceIdRemap = new Map<string, string>();

  for (const pl of playlists) {
    const key = computePlaylistCanonicalKey(pl);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        ...pl,
        hiddenGroupIds: normalizeUniquePreserveOrder(pl.hiddenGroupIds),
      });
      continue;
    }

    const preferIncomingId =
      Boolean(preferredCanonicalIds?.has(pl.id)) &&
      !preferredCanonicalIds?.has(existing.id);
    const canonicalId = preferIncomingId ? pl.id : existing.id;
    const loserId = preferIncomingId ? existing.id : pl.id;
    if (loserId !== canonicalId) {
      sourceIdRemap.set(loserId, canonicalId);
    }

    const merged = mergeTwoPlaylistEntries({
      canonicalId,
      local: pl,
      remote: existing,
      localUpdatedAt: pl.updatedAt ?? pl.createdAt ?? 0,
      remoteUpdatedAt: existing.updatedAt ?? existing.createdAt ?? 0,
      isFirstTimeMerge: true,
    });
    byKey.set(key, merged);
  }

  return {
    playlists: Array.from(byKey.values()),
    sourceIdRemap,
  };
}

/**
 * Rewrites any source-prefixed item ID (`${oldSourceId}-xt-123`, `${oldSourceId}-ch-5`,
 * `${oldSourceId}-xvod-9`, `${oldSourceId}-xser-4-s1e2`, or `${oldSourceId}`) using `sourceIdRemap`.
 */
export function remapEntityIdWithSourceMap(
  id: string,
  sourceIdRemap: ReadonlyMap<string, string>
): string {
  if (!id || sourceIdRemap.size === 0) return id;
  const direct = sourceIdRemap.get(id);
  if (direct) return direct;

  for (const [oldSourceId, newSourceId] of sourceIdRemap.entries()) {
    if (!oldSourceId || oldSourceId === newSourceId) continue;
    if (id.startsWith(`${oldSourceId}-`)) {
      return `${newSourceId}-${id.slice(oldSourceId.length + 1)}`;
    }
    if (id.startsWith(`${oldSourceId}:`)) {
      return `${newSourceId}:${id.slice(oldSourceId.length + 1)}`;
    }
  }
  return id;
}

/**
 * Remaps all channel, VOD, series, collection, reminder, history, multiview, startup,
 * and active source IDs in a sync payload when duplicate playlists are consolidated.
 */
export function remapPayloadSourceIds(
  payload: LumaSyncPlainPayload,
  sourceIdRemap: ReadonlyMap<string, string>
): LumaSyncPlainPayload {
  if (sourceIdRemap.size === 0) return payload;

  const remapList = (list?: readonly string[]) =>
    normalizeUniquePreserveOrder(
      (list ?? []).map((id) => remapEntityIdWithSourceMap(id, sourceIdRemap))
    );

  const remappedBouquets: CustomBouquet[] | undefined = payload.customBouquets?.map(
    (bq) => ({
      ...bq,
      channelIds: remapList(bq.channelIds),
      ...(bq.vodIds ? { vodIds: remapList(bq.vodIds) } : {}),
      ...(bq.seriesIds ? { seriesIds: remapList(bq.seriesIds) } : {}),
    })
  );

  const historyByItem = new Map<string, WatchHistoryEntry>();
  for (const entry of payload.watchHistory ?? []) {
    const itemId = remapEntityIdWithSourceMap(entry.itemId, sourceIdRemap);
    const existing = historyByItem.get(itemId);
    if (!existing || entry.updatedAt > existing.updatedAt) {
      historyByItem.set(itemId, { ...entry, itemId });
    }
  }
  const remappedHistory = Array.from(historyByItem.values()).sort(
    (a, b) => b.updatedAt - a.updatedAt
  );

  const remappedReminders = payload.reminders?.map((rem) => ({
    ...rem,
    programId: remapEntityIdWithSourceMap(rem.programId, sourceIdRemap),
    channelId: remapEntityIdWithSourceMap(rem.channelId, sourceIdRemap),
  }));

  const remappedDual: [string, string] | undefined = payload.dualSlotIds
    ? [
        remapEntityIdWithSourceMap(payload.dualSlotIds[0], sourceIdRemap),
        remapEntityIdWithSourceMap(payload.dualSlotIds[1], sourceIdRemap),
      ]
    : undefined;

  const remappedMulti = payload.multiviewSlotIds?.map((id) =>
    remapEntityIdWithSourceMap(id, sourceIdRemap)
  );

  const remappedPrefs: LumaPreferences | undefined = payload.preferences
    ? {
        ...payload.preferences,
        startupChannelId: payload.preferences.startupChannelId
          ? remapEntityIdWithSourceMap(
              payload.preferences.startupChannelId,
              sourceIdRemap
            )
          : payload.preferences.startupChannelId,
      }
    : undefined;

  const remappedActiveSource = payload.activeSourceId
    ? remapEntityIdWithSourceMap(payload.activeSourceId, sourceIdRemap)
    : payload.activeSourceId;

  return {
    ...payload,
    favorites: remapList(payload.favorites),
    ...(payload.favoriteVodIds
      ? { favoriteVodIds: remapList(payload.favoriteVodIds) }
      : {}),
    ...(payload.favoriteSeriesIds
      ? { favoriteSeriesIds: remapList(payload.favoriteSeriesIds) }
      : {}),
    ...(remappedBouquets ? { customBouquets: remappedBouquets } : {}),
    watchHistory: remappedHistory,
    ...(remappedReminders ? { reminders: remappedReminders } : {}),
    ...(remappedPrefs ? { preferences: remappedPrefs } : {}),
    ...(remappedDual ? { dualSlotIds: remappedDual } : {}),
    ...(remappedMulti ? { multiviewSlotIds: remappedMulti } : {}),
    ...(remappedActiveSource ? { activeSourceId: remappedActiveSource } : {}),
  };
}

function isFactoryDefaultBouquetsOnly(bouquets?: readonly CustomBouquet[]): boolean {
  if (!bouquets || bouquets.length === 0) return true;
  if (bouquets.length !== 1) return false;
  const b = bouquets[0];
  if (b.id !== 'bq-weekend-sport') return false;
  if (b.name !== 'Wochenende Live-Sport') return false;
  if (b.isPinLocked) return false;
  if ((b.vodIds?.length ?? 0) > 0 || (b.seriesIds?.length ?? 0) > 0) return false;
  const defaultCh = ['ch-redbull-tv', 'ch-mux-motorsport', 'ch-nasa-public'];
  return (
    b.channelIds.length === defaultCh.length &&
    defaultCh.every((id, i) => b.channelIds[i] === id)
  );
}

function isFactoryDefaultFavoritesOnly(favorites?: readonly string[]): boolean {
  const list = favorites ?? [];
  if (list.length !== LUMA_FACTORY_DEFAULT_FAVORITES.length) return false;
  const set = new Set(list);
  return LUMA_FACTORY_DEFAULT_FAVORITES.every((id) => set.has(id));
}

function isFactoryDefaultParentalOnly(config?: ParentalControlConfig): boolean {
  if (!config) return true;
  return (
    config.enabled === true &&
    config.pin === '0000' &&
    config.lockedGroupIds.length === 0
  );
}

function isFactoryDefaultPreferencesOnly(
  prefs?: LumaPreferences,
  hasExplicitLocalPrefs?: boolean
): boolean {
  if (hasExplicitLocalPrefs) return false;
  if (!prefs) return true;
  return (
    !prefs.startupChannelId &&
    (prefs.bufferProfile ?? 'balanced') === 'balanced' &&
    (prefs.sleepTimerMinutes ?? 0) === 0 &&
    (prefs.spatialDpadEnabled ?? true) === true &&
    Boolean(prefs.autoMiniPlayerOnSwitch ?? false) === false &&
    (prefs.autoRefreshHours ?? 12) === 12
  );
}

function isFactorySeededWatchHistoryOnly(
  history?: readonly WatchHistoryEntry[]
): boolean {
  if (!history || history.length === 0) return true;
  const seeded = new Set<string>(LUMA_FACTORY_SEEDED_HISTORY_IDS);
  return history.every((entry) => seeded.has(entry.itemId));
}

/**
 * Returns `true` when the local device only holds Luma TV's untouched factory-default
 * demo configuration (no imported playlists, no custom favorites/collections/PIN/reminders/settings).
 */
export function isDefaultOnlyLocalPayload(
  payload: LumaSyncPlainPayload,
  options?: { hasExplicitLocalPrefs?: boolean }
): boolean {
  if ((payload.playlists?.length ?? 0) > 0) return false;
  if (payload.demoSourceDeleted) return false;
  if (!isFactoryDefaultFavoritesOnly(payload.favorites)) return false;
  if ((payload.favoriteVodIds?.length ?? 0) > 0) return false;
  if ((payload.favoriteSeriesIds?.length ?? 0) > 0) return false;
  if (!isFactoryDefaultBouquetsOnly(payload.customBouquets)) return false;
  if ((payload.reminders?.length ?? 0) > 0) return false;
  if (!isFactoryDefaultParentalOnly(payload.parentalConfig)) return false;
  if ((payload.epgOffsetHours ?? 0) !== 0) return false;
  if (
    !isFactoryDefaultPreferencesOnly(
      payload.preferences,
      options?.hasExplicitLocalPrefs
    )
  ) {
    return false;
  }
  if (!isFactorySeededWatchHistoryOnly(payload.watchHistory)) return false;
  if (
    payload.activeSourceId &&
    payload.activeSourceId !== 'builtin-reference'
  ) {
    return false;
  }
  return true;
}

/**
 * Computes a deterministic canonical JSON digest of all user-facing sync state
 * (ignoring volatile `exportedAt` and playlist `updatedAt` timestamps) so Luma skips
 * redundant Firestore reads/writes when nothing meaningfully changed.
 */
export function computeSyncContentDigest(payload: LumaSyncPlainPayload): string {
  const canonicalPlaylists = (payload.playlists ?? [])
    .map((p) => ({
      key: computePlaylistCanonicalKey(p),
      id: p.id,
      name: p.name.trim(),
      type: p.type,
      rawUrlOrHost: normalizePlaylistServerOrUrl(p.rawUrlOrHost, {
        stripXtreamApiPath: p.type === 'xtream',
      }),
      username:
        p.type === 'xtream'
          ? (p.username ?? '').trim().toLowerCase()
          : (p.username ?? '').trim(),
      password: p.password ?? '',
      outputFormat: p.outputFormat ?? 'm3u8',
      xmltvUrl: p.xmltvUrl ? normalizePlaylistServerOrUrl(p.xmltvUrl) : '',
      hiddenGroupIds: normalizeSortedUniqueStrings(p.hiddenGroupIds),
      epgOffsetHours: p.epgOffsetHours ?? 0,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const canonicalBouquets = (payload.customBouquets ?? []).map((b) => ({
    id: b.id,
    name: b.name.trim(),
    isPinLocked: Boolean(b.isPinLocked),
    channelIds: normalizeUniquePreserveOrder(b.channelIds),
    vodIds: normalizeUniquePreserveOrder(b.vodIds),
    seriesIds: normalizeUniquePreserveOrder(b.seriesIds),
  }));

  const canonicalReminders = [...(payload.reminders ?? [])]
    .map((r) => ({
      programId: r.programId,
      channelId: r.channelId,
      title: r.title,
      startMs: r.startMs,
    }))
    .sort((a, b) => a.programId.localeCompare(b.programId));

  const canonicalHistory = [...(payload.watchHistory ?? [])]
    .slice(0, 24)
    .map((h) => ({
      itemId: h.itemId,
      kind: h.kind,
      resumeSec: Math.round(h.resumeSec),
      durationSec: Math.round(h.durationSec),
    }));

  const canonicalPrefs = payload.preferences
    ? {
        locale: payload.preferences.locale,
        bufferProfile: payload.preferences.bufferProfile ?? 'balanced',
        sleepTimerMinutes: payload.preferences.sleepTimerMinutes ?? 0,
        spatialDpadEnabled: payload.preferences.spatialDpadEnabled ?? true,
        autoMiniPlayerOnSwitch: Boolean(
          payload.preferences.autoMiniPlayerOnSwitch ?? false
        ),
        autoRefreshHours: payload.preferences.autoRefreshHours ?? 12,
        includeBetaUpdates: payload.preferences.includeBetaUpdates ?? true,
        autoCheckUpdates: payload.preferences.autoCheckUpdates ?? true,
        startupChannelId: payload.preferences.startupChannelId ?? null,
        startupChannelName: payload.preferences.startupChannelName ?? null,
      }
    : null;

  const canonicalParental = payload.parentalConfig
    ? {
        enabled: payload.parentalConfig.enabled,
        pin: payload.parentalConfig.pin,
        lockedGroupIds: normalizeSortedUniqueStrings(
          payload.parentalConfig.lockedGroupIds
        ),
      }
    : null;

  const tombstoneEntries = Object.entries(payload.syncMeta?.tombstones ?? {}).sort(
    ([a], [b]) => a.localeCompare(b)
  );

  return JSON.stringify({
    favorites: normalizeUniquePreserveOrder(payload.favorites),
    favoriteVodIds: normalizeUniquePreserveOrder(payload.favoriteVodIds),
    favoriteSeriesIds: normalizeUniquePreserveOrder(payload.favoriteSeriesIds),
    bouquets: canonicalBouquets,
    reminders: canonicalReminders,
    history: canonicalHistory,
    prefs: canonicalPrefs,
    parental: canonicalParental,
    epgOffsetHours: payload.epgOffsetHours ?? 0,
    preferredDesign: payload.preferredDesign,
    dualSlotIds: payload.dualSlotIds ?? null,
    multiviewSlotIds: payload.multiviewSlotIds ?? null,
    activeSourceId: payload.activeSourceId ?? 'builtin-reference',
    demoSourceDeleted: Boolean(payload.demoSourceDeleted),
    playlists: canonicalPlaylists,
    tombstones: tombstoneEntries,
  });
}

function pruneSyncMetadata(
  meta: EncryptedSyncMetadataV3,
  nowMs: number
): EncryptedSyncMetadataV3 {
  const cutoff = nowMs - TOMBSTONE_RETENTION_MS;
  const validTombstones = Object.entries(meta.tombstones)
    .filter(([, ts]) => Number.isFinite(ts) && ts >= cutoff)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TOMBSTONE_ENTRIES);

  const validUpdated = Object.entries(meta.itemUpdatedAt)
    .filter(([, ts]) => Number.isFinite(ts) && ts > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TOMBSTONE_ENTRIES * 2);

  return {
    revision: meta.revision,
    fieldUpdatedAt: { ...meta.fieldUpdatedAt },
    itemUpdatedAt: Object.fromEntries(validUpdated),
    tombstones: Object.fromEntries(validTombstones),
  };
}

function remapSyncMetaKeys(
  meta: EncryptedSyncMetadataV3,
  sourceIdRemap: ReadonlyMap<string, string>
): EncryptedSyncMetadataV3 {
  if (sourceIdRemap.size === 0) return meta;
  const remapRecord = (rec: Record<string, number>): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [fullKey, ts] of Object.entries(rec)) {
      const colonIdx = fullKey.indexOf(':');
      if (colonIdx <= 0) {
        out[fullKey] = Math.max(out[fullKey] ?? 0, ts);
        continue;
      }
      const prefix = fullKey.slice(0, colonIdx);
      const rawId = fullKey.slice(colonIdx + 1);
      const nextId =
        prefix === 'pl' ? rawId : remapEntityIdWithSourceMap(rawId, sourceIdRemap);
      const mappedKey = `${prefix}:${nextId}`;
      out[mappedKey] = Math.max(out[mappedKey] ?? 0, ts);
    }
    return out;
  };

  return {
    revision: meta.revision,
    fieldUpdatedAt: { ...meta.fieldUpdatedAt },
    itemUpdatedAt: remapRecord(meta.itemUpdatedAt),
    tombstones: remapRecord(meta.tombstones),
  };
}

function stripPayloadBaseSnapshot(
  payload: LumaSyncPlainPayload
): LumaSyncPlainPayload {
  const { syncMeta, ...rest } = payload;
  return {
    ...rest,
    schemaVersion: 3,
    watchHistory: (rest.watchHistory ?? []).slice(0, 24),
    syncMeta: syncMeta
      ? {
          revision: syncMeta.revision,
          fieldUpdatedAt: { ...syncMeta.fieldUpdatedAt },
          itemUpdatedAt: {},
          tombstones: { ...syncMeta.tombstones },
        }
      : undefined,
  };
}

export function loadDeviceCloudSyncState(uid: string): DeviceCloudSyncStateV3 | null {
  if (!uid) return null;
  try {
    const raw = localStorage.getItem(`${DEVICE_SYNC_STATE_PREFIX}${uid}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DeviceCloudSyncStateV3>;
    if (parsed.uid !== uid) return null;
    return {
      uid,
      hasCompletedInitialSync: Boolean(parsed.hasCompletedInitialSync),
      lastSyncedDigest: parsed.lastSyncedDigest ?? '',
      lastRemoteUpdatedAt: parsed.lastRemoteUpdatedAt ?? 0,
      basePayload: parsed.basePayload ?? null,
      localMeta: parsed.localMeta ?? createEmptySyncMetadata(),
    };
  } catch {
    return null;
  }
}

export function saveDeviceCloudSyncState(
  uid: string,
  state: DeviceCloudSyncStateV3
): void {
  if (!uid) return;
  try {
    const compact: DeviceCloudSyncStateV3 = {
      ...state,
      basePayload: state.basePayload
        ? stripPayloadBaseSnapshot(state.basePayload)
        : null,
      localMeta: pruneSyncMetadata(state.localMeta, Date.now()),
    };
    localStorage.setItem(
      `${DEVICE_SYNC_STATE_PREFIX}${uid}`,
      JSON.stringify(compact)
    );
  } catch {
    // Ignore localStorage quota issues
  }
}

/**
 * Records a local user mutation timestamp or deletion tombstone so incremental sync
 * deterministically propagates additions, updates, and deletions across devices.
 */
export function recordLocalSyncMutation(
  uid: string | null | undefined,
  mutation: {
    updatedKeys?: string[];
    tombstonedKeys?: string[];
    scalarFields?: SyncScalarField[];
    nowMs?: number;
  }
): void {
  if (!uid) return;
  const now = mutation.nowMs ?? Date.now();
  const existing = loadDeviceCloudSyncState(uid) ?? {
    uid,
    hasCompletedInitialSync: false,
    lastSyncedDigest: '',
    lastRemoteUpdatedAt: 0,
    basePayload: null,
    localMeta: createEmptySyncMetadata(),
  };

  const nextMeta: EncryptedSyncMetadataV3 = {
    revision: existing.localMeta.revision + 1,
    fieldUpdatedAt: { ...existing.localMeta.fieldUpdatedAt },
    itemUpdatedAt: { ...existing.localMeta.itemUpdatedAt },
    tombstones: { ...existing.localMeta.tombstones },
  };

  for (const field of mutation.scalarFields ?? []) {
    nextMeta.fieldUpdatedAt[field] = now;
  }
  for (const key of mutation.updatedKeys ?? []) {
    nextMeta.itemUpdatedAt[key] = now;
    delete nextMeta.tombstones[key];
  }
  for (const key of mutation.tombstonedKeys ?? []) {
    nextMeta.tombstones[key] = now;
    delete nextMeta.itemUpdatedAt[key];
  }

  saveDeviceCloudSyncState(uid, {
    ...existing,
    localMeta: nextMeta,
  });
}

function mergeIdSetIncrementalOrInitial(params: {
  prefix: string;
  baseList?: readonly string[];
  localList?: readonly string[];
  remoteList?: readonly string[];
  localMeta: EncryptedSyncMetadataV3;
  remoteMeta: EncryptedSyncMetadataV3;
  isFirstTimeMerge: boolean;
  stripUntouchedFactoryDefaultsFromLocal?: ReadonlySet<string>;
}): string[] {
  const {
    prefix,
    baseList,
    localList,
    remoteList,
    localMeta,
    remoteMeta,
    isFirstTimeMerge,
    stripUntouchedFactoryDefaultsFromLocal,
  } = params;

  const baseSet = new Set(baseList ?? []);
  const localNorm = normalizeUniquePreserveOrder(localList);
  const remoteNorm = normalizeUniquePreserveOrder(remoteList);
  const localSet = new Set(localNorm);
  const remoteSet = new Set(remoteNorm);

  // Preserve remote ordering first, followed by newly merged local items
  const orderedCandidates = normalizeUniquePreserveOrder([
    ...remoteNorm,
    ...localNorm,
  ]);
  const out: string[] = [];

  for (const id of orderedCandidates) {
    const metaKey = `${prefix}:${id}`;
    const inLocal = localSet.has(id);
    const inRemote = remoteSet.has(id);
    const inBase = baseSet.has(id);
    const lUpdated = localMeta.itemUpdatedAt[metaKey] ?? 0;
    const rUpdated = remoteMeta.itemUpdatedAt[metaKey] ?? 0;
    const lTomb = localMeta.tombstones[metaKey] ?? 0;
    const rTomb = remoteMeta.tombstones[metaKey] ?? 0;

    if (isFirstTimeMerge) {
      if (
        inLocal &&
        !inRemote &&
        stripUntouchedFactoryDefaultsFromLocal?.has(id) &&
        lUpdated === 0
      ) {
        continue;
      }
      if (inLocal && !inRemote && rTomb > 0 && rTomb > lUpdated && lUpdated > 0) {
        continue;
      }
      out.push(id);
      continue;
    }

    if (inLocal && inRemote) {
      out.push(id);
      continue;
    }

    if (inLocal && !inRemote) {
      if (rTomb > lUpdated && (rTomb > 0 && (inBase || lUpdated > 0 || rTomb > 0))) {
        if (lUpdated === 0 || rTomb >= lUpdated) {
          continue;
        }
      }
      if (inBase && lUpdated === 0) {
        // Existed in shared base and was removed on remote
        continue;
      }
      out.push(id);
      continue;
    }

    if (!inLocal && inRemote) {
      if (lTomb > rUpdated && lTomb > 0) {
        continue;
      }
      if (inBase && rUpdated === 0) {
        // Existed in shared base and was removed locally
        continue;
      }
      out.push(id);
    }
  }

  return out;
}

function mergeCustomBouquets(params: {
  baseBouquets?: readonly CustomBouquet[];
  localBouquets?: readonly CustomBouquet[];
  remoteBouquets?: readonly CustomBouquet[];
  localMeta: EncryptedSyncMetadataV3;
  remoteMeta: EncryptedSyncMetadataV3;
  isFirstTimeMerge: boolean;
  mergedDemoDeleted: boolean;
}): CustomBouquet[] {
  const {
    baseBouquets,
    localBouquets,
    remoteBouquets,
    localMeta,
    remoteMeta,
    isFirstTimeMerge,
    mergedDemoDeleted,
  } = params;

  const normNameKey = (name: string) => name.trim().toLowerCase();

  // Align local bouquets that share the exact normalized name with an existing remote bouquet
  // so two devices creating "Italian" or "Sports" independently merge into one collection.
  const remoteList = [...(remoteBouquets ?? [])];
  const remoteByName = new Map<string, CustomBouquet>();
  const remoteById = new Map<string, CustomBouquet>();
  for (const rb of remoteList) {
    remoteById.set(rb.id, rb);
    remoteByName.set(normNameKey(rb.name), rb);
  }

  const alignedLocalList: CustomBouquet[] = (localBouquets ?? []).map((lb) => {
    if (remoteById.has(lb.id)) return lb;
    const sameNameRemote = remoteByName.get(normNameKey(lb.name));
    if (sameNameRemote) {
      return { ...lb, id: sameNameRemote.id };
    }
    return lb;
  });

  const localById = new Map<string, CustomBouquet>();
  for (const lb of alignedLocalList) {
    const existing = localById.get(lb.id);
    if (!existing) {
      localById.set(lb.id, lb);
    } else {
      localById.set(lb.id, {
        ...existing,
        channelIds: normalizeUniquePreserveOrder([
          ...existing.channelIds,
          ...lb.channelIds,
        ]),
        vodIds: normalizeUniquePreserveOrder([
          ...(existing.vodIds ?? []),
          ...(lb.vodIds ?? []),
        ]),
        seriesIds: normalizeUniquePreserveOrder([
          ...(existing.seriesIds ?? []),
          ...(lb.seriesIds ?? []),
        ]),
      });
    }
  }

  const baseById = new Map((baseBouquets ?? []).map((b) => [b.id, b]));
  const allIds = normalizeUniquePreserveOrder([
    ...remoteList.map((b) => b.id),
    ...Array.from(localById.keys()),
  ]);

  const merged: CustomBouquet[] = [];
  for (const id of allIds) {
    const lb = localById.get(id);
    const rb = remoteById.get(id);
    const bb = baseById.get(id);
    const metaKey = `bq:${id}`;
    const lUpdated = localMeta.itemUpdatedAt[metaKey] ?? 0;
    const rUpdated = remoteMeta.itemUpdatedAt[metaKey] ?? 0;
    const lTomb = localMeta.tombstones[metaKey] ?? 0;
    const rTomb = remoteMeta.tombstones[metaKey] ?? 0;

    // Strip untouched factory demo bouquet if demo source was deleted or remote already deleted it
    if (id === 'bq-weekend-sport') {
      if (mergedDemoDeleted && lUpdated === 0 && rUpdated === 0) {
        continue;
      }
      if (
        isFirstTimeMerge &&
        lb &&
        !rb &&
        isFactoryDefaultBouquetsOnly([lb]) &&
        lUpdated === 0
      ) {
        continue;
      }
    }

    if (lb && !rb) {
      if (!isFirstTimeMerge) {
        if (rTomb > lUpdated && rTomb > 0) continue;
        if (bb && lUpdated === 0) continue;
      }
      merged.push({
        ...lb,
        channelIds: normalizeUniquePreserveOrder(lb.channelIds),
        ...(lb.vodIds ? { vodIds: normalizeUniquePreserveOrder(lb.vodIds) } : {}),
        ...(lb.seriesIds
          ? { seriesIds: normalizeUniquePreserveOrder(lb.seriesIds) }
          : {}),
      });
      continue;
    }

    if (!lb && rb) {
      if (!isFirstTimeMerge) {
        if (lTomb > rUpdated && lTomb > 0) continue;
        if (bb && rUpdated === 0) continue;
      }
      merged.push({
        ...rb,
        channelIds: normalizeUniquePreserveOrder(rb.channelIds),
        ...(rb.vodIds ? { vodIds: normalizeUniquePreserveOrder(rb.vodIds) } : {}),
        ...(rb.seriesIds
          ? { seriesIds: normalizeUniquePreserveOrder(rb.seriesIds) }
          : {}),
      });
      continue;
    }

    if (lb && rb) {
      const localNewer = lUpdated > rUpdated;
      const mergeMemberIds = (
        lIds?: readonly string[],
        rIds?: readonly string[],
        bIds?: readonly string[]
      ): string[] => {
        if (isFirstTimeMerge || !bb) {
          return normalizeUniquePreserveOrder([...(rIds ?? []), ...(lIds ?? [])]);
        }
        const bSet = new Set(bIds ?? []);
        const lSet = new Set(lIds ?? []);
        const rSet = new Set(rIds ?? []);
        const ordered = normalizeUniquePreserveOrder([
          ...(rIds ?? []),
          ...(lIds ?? []),
        ]);
        return ordered.filter((itemId) => {
          const inL = lSet.has(itemId);
          const inR = rSet.has(itemId);
          const inB = bSet.has(itemId);
          if (inL && inR) return true;
          if (!inB) return true; // Added on either local or remote
          return false; // Was in base and removed on either local or remote
        });
      };

      const name =
        !isFirstTimeMerge && bb
          ? lb.name !== bb.name && rb.name === bb.name
            ? lb.name
            : rb.name !== bb.name && lb.name === bb.name
              ? rb.name
              : localNewer
                ? lb.name
                : rb.name
          : localNewer
            ? lb.name
            : rb.name;

      const isPinLocked =
        !isFirstTimeMerge && bb
          ? lb.isPinLocked !== bb.isPinLocked && rb.isPinLocked === bb.isPinLocked
            ? lb.isPinLocked
            : rb.isPinLocked !== bb.isPinLocked && lb.isPinLocked === bb.isPinLocked
              ? rb.isPinLocked
              : localNewer
                ? lb.isPinLocked
                : rb.isPinLocked
          : Boolean(lb.isPinLocked || rb.isPinLocked);

      const channelIds = mergeMemberIds(lb.channelIds, rb.channelIds, bb?.channelIds);
      const vodIds = mergeMemberIds(lb.vodIds, rb.vodIds, bb?.vodIds);
      const seriesIds = mergeMemberIds(lb.seriesIds, rb.seriesIds, bb?.seriesIds);

      merged.push({
        id,
        name,
        isPinLocked,
        channelIds,
        ...(vodIds.length > 0 || lb.vodIds || rb.vodIds ? { vodIds } : {}),
        ...(seriesIds.length > 0 || lb.seriesIds || rb.seriesIds
          ? { seriesIds }
          : {}),
      });
    }
  }

  return merged;
}

function mergePreferences(params: {
  basePrefs?: LumaPreferences;
  localPrefs?: LumaPreferences;
  remotePrefs?: LumaPreferences;
  localUpdatedAt: number;
  remoteUpdatedAt: number;
  isFirstTimeMerge: boolean;
  hasExplicitLocalPrefs?: boolean;
}): LumaPreferences | undefined {
  const {
    basePrefs,
    localPrefs,
    remotePrefs,
    localUpdatedAt,
    remoteUpdatedAt,
    isFirstTimeMerge,
    hasExplicitLocalPrefs,
  } = params;

  if (!localPrefs && !remotePrefs) return undefined;
  if (!localPrefs) return remotePrefs;
  if (!remotePrefs) return localPrefs;

  const localNewer = localUpdatedAt > remoteUpdatedAt;

  const pickProp = <K extends keyof LumaPreferences>(
    key: K,
    defaultValue: LumaPreferences[K]
  ): LumaPreferences[K] => {
    const lVal = localPrefs[key] ?? defaultValue;
    const rVal = remotePrefs[key] ?? defaultValue;
    if (lVal === rVal) return rVal;

    if (isFirstTimeMerge) {
      if (key === 'locale' && !hasExplicitLocalPrefs) {
        return rVal;
      }
      const lIsDefault = lVal === defaultValue;
      const rIsDefault = rVal === defaultValue;
      if (!lIsDefault && rIsDefault) return lVal;
      if (lIsDefault && !rIsDefault) return rVal;
      return localNewer ? lVal : rVal;
    }

    if (basePrefs) {
      const bVal = basePrefs[key] ?? defaultValue;
      const lChanged = lVal !== bVal;
      const rChanged = rVal !== bVal;
      if (lChanged && !rChanged) return lVal;
      if (!lChanged && rChanged) return rVal;
    }
    return localNewer ? lVal : rVal;
  };

  const startupChannelId = pickProp('startupChannelId', null);
  const startupChannelName =
    startupChannelId === (localPrefs.startupChannelId ?? null) &&
    startupChannelId !== (remotePrefs.startupChannelId ?? null)
      ? (localPrefs.startupChannelName ?? null)
      : startupChannelId === (remotePrefs.startupChannelId ?? null)
        ? (remotePrefs.startupChannelName ?? localPrefs.startupChannelName ?? null)
        : pickProp('startupChannelName', null);

  return {
    locale: pickProp('locale', 'en'),
    bufferProfile: pickProp('bufferProfile', 'balanced'),
    sleepTimerMinutes: pickProp('sleepTimerMinutes', 0),
    spatialDpadEnabled: pickProp('spatialDpadEnabled', true),
    autoMiniPlayerOnSwitch: pickProp('autoMiniPlayerOnSwitch', false),
    autoRefreshHours: pickProp('autoRefreshHours', 12),
    includeBetaUpdates: pickProp('includeBetaUpdates', true),
    autoCheckUpdates: pickProp('autoCheckUpdates', true),
    startupChannelId,
    startupChannelName,
  };
}

function mergeParentalConfig(params: {
  baseParental?: ParentalControlConfig;
  localParental?: ParentalControlConfig;
  remoteParental?: ParentalControlConfig;
  localUpdatedAt: number;
  remoteUpdatedAt: number;
  isFirstTimeMerge: boolean;
}): ParentalControlConfig | undefined {
  const {
    baseParental,
    localParental,
    remoteParental,
    localUpdatedAt,
    remoteUpdatedAt,
    isFirstTimeMerge,
  } = params;

  if (!localParental && !remoteParental) return undefined;
  if (!localParental) return remoteParental;
  if (!remoteParental) return localParental;

  if (isFirstTimeMerge) {
    const lDefault = isFactoryDefaultParentalOnly(localParental);
    const rDefault = isFactoryDefaultParentalOnly(remoteParental);
    if (lDefault && !rDefault) return remoteParental;
    if (!lDefault && rDefault) return localParental;
    return {
      enabled:
        localUpdatedAt > remoteUpdatedAt
          ? localParental.enabled
          : remoteParental.enabled,
      pin:
        localParental.pin !== '0000' && remoteParental.pin === '0000'
          ? localParental.pin
          : remoteParental.pin !== '0000' && localParental.pin === '0000'
            ? remoteParental.pin
            : localUpdatedAt > remoteUpdatedAt
              ? localParental.pin
              : remoteParental.pin,
      lockedGroupIds: normalizeUniquePreserveOrder([
        ...remoteParental.lockedGroupIds,
        ...localParental.lockedGroupIds,
      ]),
    };
  }

  const localNewer = localUpdatedAt > remoteUpdatedAt;
  if (baseParental) {
    const sameParental = (a: ParentalControlConfig, b: ParentalControlConfig) =>
      a.enabled === b.enabled &&
      a.pin === b.pin &&
      normalizeSortedUniqueStrings(a.lockedGroupIds).join('|') ===
        normalizeSortedUniqueStrings(b.lockedGroupIds).join('|');
    const lChanged = !sameParental(localParental, baseParental);
    const rChanged = !sameParental(remoteParental, baseParental);
    if (lChanged && !rChanged) return localParental;
    if (!lChanged && rChanged) return remoteParental;
  }
  return localNewer ? localParental : remoteParental;
}

/**
 * Core deterministic Cloud Sync reconciliation engine supporting:
 * 1. First-time sync on default-only local device -> cleanly adopts remote cloud config.
 * 2. First-time sync on configured local device -> diffs & merges local + cloud without
 *    duplicating playlists (comparing canonical URLs & settings and remapping item IDs).
 * 3. True 3-way + tombstone incremental sync -> propagates additions, updates, and deletions
 *    across devices while skipping no-op writes.
 */
export function reconcileCloudSyncPayloads(params: {
  uid?: string;
  local: LumaSyncPlainPayload;
  remote: LumaSyncPlainPayload | null;
  deviceSyncState: DeviceCloudSyncStateV3 | null;
  remoteUpdatedAtMs?: number;
  isLocalAppleDevice?: boolean;
  hasExplicitLocalPrefs?: boolean;
  nowMs?: number;
}): CloudSyncReconcileResult {
  const nowMs = params.nowMs ?? Date.now();
  const uid = params.uid ?? params.deviceSyncState?.uid ?? 'local';
  const localMetaRaw =
    params.deviceSyncState?.localMeta ??
    params.local.syncMeta ??
    createEmptySyncMetadata();
  const hasCompletedInitialSync = Boolean(
    params.deviceSyncState?.hasCompletedInitialSync
  );

  // Deduplicate local playlists internally first in case local DB had duplicate rows
  const localDedup = deduplicatePlaylistsWithSettings(params.local.playlists ?? []);
  const cleanLocal = remapPayloadSourceIds(
    {
      ...params.local,
      playlists: localDedup.playlists,
    },
    localDedup.sourceIdRemap
  );
  const combinedSourceIdRemap = new Map<string, string>(localDedup.sourceIdRemap);
  let deduplicatedPlaylistCount = localDedup.sourceIdRemap.size;

  // Case 1: No remote cloud vault exists yet -> upload clean local configuration
  if (!params.remote) {
    const nextMeta = pruneSyncMetadata(
      {
        ...remapSyncMetaKeys(localMetaRaw, localDedup.sourceIdRemap),
        revision: Math.max(1, localMetaRaw.revision + 1),
      },
      nowMs
    );
    const initialPayload: LumaSyncPlainPayload = {
      ...cleanLocal,
      schemaVersion: 3,
      exportedAt: nowMs,
      syncMeta: nextMeta,
    };
    const digest = computeSyncContentDigest(initialPayload);
    return {
      mode: 'initial-upload',
      mergedPayload: initialPayload,
      shouldPushToCloud: true,
      shouldApplyLocally: localDedup.sourceIdRemap.size > 0,
      sourceIdRemap: combinedSourceIdRemap,
      deletedPlaylistIds: [],
      deduplicatedPlaylistCount,
      nextDeviceSyncState: {
        uid,
        hasCompletedInitialSync: true,
        lastSyncedDigest: digest,
        lastRemoteUpdatedAt: params.remoteUpdatedAtMs ?? nowMs,
        basePayload: stripPayloadBaseSnapshot(initialPayload),
        localMeta: nextMeta,
      },
      summary: 'Created initial encrypted cloud vault.',
    };
  }

  // Also deduplicate remote playlists if an older v1/v2 client uploaded duplicate entries
  const remoteDedup = deduplicatePlaylistsWithSettings(params.remote.playlists ?? []);
  deduplicatedPlaylistCount += remoteDedup.sourceIdRemap.size;
  const cleanRemote = remapPayloadSourceIds(
    {
      ...params.remote,
      playlists: remoteDedup.playlists,
    },
    remoteDedup.sourceIdRemap
  );
  const remoteMetaRaw = remapSyncMetaKeys(
    cleanRemote.syncMeta ?? createEmptySyncMetadata(),
    remoteDedup.sourceIdRemap
  );

  // Case 2: First-time sync on this device AND local only has factory-default configuration
  if (
    !hasCompletedInitialSync &&
    isDefaultOnlyLocalPayload(cleanLocal, {
      hasExplicitLocalPrefs: params.hasExplicitLocalPrefs,
    })
  ) {
    const adoptedMeta = pruneSyncMetadata(
      {
        ...remoteMetaRaw,
        revision: Math.max(1, remoteMetaRaw.revision),
      },
      nowMs
    );
    const adoptedPayload: LumaSyncPlainPayload = {
      ...cleanRemote,
      schemaVersion: 3,
      exportedAt: cleanRemote.exportedAt || nowMs,
      syncMeta: adoptedMeta,
    };
    const adoptedDigest = computeSyncContentDigest(adoptedPayload);
    const remoteRawDigest = computeSyncContentDigest({
      ...params.remote,
      schemaVersion: 3,
      syncMeta: adoptedMeta,
    });

    return {
      mode: 'adopted-remote',
      mergedPayload: adoptedPayload,
      shouldPushToCloud: remoteDedup.sourceIdRemap.size > 0 && adoptedDigest !== remoteRawDigest,
      shouldApplyLocally: true,
      sourceIdRemap: combinedSourceIdRemap,
      deletedPlaylistIds: [],
      deduplicatedPlaylistCount,
      nextDeviceSyncState: {
        uid,
        hasCompletedInitialSync: true,
        lastSyncedDigest: adoptedDigest,
        lastRemoteUpdatedAt: params.remoteUpdatedAtMs ?? cleanRemote.exportedAt ?? nowMs,
        basePayload: stripPayloadBaseSnapshot(adoptedPayload),
        localMeta: adoptedMeta,
      },
      summary: 'Synced your cloud playlists, favorites & settings to this device.',
    };
  }

  // Case 3 & 4: Either First-Time Diff Merge (non-default local vs cloud) OR Incremental 3-Way Merge
  const isFirstTimeMerge = !hasCompletedInitialSync;
  const basePayload = isFirstTimeMerge
    ? null
    : (params.deviceSyncState?.basePayload ?? null);

  const localByCanon = new Map<string, SyncedPlaylistSource>();
  for (const lp of cleanLocal.playlists ?? []) {
    localByCanon.set(computePlaylistCanonicalKey(lp), lp);
  }
  const remoteByCanon = new Map<string, SyncedPlaylistSource>();
  for (const rp of cleanRemote.playlists ?? []) {
    remoteByCanon.set(computePlaylistCanonicalKey(rp), rp);
  }
  const baseByCanon = new Map<string, SyncedPlaylistSource>();
  for (const bp of basePayload?.playlists ?? []) {
    baseByCanon.set(computePlaylistCanonicalKey(bp), bp);
  }

  const allPlaylistKeys = normalizeUniquePreserveOrder([
    ...Array.from(remoteByCanon.keys()),
    ...Array.from(localByCanon.keys()),
  ]);

  const mergedPlaylists: SyncedPlaylistSource[] = [];
  const deletedPlaylistIds: string[] = [];
  const stepRemap = new Map<string, string>();

  for (const ck of allPlaylistKeys) {
    const lp = localByCanon.get(ck);
    const rp = remoteByCanon.get(ck);
    const bp = baseByCanon.get(ck);
    const metaKey = `pl:${ck}`;
    const lUpdated =
      localMetaRaw.itemUpdatedAt[metaKey] ?? lp?.updatedAt ?? lp?.createdAt ?? 0;
    const rUpdated =
      remoteMetaRaw.itemUpdatedAt[metaKey] ?? rp?.updatedAt ?? rp?.createdAt ?? 0;
    const lTomb = localMetaRaw.tombstones[metaKey] ?? 0;
    const rTomb = remoteMetaRaw.tombstones[metaKey] ?? 0;

    if (lp && rp) {
      const canonicalId = rp.id;
      if (lp.id !== canonicalId) {
        stepRemap.set(lp.id, canonicalId);
        combinedSourceIdRemap.set(lp.id, canonicalId);
        deduplicatedPlaylistCount += 1;
      }
      mergedPlaylists.push(
        mergeTwoPlaylistEntries({
          canonicalId,
          local: lp,
          remote: rp,
          base: bp,
          localUpdatedAt: lUpdated,
          remoteUpdatedAt: rUpdated,
          isFirstTimeMerge,
        })
      );
      continue;
    }

    if (lp && !rp) {
      if (!isFirstTimeMerge) {
        if ((rTomb > 0 && rTomb >= lUpdated) || (bp && lUpdated === 0)) {
          deletedPlaylistIds.push(lp.id);
          continue;
        }
      }
      mergedPlaylists.push({
        ...lp,
        hiddenGroupIds: normalizeUniquePreserveOrder(lp.hiddenGroupIds),
      });
      continue;
    }

    if (!lp && rp) {
      if (!isFirstTimeMerge) {
        if ((lTomb > 0 && lTomb >= rUpdated) || (bp && rUpdated === 0)) {
          deletedPlaylistIds.push(rp.id);
          continue;
        }
      }
      mergedPlaylists.push({
        ...rp,
        hiddenGroupIds: normalizeUniquePreserveOrder(rp.hiddenGroupIds),
      });
    }
  }

  // Remap all local & base IDs to match canonical playlist IDs before merging favorites/collections
  const alignedLocal = remapPayloadSourceIds(cleanLocal, stepRemap);
  const alignedBase = basePayload
    ? remapPayloadSourceIds(basePayload, stepRemap)
    : null;
  const localMeta = remapSyncMetaKeys(localMetaRaw, stepRemap);
  const remoteMeta = remoteMetaRaw;

  const lDemoUpdated = localMeta.fieldUpdatedAt.demoSourceDeleted ?? 0;
  const rDemoUpdated = remoteMeta.fieldUpdatedAt.demoSourceDeleted ?? 0;
  const mergedDemoDeleted = isFirstTimeMerge
    ? Boolean(alignedLocal.demoSourceDeleted || cleanRemote.demoSourceDeleted)
    : alignedBase
      ? alignedLocal.demoSourceDeleted !== alignedBase.demoSourceDeleted &&
        cleanRemote.demoSourceDeleted === alignedBase.demoSourceDeleted
        ? Boolean(alignedLocal.demoSourceDeleted)
        : cleanRemote.demoSourceDeleted !== alignedBase.demoSourceDeleted &&
            alignedLocal.demoSourceDeleted === alignedBase.demoSourceDeleted
          ? Boolean(cleanRemote.demoSourceDeleted)
          : lDemoUpdated > rDemoUpdated
            ? Boolean(alignedLocal.demoSourceDeleted)
            : Boolean(cleanRemote.demoSourceDeleted)
      : Boolean(alignedLocal.demoSourceDeleted || cleanRemote.demoSourceDeleted);

  const remoteFavSet = new Set(cleanRemote.favorites ?? []);
  const factoryDefaultsMissingFromRemote = new Set<string>(
    LUMA_FACTORY_DEFAULT_FAVORITES.filter(
      (id) => mergedDemoDeleted || !remoteFavSet.has(id)
    )
  );

  let mergedFavorites = mergeIdSetIncrementalOrInitial({
    prefix: 'fav',
    baseList: alignedBase?.favorites,
    localList: alignedLocal.favorites,
    remoteList: cleanRemote.favorites,
    localMeta,
    remoteMeta,
    isFirstTimeMerge,
    stripUntouchedFactoryDefaultsFromLocal: factoryDefaultsMissingFromRemote,
  });

  if (mergedDemoDeleted) {
    mergedFavorites = mergedFavorites.filter((id) => !id.startsWith('ch-'));
  }

  const mergedVodFavorites = mergeIdSetIncrementalOrInitial({
    prefix: 'vod',
    baseList: alignedBase?.favoriteVodIds,
    localList: alignedLocal.favoriteVodIds,
    remoteList: cleanRemote.favoriteVodIds,
    localMeta,
    remoteMeta,
    isFirstTimeMerge,
  });

  const mergedSeriesFavorites = mergeIdSetIncrementalOrInitial({
    prefix: 'ser',
    baseList: alignedBase?.favoriteSeriesIds,
    localList: alignedLocal.favoriteSeriesIds,
    remoteList: cleanRemote.favoriteSeriesIds,
    localMeta,
    remoteMeta,
    isFirstTimeMerge,
  });

  const mergedBouquets = mergeCustomBouquets({
    baseBouquets: alignedBase?.customBouquets,
    localBouquets: alignedLocal.customBouquets,
    remoteBouquets: cleanRemote.customBouquets,
    localMeta,
    remoteMeta,
    isFirstTimeMerge,
    mergedDemoDeleted,
  });

  // Merge reminders by programId
  const reminderProgramIds = mergeIdSetIncrementalOrInitial({
    prefix: 'rem',
    baseList: alignedBase?.reminders?.map((r) => r.programId),
    localList: alignedLocal.reminders?.map((r) => r.programId),
    remoteList: cleanRemote.reminders?.map((r) => r.programId),
    localMeta,
    remoteMeta,
    isFirstTimeMerge,
  });
  const reminderLookup = new Map<string, EpgReminder>();
  for (const r of cleanRemote.reminders ?? []) reminderLookup.set(r.programId, r);
  for (const r of alignedLocal.reminders ?? []) {
    if (!reminderLookup.has(r.programId)) reminderLookup.set(r.programId, r);
  }
  const mergedReminders = reminderProgramIds
    .map((pid) => reminderLookup.get(pid))
    .filter((r): r is EpgReminder => Boolean(r));

  // Merge watchHistory by itemId keeping newest resume timestamp (strip factory demo history if real history exists)
  const seededIds = new Set<string>(LUMA_FACTORY_SEEDED_HISTORY_IDS);
  const historyMap = new Map<string, WatchHistoryEntry>();
  const combinedRawHistory = [
    ...(cleanRemote.watchHistory ?? []),
    ...(alignedLocal.watchHistory ?? []),
  ];
  const hasNonSeededHistory = combinedRawHistory.some(
    (h) => !seededIds.has(h.itemId)
  );
  for (const entry of combinedRawHistory) {
    if ((mergedDemoDeleted || hasNonSeededHistory) && seededIds.has(entry.itemId)) {
      const inRemote = (cleanRemote.watchHistory ?? []).some(
        (r) => r.itemId === entry.itemId
      );
      if (!inRemote && isFirstTimeMerge) continue;
    }
    const prev = historyMap.get(entry.itemId);
    if (!prev || entry.updatedAt > prev.updatedAt) {
      historyMap.set(entry.itemId, entry);
    }
  }
  const mergedHistory = Array.from(historyMap.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 24);

  const mergedPreferences = mergePreferences({
    basePrefs: alignedBase?.preferences,
    localPrefs: alignedLocal.preferences,
    remotePrefs: cleanRemote.preferences,
    localUpdatedAt: localMeta.fieldUpdatedAt.preferences ?? 0,
    remoteUpdatedAt: remoteMeta.fieldUpdatedAt.preferences ?? 0,
    isFirstTimeMerge,
    hasExplicitLocalPrefs: params.hasExplicitLocalPrefs,
  });

  const mergedParental = mergeParentalConfig({
    baseParental: alignedBase?.parentalConfig,
    localParental: alignedLocal.parentalConfig,
    remoteParental: cleanRemote.parentalConfig,
    localUpdatedAt: localMeta.fieldUpdatedAt.parentalConfig ?? 0,
    remoteUpdatedAt: remoteMeta.fieldUpdatedAt.parentalConfig ?? 0,
    isFirstTimeMerge,
  });

  const lEpgUpdated = localMeta.fieldUpdatedAt.epgOffsetHours ?? 0;
  const rEpgUpdated = remoteMeta.fieldUpdatedAt.epgOffsetHours ?? 0;
  const mergedEpgOffset = isFirstTimeMerge
    ? alignedLocal.epgOffsetHours !== 0 && cleanRemote.epgOffsetHours === 0
      ? alignedLocal.epgOffsetHours
      : cleanRemote.epgOffsetHours !== 0 && alignedLocal.epgOffsetHours === 0
        ? cleanRemote.epgOffsetHours
        : lEpgUpdated > rEpgUpdated
          ? alignedLocal.epgOffsetHours
          : cleanRemote.epgOffsetHours
    : alignedBase &&
        alignedLocal.epgOffsetHours !== alignedBase.epgOffsetHours &&
        cleanRemote.epgOffsetHours === alignedBase.epgOffsetHours
      ? alignedLocal.epgOffsetHours
      : alignedBase &&
          cleanRemote.epgOffsetHours !== alignedBase.epgOffsetHours &&
          alignedLocal.epgOffsetHours === alignedBase.epgOffsetHours
        ? cleanRemote.epgOffsetHours
        : lEpgUpdated > rEpgUpdated
          ? alignedLocal.epgOffsetHours
          : cleanRemote.epgOffsetHours;

  // Non-Apple devices cannot select `liquid-glass`, so never let a non-Apple device overwrite
  // an Apple device's `preferredDesign` preference in the shared cloud vault.
  const mergedPreferredDesign: PlatformDesignMode = params.isLocalAppleDevice
    ? (localMeta.fieldUpdatedAt.preferredDesign ?? 0) >
      (remoteMeta.fieldUpdatedAt.preferredDesign ?? 0)
      ? alignedLocal.preferredDesign
      : cleanRemote.preferredDesign || alignedLocal.preferredDesign
    : cleanRemote.preferredDesign || alignedLocal.preferredDesign;

  // Resolve valid activeSourceId
  const validPlaylistIds = new Set(mergedPlaylists.map((p) => p.id));
  const pickValidSource = (candidate?: string): string | null => {
    if (!candidate) return null;
    if (candidate === 'builtin-reference' && !mergedDemoDeleted) return candidate;
    if (validPlaylistIds.has(candidate)) return candidate;
    return null;
  };
  const lSourceUpdated = localMeta.fieldUpdatedAt.activeSourceId ?? 0;
  const rSourceUpdated = remoteMeta.fieldUpdatedAt.activeSourceId ?? 0;
  const mergedActiveSourceId =
    (lSourceUpdated > rSourceUpdated
      ? pickValidSource(alignedLocal.activeSourceId) ??
        pickValidSource(cleanRemote.activeSourceId)
      : pickValidSource(cleanRemote.activeSourceId) ??
        pickValidSource(alignedLocal.activeSourceId)) ??
    mergedPlaylists[0]?.id ??
    (mergedDemoDeleted ? 'none' : 'builtin-reference');

  const lSlotsUpdated = localMeta.fieldUpdatedAt.dualSlotIds ?? 0;
  const rSlotsUpdated = remoteMeta.fieldUpdatedAt.dualSlotIds ?? 0;
  const mergedDualSlots =
    lSlotsUpdated > rSlotsUpdated
      ? (alignedLocal.dualSlotIds ?? cleanRemote.dualSlotIds)
      : (cleanRemote.dualSlotIds ?? alignedLocal.dualSlotIds);
  const mergedMultiviewSlots =
    (localMeta.fieldUpdatedAt.multiviewSlotIds ?? 0) >
    (remoteMeta.fieldUpdatedAt.multiviewSlotIds ?? 0)
      ? (alignedLocal.multiviewSlotIds ?? cleanRemote.multiviewSlotIds)
      : (cleanRemote.multiviewSlotIds ?? alignedLocal.multiviewSlotIds);

  // Combine metadata ledgers
  const mergedFieldUpdatedAt: Partial<Record<SyncScalarField, number>> = {
    ...remoteMeta.fieldUpdatedAt,
  };
  for (const [field, ts] of Object.entries(localMeta.fieldUpdatedAt) as [
    SyncScalarField,
    number | undefined,
  ][]) {
    if (ts && ts > (mergedFieldUpdatedAt[field] ?? 0)) {
      mergedFieldUpdatedAt[field] = ts;
    }
  }

  const mergedItemUpdatedAt: Record<string, number> = {
    ...remoteMeta.itemUpdatedAt,
  };
  for (const [k, ts] of Object.entries(localMeta.itemUpdatedAt)) {
    if (ts > (mergedItemUpdatedAt[k] ?? 0)) {
      mergedItemUpdatedAt[k] = ts;
    }
  }

  const mergedTombstones: Record<string, number> = {
    ...remoteMeta.tombstones,
  };
  for (const [k, ts] of Object.entries(localMeta.tombstones)) {
    if (ts > (mergedTombstones[k] ?? 0)) {
      mergedTombstones[k] = ts;
    }
  }
  // Ensure active items clear older tombstones
  for (const [k, ts] of Object.entries(mergedItemUpdatedAt)) {
    if ((mergedTombstones[k] ?? 0) < ts) {
      delete mergedTombstones[k];
    }
  }
  for (const [k, ts] of Object.entries(mergedTombstones)) {
    if ((mergedItemUpdatedAt[k] ?? 0) <= ts) {
      delete mergedItemUpdatedAt[k];
    }
  }

  const candidateMeta = pruneSyncMetadata(
    {
      revision: Math.max(localMeta.revision, remoteMeta.revision),
      fieldUpdatedAt: mergedFieldUpdatedAt,
      itemUpdatedAt: mergedItemUpdatedAt,
      tombstones: mergedTombstones,
    },
    nowMs
  );

  const candidateMerged: LumaSyncPlainPayload = {
    schemaVersion: 3,
    exportedAt: nowMs,
    favorites: mergedFavorites,
    favoriteVodIds: mergedVodFavorites,
    favoriteSeriesIds: mergedSeriesFavorites,
    customBouquets: mergedBouquets,
    watchHistory: mergedHistory,
    reminders: mergedReminders,
    ...(mergedParental ? { parentalConfig: mergedParental } : {}),
    ...(mergedPreferences ? { preferences: mergedPreferences } : {}),
    epgOffsetHours: mergedEpgOffset,
    preferredDesign: mergedPreferredDesign,
    ...(mergedDualSlots ? { dualSlotIds: mergedDualSlots } : {}),
    ...(mergedMultiviewSlots ? { multiviewSlotIds: mergedMultiviewSlots } : {}),
    activeSourceId: mergedActiveSourceId,
    demoSourceDeleted: mergedDemoDeleted,
    playlists: mergedPlaylists,
    syncMeta: candidateMeta,
  };

  const mergedDigest = computeSyncContentDigest(candidateMerged);
  const remoteComparableDigest = computeSyncContentDigest({
    ...params.remote,
    schemaVersion: 3,
    syncMeta: params.remote.syncMeta ?? createEmptySyncMetadata(),
  });
  const localComparableDigest = computeSyncContentDigest({
    ...params.local,
    schemaVersion: 3,
    syncMeta: localMetaRaw,
  });

  const shouldPushToCloud = mergedDigest !== remoteComparableDigest;
  const shouldApplyLocally =
    mergedDigest !== localComparableDigest ||
    combinedSourceIdRemap.size > 0 ||
    deletedPlaylistIds.length > 0;

  const finalMeta: EncryptedSyncMetadataV3 = shouldPushToCloud
    ? { ...candidateMeta, revision: candidateMeta.revision + 1 }
    : candidateMeta;

  const finalPayload: LumaSyncPlainPayload = {
    ...candidateMerged,
    exportedAt: shouldPushToCloud ? nowMs : (cleanRemote.exportedAt || nowMs),
    syncMeta: finalMeta,
  };

  const mode: CloudSyncReconcileMode =
    !shouldPushToCloud && !shouldApplyLocally
      ? 'up-to-date'
      : isFirstTimeMerge
        ? 'first-time-merge'
        : 'incremental-merge';

  let summary: string;
  if (mode === 'up-to-date') {
    summary = 'Cloud sync is up to date.';
  } else if (mode === 'first-time-merge') {
    summary =
      deduplicatedPlaylistCount > 0
        ? `Merged local & cloud differences (${deduplicatedPlaylistCount} duplicate playlist${deduplicatedPlaylistCount > 1 ? 's' : ''} consolidated).`
        : 'Compared local & cloud configurations and synced differences.';
  } else {
    summary =
      deduplicatedPlaylistCount > 0
        ? `Incremental sync complete (${deduplicatedPlaylistCount} duplicate playlist${deduplicatedPlaylistCount > 1 ? 's' : ''} consolidated).`
        : 'Incremental cloud sync complete.';
  }

  return {
    mode,
    mergedPayload: finalPayload,
    shouldPushToCloud,
    shouldApplyLocally,
    sourceIdRemap: combinedSourceIdRemap,
    deletedPlaylistIds,
    deduplicatedPlaylistCount,
    nextDeviceSyncState: {
      uid,
      hasCompletedInitialSync: true,
      lastSyncedDigest: mergedDigest,
      lastRemoteUpdatedAt: params.remoteUpdatedAtMs ?? cleanRemote.exportedAt ?? nowMs,
      basePayload: stripPayloadBaseSnapshot(finalPayload),
      localMeta: finalMeta,
    },
    summary,
  };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(bytes.byteLength, i + chunkSize));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function getOrCreateCloudDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_STORAGE);
    if (existing && existing.length >= 8) return existing;
    const rnd = crypto.getRandomValues(new Uint8Array(8));
    const hex = Array.from(rnd)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const created = `luma-${hex}`;
    localStorage.setItem(DEVICE_ID_STORAGE, created);
    return created;
  } catch {
    return 'luma-ephemeral';
  }
}

async function deriveAesGcmKey(
  passphrase: string,
  salt: Uint8Array,
  usage: KeyUsage[],
  extractable = false
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as unknown as BufferSource,
      iterations: 150_000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    extractable,
    usage
  );
}

/**
 * Derives a deterministic per-account 16-byte PBKDF2 salt from `uid` so every device
 * signing in to the same Luma Cloud account derives the identical 256-bit AES-GCM Master Key
 * without ever storing the user's plaintext password on disk.
 */
export async function deriveAccountMasterKeyRecord(params: {
  uid: string;
  email: string | null;
  password: string;
}): Promise<StoredMasterKeyRecord> {
  const domainTag = new TextEncoder().encode(`luma-cloud-kdf-v2:${params.uid}`);
  const hashBuf = await crypto.subtle.digest('SHA-256', domainTag);
  const salt = new Uint8Array(hashBuf).slice(0, 16);
  const key = await deriveAesGcmKey(params.password, salt, ['encrypt', 'decrypt'], true);
  const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  return {
    uid: params.uid,
    email: params.email,
    masterKeyBase64: bytesToBase64(rawKey),
    saltBase64: bytesToBase64(salt),
  };
}

function saveSessionMasterKey(record: StoredMasterKeyRecord): void {
  try {
    localStorage.setItem(SESSION_MASTER_KEY_STORAGE, JSON.stringify(record));
  } catch {
    // Ignore storage quota issues
  }
}

export function loadSessionMasterKey(uid?: string): StoredMasterKeyRecord | null {
  try {
    const raw = localStorage.getItem(SESSION_MASTER_KEY_STORAGE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredMasterKeyRecord;
    if (!parsed.masterKeyBase64 || !parsed.saltBase64 || !parsed.uid) return null;
    if (uid && parsed.uid !== uid) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearSessionMasterKey(): void {
  try {
    localStorage.removeItem(SESSION_MASTER_KEY_STORAGE);
  } catch {
    // Ignore
  }
}

async function importRawAesKey(masterKeyBase64: string, usage: KeyUsage[]): Promise<CryptoKey> {
  const rawBytes = base64ToBytes(masterKeyBase64);
  return crypto.subtle.importKey(
    'raw',
    rawBytes as unknown as BufferSource,
    { name: 'AES-GCM', length: 256 },
    false,
    usage
  );
}

/**
 * Encrypts a Luma Sync payload using an exported AES-256-GCM Master Key + fresh random 96-bit IV.
 */
export async function encryptVaultWithMasterKey(params: {
  payload: LumaSyncPlainPayload;
  masterKeyBase64: string;
  saltBase64: string;
  deviceId?: string;
  deviceLabel?: string;
}): Promise<EncryptedSyncEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await importRawAesKey(params.masterKeyBase64, ['encrypt']);
  const plaintext = new TextEncoder().encode(JSON.stringify(params.payload));
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    plaintext
  );

  const envelope: EncryptedSyncEnvelope = {
    version: 2,
    kdf: 'PBKDF2-SHA256-150k',
    alg: 'AES-256-GCM',
    saltBase64: params.saltBase64,
    ivBase64: bytesToBase64(iv),
    cipherBase64: bytesToBase64(new Uint8Array(cipherBuffer)),
    updatedAt: Date.now(),
    schemaVersion: params.payload.schemaVersion,
  };
  if (params.deviceId) envelope.deviceId = params.deviceId.slice(0, 128);
  if (params.deviceLabel) envelope.deviceLabel = params.deviceLabel.slice(0, 128);
  return envelope;
}

/**
 * Decrypts a Luma Sync envelope using the cached AES-256-GCM Master Key.
 */
export async function decryptVaultWithMasterKey(
  envelope: EncryptedSyncEnvelope,
  masterKeyBase64: string
): Promise<LumaSyncPlainPayload> {
  const iv = base64ToBytes(envelope.ivBase64);
  const cipher = base64ToBytes(envelope.cipherBase64);
  const key = await importRawAesKey(masterKeyBase64, ['decrypt']);
  try {
    const plainBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      cipher as unknown as BufferSource
    );
    const json = new TextDecoder().decode(plainBuffer);
    return JSON.parse(json) as LumaSyncPlainPayload;
  } catch {
    throw new Error(
      'Unable to decrypt cloud vault. If you recently reset your password, sign out and sign in again.'
    );
  }
}

/**
 * Encrypts Luma Sync payload client-side using PBKDF2-SHA256 (150k iterations) + AES-256-GCM
 * with a manual passphrase (for local snapshots & custom passphrases).
 */
export async function encryptSyncVault(
  payload: LumaSyncPlainPayload,
  passphrase: string
): Promise<EncryptedSyncEnvelope> {
  if (!passphrase || passphrase.length < 4) {
    throw new Error('Please choose a sync password of at least 4 characters.');
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesGcmKey(passphrase, salt, ['encrypt']);

  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    plaintext
  );

  return {
    version: 2,
    kdf: 'PBKDF2-SHA256-150k',
    alg: 'AES-256-GCM',
    saltBase64: bytesToBase64(salt),
    ivBase64: bytesToBase64(iv),
    cipherBase64: bytesToBase64(new Uint8Array(cipherBuffer)),
    updatedAt: Date.now(),
    schemaVersion: payload.schemaVersion,
  };
}

/**
 * Decrypts and authenticates an AES-256-GCM Luma Sync vault envelope using a passphrase.
 */
export async function decryptSyncVault(
  envelope: EncryptedSyncEnvelope,
  passphrase: string
): Promise<LumaSyncPlainPayload> {
  const salt = base64ToBytes(envelope.saltBase64);
  const iv = base64ToBytes(envelope.ivBase64);
  const cipher = base64ToBytes(envelope.cipherBase64);

  const key = await deriveAesGcmKey(passphrase, salt, ['decrypt']);
  try {
    const plainBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      cipher as unknown as BufferSource
    );
    const json = new TextDecoder().decode(plainBuffer);
    return JSON.parse(json) as LumaSyncPlainPayload;
  } catch {
    throw new Error('Decryption failed (incorrect password or corrupted vault).');
  }
}

export function resolveEnvFirebaseConfig(): FirebaseOptions {
  const envObj = (
    import.meta as unknown as { env?: Record<string, string | undefined> }
  ).env;
  const apiKey = envObj?.VITE_FIREBASE_API_KEY;
  const projectId = envObj?.VITE_FIREBASE_PROJECT_ID;
  if (apiKey && projectId) {
    return {
      apiKey,
      authDomain: envObj?.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
      projectId,
      appId: envObj?.VITE_FIREBASE_APP_ID,
    };
  }
  return LUMA_DEFAULT_FIREBASE_CONFIG;
}

function getOrInitFirebaseApp(
  options: FirebaseOptions = resolveEnvFirebaseConfig()
): FirebaseApp {
  const existing = getApps().find((a) => a.name === 'luma-sync');
  if (existing) return existing;
  return initializeApp(options, 'luma-sync');
}

export function formatFirebaseAuthError(err: unknown): string {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code)
      : '';
  switch (code) {
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Invalid email or password.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Switch to Sign In.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters long.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'auth/network-request-failed':
      return 'Network error while connecting to Firebase Cloud Sync.';
    default:
      return err instanceof Error ? err.message : 'Cloud authentication failed.';
  }
}

export async function signUpLumaCloudAccount(
  email: string,
  password: string,
  firebaseConfig: FirebaseOptions = resolveEnvFirebaseConfig()
): Promise<LumaCloudSessionInfo> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || password.length < 6) {
    throw new Error('Please enter a valid email and a password of at least 6 characters.');
  }
  const app = getOrInitFirebaseApp(firebaseConfig);
  const auth = getAuth(app);
  try {
    const cred = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
    const keyRecord = await deriveAccountMasterKeyRecord({
      uid: cred.user.uid,
      email: cred.user.email,
      password,
    });
    saveSessionMasterKey(keyRecord);
    return {
      uid: cred.user.uid,
      email: cred.user.email,
      hasVaultKey: true,
    };
  } catch (err) {
    throw new Error(formatFirebaseAuthError(err));
  }
}

export async function signInLumaCloudAccount(
  email: string,
  password: string,
  firebaseConfig: FirebaseOptions = resolveEnvFirebaseConfig()
): Promise<LumaCloudSessionInfo> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) {
    throw new Error('Please enter your email and password.');
  }
  const app = getOrInitFirebaseApp(firebaseConfig);
  const auth = getAuth(app);
  try {
    const cred = await signInWithEmailAndPassword(auth, normalizedEmail, password);
    const keyRecord = await deriveAccountMasterKeyRecord({
      uid: cred.user.uid,
      email: cred.user.email,
      password,
    });
    saveSessionMasterKey(keyRecord);
    return {
      uid: cred.user.uid,
      email: cred.user.email,
      hasVaultKey: true,
    };
  } catch (err) {
    throw new Error(formatFirebaseAuthError(err));
  }
}

export async function unlockExistingCloudSessionWithPassword(
  password: string,
  firebaseConfig: FirebaseOptions = resolveEnvFirebaseConfig()
): Promise<LumaCloudSessionInfo> {
  const app = getOrInitFirebaseApp(firebaseConfig);
  const auth = getAuth(app);
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Not signed in to Luma Cloud.');
  }
  const keyRecord = await deriveAccountMasterKeyRecord({
    uid: user.uid,
    email: user.email,
    password,
  });
  saveSessionMasterKey(keyRecord);
  return {
    uid: user.uid,
    email: user.email,
    hasVaultKey: true,
  };
}

export async function sendLumaPasswordReset(
  email: string,
  firebaseConfig: FirebaseOptions = resolveEnvFirebaseConfig()
): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error('Enter your email address first to receive a password reset link.');
  }
  const app = getOrInitFirebaseApp(firebaseConfig);
  const auth = getAuth(app);
  try {
    await sendPasswordResetEmail(auth, normalizedEmail);
  } catch (err) {
    throw new Error(formatFirebaseAuthError(err));
  }
}

export async function signOutLumaCloudAccount(
  firebaseConfig: FirebaseOptions = resolveEnvFirebaseConfig()
): Promise<void> {
  clearSessionMasterKey();
  const app = getOrInitFirebaseApp(firebaseConfig);
  const auth = getAuth(app);
  await signOut(auth);
}

export function subscribeLumaAuthState(
  onChange: (session: LumaCloudSessionInfo | null) => void,
  firebaseConfig: FirebaseOptions = resolveEnvFirebaseConfig()
): Unsubscribe {
  const app = getOrInitFirebaseApp(firebaseConfig);
  const auth = getAuth(app);
  return onAuthStateChanged(auth, (user: User | null) => {
    if (!user || user.isAnonymous) {
      onChange(null);
      return;
    }
    const keyRecord = loadSessionMasterKey(user.uid);
    onChange({
      uid: user.uid,
      email: user.email,
      hasVaultKey: Boolean(keyRecord),
    });
  });
}

export async function pushAccountCloudVault(params: {
  payload: LumaSyncPlainPayload;
  deviceLabel?: string;
  firebaseConfig?: FirebaseOptions;
}): Promise<EncryptedSyncEnvelope> {
  const cfg = params.firebaseConfig ?? resolveEnvFirebaseConfig();
  const app = getOrInitFirebaseApp(cfg);
  const auth = getAuth(app);
  const user = auth.currentUser;
  if (!user || user.isAnonymous) {
    throw new Error('Please sign in to Luma Cloud first.');
  }
  const keyRecord = loadSessionMasterKey(user.uid);
  if (!keyRecord) {
    throw new Error('Session encryption key locked — please re-enter your password once.');
  }

  const envelope = await encryptVaultWithMasterKey({
    payload: params.payload,
    masterKeyBase64: keyRecord.masterKeyBase64,
    saltBase64: keyRecord.saltBase64,
    deviceId: getOrCreateCloudDeviceId(),
    deviceLabel: params.deviceLabel,
  });

  const db = getFirestore(app);
  await setDoc(doc(db, 'users', user.uid, 'lumaSync', 'vault'), envelope);
  return envelope;
}

export async function pullAccountCloudVault(params?: {
  firebaseConfig?: FirebaseOptions;
}): Promise<{ envelope: EncryptedSyncEnvelope; payload: LumaSyncPlainPayload } | null> {
  const cfg = params?.firebaseConfig ?? resolveEnvFirebaseConfig();
  const app = getOrInitFirebaseApp(cfg);
  const auth = getAuth(app);
  const user = auth.currentUser;
  if (!user || user.isAnonymous) {
    throw new Error('Please sign in to Luma Cloud first.');
  }
  const keyRecord = loadSessionMasterKey(user.uid);
  if (!keyRecord) {
    throw new Error('Session encryption key locked — please re-enter your password once.');
  }

  const db = getFirestore(app);
  const snap = await getDoc(doc(db, 'users', user.uid, 'lumaSync', 'vault'));
  if (!snap.exists()) return null;
  const envelope = snap.data() as EncryptedSyncEnvelope;
  const payload = await decryptVaultWithMasterKey(envelope, keyRecord.masterKeyBase64);
  return { envelope, payload };
}

/**
 * Real-time cross-device Firestore listener on `/users/{uid}/lumaSync/vault`.
 * Uses `onSnapshot` so changes made on Mac appear live on Googlebook/Android TV and vice versa.
 */
export function subscribeAccountCloudVault(params: {
  uid: string;
  onRemoteVault: (data: {
    envelope: EncryptedSyncEnvelope;
    payload: LumaSyncPlainPayload;
  }) => void;
  onError?: (message: string) => void;
  firebaseConfig?: FirebaseOptions;
}): Unsubscribe {
  const cfg = params.firebaseConfig ?? resolveEnvFirebaseConfig();
  const app = getOrInitFirebaseApp(cfg);
  const db = getFirestore(app);
  const localDeviceId = getOrCreateCloudDeviceId();

  return onSnapshot(
    doc(db, 'users', params.uid, 'lumaSync', 'vault'),
    (snap) => {
      if (!snap.exists() || snap.metadata.hasPendingWrites) return;
      const envelope = snap.data() as EncryptedSyncEnvelope;
      if (envelope.deviceId && envelope.deviceId === localDeviceId) {
        return; // Ignore own echo
      }
      const keyRecord = loadSessionMasterKey(params.uid);
      if (!keyRecord) return;

      void decryptVaultWithMasterKey(envelope, keyRecord.masterKeyBase64)
        .then((payload) => {
          params.onRemoteVault({ envelope, payload });
        })
        .catch((err) => {
          params.onError?.(
            err instanceof Error ? err.message : 'Failed to decrypt remote cloud sync.'
          );
        });
    },
    (err) => {
      params.onError?.(err.message);
    }
  );
}

// Legacy helpers kept for manual passphrase vault mode
export async function pushEncryptedVaultToFirestore(params: {
  firebaseConfig: FirebaseOptions;
  authMode: 'anonymous' | 'google';
  envelope: EncryptedSyncEnvelope;
}): Promise<{ uid: string }> {
  const app = getOrInitFirebaseApp(params.firebaseConfig);
  const auth = getAuth(app);

  let user: User | null = auth.currentUser;
  if (!user) {
    if (params.authMode === 'google') {
      const cred = await signInWithPopup(auth, new GoogleAuthProvider());
      user = cred.user;
    } else {
      const cred = await signInAnonymously(auth);
      user = cred.user;
    }
  }

  const db = getFirestore(app);
  await setDoc(doc(db, 'users', user.uid, 'lumaSync', 'vault'), params.envelope);
  return { uid: user.uid };
}

export async function pullEncryptedVaultFromFirestore(params: {
  firebaseConfig: FirebaseOptions;
}): Promise<EncryptedSyncEnvelope | null> {
  const app = getOrInitFirebaseApp(params.firebaseConfig);
  const auth = getAuth(app);
  let user: User | null = auth.currentUser;
  if (!user) {
    const cred = await signInAnonymously(auth);
    user = cred.user;
  }
  const db = getFirestore(app);
  const snap = await getDoc(doc(db, 'users', user.uid, 'lumaSync', 'vault'));
  if (!snap.exists()) return null;
  return snap.data() as EncryptedSyncEnvelope;
}

export function serializePlaylistForSync(
  source: StoredPlaylistSource
): SyncedPlaylistSource {
  return {
    id: source.id,
    name: source.name,
    type: source.type,
    endpoint: source.endpoint,
    rawUrlOrHost: source.rawUrlOrHost,
    ...(source.username ? { username: source.username } : {}),
    ...(source.password ? { password: source.password } : {}),
    ...(source.outputFormat ? { outputFormat: source.outputFormat } : {}),
    ...(source.xmltvUrl ? { xmltvUrl: source.xmltvUrl } : {}),
    hiddenGroupIds: source.hiddenGroupIds ?? [],
    epgOffsetHours: source.epgOffsetHours ?? 0,
    createdAt: source.createdAt,
    updatedAt: source.updatedAtMs ?? source.lastSyncedAtMs ?? source.createdAt,
  };
}
