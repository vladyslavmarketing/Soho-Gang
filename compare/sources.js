/* What the compare pages load. Until the Blender export lands, B builds a placeholder model and A plays
   a placeholder clip rendered from it. When blender/export/ exists: exportBase '../blender/export/',
   clipA '../blender/export/clipA/<file>.webm', placeholder false, manifest = the export's manifest.json. */
window.SNAKE_SOURCES = {
  exportBase: null,
  manifest: null,
  clipA: 'placeholder/clipA.webm',
  clipAPoster: 'placeholder/clipA_000.png',
  placeholder: true
};
