#!/usr/bin/env python3
# usage: python3 dev/snake3d-noshadow.py snake_idle.webm OUT_DIR   (then: ffmpeg -i OUT_DIR/rest.png -c:v libwebp -pix_fmt bgra -quality 82 OUT_DIR/rest.webp)
# Strip the floor shadow from the placeholder and rebuild the stacked-alpha clip + rest still.
# keep = fur core (alpha>=250) dilated 3 px  OR  coloured pixels (straight max rgb >= 40); shadow is near-black.
import subprocess, sys, numpy as np
from PIL import Image, ImageFilter
src, outdir = sys.argv[1], sys.argv[2]
W, H = 1280, 720
dec = subprocess.Popen(['ffmpeg', '-loglevel', 'error', '-c:v', 'libvpx-vp9', '-i', src, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], stdout=subprocess.PIPE)
enc = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '%dx%d' % (W, 2 * H + 96), '-r', '30', '-i', '-',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv420p',
    '-c:v', 'libx264', '-crf', '20', '-preset', 'slow', '-an', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
    '-movflags', '+faststart', outdir + '/placeholder.h264.mp4'], stdin=subprocess.PIPE)
n = 0
while True:
    buf = dec.stdout.read(W * H * 4)
    if len(buf) < W * H * 4: break
    f = np.frombuffer(buf, np.uint8).reshape(H, W, 4).astype(np.float32)
    a = f[..., 3]
    core = Image.fromarray(((a >= 250) * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(7))
    keep = (np.array(core) > 0) | (f[..., :3].max(-1) >= 40)
    a = np.where(keep, a, 0)
    P = f[..., :3] * (a[..., None] / 255)
    fr = np.zeros((2 * H + 96, W, 3), np.uint8)
    fr[:H] = np.round(P).astype(np.uint8)
    fr[H + 96:] = np.round(a).astype(np.uint8)[..., None]
    enc.stdin.write(fr.tobytes())
    if n == 0:
        rgba = np.dstack([f[..., :3], a]).astype(np.uint8)
        Image.fromarray(rgba, 'RGBA').save(outdir + '/rest.png')
    n += 1
enc.stdin.close(); enc.wait(); dec.wait()
print('frames', n)
