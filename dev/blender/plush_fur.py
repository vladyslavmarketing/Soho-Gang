"""plush_fur.py - Blender helpers for the ae studio plush snake: Cycles scene setup, fur materials and the numpy
strand groomer (hair curves with per-point colour), shared by the head renderer (head_v3.py).

Same look as the body atlas (assets/img/snake/body.webp): Principled Hair (Chiang) mixed with a soft diffuse lobe per
strand ('dm' curve attribute), root -> mid -> tip colour ramps per palette, clumped / frizzed / flow-combed strands.
Units: 1 Blender unit = 1 body radius R. Runs inside Blender 4.2 (bpy + numpy + mathutils only).
"""
import math

import bpy
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree

# Body atlas palettes (sRGB hex, root -> mid -> tip + skin backing), as rendered for body.webp ('pink' row).
PAL = {
    'pink': dict(root='#8E1034', mid='#C8406A', tip='#EE90A8', skin='#7E0E30'),
}
MIDPOS = 0.42           # where the 'mid' colour sits along a strand (0 root .. 1 tip)

# Body fur parameters of the body atlas (pink rows); the head starts from these.
BODY_FUR = dict(dens=3500, len=(0.3, 0.52), lean=1.5, bend=0.6, clump=0.5, cs=1.2, gf=0.015, rough=0.06, frizz=0.006,
                flow=0.3, flow_k=4.0, tipb=0.3, jit=0.12, K=7, rr=0.0065, rt=0.0012, dmix=0.7, hr=0.42, coat=0.0)


