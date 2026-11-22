import React from 'react';
import {
  Apple,
  Grid2x2,
  Layers,
  PanelLeft,
  Search,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import {
  LUMA_RELEASE_BADGE,
  type NavigationSection,
  type PlatformDesignMode,
} from '../../types/luma';
import { LumaLogo } from '../brand/LumaLogo';

interface CustomTitlebarProps {
  designMode: PlatformDesignMode;
  onChangeDesignMode: (mode: PlatformDesignMode) => void;
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

  const formattedClock = new Intl.DateTimeFormat('de-DE', {
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
      {/* Left Region: Traffic Lights (macOS Liquid Glass) + Sidebar Toggle + Brand */}
      <div className="app-no-drag flex items-center gap-2.5">
        {!isM3 && (
          <div
            className="mr-1.5 flex items-center gap-2 pl-0.5"
            title="macOS Window Controls"
          >
            <span className="h-3 w-3 rounded-full bg-[#FF5F57] shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.35)]" />
            <span className="h-3 w-3 rounded-full bg-[#FEBC2E] shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.35)]" />
            <span className="h-3 w-3 rounded-full bg-[#28C840] shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.35)]" />
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
          title={sidebarCollapsed ? 'Navigation einblenden' : 'Navigation einklappen'}
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
          {totalChannels.toLocaleString('de-DE')} Kanäle
        </span>
      </div>

      {/* Center Region: M3 Expressive Pill Search Bar OR macOS Liquid Glass Spotlight Capsule */}
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
              Sender, EPG oder 4K-Stream suchen…
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

      {/* Right Region: Platform Design Switcher (M3 Expressive <-> macOS Liquid Glass) + Quick Toggles */}
      <div className="app-no-drag flex items-center gap-2">
        {/* Dual-Platform Design System Switcher */}
        <div
          id="platform-design-switcher"
          className={
            isM3
              ? 'flex items-center rounded-full bg-[#232B3D] p-1'
              : 'lg-capsule flex items-center rounded-full p-0.5'
          }
          role="group"
          aria-label="Plattform-Design wechseln"
        >
          <button
            id="btn-mode-m3"
            type="button"
            onClick={() => onChangeDesignMode('m3-expressive')}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold transition-all ${
              isM3
                ? 'bg-[#7FD4FF] text-[#00354A] shadow-sm'
                : 'text-slate-300 hover:text-white'
            }`}
            title="Googlebook / Android: Material 3 Expressive"
          >
            <Smartphone className="h-3.5 w-3.5" />
            <span>GoogleOS · M3</span>
          </button>

          <button
            id="btn-mode-liquid-glass"
            type="button"
            onClick={() => onChangeDesignMode('liquid-glass')}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold transition-all ${
              !isM3
                ? 'lg-pill-active text-white'
                : 'text-slate-300 hover:text-white'
            }`}
            title="macOS: Apple Liquid Glass"
          >
            <Apple className="h-3.5 w-3.5" />
            <span>macOS · Liquid Glass</span>
          </button>
        </div>

        {/* 20k EPG Stress-Test */}
        <button
          id="btn-stress-test-20k"
          type="button"
          onClick={onToggleStressMode20k}
          className={
            isM3
              ? `m3-spring hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold lg:inline-flex luma-tabular ${
                  stressMode20k
                    ? 'm3-tonal-active'
                    : 'm3-secondary-tonal'
                }`
              : ` hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium lg:inline-flex luma-tabular ${
                  stressMode20k ? 'lg-pill-active' : 'lg-capsule text-slate-200'
                }`
          }
          title="2D-Virtualisierung mit 20.400 Kanälen testen"
        >
          <Layers className="h-3.5 w-3.5" />
          <span>{stressMode20k ? '20.4k Aktiv' : '20k EPG'}</span>
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
          title="Luma Multiview (4x Sport-Modus)"
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
          title="Dynamic Ambient Glow umschalten"
        >
          <Sparkles className="h-3.5 w-3.5" />
        </button>

        {/* Clock */}
        <div
          className={
            isM3
              ? 'hidden rounded-full bg-[#1A202E] px-3 py-1 text-xs font-semibold text-slate-200 sm:block luma-tabular'
              : 'lg-capsule hidden rounded-full px-2.5 py-1 text-xs font-medium text-white/90 sm:block luma-tabular'
          }
        >
          {formattedClock}
        </div>

        {/* ChromeOS Window Controls Overlay Caption Buttons (in GoogleOS M3 Mode) */}
        {isM3 && (
          <div
            className="hidden items-center gap-1 pl-1 text-slate-400 md:flex"
            title="ChromeOS Window Controls Overlay"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/10 text-xs">
              ─
            </span>
            <span className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/10 text-[11px]">
              ▢
            </span>
            <span className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-rose-500/30 text-xs">
              ✕
            </span>
          </div>
        )}
      </div>
    </header>
  );
};
