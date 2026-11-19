// Draws the parts of a map that change rarely (terrain, walls, doors,
// objects) into an offscreen canvas, so each frame is one drawImage.
import { cellNoise } from '../../shared/rng';
import type { ObjectKind, Terrain } from '../../shared/types';
import { FIXED_COLORS, PALETTES, PLAYER_VOID, shade, type Palette } from './palette';
import type { RenderMap } from './types';
import type { TrapInfo } from '../../shared/traps';

type TrapLook = Pick<TrapInfo, 'type' | 'state'>;

export function cachePx(w: number, h: number): number {
  const small = typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 700;
  const budget = small ? 2304 : 3200;
  return Math.max(16, Math.min(small ? 48 : 64, Math.floor(budget / Math.max(w, h))));
}

const isFloorish = (t: Terrain) => t !== 'wall' && t !== 'void' && t !== 'trees';

export function drawStatic(map: RenderMap, canvas: HTMLCanvasElement | OffscreenCanvas, px: number, dm: boolean) {
  const W = map.width, H = map.height;
  canvas.width = W * px;
  canvas.height = H * px;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const p = PALETTES[map.theme];
  const T = (x: number, y: number): Terrain => (x < 0 || y < 0 || x >= W || y >= H ? 'void' : map.terrain[y * W + x]);

  ctx.fillStyle = dm ? p.void : PLAYER_VOID;
  ctx.fillRect(0, 0, W * px, H * px);
  // Faint rock speckle in the void (the DM's view only: for players it is the unknown).
  if (dm) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (T(x, y) !== 'void') continue;
    const n = cellNoise(x, y, 7);
    if (n > 0.7) { ctx.fillStyle = 'rgba(255,255,255,0.025)'; ctx.fillRect(x * px + n * px * 0.6, y * px + (1 - n) * px * 0.6, px * 0.18, px * 0.18); }
  }

  // Ground layer.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = T(x, y);
    if (t === 'void' || t === 'wall') continue;
    drawGround(ctx, t, x, y, px, p, map.theme === 'forest');
  }

  // Shadows cast by walls onto the ground (light from top-left).
  ctx.save();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!isFloorish(T(x, y))) continue;
    const X = x * px, Y = y * px, s = px * 0.32;
    if (T(x, y - 1) === 'wall') {
      const g = ctx.createLinearGradient(0, Y, 0, Y + s);
      g.addColorStop(0, p.shadow); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(X, Y, px, s);
    }
    if (T(x - 1, y) === 'wall') {
      const g = ctx.createLinearGradient(X, 0, X + s, 0);
      g.addColorStop(0, p.shadow); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(X, Y, s, px);
    }
  }
  ctx.restore();

  // Walls with a lit top edge where they meet open ground.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (T(x, y) !== 'wall') continue;
    const X = x * px, Y = y * px;
    const n = cellNoise(x, y, 3);
    ctx.fillStyle = n > 0.5 ? p.wall : shade(p.wall, 6);
    ctx.fillRect(X, Y, px, px);
    ctx.fillStyle = p.wallTop;
    ctx.fillRect(X + px * 0.08, Y + px * 0.08, px * 0.84, px * 0.84);
    if (map.theme !== 'cave') {
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = Math.max(1, px * 0.04);
      ctx.beginPath();
      const off = (y % 2) * 0.5;
      ctx.moveTo(X, Y + px * 0.5); ctx.lineTo(X + px, Y + px * 0.5);
      ctx.moveTo(X + px * (0.25 + off * 0.5), Y); ctx.lineTo(X + px * (0.25 + off * 0.5), Y + px * 0.5);
      ctx.moveTo(X + px * (0.75 - off * 0.5), Y + px * 0.5); ctx.lineTo(X + px * (0.75 - off * 0.5), Y + px);
      ctx.stroke();
    }
    ctx.fillStyle = p.wallEdge;
    const e = Math.max(1.5, px * 0.07);
    if (isFloorish(T(x, y + 1))) ctx.fillRect(X, Y + px - e, px, e);
    if (isFloorish(T(x, y - 1))) ctx.fillRect(X, Y, px, e);
    if (isFloorish(T(x + 1, y))) ctx.fillRect(X + px - e, Y, e, px);
    if (isFloorish(T(x - 1, y))) ctx.fillRect(X, Y, e, px);
  }

  // Caves: round off corners so passages look carved, not built.
  if (map.theme === 'cave') roundCorners(ctx, map, px, p, T);

  // Tree canopies overlap neighbours, so they get their own pass.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (T(x, y) !== 'trees') continue;
    const n = cellNoise(x, y, 11), m = cellNoise(x, y, 12);
    const cx = (x + 0.5 + (n - 0.5) * 0.3) * px, cy = (y + 0.5 + (m - 0.5) * 0.3) * px;
    const r = px * (0.55 + n * 0.25);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.arc(cx + px * 0.12, cy + px * 0.14, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = n > 0.5 ? p.trees : shade(p.trees, 8);
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = p.treesHi;
    ctx.beginPath(); ctx.arc(cx - r * 0.3, cy - r * 0.3, r * 0.45, 0, Math.PI * 2); ctx.fill();
  }

  for (const d of map.doors) drawDoor(ctx, d.x, d.y, d.state, px, T, dm);
  for (const o of map.objects) drawObject(ctx, o.kind, o.x, o.y, px, !!o.hidden && dm, o.trap, dm);
}

