#!/usr/bin/env python3
"""Build a one-file preview of the site (for a claude.ai artifact or any sandbox that serves only one page).

    python3 dev/build-preview.py OUT_DIR

Writes OUT_DIR/ae-studio.html: the <head> extras and the <body> content of index.html (no <html>/<head>/<body>
tags), with style.css + blocks.css and snake.js + main.js + blocks.js inlined. Images stay separate files and are
referenced as assets/img/... relative to the page: CSS '../img/' -> 'assets/img/', snake.js assetUrl() ->
new URL('assets/img/' + rel, document.baseURI). Publish the images from assets/img/ (snake/ included) beside it.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return f.read()


def main(out_dir):
    html = read('index.html')
    head = re.search(r'<head>(.*?)</head>', html, re.S).group(1)
    body = re.search(r'<body>(.*?)</body>', html, re.S).group(1)

    css = read('assets/css/style.css') + '\n' + read('assets/css/blocks.css')
    css = css.replace('../img/', 'assets/img/')

    snake = read('assets/js/snake.js')
    snake, n = re.subn(
        r"function assetUrl\(rel\) \{.*?\n  \}",
        "function assetUrl(rel) {\n    return new URL('assets/img/' + rel, document.baseURI).href;\n  }",
        snake, count=1, flags=re.S)
    if n != 1:
        sys.exit('assetUrl() not found in snake.js')
    js = [snake, read('assets/js/main.js'), read('assets/js/blocks.js')]

    # head: title, fonts and the early "js" flag script; drop local stylesheet links, icons and social meta
    keep = []
    for line in head.splitlines():
        s = line.strip()
        if s.startswith('<title') or 'fonts.googleapis' in s or 'fonts.gstatic' in s or s.startswith('<meta name="description"'):
            keep.append(s)
    early = re.search(r'<script>.*?</script>', head, re.S).group(0)

    # body: drop the external <script src> tags; the inlined scripts go at the end (same order as the defer chain)
    body = re.sub(r'\s*<script src="[^"]+" defer></script>', '', body)

    page = '\n'.join(keep) + '\n<style>\n' + css + '\n</style>\n' + early + '\n' + body.strip() + '\n'
    for src in js:
        page += '<script>\n' + src.replace('</script', '<\\/script') + '\n</script>\n'

    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, 'ae-studio.html')
    with open(out, 'w', encoding='utf-8') as f:
        f.write(page)
    print(out, round(len(page.encode('utf-8')) / 1024), 'KB')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'dist'))
