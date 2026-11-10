#!/usr/bin/env python3
# usage: python3 -I dev/snake3d-journey-mock.py DIR   (DIR = a copy of assets/snake3d; adds a mock right-edge journey + scenes.journey for previews)
# Mock journey (right edge): enters from the right edge, turns down, crawls (seamless loop), turns right and leaves
# through the right edge with her whole body. NOT a Blender render.
import subprocess, sys, json, math, os, numpy as np
from PIL import Image, ImageDraw
out = sys.argv[1]; k = 1/3; FW, FH = 480, 2496; W, H = int(FW * k), int(FH * k); D = 156 * k; SS = 2
lam, amp, r = 5.2 * D, 0.55 * D, 1.0 * D
Xm = W / 2 - 0.25 * D                       # centre of the wave (a little left: the turns need room on the right)
y0 = 0.22 * H + r                           # top of the wave
BL = 34.3 * D; v0 = 2 * lam / 60            # loop speed, px per frame
def arc(cx, cy, a0, a1, n=120):
    t = np.radians(np.linspace(a0, a1, n)); return np.stack([cx + r * np.cos(t), cy + r * np.sin(t)], 1)
def build(y_turn):
    ent = np.stack([np.linspace(W + 45 * D, Xm + amp + r, 600), np.full(600, y0 - r)], 1)
    a1 = arc(Xm + amp + r, y0, -90, -180)                                       # heading left -> heading down
    ys = np.arange(y0, y_turn, 1.0); wav = np.stack([Xm + amp * np.cos(2 * np.pi * (ys - y0) / lam), ys], 1)
    a2 = arc(Xm + amp + r, y_turn, 180, 90)                                     # heading down -> heading right
    ex = np.stack([np.linspace(Xm + amp + r, W + 45 * D, 600), np.full(600, y_turn + r)], 1)
    p = np.concatenate([ent, a1[1:], wav[1:], a2[1:], ex[1:]]); L = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(p, axis=0).T))])
    return p, L
def sprite(rgb, rr, spec=0.25):
    n = int(2 * rr + 2); y, x = np.mgrid[0:n, 0:n] + 0.5 - n / 2
    d = np.hypot(x, y) / rr; z = np.sqrt(np.clip(1 - d * d, 0, 1))
    Lv = np.array([-0.35, -0.45, 0.82]); Lv /= np.linalg.norm(Lv)
    nd = np.clip((x / rr) * Lv[0] + (y / rr) * Lv[1] + z * Lv[2], 0, 1)
    c = np.clip(np.array(rgb)[None, None] * (0.42 + 0.68 * nd)[..., None] + 255 * spec * nd[..., None] ** 24, 0, 255)
    return Image.fromarray(np.dstack([c, np.clip((1 - d) * rr * 1.2, 0, 1) * 255]).astype(np.uint8), 'RGBA')
RR = 0.5 * D * SS; PINK, CREAM, INK, HEAD = (205, 112, 124), (246, 228, 176), (48, 36, 40), (232, 92, 112)
spr = {c: sprite(c, RR) for c in (PINK, CREAM, INK)}; head_s = sprite(HEAD, RR * 1.12, 0.35)
taper = [sprite(PINK, RR * f) for f in np.linspace(0.45, 1, 12)]
def render(p, L, sh, cam):
    at = lambda s: (np.interp(s, L, p[:, 0]), np.interp(s, L, p[:, 1]) - cam)
    im = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0)); s = sh - BL
    while s <= sh:
        x, y = at(s); u = sh - s
        if -D < x < W + D and -D < y < H + D:
            band = (u % BP) / BP
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
            ex_, ey_ = hx * SS + (-ty * sg) * e + tx * 0.15 * D * SS, hy * SS + (tx * sg) * e + ty * 0.15 * D * SS
            dr.ellipse([ex_ - er, ey_ - er, ex_ + er, ey_ + er], fill=(20, 14, 16, 255))
    return np.array(im.resize((W, H), Image.LANCZOS)).astype(np.float32)
