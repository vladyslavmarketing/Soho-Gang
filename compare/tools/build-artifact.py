"""Build the compare page for an Artifact: index.html without the document skeleton (the host adds it),
compare.js + sources.js inlined; b.html / b.js / sources.js / clip / export files listed as artifact files.
usage: python3 compare/tools/build-artifact.py <outDir>   -> prints a JSON map {published path: source path}"""
import os, re, sys, json, shutil
here = os.path.dirname(os.path.abspath(__file__)); cdir = os.path.dirname(here); root = os.path.dirname(cdir)
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
html = open(os.path.join(cdir, 'index.html'), encoding='utf-8').read()
# published files cannot sit above the page: ../blender/export/ is served as export/
def pub(text): return text.replace('../blender/export/', 'export/').replace("  placeholder: false,", "  placeholder: false,\n  glbScript: 'export/snake_glb.js',")
open(os.path.join(out, 'sources.js'), 'w', encoding='utf-8').write(pub(open(os.path.join(cdir, 'sources.js'), encoding='utf-8').read()))
for name in ['sources.js', 'compare.js']:
    js = pub(open(os.path.join(cdir, name), encoding='utf-8').read())
    html = html.replace('<script src="%s"></script>' % name, '<script>\n' + js + '\n</script>')
html = re.sub(r'<!doctype html>\s*', '', html, flags=re.I)
for t in ['<html lang="ru">', '</html>', '<head>', '</head>', '<body>', '</body>', '<meta charset="utf-8">']:
    html = html.replace(t, '')
html = re.sub(r'<meta name="viewport"[^>]*>\n?', '<meta name="claude:viewport-fit-sides" content="cover">\n', html)
open(os.path.join(out, 'index.html'), 'w', encoding='utf-8').write(html)
mapping = {'b.html': os.path.join(cdir, 'b.html'), 'b.js': os.path.join(cdir, 'b.js'), 'sources.js': os.path.join(out, 'sources.js')}
src = open(os.path.join(cdir, 'sources.js'), encoding='utf-8').read()
if "'../blender/export/'" in src:
    exp = os.path.join(root, 'blender', 'export')
    import base64
    open(os.path.join(out, 'snake_glb.js'), 'w').write('window.SNAKE_GLB_B64="' + base64.b64encode(open(os.path.join(exp, 'snake.glb'), 'rb').read()).decode() + '";\n')
    mapping['export/snake_glb.js'] = os.path.join(out, 'snake_glb.js')
    for f in ['snake_albedo.webp', 'snake_normal.webp', 'fur_strands.webp', 'manifest.json']:
        if os.path.exists(os.path.join(exp, f)): mapping['export/' + f] = os.path.join(exp, f)
for path in re.findall(r"'((?:\.\./blender/export/clipA/|placeholder/)[^']+)'", src):
    full = os.path.normpath(os.path.join(cdir, path))
    if os.path.isfile(full): mapping[path.replace('../blender/export/', 'export/')] = full
print(json.dumps(mapping, ensure_ascii=False, indent=1))
