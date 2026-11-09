"""
ae studio - the plush snake travelling along a 3D trajectory without stretching ("follow the leader").

Needs the scene from snake_scene.py (C:/Users/vladk/ae-studio/renders/snake.blend by default).

    blender -b --factory-startup --python blender/snake_path.py                      # bake both clips
    blender -b --factory-startup --python blender/snake_path.py -- --draft           # + draft MP4s (no fur)
    blender -b --factory-startup --python blender/snake_path.py -- --clip hero_intro --draft

How it works
    A master trajectory (trail) is a polyline in the direction of travel, parametrised by arc length sigma.
    On every frame the head sits at sigma_h(t) and the body occupies the window [sigma_h - L, sigma_h]
    (L = length of the snake): the point u D behind the nose is at sigma_h - u, so every point of the body
    follows the head's track exactly, without sliding. The window is written into SpinePath, Spline IK fits
    the bone chain to it (the curve is exactly as long as the chain, so nothing stretches) and the bone poses
    are baked to plain FK keys, as in snake_anim.py --bake. Optional head/neck look and tongue tracks go on
    top (same convention as idle_lookaround).
    Floor contact: a trail point lying on the floor stores its contact height; the body part passing over
    it is lifted by its own radius (the head is thicker than the tail it follows), so nothing sinks into the
    floor or floats.

Clips (30 fps)
    hero_intro   2.8 s: the snake starts fully beyond the right edge of CamHero and crawls in head first
                 along its own final shape (tail line, then the "e" loop, then the "a"); constant speed, then
                 an ease-out over the last 0.6 s; it stops exactly in the "ae" pose: the last frame equals
                 frame 1 of idle_lookaround (the rest pose of the photo, tongue in).
                 Off-screen it comes in along an S-wave on the floor.
    hero_depart  1.6 s: starts from that pose; the head goes down the left side of the "a" (~1 D closer to
                 the camera than the letter), onto the floor in front of the letters and crawls right in an
                 S-wave (>= 1 D in front of every letter stroke) and out of frame; the letters unravel from the
                 tail. Eases in over 0.4 s. The last frame has no snake in it.

Outputs
    C:/Users/vladk/ae-studio/renders/hero_intro.blend, hero_depart.blend   baked actions (fur included)
    blender/renders/motion/hero_intro_draft.mp4, hero_depart_draft.mp4     drafts: Cycles 16 spp, no fur
                                                                           (skin fattened by the fur depth),
                                                                           704x384 on the pink backdrop
"""
import bpy, math, os, sys, time, shutil, subprocess
import numpy as np
from mathutils import Matrix, Vector, Quaternion
from bpy_extras.object_utils import world_to_camera_view

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default):
    return argv[argv.index(name) + 1] if name in argv else default


RENDERS_DIR = r'C:\Users\vladk\ae-studio\renders' if os.path.isdir(r'C:\Users\vladk\ae-studio') \
    else os.path.normpath(os.path.join(HERE, '..', '..', 'renders'))
SRC_BLEND = os.path.abspath(arg('--blend', os.path.join(RENDERS_DIR, 'snake.blend')))
MOTION = os.path.join(HERE, 'renders', 'motion')
FPS = 30
W_PX, H_PX = 1408, 768                        # CamHero frame (the photo)
DRAFT_RES = (704, 384)
FUR = 0.13
OFF_MARGIN_PX = 6                            # "out of frame" = the fur tips are this far beyond the edge
SEARCH_MARGIN_PX = 30                        # extra margin of the centre-line test (bones are straight segments)
LOOK_SHARE = [('Head', 0.45), ('Spine_01', 0.22), ('Spine_02', 0.15), ('Spine_03', 0.09), ('Spine_04', 0.06),
              ('Spine_05', 0.03)]
