#!/usr/bin/env python3
# usage: python3 -I dev/snake3d-journey-mock.py DIR   (DIR = a copy of assets/snake3d; adds a mock journey clip + scenes.journey for previews)
# Mock journey clip in the animatic style (shaded banded tube, top-down), for showing the user. NOT a Blender render.
import subprocess, sys, json, math, os, numpy as np
from PIL import Image, ImageDraw
out = sys.argv[1]; k = 1/3; W, H = 160, 832; D = 156 * k; SS = 2
lam, amp = 5.2 * D, 0.55 * D
def xpath(yw): return W / 2 + amp * math.sin(2 * math.pi * yw / lam)
def sprite(rgb, r, spec=0.25):
    n = int(2 * r + 2); y, x = np.mgrid[0:n, 0:n] + 0.5 - n / 2
    d = np.hypot(x, y) / r; z = np.sqrt(np.clip(1 - d * d, 0, 1))
    L = np.array([-0.35, -0.45, 0.82]); L /= np.linalg.norm(L)
    nd = np.clip((x / r) * L[0] + (y / r) * L[1] + z * L[2], 0, 1)
    sh = 0.42 + 0.68 * nd
    sp = spec * np.clip(nd, 0, 1) ** 24
    c = np.clip(np.array(rgb)[None, None] * sh[..., None] + 255 * sp[..., None], 0, 255)
    a = np.clip((1 - d) * r * 1.2, 0, 1) * 255
    return Image.fromarray(np.dstack([c, a]).astype(np.uint8), 'RGBA')
R = 0.5 * D * SS
PINK, CREAM, INK, HEAD = (205, 112, 124), (246, 228, 176), (48, 36, 40), (232, 92, 112)
spr = {c: sprite(c, R) for c in (PINK, CREAM, INK)}
taper = [sprite(PINK, R * f) for f in np.linspace(0.45, 1, 12)]
head_s = sprite(HEAD, R * 1.12, 0.35)
cruise = 0.62 * H
frames = []
for f in range(196):
    if f < 64: cam = 0; head = -D + (cruise + D) * (f / 63)
    elif f < 124: cam = 2 * lam * (f - 64) / 60; head = cruise + cam
    else: cam = 2 * lam; t = (f - 124) / 71; head = cruise + cam + 41 * D * t * t
    im = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0))
    L = 34.3 * D; pts = []
    s = L
    while s >= 0:
        yw = head - s; ys = yw - cam
        if -D < ys < H + D: pts.append((s, xpath(yw), ys))
        s -= 0.6
    for s, x, ys in pts:
        band = (s % (1.3 * D)) / (1.3 * D)
        if s < 0.9 * D: sp = spr[PINK]
        elif band < 0.6: sp = spr[PINK]
        elif band < 0.66 or band > 0.95: sp = spr[INK]
        else: sp = spr[CREAM]
        if s > L - 3 * D: sp = taper[int(np.clip((L - s) / (3 * D) * 11, 0, 11))]
        im.alpha_composite(sp, (int(x * SS - sp.width / 2), int(ys * SS - sp.height / 2)))
    if pts and pts[-1][0] < 1:
        _, x, ys = pts[-1]
        ys += 0.25 * D
        im.alpha_composite(head_s, (int(x * SS - head_s.width / 2), int(ys * SS - head_s.height / 2)))
        dr = ImageDraw.Draw(im); e = 0.28 * D * SS; er = 0.07 * D * SS
        for sx in (-1, 1):
            cx, cy = x * SS + sx * e, ys * SS + 0.15 * D * SS
            dr.ellipse([cx - er, cy - er, cx + er, cy + er], fill=(20, 14, 16, 255))
    if f in (0, 195): im = Image.new('RGBA', im.size, (0, 0, 0, 0))
    frames.append(np.array(im.resize((W, H), Image.LANCZOS)).astype(np.float32))
G = 32
man = json.load(open(out + '/manifest.json'))
os.makedirs(out + '/journey/S', exist_ok=True)
enc = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '%dx%d' % (W, 2 * H + G), '-r', '30', '-i', '-',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-crf', '24', '-g', '1', '-x264-params', 'keyint=1:scenecut=0',
    '-an', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', out + '/journey/S/journey.h264.mp4'], stdin=subprocess.PIPE)
for fr in frames:
    a = fr[..., 3:4] / 255; o = np.zeros((2 * H + G, W, 3), np.uint8)
    o[:H] = np.round(fr[..., :3] * a); o[H + G:] = np.round(a * 255).repeat(3, -1)
    pw = W // 16
    for i in range(16): o[H + 8:H + 16, i * pw:(W if i == 15 else (i + 1) * pw)] = round(255 * i / 15)
    qw = W // 4
    for j, c in enumerate(man['videoLayout']['patches']['rgb']): o[H + 20:H + 28, j * qw:(W if j == 3 else (j + 1) * qw)] = c
    enc.stdin.write(o.tobytes())
enc.stdin.close(); assert enc.wait() == 0
Image.fromarray(frames[90].astype(np.uint8), 'RGBA').save(out + '/mock90.png')
man['scenes']['journey'] = {'frame': [480, 2496], 'camera': {'name': 'mock', 'type': 'ortho'}, 'stage': [0, 0, 480, 2496], 'exit': 'bottom',
    'clips': {'journey': {'frames': 196, 'rect': [0, 0, 480, 2496], 'from': 'empty', 'to': 'empty', 'segments': {'in': [0, 64], 'loop': [64, 124], 'out': [124, 196]}, 'intra': True}}}
man['files']['journey/S/journey.h264.mp4'] = {'file': 'journey/S/journey.h264.mp4', 'bytes': os.path.getsize(out + '/journey/S/journey.h264.mp4'), 'codec': 'avc1.64001F', 'size': [W, 2 * H + G], 'frames': 196}
json.dump(man, open(out + '/manifest.json', 'w'), indent=1, ensure_ascii=False)
print('ok', os.path.getsize(out + '/journey/S/journey.h264.mp4'))
