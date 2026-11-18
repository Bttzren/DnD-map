// The textured version of the static layer: real stone, wood, grass and
// water textures blended with soft, slightly irregular edges, walls with
// drop shadows, and warm light around fires. Drawn once per map change into
// an offscreen canvas, like the procedural layer it replaces.
//
// Shapes are built as alpha masks at a few pixels per grid square, then
// scaled up smoothly and used to stamp a texture through. Edges only wobble
// a little, so every square still reads as what it is under the grid.
import { cellNoise } from '../../shared/rng';
import type { DoorState, ObjectKind, Terrain } from '../../shared/types';
import { PALETTES } from './palette';
import { drawObject, roundRect } from './staticLayer';
import { makeCanvas, pattern, THEME_TEXTURES } from './textures';
import type { RenderMap } from './types';

/** The parts of a map the static layer draws: small enough to post to a worker. */
export type StaticMap = Pick<RenderMap, 'id' | 'width' | 'height' | 'theme' | 'terrain' | 'doors' | 'objects'>;
export const staticPart = (m: RenderMap): StaticMap => ({
  id: m.id, width: m.width, height: m.height, theme: m.theme, terrain: m.terrain,
  doors: m.doors.map((d) => ({ ...d })), objects: m.objects.map((o) => ({ ...o })),
});

type Ctx = CanvasRenderingContext2D;
type Fill = (c: Ctx) => string | CanvasPattern | CanvasGradient | null;
interface LayerOpts { alpha?: number; comp?: GlobalCompositeOperation; shadow?: { color: string; blur: number; dx: number; dy: number } }

// Scratch canvases, reused between redraws and shrunk afterwards to free memory.
// Works on the main thread or in a worker (OffscreenCanvas), so no DOM here.
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
const ctx2d = (c: AnyCanvas) => c.getContext('2d') as unknown as Ctx;
let S: AnyCanvas | null = null;
let M: AnyCanvas | null = null;
let grid: { key: string; U: Float32Array; V: Float32Array; CX: Int16Array; CY: Int16Array; N: Float32Array; N2: Float32Array } | null = null;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number) => { const t = clamp01(v); return t * t * (3 - 2 * t); };

