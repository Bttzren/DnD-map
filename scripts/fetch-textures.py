#!/usr/bin/env python3
"""Download CC0 textures from Poly Haven and bake them for the map renderer.

For each texture this downloads the colour, normal and ambient-occlusion maps,
bakes soft top-left lighting from the normal map into the colour so stones and
planks read as raised, and writes a small seamless WebP plus a manifest with
each texture's real-world size, so the renderer can tile it at true scale.

The results are committed in public/textures/, so you only need this to
change or add textures.

    pip install pillow numpy
    python3 scripts/fetch-textures.py

All Poly Haven assets are CC0 (public domain): https://polyhaven.com/license
"""
import io
import json
import os
import sys
import urllib.request

import numpy as np
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'textures')
SIZE = 512  # output pixels per texture tile

# name -> (Poly Haven id, options)
#   tint: multiply colour (r, g, b) applied after lighting
#   gain: brightness multiplier
#   relief: strength of baked normal-map lighting
TEXTURES = {
    'floor-dungeon': ('rock_tile_floor', {'relief': 0.55}),
    'floor-crypt': ('stone_tiles_02', {'relief': 0.9, 'tint': (0.88, 0.92, 1.0), 'gain': 0.95}),
    'floor-cave': ('rock_face_03', {'relief': 0.7, 'gain': 0.9}),
    'floor-sewer': ('mossy_cobblestone', {'relief': 0.6, 'gain': 0.92}),
    'floor-tavern': ('wood_floor_worn', {'relief': 0.45}),
    'street': ('cobblestone_floor_08', {'relief': 0.6}),
    'wall-dungeon': ('castle_wall_slates', {'relief': 0.8, 'gain': 0.62}),
    'wall-crypt': ('rock_wall_08', {'relief': 0.8, 'gain': 0.7, 'tint': (0.9, 0.92, 1.0)}),
    'wall-cave': ('rock_boulder_dry', {'relief': 0.9, 'gain': 0.52, 'tint': (0.95, 0.82, 0.68)}),
    'wall-sewer': ('castle_brick_07', {'relief': 0.8, 'gain': 0.5, 'tint': (0.85, 0.9, 0.8)}),
    'wall-tavern': ('medieval_wood', {'relief': 0.6, 'gain': 0.6}),
    'rock': ('rock_ground', {'relief': 0.7, 'gain': 0.32}),
    'grass': ('leafy_grass', {'relief': 0.4, 'tint': (0.82, 1.06, 0.62), 'gain': 1.05}),
    'grass-dark': ('sparse_grass', {'relief': 0.4, 'gain': 0.8}),
    'dirt': ('forrest_ground_01', {'relief': 0.5}),
    'dirt-forest': ('brown_mud_leaves_01', {'relief': 0.5}),
    'rubble': ('dry_river_pebbles', {'relief': 0.8}),
    'riverbed': ('dry_riverbed_rock', {'relief': 0.6}),
    'pit': ('gravel_stones', {'relief': 0.5, 'gain': 0.35}),
    'cracks': ('mud_cracked_dry_03', {'relief': 0.0}),  # becomes lava below
    'wood': ('dark_wooden_planks', {'relief': 0.5, 'gain': 1.05}),
    'tile': ('checkered_pavement_tiles', {'relief': 0.5, 'gain': 0.95, 'align': True}),
    'sand': ('coast_sand_01', {'relief': 0.5, 'gain': 1.2, 'tint': (1.08, 1.0, 0.8)}),
    'snow': ('snow_02', {'relief': 0.7, 'gain': 1.0, 'tint': (0.95, 0.98, 1.05)}),
    'mud': ('brown_mud_02', {'relief': 0.3, 'gain': 0.95, 'tint': (1.1, 0.86, 0.62)}),
}

API = 'https://api.polyhaven.com'
UA = {'User-Agent': 'dnd-map-texture-fetch'}