def hex2lin(h):
    h = h.lstrip('#')
    c = np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def smooth(a, b, x):
    t = np.clip((np.asarray(x, float) - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- scene
def reset(threads=4):
    """Empty scene, Cycles CPU + OIDN, the sprite-rig render settings of the body atlas."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.02
    sc.cycles.max_bounces = 5
    sc.cycles.diffuse_bounces = 3
    sc.cycles.glossy_bounces = 3
    sc.cycles.transmission_bounces = 4
    sc.cycles.transparent_max_bounces = 48
    sc.cycles.volume_bounces = 0
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False
    sc.cycles.blur_glossy = 1.0
    sc.cycles.pixel_filter_type = 'BLACKMAN_HARRIS'
    sc.cycles.filter_width = 1.5
    sc.cycles_curves.shape = 'RIBBONS'
    sc.cycles_curves.subdivisions = 2
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0
    sc.render.film_transparent = True
    sc.render.use_persistent_data = True
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.color_depth = '8'
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = threads
    return sc


def world(color_hex, strength):
    w = bpy.data.worlds.new('W')
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    c = hex2lin(color_hex)
    bg.inputs['Color'].default_value = (c[0], c[1], c[2], 1)
    bg.inputs['Strength'].default_value = strength
    return w


# ---------------------------------------------------------------- materials
def fur_material(name, rough=0.42, radial=0.6, coat=0.0):
    """Principled Hair (Chiang, colour from the 'col' point attribute) mixed with a diffuse lobe by the 'dm' curve
    attribute (plush fibres scatter softly)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    at = nt.nodes.new('ShaderNodeAttribute'); at.attribute_name = 'col'; at.attribute_type = 'GEOMETRY'
    hb = nt.nodes.new('ShaderNodeBsdfHairPrincipled'); hb.parametrization = 'COLOR'; hb.model = 'CHIANG'
    nt.links.new(at.outputs['Color'], hb.inputs['Color'])
    hb.inputs['Roughness'].default_value = rough
    hb.inputs['Radial Roughness'].default_value = radial
    hb.inputs['Coat'].default_value = coat
    hb.inputs['IOR'].default_value = 1.55
    hb.inputs['Random Roughness'].default_value = 0.25
    df = nt.nodes.new('ShaderNodeBsdfDiffuse'); df.inputs['Roughness'].default_value = 1.0
    nt.links.new(at.outputs['Color'], df.inputs['Color'])
    mx = nt.nodes.new('ShaderNodeMixShader')
    dm = nt.nodes.new('ShaderNodeAttribute'); dm.attribute_name = 'dm'; dm.attribute_type = 'GEOMETRY'
    nt.links.new(dm.outputs['Fac'], mx.inputs['Fac'])
    nt.links.new(hb.outputs[0], mx.inputs[1])
    nt.links.new(df.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs['Surface'])
    return m


def skin_material(name):
    """Matte backing under the fur, colour from the 'col' point attribute."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    at = nt.nodes.new('ShaderNodeAttribute'); at.attribute_name = 'col'; at.attribute_type = 'GEOMETRY'
    df = nt.nodes.new('ShaderNodeBsdfDiffuse'); df.inputs['Roughness'].default_value = 1.0
    nt.links.new(at.outputs['Color'], df.inputs['Color'])
    nt.links.new(df.outputs[0], out.inputs['Surface'])
    return m


def bead_material(name, hex_color='#020101', rough=0.05, spec=0.5, coat=0.8, coat_rough=0.02, coat_ior=1.5):
    """Glossy black safety-eye bead (lacquered: base + clear coat)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    c = hex2lin(hex_color)
    p.inputs['Base Color'].default_value = (c[0], c[1], c[2], 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Specular IOR Level'].default_value = spec
    p.inputs['Coat Weight'].default_value = coat
    p.inputs['Coat Roughness'].default_value = coat_rough
    p.inputs['Coat IOR'].default_value = coat_ior
    return m


# ---------------------------------------------------------------- objects
def mesh_object(name, verts, faces, point_attrs=None, mats=()):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    for k, (dtype, arr) in (point_attrs or {}).items():
        a = me.attributes.new(k, dtype, 'POINT')
        if dtype == 'FLOAT_COLOR':
            a.data.foreach_set('color', np.asarray(arr, np.float32).reshape(-1))
        else:
            a.data.foreach_set('value', np.asarray(arr, np.float32).reshape(-1))
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def curves_object(name, pos, col, r_root, r_tip, mats, curve_attrs=None):
    """Hair curves object from strand points pos (n, K, 3) and colours col (n, K, 4, linear)."""
    n, K, _ = pos.shape
    cv = bpy.data.hair_curves.new(name)
    cv.add_curves([K] * n)
    cv.position_data.foreach_set('vector', pos.astype(np.float32).reshape(-1))
    s = np.linspace(0, 1, K)
    rad = np.broadcast_to(r_root * (1 - s) ** 0.8 + r_tip * s, (n, K)).astype(np.float32)
    a = cv.attributes.new('radius', 'FLOAT', 'POINT'); a.data.foreach_set('value', rad.reshape(-1))
    a = cv.attributes.new('col', 'FLOAT_COLOR', 'POINT'); a.data.foreach_set('color', col.astype(np.float32).reshape(-1))
    for k, arr in (curve_attrs or {}).items():
        a = cv.attributes.new(k, 'FLOAT', 'CURVE'); a.data.foreach_set('value', np.asarray(arr, np.float32))
    for m in mats:
        cv.materials.append(m)
    ob = bpy.data.objects.new(name, cv)
    bpy.context.collection.objects.link(ob)
    return ob


# ---------------------------------------------------------------- grooming
def strands(P, N, T, B, L, rng, K=7, lean=0.55, comb=None, bend=0.6, clump=0.55, clump_shape=1.4, guide_frac=0.015,
            rough=0.05, frizz=0.03, flow=0.0, flow_k=2.5):
    """Strand points (n, K, 3) grown from roots P with normals N and tangent frame (T, B).
    L: per-strand length. lean: random lean magnitude (tangent plane; scalar or per strand). comb: (n, 3) systematic lean (tangent plane).
    flow: share of the lean that follows a smooth random vector field (coherent locks). clump: tips pulled toward
    guide strands (tufts). rough / frizz: smooth wander / per-point jitter, relative to L."""
    n = len(P)
    if flow > 0:
        fv = np.zeros((n, 3))
        for _ in range(6):
            kv = rng.normal(0, 1, 3); kv *= flow_k * rng.uniform(0.6, 1.4) / np.linalg.norm(kv)
            av = rng.normal(0, 1, 3); ph = rng.uniform(0, 2 * np.pi)
            fv += np.sin(P @ kv + ph)[:, None] * av[None]
        fv -= N * np.sum(fv * N, axis=1)[:, None]
        fl = np.linalg.norm(fv, axis=1)[:, None] + 1e-6
        fv = fv / fl * np.clip(fl / 1.2, 0.35, 1.0)
        a = rng.random(n) * 2 * np.pi; mag = np.abs(rng.normal(0, lean * (1 - flow) + 1e-6, n))
        lv = fv * (lean[:, None] if np.ndim(lean) else lean) * flow + (np.cos(a) * mag)[:, None] * T + (np.sin(a) * mag)[:, None] * B
    else:
        a = rng.random(n) * 2 * np.pi; mag = np.abs(rng.normal(0, lean, n))
        lv = (np.cos(a) * mag)[:, None] * T + (np.sin(a) * mag)[:, None] * B
    if comb is not None:
        lv = lv + comb
    s = np.linspace(0, 1, K)
    pos = np.zeros((n, K, 3)); pos[:, 0] = P
    for k in range(1, K):
        sm = 0.5 * (s[k] + s[k - 1])
        d = N + lv * (1 + bend * sm); d /= np.linalg.norm(d, axis=1)[:, None]
        pos[:, k] = pos[:, k - 1] + d * (L / (K - 1))[:, None]
    if clump > 0:   # guides = strands nearest to random centres; tips pulled toward their guide
        gi = rng.choice(n, size=max(1, int(n * guide_frac)), replace=False)
        kd = KDTree(len(gi))
        for j, g in enumerate(gi):
            kd.insert(Vector(P[g]), j)
        kd.balance()
        near = np.empty(n, dtype=np.int64)
        for i in range(n):
            near[i] = gi[kd.find(Vector(P[i]))[1]]
        G = pos[near]
        cs = rng.uniform(0.6, 1.0, n)[:, None] * clump
        w = (s ** clump_shape)[None, :] * cs
        pos = pos + w[:, :, None] * (G - pos) * 0.9
    wv = rng.normal(0, 1, (n, 3)); wv -= N * np.sum(wv * N, axis=1)[:, None]
    pos += (s ** 1.5)[None, :, None] * wv[:, None, :] * (rough * L)[:, None, None]
    fz = rng.normal(0, 1, (n, K, 3)) * frizz * L[:, None, None]; fz[:, 0] = 0
    pos += fz * s[None, :, None]
    return pos


def strand_colors(n, K, rng, pal_weights, jitter=0.12, tip_boost=0.0):
    """pal_weights: [(palette name, weights (n,))], weights summing to 1. Returns (n, K, 4) linear RGBA."""
    s = np.linspace(0, 1, K)
    col = np.zeros((n, K, 3))
    for name, w in pal_weights:
        p = PAL[name]
        ro, mi, ti = hex2lin(p['root']), hex2lin(p['mid']), hex2lin(p['tip'])
        c = np.where((s < MIDPOS)[:, None], ro[None] + (mi - ro)[None] * (s / MIDPOS)[:, None],
                     mi[None] + (ti - mi)[None] * ((s - MIDPOS) / (1 - MIDPOS))[:, None])
        col += np.asarray(w, float)[:, None, None] * c[None]
    col *= (1 + rng.uniform(-jitter, jitter, n))[:, None, None]
    if tip_boost:
        col = col + (1 - col) * (tip_boost * rng.random(n))[:, None, None] * (s ** 2)[None, :, None]
    return np.concatenate([np.clip(col, 0, 1), np.ones((n, K, 1))], axis=2)


def tangent_frame(N, direction):
    """Unit tangent (direction projected on the tangent plane) and bitangent at roots with normals N."""
    t = direction - N * np.sum(direction * N, axis=1)[:, None]
    tl = np.linalg.norm(t, axis=1)[:, None]
    fb = np.cross(N, np.array([0, 0, 1.0]))
    fb /= np.maximum(np.linalg.norm(fb, axis=1)[:, None], 1e-9)
    t = np.where(tl > 1e-6, t / np.maximum(tl, 1e-9), fb)
    return t, np.cross(N, t)