cruise = 0.62 * H
# timeline: in A (56 f, camera still: head from off-screen right to the cruise point), in B (40 f, camera tracks),
# loop (60 f, camera tracks 2 lambda), out (96 f, camera still: down to the next crest, turn right, the whole body leaves)
NA, NB, NL, NO = 56, 40, 60, 96
pw, Lw = build(4 * H + 60 * D)
wv = np.arange(len(pw)) > 720                                   # the wave part of the path
def s_at(y): i = np.where(wv & (pw[:, 1] >= y))[0][0]; return Lw[i]
Llam = s_at(y0 + 3 * lam) - s_at(y0 + lam)                      # arc length of two wavelengths
BP = Llam / round(Llam / (1.3 * D))                              # band period that repeats every loop                           # path without an exit turn, for in + loop (long enough)
s_entry_vis = np.interp(W + D, pw[::-1, 0][:600][::-1], np.arange(600)[::-1][::-1]) if False else 0
s_cruise = np.interp(cruise, pw[:, 1], Lw) if False else None
# arc length at which the head reaches the cruise height on the wave (first time)
idx = np.where((pw[:, 1] >= cruise) & (np.arange(len(pw)) > 600))[0][0]; s_cr = Lw[idx]
s_start = Lw[np.where(pw[:600, 0] <= W + 0.7 * D)[0][0]]          # head just outside the right edge
frames = []
for f in range(NA): t = f / (NA - 1); sh = s_start - 1.2 * D + (s_cr - s_start + 1.2 * D) * (1 - (1 - t) ** 1.6); frames.append(('w', sh, 0))
for f in range(NB): frames.append(('w', s_at(cruise + v0 * (f + 1)), v0 * (f + 1)))
camL0 = v0 * NB; shL0 = s_at(cruise + camL0)
for f in range(NL): frames.append(('w', s_at(cruise + camL0 + v0 * f), camL0 + v0 * f))
# out: from the loop-start pose; turn at the next crest below the head
y_head = cruise + camL0; kk = math.ceil((y_head + 0.6 * D - y0) / lam); y_turn = y0 + kk * lam
po, Lo = build(y_turn)
s_turn_end = Lo[np.where(po[:, 1] >= y_turn + r - 1e-6)[0][0]]
s_out_end = s_turn_end + (W + 2 * D - (Xm + amp + r)) + BL                        # tail clears the right edge
for f in range(NO): t = f / (NO - 1); frames.append(('o', shL0 + (s_out_end - shL0) * (0.35 * t + 0.65 * t * t), camL0))
img = []
for kind, sh, cam in frames:
    p, L = (pw, Lw) if kind == 'w' else (po, Lo)
    img.append(render(p, L, sh, cam))
img[0][:] = 0; img[-1][:] = 0
N = len(img)
man = json.load(open(out + '/manifest.json')); G = 32
os.makedirs(out + '/journey/S', exist_ok=True)
enc = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '%dx%d' % (W, 2 * H + G), '-r', '30', '-i', '-',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-crf', '24', '-g', '1', '-x264-params', 'keyint=1:scenecut=0',
    '-an', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', out + '/journey/S/journey.h264.mp4'], stdin=subprocess.PIPE)
for fr in img:
    a = fr[..., 3:4] / 255; o = np.zeros((2 * H + G, W, 3), np.uint8)
    o[:H] = np.round(fr[..., :3] * a); o[H + G:] = np.round(a * 255).repeat(3, -1)
    pw_ = W // 16
    for i in range(16): o[H + 8:H + 16, i * pw_:(W if i == 15 else (i + 1) * pw_)] = round(255 * i / 15)
    qw = W // 4
    for j, c in enumerate(man['videoLayout']['patches']['rgb']): o[H + 20:H + 28, j * qw:(W if j == 3 else (j + 1) * qw)] = c
    enc.stdin.write(o.tobytes())
enc.stdin.close(); assert enc.wait() == 0
for i in (40, NA + NB + 10, NA + NB + NL + 40): Image.fromarray(img[i].astype(np.uint8), 'RGBA').save(out + '/jm%d.png' % i)
a_, b_ = NA + NB, NA + NB + NL
man['scenes']['journey'] = {'frame': [FW, FH], 'camera': {'name': 'mock', 'type': 'ortho'}, 'stage': [0, 0, FW, FH], 'exit': 'right',
    'clips': {'journey': {'frames': N, 'rect': [0, 0, FW, FH], 'from': 'empty', 'to': 'empty', 'cruiseY': round(cruise / k),
                          'bodyRight': round((W - (Xm + amp + 0.5 * D)) / k), 'segments': {'in': [0, a_], 'loop': [a_, b_], 'out': [b_, N]}, 'intra': True}}}
man['files']['journey/S/journey.h264.mp4'] = {'file': 'journey/S/journey.h264.mp4', 'bytes': os.path.getsize(out + '/journey/S/journey.h264.mp4'), 'codec': 'avc1.64001F', 'size': [W, 2 * H + G], 'frames': N}
json.dump(man, open(out + '/manifest.json', 'w'), indent=1, ensure_ascii=False)
print('ok frames', N, 'loop seam check', float(np.abs(img[a_] - render(pw, Lw, s_at(cruise + camL0 + v0 * NL), camL0 + v0 * NL)).mean()))
