"""head_v3.py - plush snake head v3 (side view after the client's photo) rendered as the engine's head-atlas cells.

    blender -b --factory-startup --python dev/blender/head_v3.py -- out=DIR [buckets=all|0,8,16] [spp=48] [ss=2]
            [params=dev/blender/head_v3_params.json] [threads=4] [seed=7]

Then:  python3 dev/blender/head_v3_check.py fit DIR/head_00.png      (outline vs spec; --update calibrates the reach)
       python3 dev/blender/head_v3_pack.py DIR                       (head.webp + manifest "head" section)

Model (units: body radius R; Blender X = x forward, Y = u (+ jaw side), Z = toward the top-down camera):
  - skin: x-slices of superellipses; in-plane edges = the photo outline (head_v3_spec.py) eroded by the calibrated fur
    reach; depth (lateral half-width) ~1.1 R on the head, 1.0 R at the neck, rounding into a soft dome at the snout;
  - one glossy black bead eye on the camera side at (0.36, 0.42), centre projected exactly there;
  - outline: the traced brow / jaw + the brow-side neck shoulder (head_v3_spec.BROW_SHOULDER, covers the front end
    of the engine's first body stamp) + the snout-tip fillet (tip_round);
  - fur: hair curves groomed in numpy (plush_fur.py): combed back from a nose whorl at the snout tip, parted around
    the eye (short, soft mauve-shadow ring), longer + fluffier than the body, lighter muzzle; behind x ~ -0.5 it turns into
    body fur (body palette, length, diffuse mix) so the baked neck fade cross-fades into the body stamps (no collar);
  - rig = the body atlas rig: ortho top-down camera, world #FFE8EE 0.45, sun 4.2 (28 deg) along the engine light
    light_screen mapped to Blender (x, -y, z), turned by +th about Z for bucket b (heading th = b/32 * 2PI).
Output: DIR/head_XX.png (cell size x ss, straight alpha, linear sprite rig colours - graded in head_v3_pack.py),
DIR/head_geom.json.
"""
import json
import math
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import head_v3_spec as S   # noqa: E402
import plush_fur as F      # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ARGS = dict(a.split('=', 1) for a in argv if '=' in a)
OUT = ARGS.get('out', 'head_v3_cells')
SS = int(ARGS.get('ss', 2))
SPP = int(ARGS.get('spp', 48))
SEED = int(ARGS.get('seed', 7))
THREADS = int(ARGS.get('threads', 4))
_b = ARGS.get('buckets', 'all')
BUCKETS = list(range(S.BUCKETS)) if _b == 'all' else [int(v) for v in _b.split(',') if v != '']
PARAMS = S.load_params(ARGS.get('params'))
os.makedirs(OUT, exist_ok=True)

# fur / shape parameters (head_v3_params.json may override any of them under "fur" / "shape")
FUR = dict(
    dens=4400, len=(0.44, 0.7), lean=0.6, comb=1.1, back_comb=0.6, bend=0.9, clump=0.6, cs=1.15, gf=0.012,
    rough=0.07, frizz=0.008, flow=0.35, flow_k=3.0, tipb=0.45, jit=0.18, K=7, rr=0.0056, rt=0.0012,
    muzzle_len=0.8, nose_len=0.62, eye_comb=0.7, eye_comb_r=0.4, eye_ring=1.25, eye_ring_len=0.2,
    eyering=0.32, star=0.08, star_r=3.0, muz_a=1.2, muz_b=2.1, muz_w=0.55, neck_a=-1.25, neck_b=-0.45,
    sh_x0=0.0, sh_x1=0.6, sh_r0=0.3, sh_r1=0.8, sh_comb=0.8,
    dmix_head=0.6, dmix_body=0.7, hr=0.42, coat=0.0)
FUR.update(PARAMS.get('fur', {}))
SHAPE = dict(depth_head=1.12, depth_neck=1.0, depth_k=1.08, snout_taper=0.25, sx_p=2.2, eye_r=0.31, eye_out=0.5)
SHAPE.update(PARAMS.get('shape', {}))
F.PAL.update({
    'head': dict(root='#951641', mid='#CF5078', tip='#F2A0B6', skin='#861A3E'),
    'muzzle': dict(root='#AE4670', mid='#E494AC', tip='#FAD2DD', skin='#A04468'),
    # eye ring: a soft mauve shadow round the bead (a saturated crimson ring read as a red rim at site scale)
    'eyering': dict(root='#5C2034', mid='#94485F', tip='#C47E92', skin='#6A2440'),
})
for k_, v_ in PARAMS.get('pal', {}).items():
    F.PAL.setdefault(k_, {}).update(v_)


