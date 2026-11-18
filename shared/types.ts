// Core data model shared by server and client.
// Coordinates are in grid cells; one cell is 5 ft.

export const TERRAINS = [
  'void', 'floor', 'wall', 'water', 'deepwater', 'lava',
  'grass', 'dirt', 'trees', 'rubble', 'pit',
] as const;
export type Terrain = (typeof TERRAINS)[number];

export const THEMES = ['dungeon', 'cave', 'crypt', 'forest', 'tavern', 'sewer'] as const;
export type Theme = (typeof THEMES)[number];

export const DOOR_STATES = ['open', 'closed', 'secret'] as const;
export type DoorState = (typeof DOOR_STATES)[number];

export const OBJECT_KINDS = [
  'stairs', 'chest', 'table', 'pillar', 'altar', 'statue',
  'bed', 'barrel', 'campfire', 'trap',
] as const;
export type ObjectKind = (typeof OBJECT_KINDS)[number];

export const TOKEN_KINDS = ['player', 'ally', 'enemy', 'neutral'] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];

export const HP_VISIBILITY = ['exact', 'bar', 'vague', 'none'] as const;
export type HpVisibility = (typeof HP_VISIBILITY)[number];

export const DISTANCE_RULES = ['5e', 'alt', 'euclid'] as const;
export type DistanceRule = (typeof DISTANCE_RULES)[number];

export const AMBIENCES = ['none', 'rain', 'snow', 'fog', 'embers', 'dark'] as const;
export type Ambience = (typeof AMBIENCES)[number];

export const CONDITIONS = [
  'blinded', 'charmed', 'concentrating', 'deafened', 'frightened', 'grappled',
  'invisible', 'paralyzed', 'poisoned', 'prone', 'restrained', 'stunned',
  'unconscious', 'blessed', 'hasted', 'raging',
] as const;
export type Condition = (typeof CONDITIONS)[number];

export const TEMPLATE_SHAPES = ['circle', 'cone', 'line', 'square'] as const;
export type TemplateShape = (typeof TEMPLATE_SHAPES)[number];

export interface Point { x: number; y: number }

export interface Door { id: string; x: number; y: number; state: DoorState }

export interface MapObject { id: string; x: number; y: number; kind: ObjectKind; hidden?: boolean }

export interface Room {
  id: string;
  name: string;
  note: string;
  /** Bounding box, for labels and quick hit tests. */
  x: number; y: number; w: number; h: number;
  /** Cell indices that belong to this room. */
  cells: number[];
}

export interface Token {
  id: string;
  name: string;
  /** Emoji or up to 3 characters. */
  label: string;
  color: string;
  /** Footprint in cells (1 = medium, 2 = large, 3 = huge, 4 = gargantuan). */
  size: number;
  kind: TokenKind;
  x: number; y: number;
  hidden: boolean;
  hp: number | null;
  maxHp: number | null;
  ac: number | null;
  conditions: string[];
  note: string;
  down: boolean;
  hpVisibility: HpVisibility;
  /** Initiative bonus, used when rolling. DM only. */
  initMod?: number;
  /** Picture id (a key of Game.images), shown instead of the label. */
  image?: string;
}

export interface AreaTemplate {
  id: string;
  shape: TemplateShape;
  /** Origin in cell units (may be fractional: cell corners/centres). */
  x: number; y: number;
  /** Radius / length / side in feet. */
  sizeFt: number;
  /** Direction in degrees for cones and lines (0 = east, 90 = south). */
  angle: number;
  color: string;
  hidden: boolean;
  label?: string;
}

export interface Drawing { id: string; points: [number, number][]; color: string; width: number; hidden: boolean }

export interface Label { id: string; x: number; y: number; text: string; color: string; size: number; hidden: boolean }

export interface InitiativeEntry { tokenId: string; init: number }

export interface Initiative {
  entries: InitiativeEntry[];
  /** Index into entries of whose turn it is, -1 when not started. */
  turn: number;
  round: number;
  visible: boolean;
}

export interface MapSettings {
  grid: boolean;
  gridOpacity: number;
  distanceRule: DistanceRule;
  ambience: Ambience;
}

export interface MapData {
  id: string;
  name: string;
  width: number;
  height: number;
  theme: Theme;
  seed: string;
  terrain: Terrain[];
  /** 1 = revealed to players. */
  fog: number[];
  doors: Door[];
  objects: MapObject[];
  rooms: Room[];
  tokens: Token[];
  templates: AreaTemplate[];
  drawings: Drawing[];
  labels: Label[];
  initiative: Initiative;
  settings: MapSettings;
}

export interface ScreenState {
  /** Hide the map from players and show `message` instead. */
  blank: boolean;
  message: string;
  /** Banner shown over the map; empty for none. */
  banner: string;
  /** Players' cameras follow the DM's camera. */
  followDm: boolean;
}

export interface Game {
  code: string;
  maps: MapData[];
  liveMapId: string | null;
  screen: ScreenState;
  createdAt: number;
  updatedAt: number;
  /** Token pictures: id -> small square image as a data: URL. */
  images?: Record<string, string>;
}

/** Token pictures are small squares, so these limits are generous. */
export const IMAGE_ID_RE = /^[a-z0-9]{8,40}$/;
export const MAX_IMAGE_CHARS = 150_000;
export const MAX_IMAGES = 200;
const IMAGE_DATA_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
export const isImageData = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_IMAGE_CHARS && IMAGE_DATA_RE.test(v);
export const isImageId = (v: unknown): v is string => typeof v === 'string' && IMAGE_ID_RE.test(v);

export const MAP_MIN = 10;
export const MAP_MAX = 80;
export const MAP_DEFAULT_W = 40;
export const MAP_DEFAULT_H = 30;

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function defaultSettings(): MapSettings {
  return { grid: true, gridOpacity: 0.35, distanceRule: '5e', ambience: 'none' };
}

export function defaultScreen(): ScreenState {
  return { blank: false, message: 'The story continues shortly…', banner: '', followDm: false };
}

export function emptyInitiative(): Initiative {
  return { entries: [], turn: -1, round: 0, visible: true };
}

export function uid(prefix = ''): string {
  const r = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  return prefix ? `${prefix}_${r}` : r;
}

export function blankMap(opts: { width: number; height: number; theme: Theme; name?: string; seed?: string; fill?: Terrain }): MapData {
  const n = opts.width * opts.height;
  return {
    id: uid('map'),
    name: opts.name ?? 'Untitled map',
    width: opts.width,
    height: opts.height,
    theme: opts.theme,
    seed: opts.seed ?? '',
    terrain: new Array<Terrain>(n).fill(opts.fill ?? 'void'),
    fog: new Array<number>(n).fill(0),
    doors: [], objects: [], rooms: [], tokens: [], templates: [], drawings: [], labels: [],
    initiative: emptyInitiative(),
    settings: defaultSettings(),
  };
}

export function makeToken(partial: Partial<Token> & Pick<Token, 'x' | 'y'>): Token {
  const kind = partial.kind ?? 'enemy';
  return {
    id: uid('tok'),
    name: 'Token',
    label: '?',
    color: kind === 'player' ? '#4f9dde' : kind === 'ally' ? '#5cb85c' : kind === 'neutral' ? '#c9a227' : '#d9534f',
    size: 1,
    kind,
    hidden: false,
    hp: null, maxHp: null, ac: null,
    conditions: [], note: '', down: false,
    hpVisibility: kind === 'player' || kind === 'ally' ? 'exact' : 'vague',
    ...partial,
  };
}
