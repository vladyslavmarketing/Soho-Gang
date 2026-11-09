"""
ae studio - the gauge scene (spec B6/B7): the plush snake coils around the income calculator's ring.

    blender -b --factory-startup --python blender/snake_gauge.py                  # build + bake G1
    blender -b --factory-startup --python blender/snake_gauge.py -- --animatic    # + animatic MP4 on #1E1618

Opens renders/snake.blend (snake_scene.py), deletes the Sweep and the hero lights and builds:
    world      floor at z = 0 (= the hero floor height), ring centre at the origin, camera looking down -z
               with image-up = +y (counter-clockwise in the world = counter-clockwise on screen)
    CamGauge   orthographic, ortho_scale 13.538 D (= 2112 / 156), at (2.154, 0, 40): the ring centre lands
               on master px (720, 672), the right frame edge at x = +8.92 D
    Floor      60 x 60 D shadow catcher, Principled base #1E1618 (linear 0.0129, 0.0080, 0.0091), rough 0.9
    lights     key (area 10 D at (-18, 2, 14) -> (0, 0, 0.5), 3300 W, spread 50), front (area 14 D at
               (-4, 6, 30), 4500 W, spread 60), pink rim without shadows (area 6 D at (9, -9, 2.5), 1200 W,
               (1, .62, .70)), inner glow (sphere r 1.2 D at (0, 0, 0.6), 120 W); world (0.12, .085, .09) x .25
Master path (tail end first, arc-length parametrised; B6):
    A lead-in  (50, 1.665) -> (12, 1.665)   (spec: from 40; longer so the tail end of frame 0 lies on it)
    B approach (12, 1.665) -> (4.4, 1.665) with a lateral wave 0.30 sin(2 pi (12 - x) / 4.5) fading out over
               the last 1.5 D, then a cubic Bezier into E = (Rc cos 30, Rc sin 30), tangent to the coil
    C coil     CCW from 30 to 435 deg: r = Rc + 0.12 S, z = 1.10 S, S = smoothstep(315, 375, phi); Rc = 3.33
G1 (gauge_arrive), 96 frames: the head starts at x = 9.6 (off frame), constant speed to t = 2.0 s, cubic
    ease-out to the end; nod 10 deg until 2.5 s, eased to 40 deg by 3.1 s. Frame 95 = G3 (gauge rest).
Roll: the dorsal axis follows world-up projected off the tangent (the path is planar but for the gentle lift,
    so this equals the parallel transport); the same twist / dorsal asserts as the hero clips.
"""
import bpy, math, os, sys
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import snake_path as sp
from snake_path import log, sstep, arg, argv

RC, Z_LIFT, R_LIFT = 3.33, 1.10, 0.12
Y_E = RC * math.sin(math.radians(30))                          # 1.665
CAM_X, ORTHO = 2.154, 2112 / 156
NF = 96


def build_set(rest):
    """delete the hero set, build floor, camera, lights and world (spec B6/B7)"""
    fz = rest.floor
    for ob in list(bpy.data.objects):
        if ob.type == 'LIGHT' or ob.name == 'Sweep':
            bpy.data.objects.remove(ob, do_unlink=True)
    sc = rest.sc
    me = bpy.data.meshes.new('Floor')
    me.from_pydata([(-30, -30, 0), (30, -30, 0), (30, 30, 0), (-30, 30, 0)], [], [(0, 1, 2, 3)])
    fl = bpy.data.objects.new('Floor', me)
    fl.location = (0, 0, fz)
    sc.collection.objects.link(fl)
    m = bpy.data.materials.new('GaugeFloor')
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.0129, 0.0080, 0.0091, 1)
    b.inputs['Roughness'].default_value = 0.9
    me.materials.append(m)
    fl.is_shadow_catcher = True
    cd = bpy.data.cameras.new('CamGauge')
    cd.type = 'ORTHO'
    cd.ortho_scale = ORTHO
    cd.sensor_fit = 'HORIZONTAL'
    cd.clip_end = 60
    cam = bpy.data.objects.new('CamGauge', cd)
    cam.location = (CAM_X, 0, fz + 40)
    cam.rotation_euler = (0, 0, 0)
    sc.collection.objects.link(cam)
    sc.camera = cam
    rest.cam = cam

    def light(name, kind, loc, energy, color, size=None, aim=None, spread=None, shadow=True, radius=None):
        ld = bpy.data.lights.new(name, kind)
        ld.energy, ld.color = energy, color
        if size:
            ld.size = size
        if spread:
            ld.spread = math.radians(spread)
        if radius:
            ld.shadow_soft_size = radius
        ld.use_shadow = shadow
        ob = bpy.data.objects.new(name, ld)
        ob.location = (loc[0], loc[1], loc[2] + fz)
        if aim is not None:
            d = Vector((aim[0], aim[1], aim[2] + fz)) - ob.location
            ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        sc.collection.objects.link(ob)
        return ob

    light('GKey', 'AREA', (-18, 2, 14), float(arg('--key', 3300)), (1.0, 0.97, 0.95), size=10, aim=(0, 0, 0.5), spread=50)
    light('GFront', 'AREA', (-4, 6, 30), float(arg('--front', 4500)), (1.0, 0.97, 0.96), size=14, aim=(0, 0, 0), spread=60)
    light('GRim', 'AREA', (9, -9, 2.5), float(arg('--rim', 1200)), (1.0, 0.62, 0.70), size=6, aim=(0, 0, 0), shadow=False)
    light('GGlow', 'POINT', (0, 0, 0.6), float(arg('--glow', 120)), (0.84, 0.54, 0.60), radius=1.2)
    bg = sc.world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.12, 0.085, 0.09, 1)
    bg.inputs['Strength'].default_value = 0.25


