"""Blender (4.0+) scene: the plush snake head shaped after the client's photo, rendered as engine atlas cells.

    blender -b --factory-startup --python dev/blender/head_photo.py -- OUT_DIR [buckets e.g. 0,8] [samples]

Units: 1 Blender unit = 1 body radius R. Cell frame (as in assets/img/snake/manifest.json): x forward from the head
point, image y down; the eye is on +y (per_bucket [1]); the jaw hangs to -y. Camera: orthographic, top-down.
Cell b is lit for heading b/32*2PI with the engine's fixed screen key light (light_screen).
Output: OUT_DIR/head_XX.png (2x supersampled, straight alpha). dev/blender/build_head_atlas.py assembles the atlas.
"""
import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '/tmp/head'
BUCKETS = [int(v) for v in argv[1].split(',')] if len(argv) > 1 and argv[1] else list(range(32))
SAMPLES = int(argv[2]) if len(argv) > 2 else 48
os.makedirs(OUT, exist_ok=True)

# silhouette traced on the photo, outer fur edge, u = across the head (+ = jaw side), x forward (R units)
T_X = [-1.9, -0.29, 0.40, 0.96, 1.55, 2.05, 2.24, 2.33]
T_U = [-1.14, -1.14, -1.02, -0.80, -0.30, 0.35, 0.83, 1.25]
B_X = [-1.9, -1.18, -0.64, 0.60, 1.38, 1.86, 2.19, 2.33]
B_U = [1.20, 1.24, 1.62, 1.86, 2.00, 1.81, 1.33, 1.25]
FUR = 0.46           # fur length beyond the skin (body fur reaches ~0.58 R)
EYE = (0.36, 0.42)   # eye centre (x, u)
EYE_R = 0.27
CELL = (281, 296)    # px; origin (113, 148); 64 px per R
ORIGIN = (113, 148)
PX_R = 64
SS = 2               # supersampling
LIGHT = (-0.4194, -0.5792, 0.6990)   # engine light_screen (x right, y down, z to viewer)


def interp(x, xs, ys):
    if x <= xs[0]:
        return ys[0]
    for i in range(1, len(xs)):
        if x <= xs[i]:
            t = (x - xs[i - 1]) / (xs[i] - xs[i - 1])
            return ys[i - 1] + (ys[i] - ys[i - 1]) * t
    return ys[-1]


def section(x):
    """skin cross-section at x: centre (blender Y), half-height a (in the image plane), half-depth c (to camera)."""
    top = interp(x, T_X, T_U) + FUR          # brow edge, u
    bot = interp(x, B_X, B_U) - FUR          # jaw edge, u
    a = max(0.0, (bot - top) / 2)
    uc = (bot + top) / 2
    # cell image y = -u (eye side +y); blender Y = -image y = u
    return uc, a, min(a, 1.05)


def build_head():
    bm = bmesh.new()
    NX, NT = 90, 56
    x0, x1 = -2.3, max(T_X[-1], B_X[-1]) - FUR + 0.02
    rings = []
    for i in range(NX + 1):
        x = x0 + (x1 - x0) * i / NX
        uc, a, c = section(max(x, -0.6))
        if x < -0.3:      # back of the head melts into a round neck tube of the body radius (smooth, no ridge)
            t = min(1.0, (-0.3 - x) / 1.1)
            t = t * t * (3 - 2 * t)
            uc, a, c = uc * (1 - t), a + (1.0 - a) * t, c + (1.0 - c) * t
        # round the snout: the last ~0.35 R closes like a dome
        tipd = x1 - x
        if tipd < 0.35:
            k = math.sqrt(max(0.0, 1 - ((0.35 - tipd) / 0.35) ** 2))
            a *= k; c *= k
        ring = []
        for j in range(NT):
            t = 2 * math.pi * j / NT
            ring.append(bm.verts.new((x, uc + a * math.cos(t), c * math.sin(t))))
        rings.append(ring)
    for i in range(NX):
        for j in range(NT):
            a, b = rings[i][j], rings[i][(j + 1) % NT]
            c, d = rings[i + 1][(j + 1) % NT], rings[i + 1][j]
            bm.faces.new((a, b, c, d))
    tip = bm.verts.new((x1 + 0.01, section(x1 - 0.2)[0], 0))
    for j in range(NT):
        bm.faces.new((rings[-1][j], rings[-1][(j + 1) % NT], tip))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new('head')
    bm.to_mesh(me)
    ob = bpy.data.objects.new('head', me)
    bpy.context.scene.collection.objects.link(ob)
    for p in me.polygons:
        p.use_smooth = True
    return ob


def eye_point():
    x, u = EYE
    uc, a, c = section(x)
    s = (u - uc) / a if a else 0
    z = c * math.sqrt(max(0.0, 1 - s * s))
    return Vector((x, u, z))