CLIPS = {
    'hero_intro': dict(seconds=float(arg('--intro-seconds', 2.8)), tongue=[(0, 0.03), (2.2, 0.03), (2.3, 1.0), (2.45, 1.0), (2.58, 0.03), (9, 0.03)]),
    'hero_depart': dict(seconds=float(arg('--depart-seconds', 1.6))),
}


def log(*a):
    print('[%6.1fs]' % (time.time() - T0), *a, flush=True)


def sstep(a, b, x):
    t = np.clip((np.asarray(x, float) - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def smooth_keys(keys, t):
    for (t0, v0), (t1, v1) in zip(keys[:-1], keys[1:]):
        if t0 <= t <= t1:
            u = (t - t0) / (t1 - t0) if t1 > t0 else 0
            return v0 + (v1 - v0) * (0.5 - 0.5 * math.cos(math.pi * u))
    return keys[-1][1]


def catmull(P, per=16):
    """centripetal Catmull-Rom through the rows of P (any number of columns; spacing from the first 3)"""
    P = np.asarray(P, float)
    P = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1:i + 3]
        t0 = 0.0
        t1 = t0 + np.linalg.norm(p1[:3] - p0[:3]) ** 0.5 + 1e-9
        t2 = t1 + np.linalg.norm(p2[:3] - p1[:3]) ** 0.5 + 1e-9
        t3 = t2 + np.linalg.norm(p3[:3] - p2[:3]) ** 0.5 + 1e-9
        for t in np.linspace(t1, t2, per, endpoint=False):
            a1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
            a2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            a3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            b1 = (t2 - t) / (t2 - t0) * a1 + (t - t0) / (t2 - t0) * a2
            b2 = (t3 - t) / (t3 - t1) * a2 + (t - t1) / (t3 - t1) * a3
            out.append((t2 - t) / (t2 - t1) * b1 + (t - t1) / (t2 - t1) * b2)
    out.append(P[-2])
    return np.array(out)


def resample(P, step):
    """resample the rows of P at equal arc length steps of its first 3 columns"""
    seg = np.linalg.norm(np.diff(P[:, :3], axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    ss = np.linspace(0, s[-1], int(math.ceil(s[-1] / step)) + 1)
    return np.stack([np.interp(ss, s, P[:, k]) for k in range(P.shape[1])], 1)


# ======================================================================================== the rest scene
class Rest:
    def __init__(self):
        bpy.ops.wm.open_mainfile(filepath=SRC_BLEND)
        self.sc = bpy.context.scene
        self.arm = arm = bpy.data.objects['SnakeRig']
        self.curve = cu = bpy.data.objects['SpinePath']
        self.cam = self.sc.camera
        bpy.context.view_layer.update()
        mw = cu.matrix_world
        pts = np.array([tuple(mw @ Vector(p.co[:3])) for p in cu.data.splines[0].points])
        head = np.array(arm.matrix_world @ arm.pose.bones['Head'].head)
        self.nose_first = np.linalg.norm(pts[0] - head) < np.linalg.norm(pts[-1] - head)
        self.rest = pts if self.nose_first else pts[::-1]                     # nose -> tail tip
        self.s_rest = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(self.rest, axis=0), axis=1))])
        self.L = float(self.s_rest[-1])
        self.M0 = {pb.name: pb.matrix.copy() for pb in arm.pose.bones}       # the photo pose
        self.floor = min(v.co.z for v in bpy.data.objects['Sweep'].data.vertices)
        # body profile from the rest skin (the rest mesh runs along +X from the nose, its axis at z = 0)
        co = np.array([v.co[:] for v in bpy.data.objects['Body'].data.vertices])
        edges = np.arange(0, self.L + 0.08, 0.04)
        k = np.clip(np.digitize(co[:, 0], edges) - 1, 0, len(edges) - 2)
        lo = np.full(len(edges) - 1, np.nan)
        hi = np.full(len(edges) - 1, np.nan)
        for i in np.unique(k):
            m = k == i
            lo[i], hi[i] = co[m, 2].min(), co[m, 2].max()
        ok = ~np.isnan(lo)
        self.prof_s = (edges[:-1] + 0.02)[ok]
        half = (hi[ok] - lo[ok]) / 2
        fur = FUR * np.clip((half + FUR) / 0.5, 0.25, 1)
        self.prof_bottom = (-lo[ok] + fur) * 0.96              # axis height above the floor when lying on it
        self.prof_r = half + fur                               # outer half height (clearances, framing)
        self.f_px = self.cam.data.lens / self.cam.data.sensor_width * W_PX
        log('rest: L = %.3f D, %d curve points (nose first: %s), floor z = %.3f' % (
            self.L, len(self.rest), self.nose_first, self.floor))

    def bottom(self, u):
        return np.interp(u, self.prof_s, self.prof_bottom)

    def radius(self, u):
        return np.interp(u, self.prof_s, self.prof_r)

    def project(self, P):
        """pixel x, y (CamHero 1408x768, y down) and camera distance of world points"""
        self.sc.render.resolution_x, self.sc.render.resolution_y = W_PX, H_PX
        out = np.array([tuple(world_to_camera_view(self.sc, self.cam, Vector(p))) for p in P])
        return np.stack([out[:, 0] * W_PX, (1 - out[:, 1]) * H_PX, out[:, 2]], 1)

    def rest_contact(self):
        """contact height h and floor weight w of the rest points (w = 1 where the body lies on the floor)"""
        b = self.bottom(self.s_rest)
        c = self.rest[:, 2] - b - self.floor
        w = np.clip(1 - c / 0.15, 0, 1)
        return self.rest[:, 2] - w * b, w


