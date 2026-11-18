// A canvas that shows a RenderMap with a pannable, zoomable camera.
// Input is translated to cell coordinates and handed to a controller.
import { cellNoise } from '../../shared/rng';
import { templateCells } from '../../shared/templates';
import type { AreaTemplate } from '../../shared/types';
import { PALETTES } from './palette';
import { cachePx, drawFog, drawStatic, roundRect } from './staticLayer';
import { drawStaticTextured } from './texturedLayer';
import { loadTextures, texturesReady } from './textures';
import type { Overlay, RenderMap, RenderToken } from './types';

export interface CellEvent {
  /** Fractional cell coordinates. */
  fx: number; fy: number;
  /** Integer cell. */
  x: number; y: number;
  button: number;
  shift: boolean; alt: boolean; ctrl: boolean;
  touch: boolean;
}

export interface MapViewHandlers {
  /** Return true if the controller handles this drag; otherwise the view pans. */
  down?(e: CellEvent): boolean;
  move?(e: CellEvent): void;
  up?(e: CellEvent): void;
  cancel?(): void;
  hover?(e: CellEvent | null): void;
  tap?(e: CellEvent): void;
  dblclick?(e: CellEvent): void;
  camera?(c: Camera): void;
}

export interface Camera { x: number; y: number; z: number }

interface Particle { x: number; y: number; vx: number; vy: number; r: number; life: number }

export class MapView {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  cam: Camera = { x: 0, y: 0, z: 40 };
  map: RenderMap | null = null;
  overlay: Overlay = {};
  dm = false;
  handlers: MapViewHandlers = {};
  spaceDown = false;
  /** True once the person has panned or zoomed by hand. */
  userMoved = false;
  /** Screen space covered by overlays at the top and bottom, kept clear when fitting. */
  insets = { top: 0, bottom: 0 };

  private staticCanvas = document.createElement('canvas');
  private fogCanvas = document.createElement('canvas');
  private px = 32;
  private staticKey = '';
  private fogKey = '';
  private lastStatic = 0;
  private lastChange = 0;
  private fullPx = 0;
  private dims = '';
  private pendingStatic: ReturnType<typeof setTimeout> | 0 = 0;
  private dead = false;
  private raf = 0;
  private last = performance.now();
  private tween = new Map<string, { x: number; y: number }>();
  private particles: Particle[] = [];
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: 'none' | 'tool' | 'pan' | 'pinch' = 'none';
  private panStart = { x: 0, y: 0, cx: 0, cy: 0 };
  private pinchStart = { d: 0, z: 0, mx: 0, my: 0, cx: 0, cy: 0 };
  private downAt = { x: 0, y: 0, t: 0 };
  private moved = false;
  private camTarget: Camera | null = null;
  private hoverToken: string | null = null;
  private ro: ResizeObserver;
  private dpr = 1;

