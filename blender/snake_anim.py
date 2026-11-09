"""
ae studio - "idle + look around" animation of the plush snake and its two deliverables.

Needs the scene from snake_scene.py (C:/Users/vladk/ae-studio/renders/snake.blend by default).

    blender -b --factory-startup --python blender/snake_anim.py -- --bake            # keys -> snake_anim.blend
    blender -b --factory-startup --python blender/snake_anim.py -- --clip            # A: Cycles PNG passes
    blender -b --factory-startup --python blender/snake_anim.py -- --encode          # A: WebM (alpha) + MP4 preview
    blender -b --factory-startup --python blender/snake_anim.py -- --glb             # B: snake.glb + textures + manifest
    blender -b --factory-startup --python blender/snake_anim.py -- --fur-tile        # B: fur_strands.webp
    (stages can be combined; --clip takes --frames 1-180 and --samples 64; --encode takes --ffmpeg <path>)

Animation "idle_lookaround": 6 s at 30 fps (frames 1-180, loops), the "ae" pose of the photo.
    breathing  two slow breaths: the body swells ~2 % (bone X/Z scale along the middle of the body)
    look       the head turns toward one side, then the other, then lifts a little, and comes back;
               the turn is shared by the head (45 %) and the five neck bones
    tongue     two quick flicks (the "Tongue" bone scales the tongue out of the mouth and back)
The Spline IK pose is evaluated once and baked to plain FK keys (so the glTF export carries it); the
constraint is muted in snake_anim.blend.

Outputs
    A  blender/export/clipA/  snake_idle.webm (VP9 + alpha, snake with its shadow), snake_idle_preview.mp4
                             (on the pink backdrop); PNG passes rgba_####.png + shadow_####.png (1280x720)
                             go to --frames-dir (default C:/Users/vladk/ae-studio/renders/clipA_frames)
    B  blender/export/        snake.glb, snake_albedo.webp, snake_normal.webp, fur_strands.webp, manifest.json
"""
import bpy, math, os, sys, json, subprocess, shutil, time
import numpy as np
from mathutils import Matrix, Vector, Quaternion

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default):
    return argv[argv.index(name) + 1] if name in argv else default
RENDERS_DIR = r'C:\Users\vladk\ae-studio\renders' if os.path.isdir(r'C:\Users\vladk\ae-studio') \
    else os.path.normpath(os.path.join(HERE, '..', '..', 'renders'))
SRC_BLEND = os.path.abspath(arg('--blend', os.path.join(RENDERS_DIR, 'snake.blend')))
ANIM_BLEND = os.path.abspath(arg('--anim-blend', os.path.join(RENDERS_DIR, 'snake_anim.blend')))
EXPORT = os.path.join(HERE, 'export')
CLIP = os.path.join(EXPORT, 'clipA')
FRAMES_DIR = os.path.abspath(arg('--frames-dir', os.path.join(RENDERS_DIR, 'clipA_frames')))
FPS, NF = 30, 180
ACTION = 'idle_lookaround'
CLIP_RES = (1280, 720)


def log(*a):
    print('[%6.1fs]' % (time.time() - T0), *a, flush=True)


def smooth_keys(keys, t):
    """cosine ease between (time, value) keys"""
    for (t0, v0), (t1, v1) in zip(keys[:-1], keys[1:]):
        if t0 <= t <= t1:
            u = (t - t0) / (t1 - t0) if t1 > t0 else 0
            return v0 + (v1 - v0) * (0.5 - 0.5 * math.cos(math.pi * u))
    return keys[-1][1]


YAW = [(0, 0), (0.7, 0), (1.6, 0.42), (2.4, 0.42), (3.4, -0.36), (4.1, -0.36), (5.1, 0), (6, 0)]
PITCH = [(0, 0), (3.9, 0), (4.6, 0.20), (5.2, 0.20), (5.9, 0), (6, 0)]
TONGUE = [(0, 0.03), (1.95, 0.03), (2.07, 1.0), (2.25, 1.0), (2.4, 0.03),
          (4.75, 0.03), (4.87, 1.0), (4.97, 0.75), (5.07, 1.0), (5.22, 0.03), (6, 0.03)]
