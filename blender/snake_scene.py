"""
ae studio - plush snake built from scratch in Blender (5.1+), posed as "ae" like the client photo.

    blender -b --factory-startup --python blender/snake_scene.py                         # build, save .blend
    blender -b --factory-startup --python blender/snake_scene.py -- --render             # + render + montages
    blender -b --factory-startup --python blender/snake_scene.py -- --render --preview   # fast check

Options (after --):
    --blend <path>      where to save the scene (default C:/Users/vladk/ae-studio/renders/snake.blend,
                        otherwise ../renders/snake.blend next to the repository)
    --density <n>       fur strands per D^2 of skin (default 36000; --preview uses 5000)
    --samples <n>       Cycles samples (default 160; --preview 48)
    --render            render CamHero (1408x768) and write the approval montages to blender/renders/
    --no-hair           skin only
    --cpu               render on the CPU

What gets built (1 unit = D, the outer diameter of the body with its fur; Z up, floor under the snake):
    Body     skin mesh (~17k triangles), UVMap (u = arc length / L, v = angle from the belly line),
             colour attribute "skin_col", Armature modifier
    Rig      armature "SnakeRig": Head (rigid, chain root) + Spine_01..Spine_56 to the tail tip + Jaw (child of
             Head). Spline IK on the last bone follows the curve "SpinePath" whose length equals the chain, so a
             new curve of the same length poses the snake without stretching
    Eyes     glossy beads; Tongue (forked ribbon); both parented to the Head bone
    Fur      hair curves (Cycles only) grown on the rest skin and kept on the posed skin by the
             "Deform Curves on Surface" geometry-nodes modifier; per-strand colour "fur_col"
    Stage    camera "CamHero" matched to the photo, seamless powder-pink sweep, soft key light from the upper left

The pose: the centre line is traced on the photo (PATH_PX, head to tail) and lifted into 3D through CamHero:
the letters stand in a vertical plane (with depth offsets where the body passes in front of / behind itself),
the tail lies on the floor. Rings sit where they are on the photo (RINGS_PX projected onto the path).
"""
import bpy, bmesh, math, os, sys, time
import numpy as np
from mathutils import Vector, Matrix, Euler

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, '..'))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default):
    return argv[argv.index(name) + 1] if name in argv else default
PREVIEW = '--preview' in argv
DEF_BLEND = r'C:\Users\vladk\ae-studio\renders\snake.blend'
if not os.path.isdir(r'C:\Users\vladk\ae-studio'):
    DEF_BLEND = os.path.join(REPO, '..', 'renders', 'snake.blend')
BLEND = os.path.abspath(arg('--blend', DEF_BLEND))
DENSITY = float(arg('--density', 5000 if PREVIEW else 36000))
SAMPLES = int(arg('--samples', 48 if PREVIEW else 160))
PHOTO = os.path.join(REPO, 'assets', 'img', 'snake-ae.jpg')
RENDERS = os.path.join(HERE, 'renders')
rng = np.random.default_rng(11)

# ======================================================================================== photo measurements
W_PX, H_PX = 1408, 768
# centre line, snout (skin tip) -> tail, in photo pixels
PATH_PX = [
    (385, 257), (412, 252), (443, 239), (483, 222), (532, 203), (587, 205), (628, 209), (653, 221),
    (678, 253), (678, 300), (655, 343), (610, 368), (550, 378), (500, 386), (455, 407), (428, 450),
    (430, 505), (458, 560), (505, 592), (565, 592), (615, 568), (655, 525), (688, 470), (712, 410),
    (738, 335), (768, 270), (810, 218), (868, 192), (925, 212), (965, 239), (982, 282), (978, 335),
    (944, 378), (900, 400), (840, 408), (778, 412), (728, 428), (712, 470), (732, 515), (775, 553),
    (835, 580), (894, 577), (954, 568), (1005, 545), (1055, 512), (1102, 486), (1151, 475), (1199, 479),
    (1255, 499), (1314, 513), (1383, 520), (1449, 540)]
# depth (D, + = away from the camera) of each path point in the letter plane; None = lying on the floor
DEPTH = [0, 0, 0, 0, 0, 0, 0, 0.15,
         0.3, 0.4, 0.4, 0.35, 0.2, 0, 0, 0,
         0, 0, 0, -0.1, -0.35, -0.6, -0.68, -0.68,
         -0.62, -0.45, -0.2, 0, 0, 0, 0, 0,
         0.05, 0.2, 0.45, 0.65, 0.72, 0.72, 0.62, 0.48,
         0.35, 0.28, 0.25, 0.4, 0.7, 1.0, 1.3, 1.6,
         1.9, 2.2, 2.5, 2.8]
TAIL_EXTRA = 2.6          # D of tail beyond the right edge of the photo
# ring centres on the photo and the path index they belong to (first ring: black edge on the tail side only)
RINGS_PX = [((533, 192), 4), ((652, 192), 6), ((662, 293), 9), ((626, 378), 11), ((503, 385), 13),
            ((440, 470), 15), ((510, 592), 18), ((628, 560), 20), ((702, 456), 22), ((768, 262), 25),
            ((875, 190), 27), ((985, 272), 30), ((905, 400), 33), ((760, 522), 38), ((885, 580), 41),
            ((1002, 530), 43), ((1095, 472), 45), ((1188, 470), 47), ((1385, 518), 50)]
