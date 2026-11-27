import { useEffect } from 'react';

export type SpatialDirection = 'up' | 'down' | 'left' | 'right';

export interface RectCandidate {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Pure geometric 10-foot spatial focus scorer used for TV remotes, Gamepads,
 * and keyboard arrow navigation across macOS, Android TV, and ChromeOS.
 */
export function pickBestSpatialCandidate(
  origin: RectCandidate,
  candidates: RectCandidate[],
  direction: SpatialDirection
): string | null {
  const ox = origin.x + origin.width / 2;
  const oy = origin.y + origin.height / 2;

  let bestId: string | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const c of candidates) {
    if (c.id === origin.id || c.width === 0 || c.height === 0) continue;
    const cx = c.x + c.width / 2;
    const cy = c.y + c.height / 2;
    const dx = cx - ox;
    const dy = cy - oy;

    let primary = 0;
    let orthogonal = 0;

    if (direction === 'right') {
      if (dx <= 6) continue;
      primary = dx;
      orthogonal = Math.abs(dy);
    } else if (direction === 'left') {
      if (dx >= -6) continue;
      primary = -dx;
      orthogonal = Math.abs(dy);
    } else if (direction === 'down') {
      if (dy <= 6) continue;
      primary = dy;
      orthogonal = Math.abs(dx);
    } else {
      if (dy >= -6) continue;
      primary = -dy;
      orthogonal = Math.abs(dx);
    }

    // Weight orthogonal misalignment higher so focus stays in the expected row/column
    const score = primary + orthogonal * 2.6;
    if (score < bestScore) {
      bestScore = score;
      bestId = c.id;
    }
  }

  return bestId;
}

export interface SpatialDpadOptions {
  tvMode?: boolean;
  activeSection?: string;
}

type TvRegion = 'titlebar' | 'sidebar' | 'drawer' | 'main';

interface TvCandidateMeta {
  el: HTMLElement;
  id: string;
  region: TvRegion;
  form: HTMLFormElement | null;
  rect: RectCandidate;
}

interface AndroidTvKeyboardBridge {
  LumaAndroidWindow?: {
    showTvKeyboard?: () => void;
    hideTvKeyboard?: () => void;
  };
}

const TV_FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"]):not([type="file"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[role="option"]',
  '[role="menuitem"]',
  '[role="button"]',
  '[data-spatial="true"]',
  'main .cursor-pointer',
  'aside .cursor-pointer',
].join(', ');

const TV_MODAL_SELECTORS = [
  '#luma-command-modal',
  '[data-tv-modal="true"]',
  '#luma-cast-popover',
  '#luma-dsp-popover',
  '[role="listbox"]',
  '[role="dialog"]',
];

export function isTvTextEditableInput(
  el: Element | null
): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return !(el as HTMLTextAreaElement).disabled;
  if (el.tagName !== 'INPUT') return false;
  const input = el as HTMLInputElement;
  if (input.disabled) return false;
  const type = (input.type || 'text').toLowerCase();
  return ![
    'checkbox',
    'radio',
    'range',
    'button',
    'submit',
    'reset',
    'file',
    'hidden',
  ].includes(type);
}

function getTvRegion(el: HTMLElement): TvRegion {
  if (el.closest('#luma-custom-titlebar')) return 'titlebar';
  if (el.closest('#luma-sidebar')) return 'sidebar';
  if (el.closest('#luma-live-channel-drawer')) return 'drawer';
  return 'main';
}

function isTvCandidateRendered(el: HTMLElement, hasRealLayout: boolean): boolean {
  if (el.closest('[hidden], [aria-hidden="true"]')) return false;
  if (el.classList.contains('opacity-0') || el.closest('.pointer-events-none.opacity-0')) {
    return false;
  }
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (!hasRealLayout) return true;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;

  // Exclude items clipped far outside an ancestor scroll container so focus scrolls progressively
  const scroller = el.closest<HTMLElement>('.overflow-y-auto, .luma-scroll');
  if (scroller && scroller !== el) {
    const sr = scroller.getBoundingClientRect();
    if (sr.height > 0) {
      if (r.bottom < sr.top - 48 || r.top > sr.bottom + 320) {
        return false;
      }
    }
  }
  return true;
}

