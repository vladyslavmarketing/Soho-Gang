# Snake head atlas (Blender)

`assets/img/snake/head.webp` and the `head` section of `assets/img/snake/manifest.json` are rendered here. They
show the plush head in profile, as in the client's photo, with fur groomed as hair curves and lit like the body atlas.

| file | runs in | what |
| --- | --- | --- |
| `head_v3_spec.py` | both | target outline (traced brow and jaw polylines + the brow-side neck shoulder), eye, tongue root, cell format, light, neck fade, HEAD_TINT; 2D skin = outline eroded by the calibrated fur reach |
| `head_v3_params.json` | both | calibrated fur reach per edge (knots along x), the snout-tip fillet and the neck shoulder |
| `plush_fur.py` | Blender | Cycles setup, fur / skin / bead materials, numpy strand groomer (same look as `body.webp`) |
| `head_v3.py` | Blender | builds the head (skin, fur, bead) and renders the 32 lighting cells |
| `head_v3_check.py` | python3 | fit of the alpha >= 0.5 edge vs the target (both directions, + calibration), overlay montage, neck composite, contact sheet |
| `head_v3_pack.py` | python3 | cells -> `head.webp` (+ grade, neck fade) and the manifest `head` section |

Run from the repo root (Blender 4.2 LTS, Cycles CPU, OIDN; python3 with numpy + Pillow):

```sh
B=/path/to/blender
# 1. calibrate (optional; bucket 0 at 2x, cheap). Repeat until the deviation is within +-0.08 R
$B -b --factory-startup --python dev/blender/head_v3.py -- out=/tmp/h3 buckets=0 spp=16
python3 dev/blender/head_v3_check.py fit /tmp/h3/head_00.png out=/tmp/fit.png update=dev/blender/head_v3_params.json
# 2. all 32 cells, 2x supersampled (about 15 min on 4 threads)
$B -b --factory-startup --python dev/blender/head_v3.py -- out=/tmp/h3 spp=48 ss=2
# 3. atlas + manifest, then checks
python3 dev/blender/head_v3_pack.py /tmp/h3
python3 dev/blender/head_v3_check.py fit atlas=assets/img/snake/head.webp cell=0 out=/tmp/fit1x.png
python3 dev/blender/head_v3_check.py sheet out=/tmp/sheet.png
```

Conventions:
- Units are body radii R; x points forward from the head point.
- u runs across the head: + is the jaw side, - is the brow side.
- In a cell, image y points down and equals -u, so the jaw hangs toward -y.
- Blender maps X = x and Y = u; the ortho camera at +Z sees the side with the eye.
- Cell b is lit for heading b/32·2π by the engine's screen key light.
- Every cell has the one bead eye (`per_bucket` [[1]] × 32, never flipped).
- The engine multiplies the head by `HEAD_TINT` (snake.js). The packer's sRGB gain makes head × tint equal the
  body pink at the neck.

Neck shoulder (the one deliberate departure from the traced outline). snake.js stamps the first body cell 0.3 R
behind the head point. Its lens window ends in a straight cut at x ≈ +0.06 R, and the body fur is opaque out to
|u| ≈ 1.30 R (alpha 0.5 at 1.38 R). The traced brow is only 1.14 R out at the neck, so the stamp's front end showed
above the brow as a square tab. `BROW_SHOULDER` in `head_v3_spec.py`:
- widens the brow to the body's fur edge (1.40 R) from x −0.5 to 0, where the body covers the head anyway in a
  straight pose;
- tapers back to the traced brow by x −1.25, so the rigid head does not poke out past a bending neck;
- rounds into the traced brow by x 0.6 with a C1 fillet;
- gives that brow-side band body grooming (length, lean, palette, no comb). Long head fur combed up the fillet piles
  over the convex corner into a tuft.

To render the traced outline unchanged, set `"brow_shoulder": null` in the params file and recalibrate.

`head_photo.py` and `build_head_atlas.py` (particle-hair version) are superseded by these scripts.
