import React, { useMemo, useState } from 'react';
import {
  CalendarClock,
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
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trophy,
  Tv,
} from 'lucide-react';
import {
  LOCALE_META,
  TRANSLATIONS,
  type LumaLocale,
} from '../../i18n/translations';
import { matchesNormalizedQuery, tokenizeSearchQuery } from '../../services/channelSearch';
import type {
  ChannelGroup,
  NavigationSection,
  PlatformDesignMode,
} from '../../types/luma';

interface SidebarProps {
  designMode: PlatformDesignMode;
  locale: LumaLocale;
  collapsed: boolean;
  activeSection: NavigationSection;
  onSelectSection: (section: NavigationSection) => void;
  selectedGroupId: string;
  onSelectGroup: (groupId: string) => void;
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
  groups,
  totalChannelCount,
  favoritesCount,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const t = TRANSLATIONS[locale];
  const bcp47 = LOCALE_META[locale].bcp47;
  const [groupFilter, setGroupFilter] = useState('');

  const isLiveSection = activeSection === 'live' || activeSection === 'live-epg';

  const navItems: {
    id: NavigationSection;
    label: string;
    shortLabel: string;
    icon: React.FC<{ className?: string }>;
  }[] = [
    { id: 'live', label: t.navLiveTv, shortLabel: 'Live', icon: Tv },
    { id: 'live-epg', label: t.navLive, shortLabel: 'EPG', icon: CalendarClock },
    { id: 'home', label: t.navHome, shortLabel: 'Home', icon: Home },
    { id: 'vod', label: t.navVod, shortLabel: 'VOD', icon: Film },
    { id: 'series', label: t.navSeries, shortLabel: 'Series', icon: Clapperboard },
    { id: 'catchup', label: t.navCatchup, shortLabel: 'Replay', icon: History },
    { id: 'multiview', label: t.navMultiview, shortLabel: '4x', icon: Grid2x2 },
    { id: 'studio', label: t.navStudio, shortLabel: 'Studio', icon: SlidersHorizontal },
    { id: 'sources', label: t.navSources, shortLabel: 'Sources', icon: Database },
    { id: 'settings', label: t.navSettings, shortLabel: 'Prefs', icon: Settings },
  ];

  const filteredGroups = useMemo(() => {
    const tokens = tokenizeSearchQuery(groupFilter);
    if (tokens.length === 0) return groups;
    return groups.filter((g) => matchesNormalizedQuery(g.name, tokens));
  }, [groups, groupFilter]);

  const displayedGroups = filteredGroups.slice(0, 120);

