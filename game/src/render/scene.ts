// Static scene (iso): painted background sprite + optional procedural roads; depot/decor returned as y-sortable things; site pads.
import { Container, Graphics, Sprite } from 'pixi.js';
import type { CityMap, SiteSpot, SiteType } from '../sim/types.ts';
import { art, INK, realSprite, realTex, type RealKey } from './assets.ts';
import { iso, isoRect, ISO_W, ISO_H } from './iso.ts';

export const GROUND = 0xc4b89c;
/** Fallback: draw the procedural ground/roads over the painted background (if its painted roads drift from the graph). */
export const DRAW_ROADS = false;
let bgKey: RealKey = 'bg'; // painted background of the mounted city (set by buildStatic)
const ROAD_W = { main: 64, street: 42, sand: 36 } as const;

function drawRoads(g: Graphics, map: CityMap) {
  g.poly(isoRect(0, 0, map.width, map.height)).fill({ color: 0x9fb98a });
  const xs = [...new Set(map.nodes.map((n) => n.x))].sort((a, b) => a - b);
  const ys = [...new Set(map.nodes.map((n) => n.y))].sort((a, b) => a - b);
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
    const m = 16;
    g.poly(isoRect(xs[i] + m, ys[j] + m, xs[i + 1] - m, ys[j + 1] - m)).fill({ color: 0xd9d1bb }).stroke({ width: 3, color: 0xb9b19a });
  }
  const node = new Map(map.nodes.map((n) => [n.id, n]));
  const seg = (ax: number, ay: number, bx: number, by: number, w: number) => {
    const h = w / 2;
    return isoRect(Math.min(ax, bx) - h, Math.min(ay, by) - h, Math.max(ax, bx) + h, Math.max(ay, by) + h);
  };
  const dn = node.get(map.depotNodeId)!;
  g.poly(seg(map.depot.x, map.depot.y, dn.x, dn.y, 26)).fill({ color: 0x55606c });
  for (const e of map.edges) { const a = node.get(e.a)!, b = node.get(e.b)!; g.poly(seg(a.x, a.y, b.x, b.y, ROAD_W[e.kind])).fill({ color: e.kind === 'main' ? 0x3e434a : e.kind === 'sand' ? 0xd8bf8a : 0x4d535b }); }
  for (const e of map.edges) {
    if (e.kind !== 'main') continue;
    const a = node.get(e.a)!, b = node.get(e.b)!;
    const len = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    for (let d = 30; d + 26 < len - 30; d += 48) {
      const p = iso(a.x + ux * d, a.y + uy * d), q = iso(a.x + ux * (d + 26), a.y + uy * (d + 26));
      g.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ width: 3, color: 0xe8e4d8, alpha: 0.8 });
    }
  }
}

/** Ground layer (under everything) + depot/decor as separate containers for the y-sorted dynamic layer. */
export function buildStatic(map: CityMap): { ground: Container; things: Container[] } {
  const ground = new Container();
  bgKey = (map.bg ?? 'bg') as RealKey;
  const t = realTex(bgKey);
  if (t) { const bg = new Sprite(t); bg.width = ISO_W; bg.height = ISO_H; bg.tint = 0xd9d9d9; ground.addChild(bg); } // any pixel size, stretched; dimmed ~15% so actors pop
  else { const g = new Graphics(); g.rect(0, 0, ISO_W, ISO_H).fill({ color: GROUND }); ground.addChild(g); }
  if (DRAW_ROADS || !t) { const g = new Graphics(); drawRoads(g, map); ground.addChild(g); }

  const things: Container[] = [];
  const dp = iso(map.depot.x, map.depot.y + 40);
  const prop = realSprite('prop-depot', 0.5, 0.85, { w: 300 });
  const dep = new Container(); dep.addChild(prop ?? art('depot')); dep.position.set(dp.x, dp.y); dep.zIndex = dp.y; things.push(dep);
  for (const d of map.decor) {
    const p = iso(d.x, d.y);
    const a = art(d.key, d.scale ?? 1); a.position.set(p.x, p.y); a.zIndex = p.y; things.push(a);
  }
  return { ground, things };
}

/** World-space rect (cx, cy, w, h) + projected container. */
export interface Pad { c: Container; w: number; h: number; cx: number; cy: number; x0: number; y0: number; x1: number; y1: number }

/** Pad under a site's cabin slots (construction yard / wedding lawn), projected to an iso diamond. */
export function buildPad(spot: SiteSpot, type: SiteType, node?: { x: number; y: number }): Pad {
  const xs = [spot.x, ...spot.slots.map((s) => s.x)], ys = [Math.min(...spot.slots.map((s) => s.y)) - 120, ...spot.slots.map((s) => s.y)];
  const x0 = Math.min(...xs) - 20, x1 = Math.max(...xs) + 20, y0 = Math.min(...ys), y1 = Math.max(...ys) + 28;
  const w = x1 - x0, h = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const c = new Container();
  const g = new Graphics(); c.addChild(g);
  if (node && DRAW_ROADS) {
    const hw = 13;
    g.poly(isoRect(Math.min(spot.x, node.x) - hw, Math.min(spot.y, node.y) - hw, Math.max(spot.x, node.x) + hw, Math.max(spot.y, node.y) + hw)).fill({ color: 0x55606c });
  }
  const con = type === 'construction';
  g.poly(isoRect(x0, y0, x1, y1)).fill({ color: con ? 0xb7956a : 0xcfe8a8, alpha: con ? 0.25 : 0.35 }).stroke({ width: 3, color: con ? 0x6b5233 : 0xffffff, alpha: 0.7 });
  // border dots: hazard (construction) / bunting (wedding), projected along the rect edges
  const per = 2 * (w + h), step = 26;
  for (let d = 0; d < per; d += step) {
    let x: number, y: number;
    if (d < w) { x = x0 + d; y = y0; } else if (d < w + h) { x = x1; y = y0 + d - w; } else if (d < 2 * w + h) { x = x1 - (d - w - h); y = y1; } else { x = x0; y = y1 - (d - 2 * w - h); }
    const p = iso(x, y);
    if (con) g.ellipse(p.x, p.y, 5, 3).fill({ color: (d / step) % 2 ? 0xffc83d : INK });
    else g.ellipse(p.x, p.y, 5, 3).fill({ color: [0xf48fb1, 0xffffff, 0x7fd0ff][(d / step) % 3 | 0] });
  }
  const back = iso(cx, y0 + 50);
  const painted = !!realTex(bgKey); // construction lots are painted into the background
  const prop = con ? null : (type === 'beach' && realSprite('prop-beach', 0.5, 0.85, { w: 220 })) || realSprite('prop-wedding', 0.5, 0.85, { w: 200 });
  if (prop) { prop.position.set(back.x, back.y); c.addChild(prop); }
  else if (con) {
    if (painted) return { c, w, h, cx, cy, x0, y0, x1, y1 };
    const cp = iso(x1 - 28, y0 + 70); const crane = art('crane'); crane.position.set(cp.x, cp.y); c.addChild(crane);
  } else {
    const ap = iso(spot.x, y0 + 80); const arch = art('wedding-arch'); arch.position.set(ap.x, ap.y); c.addChild(arch);
    for (const dx of [-70, 70]) { const tp = iso(spot.x + dx, y0 + 80); const t = art('wedding-table'); t.position.set(tp.x, tp.y); c.addChild(t); }
  }
  return { c, w, h, cx, cy, x0, y0, x1, y1 };
}
