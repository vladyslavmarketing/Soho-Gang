#!/usr/bin/env python3
"""Reshape the plush snake head atlas: egg -> snake head (wide temples, long tapered rounded snout).

    python3 dev/head-reshape.py            # dev/snake-src/head-egg.webp -> assets/img/snake/head.webp (+ manifest)

The Blender atlas (head v2) has an egg-shaped head. Each cell is warped in 2D (sprite space, x forward, origin =
head point): the back and the eye region stay as rendered; ahead of the eye the head is stretched forward and
narrowed toward a rounded snout. Fur, lighting and the baked eye are kept. Premultiplied bilinear sampling.
"""
import json
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'dev', 'snake-src', 'head-egg.webp')
OUT = os.path.join(ROOT, 'assets', 'img', 'snake', 'head.webp')
MAN = os.path.join(ROOT, 'assets', 'img', 'snake', 'manifest.json')

# shape, in body radii R (incl. fur), x forward from the head point
KEEP = 0.45       # untouched up to here (temples + eye at x ~0.33)
NECK_X = -0.9     # from here back: narrow toward the neck
NECK_HW = 1.42    # half-width at the back edge of the head (body + fur ~ this)
TAPER_TO = 2.55   # straight taper ends here...
TIP_HW = 0.62     # ...at this half-width; then a round cap
TIP = TAPER_TO + TIP_HW


def main():
    man = json.load(open(MAN))
    H = man['head']
    if not os.path.exists(SRC):   # first run: keep the Blender original next to the script
        os.makedirs(os.path.dirname(SRC), exist_ok=True)
        Image.open(OUT).save(SRC, lossless=True)
    src = np.asarray(Image.open(SRC).convert('RGBA')).astype(np.float32) / 255.0
    w, h = H['cell']
    ox, oy = H['origin']
    cols, n = H['cols'], H['buckets']
    R = float(H['ref_R'])
    rows = (n + cols - 1) // cols
    w2 = int(np.ceil(ox + (TIP + 0.22) * R))       # new cell width (longer snout)

    out = np.zeros((rows * h, cols * w2, 4), np.float32)
    ys, xs = np.mgrid[0:h, 0:w2].astype(np.float32)
    X = (xs - ox) / R
    Y = (ys - oy) / R

    for b in range(n):
        cx, cy = (b % cols) * w, (b // cols) * h
        cell = src[cy:cy + h, cx:cx + w].copy()
        cell[..., :3] *= cell[..., 3:4]                      # premultiply
        al = cell[..., 3]
        # source half-width per column (alpha > .5), smoothed
        hw = np.zeros(w, np.float32)
        for x in range(w):
            c = np.where(al[:, x] > 0.5)[0]
            hw[x] = (c.max() - c.min()) / 2 / R if len(c) else 0
        hw = np.convolve(hw, np.ones(7) / 7, mode='same')
        srcTip = (np.max(np.where(hw > 0.05)[0]) - ox) / R
        # forward stretch: [KEEP, TIP] <- [KEEP, srcTip]
        k = (srcTip - KEEP) / (TIP - KEEP)
        SX = np.where(X > KEEP, KEEP + (X - KEEP) * k, X)
        # target half-width along x
        t = np.clip((X - KEEP) / (TAPER_TO - KEEP), 0, 1)
        hw_keep = np.interp(SX * R + ox, np.arange(w), hw)
        tgt = np.where(X <= KEEP, hw_keep, 0)
        hw_at_keep = float(np.interp(KEEP * R + ox, np.arange(w), hw))
        lin = hw_at_keep + (TIP_HW - hw_at_keep) * (t * t * (3 - 2 * t) * 0.35 + t * 0.65)
        tgt = np.where((X > KEEP) & (X <= TAPER_TO), lin, tgt)
        cap = np.sqrt(np.clip(TIP_HW ** 2 - (X - TAPER_TO) ** 2, 0, None))
        tgt = np.where(X > TAPER_TO, cap, tgt)
        # neck: narrow the back toward the body width
        tn = np.clip((NECK_X - X) / (NECK_X - (-1.6)), 0, 1)
        tgt = np.where(X < NECK_X, hw_keep * (1 - tn) + np.minimum(hw_keep, NECK_HW) * tn, tgt)
        src_hw = np.maximum(np.interp(SX * R + ox, np.arange(w), hw), 0.05)
        s = np.where(X <= KEEP, np.where(X < NECK_X, tgt / src_hw, 1.0), tgt / src_hw)
        s = np.clip(s, 0.02, 1.2)
        SY = Y / s
        px = SX * R + ox
        py = SY * R + oy
        # bilinear sample (outside = transparent)
        x0 = np.floor(px).astype(int); y0 = np.floor(py).astype(int)
        fx = (px - x0)[..., None]; fy = (py - y0)[..., None]
        def at(xx, yy):
            ok = (xx >= 0) & (xx < w) & (yy >= 0) & (yy < h)
            v = np.zeros(px.shape + (4,), np.float32)
            v[ok] = cell[yy[ok], xx[ok]]
            return v
        v = (at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) +
             at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy)
        # beyond the rounded tip nothing
        v[(X > TIP + 0.25)] = 0
        a = v[..., 3:4]
        v[..., :3] = np.where(a > 1e-4, v[..., :3] / np.maximum(a, 1e-4), 0)
        out[(b // cols) * h:(b // cols + 1) * h, (b % cols) * w2:(b % cols + 1) * w2] = v

    Image.fromarray(np.clip(out * 255 + 0.5, 0, 255).astype(np.uint8), 'RGBA').save(OUT, quality=88, method=6)
    H['cell'] = [w2, h]
    H['shape'] = {'reshaped': 'dev/head-reshape.py', 'tip_R': TIP, 'tip_halfwidth_R': TIP_HW, 'keep_R': KEEP}
    H['tongue_base_R'] = [round(TIP - 0.35, 2), 0.0]
    H.pop('silhouette', None)
    man['bytes']['head'] = os.path.getsize(OUT)
    json.dump(man, open(MAN, 'w'), indent=1)
    print('cell', w2, 'x', h, 'bytes', man['bytes']['head'])


if __name__ == '__main__':
    main()
