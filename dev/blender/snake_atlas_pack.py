"""
ae studio - pack the cells rendered by snake_atlas.py into the canvas snake's atlases.

    python blender/snake_atlas_pack.py [CELLS_DIR] [SITE_SNAKE_DIR]
        CELLS_DIR       default C:/Users/vladk/ae-studio/renders/atlas
        SITE_SNAKE_DIR  default C:/Users/vladk/ae-studio/landing/assets/img/snake

Writes body.webp (7 rows x 16 angles), head.webp (32 lighting cells), cap.webp and manifest.json in the format
assets/js/snake.js reads (see the manifest notes). Needs numpy + Pillow.
"""
import glob, hashlib, json, math, os, sys
import numpy as np
from PIL import Image

CELLS = sys.argv[1] if len(sys.argv) > 1 else r'C:\Users\vladk\ae-studio\renders\atlas'
SITE = sys.argv[2] if len(sys.argv) > 2 else r'C:\Users\vladk\ae-studio\landing\assets\img\snake'
INFO = json.load(open(os.path.join(CELLS, 'info.json')))
SS, R = INFO['ss'], 64
BODY_CELL = 216
ALONG, FEATHER = 0.62, 0.16
NECK_FADE = (-1.0, -1.5)   # nominal (manifest); the real cut is the round back below
HEAD_K = 0.90              # head drawn smaller: its fur edge sits ~1.5 R, just over the body's 1.3 R
NECK_W = 1.42              # half-width of the head where it meets the neck (the body's fur edge is 1.3 R)
BACK = (1.7, 1.9, 0.22)    # back of the head = soft half-ellipse about the head point (R along, R across, edge):
                           # a straight cut left corners poking past the neck when the head turned
Q = int(os.environ.get('ATLAS_Q', 80))


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def load_premult(path):
    a = np.asarray(Image.open(path).convert('RGBA'), np.float32) / 255
    a[..., :3] *= a[..., 3:]
    return a


def rotate(a, deg_cw):
    """rotate a premultiplied float image clockwise on screen about its centre (bicubic)"""
    if deg_cw % 360 == 0:
        return a
    ch = [Image.fromarray(a[..., i], 'F').rotate(-deg_cw, resample=Image.BICUBIC) for i in range(4)]
    return np.clip(np.stack([np.asarray(c) for c in ch], -1), 0, 1)


def down(a, k):
    h, w = a.shape[0] // k, a.shape[1] // k
    return a[:h * k, :w * k].reshape(h, k, w, k, 4).mean((1, 3))


def straight(a):
    o = a.copy()
    al = np.maximum(o[..., 3:], 1e-4)
    o[..., :3] = np.clip(o[..., :3] / al, 0, 1)
    o[o[..., 3] < 1 / 510, :3] = 0
    return (o * 255 + 0.5).astype(np.uint8)


def crop_centre(a, size):
    y0, x0 = (a.shape[0] - size) // 2, (a.shape[1] - size) // 2
    return a[y0:y0 + size, x0:x0 + size]


def blur(a, sig):
    """~gaussian: three box blurs (edge-padded), per channel"""
    r = max(int(round(sig * 0.87)), 1)
    for ax in (0, 1):
        for _ in range(3):
            pad = [(0, 0)] * a.ndim; pad[ax] = (r + 1, r)
            c = np.cumsum(np.pad(a, pad, mode='edge'), axis=ax, dtype=np.float64)
            n = a.shape[ax]
            a = ((np.take(c, range(2 * r + 1, 2 * r + 1 + n), axis=ax) - np.take(c, range(0, n), axis=ax)) / (2 * r + 1)).astype(np.float32)
    return a


def even_light(names, sym=False):
    """one cell whose colour never changes as the snake turns: the fur detail of the first render, its large-scale
    shading replaced by the mean over every light direction (sym: also mirrored across the body axis)"""
    ims = [load_premult(os.path.join(CELLS, n)) for n in names]
    a = ims[0]
    m = np.mean(ims, 0)
    if sym:
        m = (m + m[::-1]) / 2
    sig = 0.22 * R * SS
    out = a.copy()
    out[..., :3] = np.minimum(a[..., :3] * blur(m[..., :3], sig) / np.maximum(blur(a[..., :3], sig), 1e-4), a[..., 3:])
    return out


