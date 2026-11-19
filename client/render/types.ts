import type { TrapInfo } from '../../shared/traps';
import type { AreaTemplate, DoorState, Drawing, Label, MapSettings, ObjectKind, Room, Terrain, Theme, TokenKind } from '../../shared/types';

/** What the renderer needs, whether it came from the DM's full map or a player's filtered view. */
export interface RenderToken {
  id: string;
  name: string;
  label: string;
  color: string;
  size: number;
  kind: TokenKind;
  x: number;
  y: number;
  down: boolean;
  hidden: boolean;
  conditions: string[];
  /** 0..1 for an HP bar, or null for none. */
  hpRatio: number | null;
  /** Text under the token, e.g. "12/20" or "bloodied". */
  hpText: string | null;
  /** Picture to show instead of the label, as a URL. */
  image: string | null;
}

export interface RenderMap {
  id: string;
  name: string;
  width: number;
  height: number;
  theme: Theme;
  settings: MapSettings;
  terrain: Terrain[];
  /** DM only: fog to tint. Players get fog baked into terrain. */
  fog: number[] | null;
  doors: { id: string; x: number; y: number; state: DoorState }[];
  objects: { id: string; x: number; y: number; kind: ObjectKind; hidden?: boolean; trap?: Pick<TrapInfo, 'type' | 'state'> & Partial<TrapInfo> }[];
  tokens: RenderToken[];
  templates: AreaTemplate[];
  drawings: Drawing[];
  labels: Label[];
  rooms: Room[];
  activeTokenId: string | null;
}

export interface Ping { x: number; y: number; t0: number; color: string; label?: string }

export interface Overlay {
  selectedTokenId?: string | null;
  selectedIds?: Set<string>;
  hoverCell?: { x: number; y: number } | null;
  /** Brush footprint preview, in cells. */
  brush?: { x: number; y: number; size: number; color: string } | null;
  ruler?: { from: { x: number; y: number }; to: { x: number; y: number }; text: string } | null;
  draftTemplate?: AreaTemplate | null;
  draftDrawing?: Drawing | null;
  /** Token positions being dragged (id -> cell). */
  dragging?: Map<string, { x: number; y: number }>;
  pings?: Ping[];
  showRoomNames?: boolean;
  showFogTint?: boolean;
}
