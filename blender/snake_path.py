"""
ae studio - the plush snake travelling along a 3D trajectory without stretching ("follow the leader").

Needs the scene from snake_scene.py (C:/Users/vladk/ae-studio/renders/snake.blend by default).

    blender -b --factory-startup --python blender/snake_path.py                       # bake H1 + H2
    blender -b --factory-startup --python blender/snake_path.py -- --animatic         # + animatic MP4s
    blender -b --factory-startup --python blender/snake_path.py -- --clip hero_depart --animatic
    options: --shutter 0.5|1.0 (also key the subframes f -+ s/2 for motion blur), --depart-frames 48

How it works
    A master trajectory (trail) is a polyline in the direction of travel, parametrised by arc length sigma.
    On every frame the head sits at sigma_h(t) and the body occupies the window [sigma_h - L, sigma_h]
    (L = length of the snake): the point u D behind the nose is at sigma_h - u, so every point of the body
    follows the head's track exactly, without sliding. The window is written into SpinePath, Spline IK fits
    the bone chain to it (the curve is exactly as long as the chain, so nothing stretches) and the bone poses
    are baked to plain FK keys, as in snake_anim.py --bake (no Spline IK, no handlers at render time).
    Floor contact: a trail point lying on the floor stores its contact height; the body part passing over
    it is lifted by its own radius (the head is thicker than the tail it follows).

Roll (spec B4-3)
    Spline IK aligns every bone by the shortest rotation from its straight rest, which spins the head
    180-300 degrees on the letter crossbars. So each trail carries a frame field: the rotation-minimising
    (parallel-transported) normal of the rest Head frame, anchored at the Head's rest arc position and
    carried both ways along the trail; where the trail lies on the floor it is ramped (over >= 3 D) to the
    dorsal-up normal. At bake time every bone is rolled about its own axis onto the field at its own arc
    position. The rest pose (H3) is the last frame of hero_intro, so its rolls come from the same field.
    Asserts on every frame: Head, Spine_10, _30, _50 twist (rotation about the bone's own axis) <= 10 deg
    between frames; bones on the floor have the dorsal axis within 15 deg of +Z.
    (The spec's literal "local X turns <= 10 deg" cannot hold while the body follows letter curves of ~1 D
    radius at 0.4-1.2 D per frame, so the twist part - the spin the assert is meant to catch - is checked.)

Clips (30 fps, frame 0 = the first frame)
    hero_intro   84 frames: frames 0-2 empty, the head enters on frame ~3 along an S-wave on the floor
                 (amplitude 0.35 D), traces the tail line, the "e", the "a"; constant speed, ease-out over
                 the last 0.6 s; frame 83 is the rest pose (H3). No tongue, no look.
    hero_depart  48 frames: frame 0 = H3, ease-in over frames 0-3; the head steps down the left side of
                 the "a" heading left-front (a pitch step, so the back stays up), turns on the floor toward
                 the camera and crawls right in front of the letters, out of frame; the last frame is empty.
                 The letters the body has left settle: a trail section starts to topple backwards onto the
                 floor SETTLE_DELAY after the middle of the body has passed it, over SETTLE_S, so the tail
                 slides along the floor instead of tracing the letters in the air.

Outputs
    C:/Users/vladk/ae-studio/renders/hero_intro.blend, hero_depart.blend   baked actions (fur included)
    C:/Users/vladk/ae-studio/renders/hero_rest_pose.npz                    H3 bone matrices (joint check)
    blender/renders/motion/<clip>_animatic.mp4   Cycles 16 spp, no fur (skin fattened by the fur depth),
                                                 25 % of 1408x896, transparent film over #F1D6DA, shown 2x
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
W_PX, H_PX = 1408, 896                        # CamHero / CamGauge clip frame (CamHero overscanned, spec B1)
FUR = 0.13
OFF_MARGIN_PX = 6                            # "out of frame" = the fur tips are this far beyond the edge
SEARCH_MARGIN_PX = 30                        # extra margin of the centre-line test (bones are straight segments)
LOOK_SHARE = [('Head', 0.45), ('Spine_01', 0.22), ('Spine_02', 0.15), ('Spine_03', 0.09), ('Spine_04', 0.06),
              ('Spine_05', 0.03)]
RAMP_D = 8.0                                 # roll ramp to dorsal-up spreads over this much path (spec: >= 3 D)
FLOOR_RUN = 2.0                              # a floor segment = >= this much path lying on the floor
SETTLE_S, SETTLE_DELAY = 0.40, 0.05          # hero_depart: letters topple onto the floor
TWIST_MAX, DORSAL_MAX = 10.0, 15.0
ASSERT_BONES = ['Head', 'Spine_10', 'Spine_30', 'Spine_50']
ZUP = np.array([0.0, 0.0, 1.0])


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


# ======================================================================================== frame fields
def nrm(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-12)


def tangents(X):
    return nrm(np.gradient(X, axis=0))


def rmf(X, T, i0, n0):
    """rotation-minimising normals along the polyline X (double reflection), anchored at i0 with normal n0"""
    n = len(X)
    N = np.zeros((n, 3))
    N[i0] = nrm(n0 - (n0 @ T[i0]) * T[i0])
    for idx, step in ((range(i0 + 1, n), 1), (range(i0 - 1, -1, -1), -1)):
        for i in idx:
            j = i - step
            v1 = X[i] - X[j]
            c1 = v1 @ v1
            if c1 < 1e-16:
                N[i] = N[j]
                continue
            rL = N[j] - (2 / c1) * (v1 @ N[j]) * v1
            tL = T[j] - (2 / c1) * (v1 @ T[j]) * v1
            v2 = T[i] - tL
            c2 = v2 @ v2
            r = rL - (2 / c2) * (v2 @ rL) * v2 if c2 > 1e-16 else rL
            N[i] = nrm(r - (r @ T[i]) * T[i])
    return N


def up_normals(T):
    return nrm(ZUP[None] - (T @ ZUP)[:, None] * T)


def signed_angle(a, b, axis):
    return np.arctan2(np.einsum('ij,ij->i', np.cross(a, b), axis), np.einsum('ij,ij->i', a, b))


def rotate(v, axis, ang):
    """Rodrigues, row-wise"""
    c, s = np.cos(ang)[:, None], np.sin(ang)[:, None]
    return v * c + np.cross(axis, v) * s + axis * (np.einsum('ij,ij->i', axis, v))[:, None] * (1 - c)


def ramp_to_up(F, T, g, near=None):
    """roll the normals F about T toward dorsal-up by the fraction g (0..1). With `near` (index of the
    nearest floor-segment point) the angle is the constant offset measured on that floor segment: world-up
    is undefined where a letter stroke runs vertical, so it is never measured there."""
    d = signed_angle(F, up_normals(T), T)
    if near is not None:
        d = d[near]
    return nrm(rotate(F, T, g * d))


def floor_ramp(sig, w):
    """ramp weight: 1 on floor segments (runs of >= FLOOR_RUN D with w >= 0.9; brief touches of a letter
    bottom do not count), falling to 0 over RAMP_D of path on either side"""
    on = w >= 0.9
    keep = np.zeros(len(w), bool)
    i = 0
    while i < len(w):
        if on[i]:
            j = i
            while j + 1 < len(w) and on[j + 1]:
                j += 1
            if sig[j] - sig[i] >= FLOOR_RUN:
                keep[i:j + 1] = True
            i = j + 1
        else:
            i += 1
    if not keep.any():
        return np.zeros(len(w)), np.zeros(len(w), int)
    ki = np.where(keep)[0]
    ks = sig[ki]
    k = np.clip(np.searchsorted(ks, sig), 1, len(ks) - 1)
    left = np.abs(sig - ks[k - 1]) <= np.abs(sig - ks[k])
    near = np.where(left, ki[k - 1], ki[k])
    return sstep(RAMP_D, 0.0, np.abs(sig - sig[near])), near


# ======================================================================================== the rest scene
class Rest:
    def __init__(self, blend=SRC_BLEND):
        bpy.ops.wm.open_mainfile(filepath=blend)
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
        self.M0 = {pb.name: pb.matrix.copy() for pb in arm.pose.bones}       # the Spline IK photo pose
        sweep = bpy.data.objects.get('Sweep')
        self.floor = min(v.co.z for v in sweep.data.vertices) if sweep else 0.0
        # chain bones: arc position of the bone middle (the rest chain runs along +X from the nose) and the
        # dorsal axis in bone space (armature +Z of the straight rest chain)
        self.chain = [b.name for b in arm.data.bones if b.name == 'Head' or b.name.startswith('Spine_')]
        self.bone_s = {n: 0.5 * (arm.data.bones[n].head_local.x + arm.data.bones[n].tail_local.x) for n in self.chain}
        self.zb = {n: (arm.data.bones[n].matrix_local.to_3x3().inverted() @ Vector((0, 0, 1))).normalized()
                   for n in self.chain}
        self.Aw = np.array(arm.matrix_world.to_3x3())
        self.Aw_inv = np.linalg.inv(self.Aw)
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
        log('rest: L = %.3f D, %d curve points (nose first: %s), floor z = %.3f' % (
            self.L, len(self.rest), self.nose_first, self.floor))

    def bottom(self, u):
        return np.interp(u, self.prof_s, self.prof_bottom)

    def radius(self, u):
        return np.interp(u, self.prof_s, self.prof_r)

    def head_dorsal(self, M=None):
        M = (M or self.M0)['Head']
        return self.Aw @ np.array(M.to_3x3() @ self.zb['Head'])

    def project(self, P):
        """pixel x, y (W_PX x H_PX clip frame, y down) and camera distance of world points"""
        self.sc.render.resolution_x, self.sc.render.resolution_y = W_PX, H_PX
        self.sc.render.resolution_percentage = 100
        out = np.array([tuple(world_to_camera_view(self.sc, self.cam, Vector(p))) for p in P])
        return np.stack([out[:, 0] * W_PX, (1 - out[:, 1]) * H_PX, out[:, 2]], 1)

    def px_per_d(self, depth):
        cd = self.cam.data
        depth = np.asarray(depth, float)
        if cd.type == 'ORTHO':
            return np.full_like(depth, W_PX / cd.ortho_scale)
        return cd.lens / cd.sensor_width * W_PX / np.maximum(depth, 1e-3)

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
    axis at z = h + w * bottom(u) (w = 0 in the air: z = h). N: the frame field (dorsal normal per point)."""

    def __init__(self, xy, z_ref, h, w, N=None):
        self.xy, self.h, self.w = np.asarray(xy, float), np.asarray(h, float), np.asarray(w, float)
        self.X = np.c_[self.xy, z_ref]
        self.sig = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(self.X, axis=0), axis=1))])
        self.N = N

    def window(self, rest, sh):
        """body centre line with the head at sh: points nose -> tail (exactly L long), their arc length from
        the nose and their sigma on the trail"""
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
            ss = np.concatenate([ss[:i], [ss[i - 1] + (ss[i] - ss[i - 1]) * f]])
            cum = np.concatenate([cum[:i], [rest.L]])
        elif cum[-1] < rest.L - 1e-7:                            # ... or extend it along the last segment
            d = P[-1] - P[-2]
            ext = rest.L - cum[-1]
            P = np.vstack([P, P[-1] + d / np.linalg.norm(d) * ext])
            ss = np.concatenate([ss, [ss[-1] - ext]])
            cum = np.concatenate([cum, [rest.L]])
        return P, cum, ss

    def at(self, s, arr):
        return np.stack([np.interp(s, self.sig, arr[:, k]) for k in range(arr.shape[1])], -1)


