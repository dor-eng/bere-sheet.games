// PixiJS 8 map renderer. Reads GameState only. Contract: src/sim/types.ts (RenderApi).
import { Application, Container, Graphics } from 'pixi.js';
import type { CityMap, GameState, RenderApi, Selection, SiteDef, SiteSpot, Truck } from '../sim/types.ts';
import { art, loadAssets, personArt, INK } from './assets.ts';
import { Camera, bindGestures } from './camera.ts';
import { FxLayer } from './fx.ts';
import { buildPad, buildStatic, GROUND, type Pad } from './scene.ts';

const gaugeColor = (r: number) => (r < 0.6 ? 0x3dd68c : r < 0.85 ? 0xffb020 : 0xe5484d);
const lerpAngle = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

// ---- cabin view: body + vertical fill gauge on its front + pulse ring ----
interface CabinView { c: Container; gauge: Graphics; ring: Graphics; q: number; full: boolean; x: number; y: number }
function makeCabin(): CabinView {
  const c = new Container();
  c.addChild(art('cabin'));
  const gauge = new Graphics(); gauge.position.set(0, 0); c.addChild(gauge);
  const ring = new Graphics(); ring.roundRect(-25, -58, 50, 64, 12).fill({ color: 0xe5484d, alpha: 0.25 }).stroke({ width: 5, color: 0xe5484d });
  ring.visible = false; c.addChildAt(ring, 0);
  return { c, gauge, ring, q: -1, full: false, x: 0, y: 0 };
}
function drawCabinGauge(g: Graphics, ratio: number) {
  g.clear();
  const h = 30, w = 11, x = -w / 2, y = -42;
  g.roundRect(x, y, w, h, 5).fill({ color: 0xffffff }).stroke({ width: 3, color: INK });
  const fh = Math.max(0, Math.min(1, ratio)) * (h - 4);
  if (fh > 0) g.roundRect(x + 2, y + h - 2 - fh, w - 4, fh, 2).fill({ color: gaugeColor(ratio) });
  if (ratio >= 0.8) { // drop icon on top
    g.circle(0, y - 8, 6).fill({ color: ratio >= 1 ? 0xe5484d : 0x2f9be0 }).stroke({ width: 2.5, color: INK });
    g.poly([0, y - 20, -5, y - 11, 5, y - 11]).fill({ color: ratio >= 1 ? 0xe5484d : 0x2f9be0 });
  }
}

// ---- truck view ----
interface TruckView { c: Container; body: Container; gauge: Graphics; x: number; y: number; a: number; job: string; q: number; init: boolean }
function drawTankGauge(g: Graphics, ratio: number) {
  g.clear();
  const w = 54, h = 11;
  g.roundRect(-w / 2, 0, w, h, 5).fill({ color: 0xffffff }).stroke({ width: 3, color: INK });
  if (ratio > 0.02) g.roundRect(-w / 2 + 2, 2, (w - 4) * Math.min(1, ratio), h - 4, 3).fill({ color: gaugeColor(ratio) });
  g.circle(-w / 2 - 9, h / 2, 7).fill({ color: ratio >= 0.95 ? 0xe5484d : 0x2f9be0 }).stroke({ width: 2.5, color: INK });
}

// ---- people ----
interface Person { c: Container; x: number; y: number; hx: number; hy: number; st: 'idle' | 'toCabin' | 'inside' | 'back'; t: number; tx: number; ty: number; ph: number }
interface SiteView { def: SiteDef; spot: SiteSpot; pad: Pad; people: Person[]; maxN: number; flashed: boolean }

function usageRate(def: SiteDef, time: number): number {
  const u = def.usage; if (!u.length) return 0;
  const t = time - def.openAt;
  if (t <= u[0][0]) return u[0][1];
  for (let i = 1; i < u.length; i++) if (t <= u[i][0]) { const [t0, v0] = u[i - 1], [t1, v1] = u[i]; return v0 + (v1 - v0) * (t1 > t0 ? (t - t0) / (t1 - t0) : 1); }
  return u[u.length - 1][1];
}