# ======================================================================================== trails
class Trail:
    """polyline in the direction of travel.
    xy, z_ref: the path (z_ref = the centre height of a reference body part, used for the arc length);
    h, w: per point contact height and floor weight; a body part u D behind the nose passing a point has its
    axis at z = h + w * bottom(u) (w = 0 in the air: z = h)."""

    def __init__(self, xy, z_ref, h, w):
        self.xy, self.h, self.w = np.asarray(xy, float), np.asarray(h, float), np.asarray(w, float)
        P = np.c_[self.xy, z_ref]
        self.sig = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])

    def window(self, rest, sh):
        """body centre line with the head at sh: points nose -> tail (exactly L long) and their u"""
        lo = sh - rest.L
        inner = np.where((self.sig > lo + 1e-9) & (self.sig < sh - 1e-9))[0][::-1]
        ss = np.concatenate([[sh], self.sig[inner], [lo]])
        xy = np.stack([np.interp(ss, self.sig, self.xy[:, k]) for k in range(2)], 1)
        u = sh - ss
        z = np.interp(ss, self.sig, self.h) + np.interp(ss, self.sig, self.w) * rest.bottom(u)
        P = np.c_[xy, z]
        cum = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])
        if cum[-1] > rest.L + 1e-7:                              # floor lift changed the length: trim the tail
            i = int(np.searchsorted(cum, rest.L))
            f = (rest.L - cum[i - 1]) / (cum[i] - cum[i - 1])
            P = np.vstack([P[:i], P[i - 1] + (P[i] - P[i - 1]) * f])
            cum = np.concatenate([cum[:i], [rest.L]])
        elif cum[-1] < rest.L - 1e-7:                            # ... or extend it along the last segment
            d = P[-1] - P[-2]
            P = np.vstack([P, P[-1] + d / np.linalg.norm(d) * (rest.L - cum[-1])])
            cum = np.concatenate([cum, [rest.L]])
        return P, cum


