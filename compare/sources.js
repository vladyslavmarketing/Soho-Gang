/* What the compare pages load: the Blender export (blender/export/, contract in its manifest.json)
   and clip A rendered in Cycles. Set exportBase null to fall back to the placeholder model and clip. */
window.SNAKE_SOURCES = {
  exportBase: '../blender/export/',
  clipA: '../blender/export/clipA/snake_idle.webm',
  clipAPoster: null,
  fps: 30,
  placeholder: false,
  // B fur / light matched to clip A frame by frame (compare/tools/montage.py)
  bTuning: { furLength: 0.2, shells: 36, exposure: 0.75, gravity: 0.1, cover: 0.55, sheenAmount: 0.5, eyeScale: 1.6 }
};
