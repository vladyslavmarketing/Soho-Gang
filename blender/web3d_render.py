"""
ae studio - web3d rest-set renders (spec B2/B3/B5/B6): stills, look cells and tongue overlays.

    blender -b --factory-startup --python blender/web3d_render.py -- --scene hero    # H3 H3b H4 H5
    blender -b --factory-startup --python blender/web3d_render.py -- --scene gauge   # G3 G3b G4 G5
    blender -b --factory-startup --python blender/web3d_render.py -- --clip hero_intro,hero_depart,gauge_arrive,journey
    options: --shots H3,H4 (subset)  --quick (25 %, 8 spp: pipeline test into renders/web3d_quick)

Poses come from the baked clips: H3 = hero_intro's last frame (renders/hero_rest_pose.npz), G3 = gauge_arrive's
last frame before the nod (renders/gauge_rest_pose.npz). Every shot is keyed FK (Spline IK muted; spec B4-1).
No shadows (user decision 2026-11-10): the Sweep / Floor stay in the scene for their bounce light but are
invisible to the camera and not shadow catchers, so the film alpha is the snake only (packer: a_s = 0).
Output (B11): renders/web3d/<shot>/<name>.exr (multilayer, half, ZIP, Combined) + region.json (master px),
renders/web3d/hero_rest.png (H3 colour check), renders/web3d/rig/rig_<scene>.json, renders/web3d/timing.json.
Spec differences (decided for simplicity, see README): one denoiser (OptiX) without the OIDN comparison; max
bounces 8 (the fur colours are calibrated with 8 glossy bounces; spec B2 says 6).
"""
import bpy, math, os, sys, json, time
import numpy as np
from mathutils import Matrix, Vector
from bpy_extras.object_utils import world_to_camera_view

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import snake_path as sp
from snake_path import log, arg, argv

QUICK = '--quick' in argv
OUT = os.path.join(sp.RENDERS_DIR, 'web3d_quick' if QUICK else 'web3d')
MW, MH = 2112, 1344                                    # master frame (156 px/D)
CW, CH = 1408, 896                                     # clip frame (104 px/D)
STAGE = {'hero': [360, 96, 1752, 1152], 'gauge': [96, 0, 1632, 1344]}
HERO_YAW = [-10 + 5 * i for i in range(15)]            # H4, i = 2 neutral
GAUGE_NOD = [15 + 5 * i for i in range(11)]            # G4, i = 5 neutral
TONGUE_FR = [('e1', 0.35, 0), ('e2', 0.70, 0), ('e3', 1.0, 0), ('f1', 1.0, 14), ('f2', 1.0, -14)]
TIMING = {}


def snap(rect, unit):
    x, y, w, h = rect
    x0, y0 = math.floor(x / unit) * unit, math.floor(y / unit) * unit
    x1, y1 = math.ceil((x + w) / unit) * unit, math.ceil((y + h) / unit) * unit
    return [int(x0), int(y0), int(x1 - x0), int(y1 - y0)]


def clip_rect(rect):
    x, y, w, h = rect
    x0, y0, x1, y1 = max(x, 0), max(y, 0), min(x + w, MW), min(y + h, MH)
    return [x0, y0, x1 - x0, y1 - y0]


