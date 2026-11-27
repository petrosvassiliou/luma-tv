import React, { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { PlatformDesignMode } from '../../types/luma';

interface TvCollapsibleSearchProps {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  designMode: PlatformDesignMode;
  wrapperClassName?: string;
  inputClassName?: string;
  buttonLabel?: string;
}

interface TvKeyboardWindow {
  LumaAndroidWindow?: {
    showTvKeyboard?: () => void;
    hideTvKeyboard?: () => void;
  };
}

function isAndroidTvActiveDom(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.documentElement.dataset.tv === 'true'
  );
}

/**
 * Renders the standard inline search input on macOS, Googlebooks, and Android phones/tablets.
 * Exclusively on Android TV (`html[data-tv="true"]`), collapses the search box into a compact
 * `Search` shortcut pill button so search inputs never get focused by default or slow down D-Pad navigation.
 */
export const TvCollapsibleSearch: React.FC<TvCollapsibleSearchProps> = ({
  id,
  value,
  onChange,
  placeholder,
  designMode,
  wrapperClassName = 'relative w-64 sm:w-72',
  inputClassName,
  buttonLabel = 'Search',
}) => {
  const isM3 = designMode === 'm3-expressive';
  const isTv = isAndroidTvActiveDom();
  const [tvExpanded, setTvExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isTv) return;
    const onHotkeySearch = () => {
      setTvExpanded(true);
    };
    window.addEventListener('luma-tv-open-view-search', onHotkeySearch);
    return () => window.removeEventListener('luma-tv-open-view-search', onHotkeySearch);
  }, [isTv]);

  useEffect(() => {
    if (!isTv || !tvExpanded) return;
    const raf = window.requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.dataset.tvEditing = 'true';
      (window as unknown as TvKeyboardWindow).LumaAndroidWindow?.showTvKeyboard?.();
    });
    return () => window.cancelAnimationFrame(raf);
  }, [isTv, tvExpanded]);

  if (isTv && !tvExpanded && !value) {
    return (
      <button
        id={id ? `${id}-trigger` : undefined}
        data-tv-skip-initial="true"
        type="button"
        onClick={() => setTvExpanded(true)}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-semibold text-slate-100 ring-1 ring-white/15 hover:bg-white/20"
        title={`${placeholder} (▲▲)`}
      >
        <Search className="h-3.5 w-3.5 text-[#7FD4FF]" />
        <span>{buttonLabel}</span>
        <span className="text-[10px] text-[#7FD4FF]/85">▲▲</span>
      </button>
    );
  }

  const resolvedInputClass =
    inputClassName ??
    (isM3
      ? 'h-9 w-full rounded-full bg-[#232B3D] pl-9 pr-8 text-xs text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#7FD4FF]/60'
      : 'lg-capsule h-9 w-full rounded-full pl-9 pr-8 text-xs text-white placeholder:text-white/45 focus:outline-none');

  return (
    <div className={wrapperClassName}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          if (isTv && !value.trim()) {
            setTvExpanded(false);
          }
        }}
        placeholder={placeholder}
        className={resolvedInputClass}
      />
      {(value || (isTv && tvExpanded)) && (
        <button
          type="button"
          onClick={() => {
            onChange('');
            if (isTv) {
              setTvExpanded(false);
              (
                window as unknown as TvKeyboardWindow
              ).LumaAndroidWindow?.hideTvKeyboard?.();
            }
          }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-slate-400 hover:text-white"
          title="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
};
