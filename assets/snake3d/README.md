# assets/snake3d — plush snake renders

This folder is the Blender session's `web3d\` delivery (spec: `docs/snake3d-spec.md`, branch
`claude/webcam-studio-animation-design-jl8r68`, sections MANIFEST and WEB BRIEF). The player is
`assets/js/snake3d.js`; the test page is `dev/snake3d.html`.

## Current delivery: Blender web3d round 3 (final renders)

Copied unchanged from `blender/web3d/` on branch `claude/snake-blender`, commit `53b8840` (build 2026-11-10T13:12:46Z):
hero (intro / depart / depart-rev, rest, 15 look cells, tongue, breath), gauge (arrive, rest, 11 nod cells, tongue,
breath) and the right-edge journey J1 (all-intra, AV1 + HEVC S/M, H.264 S). No floor shadow anywhere. Scripts are in
`dev/blender/`, QA sheets stay on the Blender branch (`blender/web3d_qa/`).

Web-side notes on this delivery:
- **AV1 colour matrix.** Chromium decodes these AV1 files as BT.601 (calibration: ΔE 0.5 for 601 vs 4.9 for 709); the
  player's matrix repair handles it. Likely cause: no colour description in the AV1 sequence header. Fix in the encoder
  (e.g. `-svtav1-params color-primaries=1:transfer-characteristics=1:matrix-coefficients=1:color-range=0`); it also
  explains the 5–6 level patch deviation in the J1 decode check.
- **Hero mask has a hard right edge** (value 232 on the last column; the cells differ from the still there, so a seam
  showed through the «e»). The player now feathers any hard mask edge that is not on the stage edge (0.75 D). Packer
  fix: keep `mask.rect` inside `look.rect` with the feather fully inside, as in B8-10.
- `clips.journey.bodyRight` = her rightmost body x in the frame (404); the player reads it that way.
- M5 note: the journey rect height 3120 is not a multiple of 96 (it comes from the web brief); harmless.

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
