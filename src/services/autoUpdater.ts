import { LUMA_APP_VERSION } from '../types/luma';

export const LUMA_GITHUB_RELEASES_API =
  'https://api.github.com/repos/petrosvassiliou/luma-tv/releases?per_page=8';

export type UpdateDeliveryStrategy =
  | 'macos-in-app-ed25519'
  | 'android-play-protect-verified'
  | 'web-pwa-sw';

export interface LumaUpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseTitle: string;
  releaseNotes: string;
  publishedAt: string;
  htmlUrl: string;
  strategy: UpdateDeliveryStrategy;
  canInstallInApp: boolean;
  latestJsonUrl?: string | null;
  macosDmgUrl?: string | null;
  androidApkUrl?: string | null;
  androidApkSizeBytes?: number | null;
  androidApkSha256?: string | null;
  playProtectCompatible: boolean;
}

export interface LumaUpdateProgressPayload {
  phase:
    | 'idle'
    | 'downloading'
    | 'verifying'
    | 'installing'
    | 'restarting'
    | 'ready'
    | 'error';
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  message?: string;
}

interface ParsedSemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: (string | number)[];
}

export function parseLumaSemVer(raw: string): ParsedSemVer | null {
  const cleaned = raw.trim().replace(/^v/i, '').split('+')[0];
  if (!cleaned) return null;
  const dashIdx = cleaned.indexOf('-');
  const corePart = dashIdx >= 0 ? cleaned.slice(0, dashIdx) : cleaned;
  const prePart = dashIdx >= 0 ? cleaned.slice(dashIdx + 1) : '';

  const nums = corePart.split('.');
  if (nums.length < 3) return null;
  const major = Number(nums[0]);
  const minor = Number(nums[1]);
  const patch = Number(nums[2]);
  if (
    !Number.isInteger(major) ||
    !Number.isInteger(minor) ||
    !Number.isInteger(patch) ||
    major < 0 ||
    minor < 0 ||
    patch < 0
  ) {
    return null;
  }

  const prerelease: (string | number)[] = prePart
    ? prePart.split('.').map((seg) => (/^\d+$/.test(seg) ? Number(seg) : seg.toLowerCase()))
    : [];

  return { major, minor, patch, prerelease };
}

/**
 * Compares two SemVer 2.0 strings (`0.8.0-beta.1` < `0.8.0-beta.2` < `0.8.0` < `0.8.1-beta.1`).
 * Returns `1` if `a > b`, `-1` if `a < b`, or `0` if equal.
 */
export function compareLumaVersions(a: string, b: string): number {
  const pa = parseLumaSemVer(a);
  const pb = parseLumaSemVer(b);
  if (!pa || !pb) return a.localeCompare(b);

  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;

  // A stable version without prerelease is higher than a prerelease of the same core version
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0;
  if (pa.prerelease.length === 0) return 1;
  if (pb.prerelease.length === 0) return -1;

  const len = Math.max(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < len; i++) {
    const idA = pa.prerelease[i];
    const idB = pb.prerelease[i];
    if (idA === undefined) return -1;
    if (idB === undefined) return 1;
    if (idA === idB) continue;

    const numA = typeof idA === 'number';
    const numB = typeof idB === 'number';
    if (numA && numB) return idA > idB ? 1 : -1;
    // Numeric identifiers have lower precedence than non-numeric per SemVer 2.0
    if (numA) return -1;
    if (numB) return 1;
    return String(idA) > String(idB) ? 1 : -1;
  }

  return 0;
}

export interface GitHubReleaseAssetPayload {
  name?: string;
  browser_download_url?: string;
  size?: number;
  digest?: string | null;
}

export interface GitHubReleasePayload {
  tag_name?: string;
  name?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string;
  html_url?: string;
  assets?: GitHubReleaseAssetPayload[];
}

