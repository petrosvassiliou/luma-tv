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
}

export interface LumaSyncPlainPayload {
  schemaVersion: 1 | 2;
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

interface StoredMasterKeyRecord {
  uid: string;
  email: string | null;
  masterKeyBase64: string;
  saltBase64: string;
}

const SESSION_MASTER_KEY_STORAGE = 'luma.cloud.sessionKey.v2';
const DEVICE_ID_STORAGE = 'luma.cloud.deviceId.v1';

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
  };
}
