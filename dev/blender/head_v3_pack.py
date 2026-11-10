#!/usr/bin/env python3
"""head_v3_pack.py - pack the head v3 renders (dev/blender/head_v3.py) into assets/img/snake/head.webp + manifest.

    python3 dev/blender/head_v3_pack.py RENDER_DIR [dest=assets/img/snake] [ev=0.6] [gain=auto|r,g,b] [max_kb=435]
                                        [png=atlas.png] [dry=1]

- each render (cell x ss, straight alpha) -> cell size: Lanczos in premultiplied float (no dark fringes);
- grade: +ev exposure in linear light (same as the body atlas packing: sun+world sprite rig -> photo exposure), then a
  per-channel sRGB gain so that the head x HEAD_TINT (what snake.js draws) equals the body.webp pink at the neck
  (x -1.0 .. -0.45 R, opaque fur, same light): gain=auto measures it (median over the 32 buckets);
- neck fade baked into alpha (smoothstep, opaque at x >= -1.0 R, transparent at x <= -1.8 R);
- 8 x 4 cells -> WebP (straight alpha), quality lowered until <= max_kb (435 KiB: < 450 kB);
- fit_R: packed cell 0 vs the target outline (traced polylines + the brow-side neck shoulder from the render's params);
- manifest.json: the "head" section is rewritten (same schema; rh_ref / head_scale keep 64 px per R), bytes.head /
  bytes.total updated, every other section left as it is.
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import head_v3_spec as S        # noqa: E402
import head_v3_check as C       # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))


def srgb2lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin2srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def downsample(rgba, size):
    pm = rgba.copy(); pm[..., :3] *= pm[..., 3:4]
    ch = [np.asarray(Image.fromarray(pm[..., i]).resize(size, Image.LANCZOS)) for i in range(4)]
    out = np.stack(ch, -1)
    a = np.clip(out[..., 3:4], 0, 1)
    rgb = np.clip(out[..., :3], 0, None) / np.maximum(a, 1e-4)
    out = np.concatenate([np.clip(rgb, 0, 1), a], -1)
    out[a[..., 0] < 1.5 / 255] = 0
    return out


def neck_fade(w, h):
    x = (np.arange(w) + 0.5 - S.ORIGIN[0]) / S.PX_R
    t = np.clip((x - S.NECK_FADE[1]) / (S.NECK_FADE[0] - S.NECK_FADE[1]), 0, 1)
    return np.broadcast_to(t * t * (3 - 2 * t), (h, w))


def main():
    args = sys.argv[1:]
    kv = dict(a.split('=', 1) for a in args if '=' in a)
    rdir = [a for a in args if '=' not in a][0]
    dest = kv.get('dest', os.path.join(ROOT, 'assets', 'img', 'snake'))
    ev = float(kv.get('ev', 0.6))
    max_kb = float(kv.get('max_kb', 435))
    g = json.load(open(os.path.join(rdir, 'head_geom.json')))
    w, h = S.CELL
    body = C.load_rgba(os.path.join(dest, 'body.webp'))
    cells = {}
    for b in range(S.BUCKETS):
        p = os.path.join(rdir, 'head_%02d.png' % b)
        if not os.path.exists(p):
            raise SystemExit('missing %s' % p)
        c = downsample(C.load_rgba(p), (w, h))
        c[..., :3] = lin2srgb(srgb2lin(c[..., :3]) * 2.0 ** ev)
        cells[b] = c
    # colour gain: head x tint == body pink at the neck (per bucket, same light), median over the buckets
    ratios = []
    for b in range(S.BUCKETS):
        hm, bm = C.neck_colour(cells[b], body, b)
        ratios.append(bm / np.maximum(hm, 1e-3))
    ratios = np.array(ratios)
    gain = np.median(ratios, 0) if kv.get('gain', 'auto') == 'auto' else np.array([float(v) for v in kv['gain'].split(',')])
    fade = neck_fade(w, h)
    resid = []
    for b in range(S.BUCKETS):
        c = cells[b]
        c[..., :3] = np.clip(c[..., :3] * gain[None, None], 0, 1)
        hm, bm = C.neck_colour(c, body, b)
        resid.append(hm - bm)
        c[..., 3] = c[..., 3] * fade
        c[c[..., 3] < 1.5 / 255] = 0
    resid = np.array(resid)
    rows = S.BUCKETS // S.COLS
    at = np.zeros((rows * h, S.COLS * w, 4), np.float32)
    for b, c in cells.items():
        at[(b // S.COLS) * h:(b // S.COLS + 1) * h, (b % S.COLS) * w:(b % S.COLS + 1) * w] = c
    at8 = np.clip(at * 255 + 0.5, 0, 255).astype(np.uint8)
    if 'png' in kv:
        Image.fromarray(at8, 'RGBA').save(kv['png'])
    out = os.path.join(dest, 'head.webp') if not kv.get('dry') else os.path.join(rdir, 'head.webp')
    q = int(kv.get('q', 90))
    while True:
        Image.fromarray(at8, 'RGBA').save(out, 'WEBP', quality=q, method=6, alpha_quality=90)
        size = os.path.getsize(out)
        if size <= max_kb * 1024 or q <= 50:
            break
        q -= 2
    # fit of the packed cells (1x, before the fade: x >= -1.0 R is unfaded) for the manifest
    params = g.get('params') or S.load_params()
    shoulder = S.shoulder_of(params)
    fit = C.stats(C.measure(C.atlas_cell(C.load_rgba(out), 0), 1, x_min=-1.0, params=params), zones=((-1.0, 9),),
                  shoulder=shoulder)
    print('head.webp %d bytes q%d gain %s  neck residual (head x tint - body, sRGB) mean %s max |.| %.1f' % (
        size, q, np.round(gain, 4).tolist(), np.round(resid.mean(0), 1).tolist(), np.abs(resid).max()))
    print(json.dumps(fit))
    man_path = os.path.join(dest, 'manifest.json')
    man = json.load(open(man_path))
    # bead centre / visible radius from the full-resolution render of bucket 0 (at 1x the bead rim mixes with fur)
    eye = C.measure(C.load_rgba(os.path.join(rdir, 'head_00.png')), g['ss'], params=params).get('eye', fit.get('eye', {}))
    fit.pop('eye', None)
    print('eye (render x%d): %s' % (g['ss'], {k: round(v, 3) for k, v in eye.items()}))
    head = {
        'version': 3,
        'generator': 'Blender 4.2 Cycles (CPU, OIDN), numpy-groomed hair curves; head v3 = plush head in profile after the '
                     'client photo; dev/blender/head_v3.py + head_v3_pack.py',
        'file': 'head.webp',
        'buckets': S.BUCKETS, 'cols': S.COLS,
        'ref_R': S.PX_R, 'rh_ref': round(S.PX_R * 1.2, 3), 'head_scale': 1.2,
        'cell': list(S.CELL), 'origin': list(S.ORIGIN),
        'eyes': True, 'fade_baked': True, 'tongue': False,
        'light_screen': list(S.LIGHT_SCREEN),
        'grade': {'exposure_ev': ev, 'gain_srgb': [round(float(v), 4) for v in gain], 'head_tint': list(S.HEAD_TINT),
                  'notes': 'gain_srgb (after the exposure) makes head x head_tint (snake.js HEAD_TINT) equal the body.webp '
                           'pink at the neck (x -1.0..-0.45 R) under the same light; residual mean %s sRGB' % (
                               np.round(resid.mean(0), 1).tolist(),)},
        'neck_fade_R': list(S.NECK_FADE),
        'eye': {'centres': [[round(eye.get('x', S.EYE[0]), 3), round(-eye.get('u', S.EYE[1]), 3)]],
                'radius': round(eye.get('r_area', 0.25), 3), 'bead_radius_3d': g['shape']['eye_r'],
                'measured': 'centre + visible radius (dark bead incl. glint, fur ring excluded) on the %dx render of cell 0' % g['ss'],
                'per_bucket': [[1]] * S.BUCKETS,
                'per_bucket_note': 'every cell is [1] = draw as stored (snake.js headPick mirrors a cell only for [0]); '
                                   'the single bead is centres[0]. Unlike v2, the values do not index centres.',
                'notes': 'one glossy bead, baked in every cell on the side facing the camera; centre (x, y) in R, cell frame '
                         '(x forward, image y down = -u). Never flipped (engine headPick: per_bucket [1]).'},
        'tongue_base_R': list(S.TONGUE),
        'shape': {
            'source': 'client plush photo, side view (outer fur edge traced by the site session)',
            'frame': 'units of R; x forward from the head point; u across, + = jaw side, - = brow side; cell image y = -u '
                     '(jaw toward -y, brow toward +y)',
            'outer_fur_edge': {'brow': {'x': S.BROW_X, 'u': S.BROW_U}, 'jaw': {'x': S.JAW_X, 'u': S.JAW_U},
                               'alpha_threshold': 0.5},
            'eye': {'x': S.EYE[0], 'u': S.EYE[1], 'r': list(S.EYE_R)},
            'tongue_root': list(S.TONGUE),
            'brow_neck_shoulder': dict(shoulder, notes=(
                'deviation from the traced brow, x < x_join only: the brow is widened to the body fur edge (|u| = u) '
                'over [x_back1, x_front], tapering back to the traced brow by x_back0 and rounding into it by x_join '
                '(C1 Hermite). It covers the front end of snake.js\'s first body stamp (0.3 R behind the head point, '
                'lens cut at x ~ +0.06 R), which showed as a square tab above the traced 1.14 R brow. Body-style '
                'grooming on that band. See dev/blender/head_v3_spec.py BROW_SHOULDER.')) if shoulder else None,
            'fit_R': fit,
            'notes': 'fit_R on the packed cell 0, x >= -1.0 R, alpha >= 0.5 edge vs the target (outer_fur_edge + '
                     'brow_neck_shoulder): brow/jaw = signed normal deviation target -> edge (+ = outside); '
                     'edge_to_target = distance edge -> nearest target point (max / mean / p95; max includes stray '
                     'fur strands); brow_vs_traced_in_shoulder = the brow vs the traced polyline inside the shoulder. '
                     'See dev/blender/head_v3_check.py',
        },
        'scale': {'draw_scale': 'cell px * (R / ref_R)', 'head_scale_vs_R': 1.2,
                  'notes': 'rh_ref = ref_R * head_scale, so the engine draws the cell at R / ref_R with the origin on the '
                           "path's head point"},
        'bytes': size, 'webp_quality': q,
        'render': {'spp': g['spp'], 'supersample': g['ss'], 'per_cell_s': g['per_cell_s'], 'render_s': g['render_s'],
                   'build_s': g['build_s'], 'strands': g['strands'], 'seed': g['seed'],
                   'sun': g['sun'], 'sun_angle_deg': g['sun_angle_deg'], 'world': g['world']},
        'notes': 'cell b at column b % cols, row floor(b / cols); head points +x, lit for heading th = b/buckets*2PI with the '
                 'fixed screen key light (rotate the cell by th about origin). Neck fade baked into alpha (x in neck_fade_R); '
                 'pink fur runs into the body (no collar). Eye baked (see eye). No tongue (engine draws it from '
                 'tongue_base_R). Straight alpha.',
    }
    if kv.get('dry'):
        print(json.dumps(head, indent=1)[:2000])
        return
    man['head'] = head
    man['bytes']['head'] = size
    man['bytes']['total'] = int(sum(v for k, v in man['bytes'].items() if k != 'total'))
    with open(man_path, 'w') as f:
        json.dump(man, f, indent=1)
    print('manifest updated', man_path)


if __name__ == '__main__':
    main()
