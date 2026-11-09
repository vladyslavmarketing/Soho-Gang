#!/usr/bin/env python3
"""Interim snake3d delivery from the Blender session's animatics (fur-less drafts, 704x448 on a flat background).

    python3 -I dev/snake3d-animatic-pack.py ANIM_DIR OUT_DIR     # ANIM_DIR: hero_intro.mp4 hero_depart.mp4 gauge_arrive.mp4
                                                                 # (blender/renders/motion/*_animatic.mp4, branch claude/snake-blender)

The animatics show CamHero / CamGauge over the full 1408x896 frame at half size, so 1 animatic px = 3 master px and the
shipped tier is S = 1/3. Background and floor shadow are keyed out against an empty frame (intro frame 0, arrive frame 0):
  hero (light paper):  a pixel is background or shadow when it is the plate scaled by one factor k in [0.55, 1.03]
                       (same chroma, only darker); body pink / cream deviate in chroma, black bands are darker than 0.45.
  gauge (dark floor):  snake = brighter than the plate (shadow is darker and drops out).
Writes stacked-alpha H.264 clips with a real grey strip + colour patches, rest stills (last frames), a breath flow map
(outward normal of the blurred silhouette) and manifest.json in the ae-snake3d/1 schema.
"""
import base64, json, os, subprocess, sys, hashlib
import numpy as np
from PIL import Image, ImageFilter

A_DIR, OUT = sys.argv[1], sys.argv[2]
W, H, K = 704, 448, 1 / 3            # animatic px; tier factor (tier px per master px)
GUT = 32                             # 96 master px gutter at k = 1/3
STRIP_Y, STRIP_H, PATCH_Y, PATCH_H = 8, 8, 20, 8


def frames(name):
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', os.path.join(A_DIR, name), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3).astype(np.float32)


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def key_hero(p, plate):
    r = p / np.maximum(plate, 1)
    m = r.mean(-1)
    dev = np.abs(r - m[..., None]).max(-1)
    a = np.maximum.reduce([sstep(0.05, 0.13, dev), 1 - sstep(0.40, 0.55, m), sstep(1.04, 1.10, m)])
    return clean(a)


def key_gauge(p, plate):
    return clean(sstep(8, 30, (p - plate).max(-1)))


def clean(a):
    """drop isolated specks (codec noise): open the >0.5 mask by 1 px and keep alpha only near it"""
    m = Image.fromarray((a > 0.5).astype(np.uint8) * 255)
    m = m.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MaxFilter(5))
    return a * (np.array(m) > 0)


def encode(frames_iter, path, n):
    enc = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '%dx%d' % (W, 2 * H + GUT), '-r', '30', '-i', '-',
                            '-vf', 'scale=out_color_matrix=bt709:out_range=tv:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv420p',
                            '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-profile:v', 'high', '-refs', '4', '-g', '300', '-bf', '2',
                            '-x264-params', 'scenecut=0', '-an', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
                            '-color_range', 'tv', '-movflags', '+faststart', path], stdin=subprocess.PIPE)
    for fr in frames_iter:
        enc.stdin.write(fr.tobytes())
    enc.stdin.close()
    assert enc.wait() == 0


def gutter(pink):
    g = np.zeros((GUT, W, 3), np.uint8)
    pw = W // 16
    for i in range(16):
        g[STRIP_Y:STRIP_Y + STRIP_H, i * pw:(W if i == 15 else (i + 1) * pw)] = round(255 * i / 15)
    qw = W // 4
    for j, c in enumerate([pink, (241, 214, 218), (191, 0, 0), (0, 0, 191)]):
        g[PATCH_Y:PATCH_Y + PATCH_H, j * qw:(W if j == 3 else (j + 1) * qw)] = c
    return g


def stacked(p, a, gut):
    out = np.empty((2 * H + GUT, W, 3), np.uint8)
    out[:H] = np.round(np.clip(p * a[..., None], 0, 255))
    out[H:H + GUT] = gut
    out[H + GUT:] = np.round(a * 255)[..., None]
    return out


def still(p, a, path):
    rgba = np.dstack([np.clip(p, 0, 255), np.round(a * 255)]).astype(np.uint8)
    rgba[a <= 0] = 0
    Image.fromarray(rgba, 'RGBA').save(path + '.png')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', path + '.png', '-c:v', 'libwebp', '-pix_fmt', 'bgra', '-quality', '86', path], check=True)
    os.remove(path + '.png')


