import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Columns2,
  Database,
  Grid2x2,
  Moon,
  PanelLeft,
  Plus,
  Search,
} from 'lucide-react';
import { isTauriNativeRuntime } from '../../engine/LumaPlayerEngine';
import {
  LOCALE_META,
  TRANSLATIONS,
  type LumaLocale,
} from '../../i18n/translations';
import type {
  NavigationSection,
  PlatformDesignMode,
} from '../../types/luma';
import { LumaLogo } from '../brand/LumaLogo';
import { LanguageDropdown } from '../common/LanguageDropdown';

export interface QuickPlaylistOption {
  id: string;
  name: string;
  channelCount: number;
}

interface CustomTitlebarProps {
  designMode: PlatformDesignMode;
  locale: LumaLocale;
  onSelectLocale: (locale: LumaLocale) => void;
  sleepRemainingSec: number | null;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onOpenCommandBar: () => void;
  activeSection: NavigationSection;
  onSelectSection: (section: NavigationSection) => void;
  playlists?: QuickPlaylistOption[];
  activeSourceId?: string;
  onSelectSourceId?: (sourceId: string) => void;
  nowMs: number;
}

const CustomTitlebarInner: React.FC<CustomTitlebarProps> = ({
  designMode,
  locale,
  onSelectLocale,
  sleepRemainingSec,
  sidebarCollapsed,
  onToggleSidebar,
  onOpenCommandBar,
  activeSection,
  onSelectSection,
  playlists = [],
  activeSourceId,
  onSelectSourceId,
  nowMs,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const t = TRANSLATIONS[locale];
  const bcp47 = LOCALE_META[locale].bcp47;

  const [playlistMenuOpen, setPlaylistMenuOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);
  const reserveNativeTrafficLights = !isM3 && isTauriNativeRuntime() && !isFullscreen;

  useEffect(() => {
    const updateFs = () => {
      const htmlFs = Boolean(document.fullscreenElement);
      const macNativeFs =
        typeof window !== 'undefined' &&
        typeof screen !== 'undefined' &&
        Math.abs(window.innerHeight - screen.height) <= 2 &&
        Math.abs(window.innerWidth - screen.width) <= 2;
      setIsFullscreen(htmlFs || macNativeFs);
    };
    updateFs();
    window.addEventListener('resize', updateFs);
    document.addEventListener('fullscreenchange', updateFs);
    return () => {
      window.removeEventListener('resize', updateFs);
      document.removeEventListener('fullscreenchange', updateFs);
    };
  }, []);

  useEffect(() => {
    if (!playlistMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (
        menuContainerRef.current &&
        !menuContainerRef.current.contains(e.target as Node)
      ) {
        setPlaylistMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPlaylistMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [playlistMenuOpen]);

  const activePlaylist = playlists.find((p) => p.id === activeSourceId) ?? null;

  const formattedClock = new Intl.DateTimeFormat(bcp47, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(nowMs);

  return (
    <header
      id="luma-custom-titlebar"
      data-tauri-drag-region
      className={
        isM3
          ? 'app-drag-region m3-surface-low relative z-30 flex h-13 shrink-0 items-center justify-between gap-4 px-4'
          : 'app-drag-region lg-pane relative z-30 mx-2.5 mt-2 flex h-11 shrink-0 items-center justify-between gap-4 rounded-[18px] px-3.5'
      }
    >
      {/* Left Region: Native macOS Traffic Light Clearance + Sidebar + Brand */}
      <div className="app-no-drag flex items-center gap-2.5">
        {reserveNativeTrafficLights && (
          <div className="w-[70px] shrink-0" aria-hidden="true" />
        )}

        <button
          id="btn-toggle-sidebar"
          type="button"
          onClick={onToggleSidebar}
          className={
            isM3
              ? 'm3-spring flex h-9 w-9 items-center justify-center rounded-full text-slate-200 hover:bg-[#232B3D]'
              : 'lg-capsule flex h-8 w-8 items-center justify-center rounded-full text-slate-200 hover:text-white'
          }
          title={sidebarCollapsed ? t.expandSidebar : t.collapseSidebar}
        >
          <PanelLeft className="h-4 w-4" />
        </button>

        <LumaLogo size={isM3 ? 26 : 24} />
      </div>

      {/* Center Search Trigger */}
      <div className="app-no-drag flex max-w-lg flex-1 justify-center">
        <button
          id="btn-open-command-bar"
          type="button"
          onClick={onOpenCommandBar}
          className={
            isM3
              ? 'm3-spring m3-surface-high group flex h-9 w-full items-center justify-between rounded-full px-4 text-xs text-slate-200 hover:bg-[#2E384F]'
              : 'lg-capsule group flex h-8 w-full items-center justify-between rounded-full px-3.5 text-xs text-slate-200 hover:text-white'
          }
        >
          <span className="flex items-center gap-2.5 truncate">
            <Search
              className={`h-3.5 w-3.5 shrink-0 transition group-hover:scale-105 ${
                isM3 ? 'text-[#7FD4FF]' : 'text-sky-300'
              }`}
            />
            <span className="truncate text-slate-300 group-hover:text-white">
              {t.searchPlaceholder}
            </span>
          </span>
          <kbd
            className={
              isM3
                ? 'ml-2 shrink-0 rounded-full bg-[#131722] px-2.5 py-0.5 font-mono text-[10px] font-semibold text-[#7FD4FF]'
                : 'ml-2 shrink-0 rounded-full bg-white/10 px-2 py-0.5 font-mono text-[10px] text-white/80'
            }
          >
            {isM3 ? 'Ctrl+K' : '⌘K'}
          </kbd>
        </button>
      </div>

      {/* Right Region: Quick Playlist Switcher + Essential Controls */}
      <div className="app-no-drag flex items-center gap-2">
        {sleepRemainingSec !== null && (
          <span className="hidden items-center gap-1 rounded-full bg-amber-400/20 px-2.5 py-1 text-[11px] font-semibold text-amber-200 md:inline-flex luma-tabular">
            <Moon className="h-3 w-3" />
            {Math.ceil(sleepRemainingSec / 60)}m
          </span>
        )}

        {/* Quick Playlist Switcher */}
        {onSelectSourceId && (
          <div ref={menuContainerRef} className="relative">
            <button
              id="btn-quick-playlist-switcher"
              type="button"
              onClick={() => {
                if (playlists.length === 0) {
                  onSelectSection('sources');
                } else {
                  setPlaylistMenuOpen((v) => !v);
                }
              }}
              className={
                isM3
                  ? 'm3-secondary-tonal inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold'
                  : 'lg-capsule inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium text-slate-200 hover:text-white'
              }
              title={t.navSources}
            >
              <Database className="h-3.5 w-3.5 shrink-0 text-sky-300" />
              <span className="max-w-[120px] truncate">
                {activePlaylist ? activePlaylist.name : t.navSources}
              </span>
              {playlists.length > 0 && (
                <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
              )}
            </button>

            {playlistMenuOpen && (
              <div
                className={`absolute top-full right-0 z-50 mt-2 w-64 overflow-hidden p-1.5 shadow-2xl ${
                  isM3
                    ? 'rounded-[22px] bg-[#1E2536] ring-1 ring-white/15'
                    : 'lg-modal rounded-[20px]'
                }`}
              >
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Switch Playlist
                </div>

                <div className="luma-scroll max-h-64 overflow-y-auto space-y-0.5">
                  {playlists.map((pl) => {
                    const isSelected = pl.id === activeSourceId;
                    return (
                      <button
                        key={pl.id}
                        type="button"
                        onClick={() => {
                          onSelectSourceId(pl.id);
                          setPlaylistMenuOpen(false);
                        }}
                        className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs transition ${
                          isSelected
                            ? isM3
                              ? 'm3-tonal-active font-semibold'
                              : 'lg-pill-active font-semibold'
                            : 'text-slate-200 hover:bg-white/10'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="truncate">{pl.name}</div>
                          <div className="text-[10px] opacity-70 luma-tabular">
                            {pl.channelCount.toLocaleString(bcp47)} {t.channelsUnit}
                          </div>
                        </div>
                        {isSelected && (
                          <Check className="h-3.5 w-3.5 shrink-0 text-sky-300" />
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-1 border-t border-white/10 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setPlaylistMenuOpen(false);
                      onSelectSection('sources');
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-medium text-sky-300 hover:bg-white/10"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>{t.navSources}…</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <button
          id="btn-titlebar-dualview"
          type="button"
          onClick={() =>
            onSelectSection(activeSection === 'dualview' ? 'live' : 'dualview')
          }
          className={
            isM3
              ? `m3-spring inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold ${
                  activeSection === 'dualview' ? 'm3-primary-pill' : 'm3-secondary-tonal'
                }`
              : `inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                  activeSection === 'dualview' ? 'lg-pill-active' : 'lg-capsule text-slate-200'
                }`
          }
          title={t.navDualview}
        >
          <Columns2 className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Dual</span>
        </button>

        <button
          id="btn-titlebar-multiview"
          type="button"
          onClick={() =>
            onSelectSection(activeSection === 'multiview' ? 'live' : 'multiview')
          }
          className={
            isM3
              ? `m3-spring inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold ${
                  activeSection === 'multiview' ? 'm3-primary-pill' : 'm3-secondary-tonal'
                }`
              : `inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                  activeSection === 'multiview' ? 'lg-pill-active' : 'lg-capsule text-slate-200'
                }`
          }
          title={t.navMultiview}
        >
          <Grid2x2 className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">Multiview</span>
        </button>

        <LanguageDropdown
          id="btn-toggle-locale"
          variant="compact"
          designMode={designMode}
          locale={locale}
          onSelectLocale={onSelectLocale}
        />

        <div
          className={
            isM3
              ? 'hidden rounded-full bg-[#1A202E] px-3 py-1 text-xs font-semibold text-slate-200 sm:block luma-tabular'
              : 'lg-capsule hidden rounded-full px-2.5 py-1 text-xs font-medium text-white/90 sm:block luma-tabular'
          }
        >
          {formattedClock}
        </div>
      </div>
    </header>
  );
};

export const CustomTitlebar = React.memo(CustomTitlebarInner);
