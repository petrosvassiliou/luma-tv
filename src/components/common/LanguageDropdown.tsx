import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Globe } from 'lucide-react';
import {
  LOCALE_META,
  SUPPORTED_LOCALES,
  TRANSLATIONS,
  type LumaLocale,
} from '../../i18n/translations';
import type { PlatformDesignMode } from '../../types/luma';

const LOCALE_FLAGS: Record<LumaLocale, string> = {
  de: '🇩🇪',
  en: '🇬🇧',
  it: '🇮🇹',
  fr: '🇫🇷',
  es: '🇪🇸',
  gr: '🇬🇷',
};

interface LanguageDropdownProps {
  designMode: PlatformDesignMode;
  locale: LumaLocale;
  onSelectLocale: (locale: LumaLocale) => void;
  variant?: 'compact' | 'full';
  id?: string;
}

export const LanguageDropdown: React.FC<LanguageDropdownProps> = ({
  designMode,
  locale,
  onSelectLocale,
  variant = 'full',
  id,
}) => {
  const isM3 = designMode === 'm3-expressive';
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const activeMeta = LOCALE_META[locale];
  const t = TRANSLATIONS[locale];

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      if (!open && e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => {
          const activeIdx = Math.max(0, SUPPORTED_LOCALES.indexOf(locale));
          optionRefs.current[activeIdx]?.focus();
        });
      }
    }
  };

  const handleOptionKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    idx: number
  ) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      const nextIdx = (idx + 1) % SUPPORTED_LOCALES.length;
      optionRefs.current[nextIdx]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const prevIdx =
        (idx - 1 + SUPPORTED_LOCALES.length) % SUPPORTED_LOCALES.length;
      optionRefs.current[prevIdx]?.focus();
    }
  };

  const isCompact = variant === 'compact';

  return (
    <div
      ref={containerRef}
      className={`relative ${isCompact ? 'hidden sm:inline-block' : 'w-full sm:w-72'}`}
    >
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t.langAndDesignTitle}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={handleTriggerKeyDown}
        title={`${activeMeta.nativeName} (${activeMeta.badge})`}
        className={
          isCompact
            ? isM3
              ? 'm3-secondary-tonal inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-bold'
              : 'lg-capsule inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold text-white hover:text-white'
            : isM3
              ? 'm3-spring flex h-10 w-full items-center justify-between gap-2.5 rounded-2xl bg-[#232B3D] px-3.5 text-xs font-semibold text-white ring-1 ring-white/10 hover:bg-[#2A344A]'
              : 'lg-capsule flex h-10 w-full items-center justify-between gap-2.5 rounded-2xl px-3.5 text-xs font-semibold text-white hover:text-white'
        }
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          {isCompact ? (
            <>
              <Globe className="h-3.5 w-3.5 shrink-0 text-sky-300" />
              <span>{activeMeta.badge}</span>
            </>
          ) : (
            <>
              <span className="text-sm leading-none" aria-hidden="true">
                {LOCALE_FLAGS[locale]}
              </span>
              <span className="truncate">{activeMeta.nativeName}</span>
              <span className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-sky-300">
                {activeMeta.badge}
              </span>
            </>
          )}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 opacity-75 transition-transform duration-150 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t.langAndDesignTitle}
          className={`absolute z-50 mt-2 overflow-hidden p-1.5 shadow-2xl ${
            isCompact ? 'top-full right-0 w-52' : 'top-full left-0 w-full min-w-56'
          } ${
            isM3
              ? 'rounded-[22px] bg-[#1E2536] ring-1 ring-white/15'
              : 'lg-modal rounded-[20px]'
          }`}
        >
          <div className="space-y-0.5">
            {SUPPORTED_LOCALES.map((loc, idx) => {
              const meta = LOCALE_META[loc];
              const isSelected = loc === locale;
              return (
                <button
                  key={loc}
                  ref={(el) => {
                    optionRefs.current[idx] = el;
                  }}
                  role="option"
                  aria-selected={isSelected}
                  type="button"
                  onKeyDown={(e) => handleOptionKeyDown(e, idx)}
                  onClick={() => {
                    onSelectLocale(loc);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2.5 rounded-xl px-3 py-2 text-left text-xs transition ${
                    isSelected
                      ? isM3
                        ? 'm3-tonal-active font-semibold'
                        : 'lg-pill-active font-semibold'
                      : 'text-slate-200 hover:bg-white/10'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="text-sm leading-none" aria-hidden="true">
                      {LOCALE_FLAGS[loc]}
                    </span>
                    <span className="truncate">{meta.nativeName}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold opacity-80">
                      {meta.badge}
                    </span>
                    {isSelected && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-sky-300" />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