export function createRender(): RenderApi {
  let app: Application, cam: Camera, map: CityMap;
  let world: Container, actors: Container, padLayer: Container;
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
    const kind = sv.def.type === 'construction' ? 'worker' : 'guest';
    const c = personArt(kind, i);
    const hx = sv.pad.cx + (Math.random() - 0.5) * (sv.pad.w - 60);
    const hy = sv.spot.y - 30 + Math.random() * 36;
    c.position.set(hx, hy);
    actors.addChild(c);
    return { c, x: hx, y: hy, hx, hy, st: 'idle', t: Math.random() * 2, tx: hx, ty: hy, ph: Math.random() * 6 };
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
        if (mine.length && open) { const cb2 = mine[(Math.random() * mine.length) | 0]; const sp = slotPos(sv.spot, cb2.slot); p.tx = sp.x; p.ty = sp.y + 6; p.st = 'toCabin'; }
        else p.t = 1 + Math.random() * 2;
      }
      if (p.st === 'toCabin' || p.st === 'back') {
        const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy), step = 46 * dt;
        if (d <= step) {
          p.x = p.tx; p.y = p.ty;
          if (p.st === 'toCabin') { p.st = 'inside'; p.t = 1 + Math.random() * 1.5; p.c.visible = false; }
          else { p.st = 'idle'; p.t = 1.5 + Math.random() * 4; }
        } else { p.x += (dx / d) * step; p.y += (dy / d) * step; if (Math.abs(dx) > 1) p.c.scale.x = dx > 0 ? 1 : -1; }
      } else if (p.st === 'inside' && p.t <= 0) { p.c.visible = true; p.st = 'back'; p.tx = p.hx; p.ty = p.hy; }
      const moving = p.st === 'toCabin' || p.st === 'back';
      p.c.position.set(p.x, p.y + (moving ? -Math.abs(Math.sin(clock * 12 + p.ph)) * 3 : 0));
      p.c.zIndex = p.y;
    }
  }

  function ensureSite(s: GameState, i: number): SiteView | undefined {
    const st = s.sites[i];
    let sv = sites.get(st.def.id);
    if (sv) return sv;
    const spot = map.spots.find((p) => p.id === st.def.spotId); if (!spot) return undefined;
    const pad = buildPad(spot, st.def.type, map.nodes.find((n) => n.id === spot.nodeId));
    padLayer.addChild(pad.c);
    sv = { def: st.def, spot, pad, people: [], maxN: st.def.type === 'construction' ? 6 : 10, flashed: false };
    sites.set(st.def.id, sv);
    return sv;
  }

  function handleEvents(s: GameState) {
    for (const e of s.events) {
      if (e.kind === 'cabinEmptied') {
        const sv = sites.get(e.siteId); const cabin = s.cabins.find((c) => c.id === e.cabinId);
        if (sv && cabin) { const p = slotPos(sv.spot, cabin.slot); fx.splash(p.x, p.y); }
      } else if (e.kind === 'paid') {
        const sv = sites.get(e.siteId); if (sv) fx.coin(sv.pad.cx, sv.pad.cy - sv.pad.h / 2, e.amount);
      } else if (e.kind === 'overflowStart') {
        const sv = sites.get(e.siteId); if (sv) fx.flash(sv.pad.cx, sv.pad.cy, sv.pad.w + 10, sv.pad.h + 10);
      }
    }
  }

  function updateTruck(t: Truck, dt: number) {
    let v = trucks.get(t.id);
    if (!v) {
      const c = new Container(); const body = art('truck'); const gauge = new Graphics();
      c.addChild(body); gauge.position.set(0, -58); c.addChild(gauge); actors.addChild(c);
      v = { c, body, gauge, x: t.x, y: t.y, a: t.angle, job: t.job, q: -1, init: true };
      trucks.set(t.id, v);
    }
    const dist = Math.hypot(t.x - v.x, t.y - v.y);
    const k = dist > 250 ? 1 : 1 - Math.exp(-dt * 22);
    v.x += (t.x - v.x) * k; v.y += (t.y - v.y) * k;
    if (dist > 0.5) v.a = lerpAngle(v.a, t.angle, 1 - Math.exp(-dt * 16));
    if (t.job !== v.job) {
      if (v.job === 'idle' || v.job === 'pumping' || v.job === 'dumping') if (t.job === 'toSite' || t.job === 'toDepot' || t.job === 'delivering') fx.dust(v.x, v.y, v.a);
      v.job = t.job;
    }
    // never upside down: if heading left, mirror the sprite and rotate relative to the left direction
    const left = Math.cos(v.a) < 0;
    v.body.scale.x = left ? -1 : 1;
    v.body.rotation = left ? v.a - Math.PI : v.a;
    v.c.position.set(v.x, v.y);
    v.c.zIndex = v.y + 20;
    const q = Math.round((t.tank / Math.max(1, t.tankCap)) * 40);
    if (q !== v.q) { v.q = q; drawTankGauge(v.gauge, q / 40); }
  }

  function hit(px: number, py: number): Selection {
    const w = cam.toWorld(px, py);
    const fingerR = Math.max(60, 26 / cam.scale); // >= ~26 css px radius
    let best: Selection = null, bd = Infinity;
    for (const [id, v] of trucks) { const d = Math.hypot(v.x - w.x, v.y - w.y); if (d < fingerR + 20 && d < bd) { bd = d; best = { kind: 'truck', id }; } }
    if (best) return best;
    for (const [id, sv] of sites) {
      const p = sv.pad, pad = Math.max(0, fingerR - 40);
      if (Math.abs(w.x - p.cx) < p.w / 2 + pad && Math.abs(w.y - p.cy) < p.h / 2 + pad) return { kind: 'site', id };
    }
    if (Math.hypot(w.x - map.depot.x, w.y - (map.depot.y - 30)) < Math.max(120, fingerR + 60)) return { kind: 'depot', id: 'depot' };
    return null;
  }

  function drawSelection() {
    sel.clear();
    if (!selected) return;
    const pulse = 1 + Math.sin(clock * 6) * 0.04;
    let x = 0, y = 0, rx = 0, ry = 0;
    if (selected.kind === 'truck') { const v = trucks.get(selected.id); if (!v) return; x = v.x; y = v.y + 8; rx = 90; ry = 44; }
    else if (selected.kind === 'site') { const sv = sites.get(selected.id); if (!sv) return; x = sv.pad.cx; y = sv.pad.cy; rx = sv.pad.w / 2 + 14; ry = sv.pad.h / 2 + 14; }
    else { x = map.depot.x; y = map.depot.y - 20; rx = 150; ry = 90; }
    sel.ellipse(x, y, rx * pulse, ry * pulse).stroke({ width: 10, color: INK }).ellipse(x, y, rx * pulse, ry * pulse).stroke({ width: 5, color: 0xffffff });
  }

  const api: RenderApi = {
    async mount(el, m) {
      map = m;
      app = new Application();
      await app.init({ resizeTo: el, resolution: Math.min(3, window.devicePixelRatio || 1), autoDensity: true, antialias: true, background: GROUND, preference: 'webgl' });
      el.appendChild(app.canvas);
      app.canvas.style.display = 'block';
      await loadAssets();
      world = new Container();
      padLayer = new Container(); actors = new Container(); actors.sortableChildren = true;
      world.addChild(buildStatic(map), padLayer, sel, actors, fx.layer);
      app.stage.addChild(world);
      cam = new Camera(world, map.width, map.height);
      cam.resize(el.clientWidth || app.screen.width, el.clientHeight || app.screen.height);
      // portrait phone: start at the top-left-ish overview, fit to width
      app.renderer.on('resize', (w: number, h: number) => cam.resize(w, h));
      bindGestures(app.canvas, cam, (px, py) => { selected = hit(px, py); cb(selected); });
    },
    onSelect(f) { cb = f; },
    focus(x, y) { cam.focus(x, y); },
    update(s, dt) {
      if (!app || !cam) return;
      clock += dt;
      if (s.time < lastEventTime) lastEventTime = -1; // new day
      for (let i = 0; i < s.sites.length; i++) {
        const sv = ensureSite(s, i); if (!sv) continue;
        const st = s.sites[i];
        sv.pad.c.alpha = st.open ? 1 : st.closed ? 0.55 : 0.8;
        stepPeople(sv, s, dt, st.open);
      }
      if (s.time !== lastEventTime) { handleEvents(s); lastEventTime = s.time; } // re-called without a sim step => don't replay FX
      // cabins
      const seen = new Set<string>();
      for (const c of s.cabins) {
        if (c.siteId === null) continue;
        const sv = sites.get(c.siteId); if (!sv) continue;
        seen.add(c.id);
        let v = cabins.get(c.id);
        if (!v) { v = makeCabin(); cabins.set(c.id, v); actors.addChild(v.c); }
        const p = slotPos(sv.spot, c.slot);
        v.c.position.set(p.x, p.y); v.c.zIndex = p.y;
        const ratio = c.capacity > 0 ? c.fill / c.capacity : 0;
        const q = Math.round(ratio * 20);
        if (q !== v.q) { v.q = q; drawCabinGauge(v.gauge, ratio); }
        const full = ratio >= 0.999;
        v.ring.visible = full;
        if (full) v.ring.alpha = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(clock * 9));
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
