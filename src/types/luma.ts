import type { BufferProfile } from '../i18n/translations';

export const LUMA_APP_VERSION = '0.8.0-beta.4';
export const LUMA_RELEASE_BADGE = '0.8 beta';

export interface EpgReminder {
  programId: string;
  channelId: string;
  channelName: string;
  title: string;
  startMs: number;
}

export type PlatformDesignMode = 'm3-expressive' | 'liquid-glass';

export type NavigationSection =
  | 'live'
  | 'live-epg'
  | 'favorites'
  | 'collections'
  | 'home'
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
  vodIds?: string[];
  seriesIds?: string[];
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
  catchupMode?: string;
  catchupSource?: string;
  xtreamStreamId?: number;
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
  coverUrl?: string;
  xtreamVodId?: number;
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
  coverUrl?: string;
  xtreamSeriesId?: number;
  seasonsLoaded?: boolean;
  seasons: SeriesSeason[];
}

export interface PlaylistAccountInfo {
  status: string;
  username?: string;
  expiresAtMs: number | null; // null = Unlimited / No expiry
  createdAtMs?: number | null;
  isTrial?: boolean;
  activeConnections?: number;
  maxConnections?: number;
  serverTimezone?: string;
  checkedAtMs: number;
}

export interface PlaylistSource {
  id: string;
  name: string;
  type: 'xtream' | 'm3u_plus' | 'demo';
  endpoint: string;
  channelCount: number;
  vodCount: number;
  seriesCount?: number;
  epgStatus: 'synced' | 'syncing' | 'ready';
  epgOffsetHours: number;
  lastUpdated: string;
  accountInfo?: PlaylistAccountInfo;
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
  isExternal?: boolean;
  id?: string;
}

export interface StreamTelemetry {
  engine:
    | 'WebHLS · MSE Worker'
    | 'MPEG-TS · MSE Worker'
    | 'Tauri Rust · HLS MSE'
    | 'Tauri Rust · MPEG-TS'
    | 'Tauri Rust · FFmpeg Remux'
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
  subtitleOffsetSec?: number;
  activeSubtitleText?: string;
  activeTranscodeMode?: NativeTranscodeMode;
  proxyActive: boolean;
  proxyMode?: 'none' | 'local-rust' | 'cloud-edge';
  errorMessage?: string;
}

export type NativeTranscodeMode = 'auto' | 'remux' | 'hw';

export interface EngineProxyConfig {
  enabled: boolean;
  endpointUrl: string;
  customUserAgent?: string;
  autoFallbackOnCors?: boolean;
  bufferProfile?: BufferProfile;
  ffmpegAvailable?: boolean;
  transcodeMode?: NativeTranscodeMode;
}
