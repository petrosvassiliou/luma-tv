import React, { useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileUp,
  Gamepad2,
  Globe,
  Keyboard,
  Loader2,
  Lock,
  LockOpen,
  Moon,
  PictureInPicture2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
} from 'lucide-react';
import {
  TRANSLATIONS,
  type BufferProfile,
  type LumaLocale,
  type LumaPreferences,
} from '../../i18n/translations';
import type {
  LumaUpdateCheckResult,
  LumaUpdateProgressPayload,
} from '../../services/autoUpdater';
import { LanguageDropdown } from '../common/LanguageDropdown';
import {
  LumaCloudSyncCard,
  type CloudSyncActions,
  type CloudSyncUiState,
} from '../common/LumaCloudSyncCard';
import {
  LUMA_APP_VERSION,
  type ChannelGroup,
  type CustomBouquet,
  type ParentalControlConfig,
  type PlatformDesignMode,
} from '../../types/luma';

interface SettingsHubViewProps {
  designMode: PlatformDesignMode;
  isAppleDevice: boolean;
  detectedPlatformLabel: string;
  onChangeDesignMode: (mode: PlatformDesignMode) => void;
  preferences: LumaPreferences;
  onChangePreferences: (next: LumaPreferences) => void;
  sleepRemainingSec: number | null;
  favoriteIds: Set<string>;
  customBouquets: CustomBouquet[];
  groups: ChannelGroup[];
  parentalConfig: ParentalControlConfig;
  onChangeParentalConfig: (next: ParentalControlConfig) => void;
  onImportFullBackup: (backup: {
    favorites?: string[];
    bouquets?: CustomBouquet[];
    parental?: ParentalControlConfig;
    preferences?: LumaPreferences;
  }) => void;
  onOpenShortcutsModal: () => void;
  updateCheck?: LumaUpdateCheckResult | null;
  isCheckingUpdate?: boolean;
  isInstallingUpdate?: boolean;
  updateProgress?: LumaUpdateProgressPayload | null;
  updateError?: string | null;
  onCheckForUpdates?: () => void;
  onInstallUpdate?: () => void;
  cloudState?: CloudSyncUiState;
  cloudActions?: CloudSyncActions;
}

