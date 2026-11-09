# Decisions

> **Paths in this document.** It was written in the main session's sandbox. Map its paths like this:
> - `…/scratchpad/diva-wt/…` → branch `claude/ae-diva-structure` at commit `8093dd6`;
> - `diva-hero-d.png`, `diva-income-d.png`, `diva-hero-m.png` → `docs/snake3d-ref/` on branch `claude/webcam-studio-animation-design-jl8r68`;
> - `a.webm` → `blender/export/clipA/snake_idle.webm` on branch `claude/snake-blender`;
> - `…/scratchpad/ab/snake_scene.py`, `snake_anim.py` → `blender/` on branch `claude/snake-blender`.


**Status:** v3, 2026-11-09. This version merges spec v2 with the review round. DIVA line numbers were checked against commit `8093dd6` (branch `claude/ae-diva-structure`, worktree `diva-wt`).

**How to send this document.** The BLENDER BRIEF and the WEB BRIEF each go to their own session. Each brief must be sent **together with the `# MANIFEST` section**: that section is part of both briefs and holds the glossary, schema, invariants and byte caps.

| # | Decision | Why |
|---|---|---|
| 1 | **Alpha video is a stacked-alpha MP4, composited in WebGL.** Premultiplied colour is on top. Below it is a 96 master-px gutter holding a grey strip and 4 colour patches. Alpha, stored as grey, is at the bottom. | This is the only alpha-video path that renders the same in Chrome, Firefox, Safari macOS and iOS Safari. Safari ignores VP9 alpha. HEVC alpha needs Apple's encoder, and there is no Mac. |
| 2 | **The player calibrates every decoder load from block medians of the gutter.** It builds an inverse LUT (identity when the error is within 3 levels) and repairs a BT.601/709 matrix swap using the colour patches. It falls back to stills (BROKEN) only after 3 bad frames in a row. | Browsers handle the transfer curve differently when uploading video to WebGL. Single-pixel reads are noisy because of anti-fingerprinting noise, and the first upload can be blank. |
| 3 | **Codec ladder: AV1 → HEVC (`hvc1`) → H.264.** The choice uses `MediaCapabilities.decodingInfo` on the exact stacked size. All three are queried in parallel within 300 ms, and the result is cached per tab. AV1 on touch-only devices must be `powerEfficient`; HEVC must always be. | AV1 is about half the bytes of H.264. HEVC covers Apple devices without AV1 hardware. With serial 80 ms races, slow devices fell through to H.264. |
| 4 | **One MP4 per clip × tier × codec:** `intro`, `depart`, `depart-rev` (hero) and `arrive` (gauge). | No forced keyframes are needed, forward and reverse can run side by side, and the departure can load after the intro. |
| 5 | **Each file is fetched whole** into a Blob and played from an object URL. Files have **content-hashed names** and are fetched with `cache: 'force-cache'`. | Playback never stalls mid-clip. Without hashing, GitHub Pages' 10-minute max-age would revalidate every file and could pair a stale manifest with new media. |
| 6 | **30 fps.** H2 moves at about 30 D/s (≈ 2,700 css px/s at 1440 wide), so it renders with shutter 1.0. | 30 fps maps 2:1 onto 60 Hz and 4:1 onto 120 Hz. At about 1 D per frame, the 1.3 D band period would appear to strobe backwards unless it is blurred. |
| 7 | **Tiers S/M/L = 78/104/156 px/D.** Stills, cells and tongue overlays render at 150 % and ship at S, M and L. Clips render at 100 % (= M) and ship at S and M. An L clip pass is optional, decided after timing. | Fur sharpness shows at rest; in motion, a 1.5× upscale is invisible. This cuts clip render time 2.25× and Retina first-screen bytes about 2×. |
| 8 | **Stills and atlases are WebP** (lossy colour, lossless alpha). Masks and flow maps are PNG with no colour chunks. | Works everywhere from Safari 14, allows random access, and works when autoplay is blocked. |
| 9 | **The rest state is never video.** It is a base still, plus one look cell (a blend of two only while moving), plus a tongue overlay and a breath warp, all in one shader. | Zero decode at rest, exact frames, and it survives Low Power Mode. |
| 10 | **Look-at = one rendered out-of-plane axis plus an in-plane bend in the shader.** Hero: 15 yaw cells, −10…+60°. Gauge: 11 nod cells, 15…65°. Springs and crossfades run only while the head moves; at rest exactly one rendered cell shows. | Continuous tracking reads as alive. With 5° steps the crossfade blur is ≤ ~7 L-px and never visible at rest. |
| 11 | **Tongue = tongue-only overlay renders per cell:** 3 extend frames and 2 fork flicks, played at 30 fps over the current cell. | She can flick at any head angle; each overlay is about 1–2 KB. |
| 12 | **Breathing = a flow-map warp along the body centreline,** ±1.8 % over 3.6 s. It ships only if the H3b check passes; otherwise `amp` is 0. | The brief says she breathes. A centreline swell does not read as a zoom pulse. |
| 13 | **The hero departure is scroll-chased in both directions while it is partial.** The reverse direction uses a reversed encode. The departure arms only when p rises 0.04 above `p_hold`, and it maps p ∈ [p0, 1] onto the clip. After 600 ms idle it resolves to «ae» or to gone. A full re-form from gone replays the intro. | Her exit follows the scroll. An edge-triggered arm cannot loop. A reversed path-follow works as a rewind but looks wrong as a full re-entry. |
| 14 | **The gauge arrival is chased forward only.** It auto-completes after 600 ms idle when the gauge is ≥ 35 % visible, and it never rewinds. After an anchor jump the hero fades out (200 ms, no decode) and the arrival waits for the smooth scroll to end, then plays at 1×. | The reader sees the whole arrival. CSS smooth scroll needs its own end detection. |
| 15 | **One snake at a time:** hero or gauge. | Keeps the story: she leaves the logo, is found at the ring, comes back to write the logo. |
| 16 | **One layer per scene, inside its section.** The fixed page canvas and the stacking-context rules go away. `.gauge` loses `data-reveal`. | Native scrolling. The arrival must never play inside an ancestor at opacity 0 or mid-translate. |
| 17 | **The hero layer sits under «studio»** (z 1, earlier in the DOM) and under the vignette. | In the approved layout «studio» overlaps the bottom of the «e», and the caption must stay on top. |
| 18 | **The hero fit reproduces today's composition.** Letter bbox top-left = logo box + (−0.011·bw, −0.044·bh). Letter height = 1.085·bh. | These ratios were measured on the 1440 screenshot; they keep the approved overlap. |
| 19 | **Rest stills and flow maps cover the whole stage,** with transparent or zero padding, so `<img>` fallbacks fill the layer 1:1. | Otherwise every still-mode, no-WebGL and no-JS image is stretched or offset. |
| 20 | **The canvas backing store is stage × scene tier;** CSS scales it. | One texel per fragment, no DPR math. |
| 21 | **WebGL1 + GLSL ES 1.00,** with `highp` required and `failIfMajorPerformanceCaveat: true`. Video uploads use `texImage2D` on every frame, never `texSubImage2D`. | Works everywhere, and software GL gets stills. WebKit's GPU video copy runs only on `texImage2D`. |
| 22 | **Exactly 3 decoder `<video>` elements** (hero A, hero B, gauge), created at mount and reused by swapping `src`. They live in one 2×2 px host at opacity .01, fixed at the viewport's bottom-right corner, as a direct child of `<body>`. | The host always counts as visible for autoplay rules and is never inside `.gauge`'s containment. WebKit lifts the gesture restriction per element, so the elements must persist. |
| 23 | **Clips are primed:** play, wait for the first presented frame, upload and calibrate, then pause. The player does not wait for `loadeddata`. | iOS keeps `preload` at metadata, so `loadeddata` may never fire before `play()`. |
| 24 | **The manifest is one JSON file.** An inline boot script before the stylesheets fetches it and starts the hero intro at `priority: 'low'`. `main.js` and `snake3d.js` are preloaded. | Gets an early start without starving `main.js`, which gates the h1 (the LCP element). |
| 25 | **Hero camera = CamHero overscanned to 1408×896.** Stills render at 150 %. | The dispatched path tool exits at CamHero's right edge, and the player keeps that edge ≥ 8 css px off-screen. |
| 26 | **Gauge camera = orthographic, top-down CamGauge.** She enters from the right and coils one lap + 45° counter-clockwise. Her neck lifts 1.10 D over the start of the coil. She rests at 12:30, nodding 40°. | Ortho makes the coil a true circle over the SVG ring. A right entry continues the hero's right exit. The lift keeps ≥ 1.1 D clearance. |
| 27 | **Gauge set: no visible floor** (the section is #1E1618). A dark shadow-catcher floor, a key light from the left so shadows fall toward the exit, a shadowless pink rim light and an inner glow. Lit pink matches the hero within ΔE2000 5. The trail's fade is the packer's exit ramp. | On near-black, a body that fades to black reads as coming out of the shadow. No shadow may touch a frame edge that is not the exit. |
| 28 | **Path-following poses are baked to FK with a roll-controlled frame field.** The field is a parallel transport of the rest pose. H2 rolls her dorsal side up for the floor crawl. | Spline IK alone spins the head 180–300° on the «e» and «a» crossbars. |
| 29 | **Still mode** = DOM `<img>` stills and zero video requests. Environment triggers: Save-Data, effectiveType slow-2g/2g, no WebGL, `?snake3d=still`. User triggers: reduced motion, «Остановить анимацию». Connections reporting `3g` stay in motion at tier S. Leaving still mode loads the motion set and replays nothing. | Nothing to keep alive. Chrome reports `3g` for many real 4G sessions. |
| 30 | **Autoplay blocked** (iOS Low Power Mode, gesture-gated WebViews) = WebGL rest with look, tongue and breath; departure and arrival become opacity fades. A 1-frame probe at mount detects it and aborts the intro download. A real tap unlocks all 3 decoders. iOS in-app WKWebViews outside an allowlist never call `play()`. | Everything except the clips survives. A `play()` inside a WebView that forbids inline playback can open the native fullscreen player. |
| 31 | **The footer snake is removed.** The F1 "peek" loop is specified for v1.1 only. | Bytes and render hours go to the hero and the gauge. |
| 32 | **Income tips keep DIVA's placement beside the head,** with x taken from the manifest. main.js fires `ae:income`; the player answers with a look and a flick (1.2 s cooldown). | Decoupled through an event; keeps "beside her, not on her face". |
| 33 | **`html.has-plush-ring`** (renamed from `has-journey`) is set only once the gauge still has decoded, and removed if its assets fail. | The flat SVG head comes back if the assets fail. |
| 34 | **Hint copy:** «Наведи курсор — она следит. Кликни — покажет язык.» The hint is hidden whenever the hero is a static image, and it is lifted above the head's envelope. | It says exactly what works, and it never covers her head. |
| 35 | **Byte caps are hard** (MANIFEST M6). The encode step raises CRF up to a ceiling and reports any overrun. Nobody raises a cap without sign-off. | Weight is a release gate. |
| 36 | **Names:** `assets/js/snake3d.js`, `window.AeSnake3D`, `assets/snake3d/`. Page-layout parameters live in `snake3d.js`; the manifest holds only render facts. | Each side owns what it edits, so finalize never overwrites web tuning. |

# BLENDER BRIEF

**For:** the Blender session on the user's Windows laptop (Blender 5.1.2, RTX 4050 Laptop 6 GB, OptiX, ffmpeg 9 full build).

**Send this brief together with the `# MANIFEST` section; it is part of this brief.** Section numbers B… belong to this brief. M… numbers refer to the MANIFEST: M1 glossary, M2 conventions, M3 example, M4 fields, M5 invariants, M6 byte caps.

## B0. Context

- **The project.** "ae studio" is a landing page. Its mascot is a plush pink snake with cream bands edged in black; her body spells the logo «ae». Your Cycles renders replace the page's 2D canvas snake ("variant A"). The look reference is `ab/montage.jpg` (top row) and `ab/a.webm`.
- **How the web uses your output.** The web player composites everything in WebGL over the page. No output ever contains a background: film is transparent and the floors are shadow catchers.
  - **Hero.** H1 (intro) writes «ae». The rest state is composited from a still, look cells, tongue overlays and a breath flow map; it is never video. H2 (departure) is scroll-chased forward, and backward through a reversed encode. A full re-form replays H1.
  - **Gauge.** The gauge is the income calculator's ring, on #1E1618. G1 coils her around it; its rest state is built like the hero's.
- **Already dispatched; build on it, do not redesign it:**
  - model fixes: pink head fur and a pale pink forked tongue;
  - the path-following tool that produces hero_intro and hero_depart.

  This brief adds requirements on top of both (B4, B5).
- **Inputs:** `ab/snake_scene.py` and `ab/snake_anim.py` (read the docstrings and `bake()`), plus the path tool. Do not change body length (34.3 D), bands, fur density (36000/D²) or the hero lights.

## B1. Spaces, cameras, frame numbering

- **Master frame.** Both scenes use 2112×1344 at 156 px/D (see M1).
- **CamHero.**
  - Keep `snake_scene.py`'s location, the 85 mm lens, the 7° down pitch and the sensor width.
  - Set the resolution to **1408×896** (it was 768) with `sensor_fit='HORIZONTAL'`. This adds 64 rows above and below and leaves px/D unchanged.
  - Stills render at 150 % (= master px). Clips render at 100 % (= clip px).
  - Converting photo px (1408×768) to master px: `x_m = 1.5·x_p`, `y_m = 1.5·y_p + 96`.
- **CamGauge:** see B6. Same resolutions and percentages as CamHero.
- **Render region.** Set `use_border = True` and `use_crop_to_border = False`, so files keep full-frame coordinates. The region is the shot's rect (B3/B9) plus 128 master px on each side. Blender's border y runs bottom-up, so convert like this, clamped to [0, 1]:
  - `border_min_x = (x − 128)/2112`
  - `border_max_x = (x + w + 128)/2112`
  - `border_min_y = 1 − (y + h + 128)/1344`
  - `border_max_y = 1 − (y − 128)/1344`

  Write `region.json` (the region in master px) beside each shot's EXRs.

  Outside the region Blender writes zeros into every pass. That includes Shadow Catcher = 0, which would read as full shadow, so the packer masks it out (B8-1).
- **Frame numbers.** The packer re-indexes every shot so its first rendered frame is index 0, whether the path tool starts at frame 0 or 1. Every frame number in this brief is 0-based.

## B2. Global render settings

| Setting | Clips (H1, H2, G1) | Stills, cells, tongue overlays (H3–H5, G3–G5) |
|---|---|---|
| Engine | Cycles, GPU, OptiX; persistent data on; light tree on | same |
| Resolution % | 100 (1408×896) | 150 (2112×1344) |
| Samples | 64, adaptive threshold 0.02, min 32. Use 96 if the animatic finals boil. | 160, adaptive 0.01, min 64 |
| Denoiser | **One denoiser for every shot.** On H3, compare OptiX with OIDN (GPU, Albedo + Normal, prefilter Accurate). Pick one and never mix them. | same |
| Seed | `seed = 0`, `use_animated_seed = False` | same; stills and cells must match outside the head |
| Motion blur | On. Shutter 0.5 (**H2: 1.0**), position **Center**. Set `use_deform_motion = True` on Body and Fur. Leave `ob.cycles.motion_steps` at 1 (= 3 time samples) and never raise it: it is an exponent and multiplies memory for 2.6 M strands. | Off |
| Clamp, bounces, curves | Direct clamp 0, indirect 10; max bounces 6, transparent 16; curve shape THICK | same |
| Film | Transparent; Blackman-Harris filter 1.5 px | same |
| Colour | View `Standard`, look None, exposure −0.2 | same |
| Catcher | Hero: `Sweep.is_shadow_catcher = True`. Gauge: `Floor` (B6). Shadow Catcher pass on. | same |
| Output | OpenEXR Multilayer, half float, ZIP; layers Combined + Shadow Catcher, plus `region.json`. Never write PNG from Blender for shipping. | same, plus one PNG of H3 for the colour check (B8-2) |

## B3. Shot list (30 fps)

| ID | Name | Camera, % | Rect for the region (master px) | Frames | Content | Passes |
|---|---|---|---|---|---|---|
| H1 | hero_intro | CamHero, 100 | stage, starting value `[360,96,1752,1152]` | 84 (0–83) | Path tool. She enters from the right along the floor with an S-wave, traces the tail line, the «e», then the «a», and eases into the photo «ae» pose (B5). | Combined, Shadow Catcher; blur 0.5 |
| H2 | hero_depart | CamHero, 100 | stage | 48 (0–47), up to 60 | Path tool. Frame 0 is the rest pose. The head goes down the left side of the «a» to the floor, crawls right in front of the letters and leaves frame right; the letters unwind from the tail end. The last frame is empty. | same; **blur 1.0** |
| H3 | hero_rest | CamHero, 150 | full frame | 1 | Pose = H1 frame 83. Yaw 0, tongue scale 0.03, breath 0. Also exports `rig_hero.json` (B8-9). | Combined, Shadow Catcher |
| H3b | hero_rest_breath | CamHero, 150 | stage | 1 | H3 with breath +1: spine X/Z scale 1 + 0.022·w, with `bake()`'s weights. QA only. | Combined |
| H4 | hero_look | CamHero, 150 | cell region (B5) | 15 cells | Yaw = −10 + 5·i, i = 0…14. **i = 2 is neutral** (0°, = H3). | Combined, Shadow Catcher |
| H5 | hero_tongue | CamHero, 150 | tongue region (B5) | 15 × 5 | Tongue only, per cell: e1, e2, e3, f1, f2. | Combined |
| G1 | gauge_arrive | CamGauge, 100 | stage, starting value `[96,0,1632,1344]` | 96 (0–95) | She enters from the dark at the right and coils one lap + 45° CCW. The neck rises over the start of the coil and the head settles at 12:30, nodding 40° (B6). Frame 0 is empty; frame 95 = G3. | Combined, Shadow Catcher; blur 0.5 |
| G3 | gauge_rest | CamGauge, 150 | full frame | 1 | Rest pose, nod 40°, tongue hidden. Also exports `rig_gauge.json`. | Combined, Shadow Catcher |
| G3b | gauge_rest_breath | CamGauge, 150 | stage | 1 | Breath +1. QA only. | Combined |
| G4 | gauge_look | CamGauge, 150 | cell region | 11 cells | Nod = 15 + 5·i, i = 0…10. **i = 5 is neutral** (40°, = G3). | Combined, Shadow Catcher |
| G5 | gauge_tongue | CamGauge, 150 | tongue region | 11 × 5 | Same five tongue frames as H5. | Combined |
| F1 | footer_peek | CamFooter | B14 | 240 | **v1.1 only; do not render in v1.** | — |

The v1 total is 228 clip frames + 6 stills + 26 cells + 130 tongue overlays = **390 renders**.

The stage values are starting values. If any frame's content (snake or shadow) falls outside the stage, the packer fails and names the frame. Enlarge the stage and re-render; the manifest carries whatever stage was used.

## B4. Posing rules (all shots)

1. **Bake; never drive at render time.** Every rendered pose is a set of FK keys made with `snake_anim.bake()`'s sequence:
   1. evaluate the Spline IK pose and capture the bone matrices (M0);
   2. apply `targets()` (`LOOK_SHARE` look or nod, breath, tongue);
   3. mute `SPLINE_IK`;
   4. key FK.

   FK applied on top of an active Spline IK is undone, because Spline IK re-aligns every bone to SpinePath. If you skip the bake, every cell, the breath shot and G1's nod come out neutral. The rule covers every frame of H1, H2 and G1, and H3, H3b, H4, G3, G3b and G4.
2. **No `frame_change` handlers.** For clips, the path tool also keys subframes f − s/2 and f + s/2, where s is the shutter (0.5, or 1.0 for H2). Motion blur then follows the path on tight letter curves instead of cutting corners.
3. **Roll control with a frame field.** Spline IK sets the chain root from its FK rest by the shortest rotation onto the tangent. On the «e» and «a» crossbars the head moves right while the path changes depth. A test on the real SpinePath turned the eye axis 45–56° per 0.25 D there, a 180–300° spin within about 4 frames. Required:
   - **Build the field.** F(s) runs along the master path. It is the parallel transport (rotation-minimising frame) of the final pose's Head frame (H3 for the hero, G3 for the gauge), starting at the head's rest arc position and going in both directions. Inside the rest window it must reproduce the rest pose's bone frames within 2°.
   - **H2 only.** Beyond the rest window, add a roll ramp ρ(s) about the tangent, spread over ≥ 3 D of path along the descent beside the «a». It brings the dorsal axis to world +Z for the floor crawl. Use whatever angle the transport leaves; the test suggests about 180°.
   - **At bake time, set every bone's roll** so that its frame equals F(s) at that bone's own arc position. Keying only the Head would roll the whole body, including the letters still on screen.
   - **Asserts on every frame of H1, H2 and G1:**
     - the local X axis of Head, Spine_10, Spine_30 and Spine_50 turns ≤ 10° between consecutive frames (deliberate look and nod changes excluded);
     - on floor segments, the dorsal axis is within 15° of +Z.
4. **Centred motion blur** (B2) on H1, H2 and G1. The packer builds `depart-rev` by reversing H2's frame order, which is a valid time reversal only with a centred shutter.

## B5. Hero shots

**H1 intro**
- Frames 0–2 contain no snake and no shadow pixels at x < 2112: everything starts beyond the right edge of the frame.
- The head is inside the frame by frame 6. No dead air.
- Frames 76–83 ease out to zero velocity.
- Frame 83's bone matrices equal H3's within 1e-4 D. Render H3 from this pose; do not pose it separately.
- No tongue (scale 0.03), breath 0 and yaw 0 throughout.
- S-wave amplitude ≤ 0.35 D; head speed ≤ 14 D/s.
- Write `events.written` = the first frame where the «a» loop is closed (default 70). «studio» fades in from that frame.

**H2 depart**
- Frame 0 is the H3 pose, with an ease-in over frames 0–3.
- The head is out of frame by frame 40.
- The last frame is empty: snake and shadow are past x = 2112, and max alpha ≤ 3/255.
- If 48 frames cannot clear the body, lengthen the shot to at most 60 frames rather than cut it.
- The whole move stays inside the stage. `events.unwritten` = 2.
- **Speed.** The tail must travel about 49 D (34.3 D of body plus about 14.5 D of exit route). That is about 1 D per frame, which is faster than the band period (median 1.30 D), so the bands would appear to strobe backwards. Shutter 1.0 smears them instead.
- **Alternative at the animatic gate (user's choice).** If the smear reads badly, offer up to 110 frames at ≤ 0.45 D/frame with shutter 0.5; the depart byte caps then rise ×2.2 (M6). The default stays ≤ 60 frames, as dispatched.

**H3 / H3b.** See B3. H3b is only for the breath QA (B8-9).

**H4 look cells**
- Use the exact `targets()` construction from `bake()`: `LOOK_SHARE` Head .45, Spine_01 .22, 02 .15, 03 .09, 04 .06, 05 .03. Rotate about the head's `up_axis`, with pitch 0, breath 0, the jaw at rest and Tongue scale 0.03.
- **+yaw turns the snout toward the camera.** Check that both eyes are visible at +60°. If the sign is inverted, negate it and note it in `rig_hero.json`.
- **Cell region:** a 6 D square (936 master px) centred on the neutral eye, clipped to the frame, plus the 128 px margin. `look.rect` must lie inside the cell region **without** its margin.

**H5 tongue overlays**
- Set Object > Visibility > **Holdout** on every object except `Tongue`, including the Sweep and the eyes. Keep everything in the scene so the head still occludes the tongue.
- Set the Tongue object's origin to `TONGUE_BASE`.
- Pose each cell once: its H4 pose with the Tongue bone at scale 1.0. Check once that the Tongue bone does not deform Body.
- Render the 5 overlays as a 5-frame animation of the Tongue object's **own** transform, with persistent data on, so only the Tongue re-syncs:

  | Frame | Tongue object |
  |---|---|
  | e1 | scale 0.35 |
  | e2 | scale 0.70 |
  | e3 | scale 1.0 |
  | f1 | scale 1.0, +14° about the head's `side_axis` (tips up) |
  | f2 | scale 1.0, −14° |

- **Tongue region:** the bbox of the tongue at scale 1.0 and ±14° across all 15 cells, plus 64 master px.

## B6. Gauge scene: `snake_gauge.py` (new)

The script opens `snake.blend`, deletes the Sweep and the hero lights, and builds the set below.

**World.** The floor is at z = 0 and the ring centre is the origin. The camera looks down −z with image-up = +y, so counter-clockwise in the world is counter-clockwise on screen.

**CamGauge**
- Orthographic; `ortho_scale` = 13.538 D (= 2112/156); `sensor_fit` HORIZONTAL.
- Location (2.154, 0, 40) D, rotation (0, 0, 0), clip end 60.
- The ring centre projects to **master (720, 672)**. The frame's right edge is at x = +8.92 D.

**Reference geometry.** Gauge width G = 6.25 D. The SVG ring uses track r = 160 and stroke 34 on a viewBox of 400.

| Feature | D | master px |
|---|---|---|
| Ring track radius (= 0.4·G) | 2.5 | 390 |
| Track half-width | 0.266 | 41 |
| Coil centreline radius Rc | 3.33 | 520 |
| Body centre height z0 | 0.47 | — |
| Coil inner / outer fur edge | 2.83 / 3.83 | 442 / 598 |
| Exit ramp (packer fade, B8-5) | x 4.62 → 6.15 | x 1440 → 1680 |

The gap between the coil's inner fur and the track is 0.064 D, about 5 css px at a 480 px gauge.

**Master path.** Arc-length parametrised, tail end first, about 70 D. Pose it with the same window-sliding Spline IK tool as the hero, following the B4 rules.

| Segment | Definition |
|---|---|
| A, lead-in | Straight from (40, 1.665, z0) to (12, 1.665, z0), off frame. |
| B, approach | From (12, 1.665) to E = (Rc·cos 30°, Rc·sin 30°) = (2.884, 1.665). Lateral wave y = 1.665 + 0.30·sin(2π(12 − x)/4.5)·w(x), where w fades to 0 over the last 1.5 D. The last 1.6 D is a cubic Bézier from (4.4, 1.665), heading (−1, 0), into E, heading (−0.5, 0.866), so it joins the circle tangentially. |
| C, coil | CCW from φ = 30° to φ = 435° (one lap + 45°). P(φ) = (r cos φ, r sin φ, z), with **r = Rc + 0.12·S(φ), z = z0 + 1.10·S(φ), S = smoothstep(315°, 375°, φ)**. The neck is fully raised before it crosses the approach line at φ ≈ 385°. |

**Clearance test** (on the path samples):
- any two samples more than 2 D apart in arc length are ≥ 0.95 D apart in space;
- that distance is ≥ 1.10 D wherever either sample lies within 1.3 D of the head end.

**Rest pose**
- The window [s_end − 34.3, s_end] covers 23.5 D of coil and about 10.8 D of trail. The tail tip is at x > 9.5 (off frame).
- The head rests at φ = 75° (12:30, 435° on the path), at z ≈ 1.57 D. The eye is at about master (866, 214).
- The snout points along screen (−0.966, −0.259): left and slightly up, toward the calculator.
- Nod +40° toward the camera, applied with `LOOK_SHARE` about the head's `side_axis` (baked per B4-1).

**G1 timing (96 frames)**
- The head starts at x = 9.6 (off frame) and travels Δs ≈ 30.9 D to s_end.
- Constant speed v0 = Δs/2.4 ≈ 12.9 D/s until t = 2.0 s, then a cubic ease-out over 1.2 s.
- Nod stays at 10° (looking along the floor) until t = 2.5 s, eases to 40° by t = 3.1 s, then holds.
- Frame 0 is empty, including inside the exit ramp.

**G4:** nod 15…65° about `side_axis` with the `LOOK_SHARE` distribution. Cell region: a 6 D square centred on the neutral eye. **G5:** same as H5.

## B7. Lighting

| | Hero (unchanged, `snake_scene.py`) | Gauge (new). Positions in D from the ring centre, floor z = 0 |
|---|---|---|
| World | (0.78, 0.66, 0.68) × 0.85 | (0.12, 0.085, 0.09) × 0.25 |
| Key | Area 10 D at (−12, −13, floor + 8), 2600 W, (1, .97, .95) | **Area 10 D at (−18, +2, +14)**, aimed at (0, 0, 0.5), 3300 W, same colour, Spread 50°. Shadows fall toward +x, the exit side. |
| Front / beauty | Area 14 D at (−6, −28, floor + 10), 7500 W | Area 14 D at (−4, +6, +30), 4500 W, Spread 60° |
| Fill | Area 10 D at (10, −12, floor + 5), 700 W | none (the world provides it) |
| Back / rim | Area 8 D at (2, 12, floor + 9), 1500 W | Pink rim: area 6 D at (+9, −9, +2.5), aimed at the origin, 1200 W, (1.0, 0.62, 0.70), **`use_shadow = False`** |
| Extra | — | Inner glow (echoes `.gauge::before`): sphere light, radius 1.2 D, at (0, 0, 0.6), 120 W, (0.84, 0.54, 0.60) |
| Catcher | Pink sweep (shadow catcher) | `Floor`: 60 × 60 D plane at z = 0, shadow catcher; Principled base (0.0129, 0.0080, 0.0091) (= #1E1618 in linear), roughness 0.9 |
| View | Standard, exposure −0.2 | identical |

**Gauge calibration targets.** The wattages are starting values.
1. **Colour match.** Lit pink fur is the top 20 % luminance of pink-hue pixels with α > 0.95. Its median must be within ΔE2000 ≤ 5 of H3's, and its mean luminance within ±6 %.
2. **Bands.** On their lit side the black bands stay ≥ 6/255 above #1E1618.
3. **Contact shadow** alpha ≤ 0.6 at its darkest.
4. **Head sheet.** Deliver a side-by-side sheet of the H3 and G3 heads.
5. **Frame edges.** G1 (every frame) and G3: A < 3/255 within 48 master px of the top, bottom and left frame edges.
   - If this fails, move the key to (−20, 0, 12) and re-check.
   - If it still fails, stop and report it with the numbers. Do not crop and do not change the camera.

The trail's fade into darkness comes from the packer's exit ramp (B8-5). Do not add flags or gobos: any occluder also darkens the catcher floor.

## B8. Packer: `blender/web3d_pack.py`

It runs inside Blender's Python with numpy and the bundled **OpenImageIO** module (`import OpenImageIO`); there is no scipy or PIL. It has two stages, `--stage pack` and `--stage finalize` (B10).

1. **Read.**
   - Read the multilayer EXR channels (`ViewLayer.Combined.*`, `ViewLayer.Shadow Catcher.*`) with OIIO. Use `ImageBufAlgo` for resize (`lanczos3`), dilate and blur.
   - **Outside the shot's `region.json`, set C = 0, α = 0 and r = 1 before any other step.** Those pixels never enter bboxes, Dmax, R, masks or asserts.
   - C is premultiplied linear RGBA and α is its alpha. r is the luminance of the Shadow Catcher pass (1 = no shadow).
   - For clips, map clip px to master px ×1.5.
2. **Display colour.** Where α > 1e-4: `d = srgb_oetf(clamp((C/α)·2^-0.2, 0, 1))`, using the piecewise sRGB curve.
   - **Check once** against Blender's own PNG of H3: max |Δ| ≤ 1/255 where α > 0.99. If it fails, Blender 5.1's `Standard` view differs; use the PNG's transform instead.
3. **Shadow.** `a_s = clamp(1 − r^(1/2.2), 0, 1)`, then subtract a fixed floor: `a_s = max(0, (a_s − 3/255)/(1 − 3/255))`. This is the same for every frame (no per-frame normalisation), so video and still cannot flicker against each other.
   - **One-time check on H3:** if Combined alpha is already > 0.02 on the floor under the body, Cycles has put the shadow into Combined. Run with `--shadow-in-combined`, which skips this step.
4. **Composite** (premultiplied, display space): `A = α + a_s(1 − α)`, `P = d·α`. The shadow is black.
5. **Edges.**
   - **Gauge exit ramp:** multiply A and P by `1 − smoothstep(exitRamp[0], exitRamp[1], x_master)`, with `exitRamp = [1440, 1680]`.
   - **Every other crop edge:** a smoothstep feather over 24 master px. The hero's right edge is exempt because it is the frame edge.
6. **Tiers.** Resample P and A with `lanczos3` in premultiplied space, **then clamp A to [0, 1] and P to [0, A]**.
   - Stills, cells and overlays: from master at k = 1 (L), ⅔ (M), ½ (S).
   - Clips: from clip px at k = 1 (M) and ¾ (S). L only if the optional 150 % clip pass exists.
7. **Stacked clip frame.** For a clip rect (w, h) in master px at tier factor k, the frame is `w·k × (2h + 96)·k`. Layout, top to bottom:

   | Rows | Content |
   |---|---|
   | `[0, h·k)` | P as 8-bit RGB |
   | `[h·k, (h+96)·k)` | Gutter: black, except the two bands below |
   | `[(h+24)·k, (h+48)·k)` | **Grey strip:** 16 patches of grey `round(255·i/15)`, i = 0…15. Width `floor(w·k/16)`; the last patch takes the remainder. |
   | `[(h+60)·k, (h+84)·k)` | **Colour patches:** 4 equal patches (the last takes the remainder): lit-fur pink (that scene's median from B7-1, as 8-bit sRGB), #F1D6DA, (191, 0, 0), (0, 0, 191). Write the 4 values to `videoLayout.patches.rgb`. |
   | `[(h+96)·k, (2h+96)·k)` | A replicated to RGB |

   Write the frames to `web3d_seq/<scene>/<clip>/<tier>/NNNN.png`.
8. **`depart-rev`:** frame j = depart frame (N − 1 − j).
9. **`rig_<scene>.json` and the flow map.**
   - Blender exports, for the rest pose:
     - centreline samples every 0.05 D as `[x, y, depth, rOuterPx, breathW]` in master px, with breathW = sin(π·clamp((i − 2)/(56·0.85), 0, 1)) as in `bake()`;
     - the projected joints of Head and Spine_05 (base), the eye point and the snout tip.
   - For each pixel with A ≥ 0.05: take the front-most centreline sample whose projected distance is < 0.6 D, and set flow = (p − c)·0.022·breathW.
   - Dilate the flow by 4 px.
   - Store it as an 8-bit RGB PNG (R = x, G = y, B = 0) at half master resolution **over the whole stage**: value = 128 + 32·px, and 128 where there is no flow.
   - **QA:** H3 warped by +flow must match H3b after a σ = 1.5 px Gaussian low-pass, with mean |Δ| ≤ 2/255 on the body. If it does not, fix the sign or scale. If it still fails, write `breath.amp: 0`.
10. **Look mask** (8-bit, 0–255).
    - `Dmax` = max over cells ≠ neutral of the max-channel |cell − still|, in premultiplied 8-bit.
    - `R` = dilate(open(Dmax > 2, 2 px), 8 px), keeping only connected components within 4 D of the neutral eye.
    - `T` = union over all overlays of tongue α > 3.
    - `W` = R ∪ T ∪ (R rotated about `warp.pivot` by every angle in `rangeDeg`, in 2° steps).
    - `mask = clamp(1.6·gauss(W, σ = 8), 0, 1)`.
    - **Assert:** p99 of Dmax ≤ 4 wherever 0.02 < mask < 0.98. Otherwise dilate 8 px more and retry, up to 4 times.
    - `mask.rect` = bbox(mask > 1/255), snapped outward to 24. Store the mask as a grey PNG at half master resolution.
11. **Look rect and warp range.**
    - `look.rect` must contain `mask.rect` **and** the pre-image `R_−θ(mask ∩ {w > 0})` for every θ in `rangeDeg`.
    - Start with `rangeDeg` = hero [−12, +16], gauge [−30, +30]. Shrink it in 2° steps until both the pre-image and the warp envelope fit inside the cell region **without its 128 px margin** and inside the stage.
    - Write the final range.
12. **Warp parameters.** `pivot` = the projected base joint of Spine_05. `axis` = the unit vector from the pivot to the Head joint. `length` = their distance. `start` = 0.35 D (hero) or 0.25 D (gauge), in master px.
    - **Assert:** the mask feather lies where breathW < 0.25.
13. **Atlases.**
    - Look: cells in row-major order, `cols × rows`, with 4 tier-px padding and the edge texels replicated into the padding.
    - Tongue: one row per cell, columns e1 e2 e3 f1 f2. Every overlay uses the same `slot` size, positioned per cell by `origins[i]`.
    - All atlases are straight-alpha PNGs (P/A where A > 0, 0 elsewhere), ≤ 4096 px per side.
    - **`rest_<T>.png` covers the whole stage** (A = 0 padding).
14. **Anchors.**
    - `aeBox`: bbox of the body (A ≥ 0.5, snake only, no shadow) from the snout to the end of the «e» loop.
    - `eye`, `snout`, `headDir`.
    - `silhouetteBottom`: per 48 px column of the stage, the lowest y with A ≥ 0.5.
    - **`look.envelopeTop`:** the min y of pixels with A ≥ 3/255 in the rest still, in every cell and in every tongue overlay. Each of these is also taken warped about `warp.pivot` by every θ in `rangeDeg` (2° steps). The web side lifts its hint above this line.
    - Gauge: `ringCenter`, `ringRadius`, `trackHalfWidth`, `coilRadius`, `coilOuterRadius`, `exitRamp`.
    - `tipX` = clamp(eye x as a fraction of the gauge box + 0.10, 0.55, 0.85). The gauge box is the ring centre ± 487.5 master px.
15. **Asserts.** The packer fails loudly and names the frame.
    - **Continuity at each shipped tier,** for H1 frame 83 vs H3, H2 frame 0 vs H3, and G1 frame 95 vs G3. Low-pass both images with a Gaussian of σ = 1.5 tier px, then check two areas separately: inside the snake mask (A ≥ 0.5, dilated 8 px) and on the shadow-only area.
      - mean |Δ| ≤ 2/255 and p99 ≤ 10/255, for colour and for α;
      - the A = 0.5 contours agree within 1 tier px at p95;
      - sharpness ratio clip/still (Laplacian variance on the snake) ≥ 0.8.

      If only the sharpness ratio fails: re-render H1 frames 78–83, H2 frames 0–2 and G1 frames 90–95 with the still settings (150 %, 160 spp; the snake is nearly still there, so motion blur is irrelevant), and downsample them like clips.
    - **Empty frames** (max A ≤ 3/255): H1 frames 0–2, H2's last frame, G1 frame 0.
    - **Neutral cell** (hero cell 2, gauge cell 5) vs the still inside `look.rect`: mean |Δ| ≤ 2/255.
    - **Rect gate:** outside `R`, every cell equals the still with max |Δ| ≤ 3/255 after a 2 px morphological opening.
    - **Frame counts:** 84 / 48–60 / 96.
    - **Frame-edge rule** (B7-5) for the gauge, and the same rule for H1, H2 and H3 on the top, bottom and left edges.
    - **Crop rules and macroblock gate** (B9).
16. **Outputs of `--stage pack`:**
    - per scene and tier: `rest_<T>.png`, `look_<T>.png`, `tongue_<T>.png`;
    - per scene: `mask.png` and `flow.png` (half master);
    - the clip PNG sequences;
    - `manifest.json` without `files`, `probe` or `build`;
    - QA sheets.

    PNGs are written with a minimal zlib PNG writer: **no gAMA, sRGB or iCCP chunks**.

## B9. Crop and containment rules

1. **Rect units.** Still, cell, tongue and mask rects are multiples of 24 master px. **Clip rects are multiples of 96 in all four values**, snapped outward. The frame is 22×96 by 14×96, so they always stay inside it. Every S and M video dimension, and both region boundaries inside the stacked frame, are then multiples of 16.
2. **Rect content.** A rect = bbox of A ≥ 3/255 over all its frames, plus 16 px, snapped outward. The stage = the union of all rects in the scene. **`rest.still.rect == rest.flow.rect == stage`.**
3. **Edge margin.** Within 24 px of a rect edge, A < 3/255, except on exit edges: the hero's right edge (x = 2112, the frame edge) and the gauge's right edge (the end of the exit ramp). Non-exit frame edges also follow the 48 px rule (B7-5).
4. **Containment.**
   - `mask.rect ⊆ look.rect`.
   - The warp pre-image ⊆ `look.rect` (B8-11).
   - Every tongue rect ⊆ `mask.rect`.
   - `look.rect` ⊆ the cell region without its margin.
   - Everything ⊆ stage.
5. **Render regions** = rect + 128 px, so the denoiser has context. Never use pixels from a region's margin.
6. **No breathing in the head layers.** Cells and overlays never breathe. The mask feather lies where breathW < 0.25 and where `dot(q − pivot, axis) < start` (no warp).
7. **Macroblock gate.** Every S and M stacked clip must be ≤ 8192 macroblocks (⌈w/16⌉·⌈h/16⌉; H.264 level 4.x MaxFS) and ≤ 245,760 MB/s at 30 fps.
   - Expected sizes: hero M intro 1152×1600 = 7200 MBs; gauge M arrive 1088×1856 = 7888 MBs.
   - If the gauge fails, move `exitRamp` in by 96 px and re-pack.
   - L clips are exempt: they are desktop-only and may use level 5.1.

## B10. Encoding (`encode_web3d.ps1`) and finalize

```powershell
# encode_web3d.ps1 - run in C:\Users\vladk\ae-studio after:
#   blender -b --factory-startup --python blender\web3d_pack.py -- --stage pack
# all:        powershell -NoProfile -ExecutionPolicy Bypass -File blender\encode_web3d.ps1
# one clip:   powershell -NoProfile -ExecutionPolicy Bypass -File blender\encode_web3d.ps1 -Only hero/S/intro -Codec av1 -Crf 38
# one image:  powershell -NoProfile -ExecutionPolicy Bypass -File blender\encode_web3d.ps1 -Only hero/M/look -WebpQ 78
param([string]$Only = '', [string]$Codec = '', [int]$Crf = 0, [int]$WebpQ = 0)
$ErrorActionPreference = 'Stop'
$env:SVT_LOG = '1'                                     # SVT-AV1: errors only on stderr
$FFX  = 'ffmpeg.exe'                                   # ffmpeg 9 full build, on PATH
$ROOT = 'C:\Users\vladk\ae-studio'
$SEQ  = "$ROOT\web3d_seq"                              # packer PNGs (not shipped)
$OUT  = "$ROOT\web3d_enc"                              # plain-named encodes; finalize hashes them into web3d\
$TAGS = @('-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-color_range','tv','-movflags','+faststart','-an')
$VF   = 'scale=out_color_matrix=bt709:out_range=tv:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv420p'
$CrfStart  = @{ av1 = 36; hevc = 27; h264 = 22 }       # ceilings av1 42, hevc 32, h264 27. Never call this $CRF: PowerShell names ignore case.
$WebpStart = [ordered]@{ rest = 82; look = 82; tongue = 80 }

function Run-FF([string[]]$A) { & $FFX $A; if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed: $($A -join ' ')" } }
function Want([string]$id, [string]$c) { ($Only -eq '' -or $Only -eq $id) -and ($Codec -eq '' -or $Codec -eq $c) }
function Q([string]$c) { if ($Crf -gt 0) { "$Crf" } else { "$($CrfStart[$c])" } }

function Enc-Clip([string]$scene, [string]$clip, [string]$tier) {
  $src = "$SEQ\$scene\$clip\$tier"
  if (-not (Test-Path "$src\0000.png")) { return }      # tier not produced (L clips are optional)
  $id = "$scene/$tier/$clip"; $dir = "$OUT\$scene\$tier"; New-Item -ItemType Directory -Force $dir | Out-Null
  $in = @('-y','-hide_banner','-loglevel','error','-framerate','30','-start_number','0','-i',"$src\%04d.png",'-vf',$VF)
  if (Want $id 'av1')  { Run-FF ($in + @('-c:v','libsvtav1','-preset','4','-crf',(Q 'av1'),'-g','300','-svtav1-params','tune=0:scd=0') + $TAGS + @("$dir\$clip.av1.mp4")) }
  if (Want $id 'hevc') { Run-FF ($in + @('-c:v','libx265','-preset','slow','-crf',(Q 'hevc'),'-tag:v','hvc1','-x265-params','keyint=300:min-keyint=300:scenecut=0:open-gop=0:log-level=error') + $TAGS + @("$dir\$clip.hevc.mp4")) }
  if (Want $id 'h264') { Run-FF ($in + @('-c:v','libx264','-preset','slow','-crf',(Q 'h264'),'-profile:v','high','-refs','4','-g','300','-bf','2','-x264-params','scenecut=0') + $TAGS + @("$dir\$clip.h264.mp4")) }
}
function Enc-Webp([string]$scene, [string]$name, [string]$tier) {
  $id = "$scene/$tier/$name"; $src = "$SEQ\$scene\${name}_$tier.png"
  if ($Codec -ne '' -or -not ($Only -eq '' -or $Only -eq $id) -or -not (Test-Path $src)) { return }
  $q = if ($WebpQ -gt 0) { $WebpQ } else { $WebpStart[$name] }
  $dir = "$OUT\$scene\$tier"; New-Item -ItemType Directory -Force $dir | Out-Null
  # bgra in: libwebp does RGB->YUV itself (ffmpeg's "Using libwebp for RGB-to-YUV" note is expected)
  Run-FF @('-y','-hide_banner','-loglevel','error','-i',$src,'-frames:v','1','-c:v','libwebp','-pix_fmt','bgra','-quality',"$q",'-compression_level','6',"$dir\$name.webp")
}

foreach ($t in 'S','M','L') {
  foreach ($c in @('hero:intro','hero:depart','hero:depart-rev','gauge:arrive')) { $p = $c.Split(':'); Enc-Clip $p[0] $p[1] $t }
  foreach ($s in 'hero','gauge') { foreach ($n in $WebpStart.Keys) { Enc-Webp $s $n $t } }
}
if ($Only -eq '') {
  foreach ($s in 'hero','gauge') { Copy-Item "$SEQ\$s\mask.png","$SEQ\$s\flow.png" "$OUT\$s\" }
  # 1-frame probe for the player's blocked-autoplay test; finalize embeds it as manifest.probe
  Run-FF @('-y','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=16x16:r=30','-frames:v','1','-c:v','libx264','-profile:v','baseline','-pix_fmt','yuv420p','-movflags','+faststart','-an',"$OUT\probe.mp4")
}
# then:  blender -b --factory-startup --python blender\web3d_pack.py -- --stage finalize
```

**Notes on the script**
- **Execution policy.** Run it with `-ExecutionPolicy Bypass`; the default Windows policy blocks `.ps1` files.
- **Argument passing.** Arguments travel as string arrays. Never type `-c:v …` as bare words to a PowerShell function: PowerShell treats them as parameter tokens and drops the `-c:`.
- **Colour matrix.** `out_color_matrix=bt709` is required. swscale's default RGB→YUV matrix is BT.601, which would shift colours against the BT.709 tags.
- **Keyframes.** One clip per file, so frame 0 is the only keyframe. Forced keyframes are not needed.
- **H.264 refs.** `-refs 4` keeps the largest M clip (7888 MBs) inside level 4.0's DPB. Without it, x264 bumps the stream to level 5.0.
- **WebP pixel format.** If this ffmpeg build rejects `-pix_fmt bgra` for libwebp, use `yuva420p`.

**Finalize** (`--stage finalize`)
1. **Probe every video** with `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,profile,level,width,height,nb_frames -of json`.
2. **Codec strings** come from ffprobe's `level` exactly as printed:
   - **HEVC:** `hvc1.1.6.L<level>.B0` (the level is already general_level_idc, e.g. 93 or 120). Assert it is in {30, 60, 63, 90, 93, 120, 123, 150, 153, 156, 180, 183, 186}.
   - **AV1:** `av01.0.<level, 2 digits>M.08`.
   - **H.264:** `avc1.6400<level as 2-digit uppercase hex>` (31 → 1F, 32 → 20, 40 → 28). For S and M, assert level ≤ 40 and that MaxFS, MaxMBPS and DPB fit.
   - Each string must match `^av01\.0\.\d\dM\.08$`, `^hvc1\.1\.6\.L\d+\.B0$` or `^avc1\.6400[0-9A-F]{2}$`.
3. **Hash and ship.** Copy every encode, mask and flow file into `web3d\` as `<name>.<h8>.<ext>`, where h8 = the first 8 hex digits of the SHA-1 of the content (e.g. `intro.9b0f3d71.av1.mp4`).
   - Write `manifest.files[<logical key>] = {file, bytes, codec, size, frames}` (M4).
   - Also copy `hero\M\rest.webp` **unhashed** (for the no-JS and manifest-failure fallback).
   - Delete files in `web3d\` that the manifest does not reference.
4. **Decode check,** for each video: decode frames 0 and N−1 to PNG with `-vf scale=in_color_matrix=bt709:in_range=tv,format=rgb24`.
   - The 16 strip patches must read 17·i ± 3.
   - The colour patches must be within ±4 per channel of `patches.rgb`.
   - Frame N−1 of `intro`/`arrive` and frame 0 of `depart` must match the rest still at that tier, using the B8-15 low-pass metric with limits mean ≤ 3/255 and p99 ≤ 12/255 (codec loss allowed).
5. **Byte caps** (M6).
   - For each file over its cap, print the re-run command with CRF +2 (AV1, HEVC) or +1 (H.264).
   - At the CRF ceiling, print a `-WebpQ` re-run that lowers that scene/tier's WebP quality by 4 (minimum 70).
   - If a file is still over at the ceiling, report it. **Never raise a cap.**
6. **Manifest extras.** `probe` = `data:video/mp4;base64,` + base64 of `probe.mp4`; `fallback` = `"hero/M/rest.webp"`; stamp `build` (UTC ISO time).
7. Write `web3d_qa\encode_report.json`.

**Placeholder for the web session.** Deliver this before any final render. It is built from `a.webm`, with no strip:

```
ffmpeg -c:v libvpx-vp9 -i a.webm -filter_complex "[0]format=rgba,premultiply=inplace=1,format=rgba,split[c][a];[a]alphaextract,format=rgb24[al];[c]format=rgb24,pad=iw:ih+96:0:0:black[cp];[cp][al]vstack,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p" -c:v libx264 -crf 20 -an -color_primaries bt709 -color_trc bt709 -colorspace bt709 -color_range tv -movflags +faststart placeholder.h264.mp4
ffmpeg -c:v libvpx-vp9 -i a.webm -frames:v 1 -c:v libwebp -pix_fmt bgra -quality 82 rest.webp
ffmpeg -f lavfi -i color=c=black:s=16x16:r=30 -frames:v 1 -c:v libx264 -profile:v baseline -pix_fmt yuv420p -movflags +faststart -an probe.mp4
```

Write the placeholder manifest by hand, using plain (unhashed) file names:
- `frame` = `stage` = `rest.still.rect` = `[0, 0, 1280, 720]`;
- `tiers: {"M": 1}`, `clipRenderScale: 1`, `clipTiers: ["M"]`;
- `videoLayout: {gutter: 96, strip: null, patches: null, …}`;
- `pxPerD`, `aeBox`, `eye`, `snout` and `headDir` measured by hand on frame 0;
- `clips.intro = {frames: 180, rect: [0, 0, 1280, 720], from: "rest", to: "rest"}`;
- `files` keys mapped to the plain files;
- `probe` from `probe.mp4`;
- `look`, `look.tongue` and `rest.flow` set to `null`; no `depart`; no gauge.

## B11. Output layout

```
C:\Users\vladk\ae-studio\
  renders\web3d\            raw EXR + region.json per shot (not shipped)
    hero_intro\0000-0083.exr  hero_depart\0000-0047.exr  hero_rest\0000.exr  hero_rest.png  hero_rest_breath\0000.exr
    hero_look\c00-c14.exr  hero_tongue\c00_e1 … c14_f2.exr
    gauge_arrive\0000-0095.exr  gauge_rest\0000.exr  gauge_rest_breath\0000.exr  gauge_look\c00-c10.exr  gauge_tongue\…
    rig\rig_hero.json  rig\rig_gauge.json
  web3d_seq\                packer PNG intermediates (not shipped)
  web3d_enc\                plain-named encodes + probe.mp4 (not shipped)
  web3d\                    SHIPPED -> repo assets\snake3d\ (same tree)
    manifest.json
    hero\S|M|L\   rest.<h8>.webp  look.<h8>.webp  tongue.<h8>.webp
    hero\M\       rest.webp                                   (unhashed fallback copy)
    hero\S|M\     intro.<h8>.{av1,hevc,h264}.mp4  depart.<h8>.….mp4  depart-rev.<h8>.….mp4
    hero\         mask.<h8>.png  flow.<h8>.png
    gauge\S|M|L\  rest.<h8>.webp  look.<h8>.webp  tongue.<h8>.webp
    gauge\S|M\    arrive.<h8>.{av1,hevc,h264}.mp4
    gauge\        mask.<h8>.png  flow.<h8>.png
  web3d_qa\                 sheets, diffs, previews, encode_report.json, timing.json, og_1200x630.jpg
  blender\                  snake_scene.py snake_anim.py <path tool> snake_gauge.py web3d_pack.py encode_web3d.ps1
```

## B12. Order of work, render budget, decision gate

1. **Timing probe.** Render H1 frame 40 at final settings (100 %) and H3 at 150 %. `timing.json` records seconds per frame, **peak VRAM**, and the projection below.
2. **Animatic.** H1, H2 and G1 at 25 % (352×224), 16 samples, fur density 5000, no motion blur.
   - Run the B4 roll asserts.
   - Encode over #F1D6DA and #1E1618.
   - Get the user's approval on timing, path and the H2 smear choice (B5).
3. **Rest set first.** H3, H3b, H4, H5, G3, G3b, G4, G5 → pack → encode → finalize, with `clips: {}`. Ship this to the web session; it integrates the rest compositor before any clip exists.
4. **Hero clips:** H1 and H2 finals.
5. **Gauge clip:** G1 final.
6. **Optional L clips.** If the probe projects ≤ 6 h for H1 + H2 + G1 at 150 %, render them overnight and set `clipTiers: ["S","M","L"]`. Otherwise ship with `["S","M"]`.

**Render estimate.** It assumes 15–40 s per full 1408×768 frame at 64 spp. Clip regions cover about 0.88 of the frame; cell regions cover 0.34–0.44.

| Item | Cost per item | Total |
|---|---|---|
| Clip frames at 100 % | ≈ 20–53 s | 228 frames ≈ 1.3–3.4 h |
| Stills (150 %, 160 spp) | 85–225 s | 6 stills ≈ 10–25 min |
| Cells | 29–100 s | 26 cells ≈ 15–45 min |
| Tongue overlays (only the Tongue re-syncs) | 8–20 s | 130 overlays ≈ 17–45 min |
| **v1 total** | | **≈ 2.0–5.1 h** |
| Optional L clip pass | | +2.9–7.6 h |

## B13. What to return to the web session

- `web3d\`, unchanged.
- `web3d_qa\`, containing:
  - the rest stills on #F1D6DA and over `diva-hero-d.png`;
  - the gauge rest on #1E1618 with a 390 px ring outline at (720, 672);
  - look and tongue contact sheets;
  - clip previews composited from the **decoded M files** on both backgrounds;
  - the H3 vs G3 head sheet;
  - roll-assert plots;
  - `encode_report.json` and `timing.json`.
- The scripts in `blender\`; they will be committed to `dev/blender/`.

## B14. Optional v1.1: footer peek (do not render for v1)

- CamFooter: same lens and height as CamHero, framed 4 D × 6 D. Warm pink key light from the top left, to match `fur.jpg`.
- She rises from below the footer's bottom edge on the right with about 6 D of neck: looks left, looks at the viewer, flicks twice, sinks back.
- 240 frames looping; frames 0 and 239 are empty. Contact shadow at 50 %.
- M tier only, ≤ 500 KB AV1.

## B15. Blender-side unknowns

1. **Motion blur on hair** driven by "Deform Curves on Surface". Check 3 frames of H1. If the fur streaks or doubles, turn off deformation blur on the fur object only (object blur stays on) and note it in `timing.json`.
2. **Catcher shadow already in Combined:** settled once by the B8-3 check.
3. **Denoiser temporal stability at 64 spp:** if the finals boil, use 96 spp for clips.
4. **Render time and VRAM:** settled by the timing probe (B12).
5. **The roll field** (B4-3). If no ramp placement satisfies the dorsal-up assert without a visible twist on the letters, send a contact sheet before rendering the finals.

# MANIFEST

This section is part of both briefs. The Blender packer writes `assets/snake3d/manifest.json`; finalize adds `files`, `probe`, `fallback` and `build`. The web side never edits the file.

## M1. Glossary and units

- **D**: outer body diameter including fur. 1 D = 1 Blender unit (`snake_scene.py`: outer radius 0.5). The body is 34.3 D long.
- **master px**: one pixel of a scene's master frame, 2112×1344 at 156 px/D. Origin at the top left, y down. All manifest geometry is in master px.
- **clip px**: one pixel of a clip render at 100 % (1408×896, 104 px/D). 1 clip px = 1.5 master px.
- **Tier S, M, L**: ½, ⅔ and 1 × master, i.e. 78, 104 and 156 px/D.
  - Stills, cells and tongue overlays ship at S, M and L.
  - Clips ship at S and M; M equals clip px 1:1.
- **stage**: the union of every rect a scene uses. It is the canvas extent, and the rest still covers exactly the stage.
- **stacked-alpha frame**: an opaque video frame laid out top to bottom as:
  1. premultiplied colour (h rows);
  2. a 96 master-px gutter containing a 16-step grey strip and 4 colour patches;
  3. alpha stored as grey (h rows).
- **cell**: a pre-rendered crop of the head and neck at one look angle (yaw for the hero, nod for the gauge).
- **tongue overlay**: an RGBA render that contains only the tongue, for one cell.
- **exit edge**: the one frame edge that content may touch (the right edge in both scenes).
- **macroblock (MB)**: a 16×16 block. H.264 level 4.x allows ≤ 8192 MBs per frame.

## M2. Conventions

- Rects are `[x, y, w, h]` in master px of the scene frame; points are `[x, y]`. Frames are 0-based, times in seconds, angles in degrees.
- Tier size of any rect = master × `tiers[T]`. A clip's stacked size = `w·k × (2h + gutter)·k`, with k = `tiers[T]`.
- **Files.**
  - Keys of `files` are logical paths: `<scene>/<tier>/<name>` (e.g. `hero/S/intro.av1.mp4`, `hero/S/rest.webp`) or `<scene>/<name>` (`hero/mask.png`).
  - The URL is `assets/snake3d/` + `files[key].file`.
  - Hashed files are immutable: fetch them with `cache: 'force-cache'`.
  - The scene sections name files by leaf (`"rest.webp"`); resolve the leaf through `files`.
- **Optional sections** may be `null` or absent: `look`, `look.tongue`, `rest.flow`, any clip, the whole `gauge` scene, `videoLayout.strip`, `videoLayout.patches`. The player degrades accordingly: no look, no breath, opacity fades, no gauge, identity LUT, no matrix check.

## M3. Example

The numbers below are plausible estimates; the packer writes the real ones. In the real file:
- `silhouetteBottom.y` has 37 entries;
- hero `tongue.origins` has 15 entries and gauge `tongue.origins` has 11;
- `files` lists every shipped file;
- `probe` is the complete data URI.

```json
{
  "schema": "ae-snake3d/1",
  "build": "2026-11-12T03:10:00Z",
  "generator": "web3d_pack.py · Blender 5.1.2 · Cycles OptiX · denoiser OIDN",
  "fps": 30,
  "pxPerD": 156,
  "tiers": { "S": 0.5, "M": 0.6666667, "L": 1 },
  "clipRenderScale": 0.6666667,
  "clipTiers": ["S", "M"],
  "videoLayout": {
    "gutter": 96,
    "strip": { "y": 24, "h": 24, "steps": 16 },
    "patches": { "y": 60, "h": 24, "rgb": [[226, 140, 160], [241, 214, 218], [191, 0, 0], [0, 0, 191]] },
    "premultiplied": true, "matrix": "bt709", "range": "tv"
  },
  "probe": "data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28y…",
  "fallback": "hero/M/rest.webp",
  "scenes": {
    "hero": {
      "frame": [2112, 1344],
      "camera": { "name": "CamHero", "type": "persp", "lensMm": 85, "pitchDownDeg": 7, "base": [1408, 896] },
      "stage": [360, 96, 1752, 1152],
      "exit": "right",
      "anchors": {
        "aeBox": [500, 306, 1051, 756],
        "eye": [660, 450], "snout": [552, 486], "headDir": [-0.951, 0.309],
        "silhouetteBottom": { "x0": 360, "step": 48, "y": [1010, 1048, 1062, 1060, 1051, 1040] }
      },
      "rest": {
        "still": { "file": "rest.webp", "rect": [360, 96, 1752, 1152] },
        "flow": { "file": "flow.png", "rect": [360, 96, 1752, 1152], "fileScale": 0.5, "zero": 128, "pxPerUnit": 32 },
        "breath": { "periodS": 3.6, "amp": 0.8 }
      },
      "look": {
        "axis": "yaw",
        "angles": [-10, -5, 0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60],
        "neutral": 2,
        "rect": [384, 168, 552, 504],
        "envelopeTop": 270,
        "atlas": { "file": "look.webp", "cols": 5, "rows": 3, "pad": 4 },
        "mask": { "file": "mask.png", "rect": [432, 240, 456, 384], "fileScale": 0.5 },
        "warp": { "pivot": [840, 402], "axis": [-0.995, 0.1], "start": 55, "length": 300, "rangeDeg": [-12, 16], "positive": "cw" },
        "tongue": {
          "atlas": { "file": "tongue.webp", "cols": 5, "rows": 15, "pad": 4 },
          "slot": [168, 120],
          "frames": ["e1", "e2", "e3", "f1", "f2"],
          "origins": [[432, 432], [434, 434], [436, 436]],
          "single": [0, 1, 2, 3, 4, 3, 4, 2, 1, 0],
          "double": [0, 1, 2, 3, 4, 3, 4, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1, 0]
        }
      },
      "clips": {
        "intro":      { "frames": 84, "rect": [384, 96, 1728, 1152],  "from": "empty", "to": "rest", "events": { "written": 70 } },
        "depart":     { "frames": 48, "rect": [384, 192, 1728, 1056], "from": "rest", "to": "empty", "events": { "unwritten": 2 }, "reverse": "depart-rev" },
        "depart-rev": { "frames": 48, "rect": [384, 192, 1728, 1056], "from": "empty", "to": "rest" }
      }
    },
    "gauge": {
      "frame": [2112, 1344],
      "camera": { "name": "CamGauge", "type": "ortho", "orthoScaleD": 13.538 },
      "stage": [96, 0, 1632, 1344],
      "exit": "right",
      "anchors": {
        "ringCenter": [720, 672], "ringRadius": 390, "trackHalfWidth": 41, "coilRadius": 520, "coilOuterRadius": 598,
        "eye": [866, 214], "snout": [790, 196], "headDir": [-0.966, -0.259], "exitRamp": [1440, 1680], "tipX": 0.75
      },
      "rest": {
        "still": { "file": "rest.webp", "rect": [96, 0, 1632, 1344] },
        "flow": { "file": "flow.png", "rect": [96, 0, 1632, 1344], "fileScale": 0.5, "zero": 128, "pxPerUnit": 32 },
        "breath": { "periodS": 3.6, "amp": 0.8 }
      },
      "look": {
        "axis": "nod",
        "angles": [15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65],
        "neutral": 5,
        "rect": [576, 24, 624, 528],
        "envelopeTop": 72,
        "atlas": { "file": "look.webp", "cols": 4, "rows": 3, "pad": 4 },
        "mask": { "file": "mask.png", "rect": [624, 48, 504, 432], "fileScale": 0.5 },
        "warp": { "pivot": [1095, 297], "axis": [-0.94, -0.34], "start": 40, "length": 260, "rangeDeg": [-25, 25], "positive": "cw" },
        "tongue": {
          "atlas": { "file": "tongue.webp", "cols": 5, "rows": 11, "pad": 4 },
          "slot": [168, 168],
          "frames": ["e1", "e2", "e3", "f1", "f2"],
          "origins": [[672, 96], [674, 92]],
          "single": [0, 1, 2, 3, 4, 3, 4, 2, 1, 0],
          "double": [0, 1, 2, 3, 4, 3, 4, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1, 0]
        }
      },
      "clips": {
        "arrive": { "frames": 96, "rect": [96, 0, 1632, 1344], "from": "empty", "to": "rest", "events": { "arrived": 95 } }
      }
    }
  },
  "files": {
    "hero/S/rest.webp":        { "file": "hero/S/rest.5c1e09a2.webp",        "bytes": 72400,  "size": [876, 576] },
    "hero/S/intro.av1.mp4":    { "file": "hero/S/intro.9b0f3d71.av1.mp4",    "bytes": 301500, "codec": "av01.0.05M.08",    "size": [864, 1200],  "frames": 84 },
    "hero/S/intro.hevc.mp4":   { "file": "hero/S/intro.41d7ce08.hevc.mp4",   "bytes": 378200, "codec": "hvc1.1.6.L120.B0", "size": [864, 1200],  "frames": 84 },
    "hero/S/intro.h264.mp4":   { "file": "hero/S/intro.e2a6b915.h264.mp4",   "bytes": 512900, "codec": "avc1.640020",      "size": [864, 1200],  "frames": 84 },
    "hero/M/intro.av1.mp4":    { "file": "hero/M/intro.70c3aa5e.av1.mp4",    "bytes": 539800, "codec": "av01.0.08M.08",    "size": [1152, 1600], "frames": 84 },
    "hero/mask.png":           { "file": "hero/mask.0d4b2e7c.png",           "bytes": 9100,   "size": [228, 192] },
    "gauge/M/arrive.hevc.mp4": { "file": "gauge/M/arrive.c81f02d4.hevc.mp4", "bytes": 815000, "codec": "hvc1.1.6.L120.B0", "size": [1088, 1856], "frames": 96 }
  }
}
```

## M4. Fields

| Field | Unit | Meaning |
|---|---|---|
| `fps`, `pxPerD` | — | 30; master px per D (156). |
| `tiers` | factor | Tier px per master px. |
| `clipRenderScale` | factor | Clip render px per master px (⅔: clips render at 100 %). |
| `clipTiers` | list | Tiers that have clips. The player uses min(scene tier, highest listed). |
| `videoLayout.gutter`, `strip.y/h`, `patches.y/h` | master px | Gutter rows below the colour half; scaled by k at each tier. `strip: null` = identity LUT (placeholder). |
| `videoLayout.patches.rgb` | 8-bit sRGB | The 4 colour patches as written: lit-fur pink, #F1D6DA, 75 % red, 75 % blue. `null` = skip the matrix check. |
| `probe` | data URI | 1-frame, 16×16 H.264 MP4 for the blocked-autoplay probe. |
| `fallback` | logical path | Unhashed hero M still, for no-JS and manifest failure: `assets/snake3d/hero/M/rest.webp`. |
| `stage` | rect | Canvas extent of the scene; everything is inside it. |
| `exit` | edge | The one edge content may touch. |
| `anchors.aeBox` | rect | Body bbox from the snout to the end of the «e»; drives the hero fit. |
| `anchors.eye`, `snout`, `headDir` | px, unit vector | Neutral eye and snout positions and the screen direction of the snout. |
| `anchors.silhouetteBottom` | px | Lowest y with A ≥ 0.5 per 48-px column; QA of the «studio» overlap. |
| `ringCenter`, `ringRadius`, `trackHalfWidth`, `coilRadius`, `coilOuterRadius` | px | `ringRadius` maps onto the SVG track (r = 0.4 × gauge width). |
| `exitRamp` | px | x range over which the gauge trail fades to 0. |
| `tipX` | fraction of gauge width | x where tip chips pop (beside the head). |
| `rest.still` | rect | Equals `stage` (transparent padding). |
| `rest.flow` | RGB8 | Breath displacement in master px = (v·255 − zero)/pxPerUnit, at breath = +1. Rect = `stage`; stored at `fileScale`. |
| `rest.breath` | s, factor | Period and amplitude; `amp: 0` disables breathing. |
| `look.rect` | rect | Cell crop, the same for all cells. Contains `mask.rect` and the warp pre-image. |
| `look.envelopeTop` | px | Highest y (smallest value) any composited head pixel can reach across all cells, tongues and warps. |
| `look.atlas` | — | Cells in row-major order with `pad` tier-px padding; edge texels replicated. |
| `look.mask` | rect, PNG | Feathered replace mask, stored at `fileScale`. |
| `look.warp` | px, deg | w(q) = smoothstep(start, start + length, dot(q − pivot, axis)). The image rotates by θ·w about `pivot`; θ is clamped to `rangeDeg`; + = clockwise on screen. |
| `look.tongue.slot`, `origins[i]` | px | Overlay rect of cell i = [origins[i], slot]. |
| `single`, `double` | indices | Tongue flick sequences at 30 fps, indexing into `frames`. |
| `clips.*.rect` | rect | Multiples of 96. |
| `clips.*.events` | frame | Frames at which DOM events fire. |
| `clips.*.reverse` | key | The clip that is this one reversed. |
| `files[key]` | — | `file` (hashed path under `assets/snake3d/`), `bytes`, `codec` (for `canPlayType` and `decodingInfo`), `size` (video or image px), `frames`. |

## M5. Invariants

The packer asserts these; the player checks them under `?snake3d=debug`.
- All rects are multiples of 24 and lie inside the stage; clip rects are multiples of 96.
- `rest.still.rect == rest.flow.rect == stage`.
- `mask.rect ⊆ look.rect`; tongue rects ⊆ `mask.rect`.
- Atlas sides ≤ 4096.
- S and M stacked clips are ≤ 8192 MBs and ≤ 245,760 MB/s at 30 fps.
- Each clip's last frame (`to: rest`) or first frame (`from: rest`) matches the rest still (B8-15 metric).
- Every `files[*].file` exists in the shipped tree.

## M6. Byte caps (hard; KB = 1000 bytes; AV1)

HEVC caps are AV1 × 1.25; H.264 caps are × 1.7. Expect real files 20–30 % under the cap. If the user picks the 110-frame H2 at the animatic gate, the depart caps are × 2.2.

| Asset | S | M | L |
|---|---|---|---|
| hero rest.webp | 80 | 130 | 260 |
| hero look.webp (15 cells) | 150 | 270 | 580 |
| hero tongue.webp (75) | 55 | 90 | 180 |
| hero mask + flow (one set) | 20 | 20 | 20 |
| hero intro (84 frames) | 340 | 600 | 1250 (only if L clips exist) |
| hero depart / depart-rev (each, ≤ 60 frames) | 200 | 350 | 720 |
| gauge rest.webp | 90 | 150 | 300 |
| gauge look.webp (11) | 110 | 200 | 420 |
| gauge tongue.webp (55) | 40 | 65 | 130 |
| gauge mask + flow | 20 | 20 | 20 |
| gauge arrive (96 frames) | 400 | 700 | 1450 (only if L clips exist) |

# WEB BRIEF

**For:** the web session that builds the player and integrates it into the DIVA landing page.

**Send this brief together with the `# MANIFEST` section; it is part of this brief.** Section numbers W… belong to this brief; M… numbers refer to the MANIFEST.

## W0. Context

- **Project.** "ae studio" is a landing page (Russian copy) recruiting women 18+ for a webcam studio. It is a static site with no build step and no frameworks, hosted on GitHub Pages.
- **Approved layout ("DIVA").**
  - Worktree: `/tmp/claude-0/-home-user-Soho-Gang/71cd1814-2375-5e57-ac15-4493bcc781ae/scratchpad/diva-wt`, commit `8093dd6`, branch `claude/ae-diva-structure`. Line numbers below refer to that commit.
  - Brand brief: `/home/user/Soho-Gang/docs/site-prompt.md`, section «Главная анимация».
  - Screenshots of today's page: `…/scratchpad/diva-hero-d.png` (1440×900 hero), `diva-income-d.png` (calculator), `diva-hero-m.png` (390 px phone).
- **Today.** `assets/js/snake.js` is a 2D canvas engine, mounted by `main.js` `initHero` (about L540, `mode: 'journey'`). A second snake wanders in the footer (about L1640).
- **Measured geometry.**
  - Desktop hero 1440×925; «studio» at x 970, y 529, 397×135.
  - Gauge 480×480 at x 801 (ring track r = 160 of a 400 viewBox).
  - Phone: hero 390 wide, logo in the top ~320 px, «studio» at x 176, y 273; gauge 310×310.
- **New.** A pre-rendered Cycles plush snake replaces the 2D one. The assets arrive from the Blender session as `assets/snake3d/**` plus `manifest.json` (M3).
  - **First delivery** is a placeholder from `a.webm`: one M-tier stacked H.264 clip used as `intro`, `strip: null`, no look/tongue/flow, no `depart`, no gauge. The player must run on it.
  - **Second delivery** is the rest set with `clips: {}`. **Then** the clips arrive.
- **What the brief asks for** (`docs/site-prompt.md`, «Главная анимация»):
  - She enters from the right and writes «ae» in about 2.8 s, then «studio» appears.
  - At rest she breathes, turns her head toward the cursor, and flicks her tongue every 3–6 s and when the cursor comes close.
  - On scroll she leaves the logo and coils around the income ring. Scrolling back up re-forms «ae».
  - With reduced motion she is a static logo.
- **Dropped by the user's decision:** the free cursor chase, the page-edge journey through the sections in between, and the footer wanderer.

**Web glossary**
- **p**: hero scroll progress. **p_g**: gauge scroll progress (W9).
- **p_hold**: p at the last entry into `rest`, lowered as the user scrolls up.
- **p0**: min(p_hold, 0.8), captured when a departure starts.
- **q**: departure progress = clamp((p − p0)/(1 − p0), 0, 1).
- **heroVis / gaugeVis**: visible ratio of the hero section / `.gauge`.
- **D_css**: one D in css px.
- **settled**: no scroll for 120 ms.
- **jumping**: an in-page anchor navigation is in progress (W9).
- **primed**: a clip whose first frame has been decoded, uploaded and calibrated (W7).
- **chase**: native playback at a variable rate toward a target frame derived from scroll.

## W1. Architecture

| File | Content | Budget |
|---|---|---|
| `index.html` `<head>` inline boot | Decides still or motion, picks the hero tier and codec, starts the manifest and intro downloads during parse (W2). | ≤ 4 KB source |
| `assets/js/snake3d.js` | The player. Plain IIFE, ES2017, no dependencies, no build. Exposes `window.AeSnake3D`. | ≤ 48 KB source, ≤ 15 KB gz |
| `assets/snake3d/**` | Manifest and media from the Blender session. | M6 |
| `dev/snake3d.html` | Test page (W16). | — |

**Modules inside `snake3d.js`**

| Module | Responsibility |
|---|---|
| `env` | Feature probes: WebGL1 with `highp` fragment precision, MediaCapabilities, rVFC, `saveData`/`effectiveType`, `(pointer: coarse)`/`(any-pointer: fine)`/`(hover: hover)`, DPR, a hidden `height: 100svh` probe element, iOS WKWebView detection (W12). Tier and codec rules (W3). |
| `net` | Hashed media: `fetch(url, {cache: 'force-cache', priority})` with AbortController, into a Blob. Images: Blob → object URL → `Image` + `img.decode()`. Cache by URL; concurrency 2. Consumes `window.__aeSnake3dBoot`. A 404 on a hashed file refetches the manifest once with `cache: 'reload'` and remounts that scene. |
| `gl` | One WebGL1 context per scene layer. Programs CLIP, REST and CALIB; texture helpers; calibration; crossfades; context loss and restore. |
| `Pool` | Exactly 3 `<video>` elements (hero A, hero B, gauge), created at mount, never removed; `src` is swapped. |
| `Clip` | Binds one pool element to one clip: load from Blob, prime, seek, play/pause wrapper, frame clock, texture upload, watchdog, chase controller for a forward/reverse pair. |
| `Rest` | Base, flow, mask, look and tongue textures; look springs; tongue sequencer; breath clock; `draw()`. |
| `HeroScene`, `GaugeScene` | Layer DOM, fit, state machine, events. |
| `Director` | `mount()`; main.js scroll and layout hubs; IntersectionObservers; jump detection; visibility, `pageshow`/`pagehide`; one-snake rule; load schedule; the single rAF loop. |

**API**

```js
const snake = AeSnake3D.mount({
  hero,                 // section[data-hero]
  gauge,                // .gauge[data-gauge] (optional)
  still: still(),       // main.js still(): reduced motion or paused (userStill)
  onScroll, onLayout,   // main.js hubs
  base: 'assets/snake3d/'
});                     // synchronous; never throws on a missing gauge or a manifest still in flight
snake.setStill(on);     // userStill: the pause button and live reduced-motion changes
snake.layout();         // force a refit
snake.state();          // see below
snake.destroy();
```

`state()` returns lower-case strings:

```js
{ hero: 'boot'|'wait'|'intro'|'rest'|'align'|'depart'|'gone'|'still',
  gauge: 'off'|'empty'|'arrive'|'rest'|'still',
  mode: 'motion'|'still', video: 'ok'|'blocked'|'broken',
  tier: { hero, gauge }, clipTier, codec }
```

**Events.** Bubbling `CustomEvent`s with `detail: {scene}`:
- dispatched on the hero section: `snake:written`, `snake:unwritten`;
- dispatched on `.gauge`: `snake:arrived`, `snake:departed`.

`written` and `arrived` fire only after the relevant still, `<img>` or GL upload has decoded (exception: hero still failure, W12).

**Listens to**
- `ae:income` on `document` (`detail.delta`);
- `pointermove` on `document` (passive; fine-pointer devices only);
- `pointerdown`, `pointerup`, `pointercancel` on the hero section and `.gauge` (taps, W10);
- `pointerdown` on `a[href="#income"]` (prefetch);
- `click` on `a[href^="#"]` (capture phase);
- `hashchange`;
- `scrollend` on `window`: the **only** scroll listener of its own; everything else comes through `onScroll`/`onLayout`;
- `visibilitychange`, `pageshow`, `pagehide`;
- the first real tap or keydown (unlock, W11).

**Writes to the page**
- `--s3d-x/-y/-w/-h` on each layer;
- `--logo-x/-y/-w/-h` and `--hint-y` on `.hero`;
- `gauge.dataset.snakeTipX`;
- `html.has-plush-ring`, `html.snake3d-still` / `html.snake3d-motion`;
- `.hero.is-snake-static`;
- `.snake3d.is-img`, `.snake3d--hero.is-fallback`;
- `sessionStorage['ae-s3d:y']` on `pagehide`.

**Debug query string**
- `?snake3d=debug`: overlay showing state, tier, codec, LUT fit and deviation, matrix verdict, frame index, dropped frames, cell index and the mask outline; checks the M5 invariants.
- `?snake3d=still|nogl|novideo|lpm`, plus `&tier=S|M|L&codec=av1|hevc|h264`: force paths for QA.

## W2. Boot script and loading order

**Placement:** `index.html`, immediately before L14 (the first `<link rel="preconnect">`), followed by the two preloads.

```html
<script>
/* snake3d boot (consumed by assets/js/snake3d.js as window.__aeSnake3dBoot): still/motion, hero tier + codec,
   starts manifest + intro during parse. Writes only one class on <html>. */
(function (w, d) {
  var B = w.__aeSnake3dBoot = { t0: performance.now() };
  try {
    var mm = function (q) { return !!(w.matchMedia && w.matchMedia(q).matches); };
    var c = navigator.connection || {}, ect = c.effectiveType || '', ss = null, paused = false, y0 = 0;
    try { paused = w.localStorage.getItem('ae-studio:motion-paused') === '1'; } catch (e) {}
    try { ss = w.sessionStorage; y0 = +ss.getItem('ae-s3d:y') || 0; } catch (e) {}
    var f = /[?&]snake3d=([^&]+)/.exec(location.search); B.force = f ? f[1] : '';
    B.envStill = !!c.saveData || /^(slow-2g|2g)$/.test(ect) || B.force === 'still';
    B.userStill = mm('(prefers-reduced-motion: reduce)') || paused;
    B.still = B.envStill || B.userStill; B.slow = ect === '3g';
    d.documentElement.classList.add(B.still ? 'snake3d-still' : 'snake3d-motion');
    var nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
    B.deep = /^#(?!top$|main$)./.test(location.hash) ||
             !!(nav && /^(reload|back_forward)$/.test(nav.type) && y0 > .3 * w.innerHeight);
    var ua = navigator.userAgent, ios = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    B.wkBlocked = ios && !/Safari\//.test(ua) && !/Instagram|FBAN|FBIOS|FBAV/.test(ua);
    var touch = B.touch = mm('(pointer: coarse)') && !mm('(any-pointer: fine)');
    B.manifest = fetch('assets/snake3d/manifest.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw r.status; return r.json(); })
      .then(function (m) { if (m.schema !== 'ae-snake3d/1') throw 'schema'; return m; });
    B.manifest.catch(function () {});
    B.heroTier = function (m) {                                   // = W3/W5, duplicated in snake3d.js on purpose
      var W = w.innerWidth, H = w.innerHeight, dpr = Math.min(w.devicePixelRatio || 1, 2);
      var bw = mm('(min-width: 960px)') ? Math.min(.5 * W, 1.85 * .5 * H) : W - 32;
      var need = 1.085 * (bw / 1.85) / m.scenes.hero.anchors.aeBox[3] * m.pxPerD * dpr / 1.2;
      var t = need <= 78 ? 'S' : need <= 104 ? 'M' : 'L';
      return B.slow ? 'S' : touch && t === 'L' ? 'M' : t;
    };
    function clipTier(t, m) { var o = 'SML', top = m.clipTiers[m.clipTiers.length - 1]; return o.indexOf(t) > o.indexOf(top) ? top : t; }
    B.pick = function (m, key) {                                  // AV1 -> HEVC -> H.264; parallel probes, 300 ms budget
      var ck = 'ae-s3d:codec:' + m.build + ':' + key, v = d.createElement('video'), mc = navigator.mediaCapabilities;
      var ks = ['av1', 'hevc', 'h264'], bad = '';
      try { var hit = ss && ss.getItem(ck); if (hit) return Promise.resolve(hit === '-' ? null : hit); bad = (ss && ss.getItem('ae-s3d:bad')) || ''; } catch (e) {}
      return Promise.all(ks.map(function (k) {
        var fi = m.files[key + '.' + k + '.mp4'], type = fi && 'video/mp4; codecs="' + fi.codec + '"';
        var cp = fi && bad.indexOf(k) < 0 ? v.canPlayType(type) : '';
        if (!cp) return false;
        if (k === 'h264') return true;
        var guess = cp === 'probably' && (k !== 'av1' || !touch);
        if (!mc) return guess;
        return Promise.race([
          mc.decodingInfo({ type: 'file', video: { contentType: type, width: fi.size[0], height: fi.size[1],
                            bitrate: Math.round(fi.bytes * 8 * 30 / fi.frames), framerate: 30 } })
            .then(function (x) { return x.supported && x.smooth && (x.powerEfficient || (k === 'av1' && !touch)); },
                  function () { return false; }),
          new Promise(function (r) { setTimeout(r, 300, guess); })
        ]);
      })).then(function (ok) {
        var k = ks[ok.indexOf(true)] || null;
        try { ss && ss.setItem(ck, k || '-'); } catch (e) {}
        return k;
      });
    };
    function grab(u, total) {                                    // streamed, so the deadline can read progress
      var o = { got: 0, total: total, ctl: w.AbortController ? new AbortController() : null };
      o.blob = fetch(u, { priority: 'low', cache: 'force-cache', signal: o.ctl && o.ctl.signal }).then(function (r) {
        if (!r.ok) throw r.status;
        if (!r.body || !r.body.getReader) { o.got = -1; return r.blob(); }
        var rd = r.body.getReader(), parts = [];
        return (function pump() { return rd.read().then(function (x) {
          if (x.done) return new Blob(parts, { type: 'video/mp4' });
          parts.push(x.value); o.got += x.value.length; return pump(); }); })();
      });
      o.blob.catch(function () {});
      return o;
    }
    if (B.still) {                                               // still mode: the hero still is the LCP candidate
      B.manifest.then(function (m) {
        var fi = m.files['hero/' + B.heroTier(m) + '/rest.webp']; if (!fi) return;
        var i = B.stillImg = new Image(); i.fetchPriority = 'high'; i.src = 'assets/snake3d/' + fi.file;
      }).catch(function () {});
    } else if (!B.deep && !B.wkBlocked && B.force !== 'novideo') {
      B.intro = B.manifest.then(function (m) {
        var t = clipTier(B.heroTier(m), m), key = 'hero/' + t + '/intro';
        return B.pick(m, key).then(function (k) {
          if (!k) return null;
          var fi = m.files[key + '.' + k + '.mp4'], o = grab('assets/snake3d/' + fi.file, fi.bytes);
          o.tier = t; o.codec = k; B.abort = function () { if (o.ctl) o.ctl.abort(); };
          return o;
        });
      });
      B.intro.catch(function () {});
    }
  } catch (e) { B.error = e; }
})(window, document);
</script>
<link rel="preload" href="assets/js/main.js" as="script">
<link rel="preload" href="assets/js/snake3d.js" as="script">
```

`snake3d.js` reuses `B.pick` and `B.heroTier` when present, and carries identical copies of both for later clips.

**Loading order** (motion mode, normal landing at the top)

| Priority | When | What |
|---|---|---|
| P0 | Head parse (boot) | `manifest.json` (revalidated) |
| P1 | Head parse | Hero intro, one codec, `priority: 'low'`, streamed |
| P2 | When the intro blob resolves, or 1200 ms after boot, or at once when the intro is skipped, aborted or BLOCKED (then with `fetchPriority = 'high'`) | Hero `rest.webp` at the scene tier |
| P3 | After the intro starts playing, or after P2 decodes when there is no intro. Fetch only; GPU upload after the intro ends, at most one image per rAF. | Hero `mask`, `flow`, `look`, `tongue` |
| P4 | After P3 (requestIdleCallback with a 2000 ms timeout; Safari: `setTimeout` 1200), then prime | `depart`, then `depart-rev` |
| P5 | First of: gauge within 150 % of the viewport (IO rootMargin `150% 0px`); `pointerdown` on any `a[href="#income"]`; hero p ≥ 0.5; 4 s idle in rest | Gauge `rest.webp`, `arrive` (primed), `mask`, `flow`, `look`, `tongue` |
| P6 | Hero gone and within 150 % of the viewport, but the intro blob was aborted or never fetched | Hero intro (low priority) |

**Exceptions**
- **Still mode:** only the `rest.webp` of each scene; the gauge's is fetched lazily under P5's trigger. No `.mp4`, `look`, `tongue`, `mask` or `flow` request is ever made.
- **Deep link** (`B.deep`), or a hero not visible at mount: call `B.abort()`. The hero starts gone and P5 starts at once.
- **BLOCKED** (probe at mount, W7): call `B.abort()` and skip P4, P5's clip and P6 until a tap unlock succeeds, then fetch them lazily (P4 order, then the gauge clip, then the intro). The rest sets still load: the WebGL rest is alive.
- **Intro deadline.** At 3000 ms after navigation start (4000 ms when `B.slow`), if the intro is not primed:
  - fewer than 60 % of `files[…].bytes` received (and `got ≥ 0`): abort, and refetch at P6;
  - otherwise: let it finish for re-forms.

  Either way the hero still fades in over 600 ms.
- **Stale manifest.** A 404 on a hashed file, or a video or image whose size differs from the manifest: refetch the manifest once with `cache: 'reload'` and remount that scene.
- **Manifest failure:** see W12.

## W3. Tier and codec selection

- **Scene tier.** need = D_css × min(DPR, 2). Tier = the smallest of S (78), M (104), L (156) with px/D ≥ need/1.2.
  - Touch-only devices are capped at M. `effectiveType` 3g forces S.
  - D_css for the hero comes from W5. For the gauge, D_css = s_g × 156.
- **Clip tier** = min(scene tier, highest entry of `clipTiers`).
- **Re-picking.** Re-pick on the next entry into rest, gone or empty when a refit makes need/1.2 exceed 1.25× the current tier's px/D or fall below 0.6× of it (orientation change, 960 px crossing, window resize). Then refetch.
- **Codec.** `pick()` from the boot, per clip and tier, with the clip's stacked size; results are cached in `sessionStorage`.
  - **Runtime downgrade.** Measure only during 1× segments of at least 1 s (intro, time-based arrival, idle auto-complete), as Δ`droppedVideoFrames` / Δ`totalVideoFrames`. Ignore any interval with `playbackRate` > 1.05, a hidden document, or a scroll in the last 250 ms. Downgrade later clips to the next codec only if the ratio exceeds 15 % in two such segments, and never re-download a clip already cached in another codec.
  - **`error` events:**
    - `MEDIA_ERR_DECODE`: append the codec to `sessionStorage['ae-s3d:bad']` and fetch the clip in the next codec (if before the deadline, or whenever the clip is not visible).
    - `MEDIA_ERR_SRC_NOT_SUPPORTED`: retry the same codec once from the network URL (iOS blob quirk), then treat it like a decode error.
    - `MEDIA_ERR_NETWORK`: retry once from the network URL.
  - Calibration BROKEN sets video = broken (W6).

| Device | Hero D_css | Hero stills / clips | Gauge D_css | Gauge stills / clips |
|---|---|---|---|---|
| Phone 390×844 @3 | 43.3 | S / S | 49.6 (G 310) | M / M |
| Laptop 1366×768 @1 | 82.7 | S / S | ≈ 77 | S / S |
| Laptop 1440×900 @1 | 87.1 | S / S | 76.8 (G 480) | S / S |
| Retina 1440×900 @2 | 87.1 | L / M | 76.8 | L / M |
| Desktop 1920×1080 @1 | 116 | M / M | ≈ 80 | S / S |
| iPad 1024×1366 @2 (touch) | 62 | M / M | ≈ 70 | M (capped) / M |
| Any device on `3g` | — | S / S | — | S / S |

## W4. DOM and CSS

**Hero layer.** Insert it between `.hero__vignette` (L112) and `.hero__studio` (L113):

```html
<div class="snake3d snake3d--hero" data-snake3d-hero aria-hidden="true">
  <noscript><img src="assets/snake3d/hero/M/rest.webp" alt=""></noscript>
</div>
```

**Gauge layer.** Insert it between `</svg>` (L370) and `.gauge__readout` (L371):

```html
<div class="snake3d snake3d--gauge" data-snake3d-gauge aria-hidden="true"></div>
```

**What the player creates**
- Inside each layer: one `<canvas>` and one `<img>`. The `<img>` serves still mode, fallbacks and crossfades under context loss. The rest still covers the whole stage, so the `<img>` fills the layer 1:1.
- One decoder host, as the last child of `<body>`: `<div class="snake3d-decoders" aria-hidden="true">`.
  - It holds exactly 3 `<video muted playsinline disablepictureinpicture disableremoteplayback preload="auto" tabindex="-1">`.
  - Also set `muted` and `playsInline` as properties; `loop = false`.
  - An element with no clip holds `manifest.probe` as its `src`.

**Stacking**
- **Hero:** paper → snake (z 1) → «studio» (z 1, later in the DOM) → vignette (z 3) → viewfinder (z 4) → copy and hint (z 5).
- **Gauge** (z auto), in DOM order: `::before` glow → HUD → SVG → snake → readout → tips.
- `.hero` and `.income` already have `overflow: hidden`, which clips the layers; there is no horizontal scroll.
- `.gauge` must have no `data-reveal` (W16): the arrival must never play under an ancestor at opacity 0 or mid-translate.

## W5. Layout fit

**Hero.** W = `hero.clientWidth`. Use the desktop branch when `matchMedia('(min-width: 960px)').matches` (this matches CSS, including the Windows scrollbar). H = the 100svh probe height. `navH` = computed `--nav-h` (72).

```
logo box (unchanged formula: snake.js L230–239 / style.css .hero):
  desktop:  bw = min(.5W, 1.85·.5H); bh = bw/1.85; bx = W − max(48, .05W) − bw; by = .4H − bh/2
  phone:    bw = W − 32;            bh = bw/1.85; bx = 16;                    by = navH + 20
HERO_FIT (snake3d.js constants, measured on today's 1440×900 layout):
  s  = 1.085·bh / aeBox.h                         css px per master px
  Fx = bx − 0.011·bw − s·aeBox.x                  frame origin, relative to .hero
  Fy = by − 0.044·bh − s·aeBox.y
  if (Fx + s·frame.w < W + 8)  Fx = W + 8 − s·frame.w      keep the exit edge off-screen
layer (--s3d-*) = [Fx + s·stage.x, Fy + s·stage.y, s·stage.w, s·stage.h]
D_css = s·pxPerD
hint (desktop only): headTop = Fy + s·look.envelopeTop; hintH = hint.offsetHeight
  --hint-y = max(navH + 8, min(by − 44, headTop − 8 − hintH))
```

- Also set `--logo-x/-y/-w/-h` inline on `.hero`; `.hero__studio`, `.hero__hint` and `--hero-col` keep using them unchanged.
- **1440×900 worked example** (example manifest):
  - Logo box (648, 165.4, 720, 389.2); s = 0.5586; D = 87.1 css px.
  - Fx = 360.8, Fy = −22.6. The frame's right edge is at 1540.6 (100 px past the viewport).
  - Layer = 561.9, 31.0, 978.7 × 643.5.
  - Letter bottom at 570.6 vs «studio» top 529.4: the approved overlap of about 40 px.
  - headTop = 128.2, so `--hint-y` ≈ 87.
- **390×844 worked example:**
  - s = 0.2777; D = 43.3; Fx = −126.8, Fy = −1.5; frame right edge at 459.7.
  - Layer = −26.8, 25.2, 486.5 × 319.9. The letters' top is at 83.5, under the 72 px nav.
- **Other widths:** the exit edge stays off-screen at 320 (373), 768 (928), 960×1080 (1027), 2560×1080 (2671) and 3840×2160 (4108).
- **No-JS and manifest-failure placement.** CSS places the still from the logo box with four constants, computed from the shipped manifest (ae = aeBox, st = stage):
  - left = `--logo-x` + `--logo-w`·(−0.011 + 0.5865·(st.x − ae.x)/ae.h)
  - top = `--logo-y` + `--logo-w`·(−0.0238 + 0.5865·(st.y − ae.y)/ae.h)
  - width = `--logo-w`·0.5865·st.w/ae.h
  - height = `--logo-w`·0.5865·st.h/ae.h

  The example manifest gives −0.1196, −0.1867, 1.3592 and 0.8937.

**Gauge.** G = `gauge.offsetWidth`.

```
s_g = 0.4·G / ringRadius
layer (relative to .gauge) = [G/2 − s_g·(ringCenter.x − stage.x), G/2 − s_g·(ringCenter.y − stage.y), s_g·stage.w, s_g·stage.h]
```

- G = 480: s_g = 0.4923, D = 76.8, layer = −67.2, −90.8, 803.5 × 661.7. The fur-to-track gap is about 5 css px; the exit fade ends at page x ≈ 1514 on a 1440 viewport.
- G = 310: s_g = 0.3179, D = 49.6, layer = −43.4, −58.6, 518.9 × 427.3; the gap is about 3 css px.
- Set `gauge.dataset.snakeTipX = anchors.tipX`.

**Canvas.** Backing store = `round(stage.w·k_scene) × round(stage.h·k_scene)` (hero S: 876×576); CSS size = the layer size.
- Refit on `onLayout`.
- On coarse-pointer devices, refit only if the width changed or the height changed by more than 120 px (this ignores the iOS URL bar). On fine-pointer devices, refit on every resize.
- A refit changes only CSS variables; the backing store changes only with the tier.

## W6. Compositing (WebGL1)

**Context:** `getContext('webgl', {alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power', failIfMajorPerformanceCaveat: true})`. A null context, or no `highp` fragment precision, sets envStill (W11).

**GL state**
- Blending: `blendFunc(ONE, ONE_MINUS_SRC_ALPHA)`.
- Textures: LINEAR, CLAMP_TO_EDGE, no mipmaps; NPOT is fine.
- Set `pixelStorei` before **every** upload; it is global state.
  - Images: `UNPACK_PREMULTIPLY_ALPHA_WEBGL = true`, `UNPACK_COLORSPACE_CONVERSION_WEBGL = NONE`.
  - Flow and mask: premultiply false, conversion NONE.
  - Video: premultiply false, conversion NONE.
- **Video: `gl.texImage2D(TEXTURE_2D, 0, RGBA, RGBA, UNSIGNED_BYTE, video)` on every new frame; never `texSubImage2D`.** Only `texImage2D` takes WebKit's GPU copy path; the size is constant, so drivers reuse the storage.
- No FLIP_Y: rows are top-down.
- Unused units keep a 1×1 transparent texture bound.

**Vertex shader** (shared). The quad is drawn in master px of the stage.

```glsl
attribute vec2 aPos; uniform vec4 uDst, uView; varying vec2 vQ;
void main(){ vQ = uDst.xy + aPos * uDst.zw; vec2 n = (vQ - uView.xy) / uView.zw * 2.0 - 1.0; gl_Position = vec4(n.x, -n.y, 0.0, 1.0); }
```

**CLIP fragment shader:** stacked video, LUT, matrix repair, luma alpha, haze knee.

```glsl
precision highp float;
uniform sampler2D uVid, uLut; uniform vec2 uVidSize; uniform vec4 uRect; uniform float uK, uH, uGut, uOpacity;
uniform mat3 uFix;                                                    // identity, or the BT.601->709 repair (calibration)
varying vec2 vQ;
float lut(float v){ return texture2D(uLut, vec2((v * 255.0 + 0.5) / 256.0, 0.5)).r; }
vec3 lut3(vec3 c){ return vec3(lut(c.r), lut(c.g), lut(c.b)); }
void main(){
  vec2 p = (vQ - uRect.xy) * uK;                                      // uK = video px per master px; uH = colour rows; uGut = gutter rows
  if (p.x < 0.0 || p.y < 0.0 || p.x > uRect.z * uK || p.y > uH) { gl_FragColor = vec4(0.0); return; }
  p = clamp(p, vec2(0.5), vec2(uRect.z * uK - 0.5, uH - 0.5));        // never sample the gutter
  vec3 c = clamp(uFix * lut3(texture2D(uVid, p / uVidSize).rgb), 0.0, 1.0);
  float a0 = dot(lut3(texture2D(uVid, vec2(p.x, p.y + uH + uGut) / uVidSize).rgb), vec3(0.2126, 0.7152, 0.0722)); // Y' cancels chroma noise
  float a = a0 * smoothstep(2.0 / 255.0, 6.0 / 255.0, a0);           // kills codec haze, leaves real values untouched
  c *= a / max(a0, 1.0 / 255.0);
  gl_FragColor = vec4(min(c, vec3(a)), a) * uOpacity;                 // min(): overshoot must not glow
}
```

**REST fragment shader:** base, breath, cells, bend, tongue.

```glsl
precision highp float;
uniform sampler2D uBase, uFlow, uMask, uLook, uTong;
uniform vec4 uBaseR, uFlowR, uMaskR, uLookR, uTongR;            // rects, master px
uniform vec2 uBaseS, uFlowS, uMaskS, uLookS, uTongS;            // texture sizes, px
uniform float uK, uHalf;                                        // still tier factor; 0.5 for flow/mask
uniform vec2 uCellA, uCellB; uniform float uCellMix;            // atlas origins (tier px) of the two cells
uniform vec2 uTongO; uniform float uTongOn;                     // tongue frame atlas origin; 0/1
uniform vec2 uPivot, uAxis; uniform float uStart, uLen, uWarp;  // master px; radians, + = clockwise on screen
uniform float uBreath, uFlowZero, uFlowPx, uOpacity;
varying vec2 vQ;
bool inR(vec2 q, vec4 r){ return q.x >= r.x && q.y >= r.y && q.x < r.x + r.z && q.y < r.y + r.w; }
vec4 tex(sampler2D t, vec2 size, vec2 o, vec4 r, float k, vec2 q){
  vec2 p = clamp((q - r.xy) * k, vec2(0.5), r.zw * k - 0.5); return texture2D(t, (o + p) / size); }
void main(){
  vec2 q = vQ, f = vec2(0.0);
  if (inR(q, uFlowR)) f = (tex(uFlow, uFlowS, vec2(0.0), uFlowR, uHalf, q).rg * 255.0 - uFlowZero) / uFlowPx;
  vec2 qb = q - uBreath * f;
  vec4 o = inR(qb, uBaseR) ? tex(uBase, uBaseS, vec2(0.0), uBaseR, uK, qb) : vec4(0.0);
  float m = inR(q, uMaskR) ? tex(uMask, uMaskS, vec2(0.0), uMaskR, uHalf, q).r : 0.0;
  if (m > 0.0) {
    float w = smoothstep(uStart, uStart + uLen, dot(q - uPivot, uAxis));
    float a = -uWarp * w; vec2 d = q - uPivot;
    vec2 qh = uPivot + vec2(cos(a) * d.x - sin(a) * d.y, sin(a) * d.x + cos(a) * d.y);
    vec4 h = o;                                                   // safety net: the packer guarantees qh is in look.rect
    if (inR(qh, uLookR)) h = mix(tex(uLook, uLookS, uCellA, uLookR, uK, qh), tex(uLook, uLookS, uCellB, uLookR, uK, qh), uCellMix);
    if (uTongOn > 0.5 && inR(qh, uTongR)) { vec4 t = tex(uTong, uTongS, uTongO, uTongR, uK, qh); h = t + h * (1.0 - t.a); }
    o = mix(o, h, m);
  }
  gl_FragColor = vec4(min(o.rgb, vec3(o.a)), o.a) * uOpacity;
}
```

**Crossfades.** 5 frames (167 ms) into rest; 3 frames (100 ms) out of rest.
1. Clear to 0.
2. `blendFunc(ONE, ONE)`.
3. Draw A with `uOpacity = 1 − t`, then B with `uOpacity = t`.

Both inputs are premultiplied, so the sum is valid and does not dip in brightness.

**Calibration** (CALIB program). It runs per GL context and per decoder load, on the first frame delivered by rVFC during priming (W7). Without rVFC it runs on `playing` + 1 rAF. A later load of the same codec in the same context reuses the result after a one-frame check that every strip patch is within ±4 of its earlier reading.

1. **Sample.** Draw each of the 16 strip patches and the 4 colour patches as an 8×4 video-px block around its centre into a 160×4 RGBA8 framebuffer, then call `readPixels`.
   - Strip patch i: centre x = (i + 0.5)·floor(w/16) (the last patch is centred in its wider span), y = H + (strip.y + strip.h/2)·k.
   - Colour patch j: centre x = (j + 0.5)·floor(w/4) (the last one likewise), y = H + (patches.y + patches.h/2)·k.
   - Here H is the colour height in video px and w is the video width.
2. **Medians.** Take a per-block, per-channel median. Grey m_i = the mean of the strip patch's channel medians.
3. **Not ready.** If all medians are < 8, the frame is not ready; retry on each of the next 10 frames, then count it as a failing frame.
4. **Gate.** m₁₅ < 204 or m₀ > 38 makes a failing frame. **BROKEN only after 3 consecutive failing frames.**
5. **`strip: null`:** identity LUT.
6. **LUT.** Fit out = a + b·(v/255)^γ·255 to the points (17i, m_i), by a grid search over γ ∈ [0.4, 2.5] with linear least squares for a and b.
   - If |fit(v) − v| ≤ 3 for every v: identity LUT.
   - Otherwise, if the fit residual at the 16 points is ≤ 3: invert the fit.
   - Otherwise: invert the cumulative-max medians piecewise-linearly.

   Store the result as a 256×1 `LUMINANCE` texture.
7. **Matrix check** (`patches` present). After the LUT, compare the 4 decoded colours with:
   - `patches.rgb` (the correct BT.709 decode), and
   - the same values encoded with BT.709 and decoded with BT.601 (computed in JS).

   If the 601 hypothesis is closer by > 3 mean ΔE, set `uFix` = D709·E601: re-encode the decoded R′G′B′ with BT.601, decode with BT.709. In normalised R′G′B′:

   ```
   E601: Y = .299R + .587G + .114B;  Cb = (B − Y)/1.772;  Cr = (R − Y)/1.402
   D709: R = Y + 1.5748Cr;  G = Y − .187324Cb − .468124Cr;  B = Y + 1.8556Cb
   ```

   GLSL `mat3` is column-major. If neither hypothesis is within ΔE 6, keep identity and log it; colour alone never sets BROKEN.
8. Log everything under `?snake3d=debug`.

**Draw policy.** One rAF loop serves both scenes. It runs only while a scene is intersecting, the document is visible, **and** something needs a frame: a clip frame is pending, springs are moving, the tongue is playing, breath is on, a fade is running, or the layout changed. Otherwise there are zero rAF callbacks. Breath alone redraws at 30 fps (draw only when `floor(t·30)` changes).

**Context loss.** On `webglcontextlost`: call `preventDefault()` and show the `<img>` (rest still, or nothing in gone/empty) at once. On `webglcontextrestored`: rebuild the programs, re-upload from cached `Image` objects and blob URLs, recalibrate, and return to the logical state without replaying anything.

## W7. Decoders, priming, frame clock, chase

**Pool.** Three elements: hero A (intro, then depart), hero B (depart-rev), gauge (arrive). Only `src` is swapped.
- **Release** = `removeAttribute('src'); load()`, then set `src` back to the probe.
- At most 2 hero clips and 1 gauge clip are live.

**Probe at mount.**
- In a non-allowlisted iOS WKWebView (`B.wkBlocked`): set video = blocked and **never call `play()`**.
- Otherwise: once the manifest is in, call `play()` on hero A with `src = manifest.probe`. A `NotAllowedError` within 300 ms sets video = blocked and calls `B.abort()`. Otherwise pause.

**Load and prime.**
1. `video.src = URL.createObjectURL(blob)`, then wait for `loadedmetadata`.
2. Set `currentTime = 0.5/30` and `play()`.
3. On the first rVFC callback (without rVFC: `playing` + 1 rAF), upload with `texImage2D`, calibrate (W6), `pause()`, and set `currentTime = 0.5/30`. The clip is now **primed**.

Notes:
- Frames 0–2 of the intro, frame 0 of depart-rev and frame 0 of arrive are empty; frame 0 of depart equals the rest still. Nothing is drawn during priming.
- Prime each clip as soon as its blob is in its element.
- Ignore priming frames in the dropped-frame stats.

**`play()` wrapper.** Never call `play()` while `!v.paused` or while a play is pending (track `v._pending`).

```js
v._pending = true;
v.play().then(() => { v._pending = false; },
              e => { v._pending = false; if (e && e.name === 'NotAllowedError') setVideo('blocked'); }); // AbortError etc.: ignore
```

**Frame clock**
- **rVFC:** F = clamp(Math.round((metadata.mediaTime − t0)·30), 0, N − 1), where t0 = the mediaTime of the first frame presented after load (0 for these files). Upload on every callback.
- **Without rVFC:** poll `currentTime` in rAF, F = clamp(floor(currentTime·30 + 0.001), 0, N − 1), and upload every rAF while playing.
- **"Last frame presented"** = F ≥ N − 1, OR the `ended` event, OR (paused and currentTime ≥ (N − 1)/30).
- `dev/snake3d.html` includes a unit test of this mapping, with mediaTime values truncated and rounded to 1 µs, for every N in 48…60, 84 and 96.

**Seeks.** Seek to (F + 0.5)/30. After `seeked`, upload in the next rVFC callback whose mapped frame equals the target; without rVFC, upload on `seeked` and on the next 2 rAFs. Keep showing the held frame until then (≤ 250 ms).

**Watchdog**
- Arm it only after the first presented frame of each `play()`. The first frame gets 1500 ms (2500 ms on touch devices).
- A **stall** = no new frame for 600 ms while playing, AND rAF kept running (now − lastRaf < 100 ms), AND neither `currentTime` nor `totalVideoFrames` advanced.
- First stall in the session: pause, seek to the current frame, play again.
- Second stall in the session: cut to the clip's end state and set video = broken. Later transitions become 300 ms still fades.

**Warm-up.** On rest → align, set `depart.currentTime = 0.5/30`. This wakes Chrome's idle-suspended pipeline during align.

**Fullscreen guard.** If `webkitbeginfullscreen` fires on a decoder: `webkitExitFullscreen()`, `pause()`, and set video = broken.

**Chase.** Applies to the hero depart (forward and reverse) and the gauge arrive (forward only). N = frame count; F* = target frame (W9).

```
gap = F* − F
gap > 0.5        → forward element: playbackRate = clamp(gap / (30·0.22), 0.6, rMax); play()
|gap| ≤ 0.5      → pause()                        (write playbackRate only when it changes by > 0.1)
gap < −3 (hero)  → pause forward; seek reverse to (N − 1 − F + 0.5)/30; on its first frame play reverse
                   with the same law (target N − 1 − F*). depart-rev not primed → hold the frame.
rMax = 3.0 if wheel/touchmove/keyboard scroll input arrived in the last 250 ms, else 1.25
idle 600 ms with 0 < F < N − 1:
   hero:  F* := (q < 0.5) ? 0 : N − 1, rate 1.0. If F* = 0 and depart-rev isn't primed:
          crossfade the current frame to the rest still over 300 ms instead.
   gauge: gaugeVis ≥ 0.35 → F* := N − 1, rate 1.0; otherwise hold the frame.
```

Whenever a chase pauses, pre-seek the other element to the mirrored frame, so a direction change starts within a frame.

## W8. State machines

Global variables:
- `mode` ∈ {motion, still}, where still = envStill || userStill;
- `video` ∈ {ok, blocked, broken};
- `jumping`, `settled`;
- `heroVis`, `gaugeVis`: from IntersectionObservers, with a synchronous `getBoundingClientRect` check at mount.

**Hero**

| From | Trigger | Guard | Action | To |
|---|---|---|---|---|
| boot | mount | mode still | `<img>` rest still; emit `written` once it decodes (or fails) | still |
| boot | mount | `B.deep`, or (sync check) heroVis < 0.3, or p ≥ 0.5 | `B.abort()`; emit `unwritten` | gone |
| boot | mount | otherwise | Take `B.intro` (or start it) and queue P2 | wait |
| wait | intro primed, `html.is-loaded` + 150 ms; heroVis and p re-read synchronously right before `play()` | before the deadline, video ok | `play()`; p_intro := p | intro |
| wait | `NotAllowedError`, blocked, broken, no codec left, or the deadline | — | GL still (the `<img>` until GL is ready), fade in 600 ms; emit `written` after decode; p_hold := p | rest |
| wait | heroVis < 0.3 or p ≥ 0.5 | — | Abort the fetch if < 60 % has arrived; emit `unwritten` | gone |
| intro | F ≥ `events.written` | — | Emit `written` («studio» fades in over 1.1 s) | intro |
| intro | last frame presented | — | Crossfade clip → rest over 5 frames; ease breath in over 1.5 s; **p_hold := p_intro**, so a scroll during the intro departs right after it. **Never cut a visible intro.** | rest |
| intro | heroVis = 0, still on, or second stall | — | Cut to the end state; p_hold := p | rest / still |
| rest | each scroll | — | p_hold := min(p_hold, p) | rest |
| rest | p > p_hold + 0.04 | depart primed, video ok, WebGL | p0 := min(p_hold, 0.8); look → neutral (ω 16, ≤ 300 ms); tongue e2, e1, off; breath → 0; warm up depart | align |
| rest | p > p_hold + 0.04 | depart not playable (not primed, blocked, broken, `<img>`) | Layer opacity = 1 − smoothstep(p0, 1, p). Emit `unwritten` below opacity 0.5 and `written` above it. At opacity 0 go to gone. | rest / gone |
| rest, align | jumping and p > p_hold | — | 200 ms layer fade; emit `unwritten`; no decode | gone |
| align | look within 0.5° of neutral and breath = 0 | — | Crossfade rest → clip frame 0 over 3 frames; start the chase with F* = q·(N − 1) | depart |
| depart | F ≥ `events.unwritten` | — | Emit `unwritten` («studio» fades out) | depart |
| depart | last frame presented | — | Clear. Release the videos after 10 s if q stays ≥ 0.5. | gone |
| depart | reverse reaches F = 0 with F* = 0 | — | Crossfade to rest over 3 frames; emit `written`; p_hold := p | rest |
| depart | heroVis = 0, or jumping | — | 200 ms layer fade; emit `unwritten` | gone |
| gone | p ≤ 0.25, settled, not jumping, heroVis ≥ 0.3, ≥ 1000 ms since the last hero clip ended | intro primed (else load it at P6 and prime) | Play the intro; p_intro := p; gauge → empty | intro |
| gone | same | intro not playable | Still fades in over 400 ms; emit `written` after decode; p_hold := p; gauge → empty | rest |
| any | mode becomes still | — | Stop videos and timers; `<img>` still; emit `written` after decode | still |
| still | mode becomes motion | — | Load per W11 (no replay). heroVis ≥ 0.15 and p < 0.5 → rest (p_hold := p). Otherwise emit `unwritten`. | rest / gone |

**Gauge**

| From | Trigger | Guard | Action | To |
|---|---|---|---|---|
| off | mount | manifest OK and `scenes.gauge` present | Create the DOM and observers | empty |
| empty | P5 trigger | — | Load the set. Add `has-plush-ring` once `rest.webp` decodes. On asset failure: remove it, emit `departed`. | empty (or off on failure) |
| empty | p_g > 0 | not jumping, arrive primed, director allows | Start the chase (forward only) | arrive |
| empty | after a jump or a deep link: jump cleared, settled, gaugeVis ≥ 0.35 (max wait 600 ms after visible) | arrive primed | Play time-based at 1× from frame 0 | arrive |
| empty | gaugeVis ≥ 0.35 | video not ok, or arrive not primed 1500 ms after visible | Still fades in over 400 ms; emit `arrived` after decode | rest |
| arrive | 600 ms idle, F < N − 1 | gaugeVis ≥ 0.35 | Auto-complete at 1× | arrive |
| arrive | 600 ms idle | gaugeVis < 0.35 | Hold the frame | arrive |
| arrive | last frame presented | — | Crossfade to rest over 5 frames; emit `arrived` (main.js adds `.has-snake`) | rest |
| arrive | gaugeVis = 0, still on, or second stall | — | Cut to the rest still | rest / still |
| rest | the hero enters intro | gauge > 1 viewport away | Clear; emit `departed`; release textures after 10 s | empty |
| any | mode becomes still | — | `<img>` still (lazy, once within 1.5 viewports); emit `arrived` after decode | still |
| still | mode becomes motion | — | rest if it was rest or arrive, or gaugeVis > 0; else empty. Load per W11. | rest / empty |

**Director rules**
- The gauge may enter arrive only if the hero is gone, or in depart with F ≥ 24, or not intersecting (which forces the hero to gone without decoding).
- The gauge never rewinds.

## W9. Scroll, observers, jumps

**Progress values**
- vh = the 100svh probe height. Document offsets are cached in `onLayout`; nothing reads layout in the scroll path.
- **Hero:** `p = clamp((scrollY − a·vh) / ((b − a)·vh), 0, 1)`, with HERO_SCROLL [a, b] = [0.03, 0.38] when the desktop branch applies, else [0.02, 0.22]. During a departure, F* = q·(N − 1).
- **Gauge:** `p_g = clamp((scrollY + vh − gaugeDocTop) / (0.45·vh + 0.5·G), 0, 1)`. That is 0 when the gauge's top meets the viewport bottom and 1 when its centre is at 55 % of the viewport. Arrival: F* = max(F*, p_g·(N − 1)).

**Hysteresis.** A departure arms only at p > p_hold + 0.04. Idle resolves at q = 0.5. A re-form needs p ≤ 0.25, settled, and ≥ 1000 ms since the last clip. Stopping or jiggling the scroll therefore never loops.

**Observers**
- Hero section: thresholds [0, .15, .3, .6].
- `.gauge`: thresholds [0, .35].
- Two "near" observers with `rootMargin: '150% 0px'`, for loading.
- A layer that is not intersecting pauses its videos and stops drawing.
- At mount, compute heroVis and p synchronously; do not wait for the first IntersectionObserver callback.

**Jumps.** DIVA scrolls to anchors with native CSS smooth scroll (`style.css` L69).
- `jumping = true` on a capture-phase `click` on any `a[href^="#"]` and on `hashchange`.
- It clears on the first `scrollend` that follows at least one scroll event; or 150 ms after the last scroll event, once at least one has arrived since the jump; or 300 ms after the jump if no scroll event arrives (target already in view). Hard cap: 2500 ms.
- **While jumping:** the hero fades to gone (200 ms, no decode). The arrival and the re-form wait for the jump to clear and for settled.
- `pointerdown` on `a[href="#income"]` prefetches the gauge set.
- «Наверх» → the hero re-forms with the intro after landing; the gauge goes empty, since it is off-screen.

**Reload or restored scroll.**
- `pagehide` stores `scrollY` in `sessionStorage['ae-s3d:y']`. The boot uses it on reload and back/forward navigations to skip the early intro fetch when she would not be visible.
- If scroll restoration lands mid-page after the intro started, the intro row "heroVis = 0" cuts it to its end state.

## W10. Look, tongue, breathing, taps (rest only)

**Pointer tracking.** Track `pointermove` only when `(hover: hover) and (pointer: fine)`, rAF-coalesced. Let H = the eye in css px, v = pointer − H, dist = |v| / D_css.

| | Hero (left-facing profile) | Gauge (top-down, head at 12:30) |
|---|---|---|
| Warp θ | `clamp(0.6·atan2(−v.y, abs(v.x) + 1.5·D_css), rangeDeg)`; + = snout up | `clamp(signedAngle(headDir, v), rangeDeg)` |
| Cell angle κ | Yaw = lerp(0°, 55°, max(f, c)), where f = smoothstep(−0.2, 0.6, v.x/\|v\|) (pointer behind her) and c = 1 − smoothstep(1.5, 6, dist) (pointer close) | Nod = lerp(25°, 60°, 1 − smoothstep(1, 5, dist)) |
| On `ae:income` (delta > 0) | — | κ → 30°, θ toward the ring centre, single flick, hold 1.2 s (1.2 s cooldown) |

**Dynamics**
- Critically damped springs: ω_θ = 10 s⁻¹, ω_κ = 8 s⁻¹, speed capped at 240°/s.
- A new target is accepted only if it differs by > 3° or 300 ms have passed.
- While moving: i = floor((κ − κ₀)/5), `uCellMix` = fract(…).
- At rest: when |κ velocity| < 3°/s and κ is within 2.5° of a cell, ease onto that cell over 120 ms. **At rest exactly one cell shows.**

**Taps and clicks**
- Listen for `pointerdown`, `pointerup` and `pointercancel` on the hero section and on `.gauge`, not on `document`. iOS does not dispatch `click` to `document` for non-clickable targets.
- A **tap** = `pointerup` with no `pointercancel` since its `pointerdown`, movement < 10 css px, duration < 500 ms. Touch scrolling fires `pointercancel`, so a swipe that starts on the snake never reacts.
- Taps are handled only in rest.
- **On the snake** (inside `mask.rect` mapped to css, or within 1.2 D of the eye): "boop" = κ to its maximum plus a double flick.
- **Elsewhere in the hero** (target not inside `a, button, input, label, select, textarea, summary, [role=button], [data-magnetic]`): look at that point for 1.8 s plus a single flick.

**Autonomy** (after 4 s without a pointer; always on touch-only devices). Every U(2.5, 6) s, pick a target:
- 45 % the viewer: κ 50–60°, θ 0–6°;
- 30 % the copy: hero → the headline centre; gauge → the calculator form centre;
- 15 % a random point within 4 D;
- 10 % a look away: hero κ −10…−5°; gauge nod 15–20°.

**Tongue**
- Before a flick, snap κ to a cell (≤ 80 ms) and freeze κ for the flick; θ may follow at ≤ 60°/s.
- Frames run on the 30 fps clock. `single` = 333 ms; `double` = 600 ms and is used 35 % of the time.
- Triggers:
  - idle, U(3, 6) s since the last flick;
  - pointer within 2 D of the eye or `snout` (2 s cooldown);
  - a tap (above);
  - gauge `ae:income`.

**Breathing**
- `uBreath = amp·sin(2πt/periodS)`.
- Eased in over 1.5 s on entering rest; eased to 0 in align and before still.
- After 45 s with no input (pointer, touch, scroll or key), ease to 0 over 1.5 s and stop the rAF; resume on input.

## W11. Still mode, pause, offscreen, bfcache, blocked autoplay

**Two flags; mode = still if either is set.**
- `envStill`: Save-Data, effectiveType slow-2g/2g, no WebGL / no `highp` / major performance caveat, `?snake3d=still`. Set by the boot or by `env`.
- `userStill`: main.js `still()` at mount, then `setStill(on)` (the «Остановить анимацию» button and live reduced-motion changes).
- `setStill(false)` never clears envStill.
- Toggle `html.snake3d-still` / `html.snake3d-motion` on every mode change.

**Entering still**, within one frame:
- playing clips cut to their end state (never frozen mid-crawl);
- the canvas becomes `visibility: hidden` and the `<img>` rest still shows;
- timers clear and videos pause;
- «studio» stays visible (`written`).

**Leaving still** (motion): load as for a deep link at the current scroll.
- Hero: P2–P4 if within 150 % of the viewport; the intro only via P6, when re-forming.
- Gauge: P5 if its trigger holds.
- Keep the `<img>` until the GL rest set is uploaded, then crossfade over 5 frames. **Nothing replays.**

**Static hint.** While the hero renders through `<img>` (still mode, no WebGL, context loss, manifest fallback), add `.hero.is-snake-static`; remove it otherwise.

**Offscreen.** A layer that is not intersecting pauses its videos (a clip cuts to its end state), stops look and tongue timers, and stops drawing. A hidden document does the same for both scenes.

**bfcache.**
- `pageshow` with `persisted`: check `gl.isContextLost()` and rebuild if needed; re-sync from scroll. A hero that was mid-intro jumps to rest.
- `pagehide`: pause all media and store `scrollY`.

**Blocked autoplay** (video = blocked):
- The rest works fully in WebGL: look, tongue, breath.
- Departure and arrival become opacity fades.
- **Unlock** on the first real tap anywhere: a `pointerup` that meets the tap rule (W10, but on `document`), a `click`, or a `keydown`. Inside that handler, synchronously call `play()` on all 3 pool elements (each holds a primed blob or the probe), then `pause()`. Ignore rVFC frames caused by the unlock.
- If any `play()` resolves: video = ok, and the skipped clips are fetched lazily.
- Never run the unlock when `B.wkBlocked`.

## W12. Fallback matrix

| Environment | Video | Frame clock | Rest | Notes |
|---|---|---|---|---|
| Chrome / Edge ≥ 100, desktop | AV1 (dav1d or hardware) | rVFC | WebGL | — |
| Chrome Android, Samsung Internet | AV1 if powerEfficient, else HEVC if powerEfficient, else H.264 | rVFC | WebGL | The downgrade rule (W3) covers wrong `powerEfficient` answers |
| Firefox ≥ 115, desktop | AV1 (dav1d) | rVFC from 132, else polling | WebGL | — |
| Firefox Android | AV1 only if powerEfficient, else HEVC if powerEfficient, else H.264 | same | WebGL | — |
| Safari macOS ≥ 15.4 | HEVC; AV1 on M3+ if powerEfficient | rVFC | WebGL | Colour check (Q9) |
| iOS / iPadOS Safari ≥ 15.4 | HEVC; AV1 on A17 Pro / M-series | rVFC | WebGL | Priming (W7) |
| iOS Low Power Mode | Probe rejects → blocked | — | WebGL rest + look + tongue + breath | Tap unlock (W11) |
| WebKit without rVFC (Safari < 15.4) | none (gate: WebKit UA and no `requestVideoFrameCallback`) | — | WebGL stills | — |
| iOS in-app WKWebView (UA without `Safari/`) | Only if the UA matches `/Instagram\|FBAN\|FBIOS\|FBAV/`; all others blocked, with **no `play()` call at all** | rVFC | WebGL | Extend the allowlist after Q17 device tests (Telegram, VK) |
| Android WebView in-app | Muted autoplay usually rejected → blocked | rVFC | WebGL | Tap unlock allowed |
| effectiveType `3g` | As the browser row, tier S, deadline 4000 ms | as browser | WebGL | — |
| No WebGL, blocklisted GPU, `failIfMajorPerformanceCaveat` | none (envStill) | — | `<img>` still | — |
| WebGL context lost | stop | — | `<img>` until restored | — |
| Reduced motion, pause, Save-Data, slow-2g/2g | none fetched | — | `<img>` still | Still mode |
| **Manifest failure** (rejected fetch, non-2xx, bad JSON, schema ≠ `ae-snake3d/1`) | none | — | Retry once after 1500 ms with `cache: 'reload'`. If that fails: add `.snake3d--hero.is-fallback.is-img` and `<img src="assets/snake3d/hero/M/rest.webp">` (`manifest.fallback`'s fixed path); emit `written` after it decodes or fails | The gauge stays off (flat SVG ring, no `has-plush-ring`) |
| Hero still fails to load | — | — | Nothing drawn | Emit `written` anyway: «studio» alone beats a blank hero |
| JS disabled | none | — | `<noscript>` hero still; flat SVG ring (today's) | «studio» shows via `html:not(.js)` |
| No WebP (Safari < 14) | — | — | nothing | «studio» shows via its CSS safety net; accepted |

## W13. Mobile behaviour

- **Phone hero.**
  - The layer sits at the top of the hero, under the 72 px nav, overflowing both edges, clipped by `.hero`.
  - The departure range is [0.02, 0.22]·vh, so it finishes while she is still on screen.
  - The hint stays hidden on touch (`main.js` L583).
- **Touch.** No `pointermove` tracking. A tap (W10) on the hero looks at the tap point and flicks; a tap on the snake is a "boop". A swipe never reacts. Autonomy is always on.
- **Phone gauge.** At G = 310 the layer is −43, −59, 519 × 427 around the gauge. The coil's outer edge spans page x ≈ 5…385 at a 390 viewport. The trail exits right, clipped by `.income`. At 320 px wide the coil may be clipped by ≤ 6 px per side; this is accepted.
- **Orientation change:** refit. The tier is re-picked under the W3 ratio rule; touch devices stay capped at M.
- **The iOS URL bar** does not move the phone logo box, because the phone formula ignores H.

## W14. Decode and memory (phone: hero S, gauge M)

| Scene | Item | Size |
|---|---|---|
| Hero | Base still (stage at S, 876×576 RGBA) | 2.0 MB |
| Hero | Look atlas | ≈ 1400×780 = 4.4 MB |
| Hero | Tongue atlas | ≈ 0.5 MB |
| Hero | Flow (half master over the stage, 876×576) + mask | ≈ 2.2 MB |
| Hero | Clip texture (intro S, 864×1200) | 4.1 MB, plus ≈ 8 MB decoder buffers |
| Hero | Canvas (876×576 × 2 buffers) | 4.0 MB |
| Hero | **Total** | **≈ 25 MB** |
| Gauge | **Total** (stage M 1088×896; arrive 1088×1856 = 8.1 MB plus ≈ 12 MB decoder; canvas 7.8 MB) | **≈ 40 MB** |

**Peak** is under 70 MB with both scenes alive, and about 45 MB with this release policy:
- Release a scene's textures and videos 10 s after it has been more than 2 viewports away and in gone or empty.
- Release a video by swapping its `src` back to the probe (W7).
- Keep the Blobs for intro, depart, depart-rev and arrive (≤ 2.4 MB of RAM), so re-forms and re-arrivals need no network.
- Decode images with `img.decode()`, upload once, and keep the `Image` only for context restore.

## W15. Weight and time-to-snake

The caps per file are in M6.

| Breakpoint | Tiers (hero / gauge) | First screen (rest + intro), AV1 | Snake total |
|---|---|---|---|
| Phone 360–430 @2–3 | S / M | 420 KB (HEVC 505, H.264 660) | 2.2 MB |
| Laptop 1280–1536 @1 | S / S | 420 KB | 1.7 MB |
| Desktop 1920 @1 | M / S | 730 KB | 2.5 MB |
| Tablet (touch, capped) | M / M | 730 KB | 2.9 MB |
| Retina laptop 1440 @2 | L stills + M clips / L stills + M clip | 860 KB | 3.9 MB |
| Still mode, any device | rest stills only | 80–260 KB | ≤ 560 KB |

**JS:** `snake3d.js` ≤ 15 KB gz, plus the boot. For comparison, today loads 1.33 MB up front (`snake.js` 148 KB + atlases 1.18 MB).

**Time-to-snake** (first intro frame drawn, from navigation start):

| Conditions | Target |
|---|---|
| Desktop on cable | ≤ 1.0 s |
| Phone, "Fast 4G" + 4× CPU | ≤ 2.0 s |
| Fallback still, "Slow 4G" | ≤ 3.3 s |

## W16. DIVA changes (commit `8093dd6`)

#### `index.html`

| Lines | Change |
|---|---|
| before L14 | Insert the inline boot `<script>` and the two `<link rel="preload" as="script">` lines from W2. |
| L105–108 | **Delete** the snake-layer comment and `<canvas class="snake-layer" data-snake-canvas …>`. |
| between L112 and L113 | Insert the hero layer with its `<noscript><img></noscript>` (W4). |
| L167 | Hint copy → `Наведи курсор&nbsp;— она следит. Кликни&nbsp;— покажет язык.` |
| L316 comment | "the travelling snake coils around the ring" → "the plush snake (snake3d.js) arrives and coils around the ring". |
| L346 | `<div class="gauge" data-gauge data-reveal style="--i:1">` → `<div class="gauge" data-gauge>`. The ring keeps its own fill intro (main.js L815–836). |
| between L370 and L371 | Insert `<div class="snake3d snake3d--gauge" data-snake3d-gauge aria-hidden="true"></div>`. |
| L1038 | **Delete** `<canvas class="footer__canvas" data-footer-snake …>`. |
| L1073 | `assets/js/snake.js` → `assets/js/snake3d.js` (keep `defer`; keep it before main.js). |

#### `assets/js/main.js`

| Lines | Change |
|---|---|
| L3–5 | Header comment: snake.js / `window.SohoSnake` → snake3d.js / `window.AeSnake3D`. |
| L541–579 | Replace the snake part of `initHero` with the block below. Keep L581–615 (hint and timecode). |
| L583 | Comment only: "touch: no pointer tracking, so no hint". |
| L763–765 | Tip x from the manifest (block below). |
| L796 | Also dispatch `ae:income` (block below). |
| L1641–1666 | **Delete** `initFooter`. |
| L1797 | Remove `['footer', initFooter]` from `inits`. |

The new `initHero` snake block (replaces L541–579):

```js
    var gauge = $('[data-gauge]');
    var everWritten = false, snake = null;
    function markWritten() { everWritten = true; hero.classList.add('is-written', 'was-written'); }
    /* left the logo pose; was-written also disarms the CSS «studio» safety net (style.css L688) */
    function markUnwritten() { hero.classList.remove('is-written'); hero.classList.add('was-written'); }
    hero.addEventListener('snake:written', markWritten);
    hero.addEventListener('snake:unwritten', markUnwritten);
    if (gauge) {
      gauge.addEventListener('snake:arrived', function () { gauge.classList.add('has-snake'); });
      gauge.addEventListener('snake:departed', function () { gauge.classList.remove('has-snake'); });
    }
    var engine = win.AeSnake3D;
    if (engine && typeof engine.mount === 'function') {
      try {
        /* pre-rendered Cycles snake: writes "ae" in the hero, coils around the income gauge (see snake3d.js) */
        snake = engine.mount({ hero: hero, gauge: gauge, still: still(), onScroll: onScroll, onLayout: onLayout });
        onStillChange(function (on) { snake.setStill(on); });
        /* safety net: the intro takes ~2.8 s, longer on a slow phone */
        setTimeout(function () { if (!everWritten && snake.state().hero !== 'gone') markWritten(); }, 7000);
      } catch (e) {
        warn('hero snake', e);
        markWritten();
      }
    } else {
      markWritten();                                     // no engine → show "studio" right away
    }
```

Tip placement (replaces L764–765):

```js
      /* the plush snake rests its head near 12 o'clock: chips pop beside it, not on its face (x from snake3d.js) */
      var tipX = parseFloat(gauge && gauge.dataset.snakeTipX);
      var x = gauge && gauge.classList.contains('has-snake') ? (isFinite(tipX) ? tipX * 100 : 75) + (Math.random() - 0.5) * 6 : 50 + (Math.random() - 0.5) * 14;
```

At L796:

```js
      if (next.m > lastTarget.m) {
        queueTip(next.m - lastTarget.m);
        doc.dispatchEvent(new CustomEvent('ae:income', { detail: { delta: next.m - lastTarget.m } }));
      }
```

#### `assets/css/style.css`

| Lines | Change |
|---|---|
| L633 | Comment: "snake.js overwrites these inline" → "snake3d.js writes these inline (same formula)". |
| L814 | `.hero__hint` `top: calc(var(--logo-y) - 44px);` → `top: var(--hint-y, calc(var(--logo-y) - 44px));` |
| L935–938 | Comment: "When the plush snake arrives (.gauge.has-snake) the drawn head is gone and she coils around the ring." |
| L946–950 | **Delete** the ink text-shadow halo on the `.income` copy; the snake no longer passes under text. |
| L2463–2469 | **Delete** `.footer__canvas`. |
| L2679, L2708 | Comments: `snake.js` / `logoBox` → `snake3d.js`. |
| L2803 | Comment: "the snake is a still image: no hover / click hint". |
| after L2805 | Add `.hero.is-snake-static .hero__hint { display: none; }` |
| L2839–2855 | **Replace** the SNAKE LAYER block with the block below. Keep L2856 (`.section > .container { … z-index: 4; }`; harmless). |
| L2858–2875 | Rename every `html.has-journey` → `html.has-plush-ring` and keep the rules. Change the comment to "while the plush coil is loaded". During QA, re-check the desktop HUD inset −12 % against the coil's outer radius (0.61·G from the centre); change it to −14 % only if the brackets touch the fur. |

The replacement SNAKE 3D block:

```css
/* ── SNAKE 3D (assets/js/snake3d.js) ─────────────────────────────────────
   Pre-rendered Cycles snake: one layer per scene, inside its section. snake3d.js sets
   --s3d-x/-y/-w/-h (px, relative to .hero / .gauge). The rest still covers the whole layer. */
.snake3d { position: absolute; left: var(--s3d-x, 0); top: var(--s3d-y, 0); width: var(--s3d-w, 0); height: var(--s3d-h, 0); pointer-events: none; user-select: none; }
.snake3d--hero { z-index: 1; }   /* under .hero__studio (z 1, later in the DOM), the vignette (3), the viewfinder (4), the copy (5) */
html:not(.js) .snake3d--hero, .snake3d--hero.is-fallback {   /* stage from the CSS logo box; constants = W5, from the shipped manifest */
  left: calc(var(--logo-x) + var(--logo-w) * -0.1196);
  top: calc(var(--logo-y) + var(--logo-w) * -0.1867);
  width: calc(var(--logo-w) * 1.3592);
  height: calc(var(--logo-w) * 0.8937);
}
.snake3d > canvas, .snake3d > img, .snake3d noscript img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
.snake3d > img { opacity: 0; transition: opacity .6s var(--ease-out); }
.snake3d.is-img > img { opacity: 1; }
.snake3d.is-img > canvas { visibility: hidden; }
.snake3d-decoders { position: fixed; right: 0; bottom: 0; width: 2px; height: 2px; overflow: hidden; opacity: .01; pointer-events: none; }
.snake3d-decoders > video { position: absolute; left: 0; top: 0; width: 2px; height: 2px; }
@media print { .snake3d, .snake3d-decoders { display: none; } }
```

#### `assets/css/blocks.css`

Comments only:
- L7–9: these sections no longer need to avoid stacking contexts.
- L857–859: the journey-zone constraint is gone. The `z-index ≥ 4` rules stay; they are harmless.

#### `assets/js/blocks.js`

No change.

#### Delete

- `assets/js/snake.js`
- `assets/img/snake/` (`body.webp`, `cap.webp`, `head.webp`, `manifest.json`)
- `dev/snake.html`
- `dev/blender/*`, the 2D atlas pipeline: `README.md`, `head_v3.py`, `head_v3_check.py`, `head_v3_pack.py`, `head_v3_params.json`, `head_v3_spec.py`, `plush_fur.py`. Git keeps the history.

#### Add

- `assets/js/snake3d.js`
- `assets/snake3d/**` (= the Blender session's `web3d\`)
- `dev/blender/`: the new pipeline scripts returned by the Blender session, plus a `README.md` with the pack, encode and finalize commands.
- `dev/snake3d.html`: a test page with the real CSS, a hero mock and a gauge mock on a tall page. It includes:
  - buttons for every state;
  - `?tier=`, `?codec=`, `?snake3d=still|nogl|novideo|lpm`;
  - mask and cell-index overlays;
  - a calibration readout (medians, LUT fit, matrix verdict);
  - an fps and dropped-frames meter (gaps in rVFC `presentedFrames`);
  - a texture memory estimate;
  - the frame-clock unit test (W7).

#### Update

- `dev/build-preview.py`:
  - docstring L6–9: no asset URL rewrite;
  - **delete** L40–46 (the `snake.js` `assetUrl()` rewrite);
  - L54: keep **all** inline `<script>` blocks of `<head>` and the preload links, in order (`re.findall`), because the boot script now comes first;
  - publish `assets/snake3d/` beside the page. The player resolves URLs against `document.baseURI`.
- `README.md`:
  - L56–60: the structure (`snake3d.js`, `assets/snake3d/`, `dev/blender/`, `dev/snake3d.html`);
  - L63–66: replace the stacking-context paragraph with "the logo box formula lives in `style.css` `.hero` and `snake3d.js` (`HERO_FIT`)".
- `docs/structure-diva.md` L33: replace «поведение змеи без изменений» with the new behaviour. She writes «ae» on load, follows the cursor with her head, flicks her tongue, crawls away on scroll and re-forms at the top, and coils around the income ring.

#### Keep

`assets/img/snake-ae.jpg` (og:image and the FAQ photo). Optionally switch og:image to the Blender session's `og_1200x630.jpg`.

## W17. QA checklist

| ID | Check | Pass criterion |
|---|---|---|
| Q1 | Intro in Chrome, Firefox, Safari macOS, iOS 17/18, Android Chrome, Samsung Internet | Plays and ends in «ae» with no pop at 100 % and 200 % zoom; «studio» fades in after `written`. On a real iPhone, `readyState` reaches 2 only through priming, and the intro plays (not the deadline path). |
| Q2 | Hand-offs (intro → rest, rest → depart, depart-rev → rest, arrive → rest), recorded at 60 fps and stepped frame by frame | No jump > 2 css px; no mean shift > 4/255 in the snake area. |
| Q3 | Seams: sweep κ over its full range and θ over `rangeDeg` at 2°/s; view at 400 % | No visible feather edge; outside the mask, composite vs neutral still differs by ≤ 1/255. |
| Q4 | Calibration, every browser × codec (`?codec=`), plus Safari private browsing and Brave | Fit and matrix verdict logged; strip ≤ 2/255 after correction. Never BROKEN on supported browsers. |
| Q5 | Alignment at 320, 360, 390, 430, 768, 960–976 (Windows scrollbar), 1024, 1280, 1440, 1920, 2560, 3840 px wide | No horizontal scroll. Gauge inner fur 3–8 css px outside the SVG track. Hero exit edge ≥ 8 px off-screen. Letter bbox within ±8 px of today's 2D letters and «studio» within ±4 px of today (`diva-hero-d.png` / `diva-hero-m.png`). The hint clears the head envelope by ≥ 4 px. The tail is cut by the viewport, never by the stage. |
| Q6 | Scroll | The departure follows the scroll both ways. Idle at q < 0.5 rewinds into «ae»; at ≥ 0.5 she leaves. Stopping at p = 0.3 for 10 s gives at most one rewind and no loop. After a re-form at p ≤ 0.25 she does not depart until the user scrolls down. An intro cut offscreen, then scrolling up: she does not crawl away. A visible intro is never cut. |
| Q7 | Navigation | «Посчитать доход» from the top: no departure frames decoded (`video.paused` stays true). The arrival starts ≤ 600 ms after the smooth scroll ends, never during it, and its first frame with alpha > 0 is on screen with `getComputedStyle(gauge).opacity === '1'`. «Наверх»: intro after landing, gauge empty. `/#income` and reload mid-page: no intro request; the ring arrives; scrolling to the top re-forms «ae». `/#main`: the intro plays. |
| Q8 | Weight, cache disabled | Per-tier bytes within M6. No gauge request before a P5 trigger. Reduced motion: zero `.mp4` and atlas requests. Repeat visit: hashed media served from cache without revalidation. |
| Q9 | Colour | Last intro frame vs GL still: mean ΔE2000 < 1.5 on lit fur in Chrome, Safari and Firefox. Hero vs gauge lit pink ΔE ≤ 5 (packer sheet). If Safari fails, A/B re-tag with `-color_trc iec61966-2-1`. |
| Q10 | Performance | Chrome, 6× CPU throttle: 60 fps scrolling during the departure chase, ≤ 4 ms player main-thread work per frame, no long task > 50 ms after the intro starts. A fast 3× chase never triggers a codec downgrade. M1 1440 @2: GPU ≤ 6 ms per frame. Real iPhone: Web Inspector Timelines shows no main-thread image conversion during the intro or the chase. After 45 s idle: zero rAF callbacks between flicks; main thread < 2 % busy. |
| Q11 | Memory | iPhone 12 Safari: page < 300 MB; canvas + textures < 70 MB; no canvas-memory warnings; ten hero ↔ gauge round trips without context loss. |
| Q12 | Still mode | Reduced motion (emulated) and pause: everything still within one frame, `<img>` stills, «studio» visible, hint hidden. Resume at the top, mid-page and at the gauge: the motion set loads, nothing replays. Paused at boot, then «Включить анимацию»: GL rest crossfades in. Save-Data → still; `3g` → motion at tier S. |
| Q13 | Offscreen and tabs | Hero scrolled out mid-intro: `video.paused` within 100 ms. Hidden tab pauses all media (DevTools Media panel). bfcache back/forward: one player instance, valid GL. Leave the page in rest for 60 s, then scroll: the departure plays (no BROKEN). |
| Q14 | Low Power Mode (real iPhone) | The probe sets blocked and the intro download is aborted (Network panel). Stills + look + tongue + breath work. The tap-unlock result is logged. No console errors (no unhandled AbortError). |
| Q15 | WebGL off / `WEBGL_lose_context` | `<img>` stills, no errors; after restore, state is back with no replay. |
| Q16 | Failures | 404 on `gauge/*.mp4` → the gauge still fades in. 404 on `gauge/*.webp` → the flat SVG ring returns (`has-plush-ring` removed, head visible). 404 on the hero intro → hero still within the deadline. **`manifest.json` 404 → hero still + «studio» within 3.5 s; gauge stays flat.** A 404 on a hashed file → one manifest reload. |
| Q17 | In-app browsers (Telegram, Instagram, VK on iOS and Android), real devices | Video or a graceful still. Never a blank stage after 3.5 s; never a fullscreen player. A non-allowlisted iOS WKWebView makes no `play()` call. Android WebView: blocked path, then tap unlock. |
| Q18 | Time-to-snake and LCP | ≤ 1.0 s desktop on cable; ≤ 2.0 s Fast 4G + 4× CPU; fallback still ≤ 3.3 s on Slow 4G. Lighthouse mobile with the intro in flight: h1 visible (`is-loaded`) ≤ 1.8 s; LCP ≤ 2.5 s in motion and in still mode; CLS from the layers = 0.00. |
| Q19 | Income tips | Chips spawn at `tipX` ± 3 % beside the head, never over the face; each tip produces a look + flick (1.2 s cooldown). |
| Q20 | Accessibility | Layers `aria-hidden`, nothing focusable, no new axe issues, forced-colours mode unaffected, the pause button works. |
| Q21 | Edge cases | Resize during the intro; crossing 959/960 px; 200 % zoom; landscape phones (`max-height: 420px`) re-pick the tier. |
| Q22 | Touch | A swipe starting on the snake: no boop, no flick, no jolt. A tap: boop. |
| Q23 | Frame clock | The `dev/snake3d.html` unit test passes for N = 48…60, 84 and 96. |

## W18. Browser facts relied on

⚠ = not certain; each ⚠ item has a fallback or a QA item.

| # | Fact | Relied on for | Confidence | Fallback / QA |
|---|---|---|---|---|
| 1 | Safari does not render the alpha channel of VP9-alpha WebM. | Rejecting native alpha video | Fairly sure | Not relied on |
| 2 | HEVC-with-alpha that Safari decodes needs Apple's encoder. | Same | ⚠ | Not relied on |
| 3 | `requestVideoFrameCallback`: Chrome 83+, Safari 15.4+, Firefox 132+. | Frame clock | Chrome/Safari sure; Firefox ⚠ | rAF polling of `currentTime` |
| 4 | `rVFC` `mediaTime` is rounded to 1 µs in Chromium and Gecko, so frame k may read slightly under k/30. | Frame mapping `round((t − t0)·30)` | Sure | Q23 |
| 5 | `MediaCapabilities.decodingInfo({type: 'file'})` works in Chrome, Firefox and Safari 13+; its first call can take > 100 ms on cold mobiles; `powerEfficient` is mostly accurate. | Codec choice | API sure; accuracy ⚠ | 300 ms parallel budget, `canPlayType` guess, downgrade rule |
| 6 | Safari decodes AV1 only with hardware (A17 Pro, M3+), Safari 17+. Chrome decodes HEVC only with hardware (107+). Firefox HEVC support is platform-dependent. | Ladder order | Mostly sure; Firefox HEVC ⚠ | Ladder falls through to H.264 |
| 7 | iOS keeps `preload` at metadata, so no frame decodes before `play()`. | Priming | ⚠ believed | Priming works either way (Q1) |
| 8 | WebKit's GPU video → texture copy runs only for `texImage2D` (level 0, RGBA/UNSIGNED_BYTE); `texSubImage2D` takes a CPU path. | Upload path | Fairly sure | Q10 iPhone timeline |
| 9 | iOS Low Power Mode rejects muted `play()` with `NotAllowedError`. | Probe / blocked path | Sure | WebGL stills |
| 10 | A tap-initiated `play()` unlocks later programmatic plays on the same element; touch `pointerdown` is not activation-triggering, `pointerup` and `touchend` are. | Tap unlock, fixed pool | ⚠ | Stay blocked (Q14 logs it) |
| 11 | iPhone WKWebView defaults `allowsInlineMediaPlayback = NO`; `play()` there can open the fullscreen player. Android WebView defaults to requiring a gesture for media. | WKWebView allowlist; Android blocked path | Sure (defaults); app settings vary | Fullscreen guard; Q17 |
| 12 | Chrome and WebKit may pause muted autoplay judged invisible; a 2×2 px, opacity .01 element in the viewport counts as visible. | Decoder host | ⚠ | Watchdog; test 8×8 px if pauses are seen |
| 13 | Chrome idle-suspends paused players after about 15 s and resumes slowly. | Warm-up and watchdog arming | Fairly sure | Q13 |
| 14 | `pause()` rejects a pending `play()` promise with `AbortError`. | `play()` wrapper | Sure | — |
| 15 | iOS Safari plays MP4 from a `blob:` URL. | Whole-file loading | Believed | Network-URL retry |
| 16 | Video → WebGL upload transfer handling differs between browsers; `UNPACK_COLORSPACE_CONVERSION_WEBGL = NONE` may be ignored for video; a few vendor paths decode BT.709 streams with BT.601. | Calibration | ⚠ | LUT + matrix repair; Q4, Q9 |
| 17 | Safari's Advanced Fingerprinting Protection and Brave add noise to canvas/WebGL readback. | Block medians | ⚠ | Q4 |
| 18 | `effectiveType` and `saveData` exist only in Chromium; Chrome reports `3g` for RTT ≥ 270 ms or downlink < 700 kbps. | Still and 3g rules | Sure | — |
| 19 | `fetch(…, {priority})` is honoured by Chrome 101+ and Safari 17.2+; Chrome holds low-priority fetches while render-blocking resources load; `fetch()` defaults to high. | Intro at low priority | Fairly sure | Q18 |
| 20 | `scrollend`: Chrome 114+, Firefox 109+; Safari support is recent or absent. | Jump clearing | ⚠ Safari | Timer rules (W9) |
| 21 | iOS Safari does not dispatch `click` to `document` for taps on non-clickable elements. | Taps on the hero/gauge via pointer events | Sure | — |
| 22 | `requestIdleCallback` is absent in Safari. | P4 scheduling | Fairly sure | `setTimeout` 1200 ms |
| 23 | `img.decode()`, WebGL1 NPOT textures with CLAMP and no mipmaps, and fractional `playbackRate` on muted video work everywhere. | Images, textures, chase | Sure | — |
| 24 | `100svh`: Safari 15.4+, Chrome 108+, Firefox 101+. | vh for p and the logo box | Sure | Fall back to `innerHeight` |
| 25 | H.264 level 4.0 allows 8192 MBs per frame, 245,760 MB/s and a 32,768-MB DPB. The largest S/M stacked clip, gauge M 1088×1856 (7888 MBs), fits with 4 refs. | Codec strings, decodability | Sure | Packer gate (M5) |
| 26 | Browsers parse profile and level from `hvc1.1.6.L…`; the trailing constraint byte (`B0` vs `90`) is not matched strictly. | `canPlayType` | ⚠ | Finalize can emit `90` |
| 27 | `container-type: inline-size` on `.gauge` makes it the containing block for fixed-position descendants. | Decoders live under `<body>`, not inside `.gauge` | Fairly sure | Moot |

# Rejected review points

- **Runtime reviewer's gauge-reveal variant** (move `data-reveal` onto `.gauge__svg` and `.gauge__readout`): not used. The ring would still be invisible while she coils around it. The integration fix (remove `data-reveal` from `.gauge`) is applied instead.
- **Runtime reviewer's `.has-snake3d` class plus a new CSS safety-net selector:** not needed. `markUnwritten` now adds `.was-written`, which already disarms the CSS net (the integration fix was applied).
- **Integration reviewer: "emit `unwritten` when the hero still fails to load":** rejected for the hero only. With `.was-written` set by `markUnwritten`, it would leave the hero blank; «studio» alone is the better failure. It is applied for the gauge (`departed`, `has-plush-ring` removed).
- **Integration reviewer: "wait for `load` + 1 rAF before the intro may start":** rejected. On slow links `load` can arrive seconds after `is-loaded` and would push every intro past its deadline. The boot's stored-scroll test, a synchronous re-check before `play()`, and the offscreen cut cover scroll restoration.
- **Integration reviewer: for `3g`, "fetch the intro after `load`":** changed. The intro is fetched during parse at low priority, with a 4000 ms deadline and the 60 % progress abort, forthe same reason: waiting for `load` would make it miss the deadline every time.
- **Blender reviewer's fixed "180° tilt ramp, keyed on the Head only":** kept as a rule and changed in two ways. The ramp is whatever angle brings the dorsal axis to +Z, measured rather than fixed at 180°. It is applied as a per-bone roll at bake time, because a Head-only key would roll the whole body, including the letters still on screen.
- **Blender reviewer's fallback "switch CamGauge to 1408×1024":** not adopted as an automatic step. The gauge M clip would grow to about 8976 MBs and break the 8192-macroblock gate (H.264 level 4.x). The session moves the key light further toward the exit and then reports instead.
- **Blender reviewer's "H2 up to 110 frames":** not made the default, because the dispatched design is about 1.6 s. Shutter 1.0 is the default fix for the band strobing. The 110-frame version is offered to the user at the animatic gate, with depart caps ×2.2.
- **Runtime reviewer: "set BROKEN when the colour patches match neither BT.709 nor BT.601":** rejected. A colour-management difference (for example, Safari on P3 displays) could then disable video for a whole browser. The mismatch is logged, the identity matrix is kept, and the BROKEN gate stays on the grey strip.
- **Runtime reviewer: "abort the intro after the deadline when less than 60 % of Content-Length has arrived":** applied, but progress is measured against the manifest's `files[…].bytes` instead of Content-Length. That count is known before the fetch starts and does not depend on server headers.