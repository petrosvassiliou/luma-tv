import { describe, expect, it } from 'vitest';
import {
  inferCastContentType,
  toCastableHlsOrMediaUrl,
} from './castAndAirPlayService';

describe('castAndAirPlayService URL & MIME helpers', () => {
  it('converts Xtream live .ts and extensionless stream URLs to .m3u8 for Apple TV & Chromecast', () => {
    expect(
      toCastableHlsOrMediaUrl('http://iptv.provider.tv:8080/live/alice/sec123/98765.ts')
    ).toBe('http://iptv.provider.tv:8080/live/alice/sec123/98765.m3u8');

    expect(
      toCastableHlsOrMediaUrl('http://iptv.provider.tv:8080/live/alice/sec123/98765')
    ).toBe('http://iptv.provider.tv:8080/live/alice/sec123/98765.m3u8');

    expect(
      toCastableHlsOrMediaUrl('http://iptv.provider.tv:8080/alice/sec123/5544.ts')
    ).toBe('http://iptv.provider.tv:8080/live/alice/sec123/5544.m3u8');
  });

  it('preserves standard HLS .m3u8 and VOD .mp4 / .mkv URLs untouched', () => {
    const hls = 'https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8';
    expect(toCastableHlsOrMediaUrl(hls)).toBe(hls);

    const mp4 = 'http://iptv.provider.tv:8080/movie/alice/sec123/4421.mp4';
    expect(toCastableHlsOrMediaUrl(mp4)).toBe(mp4);
  });

  it('infers accurate Cast MIME types from media URLs', () => {
    expect(
      inferCastContentType('https://cdn.example.com/live/master.m3u8?token=abc')
    ).toBe('application/x-mpegurl');
    expect(
      inferCastContentType('http://cdn.example.com/movie/u/p/100.mp4')
    ).toBe('video/mp4');
    expect(
      inferCastContentType('http://cdn.example.com/movie/u/p/100.mkv')
    ).toBe('video/x-matroska');
  });
});
