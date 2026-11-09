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
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'assets', 'img', 'snake', 'head.webp')
MAN = os.path.join(ROOT, 'assets', 'img', 'snake', 'manifest.json')
EGG = os.path.join(ROOT, 'dev', 'snake-src', 'head-egg.webp')
CELL, ORIGIN, PX_R, COLS, N = (281, 296), (113, 148), 64, 8, 32
NECK_FADE = (-0.35, -1.35)   # earlier and softer than the egg's: no light band where the head meets the neck
SHARPEN = 1.0               # (own detail kept as rendered; the body's fur grain is transferred instead)
DETAIL = 1.0                # strength of the body fur grain transferred onto the head
EYE_C, EYE_R = (0.36, 0.42), 0.27   # bead eye in R (x, u toward the jaw = image -y)
NECK_U = 1.1                # behind the head point, fur farther than this from the axis fades (the jaw's back corner)


def body_grain(w, h):
    """luminance high-pass of the body's pink fur (atlas cell, horizontal tube), tiled to w x h."""
    B = json.load(open(MAN))['body']
    cw, ch = B['cell']
    im = Image.open(os.path.join(ROOT, 'assets', 'img', 'snake', B['file'])).convert('RGBA')
    tiles = []
    for v in range(3):                    # the three pink variants, angle 0
        c = im.crop((0, v * ch, cw, (v + 1) * ch))
        a = np.asarray(c)[..., 3]
        rows = np.where(a[:, cw // 2] > 250)[0]
        y0, y1 = rows.min() + 6, rows.max() - 6
        x0, x1 = cw // 2 - 40, cw // 2 + 40   # stamps are slices: use the middle
        L = np.asarray(c.convert('L')).astype(np.float32) / 255
        Bl = np.asarray(c.convert('L').filter(ImageFilter.GaussianBlur(3))).astype(np.float32) / 255
        tiles.append((L - Bl)[y0:y1, x0:x1])
    th = min(t.shape[0] for t in tiles)
    strip = np.concatenate([t[:th] for t in tiles], 1)
    reps = (int(np.ceil(h / th)) + 1, int(np.ceil(w / strip.shape[1])) + 1)
    g = np.tile(strip, reps)[:h, :w]
    return g / max(g.std(), 1e-4) * 0.058   # body high-pass level


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
    grain = body_grain(w, h)
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
        # the back corners of the head (beyond the neck's width) melt away too
        us = (np.arange(h) - ORIGIN[1]) / PX_R
        back = np.clip(-xs / 0.6, 0, 1)[None, :]
        side = np.clip((np.abs(us)[:, None] - NECK_U) / 0.35, 0, 1)
        al = al * (1 - back * side)
        # fine fur detail: unsharp mask on luminance
        lum = rgb.mean(-1)
        blur = np.asarray(Image.fromarray(np.clip(lum * 255, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2.5))).astype(np.float32) / 255
        ex, ey = ORIGIN[0] + EYE_C[0] * PX_R, ORIGIN[1] - EYE_C[1] * PX_R
        yy, xx = np.mgrid[0:h, 0:w]
        d = np.hypot(xx - ex, yy - ey) / PX_R
        eye = d < EYE_R * 1.05
        own = lum - blur
        rgb = np.clip(rgb + ((own * (SHARPEN - 1)) + (grain - own * 0.5) * DETAIL * (~eye))[..., None], 0, 1)
        # colour match to the egg cell with the same light
        e = egg[(b // COLS) * eh:(b // COLS + 1) * eh, (b % COLS) * ew:(b % COLS + 1) * ew] / 255
        em = e[..., 3] > 0.9
        nm = al > 0.9
        nm = nm & ~eye
        if em.any() and nm.any():   # mean + spread per channel; the bead eye keeps its own black
            src = rgb[nm]; ref = e[..., :3][em]
            g = ref.std(0) / np.maximum(src.std(0), 1e-3)
            out_rgb = (rgb - src.mean(0)) * g + ref.mean(0)
            rgb = np.where(eye[..., None], rgb, np.clip(out_rgb, 0, 1))
        # glossy black bead: darken the eye disc, keep only its brightest glint
        k = np.clip((EYE_R - d) / 0.05, 0, 1)[..., None]
        glint = (rgb.mean(-1) > 0.55)[..., None]
        rgb = np.where(glint & (k > 0.5), rgb, rgb * (1 - 0.85 * k))
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
