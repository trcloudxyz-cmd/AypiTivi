export type SpatialDirection = 'up' | 'down' | 'left' | 'right';

export function isSmartTvBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Web0S|webOS|NetCast|LGE|SmartTV|SMART-TV|Tizen|BRAVIA|HbbTV/i.test(ua);
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function isElementVisible(el: HTMLElement): boolean {
  if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function findNextSpatialFocus(
  current: HTMLElement | null,
  direction: SpatialDirection,
  root: HTMLElement = document.body,
): HTMLElement | null {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el !== current && isElementVisible(el),
  );

  if (candidates.length === 0) return null;
  if (!current || !root.contains(current) || !isElementVisible(current)) {
    return candidates[0];
  }

  const curRect = current.getBoundingClientRect();
  const curCx = curRect.left + curRect.width / 2;
  const curCy = curRect.top + curRect.height / 2;

  let bestEl: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const dx = cx - curCx;
    const dy = cy - curCy;

    let primary = 0;
    let secondary = 0;
    let overlapsOrtho = false;

    if (direction === 'right') {
      if (dx <= 4) continue;
      primary = dx;
      secondary = Math.abs(dy);
      overlapsOrtho = rect.bottom > curRect.top && rect.top < curRect.bottom;
    } else if (direction === 'left') {
      if (dx >= -4) continue;
      primary = -dx;
      secondary = Math.abs(dy);
      overlapsOrtho = rect.bottom > curRect.top && rect.top < curRect.bottom;
    } else if (direction === 'down') {
      if (dy <= 4) continue;
      primary = dy;
      secondary = Math.abs(dx);
      overlapsOrtho = rect.right > curRect.left && rect.left < curRect.right;
    } else {
      if (dy >= -4) continue;
      primary = -dy;
      secondary = Math.abs(dx);
      overlapsOrtho = rect.right > curRect.left && rect.left < curRect.right;
    }

    // Strongly prefer elements aligned along the movement corridor
    const orthoWeight = overlapsOrtho ? 0.5 : 2.2;
    const score = primary + secondary * orthoWeight;

    if (score < bestScore) {
      bestScore = score;
      bestEl = el;
    }
  }

  return bestEl;
}

export function moveSpatialFocus(
  direction: SpatialDirection,
  root: HTMLElement = document.body,
): boolean {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const next = findNextSpatialFocus(active, direction, root);
  if (!next) return false;
  next.focus({preventScroll: true});
  next.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'smooth'});
  return true;
}
