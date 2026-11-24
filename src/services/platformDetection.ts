import type { PlatformDesignMode } from '../types/luma';

export type DetectedPlatformFamily =
  | 'apple'
  | 'android'
  | 'chromeos'
  | 'windows'
  | 'linux'
  | 'web';

export interface PlatformDetectionResult {
  isApple: boolean;
  family: DetectedPlatformFamily;
  label: string;
  defaultDesignMode: PlatformDesignMode;
}

/**
 * Detects the host OS / device family from User-Agent, platform, and touch points.
 * Apple Liquid Glass (`liquid-glass`) is strictly reserved for Apple devices
 * (macOS, iPadOS, iOS). All other platforms use Material 3 Expressive (`m3-expressive`).
 */
export function detectPlatformEnvironment(
  userAgentInput?: string,
  platformInput?: string,
  maxTouchPointsInput?: number
): PlatformDetectionResult {
  const ua = (
    userAgentInput ??
    (typeof navigator !== 'undefined' ? navigator.userAgent : '')
  ).toLowerCase();
  const platform = (
    platformInput ??
    (typeof navigator !== 'undefined' ? navigator.platform : '')
  ).toLowerCase();
  const touchPoints =
    maxTouchPointsInput ??
    (typeof navigator !== 'undefined' ? navigator.maxTouchPoints ?? 0 : 0);

  // Explicit non-Apple platforms take precedence over generic WebKit tokens
  if (ua.includes('android')) {
    return {
      isApple: false,
      family: 'android',
      label: 'Android',
      defaultDesignMode: 'm3-expressive',
    };
  }

  if (ua.includes('cros')) {
    return {
      isApple: false,
      family: 'chromeos',
      label: 'ChromeOS',
      defaultDesignMode: 'm3-expressive',
    };
  }

  if (ua.includes('windows') || platform.startsWith('win')) {
    return {
      isApple: false,
      family: 'windows',
      label: 'Windows',
      defaultDesignMode: 'm3-expressive',
    };
  }

  const isIosOrIpad =
    ua.includes('iphone') ||
    ua.includes('ipad') ||
    ua.includes('ipod') ||
    platform.startsWith('iphone') ||
    platform.startsWith('ipad') ||
    (platform === 'macintel' && touchPoints > 1);

  const isMac =
    ua.includes('macintosh') ||
    ua.includes('mac os x') ||
    ua.includes('macos') ||
    platform.startsWith('mac');

  if (isIosOrIpad || isMac) {
    return {
      isApple: true,
      family: 'apple',
      label: isIosOrIpad ? 'iPadOS / iOS' : 'macOS',
      defaultDesignMode: 'liquid-glass',
    };
  }

  if (ua.includes('linux') || platform.startsWith('linux')) {
    return {
      isApple: false,
      family: 'linux',
      label: 'Linux',
      defaultDesignMode: 'm3-expressive',
    };
  }

  return {
    isApple: false,
    family: 'web',
    label: 'Web',
    defaultDesignMode: 'm3-expressive',
  };
}

/**
 * Enforces that `liquid-glass` can only be active on Apple hardware.
 * Non-Apple devices always resolve to `m3-expressive`.
 */
export function resolveAllowedDesignMode(
  requested: PlatformDesignMode | undefined | null,
  isApple: boolean
): PlatformDesignMode {
  if (!isApple) {
    return 'm3-expressive';
  }
  return requested === 'm3-expressive' ? 'm3-expressive' : 'liquid-glass';
}