export function evaluateGitHubReleasesForUpdate(params: {
  releases: GitHubReleasePayload[];
  currentVersion?: string;
  includePrereleases?: boolean;
  runtimePlatform: 'macos' | 'android' | 'web' | 'desktop';
}): LumaUpdateCheckResult {
  const currentVersion = (params.currentVersion || LUMA_APP_VERSION).replace(/^v/i, '');
  const includePrereleases = params.includePrereleases !== false;

  const strategy: UpdateDeliveryStrategy =
    params.runtimePlatform === 'macos' || params.runtimePlatform === 'desktop'
      ? 'macos-in-app-ed25519'
      : params.runtimePlatform === 'android'
        ? 'android-play-protect-verified'
        : 'web-pwa-sw';

  const candidates = params.releases.filter((r) => {
    if (!r || r.draft || !r.tag_name) return false;
    if (!includePrereleases && r.prerelease) return false;
    return parseLumaSemVer(r.tag_name) !== null;
  });

  candidates.sort((a, b) => compareLumaVersions(b.tag_name || '0.0.0', a.tag_name || '0.0.0'));
  const newest = candidates[0];

  if (!newest || !newest.tag_name) {
    return {
      updateAvailable: false,
      currentVersion,
      latestVersion: currentVersion,
      releaseTitle: `Luma TV v${currentVersion}`,
      releaseNotes: '',
      publishedAt: '',
      htmlUrl: 'https://github.com/petrosvassiliou/luma-tv/releases',
      strategy,
      canInstallInApp: strategy === 'macos-in-app-ed25519',
      playProtectCompatible: true,
    };
  }

  const latestVersion = newest.tag_name.replace(/^v/i, '');
  const isNewer = compareLumaVersions(latestVersion, currentVersion) > 0;
  const assets = newest.assets ?? [];

  const latestJsonAsset = assets.find((a) => a.name === 'latest.json');
  const dmgAsset = assets.find((a) => a.name?.endsWith('.dmg'));
  const apkAsset = assets.find((a) => a.name?.endsWith('.apk'));
  const rawDigest = apkAsset?.digest || '';
  const sha256 = rawDigest.startsWith('sha256:') ? rawDigest.slice(7) : rawDigest || null;

  const canInstallInApp =
    strategy === 'macos-in-app-ed25519' && Boolean(latestJsonAsset?.browser_download_url);

  return {
    updateAvailable: isNewer,
    currentVersion,
    latestVersion,
    releaseTitle: newest.name || `Luma TV v${latestVersion}`,
    releaseNotes: newest.body || '',
    publishedAt: newest.published_at || '',
    htmlUrl:
      newest.html_url ||
      `https://github.com/petrosvassiliou/luma-tv/releases/tag/${newest.tag_name}`,
    strategy,
    canInstallInApp,
    latestJsonUrl: latestJsonAsset?.browser_download_url ?? null,
    macosDmgUrl: dmgAsset?.browser_download_url ?? null,
    androidApkUrl: apkAsset?.browser_download_url ?? null,
    androidApkSizeBytes: apkAsset?.size ?? null,
    androidApkSha256: sha256,
    playProtectCompatible: true,
  };
}

interface TauriUpdaterBridgeWindow {
  __TAURI_INTERNALS__?: {
    invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  };
}

function getTauriInvoke() {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as TauriUpdaterBridgeWindow;
  return w.__TAURI_INTERNALS__?.invoke ?? null;
}

export async function checkForLumaAppUpdate(params?: {
  includePrereleases?: boolean;
  detectedPlatformHint?: string;
}): Promise<LumaUpdateCheckResult> {
  const includePrereleases = params?.includePrereleases !== false;
  const invoke = getTauriInvoke();

  let runtimePlatform: 'macos' | 'android' | 'web' | 'desktop' = 'web';
  let rawJsonText = '';

  if (invoke) {
    try {
      const probe = await invoke<{ platform: string }>('luma_native_probe_engine');
      if (probe.platform === 'macos') runtimePlatform = 'macos';
      else if (probe.platform === 'android') runtimePlatform = 'android';
      else runtimePlatform = 'desktop';
    } catch {
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
      runtimePlatform = ua.includes('android') ? 'android' : 'macos';
    }

    rawJsonText = await invoke<string>('luma_native_fetch_text', {
      url: LUMA_GITHUB_RELEASES_API,
      userAgent: `LumaTV/${LUMA_APP_VERSION} (AutoUpdater)`,
    });
  } else {
    const res = await fetch(LUMA_GITHUB_RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) {
      throw new Error(`Update server responded with HTTP ${res.status}`);
    }
    rawJsonText = await res.text();
  }

  const releases = JSON.parse(rawJsonText) as GitHubReleasePayload[];
  return evaluateGitHubReleasesForUpdate({
    releases: Array.isArray(releases) ? releases : [],
    currentVersion: LUMA_APP_VERSION,
    includePrereleases,
    runtimePlatform,
  });
}

