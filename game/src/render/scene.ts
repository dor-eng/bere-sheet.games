// Static scene: ground, blocks, roads, depot, decor (one container, built once, never touched per frame) + site pads.
import { Container, Graphics } from 'pixi.js';
import type { CityMap, SiteSpot, SiteType } from '../sim/types.ts';
import { art, INK } from './assets.ts';

export const GROUND = 0x9fdc86;
const ROAD_W = { main: 64, street: 42 } as const;

export function buildStatic(map: CityMap): Container {
  const root = new Container();
  const g = new Graphics();
  root.addChild(g);
  g.rect(-400, -400, map.width + 800, map.height + 800).fill({ color: 0x86c96f }); // beyond-map border
  g.rect(0, 0, map.width, map.height).fill({ color: GROUND });
  for (let y = 0; y < map.height; y += 160) g.rect(0, y, map.width, 80).fill({ color: 0xa6e08d }); // lawn stripes
  g.rect(0, 0, map.width, map.height).stroke({ width: 8, color: INK });

  // blocks between grid lines
  const xs = [...new Set(map.nodes.map((n) => n.x))].sort((a, b) => a - b);
  const ys = [...new Set(map.nodes.map((n) => n.y))].sort((a, b) => a - b);
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
    const m = 16;
    g.roundRect(xs[i] + m, ys[j] + m, xs[i + 1] - xs[i] - 2 * m, ys[j + 1] - ys[j] - 2 * m, 22)
      .fill({ color: 0xeee8d6 }).stroke({ width: 3, color: 0xb9b19a });
  }

  const node = new Map(map.nodes.map((n) => [n.id, n]));
  // driveways (depot, sites)
  const dn = node.get(map.depotNodeId)!;
  const drive = (x: number, y: number, nid: string) => { const n = node.get(nid)!; g.moveTo(x, y).lineTo(n.x, n.y).stroke({ width: 30, color: INK, cap: 'round' }); };
  drive(map.depot.x, map.depot.y, map.depotNodeId);
  g.moveTo(map.depot.x, map.depot.y).lineTo(dn.x, dn.y).stroke({ width: 22, color: 0x7a8696, cap: 'round' });

  // roads: outline pass, fill pass, centre dashes on main
  for (const e of map.edges) { const a = node.get(e.a)!, b = node.get(e.b)!; g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: ROAD_W[e.kind] + 8, color: INK, cap: 'round' }); }
  for (const e of map.edges) { const a = node.get(e.a)!, b = node.get(e.b)!; g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: ROAD_W[e.kind], color: e.kind === 'main' ? 0x5d6877 : 0x7a8696, cap: 'round' }); }
  for (const e of map.edges) {
    const a = node.get(e.a)!, b = node.get(e.b)!;
    const len = Math.hypot(b.x - a.x, b.y - a.y), ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    const [on, off] = e.kind === 'main' ? [26, 22] : [12, 22];
    for (let d = 30; d + on < len - 30; d += on + off)
      g.moveTo(a.x + ux * d, a.y + uy * d).lineTo(a.x + ux * (d + on), a.y + uy * (d + on)).stroke({ width: e.kind === 'main' ? 4 : 3, color: e.kind === 'main' ? 0xffffff : 0xdfe6ee });
  }

  // depot + decor, depth-sorted
  const things = new Container(); things.sortableChildren = true; root.addChild(things);
  const dep = art('depot'); dep.position.set(map.depot.x, map.depot.y + 40); dep.zIndex = map.depot.y + 40; things.addChild(dep);
  for (const d of map.decor) {
    const a = art(d.key, d.scale ?? 1); a.position.set(d.x, d.y); a.zIndex = d.y; things.addChild(a);
  }
  return root;
}

export interface Pad { c: Container; w: number; h: number; cx: number; cy: number }

/** Pad under a site's cabin slots (construction yard / wedding lawn). */
export function buildPad(spot: SiteSpot, type: SiteType, node?: { x: number; y: number }): Pad {
  const xs = [spot.x, ...spot.slots.map((s) => s.x)], ys = [Math.min(...spot.slots.map((s) => s.y)) - 120, ...spot.slots.map((s) => s.y)];
  const x0 = Math.min(...xs) - 20, x1 = Math.max(...xs) + 20, y0 = Math.min(...ys), y1 = Math.max(...ys) + 28;
  const w = x1 - x0, h = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const c = new Container();
  const g = new Graphics(); c.addChild(g);
  if (node) { // driveway to the road
    g.moveTo(spot.x, spot.y).lineTo(node.x, node.y).stroke({ width: 30, color: INK, cap: 'round' });
    g.moveTo(spot.x, spot.y).lineTo(node.x, node.y).stroke({ width: 22, color: 0x7a8696, cap: 'round' });
  }
  const con = type === 'construction';
  g.roundRect(x0, y0, w, h, 18).fill({ color: con ? 0xdcbc82 : 0xcff0a8 }).stroke({ width: 4, color: INK });
  // border dashes: hazard stripes (construction) / bunting dots (wedding)
  const per = 2 * (w + h), step = 26;
  for (let d = 0; d < per; d += step) {
    let x: number, y: number;
    if (d < w) { x = x0 + d; y = y0; } else if (d < w + h) { x = x1; y = y0 + d - w; } else if (d < 2 * w + h) { x = x1 - (d - w - h); y = y1; } else { x = x0; y = y1 - (d - 2 * w - h); }
    if (con) g.circle(x, y, 5).fill({ color: (d / step) % 2 ? 0xffc83d : INK });
    else g.circle(x, y, 5).fill({ color: [0xf48fb1, 0xffffff, 0x7fd0ff][(d / step) % 3 | 0] });
  }
  if (con) {
    const crane = art('crane'); crane.position.set(x1 - 28, y0 + 70); c.addChild(crane);
  } else {
    const arch = art('wedding-arch'); arch.position.set(spot.x, y0 + 80); c.addChild(arch);
    for (const dx of [-70, 70]) { const t = art('wedding-table'); t.position.set(spot.x + dx, y0 + 80); c.addChild(t); }
  }
  return { c, w, h, cx, cy };
}
