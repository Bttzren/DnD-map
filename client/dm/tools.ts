// Turns pointer input on the DM's map into ops, per tool.
import { distanceFt } from '../../shared/distance';
import { DIRS8, footprint, idx, inBounds, isOpen } from '../../shared/grid';
import { templateCells } from '../../shared/templates';
import { uid, type AreaTemplate, type Drawing, type MapData, type Terrain, type Token } from '../../shared/types';
import type { CellEvent, MapView } from '../render/mapView';
import { promptDialog } from '../ui';
import type { DmCtl, Selection } from './state';

export function tokenAt(map: MapData, x: number, y: number): Token | undefined {
  // Smallest first, so a goblin standing next to a dragon is still grabbable.
  return map.tokens.slice().sort((a, b) => a.size - b.size).find((t) => x >= t.x && x < t.x + t.size && y >= t.y && y < t.y + t.size);
}

function otherAt(map: MapData, fx: number, fy: number): Selection | null {
  const l = map.labels.find((l) => Math.abs(l.x - fx) < 1.2 && Math.abs(l.y - fy) < 0.6);
  if (l) return { coll: 'labels', id: l.id };
  const t = templateAt(map, fx, fy);
  if (t) return { coll: 'templates', id: t.id };
  const d = map.drawings.find((d) => d.points.some(([x, y]) => Math.hypot(x - fx, y - fy) < 0.45));
  if (d) return { coll: 'drawings', id: d.id };
  return null;
}

/** A spell area at this point: near its origin, or (newest first) covering the square. */
export function templateAt(map: MapData, fx: number, fy: number): AreaTemplate | undefined {
  const near = map.templates.find((t) => Math.hypot(t.x - fx, t.y - fy) < 0.8);
  if (near) return near;
  const c = Math.floor(fy) * map.width + Math.floor(fx);
  return map.templates.slice().reverse().find((t) => templateCells(t, map).includes(c));
}

/** Cells along a line between two cells (inclusive), for smooth brush strokes. */
function line(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number }[] {
  const out = [];
  let x = a.x, y = a.y;
  const dx = Math.abs(b.x - a.x), dy = -Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1, sy = a.y < b.y ? 1 : -1;
  let err = dx + dy;
  for (let i = 0; i < 500; i++) {
    out.push({ x, y });
    if (x === b.x && y === b.y) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return out;
}

function brushCells(map: MapData, x: number, y: number, size: number): number[] {
  const r = Math.floor((size - 1) / 2);
  const out: number[] = [];
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
    const cx = x - r + dx, cy = y - r + dy;
    if (inBounds(map, cx, cy)) out.push(idx(map, cx, cy));
  }
  return out;
}