function getActiveTvOverlayRoot(hasRealLayout: boolean): HTMLElement | null {
  let chosen: HTMLElement | null = null;
  for (const sel of TV_MODAL_SELECTORS) {
    const matches = document.querySelectorAll<HTMLElement>(sel);
    for (const m of matches) {
      if (isTvCandidateRendered(m, hasRealLayout)) {
        chosen = m;
      }
    }
  }
  return chosen;
}

function ensureTvTabbable(el: HTMLElement): void {
  const tag = el.tagName;
  if (tag !== 'BUTTON' && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA' && tag !== 'A') {
    if (el.tabIndex < 0 && !el.hasAttribute('tabindex')) {
      el.tabIndex = 0;
    }
  }
}

function findScrollableAncestor(el: HTMLElement | null): HTMLElement | null {
  let cur: HTMLElement | null = el;
  while (cur && cur !== document.body) {
    const style = window.getComputedStyle(cur);
    const overflowY = style.overflowY;
    if (
      (overflowY === 'auto' || overflowY === 'scroll' || cur.classList.contains('luma-scroll')) &&
      cur.scrollHeight > cur.clientHeight + 8
    ) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return null;
}

function pickBestTvCandidate(
  origin: TvCandidateMeta,
  candidates: TvCandidateMeta[],
  direction: SpatialDirection,
  allowUpToTitlebar: boolean
): TvCandidateMeta | null {
  const ox = origin.rect.x + origin.rect.width / 2;
  const oy = origin.rect.y + origin.rect.height / 2;

  let best: TvCandidateMeta | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const c of candidates) {
    if (c.el === origin.el || c.rect.width === 0 || c.rect.height === 0) continue;

    // Strict vertical region containment so scrolling Settings/Catalog never jumps into Sidebar
    if (direction === 'down') {
      if (origin.region !== 'titlebar' && c.region !== origin.region) continue;
    } else if (direction === 'up') {
      if (c.region !== origin.region) {
        if (!(allowUpToTitlebar && c.region === 'titlebar')) continue;
      }
    }

    const cx = c.rect.x + c.rect.width / 2;
    const cy = c.rect.y + c.rect.height / 2;
    const dx = cx - ox;
    const dy = cy - oy;

    const overlapX = Math.max(
      0,
      Math.min(origin.rect.x + origin.rect.width, c.rect.x + c.rect.width) -
        Math.max(origin.rect.x, c.rect.x)
    );
    const gapX =
      overlapX > 0
        ? 0
        : Math.min(
            Math.abs(origin.rect.x - (c.rect.x + c.rect.width)),
            Math.abs(c.rect.x - (origin.rect.x + origin.rect.width))
          );

    const overlapY = Math.max(
      0,
      Math.min(origin.rect.y + origin.rect.height, c.rect.y + c.rect.height) -
        Math.max(origin.rect.y, c.rect.y)
    );
    const gapY =
      overlapY > 0
        ? 0
        : Math.min(
            Math.abs(origin.rect.y - (c.rect.y + c.rect.height)),
            Math.abs(c.rect.y - (origin.rect.y + origin.rect.height))
          );

    let score = 0;
    if (direction === 'right') {
      if (dx <= 6) continue;
      score = dx + gapY * 2.4 + Math.abs(dy) * 0.35;
      if (c.region !== origin.region) score += 120;
    } else if (direction === 'left') {
      if (dx >= -6) continue;
      score = -dx + gapY * 2.4 + Math.abs(dy) * 0.35;
      if (c.region !== origin.region) score += 120;
    } else if (direction === 'down') {
      if (dy <= 6) continue;
      score = dy + gapX * 1.15 + Math.abs(dx) * 0.25;
      if (origin.form && origin.form === c.form) score -= 140;
    } else {
      if (dy >= -6) continue;
      score = -dy + gapX * 1.15 + Math.abs(dx) * 0.25;
      if (origin.form && origin.form === c.form) score -= 140;
      if (c.region !== origin.region) score += 260;
    }

    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }

  return best;
}

