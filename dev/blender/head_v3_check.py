#!/usr/bin/env python3
"""head_v3_check.py - measure / visualise the head v3 renders and atlas against the spec (head_v3_spec.py).

  fit IMG [ss=2] [out=fit.png] [update=dev/blender/head_v3_params.json] [gain=0.85] [title=...] [params=...]
      OUTER FUR EDGE (alpha >= 0.5) of a cell render (or `atlas=assets/img/snake/head.webp cell=0` for a packed cell)
      vs the target (traced polylines + the brow-side neck shoulder from the params): signed normal deviation
      (+ = render outside) per edge, edge -> target distance, the shoulder's departure from the traced brow; bead.
      update=PARAMS moves the per-edge reach knots by gain x the measured deviation (calibration loop).
      out=PNG writes the overlay montage (cell large + spec polylines + eye circle + tongue root + deviation plot).
  neck [head=assets/img/snake/head.webp] [body=assets/img/snake/body.webp] [out=neck.png]
      engine-style composite: body.webp pink stamps every 0.3 R along the path + the head cell x HEAD_TINT on top
      (both with the engine's atlasGrade), at 8 headings; reports head x tint vs body colour at the neck.
  sheet [head=assets/img/snake/head.webp] [manifest=assets/img/snake/manifest.json] [out=sheet.png] [params=...]
      contact sheet of the 32 cells (x HEAD_TINT) with the spec outline, plus the neck composites.
Paths are relative to the repo root (run from there) or absolute.
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import head_v3_spec as S   # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
SNAKE = os.path.join(ROOT, 'assets', 'img', 'snake')
BG = (236, 226, 229)
ENGINE_GRADE = ((185, 50, 45), 0.1)      # snake.js ATL_GRADE[0] (pink): alpha-preserving lerp toward this colour


def font(size):
    for p in ('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def load_rgba(path):
    return np.asarray(Image.open(path).convert('RGBA')).astype(np.float32) / 255.0


def atlas_cell(atlas, b, cell=S.CELL, cols=S.COLS):
    w, h = cell
    return atlas[(b // cols) * h:(b // cols + 1) * h, (b % cols) * w:(b % cols + 1) * w]


# ---------------------------------------------------------------- measurement
def contour_points(alpha, thr=0.5):
    """sub-pixel points (px, py) where alpha crosses thr between 4-neighbours (pixel centres at +0.5)."""
    a = alpha
    pts = []
    for axis in (0, 1):
        a0 = a[:, :-1] if axis else a[:-1, :]
        a1 = a[:, 1:] if axis else a[1:, :]
        cross = (a0 >= thr) != (a1 >= thr)
        ys, xs = np.nonzero(cross)
        f = (thr - a0[ys, xs]) / (a1[ys, xs] - a0[ys, xs])
        if axis:
            pts.append(np.c_[xs + 0.5 + f, ys + 0.5])
        else:
            pts.append(np.c_[xs + 0.5, ys + 0.5 + f])
    return np.vstack(pts)


def bilinear(img, px, py):
    h, w = img.shape
    x = np.clip(px - 0.5, 0, w - 1.001); y = np.clip(py - 0.5, 0, h - 1.001)
    x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int); fx = x - x0; fy = y - y0
    return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x0 + 1] * fx * (1 - fy) + img[y0 + 1, x0] * (1 - fx) * fy
            + img[y0 + 1, x0 + 1] * fx * fy)


def _nearest(A, B):
    """for each point of A (n, 2): distance to the nearest point of B (m, 2) and its index."""
    d = np.empty(len(A)); k = np.empty(len(A), int)
    for sl in np.array_split(np.arange(len(A)), max(1, len(A) // 200)):
        D = (A[sl, None, 0] - B[None, :, 0]) ** 2 + (A[sl, None, 1] - B[None, :, 1]) ** 2
        k[sl] = np.argmin(D, 1); d[sl] = np.sqrt(D[np.arange(len(sl)), k[sl]])
    return d, k


def measure(rgba, ss, x_min=-1.7, params=None):
    """deviations of the alpha >= 0.5 outline from the TARGET polylines (traced brow / jaw, plus the brow-side neck
    shoulder when `params` enable it) + bead eye estimate.
    res[edge]: target -> edge signed normal deviation (+ = render outside); res['edge_to_target']: distance from each
    outline point (x >= max(x_min, -1.0)) to the nearest target point (catches a rounded-off snout corner, which the target ->
    edge direction misses); res['brow_traced']: the brow vs the traced polyline (= res['brow'] without a shoulder)."""
    alpha = rgba[..., 3]
    cp = contour_points(alpha)
    cx, cu = S.cell_to_xu(cp[:, 0] - 0.5, cp[:, 1] - 0.5, ss)      # contour_points are continuous px coords
    res = {'contour': np.c_[cx, cu]}
    C = np.c_[cx, cu]

    def dev(P):
        px, py = S.xu_to_cell(P[:, 0], P[:, 1], ss)
        d, _ = _nearest(P, C)
        inside = bilinear(alpha, px, py) >= 0.5
        return dict(x=P[:, 0], u=P[:, 1], err=np.where(inside, d, -d))
    tgt = S.spec_samples(0.01, x_min, params)
    for edge, P in tgt.items():
        res[edge] = dev(P)
    res['brow_traced'] = dev(S.spec_samples(0.01, x_min)['brow'])
    T = np.vstack([tgt['brow'], tgt['jaw']])
    sel = C[:, 0] >= max(x_min, S.NECK_FADE[0])      # behind -1.0 R a packed cell's alpha 0.5 line is the baked fade
    d, _ = _nearest(C[sel], T)
    res['edge_to_target'] = dict(x=C[sel, 0], u=C[sel, 1], d=d)
    # bead: dark, opaque pixels near the spec eye centre
    ex, ey = S.xu_to_cell(*S.EYE, ss)
    H, W = alpha.shape
    yy, xx = np.mgrid[0:H, 0:W]
    near = (xx + 0.5 - ex) ** 2 + (yy + 0.5 - ey) ** 2 < (0.45 * S.PX_R * ss) ** 2
    rgb = rgba[..., :3]
    dark = near & (alpha > 0.5) & (rgb.max(-1) - rgb.min(-1) < 0.07)     # the bead (and its glint) is neutral, fur is pink
    if dark.sum() > 10:
        dy, dx = np.nonzero(dark)
        c_x, c_y = dx.mean() + 0.5, dy.mean() + 0.5
        r_area = math.sqrt(dark.sum() / math.pi) / (S.PX_R * ss)
        r_p95 = np.percentile(np.hypot(dx + 0.5 - c_x, dy + 0.5 - c_y), 97) / (S.PX_R * ss)
        bx, bu = S.cell_to_xu(c_x - 0.5, c_y - 0.5, ss)
        res['eye'] = dict(x=float(bx), u=float(bu), r_area=r_area, r_edge=float(r_p95))
    return res


def stats(res, zones=((-1.0, 9), (-1.7, -1.0)), shoulder=None):
    out = {}
    for edge in ('brow', 'jaw'):
        e = res[edge]
        for lo, hi in zones:
            m = (e['x'] >= lo) & (e['x'] < hi)
            if not m.any():
                continue
            v = e['err'][m]
            out['%s[%g,%g)' % (edge, lo, min(hi, 2.33))] = dict(max_abs=round(float(np.abs(v).max()), 3), mean=round(float(v.mean()), 3),
                                                                 rms=round(float(np.sqrt((v ** 2).mean())), 3),
                                                                 worst_x=round(float(e['x'][m][np.argmax(np.abs(v))]), 2))
    if 'edge_to_target' in res:
        e = res['edge_to_target']
        if len(e['d']):
            i = int(np.argmax(e['d']))
            out['edge_to_target'] = dict(max=round(float(e['d'].max()), 3), mean=round(float(e['d'].mean()), 3),
                                         p95=round(float(np.percentile(e['d'], 95)), 3),
                                         worst_xu=[round(float(e['x'][i]), 2), round(float(e['u'][i]), 2)])
    if shoulder and 'brow_traced' in res:
        e = res['brow_traced']
        m = (e['x'] >= shoulder['x_back0']) & (e['x'] < shoulder['x_join'])
        if m.any():
            v = e['err'][m]
            out['brow_vs_traced_in_shoulder'] = dict(x=[shoulder['x_back0'], shoulder['x_join']],
                                                     max=round(float(v.max()), 3), mean=round(float(v.mean()), 3),
                                                     worst_x=round(float(e['x'][m][np.argmax(v)]), 2))
    if 'eye' in res:
        out['eye'] = {k: round(v, 3) for k, v in res['eye'].items()}
    return out


def update_params(res, path, gain=0.85):
    p = S.load_params(path)
    kx = np.asarray(p['knots_x'], float)
    for edge in ('brow', 'jaw'):
        e = res[edge]
        key = 'reach_' + edge
        r = np.asarray(p[key], float)
        corr = np.full(len(kx), np.nan)
        for k in range(len(kx)):
            lo = kx[k - 1] if k else kx[0] - 1; hi = kx[k + 1] if k + 1 < len(kx) else kx[-1] + 1
            w = np.where(e['x'] < kx[k], (e['x'] - lo) / (kx[k] - lo), (hi - e['x']) / (hi - kx[k]))
            w = np.clip(w, 0, 1)
            if w.sum() > 3:
                corr[k] = (w * e['err']).sum() / w.sum()
        ok = ~np.isnan(corr)
        corr = np.interp(kx, kx[ok], corr[ok])
        p[key] = [round(float(v), 4) for v in np.clip(r + gain * corr, 0.05, 0.9)]
    with open(path, 'w') as f:
        json.dump(p, f, indent=1)
    return p


# ---------------------------------------------------------------- drawing
def over_bg(rgba, bg=BG):
    a = rgba[..., 3:4]
    return np.clip(rgba[..., :3] * a + (np.array(bg) / 255.0)[None, None] * (1 - a), 0, 1)


def draw_spec(d, ss, k, lw=2, eye=True, params=None):
    """spec polylines / eye / tongue root on a cell image scaled by ss*k; cyan = the brow target where the neck
    shoulder (params) departs from the traced brow."""
    for edge, colr in (('brow', (0, 120, 255)), ('jaw', (255, 110, 0))):
        xs, us = (S.BROW_X, S.BROW_U) if edge == 'brow' else (S.JAW_X, S.JAW_U)
        pts = [tuple(v * k for v in S.xu_to_cell(x, u, ss)) for x, u in zip(xs, us)]
        d.line(pts, fill=colr, width=lw)
        for p in pts:
            d.ellipse([p[0] - lw * 1.5, p[1] - lw * 1.5, p[0] + lw * 1.5, p[1] + lw * 1.5], fill=colr)
    sh = S.shoulder_of(params)
    if sh:
        xs = np.linspace(max(sh['x_back0'], -1.9), sh['x_join'], 120)
        us = S.target_u(xs, 'brow', params)
        d.line([tuple(v * k for v in S.xu_to_cell(x, u, ss)) for x, u in zip(xs, us)], fill=(0, 200, 220), width=lw)
    if eye:
        ex, ey = (v * k for v in S.xu_to_cell(*S.EYE, ss))
        for r, colr in ((S.EYE_R[0], (0, 200, 90)), (S.EYE_R[1], (0, 200, 90))):
            rr = r * S.PX_R * ss * k
            d.ellipse([ex - rr, ey - rr, ex + rr, ey + rr], outline=colr, width=max(1, lw // 2))
        d.line([ex - 6, ey, ex + 6, ey], fill=(0, 200, 90), width=1); d.line([ex, ey - 6, ex, ey + 6], fill=(0, 200, 90), width=1)
    tx, ty = (v * k for v in S.xu_to_cell(*S.TONGUE, ss))
    d.line([tx - 8, ty - 8, tx + 8, ty + 8], fill=(220, 0, 160), width=lw); d.line([tx - 8, ty + 8, tx + 8, ty - 8], fill=(220, 0, 160), width=lw)
    ox, oy = S.ORIGIN[0] * ss * k, S.ORIGIN[1] * ss * k
    d.line([ox - 10, oy, ox + 10, oy], fill=(60, 60, 60), width=1); d.line([ox, oy - 10, ox, oy + 10], fill=(60, 60, 60), width=1)


def fit_montage(rgba, ss, res, st, out, title, k=1.5, params=None):
    H, W = rgba.shape[:2]
    img = Image.fromarray((over_bg(rgba) * 255 + 0.5).astype(np.uint8)).resize((int(W * k), int(H * k)), Image.LANCZOS)
    d = ImageDraw.Draw(img)
    cxy = np.array(S.xu_to_cell(res['contour'][:, 0], res['contour'][:, 1], ss)).T * k
    for x, y in cxy[::2]:
        d.point((x, y), fill=(255, 255, 255))
    draw_spec(d, ss, k, lw=3, params=params)
    # fade band
    for xf in S.NECK_FADE:
        X = S.xu_to_cell(xf, 0, ss)[0] * k
        d.line([X, 0, X, img.size[1]], fill=(150, 150, 150), width=1)
    pw, ph = img.size[0], 300
    plot = Image.new('RGB', (pw, ph), (250, 248, 249)); pd = ImageDraw.Draw(plot)
    x0, x1, e0 = -1.8, 2.45, 0.2

    def P(x, e):
        return (40 + (x - x0) / (x1 - x0) * (pw - 60), ph / 2 - e / e0 * (ph / 2 - 20))
    for e in (-0.08, 0.08):
        pd.line([P(x0, e), P(x1, e)], fill=(0, 170, 80), width=1)
    pd.line([P(x0, 0), P(x1, 0)], fill=(120, 120, 120), width=1)
    for xv in np.arange(-1.5, 2.6, 0.5):
        pd.line([P(xv, -e0), P(xv, e0)], fill=(225, 225, 225), width=1); pd.text(P(xv, -e0), '%.1f' % xv, fill=(90, 90, 90), font=font(13))
    for edge, colr in (('brow', (0, 120, 255)), ('jaw', (255, 110, 0))):
        e = res[edge]
        pd.line([P(x, np.clip(v, -e0, e0)) for x, v in zip(e['x'], e['err'])], fill=colr, width=2)
    pd.text((6, 4), 'signed deviation of the alpha>=0.5 fur edge from the target (R); + = outside; green = +-0.08 R; '
                    'blue brow, orange jaw; x in R', fill=(40, 40, 40), font=font(14))
    lines = []
    for kk, v in st.items():
        lines.append('%s: %s' % (kk, ', '.join('%s %s' % (a, b) for a, b in v.items())))
    hh = 34 + 16 * len(lines) + 26
    head = Image.new('RGB', (pw, hh), (250, 248, 249)); hd = ImageDraw.Draw(head)
    hd.text((8, 6), title, fill=(20, 20, 20), font=font(17))
    hd.text((8, 34), '\n'.join(lines), fill=(40, 40, 40), font=font(13), spacing=3)
    hd.text((8, hh - 20), 'blue/orange = traced brow/jaw polylines, cyan = brow target with the neck shoulder, white dots = render '
                      'alpha 0.5 contour, green = eye r 0.25/0.27, magenta = tongue root, grey = neck fade -1.0/-1.8 R',
            fill=(80, 80, 80), font=font(12))
    m = Image.new('RGB', (pw, hh + img.size[1] + ph), (255, 255, 255))
    m.paste(head, (0, 0)); m.paste(img, (0, hh)); m.paste(plot, (0, hh + img.size[1]))
    m.save(out)


# ---------------------------------------------------------------- engine-style composite
def engine_grade(rgba):
    c, a = ENGINE_GRADE
    out = rgba.copy()
    out[..., :3] = out[..., :3] * (1 - a) + (np.array(c) / 255.0)[None, None] * a
    return out


def over(dst, src, x0, y0):
    """straight-alpha src over dst (float RGBA) at integer offset."""
    h, w = src.shape[:2]
    H, W = dst.shape[:2]
    xa, ya, xb, yb = max(0, x0), max(0, y0), min(W, x0 + w), min(H, y0 + h)
    if xa >= xb or ya >= yb:
        return
    s = src[ya - y0:yb - y0, xa - x0:xb - x0]; d = dst[ya:yb, xa:xb]
    sa = s[..., 3:4]; da = d[..., 3:4]
    oa = sa + da * (1 - sa)
    rgb = (s[..., :3] * sa + d[..., :3] * da * (1 - sa)) / np.maximum(oa, 1e-6)
    dst[ya:yb, xa:xb] = np.concatenate([rgb, oa], -1)


def rotate_rgba(rgba, deg, center):
    """rotate a straight-alpha image counter-clockwise (screen) by deg about center, premultiplied resampling."""
    pm = rgba.copy(); pm[..., :3] *= pm[..., 3:4]
    chans = [np.asarray(Image.fromarray(pm[..., i]).rotate(deg, Image.BICUBIC, center=center)) for i in range(4)]
    out = np.stack(chans, -1)
    out[..., 3] = np.clip(out[..., 3], 0, 1)
    out[..., :3] = np.clip(out[..., :3] / np.maximum(out[..., 3:4], 1e-4), 0, 1)
    out[out[..., 3] < 1e-4] = 0
    return out


def lens(cw, th, R=64, a0=0.55, a1=0.36, fe=0.1):
    yy, xx = np.mgrid[0:cw, 0:cw].astype(np.float32)
    x = (xx + 0.5 - cw / 2) / R; y = (yy + 0.5 - cw / 2) / R
    al = x * math.cos(th) + y * math.sin(th); ac = np.abs(-x * math.sin(th) + y * math.cos(th))
    e = np.where(ac >= 1, a1, a0 - (a0 - a1) * ac * ac)
    t = np.clip((np.abs(al) - e + fe) / (2 * fe), 0, 1)
    return 1 - t * t * (3 - 2 * t)


def composite(head_cell, body, th, size=(620, 520), hx=None, hy=None, length=7.0):
    """body pink stamps (every 0.3 R, tail -> head) + head (x HEAD_TINT) for heading th (screen, y down)."""
    Wc, Hc = size
    hx = Wc * 0.62 if hx is None else hx; hy = Hc * 0.5 if hy is None else hy
    can = np.zeros((Hc, Wc, 4), np.float32)
    bw = 202; k = int(round((th % math.pi) / math.pi * 16)) % 16
    lm = lens(bw, k / 16 * math.pi)
    ss = np.arange(length, 0.299, -0.3)          # snake.js: stamps from s0 = 0.25 * rh = 0.3 R behind the head point
    for i, s in enumerate(ss):
        row = [0, 1, 2][i % 3]
        c = body[row * bw:(row + 1) * bw, k * bw:(k + 1) * bw].copy()
        c[..., 3] *= lm
        c = engine_grade(c)
        cx = hx - s * 64 * math.cos(th); cy = hy - s * 64 * math.sin(th)
        over(can, c, int(round(cx - bw / 2)), int(round(cy - bw / 2)))
    h = head_cell.copy()
    h[..., :3] *= np.array(S.HEAD_TINT)[None, None]
    h = engine_grade(h)
    big = np.zeros((600, 600, 4), np.float32)
    big[300 - S.ORIGIN[1]:300 - S.ORIGIN[1] + h.shape[0], 300 - S.ORIGIN[0]:300 - S.ORIGIN[0] + h.shape[1]] = h
    rot = rotate_rgba(big, -math.degrees(th), (300, 300))
    over(can, rot, int(round(hx - 300)), int(round(hy - 300)))
    return can


def neck_colour(head_cell, body, b):
    """mean sRGB of head x tint in the neck zone (x in [-1.0, -0.45], opaque) vs body pink core at the same light."""
    w, h = S.CELL
    xs = (np.arange(w) + 0.5 - S.ORIGIN[0]) / S.PX_R
    m = (head_cell[..., 3] > 0.9) & ((xs > -1.0) & (xs < -0.45))[None, :]
    hm = head_cell[..., :3][m].mean(0) * np.array(S.HEAD_TINT)
    k = b % 16
    bm = []
    for row in (0, 1, 2):
        c = body[row * 202:(row + 1) * 202, k * 202:(k + 1) * 202]
        bm.append(c[..., :3][c[..., 3] > 0.9].mean(0))
    return hm * 255, np.mean(bm, 0) * 255


def neck_sheet(head, body, out, title='', cells=None):
    heads = [0, 4, 8, 12, 16, 20, 24, 28]
    tiles = []
    for b in heads:
        hc = atlas_cell(head, b) if cells is None else cells[b]
        can = composite(hc, body, b / 32 * 2 * math.pi)
        hm, bm = neck_colour(hc, body, b)
        tile = Image.fromarray((over_bg(can) * 255 + 0.5).astype(np.uint8))
        d = ImageDraw.Draw(tile)
        d.text((6, 4), 'heading %d deg (b%d)  neck: head x tint %s  body %s' % (b * 360 // 32, b, np.round(hm).astype(int).tolist(),
                                                                            np.round(bm).astype(int).tolist()), fill=(40, 40, 40), font=font(13))
        tiles.append(tile)
    tw, th_ = tiles[0].size
    m = Image.new('RGB', (tw * 4, th_ * 2 + 40), (255, 255, 255))
    ImageDraw.Draw(m).text((8, 10), title or 'engine-style composite: body.webp pink stamps every 0.3 R + head x HEAD_TINT %s '
                           '(both with atlasGrade)' % (S.HEAD_TINT,), fill=(20, 20, 20), font=font(16))
    for i, t in enumerate(tiles):
        m.paste(t, ((i % 4) * tw, 40 + (i // 4) * th_))
    m.save(out)


def contact_sheet(head, man, body, out, params=None):
    w, h = S.CELL
    k = 1
    pad = 26
    tiles = Image.new('RGB', (S.COLS * (w + 6), 4 * (h + pad)), (255, 255, 255))
    for b in range(S.BUCKETS):
        c = atlas_cell(head, b).copy()
        c[..., :3] *= np.array(S.HEAD_TINT)[None, None]
        im = Image.fromarray((over_bg(c) * 255 + 0.5).astype(np.uint8))
        d = ImageDraw.Draw(im)
        draw_spec(d, 1, 1, lw=1, params=params)
        th = b / 32 * 2 * math.pi
        L = S.LIGHT_SCREEN
        lx = math.cos(th) * L[0] + math.sin(th) * L[1]; ly = -math.sin(th) * L[0] + math.cos(th) * L[1]
        n = math.hypot(lx, ly)
        d.line([250, 270, 250 + 22 * lx / n, 270 + 22 * ly / n], fill=(230, 160, 0), width=3)
        d.ellipse([246, 266, 254, 274], outline=(230, 160, 0))
        x0 = (b % S.COLS) * (w + 6); y0 = (b // S.COLS) * (h + pad)
        tiles.paste(im, (x0, y0 + pad))
        ImageDraw.Draw(tiles).text((x0 + 4, y0 + 6), 'b%d  heading %.1f deg' % (b, b * 360 / 32), fill=(40, 40, 40), font=font(13))
    H = man.get('head', {})
    hdr = Image.new('RGB', (tiles.size[0], 64), (255, 255, 255))
    hd = ImageDraw.Draw(hdr)
    hd.text((8, 6), 'ae studio plush snake - HEAD v3 atlas (%s)  cell %s origin %s ref_R %s  head.webp %.0f KB  shown x HEAD_TINT %s' % (
        H.get('generator', '')[:60], H.get('cell'), H.get('origin'), H.get('ref_R'), H.get('bytes', 0) / 1024, list(S.HEAD_TINT)),
        fill=(20, 20, 20), font=font(15))
    hd.text((8, 32), 'cell b lit for heading b/32*360 (orange = light direction in the cell); blue/orange lines = spec brow/jaw outer fur edge, '
                     'green = eye r 0.25/0.27, magenta = tongue root, grey cross = head point', fill=(60, 60, 60), font=font(13))
    nk = os.path.join(os.path.dirname(out) or '.', '_neck_tmp.png')
    neck_sheet(head, body, nk)
    nimg = Image.open(nk).convert('RGB')
    os.remove(nk)
    scale = tiles.size[0] / nimg.size[0]
    nimg = nimg.resize((tiles.size[0], int(nimg.size[1] * scale)), Image.LANCZOS)
    m = Image.new('RGB', (tiles.size[0], hdr.size[1] + tiles.size[1] + nimg.size[1]), (255, 255, 255))
    m.paste(hdr, (0, 0)); m.paste(tiles, (0, hdr.size[1])); m.paste(nimg, (0, hdr.size[1] + tiles.size[1]))
    m.save(out)


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__); return
    mode = args[0]
    kv = dict(a.split('=', 1) for a in args[1:] if '=' in a)
    pos = [a for a in args[1:] if '=' not in a]
    if mode == 'fit':
        if 'atlas' in kv:
            rgba = atlas_cell(load_rgba(kv['atlas']), int(kv.get('cell', 0))); ss = 1
        else:
            rgba = load_rgba(pos[0]); ss = int(kv.get('ss', 2))
        params = S.load_params(kv.get('params', kv.get('update')))
        res = measure(rgba, ss, params=params)
        st = stats(res, shoulder=S.shoulder_of(params))
        print(json.dumps(st, indent=1))
        if 'update' in kv:
            p = update_params(res, kv['update'], float(kv.get('gain', 0.85)))
            print('updated', kv['update'], 'brow', p['reach_brow'], 'jaw', p['reach_jaw'])
        if 'out' in kv:
            fit_montage(rgba, ss, res, st, kv['out'], kv.get('title', 'head v3 fit: %s' % (pos[0] if pos else kv.get('atlas'))),
                        k=float(kv.get('k', 1.5 if ss >= 2 else 3.0)), params=params)
        if 'json' in kv:
            json.dump(st, open(kv['json'], 'w'), indent=1)
    elif mode == 'neck':
        head = load_rgba(kv.get('head', os.path.join(SNAKE, 'head.webp')))
        body = load_rgba(kv.get('body', os.path.join(SNAKE, 'body.webp')))
        neck_sheet(head, body, kv.get('out', 'neck.png'))
    elif mode == 'sheet':
        head = load_rgba(kv.get('head', os.path.join(SNAKE, 'head.webp')))
        body = load_rgba(kv.get('body', os.path.join(SNAKE, 'body.webp')))
        man = json.load(open(kv.get('manifest', os.path.join(SNAKE, 'manifest.json'))))
        contact_sheet(head, man, body, kv.get('out', 'sheet.png'), S.load_params(kv.get('params')))
    else:
        print(__doc__)


if __name__ == '__main__':
    main()