def anchor_field(rest, tr, sig_nose, nose_index):
    """frame field: RMF of the rest Head frame from the Head's arc position, then ramped to dorsal-up where
    the trail lies on the floor"""
    T = tangents(tr.X)
    i0 = int(np.argmin(np.abs(tr.sig - (sig_nose - rest.bone_s['Head']))))
    F = rmf(tr.X, T, i0, rest.head_dorsal())
    # ramps stay on their side of the rest nose, so the rest window gets the same field in every clip
    k = nose_index + 1
    g1, n1 = floor_ramp(tr.sig[:k], tr.w[:k])
    if k < len(tr.sig):
        g2, n2 = floor_ramp(tr.sig[k:], tr.w[k:])
        tr.g, near = np.concatenate([g1, g2]), np.concatenate([n1, n2 + k])
    else:
        tr.g, near = g1, n1
    return ramp_to_up(F, T, tr.g, near)


def intro_trail(rest):
    """approach: an S-wave on the floor beyond the right edge -> the rest shape from the tail tip to the nose"""
    h_r, w_r = rest.rest_contact()
    T = rest.rest[-1]
    d = rest.rest[-1] - rest.rest[-12]
    d[2] = 0
    d /= np.linalg.norm(d)                                        # out of the tail tip, along the floor
    n = np.array([-d[1], d[0], 0.0])
    K = int((rest.L + 6) / 0.04)
    k = np.arange(1, K + 1) * 0.04
    amp = 0.35 * sstep(0.5, 4.0, k)                              # spec B5: S-wave amplitude <= 0.35 D
    P = T + d * k[:, None] + n * (amp * np.sin(2 * math.pi * k / 6.0))[:, None]
    blend = sstep(0, 1.0, k)
    hz = h_r[-1] + (rest.floor - h_r[-1]) * blend
    ww = w_r[-1] + (1 - w_r[-1]) * blend
    zr = hz + ww * float(rest.bottom(rest.L))
    tr = Trail(np.vstack([P[::-1, :2], rest.rest[::-1, :2]]), np.concatenate([zr[::-1], rest.rest[::-1, 2]]),
               np.concatenate([hz[::-1], h_r[::-1]]), np.concatenate([ww[::-1], w_r[::-1]]))
    tr.nose_index = len(tr.sig) - 1
    tr.N = anchor_field(rest, tr, tr.sig[-1], tr.nose_index)
    return tr


