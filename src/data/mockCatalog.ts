import type {
  Channel,
  ChannelGroup,
  EpgProgram,
  PlaylistSource,
  ProgramCategory,
  SeriesItem,
  VodItem,
} from '../types/luma';

export const VERIFIED_HLS_STREAMS = {
  redBullLive: 'https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8',
  dwLive: 'https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8',
  nasaLive: 'https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8',
  tearsOfSteel:
    'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8',
  bigBuckBunny: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
  angelOne: 'https://storage.googleapis.com/shaka-demo-assets/angel-one-hls/hls.m3u8',
  blenderLive: 'https://ireplay.tv/test/blender.m3u8',
  akamaiClock: 'https://cph-p2p-msl.akamaized.net/hls/live/2000341/test/master.m3u8',
  muxPts: 'https://test-streams.mux.dev/pts_shift/master.m3u8',
  darkTruths: 'https://storage.googleapis.com/shaka-demo-assets/bbb-dark-truths-hls/hls.m3u8',
} as const;

const STREAM_POOL = Object.values(VERIFIED_HLS_STREAMS);

const CURATED_FLAGSHIP_CHANNELS: Omit<Channel, 'number'>[] = [
  {
    id: 'ch-redbull-tv',
    name: 'Red Bull TV HD',
    shortCode: 'RBTV',
    groupId: 'sport',
    groupName: 'Sport & Motorsport Live',
    streamUrl: VERIFIED_HLS_STREAMS.redBullLive,
    streamType: 'hls',
    resolution: '1080p60',
    audioBadge: 'EAC3 5.1',
    codec: 'H.264',
    hasCatchup: true,
    catchupDays: 7,
    accentColor: '#38BDF8',
    country: 'AT',
    epgArchetype: 0,
  },
  {
    id: 'ch-luma-cinema-4k',
    name: 'Luma Cinema 4K · Sci-Fi',
    shortCode: 'LC4K',
    groupId: 'cinema',
    groupName: 'Cinema & 4K HDR',
    streamUrl: VERIFIED_HLS_STREAMS.tearsOfSteel,
    streamType: 'hls',
    resolution: '4K HDR',
    audioBadge: 'Dolby Atmos',
    codec: 'HEVC',
    hasCatchup: true,
    catchupDays: 14,
    accentColor: '#60A5FA',
    country: 'DE',
    epgArchetype: 1,
  },
  {
    id: 'ch-dw-global',
    name: 'DW International HD',
    shortCode: 'DW',
    groupId: 'news',
    groupName: 'News & International',
    streamUrl: VERIFIED_HLS_STREAMS.dwLive,
    streamType: 'hls',
    resolution: '1080p',
    audioBadge: 'AAC Stereo',
    codec: 'H.264',
    hasCatchup: true,
    catchupDays: 3,
    accentColor: '#38BDF8',
    country: 'DE',
    epgArchetype: 2,
  },
  {
    id: 'ch-nasa-public',
    name: 'NASA Mission TV HD',
    shortCode: 'NASA',
    groupId: 'doku',
    groupName: 'Dokumentation & Wissen',
    streamUrl: VERIFIED_HLS_STREAMS.nasaLive,
    streamType: 'hls',
    resolution: '1080p60',
    audioBadge: 'EAC3 5.1',
    codec: 'H.264',
    hasCatchup: true,
    catchupDays: 7,
    accentColor: '#0EA5E9',
    country: 'US',
    epgArchetype: 3,
  },
  {
    id: 'ch-blender-studio',
    name: 'Blender Open Studio HD',
    shortCode: 'BLND',
    groupId: 'animation',
    groupName: 'Animation & Indie',
    streamUrl: VERIFIED_HLS_STREAMS.blenderLive,
    streamType: 'hls',
    resolution: '1080p',
    audioBadge: 'EAC3 5.1',
    codec: 'H.264',
    hasCatchup: true,
    catchupDays: 7,
    accentColor: '#22D3EE',
    country: 'NL',
    epgArchetype: 4,
  },
  {
    id: 'ch-scifi-vault',
    name: 'Luma Classics · Federation',
    shortCode: 'SCFI',
    groupId: 'cinema',
    groupName: 'Cinema & 4K HDR',
    streamUrl: VERIFIED_HLS_STREAMS.angelOne,
    streamType: 'hls',
    resolution: '1080p',
    audioBadge: 'EAC3 5.1',
    codec: 'H.264',
    hasCatchup: true,
    catchupDays: 7,
    accentColor: '#818CF8',
    country: 'US',
    epgArchetype: 5,
  },
  {
    id: 'ch-mux-animation',
    name: 'Mux Premiere Animation',
    shortCode: 'MUXA',
    groupId: 'animation',
    groupName: 'Animation & Indie',
    streamUrl: VERIFIED_HLS_STREAMS.bigBuckBunny,
    streamType: 'hls',
    resolution: '1080p60',
    audioBadge: 'AAC Stereo',
    codec: 'H.264',
    hasCatchup: true,
    catchupDays: 5,
    accentColor: '#34D399',
    country: 'EU',
    epgArchetype: 4,
  },
  {
    id: 'ch-akamai-sync',
    name: 'Broadcast Master Clock 24/7',
    shortCode: 'SYNC',
    groupId: 'public-de',
    groupName: 'DE · Hauptsender',
    streamUrl: VERIFIED_HLS_STREAMS.akamaiClock,
    streamType: 'hls',
    resolution: '1080p60',
    audioBadge: 'AAC Stereo',
    codec: 'H.264',
    hasCatchup: false,
    catchupDays: 0,
    accentColor: '#38BDF8',
    country: 'DE',
    epgArchetype: 2,
  },
  {
    id: 'ch-mux-motorsport',
    name: 'Apex Telemetry Sport HD',
    shortCode: 'APEX',
    groupId: 'sport',
    groupName: 'Sport & Motorsport Live',
    streamUrl: VERIFIED_HLS_STREAMS.muxPts,
    streamType: 'hls',
    resolution: '1080p60',
    audioBadge: 'Dolby Atmos',
    codec: 'HEVC',
    hasCatchup: true,
    catchupDays: 7,
    accentColor: '#06B6D4',
    country: 'EU',
    epgArchetype: 0,
  },
  {
    id: 'ch-shaka-noir',
    name: 'Luma Arthaus UHD',
    shortCode: 'ARTH',
    groupId: 'cinema',
    groupName: 'Cinema & 4K HDR',
    streamUrl: VERIFIED_HLS_STREAMS.darkTruths,
    streamType: 'hls',
    resolution: '4K HDR',
    audioBadge: 'Dolby Atmos',
    codec: 'HEVC',
    hasCatchup: true,
    catchupDays: 14,
    accentColor: '#6366F1',
    country: 'DE',
    epgArchetype: 1,
  },
];

