"""
ae studio - pack the cells rendered by snake_atlas.py into the canvas snake's atlases.

    python blender/snake_atlas_pack.py [CELLS_DIR] [SITE_SNAKE_DIR]
        CELLS_DIR       default C:/Users/vladk/ae-studio/renders/atlas
        SITE_SNAKE_DIR  default C:/Users/vladk/ae-studio/landing/assets/img/snake

Writes body.webp (7 rows x 16 angles), head.webp (32 lighting cells), cap.webp and manifest.json in the format
assets/js/snake.js reads (see the manifest notes). Needs numpy + Pillow.
"""
import json, math, os, sys
import numpy as np
from PIL import Image

CELLS = sys.argv[1] if len(sys.argv) > 1 else r'C:\Users\vladk\ae-studio\renders\atlas'
SITE = sys.argv[2] if len(sys.argv) > 2 else r'C:\Users\vladk\ae-studio\landing\assets\img\snake'
INFO = json.load(open(os.path.join(CELLS, 'info.json')))
SS, R = INFO['ss'], 64
BODY_CELL = 216
ALONG, FEATHER = 0.62, 0.16
NECK_FADE = (-1.0, -1.8)
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


def body_cell(i, k, n):
    ang = k / n * math.pi
    a = crop_centre(rotate(load_premult(os.path.join(CELLS, 'body_%d_%02d.png' % (i, k))), math.degrees(ang)),
                    BODY_CELL * SS)
    s = BODY_CELL * SS
    y, x = np.mgrid[0:s, 0:s]
    x = (x + 0.5 - s / 2) / (R * SS); y = (y + 0.5 - s / 2) / (R * SS)
    al = np.abs(x * math.cos(ang) + y * math.sin(ang))
    ac = np.abs(-x * math.sin(ang) + y * math.cos(ang))
    e = ALONG * np.maximum(0, 1 - (ac / 1.5) ** 4) ** 0.25
    return down(a * (1 - sstep(e - FEATHER, e + FEATHER, al))[..., None], SS)


def main():
    os.makedirs(SITE, exist_ok=True)
    kinds, nb, nh = INFO['kinds'], INFO['body_angles'], INFO['head_buckets']
    body = np.zeros((len(kinds) * BODY_CELL, nb * BODY_CELL, 4), np.float32)
    for i in range(len(kinds)):
        for k in range(nb):
            body[i * BODY_CELL:(i + 1) * BODY_CELL, k * BODY_CELL:(k + 1) * BODY_CELL] = body_cell(i, k, nb)
    Image.fromarray(straight(body), 'RGBA').save(os.path.join(SITE, 'body.webp'), quality=Q, method=6)

    hw, hh = INFO['head_cell']; ox, oy = INFO['head_origin']
    cols = 8
    head = np.zeros((math.ceil(nh / cols) * hh, cols * hw, 4), np.float32)
    xr = (np.arange(hw) + 0.5 - ox) / R
    fade = sstep(NECK_FADE[1], NECK_FADE[0], xr)[None, :, None]
    for b in range(nh):
        a = down(load_premult(os.path.join(CELLS, 'head_%02d.png' % b))[::-1, ::-1], SS) * fade   # turned by 180 deg
        r, c = divmod(b, cols)
        head[r * hh:(r + 1) * hh, c * hw:(c + 1) * hw] = a
    Image.fromarray(straight(head), 'RGBA').save(os.path.join(SITE, 'head.webp'), quality=Q, method=6)

    # tail-tip ball: a round patch of the pink fur, shaded toward its rim
    src = down(crop_centre(load_premult(os.path.join(CELLS, 'body_0_00.png')), 120 * SS), SS)
    y, x = np.mgrid[0:120, 0:120]
    rr = np.hypot(x + 0.5 - 60, y + 0.5 - 60)
    cap = src * (1 - sstep(30, 47, rr))[..., None]
    cap[..., :3] *= (1 - 0.22 * np.clip(rr / 47, 0, 1) ** 2)[..., None]
    Image.fromarray(straight(cap), 'RGBA').save(os.path.join(SITE, 'cap.webp'), quality=Q, method=6)

    k_r, nose = INFO['k_r'], INFO['nose_ext']
    d2r = 2 * k_r                                           # D -> engine R
    sizes = {n: os.path.getsize(os.path.join(SITE, n + '.webp')) for n in ('body', 'head', 'cap')}
    man = {
        'version': 2,
        'generator': 'Blender 5.1 Cycles: the plush snake of blender/snake_scene.py; blender/snake_atlas.py + snake_atlas_pack.py',
        'ref_R': R, 'light_screen': [-0.42, -0.58, 0.7], 'fuzz': round(BODY_CELL / 2 / R - 1 - 0.05, 3),
        'engine_grade': False,
        'body': {
            'file': 'body.webp', 'angles': nb, 'cell': [BODY_CELL, BODY_CELL], 'origin': [BODY_CELL // 2, BODY_CELL // 2],
            'rows': [{'kind': k, 'variant': sum(1 for q in kinds[:i] if q == k)} for i, k in enumerate(kinds)],
            'oriented': True, 'mask': 'feather', 'along': ALONG, 'feather': FEATHER, 'recommended_step_R': 0.3,
            'fur_edge_R': k_r,
            'notes': 'column k is pre-rotated to screen angle k/angles*PI (body axis (cos, sin), y down) and lit by the '
                     'fixed hero lights; rotate by the residual. The body is seen from its back. Each cell is a window '
                     'cut from a rendered straight body: |along| <= along*R*(1-(|across|/1.5R)^4)^0.25 with a '
                     '+-feather*R cross-fade; the fur edge sits at fur_edge_R * R. Straight alpha.'},
        'head': {
            'version': 6, 'file': 'head.webp', 'buckets': nh, 'cols': cols, 'ref_R': R, 'rh_ref': R * 1.2,
            'head_scale': 1.2, 'cell': [hw, hh], 'origin': [ox, oy], 'eyes': True, 'fade_baked': True, 'tongue': False,
            'neck_fade_R': list(NECK_FADE),
            'eye': {'per_bucket': [[1]] * nh,
                    'centres': [[round((INFO['head_s0'] - nose - 0.86) * d2r, 3), round(-0.05 * d2r, 3)]]},
            'tongue_base_R': [round((INFO['head_s0'] - nose - 0.05) * d2r, 3), 1.09],
            'shape': {'source': 'blender/snake_scene.py head_profile (head v6)',
                      'frame': 'units of R; x forward from the head point; cell image y: jaw toward -y, brow toward +y'},
            'notes': 'cell b at column b % cols, row floor(b / cols); head points +x (jaw toward -y), lit for heading '
                     'th = b/buckets*2PI by the fixed hero lights. Neck fade baked into alpha (x in neck_fade_R). '
                     'One bead eye baked. No tongue (engine draws it from tongue_base_R). Straight alpha.'},
        'cap': {'file': 'cap.webp', 'rc_ref': 40, 'cell': [120, 120], 'origin': [60, 60],
                'notes': 'round patch of the pink body fur (scale by rc/rc_ref).'},
        'bytes': dict(sizes, total=sum(sizes.values())),
    }
    json.dump(man, open(os.path.join(SITE, 'manifest.json'), 'w'), indent=1)
    print('wrote', SITE, man['bytes'])


if __name__ == '__main__':
    main()
