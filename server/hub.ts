// Live rooms: who is connected, applying DM ops, and pushing each player
// the filtered view.
import { randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';
import { buildMapFromPlan } from '../shared/build';
import { applyOp, validateMap } from '../shared/ops';
import { sanitizeMap, sanitizeScreen } from '../shared/sanitize';
import { STATIC_KEYS, type AiRequest, type ClientMsg, type PlayerDynamic, type PlayerStatic, type Role, type ServerMsg, type Watcher } from '../shared/protocol';
import { MAP_MAX, MAP_MIN, THEMES, defaultScreen, normalizeCode, type Game } from '../shared/types';
import { playerView } from '../shared/view';
import { hashSecret, sameHash, type Secrets } from './secrets';
import type { Store } from './store';

export interface AiProvider {
  generate(req: AiRequest): Promise<unknown>;
}

interface Client {
  ws: WebSocket;
  id: string;
  role: Role | null;
  code: string | null;
  name: string;
  /** Secret a DM joined with, kept until they restore a missing room. */
  pendingSecret?: string;
  alive: boolean;
  /** Messages from one socket are handled strictly in order. */
  queue: Promise<void>;
}

interface Room {
  code: string;
  game: Game;
  secretHash: string;
  dms: Set<Client>;
  players: Set<Client>;
  last: { screen: string; static: string; dynamic: string };
  timer: NodeJS.Timeout | null;
  unloadTimer: NodeJS.Timeout | null;
  aiTimes: number[];
}

export interface HubOptions {
  store: Store;
  secrets: Secrets;
  ai?: AiProvider | null;
  broadcastMs?: number;
  unloadMs?: number;
  aiPerMinute?: number;
}

const send = (ws: WebSocket, msg: ServerMsg | string) => {
  if (ws.readyState === ws.OPEN) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
};

export class Hub {
  private rooms = new Map<string, Room>();
  private loading = new Map<string, Promise<Room | null>>();
  private waiting = new Map<string, Set<Client>>();
  private clients = new Set<Client>();
  private heartbeat: NodeJS.Timeout;

  constructor(private o: HubOptions) {
    this.heartbeat = setInterval(() => {
      for (const c of this.clients) {
        if (!c.alive) { c.ws.terminate(); continue; }
        c.alive = false;
        try { c.ws.ping(); } catch { /* closed */ }
      }
    }, 25_000);
  }

  get aiEnabled() { return !!this.o.ai; }

  async createRoom(code: string, secret: string): Promise<void> {
    const game: Game = { code, maps: [], liveMapId: null, screen: defaultScreen(), createdAt: Date.now(), updatedAt: Date.now() };
    const room = this.makeRoom(game, hashSecret(secret));
    this.rooms.set(code, room);
    this.o.store.save(code, { game, secretHash: room.secretHash });
    await this.o.store.flush(code);
    this.scheduleUnload(room);
  }

  async codeInUse(code: string) {
    return this.rooms.has(code) || (await this.o.store.exists(code));
  }

  private makeRoom(game: Game, secretHash: string): Room {
    return {
      code: game.code, game, secretHash, dms: new Set(), players: new Set(),
      last: { screen: '', static: '', dynamic: '' }, timer: null, unloadTimer: null, aiTimes: [],
    };
  }

  private getRoom(code: string): Promise<Room | null> {
    const live = this.rooms.get(code);
    if (live) return Promise.resolve(live);
    let p = this.loading.get(code);
    if (!p) {
      p = this.o.store.load(code).then((rec) => {
        this.loading.delete(code);
        if (!rec) return null;
        const existing = this.rooms.get(code);
        if (existing) return existing;
        const room = this.makeRoom(rec.game, rec.secretHash);
        this.rooms.set(code, room);
        return room;
      });
      this.loading.set(code, p);
    }
    return p;
  }

  connect(ws: WebSocket) {
    const client: Client = { ws, id: randomBytes(6).toString('hex'), role: null, code: null, name: '', alive: true, queue: Promise.resolve() };
    this.clients.add(client);
    ws.on('pong', () => { client.alive = true; });
    ws.on('message', (data) => {
      client.alive = true;
      let msg: ClientMsg;
      try { msg = JSON.parse(String(data)); } catch { return send(ws, { type: 'error', code: 'bad-message' }); }
      client.queue = client.queue.then(() => this.handle(client, msg)).catch((err) => {
        console.error('[hub] handler error', err);
        send(ws, { type: 'error', code: 'bad-message' });
      });
    });
    ws.on('close', () => this.disconnect(client));
    ws.on('error', () => this.disconnect(client));
  }

  private disconnect(c: Client) {
    if (!this.clients.delete(c)) return;
    if (c.code) {
      this.waiting.get(c.code)?.delete(c);
      const room = this.rooms.get(c.code);
      if (room) {
        room.dms.delete(c);
        if (room.players.delete(c)) this.sendPresence(room);
        this.scheduleUnload(room);
      }
    }
  }

  private scheduleUnload(room: Room) {
    if (room.dms.size || room.players.size) return;
    if (room.unloadTimer) clearTimeout(room.unloadTimer);
    room.unloadTimer = setTimeout(async () => {
      if (room.dms.size || room.players.size) return;
      await this.o.store.flush(room.code);
      if (!room.dms.size && !room.players.size && this.rooms.get(room.code) === room) this.rooms.delete(room.code);
    }, this.o.unloadMs ?? 10 * 60_000);
    room.unloadTimer.unref?.();
  }

  private async handle(c: Client, msg: ClientMsg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'hb') return;
    if (msg.type === 'join') return this.join(c, msg);
    if (msg.type === 'restore') return this.restore(c, msg.game);
    const room = c.code ? this.rooms.get(c.code) : undefined;
    if (!room || c.role !== 'dm' || !room.dms.has(c)) return send(c.ws, { type: 'error', code: 'not-allowed' });

    switch (msg.type) {
      case 'op': {
        try { applyOp(room.game, msg.op); } catch (e) {
          return send(c.ws, { type: 'error', code: 'bad-op', message: (e as Error).message });
        }
        const out = JSON.stringify({ type: 'op', op: msg.op } satisfies ServerMsg);
        for (const d of room.dms) if (d !== c) send(d.ws, out);
        this.persist(room);
        this.schedule(room);
        break;
      }
      case 'ping': {
        if (![msg.x, msg.y].every(Number.isFinite)) return;
        const out = JSON.stringify({ type: 'ping', x: msg.x, y: msg.y, focus: !!msg.focus } satisfies ServerMsg);
        for (const p of room.players) send(p.ws, out);
        for (const d of room.dms) if (d !== c) send(d.ws, out);
        break;
      }
      case 'view': {
        if (!room.game.screen.followDm || ![msg.cx, msg.cy, msg.zoom].every(Number.isFinite)) return;
        const out = JSON.stringify({ type: 'view', cx: msg.cx, cy: msg.cy, zoom: msg.zoom } satisfies ServerMsg);
        for (const p of room.players) send(p.ws, out);
        break;
      }
      case 'ai': return this.ai(c, room, msg);
    }
  }

  private async join(c: Client, msg: Extract<ClientMsg, { type: 'join' }>) {
    const code = normalizeCode(String(msg.code ?? ''));
    if (c.code) this.disconnectFromRoom(c);
    c.code = code;
    c.role = msg.role === 'dm' ? 'dm' : 'player';
    c.name = String(msg.name ?? '').trim().slice(0, 24) || 'Adventurer';
    const room = await this.getRoom(code);

    if (c.role === 'dm') {
      const secret = String(msg.secret ?? '');
      if (!room) {
        if (!this.o.secrets.mayRestore(code, secret)) return send(c.ws, { type: 'error', code: 'bad-secret' });
        c.pendingSecret = secret;
        this.wait(c, code);
        return send(c.ws, { type: 'error', code: 'no-room' });
      }
      if (!sameHash(hashSecret(secret), room.secretHash)) return send(c.ws, { type: 'error', code: 'bad-secret' });
      this.attach(c, room);
      return;
    }
    if (!room) {
      this.wait(c, code);
      return send(c.ws, { type: 'error', code: 'no-room' });
    }
    this.attach(c, room);
  }

  private disconnectFromRoom(c: Client) {
    const room = c.code ? this.rooms.get(c.code) : undefined;
    this.waiting.get(c.code ?? '')?.delete(c);
    if (room) { room.dms.delete(c); if (room.players.delete(c)) this.sendPresence(room); }
  }

  private wait(c: Client, code: string) {
    let set = this.waiting.get(code);
    if (!set) this.waiting.set(code, (set = new Set()));
    set.add(c);
  }

  private attach(c: Client, room: Room) {
    if (room.unloadTimer) { clearTimeout(room.unloadTimer); room.unloadTimer = null; }
    this.waiting.get(room.code)?.delete(c);
    send(c.ws, { type: 'joined', role: c.role!, code: room.code, aiEnabled: this.aiEnabled });
    if (c.role === 'dm') {
      room.dms.add(c);
      send(c.ws, { type: 'state', game: room.game });
      send(c.ws, { type: 'presence', players: this.watchers(room) });
    } else {
      // Bring existing players up to date first, so everyone shares one
      // baseline and the next change is sent to all as a small diff.
      this.broadcast(room);
      room.players.add(c);
      room.last = this.sendFullView(room, c);
      this.sendPresence(room);
    }
  }

  private async restore(c: Client, game: Game) {
    const code = c.code;
    if (!code || c.role !== 'dm' || !c.pendingSecret) return send(c.ws, { type: 'error', code: 'not-allowed' });
    if (this.rooms.has(code) || (await this.o.store.exists(code))) {
      // Someone restored it first; join normally.
      return this.join(c, { type: 'join', code, role: 'dm', secret: c.pendingSecret });
    }
    try {
      if (!game || typeof game !== 'object' || !Array.isArray(game.maps) || game.maps.length > 100) throw new Error('bad game');
      game.maps.forEach(validateMap);
      const maps = game.maps.map(sanitizeMap);
      const clean: Game = {
        code, maps,
        liveMapId: maps.some((m) => m.id === game.liveMapId) ? game.liveMapId : maps[0]?.id ?? null,
        screen: sanitizeScreen(game.screen),
        createdAt: Number(game.createdAt) || Date.now(), updatedAt: Date.now(),
      };
      const room = this.makeRoom(clean, hashSecret(c.pendingSecret));
      this.rooms.set(code, room);
      c.pendingSecret = undefined;
      this.persist(room);
      this.attach(c, room);
      for (const w of [...(this.waiting.get(code) ?? [])]) {
        if (w.role === 'player') this.attach(w, room);
        else if (w.pendingSecret) void this.join(w, { type: 'join', code, role: 'dm', secret: w.pendingSecret });
      }
      this.waiting.delete(code);
    } catch {
      send(c.ws, { type: 'error', code: 'bad-message', message: 'Could not restore that game.' });
    }
  }

  private async ai(c: Client, room: Room, req: AiRequest) {
    const reqId = String(req.reqId ?? '').slice(0, 40);
    if (!this.o.ai) return send(c.ws, { type: 'ai.error', reqId, message: 'AI is not set up on this server. Use the built-in generator, or add an ANTHROPIC_API_KEY.' });
    const now = Date.now();
    room.aiTimes = room.aiTimes.filter((t) => now - t < 60_000);
    if (room.aiTimes.length >= (this.o.aiPerMinute ?? 5)) {
      return send(c.ws, { type: 'ai.error', reqId, message: 'Slow down: a few AI maps per minute. Try again shortly.' });
    }
    room.aiTimes.push(now);
    const clamp = (v: unknown, d: number) => Math.max(MAP_MIN, Math.min(MAP_MAX, Math.round(Number(v) || d)));
    const theme = THEMES.includes(req.theme) ? req.theme : 'dungeon';
    const width = clamp(req.width, 40), height = clamp(req.height, 30);
    const prompt = String(req.prompt ?? '').slice(0, 1000);
    try {
      const plan = await this.o.ai.generate({ reqId, prompt, theme, width, height, placeCreatures: !!req.placeCreatures });
      const map = buildMapFromPlan(plan, { width, height, theme, seed: randomBytes(4).toString('hex'), placeCreatures: !!req.placeCreatures });
      send(c.ws, { type: 'ai.result', reqId, map });
    } catch (err) {
      console.error('[ai] generation failed:', (err as Error).message);
      send(c.ws, { type: 'ai.error', reqId, message: 'The AI could not make that map. Try again, or rephrase.' });
    }
  }

  private persist(room: Room) {
    this.o.store.save(room.code, { game: room.game, secretHash: room.secretHash });
  }

  private watchers(room: Room): Watcher[] {
    return [...room.players].map((p) => ({ id: p.id, name: p.name }));
  }

  private sendPresence(room: Room) {
    const out = JSON.stringify({ type: 'presence', players: this.watchers(room) } satisfies ServerMsg);
    for (const d of room.dms) send(d.ws, out);
  }

  private parts(room: Room) {
    const v = playerView(room.game);
    let stat: PlayerStatic | null = null, dyn: PlayerDynamic | null = null;
    if (v.map) {
      const s: Record<string, unknown> = {}, d: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v.map)) ((STATIC_KEYS as readonly string[]).includes(k) ? s : d)[k] = val;
      stat = s as unknown as PlayerStatic;
      dyn = d as unknown as PlayerDynamic;
    }
    return { screen: JSON.stringify(v.screen), static: JSON.stringify(stat), dynamic: JSON.stringify(dyn) };
  }

  private sendFullView(room: Room, c: Client) {
    const p = this.parts(room);
    send(c.ws, `{"type":"pview","screen":${p.screen},"static":${p.static},"dynamic":${p.dynamic}}`);
    return p;
  }

  private schedule(room: Room) {
    if (room.timer) return;
    room.timer = setTimeout(() => {
      room.timer = null;
      this.broadcast(room);
    }, this.o.broadcastMs ?? 40);
  }

  /** Send players only the parts of their view that changed. */
  broadcast(room: Room) {
    if (!room.players.size) { room.last = { screen: '', static: '', dynamic: '' }; return; }
    let p: Room['last'];
    try { p = this.parts(room); } catch (err) {
      // Never let one game's bad data take the server down.
      console.error(`[hub] could not build player view for ${room.code}:`, err);
      return;
    }
    const fields: string[] = [];
    if (p.screen !== room.last.screen) fields.push(`"screen":${p.screen}`);
    if (p.static !== room.last.static) fields.push(`"static":${p.static}`);
    if (p.dynamic !== room.last.dynamic) fields.push(`"dynamic":${p.dynamic}`);
    room.last = p;
    if (!fields.length) return;
    const out = `{"type":"pview",${fields.join(',')}}`;
    for (const pl of room.players) send(pl.ws, out);
  }

  async close() {
    clearInterval(this.heartbeat);
    for (const r of this.rooms.values()) {
      if (r.timer) clearTimeout(r.timer);
      if (r.unloadTimer) clearTimeout(r.unloadTimer);
    }
    for (const c of this.clients) c.ws.terminate();
    await this.o.store.flushAll();
  }
}
