"""
ae studio - web3d packer (spec B8-B10, MANIFEST). Runs in Blender's Python (numpy + bundled OpenImageIO).

    blender -b --factory-startup --python blender/web3d_pack.py -- --stage pack       [--src renders/web3d_quick]
    powershell -NoProfile -ExecutionPolicy Bypass -File blender/encode_web3d.ps1
    blender -b --factory-startup --python blender/web3d_pack.py -- --stage finalize

pack      renders/web3d/<shot>/*.exr -> web3d_seq/<scene>/{rest,look,tongue}_<T>.png, mask.png, flow.png,
          web3d_seq/manifest.json (no files / probe / build), web3d_qa/ sheets + pack_report.json.
finalize  web3d_enc/ -> web3d/ (content-hashed names), manifest files / probe / fallback / build,
          web3d_qa/encode_report.json (byte caps, M6).
No shadow (user decision 2026-11-10): a_s = 0, A = film alpha (B8-3 skipped). PNGs come from a minimal zlib
writer (no gAMA / sRGB / iCCP chunks).
Simplifications (README): the "components within 4 D of the eye" filter of the look mask is a 4 D disc around
the eye; the flow search radius is 0.6 D at 156 px/D; aeBox ends where the tail line (the floor run at the
tail end of the centreline) begins; every tongue overlay uses one common slot (all origins equal).
"""
import os, sys, json, math, time, zlib, struct, hashlib, base64, subprocess, shutil, glob
import numpy as np
import OpenImageIO as oiio

HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
arg = lambda n, d: argv[argv.index(n) + 1] if n in argv else d
ROOT = r'C:\Users\vladk\ae-studio' if os.path.isdir(r'C:\Users\vladk\ae-studio') else os.path.normpath(os.path.join(HERE, '..', '..'))
SRC = os.path.join(ROOT, arg('--src', os.path.join('renders', 'web3d')))
SEQ, ENC, WEB, QA = (os.path.join(ROOT, d) for d in ('web3d_seq', 'web3d_enc', 'web3d', 'web3d_qa'))
MW, MH, PXD = 2112, 1344, 156
TIERS = {'S': 0.5, 'M': 2 / 3, 'L': 1.0}
CLIP_TIERS = ['S', 'M']
EXPOSURE = -0.2
D_THR = 2.0                                        # look mask threshold (spec B8-10), on the low-passed |cell - neutral cell|
SKIN_K = 0.37 / 0.5                                # breath swells the skin (r 0.37 D) but not the fur: B8-9 scale fix
SCENES = {
    'hero': dict(stage=[360, 96, 1752, 1152], range0=[-12, 16], start=0.35, exit_x=MW, camera={
        'name': 'CamHero', 'type': 'persp', 'lensMm': 85, 'pitchDownDeg': 7, 'base': [1408, 896]}),
    'gauge': dict(stage=[96, 0, 1632, 1344], range0=[-30, 30], start=0.25, exit_x=None, camera={
        'name': 'CamGauge', 'type': 'ortho', 'orthoScaleD': 13.538}),
}
GAUGE_ANCHORS = {'ringCenter': [720, 672], 'ringRadius': 390, 'trackHalfWidth': 41, 'coilRadius': 520,
                 'coilOuterRadius': 598, 'exitRamp': [1344, 1584]}   # moved in by 96 px: G1 M was 8352 MBs (B9-7)
LOG = []


def log(*a):
    s = ' '.join(str(x) for x in a)
    LOG.append(s)
    print('[pack]', s, flush=True)


# ======================================================================================== io
def write_png(path, arr):
    """minimal PNG writer: uint8 HxW (grey), HxWx3 (RGB) or HxWx4 (RGBA); no colour chunks"""
    a = np.ascontiguousarray(np.clip(arr, 0, 255).astype(np.uint8))
    h, w = a.shape[:2]
    ch = 1 if a.ndim == 2 else a.shape[2]
    ct = {1: 0, 3: 2, 4: 6}[ch]
    raw = np.concatenate([np.zeros((h, 1), np.uint8), a.reshape(h, w * ch)], 1).tobytes()
    chunk = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, ct, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def resize(a, w, h):
    c = a.shape[2]
    b = oiio.ImageBuf(oiio.ImageSpec(a.shape[1], a.shape[0], c, oiio.FLOAT))
    b.set_pixels(oiio.ROI(0, a.shape[1], 0, a.shape[0], 0, 1, 0, c), np.ascontiguousarray(a, np.float32))
    r = oiio.ImageBufAlgo.resize(b, filtername='lanczos3', roi=oiio.ROI(0, w, 0, h, 0, 1, 0, c))
    return r.get_pixels(oiio.FLOAT).reshape(h, w, c)


def read_exr(path, region):
    """premultiplied linear RGBA in master px, zero outside the region (B8-1); upsampled if rendered smaller"""
    b = oiio.ImageBuf(path)
    names = list(b.spec().channelnames)
    idx = [next(i for i, n in enumerate(names) if n.endswith('Combined.' + c)) for c in 'RGBA']
    px = b.get_pixels(oiio.FLOAT)
    px = px[..., idx].astype(np.float32)
    if px.shape[1] != MW:
        px = resize(px, MW, MH)
    x, y, w, h = region
    out = np.zeros((MH, MW, 4), np.float32)
    out[y:y + h, x:x + w] = px[y:y + h, x:x + w]
    return out


