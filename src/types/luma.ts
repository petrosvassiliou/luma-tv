import type { BufferProfile } from '../i18n/translations';

export const LUMA_APP_VERSION = '0.4.0-beta.1';
export const LUMA_RELEASE_BADGE = '0.4 beta';

export interface EpgReminder {
  programId: string;
  channelId: string;
  channelName: string;
  title: string;
  startMs: number;
}

export type PlatformDesignMode = 'm3-expressive' | 'liquid-glass';

export type NavigationSection =
  | 'home'
  | 'live-epg'
  | 'multiview'
  | 'vod'
  | 'series'
  | 'catchup'
  | 'studio'
  | 'sources'
  | 'settings';

export type AspectRatioMode = '16:9' | 'cover' | '21:9';

export type MultiviewLayoutMode = 'quad-2x2' | 'focus-1+3' | 'dual-2x1';

export interface ChannelGroup {
  id: string;
  name: string;
  icon: string;
  count: number;
  isCustomBouquet?: boolean;
  isPinLocked?: boolean;
}

export interface CustomBouquet {
  id: string;
  name: string;
  channelIds: string[];
  isPinLocked: boolean;
}

export interface ParentalControlConfig {
  enabled: boolean;
  pin: string;
  lockedGroupIds: string[];
}

export interface Channel {
  id: string;
  number: number;
  name: string;
  shortCode: string;
  groupId: string;
  groupName: string;
  streamUrl: string;
  streamType: 'hls' | 'mpegts';
  resolution: '4K HDR' | '1080p60' | '1080p' | '720p';
  audioBadge: 'Dolby Atmos' | 'EAC3 5.1' | 'AAC Stereo';
  codec: 'HEVC' | 'H.264';
  hasCatchup: boolean;
  catchupDays: number;
  accentColor: string;
  country: string;
  epgArchetype: number;
  tvgId?: string;
  logoUrl?: string;
}

export type ProgramCategory =
  | 'Live Sport'
  | 'Spielfilm'
  | 'Nachrichten'
  | 'Dokumentation'
  | 'Sci-Fi & Serie'
  | 'Wissen & Raumfahrt'
  | 'Kultur & Musik'
  | 'Animation';

export interface EpgProgram {
  id: string;
  channelId: string;
  title: string;
  subtitle: string;
  description: string;
  category: ProgramCategory;
  startMs: number;
  endMs: number;
  hasCatchup: boolean;
  isNew?: boolean;
  rating?: string;
}

export interface VodItem {
  id: string;
  title: string;
  year: number;
  genre: string;
  durationMin: number;
  rating: string;
  resolution: '4K HDR' | '1080p';
  codec: 'HEVC' | 'H.264';
  streamUrl: string;
  synopsis: string;
  accentFrom: string;
  accentTo: string;
}

export interface SeriesEpisode {
  id: string;
  episodeNumber: number;
  title: string;
  durationMin: number;
  synopsis: string;
  streamUrl: string;
  resolution: '4K HDR' | '1080p';
}

export interface SeriesSeason {
  seasonNumber: number;
  title: string;
  episodes: SeriesEpisode[];
}

export interface SeriesItem {
  id: string;
  title: string;
  year: number;
  genre: string;
  rating: string;
  badge: string;
  synopsis: string;
  accentFrom: string;
  accentTo: string;
  seasons: SeriesSeason[];
}

export interface PlaylistSource {
  id: string;
  name: string;
  type: 'xtream' | 'm3u_plus' | 'demo';
  endpoint: string;
  channelCount: number;
  vodCount: number;
  epgStatus: 'synced' | 'syncing' | 'ready';
  epgOffsetHours: number;
  lastUpdated: string;
}

export interface QualityLevelOption {
  index: number;
  height: number;
  bitrateKbps: number;
  label: string;
}

export interface AudioTrackOption {
  index: number;
  name: string;
  lang: string;
}

export interface SubtitleTrackOption {
  index: number;
  name: string;
  lang: string;
}

export interface StreamTelemetry {
  engine:
    | 'WebHLS · MSE Worker'
    | 'MPEG-TS · MSE Worker'
    | 'Tauri Rust · HLS MSE'
    | 'Tauri Rust · MPEG-TS'
    | 'Native Safari HLS'
    | 'Tauri v2 Native MPV'
    | 'Luma Studio Synth';
  state: 'idle' | 'connecting' | 'playing' | 'buffering' | 'synth-fallback' | 'error';
  width: number;
  height: number;
  bitrateKbps: number;
  bufferSec: number;
  latencySec: number;
  levels: QualityLevelOption[];
  currentLevel: number;
  audioTracks: AudioTrackOption[];
  currentAudioTrack: number;
  subtitleTracks: SubtitleTrackOption[];
  currentSubtitleTrack: number;
  proxyActive: boolean;
  proxyMode?: 'none' | 'local-rust' | 'cloud-edge';
  errorMessage?: string;
}

export interface EngineProxyConfig {
  enabled: boolean;
  endpointUrl: string;
  customUserAgent?: string;
  autoFallbackOnCors?: boolean;
  bufferProfile?: BufferProfile;
}