const PROCEDURAL_GROUPS: { id: string; name: string; icon: string; prefixes: string[]; country: string }[] = [
  {
    id: 'public-de',
    name: 'DE · Hauptsender',
    icon: 'Tv',
    prefixes: ['Das Erste Regional', 'ZDF Neo Feed', '3sat Kultur', 'Phoenix Live', 'Arte Studio', 'ARD Alpha'],
    country: 'DE',
  },
  {
    id: 'sport',
    name: 'Sport & Motorsport Live',
    icon: 'Trophy',
    prefixes: ['Luma Sport Arena', 'Eurosport Feed', 'Motorsport Pitlane', 'Bundesliga Konferenz', 'Alpine Ski'],
    country: 'DE',
  },
  {
    id: 'cinema',
    name: 'Cinema & 4K HDR',
    icon: 'Film',
    prefixes: ['Cinema UHD', 'Premiere Action', 'Director Cut', 'Thriller Vault', 'Silver Screen'],
    country: 'EU',
  },
  {
    id: 'news',
    name: 'News & International',
    icon: 'Globe',
    prefixes: ['World Desk', 'Euro Briefing', 'Financial Pulse', 'Parliament Live', 'Global 24'],
    country: 'INT',
  },
  {
    id: 'doku',
    name: 'Dokumentation & Wissen',
    icon: 'Compass',
    prefixes: ['Orbital Science', 'Deep Ocean', 'Terra Nova', 'Tech Pioneers', 'History HD'],
    country: 'US',
  },
  {
    id: 'animation',
    name: 'Animation & Indie',
    icon: 'Sparkles',
    prefixes: ['Studio Render', 'Anime Horizon', 'Toon Classics', 'Pixel Stage', 'VFX Showcase'],
    country: 'JP',
  },
];

