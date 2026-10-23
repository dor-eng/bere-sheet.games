// PixiJS 8 map renderer, isometric. Reads GameState only. Contract: src/sim/types.ts (RenderApi).
// Sim is in world px (1000 x 1600); everything drawn goes through iso() into the 2600 x 1733 projected canvas.
import { Application, Container, Graphics, Text } from 'pixi.js';
import type { CityMap, GameState, RenderApi, Selection, SiteDef, SiteSpot, SiteState, Truck } from '../sim/types.ts';
import { art, loadAssets, loadReal, logo, personArt, realSprite, INK } from './assets.ts';
import { Camera, bindGestures } from './camera.ts';
import { FxLayer } from './fx.ts';
import { iso, isoRect, unIso, ISO_W, ISO_H } from './iso.ts';
import { buildDumps, buildGates, buildPad, buildStatic, GROUND, type Pad } from './scene.ts';
import { gateCrowded } from '../sim/index.ts';
import { avgFill, cabinsOf, clockText, fineSoFar, isOverflowing, needsActionId, staleSiteIds } from './siteSync.ts';

const gaugeColor = (r: number) => (r < 0.6 ? 0x3dd68c : r < 0.85 ? 0xffb020 : 0xe5484d);
const TRUCK_W = 280, CABIN_H = 56, PERSON_H = 36;

/** soft contact shadow: stacked translucent ellipses, light from screen upper-left -> offset lower-right */
function shadow(rx: number, ry: number): Graphics {
  const g = new Graphics();
  for (const k of [1, 0.78, 0.55]) g.ellipse(rx * 0.12, ry * 0.15, rx * k, ry * k).fill({ color: 0x1a1408, alpha: 0.11 });
  return g;
}

// ---- cabin view: sprite + fill gauge above the roof + red pulse ring on the ground ----
interface CabinView { c: Container; gauge: Graphics; ring: Graphics; q: number; wmax: number; splashT: number }
function makeCabin(): CabinView {
  const c = new Container();
  const ring = new Graphics(); ring.ellipse(0, 0, 26, 13).fill({ color: 0xe5484d, alpha: 0.3 }).stroke({ width: 5, color: 0xe5484d });
  ring.visible = false;
  const spr = realSprite('cabin', 0.5, 0.97, { h: CABIN_H });
  c.addChild(ring, shadow(18, 8), spr ?? art('cabin', 0.8));
  const mark = spr && logo(15); if (mark) { mark.position.set(-8, -25); c.addChild(mark); } // brand on the cream door
  const gauge = new Graphics(); c.addChild(gauge);
  return { c, gauge, ring, q: -1, wmax: 0, splashT: 0 };
}
function drawCabinGauge(g: Graphics, ratio: number) {
  g.clear();
  const h = 24, w = 11, x = -w / 2, y = -CABIN_H - 8 - h;
  g.roundRect(x, y, w, h, 5).fill({ color: 0xffffff }).stroke({ width: 3, color: INK });
  const fh = Math.max(0, Math.min(1, ratio)) * (h - 4);
  if (fh > 0) g.roundRect(x + 2, y + h - 2 - fh, w - 4, fh, 2).fill({ color: gaugeColor(ratio) });
  if (ratio >= 0.8) { // drop icon on top
    g.circle(0, y - 8, 6).fill({ color: ratio >= 1 ? 0xe5484d : 0x2f9be0 }).stroke({ width: 2.5, color: INK });
    g.poly([0, y - 20, -5, y - 11, 5, y - 11]).fill({ color: ratio >= 1 ? 0xe5484d : 0x2f9be0 });
  }
}