function vnoise(x: number, y: number, scale: number, salt: number): number {
  const gx = x / scale, gy = y / scale;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const fx = gx - x0, fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = cellNoise(x0, y0, salt), b = cellNoise(x0 + 1, y0, salt);
  const c = cellNoise(x0, y0 + 1, salt), d = cellNoise(x0 + 1, y0 + 1, salt);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

const BUILT = new Set(['dungeon', 'crypt', 'sewer', 'tavern']);

export function drawStaticTextured(map: StaticMap, canvas: AnyCanvas, px: number, dm: boolean) {
  const W = map.width, H = map.height, CW = W * px, CH = H * px;
  canvas.width = CW; canvas.height = CH;
  const ctx = ctx2d(canvas);
  const th = THEME_TEXTURES[map.theme];
  const pal = PALETTES[map.theme];
  const built = BUILT.has(map.theme);
  const T = (x: number, y: number): Terrain => (x < 0 || y < 0 || x >= W || y >= H ? 'void' : map.terrain[y * W + x]);

  // Mask resolution: enough for smooth edges, small enough to compute fast.
  const R = Math.max(4, Math.min(px <= 48 ? 8 : 10, px, Math.floor(720 / Math.max(W, H))));
  const MW = W * R, MH = H * R, NN = MW * MH;
  S ??= makeCanvas(1, 1);
  M ??= makeCanvas(1, 1);
  S.width = CW; S.height = CH; M.width = MW; M.height = MH;
  const sctx = ctx2d(S), mctx = ctx2d(M);
  const img = mctx.createImageData(MW, MH);
  const buf = img.data;
  for (let i = 0; i < buf.length; i += 4) { buf[i] = buf[i + 1] = buf[i + 2] = 255; }
  const A = new Float32Array(NN);

  // Per-pixel cell coordinates and two noise fields (-0.5..0.5): fine wobble and
  // broad patches. They only depend on the map's size and id, so they are kept
  // between redraws (players redraw on every fog reveal).
  const salt = hashStr(map.id);
  const gkey = `${W}x${H}@${R}#${salt}`;
  if (grid?.key !== gkey) {
    const g = { key: gkey, U: new Float32Array(NN), V: new Float32Array(NN), CX: new Int16Array(NN), CY: new Int16Array(NN), N: new Float32Array(NN), N2: new Float32Array(NN) };
    for (let j = 0, k = 0; j < MH; j++) for (let i = 0; i < MW; i++, k++) {
      const u = (i + 0.5) / R, v = (j + 0.5) / R;
      g.U[k] = u; g.V[k] = v; g.CX[k] = Math.floor(u); g.CY[k] = Math.floor(v);
      g.N[k] = (vnoise(u, v, 0.9, salt) * 0.65 + vnoise(u, v, 0.35, salt + 1) * 0.35) - 0.5;
      g.N2[k] = vnoise(u, v, 4.5, salt + 2) * 0.7 + vnoise(u, v, 1.7, salt + 3) * 0.3 - 0.5;
    }
    grid = g;
  }
  const { U, V, CX, CY, N, N2 } = grid;

  const cells = (pred: (t: Terrain) => boolean) => {
    const a = new Uint8Array(W * H);
    let any = false;
    for (let i = 0; i < W * H; i++) if (pred(map.terrain[i])) { a[i] = 1; any = true; }
    return any ? a : null;
  };
  const at = (a: Uint8Array, x: number, y: number, oob: number) => (x < 0 || y < 0 || x >= W || y >= H ? oob : a[y * W + x]);
  /** Per cell: 1 if any neighbour differs from it. Most cells don't, and those need no maths. */
  const mixedCache = new Map<Uint8Array, Map<number, Uint8Array>>();
  const mixedOf = (a: Uint8Array, oob: number) => {
    let byOob = mixedCache.get(a);
    if (!byOob) mixedCache.set(a, (byOob = new Map()));
    let m = byOob.get(oob);
    if (m) return m;
    m = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const own = a[y * W + x];
      let diff = 0;
      for (let dy = -1; dy <= 1 && !diff; dy++) for (let dx = -1; dx <= 1; dx++) if (at(a, x + dx, y + dy, oob) !== own) { diff = 1; break; }
      m[y * W + x] = diff;
    }
    byOob.set(oob, m);
    return m;
  };

  /** Share of a (2h)-wide square around (u, v) covered by the cell set: 0.5 on an edge, rounded at corners. */
  const box = (a: Uint8Array, k: number, h: number, oob = 0) => {
    const u = U[k], v = V[k], cx = CX[k], cy = CY[k];
    const c = cy * W + cx;
    if (!mixedOf(a, oob)[c]) return a[c];
    let s = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const y0 = cy + dy, oy = Math.min(v + h, y0 + 1) - Math.max(v - h, y0);
      if (oy <= 0) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (!at(a, cx + dx, y0, oob)) continue;
        const x0 = cx + dx, ox = Math.min(u + h, x0 + 1) - Math.max(u - h, x0);
        if (ox > 0) s += ox * oy;
      }
    }
    return s / (4 * h * h);
  };
  /** Distance in squares from (u, v) to the nearest cell whose value is `want`, up to `cap`. */
  const near = (a: Uint8Array, k: number, want: number, oob: number, cap: number) => {
    const u = U[k], v = V[k], cx = CX[k], cy = CY[k];
    const c = cy * W + cx;
    if (!mixedOf(a, oob)[c]) return a[c] === want ? 0 : cap;
    let best = cap;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (at(a, cx + dx, cy + dy, oob) !== want) continue;
      const x0 = cx + dx, y0 = cy + dy;
      const ex = Math.max(x0 - u, 0, u - x0 - 1), ey = Math.max(y0 - v, 0, v - y0 - 1);
      const d = Math.sqrt(ex * ex + ey * ey);
      if (d < best) best = d;
    }
    return best;
  };

  /**
   * Stamp `fill` through the mask in A onto the map, touching only the part the
   * mask covers. A colour is drawn straight from the mask in one pass; a
   * texture goes through the scratch canvas. `rgb: 'set'` means the caller
   * already wrote per-pixel colours into the mask.
   */
  const layer = (fill: Fill | string, o: LayerOpts & { rgb?: 'set' } = {}) => {
    const solid = typeof fill === 'string';
    const [cr, cg, cb] = solid ? hexRgb(fill) : [255, 255, 255];
    let x0 = MW, y0 = MH, x1 = -1, y1 = -1;
    for (let j = 0, k = 0; j < MH; j++) for (let i = 0; i < MW; i++, k++) {
      const a = A[k], q = k * 4;
      if (o.rgb !== 'set') { buf[q] = cr; buf[q + 1] = cg; buf[q + 2] = cb; }
      buf[q + 3] = a * 255;
      if (a > 0.002) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
    }
    if (x1 < 0) return;
    // Grow the box a little for smoothing and shadows, then work in whole canvas pixels.
    const pad = Math.ceil(R * 0.6) + 1;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(MW - 1, x1 + pad); y1 = Math.min(MH - 1, y1 + pad);
    const sx = x0 * px / R, sy = y0 * px / R, sw = (x1 + 1 - x0) * px / R, sh = (y1 + 1 - y0) * px / R;
    const X = Math.floor(sx), Y = Math.floor(sy), Wd = Math.ceil(sx + sw) - X, Hd = Math.ceil(sy + sh) - Y;
    // Refresh one mask pixel beyond the box too, since smoothing samples it.
    const dx0 = Math.max(0, x0 - 1), dy0 = Math.max(0, y0 - 1);
    mctx.putImageData(img, 0, 0, dx0, dy0, Math.min(MW, x1 + 2) - dx0, Math.min(MH, y1 + 2) - dy0);
    const apply = (c: Ctx) => {
      if (o.alpha !== undefined) c.globalAlpha = o.alpha;
      if (o.comp) c.globalCompositeOperation = o.comp;
      if (o.shadow) { c.shadowColor = o.shadow.color; c.shadowBlur = o.shadow.blur; c.shadowOffsetX = o.shadow.dx; c.shadowOffsetY = o.shadow.dy; }
    };
    ctx.save();
    ctx.beginPath(); ctx.rect(X, Y, Wd, Hd);
    if (!o.shadow) ctx.clip();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    if (solid) {
      apply(ctx);
      ctx.drawImage(M!, x0, y0, x1 + 1 - x0, y1 + 1 - y0, sx, sy, sw, sh);
    } else {
      sctx.save();
      sctx.beginPath(); sctx.rect(X, Y, Wd, Hd); sctx.clip();
      sctx.globalCompositeOperation = 'copy';
      sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(M!, x0, y0, x1 + 1 - x0, y1 + 1 - y0, sx, sy, sw, sh);
      sctx.globalCompositeOperation = 'source-in';
      sctx.fillStyle = fill(sctx) ?? '#000';
      sctx.fillRect(X, Y, Wd, Hd);
      sctx.restore();
      apply(ctx);
      ctx.drawImage(S!, X, Y, Wd, Hd, X, Y, Wd, Hd);
    }
    ctx.restore();
  };
  const tex = (name: string, shift = 0): Fill => (c) => pattern(c, name, px, shift);

  /** A natural ground layer (grass, water...) with a soft, wobbly edge. */
  const natural = (pred: (t: Terrain) => boolean, fill: Fill | string, o: LayerOpts & { amp?: number; width?: number; grow?: number } = {}) => {
    const a = cells(pred);
    if (!a) return null;
    const amp = o.amp ?? 0.35, w = o.width ?? 0.22, grow = o.grow ?? 0.08;
    for (let k = 0; k < NN; k++) A[k] = smooth((box(a, k, 0.32) + N[k] * amp - 0.5 + grow) / w + 0.5);
    layer(fill, o);
    return a;
  };

  // 1. Ground everywhere, with a shifted second copy blended in broad patches so the repeat doesn't show.
  ctx.fillStyle = pattern(ctx, th.floor, px) ?? pal.floor;
  ctx.fillRect(0, 0, CW, CH);
  for (let k = 0; k < NN; k++) A[k] = smooth(N2[k] * 3 + 0.5);
  layer(tex(th.floor, 0.43), { alpha: 0.7 });

  // 2. Natural terrain, from the ground up.
  natural((t) => t === 'dirt', tex(th.dirt));
  natural((t) => t === 'grass', tex('grass'));
  natural((t) => t === 'trees', tex('grass-dark'), { grow: 0.2 });
  const rubble = natural((t) => t === 'rubble', tex('rubble'), { width: 0.3 });
  const pit = natural((t) => t === 'pit', tex('pit'), { amp: 0.2, width: 0.12, grow: 0.04 });
  if (pit) {
    // Darker towards the middle so it reads as a drop.
    for (let k = 0; k < NN; k++) A[k] = smooth((box(pit, k, 0.5) - 0.62) / 0.3) * 0.85;
    layer('#000000');
  }
  const wet = cells((t) => t === 'water' || t === 'deepwater');
  if (wet) {
    // Damp, dark ground at the waterline, then the bed, then the water itself.
    for (let k = 0; k < NN; k++) A[k] = smooth((box(wet, k, 0.32) + N[k] * 0.3 - 0.5 + 0.3) / 0.35 + 0.5) * 0.45;
    layer('#0b0f0c');
    natural((t) => t === 'water' || t === 'deepwater', tex('riverbed'), { amp: 0.25, width: 0.14 });
    natural((t) => t === 'water' || t === 'deepwater', pal.water, { amp: 0.25, width: 0.14, alpha: map.theme === 'sewer' ? 0.78 : 0.62 });
    // Deeper towards the middle of wide water.
    for (let k = 0; k < NN; k++) A[k] = smooth((box(wet, k, 1) - 0.55) / 0.4 + N2[k] * 0.6) * 0.45;
    layer(pal.waterDeep);
    natural((t) => t === 'deepwater', pal.waterDeep, { amp: 0.3, width: 0.4, alpha: 0.85, grow: -0.05 });
    // A pale edge where water meets land.
    for (let k = 0; k < NN; k++) {
      const f = box(wet, k, 0.32) + N[k] * 0.25 - 0.5 + 0.08;
      A[k] = Math.max(0, 1 - Math.abs(f) / 0.07) * 0.35;
    }
    layer('#dcf0eb');
  }
  const lava = cells((t) => t === 'lava');
  if (lava) {
    natural((t) => t === 'lava', '#2a0d05', { grow: 0.16, width: 0.3, alpha: 0.8 });
    natural((t) => t === 'lava', tex('lava'), { amp: 0.25, width: 0.14, shadow: { color: 'rgba(255,110,20,0.9)', blur: px * 0.9, dx: 0, dy: 0 } });
  }

  // 3. Broad light and dark patches: grime, wear and uneven light.
  const patchDark = map.theme === 'tavern' ? 0.2 : map.theme === 'forest' ? 0.24 : 0.32;
  for (let k = 0; k < NN; k++) {
    const dark = smooth(N2[k] * 2.2 + 0.1) * patchDark, light = smooth(-N2[k] * 2.4 - 0.25) * 0.1;
    const q = k * 4;
    if (dark >= light) { buf[q] = buf[q + 1] = buf[q + 2] = 0; A[k] = dark; }
    else { buf[q] = 255; buf[q + 1] = 241; buf[q + 2] = 214; A[k] = light; }
  }
  layer('', { rgb: 'set' });

  if (rubble) drawRubble(ctx, map, px);

  // 4. Walls: a dark outline that casts a soft shadow onto the floor, then the stone itself.
  const walls = cells((t) => t === 'wall');
  if (walls) {
    const sd = new Float32Array(NN); // signed distance to the wall edge in squares, negative inside
    for (let k = 0; k < NN; k++) {
      if (built) {
        const inside = walls[CY[k] * W + CX[k]] === 1;
        sd[k] = inside ? -near(walls, k, 0, 0, 1) : near(walls, k, 1, 0, 1.5);
      } else {
        sd[k] = (0.5 - box(walls, k, 0.5)) + N[k] * 0.26 + 0.07;
      }
    }
    const aa = 1 / R;
    for (let k = 0; k < NN; k++) A[k] = clamp01(0.5 - (sd[k] - 0.09) / aa);
    layer('#0a0908', { shadow: { color: 'rgba(0,0,0,0.85)', blur: px * 0.45, dx: px * 0.08, dy: px * 0.14 } });
    for (let k = 0; k < NN; k++) A[k] = clamp01(0.5 - sd[k] / aa);
    layer(tex(th.wall));
    // A faint lit rim on the inner edge, like light catching the top of the wall.
    for (let k = 0; k < NN; k++) { const d = -sd[k]; A[k] = d > 0 ? Math.max(0, 1 - Math.abs(d - 0.06) / 0.05) * 0.22 : 0; }
    layer('#fff3dc');
  }

  // 5. The unknown: dark rock for the DM, darkness for players, fading in gently at the edges.
  const voids = cells((t) => t === 'void');
  {
    const open = cells((t) => t !== 'void' && t !== 'wall');
    const vv = voids ?? new Uint8Array(W * H);
    const fadeWall = dm ? 0.32 : 0.55;
    for (let k = 0; k < NN; k++) {
      const t = map.terrain[CY[k] * W + CX[k]];
      const n = N[k] * 0.3;
      // Natural rock: a ragged, rounded edge between the walls and the unknown, like the walls themselves.
      const rag = built ? 1 : smooth((box(vv, k, 0.5, 1) - 0.5 + N[k] * 0.45 + 0.12) / 0.28 + 0.5);
      if (t === 'void') A[k] = (open ? smooth(near(open, k, 1, 0, 1) / 0.7 + n) : 1) * (built ? 1 : Math.max(rag, 0.75 + 0.25 * rag));
      else if (t === 'wall') A[k] = (built ? smooth(1 - near(vv, k, 1, 1, 1) / fadeWall + n) : rag) * (dm ? 0.75 : 0.95);
      else A[k] = 0;
    }
    if (dm) layer(tex(th.voidDm)); else layer(pal.void);
  }

  // 6. Trees, doors, objects.
  drawTrees(ctx, map, px, T);
  for (const d of map.doors) drawDoor(ctx, d.x, d.y, d.state, px, T, dm, 'floor-tavern');
  for (const o of map.objects) drawThing(ctx, o.kind, o.x, o.y, px, !!o.hidden && dm);

  // 7. Warm light from fires, candles and lava, then the theme's colour grade.
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const glow = (x: number, y: number, r: number, color: string) => {
    const g = ctx.createRadialGradient(x * px, y * px, 0, x * px, y * px, r * px);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect((x - r) * px, (y - r) * px, 2 * r * px, 2 * r * px);
  };
  for (const o of map.objects) {
    if (o.hidden && !dm) continue;
    if (o.kind === 'campfire') glow(o.x + 0.5, o.y + 0.5, 4, 'rgba(255,150,60,0.55)');
    if (o.kind === 'altar') glow(o.x + 0.5, o.y + 0.5, 2, 'rgba(255,210,130,0.3)');
  }
  if (lava) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (lava[y * W + x] && (x + y) % 2 === 0) glow(x + 0.5, y + 0.5, 2.2, 'rgba(255,90,20,0.16)');
  ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = th.gradeAlpha;
  ctx.fillStyle = th.grade;
  ctx.fillRect(0, 0, CW, CH);
  ctx.restore();

  // Free the big scratch canvas; the mask one is small.
  S.width = S.height = 1;
}

