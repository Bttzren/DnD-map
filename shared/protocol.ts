import type { Op } from './ops';
import type { Game, MapData, ScreenState, Theme } from './types';
import type { PlayerMap } from './view';

export type Role = 'dm' | 'player';

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
  | { type: 'ping'; x: number; y: number; focus: boolean }
  | { type: 'view'; cx: number; cy: number; zoom: number }
  | ({ type: 'ai' } & AiRequest)
  | { type: 'hb' };

/** Map fields that rarely change (terrain, fog, doors, objects). */
export type PlayerStatic = Pick<PlayerMap, 'id' | 'name' | 'width' | 'height' | 'theme' | 'terrain' | 'fog' | 'doors' | 'objects'>;
/** Fields that change often (tokens, templates, drawings...). */
export type PlayerDynamic = Omit<PlayerMap, keyof PlayerStatic>;

export interface Watcher { id: string; name: string }

export type ServerMsg =
  | { type: 'joined'; role: Role; code: string; aiEnabled: boolean }
  | { type: 'state'; game: Game }
  | { type: 'op'; op: Op }
  | { type: 'pview'; screen?: ScreenState; static?: PlayerStatic | null; dynamic?: PlayerDynamic | null }
  | { type: 'presence'; players: Watcher[] }
  | { type: 'ping'; x: number; y: number; focus: boolean }
  | { type: 'view'; cx: number; cy: number; zoom: number }
  | { type: 'ai.result'; reqId: string; map: MapData }
  | { type: 'ai.error'; reqId: string; message: string }
  | { type: 'error'; code: 'no-room' | 'bad-secret' | 'bad-op' | 'bad-message' | 'not-allowed'; message?: string };

export const STATIC_KEYS = ['id', 'name', 'width', 'height', 'theme', 'terrain', 'fog', 'doors', 'objects'] as const;