LOOK_SHARE = [('Head', 0.45), ('Spine_01', 0.22), ('Spine_02', 0.15), ('Spine_03', 0.09), ('Spine_04', 0.06),
              ('Spine_05', 0.03)]


def breath(t):
    return 0.022 * math.sin(2 * math.pi * t / 3.0)


# ======================================================================================== bake
def bake():
    bpy.ops.wm.open_mainfile(filepath=SRC_BLEND)
    sc = bpy.context.scene
    arm = bpy.data.objects['SnakeRig']
    bones = arm.pose.bones
    spine = [b.name for b in arm.data.bones if b.name.startswith('Spine_')]
    bpy.context.view_layer.update()
    M0 = {pb.name: pb.matrix.copy() for pb in bones}                 # the photo pose (Spline IK)
    for pb in bones:
        for c in pb.constraints:
            if c.type == 'SPLINE_IK':
                c.mute = True
        pb.rotation_mode = 'QUATERNION'
    H = arm.data.bones['Head']
    up_axis = (M0['Head'].to_3x3() @ (H.matrix_local.to_3x3().inverted() @ Vector((0, 0, 1)))).normalized()
    side_axis = (M0['Head'].to_3x3() @ (H.matrix_local.to_3x3().inverted() @ Vector((0, 1, 0)))).normalized()
    n_sp = len(spine)
    rel = lambda n: arm.data.bones['Head'].matrix_local.inverted() @ arm.data.bones[n].matrix_local

    def targets(t):
        Mt = {k: v.copy() for k, v in M0.items()}
        yaw, pit = smooth_keys(YAW, t), smooth_keys(PITCH, t)
        C = Matrix.Identity(4)
        for name, w in reversed(LOOK_SHARE):                          # from the body toward the head
            tail = C @ (M0[name] @ Vector((0, arm.data.bones[name].length, 0)))
            R = (Quaternion(up_axis, yaw * w) @ Quaternion(side_axis, pit * w)).to_matrix().to_4x4()
            C = Matrix.Translation(tail) @ R @ Matrix.Translation(-tail) @ C
            Mt[name] = C @ M0[name]
        b = breath(t)
        for i, name in enumerate(spine):                                # swell along the middle of the body
            w = math.sin(math.pi * min(max((i - 2) / (n_sp * 0.85), 0), 1))
            s = 1 + b * w
            Mt[name] = Mt[name] @ Matrix.Diagonal((s, 1, s, 1))
        tg = smooth_keys(TONGUE, t)
        Mt['Tongue'] = Mt['Head'] @ rel('Tongue') @ Matrix.Diagonal((tg, tg, tg, 1))
        Mt['Jaw'] = Mt['Head'] @ rel('Jaw')
        return Mt

    def basis(name, Mt):
        bn = arm.data.bones[name]
        if bn.parent is None:
            return bn.matrix_local.inverted() @ Mt[name]
        rest_rel = bn.parent.matrix_local.inverted() @ bn.matrix_local
        return rest_rel.inverted() @ Mt[bn.parent.name].inverted() @ Mt[name]

    names = [pb.name for pb in bones]
    data = {n: np.zeros((NF, 10)) for n in names}
    prevq = {}
    for f in range(NF):
        Mt = targets(f / FPS)
        for n in names:
            loc, q, scl = basis(n, Mt).decompose()
            if n in prevq and q.dot(prevq[n]) < 0:
                q = -q
            prevq[n] = q
            data[n][f] = [*loc, q.w, q.x, q.y, q.z, *scl]
    act = bpy.data.actions.get(ACTION) or bpy.data.actions.new(ACTION)
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
    sc.render.fps = FPS
    sc.frame_start, sc.frame_end = 1, NF
    sc.frame_set(1)
    act.use_fake_user = True
    bpy.ops.wm.save_as_mainfile(filepath=ANIM_BLEND, compress=False)
    log('baked %d bones x %d frames -> %s' % (len(names), NF, ANIM_BLEND))


