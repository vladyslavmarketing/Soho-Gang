"""head_v3_spec.py - the plush snake head v3 target (client photo, side view) and its 2D skin construction.

numpy only: imported by head_v3.py (inside Blender) and by head_v3_check.py / head_v3_pack.py (python3).

Frame (same as assets/img/snake/manifest.json "head"): units of the body radius R; x forward from the head point;
u across the head, + = jaw side, - = brow side. Atlas cell: image y down, image y = -u (the jaw hangs toward -y),
origin = head point. Blender: X = x, Y = u (= -image y), Z = toward the top-down orthographic camera, which sees the
head's side with the bead eye.

SILHOUETTE = the OUTER FUR EDGE (alpha >= 0.5) traced on the photo, plus one deliberate departure: the brow-side neck
shoulder (BROW_SHOULDER, x < 0.6 R) that covers the front end of the engine's first body stamp. The skin is that
outline eroded by the fur reach (reach knots per edge, calibrated against renders by head_v3_check.py fit update=...).
"""
import json
import math
import os

import numpy as np

BROW_X = [-1.9, -0.29, 0.40, 0.96, 1.55, 2.05, 2.24, 2.33]
BROW_U = [-1.14, -1.14, -1.02, -0.80, -0.30, 0.35, 0.83, 1.25]
JAW_X = [-1.9, -1.18, -0.64, 0.60, 1.38, 1.86, 2.19, 2.33]
JAW_U = [1.20, 1.24, 1.62, 1.86, 2.00, 1.81, 1.33, 1.25]
EYE = (0.36, 0.42)              # bead centre (x, u)
EYE_R = (0.25, 0.27)            # visible bead radius range
TONGUE = (1.95, 1.45)           # tongue root (x, u); the engine draws the tongue
CELL = (281, 296)               # atlas cell px
ORIGIN = (113, 148)             # head point in the cell (px)
PX_R = 64                       # px per R in the atlas
COLS, BUCKETS = 8, 32
LIGHT_SCREEN = (-0.4194, -0.5792, 0.6990)   # engine key light (x right, y down, z to viewer)
NECK_FADE = (-1.0, -1.8)        # alpha 1 at x >= -1.0 R, 0 at x <= -1.8 R (baked)
HEAD_TINT = (0.91, 0.8, 0.83)   # snake.js multiplies the head cells by this (sRGB) to match the body
X_BACK = -2.6                   # the skin continues straight back to here (outside the cell, faded anyway)

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PARAMS = os.path.join(HERE, 'head_v3_params.json')

# default parameters (head_v3_params.json overrides): reach = fur edge - skin (R) at knots along x, per edge
DEFAULTS = {
    'knots_x': [-2.6, -1.9, -1.2, -0.5, 0.2, 0.9, 1.5, 1.9, 2.15, 2.33],
    'reach_brow': [0.38] * 10,
    'reach_jaw': [0.38] * 10,
    'tip_round': 0.12,          # corner fillet at the snout tip (length along each edge, R)
    'brow_shoulder': None,      # see BROW_SHOULDER / brow_shoulder(); null = the traced brow polyline unchanged
}

# Brow-side neck shoulder (deviation from the traced brow, x < x_join only). snake.js stamps the first body cell at
# 0.3 R behind the head point; its lens window ends in a straight cut at x ~ +0.06 R (soft -0.04 .. +0.16) and the body
# fur is opaque to |u| ~ 1.30 (alpha 0.5 at 1.38). The traced brow is only 1.14 R out at the neck, so that front end
# showed as a square tab above the brow. The shoulder widens the brow to the body's fur edge (`u`) over
# [x_back1, x_front] - where the body covers the head anyway in a straight pose - tapers back to the traced brow
# behind (x_back0, so the rigid head's back corner does not poke out past a bending neck) and rounds into the traced
# brow ahead with a C1 Hermite fillet that meets it tangentially at x_join.
BROW_SHOULDER = {'u': 1.40, 'x_back0': -1.25, 'x_back1': -0.5, 'x_front': 0.0, 'x_join': 0.6}


def load_params(path=None):
    p = json.loads(json.dumps(DEFAULTS))
    path = path or DEFAULT_PARAMS
    if path and os.path.exists(path):
        with open(path) as f:
            p.update(json.load(f))
    return p


def spec_u(x, edge):
    """linear interpolation of the spec polyline ('brow' or 'jaw') at x."""
    xs, us = (BROW_X, BROW_U) if edge == 'brow' else (JAW_X, JAW_U)
    return np.interp(x, xs, us)