/**
 * Performs the platform-appropriate, security-compliant update action:
 * - macOS / Desktop Tauri: Cryptographically verifies Ed25519 signature (`Luma.app.tar.gz.sig`),
 *   downloads & installs the `.app` update **in-app** with live progress, and restarts Luma TV.
 *   (If an older release lacks `latest.json`, gracefully opens the Universal `.dmg`.)
 * - Android / Android TV / Chromebook (Google Play Protect Compatible):
 *   Never uses `REQUEST_INSTALL_PACKAGES` or dynamic code execution. Triggers a user-initiated
 *   HTTPS download of the V2/V3 release-signed APK via the trusted system browser / PackageInstaller.
 * - Web / ChromeOS PWA: Refreshes Service Worker registration and reloads the app.
 */
export async function triggerLumaUpdateInstall(
  checkResult: LumaUpdateCheckResult,
  onProgress?: (progress: LumaUpdateProgressPayload) => void
): Promise<void> {
  const invoke = getTauriInvoke();

  if (checkResult.strategy === 'macos-in-app-ed25519' && invoke) {
    if (checkResult.canInstallInApp && checkResult.latestJsonUrl) {
      onProgress?.({
        phase: 'downloading',
        downloadedBytes: 0,
        totalBytes: 0,
        percent: 5,
        message: `Downloading Luma TV v${checkResult.latestVersion} inside app…`,
      });

      // Poll native Rust download & signature verification progress smoothly
      let pollTimer: number | null = null;
      if (typeof window !== 'undefined') {
        pollTimer = window.setInterval(() => {
          invoke<LumaUpdateProgressPayload>('luma_native_get_update_progress')
            .then((snap) => {
              if (snap && snap.phase && snap.phase !== 'idle') {
                onProgress?.(snap);
              }
            })
            .catch(() => undefined);
        }, 250);
      }

      try {
        await invoke<string>('luma_native_install_macos_update', {
          latestJsonUrl: checkResult.latestJsonUrl,
        });
        onProgress?.({
          phase: 'restarting',
          downloadedBytes: 100,
          totalBytes: 100,
          percent: 100,
          message: 'Update installed! Restarting Luma TV…',
        });
      } finally {
        if (pollTimer !== null && typeof window !== 'undefined') {
          window.clearInterval(pollTimer);
        }
      }
      return;
    }

    // Fallback if target release was published before `latest.json` artifacts existed
    const fallbackUrl = checkResult.macosDmgUrl || checkResult.htmlUrl;
    try {
      await invoke('luma_native_open_external_url', { url: fallbackUrl });
    } catch {
      window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
    }
    return;
  }

  if (checkResult.strategy === 'android-play-protect-verified') {
    const targetUrl = checkResult.androidApkUrl || checkResult.htmlUrl;
    onProgress?.({
      phase: 'ready',
      downloadedBytes: 0,
      totalBytes: checkResult.androidApkSizeBytes ?? 0,
      percent: 100,
      message:
        'Opening Android System Installer (Google Play Protect verified V2/V3 release signature).',
    });
    // Use standard user-initiated external anchor navigation so Tauri Android WebView
    // routes the HTTPS APK URL directly to Chrome / System DownloadManager + Play Protect
    // with zero REQUEST_INSTALL_PACKAGES permissions.
    const a = document.createElement('a');
    a.href = targetUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return;
  }

  // Web / ChromeOS PWA Service Worker refresh
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      await reg?.update();
    } catch {
      // Ignore
    }
  }
  window.location.reload();
}
