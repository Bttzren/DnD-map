import type { DistanceRule, Point } from './types';

/** Distance in feet between two cells (cell coordinates). */
export function distanceFt(a: Point, b: Point, rule: DistanceRule): number {
  const dx = Math.abs(Math.round(a.x) - Math.round(b.x));
  const dy = Math.abs(Math.round(a.y) - Math.round(b.y));
  if (rule === 'euclid') return Math.round(Math.hypot(dx, dy) * 5);
  if (rule === 'alt') {
    const diag = Math.min(dx, dy);
    const straight = Math.max(dx, dy) - diag;
    return (straight + diag + Math.floor(diag / 2)) * 5;
  }
  return Math.max(dx, dy) * 5;
}

/** Distance between two tokens, edge to edge, so large creatures measure sensibly. */
export function tokenDistanceFt(
  a: { x: number; y: number; size: number },
  b: { x: number; y: number; size: number },
  rule: DistanceRule,
): number {
  const gapX = Math.max(0, b.x - (a.x + a.size - 1), a.x - (b.x + b.size - 1));
  const gapY = Math.max(0, b.y - (a.y + a.size - 1), a.y - (b.y + b.size - 1));
  return distanceFt({ x: 0, y: 0 }, { x: gapX, y: gapY }, rule);
}
