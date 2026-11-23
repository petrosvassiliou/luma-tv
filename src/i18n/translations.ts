export type LumaLocale = 'de' | 'en' | 'it' | 'fr' | 'es' | 'gr';

export const SUPPORTED_LOCALES: readonly LumaLocale[] = [
  'de',
  'en',
  'it',
  'fr',
  'es',
  'gr',
] as const;

export const LOCALE_META: Record<
  LumaLocale,
  { badge: string; nativeName: string; bcp47: string }
> = {
  de: { badge: 'DE', nativeName: 'Deutsch', bcp47: 'de-DE' },
  en: { badge: 'EN', nativeName: 'English', bcp47: 'en-GB' },
  it: { badge: 'IT', nativeName: 'Italiano', bcp47: 'it-IT' },
  fr: { badge: 'FR', nativeName: 'Français', bcp47: 'fr-FR' },
  es: { badge: 'ES', nativeName: 'Español', bcp47: 'es-ES' },
  gr: { badge: 'GR', nativeName: 'Ελληνικά', bcp47: 'el-GR' },
};

export type BufferProfile = 'low-latency' | 'balanced' | 'cinema-max';

export interface LumaPreferences {
  locale: LumaLocale;
  bufferProfile: BufferProfile;
  sleepTimerMinutes: number; // 0 = Off
  spatialDpadEnabled: boolean;
}

export function normalizeLocale(input: unknown): LumaLocale {
  if (typeof input === 'string') {
    const lower = input.toLowerCase();
    if (lower === 'el') return 'gr';
    if ((SUPPORTED_LOCALES as readonly string[]).includes(lower)) {
      return lower as LumaLocale;
    }
  }
  return 'en';
}

export function cycleNextLocale(current: LumaLocale): LumaLocale {
  const idx = SUPPORTED_LOCALES.indexOf(current);
  if (idx < 0) return 'en';
  return SUPPORTED_LOCALES[(idx + 1) % SUPPORTED_LOCALES.length];
}

export function detectSystemLocale(): LumaLocale {
  if (typeof navigator === 'undefined') return 'de';
  const lang = navigator.language.toLowerCase();
  if (lang.startsWith('de')) return 'de';
  if (lang.startsWith('it')) return 'it';
  if (lang.startsWith('fr')) return 'fr';
  if (lang.startsWith('es')) return 'es';
  if (lang.startsWith('el') || lang.startsWith('gr')) return 'gr';
  return 'en';
}

export interface TranslationDictionary {
  searchPlaceholder: string;
  quickSearchZap: string;
  expandSidebar: string;
  collapseSidebar: string;
  channelsUnit: string;
  navHome: string;
  navLive: string;
  navMultiview: string;
  navVod: string;
  navSeries: string;
  navCatchup: string;
  navStudio: string;
  navSources: string;
  navSettings: string;
  allChannels: string;
  favorites: string;
  bouquetsHeader: string;
  workspaceHeader: string;
  epgNow: string;
  epgFilter: string;
  unmute: string;
  fullscreen: string;
  sleepActive: string;
  shortcutsHelpTitle: string;
  mpvLaunchBtn: string;
  mpvLaunchTitle: string;
  localRustProxyBadge: string;
  cloudCorsProxyBadge: string;
  liveBadge: string;
  catchupBadge: string;
  onDemandBadge: string;
  backToLive: string;
  skipBack10: string;
  skipFwd10: string;
  nextEpisode: string;
  playNow: string;
  resumePlayback: string;
  continueWatchingHeader: string;
  seriesHighlightsHeader: string;
  openAllSeries: string;
  seasonsUnit: string;
  episodesUnit: string;
  loadingEpisodes: string;
  catchupTitle: string;
  catchupSubtitle: string;
  catchupDaysActive: string;
  reLiveBtn: string;
  settingsTitle: string;
  settingsSubtitle: string;
  shortcutsGuideBtn: string;
  langAndDesignTitle: string;
  sleepTimerTitle: string;
  sleepOff: string;
  dpadToggleLabel: string;
  bufferProfileTitle: string;
  bufferSportLabel: string;
  bufferSportSub: string;
  bufferBalancedLabel: string;
  bufferBalancedSub: string;
  bufferCinemaLabel: string;
  bufferCinemaSub: string;
  backupTitle: string;
  backupSubtitle: string;
  exportBackupBtn: string;
  importBackupBtn: string;
}