// ---- truck view: 4 diagonal sprites, one visible ----
type Dir = 'dl' | 'dr' | 'ul' | 'ur';
const ANCHOR: Record<Dir, [number, number]> = { dr: [0.45, 0.68], ul: [0.47, 0.66], dl: [0.55, 0.68], ur: [0.53, 0.66] };
interface TruckView {
  c: Container; body: Container; views: Partial<Record<Dir, Container>>; gauge: Graphics; topY: number;
  x: number; y: number; a: number; px: number; py: number; dir: Dir; job: string; q: number; spd: number; dustT: number;
}
/** world heading -> screen diagonal: +x DR, -x UL, +y DL, -y UR */
const dirOf = (a: number): Dir => { const c = Math.cos(a), s = Math.sin(a); return Math.abs(c) >= Math.abs(s) ? (c > 0 ? 'dr' : 'ul') : (s > 0 ? 'dl' : 'ur'); };
/** world heading -> projected screen angle */
const screenAngle = (a: number) => { const c = Math.cos(a), s = Math.sin(a); return Math.atan2((c + s) / 2, c - s); };
function drawTankGauge(g: Graphics, ratio: number) {
  g.clear();
  const w = 54, h = 11;
  g.roundRect(-w / 2, 0, w, h, 5).fill({ color: 0xffffff }).stroke({ width: 3, color: INK });
  if (ratio > 0.02) g.roundRect(-w / 2 + 2, 2, (w - 4) * Math.min(1, ratio), h - 4, 3).fill({ color: gaugeColor(ratio) });
  g.circle(-w / 2 - 9, h / 2, 7).fill({ color: ratio >= 0.95 ? 0xe5484d : 0x2f9be0 }).stroke({ width: 2.5, color: INK });
}

// ---- people ----
interface Person { c: Container; fig: Container; x: number; y: number; hx: number; hy: number; st: 'idle' | 'toCabin' | 'inside' | 'back'; t: number; tx: number; ty: number; ph: number }
interface SiteLabel { c: Container; plate: Graphics; name: Text; stat: Text; badge: Container; badgeBg: Graphics; badgeTxt: Text; key: string; w: number; h: number; bh: number }
interface SiteView { def: SiteDef; spot: SiteSpot; pad: Pad; people: Person[]; maxN: number; label: SiteLabel }

// ---- site marker: name plate + status line (+ fine badge above it). Built at LU font units, counter-scaled to a constant css size. ----
const RLM = '\u200F'; // canvas text is laid out LTR off-DOM: strong-RTL marks keep Hebrew + digits + '!' in reading order
const LABEL_CSS = 0.55; // label unit -> css px (font 30 => ~16 css px)
const txt = (size: number, fill: number) => new Text({ text: '', resolution: 2, style: { fontFamily: 'system-ui, Arial, sans-serif', fontWeight: '900', fontSize: size, fill, stroke: { color: INK, width: 5, join: 'round' } } });
function makeLabel(): SiteLabel {
  const c = new Container();
  const plate = new Graphics(), name = txt(32, 0xffffff), stat = txt(28, 0xffffff);
  name.anchor.set(0.5, 0); stat.anchor.set(0.5, 0);
  const badge = new Container(), badgeBg = new Graphics(), badgeTxt = txt(30, 0xffffff);
  const coin = art('icon-coin'); coin.scale.set(1.1);
  badgeTxt.anchor.set(0, 0.5);
  badge.addChild(badgeBg, coin, badgeTxt); badge.visible = false;
  c.addChild(plate, name, stat, badge);
  return { c, plate, name, stat, badge, badgeBg, badgeTxt, key: '', w: 0, h: 0, bh: 0 };
}
const statColor = (r: number) => (r < 0.6 ? 0x7ee8b0 : r < 0.85 ? 0xffc94d : 0xff6b6b);
/** refresh text/plate/badge (only when something changed); returns nothing, positions are set by the caller */
function drawLabel(L: SiteLabel, s: GameState, st: SiteState, overflow: boolean) {
  const def = st.def, cabs = cabinsOf(s, def.id).length;
  let line: string, color = 0xffffff;
  if (st.closed) line = 'הסתיים';
  else if (!st.open) { line = 'נפתח ב-' + clockText(def.openAt, s.level.dayLength); color = 0xffe7a3; }
  else if (!cabs) { line = 'אין תאים!'; color = 0xff6b6b; }
  else { const r = avgFill(s, def.id); line = 'מלא ' + Math.round(r * 100) + '%'; color = statColor(r); }
  const fine = overflow ? fineSoFar(st) : 0;
  const key = def.name + '|' + line + '|' + fine;
  if (key === L.key) return;
  L.key = key;
  L.name.text = RLM + def.name + RLM; L.stat.text = RLM + line + RLM; L.stat.style.fill = color;
  const w = Math.max(L.name.width, L.stat.width) + 28, h = 8 + L.name.height + L.stat.height * 0.95 + 8;
  L.w = w; L.h = h;
  L.name.position.set(0, -h + 8); L.stat.position.set(0, -h + 8 + L.name.height - 2);
  L.plate.clear().roundRect(-w / 2, -h, w, h, 18).fill({ color: INK, alpha: 0.9 }).stroke({ width: 4, color: fine > 0 ? 0xe5484d : 0xffffff, alpha: 0.95 });
  L.bh = 0;
  L.badge.visible = fine > 0;
  if (fine > 0) {
    L.badgeTxt.text = '-' + fine; L.badgeTxt.position.set(8, 0);
    const bw = 36 + 8 + L.badgeTxt.width + 18, bh = 46;
    L.badgeBg.clear().roundRect(-bw / 2, -bh / 2, bw, bh, 23).fill({ color: 0xe5484d }).stroke({ width: 4, color: 0xffffff });
    L.badge.children[1].position.set(-bw / 2 + 10, 0);
    L.badgeTxt.x = -bw / 2 + 10 + 30;
    L.badge.position.set(0, -h - bh / 2 - 6); L.bh = bh + 6;
  }
}