def open_anim():
    if os.path.normcase(bpy.data.filepath) != os.path.normcase(ANIM_BLEND):
        bpy.ops.wm.open_mainfile(filepath=ANIM_BLEND)
    return bpy.context.scene


def use_gpu(sc):
    if '--cpu' in argv:
        return
    cp = bpy.context.preferences.addons['cycles'].preferences
    for t in ('OPTIX', 'CUDA', 'HIP', 'ONEAPI', 'METAL'):
        try:
            cp.compute_device_type = t
        except TypeError:
            continue
        cp.refresh_devices()
        if any(d.type == t for d in cp.devices):
            for d in cp.devices:
                d.use = d.type == t
            sc.cycles.device = 'GPU'
            log('render device', t)
            return


# ======================================================================================== A: Cycles clip
def clip():
    sc = open_anim()
    use_gpu(sc)
    a, b = (int(v) for v in arg('--frames', '1-%d' % NF).split('-'))
    sc.frame_start, sc.frame_end = a, b
    sc.render.resolution_x, sc.render.resolution_y = CLIP_RES
    sc.render.resolution_percentage = 100
    sc.cycles.samples = int(arg('--samples', 64))
    sc.render.film_transparent = True
    sc.render.use_persistent_data = True
    bpy.data.objects['Sweep'].is_shadow_catcher = True
    vl = sc.view_layers[0]
    vl.cycles.use_pass_shadow_catcher = True
    ng = bpy.data.node_groups.new('ClipPasses', 'CompositorNodeTree')
    sc.compositing_node_group = ng
    rl = ng.nodes.new('CompositorNodeRLayers'); rl.scene = sc; rl.layer = vl.name
    fo = ng.nodes.new('CompositorNodeOutputFile')
    os.makedirs(FRAMES_DIR, exist_ok=True)
    fo.directory = FRAMES_DIR + os.sep
    fo.file_name = ''
    if hasattr(fo.format, 'media_type'):
        fo.format.media_type = 'IMAGE'
    fo.format.file_format = 'PNG'
    fo.format.color_mode = 'RGBA'
    fo.format.color_depth = '8'
    for nm in ('rgba_', 'shadow_'):
        fo.file_output_items.new('RGBA', nm)
    ng.links.new(rl.outputs['Image'], fo.inputs['rgba_'])
    ng.links.new(rl.outputs['Shadow Catcher'], fo.inputs['shadow_'])
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = os.path.join(RENDERS_DIR, 'clipA_main', '')
    t0 = time.time()
    bpy.ops.render.render(animation=True)
    log('rendered frames %d-%d in %.0fs' % (a, b, time.time() - t0))


# ======================================================================================== A: encode
def find_ffmpeg():
    p = arg('--ffmpeg', None) or shutil.which('ffmpeg')
    if not p:
        base = os.path.expandvars(r'%LOCALAPPDATA%\Microsoft\WinGet\Packages')
        for root, _, files in os.walk(base):
            if 'ffmpeg.exe' in files:
                return os.path.join(root, 'ffmpeg.exe')
    return p