RING_CREAM, RING_BLACK = 0.14, 0.165       # half width of the cream band, width of each black edge (D)

# camera (CamHero)
LENS, SENSOR, PITCH, CAM_DIST, CAM_H = 85.0, 36.0, 7.0, 32.0, 6.4      # 1 D ~ 104 px at the letters

# shape
FUR = 0.13                  # fur depth on the body (D); outer body radius 0.5 -> skin radius 0.37
FUR_STRAND = 1.15           # strands a bit longer than the depth: leaning, clumped tips read ~0.13 D above the skin
HEAD_LEN = 1.30             # rigid head bone, from the snout tip
NB = 56                     # spine bones behind the head
N_AROUND = 32
# calibrated against the photo (mean linear colour of pink / cream / black pixels, photo vs render)
# light tones are fed more saturated: the hair model washes pale colours out toward grey
COL = dict(pink='#CB7582', pink_deep='#AC4D5A', muzzle='#D6808E', eye_ring='#A05663',
           cream='#EFCB95', black='#060202', tongue='#F0B5C3', skin_dark=0.72)


def hex2lin(h):
    c = np.array([int(h[i:i + 2], 16) / 255.0 for i in (1, 3, 5)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def sstep(a, b, x):
    t = np.clip((np.asarray(x, float) - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def nrm(v):
    return v / np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-9)


def log(*a):
    print('[%6.1fs]' % (time.time() - T0), *a, flush=True)


# ======================================================================================== camera + lifting
CAM_ROT = Euler((math.radians(90 - PITCH), 0, 0)).to_matrix()
CAM_LOC = np.array([0.0, -CAM_DIST, CAM_H])
F_PX = LENS / SENSOR * W_PX


def ray(px, py):
    d = np.array(CAM_ROT @ Vector(((px - W_PX / 2) / F_PX, -(py - H_PX / 2) / F_PX, -1.0)))
    return CAM_LOC, d / np.linalg.norm(d)


def project(p):
    v = np.array(CAM_ROT.transposed() @ Vector(np.asarray(p) - CAM_LOC))
    return np.array([W_PX / 2 + F_PX * v[0] / -v[2], H_PX / 2 - F_PX * v[1] / -v[2]])


def catmull(P, per=24):
    P = np.asarray(P, float)
    P = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1:i + 3]
        t0 = 0.0
        t1 = t0 + np.linalg.norm(p1 - p0) ** 0.5 + 1e-9
        t2 = t1 + np.linalg.norm(p2 - p1) ** 0.5 + 1e-9
        t3 = t2 + np.linalg.norm(p3 - p2) ** 0.5 + 1e-9
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
    seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    n = int(math.ceil(s[-1] / step)) + 1
    ss = np.linspace(0, s[-1], n)
    return np.stack([np.interp(ss, s, P[:, k]) for k in range(P.shape[1])], 1), s[-1]


def outer_radius(s, L):
    """outer half height of the body (fur tips) at arc length s from the snout tip"""
    return 0.5 * (1 - 0.82 * sstep(L - 7.5, L - 0.35, s) ** 1.15)


def lift_path(floor_z, L_guess):
    pts = []
    for i, ((px, py), dep) in enumerate(zip(PATH_PX, DEPTH)):
        o, d = ray(px, py)
        if dep is not None:
            t = (dep - o[1]) / d[1]
        else:
            s_here = (L_guess - TAIL_EXTRA) * i / (len(PATH_PX) - 1)
            zc = floor_z + outer_radius(s_here, L_guess) * 0.96
            t = (zc - o[2]) / d[2]
        pts.append(o + d * t)
    pts = np.array(pts)
    dirv = pts[-1] - pts[-2]; dirv[2] = 0; dirv /= np.linalg.norm(dirv)       # tail beyond the photo
    for k in (1, 2, 3):
        p = pts[-1] + dirv * TAIL_EXTRA * k / 3
        p[2] = floor_z + 0.5 * (0.36 - 0.09 * k)
        pts = np.vstack([pts, p])
    return pts


floor_z, L = 0.0, 22.0
for it in range(4):
    ctrl = lift_path(floor_z, L)
    path, L = resample(catmull(ctrl, 24), 0.01)
    floor_z = min(ctrl[i, 2] - 0.5 for i in (17, 18, 19))       # the bowl of the "a" rests on the floor
log('path length L = %.3f D, floor z = %.3f' % (L, floor_z))
S_PATH = np.linspace(0, L, len(path))
P2 = np.array([project(p) for p in path[::5]])
S2 = S_PATH[::5]
# arc length of every control point (to restrict ring lookups to the right stretch of body)
S_CTRL = np.array([S_PATH[np.argmin(np.linalg.norm(path - c, axis=1))] for c in ctrl])


def ring_s():
    out = []
    for (px, py), hint in RINGS_PX:
        lo, hi = S_CTRL[max(hint - 2, 0)], S_CTRL[min(hint + 2, len(S_CTRL) - 1)]
        sel = np.where((S2 >= lo) & (S2 <= hi))[0]
        d = np.linalg.norm(P2[sel] - np.array([px, py]), axis=1)
        out.append(S2[sel[np.argmin(d)]])
    return np.array(out)


RING_S = ring_s()
log('rings at s =', np.round(RING_S, 2))


# ======================================================================================== body shape (rest, along +X)
def head_profile(s):
    """outer half height, half width and centre offset (z) at arc length s (snout tip = 0)"""
    s = np.asarray(s, float)
    # Egg-shaped head measured on the photo: ~1.3 D tall from 0.5 to 1.15 D behind the nose, the front is the
    # rounded end of an ellipse (no flat face), the axis dips toward the nose (nose low, forehead sloping down
    # to it), then the head narrows into the neck by ~1.75 D.
    HEAD_H, HEAD_W, EGG_C, EGG_A = 0.59, 0.56, 0.95, 0.95
    q = np.clip((EGG_C - s) / EGG_A, 0, 1)
    egg = np.sqrt(1 - q * q)                                                # rounded front of the egg
    neck = sstep(1.15, 1.75, s)
    base = outer_radius(s, L)
    hh = HEAD_H * egg * (1 - neck) + base * neck
    ww = HEAD_W * egg * (1 - neck) + base * neck
    cz = (-0.03 - 0.20 * np.clip(1 - s / EGG_C, 0, 1) ** 1.5) * (1 - neck)
    te = np.clip((L - s) / 0.35, 0, 1)
    rt2 = np.sqrt(1 - (1 - te) ** 2)                                        # round tail tip
    return hh * rt2, ww * rt2, cz


def fur_scale(hh, ww):
    return np.clip(np.minimum(hh, ww) / 0.5, 0.25, 1)


def skin_point(s, th):
    hh, ww, cz = head_profile(s)
    f = FUR * fur_scale(hh, ww)
    h, w = np.maximum(hh - f, 0.0), np.maximum(ww - f, 0.0)
    return np.stack([np.asarray(s, float) * np.ones_like(th), w * np.cos(th), cz + h * np.sin(th)], -1)


EYE_S, EYE_Z, EYE_R = 0.81, -0.05, 0.10          # photo: eye on the head axis, 0.81 D behind the nose


def eye_pos(sign):
    hh, ww, cz = head_profile(EYE_S)
    q = (EYE_Z - cz) / (hh - FUR)
    return np.array([EYE_S, sign * ((ww - FUR) * math.sqrt(max(1 - q * q, 0.2)) + 0.11), EYE_Z])


EYES = [eye_pos(1), eye_pos(-1)]


def surface_color(s, th, P):
    """linear RGB of the fur at arc length s, angle th (0 = left side, pi/2 = top), rest point P"""
    n = len(s)
    col = np.tile(hex2lin(COL['pink']), (n, 1))
    deep = (0.35 * sstep(0.2, -0.7, np.sin(th)))[:, None]                 # deeper rose low on the sides
    col = col * (1 - deep) + hex2lin(COL['pink_deep']) * deep
    head = (0.75 * (1 - sstep(1.2, 1.6, s)))[:, None]                    # the head is a touch lighter
    col = col * (1 - head) + hex2lin(COL['muzzle']) * head
    muz = (1 - sstep(0.10, 0.42, s))[:, None]                             # pale muzzle
    col = col * (1 - muz) + hex2lin(COL['muzzle']) * muz
    de = np.min([np.linalg.norm(P - e, axis=1) for e in EYES], axis=0)
    ring = (0.6 * (1 - sstep(EYE_R * 1.05, EYE_R * 1.9, de)))[:, None]   # darker ring round the eye
    col = col * (1 - ring) + hex2lin(COL['eye_ring']) * ring
    d = s[:, None] - RING_S[None, :]
    k = np.argmin(np.abs(d), axis=1)
    dd = d[np.arange(n), k]
    ad = np.abs(dd)
    col[ad < RING_CREAM] = hex2lin(COL['cream'])
    col[(ad >= RING_CREAM) & (ad < RING_CREAM + RING_BLACK) & ~((k == 0) & (dd < 0))] = hex2lin(COL['black'])
    return col


# ======================================================================================== scene
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'

# ---------------------------------------------------------------------------------------- skin mesh
S_RINGS = [0.0]
while S_RINGS[-1] < L - 1e-6:
    s = S_RINGS[-1]
    S_RINGS.append(min(s + (0.045 if s < 1.8 else (0.13 if s < L - 1.0 else 0.06)), L))
S_RINGS = np.array(S_RINGS)
TH = -math.pi / 2 + np.arange(N_AROUND) * 2 * math.pi / N_AROUND        # starts at the belly line
bm = bmesh.new()
uvl = bm.loops.layers.uv.new('UVMap')
tip = bm.verts.new(tuple(skin_point(np.array([0.0]), np.array([0.0]))[0]))
end = bm.verts.new(tuple(skin_point(np.array([L]), np.array([0.0]))[0]))
ring_s_arr = S_RINGS[1:-1]
rings = [[bm.verts.new(tuple(p)) for p in skin_point(np.full(N_AROUND, s), TH)] for s in ring_s_arr]


def put_uv(face, uvs):
    for loop, uv in zip(face.loops, uvs):
        loop[uvl].uv = uv


for j in range(N_AROUND):
    j1 = (j + 1) % N_AROUND
    v0, v1 = j / N_AROUND, (j + 1) / N_AROUND
    put_uv(bm.faces.new((tip, rings[0][j1], rings[0][j])),
           [(0, (v0 + v1) / 2), (ring_s_arr[0] / L, v1), (ring_s_arr[0] / L, v0)])
    for i in range(len(rings) - 1):
        put_uv(bm.faces.new((rings[i][j], rings[i][j1], rings[i + 1][j1], rings[i + 1][j])),
               [(ring_s_arr[i] / L, v0), (ring_s_arr[i] / L, v1), (ring_s_arr[i + 1] / L, v1), (ring_s_arr[i + 1] / L, v0)])
    put_uv(bm.faces.new((rings[-1][j], rings[-1][j1], end)),
           [(ring_s_arr[-1] / L, v0), (ring_s_arr[-1] / L, v1), (1, (v0 + v1) / 2)])
bm.normal_update()
bm.faces.ensure_lookup_table()
f0 = bm.faces[len(bm.faces) // 2]
c0 = f0.calc_center_median()
if f0.normal.dot(Vector((0, c0.y, c0.z - float(head_profile(c0.x)[2])))) < 0:
    bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
body_me = bpy.data.meshes.new('Body')
bm.to_mesh(body_me)
bm.free()
for p in body_me.polygons:
    p.use_smooth = True
body = bpy.data.objects.new('Body', body_me)
scene.collection.objects.link(body)
log('skin: %d verts, %d triangles' % (len(body_me.vertices), sum(len(p.vertices) - 2 for p in body_me.polygons)))

co = np.empty(len(body_me.vertices) * 3); body_me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
vs = co[:, 0]
hh_v, ww_v, cz_v = head_profile(vs)
vth = np.arctan2((co[:, 2] - cz_v) / np.maximum(hh_v, 1e-3), co[:, 1] / np.maximum(ww_v, 1e-3))
vcol = surface_color(vs, vth, co) * COL['skin_dark']
ca = body_me.color_attributes.new('skin_col', 'FLOAT_COLOR', 'POINT')
ca.data.foreach_set('color', np.concatenate([vcol, np.ones((len(vcol), 1))], 1).astype(np.float32).ravel())

# ---------------------------------------------------------------------------------------- armature
arm_d = bpy.data.armatures.new('SnakeRig')
arm = bpy.data.objects.new('SnakeRig', arm_d)
scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_d.edit_bones
hb_ = eb.new('Head'); hb_.head = (0, 0, 0); hb_.tail = (HEAD_LEN, 0, 0); hb_.roll = 0
BL = (L - HEAD_LEN) / NB
prev, bone_names = hb_, ['Head']
for i in range(NB):
    b = eb.new('Spine_%02d' % (i + 1))
    b.head = (HEAD_LEN + i * BL, 0, 0); b.tail = (HEAD_LEN + (i + 1) * BL, 0, 0); b.roll = 0
    b.parent = prev; b.use_connect = True
    prev = b
    bone_names.append(b.name)
jb = eb.new('Jaw'); jb.head = (0.95, 0, -0.18); jb.tail = (0.12, 0, -0.30); jb.parent = hb_
# tongue: short bone at the mouth; scaling it pulls the tongue in / pushes it out
TONGUE_ANG = math.radians(14)
TONGUE_BASE = (0.10, 0.0, float(head_profile(0.08)[2]) - 0.16)
tb = eb.new('Tongue'); tb.head = TONGUE_BASE
tb.tail = (TONGUE_BASE[0] - 0.05 * math.cos(TONGUE_ANG), 0.0, TONGUE_BASE[2] - 0.05 * math.sin(TONGUE_ANG))
tb.parent = hb_
bpy.ops.object.mode_set(mode='OBJECT')
log('rig: Head + %d spine bones (%.3f D each) + Jaw' % (NB, BL))

centres = np.array([HEAD_LEN - 0.12] + [HEAD_LEN + (i + 0.5) * BL for i in range(NB)])
groups = [body.vertex_groups.new(name=n) for n in bone_names]
body.vertex_groups.new(name='Jaw')
idx = np.clip(np.searchsorted(centres, vs) - 1, 0, len(centres) - 2)
t = np.clip((vs - centres[idx]) / (centres[idx + 1] - centres[idx]), 0, 1)
t = t * t * (3 - 2 * t)
for vi in range(len(vs)):
    i0, w1 = int(idx[vi]), float(t[vi])
    if w1 < 1:
        groups[i0].add([vi], 1 - w1, 'REPLACE')
    if w1 > 0:
        groups[i0 + 1].add([vi], w1, 'REPLACE')
amod = body.modifiers.new('Armature', 'ARMATURE')
amod.object = arm
body.add_rest_position_attribute = True          # needed by "Deform Curves on Surface" (fur follows the skin)

# ---------------------------------------------------------------------------------------- spine curve + Spline IK
cu = bpy.data.curves.new('SpinePath', 'CURVE')
cu.dimensions = '3D'
pp = path[::4]
if np.linalg.norm(pp[-1] - path[-1]) > 1e-6:
    pp = np.vstack([pp, path[-1]])
spl = cu.splines.new('POLY')
spl.points.add(len(pp) - 1)
for p, q in zip(spl.points, pp):
    p.co = (q[0], q[1], q[2], 1.0)
curve_ob = bpy.data.objects.new('SpinePath', cu)
scene.collection.objects.link(curve_ob)
log('SpinePath: %d points, length %.3f (chain %.3f)' % (len(pp), np.linalg.norm(np.diff(pp, axis=0), axis=1).sum(), L))
ik = arm.pose.bones[bone_names[-1]].constraints.new('SPLINE_IK')
ik.target = curve_ob
ik.chain_count = len(bone_names)
ik.use_chain_offset = False
ik.use_even_divisions = False
ik.use_curve_radius = False
ik.y_scale_mode = 'NONE'
ik.xz_scale_mode = 'NONE'
bpy.context.view_layer.update()
hp = arm.matrix_world @ arm.pose.bones['Head'].head
log('head bone root', tuple(round(v, 3) for v in hp), 'path start', tuple(np.round(path[0], 3)))
if (Vector(path[0]) - hp).length > 0.2:          # chain mapped from the other end: reverse the curve
    for p, q in zip(spl.points, pp[::-1]):
        p.co = (q[0], q[1], q[2], 1.0)
    bpy.context.view_layer.update()
    log('curve reversed; head bone root', tuple(arm.matrix_world @ arm.pose.bones['Head'].head))


def bone_parent(ob, bone):
    """parent to a bone, keeping the object where it is in the rest pose"""
    ob.parent = arm
    ob.parent_type = 'BONE'
    ob.parent_bone = bone
    bn = arm.data.bones[bone]
    rest = arm.matrix_world @ bn.matrix_local @ Matrix.Translation((0, bn.length, 0))
    ob.matrix_parent_inverse = rest.inverted()


# ---------------------------------------------------------------------------------------- materials
def mat_principled(name, rgb, rough, spec=0.5, coat=0.0):
    m = bpy.data.materials.new(name)
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Specular IOR Level'].default_value = spec
    if coat:
        b.inputs['Coat Weight'].default_value = coat
    return m


skin_m = bpy.data.materials.new('Skin')
b = skin_m.node_tree.nodes['Principled BSDF']
at = skin_m.node_tree.nodes.new('ShaderNodeAttribute'); at.attribute_name = 'skin_col'
skin_m.node_tree.links.new(at.outputs['Color'], b.inputs['Base Color'])
b.inputs['Roughness'].default_value = 0.9
body_me.materials.append(skin_m)

# ---------------------------------------------------------------------------------------- eyes + tongue
eye_m = mat_principled('EyeBead', (0.002, 0.0015, 0.0015), 0.05, spec=0.35)
for name, e in (('EyeL', EYES[0]), ('EyeR', EYES[1])):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=14, radius=EYE_R)
    bm.to_mesh(me); bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(eye_m)
    ob = bpy.data.objects.new(name, me)
    ob.location = e
    scene.collection.objects.link(ob)
    bone_parent(ob, 'Head')


def tongue_mesh():
    """flat forked ribbon in the rest frame of the head: leaves the mouth forward (-X) and down"""
    bx, bz = TONGUE_BASE[0], TONGUE_BASE[2]
    length, width, ang, n, fork = 0.95, 0.11, TONGUE_ANG, 14, 0.72
    verts, faces, rows = [], [], []
    for i in range(n + 1):
        t = i / n
        a = ang + 0.12 * t * t
        x, z = bx - math.cos(a) * length * t, bz - math.sin(a) * length * t
        nx, nz = -math.sin(a), math.cos(a)          # the flat side faces the camera (as on the photo)
        rows.append(len(verts))
        if t <= fork:
            w = width * (1 - 0.25 * t)
            offs = (-w / 2, w / 2)
        else:
            f = (t - fork) / (1 - fork)
            sp, w = 0.09 * f, width * 0.45 * (1 - 0.8 * f)
            offs = (-sp - w / 2, -sp + w / 2, sp - w / 2, sp + w / 2)
        verts += [(x + nx * o, 0.0, z + nz * o) for o in offs]
    for i in range(n):
        a0, b0 = rows[i], rows[i + 1]
        na, nb = rows[i + 1] - rows[i], (len(verts) if i + 2 > n else rows[i + 2]) - rows[i + 1]
        if na == 2 and nb == 2:
            faces.append((a0, a0 + 1, b0 + 1, b0))
        elif na == 2:
            faces.append((a0, a0 + 1, b0 + 3, b0))
        else:
            faces += [(a0, a0 + 1, b0 + 1, b0), (a0 + 2, a0 + 3, b0 + 3, b0 + 2)]
    me = bpy.data.meshes.new('Tongue')
    me.from_pydata(verts, [], faces)
    me.update()
    return me


tme = tongue_mesh()
tme.materials.append(mat_principled('Tongue', hex2lin(COL['tongue']), 0.35, spec=0.6))
tongue = bpy.data.objects.new('Tongue', tme)
scene.collection.objects.link(tongue)
sm_ = tongue.modifiers.new('Thick', 'SOLIDIFY'); sm_.thickness = 0.018; sm_.offset = 0
tongue.modifiers.new('Smooth', 'SUBSURF').levels = 1
for p in tme.polygons:
    p.use_smooth = True
bone_parent(tongue, 'Tongue')


# ---------------------------------------------------------------------------------------- fur (Cycles only)
def hair_material():
    m = bpy.data.materials.new('Fur')
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    hb = nt.nodes.new('ShaderNodeBsdfHairPrincipled')
    hb.parametrization = 'COLOR'
    at = nt.nodes.new('ShaderNodeAttribute'); at.attribute_name = 'fur_col'
    info = nt.nodes.new('ShaderNodeHairInfo')
    rmp = nt.nodes.new('ShaderNodeMapRange')             # darker roots (scaled by the strand's root_shade)
    rmp.inputs['To Max'].default_value = 1.08
    rsa = nt.nodes.new('ShaderNodeAttribute'); rsa.attribute_name = 'root_shade'
    rsm = nt.nodes.new('ShaderNodeMapRange')
    rsm.inputs['To Min'].default_value = 1.0; rsm.inputs['To Max'].default_value = 0.5
    nt.links.new(rsa.outputs['Fac'], rsm.inputs['Value'])
    nt.links.new(rsm.outputs[0], rmp.inputs['To Min'])
    nt.links.new(info.outputs['Intercept'], rmp.inputs['Value'])
    cmb = nt.nodes.new('ShaderNodeCombineColor')
    for i in range(3):
        nt.links.new(rmp.outputs[0], cmb.inputs[i])
    mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'
    mx.inputs['Factor'].default_value = 1
    nt.links.new(at.outputs['Color'], mx.inputs['A']); nt.links.new(cmb.outputs[0], mx.inputs['B'])
    pw = nt.nodes.new('ShaderNodeMath'); pw.operation = 'POWER'; pw.inputs[1].default_value = 1.4
    nt.links.new(info.outputs['Intercept'], pw.inputs[0])
    ml = nt.nodes.new('ShaderNodeMath'); ml.operation = 'MULTIPLY'; ml.inputs[1].default_value = 0.9
    nt.links.new(pw.outputs[0], ml.inputs[0])
    lighter = nt.nodes.new('ShaderNodeMix'); lighter.data_type = 'RGBA'; lighter.blend_type = 'SCREEN'
    lighter.inputs['Factor'].default_value = 0.85                # pale tips: a lighter tint of the strand's own colour
    nt.links.new(at.outputs['Color'], lighter.inputs['A']); nt.links.new(at.outputs['Color'], lighter.inputs['B'])
    tip = nt.nodes.new('ShaderNodeMix'); tip.data_type = 'RGBA'
    nt.links.new(ml.outputs[0], tip.inputs['Factor']); nt.links.new(mx.outputs['Result'], tip.inputs['A'])
    nt.links.new(lighter.outputs['Result'], tip.inputs['B'])
    hs = nt.nodes.new('ShaderNodeHueSaturation')
    hs.inputs['Saturation'].default_value = 1.05
    nt.links.new(tip.outputs['Result'], hs.inputs['Color'])
    nt.links.new(hs.outputs['Color'], hb.inputs['Color'])
    hb.inputs['Roughness'].default_value = 0.55
    hb.inputs['Radial Roughness'].default_value = 0.9
    hb.inputs['Coat'].default_value = 0.08
    nt.links.new(hb.outputs[0], out.inputs['Surface'])
    return m


def grow_fur():
    me = body_me
    me.calc_loop_triangles()
    nl = len(me.loops)
    lv = np.empty(nl, int); me.loops.foreach_get('vertex_index', lv)
    uv = np.empty(nl * 2); me.uv_layers['UVMap'].data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
    cn = np.empty(nl * 3); me.corner_normals.foreach_get('vector', cn); cn = cn.reshape(-1, 3)
    tl = np.empty(len(me.loop_triangles) * 3, int); me.loop_triangles.foreach_get('loops', tl); tl = tl.reshape(-1, 3)
    A, B, C = co[lv[tl[:, 0]]], co[lv[tl[:, 1]]], co[lv[tl[:, 2]]]
    area = 0.5 * np.linalg.norm(np.cross(B - A, C - A), axis=1)
    n = int(area.sum() * DENSITY)
    tri = rng.choice(len(tl), n, p=area / area.sum())
    r1, r2 = rng.random(n), rng.random(n)
    sq = np.sqrt(r1)
    w = np.stack([1 - sq, sq * (1 - r2), sq * r2], 1)
    Lp = tl[tri]
    P = (co[lv[Lp]] * w[..., None]).sum(1)
    N = nrm((cn[Lp] * w[..., None]).sum(1))
    UV = (uv[Lp] * w[..., None]).sum(1)
    s = P[:, 0]
    hh, ww, cz = head_profile(s)
    th = np.arctan2((P[:, 2] - cz) / np.maximum(hh, 1e-3), P[:, 1] / np.maximum(ww, 1e-3))
    log('fur: skin area %.2f D^2 -> %d strands' % (area.sum(), n))
    # direction: toward the tail, parting along the side mid-lines; on the head radiating from the snout
    ex = np.tile([1.0, 0, 0], (n, 1))
    eth = nrm(np.stack([np.zeros(n), -np.sin(th), np.cos(th)], 1))
    part = (0.75 * np.clip(np.cos(2 * th), 0, 1) * np.sign(np.sin(2 * th)) * sstep(1.4, 2.2, s))[:, None]
    d = ex + eth * part
    snout = np.array([-0.05, 0, float(head_profile(0.0)[2])])
    hd = (1 - sstep(1.0, 1.6, s))[:, None]
    d = d * (1 - hd) + (nrm(P - snout) * 0.6 + ex * 1.0) * hd
    for e in EYES:
        de = np.linalg.norm(P - e, axis=1)
        d += nrm(P - e) * (1.4 * (1 - sstep(EYE_R * 1.1, EYE_R * 3.0, de)))[:, None]
    d = nrm(d - (d * N).sum(1, keepdims=True) * N)
    fl = fur_scale(hh, ww) * FUR * FUR_STRAND * (0.82 + 0.18 * sstep(0.05, 0.45, s))   # shorter on the muzzle
    fl *= 1 + 0.25 * (1 - sstep(1.2, 1.6, s))                    # fluffier pile on the head
    for e in EYES:
        fl *= 0.06 + 0.94 * sstep(EYE_R * 1.2, EYE_R * 3.0, np.linalg.norm(P - e, axis=1))
    col = surface_color(s, th, P) * rng.uniform(0.88, 1.1, (n, 1))
    hw = 1 - sstep(1.2, 1.6, s)                                   # the head pile stands up more (fluffier)
    shade = sstep(0.15, 0.55, s) * (1 - 0.9 * hw)                 # little root darkening on the head, none on the muzzle
    lean = (0.3 - 0.15 * hw, 1.1 - 0.4 * hw)
    return P, N, d, fl, col, UV, shade, lean


def make_hair(name, roots, normals, dirs, lengths, colors, uvs, shade, lean, r0=0.0034, r1=0.0008, k=5,
              clump=0.55):
    n = len(roots)
    t = np.linspace(0, 1, k)
    a0 = np.clip(lean[0] + rng.normal(0, 0.15, n), 0.0, 1.0)
    a1 = np.clip(lean[1] + rng.normal(0, 0.28, n), a0 + 0.05, 1.4)
    d = nrm(dirs + nrm(np.cross(normals, dirs)) * rng.normal(0, 0.45, (n, 1)))
    hfac = (np.sin(a1) - np.sin(a0)) / (a1 - a0)                  # mean cos of the bend -> tip height = length
    stray = np.where(rng.random(n) < 0.012, rng.uniform(1.3, 1.6, n), 1.0)      # a few long stray fibres
    seg = (lengths * rng.uniform(0.85, 1.12, n) * stray / hfac)[:, None] / (k - 1)
    pts = np.zeros((n, k, 3))
    pts[:, 0] = roots - normals * 0.003
    for i in range(1, k):
        a = (a0 + (a1 - a0) * (i - 0.5) / (k - 1))[:, None]
        pts[:, i] = pts[:, i - 1] + seg * (normals * np.cos(a) + d * np.sin(a))
    if clump > 0:                                                  # tufts: tips gather toward a guide strand
        from mathutils.kdtree import KDTree
        g = rng.choice(n, max(n // 45, 1), replace=False)
        kd = KDTree(len(g))
        for j, gi in enumerate(g):
            kd.insert(roots[gi], j)
        kd.balance()
        near = np.fromiter((kd.find(p)[1] for p in roots), int, n)
        guide = pts[g[near]]
        pts = pts + (guide - pts) * ((t ** 1.6)[None, :, None] * clump * rng.uniform(0.4, 1.0, (n, 1, 1)))
    cv = bpy.data.hair_curves.new(name)
    cv.add_curves([k] * n)
    cv.position_data.foreach_set('vector', pts.astype(np.float32).ravel())
    rad = cv.attributes.get('radius') or cv.attributes.new('radius', 'FLOAT', 'POINT')
    rad.data.foreach_set('value', np.tile(r0 + (r1 - r0) * t ** 0.8, n).astype(np.float32))
    ca = cv.attributes.new('fur_col', 'FLOAT_COLOR', 'CURVE')
    ca.data.foreach_set('color', np.concatenate([colors, np.ones((n, 1))], 1).astype(np.float32).ravel())
    rs = cv.attributes.new('root_shade', 'FLOAT', 'CURVE')
    rs.data.foreach_set('value', shade.astype(np.float32))
    su = cv.attributes.get('surface_uv_coordinate') or cv.attributes.new('surface_uv_coordinate', 'FLOAT2', 'CURVE')
    su.data.foreach_set('vector', uvs.astype(np.float32).ravel())
    ob = bpy.data.objects.new(name, cv)
    scene.collection.objects.link(ob)
    cv.surface = body
    cv.surface_uv_map = 'UVMap'
    cv.materials.append(hair_material())
    ng = bpy.data.node_groups.new('FurFollowSkin', 'GeometryNodeTree')       # keep the fur on the posed skin
    ng.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    ng.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    gi = ng.nodes.new('NodeGroupInput'); go = ng.nodes.new('NodeGroupOutput')
    dn = ng.nodes.new('GeometryNodeDeformCurvesOnSurface')
    ng.links.new(gi.outputs[0], dn.inputs[0]); ng.links.new(dn.outputs[0], go.inputs[0])
    ob.modifiers.new('FollowSkin', 'NODES').node_group = ng
    return ob


if '--no-hair' not in argv:
    fur = make_hair('Fur', *grow_fur())
    log('fur object done')

# ---------------------------------------------------------------------------------------- stage
cam_d = bpy.data.cameras.new('CamHero')
cam_d.lens = LENS; cam_d.sensor_width = SENSOR; cam_d.sensor_fit = 'HORIZONTAL'
cam = bpy.data.objects.new('CamHero', cam_d)
cam.location = CAM_LOC; cam.rotation_euler = (math.radians(90 - PITCH), 0, 0)
scene.collection.objects.link(cam)
scene.camera = cam
scene.render.resolution_x, scene.render.resolution_y = W_PX, H_PX

BG = np.array([0.80, 0.70, 0.72])
sweep_m = mat_principled('Backdrop', np.where(BG <= 0.04045, BG / 12.92, ((BG + 0.055) / 1.055) ** 2.4), 0.95, spec=0.2)
prof = [(-30.0, floor_z)] + [(7 + 6 * math.sin(a), floor_z + 6 * (1 - math.cos(a)))
                             for a in np.linspace(0, math.pi / 2, 40)] + [(20.0, floor_z + 30)]
verts = [v for (y, z) in prof for v in ((-60, y, z), (60, y, z))]
faces = [(2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2) for i in range(len(prof) - 1)]
sme = bpy.data.meshes.new('Sweep'); sme.from_pydata(verts, [], faces); sme.update()
for p in sme.polygons:
    p.use_smooth = True
sme.materials.append(sweep_m)
scene.collection.objects.link(bpy.data.objects.new('Sweep', sme))

world = bpy.data.worlds.new('World'); scene.world = world
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.78, 0.66, 0.68, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = float(arg('--ambient', 0.85))


def area_light(name, loc, target, energy, size, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, 'AREA'); ld.energy = energy; ld.size = size; ld.color = color
    ob = bpy.data.objects.new(name, ld); scene.collection.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()


mid = Vector((float(np.mean(path[:, 0])), 0.0, floor_z + 2.5))
area_light('Key', (-12, -13, floor_z + 8), mid, float(arg('--key', 2600)), 10, (1.0, 0.97, 0.95))
area_light('Beauty', (-6, -28, floor_z + 10), mid, float(arg('--beauty', 7500)), 14, (1.0, 0.97, 0.96))    # softbox by the camera
area_light('Fill', (10, -12, floor_z + 5), mid, float(arg('--fill', 700)), 10, (1.0, 0.95, 0.96))
area_light('Back', (2, 12, floor_z + 9), mid, 1500, 8, (1.0, 0.96, 0.96))

scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.cycles.denoiser = 'OPENIMAGEDENOISE'
scene.cycles.max_bounces = 6
scene.cycles.transparent_max_bounces = 16
scene.cycles_curves.shape = 'THICK'
scene.view_settings.view_transform = 'Standard'
scene.view_settings.look = 'None'
scene.view_settings.exposure = float(arg('--exposure', -0.2))
os.makedirs(os.path.dirname(BLEND), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=BLEND, compress=False)
log('saved', BLEND)

# ======================================================================================== render + montages
if '--render' in argv:
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
                scene.cycles.device = 'GPU'
                log('render device', tdev)
                break
    os.makedirs(RENDERS, exist_ok=True)
    tmp = os.path.join(os.path.dirname(BLEND), '_hero.png')
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    log('rendered', tmp)

    def load_rgb(path):
        im = bpy.data.images.load(path)
        a = np.empty(im.size[0] * im.size[1] * 4, np.float32)
        im.pixels.foreach_get(a)
        a = a.reshape(im.size[1], im.size[0], 4)[::-1, :, :3].copy()
        bpy.data.images.remove(im)
        return a

    def save(arr, path, q=90):
        h, w = arr.shape[:2]
        im = bpy.data.images.new(os.path.basename(path), w, h, alpha=False, float_buffer=False)
        a = np.ones((h, w, 4), np.float32); a[..., :3] = np.clip(arr[::-1], 0, 1)
        im.pixels.foreach_set(a.ravel())
        im.filepath_raw = path
        im.file_format = 'WEBP' if path.endswith('.webp') else 'PNG'
        im.save(filepath=path, quality=q)
        log('wrote', path)

    def resize(arr, h, w):
        H, W = arr.shape[:2]
        y = np.clip((np.arange(h) + 0.5) * H / h - 0.5, 0, H - 1.001)
        x = np.clip((np.arange(w) + 0.5) * W / w - 0.5, 0, W - 1.001)
        y0, x0 = y.astype(int), x.astype(int)
        fy, fx = (y - y0)[:, None, None], (x - x0)[None, :, None]
        return (arr[y0][:, x0] * (1 - fx) * (1 - fy) + arr[y0][:, x0 + 1] * fx * (1 - fy) +
                arr[y0 + 1][:, x0] * (1 - fx) * fy + arr[y0 + 1][:, x0 + 1] * fx * fy)

    tag = '_preview' if PREVIEW else ''
    photo, rend = load_rgb(PHOTO), load_rgb(tmp)
    save(np.concatenate([photo, np.ones((H_PX, 12, 3)), rend], 1), os.path.join(RENDERS, 'compare_photo_render%s.webp' % tag))
    save(photo * 0.5 + rend * 0.5, os.path.join(RENDERS, 'overlay_50%s.webp' % tag))
    for name, (x0, y0, x1, y1) in (('head', (300, 110, 640, 340)), ('band', (560, 120, 820, 320)),
                                    ('tail', (950, 400, 1408, 620))):
        hgt = 520
        wid = int(hgt * (x1 - x0) / (y1 - y0))
        save(np.concatenate([resize(photo[y0:y1, x0:x1], hgt, wid), np.ones((hgt, 10, 3)),
                             resize(rend[y0:y1, x0:x1], hgt, wid)], 1),
             os.path.join(RENDERS, 'closeup_%s%s.webp' % (name, tag)))
    save(rend, os.path.join(RENDERS, 'render_hero%s.webp' % tag))
log('done')
