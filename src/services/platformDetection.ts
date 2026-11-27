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
  isAndroidTv: boolean;
  family: DetectedPlatformFamily;
  label: string;
  defaultDesignMode: PlatformDesignMode;
}

interface AndroidTvBridgeWindow {
  LumaAndroidWindow?: {
    isTelevision?: () => boolean;
  };
}

const ANDROID_TV_UA_PATTERN =
  /\b(android tv|googletv|google tv|bravia|shield android tv|aft[a-z0-9]{1,8}|mibox|chromecast|smarttv|adt-\d|philipstv|hisense|tcl[-\s]tv|onn\.\s*4k)\b/i;

export function isAndroidTvUserAgent(userAgent: string): boolean {
  const ua = userAgent.toLowerCase();
  if (ua.includes('cros')) return false;
  return ua.includes('android') && ANDROID_TV_UA_PATTERN.test(ua);
}

/**
 * Detects the host OS / device family from User-Agent, platform, and touch points.
 * Apple Liquid Glass (`liquid-glass`) is strictly reserved for Apple devices
 * (macOS, iPadOS, iOS). All other platforms use Material 3 Expressive (`m3-expressive`).
 * `isAndroidTv` is strictly true ONLY on Android TV / Google TV hardware (never on
 * macOS, ChromeOS / Googlebooks, or Android phones/tablets).
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

  const nativeTvBridgeActive =
    userAgentInput === undefined &&
    typeof window !== 'undefined' &&
    Boolean(
      (window as unknown as AndroidTvBridgeWindow).LumaAndroidWindow?.isTelevision?.()
    );

  // ChromeOS / Googlebooks always resolve to ChromeOS (never Android TV)
  if (ua.includes('cros')) {
    return {
      isApple: false,
      isAndroidTv: false,
      family: 'chromeos',
      label: 'ChromeOS',
      defaultDesignMode: 'm3-expressive',
    };
  }

  // Explicit Android / Android TV check
  if (nativeTvBridgeActive || ua.includes('android')) {
    const isTv = nativeTvBridgeActive || isAndroidTvUserAgent(ua);
    return {
      isApple: false,
      isAndroidTv: isTv,
      family: 'android',
      label: isTv ? 'Android TV' : 'Android',
      defaultDesignMode: 'm3-expressive',
    };
  }

  if (ua.includes('windows') || platform.startsWith('win')) {
    return {
      isApple: false,
      isAndroidTv: false,
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
      isAndroidTv: false,
      family: 'apple',
      label: isIosOrIpad ? 'iPadOS / iOS' : 'macOS',
      defaultDesignMode: 'liquid-glass',
    };
  }

  if (ua.includes('linux') || platform.startsWith('linux')) {
    return {
      isApple: false,
      isAndroidTv: false,
      family: 'linux',
      label: 'Linux',
      defaultDesignMode: 'm3-expressive',
    };
  }

  return {
    isApple: false,
    isAndroidTv: false,
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
