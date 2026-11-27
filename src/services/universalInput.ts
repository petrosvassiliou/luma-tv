import { useEffect } from 'react';

interface LaunchQueueConsumerParams {
  files: {
    name: string;
    getFile: () => Promise<File>;
  }[];
}

interface LaunchQueueWindow {
  launchQueue?: {
    setConsumer: (consumer: (params: LaunchQueueConsumerParams) => void) => void;
  };
  __TAURI_INTERNALS__?: {
    invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  };
}

/**
 * Triggers native Tauri v2 window actions on macOS & Desktop when running natively.
 */
export async function invokeNativeWindowControl(
  action: 'minimize' | 'toggle-maximize' | 'close'
): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as LaunchQueueWindow;
  const invoke = w.__TAURI_INTERNALS__?.invoke;
  if (!invoke) return false;

  const cmdMap: Record<typeof action, string> = {
    minimize: 'plugin:window|minimize',
    'toggle-maximize': 'plugin:window|toggle_maximize',
    close: 'plugin:window|close',
  };

  try {
    await invoke(cmdMap[action], { label: 'main' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Polls connected Gamepads / Android TV Bluetooth Remotes for 10-foot D-Pad zapping,
 * section switching (L1 / R1 bumpers), and Command Bar activation (Y button).
 */
export function useUniversalGamepadControls(
  handlers: {
    onChannelPrev: () => void;
    onChannelNext: () => void;
    onCycleSectionPrev: () => void;
    onCycleSectionNext: () => void;
    onToggleSearch: () => void;
  },
  options?: {
    isAndroidTv?: boolean;
  }
): void {
  const isAndroidTv = Boolean(options?.isAndroidTv);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('getGamepads' in navigator)) return;

    let lastActionMs = 0;
    let rafId = 0;

    const poll = (now: number) => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const pad = pads[0];
      if (pad && now - lastActionMs > 210) {
        // On Android TV, Bluetooth TV remotes expose D-Pad Up/Down as Gamepad buttons 12/13;
        // never hijack D-Pad Up/Down for channel zapping on Android TV so spatial UI focus works cleanly.
        if (
          !isAndroidTv &&
          (pad.buttons[12]?.pressed || (pad.axes[1] !== undefined && pad.axes[1] < -0.65))
        ) {
          handlers.onChannelPrev();
          lastActionMs = now;
        } else if (
          !isAndroidTv &&
          (pad.buttons[13]?.pressed || (pad.axes[1] !== undefined && pad.axes[1] > 0.65))
        ) {
          handlers.onChannelNext();
          lastActionMs = now;
        } else if (pad.buttons[4]?.pressed) {
          handlers.onCycleSectionPrev();
          lastActionMs = now;
        } else if (pad.buttons[5]?.pressed) {
          handlers.onCycleSectionNext();
          lastActionMs = now;
        } else if (pad.buttons[3]?.pressed) {
          handlers.onToggleSearch();
          lastActionMs = now + 150;
        }
      }
      rafId = requestAnimationFrame(poll);
    };

    rafId = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafId);
  }, [handlers, isAndroidTv]);
}

/**
 * Handles OS-level .m3u / .m3u8 file opens (via File Handling API launchQueue)
 * AND global drag-and-drop of .m3u / .m3u8 / .xml.gz files anywhere onto the app window
 * across macOS Finder, Android split-screen, and ChromeOS Files.
 */
export function useCrossPlatformFileDropAndLaunch(handlers: {
  onImportM3uFile: (name: string, content: string) => void;
  onImportXmltvBuffer: (buffer: ArrayBuffer) => void;
}): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const w = window as unknown as LaunchQueueWindow;
    if (w.launchQueue) {
      w.launchQueue.setConsumer(async (launchParams) => {
        if (!launchParams.files || launchParams.files.length === 0) return;
        for (const handle of launchParams.files) {
          const file = await handle.getFile();
          const text = await file.text();
          handlers.onImportM3uFile(
            file.name.replace(/\.(m3u8?|txt)$/i, ''),
            text
          );
        }
      });
    }

    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
      }
    };

    const onDrop = async (e: DragEvent) => {
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.m3u') || lower.endsWith('.m3u8')) {
        e.preventDefault();
        const text = await file.text();
        handlers.onImportM3uFile(file.name.replace(/\.(m3u8?)$/i, ''), text);
      } else if (lower.endsWith('.xml') || lower.endsWith('.gz')) {
        e.preventDefault();
        const buf = await file.arrayBuffer();
        handlers.onImportXmltvBuffer(buf);
      }
    };

    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [handlers]);
}
