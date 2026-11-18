// Draws the textured static layer off the main thread, so the map stays
// smooth to pan and tap while a reveal or a paint stroke is being drawn.
// Only the newest request is drawn; older ones waiting behind it are skipped.
import { drawStaticTextured, type StaticMap } from './texturedLayer';
import { loadTextures } from './textures';

export interface StaticRequest { seq: number; map: StaticMap; px: number; dm: boolean }
export type StaticReply = { seq: number; bitmap: ImageBitmap; px: number } | { seq: number; error: string };

const ready = loadTextures();
let pending: StaticRequest | null = null;
let busy = false;

const post = (m: StaticReply, transfer: Transferable[] = []) => (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(m, transfer);

async function run() {
  busy = true;
  const ok = await ready;
  while (pending) {
    const req = pending;
    pending = null;
    if (!ok) { post({ seq: req.seq, error: 'no-textures' }); continue; }
    try {
      const c = new OffscreenCanvas(req.map.width * req.px, req.map.height * req.px);
      drawStaticTextured(req.map, c, req.px, req.dm);
      const bitmap = c.transferToImageBitmap();
      post({ seq: req.seq, bitmap, px: req.px }, [bitmap]);
    } catch (e) {
      post({ seq: req.seq, error: String((e as Error)?.message ?? e) });
    }
    // Let any newer requests that arrived meanwhile replace `pending` first.
    await new Promise((r) => setTimeout(r, 0));
  }
  busy = false;
}

self.onmessage = (e: MessageEvent<StaticRequest>) => {
  pending = e.data;
  if (!busy) void run();
};
