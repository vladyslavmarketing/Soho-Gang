"""
ae studio - QA previews (spec B13): clips composited from the DECODED M files, the way the player does it
(premultiplied: out = P + bg * (1 - A)), on #F1D6DA and #1E1618.

    python blender/web3d_previews.py          # -> C:/Users/vladk/ae-studio/web3d_qa/previews/*.mp4
"""
import json, os, shutil, subprocess

ROOT = r'C:\Users\vladk\ae-studio'
WEB, OUT = os.path.join(ROOT, 'web3d'), os.path.join(ROOT, 'web3d_qa', 'previews')


def ffmpeg():
    p = shutil.which('ffmpeg')
    if p:
        return p
    for root, _, files in os.walk(os.path.expandvars(r'%LOCALAPPDATA%\Microsoft\WinGet\Packages')):
        if 'ffmpeg.exe' in files:
            return os.path.join(root, 'ffmpeg.exe')


def main():
    man = json.load(open(os.path.join(WEB, 'manifest.json')))
    os.makedirs(OUT, exist_ok=True)
    ff = ffmpeg()
    for scene, sec in man['scenes'].items():
        k = man['tiers']['M']
        for clip, cl in sec.get('clips', {}).items():
            key = '%s/M/%s.h264.mp4' % (scene, clip)
            if key not in man['files']:
                key = '%s/M/%s.av1.mp4' % (scene, clip)
            if key not in man['files']:
                continue
            w, h = round(cl['rect'][2] * k), round(cl['rect'][3] * k)
            g = round(man['videoLayout']['gutter'] * k)
            for bg in ('F1D6DA', '1E1618'):
                fc = ('[0]format=gbrp,split[x][y];[x]crop=%d:%d:0:0[c];[y]crop=%d:%d:0:%d[a];'
                      'color=c=0x%s:s=%dx%d:r=30,format=gbrp[b];[b][a]blend=all_expr=\'A*(1-B/255)\'[ba];'
                      '[c][ba]blend=all_mode=addition,scale=trunc(iw/4)*2:trunc(ih/4)*2,format=yuv420p'
                      % (w, h, w, h, h + g, bg, w, h))
                out = os.path.join(OUT, '%s_%s_M_on_%s.mp4' % (scene, clip, bg))
                subprocess.run([ff, '-y', '-loglevel', 'error', '-i', os.path.join(WEB, man['files'][key]['file']),
                                '-filter_complex', fc, '-frames:v', str(cl['frames']), '-c:v', 'libx264', '-crf', '20', out],
                               check=True)
                print('wrote', out)


if __name__ == '__main__':
    main()
