import React, { useState } from 'react';
import {
  CheckCircle2,
  Cloud,
  CloudDownload,
  CloudUpload,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  Mail,
  RefreshCw,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import type { LumaCloudSessionInfo } from '../../services/lumaCloudSync';
import type { PlatformDesignMode } from '../../types/luma';

export interface CloudSyncUiState {
  session: LumaCloudSessionInfo | null;
  autoSyncEnabled: boolean;
  syncPlaylistsEnabled: boolean;
  isBusy: boolean;
  isHydratingPlaylists?: boolean;
  lastSyncedAtMs: number | null;
  lastSyncedDeviceLabel?: string | null;
  statusMessage: string | null;
  errorMessage: string | null;
  summaryCounts: {
    playlists: number;
    favorites: number;
    collections: number;
    history: number;
  };
}

export interface CloudSyncActions {
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignUp: (email: string, password: string) => Promise<void>;
  onUnlockVault: (password: string) => Promise<void>;
  onSendPasswordReset: (email: string) => Promise<void>;
  onSignOut: () => Promise<void>;
  onPushNow: () => Promise<void>;
  onPullNow: () => Promise<void>;
  onToggleAutoSync: (enabled: boolean) => void;
  onToggleSyncPlaylists: (enabled: boolean) => void;
}

interface LumaCloudSyncCardProps {
  designMode: PlatformDesignMode;
  cloudState: CloudSyncUiState;
  cloudActions: CloudSyncActions;
}

export const LumaCloudSyncCard: React.FC<LumaCloudSyncCardProps> = ({
  designMode,
  cloudState,
  cloudActions,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const panelClass = isM3 ? 'rounded-[28px] bg-[#1A202E] p-5' : 'lg-pane rounded-[24px] p-5';
  const inputClass = isM3
    ? 'h-9.5 w-full rounded-full bg-[#232B3D] pl-9 pr-4 text-xs text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#7FD4FF]/60'
    : 'lg-capsule h-9.5 w-full rounded-full pl-9 pr-4 text-xs text-white placeholder:text-white/45 focus:outline-none';

  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const { session, isBusy, summaryCounts } = cloudState;

  const handleSubmitAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    if (authMode === 'signup') {
      await cloudActions.onSignUp(email, password);
    } else {
      await cloudActions.onSignIn(email, password);
    }
    setPassword('');
  };

  const handleSubmitUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    await cloudActions.onUnlockVault(password);
    setPassword('');
  };

  const formattedLastSync = cloudState.lastSyncedAtMs
    ? new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }).format(cloudState.lastSyncedAtMs)
    : null;

  return (
    <div id="luma-cloud-sync-card" className={`${panelClass} space-y-3.5`}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <Cloud className="h-4 w-4 text-sky-400" />
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-white">
              <span>Firebase Cloud Sync</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-400/30">
                <ShieldCheck className="h-3 w-3" />
                <span>AES-256-GCM Encrypted · EU (eur3)</span>
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Sync playlists, favorites (Live, Movies &amp; Series), collections, watch
              progress, and settings across macOS, Googlebook, Android TV &amp; Web.
            </p>
          </div>
        </div>

        {session && (
          <button
            id="btn-cloud-signout"
            type="button"
            disabled={isBusy}
            onClick={() => void cloudActions.onSignOut()}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold transition disabled:opacity-50 ${
              isM3 ? 'm3-secondary-tonal' : 'lg-capsule text-slate-200 hover:text-white'
            }`}
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Sign Out</span>
          </button>
        )}
      </div>

      {/* 1. SIGNED OUT: Sign In / Create Account Form */}
      {!session && (
        <form onSubmit={(e) => void handleSubmitAuth(e)} className="space-y-3 pt-1">
          <div className="inline-flex rounded-full bg-black/25 p-1">
            <button
              id="btn-cloud-tab-signin"
              type="button"
              onClick={() => setAuthMode('signin')}
              className={`rounded-full px-3.5 py-1 text-xs font-semibold transition ${
                authMode === 'signin'
                  ? isM3
                    ? 'm3-primary-pill'
                    : 'lg-pill-active'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              Sign In
            </button>
            <button
              id="btn-cloud-tab-signup"
              type="button"
              onClick={() => setAuthMode('signup')}
              className={`inline-flex items-center gap-1 rounded-full px-3.5 py-1 text-xs font-semibold transition ${
                authMode === 'signup'
                  ? isM3
                    ? 'm3-primary-pill'
                    : 'lg-pill-active'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <UserPlus className="h-3 w-3" />
              <span>Create Account</span>
            </button>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div className="relative flex items-center">
              <Mail className="pointer-events-none absolute left-3.5 h-3.5 w-3.5 text-slate-400" />
              <input
                id="input-cloud-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address…"
                className={inputClass}
              />
            </div>

            <div className="relative flex items-center">
              <KeyRound className="pointer-events-none absolute left-3.5 h-3.5 w-3.5 text-slate-400" />
              <input
                id="input-cloud-password"
                type="password"
                autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={
                  authMode === 'signup'
                    ? 'Choose password (min. 6 chars)…'
                    : 'Account password…'
                }
                className={inputClass}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            <button
              id="btn-cloud-submit-auth"
              type="submit"
              disabled={isBusy || !email.trim() || password.length < 6}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition disabled:opacity-45 ${
                isM3 ? 'm3-primary-pill' : 'lg-pill-active'
              }`}
            >
              {isBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Lock className="h-3.5 w-3.5" />
              )}
              <span>
                {authMode === 'signup'
                  ? 'Create Account & Enable Sync'
                  : 'Sign In & Sync Devices'}
              </span>
            </button>

            {authMode === 'signin' && (
              <button
                type="button"
                disabled={isBusy || !email.trim()}
                onClick={() => void cloudActions.onSendPasswordReset(email)}
                className="text-[11px] font-medium text-sky-300 hover:text-sky-200 disabled:opacity-40"
              >
                Forgot password?
              </button>
            )}
          </div>
        </form>
      )}

      {/* 2. SIGNED IN, VAULT KEY NEEDS ONE-TIME UNLOCK */}
      {session && !session.hasVaultKey && (
        <form onSubmit={(e) => void handleSubmitUnlock(e)} className="space-y-2.5 pt-1">
          <div className="text-xs text-amber-200">
            Signed in as <span className="font-semibold">{session.email}</span>. Enter
            your password once to unlock end-to-end AES-256-GCM sync on this device:
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex flex-1 items-center">
              <KeyRound className="pointer-events-none absolute left-3.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Account password…"
                className={inputClass}
              />
            </div>
            <button
              type="submit"
              disabled={isBusy || !password}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold disabled:opacity-45 ${
                isM3 ? 'm3-primary-pill' : 'lg-pill-active'
              }`}
            >
              <Lock className="h-3.5 w-3.5" />
              <span>Unlock Sync</span>
            </button>
          </div>
        </form>
      )}

      {/* 3. SIGNED IN & UNLOCKED: Live Auto-Sync Controls */}
      {session && session.hasVaultKey && (
        <div className="space-y-3 pt-1">
          <div
            className={`flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-xs ${
              isM3 ? 'rounded-[20px] bg-[#232B3D]' : 'lg-capsule rounded-[18px]'
            }`}
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              <div>
                <div className="font-semibold text-white">
                  {session.email || 'Cloud Account Active'}
                </div>
                <div className="text-[11px] text-slate-300/85 luma-tabular">
                  {summaryCounts.playlists} Playlists · {summaryCounts.favorites}{' '}
                  Favorites · {summaryCounts.collections} Collections ·{' '}
                  {summaryCounts.history} History items
                </div>
              </div>
            </div>

            {formattedLastSync && (
              <div className="text-[11px] text-sky-200 luma-tabular">
                Synced {formattedLastSync}
                {cloudState.lastSyncedDeviceLabel
                  ? ` · ${cloudState.lastSyncedDeviceLabel}`
                  : ''}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-5">
            <label className="flex items-center gap-2 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={cloudState.autoSyncEnabled}
                onChange={(e) => cloudActions.onToggleAutoSync(e.target.checked)}
                className="h-4 w-4 accent-sky-400"
              />
              <span>Real-time auto-sync across devices</span>
            </label>

            <label className="flex items-center gap-2 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={cloudState.syncPlaylistsEnabled}
                onChange={(e) => cloudActions.onToggleSyncPlaylists(e.target.checked)}
                className="h-4 w-4 accent-sky-400"
              />
              <span>Sync M3U &amp; Xtream playlists (encrypted)</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <button
              id="btn-cloud-push-now"
              type="button"
              disabled={isBusy}
              onClick={() => void cloudActions.onPushNow()}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition disabled:opacity-50 ${
                isM3 ? 'm3-primary-pill' : 'lg-pill-active'
              }`}
            >
              {isBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CloudUpload className="h-3.5 w-3.5" />
              )}
              <span>Sync Now</span>
            </button>

            <button
              id="btn-cloud-pull-now"
              type="button"
              disabled={isBusy}
              onClick={() => void cloudActions.onPullNow()}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold transition disabled:opacity-50 ${
                isM3 ? 'm3-secondary-tonal' : 'lg-capsule text-white'
              }`}
            >
              <CloudDownload className="h-3.5 w-3.5" />
              <span>Pull from Cloud</span>
            </button>

            {cloudState.isHydratingPlaylists && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-sky-300">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                <span>Importing synced playlists in background…</span>
              </span>
            )}
          </div>
        </div>
      )}

      {cloudState.errorMessage && (
        <div className="rounded-xl bg-rose-500/15 px-3.5 py-2 text-xs text-rose-200 ring-1 ring-rose-400/30">
          {cloudState.errorMessage}
        </div>
      )}

      {cloudState.statusMessage && !cloudState.errorMessage && (
        <div className="text-xs font-medium text-emerald-300">
          {cloudState.statusMessage}
        </div>
      )}
    </div>
  );
};
