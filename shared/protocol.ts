import type { Op } from './ops';
import type { Game, MapData, ScreenState, Theme } from './types';
import type { PlayerMap } from './view';

export type Role = 'dm' | 'player';

/** Which AI the server has (Claude, or a local Ollama model) and whether it's ready. */
export interface AiStatus { kind: 'claude' | 'ollama'; model: string; ready: boolean; reachable?: boolean; hasModel?: boolean; pulling?: boolean }

export interface AiRequest {
  reqId: string;
  prompt: string;
  theme: Theme;
  width: number;
  height: number;
  placeCreatures: boolean;
}

export type ClientMsg =
  | { type: 'join'; code: string; role: Role; secret?: string; name?: string }
  | { type: 'op'; op: Op }
  | { type: 'restore'; game: Game }
  /** Players may ping too (never with focus). `as` is the party token they play, for its colour. */
  | { type: 'ping'; x: number; y: number; focus: boolean; as?: string }
  | { type: 'view'; cx: number; cy: number; zoom: number }
  | ({ type: 'ai' } & AiRequest)
  | { type: 'hb' }
  /** DM: ask which AI is available; ask to download the local model. */
  | { type: 'ai.info' }
  | { type: 'ai.pull' }
  /** A player sets (or clears, with id null) the picture of a party token they can see. */
  | { type: 'icon'; tokenId: string; id: string | null; data?: string };

/** Map fields that rarely change (terrain, fog, doors, objects). */
export type PlayerStatic = Pick<PlayerMap, 'id' | 'name' | 'width' | 'height' | 'theme' | 'terrain' | 'fog' | 'doors' | 'objects'>;
/** Fields that change often (tokens, templates, drawings...). */
export type PlayerDynamic = Omit<PlayerMap, keyof PlayerStatic>;

export interface Watcher { id: string; name: string }

export type ServerMsg =
  | { type: 'joined'; role: Role; code: string; aiEnabled: boolean }
  | { type: 'ai.info'; ai: AiStatus | null }
  | { type: 'ai.progress'; status: string; total: number; completed: number; done?: boolean; error?: string }
  | { type: 'state'; game: Game }
  | { type: 'op'; op: Op }
  | { type: 'pview'; screen?: ScreenState; static?: PlayerStatic | null; dynamic?: PlayerDynamic | null }
  | { type: 'presence'; players: Watcher[] }
  | { type: 'ping'; x: number; y: number; focus: boolean; by?: string; color?: string }
  | { type: 'view'; cx: number; cy: number; zoom: number }
  | { type: 'ai.result'; reqId: string; map: MapData }
  | { type: 'ai.error'; reqId: string; message: string }
  | { type: 'error'; code: 'no-room' | 'bad-secret' | 'bad-op' | 'bad-message' | 'not-allowed'; message?: string };

export const STATIC_KEYS = ['id', 'name', 'width', 'height', 'theme', 'terrain', 'fog', 'doors', 'objects'] as const;