def encode():
    ff = find_ffmpeg()
    if not ff:
        raise SystemExit('ffmpeg not found: winget install Gyan.FFmpeg (or pass --ffmpeg <path>)')
    os.makedirs(CLIP, exist_ok=True)
    # shadow pass (white = no shadow) -> black RGBA sprite that sits under the snake on any background
    for f in sorted(os.listdir(FRAMES_DIR)):
        if not f.startswith('shadow_'):
            continue
        p = os.path.join(FRAMES_DIR, f)
        im = bpy.data.images.load(p)
        w, h = im.size
        a = np.empty(w * h * 4, np.float32); im.pixels.foreach_get(a); a = a.reshape(h, w, 4)
        if a[..., 3].min() < 0.999 and a[..., :3].max() < 0.01:
            bpy.data.images.remove(im)
            continue                                                   # already converted
        v = a[..., :3].mean(-1)
        ref = np.percentile(v, 90)                                     # the unshadowed backdrop level
        sh = np.clip((ref - v) / max(ref, 1e-3) - 0.01, 0, 1) * 1.05
        out = np.zeros((h, w, 4), np.float32); out[..., 3] = sh
        im.pixels.foreach_set(out.ravel()); im.filepath_raw = p; im.file_format = 'PNG'; im.save()
        bpy.data.images.remove(im)
    log('shadow sprites done')
    fr = os.path.join(FRAMES_DIR, '%s%%04d.png')
    webm = os.path.join(CLIP, 'snake_idle.webm')
    mp4 = os.path.join(CLIP, 'snake_idle_preview.mp4')
    common = [ff, '-y', '-loglevel', 'error']
    subprocess.check_call(common + ['-framerate', str(FPS), '-i', fr % 'shadow_', '-framerate', str(FPS), '-i', fr % 'rgba_',
                                    '-filter_complex', '[0][1]overlay=format=auto,format=yuva420p',
                                    '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '30',
                                    '-row-mt', '1', '-auto-alt-ref', '0', webm])
    subprocess.check_call(common + ['-f', 'lavfi', '-i', 'color=c=0xE6C3C9:s=%dx%d:r=%d' % (CLIP_RES[0], CLIP_RES[1], FPS),
                                    '-framerate', str(FPS), '-i', fr % 'shadow_', '-framerate', str(FPS), '-i', fr % 'rgba_',
                                    '-filter_complex', '[0][1]overlay[s];[s][2]overlay,format=yuv420p',
                                    '-frames:v', str(NF), '-c:v', 'libx264', '-crf', '18', '-movflags', '+faststart', mp4])
    log('wrote', webm, mp4)


# ======================================================================================== B: glTF + textures
def save_image(arr, path, srgb, quality=90):
    """arr: rows from the top of the image, values 0..1 (already encoded)"""
    h, w = arr.shape[:2]
    im = bpy.data.images.new(os.path.basename(path), w, h, alpha=False, float_buffer=False)
    im.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
    a = np.ones((h, w, 4), np.float32)
    a[..., :3] = np.clip(arr[::-1, :, :3], 0, 1)
    im.pixels.foreach_set(a.ravel())
    im.filepath_raw = path
    im.file_format = 'WEBP'
    im.save(filepath=path, quality=quality)
    log('wrote', path)


def lin2srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)


def blur(a, r, wrap_y=True):
    k = np.exp(-0.5 * (np.arange(-3 * int(r), 3 * int(r) + 1) / r) ** 2); k /= k.sum()
    p = 3 * int(r)
    a = np.pad(a, ((p, p), (0, 0)), mode='wrap' if wrap_y else 'edge')
    a = np.stack([np.convolve(a[:, j], k, 'valid') for j in range(a.shape[1])], 1)
    a = np.pad(a, ((0, 0), (p, p)), mode='edge')
    return np.stack([np.convolve(a[i], k, 'valid') for i in range(a.shape[0])], 0)


