#!/usr/bin/env python3
"""Reshape the plush snake head atlas from the Blender egg to the client's reference photo.

    python3 dev/head-reshape.py            # dev/snake-src/head-egg.webp -> assets/img/snake/head.webp (+ manifest)

Target silhouette = the client's outline over the plush photo (side view, head facing left, eye up), converted to
the atlas frame: x forward from the head point, u across the head (negative = the eye side), units of body radius R
(incl. fur). Scale: the neck behind the head is the body diameter (2.5 R with fur); the eye stays at x 0.33.
  - the brow slopes gently from the back of the head, then down to a blunt, rounded snout;
  - the jaw is flat and hangs below the neck;
  - the eye sits a little below the middle of the head height (moved there; the bead keeps its size).
Each column of each cell is remapped piecewise-linearly (edges + the eye band). Cells are processed with the eye on
-u and flipped back. The new cells are symmetric about the head point (the engine uses one origin).
"""
import json
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'dev', 'snake-src', 'head-egg.webp')
OUT = os.path.join(ROOT, 'assets', 'img', 'snake', 'head.webp')
MAN = os.path.join(ROOT, 'assets', 'img', 'snake', 'manifest.json')

# outline from the photo; T = eye-side edge (negative u), B = jaw edge (positive u)
T_X = [-1.9, -0.29, 0.40, 0.96, 1.55, 2.05, 2.24, 2.33]
T_U = [-1.14, -1.14, -1.02, -0.80, -0.30, 0.35, 0.83, 1.25]
B_X = [-1.9, -1.18, -0.64, 0.60, 1.38, 1.86, 2.19, 2.33]
B_U = [1.20, 1.24, 1.62, 1.86, 2.00, 1.81, 1.33, 1.25]
FRONT = 2.33
EYE_SRC = -0.938          # Blender eye centre (eye side)
EYE_DST = 0.2             # the photo has it a little below the middle; less shift = less stretched fur above it
EYE_X = 0.327
BAND = 0.34               # eye band kept at 1:1 so the bead is not stretched
TONGUE = [1.95, 1.45]     # tongue root under the front of the snout (u, + = jaw side)
FRINGE = 0.24             # fur kept beyond the target edges (fades out)