def smin(a, b, k):
    h = np.clip(k - np.abs(a - b), 0, None)
    return np.minimum(a, b) - h * h / (4 * k)


# ---------------------------------------------------------------- skin surface
def skin_grid(nphi=96):
    pr = S.skin_profile(PARAMS)
    xs, ub, uj = pr['x'], pr['u_brow'], pr['u_jaw']
    a = np.maximum((uj - ub) / 2, 0); uc = (uj + ub) / 2
    cmax = SHAPE['depth_neck'] + (SHAPE['depth_head'] - SHAPE['depth_neck']) * F.smooth(-1.6, -0.6, xs)
    cmax = cmax * (1 - SHAPE['snout_taper'] * F.smooth(0.8, pr['x_tip'], xs))
    c = np.maximum(smin(cmax, SHAPE['depth_k'] * a, 0.25), 0)
    c[-1] = 0.0; a[-1] = 0.0
    phi = np.arange(nphi) / nphi * 2 * np.pi
    p = SHAPE['sx_p']
    cs, sn = np.cos(phi), np.sin(phi)
    ey = np.sign(cs) * np.abs(cs) ** (2 / p); ez = np.sign(sn) * np.abs(sn) ** (2 / p)
    V = np.zeros((len(xs), nphi, 3))
    V[:, :, 0] = xs[:, None]
    V[:, :, 1] = uc[:, None] + a[:, None] * ey[None]
    V[:, :, 2] = c[:, None] * ez[None]
    dX = np.gradient(V, axis=0)
    dP = np.roll(V, -1, axis=1) - np.roll(V, 1, axis=1)
    Nn = np.cross(dP, dX)
    Nn /= np.maximum(np.linalg.norm(Nn, axis=2, keepdims=True), 1e-12)
    ctr = np.stack([V[:, :, 0], np.broadcast_to(uc[:, None], V.shape[:2]), np.zeros(V.shape[:2])], 2)
    sgn = np.sign(np.sum(Nn * (V - ctr), axis=2, keepdims=True)); sgn[sgn == 0] = 1
    Nn = Nn * sgn
    tipn = Nn[-2].mean(0); tipn /= np.linalg.norm(tipn)
    Nn[-1] = tipn
    back = np.array([-1.0, 0, 0])
    Nn[0] = 0.5 * (Nn[0] + back); Nn[0] /= np.linalg.norm(Nn[0], axis=1)[:, None]
    return pr, dict(x=xs, a=a, uc=uc, c=c), phi, V, Nn


def surface_z(prof, x, u):
    """camera-side skin height at (x, u)."""
    a = np.interp(x, prof['x'], prof['a']); uc = np.interp(x, prof['x'], prof['uc']); c = np.interp(x, prof['x'], prof['c'])
    p = SHAPE['sx_p']
    t = min(1.0, abs(u - uc) / max(a, 1e-6))
    return c * (1 - t ** p) ** (1 / p)


def mesh_faces(nx, nphi):
    Fc = []
    for i in range(nx - 1):
        for j in range(nphi):
            a = i * nphi + j; b = i * nphi + (j + 1) % nphi
            Fc.append((a, a + nphi, b + nphi, b))
    return Fc


def roots(V, Nn, density, rng):
    nx, nphi, _ = V.shape
    A = V[:-1]; Bq = V[1:]; Cq = np.roll(V[1:], -1, axis=1); Dq = np.roll(V[:-1], -1, axis=1)
    area = 0.5 * (np.linalg.norm(np.cross(Bq - A, Dq - A), axis=2) + np.linalg.norm(np.cross(Bq - Cq, Dq - Cq), axis=2))
    w = area.ravel(); tot = w.sum(); n = int(tot * density)
    idx = np.clip(np.searchsorted(np.cumsum(w) / tot, rng.random(n)), 0, len(w) - 1)
    i, j = np.divmod(idx, nphi); j2 = (j + 1) % nphi
    u = rng.random(n)[:, None]; v = rng.random(n)[:, None]

    def bil(G):
        return G[i, j] * (1 - u) * (1 - v) + G[i + 1, j] * u * (1 - v) + G[i + 1, j2] * u * v + G[i, j2] * (1 - u) * v
    Pp = bil(V); Nr = bil(Nn); Nr /= np.linalg.norm(Nr, axis=1)[:, None]
    return Pp, Nr, tot