export const TRANSLATIONS: Record<LumaLocale, TranslationDictionary> = {
  de: {
    searchPlaceholder: 'Sender, EPG, Filme oder Serien suchen…',
    quickSearchZap: 'Schnellsuche & Zap',
    expandSidebar: 'Navigation einblenden',
    collapseSidebar: 'Navigation einklappen',
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
    mpvLaunchBtn: 'MPV',
    mpvLaunchTitle: 'Im externen MPV Hardware-Player öffnen (VideoToolbox / HEVC / AC3)',
    localRustProxyBadge: 'RUST LOKAL-PROXY',
    cloudCorsProxyBadge: 'CORS PROXY',
    liveBadge: 'LIVE',
    catchupBadge: 'CATCH-UP',
    onDemandBadge: 'ON DEMAND',
    backToLive: 'Zurück zu Live',
    skipBack10: '10 Sekunden zurück',
    skipFwd10: '10 Sekunden vor',
    nextEpisode: 'Nächste Folge',
    playNow: 'Abspielen',
    resumePlayback: 'Fortsetzen',
    continueWatchingHeader: 'Nahtlos weiterschauen',
    seriesHighlightsHeader: 'Xtream Serien-Highlights',
    openAllSeries: 'Alle Serien öffnen →',
    seasonsUnit: 'Staffeln',
    episodesUnit: 'Episoden',
    loadingEpisodes: 'Lade Staffeln & Episoden vom Xtream-Server…',
    catchupTitle: 'Xtream Catch-Up & Timeshift Archiv',
    catchupSubtitle: 'Vergangene Sendungen direkt über Timeshift / Catch-Up-Archiv abspielen.',
    catchupDaysActive: 'Tage Rückschau-Archiv aktiv',
    reLiveBtn: 'Re-Live',
    settingsTitle: 'Plattform-Einstellungen · Sprache, Decoder, Sleep-Timer & Backup',
    settingsSubtitle:
      'Synchronisierte Einstellungen für macOS (Liquid Glass), Android / TV (Material 3) & ChromeOS PWA.',
    shortcutsGuideBtn: 'Tasten & Remote-Hilfe (?)',
    langAndDesignTitle: 'Sprache & Design-System',
    sleepTimerTitle: 'Einschlaf-Timer (Sleep Timer)',
    sleepOff: 'Aus',
    dpadToggleLabel:
      '10-Foot Spatial D-Pad / Pfeiltasten-Fokus aktivieren (Android TV & Gamepad)',
    bufferProfileTitle: 'Stream-Puffer & Latenz-Profil',
    bufferSportLabel: 'Live Sport (1.5s)',
    bufferSportSub: 'Ultra-Low-Latency',
    bufferBalancedLabel: 'Standard (12s)',
    bufferBalancedSub: 'Ausgewogen',
    bufferCinemaLabel: 'Cinema 4K (36s)',
    bufferCinemaSub: 'Maximale Stabilität',
    backupTitle: 'Plattformübergreifendes Backup (macOS ↔ Android ↔ PWA)',
    backupSubtitle:
      'Exportiert Favoriten, eigene Bouquets, Jugendschutz-PIN und Einstellungen als portables JSON.',
    exportBackupBtn: 'Backup exportieren (.json)',
    importBackupBtn: 'Backup wiederherstellen',
  },
  en: {
    searchPlaceholder: 'Search channels, EPG, movies, or series…',
    quickSearchZap: 'Quick Search & Zap',
    expandSidebar: 'Expand sidebar',
    collapseSidebar: 'Collapse sidebar',
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
    mpvLaunchBtn: 'MPV',
    mpvLaunchTitle: 'Open in external MPV hardware player (VideoToolbox / HEVC / AC3)',
    localRustProxyBadge: 'RUST LOCAL PROXY',
    cloudCorsProxyBadge: 'CORS PROXY',
    liveBadge: 'LIVE',
    catchupBadge: 'CATCH-UP',
    onDemandBadge: 'ON DEMAND',
    backToLive: 'Back to Live',
    skipBack10: 'Rewind 10 seconds',
    skipFwd10: 'Forward 10 seconds',
    nextEpisode: 'Next Episode',
    playNow: 'Play',
    resumePlayback: 'Resume',
    continueWatchingHeader: 'Continue Watching',
    seriesHighlightsHeader: 'Xtream Series Highlights',
    openAllSeries: 'View all series →',
    seasonsUnit: 'Seasons',
    episodesUnit: 'Episodes',
    loadingEpisodes: 'Loading seasons & episodes from Xtream server…',
    catchupTitle: 'Xtream Catch-Up & Timeshift Archive',
    catchupSubtitle: 'Play past broadcasts directly from provider timeshift & archive streams.',
    catchupDaysActive: 'days archive buffer active',
    reLiveBtn: 'Re-Live',
    settingsTitle: 'Platform Settings · Language, Decoder, Sleep Timer & Backup',
    settingsSubtitle:
      'Unified preferences across macOS (Liquid Glass), Android / TV (Material 3) & ChromeOS PWA.',
    shortcutsGuideBtn: 'Shortcuts & Remote Guide (?)',
    langAndDesignTitle: 'Language & Design System',
    sleepTimerTitle: 'Automatic Sleep Timer',
    sleepOff: 'Off',
    dpadToggleLabel:
      'Enable 10-Foot Spatial D-Pad / Arrow Focus Engine (Android TV & Gamepad)',
    bufferProfileTitle: 'Stream Buffer & Latency Profile',
    bufferSportLabel: 'Live Sports (1.5s)',
    bufferSportSub: 'Ultra-Low Latency',
    bufferBalancedLabel: 'Standard (12s)',
    bufferBalancedSub: 'Balanced',
    bufferCinemaLabel: 'Cinema 4K (36s)',
    bufferCinemaSub: 'Maximum Stability',
    backupTitle: 'Cross-Platform Configuration Backup (macOS ↔ Android ↔ PWA)',
    backupSubtitle:
      'Export favorites, custom bouquets, parental PIN, and preferences as a portable JSON bundle.',
    exportBackupBtn: 'Export Backup (.json)',
    importBackupBtn: 'Restore Backup',
  },
  it: {
    searchPlaceholder: 'Cerca canali, EPG, film o serie…',
    quickSearchZap: 'Ricerca rapida & Zap',
    expandSidebar: 'Espandi barra laterale',
    collapseSidebar: 'Comprimi barra laterale',
    channelsUnit: 'Canali',
    navHome: 'Home & Continua',
    navLive: 'TV Live & EPG',
    navMultiview: 'Multiview 4x',
    navVod: 'Cinema VOD',
    navSeries: 'Serie Xtream',
    navCatchup: 'Archivio Catch-Up',
    navStudio: 'Channel Studio',
    navSources: 'Sorgenti & Cloud',
    navSettings: 'Impostazioni',
    allChannels: 'Tutti i canali',
    favorites: 'Preferiti',
    bouquetsHeader: 'Bouquet & Gruppi',
    workspaceHeader: 'Catalogo',
    epgNow: 'Ora',
    epgFilter: 'Filtra canali EPG…',
    unmute: 'Attiva audio',
    fullscreen: 'Schermo intero',
    sleepActive: 'Sleep',
    shortcutsHelpTitle: 'Comandi · Tastiera, Touch & Telecomando TV',
    mpvLaunchBtn: 'MPV',
    mpvLaunchTitle: 'Apri nel lettore hardware esterno MPV (VideoToolbox / HEVC / AC3)',
    localRustProxyBadge: 'PROXY RUST LOCALE',
    cloudCorsProxyBadge: 'PROXY CORS',
    liveBadge: 'LIVE',
    catchupBadge: 'CATCH-UP',
    onDemandBadge: 'ON DEMAND',
    backToLive: 'Torna al Live',
    skipBack10: 'Indietro di 10 secondi',
    skipFwd10: 'Avanti di 10 secondi',
    nextEpisode: 'Prossimo episodio',
    playNow: 'Riproduci',
    resumePlayback: 'Riprendi',
    continueWatchingHeader: 'Continua a guardare',
    seriesHighlightsHeader: 'Serie Xtream in evidenza',
    openAllSeries: 'Apri tutte le serie →',
    seasonsUnit: 'Stagioni',
    episodesUnit: 'Episodi',
    loadingEpisodes: 'Caricamento stagioni ed episodi dal server Xtream…',
    catchupTitle: 'Archivio Catch-Up & Timeshift Xtream',
    catchupSubtitle: 'Riproduci i programmi passati direttamente tramite archivio timeshift.',
    catchupDaysActive: 'giorni di archivio attivi',
    reLiveBtn: 'Re-Live',
    settingsTitle: 'Impostazioni Piattaforma · Lingua, Decoder, Sleep Timer & Backup',
    settingsSubtitle:
      'Preferenze sincronizzate su macOS (Liquid Glass), Android / TV (Material 3) e ChromeOS PWA.',
    shortcutsGuideBtn: 'Guida scorciatoie & telecomando (?)',
    langAndDesignTitle: 'Lingua & Design System',
    sleepTimerTitle: 'Timer di spegnimento (Sleep Timer)',
    sleepOff: 'Off',
    dpadToggleLabel:
      'Attiva navigazione spaziale D-Pad / frecce 10-Foot (Android TV & Gamepad)',
    bufferProfileTitle: 'Buffer Stream & Profilo Latenza',
    bufferSportLabel: 'Sport Live (1.5s)',
    bufferSportSub: 'Latenza ultra-bassa',
    bufferBalancedLabel: 'Standard (12s)',
    bufferBalancedSub: 'Bilanciato',
    bufferCinemaLabel: 'Cinema 4K (36s)',
    bufferCinemaSub: 'Massima stabilità',
    backupTitle: 'Backup Configurazione Multi-Piattaforma (macOS ↔ Android ↔ PWA)',
    backupSubtitle:
      'Esporta preferiti, bouquet personalizzati, PIN parentale e impostazioni in formato JSON.',
    exportBackupBtn: 'Esporta Backup (.json)',
    importBackupBtn: 'Ripristina Backup',
  },
  fr: {
    searchPlaceholder: 'Rechercher chaînes, EPG, films ou séries…',
    quickSearchZap: 'Recherche rapide & Zap',
    expandSidebar: 'Déplier la barre latérale',
    collapseSidebar: 'Replier la barre latérale',
    channelsUnit: 'Chaînes',
    navHome: 'Accueil & Reprendre',
    navLive: 'TV en Direct & EPG',
    navMultiview: 'Multiview 4x',
    navVod: 'Cinéma VOD',
    navSeries: 'Séries Xtream',
    navCatchup: 'Replay Catch-Up',
    navStudio: 'Channel Studio',
    navSources: 'Sources & Cloud',
    navSettings: 'Paramètres',
    allChannels: 'Toutes les chaînes',
    favorites: 'Favoris',
    bouquetsHeader: 'Bouquets & Groupes',
    workspaceHeader: 'Médiathèque',
    epgNow: 'Maintenant',
    epgFilter: 'Filtrer les chaînes EPG…',
    unmute: 'Activer le son',
    fullscreen: 'Plein écran',
    sleepActive: 'Veille',
    shortcutsHelpTitle: 'Commandes · Clavier, Tactile & Télécommande TV',
    mpvLaunchBtn: 'MPV',
    mpvLaunchTitle: 'Ouvrir dans le lecteur matériel externe MPV (VideoToolbox / HEVC / AC3)',
    localRustProxyBadge: 'PROXY RUST LOCAL',
    cloudCorsProxyBadge: 'PROXY CORS',
    liveBadge: 'DIRECT',
    catchupBadge: 'REPLAY',
    onDemandBadge: 'À LA DEMANDE',
    backToLive: 'Retour au direct',
    skipBack10: 'Reculer de 10 secondes',
    skipFwd10: 'Avancer de 10 secondes',
    nextEpisode: 'Épisode suivant',
    playNow: 'Lire',
    resumePlayback: 'Reprendre',
    continueWatchingHeader: 'Reprendre la lecture',
    seriesHighlightsHeader: 'Séries Xtream à la une',
    openAllSeries: 'Voir toutes les séries →',
    seasonsUnit: 'Saisons',
    episodesUnit: 'Épisodes',
    loadingEpisodes: 'Chargement des saisons et épisodes depuis le serveur Xtream…',
    catchupTitle: 'Archives Replay & Timeshift Xtream',
    catchupSubtitle: 'Regardez les émissions passées directement depuis le flux timeshift.',
    catchupDaysActive: 'jours de replay actifs',
    reLiveBtn: 'Replay',
    settingsTitle: 'Paramètres Plateforme · Langue, Décodeur, Mise en veille & Sauvegarde',
    settingsSubtitle:
      'Préférences unifiées sur macOS (Liquid Glass), Android / TV (Material 3) et ChromeOS PWA.',
    shortcutsGuideBtn: 'Raccourcis & Télécommande (?)',
    langAndDesignTitle: 'Langue & Système de Design',
    sleepTimerTitle: 'Minuterie de veille (Sleep Timer)',
    sleepOff: 'Arrêt',
    dpadToggleLabel:
      'Activer la navigation spatiale D-Pad / flèches 10-Foot (Android TV & Manette)',
    bufferProfileTitle: 'Tampon de flux & Profil de latence',
    bufferSportLabel: 'Sport Direct (1.5s)',
    bufferSportSub: 'Ultra-faible latence',
    bufferBalancedLabel: 'Standard (12s)',
    bufferBalancedSub: 'Équilibré',
    bufferCinemaLabel: 'Cinéma 4K (36s)',
    bufferCinemaSub: 'Stabilité maximale',
    backupTitle: 'Sauvegarde Multiplateforme (macOS ↔ Android ↔ PWA)',
    backupSubtitle:
      'Exportez favoris, bouquets personnalisés, code PIN parental et réglages en JSON portable.',
    exportBackupBtn: 'Exporter la sauvegarde (.json)',
    importBackupBtn: 'Restaurer la sauvegarde',
  },
  es: {
    searchPlaceholder: 'Buscar canales, EPG, películas o series…',
    quickSearchZap: 'Búsqueda rápida y Zap',
    expandSidebar: 'Mostrar barra lateral',
    collapseSidebar: 'Ocultar barra lateral',
    channelsUnit: 'Canales',
    navHome: 'Inicio y Continuar',
    navLive: 'TV en Vivo y EPG',
    navMultiview: 'Multiview 4x',
    navVod: 'Cine VOD',
    navSeries: 'Series Xtream',
    navCatchup: 'Archivo Catch-Up',
    navStudio: 'Channel Studio',
    navSources: 'Fuentes y Nube',
    navSettings: 'Ajustes',
    allChannels: 'Todos los canales',
    favorites: 'Favoritos',
    bouquetsHeader: 'Bouquets y Grupos',
    workspaceHeader: 'Videoteca',
    epgNow: 'Ahora',
    epgFilter: 'Filtrar canales EPG…',
    unmute: 'Activar sonido',
    fullscreen: 'Pantalla completa',
    sleepActive: 'Sleep',
    shortcutsHelpTitle: 'Controles · Teclado, Táctil y Mando TV',
    mpvLaunchBtn: 'MPV',
    mpvLaunchTitle: 'Abrir en reproductor externo por hardware MPV (VideoToolbox / HEVC / AC3)',
    localRustProxyBadge: 'PROXY RUST LOCAL',
    cloudCorsProxyBadge: 'PROXY CORS',
    liveBadge: 'EN VIVO',
    catchupBadge: 'CATCH-UP',
    onDemandBadge: 'BAJO DEMANDA',
    backToLive: 'Volver al directo',
    skipBack10: 'Retroceder 10 segundos',
    skipFwd10: 'Avanzar 10 segundos',
    nextEpisode: 'Siguiente episodio',
    playNow: 'Reproducir',
    resumePlayback: 'Continuar',
    continueWatchingHeader: 'Seguir viendo',
    seriesHighlightsHeader: 'Series Xtream destacadas',
    openAllSeries: 'Ver todas las series →',
    seasonsUnit: 'Temporadas',
    episodesUnit: 'Episodios',
    loadingEpisodes: 'Cargando temporadas y episodios desde el servidor Xtream…',
    catchupTitle: 'Archivo Catch-Up y Timeshift Xtream',
    catchupSubtitle: 'Reproduce emisiones anteriores directamente desde el archivo timeshift.',
    catchupDaysActive: 'días de archivo activos',
    reLiveBtn: 'Re-Live',
    settingsTitle: 'Ajustes de Plataforma · Idioma, Decodificador, Temporizador y Copia',
    settingsSubtitle:
      'Preferencias sincronizadas en macOS (Liquid Glass), Android / TV (Material 3) y ChromeOS PWA.',
    shortcutsGuideBtn: 'Atajos y Guía de mando (?)',
    langAndDesignTitle: 'Idioma y Sistema de Diseño',
    sleepTimerTitle: 'Temporizador de apagado (Sleep Timer)',
    sleepOff: 'Apagado',
    dpadToggleLabel:
      'Activar enfoque espacial D-Pad / flechas 10-Foot (Android TV y Gamepad)',
    bufferProfileTitle: 'Búfer de Stream y Perfil de Latencia',
    bufferSportLabel: 'Deporte en Vivo (1.5s)',
    bufferSportSub: 'Latencia ultrabaja',
    bufferBalancedLabel: 'Estándar (12s)',
    bufferBalancedSub: 'Equilibrado',
    bufferCinemaLabel: 'Cine 4K (36s)',
    bufferCinemaSub: 'Máxima estabilidad',
    backupTitle: 'Copia de Seguridad Multiplataforma (macOS ↔ Android ↔ PWA)',
    backupSubtitle:
      'Exporta favoritos, bouquets propios, PIN parental y preferencias en un archivo JSON.',
    exportBackupBtn: 'Exportar copia (.json)',
    importBackupBtn: 'Restaurar copia',
  },
  gr: {
    searchPlaceholder: 'Αναζήτηση καναλιών, EPG, ταινιών ή σειρών…',
    quickSearchZap: 'Γρήγορη αναζήτηση & Zap',
    expandSidebar: 'Εμφάνιση πλευρικής μπάρας',
    collapseSidebar: 'Σύμπτυξη πλευρικής μπάρας',
    channelsUnit: 'Κανάλια',
    navHome: 'Αρχική & Συνέχεια',
    navLive: 'Live TV & EPG',
    navMultiview: 'Multiview 4x',
    navVod: 'Cinema VOD',
    navSeries: 'Σειρές Xtream',
    navCatchup: 'Αρχείο Catch-Up',
    navStudio: 'Channel Studio',
    navSources: 'Πηγές & Cloud',
    navSettings: 'Ρυθμίσεις',
    allChannels: 'Όλα τα κανάλια',
    favorites: 'Αγαπημένα',
    bouquetsHeader: 'Μπουκέτα & Ομάδες',
    workspaceHeader: 'Ταινιοθήκη',
    epgNow: 'Τώρα',
    epgFilter: 'Φιλτράρισμα καναλιών EPG…',
    unmute: 'Ενεργοποίηση ήχου',
    fullscreen: 'Πλήρης οθόνη',
    sleepActive: 'Ύπνος',
    shortcutsHelpTitle: 'Χειρισμός · Πληκτρολόγιο, Αφή & Τηλεχειριστήριο TV',
    mpvLaunchBtn: 'MPV',
    mpvLaunchTitle: 'Άνοιγμα σε εξωτερικό hardware player MPV (VideoToolbox / HEVC / AC3)',
    localRustProxyBadge: 'ΤΟΠΙΚΟ RUST PROXY',
    cloudCorsProxyBadge: 'CORS PROXY',
    liveBadge: 'ΖΩΝΤΑΝΑ',
    catchupBadge: 'CATCH-UP',
    onDemandBadge: 'ON DEMAND',
    backToLive: 'Επιστροφή στο Live',
    skipBack10: 'Πίσω 10 δευτερόλεπτα',
    skipFwd10: 'Μπροστά 10 δευτερόλεπτα',
    nextEpisode: 'Επόμενο επεισόδιο',
    playNow: 'Αναπαραγωγή',
    resumePlayback: 'Συνέχιση',
    continueWatchingHeader: 'Συνεχίστε την παρακολούθηση',
    seriesHighlightsHeader: 'Κορυφαίες Σειρές Xtream',
    openAllSeries: 'Όλες οι σειρές →',
    seasonsUnit: 'Σεζόν',
    episodesUnit: 'Επεισόδια',
    loadingEpisodes: 'Φόρτωση σεζόν & επεισοδίων από τον διακομιστή Xtream…',
    catchupTitle: 'Αρχείο Catch-Up & Timeshift Xtream',
    catchupSubtitle: 'Αναπαραγωγή προηγούμενων εκπομπών απευθείας μέσω αρχείου timeshift.',
    catchupDaysActive: 'ημέρες αρχείου ενεργές',
    reLiveBtn: 'Re-Live',
    settingsTitle: 'Ρυθμίσεις Πλατφόρμας · Γλώσσα, Αποκωδικοποιητής, Χρονοδιακόπτης & Backup',
    settingsSubtitle:
      'Ενιαίες προτιμήσεις σε macOS (Liquid Glass), Android / TV (Material 3) & ChromeOS PWA.',
    shortcutsGuideBtn: 'Συντομεύσεις & Οδηγός TV (?)',
    langAndDesignTitle: 'Γλώσσα & Σύστημα Σχεδίασης',
    sleepTimerTitle: 'Χρονοδιακόπτης ύπνου (Sleep Timer)',
    sleepOff: 'Ανενεργό',
    dpadToggleLabel:
      'Ενεργοποίηση χωρικής πλοήγησης D-Pad / βελών 10-Foot (Android TV & Gamepad)',
    bufferProfileTitle: 'Buffer Ροής & Προφίλ Καθυστέρησης',
    bufferSportLabel: 'Live Αθλητικά (1.5s)',
    bufferSportSub: 'Εξαιρετικά χαμηλή καθυστέρηση',
    bufferBalancedLabel: 'Τυπικό (12s)',
    bufferBalancedSub: 'Ισορροπημένο',
    bufferCinemaLabel: 'Cinema 4K (36s)',
    bufferCinemaSub: 'Μέγιστη σταθερότητα',
    backupTitle: 'Αντίγραφο Ασφαλείας Πολλαπλών Πλατφορμών (macOS ↔ Android ↔ PWA)',
    backupSubtitle:
      'Εξαγωγή αγαπημένων, μπουκέτων, γονικού PIN και ρυθμίσεων σε φορητό αρχείο JSON.',
    exportBackupBtn: 'Εξαγωγή Backup (.json)',
    importBackupBtn: 'Επαναφορά Backup',
  },
};
