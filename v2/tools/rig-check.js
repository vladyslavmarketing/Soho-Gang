// Numeric checks of the rig over every storyboard scene (no rendering):
// segment length error, min distance between non-adjacent nodes (self-intersection), max per-frame jump / jerk.
global.window = global; require('../assets/js/snake3d.js');
const S3 = window.SohoSnake3D, N = S3.N, SEG = S3.SEG, dt = 1 / 60;
const rows = [];
for (const sc of S3.Scenes) {
  const rig = new S3.Rig(); rig.setState(sc, { snap: true });
  let lenErr = 0, minGap = 1e9, maxV = 0, maxA = 0, prev = null, prevV = null, hp = null, hv = null, maxHA = 0;
  const T = sc.dur + 0.3;
  for (let f = 0; f * dt < T; f++) {
    rig.update(dt);
    const Q = rig.Q;
    for (let i = 1; i < N; i++) {
      const d = Math.hypot(Q[i*3]-Q[i*3-3], Q[i*3+1]-Q[i*3-2], Q[i*3+2]-Q[i*3-1]);
      lenErr = Math.max(lenErr, Math.abs(d - SEG) / SEG);
    }
    for (let i = 0; i < N; i++) for (let j = i + 6; j < N; j++) {
      const d = Math.hypot(Q[j*3]-Q[i*3], Q[j*3+1]-Q[i*3+1], Q[j*3+2]-Q[i*3+2]) - S3.radius(i*SEG) - S3.radius(j*SEG);
      if (d < minGap) minGap = d;
    }
    // head velocity / acceleration in D/s, D/s^2
    const H = rig.head.pos.slice();
    if (hp) { const v = [(H[0]-hp[0])/dt, (H[1]-hp[1])/dt, (H[2]-hp[2])/dt]; if (hv) maxHA = Math.max(maxHA, Math.hypot(v[0]-hv[0], v[1]-hv[1], v[2]-hv[2]) / dt); hv = v; }
    hp = H;
  }
  rows.push({ scene: sc.id, lenErrPct: +(lenErr * 100).toFixed(2), minGapD: +minGap.toFixed(3), headAccMax: Math.round(maxHA) });
}
console.table(rows);
