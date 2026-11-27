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

function isTvCandidateRendered(
  el: HTMLElement,
  rect: DOMRect,
  hasRealLayout: boolean
): boolean {
  if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') {
    return false;
  }
  if (el.classList.contains('opacity-0')) {
    return false;
  }
  if (!hasRealLayout) {
    if (el.closest('[hidden], [aria-hidden="true"], .pointer-events-none.opacity-0')) {
      return false;
    }
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (el.closest('.pointer-events-none.opacity-0')) return false;
  return true;
}

function getActiveTvOverlayRoot(hasRealLayout: boolean): HTMLElement | null {
  let chosen: HTMLElement | null = null;
  for (const sel of TV_MODAL_SELECTORS) {
    const matches = document.querySelectorAll<HTMLElement>(sel);
    for (const m of matches) {
      const r = m.getBoundingClientRect();
      if (isTvCandidateRendered(m, r, hasRealLayout)) {
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

interface TvLogicalRow {
  top: number;
  bottom: number;
  centerY: number;
  items: TvCandidateMeta[];
}

/**
 * Groups visible UI elements into ordered horizontal visual rows (Top -> Bottom)
 * and sorts items within each row strictly Left -> Right so D-Pad navigation
 * always follows predictable, sequential reading order without random diagonal jumps.
 */
export function buildLogicalTvRows(candidates: TvCandidateMeta[]): TvLogicalRow[] {
  const sorted = [...candidates].sort(
    (a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x
  );
  const rows: TvLogicalRow[] = [];

  for (const cand of sorted) {
    const top = cand.rect.y;
    const bottom = cand.rect.y + cand.rect.height;
    const centerY = top + cand.rect.height / 2;

    let matchedRow: TvLogicalRow | null = null;
    for (let i = rows.length - 1; i >= Math.max(0, rows.length - 3); i--) {
      const r = rows[i];
      const overlap = Math.max(0, Math.min(r.bottom, bottom) - Math.max(r.top, top));
      const minHeight = Math.max(1, Math.min(r.bottom - r.top, cand.rect.height));
      if (overlap >= minHeight * 0.38 || Math.abs(centerY - r.centerY) <= 14) {
        matchedRow = r;
        break;
      }
    }

    if (matchedRow) {
      matchedRow.items.push(cand);
      matchedRow.top = Math.min(matchedRow.top, top);
      matchedRow.bottom = Math.max(matchedRow.bottom, bottom);
      matchedRow.centerY =
        matchedRow.items.reduce((acc, it) => acc + it.rect.y + it.rect.height / 2, 0) /
        matchedRow.items.length;
    } else {
      rows.push({
        top,
        bottom,
        centerY,
        items: [cand],
      });
    }
  }

  rows.sort((a, b) => a.centerY - b.centerY);
  for (const r of rows) {
    r.items.sort((a, b) => a.rect.x - b.rect.x);
  }
  return rows;
}

function pickHorizontallyAlignedInRow(
  origin: TvCandidateMeta,
  row: TvLogicalRow
): TvCandidateMeta {
  const ox = origin.rect.x + origin.rect.width / 2;
  let best = row.items[0];
  let bestScore = Number.POSITIVE_INFINITY;

  for (const cand of row.items) {
    const overlapX = Math.max(
      0,
      Math.min(origin.rect.x + origin.rect.width, cand.rect.x + cand.rect.width) -
        Math.max(origin.rect.x, cand.rect.x)
    );
    const cx = cand.rect.x + cand.rect.width / 2;
    const centerDist = Math.abs(cx - ox);
    // Prefer items whose horizontal span overlaps origin, then nearest center X
    const score = overlapX > 0 ? centerDist * 0.25 - overlapX : 200 + centerDist;
    if (score < bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  return best;
}

function pickBestTvCandidate(
  origin: TvCandidateMeta,
  candidates: TvCandidateMeta[],
  direction: SpatialDirection,
  allowUpToTitlebar: boolean,
  cachedRows?: TvLogicalRow[]
): TvCandidateMeta | null {
  const sameRegion = candidates.filter((c) => {
    if (c.rect.width === 0 || c.rect.height === 0) return false;
    if (direction === 'down') {
      return origin.region === 'titlebar' || c.region === origin.region;
    }
    if (direction === 'up') {
      return c.region === origin.region || (allowUpToTitlebar && c.region === 'titlebar');
    }
    return c.region === origin.region;
  });

  const rows =
    cachedRows && sameRegion.length === candidates.length
      ? cachedRows
      : buildLogicalTvRows(sameRegion);

  let rowIdx = -1;
  let colIdx = -1;
  for (let r = 0; r < rows.length; r++) {
    const idx = rows[r].items.findIndex((it) => it.el === origin.el);
    if (idx >= 0) {
      rowIdx = r;
      colIdx = idx;
      break;
    }
  }

  if (rowIdx < 0) return null;

  if (direction === 'right') {
    const curRow = rows[rowIdx];
    return colIdx + 1 < curRow.items.length ? curRow.items[colIdx + 1] : null;
  }

  if (direction === 'left') {
    const curRow = rows[rowIdx];
    return colIdx - 1 >= 0 ? curRow.items[colIdx - 1] : null;
  }

  if (direction === 'down') {
    const nextRow = rows[rowIdx + 1];
    return nextRow ? pickHorizontallyAlignedInRow(origin, nextRow) : null;
  }

  const prevRow = rows[rowIdx - 1];
  return prevRow ? pickHorizontallyAlignedInRow(origin, prevRow) : null;
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
    let cachedSnapshot: {
      atMs: number;
      items: TvCandidateMeta[];
      rows: TvLogicalRow[];
      hasRealLayout: boolean;
      overlayRoot: HTMLElement | null;
    } | null = null;

    const invalidateTvCache = () => {
      cachedSnapshot = null;
    };

    const collectTvCandidates = (
      allowCache = false
    ): {
      items: TvCandidateMeta[];
      rows: TvLogicalRow[];
      hasRealLayout: boolean;
      overlayRoot: HTMLElement | null;
    } => {
      const now = performance.now();
      if (
        allowCache &&
        cachedSnapshot &&
        now - cachedSnapshot.atMs < 180 &&
        (!cachedSnapshot.overlayRoot || document.body.contains(cachedSnapshot.overlayRoot))
      ) {
        return cachedSnapshot;
      }

      const sampleBtn = document.querySelector<HTMLElement>('button');
      const hasRealLayout = Boolean(
        sampleBtn && sampleBtn.getBoundingClientRect().width > 0
      );
      const overlayRoot = getActiveTvOverlayRoot(hasRealLayout);
      const mainEl = document.querySelector<HTMLElement>('main');
      const queryRoot: ParentNode = overlayRoot ?? mainEl ?? document;
      const raw = queryRoot.querySelectorAll<HTMLElement>(TV_FOCUSABLE_SELECTOR);
      const items: TvCandidateMeta[] = [];

      for (let i = 0; i < raw.length; i++) {
        const el = raw[i];
        // Skip nested action micro-buttons inside a focusable catalog card so 1 press = 1 card
        if (el.tagName === 'BUTTON') {
          const parentCard = el.parentElement?.closest('main .cursor-pointer');
          if (parentCard && parentCard !== el) continue;
        }
        const r = el.getBoundingClientRect();
        if (!isTvCandidateRendered(el, r, hasRealLayout)) continue;
        ensureTvTabbable(el);
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
      const rows = hasRealLayout ? buildLogicalTvRows(items) : [];
      cachedSnapshot = {
        atMs: now,
        items,
        rows,
        hasRealLayout,
        overlayRoot,
      };
      return cachedSnapshot;
    };

    const focusTvElement = (target: HTMLElement) => {
      if (isTvTextEditableInput(target)) {
        delete target.dataset.tvEditing;
      }
      target.focus({ preventScroll: true });
      // Instant zero-lag scroll alignment (avoids 350ms smooth-scroll animation lag on Android TV)
      target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    };

    const pickPreferredInitialCandidate = (
      items: TvCandidateMeta[],
      overlayRoot: HTMLElement | null
    ): TvCandidateMeta | undefined => {
      if (overlayRoot?.id === 'luma-sidebar') {
        const activeNav = overlayRoot.querySelector<HTMLElement>(
          `#nav-${activeSection ?? 'live'}`
        );
        const matched = activeNav ? items.find((c) => c.el === activeNav) : undefined;
        if (matched) return matched;
      }
      if (overlayRoot?.id === 'luma-live-channel-drawer') {
        const activeCh =
          overlayRoot.querySelector<HTMLElement>('.m3-tonal-active[data-channel-id]') ??
          overlayRoot.querySelector<HTMLElement>('[data-channel-id]');
        const matched = activeCh ? items.find((c) => c.el === activeCh) : undefined;
        if (matched) return matched;
      }
      // Never select search/text <input> boxes or header shortcut triggers by default on screen open
      return (
        items.find(
          (c) =>
            c.region === 'main' &&
            !isTvTextEditableInput(c.el) &&
            c.el.dataset.tvSkipInitial !== 'true' &&
            c.el.id !== 'btn-tv-open-menu'
        ) ??
        items.find(
          (c) => !isTvTextEditableInput(c.el) && c.el.dataset.tvSkipInitial !== 'true'
        ) ??
        items.find((c) => !isTvTextEditableInput(c.el)) ??
        items[0]
      );
    };

    const ensureInitialTvFocus = () => {
      if (document.documentElement.dataset.tvLiveBare === 'true') {
        const { overlayRoot, items } = collectTvCandidates();
        if (overlayRoot && items.length > 0) {
          const target = pickPreferredInitialCandidate(items, overlayRoot);
          if (target) focusTvElement(target.el);
        }
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      const { items, overlayRoot } = collectTvCandidates();
      if (items.length === 0) return;

      if (overlayRoot) {
        if (!active || !overlayRoot.contains(active)) {
          const target = pickPreferredInitialCandidate(items, overlayRoot);
          if (target) focusTvElement(target.el);
        }
        return;
      }

      if (!active || active === document.body || !document.body.contains(active)) {
        const preferred = pickPreferredInitialCandidate(items, null);
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
      const { items, rows, hasRealLayout } = collectTvCandidates(true);
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
      let winner = pickBestTvCandidate(origin, items, dir, allowUpToTitlebar, rows);

      if (!winner && dir === 'up' && !allowUpToTitlebar && scroller) {
        scroller.scrollTop = Math.max(0, scroller.scrollTop - 200);
        invalidateTvCache();
        return true;
      }

      if (!winner && dir === 'down' && scroller) {
        const canScrollMore =
          scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 6;
        if (canScrollMore) {
          scroller.scrollTop = scroller.scrollTop + 200;
          invalidateTvCache();
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

    let lastTopBoundaryUpMs = 0;

    const onTvKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;

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

        // Deterministic Cloud Sync password -> Sign In button jump (never diagonal to "Forgot password?")
        if (active.id === 'input-cloud-password' && dir === 'down') {
          e.preventDefault();
          e.stopPropagation();
          delete active.dataset.tvEditing;
          bridge?.hideTvKeyboard?.();
          const submitBtn = document.getElementById('btn-cloud-submit-auth');
          if (submitBtn) {
            focusTvElement(submitBtn);
            return;
          }
        }

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
            if (active.id === 'input-cloud-email') {
              const pw = document.getElementById('input-cloud-password');
              if (pw) {
                focusTvElement(pw);
                return;
              }
            }
            if (active.id === 'input-cloud-password') {
              const submitBtn = document.getElementById('btn-cloud-submit-auth');
              if (submitBtn) {
                focusTvElement(submitBtn);
                return;
              }
            }
            if (active.id === 'input-cloud-unlock-password') {
              const unlockBtn = document.getElementById('btn-cloud-unlock-submit');
              if (unlockBtn) {
                focusTvElement(unlockBtn);
                return;
              }
            }
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

      // Explicitly activate buttons, links, checkboxes, and cards on TV OK/DPAD_CENTER press
      if (isOkKey && !e.repeat && active && active !== document.body) {
        const tag = active.tagName;
        if (tag === 'INPUT' && (active as HTMLInputElement).type === 'checkbox') {
          e.preventDefault();
          invalidateTvCache();
          active.click();
          return;
        }
        if (tag === 'BUTTON' || tag === 'A') {
          e.preventDefault();
          e.stopPropagation();
          invalidateTvCache();
          active.click();
          return;
        }
        if (tag !== 'SELECT' && tag !== 'INPUT') {
          e.preventDefault();
          invalidateTvCache();
          active.click();
          return;
        }
      }

      if (!dir) return;

      // Always preventDefault on D-Pad arrows so Android WebView's built-in C++ spatial
      // navigation NEVER hijacks focus at row/column boundaries to jump randomly across screen!
      e.preventDefault();
      e.stopPropagation();

      const moved = moveTvFocus(dir, active);
      if (!moved && dir === 'up' && !e.repeat) {
        const now = performance.now();
        if (now - lastTopBoundaryUpMs < 600) {
          lastTopBoundaryUpMs = 0;
          window.dispatchEvent(new CustomEvent('luma-tv-open-view-search'));
        } else {
          lastTopBoundaryUpMs = now;
        }
      } else if (moved) {
        lastTopBoundaryUpMs = 0;
      }
    };

    const onTvImeClosed = () => {
      const active = document.activeElement as HTMLElement | null;
      if (isTvTextEditableInput(active)) {
        delete active.dataset.tvEditing;
        if (active.id === 'input-cloud-email' && active.value.trim()) {
          const pw = document.getElementById('input-cloud-password');
          if (pw) focusTvElement(pw);
        } else if (active.id === 'input-cloud-password' && active.value.length > 0) {
          const submitBtn = document.getElementById('btn-cloud-submit-auth');
          if (submitBtn) focusTvElement(submitBtn);
        } else if (active.id === 'input-cloud-unlock-password' && active.value.length > 0) {
          const unlockBtn = document.getElementById('btn-cloud-unlock-submit');
          if (unlockBtn) focusTvElement(unlockBtn);
        }
      }
    };

    window.addEventListener('keydown', onTvKeyDown, false);
    window.addEventListener('focusout', onTvFocusOut, true);
    window.addEventListener('scroll', invalidateTvCache, true);
    window.addEventListener('luma-tv-ime-closed', onTvImeClosed);
    return () => {
      window.cancelAnimationFrame(rafFocus);
      window.removeEventListener('keydown', onTvKeyDown, false);
      window.removeEventListener('focusout', onTvFocusOut, true);
      window.removeEventListener('scroll', invalidateTvCache, true);
      window.removeEventListener('luma-tv-ime-closed', onTvImeClosed);
    };
  }, [enabled, modalBlocked, tvMode, activeSection]);
}