function usageRate(def: SiteDef, time: number): number {
  const u = def.usage; if (!u.length) return 0;
  const t = time - def.openAt;
  if (t <= u[0][0]) return u[0][1];
  for (let i = 1; i < u.length; i++) if (t <= u[i][0]) { const [t0, v0] = u[i - 1], [t1, v1] = u[i]; return v0 + (v1 - v0) * (t1 > t0 ? (t - t0) / (t1 - t0) : 1); }
  return u[u.length - 1][1];
}

export interface RenderExtra {
  /** world -> canvas css px (for ui.setView edge arrows) */
  view(x: number, y: number): { x: number; y: number } | null;
}

export function createRender(): RenderApi & RenderExtra {
  let app: Application, cam: Camera, map: CityMap;
  let world: Container, actors: Container, padLayer: Container, gates: Graphics, labels: Container;
  const ring = new Graphics(), arrow = new Graphics();
  const fx = new FxLayer();
  const sel = new Graphics();
  let selected: Selection = null;
  let cb: (s: Selection) => void = () => {};
  const cabins = new Map<string, CabinView>();
  const trucks = new Map<string, TruckView>();
  const sites = new Map<string, SiteView>();
  let lastEventTime = -1;
  let clock = 0;

  const slotPos = (spot: SiteSpot, slot: number) => spot.slots[slot] ?? { x: spot.x, y: spot.y };

  function addPerson(sv: SiteView, i: number): Person {
    const con = sv.def.type === 'construction';
    const fig = new Container();
    fig.addChild(realSprite(con ? 'worker' : 'guest', 0.5, 0.97, { h: PERSON_H }) ?? personArt(con ? 'worker' : 'guest', i));
    const c = new Container(); c.addChild(shadow(9, 4), fig);
    const hx = sv.pad.cx + (Math.random() - 0.5) * (sv.pad.w - 60);
    const hy = sv.spot.y - 30 + Math.random() * 36;
    actors.addChild(c);
    return { c, fig, x: hx, y: hy, hx, hy, st: 'idle', t: Math.random() * 2, tx: hx, ty: hy, ph: Math.random() * 6 };
  }

  function stepPeople(sv: SiteView, s: GameState, dt: number, open: boolean) {
    let want = 0;
    if (open) {
      const peak = Math.max(...sv.def.usage.map((p) => p[1]), 0);
      want = peak > 0 ? Math.max(1, Math.round((sv.maxN * usageRate(sv.def, s.time)) / peak)) : 0;
    }
    while (sv.people.length < want) sv.people.push(addPerson(sv, sv.people.length));
    for (let i = sv.people.length - 1; i >= 0 && sv.people.length > want; i--) {
      if (sv.people[i].st === 'idle') { sv.people[i].c.destroy({ children: true }); sv.people.splice(i, 1); }
    }
    const mine = s.cabins.filter((c) => c.siteId === sv.def.id);
    for (const p of sv.people) {
      p.t -= dt;
      if (p.st === 'idle' && p.t <= 0) {
        if (mine.length && open && Math.random() < 0.6) { const cb2 = mine[(Math.random() * mine.length) | 0]; const sp = slotPos(sv.spot, cb2.slot); p.tx = sp.x; p.ty = sp.y + 6; p.st = 'toCabin'; }
        else { p.tx = p.hx + (Math.random() - 0.5) * 50; p.ty = p.hy + (Math.random() - 0.5) * 24; p.st = 'back'; } // short stroll near home
      }
      if (p.st === 'toCabin' || p.st === 'back') {
        const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy), step = 46 * dt;
        if (d <= step) {
          p.x = p.tx; p.y = p.ty;
          if (p.st === 'toCabin') { p.st = 'inside'; p.t = 1 + Math.random() * 1.5; p.c.visible = false; }
          else { p.st = 'idle'; p.t = 1.5 + Math.random() * 4; }
        } else {
          p.x += (dx / d) * step; p.y += (dy / d) * step;
          const sdx = dx - dy; // projected screen dx
          if (Math.abs(sdx) > 1) p.fig.scale.x = sdx > 0 ? 1 : -1;
        }
      } else if (p.st === 'inside' && p.t <= 0) { p.c.visible = true; p.st = 'back'; p.tx = p.hx; p.ty = p.hy; }
      const moving = p.st === 'toCabin' || p.st === 'back';
      const q = iso(p.x, p.y);
      p.c.position.set(q.x, q.y);
      p.fig.y = moving ? -Math.abs(Math.sin(clock * 12 + p.ph)) * 1.8 : 0;
      p.fig.rotation = moving ? Math.sin(clock * 12 + p.ph) * 0.05 : Math.sin(clock * 1.7 + p.ph) * 0.035; // walk wobble / idle sway
      p.c.zIndex = q.y;
    }
  }

  function dropSite(id: string) {
    const sv = sites.get(id); if (!sv) return;
    for (const p of sv.people) p.c.destroy({ children: true });
    sv.pad.c.destroy({ children: true }); sv.label.c.destroy({ children: true });
    sites.delete(id);
    if (selected?.kind === 'site' && selected.id === id) { selected = null; cb(null); }
  }

  function ensureSite(s: GameState, i: number): SiteView | undefined {
    const st = s.sites[i];
    let sv = sites.get(st.def.id);
    if (sv && (sv.def.spotId !== st.def.spotId || sv.def.type !== st.def.type)) { dropSite(st.def.id); sv = undefined; } // same id, different site on a new day
    if (sv) { sv.def = st.def; return sv; }
    const spot = map.spots.find((p) => p.id === st.def.spotId); if (!spot) return undefined;
    const pad = buildPad(spot, st.def.type, map.nodes.find((n) => n.id === spot.nodeId));
    padLayer.addChild(pad.c);
    const label = makeLabel(); labels.addChild(label.c);
    sv = { def: st.def, spot, pad, people: [], maxN: st.def.type === 'construction' ? 6 : 10, label };
    sites.set(st.def.id, sv);
    return sv;
  }

  function handleEvents(s: GameState) {
    for (const e of s.events) {
      if (e.kind === 'cabinEmptied') {
        const sv = sites.get(e.siteId); const cabin = s.cabins.find((c) => c.id === e.cabinId);
        if (sv && cabin) { const sp = slotPos(sv.spot, cabin.slot); const p = iso(sp.x, sp.y); fx.splash(p.x, p.y - CABIN_H / 2); }
      } else if (e.kind === 'paid') {
        const sv = sites.get(e.siteId); if (sv) { const p = iso(sv.pad.cx, sv.pad.y0); fx.coin(p.x, p.y - 30, e.amount); }
      } else if (e.kind === 'overflowStart') {
        const sv = sites.get(e.siteId); if (sv) fx.flashPoly(isoRect(sv.pad.x0 - 5, sv.pad.y0 - 5, sv.pad.x1 + 5, sv.pad.y1 + 5));
      }
    }
  }

  function makeTruck(t: Truck): TruckView {
    const c = new Container(); const body = new Container(); const views: TruckView['views'] = {};
    let topY = -70;
    for (const d of ['dl', 'dr', 'ul', 'ur'] as Dir[]) {
      const s = realSprite(`truck-${d}`, ANCHOR[d][0], ANCHOR[d][1], { w: TRUCK_W });
      if (s) {
        const v = new Container(); v.visible = false; v.addChild(s);
        views[d] = v; body.addChild(v); topY = Math.min(topY, -s.height * ANCHOR[d][1]);
      }
    }
    if (!Object.keys(views).length) body.addChild(art('truck', 0.85)); // placeholder, no sprites
    const gauge = new Graphics(); gauge.position.set(0, topY - 18);
    c.addChild(shadow(116, 52), body, gauge); actors.addChild(c);
    const p = iso(t.x, t.y);
    return { c, body, views, gauge, topY, x: t.x, y: t.y, a: t.angle, px: p.x, py: p.y, dir: dirOf(t.angle), job: t.job, q: -1, spd: 0, dustT: 0 };
  }

  function updateTruck(t: Truck, dt: number) {
    let v = trucks.get(t.id);
    if (!v) { v = makeTruck(t); trucks.set(t.id, v); }
    const dist = Math.hypot(t.x - v.x, t.y - v.y);
    const k = dist > 250 ? 1 : 1 - Math.exp(-dt * 22);
    const ox = v.x, oy = v.y;
    v.x += (t.x - v.x) * k; v.y += (t.y - v.y) * k;
    const moved = Math.hypot(v.x - ox, v.y - oy);
    v.spd += ((dt > 0 ? moved / dt : 0) - v.spd) * Math.min(1, dt * 10);
    if (dist > 0.5) { v.a = t.angle; v.dir = dirOf(t.angle); }
    const sa = screenAngle(v.a);
    const driving = v.spd > 8 && moved < 200;
    if (t.job !== v.job) {
      if ((v.job === 'idle' || v.job === 'pumping' || v.job === 'dumping') && (t.job === 'toSite' || t.job === 'toDepot' || t.job === 'delivering')) fx.dust(v.px, v.py, sa);
      v.job = t.job;
    }
    for (const d of Object.keys(v.views) as Dir[]) v.views[d]!.visible = d === v.dir;
    const p = iso(v.x, v.y); v.px = p.x; v.py = p.y;
    // life: suspension bob while driving, small shake while pumping / dumping
    if (t.job === 'pumping' || t.job === 'dumping') v.body.position.set(Math.sin(clock * 53) * 0.9, Math.cos(clock * 41) * 0.6);
    else if (driving) v.body.position.set(0, Math.sin(clock * 11) * 1.1 + Math.sin(clock * 17.3) * 0.4);
    else v.body.position.set(0, 0);
    if (driving) { v.dustT -= dt; if (v.dustT <= 0) { v.dustT = 0.22; fx.dust(v.px, v.py, sa, 1, 0.55, 48); } }
    v.c.position.set(v.px, v.py);
    v.c.zIndex = v.py + 4;
    const q = Math.round((t.tank / Math.max(1, t.tankCap)) * 40);
    if (q !== v.q) { v.q = q; drawTankGauge(v.gauge, q / 40); }
  }

  function hit(px: number, py: number): Selection {
    const P = cam.toWorld(px, py); // projected canvas coords
    const w = unIso(P.x, P.y); // world coords
    const fingerR = Math.max(60, 26 / cam.scale); // >= ~26 css px radius
    let best: Selection = null, bd = Infinity;
    for (const [id, v] of trucks) { const d = Math.hypot(v.px - P.x, v.py - 28 - P.y); if (d < fingerR + 20 && d < bd) { bd = d; best = { kind: 'truck', id }; } }
    if (best) return best;
    for (const [id, sv] of sites) { // site marker: bottom-centre anchored plate (+ fine badge), counter-scaled
      const L = sv.label, k = L.c.scale.x, pr = 8 / cam.scale;
      if (Math.abs(P.x - L.c.x) < (L.w / 2) * k + pr && P.y < L.c.y + pr && P.y > L.c.y - (L.h + L.bh) * k - pr) return { kind: 'site', id };
    }
    for (const [id, sv] of sites) {
      const p = sv.pad, pad = Math.max(0, fingerR - 40);
      if (Math.abs(w.x - p.cx) < p.w / 2 + pad && Math.abs(w.y - p.cy) < p.h / 2 + pad) return { kind: 'site', id };
    }
    if (Math.hypot(w.x - map.depot.x, w.y - (map.depot.y - 30)) < Math.max(120, fingerR + 60)) return { kind: 'depot', id: 'depot' };
    return null;
  }

  const def_isFocus = (sv: SiteView, id: string | null) => id !== null && sv.def.id === id;
  /** pulsing ring on the lot + bouncing arrow over the marker */
  function drawFocus(sv: SiteView, over: boolean, lk: number) {
    const col = over ? 0xe5484d : 0xffc83d, k = 0.5 + 0.5 * Math.sin(clock * 6), p = sv.pad, m = 10 + 10 * k;
    const pts = isoRect(p.x0 - m, p.y0 - m, p.x1 + m, p.y1 + m);
    ring.poly(pts).stroke({ width: 12, color: INK, join: 'round', alpha: 0.6 + 0.4 * k }).poly(pts).stroke({ width: 7, color: col, join: 'round', alpha: 0.6 + 0.4 * k });
    const L = sv.label, top = L.c.y - (L.h + L.bh) * lk - 10 * lk - Math.abs(Math.sin(clock * 5)) * 18 * lk, x = L.c.x, u = 14 * lk;
    arrow.poly([x - u * 1.3, top - u * 2, x + u * 1.3, top - u * 2, x, top]).fill({ color: col }).stroke({ width: 3 * lk, color: INK, join: 'round' });
  }

  function drawSelection() {
    sel.clear();
    if (!selected) return;
    const pulse = 1 + Math.sin(clock * 6) * 0.04;
    if (selected.kind === 'site') {
      const sv = sites.get(selected.id); if (!sv) return;
      const m = 14 * pulse, p = sv.pad;
      const pts = isoRect(p.x0 - m, p.y0 - m, p.x1 + m, p.y1 + m);
      sel.poly(pts).stroke({ width: 10, color: INK, join: 'round' }).poly(pts).stroke({ width: 5, color: 0xffffff, join: 'round' });
      return;
    }
    let x = 0, y = 0, rx = 0, ry = 0;
    if (selected.kind === 'truck') { const v = trucks.get(selected.id); if (!v) return; x = v.px; y = v.py + 4; rx = 78; ry = 38; }
    else { const p = iso(map.depot.x, map.depot.y + 20); x = p.x; y = p.y; rx = 160; ry = 80; }
    sel.ellipse(x, y, rx * pulse, ry * pulse).stroke({ width: 10, color: INK }).ellipse(x, y, rx * pulse, ry * pulse).stroke({ width: 5, color: 0xffffff });
  }

  const api: RenderApi & RenderExtra = {
    async mount(el, m) {
      map = m;
      app = new Application();
      await app.init({ resizeTo: el, resolution: Math.min(3, window.devicePixelRatio || 1), autoDensity: true, antialias: true, background: GROUND, preference: 'webgl' });
      el.appendChild(app.canvas);
      app.canvas.style.display = 'block';
      await Promise.all([loadAssets(), loadReal()]);
      world = new Container();
      padLayer = new Container(); actors = new Container(); actors.sortableChildren = true;
      const st = buildStatic(map);
      for (const t of st.things) actors.addChild(t);
      gates = buildGates(map); gates.visible = false; // crowd-flow gate barriers: only while a gate window is open
      labels = new Container();
      world.addChild(st.ground, buildDumps(map), gates, padLayer, sel, ring, actors, fx.layer, labels, arrow); // dump stations: none on maps without map.dumps
      app.stage.addChild(world);
      cam = new Camera(world, ISO_W, ISO_H);
      cam.resize(el.clientWidth || app.screen.width, el.clientHeight || app.screen.height);
      app.renderer.on('resize', (w: number, h: number) => cam.resize(w, h));
      bindGestures(app.canvas, cam, (px, py) => { selected = hit(px, py); cb(selected); });
    },
    onSelect(f) { cb = f; },
    focus(x, y) { if (!cam) return; const p = iso(x, y); cam.focus(p.x, p.y); },
    view(x, y) {
      if (!cam) return null;
      const p = iso(x, y), s = cam.scale;
      return { x: (p.x - cam.cx) * s + cam.vw / 2, y: (p.y - cam.cy) * s + cam.vh / 2 };
    },
    update(s, dt) {
      if (!app || !cam) return;
      clock += dt;
      if (s.time < lastEventTime) lastEventTime = -1; // new day
      for (const id of staleSiteIds(sites.keys(), s)) dropSite(id); // new day: drop renderer sites the state no longer has
      const focusId = needsActionId(s), lk = LABEL_CSS / cam.scale;
      ring.clear(); arrow.clear();
      for (let i = 0; i < s.sites.length; i++) {
        const sv = ensureSite(s, i); if (!sv) continue;
        const st = s.sites[i];
        sv.pad.c.alpha = st.open ? 1 : st.closed ? 0.55 : 0.8;
        stepPeople(sv, s, dt, st.open);
        const over = isOverflowing(s, st);
        drawLabel(sv.label, s, st, over);
        const lp = iso(sv.pad.x0, sv.pad.y0), L = sv.label.c;
        L.position.set(lp.x, lp.y - 6 / cam.scale); L.scale.set(lk); L.alpha = st.closed ? 0.6 : 1;
        if (def_isFocus(sv, focusId)) drawFocus(sv, over, lk);
      }
      gates.visible = gateCrowded(s.level.gateWindows, s.time);
      if (s.time !== lastEventTime) { handleEvents(s); lastEventTime = s.time; } // re-called without a sim step => don't replay FX
      // cabins
      const seen = new Set<string>();
      let washK = 0;
      for (const c of s.cabins) {
        if (c.siteId === null) {
          if (c.slot !== -1 || c.washT <= 0) continue; // only dirty depot cabins are drawn: the wash line
          seen.add(c.id);
          let v = cabins.get(c.id);
          if (!v) { v = makeCabin(); cabins.set(c.id, v); actors.addChild(v.c); }
          const p = iso(map.depot.x + 70 + washK * 34, map.depot.y + 70 - washK * 6);
          v.c.position.set(p.x, p.y); v.c.zIndex = p.y; v.c.tint = 0xa08868; v.ring.visible = false;
          v.wmax = Math.max(v.wmax, c.washT);
          const k = 1 - c.washT / v.wmax, q = 100 + Math.round(k * 20);
          if (q !== v.q) { v.q = q; v.gauge.clear().roundRect(-14, -CABIN_H - 14, 28, 6, 3).fill({ color: 0x1b2a3a }).roundRect(-14, -CABIN_H - 14, 28 * k, 6, 3).fill({ color: 0x4fb3ff }); }
          if (washK === 0 && (v.splashT -= dt) <= 0) { v.splashT = 0.7; fx.splash(p.x, p.y - CABIN_H * 0.35); } // the bay in use
          washK++;
          continue;
        }
        const sv = sites.get(c.siteId); if (!sv) continue;
        seen.add(c.id);
        let v = cabins.get(c.id);
        if (!v) { v = makeCabin(); cabins.set(c.id, v); actors.addChild(v.c); }
        v.c.tint = 0xffffff; v.wmax = 0;
        const sp = slotPos(sv.spot, c.slot), p = iso(sp.x, sp.y);
        v.c.position.set(p.x, p.y); v.c.zIndex = p.y;
        const ratio = c.capacity > 0 ? c.fill / c.capacity : 0;
        const q = Math.round(ratio * 20);
        if (q !== v.q) { v.q = q; drawCabinGauge(v.gauge, ratio); }
        const full = ratio >= 0.999;
        v.ring.visible = full;
        if (full) { const k = 0.5 + 0.5 * Math.sin(clock * 9); v.ring.alpha = 0.45 + 0.55 * k; v.ring.scale.set(1 + 0.15 * k); }
      }
      for (const [id, v] of cabins) if (!seen.has(id)) { v.c.destroy({ children: true }); cabins.delete(id); }
      for (const t of s.trucks) updateTruck(t, dt);
      drawSelection();
      cam.tick(dt);
      fx.tick(dt);
    },
  };
  return api;
}
