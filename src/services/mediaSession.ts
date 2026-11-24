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
  callbacks: MediaSessionCallbacks,
  onDemandMeta?: {
    title: string;
    subtitle: string;
    badgeTop: string;
  } | null
): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
    return;
  }

  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: onDemandMeta ? onDemandMeta.title : `${channel.name} — ${programTitle}`,
      artist: onDemandMeta
        ? `Luma TV · ${onDemandMeta.badgeTop}`
        : `Luma TV · Kanal #${channel.number}`,
      album: onDemandMeta ? onDemandMeta.subtitle : channel.groupName,
      artwork: [
        {
          src: '/luma-logo.svg',
          sizes: '512x512',
          type: 'image/svg+xml',
        },
      ],
    });

    navigator.mediaSession.setActionHandler(
      'previoustrack',
      onDemandMeta ? null : callbacks.onPrevChannel
    );
    navigator.mediaSession.setActionHandler(
      'nexttrack',
      onDemandMeta ? null : callbacks.onNextChannel
    );
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
