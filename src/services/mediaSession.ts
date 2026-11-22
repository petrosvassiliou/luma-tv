import type { Channel } from '../types/luma';

interface MediaSessionCallbacks {
  onPrevChannel: () => void;
  onNextChannel: () => void;
  onPlay?: () => void;
  onPause?: () => void;
}

/**
 * Integrates Luma TV with macOS Control Center / Now Playing, ChromeOS Media Controls,
 * and Android Lockscreen / Hardware Media Keys.
 */
export function syncOsMediaSession(
  channel: Channel,
  programTitle: string,
  callbacks: MediaSessionCallbacks
): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
    return;
  }

  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `${channel.name} — ${programTitle}`,
      artist: `Luma TV · Kanal #${channel.number}`,
      album: channel.groupName,
      artwork: [
        {
          src: '/luma-logo.svg',
          sizes: '512x512',
          type: 'image/svg+xml',
        },
      ],
    });

    navigator.mediaSession.setActionHandler('previoustrack', callbacks.onPrevChannel);
    navigator.mediaSession.setActionHandler('nexttrack', callbacks.onNextChannel);
    if (callbacks.onPlay) {
      navigator.mediaSession.setActionHandler('play', callbacks.onPlay);
    }
    if (callbacks.onPause) {
      navigator.mediaSession.setActionHandler('pause', callbacks.onPause);
    }
  } catch {
    // Ignore unsupported action handlers on older WebViews
  }
}