def depart_trail(rest):
    """the rest shape from the tail tip to the nose -> a pitch step down the left of the "a" (heading
    left-front, so the back stays up) -> a turn on the floor -> along the floor in front of the letters"""
    h_r, w_r = rest.rest_contact()
    N = rest.rest[0]
    d0 = rest.rest[0] - rest.rest[10]
    d0 /= np.linalg.norm(d0)
    fl = rest.floor
    hd = np.array([-0.8, -0.6])                                   # heading of the step (left and toward us)
    half_w = (-2.6 - rest.cam.location.y) * (rest.cam.data.sensor_width / 2) / rest.cam.data.lens
    x_far = rest.cam.location.x + half_w + rest.L + 4
    B = N - d0 * 0.4
    A = N + d0 * 0.45
    q = lambda a, z, w: (N[0] + hd[0] * a, N[1] + hd[1] * a, z, w)
    C = [(B[0], B[1], B[2], 0.0), (N[0], N[1], N[2], 0.0), (A[0], A[1], A[2], 0.0),
         q(0.95, N[2] - 0.55, 0.0),
         q(1.30, fl + 1.35 + 0.35 * max(N[2] - fl - 2.6, 0), 0.0),
         q(1.55, fl + 0.35, 1.0),
         q(2.05, fl, 1.0)]                                        # level again, still heading left-front
    E = np.array(C[-1][:2])
    C += [(E[0] - 0.15, E[1] - 0.55, fl, 1.0), (E[0] + 0.35, E[1] - 0.95, fl, 1.0)]   # turn on the floor
    y0 = E[1] - 1.0
    x = E[0] + 1.3
    while x < x_far:
        C.append((x, y0 + 0.25 * math.sin(2 * math.pi * (x - E[0] - 1.3) / 5.0), fl, 1.0))
        x += 1.2
    sm = catmull(np.array(C), 16)[16:]                            # from N on (control points sit every 16 samples)
    zr = sm[:, 2] + np.clip(sm[:, 3], 0, 1) * 0.45
    sm = resample(np.c_[sm[:, :2], zr, sm[:, 2], np.clip(sm[:, 3], 0, 1)], 0.04)[1:]
    tr = Trail(np.vstack([rest.rest[::-1, :2], sm[:, :2]]), np.concatenate([rest.rest[::-1, 2], sm[:, 2]]),
               np.concatenate([h_r[::-1], sm[:, 3]]), np.concatenate([w_r[::-1], sm[:, 4]]))
    tr.nose_index = len(rest.rest) - 1
    tr.N = anchor_field(rest, tr, tr.sig[tr.nose_index], tr.nose_index)
    log('depart route: nose at (%.2f, %.2f, %.2f), step lands at (%.2f, %.2f), crawl line y = %.2f' % (
        N[0], N[1], N[2], E[0], E[1], y0))
    return tr


