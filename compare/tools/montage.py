"""A | B montage: python3 compare/tools/montage.py <A dir|A.webm> <B dir> <out.jpg> [frames=0,45,90,135]
A: the Cycles PNG sequence (sorted, frame n = n-th file) or a WebM (frames extracted with ffmpeg).
B: PNGs from compare/tools/capture.js (b_###.png). Both are composited over the site's powder pink."""
import sys, os, glob, subprocess, tempfile
from PIL import Image, ImageDraw, ImageFont
a_src, b_dir, out = sys.argv[1:4]
frames = [int(x) for x in (sys.argv[4] if len(sys.argv) > 4 else '0,45,90,135').split(',')]
FPS = 30; PAPER = (241, 214, 218)
def a_frame(n):
    if os.path.isdir(a_src):
        fs = sorted(glob.glob(os.path.join(a_src, '*.png')))
        return Image.open(fs[n]).convert('RGBA')
    tmp = os.path.join(tempfile.gettempdir(), 'a_%d.png' % n)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-c:v', 'libvpx-vp9', '-ss', '%.4f' % ((n + 0.25) / FPS), '-i', a_src, '-frames:v', '1', tmp], check=True)
    return Image.open(tmp).convert('RGBA')
def on_paper(im, size):
    bg = Image.new('RGBA', im.size, PAPER + (255,)); bg.alpha_composite(im); return bg.convert('RGB').resize(size)
W, H = 480, 270
try: font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 15)
except Exception: font = ImageFont.load_default()
sheet = Image.new('RGB', (40 + W * len(frames), 30 + 2 * H + 6), (30, 22, 24))
d = ImageDraw.Draw(sheet)
d.text((8, 7), 'верх: A (Cycles)   низ: B (браузер)   кадры ' + ', '.join(map(str, frames)) + ' при 30 fps', fill=(244, 234, 219), font=font)
for i, n in enumerate(frames):
    sheet.paste(on_paper(a_frame(n), (W, H)), (40 + i * W, 30))
    sheet.paste(on_paper(Image.open(os.path.join(b_dir, 'b_%03d.png' % n)).convert('RGBA'), (W, H)), (40 + i * W, 36 + H))
d.text((10, 30 + H // 2), 'A', fill=(229, 48, 74), font=font); d.text((10, 36 + H + H // 2), 'B', fill=(229, 48, 74), font=font)
sheet.save(out, quality=88); print(out)
