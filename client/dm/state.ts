// The DM's client state: the full game, what's selected, tool settings,
// undo history, and the connection. Edits apply locally first, then sync.
import { applyOp, findMap, type Coll, type Op } from '../../shared/ops';
import type { AiRequest, ServerMsg, Watcher } from '../../shared/protocol';
import {
  defaultScreen, uid,
  type DoorState, type Game, type MapData, type ObjectKind, type TemplateShape, type Terrain, type Theme,
} from '../../shared/types';
import { loadBackup, pref, rememberGame, saveBackup, secretFor } from '../local';
import { Connection, type Status } from '../net';
import type { Ping } from '../render/types';
import { Store, toast } from '../ui';

export type Tool = 'select' | 'paint' | 'door' | 'object' | 'fog' | 'ruler' | 'template' | 'draw' | 'label' | 'ping';
export type Tab = 'generate' | 'tokens' | 'initiative' | 'map' | 'table';

export interface ToolOpts {
  terrain: Terrain;
  brush: number;
  autoWalls: boolean;
  fogMode: 'reveal' | 'hide';
  fogShape: 'brush' | 'room';
  doorState: DoorState;
  objectKind: ObjectKind;
  objectHidden: boolean;
  tplShape: TemplateShape;
  tplSize: number;
  tplColor: string;
  drawColor: string;
  drawWidth: number;
  drawHidden: boolean;
  labelColor: string;
  labelHidden: boolean;
}

export interface Selection { coll: Coll; id: string }

export interface DmState {
  code: string;
  secret: string | null;
  status: Status;
  fatal: string | null;
  aiEnabled: boolean;
  aiBusy: boolean;
  game: Game | null;
  mapId: string | null;
  players: Watcher[];
  tool: Tool;
  opts: ToolOpts;
  /** Selected tokens (several with shift-click). */
  selected: string[];
  /** Selected template, drawing or label. */
  other: Selection | null;
  tab: Tab;
  panelOpen: boolean;
  showRooms: boolean;
  fogTint: boolean;
  share: boolean;
  ver: number;
  staticVer: number;
  fogVer: number;
  canUndo: boolean;
  canRedo: boolean;
  pings: Ping[];
}

const DEFAULT_OPTS: ToolOpts = {
  terrain: 'floor', brush: 1, autoWalls: true, fogMode: 'reveal', fogShape: 'room',
  doorState: 'closed', objectKind: 'chest', objectHidden: false,
  tplShape: 'circle', tplSize: 20, tplColor: '#f97316',
  drawColor: '#facc15', drawWidth: 2, drawHidden: false, labelColor: '#f4ead5', labelHidden: false,
};

const UNDO_LIMIT = 60;

export class DmCtl extends Store<DmState> {
  conn: Connection;
  private undo = new Map<string, MapData[]>();
  private redo = new Map<string, MapData[]>();
  private batchDepth = 0;
  private backupTimer: ReturnType<typeof setTimeout> | null = null;
  private backupWarned = false;
  private aiWaiters = new Map<string, (m: MapData | null) => void>();
  private viewTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(code: string) {
    let secret = secretFor(code);
    const hash = location.hash.slice(1);
    if (/^[0-9a-f]{64}$/.test(hash)) {
      secret = hash;
      rememberGame(code, hash);
      history.replaceState(null, '', location.pathname);
    }
    super({
      code, secret, status: 'connecting', fatal: secret ? null : 'no-secret', aiEnabled: false, aiBusy: false,
      game: null, mapId: null, players: [], tool: 'select', opts: { ...DEFAULT_OPTS, ...pref.get<Partial<ToolOpts>>('opts', {}) },
      selected: [], other: null, tab: 'generate', panelOpen: pref.get('panelOpen', true), showRooms: pref.get('showRooms', true),
      fogTint: true, share: false, ver: 0, staticVer: 0, fogVer: 0, canUndo: false, canRedo: false, pings: [],
    });
    this.conn = new Connection(
      () => ({ type: 'join', code, role: 'dm', secret: this.state.secret ?? '' }),
      (m) => this.onMsg(m),
      (status) => this.set({ status }),
    );
    if (!secret) this.conn.close();
  }

  destroy() { this.conn.close(); if (this.backupTimer) clearTimeout(this.backupTimer); }

  get map(): MapData | null { return findMap(this.state.game ?? { maps: [] } as unknown as Game, this.state.mapId) ?? null; }
  get live(): MapData | null { return this.state.game ? findMap(this.state.game, this.state.game.liveMapId) ?? null : null; }

  // ------------------------------------------------------------ server messages