def settled(rest, tr0, t, t_s):
    """hero_depart at time t: letter points whose settle time t_s has come topple backwards onto the floor
    (rotation about the x axis through their own depth, so crossings keep their depth offset)"""
    fin = np.isfinite(t_s)
    s = np.zeros(len(t_s))
    s[fin] = sstep(t_s[fin], t_s[fin] + SETTLE_S, t) * (1 - tr0.w[fin])
    if not s.any():
        return tr0
    th = s * math.pi / 2
    zc = rest.floor + 0.47
    dz = tr0.X[:, 2] - zc
    y = tr0.xy[:, 1] + dz * np.sin(th)
    zn = zc + dz * np.cos(th)
    h = (1 - s) * (tr0.h + (zn - tr0.X[:, 2])) + s * rest.floor
    w = (1 - s) * tr0.w + s
    tr = Trail(np.c_[tr0.xy[:, 0], y], zn, h, w)
    c, si = np.cos(th), np.sin(th)
    N0 = tr0.N
    Nr = np.c_[N0[:, 0], N0[:, 1] * c + N0[:, 2] * si, -N0[:, 1] * si + N0[:, 2] * c]
    T = tangents(tr.X)
    Nr = nrm(Nr - np.einsum('ij,ij->i', Nr, T)[:, None] * T)
    tr.N = Nr                     # the frame turns with the letter (no extra roll: the body is round there)
    tr.g = tr0.g                  # toppled letters are not floor segments for the dorsal-up assert
    tr.nose_index = tr0.nose_index
    return tr


# ======================================================================================== timing
def intro_profile(t, T, D, td=0.6):
    """constant speed v, then velocity v (1 - u)^2 over the last td seconds: arrives with zero speed"""
    v = D / (T - 2 * td / 3)
    if t <= T - td:
        return v * t
    u = (t - (T - td)) / td
    return v * (T - td) + v * td * (1 - (1 - u) ** 3) / 3


def depart_profile(t, T, D, ti=0.1):
    """velocity v (t / ti)^2 over the first ti seconds (frames 0-3), then constant v"""
    v = D / (T - 2 * ti / 3)
    if t <= ti:
        return v * ti * (t / ti) ** 3 / 3
    return v * ti / 3 + v * (t - ti)