export function useSpatialDpadFocus(
  enabled: boolean,
  modalBlocked: boolean,
  options?: SpatialDpadOptions
): void {
  const tvMode = Boolean(options?.tvMode);
  const activeSection = options?.activeSection;

  useEffect(() => {
    if (!enabled) return;

    // Non-TV platforms (macOS, ChromeOS / Googlebook, Android touch) preserve exact original behavior
    if (!tvMode) {
      const onKeyDown = (e: KeyboardEvent) => {
        if (modalBlocked || e.metaKey || e.ctrlKey || e.altKey) return;
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

        const dirMap: Record<string, SpatialDirection> = {
          ArrowUp: 'up',
          ArrowDown: 'down',
          ArrowLeft: 'left',
          ArrowRight: 'right',
        };
        const dir = dirMap[e.key];
        if (!dir) return;

        const focusables = Array.from(
          document.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [data-spatial="true"], a[href]'
          )
        ).filter((el) => el.offsetParent !== null);

        if (focusables.length === 0) return;

        const active = document.activeElement as HTMLElement | null;
        if (!active || active === document.body || !focusables.includes(active)) {
          // Only engage spatial focus ring on Shift+Arrow or when a button already has focus
          if (!e.shiftKey) return;
          e.preventDefault();
          focusables[0].focus();
          return;
        }

        const rectMap = new Map<string, HTMLElement>();
        const rects: RectCandidate[] = focusables.map((el, idx) => {
          const key = el.id || `sp-${idx}`;
          rectMap.set(key, el);
          const r = el.getBoundingClientRect();
          return { id: key, x: r.left, y: r.top, width: r.width, height: r.height };
        });

        const activeIdx = focusables.indexOf(active);
        const originRect = rects[activeIdx];
        if (!originRect) return;

        const winnerKey = pickBestSpatialCandidate(originRect, rects, dir);
        if (winnerKey) {
          const target = rectMap.get(winnerKey);
          if (target) {
            e.preventDefault();
            target.focus();
            target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
          }
        }
      };

      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }

    // =========================================================================
    // ANDROID TV 10-FOOT REMOTE SPATIAL ENGINE (Strictly isolated to tvMode)
    // =========================================================================
    const collectTvCandidates = (): {
      items: TvCandidateMeta[];
      hasRealLayout: boolean;
      overlayRoot: HTMLElement | null;
    } => {
      const sampleBtn = document.querySelector<HTMLElement>('button');
      const hasRealLayout = Boolean(
        sampleBtn && sampleBtn.getBoundingClientRect().width > 0
      );
      const overlayRoot = getActiveTvOverlayRoot(hasRealLayout);
      const queryRoot: ParentNode = overlayRoot ?? document;
      const raw = Array.from(queryRoot.querySelectorAll<HTMLElement>(TV_FOCUSABLE_SELECTOR));
      const items: TvCandidateMeta[] = [];

      for (let i = 0; i < raw.length; i++) {
        const el = raw[i];
        if (!isTvCandidateRendered(el, hasRealLayout)) continue;
        ensureTvTabbable(el);
        const r = el.getBoundingClientRect();
        items.push({
          el,
          id: el.id || `tv-sp-${i}`,
          region: overlayRoot ? 'main' : getTvRegion(el),
          form: el.closest('form'),
          rect: {
            id: el.id || `tv-sp-${i}`,
            x: r.left,
            y: r.top,
            width: r.width,
            height: r.height,
          },
        });
      }
      return { items, hasRealLayout, overlayRoot };
    };

    const focusTvElement = (target: HTMLElement) => {
      if (isTvTextEditableInput(target)) {
        delete target.dataset.tvEditing;
      }
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    };

    const ensureInitialTvFocus = () => {
      if (document.documentElement.dataset.tvLiveBare === 'true') {
        const { overlayRoot, items } = collectTvCandidates();
        if (overlayRoot && items.length > 0) {
          focusTvElement(items[0].el);
        }
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      const { items, overlayRoot } = collectTvCandidates();
      if (items.length === 0) return;

      if (overlayRoot) {
        if (!active || !overlayRoot.contains(active)) {
          focusTvElement(items[0].el);
        }
        return;
      }

      if (!active || active === document.body || !document.body.contains(active)) {
        const preferred =
          items.find((c) => c.region === 'main') ??
          items.find((c) => c.region === 'sidebar') ??
          items[0];
        if (preferred) {
          focusTvElement(preferred.el);
        }
      }
    };

    const rafFocus = window.requestAnimationFrame(ensureInitialTvFocus);

    const onTvFocusOut = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      if (isTvTextEditableInput(target) && target.dataset.tvEditing === 'true') {
        delete target.dataset.tvEditing;
      }
    };

    const moveTvFocus = (dir: SpatialDirection, currentActive: HTMLElement | null): boolean => {
      const { items, hasRealLayout } = collectTvCandidates();
      if (items.length === 0) return false;

      const activeIdx = currentActive
        ? items.findIndex((c) => c.el === currentActive || c.el.contains(currentActive))
        : -1;

      if (activeIdx === -1) {
        const firstMain =
          items.find((c) => c.region === 'main') ??
          items.find((c) => c.region === 'sidebar') ??
          items[0];
        focusTvElement(firstMain.el);
        return true;
      }

      const origin = items[activeIdx];
      const scroller = findScrollableAncestor(origin.el);

      if (!hasRealLayout) {
        // Deterministic DOM-order fallback for zero-layout test environments (JSDOM)
        if (dir === 'down' || dir === 'right') {
          for (let i = activeIdx + 1; i < items.length; i++) {
            if (dir === 'down' && origin.region !== 'titlebar' && items[i].region !== origin.region) {
              continue;
            }
            focusTvElement(items[i].el);
            return true;
          }
        } else {
          for (let i = activeIdx - 1; i >= 0; i--) {
            if (
              dir === 'up' &&
              items[i].region !== origin.region &&
              items[i].region !== 'titlebar'
            ) {
              continue;
            }
            focusTvElement(items[i].el);
            return true;
          }
        }
        return false;
      }

      const allowUpToTitlebar = !scroller || scroller.scrollTop <= 8;
      let winner = pickBestTvCandidate(origin, items, dir, allowUpToTitlebar);

      if (!winner && dir === 'up' && !allowUpToTitlebar && scroller) {
        scroller.scrollBy({ top: -260, behavior: 'smooth' });
        return true;
      }

      if (!winner && dir === 'down' && scroller) {
        const canScrollMore =
          scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 6;
        if (canScrollMore) {
          scroller.scrollBy({ top: 260, behavior: 'smooth' });
          return true;
        }
      }

      // If pressing Right inside floating TV Sidebar or Left inside floating TV Channel Drawer has no neighbor, dismiss overlay
      if (!winner && dir === 'right' && origin.el.closest('#luma-sidebar[data-tv-modal="true"]')) {
        window.dispatchEvent(new CustomEvent('luma-tv-close-overlays'));
        return true;
      }
      if (
        !winner &&
        dir === 'left' &&
        origin.el.closest('#luma-live-channel-drawer[data-tv-modal="true"]')
      ) {
        window.dispatchEvent(new CustomEvent('luma-tv-close-overlays'));
        return true;
      }

      // If pressing Right from Sidebar has no horizontal match at exact Y, jump to first Main item
      if (!winner && dir === 'right' && origin.region === 'sidebar') {
        winner =
          items.find((c) => c.region === 'main') ??
          items.find((c) => c.region === 'drawer') ??
          null;
      }
      // If pressing Left from Main has no horizontal match to the left, jump to Sidebar or summon TV Menu on demand
      if (!winner && dir === 'left' && origin.region === 'main') {
        const activeNav = document.querySelector<HTMLElement>(
          `#luma-sidebar #nav-${activeSection ?? 'live'}`
        );
        winner =
          (activeNav ? items.find((c) => c.el === activeNav) : undefined) ??
          items.find((c) => c.region === 'sidebar') ??
          null;
        if (!winner && !getActiveTvOverlayRoot(hasRealLayout)) {
          window.dispatchEvent(new CustomEvent('luma-tv-open-nav'));
          return true;
        }
      }

      if (winner) {
        focusTvElement(winner.el);
        return true;
      }
      return false;
    };

    const onTvKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const bridge = (window as unknown as AndroidTvKeyboardBridge).LumaAndroidWindow;
      const active = document.activeElement as HTMLElement | null;
      const isOkKey =
        e.key === 'Enter' || e.key === 'Select' || e.keyCode === 23;

      const dirMap: Record<string, SpatialDirection> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
      };
      const dir = dirMap[e.key];

      // When watching bare full-screen Live TV with no overlays open, let App's TV Live controller
      // handle Up/Down channel zapping, OK/Right channel drawer, and Left navigation menu directly.
      if (document.documentElement.dataset.tvLiveBare === 'true') {
        const { overlayRoot } = collectTvCandidates();
        if (!overlayRoot) {
          return;
        }
      }

      // Wake Live TV player HUD on any remote D-Pad / OK interaction
      if (dir || isOkKey) {
        window.dispatchEvent(new CustomEvent('luma-tv-wake-hud'));
      }

      // Two-Phase TV Text Input Handling:
      // Phase 1 (focused, not editing): D-Pad moves freely across inputs; OK enters editing + opens TV IME.
      // Phase 2 (editing): Left/Right move cursor; Up/Down/OK exit editing, hide TV IME, and advance focus.
      if (isTvTextEditableInput(active)) {
        const isEditing = active.dataset.tvEditing === 'true';
        if (!isEditing) {
          if (isOkKey) {
            e.preventDefault();
            e.stopPropagation();
            active.dataset.tvEditing = 'true';
            try {
              const len = active.value.length;
              active.setSelectionRange(len, len);
            } catch {
              // Ignore on input types like email that disallow setSelectionRange
            }
            bridge?.showTvKeyboard?.();
            return;
          }
          if (dir) {
            e.preventDefault();
            e.stopPropagation();
            moveTvFocus(dir, active);
            return;
          }
        } else {
          if (dir === 'up' || dir === 'down') {
            e.preventDefault();
            e.stopPropagation();
            delete active.dataset.tvEditing;
            bridge?.hideTvKeyboard?.();
            moveTvFocus(dir, active);
            return;
          }
          if (isOkKey) {
            e.preventDefault();
            e.stopPropagation();
            delete active.dataset.tvEditing;
            bridge?.hideTvKeyboard?.();
            if (!moveTvFocus('down', active)) {
              moveTvFocus('right', active);
            }
            return;
          }
          // Allow Left, Right, Backspace, and typing characters normally while editing
          return;
        }
      }

      // Range sliders: allow Left/Right to scrub value while Up/Down navigate away
      if (
        active?.tagName === 'INPUT' &&
        (active as HTMLInputElement).type === 'range' &&
        (dir === 'left' || dir === 'right')
      ) {
        return;
      }

      // Native <select>: allow Enter/Space to open, Up/Down/Left/Right navigate between controls
      if (isOkKey && active && active !== document.body) {
        const tag = active.tagName;
        if (tag === 'INPUT' && (active as HTMLInputElement).type === 'checkbox') {
          e.preventDefault();
          active.click();
          return;
        }
        if (tag !== 'BUTTON' && tag !== 'A' && tag !== 'SELECT' && tag !== 'INPUT') {
          e.preventDefault();
          active.click();
          return;
        }
      }

      if (!dir) return;

      if (moveTvFocus(dir, active)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener('keydown', onTvKeyDown, true);
    window.addEventListener('focusout', onTvFocusOut, true);
    return () => {
      window.cancelAnimationFrame(rafFocus);
      window.removeEventListener('keydown', onTvKeyDown, true);
      window.removeEventListener('focusout', onTvFocusOut, true);
    };
  }, [enabled, modalBlocked, tvMode, activeSection]);
}
