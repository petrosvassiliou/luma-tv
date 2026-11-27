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
  buildRustTranscodeStreamUrl,
  detectStreamDriver,
  isLocalRustProxyEndpoint,
  isNonNativeBrowserContainer,
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
  compareLumaVersions,
  evaluateGitHubReleasesForUpdate,
} from '../services/autoUpdater';
import {
  isProviderDividerChannel,
  normalizeSearchText,
  searchChannelsRanked,
  searchVodRanked,
} from '../services/channelSearch';
import {
  buildCountryBuckets,
  computeExclusiveGroupVisibility,
  detectCountryCodeFromGroupName,
  filterCountryBuckets,
} from '../services/countryGroupMatcher';
import {
  decryptSyncVault,
  encryptSyncVault,
  type LumaSyncPlainPayload,
} from '../services/lumaCloudSync';
import {
  detectPlatformEnvironment,
  resolveAllowedDesignMode,
} from '../services/platformDetection';
import {
  canAutoRefreshSource,
  isPlaylistSourceStale,
  parseXtreamAccountInfoPayload,
} from '../services/playlistService';
import {
  buildLogicalTvRows,
  pickBestSpatialCandidate,
} from '../services/spatialNavigation';
import {
  convertSubtitleToWebVtt,
  detectSubtitleLanguageFromFilename,
} from '../services/subtitleConverter';
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

    // Verify logical TV row grouping orders Top -> Bottom rows and Left -> Right columns
    const dummyEl = {} as HTMLElement;
    const rows = buildLogicalTvRows([
      {
        el: dummyEl,
        id: 'row0-right',
        region: 'main',
        form: null,
        rect: { id: 'row0-right', x: 780, y: 24, width: 140, height: 34 },
      },
      {
        el: dummyEl,
        id: 'row2-submit',
        region: 'main',
        form: null,
        rect: { id: 'row2-submit', x: 40, y: 210, width: 200, height: 36 },
      },
      {
        el: dummyEl,
        id: 'row1-tab2',
        region: 'main',
        form: null,
        rect: { id: 'row1-tab2', x: 130, y: 110, width: 120, height: 32 },
      },
      {
        el: dummyEl,
        id: 'row1-tab1',
        region: 'main',
        form: null,
        rect: { id: 'row1-tab1', x: 40, y: 110, width: 80, height: 32 },
      },
      {
        el: dummyEl,
        id: 'row2-forgot',
        region: 'main',
        form: null,
        rect: { id: 'row2-forgot', x: 300, y: 214, width: 120, height: 28 },
      },
    ]);
    expect(rows.map((r) => r.items.map((it) => it.id))).toEqual([
      ['row0-right'],
      ['row1-tab1', 'row1-tab2'],
      ['row2-submit', 'row2-forgot'],
    ]);

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

  it('autodetects Apple vs non-Apple platforms and restricts Liquid Glass strictly to Apple devices', () => {
    const mac = detectPlatformEnvironment(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15',
      'MacIntel',
      0
    );
    expect(mac.isApple).toBe(true);
    expect(mac.defaultDesignMode).toBe('liquid-glass');

    const ipad = detectPlatformEnvironment(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      'MacIntel',
      5
    );
    expect(ipad.isApple).toBe(true);
    expect(ipad.label).toBe('iPadOS / iOS');
    expect(ipad.defaultDesignMode).toBe('liquid-glass');

    const android = detectPlatformEnvironment(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36',
      'Linux armv8l',
      5
    );
    expect(android.isApple).toBe(false);
    expect(android.isAndroidTv).toBe(false);
    expect(android.defaultDesignMode).toBe('m3-expressive');

    const shieldTv = detectPlatformEnvironment(
      'Mozilla/5.0 (Linux; Android 11; SHIELD Android TV Build/RQ1A.210105.003; wv) AppleWebKit/537.36',
      'Linux aarch64',
      0
    );
    expect(shieldTv.isApple).toBe(false);
    expect(shieldTv.isAndroidTv).toBe(true);
    expect(shieldTv.label).toBe('Android TV');
    expect(shieldTv.defaultDesignMode).toBe('m3-expressive');

    const braviaTv = detectPlatformEnvironment(
      'Mozilla/5.0 (Linux; Android 12; BRAVIA 4K VH2) AppleWebKit/537.36',
      'Linux armv8l',
      0
    );
    expect(braviaTv.isAndroidTv).toBe(true);

    const cros = detectPlatformEnvironment(
      'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36',
      'Linux x86_64',
      0
    );
    expect(cros.isApple).toBe(false);
    expect(cros.isAndroidTv).toBe(false);
    expect(cros.defaultDesignMode).toBe('m3-expressive');

    // Liquid Glass cannot be enabled on non-Apple devices even if requested
    expect(resolveAllowedDesignMode('liquid-glass', false)).toBe('m3-expressive');
    expect(resolveAllowedDesignMode('liquid-glass', true)).toBe('liquid-glass');
    expect(resolveAllowedDesignMode('m3-expressive', true)).toBe('m3-expressive');
  });

  it('groups IPTV categories by country, searches by country name, and toggles exclusive visibility', () => {
    expect(detectCountryCodeFromGroupName('DE | ENTERTAINMENT')).toBe('DE');
    expect(detectCountryCodeFromGroupName('|GR| CINEMA HD')).toBe('GR');
    expect(detectCountryCodeFromGroupName('[UK] SKY SPORTS')).toBe('UK');
    expect(detectCountryCodeFromGroupName('4K: ULTRA HD')).toBe('4K');

    const groups = [
      { id: 'g-de-1', name: 'DE | SPORT', count: 120 },
      { id: 'g-de-2', name: 'DE | MOVIES', count: 80 },
      { id: 'g-gr-1', name: 'GR: ERT & SPORT', count: 65 },
      { id: 'g-uk-1', name: 'UK | ENTERTAINMENT', count: 210 },
      { id: 'g-fr-1', name: 'FR | CINEMA', count: 95 },
    ];

    const buckets = buildCountryBuckets(groups);
    expect(buckets.map((b) => b.code)).toEqual(['UK', 'DE', 'FR', 'GR']);

    expect(filterCountryBuckets(buckets, 'germany').map((b) => b.code)).toEqual(['DE']);
    expect(filterCountryBuckets(buckets, 'greece').map((b) => b.code)).toEqual(['GR']);

    const allIds = groups.map((g) => g.id);
    const selectedDeAndGr = ['g-de-1', 'g-de-2', 'g-gr-1'];

    // Enable ONLY DE + GR -> UK + FR are hidden
    expect(
      computeExclusiveGroupVisibility(allIds, selectedDeAndGr, 'enable-only-selected')
    ).toEqual(['g-uk-1', 'g-fr-1']);

    // Vice versa: Disable DE + GR -> ONLY DE + GR are hidden, UK + FR remain enabled
    expect(
      computeExclusiveGroupVisibility(allIds, selectedDeAndGr, 'disable-only-selected')
    ).toEqual(['g-de-1', 'g-de-2', 'g-gr-1']);
  });

  it('parses Xtream Codes user_info expiry timestamps, connections, and unlimited accounts', () => {
    const parsed = parseXtreamAccountInfoPayload(
      {
        user_info: {
          username: 'max4tv_user',
          status: 'Active',
          exp_date: '1800000000',
          is_trial: '0',
          active_cons: '1',
          max_connections: '3',
        },
        server_info: {
          timezone: 'Europe/Berlin',
        },
      },
      'fallback',
      1795000000000
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.username).toBe('max4tv_user');
    expect(parsed?.status).toBe('Active');
    expect(parsed?.expiresAtMs).toBe(1800000000 * 1000);
    expect(parsed?.activeConnections).toBe(1);
    expect(parsed?.maxConnections).toBe(3);
    expect(parsed?.isTrial).toBe(false);

    const unlimited = parseXtreamAccountInfoPayload({
      user_info: {
        username: 'vip',
        status: 'Active',
        exp_date: null,
        is_trial: '1',
      },
    });
    expect(unlimited?.expiresAtMs).toBeNull();
    expect(unlimited?.isTrial).toBe(true);
  });

  it('ranks exact and prefix VOD movie matches first across large catalogs', () => {
    const sampleVod = [
      {
        id: 'vod-sub',
        title: 'Behind the Scenes of Dune Part Two',
        year: 2024,
        genre: 'Documentary',
        durationMin: 60,
        rating: '7.5',
        resolution: '1080p' as const,
        codec: 'H.264' as const,
        streamUrl: 'https://vod.example/1.mp4',
        synopsis: '',
        accentFrom: '#111',
        accentTo: '#222',
      },
      {
        id: 'vod-exact',
        title: 'Dune',
        year: 2021,
        genre: 'Sci-Fi',
        durationMin: 155,
        rating: '8.4',
        resolution: '4K HDR' as const,
        codec: 'HEVC' as const,
        streamUrl: 'https://vod.example/2.mkv',
        synopsis: '',
        accentFrom: '#111',
        accentTo: '#222',
      },
      {
        id: 'vod-prefix',
        title: 'Dune: Part Two (2024)',
        year: 2024,
        genre: 'Sci-Fi',
        durationMin: 166,
        rating: '8.8',
        resolution: '4K HDR' as const,
        codec: 'HEVC' as const,
        streamUrl: 'https://vod.example/3.mkv',
        synopsis: '',
        accentFrom: '#111',
        accentTo: '#222',
      },
    ];

    const ranked = searchVodRanked(sampleVod, 'Dune', 10);
    expect(ranked.totalMatches).toBe(3);
    expect(ranked.items.map((v) => v.id)).toEqual([
      'vod-exact',
      'vod-prefix',
      'vod-sub',
    ]);
  });

  it('detects MKV/AVI containers and builds in-window Rust FFmpeg remux & VideoToolbox URLs', () => {
    expect(isNonNativeBrowserContainer('http://xtream.tv:8080/movie/u/p/991.mkv')).toBe(
      true
    );
    expect(isNonNativeBrowserContainer('http://xtream.tv:8080/movie/u/p/991.avi')).toBe(
      true
    );
    expect(isNonNativeBrowserContainer('http://xtream.tv:8080/movie/u/p/991.mp4')).toBe(
      false
    );

    const rustProxy = 'http://127.0.0.1:59001/luma-proxy/tok99/stream';
    const remuxUrl = buildRustTranscodeStreamUrl(
      'http://xtream.tv:8080/movie/u/p/991.mkv',
      {
        enabled: true,
        endpointUrl: rustProxy,
        customUserAgent: 'LumaTV/0.8',
      },
      'remux',
      125.4
    );
    expect(remuxUrl).toBe(
      `${rustProxy}?url=${encodeURIComponent('http://xtream.tv:8080/movie/u/p/991.mkv')}&transcode=remux&start=125&ua=${encodeURIComponent('LumaTV/0.8')}`
    );

    const hwUrl = buildRustTranscodeStreamUrl(
      'http://xtream.tv:8080/live/u/p/404.ts',
      { enabled: true, endpointUrl: rustProxy },
      'hw'
    );
    expect(hwUrl).toContain('&transcode=hw');
    expect(hwUrl).not.toContain('&start=');
  });

  it('evaluates playlist auto-refresh eligibility and staleness intervals accurately', () => {
    const tBase = 1_800_000_000_000;
    const xtreamSrc = {
      id: 'xt-1',
      name: 'Max4TV',
      type: 'xtream' as const,
      endpoint: 'http://max4tv.example:8080',
      rawUrlOrHost: 'http://max4tv.example:8080',
      username: 'alice',
      password: 'secret',
      channelCount: 12000,
      vodCount: 4000,
      epgStatus: 'synced' as const,
      epgOffsetHours: 0,
      lastUpdated: 'Today',
      hiddenGroupIds: [],
      createdAt: tBase,
      lastSyncedAtMs: tBase,
    };

    const localFileSrc = {
      ...xtreamSrc,
      id: 'local-1',
      type: 'm3u_plus' as const,
      rawUrlOrHost: 'local://m3u',
    };

    expect(canAutoRefreshSource(xtreamSrc)).toBe(true);
    expect(canAutoRefreshSource(localFileSrc)).toBe(false);

    // Off (0h) is never stale
    expect(isPlaylistSourceStale(xtreamSrc, 0, tBase + 48 * 3_600_000)).toBe(false);
    // 5h elapsed with 6h threshold -> not stale yet
    expect(isPlaylistSourceStale(xtreamSrc, 6, tBase + 5 * 3_600_000)).toBe(false);
    // 6.5h elapsed with 6h threshold -> stale!
    expect(isPlaylistSourceStale(xtreamSrc, 6, tBase + 6.5 * 3_600_000)).toBe(true);
    // Local file upload is never auto-refreshed over network
    expect(isPlaylistSourceStale(localFileSrc, 6, tBase + 99 * 3_600_000)).toBe(false);
  });

  it('converts SRT and ASS subtitles to WebVTT, shifts cue sync offsets, and detects language codes', () => {
    const sampleSrt = [
      '\uFEFF1',
      '00:00:01,500 --> 00:00:04,250',
      'Willkommen bei Luma TV!',
      '',
      '2',
      '00:01:10,000 --> 00:01:12,800',
      'Zweite Zeile im Kinomodus.',
    ].join('\r\n');

    const vtt = convertSubtitleToWebVtt(sampleSrt, 0);
    expect(vtt.startsWith('WEBVTT\n')).toBe(true);
    expect(vtt).toContain('00:00:01.500 --> 00:00:04.250');
    expect(vtt).toContain('00:01:10.000 --> 00:01:12.800');
    expect(vtt).not.toContain('\n1\n00:00:01');

    // Shift +2.0s and -3.0s (clamped cleanly at 00:00:00.000)
    const shiftedFwd = convertSubtitleToWebVtt(sampleSrt, 2.0);
    expect(shiftedFwd).toContain('00:00:03.500 --> 00:00:06.250');

    const shiftedBack = convertSubtitleToWebVtt(sampleSrt, -3.0);
    expect(shiftedBack).toContain('00:00:00.000 --> 00:00:01.250');

    // SubStation Alpha (.ass) Dialogue conversion with override tag stripping
    const sampleAss = [
      '[Script Info]',
      'Title: Demo',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:05.20,0:00:08.40,Default,,0,0,0,,{\\an8\\i1}Hello\\NWorld!',
    ].join('\n');
    const assVtt = convertSubtitleToWebVtt(sampleAss, 0.5);
    expect(assVtt).toContain('00:00:05.700 --> 00:00:08.900');
    expect(assVtt).toContain('Hello\nWorld!');
    expect(assVtt).not.toContain('{\\an8');

    expect(detectSubtitleLanguageFromFilename('Dune.2024.4K.de.srt').lang).toBe('de');
    expect(detectSubtitleLanguageFromFilename('Movie.2025.greek.vtt').lang).toBe('el');
    expect(detectSubtitleLanguageFromFilename('Episode.S01E02.eng.srt').lang).toBe('en');
  });

  it('compares SemVer pre-releases accurately and resolves macOS in-app & Android Play Protect updates', () => {
    expect(compareLumaVersions('0.8.0-beta.2', '0.8.0-beta.1')).toBe(1);
    expect(compareLumaVersions('0.8.0', '0.8.0-beta.9')).toBe(1);
    expect(compareLumaVersions('0.8.0-beta.1', '0.8.0-beta.1')).toBe(0);
    expect(compareLumaVersions('v0.7.0-beta.4', '0.8.0-beta.1')).toBe(-1);

    const mockReleases = [
      {
        tag_name: 'v0.8.1-beta.1',
        name: 'Luma TV v0.8.1-beta.1',
        body: 'Signed in-app macOS updater & Play Protect V3 APK.',
        prerelease: true,
        draft: false,
        published_at: '2026-11-25T10:00:00Z',
        html_url: 'https://github.com/petrosvassiliou/luma-tv/releases/tag/v0.8.1-beta.1',
        assets: [
          {
            name: 'latest.json',
            browser_download_url:
              'https://github.com/petrosvassiliou/luma-tv/releases/download/v0.8.1-beta.1/latest.json',
          },
          {
            name: 'Luma_0.8.1-beta.1_universal.dmg',
            browser_download_url:
              'https://github.com/petrosvassiliou/luma-tv/releases/download/v0.8.1-beta.1/Luma_0.8.1-beta.1_universal.dmg',
          },
          {
            name: 'Luma-TV-Android-Universal.apk',
            size: 324_000_000,
            digest: 'sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
            browser_download_url:
              'https://github.com/petrosvassiliou/luma-tv/releases/download/v0.8.1-beta.1/Luma-TV-Android-Universal.apk',
          },
        ],
      },
    ];

    const macRes = evaluateGitHubReleasesForUpdate({
      releases: mockReleases,
      currentVersion: '0.8.0-beta.1',
      includePrereleases: true,
      runtimePlatform: 'macos',
    });
    expect(macRes.updateAvailable).toBe(true);
    expect(macRes.latestVersion).toBe('0.8.1-beta.1');
    expect(macRes.strategy).toBe('macos-in-app-ed25519');
    expect(macRes.canInstallInApp).toBe(true);
    expect(macRes.latestJsonUrl).toContain('/latest.json');

    const androidRes = evaluateGitHubReleasesForUpdate({
      releases: mockReleases,
      currentVersion: '0.8.0-beta.1',
      includePrereleases: true,
      runtimePlatform: 'android',
    });
    expect(androidRes.updateAvailable).toBe(true);
    expect(androidRes.strategy).toBe('android-play-protect-verified');
    expect(androidRes.playProtectCompatible).toBe(true);
    expect(androidRes.androidApkSha256).toBe(
      'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'
    );

    // Opting out of beta pre-releases ignores prerelease tags
    const stableOnly = evaluateGitHubReleasesForUpdate({
      releases: mockReleases,
      currentVersion: '0.8.0-beta.1',
      includePrereleases: false,
      runtimePlatform: 'macos',
    });
    expect(stableOnly.updateAvailable).toBe(false);
  });
});
