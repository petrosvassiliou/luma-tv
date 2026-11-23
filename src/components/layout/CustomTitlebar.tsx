import React from 'react';
import {
  Apple,
  Grid2x2,
  Layers,
  Moon,
  PanelLeft,
  Search,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import {
  LOCALE_META,
  TRANSLATIONS,
  type LumaLocale,
} from '../../i18n/translations';
import { invokeNativeWindowControl } from '../../services/universalInput';
import {
  LUMA_RELEASE_BADGE,
  type NavigationSection,
  type PlatformDesignMode,
} from '../../types/luma';
import { LumaLogo } from '../brand/LumaLogo';

interface CustomTitlebarProps {
  designMode: PlatformDesignMode;
  onChangeDesignMode: (mode: PlatformDesignMode) => void;
  locale: LumaLocale;
  onToggleLocale: () => void;
  sleepRemainingSec: number | null;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onOpenCommandBar: () => void;
  activeSection: NavigationSection;
  onSelectSection: (section: NavigationSection) => void;
  ambilightEnabled: boolean;
  onToggleAmbilight: () => void;
  stressMode20k: boolean;
  onToggleStressMode20k: () => void;
  totalChannels: number;
  nowMs: number;
}

export const CustomTitlebar: React.FC<CustomTitlebarProps> = ({
  designMode,
  onChangeDesignMode,
  locale,
  onToggleLocale,
  sleepRemainingSec,
  sidebarCollapsed,
  onToggleSidebar,
  onOpenCommandBar,
  activeSection,
  onSelectSection,
  ambilightEnabled,
  onToggleAmbilight,
  stressMode20k,
  onToggleStressMode20k,
  totalChannels,
  nowMs,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const t = TRANSLATIONS[locale];

  const bcp47 = LOCALE_META[locale].bcp47;
  const formattedClock = new Intl.DateTimeFormat(bcp47, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(nowMs);

  return (
    <header
      id="luma-custom-titlebar"
      className={
        isM3
          ? 'app-drag-region m3-surface-low relative z-30 flex h-14 shrink-0 items-center justify-between gap-3 px-3.5'
          : 'app-drag-region lg-pane relative z-30 mx-2.5 mt-2 flex h-12 shrink-0 items-center justify-between gap-3 rounded-[20px] px-3.5'
      }
    >
      {/* Left Region */}
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
              ? 'm3-spring flex h-10 w-10 items-center justify-center rounded-full text-slate-200 hover:bg-[#232B3D]'
              : 'lg-capsule flex h-8 w-8 items-center justify-center rounded-full text-slate-200 hover:text-white'
          }
          title={sidebarCollapsed ? t.expandSidebar : t.collapseSidebar}
        >
          <PanelLeft className="h-4 w-4" />
        </button>

        <LumaLogo size={isM3 ? 28 : 25} />

        <span
          className={
            isM3
              ? 'rounded-full bg-[#5E2B40] px-2.5 py-0.5 text-[10px] font-bold tracking-wide text-[#FFD8E6]'
              : 'lg-capsule rounded-full px-2 py-0.5 text-[10px] font-semibold text-sky-200'
          }
        >
          {LUMA_RELEASE_BADGE}
        </span>

        <span
          className={
            isM3
              ? 'hidden rounded-full bg-[#232B3D] px-3 py-1 text-[11px] font-semibold text-[#C4E8FF] xl:inline-block luma-tabular'
              : 'lg-capsule hidden rounded-full px-2.5 py-0.5 text-[10px] font-medium text-slate-200 xl:inline-block luma-tabular'
          }
        >
          {totalChannels.toLocaleString(bcp47)} {t.channelsUnit}
        </span>
      </div>

      {/* Center Search Trigger */}
      <div className="app-no-drag flex max-w-md flex-1 justify-center">
        <button
          id="btn-open-command-bar"
          type="button"
          onClick={onOpenCommandBar}
          className={
            isM3
              ? 'm3-spring m3-surface-high group flex h-10 w-full items-center justify-between rounded-full px-4 text-xs text-slate-200 hover:bg-[#2E384F]'
              : 'lg-capsule group flex h-8 w-full items-center justify-between rounded-full px-3.5 text-xs text-slate-200 hover:text-white'
          }
        >
          <span className="flex items-center gap-2.5 truncate">
            <Search
              className={`h-4 w-4 shrink-0 transition group-hover:scale-105 ${
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

      {/* Right Region */}
      <div className="app-no-drag flex items-center gap-2">
        {sleepRemainingSec !== null && (
          <span className="hidden items-center gap-1 rounded-full bg-amber-400/20 px-2.5 py-1 text-[11px] font-semibold text-amber-200 md:inline-flex luma-tabular">
            <Moon className="h-3 w-3" />
            {Math.ceil(sleepRemainingSec / 60)}m
          </span>
        )}

        {/* Dual-Platform Design System Switcher */}
        <div
          id="platform-design-switcher"
          className={
            isM3
              ? 'flex items-center rounded-full bg-[#232B3D] p-1'
              : 'lg-capsule flex items-center rounded-full p-0.5'
          }
          role="group"
        >
          <button
            id="btn-mode-m3"
            type="button"
            onClick={() => onChangeDesignMode('m3-expressive')}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all ${
              isM3
                ? 'bg-[#7FD4FF] text-[#00354A] shadow-sm'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Smartphone className="h-3.5 w-3.5" />
            <span>M3</span>
          </button>

          <button
            id="btn-mode-liquid-glass"
            type="button"
            onClick={() => onChangeDesignMode('liquid-glass')}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all ${
              !isM3
                ? 'lg-pill-active text-white'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Apple className="h-3.5 w-3.5" />
            <span>Liquid Glass</span>
          </button>
        </div>

        {/* 6-Language Quick Cycle (DE · EN · IT · FR · ES · GR) */}
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

        {/* 20k EPG Stress-Test */}
        <button
          id="btn-stress-test-20k"
          type="button"
          onClick={onToggleStressMode20k}
          className={
            isM3
              ? `m3-spring hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold lg:inline-flex luma-tabular ${
                  stressMode20k ? 'm3-tonal-active' : 'm3-secondary-tonal'
                }`
              : `hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium lg:inline-flex luma-tabular ${
                  stressMode20k ? 'lg-pill-active' : 'lg-capsule text-slate-200'
                }`
          }
        >
          <Layers className="h-3.5 w-3.5" />
          <span>{stressMode20k ? '20.4k' : '20k EPG'}</span>
        </button>

        {/* Multiview */}
        <button
          id="btn-titlebar-multiview"
          type="button"
          onClick={() =>
            onSelectSection(activeSection === 'multiview' ? 'live-epg' : 'multiview')
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
        >
          <Grid2x2 className="h-3.5 w-3.5" />
          <span className="hidden xl:inline">Multiview</span>
        </button>

        {/* Ambilight */}
        <button
          id="btn-toggle-ambilight"
          type="button"
          onClick={onToggleAmbilight}
          className={
            isM3
              ? `m3-spring hidden h-8 w-8 items-center justify-center rounded-full xl:inline-flex ${
                  ambilightEnabled ? 'm3-tonal-active' : 'm3-secondary-tonal opacity-70'
                }`
              : `hidden h-8 w-8 items-center justify-center rounded-full xl:inline-flex ${
                  ambilightEnabled ? 'lg-pill-active' : 'lg-capsule text-slate-400'
                }`
          }
          title="Dynamic Ambient Glow"
        >
          <Sparkles className="h-3.5 w-3.5" />
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