def textures(TW=4096, TH=512):
    """albedo = the fur colour seen on the skin (from the strands' own colours), normal = soft pile bumps"""
    cv = bpy.data.objects['Fur'].data
    n = len(cv.curves)
    uv = np.empty(n * 2, np.float32); cv.attributes['surface_uv_coordinate'].data.foreach_get('vector', uv)
    col = np.empty(n * 4, np.float32); cv.attributes['fur_col'].data.foreach_get('color', col)
    uv, col = uv.reshape(n, 2), col.reshape(n, 4)[:, :3]
    col = 1 - (1 - col) * (1 - col * 0.35)                       # pale tips lighten the overall look
    xi = np.clip((uv[:, 0] * TW).astype(int), 0, TW - 1)
    yi = np.clip((uv[:, 1] * TH).astype(int), 0, TH - 1)
    acc = np.zeros((TH, TW, 3)); cnt = np.zeros((TH, TW))
    np.add.at(acc, (yi, xi), col); np.add.at(cnt, (yi, xi), 1)
    ws = blur(cnt, 2.0)
    alb = np.stack([blur(acc[..., c], 2.0) for c in range(3)], -1) / np.maximum(ws, 1e-6)[..., None]
    save_image(lin2srgb(alb)[::-1], os.path.join(EXPORT, 'snake_albedo.webp'), True, 92)
    # normal: anisotropic noise (pile combed along the body = along U), tangent space, +G = image up
    rng = np.random.default_rng(3)
    F = np.fft.fft2(rng.normal(size=(TH, TW)))
    fy = np.fft.fftfreq(TH)[:, None]; fx = np.fft.fftfreq(TW)[None, :]
    h = np.real(np.fft.ifft2(F * np.exp(-((fx * 90) ** 2 + (fy * 22) ** 2))))
    h = h / (np.abs(h).max() + 1e-9)
    gx = np.roll(h, -1, 1) - np.roll(h, 1, 1); gy = np.roll(h, -1, 0) - np.roll(h, 1, 0)
    nrm = np.stack([-gx * 2.2, -gy * 2.2, np.ones_like(h)], -1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    save_image((nrm * 0.5 + 0.5)[::-1], os.path.join(EXPORT, 'snake_normal.webp'), False, 95)
    return TW, TH


def glb():
    sc = open_anim()
    os.makedirs(EXPORT, exist_ok=True)
    TW, TH = textures()
    arm = bpy.data.objects['SnakeRig']
    body = bpy.data.objects['Body']
    m = bpy.data.materials.new('SnakeSkin')                     # placeholder: textures ship next to the glb
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.6, 0.25, 0.3, 1)
    body.data.materials.clear(); body.data.materials.append(m)
    bpy.ops.object.select_all(action='DESELECT')
    sel = [arm, body] + [bpy.data.objects[n] for n in ('EyeL', 'EyeR', 'Tongue', 'CamHero')]
    for o in sel:
        o.hide_set(False); o.select_set(True)
    bpy.context.view_layer.objects.active = arm
    sc.render.resolution_x, sc.render.resolution_y = CLIP_RES
    sc.frame_set(1)
    path = os.path.join(EXPORT, 'snake.glb')
    want = dict(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
                export_texcoords=True, export_normals=True, export_tangents=True, export_skins=True,
                export_all_influences=False, export_def_bones=False, export_animations=True,
                export_animation_mode='ACTIONS', export_frame_range=True, export_force_sampling=True,
                export_anim_single_armature=True, export_cameras=True, export_lights=False,
                export_materials='EXPORT', export_image_format='NONE', export_extras=False)
    props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    bpy.ops.export_scene.gltf(**{k: v for k, v in want.items() if k in props})
    log('wrote', path, '%.1f MB' % (os.path.getsize(path) / 1e6))
    cam = bpy.data.objects['CamHero']
    tri = sum(len(p.vertices) - 2 for p in body.data.polygons)
    gl = lambda v: [round(v[0], 4), round(v[2], 4), round(-v[1], 4)]
    sensor, lens = cam.data.sensor_width, cam.data.lens
    yfov = 2 * math.atan(sensor * CLIP_RES[1] / CLIP_RES[0] / 2 / lens)
    floor_z = min(v.co.z for v in bpy.data.objects['Sweep'].data.vertices)
    manifest = {
        'name': 'ae studio plush snake', 'version': 1,
        'generator': 'blender/snake_scene.py + blender/snake_anim.py (Blender %s)' % bpy.app.version_string,
        'units': '1 unit = D, the outer diameter of the body with its fur',
        'axes': {'up': '+Y', 'gltfFromBlender': '(x, y, z)_gltf = (x, z, -y)_blender', 'floorY': round(floor_z, 4),
                 'pose': 'the "ae" pose of the client photo (assets/img/snake-ae.jpg)'},
        'mesh': {'node': 'Body', 'triangles': tri, 'skinned': True,
                 'uv0': 'u = arc length from the nose / L, v = angle around the body from the belly line (0..1)',
                 'lengthD': round(max(v.co.x for v in body.data.vertices), 4),
                 'others': ['EyeL, EyeR: glossy black beads (follow Head)', 'Tongue: follows the Tongue bone']},
        'skeleton': {'root': 'Head (the chain runs nose -> tail tip)', 'bones': [b.name for b in arm.data.bones],
                     'spineBones': sum(1 for b in arm.data.bones if b.name.startswith('Spine_')),
                     'jaw': 'Jaw: child of Head, no skin weights yet', 'tongue': 'Tongue: uniform scale 0.03 = hidden, 1 = out'},
        'fur': {'depthD': 0.13, 'strandLengthD': round(0.13 * 1.15, 4),
                'direction': 'combed toward the tail with a parting along the side mid-lines; on the head it radiates from the snout',
                'shading': 'tips are a lighter tint of the strand colour; roots ~50 % darker on the body, not on the muzzle'},
        'animation': {'name': ACTION, 'fps': FPS, 'frames': NF, 'seconds': NF / FPS, 'loop': True,
                      'content': 'breathing (2 breaths, ~2 % swell), head looks to one side, the other, a little up, back; two tongue flicks'},
        'camera': {'node': 'CamHero', 'yfovRad': round(yfov, 5), 'aspect': round(CLIP_RES[0] / CLIP_RES[1], 5),
                   'lensMm': lens, 'sensorMm': sensor, 'sensorFit': 'horizontal', 'position': gl(cam.location),
                   'pitchDownDeg': round(90 - math.degrees(cam.rotation_euler.x), 3),
                   'note': 'same camera as clip A (1280x720); the photo is 1408x768 with the same lens and pose'},
        'textures': {
            'snake_albedo.webp': {'size': [TW, TH], 'colorSpace': 'sRGB', 'uv': 0,
                                  'content': 'fur colour as seen: pink, cream bands with black edges, lighter head and muzzle, darker ring round the eyes'},
            'snake_normal.webp': {'size': [TW, TH], 'colorSpace': 'linear', 'uv': 0,
                                  'content': 'tangent-space normal of soft pile bumps (glTF convention, +G = image up); use at low strength'},
            'fur_strands.webp': {'size': [1024, 1024], 'colorSpace': 'linear', 'tileable': True, 'tileD': 0.35,
                                 'R': 'strand height / mask for shell alpha: the shell at height h (0..1) keeps texels with R >= h',
                                 'G': 'random value per strand', 'B': 'random value per clump',
                                 'source': 'Cycles render of real hair curves seen from above'}},
        'clipA': {'dir': 'clipA/', 'webm': 'snake_idle.webm: VP9 + alpha, the snake with its shadow, 1280x720',
                  'preview': 'snake_idle_preview.mp4: H.264 on the powder-pink backdrop',
                  'passes': 'PNG passes (rgba_####.png snake on transparent, shadow_####.png black shadow sprite) are kept locally'},
        'files': ['snake.glb', 'snake_albedo.webp', 'snake_normal.webp', 'fur_strands.webp', 'manifest.json',
                  'clipA/snake_idle.webm', 'clipA/snake_idle_preview.mp4'],
    }
    with open(os.path.join(EXPORT, 'manifest.json'), 'w', encoding='utf-8') as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)
    log('wrote manifest')