const ACCENT_PALETTE = ['#38BDF8', '#60A5FA', '#22D3EE', '#818CF8', '#34D399', '#0EA5E9'];

export function buildChannelCatalog(totalCount: number): {
  channels: Channel[];
  groups: ChannelGroup[];
} {
  const channels: Channel[] = [];

  CURATED_FLAGSHIP_CHANNELS.forEach((c, idx) => {
    channels.push({
      ...c,
      number: idx + 1,
    });
  });

  const remaining = Math.max(0, totalCount - channels.length);
  for (let i = 0; i < remaining; i++) {
    const groupMeta = PROCEDURAL_GROUPS[i % PROCEDURAL_GROUPS.length];
    const prefix = groupMeta.prefixes[i % groupMeta.prefixes.length];
    const feedNum = Math.floor(i / PROCEDURAL_GROUPS.length) + 1;
    const number = channels.length + 1;
    const is4k = i % 5 === 0;

    channels.push({
      id: `ch-proc-${number}`,
      number,
      name: `${prefix} ${feedNum} ${is4k ? 'UHD' : 'HD'}`,
      shortCode: `${prefix.slice(0, 2).toUpperCase()}${(feedNum % 99) + 1}`,
      groupId: groupMeta.id,
      groupName: groupMeta.name,
      streamUrl: STREAM_POOL[i % STREAM_POOL.length],
      streamType: 'hls',
      resolution: is4k ? '4K HDR' : i % 2 === 0 ? '1080p60' : '1080p',
      audioBadge: is4k ? 'Dolby Atmos' : i % 3 === 0 ? 'EAC3 5.1' : 'AAC Stereo',
      codec: is4k ? 'HEVC' : 'H.264',
      hasCatchup: i % 3 !== 2,
      catchupDays: i % 3 !== 2 ? 7 : 0,
      accentColor: ACCENT_PALETTE[i % ACCENT_PALETTE.length],
      country: groupMeta.country,
      epgArchetype: i % 6,
    });
  }

  const counts = new Map<string, number>();
  for (const ch of channels) {
    counts.set(ch.groupId, (counts.get(ch.groupId) ?? 0) + 1);
  }

  const groups: ChannelGroup[] = PROCEDURAL_GROUPS.map((g) => ({
    id: g.id,
    name: g.name,
    icon: g.icon,
    count: counts.get(g.id) ?? 0,
  }));

  return { channels, groups };
}

interface ProgramTemplate {
  title: string;
  subtitle: string;
  description: string;
  category: ProgramCategory;
  durationMin: number;
  rating?: string;
}