# ---------------------------------------------------------------- build
def build(rng):
    pr, prof, phi, V, Nn = skin_grid()
    nx, nphi, _ = V.shape
    mats = dict(fur=F.fur_material('fur', rough=FUR['hr'], coat=FUR['coat']), skin=F.skin_material('skin'),
                bead=F.bead_material('bead', rough=0.08, spec=0.15, coat=1.0, coat_rough=0.03, coat_ior=1.4))
    x_tip, u_tip = pr['x_tip'], pr['u_tip']
    nose = np.array([x_tip, u_tip, 0.0])
    re = SHAPE['eye_r']
    ex, eu = S.EYE
    ez = surface_z(prof, ex, eu) + re * SHAPE['eye_out']
    eye_c = np.array([ex, eu, ez])
    # skin colour: body pink at the neck -> head -> muzzle
    xv = V[:, :, 0].reshape(-1)
    nk = 1 - F.smooth(FUR['neck_a'], FUR['neck_b'], xv)
    mz = F.smooth(FUR['muz_a'], FUR['muz_b'], xv) * FUR['muz_w']
    hs, ms, bs = (F.hex2lin(F.PAL[k]['skin']) for k in ('head', 'muzzle', 'pink'))
    sc = ((1 - mz)[:, None] * hs + mz[:, None] * ms) * (1 - nk)[:, None] + nk[:, None] * bs
    F.mesh_object('skin', V.reshape(-1, 3), mesh_faces(nx, nphi),
                  {'col': ('FLOAT_COLOR', np.concatenate([sc, np.ones((len(sc), 1))], 1))}, [mats['skin']])
    # fur
    Pg, Ng, area = roots(V, Nn, FUR['dens'], rng)
    xg = Pg[:, 0]; n = len(Pg)
    d = Pg - nose[None]; d /= np.maximum(np.linalg.norm(d, axis=1)[:, None], 1e-6)
    v = Pg - eye_c[None]; eye_d = np.linalg.norm(v, axis=1)
    wgt = FUR['eye_comb'] * np.exp(-(np.clip(eye_d - re, 0, None) / FUR['eye_comb_r']) ** 2)
    d = d + wgt[:, None] * v / np.maximum(eye_d[:, None], 1e-6)
    t, b = F.tangent_frame(Ng, d)
    L = rng.uniform(*FUR['len'], n)
    L *= 1 - (1 - FUR['muzzle_len']) * F.smooth(0.9, 1.7, xg)
    L *= 1 - (1 - FUR['nose_len'] / FUR['muzzle_len']) * F.smooth(x_tip - 0.5, x_tip, xg)
    bl = rng.uniform(*F.BODY_FUR['len'], n)
    nkr = 1 - F.smooth(FUR['neck_a'], FUR['neck_b'], xg)
    # brow-side neck shoulder (head_v3_spec.BROW_SHOULDER): it lies over the front end of the first body stamp, so its
    # silhouette band gets body grooming (length, lean, palette, no comb) up to sh_x0, fading out by sh_x1; long head
    # fur combed back up the fillet slope would pile over the convex corner into a tuft.
    rel = (np.interp(xg, prof['x'], prof['uc']) - Pg[:, 1]) / np.maximum(np.interp(xg, prof['x'], prof['a']), 1e-3)
    wsh = (1 - F.smooth(FUR['sh_x0'], FUR['sh_x1'], xg)) * F.smooth(FUR['sh_r0'], FUR['sh_r1'], rel)
    wsh = wsh * (1 if S.shoulder_of(PARAMS) else 0)
    nkr = np.maximum(nkr, wsh)
    L = L * (1 - nkr) + bl * nkr
    ring = F.smooth(re * 1.0, re * (1.0 + FUR['eye_ring']), eye_d)
    L = L * (FUR['eye_ring_len'] / FUR['len'][1] + (1 - FUR['eye_ring_len'] / FUR['len'][1]) * ring)
    L = np.where(eye_d < re * 0.92, 0.02, L)          # under the bead: hidden stubs
    star_rnd = rng.random(n)
    comb_k = FUR['comb'] * (0.55 + 0.45 * ring) * (1 - (1 - FUR['back_comb']) * (1 - F.smooth(-1.1, -0.5, xg)))
    comb_k = comb_k * (1 - FUR['sh_comb'] * wsh)
    lean = FUR['lean'] * (1 - nkr) + F.BODY_FUR['lean'] * 0.7 * nkr
    pos = F.strands(Pg, Ng, t, b, L, rng, K=FUR['K'], lean=lean, comb=t * comb_k[:, None], bend=FUR['bend'],
                    clump=FUR['clump'], clump_shape=FUR['cs'], guide_frac=FUR['gf'], rough=FUR['rough'],
                    frizz=FUR['frizz'], flow=FUR['flow'], flow_k=FUR['flow_k'])
    nf = F.smooth(0.1, 0.8, Ng[:, 0])                  # front-facing (muzzle face) strands
    mzr = F.smooth(FUR['muz_a'], FUR['muz_b'], xg) * FUR['muz_w'] * (0.6 + 0.4 * nf)
    hw = (1 - mzr) * (1 - nkr)
    er = (1 - F.smooth(re * 1.0, re * 2.1, eye_d)) * FUR['eyering']
    st = (1 - F.smooth(re * 1.6, re * FUR['star_r'], eye_d)) * (star_rnd < 0.45) * FUR['star']
    er = np.clip(np.maximum(er, st), 0, 1)
    wts = [('head', hw * (1 - er)), ('muzzle', mzr * (1 - nkr) * (1 - er)), ('pink', nkr * (1 - er)), ('eyering', er)]
    col = F.strand_colors(n, FUR['K'], rng, wts, tip_boost=FUR['tipb'], jitter=FUR['jit'])
    dm = FUR['dmix_head'] * (1 - nkr) + FUR['dmix_body'] * nkr
    F.curves_object('fur', pos, col, FUR['rr'], FUR['rt'], [mats['fur']], {'dm': dm})
    # bead eye
    bpy.ops.mesh.primitive_uv_sphere_add(radius=re, segments=64, ring_count=32, location=tuple(eye_c))
    eo = bpy.context.active_object; eo.name = 'eye'; eo.data.materials.append(mats['bead'])
    for pl in eo.data.polygons:
        pl.use_smooth = True
    return dict(strands=n, area=round(float(area), 3), x_tip=round(x_tip, 4), u_tip=round(u_tip, 4),
                eye=[round(float(c_), 4) for c_ in eye_c], eye_r=re, nose=nose.round(4).tolist())


