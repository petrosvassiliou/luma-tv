import { describe, expect, it } from 'vitest';
import {
  buildChannelCatalog,
  getChannelProgramsInRange,
} from '../data/mockCatalog';
import { AUDIO_DSP_PRESETS } from '../engine/audioProcessor';
import {
  buildCatchupStreamUrl,
  formatPlaybackClock,
  parseXtreamLiveStreamUrl,
} from '../engine/catchupUrlBuilder';
import {
  buildProxiedStreamUrl,
  detectStreamDriver,
  isLocalRustProxyEndpoint,
  resolveBufferProfileSettings,
  rewriteHlsManifestUrls,
  shouldProactivelyProxyStream,
} from '../engine/corsProxy';
import { selectSupportedRecorderMimeType } from '../engine/dvrRecorder';
import {
  cycleNextLocale,
  LOCALE_META,
  normalizeLocale,
  SUPPORTED_LOCALES,
  TRANSLATIONS,
} from '../i18n/translations';
import {
  isProviderDividerChannel,
  normalizeSearchText,
  searchChannelsRanked,
} from '../services/channelSearch';
import {
  decryptSyncVault,
  encryptSyncVault,
  type LumaSyncPlainPayload,
} from '../services/lumaCloudSync';
import { pickBestSpatialCandidate } from '../services/spatialNavigation';
import {
  exportChannelsToM3uPlus,
  parseM3uContent,
  parseXmltvDocument,
  parseXmltvTimestamp,
} from '../workers/parsers';

