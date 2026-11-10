#!/usr/bin/env python3
# usage: python3 -I dev/snake3d-gauge-mock.py DIR   (DIR = a copy of assets/snake3d with the journey mock; replaces the gauge arrival with a mock of G1-left)
# Mock of the new gauge arrival (she comes from the top-left, crawls diagonally to the ring, coils). NOT a Blender render.
import subprocess, sys, json, math, os, numpy as np
from PIL import Image, ImageDraw
out = sys.argv[1]; k = 1/3; FW, FH = 3360, 2112; W, H = int(FW * k), int(FH * k); D = 156 * k; SS = 2
cx, cy, R = 2592 * k, 1440 * k, 520 * k
def bez(p0, p1, p2, p3, n=400):
    t = np.linspace(0, 1, n)[:, None]
    return (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3
P0 = np.array([720 * k, -2 * D]); a0 = math.radians(240); Lp = np.array([cx + R * math.cos(a0), cy + R * math.sin(a0)])
tq = np.array([-math.sin(a0), math.cos(a0)])                     # clockwise tangent at the coil start (upper-left of the ring)
seg1 = bez(P0, P0 + np.array([0.45, 1]) * 8 * D, Lp - tq * 4 * D, Lp)
th = np.radians(np.linspace(240, 645, 700)); seg2 = np.stack([cx + R * np.cos(th), cy + R * np.sin(th)], 1)   # one lap + 45 deg, head at 12:30
pre = P0[None] + np.array([-0.45, -1])[None] / math.hypot(0.45, 1) * np.linspace(40 * D, 0, 300)[:, None]   # straight run before the start (above the frame)
pts = np.concatenate([pre, seg1[1:], seg2[1:]])
seglen = np.hypot(*np.diff(pts, axis=0).T); arc = np.concatenate([[0], np.cumsum(seglen)])
s_start = arc[len(pre) - 1]; s_end = arc[-1]
def at(s):
    s = np.clip(s, 0, arc[-1]); x = np.interp(s, arc, pts[:, 0]); y = np.interp(s, arc, pts[:, 1]); return x, y
def sprite(rgb, r, spec=0.25):
    n = int(2 * r + 2); y, x = np.mgrid[0:n, 0:n] + 0.5 - n / 2
    d = np.hypot(x, y) / r; z = np.sqrt(np.clip(1 - d * d, 0, 1))
    Lv = np.array([-0.35, -0.45, 0.82]); Lv /= np.linalg.norm(Lv)
    nd = np.clip((x / r) * Lv[0] + (y / r) * Lv[1] + z * Lv[2], 0, 1)
    c = np.clip(np.array(rgb)[None, None] * (0.42 + 0.68 * nd)[..., None] + 255 * spec * nd[..., None] ** 24, 0, 255)
    return Image.fromarray(np.dstack([c, np.clip((1 - d) * r * 1.2, 0, 1) * 255]).astype(np.uint8), 'RGBA')
RR = 0.5 * D * SS; PINK, CREAM, INK, HEAD = (205, 112, 124), (246, 228, 176), (48, 36, 40), (232, 92, 112)
spr = {c: sprite(c, RR) for c in (PINK, CREAM, INK)}; head_s = sprite(HEAD, RR * 1.12, 0.35)
taper = [sprite(PINK, RR * f) for f in np.linspace(0.45, 1, 12)]
BL = 34.3 * D
def render(sh):
    im = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0)); s = sh - BL
    while s <= sh:
        x, y = at(s); u = sh - s
        if -D < x < W + D and -D < y < H + D:
            band = (u % (1.3 * D)) / (1.3 * D)
            sp = spr[PINK] if u < 0.9 * D or band < 0.6 else spr[INK] if (band < 0.66 or band > 0.95) else spr[CREAM]
            if u > BL - 3 * D: sp = taper[int(np.clip((BL - u) / (3 * D) * 11, 0, 11))]
            im.alpha_composite(sp, (int(x * SS - sp.width / 2), int(y * SS - sp.height / 2)))
        s += 0.6
    x, y = at(sh); x2, y2 = at(sh - 2); tx, ty = x - x2, y - y2; n = math.hypot(tx, ty) or 1; tx, ty = tx / n, ty / n
    hx, hy = x + tx * 0.25 * D, y + ty * 0.25 * D
    if -D < hx < W + D and -D < hy < H + D:
        im.alpha_composite(head_s, (int(hx * SS - head_s.width / 2), int(hy * SS - head_s.height / 2)))
        dr = ImageDraw.Draw(im); e = 0.28 * D * SS; er = 0.07 * D * SS
        for sg in (-1, 1):
            ex, ey = hx * SS + (-ty * sg) * e + tx * 0.15 * D * SS, hy * SS + (tx * sg) * e + ty * 0.15 * D * SS
            dr.ellipse([ex - er, ey - er, ex + er, ey + er], fill=(20, 14, 16, 255))
    return np.array(im.resize((W, H), Image.LANCZOS)).astype(np.float32), (hx / k, hy / k), (tx, ty)
