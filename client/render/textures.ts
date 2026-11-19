// Loads the baked CC0 textures from /textures and hands out canvas patterns
// at a fixed size per grid square. Each texture is downscaled ahead of time
// to the exact tile size it is drawn at, because canvas patterns are not
// mipmapped: drawing a 512 px tile at a tenth of its size would shimmer.
import type { Terrain, Theme } from '../../shared/types';

const METERS_PER_CELL = 1.524; // one 5 ft square

/**
 * Real-world sizes make small, busy repeats on a 5 ft grid, so each texture
 * is drawn this many times larger than life. Battle maps conventionally
 * exaggerate stones and planks a little so they read at table distance.
 */
const SCALE: Record<string, number> = {
  'floor-dungeon': 1.7, 'floor-crypt': 1.6, 'floor-cave': 1.4, 'floor-sewer': 1.5, 'floor-tavern': 1.5,
  street: 1.6, rock: 1.6, grass: 1.5, 'grass-dark': 1.5, dirt: 1.6, 'dirt-forest': 1.8, rubble: 1.3,
  riverbed: 1.6, pit: 1.4, lava: 1.8,
  // Checkered tiles: one tile of the texture spans exactly 10 squares, so each checker is one grid square.
  wood: 1.2, tile: (10 * 1.524) / 2, sand: 0.3, snow: 1.6, mud: 1.6,
  'wall-dungeon': 1.1, 'wall-crypt': 1.2, 'wall-cave': 1.2, 'wall-sewer': 1.1, 'wall-tavern': 1.1,
};

type Img = ImageBitmap | HTMLImageElement;
type Canvas = OffscreenCanvas | HTMLCanvasElement;
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A scratch canvas that works on the main thread and in a worker. */
export function makeCanvas(w: number, h: number): Canvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

let manifest: Record<string, { meters: number }> = {};
const images = new Map<string, Img>();
const tiles = new Map<string, Canvas>();
let loading: Promise<boolean> | null = null;

export function loadTextures(): Promise<boolean> {
  if (!loading) {
    loading = (async () => {
      const r = await fetch('/textures/manifest.json');
      if (!r.ok) return false;
      manifest = await r.json();
      await Promise.all(Object.keys(manifest).map(async (name) => {
        const url = `/textures/${name}.webp`;
        try {
          if (typeof createImageBitmap === 'function') {
            const blob = await fetch(url).then((x) => (x.ok ? x.blob() : Promise.reject(new Error('missing'))));
            images.set(name, await createImageBitmap(blob));
          } else {
            const im = new Image();
            im.src = url;
            await im.decode();
            images.set(name, im);
          }
        } catch { /* leave it out; layers without a texture fall back to colour */ }
      }));
      return images.size > 0;
    })().catch(() => false);
  }
  return loading;
}

export const texturesReady = () => images.size > 0;
export const hasTexture = (name: string) => images.has(name);

/** Side of one repeat of `name`, in grid squares. */
export function tileCells(name: string): number {
  return ((manifest[name]?.meters ?? 2) / METERS_PER_CELL) * (SCALE[name] ?? 1.5);
}

/** The texture downscaled (by repeated halving, for a clean result) to one tile at `px` per square. */
function tile(name: string, px: number): Canvas | null {
  const im = images.get(name);
  if (!im) return null;
  const size = Math.max(8, Math.round(tileCells(name) * px));
  const key = `${name}@${size}`;
  const hit = tiles.get(key);
  if (hit) return hit;
  let src: CanvasImageSource = im;
  let w = im.width;
  while (w / 2 >= size * 1.01) {
    const half = makeCanvas(Math.round(w / 2), Math.round(w / 2));
    const c = half.getContext('2d') as Ctx2D;
    c.imageSmoothingQuality = 'high';
    c.drawImage(src, 0, 0, half.width, half.height);
    src = half; w = half.width;
  }
  const out = makeCanvas(size, size);
  const c = out.getContext('2d') as Ctx2D;
  c.imageSmoothingQuality = 'high';
  c.drawImage(src, 0, 0, size, size);
  tiles.set(key, out);
  if (tiles.size > 80) tiles.delete(tiles.keys().next().value!);
  return out;
}

/** A repeating pattern for `name` at `px` per square, optionally shifted by a fraction of a tile. */
export function pattern(ctx: Ctx2D, name: string, px: number, shift = 0): CanvasPattern | null {
  const t = tile(name, px);
  if (!t) return null;
  const p = ctx.createPattern(t, 'repeat');
  if (!p) return null;
  if (shift) {
    try { p.setTransform(new DOMMatrix().translate(t.width * shift, t.width * shift * 1.618)); } catch { /* unshifted is fine */ }
  }
  return p;
}

export interface ThemeTextures { floor: string; wall: string; dirt: string; voidDm: string; grade: string; gradeAlpha: number }

export const THEME_TEXTURES: Record<Theme, ThemeTextures> = {
  dungeon: { floor: 'floor-dungeon', wall: 'wall-dungeon', dirt: 'dirt', voidDm: 'rock', grade: '#ffe9cc', gradeAlpha: 0.25 },
  crypt: { floor: 'floor-crypt', wall: 'wall-crypt', dirt: 'dirt', voidDm: 'rock', grade: '#b9c8ff', gradeAlpha: 0.3 },
  cave: { floor: 'floor-cave', wall: 'wall-cave', dirt: 'dirt', voidDm: 'rock', grade: '#ffd9b0', gradeAlpha: 0.25 },
  sewer: { floor: 'floor-sewer', wall: 'wall-sewer', dirt: 'dirt', voidDm: 'rock', grade: '#cfe8c4', gradeAlpha: 0.3 },
  tavern: { floor: 'floor-tavern', wall: 'wall-tavern', dirt: 'street', voidDm: 'rock', grade: '#ffe2b8', gradeAlpha: 0.2 },
  forest: { floor: 'dirt-forest', wall: 'wall-cave', dirt: 'dirt-forest', voidDm: 'grass-dark', grade: '#f4ffe0', gradeAlpha: 0.15 },
};

/** Which texture shows a terrain in a setting (for UI swatches); null when it's a plain colour. */
export function textureFor(t: Terrain, theme: Theme): string | null {
  const th = THEME_TEXTURES[theme];
  switch (t) {
    case 'floor': return th.floor;
    case 'wall': return th.wall;
    case 'void': return th.voidDm;
    case 'water': case 'deepwater': return 'riverbed';
    case 'trees': return 'grass-dark';
    case 'dirt': return th.dirt;
    default: return t;
  }
}
