// Token pictures: turn a photo or file into a small square JPEG, and work
// out where to load a picture from.
import { isImageData } from '../shared/types';

const SIZE = 192;

/** Crop the middle square of an image file, shrink it and give it a content-based id. */
export async function fileToIcon(file: File): Promise<{ id: string; data: string }> {
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|gif|heic|heif|avif|bmp)$/i.test(file.name)) {
    throw new Error('That file isn’t a picture.');
  }
  const url = URL.createObjectURL(file);
  try {
    const im = new Image();
    im.src = url;
    try { await im.decode(); } catch { throw new Error('That picture couldn’t be opened. Try a JPEG or PNG.'); }
    const s = Math.min(im.naturalWidth, im.naturalHeight);
    if (!s) throw new Error('That picture is empty.');
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    // Step down in halves for a clean result from big camera photos.
    let src: CanvasImageSource = im, sx = (im.naturalWidth - s) / 2, sy = (im.naturalHeight - s) / 2, ss = s;
    while (ss / 2 > SIZE * 1.5) {
      const h = document.createElement('canvas');
      h.width = h.height = Math.round(ss / 2);
      const hc = h.getContext('2d')!;
      hc.imageSmoothingQuality = 'high';
      hc.drawImage(src, sx, sy, ss, ss, 0, 0, h.width, h.height);
      src = h; sx = 0; sy = 0; ss = h.width;
    }
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(src, sx, sy, ss, ss, 0, 0, SIZE, SIZE);
    let data = c.toDataURL('image/jpeg', 0.84);
    if (!isImageData(data)) data = c.toDataURL('image/jpeg', 0.6);
    if (!isImageData(data)) throw new Error('That picture couldn’t be used.');
    return { id: hashId(data), data };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function hashId(s: string): string {
  // Two independent 32-bit FNV-1a hashes: plenty to tell pictures apart.
  let a = 2166136261, b = 0x811c9dc5 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b ^ c, 2246822519);
  }
  return (a >>> 0).toString(36).padStart(7, '0') + (b >>> 0).toString(36).padStart(7, '0');
}

/** Pictures the DM has locally (data: URLs) or, for players, from the server. */
export type ImageResolver = (id: string | undefined) => string | null;
export const dmImages = (images: Record<string, string> | undefined): ImageResolver => (id) => (id && images?.[id]) || null;
export const playerImages = (code: string): ImageResolver => (id) => (id ? `/api/img/${encodeURIComponent(code)}/${id}` : null);

/** A file picker for pictures: on phones this offers the camera roll, the camera and files. */
export function pickImage(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);
    let done = false;
    const finish = (f: File | null) => { if (done) return; done = true; input.remove(); resolve(f); };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => finish(null));
    input.click();
  });
}
