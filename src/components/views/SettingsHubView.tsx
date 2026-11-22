import React from 'react';
import {
  Download,
  FileUp,
  Gamepad2,
  Globe,
  Keyboard,
  Moon,
  Sliders,
} from 'lucide-react';
import type { BufferProfile, LumaLocale, LumaPreferences } from '../../i18n/translations';
import type { CustomBouquet, ParentalControlConfig, PlatformDesignMode } from '../../types/luma';

interface SettingsHubViewProps {
  designMode: PlatformDesignMode;
  onChangeDesignMode: (mode: PlatformDesignMode) => void;
  preferences: LumaPreferences;
  onChangePreferences: (next: LumaPreferences) => void;
  sleepRemainingSec: number | null;
  favoriteIds: Set<string>;
  customBouquets: CustomBouquet[];
  parentalConfig: ParentalControlConfig;
  onImportFullBackup: (backup: {
    favorites?: string[];
    bouquets?: CustomBouquet[];
    parental?: ParentalControlConfig;
    preferences?: LumaPreferences;
  }) => void;
  onOpenShortcutsModal: () => void;
}

export const SettingsHubView: React.FC<SettingsHubViewProps> = ({
  designMode,
  onChangeDesignMode,
  preferences,
  onChangePreferences,
  sleepRemainingSec,
  favoriteIds,
  customBouquets,
  parentalConfig,
  onImportFullBackup,
  onOpenShortcutsModal,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const isDe = preferences.locale === 'de';
  const panelClass = isM3 ? 'rounded-[28px] bg-[#1A202E] p-5' : 'lg-pane rounded-[24px] p-5';

  const setLocale = (locale: LumaLocale) =>
    onChangePreferences({ ...preferences, locale });

  const setBuffer = (bufferProfile: BufferProfile) =>
    onChangePreferences({ ...preferences, bufferProfile });

  const setSleep = (sleepTimerMinutes: number) =>
    onChangePreferences({ ...preferences, sleepTimerMinutes });

  const exportBackupJson = () => {
    const bundle = {
      app: 'app.lumatv.client',
      version: '0.3.0-beta.1',
      exportedAt: new Date().toISOString(),
      favorites: Array.from(favoriteIds),
      bouquets: customBouquets,
      parental: parentalConfig,
      preferences,
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `luma-tv-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleBackupImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      onImportFullBackup(parsed);
    } catch {
      // Ignore malformed JSON
    }
    e.target.value = '';
  };

  return (
    <div className="luma-scroll flex-1 overflow-y-auto p-5 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">
            {isDe
              ? 'Plattform-Einstellungen · Sprache, Decoder, Sleep-Timer & Backup'
              : 'Platform Settings · Language, Decoder, Sleep Timer & Backup'}
          </h2>
          <p className="text-xs text-slate-400">
            {isDe
              ? 'Synchronisierte Einstellungen für macOS (Liquid Glass), Android / TV (Material 3) & ChromeOS PWA.'
              : 'Unified preferences across macOS (Liquid Glass), Android / TV (Material 3) & ChromeOS PWA.'}
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenShortcutsModal}
          className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold ${
            isM3 ? 'm3-secondary-tonal' : 'lg-capsule text-white'
          }`}
        >
          <Keyboard className="h-4 w-4 text-sky-300" />
          <span>{isDe ? 'Tasten & Remote-Hilfe (?)' : 'Shortcuts & Remote Guide (?)'}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Language & Design Paradigm */}
        <div className={`${panelClass} space-y-4`}>
          <div className="flex items-center gap-2 text-xs font-semibold text-white">
            <Globe className="h-4 w-4 text-sky-400" />
            <span>{isDe ? 'Sprache & Design-System' : 'Language & Design System'}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(['de', 'en'] as LumaLocale[]).map((loc) => (
              <button
                key={loc}
                type="button"
                onClick={() => setLocale(loc)}
                className={`rounded-full px-4 py-2 text-xs font-bold transition ${
                  preferences.locale === loc
                    ? isM3
                      ? 'm3-primary-pill'
                      : 'lg-pill-active'
                    : isM3
                      ? 'm3-secondary-tonal'
                      : 'lg-capsule text-slate-200'
                }`}
              >
                {loc === 'de' ? 'Deutsch (DE)' : 'English (EN)'}
              </button>
            ))}
          </div>

          <div className="border-t border-white/10 pt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onChangeDesignMode('m3-expressive')}
              className={`rounded-full px-4 py-2 text-xs font-semibold ${
                isM3 ? 'm3-tonal-active ring-1 ring-[#7FD4FF]/60' : 'lg-capsule text-slate-300'
              }`}
            >
              GoogleOS / Android · Material 3 Expressive
            </button>
            <button
              type="button"
              onClick={() => onChangeDesignMode('liquid-glass')}
              className={`rounded-full px-4 py-2 text-xs font-semibold ${
                !isM3 ? 'lg-pill-active' : 'm3-secondary-tonal'
              }`}
            >
              macOS · Apple Liquid Glass
            </button>
          </div>
        </div>

        {/* Sleep Timer & Spatial 10-Foot Focus */}
        <div className={`${panelClass} space-y-4`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-semibold text-white">
              <Moon className="h-4 w-4 text-sky-400" />
              <span>{isDe ? 'Einschlaf-Timer (Sleep Timer)' : 'Automatic Sleep Timer'}</span>
            </div>
            {sleepRemainingSec !== null && (
              <span className="rounded-full bg-amber-400/20 px-3 py-0.5 font-mono text-[11px] font-bold text-amber-200 luma-tabular">
                {Math.ceil(sleepRemainingSec / 60)} min
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {[0, 15, 30, 60, 90].map((mins) => (
              <button
                key={mins}
                type="button"
                onClick={() => setSleep(mins)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-semibold luma-tabular ${
                  preferences.sleepTimerMinutes === mins
                    ? isM3
                      ? 'm3-primary-pill'
                      : 'lg-pill-active'
                    : isM3
                      ? 'm3-secondary-tonal'
                      : 'lg-capsule text-slate-200'
                }`}
              >
                {mins === 0 ? (isDe ? 'Aus' : 'Off') : `${mins} min`}
              </button>
            ))}
          </div>

          <div className="border-t border-white/10 pt-3">
            <label className="flex items-center gap-2.5 text-xs text-slate-200">
              <input
                type="checkbox"
                checked={preferences.spatialDpadEnabled}
                onChange={(e) =>
                  onChangePreferences({
                    ...preferences,
                    spatialDpadEnabled: e.target.checked,
                  })
                }
                className="h-4 w-4 accent-sky-400"
              />
              <Gamepad2 className="h-4 w-4 text-sky-300" />
              <span>
                {isDe
                  ? '10-Foot Spatial D-Pad / Pfeiltasten-Fokus aktivieren (Android TV & Gamepad)'
                  : 'Enable 10-Foot Spatial D-Pad / Arrow Focus Engine (Android TV & Gamepad)'}
              </span>
            </label>
          </div>
        </div>

        {/* Stream Buffer & Decoder Tuning */}
        <div className={`${panelClass} space-y-3`}>
          <div className="flex items-center gap-2 text-xs font-semibold text-white">
            <Sliders className="h-4 w-4 text-sky-400" />
            <span>
              {isDe
                ? 'Stream-Puffer & Latenz-Profil'
                : 'Stream Buffer & Latency Profile'}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {(
              [
                ['low-latency', 'Live Sport (1.5s)', 'Ultra-Low-Latency'],
                ['balanced', 'Standard (12s)', 'Ausgewogen'],
                ['cinema-max', 'Cinema 4K (36s)', 'Maximale Stabilität'],
              ] as [BufferProfile, string, string][]
            ).map(([prof, title, sub]) => {
              const active = preferences.bufferProfile === prof;
              return (
                <button
                  key={prof}
                  type="button"
                  onClick={() => setBuffer(prof)}
                  className={`p-3 text-left transition ${
                    isM3 ? 'rounded-[20px]' : 'rounded-[18px]'
                  } ${
                    active
                      ? isM3
                        ? 'm3-tonal-active ring-1 ring-[#7FD4FF]/60'
                        : 'lg-pill-active'
                      : isM3
                        ? 'bg-[#232B3D]'
                        : 'lg-capsule'
                  }`}
                >
                  <div className="text-xs font-semibold text-white">{title}</div>
                  <div className="text-[10px] opacity-75">{sub}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Cross-Platform JSON Backup Export & Restore */}
        <div className={`${panelClass} space-y-3`}>
          <div className="text-xs font-semibold text-white">
            {isDe
              ? 'Plattformübergreifendes Backup (macOS ↔ Android ↔ PWA)'
              : 'Cross-Platform Configuration Backup (macOS ↔ Android ↔ PWA)'}
          </div>
          <p className="text-[11px] text-slate-400">
            {isDe
              ? 'Sichert Favoriten, eigene Bouquets, Jugendschutz-PIN und Präferenzen als portables JSON.'
              : 'Exports Favorites, Custom Bouquets, Parental PIN, and Preferences as a portable JSON file.'}
          </p>

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={exportBackupJson}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold ${
                isM3 ? 'm3-primary-pill' : 'lg-pill-active'
              }`}
            >
              <Download className="h-3.5 w-3.5" />
              <span>{isDe ? 'Backup exportieren (.json)' : 'Export Backup (.json)'}</span>
            </button>

            <label
              className={`inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold ${
                isM3 ? 'm3-secondary-tonal' : 'lg-capsule text-white'
              }`}
            >
              <FileUp className="h-3.5 w-3.5" />
              <span>{isDe ? 'Backup importieren' : 'Restore Backup'}</span>
              <input
                type="file"
                accept=".json"
                onChange={handleBackupImportFile}
                className="hidden"
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};