const ARCHETYPE_LINEUPS: ProgramTemplate[][] = [
  // 0: Sport & Motorsport
  [
    {
      title: 'UCI Downhill World Cup · Val di Sole',
      subtitle: 'Elite Finals Live Übertragung',
      description: 'Hochgeschwindigkeits-Abfahrt mit Helmkamera-Telemetrie, Zwischenzeiten und Expertenanalyse aus Italien.',
      category: 'Live Sport',
      durationMin: 65,
    },
    {
      title: 'Apex GT3 Endurance Series',
      subtitle: 'Qualifying & Boxengassen-Fokus',
      description: 'Onboard-Perspektiven in 60fps inklusive Live-Reifentemperaturen und Funkverkehr der Top-Teams.',
      category: 'Live Sport',
      durationMin: 55,
    },
    {
      title: 'Freeride World Tour · Alaska Peak',
      subtitle: 'Backcountry Highlights',
      description: 'Spektakuläre Big-Mountain-Lines im unberührten Tiefschnee von Haines mit Drohnen-Tracking.',
      category: 'Live Sport',
      durationMin: 45,
    },
    {
      title: 'Paddock Night Talk',
      subtitle: 'Technik-Analyse & Aerodynamik',
      description: 'Ingenieure erklären Ground-Effect-Diffusoren und Hybrid-Rekuperation der aktuellen Saison.',
      category: 'Live Sport',
      durationMin: 50,
    },
  ],
  // 1: Cinema & 4K HDR
  [
    {
      title: 'Tears of Steel · Director’s Master',
      subtitle: 'Sci-Fi Kurzfilm · Open Movie 4K HDR',
      description: 'In einem futuristischen Amsterdam versucht eine Gruppe von Widerstandskämpfern und Wissenschaftlern die Welt vor zerstörerischen Robotern zu retten.',
      category: 'Spielfilm',
      durationMin: 75,
      rating: 'FSK 12',
    },
    {
      title: 'Solaris Horizon',
      subtitle: 'Cyberpunk Neo-Noir · Dolby Atmos',
      description: 'Ein Spezialist für orbitale Quanten-Relais entdeckt ein rätselhaftes Echo aus einer längst aufgegebenen Kolonie.',
      category: 'Spielfilm',
      durationMin: 95,
      rating: 'FSK 16',
    },
    {
      title: 'Cinematography of Light',
      subtitle: 'Making-of & Color Grading HDR10+',
      description: 'Blick hinter die Kulissen moderner VFX-Pipelines, anamorphotischer Objektive und OLED-Mastering.',
      category: 'Kultur & Musik',
      durationMin: 40,
      rating: 'FSK 6',
    },
  ],
  // 2: News & Global
  [
    {
      title: 'DW Global Briefing',
      subtitle: 'Weltnachrichten & Korrespondenten',
      description: 'Live-Schalten nach Berlin, Brüssel, Washington und Tokio zu den wichtigsten geopolitischen Entwicklungen.',
      category: 'Nachrichten',
      durationMin: 30,
    },
    {
      title: 'European Tech & Markets',
      subtitle: 'Halbleiter, KI & Energiewende',
      description: 'Hintergrundberichte von den europäischen Technologie-Standorten und Börsenplätzen.',
      category: 'Nachrichten',
      durationMin: 45,
    },
    {
      title: 'Fokus Europa · Reportage',
      subtitle: 'Infrastruktur der Zukunft',
      description: 'Wie Hochgeschwindigkeits-Nachtzüge und digitale Stromnetze den Kontinent neu verbinden.',
      category: 'Dokumentation',
      durationMin: 45,
    },
  ],
  // 3: NASA & Space Science
  [
    {
      title: 'ISS Orbital Downlink · Live Earth Views',
      subtitle: '400 km über dem Pazifik',
      description: 'Unkomprimierter HD-Downlink der Außenkameras der Internationalen Raumstation inklusive Mission Control Audio.',
      category: 'Wissen & Raumfahrt',
      durationMin: 60,
    },
    {
      title: 'Artemis Lunar Gateway Briefing',
      subtitle: 'Houston Flight Director Update',
      description: 'Technische Einblicke in Lebenserhaltungssysteme, Ionenantriebe und die nächste Mondmission.',
      category: 'Wissen & Raumfahrt',
      durationMin: 50,
    },
    {
      title: 'Deep Space Webb Spectroscopy',
      subtitle: 'Exoplaneten im Infrarotlicht',
      description: 'Neue Aufnahmen des James-Webb-Weltraumteleskops entschlüsseln Atmosphären ferner Welten.',
      category: 'Dokumentation',
      durationMin: 55,
    },
  ],
  // 4: Animation & Indie
  [
    {
      title: 'Spring & Charge · Blender Open Showcase',
      subtitle: '3D Featurette in Echtzeit-Rendering',
      description: 'Preisgekrönte Kurzfilme der Blender-Foundation mit detaillierten Charakter-Rigs und atmosphärischem Licht.',
      category: 'Animation',
      durationMin: 45,
      rating: 'FSK 6',
    },
    {
      title: 'Big Buck Bunny Remastered',
      subtitle: '60fps Referenz-Master',
      description: 'Der humorvolle Open-Source-Klassiker in kristallklarer Hochbitraten-Kodierung.',
      category: 'Animation',
      durationMin: 35,
      rating: 'FSK 0',
    },
    {
      title: 'Procedural Worlds Session',
      subtitle: 'Geometry Nodes & Shader Art',
      description: 'Digital Artists demonstrieren, wie ganze Städte und Landschaften prozedural entstehen.',
      category: 'Kultur & Musik',
      durationMin: 50,
    },
  ],
  // 5: Sci-Fi & Serien
  [
    {
      title: 'Starfleet Chronicles · Angel One',
      subtitle: 'Staffel 1 · Remastered HD',
      description: 'Ein verschollenes Frachtschiff führt die Crew auf einen diplomatisch heiklen Planeten am Rand der Föderation.',
      category: 'Sci-Fi & Serie',
      durationMin: 50,
      rating: 'FSK 12',
    },
    {
      title: 'Subspace Odyssey',
      subtitle: 'Folge 8 · Der Ereignishorizont',
      description: 'Als das Langstrecken-Array ein unbekanntes Signal empfängt, bleibt der Brücke nur wenig Zeit zur Entscheidung.',
      category: 'Sci-Fi & Serie',
      durationMin: 55,
      rating: 'FSK 12',
    },
    {
      title: 'Retro Future Design',
      subtitle: 'LCARS & Spatial Interfaces',
      description: 'Wie klassische Science-Fiction-Serien das heutige UI/UX-Design von Desktop- und Spatial-Systemen geprägt haben.',
      category: 'Dokumentation',
      durationMin: 40,
    },
  ],
];

