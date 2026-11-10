"""
ae studio - shot J1 "journey" (docs/snake3d-journey.md, update 2026-11-10 final): she crawls down the right edge.

    blender -b --factory-startup --python blender/snake_journey.py                  # bake
    blender -b --factory-startup --python blender/snake_journey.py -- --animatic    # + animatic MP4
    options: --shutter 1.0 (subframe keys for motion blur)

Scene: renders/snake_j1.blend = snake_scene.py --uniform-rings 1.325 (evenly spaced rings; the photo's irregular
ring spacing, 1.0-3.1 D, would jump at every loop seam). CamJourney: orthographic, top-down over the floor, frame
480 x 3120 master px (3.08 D x 20 D, 156 px/D; clips render 320 x 2080), centreline at x = 1.54 D.
The hero lights and an invisible pink bounce floor ride with the camera, so the lighting is the same on every
loop. No shadows.
One clip, three segments (30 fps, 0-based):
    in    frame 0 empty; she comes in through the right edge at 22 % of the frame height heading left, turns down
          (radius 1 D) and crawls down at the loop speed; the camera eases into tracking so the turn and the
          amplitude ramp leave the frame through the top before the loop begins; the head reaches cruiseY.
    loop  60 frames, seamless: the camera travels 2 lambda; lambda is chosen so the arc length of 2 lambda is
          exactly 9 ring periods (9 x 1.325 D), so wave and rings both repeat (frame F_L + 60 = frame F_L).
    out   starts from the loop's first pose, camera still; she goes on to the next crest, turns right (radius 1 D)
          and leaves through the right edge, accelerating, until the tail has left (last frame empty).
Roll: dorsal up everywhere (the path is planar); twist / dorsal asserts as in snake_path.
"""
import bpy, math, os, sys, json
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import snake_path as sp
from snake_path import log, sstep, arg, argv

FW, FH = 480 / 156, 3120 / 156                      # frame in D
sp.W_PX, sp.H_PX = 320, 2080                         # clip px (100 %)
RING_P, N_RINGS = 1.325, 9
AMP, R_TURN = 0.55, 1.0
Y_ENTRY = FH / 2 - 0.22 * FH                         # camera at y = 0: 22 % below the top edge
LOOP_N, OUT_N, CRUISE = 60, 96, 12.0
X_EDGE = FW / 2


def wave_len(lam, n=4000):
    y = np.linspace(0, lam, n)
    k = 2 * math.pi / lam
    return float(np.trapz(np.sqrt(1 + (AMP * k * np.cos(k * y)) ** 2), y))


def solve_lambda():
    target = N_RINGS * RING_P / 2
    lo, hi = 4.0, 7.0
    for _ in range(60):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if wave_len(mid) < target else (lo, mid)
    return (lo + hi) / 2


def build_set(rest):
    """CamJourney + the hero lights and a bounce floor parented to it (offsets relative to the hero letters)"""
    sc, fz = rest.sc, rest.floor
    cd = bpy.data.cameras.new('CamJourney')
    cd.type, cd.ortho_scale, cd.sensor_fit, cd.clip_end = 'ORTHO', FH, 'VERTICAL', 80
    cam = bpy.data.objects.new('CamJourney', cd)
    cam.location = (0, 0, fz + 40)
    sc.collection.objects.link(cam)
    sc.camera = cam
    rest.cam = cam
    mid = Vector(rest.rest.mean(0).tolist())
    mid.z = fz
    bpy.context.view_layer.update()
    for ob in list(bpy.data.objects):
        if ob.type == 'LIGHT':
            ob.location = Vector((0, 0, fz)) + (ob.location - mid)
            ob.parent = cam
            ob.matrix_parent_inverse = cam.matrix_world.inverted()
    sw = bpy.data.objects.get('Sweep')
    if sw:
        bpy.data.objects.remove(sw, do_unlink=True)
    me = bpy.data.meshes.new('JFloor')
    me.from_pydata([(-30, -30, 0), (30, -30, 0), (30, 30, 0), (-30, 30, 0)], [], [(0, 1, 2, 3)])
    fl = bpy.data.objects.new('JFloor', me)
    fl.location = (0, 0, fz)
    sc.collection.objects.link(fl)
    m = bpy.data.materials.new('JFloor')
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.78, 0.55, 0.58, 1)
    me.materials.append(m)
    fl.visible_camera = False
    fl.visible_shadow = False
    fl.parent = cam
    fl.matrix_parent_inverse = cam.matrix_world.inverted()
    sc.render.resolution_x, sc.render.resolution_y = sp.W_PX, sp.H_PX
    return cam