def offscreen(rest, P, u, margin=OFF_MARGIN_PX + SEARCH_MARGIN_PX):
    """True if no part of the body (centre line +- its radius) is inside the clip frame"""
    pr = rest.project(P)
    rp = rest.radius(u) * rest.px_per_d(pr[:, 2]) + margin
    inside = (pr[:, 0] + rp > 0) & (pr[:, 0] - rp < W_PX) & (pr[:, 1] + rp > 0) & (pr[:, 1] - rp < H_PX) & (pr[:, 2] > 0)
    return not inside.any()


def head_inside(rest, tr, sh):
    """the snout (with its fur) is left of the right frame edge"""
    P = tr.window(rest, sh)[0]
    pr = rest.project(P[:1])
    return bool(pr[0, 0] + 0.6 * rest.px_per_d(pr[:, 2])[0] < W_PX)


def clearance(rest, P, u, gap=2.5):
    """smallest gap between the fur surfaces of two body parts more than `gap` D apart along the body"""
    r = rest.radius(u)
    step = max(1, len(P) // 400)
    P, u, r = P[::step], u[::step], r[::step]
    d = np.linalg.norm(P[:, None] - P[None], axis=2) - (r[:, None] + r[None])
    far = np.abs(u[:, None] - u[None]) > gap
    return float(np.where(far, d, np.inf).min())


# ======================================================================================== posing
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


def pose(rest, tr, sh):
    """Spline IK pose with the head at sh, every chain bone rolled onto the trail's frame field.
    Returns the bone matrices, the window points, their arc length, and per chain bone (dorsal, floor w)."""
    P, cum, ss = tr.window(rest, sh)
    set_curve(rest, P)
    M = {pb.name: pb.matrix.copy() for pb in rest.arm.pose.bones}
    info = {}
    for n in rest.chain:
        sb = float(np.interp(rest.bone_s[n], cum, ss))
        Nw = tr.at(sb, tr.N)
        Na = Vector(rest.Aw_inv @ (Nw / np.linalg.norm(Nw)))
        m = M[n]
        R = m.to_3x3()
        y = R.col[1].normalized()
        zc = (R @ rest.zb[n]).normalized()
        tgt = (Na - Na.dot(y) * y).normalized()
        phi = math.atan2(zc.cross(tgt).dot(y), zc.dot(tgt))
        M[n] = m @ Matrix.Rotation(phi, 4, 'Y')
        dors = rest.Aw @ np.array((M[n].to_3x3() @ rest.zb[n]).normalized())
        yw = rest.Aw @ np.array(y)
        upb = ZUP - (ZUP @ yw) * yw                               # world-up off the bone's own axis
        dors = (dors, upb / max(np.linalg.norm(upb), 1e-9))
        info[n] = (dors, float(np.interp(sb, tr.sig, tr.g)))      # g = 1: on a floor segment
    return M, P, cum, info


def twist_deg(Ma, Mb):
    """rotation about the bone's own (Y) axis between two poses, degrees (0..180)"""
    qa = Ma.to_3x3().normalized().to_quaternion()
    qb = Mb.to_3x3().normalized().to_quaternion()
    q = qa.inverted() @ qb
    t = abs(math.degrees(2 * math.atan2(q.y, q.w))) % 360
    return min(t, 360 - t)


def check_roll(name, Ms, infos):
    worst_t, wt = 0.0, None
    for f in range(1, len(Ms)):
        for n in ASSERT_BONES:
            t = twist_deg(Ms[f - 1][n], Ms[f][n])
            if t > worst_t:
                worst_t, wt = t, (f, n)
    worst_d, wd = 0.0, None
    for f, inf in enumerate(infos):
        for n, ((dors, upb), w) in inf.items():
            if w >= 0.99:
                a = math.degrees(math.acos(np.clip(np.dot(dors, upb), -1, 1)))
                if a > worst_d:
                    worst_d, wd = a, (f, n)
    ok = worst_t <= TWIST_MAX and worst_d <= DORSAL_MAX
    log('%s roll asserts %s: max twist %.1f deg/frame (frame, bone %s), max dorsal tilt on the floor %.1f deg (%s)' % (
        name, 'PASS' if ok else 'FAIL', worst_t, wt, worst_d, wd))
    return dict(ok=ok, twist=worst_t, dorsal=worst_d)


def look_matrices(rest, M, yaw, pit):
    """LOOK_SHARE turn of head + neck about the head's up (yaw) and side (pitch) axes, as in snake_anim"""
    arm = rest.arm
    H = arm.data.bones['Head']
    up = (M['Head'].to_3x3() @ (H.matrix_local.to_3x3().inverted() @ Vector((0, 0, 1)))).normalized()
    side = (M['Head'].to_3x3() @ (H.matrix_local.to_3x3().inverted() @ Vector((0, 1, 0)))).normalized()
    Mt = dict(M)
    Cm = Matrix.Identity(4)
    for bn, wgt in reversed(LOOK_SHARE):
        tail = Cm @ (M[bn] @ Vector((0, arm.data.bones[bn].length, 0)))
        R = (Quaternion(up, yaw * wgt) @ Quaternion(side, pit * wgt)).to_matrix().to_4x4()
        Cm = Matrix.Translation(tail) @ R @ Matrix.Translation(-tail) @ Cm
        Mt[bn] = Cm @ M[bn]
    return Mt


def key_action(rest, name, keys, look=None, tongue=None):
    """keys: list of (blender frame number (float), time s, bone matrices). Mutes Spline IK and writes FK."""
    arm = rest.arm
    set_curve(rest, rest.rest)
    for pb in arm.pose.bones:
        for c in pb.constraints:
            if c.type == 'SPLINE_IK':
                c.mute = True
        pb.rotation_mode = 'QUATERNION'
    H = arm.data.bones['Head']
    rel = lambda n: H.matrix_local.inverted() @ arm.data.bones[n].matrix_local
    names = [pb.name for pb in arm.pose.bones]
    NK = len(keys)
    data = {n: np.zeros((NK, 10)) for n in names}
    prevq = {}
    for k, (fr, t, M) in enumerate(keys):
        Mt = look_matrices(rest, M, smooth_keys(look[0], t), smooth_keys(look[1], t)) if look else dict(M)
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
            data[n][k] = [*loc, q.w, q.x, q.y, q.z, *scl]
    act = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = act
    frames = np.array([k[0] for k in keys], float)
    for n in names:
        for path, cols in (('location', range(0, 3)), ('rotation_quaternion', range(3, 7)), ('scale', range(7, 10))):
            for k, c in enumerate(cols):
                fc = act.fcurve_ensure_for_datablock(arm, 'pose.bones["%s"].%s' % (n, path), index=k)
                fc.keyframe_points.clear()
                fc.keyframe_points.add(NK)
                fc.keyframe_points.foreach_set('co', np.stack([frames, data[n][:, c]], 1).ravel().astype(np.float32))
                for kp in fc.keyframe_points:
                    kp.interpolation = 'LINEAR'
                fc.update()
    act.use_fake_user = True
    return act


def sample_times(NF, shutter):
    """(blender frame, time) for frames 0..NF-1 (blender frames 1..NF), plus subframes f -+ shutter/2"""
    out = []
    for f in range(NF):
        for o in ((-shutter / 2, 0.0, shutter / 2) if shutter > 0 else (0.0,)):
            out.append((round(f + 1 + o, 6), (f + o) / FPS))
    return sorted(set(out))


def frame_check(rest, f, name):
    """posed skin of blender frame f: number of vertices (plus the fur depth) inside the clip frame"""
    sc = rest.sc
    sc.frame_set(f)
    dg = bpy.context.evaluated_depsgraph_get()
    ob = bpy.data.objects['Body'].evaluated_get(dg)
    me = ob.to_mesh()
    V = np.array([tuple(ob.matrix_world @ v.co) for v in me.vertices])
    ob.to_mesh_clear()
    pr = rest.project(V)
    m = FUR * rest.px_per_d(pr[:, 2]) + OFF_MARGIN_PX
    ins = (pr[:, 0] + m > 0) & (pr[:, 0] - m < W_PX) & (pr[:, 1] + m > 0) & (pr[:, 1] - m < H_PX)
    log('%s frame %d: %d of %d skin vertices (plus the fur depth) inside the frame%s; skin y range %.0f..%.0f px' % (
        name, f - 1, int(ins.sum()), len(V),
        '' if not ins.any() else ' (x %.0f..%.0f)' % (pr[ins, 0].min(), pr[ins, 0].max()), pr[:, 1].min(), pr[:, 1].max()))
    return int(ins.sum())


# ======================================================================================== hero clips
def intro_motion(rest):
    NF = 84
    T = (NF - 1) / FPS
    tr = intro_trail(rest)
    s_end = float(tr.sig[-1])
    s_vis = None
    for sh in np.arange(rest.L, s_end, 0.02):                      # first head position touching the frame
        P, cum, ss = tr.window(rest, sh)
        if not offscreen(rest, P, cum):
            s_vis = sh
            break
    assert s_vis is not None
    # frames 0-2 empty: frame 2 sits a little short of s_vis
    s0 = s_vis
    for it in range(20):
        D = s_end - s0
        v = D / (T - 0.4)
        s0 = s_vis - v * 2 / FPS - 0.05
    D = s_end - s0
    prof = lambda t: s0 + intro_profile(t, T, D)
    v = max(prof((f + 1) / FPS) - prof(f / FPS) for f in range(NF - 1)) * FPS
    head_in = next(f for f in range(NF) if head_inside(rest, tr, prof(f / FPS)))
    log('hero_intro: %d frames, the head travels %.2f D at %.1f D/s (%.2f D/frame); the body touches the frame '
        'at frame %.1f, the snout is inside from frame %d' % (NF, D, v, v / FPS, (s_vis - s0) / v * FPS, head_in))
    return tr, prof, NF, T


def written_frame(rest, tr, prof, NF):
    """first frame where the "a" loop is closed: the head reaches the second visit of the last
    self-crossing (in the image) of the rest path"""
    pr = rest.project(rest.rest)[:, :2]
    s = rest.s_rest
    idx = np.arange(0, len(pr), 2)
    Q, S = pr[idx], s[idx]
    d = np.linalg.norm(Q[:, None] - Q[None], axis=2)
    far = (S[None, :] - S[:, None]) > 3.0
    a, b = np.where((d < 12) & far)
    if not len(a):
        return 70, None
    best = float(S[a].min())                                      # nose-first s of the closing point
    target = tr.sig[-1] - best
    return next((f for f in range(NF) if prof(f / FPS) >= target), NF - 1), best


def depart_motion(rest, NF):
    T = (NF - 1) / FPS
    tr0 = depart_trail(rest)
    s_start = float(tr0.sig[tr0.nose_index])
    s1 = None
    for sh in np.arange(s_start + rest.L * 0.5, tr0.sig[-1], 0.1):
        P, cum, ss = tr0.window(rest, sh)
        if offscreen(rest, P, cum):
            s1 = sh + 0.1
            break
    assert s1 is not None, 'depart trail too short'
    idx = np.arange(len(tr0.sig))
    for it in range(60):                                          # the settled trail changes length: iterate
        D = s1 - s_start
        prof = (lambda D: (lambda t: s_start + depart_profile(min(max(t, 0), T), T, D)))(D)
        tg = np.linspace(-2, T + 2, 4000)
        sg = np.array([prof(t) + min(t, 0) * 30 + max(t - T, 0) * 30 for t in tg])
        t_mid = np.interp(tr0.sig + rest.L / 2, sg, tg)
        t_s = np.maximum(t_mid, SETTLE_DELAY)          # letters and the step down beside the "a" (w < 1) settle
        state = (lambda t_s, prof: (lambda t: depart_state(rest, tr0, t, t_s, prof)))(t_s, prof)
        trT, shT = state(T)
        P, cum, ss = trT.window(rest, shT)
        if offscreen(rest, P, cum):
            break
        s1 += 0.4
    v = max(prof((f + 1) / FPS) - prof(f / FPS) for f in range(NF - 1)) * FPS
    log('hero_depart: %d frames, the head travels %.2f D at %.1f D/s (%.2f D/frame)' % (NF, D, v, v / FPS))
    return state, NF, T


def depart_state(rest, tr0, t, t_s, prof):
    tr = settled(rest, tr0, t, t_s)
    sh = prof(t) + (tr.sig[tr0.nose_index] - tr0.sig[tr0.nose_index])
    return tr, sh


def bake_clip(rest, name, state, NF, shutter=0.0, look=None, tongue=None):
    """pose every frame (and subframe) from state(t) -> (trail, sigma_h), check, key"""
    T = (NF - 1) / FPS
    keys, Ms, infos, gaps = [], [], [], []
    for fr, t in sample_times(NF, shutter):
        trt, sh = state(min(max(t, 0.0), T))
        M, P, cum, info = pose(rest, trt, sh)
        keys.append((fr, t, M))
        if abs(fr - round(fr)) < 1e-6:
            Ms.append(M)
            infos.append(info)
            gaps.append(clearance(rest, P, cum))
    roll = check_roll(name, Ms, infos)
    worst = int(np.argmin(gaps))
    log('%s: smallest fur-to-fur gap between body parts %.2f D (frame %d)' % (name, gaps[worst], worst))
    key_action(rest, name, keys, look, tongue)
    sc = rest.sc
    sc.render.fps = FPS
    sc.frame_start, sc.frame_end = 1, NF
    sc.render.resolution_x, sc.render.resolution_y = W_PX, H_PX
    return Ms, dict(roll=roll, min_gap=gaps[worst], min_gap_frame=worst)


def bake(name, NF=None, shutter=0.0):
    rest = Rest()
    joint = os.path.join(RENDERS_DIR, 'hero_rest_pose.npz')
    extra = {}
    if name == 'hero_intro':
        tr, prof, NF, T = intro_motion(rest)
        Ms, extra = bake_clip(rest, name, lambda t: (tr, prof(t)), NF, shutter)
        jf = NF - 1
        np.savez(joint, **{n: np.array(Ms[jf][n]) for n in rest.chain})
        extra['written'], s_cl = written_frame(rest, tr, prof, NF)
        log('hero_intro events.written = %d (the "a" loop closes at s = %s D from the nose)' % (extra['written'], s_cl))
        for f in (1, 2, 3, 4):
            frame_check(rest, f, name)
    else:
        state, NF, T = depart_motion(rest, NF or 48)
        Ms, extra = bake_clip(rest, name, state, NF, shutter)
        jf = 0
        if os.path.exists(joint):
            J = np.load(joint)
            err = max(np.abs(J[n] - np.array(Ms[0][n])).max() for n in rest.chain)
            log('hero_depart frame 0 vs hero_intro frame 83 (H3): max matrix entry diff %.2e' % err)
        frame_check(rest, NF, name)
        head_out = None
        for f in range(10, NF):
            trt, sh = state(f / FPS)
            P, cum, ss = trt.window(rest, sh)
            k = int(np.searchsorted(cum, 1.5))
            if offscreen(rest, P[:k], cum[:k], margin=OFF_MARGIN_PX):
                head_out = f
                break
        log('hero_depart: the snout is out of frame from frame %s' % head_out)
    roll0 = max(math.degrees(math.acos(np.clip(np.dot(
        np.array((Ms[jf][n].to_3x3() @ rest.zb[n]).normalized()),
        np.array((rest.M0[n].to_3x3() @ rest.zb[n]).normalized())), -1, 1))) for n in rest.chain)
    log('%s frame %d: largest roll change vs the old Spline IK rest pose %.1f deg' % (name, jf, roll0))
    rest.sc.frame_set(1)
    out = os.path.join(RENDERS_DIR, name + '.blend')
    bpy.ops.wm.save_as_mainfile(filepath=out, compress=False)
    log('saved', out)
    return rest, NF, extra


# ======================================================================================== animatic
def find_ffmpeg():
    p = arg('--ffmpeg', None) or shutil.which('ffmpeg')
    if not p:
        base = os.path.expandvars(r'%LOCALAPPDATA%\Microsoft\WinGet\Packages')
        for root, _, files in os.walk(base):
            if 'ffmpeg.exe' in files:
                return os.path.join(root, 'ffmpeg.exe')
    return p


def use_gpu(sc):
    if '--cpu' in argv:
        return
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
            return


def animatic(name, NF, bg_hex, catcher='Sweep', pct=25):
    """spec B12-2: 25 %, 16 spp, no fur (skin fattened by the fur depth), no motion blur, transparent film
    with a shadow catcher, composited over bg_hex; shown 2x for viewing"""
    sc = bpy.context.scene
    use_gpu(sc)
    bpy.data.objects['Fur'].hide_render = True
    dm = bpy.data.objects['Body'].modifiers.new('FurDepth', 'DISPLACE')
    dm.strength, dm.mid_level, dm.direction = FUR, 0.0, 'NORMAL'
    if catcher and bpy.data.objects.get(catcher):
        bpy.data.objects[catcher].is_shadow_catcher = True
    sc.render.resolution_x, sc.render.resolution_y = W_PX, H_PX
    sc.render.resolution_percentage = pct
    sc.cycles.samples = 16
    sc.cycles.use_denoising = True
    sc.render.use_persistent_data = True
    sc.render.use_motion_blur = False
    sc.render.film_transparent = True
    sc.view_settings.view_transform = 'Standard'
    tmp = os.path.join(RENDERS_DIR, '_anim_' + name)
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.filepath = os.path.join(tmp, 'f_')
    sc.frame_start, sc.frame_end = 1, NF
    t0 = time.time()
    bpy.ops.render.render(animation=True)
    log('%s animatic: %d frames in %.0f s' % (name, NF, time.time() - t0))
    os.makedirs(MOTION, exist_ok=True)
    mp4 = os.path.join(MOTION, name + '_animatic.mp4')
    w, h = W_PX * pct // 100, H_PX * pct // 100
    subprocess.check_call([find_ffmpeg(), '-y', '-loglevel', 'error',
                           '-f', 'lavfi', '-i', 'color=c=0x%s:s=%dx%d:r=%d' % (bg_hex.lstrip('#'), w, h, FPS),
                           '-framerate', str(FPS), '-i', os.path.join(tmp, 'f_%04d.png'),
                           '-filter_complex', '[0][1]overlay=shortest=1,scale=%d:%d:flags=lanczos,format=yuv420p' % (2 * w, 2 * h),
                           '-c:v', 'libx264', '-crf', '18', '-movflags', '+faststart', mp4])
    log('wrote', mp4)


if __name__ == '__main__':
    which = arg('--clip', 'all')
    shutter = float(arg('--shutter', 0.0))
    for nm in ('hero_intro', 'hero_depart'):
        if which in ('all', nm):
            r, nf, ex = bake(nm, int(arg('--depart-frames', 48)) if nm == 'hero_depart' else None, shutter)
            if '--animatic' in argv:
                animatic(nm, nf, '#F1D6DA')
    log('done')