export function attachTools(view: MapView, ctl: DmCtl) {
  let last: { x: number; y: number } | null = null;
  let drag: { ids: string[]; start: { x: number; y: number }; moved: boolean; origin: Map<string, { x: number; y: number }> } | null = null;
  let pendingDoorTap = false;
  let rulerFrom: { x: number; y: number } | null = null;
  let tplDraft: AreaTemplate | null = null;
  /** A placed spell area being dragged to a new spot. */
  let tplMove: { id: string; fx: number; fy: number; x: number; y: number } | null = null;
  let drawing: Drawing | null = null;
  let stroking = false;

  const setOverlay = (patch: Partial<typeof view.overlay>) => { view.overlay = { ...view.overlay, ...patch }; };

  const paint = (map: MapData, cells: number[], terrain: Terrain) => {
    const changes: [number, Terrain][] = cells.filter((c) => map.terrain[c] !== terrain).map((c) => [c, terrain]);
    // Auto-walls: wrap newly opened ground in wall where it meets solid rock.
    if (ctl.state.opts.autoWalls && map.theme !== 'forest' && (isOpen(terrain) || ['lava', 'deepwater', 'pit'].includes(terrain))) {
      const painted = new Set(cells);
      for (const c of cells) {
        const x = c % map.width, y = Math.floor(c / map.width);
        for (const [dx, dy] of DIRS8) {
          const nx = x + dx, ny = y + dy;
          if (!inBounds(map, nx, ny)) continue;
          const n = idx(map, nx, ny);
          if (!painted.has(n) && map.terrain[n] === 'void') { changes.push([n, 'wall']); painted.add(n); }
        }
      }
    }
    if (changes.length) ctl.dispatch({ t: 'terrain.set', mapId: map.id, cells: changes });
    // Doors can't sit in solid terrain.
    if (!isOpen(terrain)) for (const d of map.doors) if (cells.includes(idx(map, d.x, d.y))) ctl.dispatch({ t: 'item.delete', mapId: map.id, coll: 'doors', id: d.id });
  };

  const fog = (map: MapData, cells: number[], reveal: boolean) => {
    const changes = cells.filter((c) => (map.fog[c] === 1) !== reveal);
    if (changes.length) ctl.dispatch({ t: 'fog.set', mapId: map.id, cells: changes, revealed: reveal });
  };

  const roomCellsWithWalls = (map: MapData, x: number, y: number): number[] | null => {
    const c = idx(map, x, y);
    const room = map.rooms.find((r) => r.cells.includes(c));
    if (!room) return null;
    const set = new Set(room.cells);
    for (const rc of room.cells) {
      const rx = rc % map.width, ry = Math.floor(rc / map.width);
      for (const [dx, dy] of DIRS8) if (inBounds(map, rx + dx, ry + dy)) set.add(idx(map, rx + dx, ry + dy));
    }
    return [...set];
  };

  const brushPreview = (e: CellEvent | null) => {
    const { tool, opts } = ctl.state;
    if (!e) return setOverlay({ brush: null, hoverCell: null });
    if (tool === 'paint') setOverlay({ brush: { x: e.x, y: e.y, size: opts.brush, color: '#facc15' }, hoverCell: null });
    else if (tool === 'fog' && opts.fogShape === 'brush') setOverlay({ brush: { x: e.x, y: e.y, size: opts.brush, color: opts.fogMode === 'reveal' ? '#7dd3fc' : '#a78bfa' }, hoverCell: null });
    else setOverlay({ brush: null, hoverCell: tool === 'select' ? null : { x: e.x, y: e.y } });
  };

  const templateFrom = (e: CellEvent): AreaTemplate => {
    const { opts } = ctl.state;
    const snap = opts.tplShape === 'circle' || opts.tplShape === 'square';
    return {
      id: uid('tpl'), shape: opts.tplShape, x: snap ? Math.round(e.fx) : Math.round(e.fx * 2) / 2, y: snap ? Math.round(e.fy) : Math.round(e.fy * 2) / 2,
      sizeFt: opts.tplSize, angle: 0, color: opts.tplColor, hidden: false,
      ...(opts.tplLabel ? { label: opts.tplLabel } : {}), ...(opts.tplEffect !== 'plain' ? { effect: opts.tplEffect } : {}),
    };
  };

  view.handlers = {
    hover: brushPreview,

    down(e) {
      const map = ctl.map;
      if (!map) return false;
      const { tool, opts } = ctl.state;
      last = { x: e.x, y: e.y };
      switch (tool) {
        case 'select': {
          const t = tokenAt(map, e.x, e.y);
          if (t) {
            let ids = ctl.state.selected;
            if (e.shift) ids = ids.includes(t.id) ? ids.filter((i) => i !== t.id) : [...ids, t.id];
            else if (!ids.includes(t.id)) ids = [t.id];
            ctl.set({ selected: ids, other: null });
            const moving = ids.includes(t.id) ? ids : [t.id];
            drag = {
              ids: moving, start: { x: e.x, y: e.y }, moved: false,
              origin: new Map(moving.map((id) => { const tk = map.tokens.find((x) => x.id === id)!; return [id, { x: tk.x, y: tk.y }]; })),
            };
            return true;
          }
          const o = otherAt(map, e.fx, e.fy);
          if (o) {
            ctl.set({ other: o, selected: [] });
            const tp = o.coll === 'templates' ? map.templates.find((x) => x.id === o.id) : undefined;
            if (tp) { tplMove = { id: tp.id, fx: e.fx, fy: e.fy, x: tp.x, y: tp.y }; ctl.begin(); }
            return true;
          }
          if (map.doors.some((d) => d.x === e.x && d.y === e.y)) { pendingDoorTap = true; return true; }
          if (!e.shift) ctl.set({ selected: [], other: null });
          return false;
        }
        case 'paint': {
          if (e.alt) { ctl.setOpts({ terrain: map.terrain[idx(map, e.x, e.y)] }); return true; }
          ctl.begin(); stroking = true;
          paint(map, brushCells(map, e.x, e.y, opts.brush), opts.terrain);
          return true;
        }
        case 'fog': {
          const reveal = (opts.fogMode === 'reveal') !== e.alt;
          if (opts.fogShape === 'room') {
            const cells = roomCellsWithWalls(map, e.x, e.y);
            if (cells) { fog(map, cells, reveal); return true; }
          }
          ctl.begin(); stroking = true;
          fog(map, brushCells(map, e.x, e.y, opts.brush), reveal);
          return true;
        }
        case 'ruler': {
          const t = tokenAt(map, e.x, e.y);
          rulerFrom = t ? { x: t.x + (t.size - 1) / 2, y: t.y + (t.size - 1) / 2 } : { x: e.x, y: e.y };
          return true;
        }
        case 'template': {
          // Grabbing an existing area's centre moves it instead of making a new one.
          const tp = map.templates.find((x) => Math.hypot(x.x - e.fx, x.y - e.fy) < 0.6);
          if (tp) { ctl.set({ other: { coll: 'templates', id: tp.id }, selected: [] }); tplMove = { id: tp.id, fx: e.fx, fy: e.fy, x: tp.x, y: tp.y }; ctl.begin(); return true; }
          tplDraft = templateFrom(e); setOverlay({ draftTemplate: tplDraft }); return true;
        }
        case 'draw':
          drawing = { id: uid('drw'), points: [[e.fx, e.fy]], color: opts.drawColor, width: opts.drawWidth, hidden: opts.drawHidden };
          setOverlay({ draftDrawing: drawing });
          return true;
        default: return true; // door, object, label, ping act on tap
      }
    },

    move(e) {
      const map = ctl.map;
      if (!map || !last) return;
      const { tool, opts } = ctl.state;
      const prev = last;
      last = { x: e.x, y: e.y };
      if (tplMove) {
        const tp = map.templates.find((x) => x.id === tplMove!.id);
        if (!tp) return;
        const snap = tp.shape === 'circle' || tp.shape === 'square' ? 1 : 2;
        const nx = Math.round((tplMove.x + e.fx - tplMove.fx) * snap) / snap, ny = Math.round((tplMove.y + e.fy - tplMove.fy) * snap) / snap;
        if (nx !== tp.x || ny !== tp.y) ctl.dispatch({ t: 'item.put', mapId: map.id, coll: 'templates', item: { ...tp, x: nx, y: ny } });
        return;
      }
      if (tool === 'select' && drag) {
        const dx = e.x - drag.start.x, dy = e.y - drag.start.y;
        if (dx || dy) drag.moved = true;
        const positions = new Map<string, { x: number; y: number }>();
        for (const id of drag.ids) {
          const o = drag.origin.get(id)!;
          const tk = map.tokens.find((t) => t.id === id);
          const s = tk?.size ?? 1;
          positions.set(id, { x: Math.max(0, Math.min(map.width - s, o.x + dx)), y: Math.max(0, Math.min(map.height - s, o.y + dy)) });
        }
        setOverlay({ dragging: positions });
        const lead = drag.ids[0], o = drag.origin.get(lead)!, n = positions.get(lead)!;
        const ft = distanceFt(o, n, map.settings.distanceRule);
        setOverlay({ ruler: ft ? { from: o, to: n, text: `${ft} ft` } : null });
        return;
      }
      if (tool === 'paint' && stroking) {
        const cells = new Set<number>();
        for (const p of line(prev, last)) for (const c of brushCells(map, p.x, p.y, opts.brush)) cells.add(c);
        paint(map, [...cells], opts.terrain);
        brushPreview(e);
        return;
      }
      if (tool === 'fog' && stroking) {
        const cells = new Set<number>();
        for (const p of line(prev, last)) for (const c of brushCells(map, p.x, p.y, opts.brush)) cells.add(c);
        fog(map, [...cells], (opts.fogMode === 'reveal') !== e.alt);
        brushPreview(e);
        return;
      }
      if (tool === 'ruler' && rulerFrom) {
        const ft = distanceFt(rulerFrom, { x: e.x, y: e.y }, map.settings.distanceRule);
        setOverlay({ ruler: { from: rulerFrom, to: { x: e.x, y: e.y }, text: `${ft} ft · ${ft / 5} sq` } });
        return;
      }
      if (tool === 'template' && tplDraft) {
        const dx = e.fx - tplDraft.x, dy = e.fy - tplDraft.y;
        if (tplDraft.shape === 'circle' || tplDraft.shape === 'square') {
          const d = tplDraft.shape === 'circle' ? Math.hypot(dx, dy) : Math.max(Math.abs(dx), Math.abs(dy)) * 2;
          if (d > 0.6) tplDraft = { ...tplDraft, sizeFt: Math.max(5, Math.round(d) * 5) };
        } else if (Math.hypot(dx, dy) > 0.4) {
          tplDraft = { ...tplDraft, angle: Math.round((Math.atan2(dy, dx) * 180) / Math.PI / 15) * 15 };
        }
        setOverlay({ draftTemplate: tplDraft });
        return;
      }
      if (tool === 'draw' && drawing) {
        const lp = drawing.points[drawing.points.length - 1];
        if (Math.hypot(e.fx - lp[0], e.fy - lp[1]) > 0.12) {
          drawing = { ...drawing, points: [...drawing.points, [e.fx, e.fy]] };
          setOverlay({ draftDrawing: drawing });
        }
      }
    },

    up() {
      const map = ctl.map;
      const { tool } = ctl.state;
      if (map && tool === 'select' && drag) {
        if (drag.moved && view.overlay.dragging) {
          ctl.begin();
          for (const [id, pos] of view.overlay.dragging) {
            const tk = map.tokens.find((t) => t.id === id);
            if (tk && (tk.x !== pos.x || tk.y !== pos.y)) ctl.dispatch({ t: 'item.put', mapId: map.id, coll: 'tokens', item: { ...tk, ...pos } });
          }
          ctl.end();
        }
        drag = null;
        setOverlay({ dragging: undefined, ruler: null });
      }
      if (stroking) { ctl.end(); stroking = false; }
      if (tplMove) { ctl.end(); tplMove = null; }
      if (map && tool === 'ruler') { rulerFrom = null; setTimeout(() => { if (!rulerFrom) setOverlay({ ruler: null }); }, 1500); }
      if (map && tool === 'template' && tplDraft) {
        ctl.dispatch({ t: 'item.put', mapId: map.id, coll: 'templates', item: tplDraft });
        ctl.set({ other: { coll: 'templates', id: tplDraft.id } });
        tplDraft = null; setOverlay({ draftTemplate: null });
      }
      if (map && tool === 'draw' && drawing) {
        if (drawing.points.length > 1) ctl.dispatch({ t: 'item.put', mapId: map.id, coll: 'drawings', item: drawing });
        drawing = null; setOverlay({ draftDrawing: null });
      }
      last = null;
    },

    cancel() {
      if (stroking) { ctl.end(); stroking = false; }
      drag = null; rulerFrom = null; tplDraft = null; drawing = null; pendingDoorTap = false;
      setOverlay({ dragging: undefined, ruler: null, draftTemplate: null, draftDrawing: null });
    },

    async tap(e) {
      const map = ctl.map;
      if (!map) return;
      const { tool, opts } = ctl.state;
      const door = map.doors.find((d) => d.x === e.x && d.y === e.y);
      if (tool === 'select' && pendingDoorTap && door) {
        pendingDoorTap = false;
        if (door.state !== 'secret') ctl.dispatch({ t: 'item.put', mapId: map.id, coll: 'doors', item: { ...door, state: door.state === 'open' ? 'closed' : 'open' } });
        return;
      }
      pendingDoorTap = false;
      if (tool === 'door') {
        if (door) {
          if (e.shift || door.state === 'secret') ctl.dispatch({ t: 'item.delete', mapId: map.id, coll: 'doors', id: door.id });
          else ctl.dispatch({ t: 'item.put', mapId: map.id, coll: 'doors', item: { ...door, state: door.state === 'closed' ? 'open' : 'secret' } });
        } else {
          ctl.begin();
          if (!isOpen(map.terrain[idx(map, e.x, e.y)])) ctl.dispatch({ t: 'terrain.set', mapId: map.id, cells: [[idx(map, e.x, e.y), 'floor']] });
          ctl.dispatch({ t: 'item.put', mapId: map.id, coll: 'doors', item: { id: uid('door'), x: e.x, y: e.y, state: opts.doorState } });
          ctl.end();
        }
      } else if (tool === 'object') {
        const existing = map.objects.find((o) => o.x === e.x && o.y === e.y);
        if (existing) {
          if (e.alt) ctl.dispatch({ t: 'item.put', mapId: map.id, coll: 'objects', item: { ...existing, hidden: !existing.hidden } });
          else ctl.dispatch({ t: 'item.delete', mapId: map.id, coll: 'objects', id: existing.id });
        } else {
          ctl.dispatch({ t: 'item.put', mapId: map.id, coll: 'objects', item: { id: uid('obj'), x: e.x, y: e.y, kind: opts.objectKind, ...(opts.objectHidden ? { hidden: true } : {}) } });
        }
      } else if (tool === 'label') {
        const text = await promptDialog('Label text', '', 'Place label');
        if (text?.trim()) ctl.dispatch({ t: 'item.put', mapId: map.id, coll: 'labels', item: { id: uid('lbl'), x: e.fx, y: e.fy, text: text.trim().slice(0, 60), color: opts.labelColor, size: 1, hidden: opts.labelHidden } });
      } else if (tool === 'ping') {
        ctl.ping(e.x, e.y, e.shift);
      }
    },

    dblclick(e) {
      const map = ctl.map;
      if (!map || ctl.state.tool !== 'select') return;
      const t = tokenAt(map, e.x, e.y);
      if (t) view.centerOn(t.x + t.size / 2, t.y + t.size / 2);
    },

    camera(c) {
      const { w } = view.size;
      ctl.sendView(c.x, c.y, w / c.z);
    },
  };
}

/** Find free cells near (x,y) for `n` tokens of a given size. */
export function freeSpots(map: MapData, x: number, y: number, n: number, size = 1): { x: number; y: number }[] {
  const taken = new Set<number>();
  for (const t of map.tokens) for (const c of footprint(map, t.x, t.y, t.size)) taken.add(c);
  for (const o of map.objects) taken.add(idx(map, o.x, o.y));
  const out: { x: number; y: number }[] = [];
  const ok = (cx: number, cy: number) => {
    const fp = footprint(map, cx, cy, size);
    return fp.length === size * size && fp.every((c) => !taken.has(c) && isOpen(map.terrain[c]));
  };
  for (let r = 0; r < Math.max(map.width, map.height) && out.length < n; r++) {
    for (let dy = -r; dy <= r && out.length < n; dy++) for (let dx = -r; dx <= r && out.length < n; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const cx = x + dx, cy = y + dy;
      if (!inBounds(map, cx, cy) || !ok(cx, cy)) continue;
      out.push({ x: cx, y: cy });
      for (const c of footprint(map, cx, cy, size)) taken.add(c);
    }
  }
  return out;
}
