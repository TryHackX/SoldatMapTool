import type { EditorToolId } from './types';

// Classic Solid Unicode values shared by Font Awesome's web releases.
export const toolGlyphs: Record<EditorToolId, number> = {
  climb_tunnel: 0xf6fc,
  select: 0xf245, lasso: 0xf8c8, vertex: 0xf5ee, poly_tri: 0xf2ec, poly_strip: 0xf7a4,
  poly_fan: 0xf542, poly_shape: 0xf61f, poly_laser: 0xe2ca, color_brush: 0xf1fc, light: 0xf185,
  uv: 0xf00a, scenery: 0xf03e, spawn: 0xf024, collider: 0xf192, waypoint: 0xf544, ruler: 0xf545, playtest: 0xf11b,
};

export async function loadToolIcons() {
  try {
    const face = await new FontFace('StudioIcons', 'url(/api/admin/font) format("woff2")').load();
    document.fonts.add(face);
    document.documentElement.classList.add('studio-icons-loaded');
  } catch { /* Use the bundled Lucide icons if the local font cannot be loaded. */ }
}