# ======================================================================================== B: fur strand tile
def fur_tile(res=1024, n=7500, clumps=150, seed=5):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    use_gpu(sc)
    rng = np.random.default_rng(seed)
    cc = rng.random((clumps, 2)); crand = rng.random(clumps)
    roots = rng.random((n, 2))
    d = roots[:, None, :] - cc[None, :, :]
    d -= np.round(d)                                               # periodic distance (tile = 1)
    k = np.argmin((d ** 2).sum(-1), 1)
    to_c = -d[np.arange(n), k]
    K = 6
    t = np.linspace(0, 1, K)
    length = rng.uniform(0.72, 1.0, n)
    lean = rng.normal(0, 0.012, (n, 2))
    pts = np.zeros((n, K, 3))
    for c in (0, 1):
        pts[:, :, c] = roots[:, None, c] + (to_c[:, None, c] * 0.22 + lean[:, None, c]) * t ** 1.5
    pts[:, :, 2] = length[:, None] * t
    reps = [(dx, dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)]
    allp = np.concatenate([pts + np.array([dx, dy, 0]) for dx, dy in reps])
    rnd = np.tile(rng.random(n), len(reps)); cl = np.tile(crand[k], len(reps))
    N = len(allp)
    cv = bpy.data.hair_curves.new('Tile')
    cv.add_curves([K] * N)
    cv.position_data.foreach_set('vector', allp.astype(np.float32).ravel())
    rad = cv.attributes.get('radius') or cv.attributes.new('radius', 'FLOAT', 'POINT')
    rad.data.foreach_set('value', np.tile(0.0068 + (0.0012 - 0.0068) * t, N).astype(np.float32))
    for nm, v in (('rnd', rnd), ('clump', cl)):
        a = cv.attributes.new(nm, 'FLOAT', 'CURVE'); a.data.foreach_set('value', v.astype(np.float32))
    ob = bpy.data.objects.new('Tile', cv); sc.collection.objects.link(ob)
    m = bpy.data.materials.new('TileData'); nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); em = nt.nodes.new('ShaderNodeEmission')
    geo = nt.nodes.new('ShaderNodeNewGeometry'); sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    a1 = nt.nodes.new('ShaderNodeAttribute'); a1.attribute_name = 'rnd'
    a2 = nt.nodes.new('ShaderNodeAttribute'); a2.attribute_name = 'clump'
    cmb = nt.nodes.new('ShaderNodeCombineColor')
    nt.links.new(geo.outputs['Position'], sep.inputs[0]); nt.links.new(sep.outputs['Z'], cmb.inputs[0])
    nt.links.new(a1.outputs['Fac'], cmb.inputs[1]); nt.links.new(a2.outputs['Fac'], cmb.inputs[2])
    nt.links.new(cmb.outputs[0], em.inputs['Color']); nt.links.new(em.outputs[0], out.inputs['Surface'])
    cv.materials.append(m)
    camd = bpy.data.cameras.new('Top'); camd.type = 'ORTHO'; camd.ortho_scale = 1.0
    cam = bpy.data.objects.new('Top', camd); cam.location = (0.5, 0.5, 5); sc.collection.objects.link(cam)
    sc.camera = cam
    w = bpy.data.worlds.new('W'); sc.world = w
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0
    sc.render.resolution_x = sc.render.resolution_y = res
    sc.cycles.samples = 16; sc.cycles.use_denoising = False
    sc.cycles.max_bounces = 0; sc.cycles_curves.shape = 'THICK'
    sc.cycles.filter_width = 0.8
    sc.view_settings.view_transform = 'Standard'
    tmp = os.path.join(RENDERS_DIR, '_fur_tile.exr')
    sc.render.image_settings.file_format = 'OPEN_EXR'; sc.render.image_settings.color_depth = '32'
    sc.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    im = bpy.data.images.load(tmp)
    a = np.empty(res * res * 4, np.float32); im.pixels.foreach_get(a); a = a.reshape(res, res, 4)[::-1, :, :3]
    os.makedirs(EXPORT, exist_ok=True)
    save_image(np.clip(a, 0, 1), os.path.join(EXPORT, 'fur_strands.webp'), False, 100)


if '--bake' in argv:
    bake()
if '--clip' in argv:
    clip()
if '--encode' in argv:
    encode()
if '--glb' in argv:
    glb()
if '--fur-tile' in argv:
    fur_tile()
log('done')
