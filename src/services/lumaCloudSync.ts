import { getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInAnonymously,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import { doc, getDoc, getFirestore, setDoc } from 'firebase/firestore';
import type { StoredPlaylistSource } from '../db/lumaDb';
import type { PlatformDesignMode } from '../types/luma';

export interface WatchHistoryEntry {
  itemId: string;
  title: string;
  kind: 'live' | 'vod' | 'catchup';
  resumeSec: number;
  durationSec: number;
  updatedAt: number;
}

export interface LumaSyncPlainPayload {
  schemaVersion: 1;
  exportedAt: number;
  favorites: string[];
  watchHistory: WatchHistoryEntry[];
  epgOffsetHours: number;
  preferredDesign: PlatformDesignMode;
  playlists?: Pick<
    StoredPlaylistSource,
    'id' | 'name' | 'type' | 'endpoint' | 'rawUrlOrHost' | 'xmltvUrl'
  >[];
}

export interface EncryptedSyncEnvelope {
  version: 1;
  kdf: 'PBKDF2-SHA256-150k';
  alg: 'AES-256-GCM';
  saltBase64: string;
  ivBase64: string;
  cipherBase64: string;
  updatedAt: number;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

async function deriveAesGcmKey(
  passphrase: string,
  salt: Uint8Array,
  usage: KeyUsage[]
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
    false,
    usage
  );
}

/**
 * Encrypts Luma Sync payload client-side using PBKDF2-SHA256 (150k iterations) + AES-256-GCM.
 */
export async function encryptSyncVault(
  payload: LumaSyncPlainPayload,
  passphrase: string
): Promise<EncryptedSyncEnvelope> {
  if (!passphrase || passphrase.length < 4) {
    throw new Error('Bitte mindestens 4 Zeichen als Sync-Passphrase vergeben.');
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
    version: 1,
    kdf: 'PBKDF2-SHA256-150k',
    alg: 'AES-256-GCM',
    saltBase64: bytesToBase64(salt),
    ivBase64: bytesToBase64(iv),
    cipherBase64: bytesToBase64(new Uint8Array(cipherBuffer)),
    updatedAt: Date.now(),
  };
}

/**
 * Decrypts and authenticates an AES-256-GCM Luma Sync vault envelope.
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
    throw new Error('Entschlüsselung fehlgeschlagen (falsche Passphrase oder manipuliertes Vault).');
  }
}

export function resolveEnvFirebaseConfig(): FirebaseOptions | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY as string | undefined;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined;
  if (!apiKey || !projectId) return null;
  return {
    apiKey,
    authDomain:
      (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined) ||
      `${projectId}.firebaseapp.com`,
    projectId,
    appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
  };
}

function getOrInitFirebaseApp(options: FirebaseOptions): FirebaseApp {
  const existing = getApps().find((a) => a.name === 'luma-sync');
  if (existing) return existing;
  return initializeApp(options, 'luma-sync');
}

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
