import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp, type AppOptions } from '../../server/app';
import type { AiProvider } from '../../server/hub';
import { generateMap } from '../../shared/generate';
import type { ServerMsg } from '../../shared/protocol';
import { makeToken, type Game } from '../../shared/types';

type App = Awaited<ReturnType<typeof createApp>>;
const apps: App[] = [];
const dirs: string[] = [];

async function start(o: Partial<AppOptions> = {}, dataDir?: string) {
  const dir = dataDir ?? mkdtempSync(path.join(tmpdir(), 'dndmap-'));
  if (!dataDir) dirs.push(dir);
  const app = await createApp({ dataDir: dir, broadcastMs: 5, saveDebounceMs: 5, ...o });
  apps.push(app);
  await new Promise<void>((r) => app.server.listen(0, r));
  const port = (app.server.address() as { port: number }).port;
  return { app, port, dir, base: `http://127.0.0.1:${port}` };
}

afterEach(async () => {
  for (const a of apps.splice(0)) await a.close().catch(() => {});
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

class Client {
  msgs: ServerMsg[] = [];
  raw: string[] = [];
  ws: WebSocket;
  private waiters: { pred: (m: ServerMsg) => boolean; res: (m: ServerMsg) => void }[] = [];
  constructor(port: number) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    this.ws.on('message', (d) => {
      const s = String(d);
      this.raw.push(s);
      const m = JSON.parse(s) as ServerMsg;
      this.msgs.push(m);
      this.waiters = this.waiters.filter((w) => (w.pred(m) ? (w.res(m), false) : true));
    });
  }
  open() { return new Promise<void>((r) => (this.ws.readyState === WebSocket.OPEN ? r() : this.ws.once('open', () => r()))); }
  send(m: unknown) { this.ws.send(JSON.stringify(m)); }
  next<T extends ServerMsg['type']>(type: T, pred: (m: Extract<ServerMsg, { type: T }>) => boolean = () => true, ms = 2000) {
    const found = this.msgs.find((m) => m.type === type && pred(m as Extract<ServerMsg, { type: T }>));
    if (found) { this.msgs.splice(this.msgs.indexOf(found), 1); return Promise.resolve(found as Extract<ServerMsg, { type: T }>); }
    return new Promise<Extract<ServerMsg, { type: T }>>((res, rej) => {
      const t = setTimeout(() => rej(new Error(`timeout waiting for ${type}`)), ms);
      this.waiters.push({
        pred: (m) => m.type === type && pred(m as Extract<ServerMsg, { type: T }>),
        res: (m) => { clearTimeout(t); this.msgs.splice(this.msgs.indexOf(m), 1); res(m as Extract<ServerMsg, { type: T }>); },
      });
    });
  }
  close() { this.ws.close(); }
}

async function newGame(base: string, password?: string) {
  const r = await fetch(`${base}/api/games`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
  return { status: r.status, body: (await r.json()) as { code: string; dmSecret: string; error?: string } };
}

async function dm(port: number, code: string, secret: string) {
  const c = new Client(port); await c.open();
  c.send({ type: 'join', code, role: 'dm', secret });
  return c;
}
async function player(port: number, code: string, name = 'Pip') {
  const c = new Client(port); await c.open();
  c.send({ type: 'join', code, role: 'player', name });
  return c;
}

describe('server', () => {
  it('creates a game, syncs DM ops to other DMs and players, and filters hidden data', async () => {
    const { port, base } = await start();
    const { body: g } = await newGame(base);
    expect(g.code).toMatch(/^[A-Z2-9]{6}$/);

    const d1 = await dm(port, g.code, g.dmSecret);
    const s = await d1.next('state');
    expect(s.game.maps).toHaveLength(0);
    const d2 = await dm(port, g.code, g.dmSecret);
    await d2.next('state');

    const map = generateMap({ theme: 'dungeon', width: 30, height: 20, seed: 'srv' });
    map.fog.fill(1);
    const visible = makeToken({ name: 'Goblin', x: map.rooms[0].x, y: map.rooms[0].y });
    const hidden = makeToken({ name: 'SECRET-ASSASSIN', x: map.rooms[0].x + 1, y: map.rooms[0].y, hidden: true });
    map.tokens.push(visible, hidden);
    d1.send({ type: 'op', op: { t: 'map.put', map } });
    const echoed = await d2.next('op');
    expect(echoed.op.t).toBe('map.put');

    const p = await player(port, ` ${g.code.toLowerCase().slice(0, 3)} ${g.code.toLowerCase().slice(3)} `);
    const view = await p.next('pview', (m) => !!m.static);
    expect(view.static!.width).toBe(30);
    expect(view.dynamic!.tokens.map((t) => t.name)).toEqual(['Goblin']);

    d1.send({ type: 'op', op: { t: 'item.put', mapId: map.id, coll: 'tokens', item: { ...visible, x: visible.x + 1 } } });
    const moved = await p.next('pview', (m) => !!m.dynamic && m.dynamic.tokens[0]?.x === visible.x + 1);
    expect(moved.static).toBeUndefined();

    const pres = await d1.next('presence', (m) => m.players.length === 1);
    expect(pres.players[0].name).toBe('Pip');
    for (const r of p.raw) expect(r).not.toContain('SECRET-ASSASSIN');
    for (const r of p.raw) expect(r).not.toContain(g.dmSecret);
  });

  it('lets a player set a party token picture, but not a monster one, and serves it', async () => {
    const { port, base } = await start();
    const { body: g } = await newGame(base);
    const d = await dm(port, g.code, g.dmSecret);
    await d.next('state');
    const map = generateMap({ theme: 'dungeon', width: 30, height: 20, seed: 'pic' });
    map.fog.fill(1);
    const hero = makeToken({ name: 'Thalia', kind: 'player', x: map.rooms[0].x, y: map.rooms[0].y });
    const orc = makeToken({ name: 'Orc', kind: 'enemy', x: map.rooms[0].x + 1, y: map.rooms[0].y });
    map.tokens.push(hero, orc);
    d.send({ type: 'op', op: { t: 'map.put', map } });
    const p = await player(port, g.code);
    await p.next('pview', (m) => !!m.static);

    // A tiny valid JPEG-ish payload: the server only checks the data URL shape.
    const data = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg-bytes').toString('base64');
    p.send({ type: 'icon', tokenId: orc.id, id: 'abcdefgh1234', data });
    expect((await p.next('error')).code).toBe('not-allowed');
    p.send({ type: 'icon', tokenId: hero.id, id: 'not valid!', data });
    expect((await p.next('error')).code).toBe('bad-message');

    p.send({ type: 'icon', tokenId: hero.id, id: 'abcdefgh1234', data });
    const seen = await p.next('pview', (m) => !!m.dynamic?.tokens.some((t) => t.id === hero.id && t.image === 'abcdefgh1234'));
    expect(seen.dynamic!.tokens.find((t) => t.id === orc.id)!.image).toBeUndefined();
    // The DM gets the picture and the token change as ordinary ops.
    await d.next('op', (m) => m.op.t === 'image.put');
    await d.next('op', (m) => m.op.t === 'item.put' && m.op.coll === 'tokens' && (m.op.item as { image?: string }).image === 'abcdefgh1234');
    // Players never get the picture data over the socket, only its id.
    for (const r of p.raw) expect(r).not.toContain('base64');

    const res = await fetch(`${base}/api/img/${g.code}/abcdefgh1234`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('fake-jpeg-bytes');
    expect((await fetch(`${base}/api/img/${g.code}/zzzzzzzz9999`)).status).toBe(404);

    // Clearing it.
    p.send({ type: 'icon', tokenId: hero.id, id: null });
    await p.next('pview', (m) => !!m.dynamic?.tokens.some((t) => t.id === hero.id && !t.image));
  });

  it('relays player pings with their character colour, and rolls dice on the server', async () => {
    const { port, base } = await start();
    const { body: g } = await newGame(base);
    const d = await dm(port, g.code, g.dmSecret);
    await d.next('state');
    const map = generateMap({ theme: 'dungeon', width: 30, height: 20, seed: 'dice' });
    map.fog.fill(1);
    const hero = makeToken({ name: 'Thalia', kind: 'player', color: '#8b5cf6', x: map.rooms[0].x, y: map.rooms[0].y });
    map.tokens.push(hero);
    d.send({ type: 'op', op: { t: 'map.put', map } });
    const p1 = await player(port, g.code, 'Ana');
    const p2 = await player(port, g.code, 'Bo');
    await p1.next('pview', (m) => !!m.static);
    await p2.next('pview', (m) => !!m.static);

    p1.send({ type: 'ping', x: 3.7, y: 4.2, focus: true, as: hero.id });
    const dp = await d.next('ping');
    expect(dp).toMatchObject({ x: 3, y: 4, focus: false, by: 'Thalia', color: '#8b5cf6' });
    expect(await p2.next('ping')).toMatchObject({ by: 'Thalia' });
    p1.send({ type: 'ping', x: 999, y: 4, focus: false });
    // Out of bounds is dropped; spam is limited.
    for (let i = 0; i < 9; i++) p1.send({ type: 'ping', x: 1, y: 1, focus: false });
    expect((await p1.next('error')).message).toMatch(/Too many pings/);

    p2.send({ type: 'roll', expr: '2d6+3', label: 'Damage' });
    const r = await d.next('roll');
    expect(r.roll).toMatchObject({ by: 'Bo', text: '2d6+3', label: 'Damage', secret: false });
    expect(r.roll.total).toBeGreaterThanOrEqual(5);
    expect(r.roll.total).toBeLessThanOrEqual(15);
    expect((await p1.next('roll')).roll.id).toBe(r.roll.id);
    p2.send({ type: 'roll', expr: 'banana' });
    expect((await p2.next('error')).code).toBe('bad-message');
    // Players can't make secret rolls.
    p2.send({ type: 'roll', expr: 'd20', secret: true });
    expect((await p1.next('roll')).roll.secret).toBe(false);

    // A DM secret roll reaches DMs only.
    d.send({ type: 'roll', expr: 'd20+7', label: 'SECRET-STEALTH-CHECK', secret: true });
    const sr = await d.next('roll', (m) => m.roll.secret);
    expect(sr.roll.by).toBe('DM');
    d.send({ type: 'roll', expr: 'd4', label: 'public' });
    await p1.next('roll', (m) => m.roll.label === 'public');
    for (const raw of [...p1.raw, ...p2.raw]) expect(raw).not.toContain('SECRET-STEALTH-CHECK');

    // Roll spam is limited too.
    for (let i = 0; i < 11; i++) p1.send({ type: 'roll', expr: 'd6' });
    expect((await p1.next('error', (m) => /Too many rolls/.test(m.message ?? ''))).code).toBe('not-allowed');
  });

  it('rejects a wrong DM secret and player ops', async () => {
    const { port, base } = await start();
    const { body: g } = await newGame(base);
    const bad = await dm(port, g.code, 'f'.repeat(64));
    expect((await bad.next('error')).code).toBe('bad-secret');
    const p = await player(port, g.code);
    await p.next('pview');
    p.send({ type: 'op', op: { t: 'fog.all', mapId: 'x', revealed: true } });
    expect((await p.next('error')).code).toBe('not-allowed');
  });

  it('requires the host password when one is set', async () => {
    const { base } = await start({ hostPassword: 'hunter2' });
    expect((await newGame(base)).status).toBe(401);
    expect((await newGame(base, 'nope')).status).toBe(401);
    expect((await newGame(base, 'hunter2')).status).toBe(200);
    const cfg = await (await fetch(`${base}/api/config`)).json();
    expect(cfg).toEqual({ aiEnabled: false, passwordRequired: true });
  });

  it('restores a room from the DM after the server loses its disk', async () => {
    const first = await start({ secretKey: 'k' });
    const { body: g } = await newGame(first.base);
    const d = await dm(first.port, g.code, g.dmSecret);
    const map = generateMap({ theme: 'cave', width: 30, height: 20, seed: 'r' });
    d.send({ type: 'op', op: { t: 'map.put', map } });
    await new Promise((r) => setTimeout(r, 30));
    const backup: Game = { code: g.code, maps: [map], liveMapId: map.id, screen: { blank: false, message: '', banner: 'Back!', followDm: false }, createdAt: 1, updatedAt: 1 };

    // A fresh server with an empty disk.
    const second = await start({ secretKey: 'k' });
    const p = await player(second.port, g.code);
    expect((await p.next('error')).code).toBe('no-room');

    // A forged secret may not restore.
    const forger = await dm(second.port, g.code, 'a'.repeat(64));
    expect((await forger.next('error')).code).toBe('bad-secret');

    const d2 = await dm(second.port, g.code, g.dmSecret);
    expect((await d2.next('error')).code).toBe('no-room');
    d2.send({ type: 'restore', game: backup });
    const st = await d2.next('state');
    expect(st.game.maps[0].id).toBe(map.id);
    const v = await p.next('pview', (m) => !!m.static);
    expect(v.static!.id).toBe(map.id);
    expect(v.screen!.banner).toBe('Back!');
  });

  it('persists to disk and reloads', async () => {
    const first = await start();
    const { body: g } = await newGame(first.base);
    const d = await dm(first.port, g.code, g.dmSecret);
    await d.next('state');
    const map = generateMap({ theme: 'forest', width: 20, height: 20, seed: 'p' });
    d.send({ type: 'op', op: { t: 'map.put', map } });
    await new Promise((r) => setTimeout(r, 50));
    await first.app.close();
    const second = await start({}, first.dir);
    const d2 = await dm(second.port, g.code, g.dmSecret);
    expect((await d2.next('state')).game.maps[0].id).toBe(map.id);
  });

  it('blanks the player screen', async () => {
    const { port, base } = await start();
    const { body: g } = await newGame(base);
    const d = await dm(port, g.code, g.dmSecret);
    await d.next('state');
    const map = generateMap({ theme: 'dungeon', width: 20, height: 20, seed: 'b' });
    d.send({ type: 'op', op: { t: 'map.put', map } });
    const p = await player(port, g.code);
    await p.next('pview', (m) => !!m.static);
    d.send({ type: 'op', op: { t: 'game.patch', screen: { blank: true, message: 'Short rest' } } });
    const v = await p.next('pview', (m) => m.screen?.blank === true);
    expect(v.static).toBeNull();
    expect(v.screen!.message).toBe('Short rest');
  });

  it('runs AI generation with a rate limit', async () => {
    let calls = 0;
    const ai: AiProvider = { generate: async () => { calls++; return { name: 'AI Keep', rooms: [{ id: 'a', x: 2, y: 2, w: 6, h: 5 }, { id: 'b', x: 14, y: 10, w: 5, h: 5 }], connections: [{ from: 'a', to: 'b' }] }; } };
    const { port, base } = await start({ ai });
    const { body: g } = await newGame(base);
    const d = await dm(port, g.code, g.dmSecret);
    expect((await d.next('joined')).aiEnabled).toBe(true);
    for (let i = 0; i < 6; i++) d.send({ type: 'ai', reqId: `r${i}`, prompt: 'keep', theme: 'dungeon', width: 30, height: 20, placeCreatures: false });
    const ok = await d.next('ai.result', (m) => m.reqId === 'r0');
    expect(ok.map.name).toBe('AI Keep');
    expect(ok.map.width).toBe(30);
    const limited = await d.next('ai.error', (m) => m.reqId === 'r5');
    expect(limited.message).toMatch(/Slow down/);
    expect(calls).toBe(5);
  });

  it('reports AI as unavailable without a provider', async () => {
    const { port, base } = await start();
    const { body: g } = await newGame(base);
    const d = await dm(port, g.code, g.dmSecret);
    d.send({ type: 'ai', reqId: 'x', prompt: 'hi', theme: 'cave', width: 20, height: 20, placeCreatures: false });
    expect((await d.next('ai.error')).message).toMatch(/not set up/);
  });

  it('survives a malformed token and keeps serving players', async () => {
    const { port, base } = await start();
    const { body: g } = await newGame(base);
    const d = await dm(port, g.code, g.dmSecret);
    await d.next('state');
    const map = generateMap({ theme: 'dungeon', width: 20, height: 20, seed: 'm' });
    map.fog.fill(1);
    d.send({ type: 'op', op: { t: 'map.put', map } });
    const p = await player(port, g.code);
    await p.next('pview', (m) => !!m.static);
    d.send({ type: 'op', op: { t: 'item.put', mapId: map.id, coll: 'tokens', item: { id: 'evil', x: {}, conditions: 'nope', name: 7 } } });
    d.send({ type: 'op', op: { t: 'item.put', mapId: map.id, coll: 'tokens', item: makeToken({ name: 'Fine', x: 1, y: 1 }) } });
    const v = await p.next('pview', (m) => !!m.dynamic?.tokens.some((t) => t.name === 'Fine'));
    expect(v.dynamic!.tokens.find((t) => t.id === 'evil')!.conditions).toEqual([]);
    expect((await fetch(`${base}/api/health`)).ok).toBe(true);
  });

  it('rejects a malformed map without crashing', async () => {
    const { port, base } = await start();
    const { body: g } = await newGame(base);
    const d = await dm(port, g.code, g.dmSecret);
    await d.next('state');
    d.send({ type: 'op', op: { t: 'map.put', map: { id: 'x', width: 9999 } } });
    expect((await d.next('error')).code).toBe('bad-op');
    d.ws.send('not json');
    expect((await d.next('error')).code).toBe('bad-message');
  });
});
