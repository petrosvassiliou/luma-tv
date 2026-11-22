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

export function useSpatialDpadFocus(enabled: boolean, modalBlocked: boolean): void {
  useEffect(() => {
    if (!enabled) return;

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
  }, [enabled, modalBlocked]);
}
