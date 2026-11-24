import React, { useEffect, useState } from 'react';
import {
  CloudUpload,
  Cpu,
  Download,
  KeyRound,
  Lock,
  RefreshCw,
} from 'lucide-react';
import type { StoredPlaylistSource } from '../../db/lumaDb';
import {
  probeTauriNativeEngine,
  type NativeEngineProbe,
} from '../../engine/tauriNativeBridge';
import { type LumaLocale } from '../../i18n/translations';
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
import { detectPlatformEnvironment } from '../../services/platformDetection';
import { LUMA_APP_VERSION, type PlatformDesignMode } from '../../types/luma';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}

interface PlatformSyncPanelProps {
  designMode: PlatformDesignMode;
  locale?: LumaLocale;
  favoriteIds: Set<string>;
  persistedSources: StoredPlaylistSource[];
  epgOffsetHours: number;
  watchHistory: WatchHistoryEntry[];
  onRestoreFromSync: (payload: LumaSyncPlainPayload) => void;
}

const LOCAL_VAULT_KEY = 'luma.encrypted.vault.v1';

export const Phase4PlatformSyncPanel: React.FC<PlatformSyncPanelProps> = ({
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

  const platformInfo = detectPlatformEnvironment();
  const [nativeProbe, setNativeProbe] = useState<NativeEngineProbe | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  const [passphrase, setPassphrase] = useState<string>('');
  const [includePlaylists, setIncludePlaylists] = useState<boolean>(true);
  const [syncStatus, setSyncStatus] = useState<string>('');
  const [isError, setIsError] = useState<boolean>(false);
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

  const handleEncryptAndSync = async () => {
    if (!passphrase.trim()) {
      setIsError(true);
      setSyncStatus('Please enter a password first.');
      return;
    }
    try {
      setIsError(false);
      setSyncStatus('Encrypting backup…');
      const payload = buildCurrentPayload();
      const envelope = await encryptSyncVault(payload, passphrase);
      localStorage.setItem(LOCAL_VAULT_KEY, JSON.stringify(envelope));
      setLastEnvelope(envelope);

      const fbCfg = resolveEnvFirebaseConfig();
      if (fbCfg) {
        await pushEncryptedVaultToFirestore({
          firebaseConfig: fbCfg,
          authMode: 'anonymous',
          envelope,
        });
        setSyncStatus('Encrypted backup saved & synced to cloud.');
      } else {
        await decryptSyncVault(envelope, passphrase);
        setSyncStatus(
          `Encrypted backup saved (${payload.favorites.length} favorites).`
        );
      }
    } catch (err) {
      setIsError(true);
      setSyncStatus(err instanceof Error ? err.message : 'Sync failed');
    }
  };

  const handleDecryptRestore = async () => {
    if (!passphrase.trim()) {
      setIsError(true);
      setSyncStatus('Please enter your backup password.');
      return;
    }
    try {
      setIsError(false);
      const fbCfg = resolveEnvFirebaseConfig();
      let envelope = lastEnvelope;
      if (fbCfg) {
        const remote = await pullEncryptedVaultFromFirestore({ firebaseConfig: fbCfg });
        if (remote) envelope = remote;
      }
      if (!envelope) {
        setIsError(true);
        setSyncStatus('No encrypted backup found yet.');
        return;
      }
      const decrypted = await decryptSyncVault(envelope, passphrase);
      onRestoreFromSync(decrypted);
      setSyncStatus(
        `Backup restored (${decrypted.favorites.length} favorites).`
      );
    } catch {
      setIsError(true);
      setSyncStatus('Incorrect password or corrupted backup.');
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* Password-Protected Sync & Snapshot */}
      <div className={`${panelClass} space-y-3`}>
        <div className="flex items-center gap-2 text-xs font-semibold text-white">
          <Lock className="h-4 w-4 text-sky-400" />
          <span>Password-Protected Sync</span>
        </div>

        <p className="text-[11px] leading-relaxed text-slate-300/80">
          Protect your favorites, watch progress, and playlists with your own password to
          save and restore securely across sessions.
        </p>

        <div className="relative flex items-center">
          <KeyRound className="pointer-events-none absolute left-3.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Choose a sync password…"
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
          <span>Include playlist connections</span>
        </label>

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
            <span>Save Encrypted Backup</span>
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
            <span>Restore</span>
          </button>
        </div>

        {syncStatus && (
          <div
            className={`text-[11px] font-medium ${
              isError ? 'text-rose-300' : 'text-emerald-300'
            }`}
          >
            {syncStatus}
          </div>
        )}
      </div>

      {/* Clean System & Playback Status */}
      <div className={`${panelClass} flex flex-col justify-between space-y-3`}>
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-white">
              <Cpu className="h-4 w-4 text-sky-400" />
              <span>App &amp; Playback Status</span>
            </div>
            <span className="rounded-full bg-white/10 px-2.5 py-0.5 font-mono text-[10px] text-slate-300 luma-tabular">
              v{LUMA_APP_VERSION}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div
              className={`p-3 ${
                isM3 ? 'rounded-[18px] bg-[#232B3D]' : 'lg-capsule rounded-[16px]'
              }`}
            >
              <div className="text-[10px] text-slate-400">Platform &amp; Theme</div>
              <div className="mt-0.5 font-semibold text-white">
                {platformInfo.label} ·{' '}
                {designMode === 'liquid-glass' ? 'Liquid Glass' : 'Material 3'}
              </div>
            </div>

            <div
              className={`p-3 ${
                isM3 ? 'rounded-[18px] bg-[#232B3D]' : 'lg-capsule rounded-[16px]'
              }`}
            >
              <div className="text-[10px] text-slate-400">Video Decoder</div>
              <div className="mt-0.5 truncate font-semibold text-white">
                {nativeProbe?.hwDecoder ?? 'Hardware MSE'}
              </div>
            </div>
          </div>

          {nativeProbe?.available && (
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span
                className={`rounded-full px-2.5 py-1 font-medium ${
                  nativeProbe.mpvAvailable
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-white/10 text-slate-300'
                }`}
              >
                External MPV Player: {nativeProbe.mpvAvailable ? 'Ready' : 'Optional'}
              </span>
              {nativeProbe.localProxyUrl && (
                <span className="rounded-full bg-sky-400/15 px-2.5 py-1 font-medium text-sky-200">
                  Stream Compatibility Engine: Active
                </span>
              )}
            </div>
          )}
        </div>

        {installPrompt && (
          <div>
            <button
              type="button"
              onClick={() => installPrompt.prompt()}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold ${
                isM3 ? 'm3-primary-pill' : 'lg-pill-active'
              }`}
            >
              <Download className="h-3.5 w-3.5" />
              <span>Install Desktop / Web App</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
