#!/usr/bin/env python3
"""Build a one-file preview of the site (for a claude.ai artifact or any sandbox that serves only one page).

    python3 dev/build-preview.py OUT_DIR [page.html]   # index.html -> ae-studio.html, page-3d.html -> page-3d.html

Writes OUT_DIR/ae-studio.html: the <head> extras and the <body> content of index.html (no <html>/<head>/<body>
tags), with style.css + blocks.css and snake3d.js + main.js + blocks.js inlined. Every inline <script> of <head>
(the snake3d boot first) is kept in order. Images and snake media stay separate files referenced relative to the
page (CSS '../img/' -> 'assets/img/'); snake3d.js resolves 'assets/snake3d/...' against document.baseURI, so no URL
rewrite is needed. Publish assets/img/ and assets/snake3d/ beside the page. The <link rel="preload"> lines are
dropped: the scripts they warm are inlined here.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def main(out_dir, page='index.html'):
    html = read(page)
    head = re.search(r'<head>(.*?)</head>', html, re.S).group(1)
    body = re.search(r'<body>(.*?)</body>', html, re.S).group(1)

    # local stylesheets in <head> order, image paths rewritten for the page root
    css = ''
    for href in re.findall(r'<link rel="stylesheet" href="(assets/[^"]+)">', head):
        css += read(href).replace('../img/', 'assets/img/').replace('../../img/', 'assets/img/') + '\n'

    # scripts in document order: local ones inlined, CDN ones kept as tags
    js = []
    for src in re.findall(r'<script src="([^"]+)" defer></script>', body):
        if src.startswith('http'):
            js.append(('ext', src))
            continue
        js.append(('inline', read(src)))

    keep = []
    for line in head.splitlines():
        s_ = line.strip()
        if s_.startswith('<title') or 'fonts.googleapis' in s_ or 'fonts.gstatic' in s_ or s_.startswith('<meta name="description"'):
            keep.append(s_)
    early = '\n'.join(re.findall(r'<script>.*?</script>', head, re.S))
    body = re.sub(r'\s*<script src="[^"]+" defer></script>', '', body)

    page_html = '\n'.join(keep) + '\n<style>\n' + css + '\n</style>\n' + early + '\n' + body.strip() + '\n'
    for kind, v in js:
        page_html += ('<script src="%s"></script>\n' % v) if kind == 'ext' else ('<script>\n' + v.replace('</script', '<\\/script') + '\n</script>\n')

    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, os.path.splitext(os.path.basename(page))[0].replace('index', 'ae-studio') + '.html')
    with open(out, 'w', encoding='utf-8') as f:
        f.write(page_html)
    print(out, round(len(page_html.encode('utf-8')) / 1024), 'KB')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'dist'), sys.argv[2] if len(sys.argv) > 2 else 'index.html')