def intro_trail(rest):
    """approach: an S-wave on the floor beyond the right edge -> the rest shape from the tail tip to the nose"""
    h_r, w_r = rest.rest_contact()
    T = rest.rest[-1]
    d = rest.rest[-1] - rest.rest[-12]
    d[2] = 0
    d /= np.linalg.norm(d)                                        # out of the tail tip, along the floor
    n = np.array([-d[1], d[0], 0.0])
    K = int((rest.L + 4) / 0.04)
    k = np.arange(1, K + 1) * 0.04
    amp = 0.7 * sstep(0.5, 4.0, k)                               # tangent-continuous at the tail tip
    P = T + d * k[:, None] + n * (amp * np.sin(2 * math.pi * k / 7.0))[:, None]
    blend = sstep(0, 1.0, k)
    hz = h_r[-1] + (rest.floor - h_r[-1]) * blend
    ww = w_r[-1] + (1 - w_r[-1]) * blend
    b_tip = float(rest.bottom(rest.L))
    zr = hz + ww * b_tip
    tr = Trail(np.vstack([P[::-1, :2], rest.rest[::-1, :2]]), np.concatenate([zr[::-1], rest.rest[::-1, 2]]),
               np.concatenate([hz[::-1], h_r[::-1]]), np.concatenate([ww[::-1], w_r[::-1]]))
    tr.approach = P
    return tr


def depart_trail(rest):
    """the rest shape from the tail tip to the nose -> down the left of the "a" -> along the floor in front"""
    h_r, w_r = rest.rest_contact()
    N = rest.rest[0]
    d0 = rest.rest[0] - rest.rest[10]
    d0 /= np.linalg.norm(d0)
    fl, xN = rest.floor, N[0]
    half_w = (-2.0 - rest.cam.location.y) * (rest.cam.data.sensor_width / 2) / rest.cam.data.lens
    x_far = half_w + rest.L + 4                                   # far enough for the tail to leave the frame
    B = N - d0 * 0.4
    A = N + d0 * 0.45
    C = [(B[0], B[1], B[2], 0.0),                                 # (x, y, h, w); B only sets the tangent at N
         (N[0], N[1], N[2], 0.0),
         (A[0], A[1], A[2], 0.0),
         (xN - 0.85, N[1] - 0.5, N[2] - 0.8, 0.0),
         (xN - 1.05, -1.15, fl + 2.1, 0.0),
         (xN - 0.95, -1.65, fl + 0.35, 1.0),
         (xN - 0.35, -2.0, fl, 1.0)]
    x = xN + 0.6
    while x < x_far:
        C.append((x, -2.0 + 0.3 * math.sin(2 * math.pi * (x - xN) / 5.0), fl, 1.0))
        x += 1.2
    sm = catmull(np.array(C), 16)[16:]                            # from N on (control points sit every 16 samples)
    zr = sm[:, 2] + np.clip(sm[:, 3], 0, 1) * 0.45
    sm = resample(np.c_[sm[:, :2], zr, sm[:, 2], np.clip(sm[:, 3], 0, 1)], 0.04)[1:]
    tr = Trail(np.vstack([rest.rest[::-1, :2], sm[:, :2]]), np.concatenate([rest.rest[::-1, 2], sm[:, 2]]),
               np.concatenate([h_r[::-1], sm[:, 3]]), np.concatenate([w_r[::-1], sm[:, 4]]))
    tr.nose_index = len(rest.rest) - 1
    return tr


# ======================================================================================== timing
def intro_profile(t, T, D, td=0.6):
    """constant speed v, then velocity v (1 - u)^2 over the last td seconds: arrives with zero speed"""
    v = D / (T - 2 * td / 3)
    if t <= T - td:
        return v * t
    u = (t - (T - td)) / td
    return v * (T - td) + v * td * (1 - (1 - u) ** 3) / 3


def depart_profile(t, T, D, ti=0.4):
    """velocity v (t / ti)^2 over the first ti seconds, then constant v"""
    v = D / (T - 2 * ti / 3)
    if t <= ti:
        return v * ti * (t / ti) ** 3 / 3
    return v * ti / 3 + v * (t - ti)