def materials(head):
    skin = bpy.data.materials.new('skin')
    skin.use_nodes = True
    bsdf = skin.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0.62, 0.25, 0.33, 1)
    bsdf.inputs['Roughness'].default_value = 0.9
    head.data.materials.append(skin)
    fur = bpy.data.materials.new('fur')
    fur.use_nodes = True
    nt = fur.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    hair = nt.nodes.new('ShaderNodeBsdfHairPrincipled')
    hair.parametrization = 'COLOR'
    hair.inputs['Color'].default_value = (0.78, 0.36, 0.46, 1)
    hair.inputs['Roughness'].default_value = 0.42
    if 'Random Color' in hair.inputs: hair.inputs['Random Color'].default_value = 0.25
    hair.inputs['Radial Roughness'].default_value = 0.7
    hair.inputs['Coat'].default_value = 0.0
    nt.links.new(hair.outputs[0], out.inputs['Surface'])
    head.data.materials.append(fur)
    return fur


def fur_system(head):
    # no fur on the eye bead: density weight 0 around it
    vg = head.vertex_groups.new(name='density')
    e = eye_point()
    for v in head.data.vertices:
        d = (v.co - e).length
        w = max(0.0, min(1.0, (d - EYE_R * 1.05) / 0.12))
        vg.add([v.index], w, 'REPLACE')
    mod = head.modifiers.new('fur', 'PARTICLE_SYSTEM')
    ps = mod.particle_system
    ps.vertex_group_density = 'density'
    st = ps.settings
    st.type = 'HAIR'
    st.count = 11000
    st.hair_length = FUR * 1.3
    st.use_advanced_hair = False        # simple mode: hair_length is the strand length, along the normal
    st.emit_from = 'FACE'
    st.use_even_distribution = True
    st.child_type = 'INTERPOLATED'
    st.rendered_child_count = 7
    st.child_length = 1.0
    st.child_length_threshold = 0.25
    st.clump_factor = 0.55
    st.clump_shape = -0.45
    st.roughness_1 = 0.12
    st.roughness_endpoint = 0.16
    st.roughness_2 = 0.10
    st.kink = 'NO'
    st.material = 2
    st.root_radius = 1.0
    st.tip_radius = 0.0
    st.radius_scale = 0.045
    st.display_step = 3
    st.render_step = 4


def eye_bead():
    bpy.ops.mesh.primitive_uv_sphere_add(radius=EYE_R, location=eye_point(), segments=48, ring_count=24)
    ob = bpy.context.active_object
    for p in ob.data.polygons:
        p.use_smooth = True
    m = bpy.data.materials.new('bead')
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.002, 0.002, 0.003, 1)
    b.inputs['Roughness'].default_value = 0.04
    b.inputs['Specular IOR Level'].default_value = 0.8
    ob.data.materials.append(m)
    return ob


def scene():
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = False   # the Ubuntu build has no OIDN; more samples instead
    sc.render.film_transparent = True
    sc.render.resolution_x = CELL[0] * SS
    sc.render.resolution_y = CELL[1] * SS
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'Standard'
    sc.cycles.curve_shape = 'THICK' if hasattr(sc.cycles, 'curve_shape') else None
    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    cam.ortho_scale = max(CELL) / PX_R
    co = bpy.data.objects.new('cam', cam)
    sc.collection.objects.link(co)
    sc.camera = co
    # image centre in cell coords -> blender (x, -y)
    cx = (CELL[0] / 2 - ORIGIN[0]) / PX_R
    cy = (CELL[1] / 2 - ORIGIN[1]) / PX_R
    co.location = (cx, -cy, 20)
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.95, 0.85, 0.87, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.45
    sc.world = world
    sun = bpy.data.lights.new('key', 'SUN')
    sun.energy = 3.2
    sun.angle = math.radians(14)
    so = bpy.data.objects.new('key', sun)
    sc.collection.objects.link(so)
    return sc, so


def main():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    sc, sun = scene()
    head = build_head()
    materials(head)
    fur_system(head)
    eye_bead()
    for b in BUCKETS:
        th = b / 32 * 2 * math.pi
        lx = math.cos(th) * LIGHT[0] + math.sin(th) * LIGHT[1]
        ly = -math.sin(th) * LIGHT[0] + math.cos(th) * LIGHT[1]
        d = Vector((lx, -ly, LIGHT[2])).normalized()
        sun.rotation_mode = 'QUATERNION'
        sun.rotation_quaternion = d.to_track_quat('Z', 'Y')
        sc.render.filepath = os.path.join(OUT, 'head_%02d.png' % b)
        bpy.ops.render.render(write_still=True)
        print('rendered', b, flush=True)


main()
