import type { AreaTemplate, MapData } from './types';

const CONE_HALF = Math.atan(0.5); // 5e cone: width equals distance from origin
const EPS = 1e-6;

/** Cells whose centre lies inside the template. */
export function templateCells(t: AreaTemplate, map: Pick<MapData, 'width' | 'height'>): number[] {
  const len = t.sizeFt / 5;
  const a = (t.angle * Math.PI) / 180;
  const dx = Math.cos(a), dy = Math.sin(a);
  const reach = Math.ceil(len) + 1;
  const out: number[] = [];
  const x0 = Math.max(0, Math.floor(t.x - reach)), x1 = Math.min(map.width - 1, Math.ceil(t.x + reach));
  const y0 = Math.max(0, Math.floor(t.y - reach)), y1 = Math.min(map.height - 1, Math.ceil(t.y + reach));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5 - t.x, py = y + 0.5 - t.y;
      let inside = false;
      if (t.shape === 'circle') inside = Math.hypot(px, py) <= len + EPS;
      else if (t.shape === 'square') inside = Math.abs(px) <= len / 2 + EPS && Math.abs(py) <= len / 2 + EPS;
      else {
        const along = px * dx + py * dy;
        const perp = Math.abs(-px * dy + py * dx);
        if (t.shape === 'line') inside = along >= -EPS && along <= len + EPS && perp <= 0.5 + EPS;
        else inside = along > 0 && Math.hypot(px, py) <= len + EPS && Math.atan2(perp, along) <= CONE_HALF + EPS;
      }
      if (inside) out.push(y * map.width + x);
    }
  return out;
}