  private onMsg(m: ServerMsg) {
    switch (m.type) {
      case 'joined':
        this.set({ aiEnabled: m.aiEnabled, fatal: null });
        break;
      case 'state': {
        const game = m.game;
        for (const f of this.conn.takeFlushed()) if (f.type === 'op') { try { applyOp(game, f.op); } catch { /* ignore */ } }
        const mapId = findMap(game, this.state.mapId) ? this.state.mapId : game.liveMapId ?? game.maps[0]?.id ?? null;
        this.state = { ...this.state, game, mapId };
        this.bump(true, true);
        this.scheduleBackup();
        if (!game.maps.length) this.set({ tab: 'generate', panelOpen: true });
        break;
      }
      case 'op': {
        if (!this.state.game) return;
        try { applyOp(this.state.game, m.op); } catch { return; }
        const [s, f] = touches(m.op);
        if (m.op.t === 'map.delete' && this.state.mapId === m.op.mapId) this.state.mapId = this.state.game.liveMapId ?? this.state.game.maps[0]?.id ?? null;
        this.bump(s, f);
        this.scheduleBackup();
        break;
      }
      case 'presence': {
        const before = this.state.players.length;
        this.set({ players: m.players });
        if (m.players.length > before && this.state.ver > 0) toast(`${m.players[m.players.length - 1].name} joined the table`, 'ok');
        break;
      }
      case 'ping': this.addPing(m.x, m.y, m.color, m.by); break;
      case 'ai.result': this.aiWaiters.get(m.reqId)?.(m.map); this.aiWaiters.delete(m.reqId); break;
      case 'ai.error': toast(m.message, 'error', 5000); this.aiWaiters.get(m.reqId)?.(null); this.aiWaiters.delete(m.reqId); break;
      case 'error':
        if ((m.code === 'bad-message' || m.code === 'not-allowed') && m.message) { toast(m.message, 'error'); break; }
        if (m.code === 'no-room') {
          // The server lost this game (e.g. it restarted). Hand it our copy.
          const game = this.state.game ?? loadBackup(this.state.code) ?? { code: this.state.code, maps: [], liveMapId: null, screen: defaultScreen(), createdAt: Date.now(), updatedAt: Date.now() };
          this.conn.send({ type: 'restore', game }, false);
          toast('Server restarted: restoring your game from this browser…', 'info', 4000);
        } else if (m.code === 'bad-secret') {
          this.set({ fatal: 'bad-secret' });
          this.conn.close();
        } else if (m.code === 'bad-op') toast(`The server rejected a change: ${m.message ?? ''}`, 'error');
        break;
    }
  }

  private bump(staticChanged: boolean, fogChanged: boolean) {
    this.set({
      ver: this.state.ver + 1,
      staticVer: this.state.staticVer + (staticChanged ? 1 : 0),
      fogVer: this.state.fogVer + (fogChanged ? 1 : 0),
      canUndo: (this.undo.get(this.state.mapId ?? '')?.length ?? 0) > 0,
      canRedo: (this.redo.get(this.state.mapId ?? '')?.length ?? 0) > 0,
    });
  }

  private scheduleBackup() {
    if (this.backupTimer) return;
    this.backupTimer = setTimeout(() => {
      this.backupTimer = null;
      const g = this.state.game;
      if (!g) return;
      if (!saveBackup(g) && !this.backupWarned) {
        this.backupWarned = true;
        toast('This game is too big to back up in your browser. Export important maps from the Map tab.', 'error', 6000);
      }
      const name = this.live?.name;
      if (name && this.state.secret) rememberGame(this.state.code, this.state.secret, name);
    }, 800);
  }

  // ------------------------------------------------------------ edits

  /** Apply an op locally and send it. Map ops are undoable unless inside a batch. */
  dispatch(op: Op, opts: { undoable?: boolean } = {}) {
    const game = this.state.game;
    if (!game) return;
    const mapId = 'mapId' in op ? op.mapId : op.t === 'map.put' ? op.map.id : null;
    if (mapId && opts.undoable !== false && this.batchDepth === 0) this.snapshot(mapId);
    try { applyOp(game, op); } catch (e) { toast(`Could not apply that: ${(e as Error).message}`, 'error'); return; }
    this.conn.send({ type: 'op', op });
    const [s, f] = touches(op);
    this.bump(s, f);
    this.scheduleBackup();
  }

  /** Group several dispatches (a brush stroke, a drag) into one undo step. */
  begin() {
    if (this.batchDepth++ === 0 && this.state.mapId) this.snapshot(this.state.mapId);
  }
  end() { this.batchDepth = Math.max(0, this.batchDepth - 1); }