describe('Luma TV v0.1 beta — M3U_Plus & XMLTV Parsers', () => {
  it('parses M3U_Plus attributes, discovers url-tvg, and separates HLS, MPEG-TS, and VOD', () => {
    const sample = [
      '#EXTM3U url-tvg="https://epg.example.com/guide.xml.gz"',
      '#EXTINF:-1 tvg-id="sport1.de" tvg-chno="10" group-title="Live Sport" catchup="default" catchup-days="7",Luma Motorsport 4K UHD',
      'https://cdn.example.com/live/sport1/master.m3u8',
      '#EXTINF:-1 tvg-id="xtream.ts" tvg-chno="11" group-title="Xtream Raw",Xtream Arena HD',
      'http://xtream.example.com:8080/live/user/pass/4021.ts',
      '#EXTINF:-1 group-title="Sci-Fi Blockbuster",Solaris 4K Master',
      'https://vod.example.com/movie/user/pass/9981.mp4',
    ].join('\n');

    const res = parseM3uContent('test-src', sample);

    expect(res.discoveredXmltvUrl).toBe('https://epg.example.com/guide.xml.gz');
    expect(res.channels).toHaveLength(2);
    expect(res.vodItems).toHaveLength(1);

    expect(res.channels[0].number).toBe(10);
    expect(res.channels[0].tvgId).toBe('sport1.de');
    expect(res.channels[0].streamType).toBe('hls');
    expect(res.channels[0].resolution).toBe('4K HDR');
    expect(res.channels[0].catchupDays).toBe(7);

    expect(res.channels[1].streamType).toBe('mpegts');
    expect(res.vodItems[0].title).toBe('Solaris 4K Master');
    expect(res.vodItems[0].resolution).toBe('4K HDR');
  });

  it('exports custom bouquets back to valid M3U_Plus format', () => {
    const { channels } = buildChannelCatalog(3);
    const exported = exportChannelsToM3uPlus('Mein Sport Bouquet', channels.slice(0, 2));
    expect(exported).toContain('#EXTM3U x-luma-bouquet="Mein Sport Bouquet"');
    expect(exported).toContain('group-title="Mein Sport Bouquet"');
    expect(exported).toContain(channels[0].streamUrl);
  });

  it('parses XMLTV timestamps with timezone offsets and extracts programme entries', () => {
    const utcEpoch = Date.UTC(2026, 10, 22, 18, 0, 0); // 2026-11-22 18:00:00 UTC
    // 20:00:00 +0200 equals 18:00:00 UTC
    expect(parseXmltvTimestamp('20261122200000 +0200')).toBe(utcEpoch);
    // 13:00:00 -0500 equals 18:00:00 UTC
    expect(parseXmltvTimestamp('20261122130000 -0500')).toBe(utcEpoch);

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <tv>
        <programme start="20261122200000 +0200" stop="20261122210000 +0200" channel="rbtv.at">
          <title>UCI Downhill &amp; Finals</title>
          <sub-title>Live aus Val di Sole</sub-title>
          <desc>Top-Athleten im Finale.</desc>
          <category>Live Sport</category>
        </programme>
      </tv>`;

    const programs = parseXmltvDocument('src-1', xml, utcEpoch + 7200_000);
    expect(programs).toHaveLength(1);
    expect(programs[0].title).toBe('UCI Downhill & Finals');
    expect(programs[0].category).toBe('Live Sport');
    expect(programs[0].endMs - programs[0].startMs).toBe(3600_000);
    expect(programs[0].hasCatchup).toBe(true);
  });
});

describe('Luma TV v0.1 beta — Stream Driver Detection & CORS Manifest Proxy', () => {
  it('classifies HLS, MPEG-TS, and Progressive MP4 URLs accurately', () => {
    expect(detectStreamDriver('https://cdn.example.com/live/master.m3u8')).toBe('hls');
    expect(detectStreamDriver('http://provider.tv:8080/live/u/p/101.ts')).toBe('mpegts');
    expect(detectStreamDriver('https://provider.tv/stream?id=5&output=mpegts')).toBe('mpegts');
    expect(detectStreamDriver('https://vod.example.com/film.mp4')).toBe('progressive');
  });

  it('rewrites relative segments and #EXT-X-KEY URIs inside HLS manifests without double-wrapping', () => {
    const manifest = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-KEY:METHOD=AES-128,URI="keys/enc.key"',
      '#EXTINF:6.000,',
      'seg_0001.ts',
    ].join('\n');

    const rewritten = rewriteHlsManifestUrls(
      manifest,
      'https://origin.iptv.example/live/ch1/index.m3u8',
      'https://luma-tv-app.web.app/api/stream-proxy',
      'LumaTV/0.1-beta'
    );

    expect(rewritten).toContain(
      'URI="https://luma-tv-app.web.app/api/stream-proxy?url=' +
        encodeURIComponent('https://origin.iptv.example/live/ch1/keys/enc.key')
    );
    expect(rewritten).toContain(
      'https://luma-tv-app.web.app/api/stream-proxy?url=' +
        encodeURIComponent('https://origin.iptv.example/live/ch1/seg_0001.ts')
    );

    const alreadyProxied = buildProxiedStreamUrl(
      'https://luma-tv-app.web.app/api/stream-proxy?url=https%3A%2F%2Ffoo.bar',
      { enabled: true, endpointUrl: 'https://luma-tv-app.web.app/api/stream-proxy' }
    );
    expect(alreadyProxied).toBe(
      'https://luma-tv-app.web.app/api/stream-proxy?url=https%3A%2F%2Ffoo.bar'
    );
  });

  it('routes cleartext HTTP IPTV streams through Tauri Rust loopback proxy and tunes MSE buffer profiles', () => {
    const rustProxyUrl = 'http://127.0.0.1:54321/luma-proxy/a1b2c3d4/stream';
    const cloudProxyUrl = 'https://luma-tv-app.web.app/api/stream-proxy';

    expect(isLocalRustProxyEndpoint(rustProxyUrl)).toBe(true);
    expect(isLocalRustProxyEndpoint(cloudProxyUrl)).toBe(false);

    // Cleartext HTTP IPTV stream is proactively routed via local Rust proxy
    expect(
      shouldProactivelyProxyStream('http://xtream.example.tv:8080/live/u/p/101.ts', {
        enabled: false,
        endpointUrl: rustProxyUrl,
        autoFallbackOnCors: true,
      })
    ).toBe(true);

    // Public HTTPS CDN stream loads directly first unless always-proxy is enabled
    expect(
      shouldProactivelyProxyStream('https://cdn.example.com/live/master.m3u8', {
        enabled: false,
        endpointUrl: rustProxyUrl,
        autoFallbackOnCors: true,
      })
    ).toBe(false);

    // Cleartext HTTP stream on HTTPS PWA origin proactively uses cloud proxy to avoid mixed-content block
    expect(
      shouldProactivelyProxyStream(
        'http://xtream.example.tv:8080/live/u/p/101.m3u8',
        {
          enabled: false,
          endpointUrl: cloudProxyUrl,
          autoFallbackOnCors: true,
        },
        'https:'
      )
    ).toBe(true);

    // Respects explicit opt-out
    expect(
      shouldProactivelyProxyStream('http://xtream.example.tv:8080/live/u/p/101.ts', {
        enabled: false,
        endpointUrl: rustProxyUrl,
        autoFallbackOnCors: false,
      })
    ).toBe(false);

    const lowLat = resolveBufferProfileSettings('low-latency');
    const balanced = resolveBufferProfileSettings('balanced');
    const cinema = resolveBufferProfileSettings('cinema-max');
    expect(lowLat.hlsMaxBufferLength).toBeLessThan(balanced.hlsMaxBufferLength);
    expect(cinema.hlsMaxBufferLength).toBeGreaterThan(balanced.hlsMaxBufferLength);
    expect(cinema.mpegtsMaxLatency).toBeGreaterThan(lowLat.mpegtsMaxLatency);
  });
});

describe('Luma TV v0.1 beta — Zero-Knowledge AES-256-GCM Sync Vault & 20k EPG Engine', () => {
  it('encrypts and decrypts LumaSyncPlainPayload via PBKDF2 + AES-256-GCM and rejects wrong passphrases', async () => {
    const payload: LumaSyncPlainPayload = {
      schemaVersion: 1,
      exportedAt: Date.now(),
      favorites: ['ch-redbull-tv', 'ch-nasa-public'],
      watchHistory: [
        {
          itemId: 'ep-orb-s1e1',
          title: 'Orbital Horizon S01E01',
          kind: 'vod',
          resumeSec: 940,
          durationSec: 3120,
          updatedAt: Date.now(),
        },
      ],
      epgOffsetHours: 1,
      preferredDesign: 'liquid-glass',
    };

    const envelope = await encryptSyncVault(payload, 'correct-horse-battery');
    expect(envelope.alg).toBe('AES-256-GCM');
    expect(envelope.cipherBase64.length).toBeGreaterThan(32);

    const restored = await decryptSyncVault(envelope, 'correct-horse-battery');
    expect(restored.favorites).toEqual(payload.favorites);
    expect(restored.preferredDesign).toBe('liquid-glass');
    expect(restored.watchHistory[0].resumeSec).toBe(940);

    await expect(decryptSyncVault(envelope, 'wrong-passphrase')).rejects.toThrow();
  });

  it('builds 20,400 channels quickly and generates contiguous EPG program windows', () => {
    const t0 = performance.now();
    const { channels, groups } = buildChannelCatalog(20_400);
    const elapsed = performance.now() - t0;

    expect(channels).toHaveLength(20_400);
    expect(groups.length).toBeGreaterThanOrEqual(6);
    expect(elapsed).toBeLessThan(250);

    const now = Date.now();
    const progs = getChannelProgramsInRange(
      channels[19_999],
      now - 3600_000,
      now + 3600_000,
      now
    );
    expect(progs.length).toBeGreaterThan(0);
    for (let i = 1; i < progs.length; i++) {
      expect(progs[i].startMs).toBe(progs[i - 1].endMs);
    }
  });

  it('provides calibrated Studio Audio DSP curves and safe DVR fallback in headless Node', () => {
    expect(AUDIO_DSP_PRESETS['vocal-boost'].midPeakDb).toBeGreaterThan(4);
    expect(AUDIO_DSP_PRESETS['night-leveler'].compressorActive).toBe(true);
    const recFormat = selectSupportedRecorderMimeType();
    expect(['mp4', 'webm']).toContain(recFormat.extension);
  });

  it('selects accurate 2D spatial focus targets for D-Pad / TV remotes and maintains DE/EN parity', () => {
    const origin = { id: 'btn-a', x: 100, y: 100, width: 80, height: 40 };
    const candidates = [
      origin,
      { id: 'btn-right-aligned', x: 220, y: 102, width: 80, height: 40 },
      { id: 'btn-diagonal-far', x: 230, y: 320, width: 80, height: 40 },
      { id: 'btn-below', x: 105, y: 180, width: 80, height: 40 },
    ];

    expect(pickBestSpatialCandidate(origin, candidates, 'right')).toBe('btn-right-aligned');
    expect(pickBestSpatialCandidate(origin, candidates, 'down')).toBe('btn-below');
    expect(pickBestSpatialCandidate(origin, candidates, 'left')).toBeNull();

    // Verify 100% translation key parity across DE, EN, IT, FR, ES, and GR
    expect(SUPPORTED_LOCALES).toEqual(['de', 'en', 'it', 'fr', 'es', 'gr']);
    const baseKeys = Object.keys(TRANSLATIONS.de);
    for (const loc of SUPPORTED_LOCALES) {
      expect(Object.keys(TRANSLATIONS[loc])).toEqual(baseKeys);
      expect(() => new Intl.DateTimeFormat(LOCALE_META[loc].bcp47).format(Date.now())).not.toThrow();
    }
    expect(normalizeLocale('el')).toBe('gr');
    expect(normalizeLocale('IT')).toBe('it');
    expect(cycleNextLocale('es')).toBe('gr');
    expect(cycleNextLocale('gr')).toBe('de');
  });

  it('builds real Xtream timeshift, M3U catchup-source, Flussonic, and scrubber timecodes', () => {
    const startMs = Date.UTC(2026, 10, 23, 18, 30, 0); // 2026-11-23 18:30:00 UTC
    const endMs = startMs + 45 * 60_000;
    const nowMs = startMs + 2 * 3600_000;

    const { channels } = buildChannelCatalog(2);
    const baseChannel = channels[0];
    const program = {
      id: 'prog-1',
      channelId: baseChannel.id,
      title: 'Evening Finals',
      subtitle: 'Live Archive',
      description: 'Catch-up test',
      category: 'Live Sport' as const,
      startMs,
      endMs,
      hasCatchup: true,
    };

    // 1. Xtream Codes /timeshift/{user}/{pass}/{duration}/{YYYY-MM-DD:HH-mm}/{id}.{ext}
    const xtChannel = {
      ...baseChannel,
      streamUrl: 'http://xtream.provider.tv:8080/live/alice/secret99/4021.ts',
    };
    expect(parseXtreamLiveStreamUrl(xtChannel.streamUrl)?.streamId).toBe('4021');
    expect(buildCatchupStreamUrl(xtChannel, program, nowMs)).toBe(
      'http://xtream.provider.tv:8080/timeshift/alice/secret99/45/2026-11-23:18-30/4021.ts'
    );

    // 2. M3U_Plus catchup-source macro template + parser roundtrip
    const m3uSample = [
      '#EXTM3U',
      '#EXTINF:-1 tvg-id="arte.tv" catchup="default" catchup-days="7" catchup-source="https://archive.example.tv/ch1/${start}-${duration}.m3u8?d={Y}-{m}-{d}",ARTE UHD',
      'https://live.example.tv/ch1/index.m3u8',
    ].join('\n');
    const parsedM3u = parseM3uContent('src-cu', m3uSample);
    expect(parsedM3u.channels[0].catchupSource).toContain('${start}-${duration}');
    expect(buildCatchupStreamUrl(parsedM3u.channels[0], program, nowMs)).toBe(
      `https://archive.example.tv/ch1/${Math.floor(startMs / 1000)}-2700.m3u8?d=2026-11-23`
    );

    // 3. Flussonic archive convention
    const flussonicChannel = {
      ...baseChannel,
      streamUrl: 'https://flussonic.example.tv/sport1/mono.m3u8?token=abc',
      catchupMode: 'flussonic',
    };
    expect(buildCatchupStreamUrl(flussonicChannel, program, nowMs)).toBe(
      `https://flussonic.example.tv/sport1/index-${Math.floor(startMs / 1000)}-2700.m3u8?token=abc`
    );

    // 4. Scrubber timecodes
    expect(formatPlaybackClock(65)).toBe('01:05');
    expect(formatPlaybackClock(5049)).toBe('1:24:09');
  });

  it('normalizes IPTV Unicode superscripts and finds all matches across 54,000+ channels', () => {
    expect(normalizeSearchText('4K: ELEVEN ᴾᴸ ᵁᴴᴰ ³⁸⁴⁰ᴾ')).toBe('4k eleven pl uhd 3840p');
    expect(normalizeSearchText('4K: SKY SPORTS F1 ᵁᴴᴰ ³⁸⁴⁰ᴾ')).toBe(
      '4k sky sports f1 uhd 3840p'
    );
    expect(normalizeSearchText('VIP | CINEMA ᶠᴴᴰ')).toBe('vip cinema fhd');

    expect(isProviderDividerChannel('##### 4K ᵁᴴᴰ ³⁸⁴⁰ᴾ #####')).toBe(true);
    expect(isProviderDividerChannel('4K: V SPORT ᵁᴴᴰ ³⁸⁴⁰ᴾ')).toBe(false);

    const { channels } = buildChannelCatalog(54_200);
    // Inject target channels at the start, middle, and very end (>54,000)
    channels[10] = {
      ...channels[10],
      id: 'xt-11',
      number: 11,
      name: '4K: SKY SPORTS F1 ᵁᴴᴰ ³⁸⁴⁰ᴾ',
      groupName: 'UK | UHD SPORT',
    };
    channels[28_500] = {
      ...channels[28_500],
      id: 'xt-28501',
      number: 28501,
      name: 'DE: SKY SPORT F1 ᶠᴴᴰ',
      groupName: 'DE | SPORT',
    };
    channels[54_140] = {
      ...channels[54_140],
      id: 'xt-54141',
      number: 54141,
      name: 'IT: SKY SPORT F1 ᵁᴴᴰ',
      groupName: 'IT | SPORT',
    };

    const res = searchChannelsRanked(channels, 'sky f1 uhd', 100);
    expect(res.totalMatches).toBeGreaterThanOrEqual(2);
    const ids = res.items.map((c) => c.id);
    expect(ids).toContain('xt-11');
    expect(ids).toContain('xt-54141');

    const allSkyF1 = searchChannelsRanked(channels, 'sky f1', 100);
    expect(allSkyF1.items.map((c) => c.id)).toEqual(
      expect.arrayContaining(['xt-11', 'xt-28501', 'xt-54141'])
    );
  });
});
