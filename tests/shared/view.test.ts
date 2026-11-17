import { beforeEach, describe, expect, it } from 'vitest';
import { applyOp } from '../../shared/ops';
import { templateCells } from '../../shared/templates';
import { playerView } from '../../shared/view';
import { blankMap, defaultScreen, makeToken, type Game, type MapData } from '../../shared/types';
import { idx } from '../../shared/grid';

function game(): Game {
  const m = blankMap({ width: 12, height: 10, theme: 'dungeon', name: 'Test', fill: 'floor' });
  for (let x = 0; x < 12; x++) m.terrain[idx(m, x, 0)] = 'wall';
  m.rooms = [{ id: 'r1', name: 'SECRET-ROOM-NAME', note: 'SECRET-NOTE', x: 0, y: 0, w: 12, h: 10, cells: [] }];
  return { code: 'ABC123', maps: [m], liveMapId: m.id, screen: defaultScreen(), createdAt: 0, updatedAt: 0 };
}
const reveal = (m: MapData, x0: number, y0: number, x1: number, y1: number) => {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) m.fog[idx(m, x, y)] = 1;
};

describe('playerView', () => {
  let g: Game; let m: MapData;
  beforeEach(() => { g = game(); m = g.maps[0]; reveal(m, 0, 0, 5, 9); });

  it('shows nothing when there is no live map or the screen is blank', () => {
    expect(playerView({ ...g, liveMapId: null }).map).toBeNull();
    g.screen.blank = true;
    expect(playerView(g).map).toBeNull();
    expect(playerView(g).screen.blank).toBe(true);
  });

  it('blanks unrevealed terrain', () => {
    const v = playerView(g).map!;
    expect(v.terrain[idx(m, 1, 1)]).toBe('floor');
    expect(v.terrain[idx(m, 9, 5)]).toBe('void');
  });

  it('drops hidden tokens, tokens in fog, notes, and room data', () => {
    m.tokens.push(
      makeToken({ name: 'Visible', x: 2, y: 2 }),
      makeToken({ name: 'HIDDEN-TOKEN', x: 3, y: 3, hidden: true }),
      makeToken({ name: 'FOGGED-TOKEN', x: 9, y: 5 }),
      makeToken({ name: 'Noted', x: 1, y: 1, note: 'SECRET-TOKEN-NOTE' }),
    );
    const v = playerView(g);
    expect(v.map!.tokens.map((t) => t.name).sort()).toEqual(['Noted', 'Visible']);
    const json = JSON.stringify(v);
    for (const s of ['HIDDEN-TOKEN', 'FOGGED-TOKEN', 'SECRET-TOKEN-NOTE', 'SECRET-ROOM-NAME', 'SECRET-NOTE']) expect(json).not.toContain(s);
  });

  it('always shows visible player tokens even in fog', () => {
    m.tokens.push(makeToken({ name: 'Hero', kind: 'player', x: 9, y: 5 }));
    expect(playerView(g).map!.tokens.map((t) => t.name)).toEqual(['Hero']);
  });

  it('lets players see the squares their own tokens stand on, but not hidden ones', () => {
    m.tokens.push(makeToken({ name: 'Hero', kind: 'player', x: 9, y: 5 }));
    m.tokens.push(makeToken({ name: 'Scout', kind: 'player', x: 10, y: 8, hidden: true }));
    const v = playerView(g).map!;
    expect(v.terrain[idx(m, 9, 5)]).toBe('floor');
    expect(v.terrain[idx(m, 10, 6)]).toBe('void');
    expect(v.terrain[idx(m, 10, 8)]).toBe('void');
  });

  it('shows a large token if any covered cell is revealed', () => {
    m.tokens.push(makeToken({ name: 'Dragon', size: 2, x: 5, y: 4 }));
    m.tokens.push(makeToken({ name: 'Ogre', size: 2, x: 7, y: 4 }));
    expect(playerView(g).map!.tokens.map((t) => t.name)).toEqual(['Dragon']);
  });

  it('turns secret doors into wall and hides hidden traps', () => {
    m.doors.push({ id: 'd1', x: 2, y: 5, state: 'secret' }, { id: 'd2', x: 3, y: 5, state: 'closed' });
    m.objects.push({ id: 'o1', x: 1, y: 4, kind: 'trap', hidden: true }, { id: 'o2', x: 1, y: 5, kind: 'chest' });
    const v = playerView(g).map!;
    expect(v.doors.map((d) => d.id)).toEqual(['d2']);
    expect(v.terrain[idx(m, 2, 5)]).toBe('wall');
    expect(v.objects.map((o) => o.id)).toEqual(['o2']);
  });

  it('shows walls next to revealed cells', () => {
    m.fog.fill(0);
    m.fog[idx(m, 3, 1)] = 1;
    const v = playerView(g).map!;
    expect(v.terrain[idx(m, 3, 0)]).toBe('wall');
    expect(v.terrain[idx(m, 3, 2)]).toBe('void');
  });

  it('reports hp according to visibility', () => {
    m.tokens.push(
      makeToken({ name: 'A', x: 1, y: 1, hp: 4, maxHp: 10, hpVisibility: 'vague' }),
      makeToken({ name: 'B', x: 1, y: 2, hp: 4, maxHp: 10, hpVisibility: 'exact' }),
      makeToken({ name: 'C', x: 1, y: 3, hp: 4, maxHp: 10, hpVisibility: 'bar' }),
      makeToken({ name: 'D', x: 1, y: 4, hp: 4, maxHp: 10, hpVisibility: 'none' }),
    );
    const t = Object.fromEntries(playerView(g).map!.tokens.map((x) => [x.name, x]));
    expect(t.A.hpLabel).toBe('bloodied');
    expect(t.A.hp).toBeNull();
    expect(t.A.hpBar).toBeNull();
    expect(t.B.hp).toEqual({ cur: 4, max: 10 });
    expect(t.C.hpBar).toBeCloseTo(0.4);
    expect(t.C.hp).toBeNull();
    expect([t.D.hp, t.D.hpBar, t.D.hpLabel]).toEqual([null, null, null]);
  });

  it('filters initiative to visible tokens and hides it when asked', () => {
    const a = makeToken({ name: 'A', x: 1, y: 1 });
    const h = makeToken({ name: 'HIDDEN-INIT', x: 1, y: 2, hidden: true });
    m.tokens.push(a, h);
    m.initiative = { entries: [{ tokenId: h.id, init: 20 }, { tokenId: a.id, init: 10 }], turn: 1, round: 2, visible: true };
    const init = playerView(g).map!.initiative!;
    expect(init.entries.map((e) => e.name)).toEqual(['A']);
    expect(init.activeTokenId).toBe(a.id);
    expect(init.round).toBe(2);
    m.initiative.visible = false;
    expect(playerView(g).map!.initiative).toBeNull();
  });

  it('drops hidden drawings, labels and templates', () => {
    m.labels.push({ id: 'l1', x: 1, y: 1, text: 'shown', color: '#fff', size: 1, hidden: false }, { id: 'l2', x: 1, y: 1, text: 'SECRET-LABEL', color: '#fff', size: 1, hidden: true });
    m.drawings.push({ id: 'dr', points: [[0, 0], [1, 1]], color: '#f00', width: 2, hidden: true });
    m.templates.push({ id: 't1', shape: 'circle', x: 3, y: 3, sizeFt: 10, angle: 0, color: '#f00', hidden: false });
    const v = playerView(g).map!;
    expect(v.labels.map((l) => l.id)).toEqual(['l1']);
    expect(v.drawings).toHaveLength(0);
    expect(v.templates).toHaveLength(1);
  });
});