/**
 * Generates deterministic EPG programs covering [windowStartMs, windowEndMs]
 * in O(slots) time with zero heap bloat, enabling 20,000+ channels effortlessly.
 */
export function getChannelProgramsInRange(
  channel: Channel,
  windowStartMs: number,
  windowEndMs: number,
  nowMs: number,
  epgOffsetHours = 0
): EpgProgram[] {
  const lineup = ARCHETYPE_LINEUPS[channel.epgArchetype % ARCHETYPE_LINEUPS.length];
  const cycleMinutes = lineup.reduce((acc, item) => acc + item.durationMin, 0);
  const cycleMs = cycleMinutes * 60_000;

  // Deterministic phase offset per channel so adjacent rows have staggered transitions
  const phaseMinutes = ((channel.number * 17) % 55) - 25;
  const offsetMs = (phaseMinutes + epgOffsetHours * 60) * 60_000;

  // Anchor to UTC day boundary minus 12 hours
  const baseEpochMs = Math.floor((windowStartMs - cycleMs) / cycleMs) * cycleMs + offsetMs;

  const programs: EpgProgram[] = [];
  let cursorMs = baseEpochMs;
  let idx = channel.number % lineup.length;

  while (cursorMs < windowEndMs) {
    const tpl = lineup[idx % lineup.length];
    const endMs = cursorMs + tpl.durationMin * 60_000;

    if (endMs > windowStartMs) {
      programs.push({
        id: `${channel.id}-${cursorMs}`,
        channelId: channel.id,
        title: tpl.title,
        subtitle: tpl.subtitle,
        description: tpl.description,
        category: tpl.category,
        startMs: cursorMs,
        endMs,
        hasCatchup: channel.hasCatchup && endMs <= nowMs,
        isNew: idx % 3 === 0,
        rating: tpl.rating,
      });
    }

    cursorMs = endMs;
    idx++;
  }

  return programs;
}