def _smooth(a, b, x):
    t = np.clip((np.asarray(x, float) - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def brow_shoulder(x, m, sh):
    """brow magnitude |u| with the neck shoulder applied: x (n,), m = traced brow magnitude at x (> 0), sh = shoulder
    dict (BROW_SHOULDER keys) or None. Returns the new magnitude (>= m inside the shoulder zone, = m elsewhere)."""
    x = np.asarray(x, float); m = np.asarray(m, float)
    if not sh:
        return m
    U, xb0, xb1, xf, xj = sh['u'], sh['x_back0'], sh['x_back1'], sh['x_front'], sh['x_join']
    out = np.where(x <= xf, np.maximum(m, m + (U - m) * _smooth(xb0, xb1, x)), m)
    # fillet: Hermite from (xf, U, slope 0) to the traced (linear) brow at xj with its slope there
    e = 1e-3
    mj = -float(spec_u(xj, 'brow'))
    sj = -float(spec_u(xj + e, 'brow') - spec_u(xj - e, 'brow')) / (2 * e)
    t = np.clip((x - xf) / (xj - xf), 0, 1)
    H = (2 * t ** 3 - 3 * t ** 2 + 1) * U + (-2 * t ** 3 + 3 * t ** 2) * mj + (t ** 3 - t ** 2) * (xj - xf) * sj
    return np.where((x > xf) & (x < xj), np.maximum(m, H), out)


def shoulder_of(params):
    sh = params.get('brow_shoulder') if params else None
    if sh is True:
        sh = BROW_SHOULDER
    return dict(BROW_SHOULDER, **sh) if isinstance(sh, dict) else None


def target_u(x, edge, params=None):
    """target outer fur edge at x: the traced polyline, plus the brow shoulder when params enable it."""
    u = spec_u(x, edge)
    if edge == 'brow':
        u = -brow_shoulder(np.atleast_1d(x), -np.atleast_1d(u), shoulder_of(params))
        if np.ndim(x) == 0:
            u = float(u[0])
    return u


def spec_samples(step=0.01, x_min=-1.9, params=None):
    """dense points (x, u) along both spec polylines (exact linear segments), for measuring. With params enabling the
    brow shoulder, the brow samples follow the target (traced brow + shoulder) instead."""
    sh = shoulder_of(params)
    out = {}
    for edge, xs, us in (('brow', BROW_X, BROW_U), ('jaw', JAW_X, JAW_U)):
        pts = []
        for i in range(len(xs) - 1):
            a = np.array([xs[i], us[i]]); b = np.array([xs[i + 1], us[i + 1]])
            n = max(2, int(math.ceil(np.linalg.norm(b - a) / step)))
            t = np.arange(n) / n
            pts.append(a[None] + t[:, None] * (b - a)[None])
        pts.append(np.array([[xs[-1], us[-1]]]))
        P = np.concatenate(pts)
        if edge == 'brow' and sh:
            P[:, 1] = -brow_shoulder(P[:, 0], -P[:, 1], sh)
        out[edge] = P[P[:, 0] >= x_min]
    return out


def catmull_rom(P, step=0.004, alpha=0.5):
    """centripetal Catmull-Rom through points P (n, 2), sampled ~every `step`."""
    P = np.asarray(P, float)
    ext = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    out = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        t0 = 0.0
        t1 = t0 + max(np.linalg.norm(p1 - p0), 1e-6) ** alpha
        t2 = t1 + max(np.linalg.norm(p2 - p1), 1e-6) ** alpha
        t3 = t2 + max(np.linalg.norm(p3 - p2), 1e-6) ** alpha
        n = max(2, int(math.ceil(np.linalg.norm(p2 - p1) / step)))
        for k in range(n):
            t = t1 + (t2 - t1) * k / n
            A1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
            A2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            A3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            B1 = (t2 - t) / (t2 - t0) * A1 + (t - t0) / (t2 - t0) * A2
            B2 = (t3 - t) / (t3 - t1) * A2 + (t - t1) / (t3 - t1) * A3
            out.append((t2 - t) / (t2 - t1) * B1 + (t - t1) / (t2 - t1) * B2)
    out.append(P[-1])
    return np.array(out)


def outline(tip_round=0.12, step=0.004, shoulder=None):
    """smoothed outer-fur outline: {'brow': (n,2), 'jaw': (m,2)}, each ordered from the back (X_BACK) to the snout
    tip; the tip corner is rounded by a quadratic fillet that starts `tip_round` R back along each edge; `shoulder`
    (BROW_SHOULDER-like dict) widens the brow at the neck (brow_shoulder)."""
    br = catmull_rom(np.c_[[X_BACK] + BROW_X, [BROW_U[0]] + BROW_U], step)
    jw = catmull_rom(np.c_[[X_BACK] + JAW_X, [JAW_U[0]] + JAW_U], step)
    if shoulder:
        br[:, 1] = -brow_shoulder(br[:, 0], -br[:, 1], shoulder)
    if tip_round > 0:
        T = br[-1]

        def cut(c):
            d = np.linalg.norm(c - T[None], axis=1)
            i = np.nonzero(d >= tip_round)[0].max()
            return c[:i + 1]
        br, jw = cut(br), cut(jw)
        B0, J0 = br[-1], jw[-1]
        n = max(8, int(math.ceil(2 * tip_round / step)))
        t = np.linspace(0, 1, 2 * n + 1)[:, None]
        q = (1 - t) ** 2 * B0[None] + 2 * (1 - t) * t * T[None] + t ** 2 * J0[None]
        br = np.vstack([br, q[1:n + 1]])
        jw = np.vstack([jw, q[n:-1][::-1]])
    return {'brow': br, 'jaw': jw}


def reach_fn(params):
    kx = np.asarray(params['knots_x'], float)
    rb = np.asarray(params['reach_brow'], float); rj = np.asarray(params['reach_jaw'], float)
    return lambda edge, x: np.interp(x, kx, rb if edge == 'brow' else rj)


def skin_columns(xq, params, ol=None, du=0.004):
    """skin edges at columns xq: (u_brow, u_jaw) arrays (NaN where the skin is empty). Skin = points inside the outline
    whose distance to it is >= the local reach (reach of the nearest outline point)."""
    ol = ol or outline(params.get('tip_round', 0.12), shoulder=shoulder_of(params))
    rf = reach_fn(params)
    pts = np.vstack([ol['brow'], ol['jaw']])
    rch = np.concatenate([rf('brow', ol['brow'][:, 0]), rf('jaw', ol['jaw'][:, 0])])
    Q = np.vstack([ol['brow'], ol['jaw'][::-1]])          # closed polygon (the back edge closes it at X_BACK)
    Q0, Q1 = Q, np.roll(Q, -1, axis=0)
    ub = np.full(len(xq), np.nan); uj = np.full(len(xq), np.nan)
    for i, x in enumerate(np.atleast_1d(xq)):
        s = (Q0[:, 0] - x) * (Q1[:, 0] - x)
        e = np.nonzero((s < 0) | ((s == 0) & (Q0[:, 0] != Q1[:, 0])))[0]
        if len(e) < 2:
            continue
        cu = Q0[e, 1] + (Q1[e, 1] - Q0[e, 1]) * (x - Q0[e, 0]) / (Q1[e, 0] - Q0[e, 0])
        top, bot = cu.min(), cu.max()
        if not top < bot:
            continue
        u = np.arange(top, bot + 1e-9, du)
        sel = np.abs(pts[:, 0] - x) < 1.2
        P, Rr = pts[sel], rch[sel]
        d2 = (P[None, :, 0] - x) ** 2 + (P[None, :, 1] - u[:, None]) ** 2
        k = np.argmin(d2, axis=1)
        F = np.sqrt(d2[np.arange(len(u)), k]) - Rr[k]
        ok = np.nonzero(F >= 0)[0]
        if not len(ok):
            continue
        a, b = ok[0], ok[-1]
        ua = u[a] if a == 0 else u[a - 1] + (u[a] - u[a - 1]) * (-F[a - 1]) / (F[a] - F[a - 1])
        ubb = u[b] if b == len(u) - 1 else u[b] + (u[b + 1] - u[b]) * F[b] / (F[b] - F[b + 1])
        ub[i], uj[i] = ua, ubb
    return ub, uj


def skin_profile(params, nx=170):
    """slices of the skin from X_BACK to the snout tip: dict(x, u_brow, u_jaw, x_tip, u_tip). The slices are dense at
    the tip; the last one is the tip itself (zero height)."""
    ol = outline(params.get('tip_round', 0.12), shoulder=shoulder_of(params))
    lo, hi = 1.5, max(ol['brow'][:, 0].max(), ol['jaw'][:, 0].max())
    for _ in range(26):   # tip = last column with skin
        m = 0.5 * (lo + hi)
        b, j = skin_columns(np.array([m]), params, ol)
        if np.isnan(b[0]):
            hi = m
        else:
            lo = m
    x_tip = lo
    b, j = skin_columns(np.array([x_tip]), params, ol)
    u_tip = 0.5 * (b[0] + j[0])
    t = np.linspace(0, 1, nx)
    xs = X_BACK + (x_tip - X_BACK) * np.sin(t * np.pi / 2) ** 0.85
    xs[-1] = x_tip
    ub, uj = skin_columns(xs[:-1], params, ol)
    ub = np.append(ub, u_tip); uj = np.append(uj, u_tip)
    good = ~np.isnan(ub)
    return dict(x=xs[good], u_brow=ub[good], u_jaw=uj[good], x_tip=x_tip, u_tip=u_tip)


def cell_to_xu(px, py, ss=1):
    """cell pixel centres -> (x, u) in R (ss = supersampling of the image)."""
    return (np.asarray(px) + 0.5 - ORIGIN[0] * ss) / (PX_R * ss), -(np.asarray(py) + 0.5 - ORIGIN[1] * ss) / (PX_R * ss)


def xu_to_cell(x, u, ss=1):
    """(x, u) in R -> cell pixel coordinates (continuous; pixel centres at +0.5)."""
    return ORIGIN[0] * ss + np.asarray(x) * PX_R * ss, ORIGIN[1] * ss - np.asarray(u) * PX_R * ss
