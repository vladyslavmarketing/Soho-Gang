# assets/snake3d — plush snake renders

This folder is the Blender session's `web3d\` delivery (spec: `docs/snake3d-spec.md`, branch
`claude/webcam-studio-animation-design-jl8r68`, sections MANIFEST and WEB BRIEF). The player is
`assets/js/snake3d.js`; the test page is `dev/snake3d.html`.

## Current delivery: placeholder (W0 "first delivery", spec B10)

Built by the web session from `blender/export/clipA/snake_idle.webm` (branch `claude/snake-blender`):

| File | What |
|---|---|
| `hero/M/placeholder.h264.mp4` | Stacked-alpha H.264 (1280×1536: colour, 96 px black gutter, alpha). 180 frames, idle loop, used as `intro` (`from: rest`, `to: rest`). |
| `hero/M/rest.webp` | Frame 0 as the rest still (also the no-JS / manifest-failure fallback). |
| `manifest.json` | Written by hand: `strip: null`, `patches: null`, `look: null`, `flow: null`, no `depart`, no gauge. |

Anchors measured on frame 0: `aeBox [337, 135, 608, 465]`, eye `[424, 229]`, snout `[353, 235]`,
`pxPerD` ≈ 90. With no `depart` clip the hero leaves by an opacity fade; with no gauge scene the flat
SVG ring stays.

Commands (from the scratch folder holding `a.webm`):

```
ffmpeg -c:v libvpx-vp9 -i a.webm -filter_complex "[0]format=rgba,premultiply=inplace=1,format=rgba,split[c][a];[a]alphaextract,format=rgb24[al];[c]format=rgb24,pad=iw:ih+96:0:0:black[cp];[cp][al]vstack,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p" -c:v libx264 -crf 20 -an -color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv -movflags +faststart placeholder.h264.mp4
ffmpeg -c:v libvpx-vp9 -i a.webm -frames:v 1 -c:v libwebp -pix_fmt bgra -quality 82 rest.webp
ffmpeg -f lavfi -i color=c=black:s=16x16:r=30 -frames:v 1 -c:v libx264 -profile:v baseline -pix_fmt yuv420p -movflags +faststart -an probe.mp4   # -> manifest.probe
```

## Integrating a real delivery

1. `git fetch origin claude/snake-blender` and copy `blender/web3d/` over this folder (delete the placeholder files).
2. Recompute the four no-JS fallback constants in `style.css` (`.snake3d--hero.is-fallback`, W5) from the new
   `aeBox` (ae) and `stage` (st): left `−0.011 + 0.5865·(st.x − ae.x)/ae.h`, top `−0.0238 + 0.5865·(st.y − ae.y)/ae.h`,
   width `0.5865·st.w/ae.h`, height `0.5865·st.h/ae.h`.
3. Re-run QA (`dev/snake3d.html?snake3d=debug` shows the M5 invariant check and calibration).

## Where the code differs from the spec (and why)

- **Tier snapping.** The spec's boot assumes every tier S/M/L exists. The placeholder ships only M, so the boot and
  the player snap a picked tier to the nearest tier the manifest actually lists (prefer the next one up). This is a
  no-op for the real deliveries.
- **`?tier=` / `?codec=`** are read by the boot as well, so a forced codec or tier also applies to the early intro fetch.
- **Placeholder `written`.** The placeholder intro has no `events`; a clip with `from: rest` emits `written` on its
  first frame, otherwise on its last frame.
- **Size budget.** `snake3d.js` is ≈ 85 KB source / 26 KB gzip, over the W1 target (48 KB / 15 KB gzip). It is still far
  below the 1.33 MB the 2D snake loaded up front. A minified copy would meet the budget if needed.
- **Preview build.** `dev/build-preview.py` drops the two `<link rel="preload">` lines: the preview inlines those scripts.
- **Autonomy timer.** At rest with a look set, autonomy re-checks on a 400 ms `setTimeout` instead of keeping rAF alive
  (no rAF callbacks between moves).
- **Not implemented yet:** texture release for scenes more than 2 viewports away (W14; blobs and decoders are released
  after the hero departure only).