export function getCurrentAndNextProgram(
  channel: Channel,
  nowMs: number,
  epgOffsetHours = 0
): { current: EpgProgram; next: EpgProgram; progressPct: number } {
  const list = getChannelProgramsInRange(
    channel,
    nowMs - 3 * 3600_000,
    nowMs + 5 * 3600_000,
    nowMs,
    epgOffsetHours
  );

  const currentIdx = Math.max(
    0,
    list.findIndex((p) => p.startMs <= nowMs && p.endMs > nowMs)
  );
  const current = list[currentIdx] ?? list[0];
  const next = list[currentIdx + 1] ?? current;

  const total = Math.max(1, current.endMs - current.startMs);
  const elapsed = Math.min(total, Math.max(0, nowMs - current.startMs));
  const progressPct = Math.round((elapsed / total) * 100);

  return { current, next, progressPct };
}

export const DEMO_VOD_CATALOG: VodItem[] = [
  {
    id: 'vod-tears-of-steel',
    title: 'Tears of Steel (4K Open Master)',
    year: 2024,
    genre: 'Sci-Fi · Cyberpunk',
    durationMin: 74,
    rating: '8.6',
    resolution: '4K HDR',
    codec: 'HEVC',
    streamUrl: VERIFIED_HLS_STREAMS.tearsOfSteel,
    synopsis:
      'Referenz-Master aus Amsterdam mit aufwendigen visuellen Effekten, Raumklang und kristallklarer HDR-Dynamik.',
    accentFrom: '#0EA5E9',
    accentTo: '#312E81',
  },
  {
    id: 'vod-angel-one',
    title: 'Federation Archive: Angel One',
    year: 2023,
    genre: 'Sci-Fi · Klassiker',
    durationMin: 48,
    rating: '8.2',
    resolution: '1080p',
    codec: 'H.264',
    streamUrl: VERIFIED_HLS_STREAMS.angelOne,
    synopsis:
      'Remastered Weltraum-Klassiker mit mehrspurigem Audio-Stream und sauberer adaptiver HLS-Bitrate.',
    accentFrom: '#38BDF8',
    accentTo: '#1E293B',
  },
  {
    id: 'vod-dark-truths',
    title: 'Chronicles of Light & Shadow',
    year: 2025,
    genre: 'Arthaus · Mystery',
    durationMin: 62,
    rating: '8.4',
    resolution: '4K HDR',
    codec: 'HEVC',
    streamUrl: VERIFIED_HLS_STREAMS.darkTruths,
    synopsis:
      'Atmosphärische UHD-Produktion, abgestimmt auf tiefe OLED-Schwarztöne und feine Luminanz-Abstufungen.',
    accentFrom: '#0284C7',
    accentTo: '#0F172A',
  },
  {
    id: 'vod-big-buck',
    title: 'Big Buck Bunny · 60fps Studio Cut',
    year: 2024,
    genre: 'Animation · Familie',
    durationMin: 32,
    rating: '8.1',
    resolution: '1080p',
    codec: 'H.264',
    streamUrl: VERIFIED_HLS_STREAMS.bigBuckBunny,
    synopsis:
      'Der weltbekannte Blender-Animationsfilm als hochflüssiger 60fps Referenz-Stream für Motion-Tests.',
    accentFrom: '#06B6D4',
    accentTo: '#1E3A8A',
  },
  {
    id: 'vod-redbull-expedition',
    title: 'Cerro Torre · Alpine Luminance',
    year: 2025,
    genre: 'Dokumentation · Alpin',
    durationMin: 88,
    rating: '9.0',
    resolution: '1080p',
    codec: 'H.264',
    streamUrl: VERIFIED_HLS_STREAMS.redBullLive,
    synopsis:
      'Eine spektakuläre Expedition durch Patagonien mit Helikopter-Cineflex-Aufnahmen bei Sonnenaufgang.',
    accentFrom: '#22D3EE',
    accentTo: '#0F172A',
  },
  {
    id: 'vod-orbital-earth',
    title: 'Blue Marble from Low Earth Orbit',
    year: 2026,
    genre: 'Wissen · Raumfahrt',
    durationMin: 95,
    rating: '9.2',
    resolution: '1080p',
    codec: 'H.264',
    streamUrl: VERIFIED_HLS_STREAMS.nasaLive,
    synopsis:
      'Echtzeit- und Langzeitaufnahmen unseres Planeten bei Tag- und Nachtübergängen aus 400 Kilometern Höhe.',
    accentFrom: '#38BDF8',
    accentTo: '#172554',
  },
];

