import React, { useEffect, useState } from 'react';
import {
  Apple,
  CloudUpload,
  Cpu,
  Download,
  KeyRound,
  Lock,
  RefreshCw,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import type { FirebaseOptions } from 'firebase/app';
import type { StoredPlaylistSource } from '../../db/lumaDb';
import {
  probeTauriNativeEngine,
  type NativeEngineProbe,
} from '../../engine/tauriNativeBridge';
import {
  decryptSyncVault,
  encryptSyncVault,
  pullEncryptedVaultFromFirestore,
  pushEncryptedVaultToFirestore,
  resolveEnvFirebaseConfig,
  type EncryptedSyncEnvelope,
  type LumaSyncPlainPayload,
  type WatchHistoryEntry,
} from '../../services/lumaCloudSync';
import type { PlatformDesignMode } from '../../types/luma';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

interface Phase4PlatformSyncPanelProps {
  designMode: PlatformDesignMode;
  favoriteIds: Set<string>;
  persistedSources: StoredPlaylistSource[];
  epgOffsetHours: number;
  watchHistory: WatchHistoryEntry[];
  onRestoreFromSync: (payload: LumaSyncPlainPayload) => void;
}

const LOCAL_VAULT_KEY = 'luma.encrypted.vault.v1';

export const Phase4PlatformSyncPanel: React.FC<Phase4PlatformSyncPanelProps> = ({
  designMode,
  favoriteIds,
  persistedSources,
  epgOffsetHours,
  watchHistory,
  onRestoreFromSync,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const panelClass = isM3 ? 'rounded-[28px] bg-[#1A202E] p-5' : 'lg-pane rounded-[24px] p-5';
  const inputClass = isM3
    ? 'h-9 w-full rounded-full bg-[#232B3D] px-4 text-xs text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#7FD4FF]/60'
    : 'lg-capsule h-9 w-full rounded-full px-4 text-xs text-white placeholder:text-white/45 focus:outline-none';

  const [nativeProbe, setNativeProbe] = useState<NativeEngineProbe | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  const [passphrase, setPassphrase] = useState<string>('luma-oled-2026');
  const [includePlaylists, setIncludePlaylists] = useState<boolean>(true);
  const [firebaseJson, setFirebaseJson] = useState<string>('');
  const [syncStatus, setSyncStatus] = useState<string>('');
  const [lastEnvelope, setLastEnvelope] = useState<EncryptedSyncEnvelope | null>(() => {
    try {
      const raw = localStorage.getItem(LOCAL_VAULT_KEY);
      return raw ? (JSON.parse(raw) as EncryptedSyncEnvelope) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    probeTauriNativeEngine().then(setNativeProbe).catch(() => undefined);

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  const buildCurrentPayload = (): LumaSyncPlainPayload => ({
    schemaVersion: 1,
    exportedAt: Date.now(),
    favorites: Array.from(favoriteIds),
    watchHistory,
    epgOffsetHours,
    preferredDesign: designMode,
    playlists: includePlaylists
      ? persistedSources.map((s) => ({
          id: s.id,
          name: s.name,
          type: s.type,
          endpoint: s.endpoint,
          rawUrlOrHost: s.rawUrlOrHost,
          xmltvUrl: s.xmltvUrl,
        }))
      : undefined,
  });

  const parseFirebaseConfig = (): FirebaseOptions | null => {
    const envCfg = resolveEnvFirebaseConfig();
    if (!firebaseJson.trim()) return envCfg;
    try {
      return JSON.parse(firebaseJson) as FirebaseOptions;
    } catch {
      throw new Error('Ungültiges Firebase Config JSON.');
    }
  };

  const handleEncryptAndSync = async () => {
    try {
      setSyncStatus('Verschlüssele Vault via PBKDF2-SHA256 + AES-256-GCM…');
      const payload = buildCurrentPayload();
      const envelope = await encryptSyncVault(payload, passphrase);
      localStorage.setItem(LOCAL_VAULT_KEY, JSON.stringify(envelope));
      setLastEnvelope(envelope);

      const fbCfg = parseFirebaseConfig();
      if (fbCfg) {
        setSyncStatus('Übertrage verschlüsseltes Vault zu Cloud Firestore…');
        const { uid } = await pushEncryptedVaultToFirestore({
          firebaseConfig: fbCfg,
          authMode: 'anonymous',
          envelope,
        });
        setSyncStatus(
          `Firestore Sync erfolgreich (UID ${uid.slice(0, 8)}… · ${envelope.cipherBase64.length} Bytes AES-256-GCM)`
        );
      } else {
        // Verify roundtrip decryption immediately
        const verified = await decryptSyncVault(envelope, passphrase);
        setSyncStatus(
          `AES-256-GCM Vault verschlüsselt & verifiziert (${verified.favorites.length} Favoriten, ${verified.watchHistory.length} Resume-Punkte · bereit für Firestore luma-tv-app)`
        );
      }
    } catch (err) {
      setSyncStatus(err instanceof Error ? err.message : 'Sync-Fehler');
    }
  };

  const handleDecryptRestore = async () => {
    try {
      const fbCfg = parseFirebaseConfig();
      let envelope = lastEnvelope;
      if (fbCfg) {
        setSyncStatus('Lade verschlüsseltes Vault aus Cloud Firestore…');
        const remote = await pullEncryptedVaultFromFirestore({ firebaseConfig: fbCfg });
        if (remote) envelope = remote;
      }
      if (!envelope) {
        setSyncStatus('Noch kein verschlüsseltes Vault vorhanden.');
        return;
      }
      const decrypted = await decryptSyncVault(envelope, passphrase);
      onRestoreFromSync(decrypted);
      setSyncStatus(
        `Vault entschlüsselt & wiederhergestellt (${decrypted.favorites.length} Favoriten, Design: ${decrypted.preferredDesign}).`
      );
    } catch (err) {
      setSyncStatus(err instanceof Error ? err.message : 'Entschlüsselung fehlgeschlagen');
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Encrypted Luma Sync (AES-256-GCM + Firebase Auth/Firestore) */}
        <div className={`${panelClass} space-y-3.5`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-white">
              <Lock className="h-4 w-4 text-sky-400" />
              <span>Luma Cloud Sync · Zero-Knowledge AES-256-GCM</span>
            </div>
            <span className="rounded-full bg-sky-400/15 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-sky-300">
              luma-tv-app
            </span>
          </div>

          <p className="text-[11px] leading-relaxed text-slate-300/80">
            Verschlüsselt Favoriten, Watch-History/Resume-Punkte und optional Playlist-Zugänge lokal via{' '}
            <code className="text-sky-300">WebCrypto AES-256-GCM</code> vor dem Sync nach Firestore.
          </p>

          <div className="relative flex items-center">
            <KeyRound className="pointer-events-none absolute left-3.5 h-3.5 w-3.5 text-slate-400" />
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Ende-zu-Ende Sync-Passphrase…"
              className={`${inputClass} pl-9`}
            />
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-200">
            <input
              type="checkbox"
              checked={includePlaylists}
              onChange={(e) => setIncludePlaylists(e.target.checked)}
              className="h-4 w-4 accent-sky-400"
            />
            <span>Playlist-Zugänge verschlüsselt ins Vault einschließen</span>
          </label>

          <input
            type="text"
            value={firebaseJson}
            onChange={(e) => setFirebaseJson(e.target.value)}
            placeholder='Optional: Firebase Config JSON ({"apiKey":"…","projectId":"luma-tv-app"})'
            className={`${inputClass} font-mono text-[11px]`}
          />

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              id="btn-luma-sync-encrypt"
              type="button"
              onClick={handleEncryptAndSync}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold ${
                isM3 ? 'm3-primary-pill' : 'lg-pill-active'
              }`}
            >
              <CloudUpload className="h-3.5 w-3.5" />
              <span>Verschlüsseln &amp; Sync</span>
            </button>

            <button
              id="btn-luma-sync-restore"
              type="button"
              onClick={handleDecryptRestore}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold ${
                isM3 ? 'm3-secondary-tonal' : 'lg-capsule text-white'
              }`}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Vault entschlüsseln</span>
            </button>
          </div>

          {lastEnvelope && (
            <div className="rounded-2xl bg-black/30 p-2.5 font-mono text-[10px] text-slate-400">
              <div className="flex items-center justify-between text-sky-300">
                <span>{lastEnvelope.alg} · {lastEnvelope.kdf}</span>
                <span className="luma-tabular">
                  IV {lastEnvelope.ivBase64.slice(0, 10)}…
                </span>
              </div>
              <div className="mt-1 truncate opacity-75">
                Cipher: {lastEnvelope.cipherBase64.slice(0, 68)}…
              </div>
            </div>
          )}

          {syncStatus && (
            <div className="text-[11px] font-medium text-emerald-300">{syncStatus}</div>
          )}
        </div>

        {/* Phase 4 Multi-Target Architecture Matrix (Tauri v2 + ChromeOS PWA + Watch History) */}
        <div className={`${panelClass} space-y-3.5`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-white">
              <Cpu className="h-4 w-4 text-sky-400" />
              <span>Phase 4 · Multi-Target Runtime (`app.lumatv.client`)</span>
            </div>

            {installPrompt && (
              <button
                type="button"
                onClick={() => installPrompt.prompt()}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold ${
                  isM3 ? 'm3-primary-pill' : 'lg-pill-active'
                }`}
              >
                <Download className="h-3 w-3" />
                <span>ChromeOS PWA installieren</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <div
              className={`p-3 ${
                isM3 ? 'rounded-[20px] bg-[#232B3D]' : 'lg-capsule rounded-[18px]'
              }`}
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                <Apple className="h-3.5 w-3.5 text-sky-300" />
                <span>macOS Tauri v2</span>
              </div>
              <p className="mt-1 text-[10px] text-slate-300/80">
                Liquid Glass Overlay Titlebar, VideoToolbox HEVC &amp; Rust MPV-Bridge.
              </p>
            </div>

            <div
              className={`p-3 ${
                isM3 ? 'rounded-[20px] bg-[#232B3D]' : 'lg-capsule rounded-[18px]'
              }`}
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                <Smartphone className="h-3.5 w-3.5 text-sky-300" />
                <span>GoogleOS / Android</span>
              </div>
              <p className="mt-1 text-[10px] text-slate-300/80">
                Material 3 Expressive, Freeform Resizable Window &amp; SDK 28 Manifest.
              </p>
            </div>

            <div
              className={`p-3 ${
                isM3 ? 'rounded-[20px] bg-[#232B3D]' : 'lg-capsule rounded-[18px]'
              }`}
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                <Sparkles className="h-3.5 w-3.5 text-sky-300" />
                <span>Firebase PWA</span>
              </div>
              <p className="mt-1 text-[10px] text-slate-300/80">
                WCO Manifest, Service Worker, Hosting &amp; `lumaStreamProxy` bereit.
              </p>
            </div>
          </div>

          {nativeProbe && (
            <div className="rounded-2xl bg-black/30 px-3.5 py-2.5 text-[11px] text-slate-300">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">
                  Aktive Laufzeit: {nativeProbe.available ? 'Tauri v2 Native' : 'Web / ChromeOS PWA'}
                </span>
                <span className="font-mono text-[10px] text-sky-300">
                  {nativeProbe.hwDecoder}
                </span>
              </div>
              <div className="mt-1 text-[10px] text-slate-400">
                Codecs: {nativeProbe.supportedCodecs.join(' · ')}
              </div>
            </div>
          )}

          {/* Watch History / Resume Points */}
          <div>
            <div className="mb-1.5 text-[11px] font-semibold text-slate-300">
              Watch-History &amp; Resume-Punkte ({watchHistory.length})
            </div>
            <div className="space-y-1">
              {watchHistory.slice(0, 3).map((w) => (
                <div
                  key={w.itemId}
                  className="flex items-center justify-between rounded-full bg-white/[0.05] px-3 py-1.5 text-[11px]"
                >
                  <span className="truncate font-medium text-white">{w.title}</span>
                  <span className="shrink-0 font-mono text-[10px] text-sky-300 luma-tabular">
                    {w.kind.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
