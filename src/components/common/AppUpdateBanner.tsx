import React from 'react';
import {
  Download,
  Loader2,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  LumaUpdateCheckResult,
  LumaUpdateProgressPayload,
} from '../../services/autoUpdater';
import type { PlatformDesignMode } from '../../types/luma';

interface AppUpdateBannerProps {
  designMode: PlatformDesignMode;
  updateInfo: LumaUpdateCheckResult;
  installProgress: LumaUpdateProgressPayload | null;
  isInstalling: boolean;
  onInstallNow: () => void;
  onDismiss: () => void;
}

export const AppUpdateBanner: React.FC<AppUpdateBannerProps> = ({
  designMode,
  updateInfo,
  installProgress,
  isInstalling,
  onInstallNow,
  onDismiss,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const isAndroid = updateInfo.strategy === 'android-play-protect-verified';
  const isMacInApp = updateInfo.strategy === 'macos-in-app-ed25519';

  const actionLabel = isMacInApp
    ? updateInfo.canInstallInApp
      ? 'Update & Restart Inside App'
      : 'Download macOS Update'
    : isAndroid
      ? 'Update APK (Play Protect Verified)'
      : 'Reload to Update';

  return (
    <div
      role="status"
      aria-live="polite"
      className={
        isM3
          ? 'relative z-20 mx-3 mt-2 flex flex-wrap items-center justify-between gap-3 rounded-[22px] bg-[#1E293B] px-4 py-2.5 text-xs text-white shadow-lg ring-1 ring-[#7FD4FF]/40'
          : 'lg-pane relative z-20 mx-2.5 mt-2 flex flex-wrap items-center justify-between gap-3 rounded-[18px] px-4 py-2 text-xs text-white ring-1 ring-sky-400/35'
      }
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
            isM3 ? 'bg-[#7FD4FF]/20 text-[#7FD4FF]' : 'bg-sky-400/20 text-sky-300'
          }`}
        >
          {isInstalling ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-white">
              Luma TV v{updateInfo.latestVersion} available
            </span>
            <span className="text-[11px] text-slate-400 luma-tabular">
              (current: v{updateInfo.currentVersion})
            </span>

            {isAndroid && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-400/30">
                <ShieldCheck className="h-3 w-3" />
                <span>Google Play Protect Compatible · V3 Signed</span>
              </span>
            )}

            {isMacInApp && updateInfo.canInstallInApp && (
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-400/15 px-2.5 py-0.5 text-[10px] font-semibold text-sky-200 ring-1 ring-sky-400/30">
                <ShieldCheck className="h-3 w-3" />
                <span>In-App Ed25519 Signed</span>
              </span>
            )}
          </div>

          {isInstalling && installProgress ? (
            <div className="mt-1.5 flex items-center gap-3">
              <div className="h-1.5 w-48 overflow-hidden rounded-full bg-white/15 sm:w-64">
                <div
                  className={`h-full transition-all duration-200 ${
                    isM3 ? 'bg-[#7FD4FF]' : 'luma-accent-gradient'
                  }`}
                  style={{ width: `${Math.max(5, installProgress.percent)}%` }}
                />
              </div>
              <span className="truncate text-[11px] text-sky-200 luma-tabular">
                {installProgress.percent}% · {installProgress.message || installProgress.phase}
              </span>
            </div>
          ) : (
            updateInfo.androidApkSha256 &&
            isAndroid && (
              <div className="mt-0.5 truncate font-mono text-[10px] text-slate-400">
                SHA-256: {updateInfo.androidApkSha256.slice(0, 24)}…
              </div>
            )
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          id="btn-install-app-update"
          type="button"
          disabled={isInstalling}
          onClick={onInstallNow}
          className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
            isM3 ? 'm3-primary-pill' : 'lg-pill-active'
          }`}
        >
          {isInstalling ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          <span>{isInstalling ? 'Updating…' : actionLabel}</span>
        </button>

        {!isInstalling && (
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-full p-1.5 text-slate-300 hover:bg-white/10 hover:text-white"
            title="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};
