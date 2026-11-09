#!/usr/bin/env python3
"""Assemble the Blender head renders (dev/blender/head_photo.py) into assets/img/snake/head.webp + manifest.

    python3 dev/blender/build_head_atlas.py RENDER_DIR

- 2x renders -> cell size (Lanczos), straight alpha kept;
- neck fade baked into alpha (x from NECK_FADE[0] to NECK_FADE[1] body radii behind the head point);
- colour: each cell scaled per channel so its mean matches the Blender egg cell of the same light (the engine's
  HEAD_TINT then brings both to the body fur colour);
- manifest: cell / origin / eye (one bead, on +y in every cell) / tongue base / shape note.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'assets', 'img', 'snake', 'head.webp')
MAN = os.path.join(ROOT, 'assets', 'img', 'snake', 'manifest.json')
EGG = os.path.join(ROOT, 'dev', 'snake-src', 'head-egg.webp')
CELL, ORIGIN, PX_R, COLS, N = (281, 296), (113, 148), 64, 8, 32
NECK_FADE = (-1.0, -1.8)


def main(rdir):
    man = json.load(open(MAN))
    H = man['head']
    egg = np.asarray(Image.open(EGG).convert('RGBA')).astype(np.float32)
    ew, eh = 271, 242
    w, h = CELL
    rows = N // COLS
    out = np.zeros((rows * h, COLS * w, 4), np.float32)
    xs = (np.arange(w) - ORIGIN[0]) / PX_R
    fade = np.clip((xs - NECK_FADE[1]) / (NECK_FADE[0] - NECK_FADE[1]), 0, 1)
    fade = fade * fade * (3 - 2 * fade)
    for b in range(N):
        im = Image.open(os.path.join(rdir, 'head_%02d.png' % b)).convert('RGBA')
        # resize in premultiplied space (no dark fringes)
        a = np.asarray(im).astype(np.float32) / 255
        a[..., :3] *= a[..., 3:4]
        pm = np.stack([np.asarray(Image.fromarray((a[..., i] * 255).astype(np.uint8)).resize((w, h), Image.LANCZOS)).astype(np.float32) / 255
                       for i in range(4)], -1)
        al = pm[..., 3:4]
        rgb = np.where(al > 1e-3, pm[..., :3] / np.maximum(al, 1e-3), 0)
        al = al[..., 0] * fade[None, :]
        # colour match to the egg cell with the same light
        e = egg[(b // COLS) * eh:(b // COLS + 1) * eh, (b % COLS) * ew:(b % COLS + 1) * ew] / 255
        em = e[..., 3] > 0.9
        nm = al > 0.9
        if em.any() and nm.any():
            gain = e[..., :3][em].mean(0) / np.maximum(rgb[nm].mean(0), 1e-3)
            rgb = np.clip(rgb * gain, 0, 1)
        cell = np.concatenate([rgb, al[..., None]], -1)
        out[(b // COLS) * h:(b // COLS + 1) * h, (b % COLS) * w:(b % COLS + 1) * w] = cell
    Image.fromarray(np.clip(out * 255 + 0.5, 0, 255).astype(np.uint8), 'RGBA').save(OUT, quality=90, method=6)
    H.update({
        'version': 3,
        'generator': 'Blender 4.0 Cycles (CPU); head v3 shaped after the client plush photo; dev/blender/head_photo.py',
        'cell': list(CELL), 'origin': list(ORIGIN), 'cols': COLS, 'buckets': N,
        'neck_fade_R': list(NECK_FADE), 'fade_baked': True, 'eyes': True,
        'tongue_base_R': [1.95, 1.45],
        'shape': {'source': 'client plush photo, side view', 'jaw_side': '-y (u > 0)', 'eye_side': '+y'},
    })
    H['eye'] = {'centres': [[0.36, -0.42]], 'radius': 0.25, 'per_bucket': [[1]] * N,
                'notes': 'one bead on the head side facing the camera; local +y side is the brow (engine: never flipped)'}
    H.pop('silhouette', None)
    man['bytes']['head'] = os.path.getsize(OUT)
    json.dump(man, open(MAN, 'w'), indent=1)
    print('atlas', out.shape, 'bytes', man['bytes']['head'])


if __name__ == '__main__':
    main(sys.argv[1])
