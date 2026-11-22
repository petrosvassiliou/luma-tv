import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CornerDownLeft,
  Film,
  Grid2x2,
  Layers,
  Radio,
  Search,
  Sparkles,
  Tv,
  Zap,
} from 'lucide-react';
import { getCurrentAndNextProgram } from '../../data/mockCatalog';
import type { Channel, PlatformDesignMode, VodItem } from '../../types/luma';

interface CommandBarProps {
  designMode: PlatformDesignMode;
  onClose: () => void;
  channels: Channel[];
  vodCatalog: VodItem[];
  nowMs: number;
  onSelectChannel: (channel: Channel) => void;
  onSelectVod: (vod: VodItem) => void;
  onTriggerAction: (action: 'multiview' | 'ambilight' | 'stress20k' | 'toggleDesign') => void;
}

interface SearchHit {
  id: string;
  kind: 'channel' | 'epg' | 'vod' | 'action';
  title: string;
  subtitle: string;
  badge: string;
  onExecute: () => void;
}

export const CommandBar: React.FC<CommandBarProps> = ({
  designMode,
  onClose,
  channels,
  vodCatalog,
  nowMs,
  onSelectChannel,
  onSelectVod,
  onTriggerAction,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    const results: SearchHit[] = [];

    for (let i = 0; i < channels.length && results.length < 10; i++) {
      const ch = channels[i];
      if (
        !q ||
        ch.name.toLowerCase().includes(q) ||
        ch.shortCode.toLowerCase().includes(q) ||
        String(ch.number) === q ||
        ch.groupName.toLowerCase().includes(q)
      ) {
        const { current } = getCurrentAndNextProgram(ch, nowMs);
        results.push({
          id: `ch-${ch.id}`,
          kind: 'channel',
          title: `#${ch.number} · ${ch.name}`,
          subtitle: `Jetzt: ${current.title} (${ch.groupName})`,
          badge: ch.resolution,
          onExecute: () => {
            onSelectChannel(ch);
            onClose();
          },
        });
      }
    }

    if (q.length >= 2) {
      for (let i = 0; i < Math.min(channels.length, 60) && results.length < 16; i++) {
        const ch = channels[i];
        const { current } = getCurrentAndNextProgram(ch, nowMs);
        if (
          current.title.toLowerCase().includes(q) ||
          current.subtitle.toLowerCase().includes(q)
        ) {
          results.push({
            id: `epg-${ch.id}`,
            kind: 'epg',
            title: current.title,
            subtitle: `Läuft live auf ${ch.name} · ${current.subtitle}`,
            badge: 'EPG LIVE',
            onExecute: () => {
              onSelectChannel(ch);
              onClose();
            },
          });
        }
      }
    }

    for (const vod of vodCatalog) {
      if (!q || vod.title.toLowerCase().includes(q) || vod.genre.toLowerCase().includes(q)) {
        results.push({
          id: `vod-${vod.id}`,
          kind: 'vod',
          title: vod.title,
          subtitle: `${vod.genre} · ${vod.year} · ${vod.durationMin} Min.`,
          badge: `VOD ${vod.resolution}`,
          onExecute: () => {
            onSelectVod(vod);
            onClose();
          },
        });
      }
    }

    const actions: SearchHit[] = [
      {
        id: 'act-design',
        kind: 'action',
        title: isM3
          ? 'Zu macOS · Liquid Glass Design wechseln'
          : 'Zu GoogleOS / Android · Material 3 Expressive wechseln',
        subtitle: 'Wechselt das gesamte Plattform-Design-System in Echtzeit',
        badge: 'DESIGN',
        onExecute: () => {
          onTriggerAction('toggleDesign');
          onClose();
        },
      },
      {
        id: 'act-multiview',
        kind: 'action',
        title: 'Luma Multiview (4x Sport-Modus) umschalten',
        subtitle: '4 Live-Streams gleichzeitig im Bento-Grid anzeigen',
        badge: 'AKTION',
        onExecute: () => {
          onTriggerAction('multiview');
          onClose();
        },
      },
      {
        id: 'act-stress20k',
        kind: 'action',
        title: '20.400 Kanäle EPG-Benchmark umschalten',
        subtitle: 'Testet die 2D-Virtualisierung unter Volllast',
        badge: 'ENGINE',
        onExecute: () => {
          onTriggerAction('stress20k');
          onClose();
        },
      },
    ];

    for (const act of actions) {
      if (!q || act.title.toLowerCase().includes(q) || act.subtitle.toLowerCase().includes(q)) {
        results.push(act);
      }
    }

    return results.slice(0, 14);
  }, [query, channels, vodCatalog, nowMs, isM3, onSelectChannel, onSelectVod, onTriggerAction, onClose]);

  const safeSelected = hits.length > 0 ? Math.min(selectedIndex, hits.length - 1) : 0;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (hits.length ? (prev + 1) % hits.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (hits.length ? (prev - 1 + hits.length) % hits.length : 0));
    } else if (e.key === 'Enter' && hits[safeSelected]) {
      e.preventDefault();
      hits[safeSelected].onExecute();
    }
  };

  const renderIcon = (kind: SearchHit['kind']) => {
    switch (kind) {
      case 'channel':
        return <Tv className="h-4 w-4 text-sky-300" />;
      case 'epg':
        return <Radio className="h-4 w-4 text-emerald-300" />;
      case 'vod':
        return <Film className="h-4 w-4 text-indigo-300" />;
      case 'action':
        return <Sparkles className="h-4 w-4 text-amber-300" />;
    }
  };

  return (
    <div
      id="luma-command-backdrop"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[10vh] backdrop-blur-md"
    >
      <div
        id="luma-command-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        className={`w-full max-w-2xl overflow-hidden ${
          isM3
            ? 'rounded-[28px] bg-[#1E2536] shadow-2xl ring-1 ring-white/10'
            : 'lg-modal rounded-[26px]'
        }`}
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
          <Search className="h-4 w-4 shrink-0 text-sky-300" />
          <input
            ref={inputRef}
            id="input-command-bar"
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Suche in 20.000+ Kanälen, EPG-Sendungen, Filmen oder Aktionen…"
            className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-400 focus:outline-none"
          />
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-300 luma-tabular">
            <Zap className="h-3 w-3" />
            &lt; 2 ms
          </span>
          <kbd className="rounded-full bg-black/35 px-2.5 py-0.5 font-mono text-[10px] text-slate-300">
            ESC
          </kbd>
        </div>

        <div className="luma-scroll max-h-[54vh] overflow-y-auto p-2.5 space-y-1">
          {hits.length === 0 ? (
            <div className="py-10 text-center text-xs text-slate-400">
              Keine Treffer für „{query}“ gefunden.
            </div>
          ) : (
            hits.map((hit, idx) => {
              const active = idx === safeSelected;
              return (
                <button
                  key={hit.id}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={hit.onExecute}
                  className={`flex w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left transition ${
                    isM3 ? 'rounded-full' : 'rounded-[16px]'
                  } ${
                    active
                      ? isM3
                        ? 'm3-tonal-active'
                        : 'lg-pill-active'
                      : 'text-slate-200 hover:bg-white/[0.06]'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center ${
                        isM3 ? 'rounded-full bg-[#131722]' : 'rounded-xl bg-white/10'
                      }`}
                    >
                      {renderIcon(hit.kind)}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-white">{hit.title}</div>
                      <div className="truncate text-[11px] opacity-75">{hit.subtitle}</div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-medium luma-tabular">
                      {hit.badge}
                    </span>
                    {active && <CornerDownLeft className="h-3.5 w-3.5" />}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-white/10 bg-black/25 px-5 py-2.5 text-[11px] text-slate-300/80">
          <div className="flex items-center gap-3">
            <span>↑↓ Navigieren</span>
            <span>↵ Umschalten</span>
          </div>
          <span className="hidden sm:inline-flex items-center gap-1.5 opacity-75">
            <Grid2x2 className="h-3 w-3" />
            <Layers className="h-3 w-3" />
            {isM3 ? 'Material 3 Search Sheet' : 'macOS Liquid Glass Spotlight'}
          </span>
        </div>
      </div>
    </div>
  );
};
