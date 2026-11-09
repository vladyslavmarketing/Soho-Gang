#!/usr/bin/env python3
"""Reshape the plush snake head atlas from the Blender egg to the client's head shape.

    python3 dev/head-reshape.py            # dev/snake-src/head-egg.webp -> assets/img/snake/head.webp (+ manifest)

Target silhouette (client sketch over the egg cell + the plush photo), side view, x forward:
  - top (the eye side): a flat brow that slopes down to the snout; the back of the head is cut at a slant;
  - snout: blunt, rounded corners, a little below the middle;
  - bottom (jaw): almost flat, rising only near the snout.
Each atlas cell is warped column by column: the source column's top/bottom fur edges are mapped onto the target
edges (the eye side is known from the manifest, so the shape is the same whichever way the head is lit).
Fur, lighting and the baked eye are kept. Premultiplied bilinear sampling.
"""
import json
import os

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'dev', 'snake-src', 'head-egg.webp')
OUT = os.path.join(ROOT, 'assets', 'img', 'snake', 'head.webp')
MAN = os.path.join(ROOT, 'assets', 'img', 'snake', 'manifest.json')

# silhouette in body radii R (incl. fur); "top" = the eye side, values are distances from the head axis
FRONT = 2.45       # snout front
CORNER = 0.55      # snout corner radius
IDENT = (-0.75, 0.75)   # columns kept exactly as rendered (the eye sits at x ~0.33)


def lerp(a, b, t):
    return a + (b - a) * t


def ease(t):
    # a brow that rolls into the slope (no knee)
    t = min(1.0, max(0.0, t))
    return t * t * 0.45 + t * 0.55   # soft start only: the slope runs straight into the rounded snout


def top_edge(x, src):
    """target top half-height at x (src = rendered half-height at the same source column)."""
    if IDENT[0] <= x <= IDENT[1]:
        return src
    if x < IDENT[0]:                                  # slanted back of the head (sketch: top-left corner cut)
        t = min(1.0, (IDENT[0] - x) / 0.75)
        return lerp(src, min(src, 1.25), t)
    # brow: flat, then a straight slope down to the snout top
    flat_to, slope_to, h0, h1 = 0.95, FRONT - CORNER, 1.70, 0.86
    if x <= flat_to:
        return lerp(src, h0, (x - IDENT[1]) / (flat_to - IDENT[1]))
    return lerp(h0, h1, ease((x - flat_to) / (slope_to - flat_to)))


def bottom_edge(x, src):
    if IDENT[0] <= x <= IDENT[1]:
        return src
    if x < IDENT[0]:
        t = min(1.0, (IDENT[0] - x) / 0.75)
        return lerp(src, min(src, 1.45), t)
    flat_to, slope_to, h0, h1 = 1.15, FRONT - CORNER, 1.62, 1.02   # jaw: nearly flat, rises near the snout
    if x <= flat_to:
        return lerp(src, h0, (x - IDENT[1]) / (flat_to - IDENT[1]))
    return lerp(h0, h1, ease((x - flat_to) / (slope_to - flat_to)))


def corner_cut(x):
    """how much the rounded snout corners pull both edges in near the front."""
    x0 = FRONT - CORNER
    if x <= x0:
        return 0.0
    d = min(CORNER, x - x0)
    return CORNER - np.sqrt(CORNER * CORNER - d * d)