  private snapshot(mapId: string) {
    const m = findMap(this.state.game!, mapId);
    if (!m) return;
    const stack = this.undo.get(mapId) ?? [];
    stack.push(structuredClone(m));
    if (stack.length > UNDO_LIMIT) stack.shift();
    this.undo.set(mapId, stack);
    this.redo.set(mapId, []);
  }

  undoStep() { this.step(this.undo, this.redo, 'Undone'); }
  redoStep() { this.step(this.redo, this.undo, 'Redone'); }

  private step(from: Map<string, MapData[]>, to: Map<string, MapData[]>, msg: string) {
    const id = this.state.mapId;
    const cur = this.map;
    const prev = id ? from.get(id)?.pop() : undefined;
    if (!id || !cur || !prev) return;
    const other = to.get(id) ?? [];
    other.push(structuredClone(cur));
    to.set(id, other);
    this.dispatch({ t: 'map.put', map: prev }, { undoable: false });
    this.set({ selected: this.state.selected.filter((s) => prev.tokens.some((t) => t.id === s)) });
    toast(msg, 'info', 900);
  }

  // ------------------------------------------------------------ helpers

  setOpts(patch: Partial<ToolOpts>) {
    const opts = { ...this.state.opts, ...patch };
    pref.set('opts', opts);
    this.set({ opts });
  }

  setTool(tool: Tool) { this.set({ tool, other: tool === 'select' ? this.state.other : null }); }

  togglePanel(open?: boolean) {
    const panelOpen = open ?? !this.state.panelOpen;
    pref.set('panelOpen', panelOpen);
    this.set({ panelOpen });
  }

  openTab(tab: Tab) { this.set({ tab }); this.togglePanel(true); }

  editMap(mapId: string) {
    this.set({ mapId, selected: [], other: null, staticVer: this.state.staticVer + 1, fogVer: this.state.fogVer + 1 });
    this.bump(false, false);
  }

  addMap(map: MapData, makeLive: boolean) {
    this.dispatch({ t: 'map.put', map }, { undoable: false });
    this.editMap(map.id);
    if (makeLive) this.dispatch({ t: 'game.patch', liveMapId: map.id });
  }

  replaceMap(map: MapData) {
    const cur = this.map;
    if (!cur) return this.addMap(map, true);
    this.dispatch({ t: 'map.put', map: { ...map, id: cur.id } });
    this.set({ selected: [], other: null });
  }

  addPing(x: number, y: number, color = '#facc15', label?: string) {
    const now = performance.now();
    this.set({ pings: [...this.state.pings.filter((p) => now - p.t0 < 2500), { x, y, t0: now, color, label }] });
  }

  ping(x: number, y: number, focus: boolean) {
    this.conn.send({ type: 'ping', x, y, focus }, false);
    this.addPing(x, y);
  }

  /** Tell players where the DM is looking (only used when they follow). */
  sendView(cx: number, cy: number, cellsAcross: number) {
    if (!this.state.game?.screen.followDm || this.state.mapId !== this.state.game.liveMapId) return;
    if (this.viewTimer) return;
    this.viewTimer = setTimeout(() => {
      this.viewTimer = null;
      this.conn.send({ type: 'view', cx, cy, zoom: cellsAcross }, false);
    }, 120);
  }

  generateAi(req: Omit<AiRequest, 'reqId'>): Promise<MapData | null> {
    const reqId = uid('ai');
    this.set({ aiBusy: true });
    return new Promise((res) => {
      const timer = setTimeout(() => { this.aiWaiters.delete(reqId); this.set({ aiBusy: false }); toast('The AI took too long. Try again.', 'error'); res(null); }, 150_000);
      this.aiWaiters.set(reqId, (m) => { clearTimeout(timer); this.set({ aiBusy: false }); res(m); });
      this.conn.send({ type: 'ai', reqId, ...req }, false);
      if (this.state.status !== 'open') { clearTimeout(timer); this.aiWaiters.delete(reqId); this.set({ aiBusy: false }); toast('Not connected to the server', 'error'); res(null); }
    });
  }

  newMapId() { return uid('map'); }
  setTheme(theme: Theme) { const m = this.map; if (m) this.dispatch({ t: 'map.patch', mapId: m.id, patch: { theme } }); }
}

/** Which cached layers an op invalidates: [static, fog]. */
function touches(op: Op): [boolean, boolean] {
  switch (op.t) {
    case 'map.put': case 'map.delete': return [true, true];
    case 'terrain.set': return [true, false];
    case 'fog.set': case 'fog.all': return [false, true];
    case 'item.put': case 'item.delete': return [op.coll === 'doors' || op.coll === 'objects', false];
    case 'map.patch': return [!!op.patch.theme, false];
    default: return [false, false];
  }
}