def offscreen(rest, P, u):
    """True if no part of the body (centre line +- its radius) is inside the CamHero frame"""
    pr = rest.project(P)
    rp = rest.radius(u) * rest.f_px / np.maximum(pr[:, 2], 1e-3) + OFF_MARGIN_PX + SEARCH_MARGIN_PX
    inside = (pr[:, 0] + rp > 0) & (pr[:, 0] - rp < W_PX) & (pr[:, 1] + rp > 0) & (pr[:, 1] - rp < H_PX) & (pr[:, 2] > 0)
    return not inside.any()


def clearance(rest, P, u, gap=2.5):
    """smallest gap between the fur surfaces of two body parts more than `gap` D apart along the body"""
    r = rest.radius(u)
    step = max(1, len(P) // 400)
    P, u, r = P[::step], u[::step], r[::step]
    d = np.linalg.norm(P[:, None] - P[None], axis=2) - (r[:, None] + r[None])
    far = np.abs(u[:, None] - u[None]) > gap
    return float(np.where(far, d, np.inf).min())


# ======================================================================================== bake
def set_curve(rest, P):
    cu = rest.curve
    pts = P if rest.nose_first else P[::-1]
    inv = np.array(cu.matrix_world.inverted())
    loc = (inv[:3, :3] @ pts.T).T + inv[:3, 3]
    cd = cu.data
    cd.splines.clear()
    sp = cd.splines.new('POLY')
    sp.points.add(len(loc) - 1)
    sp.points.foreach_set('co', np.c_[loc, np.ones(len(loc))].astype(np.float32).ravel())
    cd.update_tag()
    bpy.context.view_layer.update()


def bake(name, seconds, look=None, tongue=None):
    rest = Rest()
    sc, arm = rest.sc, rest.arm
    NF = int(round(seconds * FPS))
    T = (NF - 1) / FPS
    if name == 'hero_intro':
        tr = intro_trail(rest)
        pa = rest.project(tr.approach)
        log('approach trail: leftmost point at x = %.0f px (frame right edge %d)' % (pa[:, 0].min(), W_PX))
        s_end = float(tr.sig[-1])                                  # nose on the rest nose
        s0 = None
        for sh in np.arange(rest.L, s_end, 0.05):
            if not offscreen(rest, *tr.window(rest, sh)):
                s0 = sh - 0.05
                break
        assert s0 is not None and s0 >= rest.L, 'approach trail too short'
        D = s_end - s0
        prof = [s0 + intro_profile(f / FPS, T, D) for f in range(NF)]
    else:
        tr = depart_trail(rest)
        s_start = float(tr.sig[tr.nose_index])
        s1 = None
        for sh in np.arange(s_start + rest.L * 0.5, tr.sig[-1], 0.05):
            if offscreen(rest, *tr.window(rest, sh)):
                s1 = sh + 0.05
                break
        assert s1 is not None and s1 <= tr.sig[-1], 'depart trail too short'
        D = s1 - s_start
        prof = [s_start + depart_profile(f / FPS, T, D) for f in range(NF)]
    log('%s: %d frames, the head travels %.2f D (top speed %.1f D/s, %.2f D per frame)' % (
        name, NF, D, max(np.diff(prof)) * FPS, max(np.diff(prof))))

    Ms, gaps = [], []
    for f in range(NF):
        P, u = tr.window(rest, prof[f])
        set_curve(rest, P)
        Ms.append({pb.name: pb.matrix.copy() for pb in arm.pose.bones})
        gaps.append(clearance(rest, P, u))
    jf = NF - 1 if name == 'hero_intro' else 0                     # the frame that meets the idle loop
    err = max((Ms[jf][n].translation - rest.M0[n].translation).length for n in rest.M0)
    rot = max(abs(Ms[jf][n].to_3x3()[i][j] - rest.M0[n].to_3x3()[i][j]) for n in rest.M0 for i in range(3)
              for j in range(3))
    log('%s frame %d vs the rest pose: max bone offset %.6f D (%.4f px), max rotation entry diff %.6f' % (
        name, jf + 1, err, err * 104, rot))
    worst = int(np.argmin(gaps))
    log('%s: smallest fur-to-fur gap between body parts %.2f D (frame %d); in the rest pose %.2f D' % (
        name, gaps[worst], worst + 1, clearance(rest, rest.rest, rest.s_rest)))

    # restore the rest curve, mute Spline IK, key the poses (plus the optional look and tongue tracks)
    set_curve(rest, rest.rest)
    for pb in arm.pose.bones:
        for c in pb.constraints:
            if c.type == 'SPLINE_IK':
                c.mute = True
        pb.rotation_mode = 'QUATERNION'
    H = arm.data.bones['Head']
    rel = lambda n: H.matrix_local.inverted() @ arm.data.bones[n].matrix_local
    names = [pb.name for pb in arm.pose.bones]
    data = {n: np.zeros((NF, 10)) for n in names}
    prevq = {}
    for f in range(NF):
        t = f / FPS
        Mt = {k: v.copy() for k, v in Ms[f].items()}
        if look:
            yaw, pit = smooth_keys(look[0], t), smooth_keys(look[1], t)
            up = (Mt['Head'].to_3x3() @ (H.matrix_local.to_3x3().inverted() @ Vector((0, 0, 1)))).normalized()
            side = (Mt['Head'].to_3x3() @ (H.matrix_local.to_3x3().inverted() @ Vector((0, 1, 0)))).normalized()
            Cm = Matrix.Identity(4)
            for bn, wgt in reversed(LOOK_SHARE):
                tail = Cm @ (Ms[f][bn] @ Vector((0, arm.data.bones[bn].length, 0)))
                R = (Quaternion(up, yaw * wgt) @ Quaternion(side, pit * wgt)).to_matrix().to_4x4()
                Cm = Matrix.Translation(tail) @ R @ Matrix.Translation(-tail) @ Cm
                Mt[bn] = Cm @ Ms[f][bn]
        tg = smooth_keys(tongue, t) if tongue else 0.03
        Mt['Tongue'] = Mt['Head'] @ rel('Tongue') @ Matrix.Diagonal((tg, tg, tg, 1))
        Mt['Jaw'] = Mt['Head'] @ rel('Jaw')
        for n in names:
            bn = arm.data.bones[n]
            if bn.parent is None:
                B = bn.matrix_local.inverted() @ Mt[n]
            else:
                B = ((bn.parent.matrix_local.inverted() @ bn.matrix_local).inverted() @ Mt[bn.parent.name].inverted()
                     @ Mt[n])
            loc, q, scl = B.decompose()
            if n in prevq and q.dot(prevq[n]) < 0:
                q = -q
            prevq[n] = q
            data[n][f] = [*loc, q.w, q.x, q.y, q.z, *scl]
    act = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = act
    for n in names:
        for path, cols in (('location', range(0, 3)), ('rotation_quaternion', range(3, 7)), ('scale', range(7, 10))):
            for k, c in enumerate(cols):
                fc = act.fcurve_ensure_for_datablock(arm, 'pose.bones["%s"].%s' % (n, path), index=k)
                fc.keyframe_points.clear()
                fc.keyframe_points.add(NF)
                co = np.stack([np.arange(1, NF + 1, dtype=float), data[n][:, c]], 1).ravel()
                fc.keyframe_points.foreach_set('co', co.astype(np.float32))
                for kp in fc.keyframe_points:
                    kp.interpolation = 'LINEAR'
                fc.update()
    act.use_fake_user = True
    sc.render.fps = FPS
    sc.frame_start, sc.frame_end = 1, NF
    # framing check on the posed skin: the first frame of the intro and the last of the depart are empty
    f = 1 if name == 'hero_intro' else NF
    sc.frame_set(f)
    dg = bpy.context.evaluated_depsgraph_get()
    ob = bpy.data.objects['Body'].evaluated_get(dg)
    me = ob.to_mesh()
    V = np.array([tuple(ob.matrix_world @ v.co) for v in me.vertices])
    ob.to_mesh_clear()
    pr = rest.project(V)
    m = FUR * rest.f_px / pr[:, 2] + OFF_MARGIN_PX
    ins = (pr[:, 0] + m > 0) & (pr[:, 0] - m < W_PX) & (pr[:, 1] + m > 0) & (pr[:, 1] - m < H_PX)
    deep = 0.0
    if ins.any():
        q = pr[ins]
        mm = m[ins]
        deep = float(np.max(np.minimum.reduce([q[:, 0] + mm, W_PX - (q[:, 0] - mm), q[:, 1] + mm, H_PX - (q[:, 1] - mm)])))
        log('  inside at px x %.0f..%.0f, y %.0f..%.0f' % (q[:, 0].min(), q[:, 0].max(), q[:, 1].min(), q[:, 1].max()))
    log('%s frame %d: %d of %d skin vertices (plus the fur depth) inside the frame, deepest %.1f px' % (
        name, f, int(ins.sum()), len(V), deep))
    sc.frame_set(1)
    out = os.path.join(RENDERS_DIR, name + '.blend')
    bpy.ops.wm.save_as_mainfile(filepath=out, compress=False)
    log('saved', out)
    return NF


# ======================================================================================== drafts
def find_ffmpeg():
    p = arg('--ffmpeg', None) or shutil.which('ffmpeg')
    if not p:
        base = os.path.expandvars(r'%LOCALAPPDATA%\Microsoft\WinGet\Packages')
        for root, _, files in os.walk(base):
            if 'ffmpeg.exe' in files:
                return os.path.join(root, 'ffmpeg.exe')
    return p


def draft(name, NF):
    sc = bpy.context.scene
    if '--cpu' not in argv:
        cp = bpy.context.preferences.addons['cycles'].preferences
        for tdev in ('OPTIX', 'CUDA', 'HIP', 'ONEAPI', 'METAL'):
            try:
                cp.compute_device_type = tdev
            except TypeError:
                continue
            cp.refresh_devices()
            if any(dv.type == tdev for dv in cp.devices):
                for dv in cp.devices:
                    dv.use = dv.type == tdev
                sc.cycles.device = 'GPU'
                break
    bpy.data.objects['Fur'].hide_render = True
    dm = bpy.data.objects['Body'].modifiers.new('FurDepth', 'DISPLACE')   # the skin fattened to the fur surface
    dm.strength, dm.mid_level, dm.direction = FUR, 0.0, 'NORMAL'
    sc.render.resolution_x, sc.render.resolution_y = DRAFT_RES
    sc.render.resolution_percentage = 100
    sc.cycles.samples = 16
    sc.cycles.use_denoising = True
    sc.render.use_persistent_data = True
    sc.render.film_transparent = False
    tmp = os.path.join(RENDERS_DIR, '_draft_' + name)
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = os.path.join(tmp, 'f_')
    sc.frame_start, sc.frame_end = 1, NF
    t0 = time.time()
    bpy.ops.render.render(animation=True)
    log('%s draft: %d frames in %.0f s' % (name, NF, time.time() - t0))
    os.makedirs(MOTION, exist_ok=True)
    mp4 = os.path.join(MOTION, name + '_draft.mp4')
    subprocess.check_call([find_ffmpeg(), '-y', '-loglevel', 'error', '-framerate', str(FPS),
                           '-i', os.path.join(tmp, 'f_%04d.png'), '-c:v', 'libx264', '-crf', '20',
                           '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4])
    log('wrote', mp4)


which = arg('--clip', 'all')
for nm, cfg in CLIPS.items():
    if which in ('all', nm):
        nf = bake(nm, cfg['seconds'], cfg.get('look'), cfg.get('tongue'))
        if '--draft' in argv:
            draft(nm, nf)
log('done')