def main():
    man = json.load(open(MAN))
    H = man['head']
    if not os.path.exists(SRC):
        os.makedirs(os.path.dirname(SRC), exist_ok=True)
        Image.open(OUT).save(SRC, lossless=True)
    src = np.asarray(Image.open(SRC).convert('RGBA')).astype(np.float32) / 255.0
    w, h, oy = 271, 242, 121                          # Blender cell (head v2)
    ox = H['origin'][0]
    cols, n = H['cols'], H['buckets']
    R = float(H['ref_R'])
    rows = (n + cols - 1) // cols
    half = int(np.ceil((max(-min(T_U), max(B_U)) + FRINGE + 0.05) * R))
    h2, oy2 = 2 * half + 2, half + 1
    w2 = int(np.ceil(ox + (FRONT + FRINGE + 0.05) * R))
    per = (H.get('eye') or {}).get('per_bucket') or [[0]] * n
    U = (np.arange(h2) - oy2) / R                     # target rows, + = jaw side
    xs_src = (np.arange(w) - ox) / R
    sm = np.ones(7) / 7

    out = np.zeros((rows * h2, cols * w2, 4), np.float32)
    for b in range(n):
        cell = src[(b // cols) * h:(b // cols + 1) * h, (b % cols) * w:(b % cols + 1) * w].copy()
        flip = per[b][0] != 0                         # eye on +y: process upside down
        if flip:
            cell = cell[::-1].copy()
        cell[..., :3] *= cell[..., 3:4]
        al = cell[..., 3]
        ts = np.zeros(w); bs = np.zeros(w)
        for x in range(w):
            c = np.where(al[:, x] > 0.5)[0]
            if len(c):
                ts[x], bs[x] = -(c.min() - oy) / R, (c.max() - oy) / R
        ts = np.convolve(ts, sm, 'same'); bs = np.convolve(bs, sm, 'same')
        src_front = (np.max(np.where(ts + bs > 0.1)[0]) - ox) / R

        res = np.zeros((h2, w2, 4), np.float32)
        for X in range(w2):
            x = (X - ox) / R
            if x > FRONT + FRINGE:
                continue
            sx = x if x <= 0.9 else 0.9 + (x - 0.9) * (src_front - 0.9) / (FRONT - 0.9)
            t_s = float(np.interp(sx, xs_src, ts)); b_s = float(np.interp(sx, xs_src, bs))
            T = float(np.interp(x, T_X, T_U)); B = float(np.interp(x, B_X, B_U))
            if t_s + b_s < 0.1 or B - T < 0.05:
                continue
            g = (B - T) / (t_s + b_s)
            prop = T + (EYE_SRC + t_s) * g
            dx = max(0.0, abs(x - EYE_X) - 0.45)          # flat over the whole bead, then a soft fall-off
            wgt = float(np.exp(-(dx / 0.6) ** 2))
            kt = prop + (EYE_DST - prop) * wgt
            gb = g + (1.0 - g) * wgt
            sk = [-t_s, EYE_SRC - BAND, EYE_SRC + BAND, b_s]
            dk = [T, kt - BAND * gb, kt + BAND * gb, B]
            if not (dk[0] < dk[1] < dk[2] < dk[3] and sk[0] < sk[1] < sk[2] < sk[3]):
                sk, dk = [-t_s, b_s], [T, B]
            su = np.interp(U, dk, sk)
            su = np.where(U < T, sk[0] + (U - T) * (sk[1] - sk[0]) / (dk[1] - dk[0]), su)
            su = np.where(U > B, sk[-1] + (U - B) * (sk[-1] - sk[-2]) / (dk[-1] - dk[-2]), su)
            py = su * R + oy
            px = sx * R + ox
            x0 = int(np.floor(px)); fx = px - x0
            y0 = np.floor(py).astype(int); fy = (py - y0)[:, None]

            def at(xx, yy):
                v = np.zeros((h2, 4), np.float32)
                if 0 <= xx < w:
                    m = (yy >= 0) & (yy < h)
                    v[m] = cell[yy[m], xx]
                return v
            col = ((at(x0, y0) * (1 - fy) + at(x0, y0 + 1) * fy) * (1 - fx) +
                   (at(x0 + 1, y0) * (1 - fy) + at(x0 + 1, y0 + 1) * fy) * fx)
            col *= np.clip(1 - np.maximum(T - U, U - B) / FRINGE, 0, 1)[:, None]
            res[:, X] = col
        a = res[..., 3:4]
        res[..., :3] = np.where(a > 1e-4, res[..., :3] / np.maximum(a, 1e-4), 0)
        if flip:
            res = res[::-1]
        out[(b // cols) * h2:(b // cols + 1) * h2, (b % cols) * w2:(b % cols + 1) * w2] = res

    Image.fromarray(np.clip(out * 255 + 0.5, 0, 255).astype(np.uint8), 'RGBA').save(OUT, quality=88, method=6)
    H['cell'] = [w2, h2]
    H['origin'] = [ox, oy2]
    H['shape'] = {'reshaped': 'dev/head-reshape.py (client photo)', 'front_R': FRONT, 'jaw_R': max(B_U)}
    H['eye']['moved_to'] = [EYE_X, EYE_DST, 'u: + = jaw side (opposite the eye side of the source cell)']
    H['tongue_base_R'] = TONGUE
    H.pop('silhouette', None)
    man['bytes']['head'] = os.path.getsize(OUT)
    json.dump(man, open(MAN, 'w'), indent=1)
    print('cell', w2, 'x', h2, 'origin', ox, oy2, 'bytes', man['bytes']['head'])


if __name__ == '__main__':
    main()
