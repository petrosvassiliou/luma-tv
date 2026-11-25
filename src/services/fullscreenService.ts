export type FullscreenBackendMode =
  | 'dom'
  | 'android-bridge'
  | 'tauri-window'
  | 'stage-fallback';

export interface LumaAndroidWindowBridge {
  setFullscreen?: (enabled: boolean) => void;
  toggleFullscreen?: () => boolean;
  isFullscreen?: () => boolean;
}

interface VendorFullscreenDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}

interface VendorFullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

interface FullscreenRuntimeWindow extends Window {
  LumaAndroidWindow?: LumaAndroidWindowBridge;
  __TAURI_INTERNALS__?: {
    invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  };
}

export function getNativeDomFullscreenElement(
  doc: Document | undefined = typeof document !== 'undefined' ? document : undefined
): Element | null {
  if (!doc) return null;
  const vendorDoc = doc as VendorFullscreenDocument;
  return doc.fullscreenElement ?? vendorDoc.webkitFullscreenElement ?? null;
}

export function hasAndroidWindowBridge(
  win: Window | undefined = typeof window !== 'undefined' ? window : undefined
): boolean {
  if (!win) return false;
  const runtimeWin = win as FullscreenRuntimeWindow;
  return typeof runtimeWin.LumaAndroidWindow?.setFullscreen === 'function';
}

export function isAndroidWindowBridgeFullscreen(
  win: Window | undefined = typeof window !== 'undefined' ? window : undefined
): boolean {
  if (!win) return false;
  const runtimeWin = win as FullscreenRuntimeWindow;
  try {
    return Boolean(runtimeWin.LumaAndroidWindow?.isFullscreen?.());
  } catch {
    return false;
  }
}

/**
 * Enters fullscreen across all Luma TV targets:
 * 1. Android / Googlebook (ChromeOS ARCVM) APK via `window.LumaAndroidWindow` immersive WindowInsets bridge.
 * 2. Desktop / Web / PWA via HTML5 `requestFullscreen()` / `webkitRequestFullscreen()`.
 * 3. Detects silent Android WebView cancellations (`RustWebChromeClient.onShowCustomView` calling
 *    `onCustomViewHidden()`, where `requestFullscreen()` resolves with `fullscreenElement === null`)
 *    and falls back to Tauri Desktop `plugin:window|set_fullscreen` or Luma's 100% viewport Cinema Stage.
 */
export async function enterLumaFullscreen(
  targetEl: HTMLElement | null,
  options?: { win?: Window; doc?: Document }
): Promise<FullscreenBackendMode> {
  const win = options?.win ?? (typeof window !== 'undefined' ? window : undefined);
  const doc = options?.doc ?? (typeof document !== 'undefined' ? document : undefined);
  const runtimeWin = win as FullscreenRuntimeWindow | undefined;

  // 1. Native Android / Googlebook ARCVM Activity immersive fullscreen bridge
  if (runtimeWin?.LumaAndroidWindow?.setFullscreen) {
    try {
      runtimeWin.LumaAndroidWindow.setFullscreen(true);
      return 'android-bridge';
    } catch {
      // Fall through to DOM / stage fallback
    }
  }

  // 2. Standard HTML5 / Safari WebKit Element Fullscreen
  if (targetEl && doc) {
    const vendorEl = targetEl as VendorFullscreenElement;
    const reqFn =
      typeof targetEl.requestFullscreen === 'function'
        ? () => targetEl.requestFullscreen()
        : typeof vendorEl.webkitRequestFullscreen === 'function'
          ? () => vendorEl.webkitRequestFullscreen!()
          : null;

    if (reqFn) {
      try {
        await reqFn();
        if (getNativeDomFullscreenElement(doc)) {
          return 'dom';
        }
        // Allow one short tick for asynchronous WebKit/Chromium fullscreen transitions
        await new Promise<void>((resolve) => setTimeout(resolve, 35));
        if (getNativeDomFullscreenElement(doc)) {
          return 'dom';
        }
      } catch {
        // Element fullscreen rejected; proceed to Tauri / stage fallback
      }
    }
  }

  // 3. Tauri v2 Desktop native window fullscreen fallback
  const invoke = runtimeWin?.__TAURI_INTERNALS__?.invoke;
  if (invoke) {
    try {
      await invoke('plugin:window|set_fullscreen', { label: 'main', value: true });
      return 'tauri-window';
    } catch {
      // On Tauri Android `plugin:window|set_fullscreen` is desktop-gated; fall through cleanly
    }
  }

  // 4. Guaranteed 100% viewport in-app Cinema Stage fullscreen
  return 'stage-fallback';
}

export async function exitLumaFullscreen(options?: {
  win?: Window;
  doc?: Document;
}): Promise<void> {
  const win = options?.win ?? (typeof window !== 'undefined' ? window : undefined);
  const doc = options?.doc ?? (typeof document !== 'undefined' ? document : undefined);
  const runtimeWin = win as FullscreenRuntimeWindow | undefined;

  if (runtimeWin?.LumaAndroidWindow?.setFullscreen) {
    try {
      runtimeWin.LumaAndroidWindow.setFullscreen(false);
    } catch {
      // Ignore bridge error
    }
  }

  if (doc && getNativeDomFullscreenElement(doc)) {
    const vendorDoc = doc as VendorFullscreenDocument;
    try {
      if (typeof doc.exitFullscreen === 'function') {
        await doc.exitFullscreen();
      } else if (typeof vendorDoc.webkitExitFullscreen === 'function') {
        await vendorDoc.webkitExitFullscreen();
      }
    } catch {
      // Ignore DOM exit error
    }
  }

  const invoke = runtimeWin?.__TAURI_INTERNALS__?.invoke;
  if (invoke) {
    try {
      const isNativeWinFs = await invoke<boolean>('plugin:window|is_fullscreen', {
        label: 'main',
      });
      if (isNativeWinFs) {
        await invoke('plugin:window|set_fullscreen', { label: 'main', value: false });
      }
    } catch {
      // Desktop-only command; ignore on mobile/web
    }
  }
}