export const INITIAL_PLAYLIST_SOURCES: PlaylistSource[] = [
  {
    id: 'src-luma-showcase',
    name: 'Luma Reference Broadcast (HLS + XMLTV)',
    type: 'demo',
    endpoint: 'https://cdn.lumatv.app/playlists/reference-plus.m3u8',
    channelCount: 2400,
    vodCount: DEMO_VOD_CATALOG.length,
    epgStatus: 'synced',
    epgOffsetHours: 0,
    lastUpdated: 'Gerade eben',
  },
  {
    id: 'src-xtream-ready',
    name: 'Xtream Codes Core (Phase 2 Worker Ready)',
    type: 'xtream',
    endpoint: 'https://xtream.provider-gateway.example:8443',
    channelCount: 18000,
    vodCount: 4200,
    epgStatus: 'ready',
    epgOffsetHours: 0,
    lastUpdated: 'Architektur bereit',
  },
];

export const DEMO_SERIES_CATALOG: SeriesItem[] = [
  {
    id: 'ser-orbital-odyssey',
    title: 'Orbital Horizon · Deep Space Logs',
    year: 2026,
    genre: 'Sci-Fi · Raumfahrt-Drama',
    rating: '9.1',
    badge: '4K HDR · Dolby Atmos',
    synopsis:
      'Eine internationale Forschungscrew im niedrigen Erdorbit stößt bei Langzeit-Spektroskopie-Messungen auf ein rätselhaftes Quanten-Signal.',
    accentFrom: '#0EA5E9',
    accentTo: '#1E1B4B',
    seasons: [
      {
        seasonNumber: 1,
        title: 'Staffel 1 · Das Erste Echo',
        episodes: [
          {
            id: 'ep-orb-s1e1',
            episodeNumber: 1,
            title: 'Apogäum 420 km',
            durationMin: 52,
            synopsis:
              'Beim Andockmanöver des Versorgungsmoduls fällt die primäre Telemetrie für 14 Sekunden aus.',
            streamUrl: VERIFIED_HLS_STREAMS.nasaLive,
            resolution: '4K HDR',
          },
          {
            id: 'ep-orb-s1e2',
            episodeNumber: 2,
            title: 'Schatten der Thermosphäre',
            durationMin: 48,
            synopsis:
              'Kommandantin Lin rekonstruiert die verschlüsselten Frequenzbänder des Außen-Arrays.',
            streamUrl: VERIFIED_HLS_STREAMS.tearsOfSteel,
            resolution: '4K HDR',
          },
          {
            id: 'ep-orb-s1e3',
            episodeNumber: 3,
            title: 'Lagrange-Punkt Zwei',
            durationMin: 56,
            synopsis:
              'Houston gibt grünes Licht für eine riskante Neuausrichtung des Infrarot-Spiegels.',
            streamUrl: VERIFIED_HLS_STREAMS.angelOne,
            resolution: '4K HDR',
          },
        ],
      },
      {
        seasonNumber: 2,
        title: 'Staffel 2 · Jenseits des Terminators',
        episodes: [
          {
            id: 'ep-orb-s2e1',
            episodeNumber: 1,
            title: 'Rückkehr nach Amsterdam',
            durationMin: 54,
            synopsis:
              'Sechs Monate nach dem Rücksturz beginnt die Auswertung des geborgenen Flugschreibers.',
            streamUrl: VERIFIED_HLS_STREAMS.tearsOfSteel,
            resolution: '4K HDR',
          },
          {
            id: 'ep-orb-s2e2',
            episodeNumber: 2,
            title: 'Luminanz-Protokoll',
            durationMin: 50,
            synopsis:
              'Ein zweiter Impuls zwingt das Kontrollzentrum zu einer sofortigen globalen Konferenz.',
            streamUrl: VERIFIED_HLS_STREAMS.darkTruths,
            resolution: '4K HDR',
          },
        ],
      },
    ],
  },
  {
    id: 'ser-alpine-lines',
    title: 'Peaks & Velocity · World Tour Inside',
    year: 2025,
    genre: 'Doku-Serie · Extremsport',
    rating: '8.9',
    badge: '1080p60 · EAC3 5.1',
    synopsis:
      'Hautnahe Dokumentation über die spektakulärsten Abfahrten, Helikopter-Crews und Ingenieursteams der internationalen Berg- und Motorsport-Elite.',
    accentFrom: '#38BDF8',
    accentTo: '#0F172A',
    seasons: [
      {
        seasonNumber: 1,
        title: 'Staffel 1 · Gratwanderung',
        episodes: [
          {
            id: 'ep-alp-s1e1',
            episodeNumber: 1,
            title: 'Val di Sole in 60fps',
            durationMin: 44,
            synopsis:
              'Millimeterarbeit zwischen Wurzelteppichen, Steilkurven und Telemetrie-Sensoren am Fahrwerk.',
            streamUrl: VERIFIED_HLS_STREAMS.redBullLive,
            resolution: '1080p',
          },
          {
            id: 'ep-alp-s1e2',
            episodeNumber: 2,
            title: 'Nordwand im Morgengrauen',
            durationMin: 49,
            synopsis:
              'Wenn das Wetterfenster in den Dolomiten nur 90 Minuten geöffnet bleibt.',
            streamUrl: VERIFIED_HLS_STREAMS.muxPts,
            resolution: '1080p',
          },
        ],
      },
    ],
  },
  {
    id: 'ser-open-studio',
    title: 'Open Render · Die Blender Anthologie',
    year: 2025,
    genre: 'Animation · Making-Of',
    rating: '8.7',
    badge: '1080p · Studio Master',
    synopsis:
      'Von den ersten Storyboards bis zum fertigen Path-Tracing-Frame: Die besten Kurzfilme und Episoden unabhängiger Animationsstudios.',
    accentFrom: '#22D3EE',
    accentTo: '#172554',
    seasons: [
      {
        seasonNumber: 1,
        title: 'Staffel 1 · Open Movies',
        episodes: [
          {
            id: 'ep-bld-s1e1',
            episodeNumber: 1,
            title: 'Big Buck Remastered',
            durationMin: 34,
            synopsis:
              'Neu abgetasteter Open-Movie-Meilenstein mit brillanter Farb- und Bewegungsauflösung.',
            streamUrl: VERIFIED_HLS_STREAMS.bigBuckBunny,
            resolution: '1080p',
          },
          {
            id: 'ep-bld-s1e2',
            episodeNumber: 2,
            title: 'Open Studio Live Reel',
            durationMin: 41,
            synopsis:
              'Direkter Einblick in prozedurale Shader, Licht-Setups und Charakter-Animation.',
            streamUrl: VERIFIED_HLS_STREAMS.blenderLive,
            resolution: '1080p',
          },
        ],
      },
    ],
  },
];

