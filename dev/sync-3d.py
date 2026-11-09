#!/usr/bin/env python3
"""Pull the 3D plush snake from branch claude/plush-snake-v2 and build page-3d.html (comparison page).

    git fetch origin claude/plush-snake-v2 && python3 dev/sync-3d.py

- copies the v2 snake files verbatim (no edits in the core, so a re-run picks up every v2 update):
    v2/assets/js/snake3d.js, snake3d-page.js -> assets/js/3d/
    v2/assets/css/v2.css                     -> assets/css/3d/v2.css
    v2/assets/img/snake-ae-3d.webp           -> assets/img/
    v2/assets/models/*  (when present)       -> assets/models/
- builds page-3d.html from index.html: the 2D engine (snake.js) is swapped for three.js r149 + the 3D scripts;
  v2.css and assets/css/3d-page.css (this site's alignment of the hero to the 3D logo box) are added.
index.html (2D snake) is not touched.
"""
import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = 'origin/claude/plush-snake-v2'
FILES = {
    'v2/assets/js/snake3d.js': 'assets/js/3d/snake3d.js',
    'v2/assets/js/snake3d-page.js': 'assets/js/3d/snake3d-page.js',
    'v2/assets/css/v2.css': 'assets/css/3d/v2.css',
    'v2/assets/img/snake-ae-3d.webp': 'assets/img/snake-ae-3d.webp',
}


def git(*args):
    return subprocess.run(['git', '-C', ROOT] + list(args), check=True, capture_output=True).stdout


def main():
    names = git('ls-tree', '-r', '--name-only', REF, 'v2/assets/models').decode().split()
    files = dict(FILES)
    for n in names:
        files[n] = 'assets/models/' + n[len('v2/assets/models/'):]
    for src, dst in files.items():
        data = git('show', REF + ':' + src)
        path = os.path.join(ROOT, dst)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'wb') as f:
            f.write(data)
        print('synced', dst, len(data))

    html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()
    old = '<script src="assets/js/snake.js" defer></script>'
    assert old in html
    html = html.replace(old, '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/0.149.0/three.min.js" defer></script>\n'
                             '<script src="assets/js/3d/snake3d.js" defer></script>\n'
                             '<script src="assets/js/3d/snake3d-page.js" defer></script>')
    css = '<link rel="stylesheet" href="assets/css/blocks.css">'
    assert css in html
    html = html.replace(css, css + '\n<link rel="stylesheet" href="assets/css/3d/v2.css">\n<link rel="stylesheet" href="assets/css/3d-page.css">')
    hero = '<p class="hero__studio" aria-hidden="true">studio</p>'
    assert hero in html
    html = html.replace(hero, '<img class="hero__still" src="assets/img/snake-ae-3d.webp" alt="" width="1200" height="800" aria-hidden="true" decoding="async">\n    ' + hero)
    html = html.replace('<title>ae studio — вебкам-студия</title>', '<title>ae studio — 3D-змея</title>')
    html = html.replace('<meta name="viewport"', '<meta name="robots" content="noindex">\n<meta name="viewport"', 1)
    open(os.path.join(ROOT, 'page-3d.html'), 'w', encoding='utf-8').write(html)
    print('built page-3d.html')


if __name__ == '__main__':
    main()
