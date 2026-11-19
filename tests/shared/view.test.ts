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

describe('sanitising ops from the wire', () => {
  let g: Game; let m: MapData;
  beforeEach(() => { g = game(); m = g.maps[0]; });

  it('cleans a malformed token so the player view never throws', () => {
    applyOp(g, { t: 'item.put', mapId: m.id, coll: 'tokens', item: { id: 'bad', x: 'nope', y: 9999, size: 99, kind: 'dragon', name: 'x'.repeat(500), color: 'javascript:alert(1)' } as never });
    const t = m.tokens[0];
    expect(t.x).toBe(0);
    expect(t.y).toBe(m.height - t.size);
    expect(t.size).toBeLessThanOrEqual(4);
    expect(t.kind).toBe('enemy');
    expect(t.name.length).toBeLessThanOrEqual(40);
    expect(t.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(t.conditions).toEqual([]);
    m.fog.fill(1);
    expect(() => playerView(g)).not.toThrow();
  });

  it('drops items without an id and doors off the map', () => {
    applyOp(g, { t: 'item.put', mapId: m.id, coll: 'tokens', item: { name: 'no id' } as never });
    applyOp(g, { t: 'item.put', mapId: m.id, coll: 'doors', item: { id: 'd', x: -5, y: 2, state: 'open' } });
    expect(m.tokens).toHaveLength(0);
    expect(m.doors).toHaveLength(0);
  });

  it('cleans every item inside a map.put', () => {
    const bad = blankMap({ width: 10, height: 10, theme: 'cave' });
    (bad.tokens as unknown[]).push({ id: 't1', x: 3, y: 3 }, 'junk', null);
    (bad.labels as unknown[]).push({ id: 'l1', text: 42 });
    (bad.settings as unknown as Record<string, unknown>).ambience = 'meteor-shower';
    bad.initiative = { entries: [{ tokenId: 't1', init: 'high' }], turn: 'x', round: null, visible: 'yes' } as never;
    applyOp(g, { t: 'map.put', map: bad });
    const stored = g.maps.find((x) => x.id === bad.id)!;
    expect(stored.tokens).toHaveLength(1);
    expect(stored.tokens[0].conditions).toEqual([]);
    expect(stored.labels[0].text).toBe('');
    expect(stored.settings.ambience).toBe('none');
    expect(stored.initiative.entries[0].init).toBe(0);
    expect(stored.initiative.visible).toBe(false);
    g.liveMapId = bad.id;
    stored.fog.fill(1);
    expect(() => playerView(g)).not.toThrow();
  });

  it('cleans screen and settings patches', () => {
    applyOp(g, { t: 'game.patch', screen: { banner: 'b'.repeat(999), blank: 'yes' as never } });
    expect(g.screen.banner.length).toBeLessThanOrEqual(140);
    expect(g.screen.blank).toBe(false);
    applyOp(g, { t: 'map.patch', mapId: m.id, patch: { settings: { gridOpacity: 50, distanceRule: 'warp' } as never } });
    expect(m.settings.gridOpacity).toBeLessThanOrEqual(1);
    expect(m.settings.distanceRule).toBe('5e');
  });
});

describe('turn order entries typed in by the DM', () => {
  it('shows typed-in entries to players unless hidden, and tracks whose turn it is', () => {
    const g = game(); const m = g.maps[0];
    for (let i = 0; i < m.fog.length; i++) m.fog[i] = 1;
    const hero = makeToken({ name: 'Thalia', kind: 'player', x: 2, y: 2 });
    const spy = makeToken({ name: 'Spy', x: 3, y: 3, hidden: true });
    m.tokens.push(hero, spy);
    applyOp(g, { t: 'map.patch', mapId: m.id, patch: { initiative: {
      entries: [
        { tokenId: 'ent_lair', init: 20, name: 'Lair actions', color: '#a855f7' },
        { tokenId: hero.id, init: 18 },
        { tokenId: spy.id, init: 15 },
        { tokenId: 'ent_secret', init: 10, name: 'SECRET-REINFORCEMENTS', hidden: true },
      ], turn: 0, round: 1, visible: true,
    } } });
    const init = playerView(g).map!.initiative!;
    expect(init.entries.map((e) => e.name)).toEqual(['Lair actions', 'Thalia']);
    expect(init.entries[0]).toMatchObject({ label: 'L', color: '#a855f7' });
    expect(init.activeTokenId).toBe('ent_lair');
    expect(JSON.stringify(playerView(g))).not.toContain('SECRET-REINFORCEMENTS');
    // A hidden entry's turn shows as nobody's.
    applyOp(g, { t: 'map.patch', mapId: m.id, patch: { initiative: { ...m.initiative, turn: 3 } } });
    expect(playerView(g).map!.initiative!.activeTokenId).toBeNull();
  });

  it('keeps spell area looks through the sanitizer', () => {
    const g = game(); const m = g.maps[0];
    applyOp(g, { t: 'item.put', mapId: m.id, coll: 'templates', item: { id: 'tp1', shape: 'cone', x: 2, y: 2, sizeFt: 60, angle: 0, color: '#38bdf8', hidden: false, label: 'Cone of Cold', effect: 'cold' } });
    applyOp(g, { t: 'item.put', mapId: m.id, coll: 'templates', item: { id: 'tp2', shape: 'circle', x: 2, y: 2, sizeFt: 20, angle: 0, color: '#38bdf8', hidden: false, effect: 'banana' as never } });
    expect(m.templates[0].effect).toBe('cold');
    expect(m.templates[1].effect).toBeUndefined();
  });
});

describe('traps', () => {
  it('keeps trap details for the DM and shows players only revealed traps, without the details', () => {
    const g = game(); const m = g.maps[0];
    for (let i = 0; i < m.fog.length; i++) m.fog[i] = 1;
    applyOp(g, { t: 'item.put', mapId: m.id, coll: 'objects', item: { id: 't1', x: 2, y: 2, kind: 'trap', trap: { type: 'darts', state: 'armed', dc: 15, damage: 'SECRET-DAMAGE', note: 'SECRET-NOTE-TRAP' } } });
    applyOp(g, { t: 'item.put', mapId: m.id, coll: 'objects', item: { id: 't2', x: 3, y: 2, kind: 'trap', hidden: true, trap: { type: 'pit', state: 'armed' } } });
    applyOp(g, { t: 'item.put', mapId: m.id, coll: 'objects', item: { id: 't3', x: 4, y: 2, kind: 'trap', trap: { type: 'banana', state: 'nope' } as never } });
    expect(m.objects[0].trap).toEqual({ type: 'darts', state: 'armed', dc: 15, damage: 'SECRET-DAMAGE', note: 'SECRET-NOTE-TRAP' });
    expect(m.objects[2].trap).toEqual({ type: 'spikes', state: 'armed' });
    const v = playerView(g).map!;
    expect(v.objects.map((o) => o.id)).toEqual(['t1', 't3']);
    expect(v.objects[0].trap).toEqual({ type: 'darts', state: 'armed' });
    const raw = JSON.stringify(playerView(g));
    expect(raw).not.toContain('SECRET-DAMAGE');
    expect(raw).not.toContain('SECRET-NOTE-TRAP');
  });

  it('spots armed traps a token crosses or lands on, but not where it started', async () => {
    const { trapsCrossed } = await import('../../shared/traps');
    const map = { objects: [
      { id: 'a', x: 3, y: 0, kind: 'trap' as const, trap: { type: 'spikes' as const, state: 'armed' as const } },
      { id: 'b', x: 6, y: 0, kind: 'trap' as const, trap: { type: 'pit' as const, state: 'disarmed' as const } },
      { id: 'c', x: 0, y: 0, kind: 'trap' as const, trap: { type: 'net' as const, state: 'armed' as const } },
      { id: 'd', x: 8, y: 0, kind: 'trap' as const, trap: { type: 'gas' as const, state: 'triggered' as const } },
    ] };
    expect(trapsCrossed(map, { size: 1 }, { x: 0, y: 0 }, { x: 9, y: 0 }).map((o) => o.id)).toEqual(['a']);
    expect(trapsCrossed(map, { size: 1 }, { x: 0, y: 1 }, { x: 5, y: 1 })).toEqual([]);
    // A large creature's footprint sweeps the row next to it too.
    expect(trapsCrossed(map, { size: 2 }, { x: 0, y: 1 }, { x: 5, y: 1 })).toEqual([]);
    expect(trapsCrossed(map, { size: 2 }, { x: 1, y: -1 }, { x: 5, y: -1 }).map((o) => o.id)).toEqual(['a']);
  });
});

describe('status effects', () => {
  it('keeps durations, hides secret effects from players, and shows players the rounds left', () => {
    const g = game(); const m = g.maps[0];
    for (let i = 0; i < m.fog.length; i++) m.fog[i] = 1;
    const orc = makeToken({ name: 'Orc', x: 2, y: 2, conditions: ['burning', 'hexed', 'SECRET-CURSE', 'burning'] });
    applyOp(g, { t: 'item.put', mapId: m.id, coll: 'tokens', item: { ...orc, effectInfo: { burning: { rounds: 3 }, 'SECRET-CURSE': { hidden: true }, nothere: { rounds: 2 } } } });
    const saved = m.tokens.find((t) => t.name === 'Orc')!;
    expect(saved.conditions).toEqual(['burning', 'hexed', 'SECRET-CURSE']);
    expect(saved.effectInfo).toEqual({ burning: { rounds: 3 }, 'SECRET-CURSE': { hidden: true } });
    const seen = playerView(g).map!.tokens.find((t) => t.name === 'Orc')!;
    expect(seen.conditions).toEqual(['burning', 'hexed']);
    expect(seen.rounds).toEqual({ burning: 3 });
    expect(JSON.stringify(playerView(g))).not.toContain('SECRET-CURSE');
  });

  it('counts durations down and removes what wears off', async () => {
    const { tickEffects, effectDef } = await import('../../shared/effects');
    const r = tickEffects(['burning', 'blessed', 'hexed'], { burning: { rounds: 1 }, blessed: { rounds: 3, hidden: true } });
    expect(r.expired).toEqual(['burning']);
    expect(r.conditions).toEqual(['blessed', 'hexed']);
    expect(r.effectInfo).toEqual({ blessed: { rounds: 2, hidden: true } });
    expect(effectDef('burning').look).toBe('fire');
    expect(effectDef('Turned').label).toBe('Turned');
  });
});
