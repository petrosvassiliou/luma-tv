export type LumaLocale = 'de' | 'en';

export type BufferProfile = 'low-latency' | 'balanced' | 'cinema-max';

export interface LumaPreferences {
  locale: LumaLocale;
  bufferProfile: BufferProfile;
  sleepTimerMinutes: number; // 0 = Off
  spatialDpadEnabled: boolean;
}

export function detectSystemLocale(): LumaLocale {
  if (typeof navigator === 'undefined') return 'de';
  return navigator.language.toLowerCase().startsWith('de') ? 'de' : 'en';
}

export const TRANSLATIONS = {
  de: {
    searchPlaceholder: 'Sender, EPG, Filme oder Serien suchen…',
    channelsUnit: 'Kanäle',
    navHome: 'Start & Weiterschauen',
    navLive: 'Live TV & EPG',
    navMultiview: 'Multiview 4x',
    navVod: 'Cinema VOD',
    navSeries: 'Xtream Serien',
    navCatchup: 'Catch-Up Archiv',
    navStudio: 'Channel Studio',
    navSources: 'Quellen & Cloud',
    navSettings: 'Einstellungen',
    allChannels: 'Alle Kanäle',
    favorites: 'Favoriten',
    bouquetsHeader: 'Bouquets & Gruppen',
    workspaceHeader: 'Mediathek',
    epgNow: 'Jetzt',
    epgFilter: 'Kanal im EPG filtern…',
    unmute: 'Ton aktivieren',
    fullscreen: 'Vollbild',
    sleepActive: 'Sleep',
    shortcutsHelpTitle: 'Steuerung · Tastatur, Touch & TV-Remote',
  },
  en: {
    searchPlaceholder: 'Search channels, EPG, movies, or series…',
    channelsUnit: 'Channels',
    navHome: 'Home & Continue',
    navLive: 'Live TV & EPG',
    navMultiview: 'Multiview 4x',
    navVod: 'Cinema VOD',
    navSeries: 'Xtream Series',
    navCatchup: 'Catch-Up Archive',
    navStudio: 'Channel Studio',
    navSources: 'Sources & Cloud',
    navSettings: 'Settings',
    allChannels: 'All Channels',
    favorites: 'Favorites',
    bouquetsHeader: 'Bouquets & Groups',
    workspaceHeader: 'Library',
    epgNow: 'Now',
    epgFilter: 'Filter EPG channels…',
    unmute: 'Unmute Audio',
    fullscreen: 'Fullscreen',
    sleepActive: 'Sleep',
    shortcutsHelpTitle: 'Controls · Keyboard, Touch & TV Remote',
  },
} as const;