export const SettingsHubView: React.FC<SettingsHubViewProps> = ({
  designMode,
  isAppleDevice,
  detectedPlatformLabel,
  onChangeDesignMode,
  preferences,
  onChangePreferences,
  sleepRemainingSec,
  favoriteIds,
  customBouquets,
  groups,
  parentalConfig,
  onChangeParentalConfig,
  onImportFullBackup,
  onOpenShortcutsModal,
  updateCheck = null,
  isCheckingUpdate = false,
  isInstallingUpdate = false,
  updateProgress = null,
  updateError = null,
  onCheckForUpdates,
  onInstallUpdate,
  cloudState,
  cloudActions,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const t = TRANSLATIONS[preferences.locale];
  const panelClass = isM3 ? 'rounded-[28px] bg-[#1A202E] p-5' : 'lg-pane rounded-[24px] p-5';
  const [newPin, setNewPin] = useState(parentalConfig.pin);

  const setLocale = (locale: LumaLocale) =>
    onChangePreferences({ ...preferences, locale });

  const setBuffer = (bufferProfile: BufferProfile) =>
    onChangePreferences({ ...preferences, bufferProfile });

  const setSleep = (sleepTimerMinutes: number) =>
    onChangePreferences({ ...preferences, sleepTimerMinutes });

  const toggleGroupPinLock = (groupId: string) => {
    const set = new Set(parentalConfig.lockedGroupIds);
    if (set.has(groupId)) set.delete(groupId);
    else set.add(groupId);
    onChangeParentalConfig({
      ...parentalConfig,
      lockedGroupIds: Array.from(set),
    });
  };

  const exportBackupJson = () => {
    const bundle = {
      app: 'app.lumatv.client',
      version: LUMA_APP_VERSION,
      exportedAt: new Date().toISOString(),
      favorites: Array.from(favoriteIds),
      bouquets: customBouquets,
      parental: parentalConfig,
      preferences,
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `luma-tv-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleBackupImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      onImportFullBackup(parsed);
    } catch {
      // Ignore malformed JSON
    }
    e.target.value = '';
  };

  return (
    <div className="luma-scroll flex-1 overflow-y-auto p-5 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">{t.navSettings}</h2>
          <p className="text-xs text-slate-400">
            Language, playback buffer, sleep timer, parental PIN, and backups.
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenShortcutsModal}
          className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold ${
            isM3 ? 'm3-secondary-tonal' : 'lg-capsule text-white'
          }`}
        >
          <Keyboard className="h-4 w-4 text-sky-300" />
          <span>{t.shortcutsGuideBtn}</span>
        </button>
      </div>

      {/* Firebase Cloud Sync Account & Auto-Sync Center */}
      {cloudState && cloudActions && (
        <LumaCloudSyncCard
          designMode={designMode}
          cloudState={cloudState}
          cloudActions={cloudActions}
        />
      )}

      {/* Software Updates & Auto-Updater Center */}
      <div className={`${panelClass} space-y-3.5`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Sparkles className="h-4 w-4 text-sky-400" />
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-white">
                <span>Software Updates</span>
                <span className="rounded-full bg-white/10 px-2.5 py-0.5 font-mono text-[10px] text-sky-200 luma-tabular">
                  v{LUMA_APP_VERSION}
                </span>
                {isAppleDevice ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-sky-400/15 px-2.5 py-0.5 text-[10px] font-semibold text-sky-200 ring-1 ring-sky-400/30">
                    <ShieldCheck className="h-3 w-3" />
                    <span>macOS In-App Ed25519 Updater</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-400/30">
                    <ShieldCheck className="h-3 w-3" />
                    <span>Google Play Protect Compatible · V3 Release Signed</span>
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[11px] text-slate-400">
                {isAppleDevice
                  ? 'Cryptographically signed updates download and install directly inside Luma.app with automatic restart.'
                  : 'Verified V2/V3 release-signed APK updates via the trusted Android System Installer with zero risky sideload permissions.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onCheckForUpdates && (
              <button
                id="btn-settings-check-updates"
                type="button"
                disabled={isCheckingUpdate || isInstallingUpdate}
                onClick={onCheckForUpdates}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition disabled:opacity-50 ${
                  isM3 ? 'm3-secondary-tonal' : 'lg-capsule text-white'
                }`}
              >
                {isCheckingUpdate ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                <span>{isCheckingUpdate ? 'Checking…' : 'Check for Updates'}</span>
              </button>
            )}

            {updateCheck?.updateAvailable && onInstallUpdate && (
              <button
                id="btn-settings-install-update"
                type="button"
                disabled={isInstallingUpdate}
                onClick={onInstallUpdate}
                className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition disabled:opacity-50 ${
                  isM3 ? 'm3-primary-pill' : 'lg-pill-active'
                }`}
              >
                {isInstallingUpdate ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                <span>
                  {isInstallingUpdate
                    ? 'Updating…'
                    : updateCheck.strategy === 'macos-in-app-ed25519' &&
                        updateCheck.canInstallInApp
                      ? `Install v${updateCheck.latestVersion} & Restart`
                      : `Update to v${updateCheck.latestVersion}`}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Live Progress or Up-to-Date Status */}
        {isInstallingUpdate && updateProgress && (
          <div className="space-y-1.5 rounded-2xl bg-black/25 p-3">
            <div className="flex items-center justify-between text-[11px] text-sky-200 luma-tabular">
              <span>{updateProgress.message || updateProgress.phase}</span>
              <span>{updateProgress.percent}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/15">
              <div
                className={`h-full transition-all duration-200 ${
                  isM3 ? 'bg-[#7FD4FF]' : 'luma-accent-gradient'
                }`}
                style={{ width: `${Math.max(5, updateProgress.percent)}%` }}
              />
            </div>
          </div>
        )}

        {updateError && (
          <div className="rounded-xl bg-rose-500/15 px-3.5 py-2 text-xs text-rose-200 ring-1 ring-rose-400/30">
            {updateError}
          </div>
        )}

        {updateCheck && !updateCheck.updateAvailable && !updateError && (
          <div className="flex items-center gap-2 text-xs text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            <span>
              Luma TV is up to date (v{updateCheck.currentVersion}).
            </span>
          </div>
        )}

        {updateCheck?.updateAvailable && (
          <div className="space-y-1.5 rounded-2xl bg-white/[0.04] p-3.5 text-xs text-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2 font-semibold text-white">
              <span>{updateCheck.releaseTitle}</span>
              {updateCheck.androidApkSha256 && (
                <span className="font-mono text-[10px] font-normal text-slate-400">
                  APK SHA-256: {updateCheck.androidApkSha256.slice(0, 20)}…
                </span>
              )}
            </div>
            {updateCheck.releaseNotes && (
              <p className="line-clamp-4 whitespace-pre-line text-[11px] leading-relaxed text-slate-300">
                {updateCheck.releaseNotes}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-5 border-t border-white/10 pt-2.5">
          <label className="flex items-center gap-2 text-xs text-slate-200">
            <input
              type="checkbox"
              checked={preferences.autoCheckUpdates !== false}
              onChange={(e) =>
                onChangePreferences({
                  ...preferences,
                  autoCheckUpdates: e.target.checked,
                })
              }
              className="h-4 w-4 accent-sky-400"
            />
            <span>Automatically check for updates on startup</span>
          </label>

          <label className="flex items-center gap-2 text-xs text-slate-200">
            <input
              type="checkbox"
              checked={preferences.includeBetaUpdates !== false}
              onChange={(e) =>
                onChangePreferences({
                  ...preferences,
                  includeBetaUpdates: e.target.checked,
                })
              }
              className="h-4 w-4 accent-sky-400"
            />
            <span>Include Beta releases</span>
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 6-Language Selector & Platform-Aware Design System */}
        <div className={`${panelClass} space-y-4`}>
          <div className="flex items-center gap-2 text-xs font-semibold text-white">
            <Globe className="h-4 w-4 text-sky-400" />
            <span>{t.langAndDesignTitle}</span>
          </div>

          <LanguageDropdown
            id="settings-language-dropdown"
            variant="full"
            designMode={designMode}
            locale={preferences.locale}
            onSelectLocale={setLocale}
          />

          <div className="border-t border-white/10 pt-3">
            {isAppleDevice ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onChangeDesignMode('liquid-glass')}
                  className={`rounded-full px-4 py-2 text-xs font-semibold ${
                    !isM3 ? 'lg-pill-active' : 'm3-secondary-tonal'
                  }`}
                >
                  Apple Liquid Glass ({detectedPlatformLabel})
                </button>
                <button
                  type="button"
                  onClick={() => onChangeDesignMode('m3-expressive')}
                  className={`rounded-full px-4 py-2 text-xs font-semibold ${
                    isM3
                      ? 'm3-tonal-active ring-1 ring-[#7FD4FF]/60'
                      : 'lg-capsule text-slate-300'
                  }`}
                >
                  Material 3 Expressive
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between text-xs text-slate-300">
                <span>Detected Theme ({detectedPlatformLabel})</span>
                <span className="m3-tonal-active rounded-full px-3 py-1 text-[11px] font-semibold">
                  Material 3 Expressive
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Sleep Timer & Spatial 10-Foot Focus */}
        <div className={`${panelClass} space-y-4`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-white">
              <Moon className="h-4 w-4 text-sky-400" />
              <span>{t.sleepTimerTitle}</span>
            </div>
            {sleepRemainingSec !== null && (
              <span className="rounded-full bg-amber-400/20 px-3 py-0.5 font-mono text-[11px] font-bold text-amber-200 luma-tabular">
                {Math.ceil(sleepRemainingSec / 60)} min
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {[0, 15, 30, 60, 90].map((mins) => (
              <button
                key={mins}
                type="button"
                onClick={() => setSleep(mins)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold luma-tabular ${
                  preferences.sleepTimerMinutes === mins
                    ? isM3
                      ? 'm3-primary-pill'
                      : 'lg-pill-active'
                    : isM3
                      ? 'm3-secondary-tonal'
                      : 'lg-capsule text-slate-200'
                }`}
              >
                {mins === 0 ? t.sleepOff : `${mins} min`}
              </button>
            ))}
          </div>

          <div className="border-t border-white/10 pt-3 space-y-2.5">
            <label className="flex items-center gap-2.5 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={Boolean(preferences.autoMiniPlayerOnSwitch)}
                onChange={(e) =>
                  onChangePreferences({
                    ...preferences,
                    autoMiniPlayerOnSwitch: e.target.checked,
                  })
                }
                className="h-4 w-4 accent-sky-400"
              />
              <PictureInPicture2 className="h-4 w-4 shrink-0 text-sky-300" />
              <span>{t.autoMiniPlayerToggleLabel}</span>
            </label>

            <label className="flex items-center gap-2.5 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={preferences.spatialDpadEnabled}
                onChange={(e) =>
                  onChangePreferences({
                    ...preferences,
                    spatialDpadEnabled: e.target.checked,
                  })
                }
                className="h-4 w-4 accent-sky-400"
              />
              <Gamepad2 className="h-4 w-4 shrink-0 text-sky-300" />
              <span>{t.dpadToggleLabel}</span>
            </label>
          </div>
        </div>

        {/* Stream Buffer & Decoder Tuning */}
        <div className={`${panelClass} space-y-3`}>
          <div className="flex items-center gap-2 text-xs font-semibold text-white">
            <Sliders className="h-4 w-4 text-sky-400" />
            <span>{t.bufferProfileTitle}</span>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {(
              [
                ['low-latency', t.bufferSportLabel, t.bufferSportSub],
                ['balanced', t.bufferBalancedLabel, t.bufferBalancedSub],
                ['cinema-max', t.bufferCinemaLabel, t.bufferCinemaSub],
              ] as [BufferProfile, string, string][]
            ).map(([prof, title, sub]) => {
              const active = preferences.bufferProfile === prof;
              return (
                <button
                  key={prof}
                  type="button"
                  onClick={() => setBuffer(prof)}
                  className={`p-3 text-left transition ${
                    isM3 ? 'rounded-[20px]' : 'rounded-[18px]'
                  } ${
                    active
                      ? isM3
                        ? 'm3-tonal-active ring-1 ring-[#7FD4FF]/60'
                        : 'lg-pill-active'
                      : isM3
                        ? 'bg-[#232B3D]'
                        : 'lg-capsule'
                  }`}
                >
                  <div className="text-xs font-semibold text-white">{title}</div>
                  <div className="text-[10px] opacity-75">{sub}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Automatic Background Playlist & XMLTV Refresh */}
        <div className={`${panelClass} space-y-3`}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-white">
              <RefreshCw className="h-4 w-4 text-sky-400" />
              <span>Auto Playlist &amp; EPG Refresh</span>
            </div>
            <span className="text-[11px] text-slate-400">
              {(preferences.autoRefreshHours ?? 12) === 0
                ? t.sleepOff
                : `Every ${preferences.autoRefreshHours ?? 12}h`}
            </span>
          </div>

          <p className="text-[11px] text-slate-400">
            Automatically refreshes Xtream &amp; M3U URL playlists and XMLTV schedules in
            the background without interrupting playback.
          </p>

          <div className="flex flex-wrap gap-2 pt-0.5">
            {[
              { hours: 0, label: t.sleepOff },
              { hours: 6, label: '6h' },
              { hours: 12, label: '12h' },
              { hours: 24, label: '24h' },
            ].map((opt) => {
              const currentHours = preferences.autoRefreshHours ?? 12;
              const active = currentHours === opt.hours;
              return (
                <button
                  key={opt.hours}
                  type="button"
                  onClick={() =>
                    onChangePreferences({
                      ...preferences,
                      autoRefreshHours: opt.hours,
                    })
                  }
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold luma-tabular ${
                    active
                      ? isM3
                        ? 'm3-primary-pill'
                        : 'lg-pill-active'
                      : isM3
                        ? 'm3-secondary-tonal'
                        : 'lg-capsule text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Cross-Platform JSON Backup Export & Restore */}
        <div className={`${panelClass} space-y-3`}>
          <div className="text-xs font-semibold text-white">{t.backupTitle}</div>
          <p className="text-[11px] text-slate-400">{t.backupSubtitle}</p>

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={exportBackupJson}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold ${
                isM3 ? 'm3-primary-pill' : 'lg-pill-active'
              }`}
            >
              <Download className="h-3.5 w-3.5" />
              <span>{t.exportBackupBtn}</span>
            </button>

            <label
              className={`inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold ${
                isM3 ? 'm3-secondary-tonal' : 'lg-capsule text-white'
              }`}
            >
              <FileUp className="h-3.5 w-3.5" />
              <span>{t.importBackupBtn}</span>
              <input
                type="file"
                accept=".json"
                onChange={handleBackupImportFile}
                className="hidden"
              />
            </label>
          </div>
        </div>
      </div>

      {/* Parental Control 4-Digit PIN Lock */}
      <div className={`${panelClass} space-y-3`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-white">
            <ShieldAlert className="h-4 w-4 text-amber-300" />
            <span>Parental Control (4-Digit PIN)</span>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={parentalConfig.enabled}
                onChange={(e) =>
                  onChangeParentalConfig({
                    ...parentalConfig,
                    enabled: e.target.checked,
                  })
                }
                className="h-4 w-4 accent-sky-400"
              />
              <span>Enable PIN Lock</span>
            </label>

            <input
              type="password"
              maxLength={4}
              value={newPin}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, '').slice(0, 4);
                setNewPin(digits);
                if (digits.length === 4) {
                  onChangeParentalConfig({ ...parentalConfig, pin: digits });
                }
              }}
              placeholder="PIN"
              className={
                isM3
                  ? 'h-8.5 w-24 rounded-full bg-[#232B3D] px-3 text-center font-mono text-xs text-white focus:outline-none luma-tabular'
                  : 'lg-capsule h-8.5 w-24 rounded-full px-3 text-center font-mono text-xs text-white focus:outline-none luma-tabular'
              }
            />
          </div>
        </div>

        <div className="luma-scroll flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
          {groups.slice(0, 80).map((g) => {
            const locked = parentalConfig.lockedGroupIds.includes(g.id);
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => toggleGroupPinLock(g.id)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium transition ${
                  locked
                    ? 'bg-amber-400/20 text-amber-200 ring-1 ring-amber-400/50'
                    : 'bg-white/[0.06] text-slate-300 hover:bg-white/10'
                }`}
              >
                {locked ? (
                  <Lock className="h-3 w-3 text-amber-300" />
                ) : (
                  <LockOpen className="h-3 w-3 text-slate-400" />
                )}
                <span>{g.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