class Shoot:
    def __init__(self, scene):
        self.scene = scene
        blend = os.path.join(sp.RENDERS_DIR, 'hero_intro.blend' if scene == 'hero' else 'gauge_arrive.blend')
        self.rest = sp.Rest(blend)
        self.sc = self.rest.sc
        npz = np.load(os.path.join(sp.RENDERS_DIR, '%s_rest_pose.npz' % scene))
        self.M = {n: Matrix(npz[n].tolist()) for n in npz.files}
        for nm in ('Sweep', 'Floor'):                  # no shadows: bounce light only
            ob = bpy.data.objects.get(nm)
            if ob:
                ob.is_shadow_catcher = False
                ob.visible_camera = False
        self.nod_sign = float(arg('--nod-sign', 1))
        self.yaw_sign = 1.0
        self.settings()
        if scene == 'hero':
            self.check_yaw()

    # ------------------------------------------------------------------ render settings (B2, stills)
    def settings(self):
        sc = self.sc
        sp.use_gpu(sc)
        sc.render.engine = 'CYCLES'
        c = sc.cycles
        c.samples = 8 if QUICK else 160
        c.use_adaptive_sampling = True
        c.adaptive_threshold = 0.01
        c.adaptive_min_samples = 4 if QUICK else 64
        c.use_denoising = True
        c.denoiser = 'OPTIX'
        c.seed = 0
        c.use_animated_seed = False
        c.sample_clamp_direct = 0.0
        c.sample_clamp_indirect = 10.0
        c.max_bounces = 8
        c.glossy_bounces = 8
        c.transparent_max_bounces = 16
        c.use_light_tree = True
        try:
            sc.cycles_curves.shape = 'THICK'
        except Exception:
            pass
        sc.render.use_persistent_data = True
        sc.render.use_motion_blur = False
        sc.render.film_transparent = True
        c.filter_width = 1.5                          # Blackman-Harris is the only pixel filter in Blender 5
        sc.view_settings.view_transform = 'Standard'
        sc.view_settings.look = 'None'
        sc.view_settings.exposure = -0.2
        sc.render.resolution_x, sc.render.resolution_y = CW, CH
        sc.render.resolution_percentage = 25 if QUICK else 150
        sc.render.use_border = True
        sc.render.use_crop_to_border = False
        f = sc.render.image_settings
        try:                                          # Blender 5: multilayer = media type + OPEN_EXR
            f.media_type = 'MULTI_LAYER_IMAGE'
            f.file_format = 'OPEN_EXR'
        except (AttributeError, TypeError):
            f.file_format = 'OPEN_EXR_MULTILAYER'
        f.color_depth = '16'
        f.exr_codec = 'ZIP'

    # ------------------------------------------------------------------ posing
    def pose(self, yaw=0.0, pitch=0.0, tongue=0.03, breath=0.0):
        """yaw / pitch in degrees (hero yaw, gauge nod); keyed FK at frame 1"""
        if self.scene == 'gauge':
            pitch = self.nod_sign * pitch
        else:
            yaw = self.yaw_sign * yaw
        sp.key_action(self.rest, 'web3d_pose', [(1.0, 0.0, self.M)],
                      look=([(0, math.radians(yaw))], [(0, math.radians(pitch))]), tongue=[(0, tongue)], breath=breath)
        self.sc.frame_set(1)
        bpy.context.view_layer.update()

    def master(self, P):
        """world points -> master px (x, y) and camera distance"""
        sc = self.sc
        rx, ry, pc = sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage
        sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = CW, CH, 100
        out = np.array([tuple(world_to_camera_view(sc, sc.camera, Vector(p))) for p in P])
        sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = rx, ry, pc
        return np.stack([out[:, 0] * MW, (1 - out[:, 1]) * MH, out[:, 2]], 1)

    def eye(self):
        """the eye nearer to the camera, master px"""
        cam = np.array(self.sc.camera.matrix_world.translation)
        E = [np.array(bpy.data.objects[n].matrix_world.translation) for n in ('EyeL', 'EyeR')]
        if self.sc.camera.data.type == 'ORTHO':
            e = max(E, key=lambda p: p[2])
        else:
            e = min(E, key=lambda p: np.linalg.norm(p - cam))
        return self.master([e])[0, :2], e

    def check_yaw(self):
        """B5: +yaw turns the snout toward the camera"""
        cam = np.array(self.sc.camera.matrix_world.translation)
        d = []
        for y in (0, 30):
            self.pose(yaw=y)
            nose = np.array(self.rest.arm.matrix_world @ self.rest.arm.pose.bones['Head'].head)
            d.append(np.linalg.norm(nose - cam))
        if d[1] > d[0]:
            self.yaw_sign = -1.0
        log('yaw sign: %+d (snout camera distance %.3f -> %.3f at +30)' % (self.yaw_sign, d[0], d[1]))

    # ------------------------------------------------------------------ rendering
    def render(self, shot, name, rect, margin=128):
        sc = self.sc
        x, y, w, h = rect
        r = sc.render
        r.border_min_x = max((x - margin) / MW, 0.0)
        r.border_max_x = min((x + w + margin) / MW, 1.0)
        r.border_min_y = max(1 - (y + h + margin) / MH, 0.0)
        r.border_max_y = min(1 - (y - margin) / MH, 1.0)
        d = os.path.join(OUT, shot)
        os.makedirs(d, exist_ok=True)
        region = [int(round(r.border_min_x * MW)), int(round((1 - r.border_max_y) * MH)),
                  int(round((r.border_max_x - r.border_min_x) * MW)), int(round((r.border_max_y - r.border_min_y) * MH))]
        rj = os.path.join(d, 'region.json')
        regs = json.load(open(rj)) if os.path.exists(rj) else {}
        regs[name] = {'region': region, 'rect': rect}
        json.dump(regs, open(rj, 'w'), indent=1)
        r.filepath = os.path.join(d, name + '.exr')
        t0 = time.time()
        bpy.ops.render.render(write_still=True)
        TIMING.setdefault(shot, []).append(round(time.time() - t0, 1))
        log('%s/%s rendered in %.0f s (region %s)' % (shot, name, time.time() - t0, region))

    def save_png(self, path):
        f = self.sc.render.image_settings
        if hasattr(f, 'media_type'):
            f.media_type = 'IMAGE'
        f.file_format, f.color_mode, f.color_depth = 'PNG', 'RGBA', '8'
        bpy.data.images['Render Result'].save_render(path, scene=self.sc)
        self.settings()

    # ------------------------------------------------------------------ rig export (B8-9)
    def rig(self):
        arm = self.rest.arm
        mw = arm.matrix_world
        pb = arm.pose.bones
        chain = ['Head'] + ['Spine_%02d' % i for i in range(1, 57)]
        pts = [np.array(mw @ pb['Head'].head)] + [np.array(mw @ pb[n].tail) for n in chain]
        samples, u0 = [], 0.0
        for k in range(len(chain)):
            a, b = pts[k], pts[k + 1]
            L = np.linalg.norm(b - a)
            t = (np.arange(math.ceil((L - u0) / 0.05 + 1e-9)) * 0.05 + u0) / max(L, 1e-9)
            t = t[t <= 1]
            for tt in t:
                samples.append((a + (b - a) * tt, k))
            u0 = (t[-1] * L + 0.05 - L) if len(t) else u0 - L
        P = np.array([s[0] for s in samples])
        pr = self.master(P)
        u = np.arange(len(P)) * 0.05
        pxd = self.rest.px_per_d(pr[:, 2]) * 1.5
        rows = [[round(float(pr[i, 0]), 2), round(float(pr[i, 1]), 2), round(float(pr[i, 2]), 4),
                 round(float(self.rest.radius(u[i]) * pxd[i]), 2), round(sp.breath_w(samples[i][1]), 4)]
                for i in range(len(P))]
        eye2, _ = self.eye()
        J = lambda v: [round(float(c), 2) for c in self.master([np.array(v)])[0, :2]]
        rig = {'scene': self.scene, 'units': 'master px (2112x1344, 156 px/D), depth = camera distance (D)',
               'centreline': {'step': 0.05, 'columns': ['x', 'y', 'depth', 'rOuterPx', 'breathW'], 'samples': rows},
               'joints': {'head': J(mw @ pb['Head'].tail), 'base': J(mw @ pb['Spine_05'].head),
                          'eye': [round(float(c), 2) for c in eye2], 'snout': J(mw @ pb['Head'].head)},
               'lookAxis': 'yaw' if self.scene == 'hero' else 'nod',
               'lookSign': self.yaw_sign if self.scene == 'hero' else self.nod_sign,
               'camera': {'name': self.sc.camera.name, 'type': self.sc.camera.data.type}}
        os.makedirs(os.path.join(OUT, 'rig'), exist_ok=True)
        json.dump(rig, open(os.path.join(OUT, 'rig', 'rig_%s.json' % self.scene), 'w'))
        log('rig_%s.json: %d centreline samples, joints %s' % (self.scene, len(rows), rig['joints']))
        return rig

    # ------------------------------------------------------------------ tongue overlays
    def tongue_states(self):
        """world matrices of the Tongue object for e1..f2 (pivot at the tongue base, tips up for f1)"""
        arm = self.rest.arm
        ob = bpy.data.objects['Tongue']
        W0 = ob.matrix_world.copy()
        P = arm.matrix_world @ arm.pose.bones['Tongue'].head
        H = arm.data.bones['Head']
        side = (arm.matrix_world.to_3x3() @ arm.pose.bones['Head'].matrix.to_3x3() @
                (H.matrix_local.to_3x3().inverted() @ Vector((0, 1, 0)))).normalized()
        V = [Vector(v.co) for v in ob.data.vertices]
        out = []
        for nm, s, a in TONGUE_FR:
            Mx = Matrix.Translation(P) @ Matrix.Rotation(math.radians(a), 4, side) @ Matrix.Diagonal((s, s, s, 1)) \
                 @ Matrix.Translation(-P) @ W0
            out.append((nm, Mx))
        zf1 = np.mean([(out[3][1] @ v).z for v in V])           # f1 = tips up
        zf2 = np.mean([(out[4][1] @ v).z for v in V])
        if zf2 > zf1:
            out[3], out[4] = ('f1', out[4][1]), ('f2', out[3][1])
        return out, W0, V

    def tongue_bbox(self, angles):
        box = None
        for a in angles:
            self.pose(**{self.look_key: a, 'tongue': 1.0})
            states, W0, V = self.tongue_states()
            for nm, Mx in states:
                pr = self.master([np.array(Mx @ v) for v in V])
                b = [pr[:, 0].min(), pr[:, 1].min(), pr[:, 0].max(), pr[:, 1].max()]
                box = b if box is None else [min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3])]
        r = [box[0] - 64, box[1] - 64, box[2] - box[0] + 128, box[3] - box[1] + 128]
        return clip_rect(snap(r, 24))

    # ------------------------------------------------------------------ shots
    def run(self, shots):
        scene = self.scene
        S = 'H' if scene == 'hero' else 'G'
        angles = HERO_YAW if scene == 'hero' else GAUGE_NOD
        self.look_key = 'yaw' if scene == 'hero' else 'pitch'
        neutral = 0 if scene == 'hero' else 40
        stage = STAGE[scene]
        mp = os.path.join(OUT, '%s_meta.json' % scene)
        meta = json.load(open(mp)) if os.path.exists(mp) else {}
        self.pose(**{self.look_key: neutral})
        e2, _ = self.eye()
        cell = clip_rect(snap([e2[0] - 468, e2[1] - 468, 936, 936], 24))
        meta.update(neutral_eye=[float(e2[0]), float(e2[1])], cell_rect=cell, angles=angles,
                    neutral=angles.index(neutral), look_sign=self.yaw_sign if scene == 'hero' else self.nod_sign)
        if S + '3' in shots:
            self.rig()
            self.render('%s_rest' % scene, '0000', [0, 0, MW, MH], margin=0)
            if scene == 'hero':
                self.save_png(os.path.join(OUT, 'hero_rest.png'))
        if S + '3b' in shots:
            self.pose(**{self.look_key: neutral, 'breath': 1.0})
            self.render('%s_rest_breath' % scene, '0000', stage)
        if S + '4' in shots:
            for i, a in enumerate(angles):
                self.pose(**{self.look_key: a})
                self.render('%s_look' % scene, 'c%02d' % i, cell)
        if S + '5' in shots:
            trect = self.tongue_bbox(angles)
            meta['tongue_rect'] = trect
            obs = [o for o in bpy.data.objects if o.type in ('MESH', 'CURVES') and o.name != 'Tongue']
            for o in obs:
                o.is_holdout = True
            tob = bpy.data.objects['Tongue']
            for i, a in enumerate(angles):
                self.pose(**{self.look_key: a, 'tongue': 1.0})
                states, W0, V = self.tongue_states()
                for nm, Mx in states:
                    tob.matrix_world = Mx
                    self.render('%s_tongue' % scene, 'c%02d_%s' % (i, nm), trect, margin=64)
                tob.matrix_world = W0
            for o in obs:
                o.is_holdout = False
        json.dump(meta, open(mp, 'w'), indent=1)
        log(scene, 'meta', meta)


