import React from 'react';
import {
  Clapperboard,
  Compass,
  Database,
  Film,
  FolderHeart,
  Globe,
  Grid2x2,
  History,
  Home,
  Layers,
  Lock,
  Radio,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trophy,
  Tv,
} from 'lucide-react';
import { TRANSLATIONS, type LumaLocale } from '../../i18n/translations';
import {
  LUMA_RELEASE_BADGE,
  type ChannelGroup,
  type NavigationSection,
  type PlatformDesignMode,
} from '../../types/luma';

interface SidebarProps {
  designMode: PlatformDesignMode;
  locale: LumaLocale;
  collapsed: boolean;
  activeSection: NavigationSection;
  onSelectSection: (section: NavigationSection) => void;
  selectedGroupId: string;
  onSelectGroup: (groupId: string) => void;
  onOpenCommandBar: () => void;
  groups: ChannelGroup[];
  totalChannelCount: number;
  favoritesCount: number;
}

const GROUP_ICONS: Record<string, React.FC<{ className?: string }>> = {
  Tv,
  Trophy,
  Film,
  Globe,
  Compass,
  Sparkles,
  FolderHeart,
};

export const Sidebar: React.FC<SidebarProps> = ({
  designMode,
  locale,
  collapsed,
  activeSection,
  onSelectSection,
  selectedGroupId,
  onSelectGroup,
  onOpenCommandBar,
  groups,
  totalChannelCount,
  favoritesCount,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const t = TRANSLATIONS[locale];

  const navItems: {
    id: NavigationSection;
    label: string;
    shortLabel: string;
    badge?: string;
    icon: React.FC<{ className?: string }>;
  }[] = [
    { id: 'home', label: t.navHome, shortLabel: 'Start', icon: Home },
    { id: 'live-epg', label: t.navLive, shortLabel: 'Live', icon: Radio },
    { id: 'multiview', label: t.navMultiview, shortLabel: '4x', badge: 'SPORT', icon: Grid2x2 },
    { id: 'vod', label: t.navVod, shortLabel: 'VOD', icon: Film },
    { id: 'series', label: t.navSeries, shortLabel: 'Series', icon: Clapperboard },
    { id: 'catchup', label: t.navCatchup, shortLabel: 'Replay', icon: History },
    { id: 'studio', label: t.navStudio, shortLabel: 'Studio', icon: SlidersHorizontal },
    { id: 'sources', label: t.navSources, shortLabel: 'Cloud', icon: Database },
    { id: 'settings', label: t.navSettings, shortLabel: 'Prefs', icon: Settings },
  ];

  if (isM3) {
    return (
      <aside
        id="luma-sidebar"
        className={`m3-surface-low relative z-20 flex shrink-0 flex-col transition-all duration-300 ${
          collapsed ? 'w-20 items-center px-2 py-2' : 'w-[268px] px-3 py-2'
        }`}
      >
        <button
          type="button"
          onClick={onOpenCommandBar}
          className={`m3-primary-pill mb-2 flex items-center justify-center gap-2.5 shadow-lg ${
            collapsed
              ? 'h-11 w-11 rounded-[16px]'
              : 'h-10 w-full rounded-[20px] px-4 text-xs font-bold tracking-wide'
          }`}
          title="Ctrl+K"
        >
          <Search className="h-4 w-4 shrink-0" />
          {!collapsed && <span>{locale === 'de' ? 'Schnellsuche & Zap' : 'Quick Search & Zap'}</span>}
        </button>

        <div className="w-full space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;

            if (collapsed) {
              return (
                <button
                  key={item.id}
                  id={`nav-${item.id}`}
                  type="button"
                  onClick={() => onSelectSection(item.id)}
                  className="group flex w-full flex-col items-center gap-0.5 py-0.5 text-[10px] font-medium"
                >
                  <span
                    className={`m3-spring flex h-7 w-14 items-center justify-center rounded-full ${
                      isActive
                        ? 'm3-tonal-active'
                        : 'text-slate-400 group-hover:bg-[#232B3D] group-hover:text-slate-100'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className={isActive ? 'font-semibold text-[#C4E8FF]' : 'text-slate-400'}>
                    {item.shortLabel}
                  </span>
                </button>
              );
            }

            return (
              <button
                key={item.id}
                id={`nav-${item.id}`}
                type="button"
                onClick={() => onSelectSection(item.id)}
                className={`m3-spring flex h-9 w-full items-center justify-between rounded-full px-4 text-xs font-semibold ${
                  isActive
                    ? 'm3-tonal-active'
                    : 'text-slate-300 hover:bg-[#1E2536] hover:text-white'
                }`}
              >
                <span className="flex items-center gap-3 truncate">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.badge && (
                  <span className="m3-tertiary-badge rounded-full px-2.5 py-0.5 text-[10px] font-bold">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="my-2 w-full border-t border-white/[0.07]" />

        <div className="luma-scroll w-full flex-1 overflow-y-auto space-y-0.5 pr-0.5">
          {!collapsed && (
            <div className="px-4 pb-1 text-[11px] font-semibold text-[#8CA2C6]">
              {t.bouquetsHeader}
            </div>
          )}

          <button
            id="group-all"
            type="button"
            onClick={() => onSelectGroup('all')}
            title={collapsed ? t.allChannels : undefined}
            className={`m3-spring flex w-full items-center justify-between rounded-full ${
              collapsed ? 'h-9 justify-center' : 'h-9 px-4'
            } text-xs font-medium ${
              selectedGroupId === 'all' && activeSection === 'live-epg'
                ? 'bg-[#29354D] text-[#D6E3FF] font-semibold'
                : 'text-slate-300 hover:bg-[#1E2536]'
            }`}
          >
            <span className="flex items-center gap-3 truncate">
              <Layers className="h-4 w-4 shrink-0 text-[#7FD4FF]" />
              {!collapsed && <span>{t.allChannels}</span>}
            </span>
            {!collapsed && (
              <span className="rounded-full bg-[#131722] px-2.5 py-0.5 text-[11px] text-slate-300 luma-tabular">
                {totalChannelCount.toLocaleString('de-DE')}
              </span>
            )}
          </button>

          <button
            id="group-favorites"
            type="button"
            onClick={() => onSelectGroup('favorites')}
            title={collapsed ? t.favorites : undefined}
            className={`m3-spring flex w-full items-center justify-between rounded-full ${
              collapsed ? 'h-9 justify-center' : 'h-9 px-4'
            } text-xs font-medium ${
              selectedGroupId === 'favorites' && activeSection === 'live-epg'
                ? 'm3-tertiary-badge font-semibold'
                : 'text-slate-300 hover:bg-[#1E2536]'
            }`}
          >
            <span className="flex items-center gap-3 truncate">
              <Star className="h-4 w-4 shrink-0 text-[#FFB1C8]" />
              {!collapsed && <span>{t.favorites}</span>}
            </span>
            {!collapsed && (
              <span className="rounded-full bg-[#131722] px-2.5 py-0.5 text-[11px] text-slate-300 luma-tabular">
                {favoritesCount}
              </span>
            )}
          </button>

          {groups.map((grp) => {
            const Icon = GROUP_ICONS[grp.icon] ?? Tv;
            const isSelected = selectedGroupId === grp.id && activeSection === 'live-epg';
            return (
              <button
                key={grp.id}
                id={`group-${grp.id}`}
                type="button"
                onClick={() => onSelectGroup(grp.id)}
                title={collapsed ? grp.name : undefined}
                className={`m3-spring flex w-full items-center justify-between rounded-full ${
                  collapsed ? 'h-9 justify-center' : 'h-9 px-4'
                } text-xs font-medium ${
                  isSelected
                    ? 'bg-[#29354D] text-[#D6E3FF] font-semibold'
                    : 'text-slate-400 hover:bg-[#1E2536] hover:text-slate-100'
                }`}
              >
                <span className="flex items-center gap-3 truncate">
                  <Icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span className="truncate">{grp.name}</span>}
                </span>
                {!collapsed && (
                  <span className="flex items-center gap-1.5 text-[11px] text-slate-400 luma-tabular">
                    {grp.isPinLocked && <Lock className="h-3 w-3 text-amber-300" />}
                    <span>{grp.count.toLocaleString('de-DE')}</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {!collapsed && (
          <div className="mt-2 w-full rounded-[20px] bg-[#1A202E] p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[#C4E8FF]">
                Luma TV · {LUMA_RELEASE_BADGE}
              </span>
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-luma-live" />
            </div>
            <p className="mt-0.5 text-[10px] text-slate-400">
              GoogleOS / Android M3 · `app.lumatv.client`
            </p>
          </div>
        )}
      </aside>
    );
  }

  return (
    <aside
      id="luma-sidebar"
      className={`lg-pane relative z-20 m-2.5 mr-0 flex shrink-0 flex-col rounded-[24px] transition-all duration-300 ${
        collapsed ? 'w-[66px]' : 'w-64'
      }`}
    >
      <div className="p-2.5 space-y-0.5">
        {!collapsed && (
          <div className="px-2.5 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/45">
            {t.workspaceHeader}
          </div>
        )}

        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              id={`nav-${item.id}`}
              type="button"
              onClick={() => onSelectSection(item.id)}
              title={collapsed ? item.label : undefined}
              className={`group flex w-full items-center justify-between rounded-[14px] px-3 py-1.5 text-xs font-medium transition-all ${
                isActive
                  ? 'lg-pill-active'
                  : 'text-white/75 hover:bg-white/[0.08] hover:text-white'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    isActive ? 'text-sky-300' : 'text-white/60 group-hover:text-white'
                  }`}
                />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </span>
              {!collapsed && item.badge && (
                <span className="rounded-full bg-white/15 px-2 py-0.5 text-[9px] font-semibold tracking-wider text-sky-200">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mx-3.5 my-1 border-t border-white/10" />

      <div className="luma-scroll flex-1 overflow-y-auto px-2.5 py-1 space-y-0.5">
        {!collapsed && (
          <div className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/45">
            {t.bouquetsHeader}
          </div>
        )}

        <button
          id="group-all"
          type="button"
          onClick={() => onSelectGroup('all')}
          title={collapsed ? t.allChannels : undefined}
          className={`flex w-full items-center justify-between rounded-[14px] px-3 py-1.5 text-xs font-medium transition ${
            selectedGroupId === 'all' && activeSection === 'live-epg'
              ? 'lg-pill-active'
              : 'text-white/75 hover:bg-white/[0.08] hover:text-white'
          }`}
        >
          <span className="flex items-center gap-2.5 truncate">
            <Layers className="h-4 w-4 shrink-0 text-sky-300" />
            {!collapsed && <span className="truncate">{t.allChannels}</span>}
          </span>
          {!collapsed && (
            <span className="text-[11px] text-white/55 luma-tabular">
              {totalChannelCount.toLocaleString('de-DE')}
            </span>
          )}
        </button>

        <button
          id="group-favorites"
          type="button"
          onClick={() => onSelectGroup('favorites')}
          title={collapsed ? t.favorites : undefined}
          className={`flex w-full items-center justify-between rounded-[14px] px-3 py-1.5 text-xs font-medium transition ${
            selectedGroupId === 'favorites' && activeSection === 'live-epg'
              ? 'lg-pill-active'
              : 'text-white/75 hover:bg-white/[0.08] hover:text-white'
          }`}
        >
          <span className="flex items-center gap-2.5 truncate">
            <Star className="h-4 w-4 shrink-0 text-amber-300" />
            {!collapsed && <span className="truncate">{t.favorites}</span>}
          </span>
          {!collapsed && (
            <span className="text-[11px] text-white/55 luma-tabular">{favoritesCount}</span>
          )}
        </button>

        {groups.map((grp) => {
          const Icon = GROUP_ICONS[grp.icon] ?? Tv;
          const isSelected = selectedGroupId === grp.id && activeSection === 'live-epg';
          return (
            <button
              key={grp.id}
              id={`group-${grp.id}`}
              type="button"
              onClick={() => onSelectGroup(grp.id)}
              title={collapsed ? grp.name : undefined}
              className={`flex w-full items-center justify-between rounded-[14px] px-3 py-1.5 text-xs font-medium transition ${
                isSelected
                  ? 'lg-pill-active'
                  : 'text-white/65 hover:bg-white/[0.08] hover:text-white'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="truncate">{grp.name}</span>}
              </span>
              {!collapsed && (
                <span className="flex items-center gap-1.5 text-[11px] text-white/45 luma-tabular">
                  {grp.isPinLocked && <Lock className="h-3 w-3 text-amber-300" />}
                  <span>{grp.count.toLocaleString('de-DE')}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>

      {!collapsed && (
        <div className="p-2.5">
          <div className="lg-capsule rounded-[18px] p-2.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-semibold text-white">
                Luma TV · {LUMA_RELEASE_BADGE}
              </span>
              <span className="h-2 w-2 rounded-full bg-sky-300 animate-luma-live" />
            </div>
            <p className="mt-0.5 text-[10px] text-white/65">
              macOS Liquid Glass · `app.lumatv.client`
            </p>
          </div>
        </div>
      )}
    </aside>
  );
};
