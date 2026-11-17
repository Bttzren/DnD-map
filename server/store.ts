// Rooms on disk: one JSON file per game. Writes are debounced and atomic.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Game } from '../shared/types';

export interface RoomRecord { game: Game; secretHash: string }

const THIRTY_DAYS = 30 * 24 * 3600 * 1000;

export class Store {
  private timers = new Map<string, NodeJS.Timeout>();
  private pending = new Map<string, RoomRecord>();
  private dir: string;

  constructor(dataDir: string, private debounceMs = 1000) {
    this.dir = path.join(dataDir, 'rooms');
  }

  async init() {
    await fs.mkdir(this.dir, { recursive: true });
    await this.cleanup();
  }

  private file(code: string) { return path.join(this.dir, `${code.replace(/[^A-Z0-9]/g, '')}.json`); }

  async load(code: string): Promise<RoomRecord | null> {
    const pending = this.pending.get(code);
    if (pending) return pending;
    try {
      return JSON.parse(await fs.readFile(this.file(code), 'utf8')) as RoomRecord;
    } catch {
      return null;
    }
  }

  async exists(code: string): Promise<boolean> {
    if (this.pending.has(code)) return true;
    try { await fs.access(this.file(code)); return true; } catch { return false; }
  }

  save(code: string, rec: RoomRecord) {
    this.pending.set(code, rec);
    if (this.timers.has(code)) return;
    this.timers.set(code, setTimeout(() => void this.flush(code), this.debounceMs));
  }

  async flush(code: string) {
    const t = this.timers.get(code);
    if (t) clearTimeout(t);
    this.timers.delete(code);
    const rec = this.pending.get(code);
    if (!rec) return;
    this.pending.delete(code);
    const file = this.file(code);
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(rec));
      await fs.rename(tmp, file);
    } catch (err) {
      console.error(`[store] failed to save ${code}:`, err);
    }
  }

  async flushAll() {
    await Promise.all([...this.pending.keys()].map((c) => this.flush(c)));
  }

  /** Delete rooms nobody has touched for 30 days. */
  async cleanup(now = Date.now()) {
    let names: string[] = [];
    try { names = await fs.readdir(this.dir); } catch { return; }
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      const f = path.join(this.dir, n);
      try {
        const st = await fs.stat(f);
        if (now - st.mtimeMs > THIRTY_DAYS) await fs.unlink(f);
      } catch { /* ignore */ }
    }
  }
}
