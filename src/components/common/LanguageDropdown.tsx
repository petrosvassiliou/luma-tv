import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

interface MenuCoords {
  top: number;
  left: number;
  width: number;
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
  const [coords, setCoords] = useState<MenuCoords | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const activeMeta = LOCALE_META[locale];
  const t = TRANSLATIONS[locale];
  const isCompact = variant === 'compact';

  const updateMenuPosition = () => {
    const btn = triggerRef.current;
    if (!btn || typeof window === 'undefined') return;
    const rect = btn.getBoundingClientRect();
    const menuWidth = isCompact ? 216 : Math.max(rect.width, 240);
    const estimatedMenuHeight = SUPPORTED_LOCALES.length * 40 + 16;

    const rawLeft = isCompact ? rect.right - menuWidth : rect.left;
    const clampedLeft = Math.max(
      10,
      Math.min(rawLeft, window.innerWidth - menuWidth - 10)
    );

    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const top =
      spaceBelow < estimatedMenuHeight && rect.top > estimatedMenuHeight + 12
        ? Math.max(10, rect.top - estimatedMenuHeight - 8)
        : rect.bottom + 8;

    setCoords({
      top,
      left: clampedLeft,
      width: menuWidth,
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isCompact]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (
        target &&
        (containerRef.current?.contains(target) || menuRef.current?.contains(target))
      ) {
        return;
      }
      setOpen(false);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };

    const onReposition = () => updateMenuPosition();

    // Capture phase ensures clicking ANY other menu or control closes this dropdown immediately
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isCompact]);

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

  const portalTarget =
    (typeof document !== 'undefined' &&
      (containerRef.current?.closest('[data-design]') as HTMLElement | null)) ||
    (typeof document !== 'undefined' ? document.body : null);

  const listboxMenu =
    open && coords && portalTarget
      ? createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label={t.langAndDesignTitle}
            style={{
              position: 'fixed',
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              width: `${coords.width}px`,
              zIndex: 9999,
            }}
            className={`overflow-hidden p-1.5 shadow-[0_28px_70px_-8px_rgba(0,0,0,0.95)] ${
              isM3
                ? 'rounded-[22px] bg-[#181F2F] ring-1 ring-[#7FD4FF]/40'
                : 'lg-modal rounded-[20px] ring-1 ring-sky-300/35'
            }`}
          >
            <div className="space-y-1">
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
                          ? 'm3-tonal-active font-bold text-white'
                          : 'lg-pill-active font-bold text-white'
                        : 'text-slate-100 hover:bg-white/12'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="text-base leading-none" aria-hidden="true">
                        {LOCALE_FLAGS[loc]}
                      </span>
                      <span className="truncate">{meta.nativeName}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                          isSelected
                            ? 'bg-sky-300/25 text-white'
                            : 'bg-white/10 text-slate-300'
                        }`}
                      >
                        {meta.badge}
                      </span>
                      {isSelected && (
                        <Check className="h-3.5 w-3.5 shrink-0 text-sky-200" />
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>,
          portalTarget
        )
      : null;

  return (
    <div
      ref={containerRef}
      className={`relative ${isCompact ? 'inline-flex shrink-0' : 'w-full sm:w-80'}`}
    >
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-pressed={open}
        aria-label={t.langAndDesignTitle}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={handleTriggerKeyDown}
        title={`${activeMeta.nativeName} (${activeMeta.badge})`}
        className={
          isCompact
            ? isM3
              ? `m3-spring inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold ${
                  open
                    ? 'm3-tonal-active'
                    : 'bg-[#263148] text-white ring-1 ring-[#7FD4FF]/40 hover:bg-[#324160]'
                }`
              : `inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold text-white ${
                  open
                    ? 'lg-pill-active'
                    : 'lg-capsule ring-1 ring-sky-300/40 hover:ring-sky-300/70'
                }`
            : isM3
              ? `m3-spring flex h-11 w-full items-center justify-between gap-2.5 rounded-2xl px-4 text-xs font-semibold text-white ${
                  open
                    ? 'm3-tonal-active'
                    : 'bg-[#252E42] ring-1 ring-[#7FD4FF]/45 hover:bg-[#2F3B54]'
                }`
              : `flex h-11 w-full items-center justify-between gap-2.5 rounded-2xl px-4 text-xs font-semibold text-white ${
                  open
                    ? 'lg-pill-active'
                    : 'lg-capsule ring-1 ring-sky-300/45 hover:ring-sky-300/75'
                }`
        }
      >
        <span className="inline-flex min-w-0 items-center gap-2">
          {isCompact ? (
            <>
              <span className="text-sm leading-none" aria-hidden="true">
                {LOCALE_FLAGS[locale]}
              </span>
              <span className="font-mono font-bold tracking-tight text-sky-200">
                {activeMeta.badge}
              </span>
            </>
          ) : (
            <>
              <Globe className="h-4 w-4 shrink-0 text-sky-300" />
              <span className="text-base leading-none" aria-hidden="true">
                {LOCALE_FLAGS[locale]}
              </span>
              <span className="truncate text-white">{activeMeta.nativeName}</span>
              <span className="rounded-md bg-sky-400/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-sky-200 ring-1 ring-sky-300/35">
                {activeMeta.badge}
              </span>
            </>
          )}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-sky-200 transition-transform duration-150 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {listboxMenu}
    </div>
  );
};