def body_cell(i, k, n):
    ang = 0.0
    a = crop_centre(even_light(['body_%d_%02d.png' % (i, q) for q in range(INFO['body_angles'])], sym=True), BODY_CELL * SS)
    s = BODY_CELL * SS
    y, x = np.mgrid[0:s, 0:s]
    x = (x + 0.5 - s / 2) / (R * SS); y = (y + 0.5 - s / 2) / (R * SS)
    al = np.abs(x * math.cos(ang) + y * math.sin(ang))
    ac = np.abs(-x * math.sin(ang) + y * math.cos(ang))
    e = ALONG * np.maximum(0, 1 - (ac / 1.5) ** 4) ** 0.25
    return down(a * (1 - sstep(e - FEATHER, e + FEATHER, al))[..., None], SS)


def main():
    os.makedirs(SITE, exist_ok=True)
    kinds, nb, nh = INFO['kinds'], 1, 1
    body = np.zeros((len(kinds) * BODY_CELL, nb * BODY_CELL, 4), np.float32)
    for i in range(len(kinds)):
        for k in range(nb):
            body[i * BODY_CELL:(i + 1) * BODY_CELL, k * BODY_CELL:(k + 1) * BODY_CELL] = body_cell(i, k, nb)
    Image.fromarray(straight(body), 'RGBA').save(os.path.join(SITE, 'body.webp'), quality=Q, method=6)

    hw0, hh0 = INFO['head_cell']; ox0, oy0 = INFO['head_origin']
    hw, hh = int(round(hw0 * HEAD_K)), int(round(hh0 * HEAD_K)); ox, oy = ox0 * hw / hw0, oy0 * hh / hh0
    cols = 1
    head = np.zeros((math.ceil(nh / cols) * hh, cols * hw, 4), np.float32)
    yy, xx = np.mgrid[0:hh, 0:hw]
    xr = (xx + 0.5 - ox) / R; yr = (yy + 0.5 - oy) / R
    d = np.hypot(np.minimum(xr, 0) / BACK[0], yr / BACK[1])
    # the head narrows to the body's width toward the neck (an egg): no shoulder above the collar ring
    lim = NECK_W + (1.75 - NECK_W) * sstep(-1.1, -0.2, xr)
    fade = ((1 - sstep(1 - BACK[2], 1, d)) * (1 - sstep(lim - 0.18, lim + 0.06, np.abs(yr))))[..., None]
    for b in range(nh):
        a = down(even_light(['head_%02d.png' % q for q in range(INFO['head_buckets'])], sym=True)[::-1, ::-1], SS)   # turned by 180 deg
        # the head is never mirrored by the engine, so it must read the same whichever way it points: the bead eye
        # is moved onto the head axis and the silhouette made symmetric about it (no "upside down" heading left)
        dark = (a[..., :3].sum(-1) < 0.6) & (a[..., 3] > 0.95)
        ey = int(round(np.nonzero(dark)[0].mean() - (oy0 - 0.5))) if dark.sum() > 20 else 0
        a = np.roll(a, -ey, 0)
        if ey > 0: a[-ey:] = 0
        elif ey < 0: a[:-ey] = 0
        mir = a[::-1][..., 3]
        a = a * (np.minimum(a[..., 3], mir) / np.maximum(a[..., 3], 1e-4))[..., None]
        print('head: eye moved by', -ey, 'px onto the axis')
        a = np.clip(np.stack([np.asarray(Image.fromarray(a[..., i], 'F').resize((hw, hh), Image.LANCZOS)) for i in range(4)], -1), 0, 1) * fade
        r, c = divmod(b, cols)
        head[r * hh:(r + 1) * hh, c * hw:(c + 1) * hw] = a
    Image.fromarray(straight(head), 'RGBA').save(os.path.join(SITE, 'head.webp'), quality=Q, method=6)

    # tail-tip ball: a round patch of the pink fur, shaded toward its rim
    src = down(crop_centre(even_light(['body_0_%02d.png' % q for q in range(INFO['body_angles'])], sym=True), 120 * SS), SS)
    y, x = np.mgrid[0:120, 0:120]
    rr = np.hypot(x + 0.5 - 60, y + 0.5 - 60)
    cap = src * (1 - sstep(30, 47, rr))[..., None]
    cap[..., :3] *= (1 - 0.22 * np.clip(rr / 47, 0, 1) ** 2)[..., None]
    Image.fromarray(straight(cap), 'RGBA').save(os.path.join(SITE, 'cap.webp'), quality=Q, method=6)

    k_r, nose = INFO['k_r'], INFO['nose_ext']
    d2r = 2 * k_r * HEAD_K                                           # D -> engine R
    sizes = {n: os.path.getsize(os.path.join(SITE, n + '.webp')) for n in ('body', 'head', 'cap')}
    # content-hashed file names: a browser can never pair a cached old image with the new manifest
    names = {}
    for n in ('body', 'head', 'cap'):
        src = os.path.join(SITE, n + '.webp')
        for old in glob.glob(os.path.join(SITE, n + '.*.webp')):
            os.remove(old)
        names[n] = '%s.%s.webp' % (n, hashlib.sha1(open(src, 'rb').read()).hexdigest()[:8])
        os.replace(src, os.path.join(SITE, names[n]))
    man = {
        'version': 2,
        'generator': 'Blender 5.1 Cycles: the plush snake of blender/snake_scene.py; blender/snake_atlas.py + snake_atlas_pack.py',
        'ref_R': R, 'light_screen': [-0.42, -0.58, 0.7], 'fuzz': round(BODY_CELL / 2 / R - 1 - 0.05, 3),
        'engine_grade': False,
        'body': {
            'file': names['body'], 'angles': nb, 'cell': [BODY_CELL, BODY_CELL], 'origin': [BODY_CELL // 2, BODY_CELL // 2],
            'rows': [{'kind': k, 'variant': sum(1 for q in kinds[:i] if q == k)} for i, k in enumerate(kinds)],
            'oriented': True, 'mask': 'feather', 'along': ALONG, 'feather': FEATHER, 'recommended_step_R': 0.3,
            'fur_edge_R': k_r,
            'notes': 'column k is pre-rotated to screen angle k/angles*PI (body axis (cos, sin), y down) and lit by the '
                     'fixed hero lights; rotate by the residual. The body is seen from its back. Each cell is a window '
                     'cut from a rendered straight body: |along| <= along*R*(1-(|across|/1.5R)^4)^0.25 with a '
                     '+-feather*R cross-fade; the fur edge sits at fur_edge_R * R. Straight alpha.'},
        'head': {
            'version': 6, 'file': names['head'], 'buckets': nh, 'cols': cols, 'ref_R': R, 'rh_ref': R * 1.2,
            'head_scale': 1.2, 'cell': [hw, hh], 'origin': [round(ox, 2), round(oy, 2)], 'eyes': True, 'fade_baked': True, 'tongue': False,
            'neck_fade_R': list(NECK_FADE),
            'eye': {'per_bucket': [[1]] * 32,
                    'centres': [[round((INFO['head_s0'] - nose - 0.86) * d2r, 3), 0]]},
            'tongue_base_R': [round((INFO['head_s0'] - nose - 0.05) * d2r, 3), round(1.09 * HEAD_K, 3)],
            'shape': {'source': 'blender/snake_scene.py head_profile (head v6)',
                      'frame': 'units of R; x forward from the head point; cell image y: jaw toward -y, brow toward +y'},
            'notes': 'cell b at column b % cols, row floor(b / cols); head points +x (jaw toward -y), lit for heading '
                     'th = b/buckets*2PI by the fixed hero lights. Neck fade baked into alpha (x in neck_fade_R). '
                     'One bead eye baked. No tongue (engine draws it from tongue_base_R). Straight alpha.'},
        'cap': {'file': names['cap'], 'rc_ref': 40, 'cell': [120, 120], 'origin': [60, 60],
                'notes': 'round patch of the pink body fur (scale by rc/rc_ref).'},
        'bytes': dict(sizes, total=sum(sizes.values())),
    }
    json.dump(man, open(os.path.join(SITE, 'manifest.json'), 'w'), indent=1)
    print('wrote', SITE, man['bytes'])


if __name__ == '__main__':
    main()