  constructor(private host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'map-canvas';
    this.canvas.style.touchAction = 'none';
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.bindInput();
    const loop = (t: number) => { this.frame(t); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
    // Draw with the procedural look straight away, then switch to textures once they arrive.
    loadTextures().then((ok) => { if (ok && !this.dead && this.map) this.redrawStatic(); });
  }

  destroy() {
    this.dead = true;
    clearTimeout(this.pendingStatic);
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.canvas.remove();
  }

  /** Call whenever terrain/doors/objects change. `key` should change with them. */
  setMap(map: RenderMap | null, staticKey: string, fogKey: string) {
    const first = !this.map || !map || this.map.id !== map?.id;
    this.map = map;
    if (!map) return;
    if (staticKey !== this.staticKey) {
      this.staticKey = staticKey;
      const px = cachePx(map.width, map.height);
      const resized = px !== this.fullPx || this.dims !== `${map.width}x${map.height}`;
      const now = performance.now();
      const burst = now - this.lastChange < 600;
      this.lastChange = now;
      clearTimeout(this.pendingStatic); this.pendingStatic = 0;
      if (first || resized || !burst) {
        // A one-off change (a door, a new map) is drawn in full straight away.
        this.redrawStatic(false);
        // Count the burst from when drawing finished, so a slow device still gets drafts.
        this.lastChange = performance.now();
        if (resized) this.fogKey = '';
      } else {
        // While painting, draw a quick half-resolution version now and then,
        // and the full one once things settle.
        if (now - this.lastStatic > 120) this.redrawStatic(true);
        this.lastChange = performance.now();
        this.pendingStatic = setTimeout(() => { this.pendingStatic = 0; if (!this.dead) this.redrawStatic(false); }, 450);
      }
    }
    if (this.dm && fogKey !== this.fogKey) {
      drawFog(map, this.fogCanvas, this.px);
      this.fogKey = fogKey;
    }
    if (first) this.fit();
  }

  /** Redraw the cached terrain layer for the current map; a draft is half resolution. */
  private redrawStatic(draft = false) {
    const map = this.map;
    if (!map) return;
    const full = cachePx(map.width, map.height);
    this.fullPx = full;
    this.dims = `${map.width}x${map.height}`;
    const px = draft ? Math.max(12, Math.round(full / 2)) : full;
    if (px !== this.px) this.fogKey = '';
    this.px = px;
    if (texturesReady()) drawStaticTextured(map, this.staticCanvas, px, this.dm);
    else drawStatic(map, this.staticCanvas, px, this.dm);
    this.lastStatic = performance.now();
    if (this.dm && !this.fogKey && map.fog) { drawFog(map, this.fogCanvas, px); this.fogKey = 'redrawn'; }
  }

  get size() { return { w: this.canvas.width / this.dpr, h: this.canvas.height / this.dpr }; }

  /** Fit the map to the screen. Players fit to what they can actually see. */
  fit() {
    if (!this.map) return;
    const { w, h } = this.size;
    const m = this.map;
    let x0 = 0, y0 = 0, x1 = m.width, y1 = m.height;
    if (!this.dm) {
      x0 = m.width; y0 = m.height; x1 = 0; y1 = 0;
      for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
        if (m.terrain[y * m.width + x] === 'void') continue;
        if (x < x0) x0 = x; if (y < y0) y0 = y; if (x + 1 > x1) x1 = x + 1; if (y + 1 > y1) y1 = y + 1;
      }
      for (const t of m.tokens) { x0 = Math.min(x0, t.x); y0 = Math.min(y0, t.y); x1 = Math.max(x1, t.x + t.size); y1 = Math.max(y1, t.y + t.size); }
      if (x1 <= x0) { x0 = 0; y0 = 0; x1 = m.width; y1 = m.height; }
      // Leave some room around a small revealed area.
      const pad = 2;
      x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
    }
    const bw = x1 - x0, bh = y1 - y0;
    const { top, bottom } = this.insets;
    const z = Math.max(6, Math.min(this.dm ? 80 : 64, (w - 40) / bw, (h - top - bottom - 24) / bh));
    // Centre the map in the space between the overlays.
    this.cam = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 - (top - bottom) / (2 * z), z };
    this.camTarget = null;
    this.userMoved = false;
    this.handlers.camera?.(this.cam);
  }

  /** Smoothly move the camera (used when players follow the DM). */
  animateTo(c: Camera) { this.camTarget = { ...c }; }

  centerOn(x: number, y: number, z?: number) { this.animateTo({ x, y, z: z ?? Math.max(this.cam.z, 44) }); }

  zoomBy(f: number, sx?: number, sy?: number) {
    const { w, h } = this.size;
    sx ??= w / 2; sy ??= h / 2;
    const before = this.toCell(sx, sy);
    this.cam.z = Math.max(5, Math.min(140, this.cam.z * f));
    const after = this.toCell(sx, sy);
    this.cam.x += before.fx - after.fx;
    this.cam.y += before.fy - after.fy;
    this.camTarget = null;
    this.handlers.camera?.(this.cam);
  }

  toCell(sx: number, sy: number) {
    const { w, h } = this.size;
    const fx = this.cam.x + (sx - w / 2) / this.cam.z;
    const fy = this.cam.y + (sy - h / 2) / this.cam.z;
    return { fx, fy, x: Math.floor(fx), y: Math.floor(fy) };
  }

  toScreen(cx: number, cy: number) {
    const { w, h } = this.size;
    return { x: (cx - this.cam.x) * this.cam.z + w / 2, y: (cy - this.cam.y) * this.cam.z + h / 2 };
  }

  private resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    const r = this.host.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
  }

  // ---------------------------------------------------------------- input

  private ev(e: PointerEvent | MouseEvent): CellEvent {
    const r = this.canvas.getBoundingClientRect();
    const c = this.toCell(e.clientX - r.left, e.clientY - r.top);
    return {
      ...c, button: e.button, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey,
      touch: 'pointerType' in e && e.pointerType === 'touch',
    };
  }

  private bindInput() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.userMoved = true;
      const r = c.getBoundingClientRect();
      if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
        this.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
      } else {
        this.cam.x += e.deltaX / this.cam.z; this.cam.y += e.deltaY / this.cam.z;
        this.handlers.camera?.(this.cam);
      }
    }, { passive: false });

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      const r = c.getBoundingClientRect();
      this.pointers.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
      this.camTarget = null;
      if (this.pointers.size === 2) {
        if (this.gesture === 'tool') this.handlers.cancel?.();
        const [a, b] = [...this.pointers.values()];
        this.gesture = 'pinch';
        this.pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.cam.z, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, cx: this.cam.x, cy: this.cam.y };
        return;
      }
      if (this.pointers.size > 2) return;
      this.downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
      this.moved = false;
      const ce = this.ev(e);
      const forcePan = e.button === 1 || e.button === 2 || this.spaceDown;
      if (!forcePan && this.handlers.down?.(ce)) this.gesture = 'tool';
      else {
        this.gesture = 'pan';
        this.panStart = { x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y };
      }
    });

    c.addEventListener('pointermove', (e) => {
      const r = c.getBoundingClientRect();
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
      if (Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 5) this.moved = true;
      if (this.gesture === 'pinch' && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const { w, h } = this.size;
        const z = Math.max(5, Math.min(140, this.pinchStart.z * (d / Math.max(1, this.pinchStart.d))));
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        // Keep the world point under the starting midpoint under the current midpoint.
        const wx = this.pinchStart.cx + (this.pinchStart.mx - w / 2) / this.pinchStart.z;
        const wy = this.pinchStart.cy + (this.pinchStart.my - h / 2) / this.pinchStart.z;
        this.cam = { x: wx - (mx - w / 2) / z, y: wy - (my - h / 2) / z, z };
        this.userMoved = true;
        this.handlers.camera?.(this.cam);
        return;
      }
      if (this.gesture === 'pan') {
        this.userMoved = true;
        this.cam.x = this.panStart.cx - (e.clientX - this.panStart.x) / this.cam.z;
        this.cam.y = this.panStart.cy - (e.clientY - this.panStart.y) / this.cam.z;
        this.handlers.camera?.(this.cam);
        return;
      }
      const ce = this.ev(e);
      if (this.gesture === 'tool') this.handlers.move?.(ce);
      else if (e.pointerType !== 'touch') {
        this.hoverToken = this.map?.tokens.find((t) => ce.x >= t.x && ce.x < t.x + t.size && ce.y >= t.y && ce.y < t.y + t.size)?.id ?? null;
        this.handlers.hover?.(ce);
      }
    });

    const end = (e: PointerEvent) => {
      if (!this.pointers.delete(e.pointerId)) return;
      const ce = this.ev(e);
      if (this.gesture === 'tool') this.handlers.up?.(ce);
      if (this.pointers.size === 0) {
        const wasPinch = this.gesture === 'pinch';
        if (!this.moved && !wasPinch && performance.now() - this.downAt.t < 450 && e.button === 0) this.handlers.tap?.(ce);
        this.gesture = 'none';
      } else if (this.gesture === 'pinch' && this.pointers.size === 1) {
        // Continue as a pan with the remaining finger.
        const [p] = [...this.pointers.values()];
        const r = c.getBoundingClientRect();
        this.gesture = 'pan';
        this.panStart = { x: p.x + r.left, y: p.y + r.top, cx: this.cam.x, cy: this.cam.y };
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', (e) => { if (this.gesture === 'tool') this.handlers.cancel?.(); this.gesture = 'none'; this.pointers.delete(e.pointerId); });
    c.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch' && this.gesture === 'none') this.handlers.hover?.(null); });
    c.addEventListener('dblclick', (e) => this.handlers.dblclick?.(this.ev(e)));
  }

  // ---------------------------------------------------------------- frame

  private frame(now: number) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.camTarget) {
      const k = Math.min(1, dt * 6);
      this.cam.x += (this.camTarget.x - this.cam.x) * k;
      this.cam.y += (this.camTarget.y - this.cam.y) * k;
      this.cam.z += (this.camTarget.z - this.cam.z) * k;
      if (Math.abs(this.camTarget.x - this.cam.x) + Math.abs(this.camTarget.y - this.cam.y) < 0.01 && Math.abs(this.camTarget.z - this.cam.z) < 0.05) this.camTarget = null;
    }
    const ctx = this.ctx;
    const { w, h } = this.size;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#0b0a0e';
    ctx.fillRect(0, 0, w, h);
    const map = this.map;
    if (!map) return;
    const z = this.cam.z;
    const ox = w / 2 - this.cam.x * z, oy = h / 2 - this.cam.y * z;
    const x0 = Math.max(0, Math.floor(this.cam.x - w / 2 / z) - 1), x1 = Math.min(map.width - 1, Math.ceil(this.cam.x + w / 2 / z) + 1);
    const y0 = Math.max(0, Math.floor(this.cam.y - h / 2 / z) - 1), y1 = Math.min(map.height - 1, Math.ceil(this.cam.y + h / 2 / z) + 1);
    const pal = PALETTES[map.theme];
    const t = now / 1000;

    // Map body.
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(z / this.px, z / this.px);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Shadow from a plain rectangle under the map: far cheaper than shadowing the image itself.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 30;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.staticCanvas.width, this.staticCanvas.height);
    ctx.restore();
    ctx.drawImage(this.staticCanvas, 0, 0);
    ctx.restore();

    // Water shimmer and lava glow, visible cells only.
    ctx.save();
    ctx.translate(ox, oy); ctx.scale(z, z);
    ctx.lineWidth = 0.05;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const ter = map.terrain[y * map.width + x];
      if (ter === 'water' || ter === 'deepwater') {
        // A few glints that drift and fade, rather than ripples in every square.
        const n = cellNoise(x, y, 77);
        if (n < 0.45) continue;
        const a = Math.max(0, Math.sin(t * (0.8 + n) + n * 40));
        if (a < 0.05) continue;
        ctx.strokeStyle = `rgba(215,240,255,${(0.32 * a).toFixed(3)})`;
        const gx = x + 0.2 + cellNoise(x, y, 78) * 0.5, gy = y + 0.25 + cellNoise(x, y, 79) * 0.5 + Math.sin(t * 0.7 + n * 9) * 0.05;
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.quadraticCurveTo(gx + 0.15, gy - 0.06, gx + 0.3, gy);
        ctx.stroke();
      } else if (ter === 'lava') {
        ctx.fillStyle = `rgba(255,190,70,${0.08 + 0.08 * Math.sin(t * 2 + x * 1.3 + y * 0.7)})`;
        ctx.beginPath(); ctx.arc(x + 0.5, y + 0.5, 0.62, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();

    if (this.dm && map.fog && this.overlay.showFogTint !== false) {
      ctx.save(); ctx.translate(ox, oy); ctx.scale(z / this.px, z / this.px); ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.fogCanvas, 0, 0); ctx.restore();
    }

    // Grid.
    if (map.settings.grid && z >= 7) {
      ctx.save();
      ctx.strokeStyle = `rgba(0,0,0,${map.settings.gridOpacity})`;
      ctx.lineWidth = 1;
      // Only over known ground, so the grid never outlines unexplored space.
      const solid = (x: number, y: number) => x < 0 || y < 0 || x >= map.width || y >= map.height || map.terrain[y * map.width + x] === 'void';
      const gx = (x: number) => Math.round(ox + x * z) + 0.5, gy = (y: number) => Math.round(oy + y * z) + 0.5;
      ctx.beginPath();
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (solid(x, y)) continue;
        ctx.moveTo(gx(x), gy(y)); ctx.lineTo(gx(x + 1), gy(y));
        ctx.moveTo(gx(x), gy(y)); ctx.lineTo(gx(x), gy(y + 1));
        if (solid(x + 1, y)) { ctx.moveTo(gx(x + 1), gy(y)); ctx.lineTo(gx(x + 1), gy(y + 1)); }
        if (solid(x, y + 1)) { ctx.moveTo(gx(x), gy(y + 1)); ctx.lineTo(gx(x + 1), gy(y + 1)); }
      }
      ctx.stroke();
      ctx.restore();
    }

    // Area templates.
    const templates = [...map.templates, ...(this.overlay.draftTemplate ? [this.overlay.draftTemplate] : [])];
    for (const tp of templates) this.drawTemplate(tp, ox, oy, z, map, tp === this.overlay.draftTemplate);

    // Drawings.
    const drawings = [...map.drawings, ...(this.overlay.draftDrawing ? [this.overlay.draftDrawing] : [])];
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const d of drawings) {
      if (d.points.length < 2) continue;
      ctx.globalAlpha = d.hidden ? 0.5 : 0.9;
      ctx.strokeStyle = d.color; ctx.lineWidth = Math.max(1.5, d.width * z * 0.06);
      if (d.hidden) ctx.setLineDash([6, 6]); else ctx.setLineDash([]);
      ctx.beginPath();
      d.points.forEach(([px, py], i) => (i ? ctx.lineTo(ox + px * z, oy + py * z) : ctx.moveTo(ox + px * z, oy + py * z)));
      ctx.stroke();
    }
    ctx.restore();

    // Room names for the DM.
    if (this.dm && this.overlay.showRoomNames && z >= 14) {
      ctx.save();
      ctx.font = `600 ${Math.min(16, Math.max(10, z * 0.32))}px "Cinzel", Georgia, serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const r of map.rooms) {
        const s = { x: ox + (r.x + r.w / 2) * z, y: oy + (r.y + 0.6) * z };
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.strokeText(r.name, s.x, s.y);
        ctx.fillStyle = 'rgba(240,220,170,0.9)'; ctx.fillText(r.name, s.x, s.y);
      }
      ctx.restore();
    }

    // Labels.
    for (const l of map.labels) {
      const s = { x: ox + l.x * z, y: oy + l.y * z };
      ctx.save();
      ctx.globalAlpha = l.hidden ? 0.55 : 1;
      ctx.font = `700 ${Math.max(10, z * 0.42 * l.size)}px "Cinzel", Georgia, serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(l.text, s.x, s.y);
      ctx.fillStyle = l.color; ctx.fillText(l.text, s.x, s.y);
      ctx.restore();
    }

    // Tokens (smallest last so they stay clickable on top of big ones).
    const tokens = map.tokens.slice().sort((a, b) => b.size - a.size);
    const seen = new Set<string>();
    for (const tk of tokens) {
      seen.add(tk.id);
      const target = this.overlay.dragging?.get(tk.id) ?? { x: tk.x, y: tk.y };
      let pos = this.tween.get(tk.id);
      if (!pos) { pos = { ...target }; this.tween.set(tk.id, pos); }
      if (this.overlay.dragging?.has(tk.id)) { pos.x = target.x; pos.y = target.y; }
      else { const k = Math.min(1, dt * 14); pos.x += (target.x - pos.x) * k; pos.y += (target.y - pos.y) * k; }
      this.drawToken(tk, pos.x, pos.y, ox, oy, z, t);
    }
    for (const id of this.tween.keys()) if (!seen.has(id)) this.tween.delete(id);

    // Brush preview / hover.
    const b = this.overlay.brush;
    if (b) {
      const r = Math.floor((b.size - 1) / 2);
      ctx.save(); ctx.strokeStyle = b.color; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
      ctx.strokeRect(ox + (b.x - r) * z, oy + (b.y - r) * z, b.size * z, b.size * z);
      ctx.restore();
    } else if (this.overlay.hoverCell) {
      const hc = this.overlay.hoverCell;
      ctx.save(); ctx.strokeStyle = 'rgba(255,230,160,0.5)'; ctx.lineWidth = 1.5;
      ctx.strokeRect(ox + hc.x * z + 1, oy + hc.y * z + 1, z - 2, z - 2); ctx.restore();
    }

    // Ruler.
    const ru = this.overlay.ruler;
    if (ru) this.drawRuler(ru, ox, oy, z);

    // Pings.
    for (const p of this.overlay.pings ?? []) {
      const age = (now - p.t0) / 1000;
      if (age > 2.2) continue;
      const s = { x: ox + (p.x + 0.5) * z, y: oy + (p.y + 0.5) * z };
      for (let k = 0; k < 3; k++) {
        const a = age - k * 0.25;
        if (a < 0 || a > 1.4) continue;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - a / 1.4);
        ctx.strokeStyle = p.color; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(s.x, s.y, 6 + a * z * 1.6, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, Math.PI * 2); ctx.fill();
    }

    this.drawAmbience(map.settings.ambience, dt, w, h, t);
  }

  private drawTemplate(tp: AreaTemplate, ox: number, oy: number, z: number, map: RenderMap, draft: boolean) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = tp.hidden ? 0.5 : 1;
    ctx.fillStyle = hexA(tp.color, 0.28);
    for (const c of templateCells(tp, map)) {
      const x = c % map.width, y = Math.floor(c / map.width);
      ctx.fillRect(ox + x * z, oy + y * z, z, z);
    }
    ctx.strokeStyle = tp.color; ctx.lineWidth = 2;
    if (draft || tp.hidden) ctx.setLineDash([6, 4]);
    const o = { x: ox + tp.x * z, y: oy + tp.y * z };
    const len = (tp.sizeFt / 5) * z;
    const a = (tp.angle * Math.PI) / 180;
    ctx.beginPath();
    if (tp.shape === 'circle') ctx.arc(o.x, o.y, len, 0, Math.PI * 2);
    else if (tp.shape === 'square') ctx.rect(o.x - len / 2, o.y - len / 2, len, len);
    else if (tp.shape === 'line') {
      const dx = Math.cos(a), dy = Math.sin(a), nx = -dy * z * 0.5, ny = dx * z * 0.5;
      ctx.moveTo(o.x + nx, o.y + ny); ctx.lineTo(o.x + dx * len + nx, o.y + dy * len + ny);
      ctx.lineTo(o.x + dx * len - nx, o.y + dy * len - ny); ctx.lineTo(o.x - nx, o.y - ny); ctx.closePath();
    } else {
      const half = Math.atan(0.5);
      ctx.moveTo(o.x, o.y);
      ctx.arc(o.x, o.y, len, a - half, a + half);
      ctx.closePath();
    }
    ctx.stroke();
    ctx.setLineDash([]);
    const label = `${tp.sizeFt} ft${tp.label ? ` · ${tp.label}` : ''}`;
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.strokeText(label, o.x, o.y - 12);
    ctx.fillStyle = '#fff'; ctx.fillText(label, o.x, o.y - 12);
    ctx.restore();
  }

  private drawToken(tk: RenderToken, x: number, y: number, ox: number, oy: number, z: number, t: number) {
    const ctx = this.ctx;
    const size = tk.size * z;
    const cx = ox + x * z + size / 2, cy = oy + y * z + size / 2;
    const r = size * 0.42;
    const selected = this.overlay.selectedTokenId === tk.id || this.overlay.selectedIds?.has(tk.id);
    const active = this.map?.activeTokenId === tk.id;
    ctx.save();
    if (tk.hidden) ctx.globalAlpha = 0.5;

    if (active) {
      const pulse = 0.5 + 0.5 * Math.sin(t * 4);
      ctx.save();
      ctx.shadowColor = '#facc15'; ctx.shadowBlur = 18 + pulse * 10;
      ctx.strokeStyle = `rgba(250,204,21,${0.7 + pulse * 0.3})`; ctx.lineWidth = Math.max(3, z * 0.08);
      ctx.beginPath(); ctx.arc(cx, cy, r + Math.max(4, z * 0.1), 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // Body.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = z * 0.15; ctx.shadowOffsetY = z * 0.05;
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
    g.addColorStop(0, lighten(tk.color, 0.35)); g.addColorStop(1, tk.color);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.lineWidth = Math.max(2, z * 0.06);
    ctx.strokeStyle = tk.kind === 'enemy' ? '#7f1d1d' : tk.kind === 'player' ? '#dbeafe' : tk.kind === 'ally' ? '#14532d' : '#713f12';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();

    // Face: a picture, or else emoji or initials.
    const pic = tk.image ? tokenImage(tk.image) : null;
    if (pic) {
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, r - ctx.lineWidth / 2, 0, Math.PI * 2); ctx.clip();
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(pic, cx - r, cy - r, r * 2, r * 2);
      ctx.restore();
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    } else {
      const emoji = /\p{Extended_Pictographic}/u.test(tk.label);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = emoji ? `${r * 1.15}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif` : `700 ${r * (tk.label.length > 2 ? 0.7 : 0.9)}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = '#fff';
      if (!emoji) { ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.strokeText(tk.label, cx, cy + r * 0.04); }
      ctx.fillText(tk.label, cx, cy + r * (emoji ? 0.08 : 0.04));
    }

    if (tk.down) {
      ctx.fillStyle = 'rgba(20,20,20,0.6)';
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#ef4444'; ctx.lineWidth = Math.max(2, z * 0.07);
      ctx.beginPath(); ctx.moveTo(cx - r * 0.5, cy - r * 0.5); ctx.lineTo(cx + r * 0.5, cy + r * 0.5); ctx.moveTo(cx + r * 0.5, cy - r * 0.5); ctx.lineTo(cx - r * 0.5, cy + r * 0.5); ctx.stroke();
    }

    if (selected) {
      ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.arc(cx, cy, r + 5, t * 0.8, t * 0.8 + Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }

    // Condition pips around the rim.
    tk.conditions.slice(0, 8).forEach((c, i) => {
      const a = -Math.PI / 2 + Math.PI * 0.25 + i * (Math.PI / 5);
      const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
      const pr = Math.max(4, z * 0.11);
      ctx.fillStyle = conditionColor(c);
      ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke();
      if (pr >= 6) {
        ctx.fillStyle = '#111'; ctx.font = `700 ${pr * 1.2}px Inter, system-ui, sans-serif`;
        ctx.fillText(c[0].toUpperCase(), px, py + 0.5);
      }
    });

    // HP bar.
    if (tk.hpRatio !== null && z >= 14) {
      const bw = size * 0.8, bh = Math.max(3, z * 0.09);
      const bx = cx - bw / 2, by = cy + r + Math.max(2, z * 0.04);
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; roundRect(ctx, bx - 1, by - 1, bw + 2, bh + 2, 2); ctx.fill();
      const ratio = Math.max(0, Math.min(1, tk.hpRatio));
      ctx.fillStyle = ratio > 0.5 ? '#22c55e' : ratio > 0.25 ? '#f59e0b' : '#ef4444';
      roundRect(ctx, bx, by, bw * ratio, bh, 2); ctx.fill();
    }

    // Name plate when zoomed in or selected.
    // Players have party chips for names and HP, so their map stays clean.
    const showName = selected || this.hoverToken === tk.id || (this.dm && z >= 44);
    if (showName) {
      const text = tk.hpText ? `${tk.name} · ${tk.hpText}` : tk.name;
      ctx.font = `600 ${Math.max(10, Math.min(13, z * 0.26))}px Inter, system-ui, sans-serif`;
      const tw = ctx.measureText(text).width + 10;
      const ny = cy - r - Math.max(10, z * 0.28);
      ctx.fillStyle = 'rgba(12,10,16,0.82)';
      roundRect(ctx, cx - tw / 2, ny - 9, tw, 18, 9); ctx.fill();
      ctx.fillStyle = '#f4ead5';
      ctx.fillText(text, cx, ny + 0.5);
    }
    ctx.restore();
  }

  private drawRuler(ru: NonNullable<Overlay['ruler']>, ox: number, oy: number, z: number) {
    const ctx = this.ctx;
    const a = { x: ox + (ru.from.x + 0.5) * z, y: oy + (ru.from.y + 0.5) * z };
    const b = { x: ox + (ru.to.x + 0.5) * z, y: oy + (ru.to.y + 0.5) * z };
    ctx.save();
    ctx.fillStyle = 'rgba(250,204,21,0.18)';
    ctx.fillRect(ox + ru.to.x * z, oy + ru.to.y * z, z, z);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.strokeStyle = '#facc15'; ctx.lineWidth = 3; ctx.setLineDash([10, 6]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#facc15';
    for (const p of [a, b]) { ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill(); }
    ctx.font = '700 14px Inter, system-ui, sans-serif';
    const tw = ctx.measureText(ru.text).width + 16;
    const lx = b.x + 14, ly = b.y - 26;
    ctx.fillStyle = 'rgba(12,10,16,0.92)'; roundRect(ctx, lx, ly, tw, 24, 12); ctx.fill();
    ctx.strokeStyle = '#facc15'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(ru.text, lx + 8, ly + 12.5);
    ctx.restore();
  }

  private drawAmbience(kind: string, dt: number, w: number, h: number, t: number) {
    const ctx = this.ctx;
    if (kind === 'none') { this.particles.length = 0; return; }
    if (kind === 'dark') {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
      g.addColorStop(0, 'rgba(5,5,20,0.35)'); g.addColorStop(1, 'rgba(0,0,8,0.8)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      return;
    }
    const target = kind === 'rain' ? 260 : kind === 'snow' ? 160 : kind === 'embers' ? 70 : 14;
    while (this.particles.length < target) this.particles.push(this.spawn(kind, w, h, true));
    if (this.particles.length > target) this.particles.length = target;
    ctx.save();
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.y > h + 40 || p.y < -60 || p.x < -80 || p.x > w + 80 || p.life <= 0) { this.particles[i] = this.spawn(kind, w, h, false); continue; }
      if (kind === 'rain') {
        ctx.strokeStyle = 'rgba(170,200,255,0.45)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); ctx.stroke();
      } else if (kind === 'snow') {
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath(); ctx.arc(p.x + Math.sin(t + i) * 8, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      } else if (kind === 'embers') {
        ctx.fillStyle = `rgba(255,${120 + (i % 5) * 20},40,${Math.min(1, p.life)})`;
        ctx.beginPath(); ctx.arc(p.x + Math.sin(t * 2 + i) * 6, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      } else if (kind === 'fog') {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0, 'rgba(200,210,220,0.16)'); g.addColorStop(1, 'rgba(200,210,220,0)');
        ctx.fillStyle = g; ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
      }
    }
    ctx.restore();
  }

  private spawn(kind: string, w: number, h: number, anywhere: boolean): Particle {
    const R = Math.random;
    if (kind === 'rain') return { x: R() * (w + 100), y: anywhere ? R() * h : -20, vx: -120, vy: 900 + R() * 300, r: 1, life: 5 };
    if (kind === 'snow') return { x: R() * w, y: anywhere ? R() * h : -10, vx: 10 + R() * 20, vy: 30 + R() * 40, r: 1 + R() * 2.2, life: 60 };
    if (kind === 'embers') return { x: R() * w, y: anywhere ? R() * h : h + 10, vx: (R() - 0.5) * 20, vy: -(40 + R() * 60), r: 1 + R() * 2, life: 3 + R() * 6 };
    return { x: anywhere ? R() * w : -200, y: R() * h, vx: 12 + R() * 18, vy: (R() - 0.5) * 4, r: 160 + R() * 220, life: 120 };
  }
}

const COND_COLORS: Record<string, string> = {
  poisoned: '#84cc16', prone: '#a16207', stunned: '#facc15', paralyzed: '#eab308', blinded: '#64748b', charmed: '#ec4899',
  frightened: '#a855f7', grappled: '#f97316', restrained: '#ea580c', invisible: '#cbd5e1', unconscious: '#475569',
  concentrating: '#38bdf8', blessed: '#fde68a', hasted: '#22d3ee', raging: '#dc2626', deafened: '#94a3b8',
};
export const conditionColor = (c: string) => COND_COLORS[c] ?? '#e5e7eb';

function hexA(hex: string, a: number) {
  if (!hex.startsWith('#') || hex.length < 7) return `rgba(255,255,255,${a})`;
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function lighten(hex: string, amt: number) {
  if (!hex.startsWith('#') || hex.length < 7) return hex;
  const n = parseInt(hex.slice(1, 7), 16);
  const f = (v: number) => Math.round(v + (255 - v) * amt);
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

const pictures = new Map<string, HTMLImageElement | null>();
/** A loaded token picture, or null while it loads (the label shows meanwhile). */
function tokenImage(src: string): HTMLImageElement | null {
  const hit = pictures.get(src);
  if (hit !== undefined) return hit && hit.complete && hit.naturalWidth ? hit : null;
  const im = new Image();
  im.decoding = 'async';
  im.onerror = () => pictures.set(src, null);
  im.src = src;
  pictures.set(src, im);
  if (pictures.size > 400) pictures.delete(pictures.keys().next().value!);
  return null;
}
