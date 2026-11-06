"""Build the v2 preview as one HTML file (CSS + JS inlined, images as separate files).
usage: python3 v2/tools/build-artifact.py <outDir>
three.js stays an external script from cdnjs (exact version)."""
import os, re, sys, shutil
here = os.path.dirname(os.path.abspath(__file__)); v2 = os.path.dirname(here)
out = [a for a in sys.argv[1:] if not a.startswith('--')][0]; os.makedirs(os.path.join(out, 'assets', 'img'), exist_ok=True)
html = open(os.path.join(v2, 'index.html'), encoding='utf-8').read()
def css(m):
    t = open(os.path.join(v2, m.group(1)), encoding='utf-8').read().replace('url("../img/', 'url("assets/img/').replace("url('../img/", "url('assets/img/").replace('url(../img/', 'url(assets/img/')
    return '<style>\n' + t + '\n</style>'
html = re.sub(r'<link rel="stylesheet" href="(assets/css/[^"]+)">', css, html)
scripts = re.findall(r'<script src="(assets/js/[^"]+)" defer></script>', html)
html = re.sub(r'<script src="(assets/js/[^"]+)" defer></script>\n?', '', html)
html = html.replace('<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/0.149.0/three.min.js" defer></script>\n', '')
body = '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/0.149.0/three.min.js"></script>\n'
for s in scripts:
    body += '<script>\n' + open(os.path.join(v2, s), encoding='utf-8').read().replace('</script', '<\\/script') + '\n</script>\n'
html = html.replace('</body>', body + '</body>')
if '--fragment' in sys.argv:   # artifact host wraps the page in its own document skeleton
    html = re.sub(r'<!doctype html>\s*', '', html, flags=re.I)
    for t in ['<html lang="ru">', '</html>', '<head>', '</head>', '<body>', '</body>', '<meta charset="utf-8">']:
        html = html.replace(t, '')
    html = re.sub(r'<meta name="viewport"[^>]*>\n?', '', html)
    html = re.sub(r'<title>[^<]*</title>', '<title>ae studio v2</title>', html)
open(os.path.join(out, 'index.html'), 'w', encoding='utf-8').write(html)
for f in os.listdir(os.path.join(v2, 'assets', 'img')):
    shutil.copy(os.path.join(v2, 'assets', 'img', f), os.path.join(out, 'assets', 'img', f))
print(os.path.join(out, 'index.html'), round(len(html) / 1024), 'KB')