function drawGround(ctx: CanvasRenderingContext2D, t: Terrain, x: number, y: number, px: number, p: Palette, outdoors: boolean) {
  const X = x * px, Y = y * px;
  const n = cellNoise(x, y, 1);
  switch (t) {
    case 'floor':
    case 'rubble': {
      ctx.fillStyle = outdoors ? (n > 0.5 ? p.dirt : p.dirtAlt) : n > 0.55 ? p.floorAlt : p.floor;
      ctx.fillRect(X, Y, px, px);
      if (!outdoors) floorPattern(ctx, p, x, y, px, n);
      if (t === 'rubble') {
        for (let k = 0; k < 4; k++) {
          const a = cellNoise(x, y, 20 + k), b = cellNoise(x, y, 30 + k);
          ctx.fillStyle = k % 2 ? shade(p.rubble.startsWith('#') ? p.rubble : '#80786e', -20) : p.rubble;
          ctx.beginPath();
          ctx.ellipse(X + px * (0.15 + a * 0.7), Y + px * (0.15 + b * 0.7), px * (0.08 + a * 0.08), px * (0.06 + b * 0.06), a * 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'grass':
      ctx.fillStyle = n > 0.5 ? p.grass : p.grassAlt;
      ctx.fillRect(X, Y, px, px);
      ctx.strokeStyle = 'rgba(20,50,10,0.35)'; ctx.lineWidth = Math.max(1, px * 0.03);
      for (let k = 0; k < 3; k++) {
        const a = cellNoise(x, y, 40 + k), b = cellNoise(x, y, 50 + k);
        const gx = X + px * (0.15 + a * 0.7), gy = Y + px * (0.3 + b * 0.6);
        ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx - px * 0.05, gy - px * 0.14); ctx.moveTo(gx, gy); ctx.lineTo(gx + px * 0.05, gy - px * 0.13); ctx.stroke();
      }
      break;
    case 'trees':
      ctx.fillStyle = shade(p.grass, -18);
      ctx.fillRect(X, Y, px, px);
      break;
    case 'dirt':
      ctx.fillStyle = n > 0.5 ? p.dirt : p.dirtAlt;
      ctx.fillRect(X, Y, px, px);
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      for (let k = 0; k < 3; k++) ctx.fillRect(X + px * cellNoise(x, y, 60 + k), Y + px * cellNoise(x, y, 70 + k), px * 0.06, px * 0.06);
      break;
    case 'water':
    case 'deepwater': {
      ctx.fillStyle = t === 'water' ? p.water : p.waterDeep;
      ctx.fillRect(X, Y, px, px);
      break;
    }
    case 'lava': {
      const g = ctx.createRadialGradient(X + px / 2, Y + px / 2, px * 0.1, X + px / 2, Y + px / 2, px * 0.8);
      g.addColorStop(0, p.lavaHi); g.addColorStop(0.5, p.lava); g.addColorStop(1, '#7c1d06');
      ctx.fillStyle = g; ctx.fillRect(X, Y, px, px);
      break;
    }
    case 'wood': {
      ctx.fillStyle = n > 0.5 ? FIXED_COLORS.wood : shade(FIXED_COLORS.wood, 8); ctx.fillRect(X, Y, px, px);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = Math.max(1, px * 0.03);
      ctx.beginPath(); for (let k = 1; k < 4; k++) { ctx.moveTo(X, Y + (px * k) / 4); ctx.lineTo(X + px, Y + (px * k) / 4); } ctx.stroke();
      break;
    }
    case 'tile': {
      ctx.fillStyle = (x + y) % 2 ? '#a39d90' : '#4b4741'; ctx.fillRect(X, Y, px, px);
      break;
    }
    case 'sand': case 'snow': case 'mud': {
      ctx.fillStyle = n > 0.5 ? FIXED_COLORS[t] : shade(FIXED_COLORS[t], t === 'snow' ? -8 : 8); ctx.fillRect(X, Y, px, px);
      ctx.fillStyle = t === 'snow' ? 'rgba(120,140,170,0.18)' : 'rgba(0,0,0,0.12)';
      for (let k = 0; k < 3; k++) ctx.fillRect(X + px * cellNoise(x, y, 80 + k), Y + px * cellNoise(x, y, 90 + k), px * 0.07, px * 0.05);
      break;
    }
    case 'pit': {
      ctx.fillStyle = p.pit; ctx.fillRect(X, Y, px, px);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
      ctx.strokeRect(X + px * 0.2, Y + px * 0.2, px * 0.6, px * 0.6);
      break;
    }
    default: break;
  }
}

function floorPattern(ctx: CanvasRenderingContext2D, p: Palette, x: number, y: number, px: number, n: number) {
  const X = x * px, Y = y * px;
  ctx.strokeStyle = p.floorLine;
  ctx.lineWidth = Math.max(1, px * 0.035);
  ctx.beginPath();
  if (p.pattern === 'flagstone') {
    // Two-by-two flagstones with offset rows.
    const big = (x + (y % 2)) % 2 === 0;
    ctx.moveTo(X, Y + 0.5); ctx.lineTo(X + px, Y + 0.5);
    if (big) { ctx.moveTo(X + 0.5, Y); ctx.lineTo(X + 0.5, Y + px); }
    if (n > 0.9) { ctx.moveTo(X + px * 0.2, Y + px * 0.3); ctx.lineTo(X + px * 0.45, Y + px * 0.55); ctx.lineTo(X + px * 0.4, Y + px * 0.8); }
  } else if (p.pattern === 'planks') {
    for (let k = 1; k < 3; k++) { ctx.moveTo(X, Y + (px * k) / 3); ctx.lineTo(X + px, Y + (px * k) / 3); }
    const off = cellNoise(Math.floor(x / 3), y, 9) * px;
    ctx.moveTo(X + off, Y); ctx.lineTo(X + off, Y + px / 3);
    ctx.moveTo(X + ((off + px / 2) % px), Y + px / 3); ctx.lineTo(X + ((off + px / 2) % px), Y + (2 * px) / 3);
  } else if (p.pattern === 'rough') {
    if (n > 0.6) { ctx.moveTo(X + px * n * 0.5, Y + px * 0.2); ctx.lineTo(X + px * 0.7, Y + px * (0.3 + n * 0.4)); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.beginPath(); ctx.arc(X + px * cellNoise(x, y, 5), Y + px * cellNoise(x, y, 6), px * 0.1, 0, Math.PI * 2); ctx.fill();
    return;
  }
  ctx.stroke();
}

function drawDoor(ctx: CanvasRenderingContext2D, x: number, y: number, state: string, px: number, T: (x: number, y: number) => Terrain, dm: boolean) {
  const X = x * px, Y = y * px;
  // Door runs between the walls on either side.
  const horiz = T(x - 1, y) === 'wall' && T(x + 1, y) === 'wall';
  ctx.save();
  ctx.translate(X + px / 2, Y + px / 2);
  if (!horiz) ctx.rotate(Math.PI / 2);
  const L = px, Th = px * 0.26;
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
  if (state === 'open') {
    ctx.fillStyle = '#5b3a1f';
    ctx.fillRect(-L / 2, -Th / 2, px * 0.12, Th);
    ctx.save();
    ctx.translate(-L / 2 + px * 0.06, 0);
    ctx.rotate(-Math.PI / 2.4);
    ctx.fillStyle = '#8b5a2b';
    ctx.fillRect(0, -Th / 3, L * 0.85, (Th * 2) / 3);
    ctx.restore();
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(-L / 2, -Th / 2 + px * 0.04, L, Th);
    ctx.fillStyle = '#8b5a2b';
    ctx.fillRect(-L / 2, -Th / 2, L, Th);
    ctx.strokeStyle = '#4a2c12'; ctx.lineWidth = Math.max(1, px * 0.03);
    ctx.strokeRect(-L / 2, -Th / 2, L, Th);
    ctx.beginPath(); ctx.moveTo(-L / 6, -Th / 2); ctx.lineTo(-L / 6, Th / 2); ctx.moveTo(L / 6, -Th / 2); ctx.lineTo(L / 6, Th / 2); ctx.stroke();
    ctx.fillStyle = '#d4a017';
    ctx.beginPath(); ctx.arc(L * 0.3, 0, px * 0.04, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

export function drawObject(ctx: CanvasRenderingContext2D, kind: ObjectKind, x: number, y: number, px: number, ghost: boolean, trap?: TrapLook, dm = true) {
  const cx = (x + 0.5) * px, cy = (y + 0.5) * px, s = px;
  ctx.save();
  if (ghost) ctx.globalAlpha = 0.55;
  const shadow = () => { ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = s * 0.12; ctx.shadowOffsetX = s * 0.05; ctx.shadowOffsetY = s * 0.07; };
  const noShadow = () => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; };
  const lw = Math.max(1, s * 0.04);
  ctx.lineWidth = lw;
  switch (kind) {
    case 'chest': {
      shadow();
      ctx.fillStyle = '#7a4a1f'; ctx.fillRect(cx - s * 0.3, cy - s * 0.2, s * 0.6, s * 0.4);
      noShadow();
      ctx.fillStyle = '#9c6129'; ctx.fillRect(cx - s * 0.3, cy - s * 0.2, s * 0.6, s * 0.15);
      ctx.fillStyle = '#d4a017';
      ctx.fillRect(cx - s * 0.3, cy - s * 0.06, s * 0.6, s * 0.05);
      ctx.fillRect(cx - s * 0.04, cy - s * 0.08, s * 0.08, s * 0.12);
      break;
    }
    case 'table': {
      shadow();
      ctx.fillStyle = '#7b5230';
      roundRect(ctx, cx - s * 0.38, cy - s * 0.26, s * 0.76, s * 0.52, s * 0.06); ctx.fill();
      noShadow();
      ctx.strokeStyle = 'rgba(40,20,5,0.5)';
      ctx.beginPath(); ctx.moveTo(cx - s * 0.38, cy); ctx.lineTo(cx + s * 0.38, cy); ctx.stroke();
      break;
    }
    case 'pillar': {
      shadow();
      ctx.fillStyle = '#8d8a85'; ctx.beginPath(); ctx.arc(cx, cy, s * 0.32, 0, Math.PI * 2); ctx.fill();
      noShadow();
      ctx.fillStyle = '#b3b0aa'; ctx.beginPath(); ctx.arc(cx - s * 0.06, cy - s * 0.06, s * 0.2, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'altar': {
      shadow();
      ctx.fillStyle = '#9a958d'; ctx.fillRect(cx - s * 0.4, cy - s * 0.24, s * 0.8, s * 0.48);
      noShadow();
      ctx.fillStyle = '#7e1d1d'; ctx.fillRect(cx - s * 0.12, cy - s * 0.24, s * 0.24, s * 0.48);
      ctx.fillStyle = '#fde68a';
      for (const dx of [-0.3, 0.3]) { ctx.beginPath(); ctx.arc(cx + s * dx, cy - s * 0.12, s * 0.05, 0, Math.PI * 2); ctx.fill(); }
      break;
    }
    case 'statue': {
      shadow();
      ctx.fillStyle = '#6f6c66'; ctx.fillRect(cx - s * 0.32, cy - s * 0.32, s * 0.64, s * 0.64);
      noShadow();
      ctx.fillStyle = '#a8a49c';
      ctx.beginPath(); ctx.arc(cx, cy - s * 0.08, s * 0.12, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx, cy + s * 0.12, s * 0.18, s * 0.12, 0, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'bed': {
      shadow();
      ctx.fillStyle = '#5b3a1f'; ctx.fillRect(cx - s * 0.28, cy - s * 0.42, s * 0.56, s * 0.84);
      noShadow();
      ctx.fillStyle = '#7f1d1d'; ctx.fillRect(cx - s * 0.24, cy - s * 0.1, s * 0.48, s * 0.48);
      ctx.fillStyle = '#f5f0e6'; ctx.fillRect(cx - s * 0.2, cy - s * 0.36, s * 0.4, s * 0.18);
      break;
    }
    case 'barrel': {
      shadow();
      ctx.fillStyle = '#8b5a2b'; ctx.beginPath(); ctx.arc(cx, cy, s * 0.3, 0, Math.PI * 2); ctx.fill();
      noShadow();
      ctx.strokeStyle = '#3f2a14'; ctx.lineWidth = Math.max(1, s * 0.05);
      ctx.beginPath(); ctx.arc(cx, cy, s * 0.22, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, s * 0.1, 0, Math.PI * 2); ctx.stroke();
      break;
    }
    case 'campfire': {
      ctx.strokeStyle = '#4a2c12'; ctx.lineWidth = s * 0.1; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx - s * 0.28, cy + s * 0.2); ctx.lineTo(cx + s * 0.28, cy - s * 0.1);
      ctx.moveTo(cx - s * 0.28, cy - s * 0.1); ctx.lineTo(cx + s * 0.28, cy + s * 0.2); ctx.stroke();
      ctx.fillStyle = 'rgba(160,160,160,0.6)';
      for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2; ctx.beginPath(); ctx.arc(cx + Math.cos(a) * s * 0.36, cy + Math.sin(a) * s * 0.36, s * 0.06, 0, Math.PI * 2); ctx.fill(); }
      break;
    }
    case 'stairs': {
      ctx.fillStyle = '#4b4540'; ctx.fillRect(cx - s * 0.42, cy - s * 0.42, s * 0.84, s * 0.84);
      for (let k = 0; k < 5; k++) {
        ctx.fillStyle = shade('#4b4540', 18 + k * 10);
        ctx.fillRect(cx - s * 0.42, cy - s * 0.42 + (k * s * 0.84) / 5, s * 0.84, s * 0.1);
      }
      break;
    }
    case 'trap': {
      ctx.restore();
      drawTrap(ctx, cx, cy, s, trap, dm, ghost);
      return;
    }
  }
  ctx.restore();
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** DM fog tint: a separate cached layer so painting fog stays cheap. */
export function drawFog(map: RenderMap, canvas: HTMLCanvasElement, px: number) {
  canvas.width = map.width * px;
  canvas.height = map.height * px;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!map.fog) return;
  ctx.fillStyle = 'rgba(10,12,30,0.42)';
  for (let y = 0; y < map.height; y++) {
    let run = -1;
    for (let x = 0; x <= map.width; x++) {
      const fogged = x < map.width && map.fog[y * map.width + x] === 0;
      if (fogged && run < 0) run = x;
      if (!fogged && run >= 0) { ctx.fillRect(run * px, y * px, (x - run) * px, px); run = -1; }
    }
  }
  // A bright edge where revealed meets fogged, so the DM sees at a glance
  // exactly what players can see.
  const W = map.width, H = map.height, F = map.fog;
  const fogged = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && F[y * W + x] === 0;
  ctx.strokeStyle = 'rgba(125,211,252,0.85)';
  ctx.lineWidth = Math.max(1.5, px * 0.07);
  ctx.beginPath();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (F[y * W + x] !== 1) continue;
    if (fogged(x, y - 1)) { ctx.moveTo(x * px, y * px); ctx.lineTo((x + 1) * px, y * px); }
    if (fogged(x, y + 1)) { ctx.moveTo(x * px, (y + 1) * px); ctx.lineTo((x + 1) * px, (y + 1) * px); }
    if (fogged(x - 1, y)) { ctx.moveTo(x * px, y * px); ctx.lineTo(x * px, (y + 1) * px); }
    if (fogged(x + 1, y)) { ctx.moveTo((x + 1) * px, y * px); ctx.lineTo((x + 1) * px, (y + 1) * px); }
  }
  ctx.stroke();
  // Hatching so fog reads as fog, not just darker.
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(160,180,255,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    if (map.fog[y * map.width + x] !== 0) continue;
    ctx.moveTo(x * px, (y + 1) * px); ctx.lineTo((x + 1) * px, y * px);
  }
  ctx.stroke();
}

function roundCorners(ctx: CanvasRenderingContext2D, map: RenderMap, px: number, p: Palette, T: (x: number, y: number) => Terrain) {
  const r = px * 0.5;
  const corners: [number, number, number, number][] = [[-1, -1, 0, 0], [1, -1, 1, 0], [-1, 1, 0, 1], [1, 1, 1, 1]];
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
    const t = T(x, y);
    const wall = t === 'wall';
    if (!wall && !isFloorish(t)) continue;
    for (const [dx, dy, cx, cy] of corners) {
      const a = T(x + dx, y), b = T(x, y + dy);
      // Inside corner of open ground: fill with rock. Outside corner of rock: cut it back.
      const fill = wall ? (isFloorish(a) && isFloorish(b) ? p.floor : null) : (a === 'wall' && b === 'wall' ? p.wallTop : null);
      if (!fill) continue;
      // Fill the sliver between the cell corner and a quarter circle.
      const ox = (x + cx) * px, oy = (y + cy) * px;
      const hx = ox + (cx ? -r : r), vy = oy + (cy ? -r : r);
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(hx, oy);
      ctx.arcTo(ox, oy, ox, vy, r);
      ctx.lineTo(ox, vy);
      ctx.closePath();
      ctx.fill();
    }
  }
}

const TRAP_COLOR: Record<TrapInfo['type'], string> = {
  spikes: '#d4d4d8', pit: '#78716c', darts: '#a3e635', fire: '#fb923c', net: '#d6c7a1',
  glyph: '#a78bfa', blade: '#e5e7eb', gas: '#86efac', alarm: '#facc15', collapse: '#a8a29e',
};

/**
 * A trap: a pressure plate with a symbol for its type. The DM sees a ring
 * for its state (red armed, orange sprung, green disarmed); players see an
 * amber warning ring on traps they've found.
 */
export function drawTrap(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, trap: TrapLook | undefined, dm: boolean, ghost: boolean) {
  const type = trap?.type ?? 'spikes', state = trap?.state ?? 'armed';
  const col = state === 'disarmed' ? '#71717a' : TRAP_COLOR[type];
  const sprung = state === 'triggered';
  ctx.save();
  if (ghost) ctx.globalAlpha = 0.6;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // The plate.
  roundRect(ctx, cx - s * 0.36, cy - s * 0.36, s * 0.72, s * 0.72, s * 0.09);
  const g = ctx.createLinearGradient(cx - s * 0.36, cy - s * 0.36, cx + s * 0.36, cy + s * 0.36);
  g.addColorStop(0, 'rgba(70,64,58,0.85)'); g.addColorStop(1, 'rgba(24,22,20,0.9)');
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = Math.max(1, s * 0.03); ctx.stroke();
  // The symbol.
  ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.2, s * 0.05);
  const r = s * 0.24;
  ctx.beginPath();
  switch (type) {
    case 'spikes': {
      const h = sprung ? r * 1.25 : r * 0.9;
      for (const dx of [-0.6, 0, 0.6]) { ctx.moveTo(cx + dx * r - r * 0.28, cy + r * 0.6); ctx.lineTo(cx + dx * r, cy + r * 0.6 - h * 1.3); ctx.lineTo(cx + dx * r + r * 0.28, cy + r * 0.6); }
      ctx.fill();
      break;
    }
    case 'pit': {
      const pg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.1);
      pg.addColorStop(0, '#000'); pg.addColorStop(0.75, '#0c0a09'); pg.addColorStop(1, col);
      ctx.arc(cx, cy, r * (sprung ? 1.15 : 0.95), 0, Math.PI * 2); ctx.fillStyle = pg; ctx.fill();
      break;
    }
    case 'darts': {
      for (const dy of [-0.5, 0, 0.5]) {
        const y = cy + dy * r;
        ctx.moveTo(cx - r * 0.9, y); ctx.lineTo(cx + r * 0.6, y);
        ctx.moveTo(cx + r * 0.95, y); ctx.lineTo(cx + r * 0.55, y - r * 0.22); ctx.lineTo(cx + r * 0.55, y + r * 0.22); ctx.closePath();
      }
      ctx.stroke(); ctx.fill();
      break;
    }
    case 'fire': {
      ctx.moveTo(cx, cy - r * 1.15);
      ctx.bezierCurveTo(cx + r * 0.9, cy - r * 0.2, cx + r * 0.8, cy + r * 0.9, cx, cy + r * 0.9);
      ctx.bezierCurveTo(cx - r * 0.8, cy + r * 0.9, cx - r * 0.9, cy - r * 0.2, cx, cy - r * 1.15);
      ctx.fill();
      ctx.beginPath(); ctx.fillStyle = state === 'disarmed' ? '#a1a1aa' : '#fde68a';
      ctx.ellipse(cx, cy + r * 0.35, r * 0.32, r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'net': {
      ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.save(); ctx.clip();
      ctx.beginPath(); ctx.lineWidth = Math.max(1, s * 0.03);
      for (let k = -2; k <= 2; k++) { ctx.moveTo(cx + k * r * 0.45 - r, cy - r); ctx.lineTo(cx + k * r * 0.45 + r, cy + r); ctx.moveTo(cx + k * r * 0.45 + r, cy - r); ctx.lineTo(cx + k * r * 0.45 - r, cy + r); }
      ctx.stroke(); ctx.restore();
      break;
    }
    case 'glyph': {
      if (state !== 'disarmed') { ctx.shadowColor = col; ctx.shadowBlur = s * 0.25; }
      ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + (k * 4 * Math.PI) / 5; const px = cx + Math.cos(a) * r * 0.85, py = cy + Math.sin(a) * r * 0.85; if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
      ctx.closePath(); ctx.stroke();
      break;
    }
    case 'blade': {
      ctx.arc(cx - r * 0.2, cy, r * 1.05, -Math.PI * 0.42, Math.PI * 0.42);
      ctx.arc(cx - r * 0.55, cy, r * 0.85, Math.PI * 0.36, -Math.PI * 0.36, true);
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'gas': {
      for (const [dx, dy, rr] of [[-0.45, 0.15, 0.5], [0.1, -0.25, 0.6], [0.5, 0.2, 0.45]] as const) { ctx.moveTo(cx + dx * r + rr * r, cy + dy * r); ctx.arc(cx + dx * r, cy + dy * r, rr * r, 0, Math.PI * 2); }
      ctx.globalAlpha *= 0.85; ctx.fill();
      break;
    }
    case 'alarm': {
      ctx.moveTo(cx - r * 0.8, cy + r * 0.55);
      ctx.quadraticCurveTo(cx - r * 0.6, cy - r * 0.9, cx, cy - r * 0.95);
      ctx.quadraticCurveTo(cx + r * 0.6, cy - r * 0.9, cx + r * 0.8, cy + r * 0.55);
      ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(cx, cy + r * 0.75, r * 0.2, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'collapse': {
      for (const [dx, dy, k] of [[-0.5, 0.35, 0.45], [0.35, 0.3, 0.5], [-0.05, -0.4, 0.42]] as const) {
        const x0 = cx + dx * r, y0 = cy + dy * r, q = k * r;
        ctx.moveTo(x0 - q, y0); ctx.lineTo(x0 - q * 0.4, y0 - q * 0.8); ctx.lineTo(x0 + q * 0.7, y0 - q * 0.6); ctx.lineTo(x0 + q, y0 + q * 0.3); ctx.lineTo(x0, y0 + q * 0.7); ctx.closePath();
      }
      ctx.fill();
      break;
    }
  }
  ctx.shadowBlur = 0;
  if (state === 'disarmed') {
    // Struck through.
    ctx.beginPath(); ctx.strokeStyle = '#22c55e'; ctx.lineWidth = Math.max(1.5, s * 0.05);
    ctx.moveTo(cx - r, cy + r); ctx.lineTo(cx + r, cy - r); ctx.stroke();
  }
  // State ring.
  ctx.beginPath();
  roundRect(ctx, cx - s * 0.44, cy - s * 0.44, s * 0.88, s * 0.88, s * 0.12);
  ctx.lineWidth = Math.max(1.5, s * 0.055);
  if (dm) {
    ctx.strokeStyle = state === 'armed' ? '#ef4444' : state === 'triggered' ? '#f59e0b' : '#22c55e';
    if (state !== 'triggered') ctx.setLineDash([s * 0.1, s * 0.07]);
    ctx.stroke();
  } else if (state !== 'disarmed') {
    ctx.strokeStyle = '#fbbf24'; ctx.stroke();
  }
  ctx.restore();
}