CLIPS = {  # blend, shutter, region rect (master px of its own frame)
    'hero_intro': ('hero_intro.blend', 0.5, STAGE['hero']), 'hero_depart': ('hero_depart.blend', 1.0, STAGE['hero']),
    'gauge_arrive': ('gauge_arrive.blend', 0.5, STAGE['gauge']), 'journey': ('journey.blend', 0.5, [0, 0, 480, 3120]),
}


def render_clip(name):
    """B2 clips: 100 %, 64 spp (adaptive 0.02, min 32), centred motion blur with deformation blur, EXR per frame"""
    blend, shutter, rect = CLIPS[name]
    bpy.ops.wm.open_mainfile(filepath=os.path.join(sp.RENDERS_DIR, blend))
    sc = bpy.context.scene
    for nm in ('Sweep', 'Floor'):
        ob = bpy.data.objects.get(nm)
        if ob:
            ob.is_shadow_catcher = False
            ob.visible_camera = False
    sh = Shoot.__new__(Shoot)
    sh.sc = sc
    Shoot.settings(sh)
    c = sc.cycles
    c.samples = 8 if QUICK else int(arg('--samples', 64))
    c.adaptive_threshold = 0.02
    c.adaptive_min_samples = 4 if QUICK else 32
    fw, fh = (480, 3120) if name == 'journey' else (MW, MH)
    sc.render.resolution_x, sc.render.resolution_y = fw * 2 // 3, fh * 2 // 3
    sc.render.resolution_percentage = 25 if QUICK else 100
    sc.render.use_motion_blur = True
    sc.render.motion_blur_shutter = shutter
    sc.render.motion_blur_position = 'CENTER'
    for nm in ('Body', 'Fur'):
        ob = bpy.data.objects[nm]
        ob.cycles.use_motion_blur = True
        ob.cycles.use_deform_motion = True
    x, y, w, h = rect
    r = sc.render
    r.border_min_x, r.border_max_x = max((x - 128) / fw, 0), min((x + w + 128) / fw, 1)
    r.border_min_y, r.border_max_y = max(1 - (y + h + 128) / fh, 0), min(1 - (y - 128) / fh, 1)
    d = os.path.join(OUT, name)
    os.makedirs(d, exist_ok=True)
    region = [int(round(r.border_min_x * fw)), int(round((1 - r.border_max_y) * fh)),
              int(round((r.border_max_x - r.border_min_x) * fw)), int(round((r.border_max_y - r.border_min_y) * fh))]
    json.dump({'region': region, 'rect': rect, 'frame': [fw, fh], 'shutter': shutter,
               'frames': [sc.frame_start, sc.frame_end]}, open(os.path.join(d, 'region.json'), 'w'), indent=1)
    fr = arg('--frames', None)
    if fr:
        sc.frame_start, sc.frame_end = [int(v) + 1 for v in fr.split('-')]
    r.filepath = os.path.join(d, '####')
    t0 = time.time()
    bpy.ops.render.render(animation=True)
    n = sc.frame_end - sc.frame_start + 1
    TIMING[name] = {'frames': n, 'seconds': round(time.time() - t0), 'per_frame': round((time.time() - t0) / n, 1)}
    log('%s: %d frames in %.0f s' % (name, n, time.time() - t0))


def main():
    if arg('--clip', None):
        os.makedirs(OUT, exist_ok=True)
        for nm in arg('--clip', '').split(','):
            render_clip(nm)
        tj = os.path.join(OUT, 'timing.json')
        tm = json.load(open(tj)) if os.path.exists(tj) else {}
        tm.update(TIMING)
        json.dump(tm, open(tj, 'w'), indent=1)
        return
    scene = arg('--scene', 'hero')
    S = 'H' if scene == 'hero' else 'G'
    shots = arg('--shots', ','.join(S + s for s in ('3', '3b', '4', '5'))).split(',')
    t0 = time.time()
    Shoot(scene).run(shots)
    os.makedirs(OUT, exist_ok=True)
    tj = os.path.join(OUT, 'timing.json')
    tm = json.load(open(tj)) if os.path.exists(tj) else {}
    tm.update({k: {'seconds': v, 'mean': round(sum(v) / len(v), 1)} for k, v in TIMING.items()})
    tm['%s_total_s' % scene] = round(time.time() - t0)
    json.dump(tm, open(tj, 'w'), indent=1)
    log('done', scene, 'in %.0f s' % (time.time() - t0))


if __name__ == '__main__':
    main()
