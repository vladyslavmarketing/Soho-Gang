"""
ae studio - fur atlases for the site's interactive canvas snake (assets/js/snake.js), rendered from the
Blender plush snake (renders/snake.blend, built by snake_scene.py).

    blender -b --factory-startup --python blender/snake_atlas.py                 # all cells -> renders/atlas/
    blender -b --factory-startup --python blender/snake_atlas.py -- --quick      # a few cells, low samples
    python blender/snake_atlas_pack.py                                           # cells -> body / head / cap .webp

The snake is put in its rest pose (straight along +X, snout at s = 0) and recoloured: no rings, the body behind
the head is cut into solid stretches (pink x3, cream x2, black x2), one per atlas row. An orthographic camera
looks at its side (from -Y, +Z up), the hero lights and the bounce sweep hang on "LightRig".

The engine draws a cell rotated to the body's screen angle and expects the light to stay fixed on screen. So a
cell for screen angle a (clockwise, y down) is rendered with the snake still and LightRig turned by -a about the
view axis; the packer turns the image by +a (body) or stores it as it is (head, see below).

    body_<w>_<k>.png   window w (0..6) of the straight body, light for axis angle k / 16 * pi
    head_<b>.png       the head, light for heading b / 32 * 2 pi. The head points left and stands upright here,
                       i.e. it is the engine's cell turned by 180 deg (the packer turns it back)
Scale: PX px per D at 1x (the engine's body radius R = 64 px = 0.5 D / K_R: the fur edge sits at K_R * R, as the
old atlas did), rendered SS times larger.
"""
import bpy, math, os, sys, json, time
import numpy as np
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import snake_path as sp
from snake_path import arg, argv

T0 = time.time()
QUICK = '--quick' in argv
OUT = os.path.join(sp.RENDERS_DIR, 'atlas_quick' if QUICK else 'atlas')
K_R = 1.3                                  # fur edge (0.5 D) = K_R x the engine's body radius
PX = 64 * K_R / 0.5                        # px per D at 1x
SS = 2
BODY_FRAME = 320                           # 1x px, square (cell 216 turned by any angle fits)
HEAD_CELL, HEAD_ORG = (384, 256), (164, 128)   # engine cell (head pointing +x) and its origin
HEAD_S0 = 1.0                              # arc length of the engine's head point behind the snout tip (D)
WIN_S0, WIN_STEP = 5.0, 2.6                # body windows: centres at WIN_S0 + i * WIN_STEP
KINDS = ['pink', 'pink', 'pink', 'cream', 'cream', 'black', 'black']
COL = dict(pink='#BC6C78', pink_deep='#A0474F', cream='#E2BC88', black='#060202')
rng = np.random.default_rng(5)


def log(*a):
    print('[%6.1fs]' % (time.time() - T0), *a, flush=True)