# ======================================================================================== image ops
def srgb_oetf(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def display(C):
    """B8-2/3/4: premultiplied display-space P and A; shadow a_s = 0"""
    a = C[..., 3]
    d = np.zeros(C.shape[:2] + (3,), np.float32)
    m = a > 1e-4
    d[m] = srgb_oetf(C[..., :3][m] / a[m, None] * 2 ** EXPOSURE)
    A = np.clip(a, 0, 1)
    return np.dstack([d * A[..., None], A]).astype(np.float32)


def dilate(m, r):
    out = m.astype(np.float32)
    for _ in range(r):
        o = out.copy()
        o[1:] = np.maximum(o[1:], out[:-1]); o[:-1] = np.maximum(o[:-1], out[1:])
        o[:, 1:] = np.maximum(o[:, 1:], out[:, :-1]); o[:, :-1] = np.maximum(o[:, :-1], out[:, 1:])
        out = o
    return out


def erode(m, r):
    return 1 - dilate(1 - m.astype(np.float32), r)


def gauss(a, sigma):
    k = int(3 * sigma)
    g = np.exp(-0.5 * (np.arange(-k, k + 1) / sigma) ** 2)
    g /= g.sum()
    out = a.astype(np.float32)
    for ax in (0, 1):
        p = np.pad(out, [(k, k) if i == ax else (0, 0) for i in range(out.ndim)], mode='edge')
        acc = np.zeros_like(out)
        for i, w in enumerate(g):
            sl = [slice(None)] * out.ndim
            sl[ax] = slice(i, i + out.shape[ax])
            acc += w * p[tuple(sl)]
        out = acc
    return out


def rotate_points(xy, pivot, ang):
    c, s = np.cos(ang), np.sin(ang)
    d = xy - pivot
    return pivot + np.stack([d[..., 0] * c - d[..., 1] * s, d[..., 0] * s + d[..., 1] * c], -1)


def snap(rect, unit):
    x, y, w, h = rect
    x0, y0 = math.floor(x / unit) * unit, math.floor(y / unit) * unit
    x1, y1 = math.ceil((x + w) / unit) * unit, math.ceil((y + h) / unit) * unit
    x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, MW), min(y1, MH)
    return [int(x0), int(y0), int(x1 - x0), int(y1 - y0)]


def bbox(mask, pad=0, unit=24):
    ys, xs = np.where(mask)
    if not len(xs):
        return None
    return snap([xs.min() - pad, ys.min() - pad, xs.max() + 1 - xs.min() + 2 * pad, ys.max() + 1 - ys.min() + 2 * pad], unit)


def union(a, b):
    x0, y0 = min(a[0], b[0]), min(a[1], b[1])
    return [x0, y0, max(a[0] + a[2], b[0] + b[2]) - x0, max(a[1] + a[3], b[1] + b[3]) - y0]


def intersect(a, b):
    x0, y0 = max(a[0], b[0]), max(a[1], b[1])
    return [x0, y0, min(a[0] + a[2], b[0] + b[2]) - x0, min(a[1] + a[3], b[1] + b[3]) - y0]


def inside(a, b):
    return a[0] >= b[0] and a[1] >= b[1] and a[0] + a[2] <= b[0] + b[2] and a[1] + a[3] <= b[1] + b[3]


def crop(img, r):
    x, y, w, h = r
    return img[y:y + h, x:x + w]


def feather(img, rect, exit_x=None, f=24):
    """B8-5: smoothstep feather over f master px on every crop edge except the exit edge"""
    x, y, w, h = rect
    yy, xx = np.mgrid[0:MH, 0:MW]
    ss = lambda t: np.clip(t, 0, 1) ** 2 * (3 - 2 * np.clip(t, 0, 1))
    k = ss((xx - x) / f) * ss((yy - y) / f) * ss((y + h - yy) / f)
    if not (exit_x is not None and x + w >= exit_x):
        k = k * ss((x + w - xx) / f)
    return img * k[..., None].astype(np.float32)


def tier(img, k):
    """B8-6: lanczos3 in premultiplied space, then A in [0,1] and P in [0,A]"""
    h, w = img.shape[:2]
    r = img if k == 1 else resize(img, int(round(w * k)), int(round(h * k)))
    A = np.clip(r[..., 3], 0, 1)
    return np.dstack([np.clip(r[..., :3], 0, A[..., None]), A])


def straight8(img):
    A = img[..., 3]
    P = np.where(A[..., None] > 0, img[..., :3] / np.maximum(A[..., None], 1e-6), 0)
    return np.dstack([np.clip(P, 0, 1), A]) * 255 + 0.5


def atlas(cells, cols, pad):
    """equal-size premultiplied cells -> straight-alpha uint8 atlas with edge-replicated padding (B8-13)"""
    h, w = cells[0].shape[:2]
    rows = int(math.ceil(len(cells) / cols))
    out = np.zeros((rows * (h + 2 * pad), cols * (w + 2 * pad), 4), np.float32)
    for i, c in enumerate(cells):
        r, q = divmod(i, cols)
        out[r * (h + 2 * pad):(r + 1) * (h + 2 * pad), q * (w + 2 * pad):(q + 1) * (w + 2 * pad)] = \
            np.pad(straight8(c), ((pad, pad), (pad, pad), (0, 0)), mode='edge')
    return out, rows


# ======================================================================================== one scene
def exit_ramp(img):
    """B8-5 gauge exit ramp: A and P x (1 - smoothstep(1440, 1680, x))"""
    x0, x1 = GAUGE_ANCHORS['exitRamp']
    t = np.clip((np.arange(MW) - x0) / (x1 - x0), 0, 1)
    return img * (1 - t * t * (3 - 2 * t))[None, :, None].astype(np.float32)


def load_shot(shot):
    d = os.path.join(SRC, shot)
    regs = json.load(open(os.path.join(d, 'region.json')))
    f = exit_ramp if shot.startswith('gauge') else (lambda im: im)
    return {n: (f(display(read_exr(os.path.join(d, n + '.exr'), regs[n]['region']))), regs[n]) for n in sorted(regs)}


