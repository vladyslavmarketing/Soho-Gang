"""Build the compare page for an Artifact: index.html without the document skeleton (the host adds it),
compare.js + sources.js inlined; b.html / b.js / sources.js / clip / export files listed as artifact files.
usage: python3 compare/tools/build-artifact.py <outDir>   -> prints a JSON map {published path: source path}"""
import os, re, sys, json, shutil
here = os.path.dirname(os.path.abspath(__file__)); cdir = os.path.dirname(here); root = os.path.dirname(cdir)
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
html = open(os.path.join(cdir, 'index.html'), encoding='utf-8').read()
for name in ['sources.js', 'compare.js']:
    js = open(os.path.join(cdir, name), encoding='utf-8').read()
    html = html.replace('<script src="%s"></script>' % name, '<script>\n' + js + '\n</script>')
html = re.sub(r'<!doctype html>\s*', '', html, flags=re.I)
for t in ['<html lang="ru">', '</html>', '<head>', '</head>', '<body>', '</body>', '<meta charset="utf-8">']:
    html = html.replace(t, '')
html = re.sub(r'<meta name="viewport"[^>]*>\n?', '<meta name="claude:viewport-fit-sides" content="cover">\n', html)
open(os.path.join(out, 'index.html'), 'w', encoding='utf-8').write(html)
files = {'b.html': 'b.html', 'b.js': 'b.js', 'sources.js': 'sources.js'}
src = open(os.path.join(cdir, 'sources.js'), encoding='utf-8').read()
for path in re.findall(r"'((?:\.\./|placeholder/)[^']+)'", src):
    files[path] = path
mapping = {}
for pub, rel in files.items():
    full = os.path.normpath(os.path.join(cdir, rel))
    if os.path.isdir(full):
        for f in os.listdir(full):
            p = os.path.join(full, f)
            if os.path.isfile(p): mapping[os.path.normpath(os.path.join(pub, f)).replace('../', '_up/')] = p
    elif os.path.exists(full):
        mapping[pub.replace('../', '_up/')] = full
print(json.dumps(mapping, ensure_ascii=False, indent=1))
