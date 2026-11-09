#!/usr/bin/env python3
# usage: python3 -I dev/snake3d-journey-testclip.py DIR   (DIR = a copy of assets/snake3d; adds journey/S/journey.h264.mp4 + scenes.journey)
# QA-only synthetic journey clip (a banded tube on a sine path), NOT for shipping.
import subprocess, sys, json, math, numpy as np
from PIL import Image, ImageDraw
out = sys.argv[1]; k = 1/3; W, H = 160, 832; D = 156 * k; SS = 2
lam, amp = 5.2 * D, 0.55 * D
def xpath(yw): return W / 2 + amp * math.sin(2 * math.pi * yw / lam)
frames = []
cruise = 0.62 * H
for f in range(196):
    if f < 64: cam = 0; head = -D + (cruise + D) * f / 63
    elif f < 124: cam = 2 * lam * (f - 64) / 60; head = cruise + cam
    else: cam = 2 * lam; t = (f - 124) / 71; head = cruise + cam + 41 * D * t * t
    im = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 0)); dr = ImageDraw.Draw(im)
    L = 34.3 * D; s = 0.0
    while s < L:
        yw = head - s; ys = (yw - cam); x = xpath(yw)
        band = (s % (1.3 * D)) / (1.3 * D)
        col = (196, 105, 116) if band < 0.62 else ((30, 22, 24) if band < 0.68 or band > 0.94 else (244, 225, 170))
        r = 0.5 * D * (0.75 if s > L - 3 * D else 1)
        if -r < ys < H + r: dr.ellipse([(x - r) * SS, (ys - r) * SS, (x + r) * SS, (ys + r) * SS], fill=col + (255,))
        s += 1.5
    if f == 0 or f == 195: im = Image.new('RGBA', im.size, (0, 0, 0, 0))
    frames.append(np.array(im.resize((W, H), Image.LANCZOS)).astype(np.float32))
G = 32
enc = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '%dx%d' % (W, 2 * H + G), '-r', '30', '-i', '-',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p', '-c:v', 'libx264', '-crf', '26', '-g', '1', '-x264-params', 'keyint=1:scenecut=0',
    '-an', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-movflags', '+faststart', out + '/journey/S/journey.h264.mp4'], stdin=subprocess.PIPE)
for fr in frames:
    a = fr[..., 3:4] / 255; o = np.zeros((2 * H + G, W, 3), np.uint8)
    o[:H] = np.round(fr[..., :3] * a); o[H + G:] = np.round(a * 255).repeat(3, -1)
    pw = W // 16
    for i in range(16): o[H + 8:H + 16, i * pw:(W if i == 15 else (i + 1) * pw)] = round(255 * i / 15)
    qw = W // 4
    for j, c in enumerate(json.load(open(out + '/manifest.json'))['videoLayout']['patches']['rgb']): o[H + 20:H + 28, j * qw:(W if j == 3 else (j + 1) * qw)] = c
    enc.stdin.write(o.tobytes())
enc.stdin.close(); enc.wait()
import os
m = json.load(open(out + '/manifest.json'))
m['scenes']['journey'] = {'frame': [480, 2496], 'camera': {'name': 'CamJourney', 'type': 'ortho'}, 'stage': [0, 0, 480, 2496], 'exit': 'bottom',
    'clips': {'journey': {'frames': 196, 'rect': [0, 0, 480, 2496], 'from': 'empty', 'to': 'empty', 'segments': {'in': [0, 64], 'loop': [64, 124], 'out': [124, 196]}, 'intra': True}}}
m['files']['journey/S/journey.h264.mp4'] = {'file': 'journey/S/journey.h264.mp4', 'bytes': os.path.getsize(out + '/journey/S/journey.h264.mp4'), 'codec': 'avc1.64001F', 'size': [W, 2 * H + G], 'frames': 196}
json.dump(m, open(out + '/manifest.json', 'w'), indent=1)
print('ok', os.path.getsize(out + '/journey/S/journey.h264.mp4'))
