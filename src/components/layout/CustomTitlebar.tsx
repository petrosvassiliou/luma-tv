import React from 'react';
import {
  Grid2x2,
  Moon,
  PanelLeft,
  Search,
} from 'lucide-react';
import {
  LOCALE_META,
  TRANSLATIONS,
  type LumaLocale,
} from '../../i18n/translations';
import { invokeNativeWindowControl } from '../../services/universalInput';
import type {
  NavigationSection,
  PlatformDesignMode,
} from '../../types/luma';
import { LumaLogo } from '../brand/LumaLogo';

interface CustomTitlebarProps {
  designMode: PlatformDesignMode;
  locale: LumaLocale;
  onToggleLocale: () => void;
  sleepRemainingSec: number | null;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onOpenCommandBar: () => void;
  activeSection: NavigationSection;
  onSelectSection: (section: NavigationSection) => void;
  nowMs: number;
}

export const CustomTitlebar: React.FC<CustomTitlebarProps> = ({
  designMode,
  locale,
  onToggleLocale,
  sleepRemainingSec,
  sidebarCollapsed,
  onToggleSidebar,
  onOpenCommandBar,
  activeSection,
  onSelectSection,
  nowMs,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const t = TRANSLATIONS[locale];
  const bcp47 = LOCALE_META[locale].bcp47;

  const formattedClock = new Intl.DateTimeFormat(bcp47, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(nowMs);

  return (
    <header
      id="luma-custom-titlebar"
      className={
        isM3
          ? 'app-drag-region m3-surface-low relative z-30 flex h-13 shrink-0 items-center justify-between gap-4 px-4'
          : 'app-drag-region lg-pane relative z-30 mx-2.5 mt-2 flex h-11 shrink-0 items-center justify-between gap-4 rounded-[18px] px-3.5'
      }
    >
      {/* Left Region: Window / Sidebar + Brand */}
      <div className="app-no-drag flex items-center gap-2.5">
        {!isM3 && (
          <div className="mr-1.5 flex items-center gap-2 pl-0.5" title="macOS Window Controls">
            <button
              type="button"
              onClick={() => invokeNativeWindowControl('close')}
              className="h-3 w-3 rounded-full bg-[#FF5F57] shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.35)]"
              aria-label="Close"
            />
            <button
              type="button"
              onClick={() => invokeNativeWindowControl('minimize')}
              className="h-3 w-3 rounded-full bg-[#FEBC2E] shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.35)]"
              aria-label="Minimize"
            />
            <button
              type="button"
              onClick={() => invokeNativeWindowControl('toggle-maximize')}
              className="h-3 w-3 rounded-full bg-[#28C840] shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.35)]"
              aria-label="Zoom"
            />
          </div>
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

      {/* Right Region: Minimal Essential Controls */}
      <div className="app-no-drag flex items-center gap-2">
        {sleepRemainingSec !== null && (
          <span className="hidden items-center gap-1 rounded-full bg-amber-400/20 px-2.5 py-1 text-[11px] font-semibold text-amber-200 md:inline-flex luma-tabular">
            <Moon className="h-3 w-3" />
            {Math.ceil(sleepRemainingSec / 60)}m
          </span>
        )}

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
          <span className="hidden md:inline">Multiview</span>
        </button>

        <button
          id="btn-toggle-locale"
          type="button"
          onClick={onToggleLocale}
          className={
            isM3
              ? 'm3-secondary-tonal hidden rounded-full px-2.5 py-1.5 text-[11px] font-bold sm:inline-flex'
              : 'lg-capsule hidden rounded-full px-2.5 py-1 text-[11px] font-semibold text-white sm:inline-flex'
          }
          title={`${LOCALE_META[locale].nativeName} — DE / EN / IT / FR / ES / GR`}
        >
          {LOCALE_META[locale].badge}
        </button>

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
