import { idx, isOpen } from '../../shared/grid';
import type { MapData } from '../../shared/types';

/** Number of separate open regions (doors count as open). */
export function openRegions(map: MapData): number {
  const seen = new Uint8Array(map.width * map.height);
  let regions = 0;
  for (let i = 0; i < seen.length; i++) {
    if (seen[i] || !isOpen(map.terrain[i])) continue;
    regions++;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      const x = c % map.width, y = Math.floor(c / map.width);
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
        const n = idx(map, nx, ny);
        if (!seen[n] && isOpen(map.terrain[n])) { seen[n] = 1; stack.push(n); }
      }
    }
  }
  return regions;
}