def flow(a, path, d_px=52):
    """breath: outward normal of the blurred silhouette, max 6 master px; stored at quarter master over the stage"""
    b = np.array(Image.fromarray(np.uint8(a * 255)).filter(ImageFilter.GaussianBlur(d_px * 0.22))).astype(np.float32) / 255
    gy, gx = np.gradient(b)
    mag = np.hypot(gx, gy)
    s = 6.0 / max(mag.max(), 1e-6)                    # master px at breath = +1
    fx, fy = -gx * s, -gy * s
    big = lambda f: np.array(Image.fromarray(f.astype(np.float32), 'F').resize((W * 3 // 4, H * 3 // 4), Image.BILINEAR))
    fx, fy = big(fx), big(fy)
    rgb = np.zeros(fx.shape + (3,), np.uint8)
    rgb[..., 0] = np.clip(np.round(128 + 32 * fx), 0, 255)
    rgb[..., 1] = np.clip(np.round(128 + 32 * fy), 0, 255)
    Image.fromarray(rgb, 'RGB').save(path)


def bbox(m):
    ys, xs = np.where(m)
    return [int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)]


def main():
    I, D, G = frames('hero_intro.mp4'), frames('hero_depart.mp4'), frames('gauge_arrive.mp4')
    hp, gp = I[0], G[0]
    os.makedirs(OUT + '/hero/S', exist_ok=True); os.makedirs(OUT + '/gauge/S', exist_ok=True)
    m3 = lambda v: [int(round(x * 3)) for x in v]

    # hero
    ha = [key_hero(f, hp) for f in I]
    da = [key_hero(f, hp) for f in D]
    rest_a = ha[-1]
    body = rest_a >= 0.5
    pink = tuple(int(v) for v in np.median(I[-1][body & (I[-1][..., 0] > I[-1][..., 1] + 40)], 0))
    gut = gutter(pink)
    encode((stacked(f, a, gut) for f, a in zip(I, ha)), OUT + '/hero/S/intro.h264.mp4', len(I))
    encode((stacked(f, a, gut) for f, a in zip(D, da)), OUT + '/hero/S/depart.h264.mp4', len(D))
    encode((stacked(f, a, gut) for f, a in zip(D[::-1], da[::-1])), OUT + '/hero/S/depart-rev.h264.mp4', len(D))
    still(I[-1], rest_a, OUT + '/hero/S/rest.webp')
    flow(rest_a, OUT + '/hero/flow.png')
    # anchors on the rest frame (animatic px -> master px)
    cols = body.sum(0)
    xs = np.where(cols > 0)[0]
    # the «e» loop ends where the column count drops to a single body thickness (the tail)
    thick = np.median(cols[cols > 0][-80:])
    end = next((x for x in range(int(xs.min()) + 120, W) if cols[x] <= thick * 1.25 and all(cols[x:x + 20] <= thick * 1.25)), W - 1)
    ae = bbox(body[:, :end])
    left = body[:, :ae[0] + 60]
    hy = np.where(left.any(1))[0]
    head_rows = [y for y in hy if y < ae[1] + ae[3] * 0.45]
    sn_y = int(np.median([y for y in head_rows if body[y, :ae[0] + 60].any() and np.where(body[y])[0].min() <= ae[0] + 3] or head_rows))
    snout = [ae[0], sn_y]
    eye = [ae[0] + 0.55 * thick, sn_y - 0.2 * thick]
    # gauge
    ga = [key_gauge(f, gp) for f in G]
    g_rest = ga[-1]
    gb = g_rest >= 0.5
    gpink = tuple(int(v) for v in np.median(G[-1][gb & (G[-1][..., 0] > G[-1][..., 1] + 30)], 0))
    ggut = gut                       # videoLayout.patches is global: the same patches in every clip
    encode((stacked(f, a, ggut) for f, a in zip(G, ga)), OUT + '/gauge/S/arrive.h264.mp4', len(G))
    still(G[-1], g_rest, OUT + '/gauge/S/rest.webp')
    flow(g_rest, OUT + '/gauge/flow.png')
    # gauge head = the brightest-pink blob near 12 o'clock: the topmost body pixels right of the ring centre
    cx, cy = 240, 224
    ys, xs2 = np.where(gb)
    top = [(x, y) for x, y in zip(xs2, ys) if x > cx - 10 and x < cx + 140 and y < cy - 100]
    hx = float(np.mean([x for x, y in top])); hyy = float(min(y for x, y in top)) + 0.5 * 52 / 3 * 1.0
    g_eye = [hx, hyy]

    probe = OUT + '/probe.mp4'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=16x16:r=30', '-frames:v', '1', '-c:v', 'libx264', '-profile:v',
                    'baseline', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', probe], check=True)
    probe_uri = 'data:video/mp4;base64,' + base64.b64encode(open(probe, 'rb').read()).decode()
    os.remove(probe)

    FR = [0, 0, 2112, 1344]
    ring_c, ring_r = [720, 672], 390
    tipX = min(0.85, max(0.55, (g_eye[0] * 3 - (ring_c[0] - 487.5)) / 975 + 0.10))
    files = {}

    def add(key, path, **kw):
        full = os.path.join(OUT, path)
        e = {'file': path, 'bytes': os.path.getsize(full)}
        if path.endswith('.mp4'):
            e.update(codec='avc1.64001F', size=[W, 2 * H + GUT], frames=kw['frames'])
        elif path.endswith(('.webp', '.png')):
            e['size'] = list(Image.open(full).size)
        files[key] = e
    for sc, clips in (('hero', [('intro', len(I)), ('depart', len(D)), ('depart-rev', len(D))]), ('gauge', [('arrive', len(G))])):
        for c, n in clips:
            add('%s/S/%s.h264.mp4' % (sc, c), '%s/S/%s.h264.mp4' % (sc, c), frames=n)
        add(sc + '/S/rest.webp', sc + '/S/rest.webp')
        add(sc + '/flow.png', sc + '/flow.png')

    rest = lambda sc: {'still': {'file': 'rest.webp', 'rect': FR}, 'flow': {'file': 'flow.png', 'rect': FR, 'fileScale': 0.25, 'zero': 128, 'pxPerUnit': 32},
                       'breath': {'periodS': 3.6, 'amp': 0.8}}
    vl = {'gutter': 96, 'strip': {'y': 24, 'h': 24, 'steps': 16}, 'patches': {'y': 60, 'h': 24, 'rgb': [list(pink), [241, 214, 218], [191, 0, 0], [0, 0, 191]]},
          'premultiplied': True, 'matrix': 'bt709', 'range': 'tv'}
    man = {
        'schema': 'ae-snake3d/1', 'build': subprocess.run(['date', '-u', '+%Y-%m-%dT%H:%M:%SZ'], capture_output=True, text=True).stdout.strip(),
        'generator': 'dev/snake3d-animatic-pack.py from the Blender animatics (interim, fur-less drafts; background and shadow keyed out)',
        'fps': 30, 'pxPerD': 156, 'tiers': {'S': K}, 'clipRenderScale': K, 'clipTiers': ['S'], 'videoLayout': vl, 'probe': probe_uri,
        'fallback': 'hero/S/rest.webp',
        'scenes': {
            'hero': {'frame': [2112, 1344], 'camera': {'name': 'CamHero', 'type': 'persp'}, 'stage': FR, 'exit': 'right',
                     'anchors': {'aeBox': m3(ae), 'eye': m3(eye), 'snout': m3(snout), 'headDir': [-0.97, -0.24]},
                     'rest': rest('hero'), 'look': None,
                     'clips': {'intro': {'frames': len(I), 'rect': FR, 'from': 'empty', 'to': 'rest', 'events': {'written': 70}},
                               'depart': {'frames': len(D), 'rect': FR, 'from': 'rest', 'to': 'empty', 'events': {'unwritten': 2}, 'reverse': 'depart-rev'},
                               'depart-rev': {'frames': len(D), 'rect': FR, 'from': 'empty', 'to': 'rest'}}},
            'gauge': {'frame': [2112, 1344], 'camera': {'name': 'CamGauge', 'type': 'ortho', 'orthoScaleD': 13.538}, 'stage': FR, 'exit': 'right',
                      'anchors': {'ringCenter': ring_c, 'ringRadius': ring_r, 'trackHalfWidth': 41, 'coilRadius': 520, 'coilOuterRadius': 598,
                                  'eye': m3(g_eye), 'snout': m3([g_eye[0] - 15, g_eye[1]]), 'headDir': [-0.966, -0.259], 'exitRamp': [1440, 1680],
                                  'tipX': round(tipX, 3)},
                      'rest': rest('gauge'), 'look': None,
                      'clips': {'arrive': {'frames': len(G), 'rect': FR, 'from': 'empty', 'to': 'rest', 'events': {'arrived': len(G) - 1}}}}},
        'files': files}
    json.dump(man, open(OUT + '/manifest.json', 'w'), indent=2, ensure_ascii=False)
    print('aeBox', m3(ae), 'eye', m3(eye), 'snout', m3(snout), 'gauge eye', m3(g_eye), 'tipX', round(tipX, 3), 'pink', pink, gpink)
    for k, v in files.items():
        print(k, v['bytes'])


main()