function hexRgb(c: string): [number, number, number] {
  if (!c.startsWith('#')) return [0, 0, 0];
  const h = c.length === 4 ? c.slice(1).split('').map((d) => d + d).join('') : c.slice(1, 7);
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) % 100000;
}

function drawRubble(ctx: Ctx, map: StaticMap, px: number) {
  ctx.save();
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    if (map.terrain[y * map.width + x] !== 'rubble') continue;
    for (let k = 0; k < 4; k++) {
      const a = cellNoise(x, y, 20 + k), b = cellNoise(x, y, 30 + k);
      const cx = (x + 0.15 + a * 0.7) * px, cy = (y + 0.15 + b * 0.7) * px;
      const rx = px * (0.07 + a * 0.09), ry = px * (0.05 + b * 0.07);
      ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = px * 0.08; ctx.shadowOffsetX = px * 0.03; ctx.shadowOffsetY = px * 0.05;
      const g = ctx.createRadialGradient(cx - rx * 0.4, cy - ry * 0.5, 0, cx, cy, Math.max(rx, ry) * 1.2);
      g.addColorStop(0, '#a39a8c'); g.addColorStop(1, '#4e4840');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, a * 3, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

function drawTrees(ctx: Ctx, map: StaticMap, px: number, T: (x: number, y: number) => Terrain) {
  const leaf = pattern(ctx, 'grass-dark', px, 0.2) ?? '#2f5a2a';
  const TINTS = ['rgba(25,60,15,0.4)', 'rgba(70,80,15,0.32)', 'rgba(10,45,25,0.48)', 'rgba(45,85,25,0.28)', 'rgba(35,55,10,0.42)'];
  const trees: { cx: number; cy: number; r: number; seed: number; tint: string }[] = [];
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    if (T(x, y) !== 'trees') continue;
    const n = cellNoise(x, y, 11), m = cellNoise(x, y, 12), q = cellNoise(x, y, 15);
    // Leave the odd gap inside thick woods, so it reads as many trees, not a hedge.
    const inner = T(x - 1, y) === 'trees' && T(x + 1, y) === 'trees' && T(x, y - 1) === 'trees' && T(x, y + 1) === 'trees';
    if (inner && q < 0.22) continue;
    const big = q > 0.86 ? 1.35 : 1;
    trees.push({
      cx: (x + 0.5 + (n - 0.5) * 0.5) * px, cy: (y + 0.5 + (m - 0.5) * 0.5) * px,
      r: px * (0.48 + cellNoise(x, y, 16) * 0.4) * big, seed: x * 131 + y,
      tint: TINTS[Math.floor(cellNoise(x, y, 17) * TINTS.length)],
    });
  }
  // Big trees spread over the small ones.
  trees.sort((a, b) => a.r - b.r);
  const crown = (t: (typeof trees)[number]) => {
    ctx.beginPath();
    ctx.arc(t.cx, t.cy, t.r * 0.78, 0, Math.PI * 2);
    const lobes = 6 + (t.seed % 4);
    for (let k = 0; k < lobes; k++) {
      const a = (k / lobes) * Math.PI * 2 + cellNoise(t.seed, k, 13) * 0.6;
      const rr = t.r * (0.34 + cellNoise(t.seed, k, 14) * 0.14);
      const d = t.r - rr;
      ctx.moveTo(t.cx + Math.cos(a) * d + rr, t.cy + Math.sin(a) * d);
      ctx.arc(t.cx + Math.cos(a) * d, t.cy + Math.sin(a) * d, rr, 0, Math.PI * 2);
    }
  };
  // Shadows first, so no canopy is darkened by its neighbour's shadow.
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = px * 0.3;
  for (const t of trees) { ctx.save(); ctx.translate(px * 0.16, px * 0.22); crown(t); ctx.fill(); ctx.restore(); }
  ctx.restore();
  for (const t of trees) {
    ctx.save();
    crown(t);
    ctx.fillStyle = leaf; ctx.fill();
    ctx.clip();
    ctx.fillStyle = t.tint; ctx.fill();
    const g = ctx.createRadialGradient(t.cx - t.r * 0.35, t.cy - t.r * 0.4, t.r * 0.05, t.cx, t.cy, t.r * 1.15);
    g.addColorStop(0, 'rgba(255,250,190,0.3)'); g.addColorStop(0.45, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,15,0,0.55)');
    ctx.fillStyle = g; ctx.fillRect(t.cx - t.r * 1.2, t.cy - t.r * 1.2, t.r * 2.4, t.r * 2.4);
    ctx.restore();
  }
}

function drawDoor(ctx: Ctx, x: number, y: number, state: DoorState, px: number, T: (x: number, y: number) => Terrain, dm: boolean, wood: string) {
  const horiz = T(x - 1, y) === 'wall' && T(x + 1, y) === 'wall';
  ctx.save();
  ctx.translate((x + 0.5) * px, (y + 0.5) * px);
  if (!horiz) ctx.rotate(Math.PI / 2);
  const L = px, Th = px * 0.28;
  if (state === 'secret') {
    if (dm) {
      ctx.setLineDash([px * 0.12, px * 0.08]);
      ctx.strokeStyle = '#e0b84a'; ctx.lineWidth = Math.max(1.5, px * 0.06);
      ctx.strokeRect(-L / 2 + 1, -Th / 2, L - 2, Th);
      ctx.setLineDash([]);
      ctx.fillStyle = '#e0b84a';
      ctx.font = `bold ${px * 0.32}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.rotate(horiz ? 0 : -Math.PI / 2);
      ctx.fillText('S', 0, 0);
    }
    ctx.restore();
    return;
  }
  const woodFill = pattern(ctx, wood, px) ?? '#8b5a2b';
  // Stone jambs where the door meets the walls.
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = px * 0.12; ctx.shadowOffsetY = px * 0.05;
  ctx.fillStyle = '#2b2622';
  ctx.fillRect(-L / 2 - px * 0.02, -Th * 0.75, px * 0.14, Th * 1.5);
  ctx.fillRect(L / 2 - px * 0.12, -Th * 0.75, px * 0.14, Th * 1.5);
  ctx.restore();
  const slab = (w: number) => {
    ctx.fillStyle = woodFill; ctx.fillRect(0, -Th / 2, w, Th);
    ctx.fillStyle = 'rgba(120,70,25,0.45)'; ctx.fillRect(0, -Th / 2, w, Th);
    const g = ctx.createLinearGradient(0, -Th / 2, 0, Th / 2);
    g.addColorStop(0, 'rgba(255,230,180,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = g; ctx.fillRect(0, -Th / 2, w, Th);
    ctx.strokeStyle = 'rgba(25,12,4,0.9)'; ctx.lineWidth = Math.max(1, px * 0.035);
    ctx.strokeRect(0, -Th / 2, w, Th);
    // Iron bands.
    ctx.fillStyle = '#2a2a2e';
    ctx.fillRect(w * 0.2, -Th / 2, px * 0.05, Th);
    ctx.fillRect(w * 0.75, -Th / 2, px * 0.05, Th);
  };
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.65)'; ctx.shadowBlur = px * 0.15; ctx.shadowOffsetX = px * 0.04; ctx.shadowOffsetY = px * 0.07;
  if (state === 'open') {
    ctx.translate(-L / 2 + px * 0.12, -Th / 2);
    ctx.rotate(-Math.PI / 2.3);
    ctx.translate(0, Th / 2);
    slab(L * 0.76);
  } else {
    ctx.translate(-L / 2 + px * 0.1, 0);
    slab(L - px * 0.2);
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#d4a017';
    ctx.beginPath(); ctx.arc(L * 0.68, 0, px * 0.045, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  ctx.restore();
}

/** Objects with textured wood and stone; the rest keep their drawn look. */
function drawThing(ctx: Ctx, kind: ObjectKind, x: number, y: number, px: number, ghost: boolean) {
  const cx = (x + 0.5) * px, cy = (y + 0.5) * px, s = px;
  const wood = pattern(ctx, 'floor-tavern', px, 0.3);
  const stone = pattern(ctx, 'floor-crypt', px, 0.6);
  if (!wood || !stone) return drawObject(ctx, kind, x, y, px, ghost);
  ctx.save();
  if (ghost) ctx.globalAlpha = 0.55;
  const shadow = (k = 1) => { ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = s * 0.16 * k; ctx.shadowOffsetX = s * 0.06 * k; ctx.shadowOffsetY = s * 0.1 * k; };
  const noShadow = () => { ctx.shadowColor = 'transparent'; };
  const shade = (x0: number, y0: number, x1: number, y1: number) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, 'rgba(255,240,210,0.28)'); g.addColorStop(0.5, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.4)');
    return g;
  };
  const edge = (w = 0.035) => { ctx.strokeStyle = 'rgba(15,8,3,0.85)'; ctx.lineWidth = Math.max(1, s * w); ctx.stroke(); };
  switch (kind) {
    case 'table': {
      roundRect(ctx, cx - s * 0.4, cy - s * 0.28, s * 0.8, s * 0.56, s * 0.06);
      shadow(); ctx.fillStyle = wood; ctx.fill(); noShadow();
      ctx.fillStyle = 'rgba(110,60,20,0.35)'; ctx.fill();
      ctx.fillStyle = shade(cx - s * 0.4, cy - s * 0.28, cx + s * 0.4, cy + s * 0.28); ctx.fill();
      edge();
      break;
    }
    case 'chest': {
      roundRect(ctx, cx - s * 0.32, cy - s * 0.22, s * 0.64, s * 0.44, s * 0.05);
      shadow(); ctx.fillStyle = wood; ctx.fill(); noShadow();
      ctx.fillStyle = 'rgba(90,40,10,0.5)'; ctx.fill();
      ctx.fillStyle = shade(cx, cy - s * 0.22, cx, cy + s * 0.22); ctx.fill();
      edge();
      ctx.fillStyle = '#c9971c';
      ctx.fillRect(cx - s * 0.32, cy - s * 0.04, s * 0.64, s * 0.06);
      ctx.fillRect(cx - s * 0.2, cy - s * 0.22, s * 0.05, s * 0.44);
      ctx.fillRect(cx + s * 0.15, cy - s * 0.22, s * 0.05, s * 0.44);
      ctx.fillStyle = '#f3d36b'; ctx.fillRect(cx - s * 0.045, cy - s * 0.07, s * 0.09, s * 0.12);
      break;
    }
    case 'barrel': {
      ctx.beginPath(); ctx.arc(cx, cy, s * 0.31, 0, Math.PI * 2);
      shadow(); ctx.fillStyle = wood; ctx.fill(); noShadow();
      ctx.fillStyle = 'rgba(100,50,15,0.4)'; ctx.fill();
      const g = ctx.createRadialGradient(cx - s * 0.1, cy - s * 0.1, 0, cx, cy, s * 0.33);
      g.addColorStop(0, 'rgba(255,230,190,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = '#26262a'; ctx.lineWidth = Math.max(1, s * 0.045);
      for (const r of [0.31, 0.2]) { ctx.beginPath(); ctx.arc(cx, cy, s * r, 0, Math.PI * 2); ctx.stroke(); }
      break;
    }
    case 'bed': {
      roundRect(ctx, cx - s * 0.3, cy - s * 0.44, s * 0.6, s * 0.88, s * 0.05);
      shadow(); ctx.fillStyle = wood; ctx.fill(); noShadow(); edge();
      ctx.fillStyle = '#7b2323'; roundRect(ctx, cx - s * 0.26, cy - s * 0.1, s * 0.52, s * 0.5, s * 0.04); ctx.fill();
      ctx.fillStyle = shade(cx - s * 0.26, cy - s * 0.1, cx + s * 0.26, cy + s * 0.4); ctx.fill();
      ctx.fillStyle = '#eee6d6'; roundRect(ctx, cx - s * 0.21, cy - s * 0.38, s * 0.42, s * 0.2, s * 0.06); ctx.fill();
      break;
    }
    case 'pillar': {
      ctx.beginPath(); ctx.arc(cx, cy, s * 0.34, 0, Math.PI * 2);
      shadow(1.3); ctx.fillStyle = stone; ctx.fill(); noShadow();
      const g = ctx.createRadialGradient(cx - s * 0.12, cy - s * 0.12, s * 0.02, cx, cy, s * 0.36);
      g.addColorStop(0, 'rgba(255,255,250,0.35)'); g.addColorStop(0.6, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = g; ctx.fill(); edge(0.03);
      ctx.beginPath(); ctx.arc(cx, cy, s * 0.24, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.stroke();
      break;
    }
    case 'altar': {
      ctx.beginPath(); ctx.rect(cx - s * 0.42, cy - s * 0.26, s * 0.84, s * 0.52);
      shadow(); ctx.fillStyle = stone; ctx.fill(); noShadow();
      ctx.fillStyle = shade(cx - s * 0.42, cy - s * 0.26, cx + s * 0.42, cy + s * 0.26); ctx.fill(); edge(0.03);
      ctx.fillStyle = '#6e1818'; ctx.fillRect(cx - s * 0.12, cy - s * 0.26, s * 0.24, s * 0.52);
      for (const dx of [-0.3, 0.3]) {
        ctx.fillStyle = '#efe6cf'; ctx.beginPath(); ctx.arc(cx + s * dx, cy - s * 0.12, s * 0.05, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffd36b'; ctx.beginPath(); ctx.arc(cx + s * dx, cy - s * 0.12, s * 0.025, 0, Math.PI * 2); ctx.fill();
      }
      break;
    }
    case 'statue': {
      ctx.beginPath(); ctx.rect(cx - s * 0.34, cy - s * 0.34, s * 0.68, s * 0.68);
      shadow(); ctx.fillStyle = stone; ctx.fill(); noShadow();
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fill(); edge(0.03);
      shadow(0.6);
      const g = ctx.createRadialGradient(cx - s * 0.08, cy - s * 0.12, 0, cx, cy, s * 0.3);
      g.addColorStop(0, '#d8d3c8'); g.addColorStop(1, '#6d685f');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(cx, cy + s * 0.1, s * 0.2, s * 0.13, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy - s * 0.1, s * 0.12, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'campfire': {
      ctx.restore();
      drawObject(ctx, kind, x, y, px, ghost);
      ctx.save();
      if (ghost) ctx.globalAlpha = 0.55;
      const g = ctx.createRadialGradient(cx, cy + s * 0.04, 0, cx, cy, s * 0.24);
      g.addColorStop(0, '#fff3b0'); g.addColorStop(0.45, '#ffad33'); g.addColorStop(1, 'rgba(230,70,10,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, s * 0.26, 0, Math.PI * 2); ctx.fill();
      break;
    }
    default:
      ctx.restore();
      return drawObject(ctx, kind, x, y, px, ghost);
  }
  ctx.restore();
}
