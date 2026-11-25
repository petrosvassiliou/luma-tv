import { describe, expect, it, vi } from 'vitest';
import {
  enterLumaFullscreen,
  exitLumaFullscreen,
  getNativeDomFullscreenElement,
} from './fullscreenService';

describe('fullscreenService (Googlebook, Android WebView, Tauri Desktop & Web)', () => {
  it('uses LumaAndroidWindow native immersive bridge when running on Googlebook / Android APK', async () => {
    const setFullscreen = vi.fn();
    const fakeWin = {
      LumaAndroidWindow: {
        setFullscreen,
        isFullscreen: () => true,
      },
    } as unknown as Window;
    const fakeDoc = { fullscreenElement: null } as unknown as Document;
    const fakeEl = {} as HTMLElement;

    const mode = await enterLumaFullscreen(fakeEl, { win: fakeWin, doc: fakeDoc });
    expect(mode).toBe('android-bridge');
    expect(setFullscreen).toHaveBeenCalledWith(true);

    await exitLumaFullscreen({ win: fakeWin, doc: fakeDoc });
    expect(setFullscreen).toHaveBeenCalledWith(false);
  });

  it('falls back to stage-fallback when Android WebView silently cancels requestFullscreen()', async () => {
    // Simulates Tauri wry RustWebChromeClient.onShowCustomView calling callback.onCustomViewHidden(),
    // where requestFullscreen() resolves without error while document.fullscreenElement stays null.
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const invoke = vi.fn().mockRejectedValue(new Error('Command set_fullscreen not found on mobile'));

    const fakeWin = {
      __TAURI_INTERNALS__: { invoke },
    } as unknown as Window;
    const fakeDoc = { fullscreenElement: null } as unknown as Document;
    const fakeEl = { requestFullscreen } as unknown as HTMLElement;

    const mode = await enterLumaFullscreen(fakeEl, { win: fakeWin, doc: fakeDoc });
    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(mode).toBe('stage-fallback');
  });

  it('uses native DOM fullscreen when document.fullscreenElement activates properly', async () => {
    const exitFullscreen = vi.fn().mockResolvedValue(undefined);
    const fakeDoc = {
      fullscreenElement: null as Element | null,
      exitFullscreen,
    } as unknown as Document;

    const fakeEl = {
      requestFullscreen: vi.fn(async () => {
        (fakeDoc as { fullscreenElement: Element | null }).fullscreenElement =
          fakeEl as unknown as Element;
      }),
    } as unknown as HTMLElement;

    const mode = await enterLumaFullscreen(fakeEl, {
      win: {} as Window,
      doc: fakeDoc,
    });
    expect(mode).toBe('dom');
    expect(getNativeDomFullscreenElement(fakeDoc)).toBe(fakeEl);

    await exitLumaFullscreen({ win: {} as Window, doc: fakeDoc });
    expect(exitFullscreen).toHaveBeenCalledOnce();
  });

  it('falls back to Tauri desktop plugin:window|set_fullscreen when element fullscreen fails on desktop', async () => {
    const invoke = vi.fn(async (cmd: string) => {
      if (cmd === 'plugin:window|is_fullscreen') return true;
      return undefined;
    });
    const fakeWin = {
      __TAURI_INTERNALS__: { invoke },
    } as unknown as Window;
    const fakeDoc = { fullscreenElement: null } as unknown as Document;
    const fakeEl = {
      requestFullscreen: vi.fn().mockRejectedValue(new Error('Blocked')),
    } as unknown as HTMLElement;

    const mode = await enterLumaFullscreen(fakeEl, { win: fakeWin, doc: fakeDoc });
    expect(mode).toBe('tauri-window');
    expect(invoke).toHaveBeenCalledWith('plugin:window|set_fullscreen', {
      label: 'main',
      value: true,
    });

    await exitLumaFullscreen({ win: fakeWin, doc: fakeDoc });
    expect(invoke).toHaveBeenCalledWith('plugin:window|set_fullscreen', {
      label: 'main',
      value: false,
    });
  });
});
