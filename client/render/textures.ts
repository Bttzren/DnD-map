// Loads the baked CC0 textures from /textures and hands out canvas patterns
// scaled to true size (one grid square is 5 ft = 1.524 m).
import type { Theme } from '../../shared/types';

const METERS_PER_CELL = 1.524;

let manifest: Record<string, { meters: number }> = {};
const images = new Map<string, HTMLImageElement>();
let loading: Promise<boolean> | null = null;

export function loadTextures(): Promise<boolean> {
  if (!loading) {
    loading = (async () => {
      manifest = await fetch('/textures/manifest.json').then((r) => r.json());
      await Promise.all(Object.keys(manifest).map((name) => new Promise<void>((res) => {
        const im = new Image();
        im.decoding = 'async';
        im.onload = () => { images.set(name, im); res(); };
        im.onerror = () => res();
        im.src = `/textures/${name}.webp`;
      })));
      return images.size > 0;
    })().catch(() => false);
  }
  return loading;
}

export const texturesReady = () => images.size > 0;

/** A repeating pattern for `name`, scaled so it tiles at real-world size. */
export function pattern(ctx: CanvasRenderingContext2D, name: string, px: number, rotate = 0): CanvasPattern | null {
  const im = images.get(name);
  if (!im) return null;
  const p = ctx.createPattern(im, 'repeat');
  if (!p) return null;
  const cells = (manifest[name]?.meters ?? 2) / METERS_PER_CELL;
  const s = (cells * px) / im.width;
  let m = new DOMMatrix().scale(s, s);
  if (rotate) m = new DOMMatrix().rotate(rotate).multiply(m);
  p.setTransform(m);
  return p;
}

export interface ThemeTextures { floor: string; wall: string; dirt: string; voidDm: string }

export const THEME_TEXTURES: Record<Theme, ThemeTextures> = {
  dungeon: { floor: 'floor-dungeon', wall: 'wall-dungeon', dirt: 'dirt', voidDm: 'rock' },
  crypt: { floor: 'floor-crypt', wall: 'wall-crypt', dirt: 'dirt', voidDm: 'rock' },
  cave: { floor: 'floor-cave', wall: 'wall-cave', dirt: 'dirt', voidDm: 'rock' },
  sewer: { floor: 'floor-sewer', wall: 'wall-sewer', dirt: 'dirt', voidDm: 'rock' },
  tavern: { floor: 'floor-tavern', wall: 'wall-tavern', dirt: 'street', voidDm: 'rock' },
  forest: { floor: 'dirt-forest', wall: 'wall-cave', dirt: 'dirt-forest', voidDm: 'grass-dark' },
};
