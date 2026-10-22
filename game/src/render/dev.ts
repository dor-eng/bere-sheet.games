// Standalone render check: fake GameState from city1.json, trucks looping on roads, events firing. Not used by the game.
import city1 from '../data/city1.json';
import type { CityMap, GameEvent, GameState, Truck } from '../sim/types.ts';
import { createRender } from './index.ts';

const map = city1 as CityMap;
const node = new Map(map.nodes.map((n) => [n.id, n]));
const usage: [number, number][] = [[0, 0.2], [60, 1], [120, 0.4]];
const mkSite = (id: string, type: 'construction' | 'wedding', spotId: string) => {
  const sp = map.spots.find((s) => s.id === spotId)!;
  return { def: { id, type, name: id, spotId, openAt: 0, closeAt: 999, usage, fee: 100, serviceTip: 5, overflowFinePerSec: 1 }, open: true, closed: false, overflowSec: 0, earned: 0, x: sp.x, y: sp.y };
};
const sites = [mkSite('A', 'construction', 'spot-build-a'), mkSite('B', 'wedding', 'spot-hall-a')];
const cabins = sites.flatMap((st, si) => map.spots.find((s) => s.id === st.def.spotId)!.slots.slice(0, 3 + si * 2).map((_, k) => ({ id: `c${si}${k}`, siteId: st.def.id, slot: k, fill: 0, capacity: 100 })));
const mkTruck = (id: string): Truck => ({ id, name: id, job: 'toSite', path: [], seg: 0, segT: 0, x: 0, y: 0, angle: 0, tank: 0, tankCap: 100, pumpRate: 10, speed: 100, targetSiteId: null, carrying: 0 });
const state: GameState = {
  level: { id: 1, title: 'dev', dayLength: 600, sites: [], coinTarget: 0, unlock: { kind: 'site', name: '', desc: '', icon: 'icon-coin' } },
  map, time: 0, over: false, coinsStart: 0, coins: 0, trucks: [mkTruck('t1'), mkTruck('t2')], cabins, sites, events: [],
};
// loops over node polylines
const loops = [['n04', 'n14', 'n24', 'n23', 'n22', 'n12', 'n02', 'n03', 'n04'], ['n22', 'n21', 'n20', 'n10', 'n11', 'n12', 'n22']];
const pts = loops.map((l) => l.map((id) => node.get(id)!));
function pose(p: { x: number; y: number }[], d: number) {
  const segs = p.slice(1).map((b, i) => ({ a: p[i], b, len: Math.hypot(b.x - p[i].x, b.y - p[i].y) }));
  const total = segs.reduce((s, q) => s + q.len, 0); d %= total;
  for (const q of segs) { if (d <= q.len) { const t = d / q.len; return { x: q.a.x + (q.b.x - q.a.x) * t, y: q.a.y + (q.b.y - q.a.y) * t, angle: Math.atan2(q.b.y - q.a.y, q.b.x - q.a.x) }; } d -= q.len; }
  return { ...p[0], angle: 0 };
}
const r = createRender();
await r.mount(document.getElementById('stage')!, map);
r.onSelect((s) => console.log('select', JSON.stringify(s)));
(window as any).__r = r; (window as any).__s = state;
const fo = new URLSearchParams(location.search).get('focus'); if (fo) { const [x, y] = fo.split(',').map(Number); r.focus(x, y); }
let last = performance.now(), prevT = 0;
const speedUp = new URLSearchParams(location.search).get('t'); if (speedUp) state.time = +speedUp;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  const prev = state.time; state.time += dt; prevT = prev;
  const ev: GameEvent[] = [];
  state.trucks.forEach((t, i) => {
    const p = pose(pts[i], state.time * (110 + i * 30) + i * 300);
    t.x = p.x; t.y = p.y; t.angle = p.angle; t.tank = 50 + 50 * Math.sin(state.time * 0.4 + i);
    const nj = Math.floor(state.time / 6 + i) % 3 === 0 ? 'pumping' : 'toSite';
    t.job = nj;
  });
  for (const c of state.cabins) { c.fill = Math.min(100, c.fill + dt * (4 + (c.slot % 4) * 3)); }
  if (Math.floor(state.time / 5) !== Math.floor(prev / 5)) {
    const c = state.cabins[Math.floor(state.time / 5) % state.cabins.length];
    if (c.fill >= 100) { ev.push({ kind: 'overflowStart', siteId: c.siteId! }); }
    c.fill = 0; ev.push({ kind: 'cabinEmptied', siteId: c.siteId!, cabinId: c.id, tip: 5 }, { kind: 'paid', siteId: c.siteId!, amount: 25 });
  }
  state.events = ev;
  r.update(state, dt);
  requestAnimationFrame(frame);
}
void prevT;
requestAnimationFrame(frame);