def gauge_trail(rest):
    fz = rest.floor
    pts = [np.c_[np.linspace(50, 12, 951), np.full(951, Y_E), np.zeros(951)]]          # A
    x = np.linspace(12, 4.4, 381)[1:]                                                  # B: wave
    wv = sstep(4.4, 5.9, x)
    pts.append(np.c_[x, Y_E + 0.30 * np.sin(2 * math.pi * (12 - x) / 4.5) * wv, np.zeros(len(x))])
    E = np.array([RC * math.cos(math.radians(30)), Y_E])
    P0, P3 = np.array([4.4, Y_E]), E
    P1, P2 = P0 + 0.5 * np.array([-1, 0]), P3 - 0.5 * np.array([-0.5, 0.866])
    t = np.linspace(0, 1, 81)[1:, None]
    bz = (1 - t) ** 3 * P0 + 3 * (1 - t) ** 2 * t * P1 + 3 * (1 - t) * t ** 2 * P2 + t ** 3 * P3
    pts.append(np.c_[bz, np.zeros(len(bz))])
    phi = np.radians(np.linspace(30, 435, 2026)[1:])                                  # C: coil
    S = sstep(math.radians(315), math.radians(375), phi)
    r = RC + R_LIFT * S
    pts.append(np.c_[r * np.cos(phi), r * np.sin(phi), Z_LIFT * S])
    Q = sp.resample(np.vstack(pts), 0.04)
    h = fz + Q[:, 2]
    w = np.ones(len(Q))
    tr = sp.Trail(Q[:, :2], h + 0.45, h, w)
    tr.N = sp.up_normals(sp.tangents(tr.X))
    tr.g = np.ones(len(Q))
    # clearance test on the path samples (B6)
    sig = tr.sig
    Xs, ss = Q[::5], sig[::5]
    d = np.linalg.norm(Xs[:, None] - Xs[None], axis=2)
    far = np.abs(ss[:, None] - ss[None]) > 2.0
    head = (ss[:, None] > sig[-1] - 1.3) | (ss[None] > sig[-1] - 1.3)
    m1 = float(np.where(far, d, np.inf).min())
    m2 = float(np.where(far & head, d, np.inf).min())
    log('gauge path: %.1f D; clearance %.3f D (>= 0.95), near the head %.3f D (>= 1.10) -> %s' % (
        sig[-1], m1, m2, 'PASS' if m1 >= 0.95 and m2 >= 1.10 - 5e-3 else 'FAIL'))
    return tr


def arrive_profile(t, T, D, te=2.0):
    """constant v0 to te, then a cubic ease-out to zero speed at T"""
    tau = T - te
    v = D / (te + tau / 3)
    if t <= te:
        return v * t
    u = (t - te) / tau
    return v * te + v * tau * (1 - (1 - u) ** 3) / 3


def main():
    rest = sp.Rest()
    build_set(rest)
    tr = gauge_trail(rest)
    T = (NF - 1) / sp.FPS
    s_end = float(tr.sig[-1])
    s0 = float(np.interp(-9.6, -tr.xy[:950, 0], tr.sig[:950]))    # the head starts at x = 9.6
    D = s_end - s0
    prof = lambda t: s0 + arrive_profile(t, T, D)
    log('gauge_arrive: head travels %.2f D, v0 %.2f D/s; tail tip at rest x = %.2f' % (
        D, D / (2.0 + (T - 2.0) / 3), tr.window(rest, s_end)[0][-1, 0]))
    P, cum, ss = tr.window(rest, s0)
    log('gauge_arrive frame 0 empty (centre line test): %s' % sp.offscreen(rest, P, cum, margin=sp.OFF_MARGIN_PX))
    sign = float(arg('--nod-sign', 1))
    look = ([(0, 0.0), (9, 0.0)], [(t, sign * math.radians(v)) for t, v in ((0, 10), (2.5, 10), (3.1, 40), (9, 40))])
    Ms, extra = sp.bake_clip(rest, 'gauge_arrive', lambda t: (tr, prof(t)), NF, float(arg('--shutter', 0.0)), look=look)
    # nod direction check: snout height and screen position at rest
    sc = rest.sc
    sc.frame_set(NF)
    arm = rest.arm
    nose = arm.matrix_world @ arm.pose.bones['Head'].head
    eye = bpy.data.objects['EyeL'].matrix_world.translation
    pr = rest.project(np.array([tuple(nose), tuple(eye)]))
    log('G3: snout z %.2f D above the floor, snout master px (%.0f, %.0f), eye master px (%.0f, %.0f)' % (
        nose.z - rest.floor, pr[0, 0] * 1.5, pr[0, 1] * 1.5, pr[1, 0] * 1.5, pr[1, 1] * 1.5))
    sp.frame_check(rest, 1, 'gauge_arrive')
    sc.frame_set(1)
    out = os.path.join(sp.RENDERS_DIR, 'gauge_arrive.blend')
    bpy.ops.wm.save_as_mainfile(filepath=out, compress=False)
    log('saved', out)
    if '--animatic' in argv:
        sp.animatic('gauge_arrive', NF, '#1E1618', catcher='Floor')


if __name__ == '__main__':
    main()
    log('done')