describe('applyOp', () => {
  let g: Game; let m: MapData;
  beforeEach(() => { g = game(); m = g.maps[0]; });

  it('sets terrain and fog', () => {
    applyOp(g, { t: 'terrain.set', mapId: m.id, cells: [[5, 'water'], [6, 'lava']] });
    expect(m.terrain[5]).toBe('water');
    applyOp(g, { t: 'fog.set', mapId: m.id, cells: [1, 2], revealed: true });
    expect(m.fog.slice(0, 3)).toEqual([0, 1, 1]);
    applyOp(g, { t: 'fog.all', mapId: m.id, revealed: true });
    expect(m.fog.every((f) => f === 1)).toBe(true);
  });

  it('puts, replaces and deletes items', () => {
    const t = makeToken({ name: 'A', x: 1, y: 1 });
    applyOp(g, { t: 'item.put', mapId: m.id, coll: 'tokens', item: t });
    applyOp(g, { t: 'item.put', mapId: m.id, coll: 'tokens', item: { ...t, x: 4 } });
    expect(m.tokens).toHaveLength(1);
    expect(m.tokens[0].x).toBe(4);
    applyOp(g, { t: 'item.delete', mapId: m.id, coll: 'tokens', id: t.id });
    expect(m.tokens).toHaveLength(0);
  });

  it('removes deleted tokens from initiative', () => {
    const t = makeToken({ name: 'A', x: 1, y: 1 });
    m.tokens.push(t);
    m.initiative.entries.push({ tokenId: t.id, init: 12 });
    applyOp(g, { t: 'item.delete', mapId: m.id, coll: 'tokens', id: t.id });
    expect(m.initiative.entries).toHaveLength(0);
  });

  it('patches maps and the game, and handles deleting the live map', () => {
    applyOp(g, { t: 'map.patch', mapId: m.id, patch: { name: 'Renamed', settings: { ...m.settings, ambience: 'rain' } } });
    expect(m.name).toBe('Renamed');
    expect(m.settings.ambience).toBe('rain');
    const m2 = blankMap({ width: 10, height: 10, theme: 'cave' });
    applyOp(g, { t: 'map.put', map: m2 });
    expect(g.maps).toHaveLength(2);
    applyOp(g, { t: 'game.patch', liveMapId: m2.id, screen: { banner: 'Hi' } });
    expect(g.liveMapId).toBe(m2.id);
    expect(g.screen.banner).toBe('Hi');
    expect(g.screen.followDm).toBe(false);
    applyOp(g, { t: 'game.patch', liveMapId: 'nope' });
    expect(g.liveMapId).toBe(m2.id);
    applyOp(g, { t: 'map.delete', mapId: m2.id });
    expect(g.liveMapId).toBe(m.id);
  });

  it('ignores ops for unknown maps and invalid maps', () => {
    expect(() => applyOp(g, { t: 'terrain.set', mapId: 'missing', cells: [[0, 'wall']] })).not.toThrow();
    const bad = { ...blankMap({ width: 10, height: 10, theme: 'cave' }), terrain: [] };
    expect(() => applyOp(g, { t: 'map.put', map: bad })).toThrow();
    expect(g.maps).toHaveLength(1);
  });

  it('ignores out-of-range cells', () => {
    applyOp(g, { t: 'terrain.set', mapId: m.id, cells: [[-1, 'wall'], [99999, 'wall'], [30, 'not-a-terrain' as never]] });
    expect(m.terrain.length).toBe(120);
    expect(m.terrain[30]).toBe('floor');
  });
});

describe('templateCells', () => {
  const m = blankMap({ width: 20, height: 20, theme: 'dungeon' });
  it('covers a 10 ft radius circle', () => {
    const cells = templateCells({ id: 't', shape: 'circle', x: 10, y: 10, sizeFt: 10, angle: 0, color: '', hidden: false }, m);
    expect(cells).toContain(idx(m, 10, 10));
    expect(cells).toContain(idx(m, 8, 9));
    expect(cells).not.toContain(idx(m, 7, 10));
    expect(cells.length).toBe(12);
  });
  it('covers a 30 ft line one square wide', () => {
    const cells = templateCells({ id: 't', shape: 'line', x: 2, y: 5.5, sizeFt: 30, angle: 0, color: '', hidden: false }, m);
    expect(cells.sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7].map((x) => idx(m, x, 5)));
  });
  it('covers a cone that widens', () => {
    const cells = templateCells({ id: 't', shape: 'cone', x: 2, y: 10.5, sizeFt: 30, angle: 0, color: '', hidden: false }, m);
    expect(cells).toContain(idx(m, 2, 10));
    expect(cells).toContain(idx(m, 7, 12));
    expect(cells).not.toContain(idx(m, 3, 12));
  });
});