def main():
    man = json.load(open(MAN))
    H = man['head']
    if not os.path.exists(SRC):   # first run: keep the Blender original next to the script
        os.makedirs(os.path.dirname(SRC), exist_ok=True)
        Image.open(OUT).save(SRC, lossless=True)
    src = np.asarray(Image.open(SRC).convert('RGBA')).astype(np.float32) / 255.0
    w, h = 271, 242                                   # the Blender cell (head v2)
    ox, oy = H['origin']
    cols, n = H['cols'], H['buckets']
    R = float(H['ref_R'])
    rows = (n + cols - 1) // cols
    w2 = int(np.ceil(ox + (FRONT + 0.25) * R))
    per = (H.get('eye') or {}).get('per_bucket') or [[0]] * n

    out = np.zeros((rows * h, cols * w2, 4), np.float32)
    for b in range(n):
        cx, cy = (b % cols) * w, (b // cols) * h
        cell = src[cy:cy + h, cx:cx + w].copy()
        cell[..., :3] *= cell[..., 3:4]                   # premultiply
        al = cell[..., 3]
        up = -1.0 if per[b][0] == 0 else 1.0             # sign of the eye side (local y); two-eye cells: -y
        top_s = np.zeros(w); bot_s = np.zeros(w); ok = np.zeros(w, bool)
        for x in range(w):
            c = np.where(al[:, x] > 0.5)[0]
            if len(c):
                ok[x] = True
                lo, hi = (c.min() - oy) / R, (c.max() - oy) / R          # y down
                top_s[x], bot_s[x] = (-lo, hi) if up < 0 else (hi, -lo)  # distances on the eye / jaw side
        k = np.ones(7) / 7
        top_s = np.convolve(top_s, k, 'same'); bot_s = np.convolve(bot_s, k, 'same')
        src_front = (np.max(np.where(ok)[0]) - ox) / R - 0.05
        xs_src = (np.arange(w) - ox) / R

        res = np.zeros((h, w2, 4), np.float32)
        for X in range(w2):
            x = (X - ox) / R
            if x > FRONT + 0.2:
                continue
            # x: identity up to the eye region, then the snout section maps onto the source front
            sx = x if x <= IDENT[1] else IDENT[1] + (x - IDENT[1]) * (src_front - IDENT[1]) / (FRONT - IDENT[1])
            ts = float(np.interp(sx, xs_src, top_s)); bs = float(np.interp(sx, xs_src, bot_s))
            if ts + bs < 0.1:
                continue
            cc = corner_cut(x)
            tt = max(0.05, top_edge(x, ts) - cc); bt = max(0.05, bottom_edge(x, bs) - cc)
            # map target [-tt, bt] (eye side negative) onto source [-ts, bs], linearly
            Y = (np.arange(h) - oy) / R * (-up)          # +: jaw side, -: eye side
            SYs = -ts + (Y + tt) * (ts + bs) / (tt + bt)
            py = SYs * (-up) * R + oy
            px = sx * R + ox
            x0 = int(np.floor(px)); fx = px - x0
            y0 = np.floor(py).astype(int); fy = (py - y0)[:, None]

            def at(xx, yy):
                v = np.zeros((h, 4), np.float32)
                m = (yy >= 0) & (yy < h) & (0 <= xx < w)
                if 0 <= xx < w:
                    v[m] = cell[yy[m], xx]
                return v
            col = ((at(x0, y0) * (1 - fy) + at(x0, y0 + 1) * fy) * (1 - fx) +
                   (at(x0 + 1, y0) * (1 - fy) + at(x0 + 1, y0 + 1) * fy) * fx)
            # keep fur fringe only a little beyond the target edges
            d_out = np.maximum(-Y - tt, Y - bt)
            col *= np.clip(1 - d_out / 0.22, 0, 1)[:, None]
            res[:, X] = col
        a = res[..., 3:4]
        res[..., :3] = np.where(a > 1e-4, res[..., :3] / np.maximum(a, 1e-4), 0)
        out[(b // cols) * h:(b // cols + 1) * h, (b % cols) * w2:(b % cols + 1) * w2] = res

    Image.fromarray(np.clip(out * 255 + 0.5, 0, 255).astype(np.uint8), 'RGBA').save(OUT, quality=88, method=6)
    H['cell'] = [w2, h]
    H['shape'] = {'reshaped': 'dev/head-reshape.py', 'front_R': FRONT, 'corner_R': CORNER}
    H['tongue_base_R'] = [round(FRONT - 0.3, 2), 0.0]
    H.pop('silhouette', None)
    man['bytes']['head'] = os.path.getsize(OUT)
    json.dump(man, open(MAN, 'w'), indent=1)
    print('cell', w2, 'x', h, 'bytes', man['bytes']['head'])


if __name__ == '__main__':
    main()