def hex2lin(h):
    c = np.array([int(h[i:i + 2], 16) / 255.0 for i in (1, 3, 5)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def zone_colors(s):
    """solid colour per strand / vertex at arc length s: pink, or the window's kind"""
    pink = hex2lin(COL['pink']) * 0.85 + hex2lin(COL['pink_deep']) * 0.15
    col = np.tile(pink, (len(s), 1))
    i = np.clip(np.round((s - WIN_S0) / WIN_STEP).astype(int), 0, len(KINDS) - 1)
    for j, k in enumerate(KINDS):
        if k != 'pink':
            col[(i == j) & (s > WIN_S0 - WIN_STEP / 2)] = hex2lin(COL[k])
    return col


def main():
    bpy.ops.wm.open_mainfile(filepath=os.path.join(sp.RENDERS_DIR, 'snake.blend'))
    sc = bpy.context.scene
    arm, body, fur = bpy.data.objects['SnakeRig'], bpy.data.objects['Body'], bpy.data.objects['Fur']
    arm.data.pose_position = 'REST'
    head_len = arm.data.bones['Head'].length
    nose_ext = head_len - 1.30
    L = head_len + sum(b.length for b in arm.data.bones if b.name.startswith('Spine_'))
    s_body = nose_ext + 1.6                              # behind this the fur is plain body fur
    log('L %.3f, nose_ext %.3f, windows end at %.2f (taper from %.2f)' % (
        L, nose_ext, WIN_S0 + WIN_STEP * (len(KINDS) - 1) + 0.6, L - 7.5))

    # ---- recolour: no rings, solid stretches
    cv = fur.data
    n = len(cv.curves)
    pos = np.empty(len(cv.points) * 3, np.float32)
    cv.position_data.foreach_get('vector', pos)
    k = len(cv.points) // n
    s = pos.reshape(n, k, 3)[:, 0, 0].astype(float)
    sel = s > s_body
    col = np.empty(n * 4, np.float32); cv.attributes['fur_col'].data.foreach_get('color', col); col = col.reshape(n, 4)
    tip = np.empty(n * 4, np.float32); cv.attributes['tip_col'].data.foreach_get('color', tip); tip = tip.reshape(n, 4)
    c = zone_colors(s[sel]) * rng.uniform(0.88, 1.1, (int(sel.sum()), 1))
    col[sel, :3] = c
    tip[sel, :3] = c * 0.15 + 0.85 * (1 - (1 - np.clip(c, 0, 1)) ** 2)
    cv.attributes['fur_col'].data.foreach_set('color', col.ravel())
    cv.attributes['tip_col'].data.foreach_set('color', tip.ravel())
    me = body.data
    co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get('co', co); vs = co.reshape(-1, 3)[:, 0]
    vc = np.empty(len(me.vertices) * 4, np.float32); me.color_attributes['skin_col'].data.foreach_get('color', vc)
    vc = vc.reshape(-1, 4)
    vsel = vs > s_body
    vc[vsel, :3] = zone_colors(vs[vsel]) * 0.72
    me.color_attributes['skin_col'].data.foreach_set('color', vc.ravel())
    bpy.data.objects['Tongue'].hide_render = True       # the engine draws the tongue

    # ---- rig: snake root, light rig about the view axis through the point the key light aims at
    key = bpy.data.objects['Key']
    d = key.matrix_world.to_3x3() @ Vector((0, 0, -1))
    P = key.matrix_world.translation + d * (-key.matrix_world.translation.y / d.y)
    log('pivot', tuple(round(v, 3) for v in P))
    root = bpy.data.objects.new('SnakeRoot', None); sc.collection.objects.link(root)
    for ob in (arm, body, fur):
        ob.parent = root
    rig = bpy.data.objects.new('LightRig', None); sc.collection.objects.link(rig)
    rig.location = P
    bpy.context.view_layer.update()
    for ob in list(bpy.data.objects):
        if ob.type == 'LIGHT' or ob.name in ('Sweep', 'Floor'):
            mw = ob.matrix_world.copy()
            ob.parent = rig
            ob.matrix_parent_inverse = rig.matrix_world.inverted()
            ob.matrix_world = mw
            if ob.type != 'LIGHT':
                ob.is_shadow_catcher = False
                ob.visible_camera = False
    cd = bpy.data.cameras.new('CamAtlas'); cd.type = 'ORTHO'; cd.clip_end = 200
    cam = bpy.data.objects.new('CamAtlas', cd); sc.collection.objects.link(cam)
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = cam

    # ---- render settings (as the web3d stills)
    sp.use_gpu(sc)
    cy = sc.cycles
    cy.samples = 24 if QUICK else int(arg('--samples', 128))
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = 0.01
    cy.adaptive_min_samples = 8 if QUICK else 48
    cy.use_denoising = True
    cy.denoiser = 'OPTIX'
    cy.seed = 0
    cy.sample_clamp_indirect = 10.0
    cy.max_bounces = 8; cy.glossy_bounces = 8; cy.transparent_max_bounces = 16
    cy.filter_width = 1.5
    sc.render.use_persistent_data = True
    sc.render.use_motion_blur = False
    sc.render.film_transparent = True
    sc.render.use_border = False
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = -0.2
    f = sc.render.image_settings
    try:
        f.media_type = 'IMAGE'
    except (AttributeError, TypeError):
        pass
    f.file_format = 'PNG'; f.color_mode = 'RGBA'; f.color_depth = '8'
    os.makedirs(OUT, exist_ok=True)

    def shoot(name, s_centre, w, h, ang, roll=0.0):
        """frame w x h (1x px) centred on arc length s_centre of the body axis; light rig turned by -ang;
        roll = the snake turned about its own axis (90 deg: the camera sees its back)"""
        path = os.path.join(OUT, name + '.png')
        if os.path.exists(path) and '--force' not in argv:
            return
        root.location = (P.x - s_centre, 0, P.z)
        root.rotation_euler = (roll, 0, 0)
        rig.rotation_euler = (0, -ang, 0)
        cam.location = (P.x, -60, P.z)
        cd.ortho_scale = max(w, h) / PX
        sc.render.resolution_x, sc.render.resolution_y = w * SS, h * SS
        sc.render.filepath = path
        t = time.time()
        bpy.ops.render.render(write_still=True)
        log('%s  %.1fs' % (name, time.time() - t))

    only = arg('--only', '')
    nb, nh = 16, 32
    if only in ('', 'head'):
        hw, hh = HEAD_CELL
        # the render is the cell turned by 180 deg: its origin sits at (hw - ox, hh - oy), +X of the world to the right
        s_c = HEAD_S0 + (hw / 2 - (hw - HEAD_ORG[0])) / PX
        for b in ([0, 8, 16] if QUICK else range(nh)):
            shoot('head_%02d' % b, s_c, hw, hh, b / nh * 2 * math.pi - math.pi)
    if only in ('', 'body'):
        for i in ([0, 3, 5] if QUICK else range(len(KINDS))):
            for kk in ([0, 4] if QUICK else range(nb)):
                shoot('body_%d_%02d' % (i, kk), WIN_S0 + i * WIN_STEP, BODY_FRAME, BODY_FRAME, kk / nb * math.pi,
                      roll=math.pi / 2)   # from the back: the side partings of the fur sit on the silhouette
    json.dump(dict(px_per_d=PX, k_r=K_R, ss=SS, body_frame=BODY_FRAME, head_cell=HEAD_CELL, head_origin=HEAD_ORG,
                   head_s0=HEAD_S0, kinds=KINDS, nose_ext=nose_ext, body_angles=nb, head_buckets=nh,
                   samples=cy.samples), open(os.path.join(OUT, 'info.json'), 'w'), indent=1)
    log('done')


if __name__ == '__main__':
    main()