def make_trail(rest, P):
    Q = sp.resample(np.c_[P, np.zeros(len(P))], 0.04)
    n = len(Q)
    tr = sp.Trail(Q[:, :2], np.full(n, rest.floor + 0.45), np.full(n, rest.floor), np.ones(n))
    tr.N = sp.up_normals(sp.tangents(tr.X))
    tr.g = np.ones(n)
    return tr


def main():
    rest = sp.Rest(os.path.join(sp.RENDERS_DIR, 'snake_j1.blend'))
    cam = build_set(rest)
    lam = solve_lambda()
    v_cam = 2 * lam / LOOP_N                           # D per frame
    v_s = N_RINGS * RING_P / LOOP_N
    log('journey: lambda %.4f D (arc of 2 lambda %.4f = %d x %.3f), camera %.4f D/frame, head %.4f D/frame' % (
        lam, 2 * wave_len(lam), N_RINGS, RING_P, v_cam, v_s))
    # ---- in + loop trail: entry line (heading -x) -> quarter turn -> wave down
    ex = np.arange(R_TURN + rest.L + 8, R_TURN, -0.01)
    entry = np.c_[ex, np.full(len(ex), Y_ENTRY)]
    a = np.linspace(math.pi / 2, math.pi, 160)
    turn = np.c_[R_TURN + R_TURN * np.cos(a), Y_ENTRY - R_TURN + R_TURN * np.sin(a)]
    y_w = Y_ENTRY - R_TURN
    y = np.arange(y_w, -150, -0.01)
    wave = np.c_[AMP * sstep(0, 1.0, y_w - y) * np.sin(2 * math.pi * (y_w - y) / lam), y]
    tr = make_trail(rest, np.vstack([entry, turn[1:], wave[1:]]))
    on_entry = np.where((np.abs(tr.xy[:, 1] - Y_ENTRY) < 1e-6) & (tr.xy[:, 0] > R_TURN))[0]
    s_enter = float(tr.sig[on_entry[np.argmin(np.abs(tr.xy[on_entry, 0] - (X_EDGE + 0.8)))]])
    # ---- camera: still, then eases into tracking; at the loop start the turn + ramp are above the top edge
    y_clear = y_w - 1.0 - 0.7
    N_acc = int(math.ceil(-2 * (y_clear - FH / 2) / v_cam))
    Y_L = -v_cam * N_acc / 2
    head_y = Y_L + FH / 2 - CRUISE
    wv = np.where(tr.xy[:, 1] < y_w - 1e-6)[0]          # the wave part of the trail
    s_L = float(np.interp(-head_y, -tr.xy[wv, 1], tr.sig[wv]))
    F_L = int(math.ceil((s_L - s_enter) / v_s))
    s0 = s_L - F_L * v_s                               # constant head speed v_s from frame 0
    f_a = F_L - N_acc
    log('in: %d frames (camera eases into tracking over %d frames from frame %d); loop %d-%d' % (
        F_L, N_acc, f_a, F_L, F_L + LOOP_N - 1))

    def cam_y(f):
        if f <= f_a:
            return 0.0
        if f <= F_L:
            return -v_cam * (f - f_a) ** 2 / (2 * N_acc)
        if f < F_L + LOOP_N - 0.5:
            return Y_L - v_cam * (f - F_L)
        return Y_L                                     # out (and its leading subframe): camera still

    # ---- out trail: the same track to the head at s_L, on to the next crest, turn right, out
    iL = int(np.searchsorted(tr.sig, s_L))
    xs = tr.xy[iL:, 0]
    crest = iL + 1 + int(np.argmax((np.diff(xs) <= 0) & (xs[1:] > AMP * 0.95)))
    cx, cy = tr.xy[crest]
    a = np.linspace(math.pi, 1.5 * math.pi, 160)
    turn2 = np.c_[cx + R_TURN + R_TURN * np.cos(a), cy + R_TURN * np.sin(a)]
    lx = np.arange(turn2[-1, 0], X_EDGE + rest.L + 6, 0.01)
    tr_out = make_trail(rest, np.vstack([tr.xy[:crest + 1], turn2[1:], np.c_[lx, np.full(len(lx), turn2[-1, 1])][1:]]))
    cam.location.y = Y_L
    bpy.context.view_layer.update()                      # the camera matrix must follow before projecting
    s_out_end = next(sh + 0.1 for sh in np.arange(s_L + rest.L * 0.5, tr_out.sig[-1], 0.1)
                     if sp.offscreen(rest, *tr_out.window(rest, sh)[:2]))
    D_out = s_out_end - s_L
    ramp = 30
    v_max = (D_out - v_s * (OUT_N - 1)) / ((OUT_N - 1) - ramp / 2) + v_s
    log('out: %d frames, head travels %.1f D, %.3f -> %.3f D/frame' % (OUT_N, D_out, v_s, v_max))

    def out_s(g):                                      # g = frame within out (0 = the loop's first pose)
        if g <= ramp:
            return s_L + v_s * g + (v_max - v_s) * g * g / (2 * ramp)
        return s_L + v_s * g + (v_max - v_s) * (g - ramp / 2)

    NF = F_L + LOOP_N + OUT_N

    def state(t):
        """in + loop on the loop trail; out (from its leading subframe on) restarts at the loop's first pose.
        Subframe keys must not straddle that jump: J1 uses a shutter <= 0.5 (keys at f -+ 0.25)."""
        f = t * sp.FPS
        if f < F_L + LOOP_N - 0.5:
            return tr, s0 + v_s * f
        return tr_out, out_s(f - (F_L + LOOP_N))

    for f, lab in ((0, 'first'), (NF - 1, 'last')):
        cam.location.y = cam_y(f)
        bpy.context.view_layer.update()
        trt, sh = state(f / sp.FPS)
        P, cum, ss = trt.window(rest, sh)
        log('journey %s frame %d empty (centre line test): %s' % (lab, f, sp.offscreen(rest, P, cum, margin=sp.OFF_MARGIN_PX)))
    shutter = min(float(arg('--shutter', 0.0)), 0.5)
    Ms, extra = sp.bake_clip(rest, 'journey', state, NF, shutter)
    # seam: the loop end (frame F_L + 60 on the loop trail) shifted by the camera travel vs the loop start
    P1 = tr.window(rest, s0 + v_s * (F_L + LOOP_N))[0]
    P0 = tr.window(rest, s0 + v_s * F_L)[0]
    n = min(len(P0), len(P1))
    vis = np.abs(P0[:n, 1] - Y_L) < FH / 2 + 1
    dy = cam_y(F_L + LOOP_N) - cam_y(F_L)
    log('loop seam: centre line in view differs by %.4f D after the camera shift' % float(
        np.abs(P1[:n] - P0[:n] - np.array([0, dy, 0]))[vis].max()))
    # camera keys (frames and subframes), linear
    bpy.context.preferences.edit.keyframe_new_interpolation_type = 'LINEAR'
    for fr, t in sp.sample_times(NF, shutter):
        cam.location.y = cam_y(t * sp.FPS)
        cam.keyframe_insert('location', index=1, frame=fr)
    rest.sc.frame_set(F_L + 1)
    nose = rest.arm.matrix_world @ rest.arm.pose.bones['Head'].head
    info = {'frames': NF, 'segments': {'in': [0, F_L], 'loop': [F_L, F_L + LOOP_N], 'out': [F_L + LOOP_N, NF]},
            'cruiseY': round(float((cam_y(F_L) + FH / 2 - nose.y) * 156)),
            'bodyRight': round(float((FW / 2 + AMP + 0.5) * 156)),
            'lambda': lam, 'v_cam': v_cam, 'v_head': v_s, 'roll': extra['roll'], 'min_gap': extra['min_gap']}
    json.dump(info, open(os.path.join(sp.RENDERS_DIR, 'journey_info.json'), 'w'), indent=1)
    log('journey info', info)
    rest.sc.frame_start, rest.sc.frame_end = 1, NF
    rest.sc.frame_set(1)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(sp.RENDERS_DIR, 'journey.blend'), compress=False)
    if '--animatic' in argv:
        sp.animatic('journey', NF, '#F1D6DA', catcher=None, pct=50)


if __name__ == '__main__':
    main()
    log('done')