def scene():
    sc = F.reset(THREADS)
    sc.cycles.samples = SPP
    F.world('#FFE8EE', 0.45)
    W, H = S.CELL[0] * SS, S.CELL[1] * SS
    ox, oy, pxr = S.ORIGIN[0] * SS, S.ORIGIN[1] * SS, S.PX_R * SS
    cam = bpy.data.cameras.new('cam'); cam.type = 'ORTHO'; cam.clip_start = 0.1; cam.clip_end = 200
    cam.ortho_scale = max(W, H) / pxr
    co = bpy.data.objects.new('cam', cam); sc.collection.objects.link(co); sc.camera = co
    co.location = ((W / 2 - ox) / pxr, -(H / 2 - oy) / pxr, 40)
    sc.render.resolution_x = W; sc.render.resolution_y = H
    rig = bpy.data.objects.new('litrig', None); sc.collection.objects.link(rig)
    sun = bpy.data.lights.new('key', 'SUN'); sun.energy = 4.2; sun.angle = math.radians(28)
    so = bpy.data.objects.new('key', sun); sc.collection.objects.link(so); so.parent = rig
    L = S.LIGHT_SCREEN
    so.rotation_euler = Vector((L[0], -L[1], L[2])).normalized().to_track_quat('Z', 'Y').to_euler()
    return sc, rig, (W, H, ox, oy, pxr)


def main():
    t0 = time.time()
    sc, rig, (W, H, ox, oy, pxr) = scene()
    info = build(np.random.default_rng(SEED))
    t_build = time.time() - t0
    print('BUILD %.1fs strands %d x_tip %.3f' % (t_build, info['strands'], info['x_tip']), flush=True)
    times = []
    for b in BUCKETS:
        rig.rotation_euler = (0, 0, b / S.BUCKETS * 2 * math.pi)
        sc.render.filepath = os.path.join(os.path.abspath(OUT), 'head_%02d.png' % b)
        t1 = time.time()
        bpy.ops.render.render(write_still=True)
        times.append(time.time() - t1)
        print('CELL %d %.1fs' % (b, times[-1]), flush=True)
    geom = dict(W=W, H=H, ox=ox, oy=oy, px_R=pxr, ss=SS, spp=SPP, seed=SEED, buckets=BUCKETS,
                light_screen=list(S.LIGHT_SCREEN), sun=4.2, sun_angle_deg=28, world=['#FFE8EE', 0.45],
                build_s=round(t_build, 1), render_s=round(sum(times), 1),
                per_cell_s=round(float(np.mean(times)), 2) if times else 0, params=PARAMS, fur=FUR, shape=SHAPE, **info)
    path = os.path.join(OUT, 'head_geom.json')
    old = json.load(open(path)) if os.path.exists(path) else {}
    if old.get('buckets') and set(old['buckets']) - set(BUCKETS) and old.get('params') == PARAMS:
        geom['buckets'] = sorted(set(old['buckets']) | set(BUCKETS))
    with open(path, 'w') as f:
        json.dump(geom, f, indent=1)
    print('TIMING total %.1fs render %.1fs' % (time.time() - t0, sum(times)), flush=True)


main()
