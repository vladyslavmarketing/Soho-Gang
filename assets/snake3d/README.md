# assets/snake3d — plush snake renders

This folder is the Blender session's `web3d\` delivery (spec: `docs/snake3d-spec.md`, branch
`claude/webcam-studio-animation-design-jl8r68`, sections MANIFEST and WEB BRIEF). The player is
`assets/js/snake3d.js`; the test page is `dev/snake3d.html`.

## Current delivery: animatic set (interim, user decision 2026-11-10)

The user asked to see the full behaviour on the live site before the Cycles finals exist, so this delivery is built
from the Blender session's animatics (`blender/renders/motion/*_animatic.mp4`, branch `claude/snake-blender`, commit
`3a2d4c7`): smooth fur-less drafts, 704×448 = the full CamHero / CamGauge frame at 1/3 of master.
`python3 -I dev/snake3d-animatic-pack.py <dir with the 3 mp4s> <out>` writes everything here:

| File | What |
|---|---|
| `hero/S/intro`, `depart`, `depart-rev` `.h264.mp4` | Stacked-alpha clips (704×928) with a real grey strip and colour patches, so calibration runs. |
| `gauge/S/arrive.h264.mp4` | The coil around the income ring (96 frames). |
| `*/S/rest.webp` | Last frames as the rest stills; `hero/M/rest.webp` is the unhashed no-JS / manifest-failure copy. |
| `*/flow.png` | Breath map: outward normal of the blurred silhouette (±6 master px, `fileScale` 0.25), so she breathes at rest. |

- Tier: only `S` = 1/3 (the animatic resolution); the player snaps every device to it.
- Background **and floor shadow are keyed out** against an empty frame (user: «тени портят эстетику»).
- No `look` / `tongue` yet: the head does not follow the cursor, so the hero hint is hidden (`is-snake-static`).
- Files are not content-hashed (interim); the finals from `web3d_pack.py` will be.
- `aeBox [534, 312, 1056, 756]`; gauge anchors use the spec's ring (720, 672, r 390).

- `journey/S/journey.h264.mp4`: **interim mock** of the right-edge journey (J1), drawn by `dev/snake3d-journey-mock.py`
  in the animatic style (not a Blender render), so the live site shows the whole story until J1 is rendered.
  Replace it with the Blender delivery (docs/snake3d-journey.md).

**For the final renders:** drop the shadow-catcher floor (B2, B8-3) too, otherwise the grey shadow returns.

The earlier plush placeholder (idle loop from `snake_idle.webm`, `loopRest`) is in git history; `dev/snake3d-noshadow.py`
rebuilds it.

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
