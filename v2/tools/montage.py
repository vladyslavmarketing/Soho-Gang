"""storyboard | site montages: for every scene a 2x4 sheet (top: storyboard key frames, bottom: our render)."""
import sys, os, glob
from PIL import Image, ImageDraw, ImageFont
out = sys.argv[1]
root = os.path.join(os.path.dirname(__file__), '..', '..', 'storyboard', 'Кадры')
W, H = 420, 240
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 15)
except Exception:
    font = ImageFont.load_default()
sheets = []
for d in sorted(os.listdir(root)):
    sb = [os.path.join(root, d, f'0{k}.jpg') for k in range(1, 5)]
    ours = [os.path.join(out, f'{d}_{k}.png') for k in range(1, 5)]
    if not all(os.path.exists(f) for f in ours):
        continue
    sheet = Image.new('RGB', (W * 4 + 50, H * 2 + 36), '#1E1618')
    dr = ImageDraw.Draw(sheet)
    dr.text((8, 8), f'{d}   верх: раскадровка  /  низ: сайт v2', fill='#F4EADB', font=font)
    for k in range(4):
        a = Image.open(sb[k]).convert('RGB').resize((W, H))
        b = Image.open(ours[k]).convert('RGB').resize((W, H))
        sheet.paste(a, (50 + k * W, 32)); sheet.paste(b, (50 + k * W, 32 + H + 4))
    dr.text((6, 32 + H // 2), 'SB', fill='#E5304A', font=font); dr.text((6, 36 + H + H // 2), 'v2', fill='#E5304A', font=font)
    p = os.path.join(out, f'montage_{d}.jpg'); sheet.save(p, quality=86); sheets.append(p)
print('\n'.join(sheets))
