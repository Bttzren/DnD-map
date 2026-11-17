// Browser storage, wrapped so private windows and full quotas never break the app.
import type { Game } from '../shared/types';

const get = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string): boolean => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
const del = (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } };

export interface SavedGame { code: string; secret: string; name: string; at: number }

export function myGames(): SavedGame[] {
  try { return (JSON.parse(get('dndmap:games') ?? '[]') as SavedGame[]).sort((a, b) => b.at - a.at); } catch { return []; }
}

export function rememberGame(code: string, secret: string, name?: string) {
  const list = myGames().filter((g) => g.code !== code);
  const prev = myGames().find((g) => g.code === code);
  list.unshift({ code, secret, name: name ?? prev?.name ?? '', at: Date.now() });
  set('dndmap:games', JSON.stringify(list.slice(0, 20)));
}

export function forgetGame(code: string) {
  set('dndmap:games', JSON.stringify(myGames().filter((g) => g.code !== code)));
  del(`dndmap:backup:${code}`);
}

export function secretFor(code: string): string | null {
  return myGames().find((g) => g.code === code)?.secret ?? null;
}

/** Full copy of the game, used to restore it if the server restarts empty. */
export function saveBackup(game: Game): boolean {
  return set(`dndmap:backup:${game.code}`, JSON.stringify(game));
}

export function loadBackup(code: string): Game | null {
  try { const s = get(`dndmap:backup:${code}`); return s ? (JSON.parse(s) as Game) : null; } catch { return null; }
}

export const pref = {
  get<T>(k: string, d: T): T { try { const s = get(`dndmap:pref:${k}`); return s === null ? d : (JSON.parse(s) as T); } catch { return d; } },
  set(k: string, v: unknown) { set(`dndmap:pref:${k}`, JSON.stringify(v)); },
};
