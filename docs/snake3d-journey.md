# Journey: она ползёт по правому краю до калькулятора (дополнение к snake3d-spec v3)

**Решение пользователя (2026-11-10):** между первым экраном и калькулятором змея ползёт вниз по правому краю
экрана вслед за прокруткой (вариант «1»). Это отменяет строку W0 «Dropped: the page-edge journey» для десктопа.

Дополнение к `docs/snake3d-spec.md` (ветка `claude/webcam-studio-animation-design-jl8r68`): разделы J-B — для
Blender-сессии, J-M — дополнение к MANIFEST, J-W — что делает плеер (уже сделано в `assets/js/snake3d.js`).

---

## J-B. BLENDER BRIEF: shot J1 `journey`

**Story.** H2 (depart) leaves the logo through the right edge. J1 picks her up at the top of a tall strip at the
right edge of the viewport; she slithers down, the body flows down while the page scrolls, and at the end she darts
out through the bottom. G1 (arrive) then brings her in from the right onto the ring.

**Camera `CamJourney`.** Orthographic, top-down over the same floor plane as CamGauge (no visible floor). Same
lighting as the hero (B7) so the pink matches the hero within ΔE2000 5. **No shadow catcher, no shadow** (the user
rejected floor shadows: «тени портят эстетику»; this applies to H/G shots too).
- Frame (master px, 156 px/D): **480 × 3120** = 3.08 D × 20 D. Snake centreline at x = 240 (1.54 D).
- **Size = the hero's, 1:1** (user decision): the player scales this layer exactly like the hero (same css px per D), so the
  viewport shows 9–19 D of it depending on the screen. The player places the cruise point at 62 % of the viewport
  height; the frame must reach above the viewport top and below its bottom, hence 20 D with the cruise point at 12 D.
- Content may touch the **top** edge (entry) and the **bottom** edge (exit) only; left/right keep 24 px clear.

**One clip, three segments** (30 fps, 0-based frames). The web side reads the segment bounds from the manifest, so
the counts below are targets, not hard rules.

| Segment | Frames | Content |
|---|---|---|
| `in` | 0–63 | Frame 0 empty. Her head enters through the top edge on the centreline and travels down to the cruise point (head at y = **cruiseY = 1872** = 12 D). Camera static. Her speed at frame 63 equals the loop speed. |
| `loop` | 64–123 | **Seamless loop.** The camera tracks down at constant speed v so the head stays near the cruise point. Path: sine along the centreline, wavelength λ = 5.2 D (4 band periods of 1.3 D), amplitude 0.55 D. The camera travels exactly **2 λ = 10.4 D** in 60 frames, so bands and wave repeat: frame 124 would equal frame 64. Head may yaw ±10° with the wave; no tongue. |
| `out` | 124–195 | Starts from the loop's frame-64 pose. The camera stops; she accelerates and darts out through the bottom edge (ease-in, ≈ 41 D of travel so the tail clears the frame). Shutter 1.0 for the fast part. Last frame empty. |

- Posing rules B4 apply (frame field, dorsal side up, no 180° head spins).
- Continuity asserts: frame 63 → 64 and frame 123 → 64 (the wrap) both within the B8-15 metric.
- Render at 100 % for clips (clip px = master × ⅔), like H1/H2/G1.

**Packing / encoding.** Same stacked-alpha layout (B8-7), tiers S and M. One difference: encode **all-intra**
(every frame a keyframe), because the player scrubs it by seeking on every scroll step, in both directions:
- H.264: `-g 1 -keyint_min 1 -x264-params keyint=1:scenecut=0`, CRF start 26 (ceiling 31);
- HEVC: `-x265-params keyint=1:min-keyint=1:scenecut=0`, CRF start 30;
- AV1: `-g 1`, CRF start 40.
- Sizes: S = 240 × 3168, M = 320 × 4224 (stacked; ≤ 8192 MBs; M height > 4096 needs level 5.1 → ship M as AV1/HEVC only, or S everywhere). Byte caps (AV1): S 900 KB, M 1500 KB.
- No reverse encode is needed (seeking runs both ways).

**Animatic first** (25 %, 16 spp, no fur), like B12-2, so the user can approve the motion.

## J-M. MANIFEST addition

```json
"journey": {
  "frame": [480, 3120],
  "camera": { "name": "CamJourney", "type": "ortho" },
  "stage": [0, 0, 480, 3120],
  "exit": "bottom",
  "clips": {
    "journey": { "frames": 196, "rect": [0, 0, 480, 3120], "from": "empty", "to": "empty", "cruiseY": 1872,
                 "segments": { "in": [0, 64], "loop": [64, 124], "out": [124, 196] }, "intra": true }
  }
}
```

Files: `journey/S/journey.<h8>.{av1,hevc,h264}.mp4`, `journey/M/…`. No rest still, no look, no flow.

## J-W. Web behaviour (implemented)

- A fixed layer at the right edge of the viewport, scaled 1:1 with the hero snake, cruise point at 62 % of the viewport, `z-index: 3`: above section backgrounds,
  under content wrappers (`z-index ≥ 4`). On laptops she slides under the cards and shows in margins and gaps; on wide
  screens she stays in the free right margin. The sections between the hero and `#income` must again not create a
  stacking context (the CSS rules for it never changed).
- **Desktop only** (`min-width: 960px`), motion mode, video ok, WebGL. Phones keep depart → arrive.
- Scroll range: from the hero's p = 1 (she has left the logo) to the scroll where the gauge's top meets the viewport
  bottom (the arrival starts). The loop repeats n times so that one clip frame ≈ 14 px of scroll; n is recomputed on
  layout. Scrolling up runs everything backwards.
- Visible only while the hero is gone and the gauge is empty (one snake at a time). Anchor jumps skip it (200 ms fade).
- Uses the hero B decoder (depart-rev) while active; the hero reloads it from the cached blob when she re-forms.