N = 96; frames = []
for f in range(N):
    t = f / (N - 1); sh = s_start + (s_end - s_start) * (1 - (1 - t) ** 2.2)
    fr, eye, hd = render(sh); frames.append(fr)
frames[0][:] = 0
man = json.load(open(out + '/manifest.json')); G = 32
os.makedirs(out + '/gauge/S', exist_ok=True)
enc = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '%dx%d' % (W, 2 * H + G), '-r', '30', '-i', '-',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-crf', '22', '-preset', 'slow', '-an', '-color_primaries', 'bt709',
    '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', out + '/gauge/S/arrive.h264.mp4'], stdin=subprocess.PIPE)
for fr in frames:
    a = fr[..., 3:4] / 255; o = np.zeros((2 * H + G, W, 3), np.uint8)
    o[:H] = np.round(fr[..., :3] * a); o[H + G:] = np.round(a * 255).repeat(3, -1)
    pw = W // 16
    for i in range(16): o[H + 8:H + 16, i * pw:(W if i == 15 else (i + 1) * pw)] = round(255 * i / 15)
    qw = W // 4
    for j, c in enumerate(man['videoLayout']['patches']['rgb']): o[H + 20:H + 28, j * qw:(W if j == 3 else (j + 1) * qw)] = c
    enc.stdin.write(o.tobytes())
enc.stdin.close(); assert enc.wait() == 0
last = frames[-1].astype(np.uint8); Image.fromarray(last, 'RGBA').save(out + '/gauge/S/rest.png')
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', out + '/gauge/S/rest.png', '-c:v', 'libwebp', '-pix_fmt', 'bgra', '-quality', '86', out + '/gauge/S/rest.webp'], check=True)
os.remove(out + '/gauge/S/rest.png')
FR = [0, 0, FW, FH]; g = man['scenes']['gauge']
g.update(frame=[FW, FH], stage=FR, exit='top')
g['anchors'].update(ringCenter=[2592, 1440], eye=[round(eye[0]), round(eye[1])], snout=[round(eye[0] + hd[0] * 40), round(eye[1] + hd[1] * 40)],
                    headDir=[round(hd[0], 3), round(hd[1], 3)], tipX=round(min(0.85, max(0.55, (eye[0] - (2592 - 487.5)) / 975 + 0.1)), 3))
g['rest'] = {'still': {'file': 'rest.webp', 'rect': FR}, 'flow': None, 'breath': {'periodS': 3.6, 'amp': 0}}
g['clips']['arrive'].update(rect=FR)
for key in ['gauge/S/arrive.h264.mp4', 'gauge/S/rest.webp']:
    p = out + '/' + key; e = man['files'][key]; e['file'] = key; e['bytes'] = os.path.getsize(p)
    e['size'] = [W, 2 * H + G] if key.endswith('.mp4') else [W, H]
man['files'].pop('gauge/flow.png', None)
json.dump(man, open(out + '/manifest.json', 'w'), indent=1, ensure_ascii=False)
print('ok eye', eye, 'dir', hd, 'tipX', g['anchors']['tipX'])