  if (isM3) {
    return (
      <aside
        id="luma-sidebar"
        className={`m3-surface-low relative z-20 flex shrink-0 flex-col transition-all duration-300 ${
          collapsed ? 'w-[74px] items-center px-2 py-2' : 'w-[252px] px-3 py-2.5'
        }`}
      >
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
                    className={`m3-spring flex h-7 w-12 items-center justify-center rounded-full ${
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
                className={`m3-spring flex h-8.5 w-full items-center gap-3 rounded-full px-3.5 text-xs font-semibold ${
                  isActive
                    ? 'm3-tonal-active'
                    : 'text-slate-300 hover:bg-[#1E2536] hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="my-2 w-full border-t border-white/[0.07]" />

        {!collapsed && groups.length > 8 && (
          <div className="relative mb-1.5 w-full px-1">
            <Search className="pointer-events-none absolute left-3.5 top-2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              placeholder={t.filterGroupsPlaceholder}
              className="h-7.5 w-full rounded-full bg-[#1E2536] pl-8 pr-3 text-[11px] text-white placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-[#7FD4FF]/60"
            />
          </div>
        )}

        <div className="luma-scroll w-full flex-1 overflow-y-auto space-y-0.5 pr-0.5">
          <button
            id="group-all"
            type="button"
            onClick={() => onSelectGroup('all')}
            title={collapsed ? t.allChannels : undefined}
            className={`m3-spring flex w-full items-center justify-between rounded-full ${
              collapsed ? 'h-8.5 justify-center' : 'h-8.5 px-3.5'
            } text-xs font-medium ${
              selectedGroupId === 'all' && isLiveSection
                ? 'bg-[#29354D] text-[#D6E3FF] font-semibold'
                : 'text-slate-300 hover:bg-[#1E2536]'
            }`}
          >
            <span className="flex items-center gap-2.5 truncate">
              <Layers className="h-4 w-4 shrink-0 text-[#7FD4FF]" />
              {!collapsed && <span className="truncate">{t.allChannels}</span>}
            </span>
            {!collapsed && (
              <span className="text-[11px] text-slate-400 luma-tabular">
                {totalChannelCount.toLocaleString(bcp47)}
              </span>
            )}
          </button>

          <button
            id="group-favorites"
            type="button"
            onClick={() => onSelectGroup('favorites')}
            title={collapsed ? t.favorites : undefined}
            className={`m3-spring flex w-full items-center justify-between rounded-full ${
              collapsed ? 'h-8.5 justify-center' : 'h-8.5 px-3.5'
            } text-xs font-medium ${
              selectedGroupId === 'favorites' && isLiveSection
                ? 'm3-tertiary-badge font-semibold'
                : 'text-slate-300 hover:bg-[#1E2536]'
            }`}
          >
            <span className="flex items-center gap-2.5 truncate">
              <Star className="h-4 w-4 shrink-0 text-[#FFB1C8]" />
              {!collapsed && <span className="truncate">{t.favorites}</span>}
            </span>
            {!collapsed && (
              <span className="text-[11px] text-slate-400 luma-tabular">{favoritesCount}</span>
            )}
          </button>

          {displayedGroups.map((grp) => {
            const Icon = GROUP_ICONS[grp.icon] ?? Tv;
            const isSelected = selectedGroupId === grp.id && isLiveSection;
            return (
              <button
                key={grp.id}
                id={`group-${grp.id}`}
                type="button"
                onClick={() => onSelectGroup(grp.id)}
                title={collapsed ? grp.name : undefined}
                className={`m3-spring flex w-full items-center justify-between rounded-full ${
                  collapsed ? 'h-8.5 justify-center' : 'h-8 px-3.5'
                } text-xs font-medium ${
                  isSelected
                    ? 'bg-[#29354D] text-[#D6E3FF] font-semibold'
                    : 'text-slate-400 hover:bg-[#1E2536] hover:text-slate-100'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  {!collapsed && <span className="truncate">{grp.name}</span>}
                </span>
                {!collapsed && (
                  <span className="ml-2 flex shrink-0 items-center gap-1 text-[11px] text-slate-400 luma-tabular">
                    {grp.isPinLocked && <Lock className="h-3 w-3 text-amber-300" />}
                    <span>{grp.count.toLocaleString(bcp47)}</span>
                  </span>
                )}
              </button>
            );
          })}

          {!collapsed && filteredGroups.length > displayedGroups.length && (
            <button
              type="button"
              onClick={() => onSelectSection('sources')}
              className="mt-1 w-full rounded-full py-1.5 text-center text-[11px] text-sky-300 hover:bg-white/[0.06]"
            >
              +{(filteredGroups.length - displayedGroups.length).toLocaleString()} more in Sources…
            </button>
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside
      id="luma-sidebar"
      className={`lg-pane relative z-20 m-2.5 mr-0 flex shrink-0 flex-col rounded-[22px] transition-all duration-300 ${
        collapsed ? 'w-[62px]' : 'w-60'
      }`}
    >
      <div className="p-2 space-y-0.5">
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
              className={`group flex w-full items-center gap-2.5 rounded-[13px] px-3 py-1.5 text-xs font-medium transition-all ${
                isActive
                  ? 'lg-pill-active'
                  : 'text-white/75 hover:bg-white/[0.08] hover:text-white'
              }`}
            >
              <Icon
                className={`h-4 w-4 shrink-0 ${
                  isActive ? 'text-sky-300' : 'text-white/60 group-hover:text-white'
                }`}
              />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </button>
          );
        })}
      </div>

      <div className="mx-3 my-1 border-t border-white/10" />

      {!collapsed && groups.length > 8 && (
        <div className="relative px-2.5 pb-1">
          <Search className="pointer-events-none absolute left-5 top-2 h-3.5 w-3.5 text-white/45" />
          <input
            type="text"
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            placeholder={t.filterGroupsPlaceholder}
            className="lg-capsule h-7.5 w-full rounded-full pl-8 pr-3 text-[11px] text-white placeholder:text-white/45 focus:outline-none"
          />
        </div>
      )}

      <div className="luma-scroll flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
        <button
          id="group-all"
          type="button"
          onClick={() => onSelectGroup('all')}
          title={collapsed ? t.allChannels : undefined}
          className={`flex w-full items-center justify-between rounded-[13px] px-3 py-1.5 text-xs font-medium transition ${
            selectedGroupId === 'all' && isLiveSection
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
              {totalChannelCount.toLocaleString(bcp47)}
            </span>
          )}
        </button>

        <button
          id="group-favorites"
          type="button"
          onClick={() => onSelectGroup('favorites')}
          title={collapsed ? t.favorites : undefined}
          className={`flex w-full items-center justify-between rounded-[13px] px-3 py-1.5 text-xs font-medium transition ${
            selectedGroupId === 'favorites' && isLiveSection
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

        {displayedGroups.map((grp) => {
          const Icon = GROUP_ICONS[grp.icon] ?? Tv;
          const isSelected = selectedGroupId === grp.id && isLiveSection;
          return (
            <button
              key={grp.id}
              id={`group-${grp.id}`}
              type="button"
              onClick={() => onSelectGroup(grp.id)}
              title={collapsed ? grp.name : undefined}
              className={`flex w-full items-center justify-between rounded-[13px] px-3 py-1.5 text-xs font-medium transition ${
                isSelected
                  ? 'lg-pill-active'
                  : 'text-white/65 hover:bg-white/[0.08] hover:text-white'
              }`}
            >
              <span className="flex items-center gap-2.5 truncate">
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {!collapsed && <span className="truncate">{grp.name}</span>}
              </span>
              {!collapsed && (
                <span className="ml-2 flex shrink-0 items-center gap-1 text-[11px] text-white/45 luma-tabular">
                  {grp.isPinLocked && <Lock className="h-3 w-3 text-amber-300" />}
                  <span>{grp.count.toLocaleString(bcp47)}</span>
                </span>
              )}
            </button>
          );
        })}

        {!collapsed && filteredGroups.length > displayedGroups.length && (
          <button
            type="button"
            onClick={() => onSelectSection('sources')}
            className="mt-1 w-full rounded-xl py-1.5 text-center text-[11px] text-sky-300 hover:bg-white/[0.06]"
          >
            +{(filteredGroups.length - displayedGroups.length).toLocaleString()} more in Sources…
          </button>
        )}
      </div>
    </aside>
  );
};
