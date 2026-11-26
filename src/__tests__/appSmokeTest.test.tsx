// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Node 25/26 overrides globalThis.localStorage with an experimental getter unless --localstorage-file is set;
// install a standard Web Storage implementation so App persistence works deterministically in Vitest.
const memoryStore = new Map<string, string>();
const webStorageMock: Storage = {
  get length() {
    return memoryStore.size;
  },
  clear() {
    memoryStore.clear();
  },
  getItem(key: string) {
    return memoryStore.has(key) ? memoryStore.get(key)! : null;
  },
  key(index: number) {
    return Array.from(memoryStore.keys())[index] ?? null;
  },
  removeItem(key: string) {
    memoryStore.delete(key);
  },
  setItem(key: string, value: string) {
    memoryStore.set(key, String(value));
  },
};
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: webStorageMock,
});
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    writable: true,
    value: webStorageMock,
  });
}

// Enable React 19 act() environment flag so state updates flush cleanly without warnings
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

class MockResizeObserver {
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe() {
    this.cb([], this as unknown as ResizeObserver);
  }
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  }

  // Stub HTMLMediaElement playback methods in jsdom
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'load', {
    configurable: true,
    value: vi.fn(),
  });

  // Stub 2D canvas context for BroadcastSynthCanvas & Ambilight sampler
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    setLineDash: vi.fn(),
    fillText: vi.fn(),
    drawImage: vi.fn(),
    getImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(16 * 9 * 4) }),
    createLinearGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
    createRadialGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;

  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => 'blob:luma-mock');
  }
  if (!URL.revokeObjectURL) {
    URL.revokeObjectURL = vi.fn();
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }

  // Mock network fetch so update checks & external streams never make real network calls in tests
  globalThis.fetch = vi.fn(async () => {
    return new Response(
      JSON.stringify({
        tag_name: 'v0.8.0-beta.6',
        name: 'Luma TV v0.8.0-beta.6',
        prerelease: true,
        html_url: 'https://github.com/petrosvassiliou/luma-tv/releases/tag/v0.8.0-beta.6',
        body: 'Release notes',
        assets: [],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as unknown as typeof fetch;
});

function clickEl(el: Element | null, label: string): HTMLElement {
  if (!el) {
    throw new Error(`Missing interactive element: ${label}`);
  }
  const htmlEl = el as HTMLElement;
  act(() => {
    htmlEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  return htmlEl;
}

function setInputValue(input: HTMLInputElement | HTMLSelectElement, value: string) {
  act(() => {
    const proto =
      input instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('Luma TV End-to-End UI & Button Smoke Test', () => {
  let host!: HTMLDivElement;
  let root: Root | null = null;
  let AppComponent: React.ComponentType;

  beforeAll(async () => {
    const mod = await import('../App');
    AppComponent = mod.default;
  });

  beforeEach(async () => {
    localStorage.clear();
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko)',
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(<AppComponent />);
    });
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root!.unmount();
      });
      root = null;
    }
    if (host) {
      host.remove();
    }
  });

  it('exercises Titlebar, 6-language switcher, CommandBar, Sidebar & Favorites right-drawer auto-expand', async () => {
    // 1. Switch UI to English via LanguageDropdown
    clickEl(host.querySelector('#btn-toggle-locale'), '#btn-toggle-locale');
    const enOption = Array.from(host.querySelectorAll('[role="option"]')).find((el) =>
      el.textContent?.includes('English')
    );
    clickEl(enOption ?? null, 'English locale option');
    expect(host.querySelector('#nav-vod')?.textContent).toContain('Movies (VOD)');

    // 2. Quick Playlist Switcher open & close
    clickEl(
      host.querySelector('#btn-quick-playlist-switcher'),
      '#btn-quick-playlist-switcher'
    );
    expect(host.textContent).toContain('Luma Demo');
    clickEl(
      host.querySelector('#btn-quick-playlist-switcher'),
      '#btn-quick-playlist-switcher close'
    );

    // 3. CommandBar (Cmd+K) open, search, and Escape close
    clickEl(host.querySelector('#btn-open-command-bar'), '#btn-open-command-bar');
    const cmdInput = host.querySelector(
      'input[type="text"]'
    ) as HTMLInputElement | null;
    expect(cmdInput).not.toBeNull();
    if (cmdInput) {
      setInputValue(cmdInput, 'Red Bull');
      expect(host.textContent).toContain('Red Bull TV HD');
      act(() => {
        cmdInput.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );
      });
    }

    // 4. Regression check: collapse left sidebar + close right channel drawer, then click #group-favorites
    clickEl(host.querySelector('#btn-toggle-sidebar'), 'collapse left sidebar');
    const closeRightBtn = host.querySelector('button[title="Channel List"]');
    clickEl(closeRightBtn, 'close right channel drawer');
    // Right channel drawer <aside> inside main should now be closed
    expect(host.querySelector('main aside')).toBeNull();

    // Click #group-favorites on the collapsed left sidebar -> right drawer MUST expand showing Favorites!
    clickEl(host.querySelector('#group-favorites'), '#group-favorites');
    const reopenedDrawer = host.querySelector('main aside');
    expect(reopenedDrawer).not.toBeNull();
    expect(reopenedDrawer?.textContent).toContain('Favorites');

    // Re-expand left sidebar and restore All Channels
    clickEl(host.querySelector('#btn-toggle-sidebar'), 'expand left sidebar');
    clickEl(host.querySelector('#group-all'), '#group-all');
    expect(host.querySelector('main aside')?.textContent).toContain('All Channels');
  });

  it('exercises Live TV PlayerStage buttons, DSP/Subtitle menu, In-App PiP, Dual View (2x), Multiview (4x), and Fullscreen', async () => {
    // Switch to EN
    clickEl(host.querySelector('#btn-toggle-locale'), '#btn-toggle-locale');
    clickEl(
      Array.from(host.querySelectorAll('[role="option"]')).find((el) =>
        el.textContent?.includes('English')
      ) ?? null,
      'English option'
    );

    // PlayerStage transport buttons
    clickEl(host.querySelector('#btn-play-pause'), '#btn-play-pause pause');
    clickEl(host.querySelector('#btn-play-pause'), '#btn-play-pause play');
    clickEl(host.querySelector('#btn-zap-next'), '#btn-zap-next');
    expect(host.querySelector('#luma-player-stage h1')?.textContent).toContain(
      'Luma Cinema 4K'
    );
    clickEl(host.querySelector('#btn-zap-prev'), '#btn-zap-prev');
    expect(host.querySelector('#luma-player-stage h1')?.textContent).toContain(
      'Red Bull TV HD'
    );

    clickEl(host.querySelector('#btn-mute-toggle'), '#btn-mute-toggle');
    expect(host.querySelector('#btn-quick-unmute')).not.toBeNull();
    clickEl(host.querySelector('#btn-quick-unmute'), '#btn-quick-unmute');

    // Favorite toggle on HUD
    clickEl(host.querySelector('#btn-hud-favorite'), '#btn-hud-favorite toggle off');
    clickEl(host.querySelector('#btn-hud-favorite'), '#btn-hud-favorite toggle on');

    // Aspect ratio cycle
    clickEl(host.querySelector('#btn-aspect-ratio'), '#btn-aspect-ratio -> COVER');
    expect(host.querySelector('#btn-aspect-ratio')?.textContent).toContain('COVER');
    clickEl(host.querySelector('#btn-aspect-ratio'), '#btn-aspect-ratio -> 21:9');
    expect(host.querySelector('#btn-aspect-ratio')?.textContent).toContain('21:9');
    clickEl(host.querySelector('#btn-aspect-ratio'), '#btn-aspect-ratio -> 16:9');

    // Stream Settings (DSP, ABR Quality, Subtitle sync offset) + Outside-Click & Cast/AirPlay Menu Switch
    clickEl(host.querySelector('#btn-stream-settings'), '#btn-stream-settings open');
    const plusOffsetBtn = host.querySelector('button[title="+0.5s"]');
    clickEl(plusOffsetBtn, 'Subtitle +0.5s');
    expect(host.textContent).toContain('+0.5s');
    clickEl(host.querySelector('button[title="Reset offset"]'), 'Reset subtitle offset');
    expect(host.textContent).toContain('0.0s');

    // Mock Android MediaRouter network scanner discovering a Chromecast on Wi-Fi
    const connectAndCastRouteMock = vi.fn(() => true);
    const mockSnap = JSON.stringify({
      devices: [
        {
          id: 'route:cast-living-room',
          name: 'Living Room Chromecast',
          model: 'Chromecast Ultra',
          protocol: 'chromecast',
          source: 'android-mediarouter',
        },
      ],
      connectedDeviceName: null,
    });
    (window as unknown as Record<string, unknown>).LumaAndroidWindow = {
      startCastScan: vi.fn(() => mockSnap),
      getCastStateJson: vi.fn(() => mockSnap),
      stopCastScan: vi.fn(),
      connectAndCastRoute: connectAndCastRouteMock,
      stopCasting: vi.fn(),
    };

    // Clicking Cast / AirPlay menu must automatically close DSP & Spuren and scan network for TVs
    await act(async () => {
      clickEl(host.querySelector('#btn-cast-airplay'), '#btn-cast-airplay open');
    });
    expect(host.querySelector('button[title="+0.5s"]')).toBeNull();
    expect(host.querySelector('#luma-cast-popover')).not.toBeNull();
    expect(host.querySelector('#luma-cast-network-list')?.textContent).toContain(
      'Living Room Chromecast'
    );

    // Clicking the discovered Chromecast streams directly via MediaRouter without external app chooser
    const castDeviceBtn = Array.from(
      host.querySelectorAll('#luma-cast-network-list button')
    ).find((b) => b.textContent?.includes('Living Room Chromecast'));
    await act(async () => {
      clickEl(castDeviceBtn ?? null, 'Connect to Living Room Chromecast');
    });
    expect(connectAndCastRouteMock).toHaveBeenCalledTimes(1);
    expect(host.querySelector('#luma-cast-popover')).toBeNull();

    // Re-open Cast menu and verify clicking anywhere outside (e.g. titlebar) closes it immediately
    await act(async () => {
      clickEl(host.querySelector('#btn-cast-airplay'), '#btn-cast-airplay reopen');
    });
    expect(host.querySelector('#luma-cast-popover')).not.toBeNull();
    act(() => {
      host
        .querySelector('#luma-custom-titlebar')!
        .dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(host.querySelector('#luma-cast-popover')).toBeNull();
    delete (window as unknown as Record<string, unknown>).LumaAndroidWindow;

    // Verify macOS native WebKit AirPlay 2 pre-warming & synchronous picker invocation
    const airplayPickerMock = vi.fn();
    Object.defineProperty(
      HTMLMediaElement.prototype,
      'webkitShowPlaybackTargetPicker',
      {
        configurable: true,
        writable: true,
        value: airplayPickerMock,
      }
    );
    await act(async () => {
      clickEl(host.querySelector('#btn-cast-airplay'), '#btn-cast-airplay macOS open');
    });
    const bridgeVideo = host.querySelector(
      '#luma-airplay-bridge-video'
    ) as HTMLVideoElement | null;
    expect(bridgeVideo).not.toBeNull();
    expect(bridgeVideo?.getAttribute('data-luma-airplay-src')).toContain('.m3u8');
    expect(host.querySelector('#btn-cast-appletv')).not.toBeNull();
    clickEl(host.querySelector('#btn-cast-appletv'), '#btn-cast-appletv macOS AirPlay');
    expect(airplayPickerMock).toHaveBeenCalledTimes(1);
    delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>)
      .webkitShowPlaybackTargetPicker;

    // Fullscreen toggle & exit via #btn-fullscreen and Escape
    await act(async () => {
      clickEl(host.querySelector('#btn-fullscreen'), '#btn-fullscreen enter');
    });
    expect(host.querySelector('#luma-custom-titlebar')).toBeNull();
    expect(host.querySelector('#luma-sidebar')).toBeNull();

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    });
    expect(host.querySelector('#luma-custom-titlebar')).not.toBeNull();
    expect(host.querySelector('#luma-sidebar')).not.toBeNull();

    // Dual View 2x via #btn-open-dualview
    clickEl(host.querySelector('#btn-open-dualview'), '#btn-open-dualview');
    expect(host.querySelector('#dualview-pane-1')).not.toBeNull();
    expect(host.querySelector('#dualview-pane-2')).not.toBeNull();
    // Sidebar auto-hides in Dual View to maximize space
    expect(host.querySelector('#luma-sidebar')).toBeNull();

    const slot1Initial = host.querySelector('#btn-dual-pick-1')?.textContent;
    const slot2Initial = host.querySelector('#btn-dual-pick-2')?.textContent;
    expect(slot1Initial).not.toEqual(slot2Initial);

    // Swap Dual View channels
    clickEl(host.querySelector('#btn-dual-swap'), '#btn-dual-swap');
    expect(host.querySelector('#btn-dual-pick-1')?.textContent).toEqual(slot2Initial);

    // Orientation & Fit/Fill toggles
    clickEl(host.querySelector('#btn-dual-orientation'), '#btn-dual-orientation');
    clickEl(host.querySelector('#btn-dual-fit'), '#btn-dual-fit');
    expect(host.querySelector('#btn-dual-fit')?.textContent).toContain('Fill');

    // Audio slot switch & Channel Picker modal
    clickEl(host.querySelector('#btn-dual-audio-2'), '#btn-dual-audio-2');
    clickEl(host.querySelector('#btn-dual-pick-2'), '#btn-dual-pick-2');
    expect(host.textContent).toContain('Stream #2');
    // Pick NASA Mission TV HD
    const nasaBtn = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('NASA Mission TV HD')
    );
    clickEl(nasaBtn ?? null, 'Select NASA in Dual View Slot 2');
    expect(host.querySelector('#btn-dual-pick-2')?.textContent).toContain(
      'NASA Mission TV HD'
    );

    // Multiview 4x
    clickEl(host.querySelector('#btn-titlebar-multiview'), '#btn-titlebar-multiview');
    expect(host.querySelector('#multiview-slot-1')).not.toBeNull();
    expect(host.querySelector('#multiview-slot-4')).not.toBeNull();
    clickEl(
      host.querySelector('#btn-multiview-master-audio'),
      '#btn-multiview-master-audio'
    );
  });

  it('exercises EPG, Catch-Up, Movies (VOD), Series, Collections 3-column builder, Sources Sync, and Settings', async () => {
    // Switch to EN
    clickEl(host.querySelector('#btn-toggle-locale'), '#btn-toggle-locale');
    clickEl(
      Array.from(host.querySelectorAll('[role="option"]')).find((el) =>
        el.textContent?.includes('English')
      ) ?? null,
      'English option'
    );

    // 1. Live TV & EPG split view + Theater height toggle
    clickEl(host.querySelector('#nav-live-epg'), '#nav-live-epg');
    clickEl(host.querySelector('#btn-theater-height'), '#btn-theater-height expand');
    clickEl(host.querySelector('#btn-theater-height'), '#btn-theater-height compact');

    // 2. Catch-Up Archive -> Re-Live -> Back to Live
    clickEl(host.querySelector('#nav-catchup'), '#nav-catchup');
    const reLiveBtn = Array.from(host.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Re-Live')
    );
    clickEl(reLiveBtn ?? null, 'Re-Live catchup button');
    expect(host.querySelector('#luma-player-stage')?.textContent).toContain('CATCH-UP');
    const backToLiveBtn = Array.from(
      host.querySelectorAll('#luma-player-stage button')
    ).find((b) => b.textContent?.includes('Back to Live'));
    clickEl(backToLiveBtn ?? null, 'Back to Live button');
    expect(host.querySelector('#luma-player-stage')?.textContent).toContain('LIVE');

    // 3. Movies (VOD) -> Details modal -> Play Movie -> On-Demand HUD -> Back to Movies
    clickEl(host.querySelector('#nav-vod'), '#nav-vod');
    const detailsBtn = Array.from(host.querySelectorAll('main button')).find(
      (b) => b.textContent?.trim() === 'Details'
    );
    clickEl(detailsBtn ?? null, 'VOD Details button');
    expect(host.textContent).toContain('TMDB');
    // Click modal backdrop to close MediaDetailModal cleanly
    const modalBackdrop = host.querySelector('div.fixed.inset-0');
    if (modalBackdrop) clickEl(modalBackdrop, 'Close MediaDetailModal backdrop');

    const tearsHeading = Array.from(host.querySelectorAll('main h3')).find((h) =>
      h.textContent?.includes('Tears of Steel')
    );
    clickEl(tearsHeading ?? null, 'Play Tears of Steel card');
    expect(host.querySelector('#luma-player-stage h1')?.textContent).toContain(
      'Tears of Steel'
    );
    expect(host.querySelector('#btn-skip-fwd-10')).not.toBeNull();
    clickEl(host.querySelector('#btn-skip-fwd-10'), '#btn-skip-fwd-10');
    const backToMoviesBtn = Array.from(
      host.querySelectorAll('#luma-player-stage button')
    ).find((b) => b.textContent?.includes('Movies (VOD)'));
    clickEl(backToMoviesBtn ?? null, 'Back to Movies (VOD) button');
    expect(host.querySelector('#input-vod-search')).not.toBeNull();

    // 4. Series -> Open Orbital Horizon -> Play S01E01 -> Next Episode S01E02 -> Back to Series
    clickEl(host.querySelector('#nav-series'), '#nav-series');
    const orbitalCard = Array.from(host.querySelectorAll('main h3')).find((h) =>
      h.textContent?.includes('Orbital Horizon')
    );
    clickEl(orbitalCard ?? null, 'Open Orbital Horizon series');
    const playEpBtn = Array.from(host.querySelectorAll('main h4')).find((el) =>
      el.textContent?.includes('Apogäum 420 km')
    );
    clickEl(playEpBtn ?? null, 'Play S01E01');
    expect(host.querySelector('#luma-player-stage')?.textContent).toContain('S01E01');
    clickEl(host.querySelector('#btn-next-episode'), '#btn-next-episode -> S01E02');
    expect(host.querySelector('#luma-player-stage')?.textContent).toContain('S01E02');
    const backToSeriesBtn = Array.from(
      host.querySelectorAll('#luma-player-stage button')
    ).find((b) => b.textContent?.includes('Series'));
    clickEl(backToSeriesBtn ?? null, 'Back to Series button');

    // 5. Collections -> Create collection + 3-column Country/Group/Channel builder
    clickEl(host.querySelector('#nav-collections'), '#nav-collections');
    const newColInput = host.querySelector(
      'input[placeholder*="collection" i]'
    ) as HTMLInputElement | null;
    expect(newColInput).not.toBeNull();
    if (newColInput) {
      setInputValue(newColInput, 'Smoke Test Bouquet');
      const createBtn = Array.from(host.querySelectorAll('main button')).find((b) =>
        b.textContent?.includes('Create')
      );
      clickEl(createBtn ?? null, 'Create Collection button');
      expect(host.textContent).toContain('Smoke Test Bouquet');
    }
    // Creating an empty collection auto-expands the 3-column Country -> Group -> Channels builder
    if (!host.textContent?.includes('1. Country')) {
      const openBuilderBtn = Array.from(host.querySelectorAll('main button')).find(
        (b) => b.textContent?.includes('Add Countries, Groups & Channels')
      );
      clickEl(openBuilderBtn ?? null, 'Open 3-column Collection builder');
    }
    expect(host.textContent).toContain('1. Country');
    expect(host.textContent).toContain('2. Group');
    expect(host.textContent).toContain('3. Channels');

    // 6. Favorites & Home hubs
    clickEl(host.querySelector('#nav-favorites'), '#nav-favorites');
    expect(host.textContent).toContain('Red Bull TV HD');
    clickEl(host.querySelector('#nav-home'), '#nav-home');
    expect(host.textContent).toContain('Continue Watching');

    // 7. Sources & Encrypted Sync Vault + Firebase Cloud Sync UI roundtrip
    clickEl(host.querySelector('#nav-sources'), '#nav-sources');
    expect(host.querySelector('#luma-cloud-sync-card')).not.toBeNull();
    clickEl(host.querySelector('#btn-cloud-tab-signup'), '#btn-cloud-tab-signup');
    expect(host.querySelector('#btn-cloud-submit-auth')?.textContent).toContain(
      'Create Account'
    );
    clickEl(host.querySelector('#btn-cloud-tab-signin'), '#btn-cloud-tab-signin');

    const snapshotPassInput = Array.from(
      host.querySelectorAll('input[type="password"]')
    ).find((el) =>
      (el as HTMLInputElement).placeholder.includes('local snapshot')
    ) as HTMLInputElement | undefined;
    expect(snapshotPassInput).toBeDefined();
    if (snapshotPassInput) {
      setInputValue(snapshotPassInput, 'SmokeVaultPass2026!');
      await act(async () => {
        clickEl(
          host.querySelector('#btn-luma-sync-encrypt'),
          '#btn-luma-sync-encrypt'
        );
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 120));
      });
      await act(async () => {
        clickEl(
          host.querySelector('#btn-luma-sync-restore'),
          '#btn-luma-sync-restore'
        );
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 120));
      });
    }

    // 8. Settings Hub: Firebase Cloud Sync card, Theme switch, Sleep timer, Buffer profile, Auto refresh, Update check, Shortcuts modal
    clickEl(host.querySelector('#nav-settings'), '#nav-settings');
    expect(host.querySelector('#luma-cloud-sync-card')).not.toBeNull();
    const m3Btn = Array.from(host.querySelectorAll('main button')).find((b) =>
      b.textContent?.includes('Material 3 Expressive')
    );
    clickEl(m3Btn ?? null, 'Switch to Material 3 Expressive');
    expect(host.firstElementChild?.getAttribute('data-design')).toBe('m3-expressive');

    const lgBtn = Array.from(host.querySelectorAll('main button')).find((b) =>
      b.textContent?.includes('Apple Liquid Glass')
    );
    clickEl(lgBtn ?? null, 'Switch back to Apple Liquid Glass');
    expect(host.firstElementChild?.getAttribute('data-design')).toBe('liquid-glass');

    const sleep15 = Array.from(host.querySelectorAll('main button')).find(
      (b) => b.textContent?.trim() === '15 min'
    );
    clickEl(sleep15 ?? null, 'Sleep 15 min');
    const sleepOff = Array.from(host.querySelectorAll('main button')).find(
      (b) => b.textContent?.trim() === 'Off'
    );
    clickEl(sleepOff ?? null, 'Sleep Off');

    await act(async () => {
      clickEl(
        host.querySelector('#btn-settings-check-updates'),
        '#btn-settings-check-updates'
      );
    });

    const shortcutsBtn = Array.from(host.querySelectorAll('main button')).find((b) =>
      b.textContent?.includes('Shortcuts & Remote Guide')
    );
    clickEl(shortcutsBtn ?? null, 'Open Shortcuts Guide modal');
    expect(host.textContent).toContain('Controls');
  });

  it('starts on First Favorite by default and allows overriding with a Custom Default Startup Channel', async () => {
    // Unmount default instance and configure custom Favorites where NASA Mission TV HD is the 1st Favorite
    await act(async () => {
      root!.unmount();
    });
    localStorage.setItem('luma.favorites.v1', JSON.stringify(['ch-nasa-public']));

    root = createRoot(host);
    await act(async () => {
      root!.render(<AppComponent />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });

    // Should automatically boot into NASA Mission TV HD (1st Favorite) instead of #1 Red Bull TV HD
    expect(host.querySelector('#luma-player-stage h1')?.textContent).toContain(
      'NASA Mission TV HD'
    );

    // Open Settings -> Startup Channel card -> choose DW International HD as Custom Default Startup Channel
    clickEl(host.querySelector('#nav-settings'), '#nav-settings');
    expect(host.querySelector('#settings-startup-channel-card')).not.toBeNull();
    clickEl(
      host.querySelector('#btn-startup-custom-channel'),
      '#btn-startup-custom-channel'
    );
    const startupInput = host.querySelector(
      '#input-startup-channel-search'
    ) as HTMLInputElement | null;
    expect(startupInput).not.toBeNull();
    if (startupInput) {
      setInputValue(startupInput, 'DW International');
      const dwBtn = Array.from(
        host.querySelectorAll('#settings-startup-channel-card button')
      ).find((b) => b.textContent?.includes('DW International HD'));
      clickEl(dwBtn ?? null, 'Select DW International HD as Startup Channel');
    }

    // Verify Settings LanguageDropdown renders all 6 locales via unclipped fixed portal
    clickEl(
      host.querySelector('#settings-language-dropdown'),
      '#settings-language-dropdown'
    );
    expect(host.querySelectorAll('[role="option"]').length).toBe(6);

    // Remount App from scratch -> Custom Startup Channel (DW International HD) MUST override 1st Favorite (NASA)
    await act(async () => {
      root!.unmount();
    });
    root = createRoot(host);
    await act(async () => {
      root!.render(<AppComponent />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });

    expect(host.querySelector('#luma-player-stage h1')?.textContent).toContain(
      'DW International HD'
    );
  });

  it('displays synced Favorites and Greek collection channels across Live TV, Favorites, and Collections views (both via snapshots and orphaned-ID self-healing)', async () => {
    await act(async () => {
      root!.unmount();
    });

    const { lumaDb } = await import('../db/lumaDb');
    await Promise.all([
      lumaDb.sources.clear(),
      lumaDb.channels.clear(),
    ]);

    // Seed IndexedDB with playlist `xtream-device2-777`, while synced Favorites & "Greek"
    // collection initially carry orphaned prefix `xtream-device1-111-xt-*` + a snapshot channel!
    await lumaDb.sources.put({
      id: 'xtream-device2-777',
      name: 'Home Xtream',
      type: 'xtream',
      endpoint: 'http://provider.example:8080',
      rawUrlOrHost: 'http://provider.example:8080',
      username: 'alice',
      password: 'pw',
      outputFormat: 'm3u8',
      hiddenGroupIds: ['gr-general'], // Even when raw group is hidden!
      epgOffsetHours: 0,
      channelCount: 2,
      vodCount: 0,
      seriesCount: 0,
      epgStatus: 'synced',
      lastUpdated: 'Synced',
      createdAt: 1795800000000,
    });

    await lumaDb.channels.bulkPut([
      {
        id: 'xtream-device2-777-xt-9001',
        sourceId: 'xtream-device2-777',
        number: 101,
        sortOrder: 0,
        name: 'GR| ERT 1 HD',
        shortCode: 'ERT1',
        groupId: 'gr-general',
        groupName: 'GR| GREECE',
        streamUrl: 'http://provider.example:8080/live/alice/pw/9001.m3u8',
        streamType: 'hls',
        resolution: '1080p',
        audioBadge: 'EAC3 5.1',
        codec: 'H.264',
        hasCatchup: true,
        catchupDays: 7,
        xtreamStreamId: 9001,
        accentColor: '#38BDF8',
        country: 'GR',
        epgArchetype: 0,
      },
      {
        id: 'xtream-device2-777-xt-9002',
        sourceId: 'xtream-device2-777',
        number: 102,
        sortOrder: 1,
        name: 'GR| MEGA HD',
        shortCode: 'MEGA',
        groupId: 'gr-general',
        groupName: 'GR| GREECE',
        streamUrl: 'http://provider.example:8080/live/alice/pw/9002.m3u8',
        streamType: 'hls',
        resolution: '1080p',
        audioBadge: 'EAC3 5.1',
        codec: 'H.264',
        hasCatchup: true,
        catchupDays: 7,
        xtreamStreamId: 9002,
        accentColor: '#38BDF8',
        country: 'GR',
        epgArchetype: 1,
      },
    ]);

    localStorage.setItem('luma.demoDeleted.v1', '1');
    localStorage.setItem(
      'luma.favorites.v1',
      JSON.stringify(['xtream-device1-111-xt-9001', 'xtream-pending-999-xt-9003'])
    );
    localStorage.setItem(
      'luma.bouquets.v1',
      JSON.stringify([
        {
          id: 'col-greek',
          name: 'Greek',
          channelIds: [
            'xtream-device1-111-xt-9001',
            'xtream-device1-111-xt-9002',
            'xtream-pending-999-xt-9003',
          ],
          isPinLocked: false,
        },
      ])
    );
    localStorage.setItem(
      'luma.cloud.mediaSnapshots.v1',
      JSON.stringify({
        channels: {
          'xtream-pending-999-xt-9003': {
            id: 'xtream-pending-999-xt-9003',
            number: 103,
            name: 'GR| SKAI HD',
            shortCode: 'SKAI',
            groupId: 'gr-general',
            groupName: 'GR| GREECE',
            streamUrl: 'http://provider2.example:8080/live/alice/pw/9003.m3u8',
            streamType: 'hls',
            resolution: '1080p',
            audioBadge: 'EAC3 5.1',
            codec: 'H.264',
            hasCatchup: false,
            catchupDays: 0,
            accentColor: '#38BDF8',
            country: 'GR',
            epgArchetype: 2,
          },
        },
        vod: {},
        series: {},
      })
    );

    root = createRoot(host);
    await act(async () => {
      root!.render(<AppComponent />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });

    // 1. Click "Greek" chip in Live TV drawer -> all 3 Greek channels MUST display!
    const greekChip = Array.from(host.querySelectorAll('aside button')).find((b) =>
      b.textContent?.includes('Greek')
    );
    expect(greekChip).toBeDefined();
    clickEl(greekChip ?? null, 'Click Greek collection chip in Live TV');
    expect(host.textContent).toContain('GR| ERT 1 HD');
    expect(host.textContent).toContain('GR| MEGA HD');
    expect(host.textContent).toContain('GR| SKAI HD');

    // 2. Navigate to Favorites view -> both favorited Greek channels MUST display!
    clickEl(host.querySelector('#nav-favorites'), '#nav-favorites');
    expect(host.textContent).toContain('GR| ERT 1 HD');
    expect(host.textContent).toContain('GR| SKAI HD');

    // 3. Navigate to Collections view -> Greek collection MUST display all 3 channels!
    clickEl(host.querySelector('#nav-collections'), '#nav-collections');
    expect(host.textContent).toContain('GR| ERT 1 HD');
    expect(host.textContent).toContain('GR| MEGA HD');
    expect(host.textContent).toContain('GR| SKAI HD');
  });
});