def get(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()


def load(url: str, mode: str) -> np.ndarray:
    im = Image.open(io.BytesIO(get(url))).convert(mode).resize((SIZE, SIZE), Image.LANCZOS)
    return np.asarray(im).astype(np.float32) / 255.0


def bake(asset_id: str, opts: dict) -> tuple[np.ndarray, dict]:
    files = json.loads(get(f'{API}/files/{asset_id}'))
    info = json.loads(get(f'{API}/info/{asset_id}'))
    url = lambda key: files[key]['1k']['jpg']['url']
    col = load(url('Diffuse'), 'RGB')
    out = col.copy()
    relief = opts.get('relief', 0.5)
    if relief and 'nor_gl' in files:
        n = load(url('nor_gl'), 'RGB') * 2 - 1
        n /= np.linalg.norm(n, axis=2, keepdims=True) + 1e-6
        light = np.array([-0.45, 0.55, 0.7])  # from the top-left (OpenGL normals: +y is up)
        light /= np.linalg.norm(light)
        shade = np.clip((n * light).sum(axis=2), 0, 1)
        flat = float(light[2])  # what a flat surface receives
        out = out * (1 + relief * (shade / flat - 1))[..., None]
    if 'AO' in files:
        ao = load(url('AO'), 'L')
        out = out * (0.55 + 0.45 * ao)[..., None]
    out = out * opts.get('gain', 1.0) * np.array(opts.get('tint', (1, 1, 1)))
    if opts.get('align'):
        out = align_to_edges(out)
    meta = {
        'id': asset_id,
        'meters': round(float(info.get('dimensions', [2000])[0]) / 1000, 3),
        'authors': sorted((info.get('authors') or {}).keys()),
    }
    return np.clip(out, 0, 1), meta


def align_to_edges(img: np.ndarray) -> np.ndarray:
    """Shift a checkered texture so a square's edge sits on the tile edge, so the
    squares line up with the map grid when one tile spans a whole number of cells."""
    lum = img.mean(axis=2)
    dark = lum < np.median(lum)
    shifts = []
    for axis in (1, 0):
        prof = dark.mean(axis=1 - axis) if axis == 1 else dark.mean(axis=1)
        # Edges are where the dark share along the line flips most sharply.
        lines = dark if axis == 1 else dark.T
        flips = np.abs(np.diff(lines.astype(np.int8), axis=1)).sum(axis=0)
        shifts.append(int(np.argmax(flips)) + 1)
    return np.roll(np.roll(img, -shifts[0], axis=1), -shifts[1], axis=0)


def lava_from_cracks(cracks: np.ndarray) -> np.ndarray:
    """Dark crust plates with molten light in the cracks between them."""
    lum = cracks.mean(axis=2)
    lo, hi = np.percentile(lum, 3), np.percentile(lum, 60)
    t = np.clip((hi - lum) / (hi - lo + 1e-6), 0, 1) ** 1.6  # 1 in cracks, 0 on plates
    crust = np.stack([0.16 + 0.1 * lum, 0.06 + 0.04 * lum, 0.05 + 0.02 * lum], axis=2)
    glow = np.stack([np.ones_like(t), 0.35 + 0.55 * t, 0.05 + 0.25 * t ** 3], axis=2)
    return np.clip(crust * (1 - t[..., None]) + glow * t[..., None], 0, 1)


def save(name: str, arr: np.ndarray):
    Image.fromarray((arr * 255).astype(np.uint8)).save(os.path.join(OUT, f'{name}.webp'), quality=84, method=6)


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest, credits = {}, {}
    for name, (asset_id, opts) in TEXTURES.items():
        print(f'{name:14s} <- {asset_id}', flush=True)
        arr, meta = bake(asset_id, opts)
        if name == 'cracks':
            name, arr = 'lava', lava_from_cracks(arr)
        save(name, arr)
        manifest[name] = {'meters': meta['meters']}
        credits[name] = meta
    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=2, sort_keys=True)
    with open(os.path.join(OUT, 'CREDITS.md'), 'w') as f:
        f.write('# Texture credits\n\nAll textures are from [Poly Haven](https://polyhaven.com) and are CC0 (public domain).\n'
                'They were resized and relit by `scripts/fetch-textures.py`.\n\n| File | Poly Haven asset | Authors |\n|---|---|---|\n')
        for name, m in sorted(credits.items()):
            f.write(f"| `{'lava' if name == 'cracks' else name}.webp` | [{m['id']}](https://polyhaven.com/a/{m['id']}) | {', '.join(m['authors'])} |\n")
    print('done')


if __name__ == '__main__':
    sys.exit(main())
