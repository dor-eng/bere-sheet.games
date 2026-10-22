// Isometric projection, render only. World = sim px (1000 x 1600, y down); screen = projected canvas px (2600 x 1733).
export const ISO_W = 2600, ISO_H = 1733;
const OX = 1600, OY = 216;
export const iso = (x: number, y: number) => ({ x: (x - y) + OX, y: (x + y) / 2 + OY });
export const unIso = (sx: number, sy: number) => { const a = sx - OX, b = (sy - OY) * 2; return { x: (a + b) / 2, y: (b - a) / 2 }; };
/** world axis-aligned rect -> projected quad (flat array for Graphics.poly) */
export const isoRect = (x0: number, y0: number, x1: number, y1: number) =>
  [iso(x0, y0), iso(x1, y0), iso(x1, y1), iso(x0, y1)].flatMap((p) => [p.x, p.y]);