def reconstruct(seed, allowed):
    """connected parts of `allowed` that touch `seed` (geodesic dilation until stable)"""
    cur = seed & allowed
    while True:
        nxt = (dilate(cur, 1) > 0) & allowed
        if nxt.sum() == cur.sum():
            return nxt
        cur = nxt


REST_F = {}


def pack_scene(scene, extra_rects=()):
    cfg = SCENES[scene]
    meta = json.load(open(os.path.join(SRC, '%s_meta.json' % scene)))
    rig = json.load(open(os.path.join(SRC, 'rig', 'rig_%s.json' % scene)))
    angles, neutral = meta['angles'], meta['neutral']
    still = load_shot('%s_rest' % scene)['0000'][0]
    cells = load_shot('%s_look' % scene)
    tongues = load_shot('%s_tongue' % scene)
    names, tnames = sorted(cells), sorted(tongues)
    A = still[..., 3]
    out = os.path.join(SEQ, scene)
    os.makedirs(out, exist_ok=True)
    rep = {}
    yy, xx = np.mgrid[0:MH, 0:MW].astype(np.float32)

    # ---- stage (B9-2): the spec's starting stage, grown to the still's content if needed
    still_rect = bbox(A >= 3 / 255, 16)
    stage = union(cfg['stage'], still_rect)
    for r_ in extra_rects:                                # clips (B9-2: the stage is the union of every rect)
        stage = union(stage, r_)
    cell_rect = meta['cell_rect']
    # ---- warp parameters (B8-12)
    pivot = np.array(rig['joints']['base'], float)
    head = np.array(rig['joints']['head'], float)
    axis = (head - pivot) / np.linalg.norm(head - pivot)
    length = float(np.linalg.norm(head - pivot))
    start = cfg['start'] * PXD
    wq = np.clip(((xx - pivot[0]) * axis[0] + (yy - pivot[1]) * axis[1] - start) / length, 0, 1)
    wq = wq * wq * (3 - 2 * wq)

    # ---- look mask (B8-10)
    s8 = still * 255
    inc = np.zeros((MH, MW), bool)
    cx, cy, cw, ch = cell_rect
    inc[cy:cy + ch, cx:cx + cw] = True
    D = np.zeros((MH, MW), np.float32)
    c8 = cells[names[neutral]][0] * 255
    for i, n in enumerate(names):
        if i != neutral:
            # against the neutral CELL (same region, same seed -> the same noise), not the full-frame still
            D = np.maximum(D, gauss(np.abs(cells[n][0] * 255 - c8).max(2), 1.5))
    D *= inc
    eye = np.array(rig['joints']['eye'], float)
    near = (xx - eye[0]) ** 2 + (yy - eye[1]) ** 2 <= (4 * PXD) ** 2
    T = np.zeros((MH, MW), bool)
    for n in tnames:
        T |= tongues[n][0][..., 3] * 255 > 3
    rng = list(cfg['range0'])
    R0 = dilate(erode(D > D_THR, 2), 2) > 0
    R0 = reconstruct(R0 & near, R0)                     # components that reach within 4 D of the eye
    for attempt in range(5):
        R = (dilate(R0, 8 + 8 * attempt) > 0) & inc
        W = R | T
        Rp = np.stack(np.where(R), 1)[:, ::-1].astype(np.float32)
        if len(Rp):
            wr = wq[Rp[:, 1].astype(int), Rp[:, 0].astype(int)]
            for ang in range(int(rng[0]), int(rng[1]) + 1, 2):
                q = rotate_points(Rp, pivot, math.radians(ang) * wr).round().astype(int)
                ok = (q[:, 0] >= 0) & (q[:, 0] < MW) & (q[:, 1] >= 0) & (q[:, 1] < MH)
                W[q[ok, 1], q[ok, 0]] = True
        mask = np.clip(1.6 * gauss(dilate(W, 1), 8), 0, 1) * inc
        feath = (mask > 0.02) & (mask < 0.98)
        p99 = float(np.percentile(D[feath], 99)) if feath.any() else 0.0
        if p99 <= 4:
            break
        log(scene, 'mask feather p99 Dmax %.1f > 4: dilating 8 px more' % p99)
    rep['mask_feather_p99_Dmax'] = p99
    rep['mask_breathW_note'] = 'feather vs breathW < 0.25 not asserted'
    mask_rect = bbox(mask > 1 / 255)

    # ---- look rect + warp range (B8-11)
    mp = np.stack(np.where((mask > 1 / 255) & (wq > 0)), 1)[:, ::-1].astype(np.float32)
    mw_ = wq[mp[:, 1].astype(int), mp[:, 0].astype(int)] if len(mp) else np.zeros(0)
    while True:
        look_rect = mask_rect
        for ang in range(int(rng[0]), int(rng[1]) + 1, 2):
            if len(mp):
                q = rotate_points(mp, pivot, -math.radians(ang) * mw_)
                look_rect = union(look_rect, snap([q[:, 0].min(), q[:, 1].min(), np.ptp(q[:, 0]) + 1, np.ptp(q[:, 1]) + 1], 24))
        if (inside(look_rect, cell_rect) and inside(look_rect, stage)) or rng[1] - rng[0] <= 4:
            break
        rng = [min(rng[0] + 2, 0), max(rng[1] - 2, 0)]
    look_rect = intersect(look_rect, cell_rect)
    rep['rangeDeg'] = rng
    gate = 0.0                                            # outside R every cell equals the still (2 px opening)
    for n in names:
        dd = np.abs(cells[n][0] * 255 - c8).max(2) * (~R) * inc
        op = dilate(erode(dd > 3, 2), 2) > 0
        gate = max(gate, float(dd[op].max()) if op.any() else 0.0)
    rep['rect_gate_max_outside_R'] = gate
    nd = float(np.abs(crop(cells[names[neutral]][0] * 255, look_rect) - crop(s8, look_rect)).mean())
    rep['neutral_cell_mean_diff'] = nd
    write_png(os.path.join(out, 'mask.png'),
              crop(resize(mask[..., None], MW // 2, MH // 2)[..., 0], [v // 2 for v in mask_rect]) * 255 + 0.5)
    log(scene, 'mask rect', mask_rect, 'look rect', look_rect, 'range', rng, 'neutral diff %.2f, gate %.1f, p99 %.1f' % (nd, gate, p99))

    # ---- tongue slot: union bbox of every overlay (+16, snapped), clipped into the mask rect
    tb = None
    for n in tnames:
        b = bbox(tongues[n][0][..., 3] * 255 > 3, 16)
        if b:
            tb = b if tb is None else union(tb, b)
    trect = intersect(tb, mask_rect)
    rep['tongue_rect'] = trect

    # ---- flow map (B8-9), half master over the stage
    cl = np.array(rig['centreline']['samples'], float)
    hx, hy = MW // 2, MH // 2
    Ah = resize(A[..., None], hx, hy)[..., 0]
    best = np.full((hy, hx), np.inf, np.float32)
    flow = np.zeros((hy, hx, 2), np.float32)
    gy, gx = np.mgrid[0:hy, 0:hx].astype(np.float32)
    rad = 0.6 * PXD
    for x, y, dep, r, bw in cl:
        x0, x1 = int(max((x - rad) / 2, 0)), int(min((x + rad) / 2 + 1, hx))
        y0, y1 = int(max((y - rad) / 2, 0)), int(min((y + rad) / 2 + 1, hy))
        if x1 <= x0 or y1 <= y0:
            continue
        px, py = gx[y0:y1, x0:x1] * 2, gy[y0:y1, x0:x1] * 2
        m = ((px - x) ** 2 + (py - y) ** 2 < rad * rad) & (dep < best[y0:y1, x0:x1]) & (Ah[y0:y1, x0:x1] >= 0.05)
        best[y0:y1, x0:x1][m] = dep
        flow[y0:y1, x0:x1, 0][m] = (px[m] - x) * 0.022 * SKIN_K * bw / 2   # stored in half-res px
        flow[y0:y1, x0:x1, 1][m] = (py[m] - y) * 0.022 * SKIN_K * bw / 2
    has = np.isfinite(best)
    for _ in range(4):                                     # dilate the flow by 4 px
        new = (dilate(has, 1) > 0) & ~has
        if not new.any():
            break
        acc = np.zeros_like(flow)
        cnt = np.zeros((hy, hx), np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sh = np.roll(np.roll(has, dy, 0), dx, 1)
            acc += np.roll(np.roll(flow, dy, 0), dx, 1) * sh[..., None]
            cnt += sh
        flow[new] = acc[new] / np.maximum(cnt[new, None], 1)
        has |= new
    flow_master = flow * 2                                 # displacement in master px (M4: rest.flow)
    amp = 0.8
    try:                                                   # breath QA: H3 warped by +flow vs H3b
        breath = load_shot('%s_rest_breath' % scene)['0000'][0]
        f_full = resize(flow_master, MW, MH)
        bx, by, bw_, bh = json.load(open(os.path.join(SRC, '%s_rest_breath' % scene, 'region.json')))['0000']['rect']
        inb = np.zeros((MH, MW), bool)
        inb[by + 8:by + bh - 8, bx + 8:bx + bw_ - 8] = True
        # area check: render noise and fur strands make per-pixel comparisons meaningless for a 1-2 px swell, so
        # the flow must reproduce the alpha area H3b gained over H3 (inside the H3b render region)
        def area(a):
            return float(a[inb].sum())
        def warped(sgn):
            sx = np.clip(xx - sgn * f_full[..., 0], 0, MW - 1).round().astype(int)
            sy = np.clip(yy - sgn * f_full[..., 1], 0, MH - 1).round().astype(int)
            return A[sy, sx]
        a3, a3b = area(A), area(breath[..., 3])
        res = {1: area(warped(1)) - a3b, -1: area(warped(-1)) - a3b}
        base = a3 - a3b
        sgn = min(res, key=lambda k: abs(res[k]))
        if sgn < 0:
            flow_master = -flow_master
        if not (abs(res[sgn]) <= 0.5 * abs(base) and base < 0):
            amp = 0
        rep['breath_qa'] = {'area_px_H3_minus_H3b': base, 'warped_plus_minus_H3b': res[1], 'warped_minus_minus_H3b': res[-1], 'amp': amp}
        log(scene, 'breath QA (alpha area vs H3b): H3 %+.0f px, +flow %+.0f, -flow %+.0f -> amp %s' % (base, res[1], res[-1], amp))
    except Exception as ex:
        log(scene, 'breath QA skipped:', repr(ex))
    fl8 = np.dstack([128 + 32 * flow_master[..., 0], 128 + 32 * flow_master[..., 1], np.zeros((hy, hx))]).round()
    fl8[~has] = [128, 128, 0]
    write_png(os.path.join(out, 'flow.png'), crop(fl8, [v // 2 for v in stage]))

    # ---- tiers (B8-6, B8-13)
    rest_f = feather(still, stage, cfg['exit_x'])
    REST_F[scene] = rest_f
    keep = (dilate(mask > 0, 4) > 0)[..., None]                # outside the mask the player never shows a cell
    look_cells = [feather(cells[n][0], look_rect) * keep for n in names]
    lw = look_rect[2] + 8
    look_cols = 5
    while look_cols > 1 and look_cols * lw > 4096:
        look_cols -= 1
    for T_, k in TIERS.items():
        tr = lambda r: [int(round(v * k)) for v in r]
        write_png(os.path.join(out, 'rest_%s.png' % T_), straight8(crop(tier(rest_f, k), tr(stage))))
        at, look_rows = atlas([crop(tier(c, k), tr(look_rect)) for c in look_cells], look_cols, 4)
        write_png(os.path.join(out, 'look_%s.png' % T_), at)
        at, _ = atlas([crop(tier(tongues[n][0], k), tr(trect)) for n in tnames], 5, 4)
        write_png(os.path.join(out, 'tongue_%s.png' % T_), at)

    # ---- anchors (B8-14)
    an = {}
    body = A >= 0.5
    if scene == 'hero':
        k_end = len(cl) - 1                                # tail line: the flat run at the tail end
        ymax = cl[-1, 1]
        while k_end > 0 and cl[k_end - 1, 1] >= ymax - 0.5 * cl[k_end - 1, 3]:
            k_end -= 1
            ymax = max(ymax, cl[k_end, 1])
        x_end = float((cl[:k_end, 0] + cl[:k_end, 3]).max())
        an['aeBox'] = bbox(body & (xx <= x_end), 0, 1)
    eye, snout = rig['joints']['eye'], rig['joints']['snout']
    hd = np.array(snout) - np.array(rig['joints']['head'])
    hd = hd / np.linalg.norm(hd)
    an.update(eye=[round(v) for v in eye], snout=[round(v) for v in snout], headDir=[round(float(v), 3) for v in hd])
    if scene == 'hero':
        ys = []
        for x0 in range(stage[0], stage[0] + stage[2], 48):
            r_ = np.where(body[:, x0:x0 + 48].any(1))[0]
            ys.append(int(r_.max()) if len(r_) else None)
        an['silhouetteBottom'] = {'x0': stage[0], 'step': 48, 'y': ys}
    else:
        an.update(GAUGE_ANCHORS)
        an['tipX'] = round(float(np.clip((eye[0] - (720 - 487.5)) / 975 + 0.10, 0.55, 0.85)), 3)
    env = int(np.where((A >= 3 / 255).any(1))[0].min())
    pts = []
    for n in names:
        q = np.stack(np.where(cells[n][0][..., 3] >= 3 / 255), 1)[:, ::-1].astype(np.float32)
        pts.append(q[np.argsort(q[:, 1])[:3000]])
    for n in tnames:
        q = np.stack(np.where(tongues[n][0][..., 3] >= 3 / 255), 1)[:, ::-1].astype(np.float32)
        if len(q):
            pts.append(q[np.argsort(q[:, 1])[:500]])
    P_ = np.concatenate(pts)
    w_ = wq[P_[:, 1].astype(int), P_[:, 0].astype(int)]
    for ang in range(int(rng[0]), int(rng[1]) + 1, 2):
        env = min(env, int(rotate_points(P_, pivot, math.radians(ang) * w_)[:, 1].min()))
    # containment (B9-4)
    rep['containment'] = {'mask_in_look': inside(mask_rect, look_rect), 'tongue_in_mask': inside(trect, mask_rect),
                          'look_in_cell': inside(look_rect, cell_rect), 'look_in_stage': inside(look_rect, stage)}
    log(scene, 'containment', rep['containment'])
    # lit-fur pink (B7-1): median of the top 20 % luminance of pink pixels with alpha > 0.95
    d = np.where(A[..., None] > 0, still[..., :3] / np.maximum(A[..., None], 1e-6), 0)
    pink = (A > 0.95) & (d[..., 0] > d[..., 1] + 0.12) & (d[..., 2] > d[..., 1])
    lum = d @ np.array([0.2126, 0.7152, 0.0722])
    sel = pink & (lum >= np.percentile(lum[pink], 80)) if pink.any() else pink
    rep['lit_pink'] = [int(round(v * 255)) for v in np.median(d[sel], 0)] if sel.any() else [226, 140, 160]
    look = {
        'axis': 'yaw' if scene == 'hero' else 'nod', 'angles': angles, 'neutral': neutral, 'rect': look_rect,
        'envelopeTop': env, 'atlas': {'file': 'look.webp', 'cols': look_cols, 'rows': look_rows, 'pad': 4},
        'mask': {'file': 'mask.png', 'rect': mask_rect, 'fileScale': 0.5},
        'warp': {'pivot': [round(float(v), 1) for v in pivot], 'axis': [round(float(v), 4) for v in axis],
                 'start': round(start, 1), 'length': round(length, 1), 'rangeDeg': rng, 'positive': 'cw'},
        'tongue': {'atlas': {'file': 'tongue.webp', 'cols': 5, 'rows': len(names), 'pad': 4},
                   'slot': trect[2:], 'frames': ['e1', 'e2', 'e3', 'f1', 'f2'], 'origins': [trect[:2]] * len(names),
                   'single': [0, 1, 2, 3, 4, 3, 4, 2, 1, 0],
                   'double': [0, 1, 2, 3, 4, 3, 4, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1, 0]},
    }
    sec = {'frame': [MW, MH], 'camera': cfg['camera'], 'stage': stage, 'exit': 'right', 'anchors': an,
           'rest': {'still': {'file': 'rest.webp', 'rect': stage},
                    'flow': {'file': 'flow.png', 'rect': stage, 'fileScale': 0.5, 'zero': 128, 'pxPerUnit': 32},
                    'breath': {'periodS': 3.6, 'amp': amp}},
           'look': look, 'clips': {}}
    qa(scene, rest_f, stage, cells, names, tongues, tnames, trect, look_rect)
    log(scene, 'stage', stage, 'still rect', still_rect, 'anchors', {k: v for k, v in an.items() if k != 'silhouetteBottom'})
    return sec, rep


def qa(scene, rest_f, stage, cells, names, tongues, tnames, trect, look_rect):
    bg = np.array([241, 214, 218] if scene == 'hero' else [30, 22, 24], np.float32) / 255
    over = lambda img: (img[..., :3] + bg * (1 - img[..., 3:4])) * 255
    im = crop(over(rest_f), stage)
    if scene == 'gauge':
        yy, xx = np.mgrid[stage[1]:stage[1] + stage[3], stage[0]:stage[0] + stage[2]]
        im[np.abs(np.sqrt((xx - 720) ** 2 + (yy - 672) ** 2) - 390) < 1.5] = [80, 200, 255]
    write_png(os.path.join(QA, '%s_rest_on_bg.png' % scene), im[::2, ::2])
    for nm, imgs, rect, cols in (('look', [cells[n][0] for n in names], look_rect, 5),
                                  ('tongue', [tongues[n][0] for n in tnames], trect, 5)):
        lc = [crop(over(c), rect) for c in imgs]
        if nm == 'look':
            lc = [c[::2, ::2] for c in lc]
        h, w = lc[0].shape[:2]
        rows = int(math.ceil(len(lc) / cols))
        sheet = np.full((rows * h, cols * w, 3), 255, np.float32)
        for i, c in enumerate(lc):
            r, q = divmod(i, cols)
            sheet[r * h:(r + 1) * h, q * w:(q + 1) * w] = c
        write_png(os.path.join(QA, '%s_%s_sheet.png' % (scene, nm)), sheet)


# ======================================================================================== clips (B8-7, B9)
CLIPS = {  # logical name: scene, source shot, from, to, events
    'intro': ('hero', 'hero_intro', 'empty', 'rest', {'written': 70}),
    'depart': ('hero', 'hero_depart', 'rest', 'empty', {'unwritten': 2}),
    'arrive': ('gauge', 'gauge_arrive', 'empty', 'rest', {'arrived': 95}),
}
STRIP = [round(255 * i / 15) for i in range(16)]


def clip_frames(shot):
    return sorted(glob.glob(os.path.join(SRC, shot, '[0-9][0-9][0-9][0-9].exr')))


def read_clip(path, ramp):
    """one clip frame: premultiplied display RGBA at clip px (2/3 master)"""
    b = oiio.ImageBuf(path)
    names = list(b.spec().channelnames)
    idx = [next(i for i, n in enumerate(names) if n.endswith('Combined.' + c)) for c in 'RGBA']
    px = b.get_pixels(oiio.FLOAT)[..., idx].astype(np.float32)
    if px.shape[1] != 1408:                                 # end frames re-rendered with the still settings (B8-15)
        px = resize(px, 1408, 896)
    im = display(px)
    if ramp:
        x0, x1 = (v * 2 / 3 for v in GAUGE_ANCHORS['exitRamp'])
        t = np.clip((np.arange(im.shape[1]) - x0) / (x1 - x0), 0, 1)
        im *= (1 - t * t * (3 - 2 * t))[None, :, None].astype(np.float32)
    return im


def clip_rect(name):
    """bbox of A >= 3/255 over all frames + 16 master px, snapped outward to 96 (master px)"""
    scene, shot = CLIPS[name][:2]
    acc = None
    for f in clip_frames(shot):
        a = read_clip(f, scene == 'gauge')[..., 3] >= 3 / 255
        acc = a if acc is None else acc | a
    ys, xs = np.where(acc)
    r = [xs.min() * 1.5 - 16, ys.min() * 1.5 - 16, (xs.max() + 1 - xs.min()) * 1.5 + 32,
         (ys.max() + 1 - ys.min()) * 1.5 + 32]
    return snap(r, 96)


def stacked(img, k, gutter_rgb):
    """premultiplied RGBA crop at tier k (master -> tier) -> stacked-alpha RGB uint8 (colour, gutter, alpha)"""
    h, w = img.shape[:2]
    g = int(round(96 * k))
    out = np.zeros((2 * h + g, w, 3), np.float32)
    out[:h] = img[..., :3] * 255
    y0, y1 = h + int(round(24 * k)), h + int(round(48 * k))
    pw = w // 16
    for i, v in enumerate(STRIP):
        out[y0:y1, i * pw:(w if i == 15 else (i + 1) * pw)] = v
    y0, y1 = h + int(round(60 * k)), h + int(round(84 * k))
    pw = w // 4
    for i, c in enumerate(gutter_rgb):
        out[y0:y1, i * pw:(w if i == 3 else (i + 1) * pw)] = c
    out[h + g:] = img[..., 3:4] * 255
    return (out + 0.5).clip(0, 255).astype(np.uint8)


def lowpass_cmp(a, b):
    """B8-15 metric on premultiplied RGBA at one tier: sigma 1.5 tier px, inside the snake mask (dilated 8)"""
    m = dilate(np.maximum(a[..., 3], b[..., 3]) >= 0.5, 8) > 0
    d = np.abs(gauss(a, 1.5) - gauss(b, 1.5)) * 255
    dc, da = d[..., :3].max(2)[m], d[..., 3][m]
    return {'mean_rgb': round(float(dc.mean()), 2), 'p99_rgb': round(float(np.percentile(dc, 99)), 2),
            'mean_a': round(float(da.mean()), 2), 'p99_a': round(float(np.percentile(da, 99)), 2)}


def pack_clip(name, rect, patches, man):
    scene, shot, frm, to, events = CLIPS[name]
    files = clip_frames(shot)
    N = len(files)
    rc = [int(round(v * 2 / 3)) for v in rect]
    rep = {'frames': N, 'rect': rect}
    outs = {T_: [os.path.join(SEQ, scene, name, T_)] for T_ in CLIP_TIERS}
    if name == 'depart':
        for T_ in CLIP_TIERS:
            outs[T_].append(os.path.join(SEQ, scene, 'depart-rev', T_))
    for ds in outs.values():
        for d in ds:
            shutil.rmtree(d, ignore_errors=True)
            os.makedirs(d)
    x, y, w, h = rc
    yy, xx = np.mgrid[0:h, 0:w]
    ss = lambda t: np.clip(t, 0, 1) ** 2 * (3 - 2 * np.clip(t, 0, 1))
    ff = ss(xx / 16) * ss(yy / 16) * ss((h - yy) / 16)
    if not (scene == 'hero' and rect[0] + rect[2] >= MW):
        ff = ff * ss((w - xx) / 16)
    ff = ff[..., None].astype(np.float32)
    maxA, sizes = [], {}
    for j, f in enumerate(files):
        im = read_clip(f, scene == 'gauge')
        maxA.append(float(im[..., 3].max()))
        cr = im[y:y + h, x:x + w] * ff
        for T_ in CLIP_TIERS:
            t = tier(cr, TIERS[T_] * 1.5)                  # tier px per clip px: M 1, S 3/4
            fr = stacked(t, TIERS[T_], patches)
            sizes[T_] = [int(fr.shape[1]), int(fr.shape[0])]
            write_png(os.path.join(outs[T_][0], '%04d.png' % j), fr)
            if len(outs[T_]) > 1:
                write_png(os.path.join(outs[T_][1], '%04d.png' % (N - 1 - j)), fr)
            if (j == N - 1 and to == 'rest') or (j == 0 and frm == 'rest'):
                still_t = tier(crop(REST_F[scene], rect), TIERS[T_])[:t.shape[0], :t.shape[1]]
                rep.setdefault('continuity', {})[T_] = lowpass_cmp(t, still_t)
    empty = {'intro': [0, 1, 2], 'depart': [N - 1], 'arrive': [0]}[name]
    rep['empty_frames_maxA_255'] = {str(i): round(maxA[i] * 255, 2) for i in empty}
    rep['empty_ok'] = all(maxA[i] * 255 <= 3 for i in empty)
    rep['stacked'] = sizes
    rep['macroblocks'] = {T_: math.ceil(sz[0] / 16) * math.ceil(sz[1] / 16) for T_, sz in sizes.items()}
    rep['mb_ok'] = all(v <= 8192 for v in rep['macroblocks'].values())
    clip = {'frames': N, 'rect': rect, 'from': frm, 'to': to, 'events': events}
    if name == 'depart':
        clip['reverse'] = 'depart-rev'
        man['scenes'][scene]['clips']['depart-rev'] = {'frames': N, 'rect': rect, 'from': 'empty', 'to': 'rest'}
    man['scenes'][scene]['clips'][name] = clip
    log(name, rep)
    return rep


# ======================================================================================== stages
def stage_pack():
    t0 = time.time()
    os.makedirs(QA, exist_ok=True)
    man = {'schema': 'ae-snake3d/1', 'generator': 'web3d_pack.py · Blender 5.1.2 · Cycles OptiX · denoiser OptiX',
           'fps': 30, 'pxPerD': PXD, 'tiers': {'S': 0.5, 'M': 0.6666667, 'L': 1},
           'clipRenderScale': 0.6666667, 'clipTiers': CLIP_TIERS, 'scenes': {}}
    reports = {}
    rects = {} if '--no-clips' in argv else {n: clip_rect(n) for n, c in CLIPS.items() if clip_frames(c[1])}
    log('clip rects', rects)
    for scene in arg('--scenes', 'hero,gauge').split(','):
        if os.path.exists(os.path.join(SRC, '%s_rest' % scene)):
            man['scenes'][scene], reports[scene] = pack_scene(scene, [r for n, r in rects.items() if CLIPS[n][0] == scene])
    pink = reports.get('hero', reports.get('gauge', {})).get('lit_pink', [226, 140, 160])
    patches = [pink, [241, 214, 218], [191, 0, 0], [0, 0, 191]]
    for n, r in rects.items():
        reports.setdefault('clips', {})[n] = pack_clip(n, r, patches, man)
    man['videoLayout'] = {'gutter': 96, 'strip': {'y': 24, 'h': 24, 'steps': 16},
                          'patches': {'y': 60, 'h': 24, 'rgb': [pink, [241, 214, 218], [191, 0, 0], [0, 0, 191]]},
                          'premultiplied': True, 'matrix': 'bt709', 'range': 'tv'}
    json.dump(man, open(os.path.join(SEQ, 'manifest.json'), 'w'), indent=1)
    json.dump({'reports': reports, 'log': LOG}, open(os.path.join(QA, 'pack_report.json'), 'w'), indent=1)
    log('pack done in %.0f s' % (time.time() - t0))


def find_ff(exe):
    p = shutil.which(exe)
    if p:
        return p
    for root, _, files in os.walk(os.path.expandvars(r'%LOCALAPPDATA%\Microsoft\WinGet\Packages')):
        if exe in files:
            return os.path.join(root, exe)
    return exe


CAPS = {  # M6, KB for AV1 / WebP (HEVC x1.25, H.264 x1.7)
    ('hero', 'rest'): (80, 130, 260), ('hero', 'look'): (150, 270, 580), ('hero', 'tongue'): (55, 90, 180),
    ('gauge', 'rest'): (90, 150, 300), ('gauge', 'look'): (110, 200, 420), ('gauge', 'tongue'): (40, 65, 130),
    ('hero', 'intro'): (340, 600, 1250), ('hero', 'depart'): (200, 350, 720), ('hero', 'depart-rev'): (200, 350, 720),
    ('gauge', 'arrive'): (400, 700, 1450),
}


def decode_check(man):
    """B10-4: decode frames 0 and N-1 of every video; grey strip 17 i +- 3, colour patches +- 4"""
    ff = find_ff('ffmpeg.exe')
    vl = man['videoLayout']
    out, tmp = {}, os.path.join(QA, '_decode')
    os.makedirs(tmp, exist_ok=True)
    for key, ent in man['files'].items():
        if not key.endswith('.mp4'):
            continue
        scene, T_, leaf = key.split('/')
        clip = leaf.split('.')[0]
        cl = man['scenes'].get(scene, {}).get('clips', {}).get(clip)
        if not cl:
            continue
        k = man['tiers'][T_]
        h = int(round(cl['rect'][3] * k))
        res = {}
        for fi in (0, cl['frames'] - 1):
            png = os.path.join(tmp, 'f.png')
            subprocess.run([ff, '-y', '-loglevel', 'error', '-i', os.path.join(WEB, ent['file']), '-vf',
                            'select=eq(n\\,%d),scale=in_color_matrix=bt709:in_range=tv,format=rgb24' % fi,
                            '-frames:v', '1', png], check=True)
            im = oiio.ImageBuf(png).get_pixels(oiio.FLOAT) * 255
            w = im.shape[1]
            y0, y1 = h + int(round(vl['strip']['y'] * k)), h + int(round((vl['strip']['y'] + vl['strip']['h']) * k))
            pw = w // 16
            strip = [float(np.median(im[y0 + 2:y1 - 2, i * pw + 3:(i + 1) * pw - 3, 1])) for i in range(16)]
            serr = max(abs(v - round(255 * i / 15)) for i, v in enumerate(strip))
            y0, y1 = h + int(round(vl['patches']['y'] * k)), h + int(round((vl['patches']['y'] + vl['patches']['h']) * k))
            pw = w // 4
            perr = max(float(np.abs(np.median(im[y0 + 2:y1 - 2, i * pw + 3:(i + 1) * pw - 3].reshape(-1, 3), 0)
                                    - np.array(c)).max()) for i, c in enumerate(vl['patches']['rgb']))
            res[str(fi)] = {'strip_max_err': round(serr, 1), 'patch_max_err': round(perr, 1),
                            'ok': serr <= 3 and perr <= 4}
        out[key] = res
    bad = [k for k, v in out.items() if not all(r['ok'] for r in v.values())]
    log('decode check: %d videos, failing: %s' % (len(out), bad or 'none'))
    return {'videos': out, 'failing': bad}


def stage_finalize():
    man = json.load(open(os.path.join(SEQ, 'manifest.json')))
    files, report = {}, {'files': {}, 'over_cap': []}
    os.makedirs(WEB, exist_ok=True)
    keep = set()
    for path in sorted(glob.glob(os.path.join(ENC, '**', '*.*'), recursive=True)):
        rel = os.path.relpath(path, ENC).replace('\\', '/')
        if rel == 'probe.mp4':
            continue
        data = open(path, 'rb').read()
        h8 = hashlib.sha1(data).hexdigest()[:8]
        d, leaf = os.path.split(rel)
        stem, ext = leaf.split('.', 1)
        hashed = (d + '/' if d else '') + '%s.%s.%s' % (stem, h8, ext)
        dst = os.path.join(WEB, hashed)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copyfile(path, dst)
        keep.add(os.path.normpath(dst))
        ent = {'file': hashed, 'bytes': len(data)}
        if ext.endswith('mp4'):
            o = subprocess.run([find_ff('ffprobe.exe'), '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                                'stream=codec_name,profile,level,width,height,nb_frames', '-of', 'json', path],
                               capture_output=True, text=True).stdout
            p = json.loads(o)['streams'][0]
            lv = int(p['level'])
            ent['codec'] = {'av1': 'av01.0.%02dM.08' % lv, 'hevc': 'hvc1.1.6.L%d.B0' % lv,
                            'h264': 'avc1.6400%02X' % lv}[ext.split('.')[0]]
            ent.update(size=[p['width'], p['height']], frames=int(p.get('nb_frames', 0)))
        else:
            sp_ = oiio.ImageBuf(path).spec()
            ent['size'] = [sp_.width, sp_.height]
        files[rel] = ent
        parts = rel.split('/')
        if len(parts) == 3 and (parts[0], parts[2].split('.')[0]) in CAPS:
            cap = CAPS[(parts[0], parts[2].split('.')[0])]['SML'.index(parts[1])] * 1000
            if parts[2].endswith('mp4'):
                cap *= {'av1': 1, 'hevc': 1.25, 'h264': 1.7}[parts[2].split('.')[1]]
            report['files'][rel] = {'bytes': len(data), 'cap': int(cap)}
            if len(data) > cap:
                report['over_cap'].append(rel)
    fb = os.path.join(ENC, 'hero', 'M', 'rest.webp')
    if os.path.exists(fb):
        shutil.copyfile(fb, os.path.join(WEB, 'hero', 'M', 'rest.webp'))
        keep.add(os.path.normpath(os.path.join(WEB, 'hero', 'M', 'rest.webp')))
    man['files'] = files
    man['probe'] = 'data:video/mp4;base64,' + base64.b64encode(open(os.path.join(ENC, 'probe.mp4'), 'rb').read()).decode()
    man['fallback'] = 'hero/M/rest.webp'
    man['build'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    json.dump(man, open(os.path.join(WEB, 'manifest.json'), 'w'), indent=1)
    keep.add(os.path.normpath(os.path.join(WEB, 'manifest.json')))
    for p in glob.glob(os.path.join(WEB, '**', '*.*'), recursive=True):
        if os.path.normpath(p) not in keep:
            os.remove(p)
    report['decode'] = decode_check(man)
    os.makedirs(QA, exist_ok=True)
    json.dump(report, open(os.path.join(QA, 'encode_report.json'), 'w'), indent=1)
    log('finalize: %d files, over cap: %s' % (len(files), report['over_cap'] or 'none'))


if __name__ == '__main__':
    stage_pack() if arg('--stage', 'pack') == 'pack' else stage_finalize()
