// Simulation for slice 1. Pure TS, no DOM, deterministic (no randomness at all).
// Encoding note: Cabin.siteId === null && slot === -1 -> in depot stock;
//                siteId === null && slot <= -100 -> on board of truck index (-100 - slot).
import type {
  CityMap, LevelDef, UpgradeDef, Save, GameState, Truck, Cabin, SiteState, SiteDef,
  Command, CommandResult, DayResult, GameEvent,
} from './types.ts';
import levelsJson from '../data/levels.json' with { type: 'json' };
import economyJson from '../data/economy.json' with { type: 'json' };

export const LEVELS = levelsJson as unknown as LevelDef[];
export const ECON = economyJson as unknown as {
  cabinCapacity: number; cabinCarry: number; truck: { name: string; speed: number };
  streetSpeedMult: number; sandSpeedMult: number; checkSpeedMult: number; gateSpeedMult: number; dumpRate: number; pumpMinFill: number; feeOverflowTolerance: number;
  starFractions: number[]; upgrades: UpgradeDef[]; wash: { sec: number; bays: number };
};
export const UPGRADES: UpgradeDef[] = ECON.upgrades;

const EPS = 1e-6;
const STOCK_SLOT = -1;

export function newSave(): Save {
  return { coins: 0, level: 1, stars: {}, upgrades: { pump: 0, tank: 0, cabin: 0 } };
}

// ---------- routing ----------
/** True while sim time t is inside one of the level's gateWindows (crowds on the gate roads). No windows -> never. */
export const gateCrowded = (windows: LevelDef['gateWindows'], t: number) => !!windows && windows.some(([a, b]) => t >= a && t < b);
const crowdedNow = (s: GameState) => gateCrowded(s.level.gateWindows, s.time);
/** Speed multiplier of an edge kind; a 'gate' edge is plain asphalt unless its crowd window is open. */
const edgeMult = (kind: string, crowded = false) => (kind === 'street' ? ECON.streetSpeedMult : kind === 'sand' ? ECON.sandSpeedMult : kind === 'check' ? ECON.checkSpeedMult : kind === 'gate' && crowded ? ECON.gateSpeedMult : 1);
const nodeOf = (map: CityMap, id: string) => map.nodes.find((n) => n.id === id)!;
function edgeBetween(map: CityMap, a: string, b: string) {
  return map.edges.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a));
}
function edgeLen(map: CityMap, a: string, b: string): number {
  const p = nodeOf(map, a), q = nodeOf(map, b);
  return Math.hypot(p.x - q.x, p.y - q.y);
}

/** Dijkstra on travel time (street edges cost 1/0.7). `crowded` = gate windows open now. Returns node ids from..to, or [] if unreachable. */
export function route(map: CityMap, from: string, to: string, crowded = false): string[] {
  if (from === to) return [from];
  const dist = new Map<string, number>(), prev = new Map<string, string>();
  const done = new Set<string>();
  for (const n of map.nodes) dist.set(n.id, Infinity);
  dist.set(from, 0);
  for (;;) {
    let cur: string | null = null, best = Infinity;
    for (const n of map.nodes) { // node order = deterministic tie-break
      const d = dist.get(n.id)!;
      if (!done.has(n.id) && d < best) { best = d; cur = n.id; }
    }
    if (cur === null) return [];
    if (cur === to) break;
    done.add(cur);
    for (const e of map.edges) {
      const other = e.a === cur ? e.b : e.b === cur ? e.a : null;
      if (other === null || done.has(other)) continue;
      const nd = best + edgeLen(map, cur, other) / edgeMult(e.kind, crowded);
      if (nd < dist.get(other)!) { dist.set(other, nd); prev.set(other, cur); }
    }
  }
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0])!);
  return path;
}

/** Travel time in seconds along a node path at the given base speed. */
export function pathTime(map: CityMap, path: string[], speed: number, crowded = false): number {
  let t = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const e = edgeBetween(map, path[i], path[i + 1])!;
    t += edgeLen(map, path[i], path[i + 1]) / (speed * edgeMult(e.kind, crowded));
  }
  return t;
}

// ---------- helpers ----------
const siteOf = (s: GameState, id: string) => s.sites.find((x) => x.def.id === id);
const cabinsAt = (s: GameState, siteId: string) => s.cabins.filter((c) => c.siteId === siteId);
const inDepot = (s: GameState) => s.cabins.filter((c) => c.siteId === null && c.slot === STOCK_SLOT);
const stock = (s: GameState) => inDepot(s).filter((c) => c.washT <= 0); // clean, ready to deliver
const boardSlot = (s: GameState, t: Truck) => -100 - s.trucks.indexOf(t);
const spotOf = (s: GameState, site: SiteState) => s.map.spots.find((p) => p.id === site.def.spotId)!;
const overflowFlags = new WeakMap<SiteState, boolean>();

function setPose(s: GameState, t: Truck) {
  const last = t.path.length - 1;
  if (t.seg >= last) {
    const n = nodeOf(s.map, t.path[last]);
    t.x = n.x; t.y = n.y; t.seg = last; t.segT = 0;
    return;
  }
  const a = nodeOf(s.map, t.path[t.seg]), b = nodeOf(s.map, t.path[t.seg + 1]);
  t.x = a.x + (b.x - a.x) * t.segT; t.y = a.y + (b.y - a.y) * t.segT;
  t.angle = Math.atan2(b.y - a.y, b.x - a.x);
}

function startRoute(s: GameState, t: Truck, to: string): boolean {
  const from = t.path[t.path.length - 1];
  const p = route(s.map, from, to, crowdedNow(s));
  if (p.length === 0) return false;
  t.path = p; t.seg = 0; t.segT = 0;
  setPose(s, t);
  return true;
}

/** Re-route a moving/standing truck to `to`, allowed to turn around mid-edge. */
function retarget(s: GameState, t: Truck, to: string) {
  const last = t.path.length - 1;
  if (t.seg >= last || t.segT === 0) {
    t.path = [t.path[Math.min(t.seg, last)]]; t.seg = 0; t.segT = 0;
    startRoute(s, t, to);
    return;
  }
  const a = t.path[t.seg], b = t.path[t.seg + 1];
  const cr = crowdedNow(s);
  const len = edgeLen(s.map, a, b), mult = edgeMult(edgeBetween(s.map, a, b)!.kind, cr);
  const fwdRoute = route(s.map, b, to, cr), backRoute = route(s.map, a, to, cr);
  const fwd = (1 - t.segT) * len / mult + pathTime(s.map, fwdRoute, 1, cr) * 1;
  const back = t.segT * len / mult + pathTime(s.map, backRoute, 1, cr) * 1;
  if (fwd <= back) { t.path = [a, ...fwdRoute]; } // keep going to b, then route
  else { t.path = [b, ...backRoute]; t.segT = 1 - t.segT; } // turn around
  t.seg = 0;
  setPose(s, t);
}

// ---------- day creation ----------
export function createDay(level: LevelDef, map: CityMap, save: Save): GameState {
  const pump = UPGRADES.find((u) => u.id === 'pump')!.values[save.upgrades.pump];
  const tank = Math.min(UPGRADES.find((u) => u.id === 'tank')!.values[save.upgrades.tank], level.maxTank ?? Infinity);
  const cabinCount = UPGRADES.find((u) => u.id === 'cabin')!.values[save.upgrades.cabin];
  const dn = nodeOf(map, map.depotNodeId);
  const truck: Truck = {
    id: 't1', name: level.maxTank ? 'המשאית הקטנה' : ECON.truck.name, job: 'idle', path: [map.depotNodeId], seg: 0, segT: 0,
    x: dn.x, y: dn.y, angle: 0, tank: 0, tankCap: tank, pumpRate: pump, speed: ECON.truck.speed,
    targetSiteId: null, carrying: 0,
  };
  const cabins: Cabin[] = [];
  for (let i = 0; i < cabinCount; i++) {
    cabins.push({ id: `c${i + 1}`, siteId: null, slot: STOCK_SLOT, fill: 0, capacity: ECON.cabinCapacity, washT: 0 });
  }
  const sites: SiteState[] = level.sites.map((def) => {
    const spot = map.spots.find((p) => p.id === def.spotId)!;
    return { def, open: false, closed: false, overflowSec: 0, earned: 0, x: spot.x, y: spot.y };
  });
  return { level, map, time: 0, over: false, coinsStart: save.coins, coins: save.coins, trucks: [truck], cabins, sites, events: [] };
}

// ---------- usage ----------
function usageAt(def: SiteDef, time: number): number {
  const u = def.usage, t = time - def.openAt;
  if (u.length === 0) return 0;
  if (t <= u[0][0]) return u[0][1];
  for (let i = 1; i < u.length; i++) {
    if (t <= u[i][0]) {
      const [t0, v0] = u[i - 1], [t1, v1] = u[i];
      return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
  }
  return u[u.length - 1][1];
}

function addCoins(s: GameState, delta: number) { s.coins = Math.max(0, s.coins + delta); }

function closeSite(s: GameState, site: SiteState) {
  site.open = false; site.closed = true;
  if (overflowFlags.get(site)) { overflowFlags.set(site, false); s.events.push({ kind: 'overflowEnd', siteId: site.def.id }); }
  s.events.push({ kind: 'siteClose', siteId: site.def.id });
  if (site.overflowSec <= ECON.feeOverflowTolerance) {
    site.earned += site.def.fee; addCoins(s, site.def.fee);
    s.events.push({ kind: 'paid', siteId: site.def.id, amount: site.def.fee });
  }
  // ponytail: cabins are hauled back instantly; a pickup trip is a later mechanic
  for (const c of cabinsAt(s, site.def.id)) { c.siteId = null; c.slot = STOCK_SLOT; c.fill = 0; c.washT = ECON.wash.sec; }
}

/** Wash center: the first `bays` dirty cabins in the depot wash in parallel. */
function stepWash(s: GameState, dt: number) {
  let bays = ECON.wash.bays;
  for (const c of inDepot(s)) {
    if (c.washT <= 0 || bays-- <= 0) continue;
    c.washT -= dt;
    if (c.washT <= EPS) { c.washT = 0; s.events.push({ kind: 'washed', cabinId: c.id }); }
  }
}

// ---------- step ----------
export function step(s: GameState, dt: number): void {
  s.events = [];
  if (s.over) return;
  s.time += dt;

  for (const site of s.sites) {
    if (!site.open && !site.closed && s.time >= site.def.openAt) {
      site.open = true; s.events.push({ kind: 'siteOpen', siteId: site.def.id });
    }
    if (site.open && s.time >= site.def.closeAt) closeSite(s, site);
  }

  for (const site of s.sites) if (site.open) stepSite(s, site, dt);
  for (const t of s.trucks) stepTruck(s, t, dt);
  stepWash(s, dt);

  if (s.time >= s.level.dayLength) {
    for (const site of s.sites) if (!site.closed) closeSite(s, site);
    for (const c of s.cabins) if (c.siteId !== null) { c.siteId = null; c.slot = STOCK_SLOT; c.fill = 0; }
    s.over = true; s.events.push({ kind: 'dayEnd' });
  }
}

function stepSite(s: GameState, site: SiteState, dt: number) {
  const id = site.def.id;
  const cabs = cabinsAt(s, id);
  let liters = usageAt(site.def, s.time) * dt;
  while (liters > EPS && cabs.length > 0) {
    let low: Cabin | null = null;
    for (const c of cabs) if (c.fill < c.capacity - EPS && (low === null || c.fill < low.fill)) low = c;
    if (low === null) break;
    const put = Math.min(liters, low.capacity - low.fill);
    low.fill += put; liters -= put;
  }
  const overflowing = cabs.length === 0 || liters > EPS;
  const was = overflowFlags.get(site) === true;
  if (overflowing) {
    const before = Math.floor(site.overflowSec * site.def.overflowFinePerSec + EPS);
    site.overflowSec += dt;
    const delta = Math.floor(site.overflowSec * site.def.overflowFinePerSec + EPS) - before;
    if (delta > 0) { addCoins(s, -delta); s.events.push({ kind: 'fine', siteId: id, amount: delta }); }
  }
  if (overflowing && !was) s.events.push({ kind: 'overflowStart', siteId: id });
  if (!overflowing && was) s.events.push({ kind: 'overflowEnd', siteId: id });
  overflowFlags.set(site, overflowing);
}

function stepTruck(s: GameState, t: Truck, dt: number) {
  if (t.job === 'toSite' || t.job === 'toDepot' || t.job === 'delivering') {
    if (move(s, t, dt)) arrive(s, t);
  } else if (t.job === 'pumping') {
    pump(s, t, dt);
  } else if (t.job === 'dumping') {
    t.tank = Math.max(0, t.tank - ECON.dumpRate * dt);
    if (t.tank <= EPS) { t.tank = 0; t.job = 'idle'; t.targetSiteId = null; }
  }
}

/** Advance along the path; true when the end node is reached. */
function move(s: GameState, t: Truck, dt: number): boolean {
  let dist = t.speed * dt;
  const last = t.path.length - 1, cr = crowdedNow(s);
  while (t.seg < last) {
    const a = t.path[t.seg], b = t.path[t.seg + 1];
    const len = edgeLen(s.map, a, b);
    const eff = edgeMult(edgeBetween(s.map, a, b)!.kind, cr);
    const remain = (1 - t.segT) * len; // px left on this edge
    const cost = remain / eff; // "speed-px" needed
    if (dist >= cost) { dist -= cost; t.seg++; t.segT = 0; }
    else { t.segT += (dist * eff) / len; dist = 0; break; }
  }
  setPose(s, t);
  return t.seg >= last;
}

function arrive(s: GameState, t: Truck) {
  const atDepot = t.path[t.path.length - 1] === s.map.depotNodeId;
  if (t.job === 'toSite') { t.job = 'pumping'; return; }
  // toDepot ends at the depot or at a satellite dump (map.dumps): a dump empties the tank only, no stock/wash there
  if (t.job === 'toDepot') { if (atDepot) unloadToStock(s, t); t.job = 'dumping'; if (t.tank <= EPS) { t.tank = 0; t.job = 'idle'; t.targetSiteId = null; } return; }
  if (t.job === 'delivering') {
    if (atDepot) { unloadToStock(s, t); t.job = 'idle'; t.targetSiteId = null; return; }
    const site = t.targetSiteId ? siteOf(s, t.targetSiteId) : undefined;
    if (site && !site.closed) placeCarried(s, t, site);
    startRoute(s, t, s.map.depotNodeId);
  }
}

function placeCarried(s: GameState, t: Truck, site: SiteState) {
  const spot = spotOf(s, site), mine = boardSlot(s, t);
  const used = new Set(cabinsAt(s, site.def.id).map((c) => c.slot));
  let placed = 0;
  for (const c of s.cabins) {
    if (c.siteId !== null || c.slot !== mine) continue;
    let slot = -1;
    for (let i = 0; i < spot.slots.length; i++) if (!used.has(i)) { slot = i; break; }
    if (slot < 0) break; // no room left: remaining cabins ride back
    used.add(slot); c.siteId = site.def.id; c.slot = slot; c.fill = 0; placed++;
  }
  t.carrying -= placed;
  if (placed > 0) s.events.push({ kind: 'delivered', siteId: site.def.id, count: placed });
}

function unloadToStock(s: GameState, t: Truck) {
  const mine = boardSlot(s, t);
  for (const c of s.cabins) if (c.siteId === null && c.slot === mine) c.slot = STOCK_SLOT;
  t.carrying = 0;
}

function pump(s: GameState, t: Truck, dt: number) {
  const site = t.targetSiteId ? siteOf(s, t.targetSiteId) : undefined;
  let budget = t.pumpRate * dt;
  if (site && !site.closed) {
    while (budget > EPS && t.tankCap - t.tank > EPS) {
      let top: Cabin | null = null;
      for (const c of cabinsAt(s, site.def.id)) {
        if (!pumpable(c)) continue;
        // finish the cabin already being drained first (one by one), else take the fullest
        if (top === null || (partial.has(c) && !partial.has(top)) || (partial.has(c) === partial.has(top) && c.fill > top.fill)) top = c;
      }
      if (top === null) break;
      const take = Math.min(budget, top.fill, t.tankCap - t.tank);
      top.fill -= take; t.tank += take; budget -= take;
      if (top.fill > EPS) { partial.add(top); } // partly drained: keep working on it next step
      else {
        top.fill = 0; partial.delete(top);
        site.earned += site.def.serviceTip; addCoins(s, site.def.serviceTip);
        s.events.push({ kind: 'cabinEmptied', siteId: site.def.id, cabinId: top.id, tip: site.def.serviceTip });
      }
      if (take <= EPS) break;
    }
    const more = cabinsAt(s, site.def.id).some(pumpable);
    if (more && t.tankCap - t.tank > EPS) return; // keep pumping
  }
  t.job = 'toDepot';
  startRoute(s, t, dumpTarget(s, t));
  if (t.path.length === 1) arrive(s, t);
}
/** Where a full truck goes to empty: the depot, or a satellite dump (map.dumps) that is faster from here right now. No dumps -> depot. */
function dumpTarget(s: GameState, t: Truck): string {
  const from = t.path[t.path.length - 1], cr = crowdedNow(s);
  let best = s.map.depotNodeId, bestT = pathTime(s.map, route(s.map, from, best, cr), t.speed, cr);
  for (const d of s.map.dumps ?? []) {
    const p = route(s.map, from, d.nodeId, cr);
    if (p.length === 0) continue;
    const tt = pathTime(s.map, p, t.speed, cr);
    if (tt < bestT) { best = d.nodeId; bestT = tt; }
  }
  return best;
}
const partial = new WeakSet<Cabin>(); // cabins already being drained (finish them even below pumpMinFill)
const pumpable = (c: Cabin) => c.fill > EPS && (c.fill >= ECON.pumpMinFill || partial.has(c));

// ---------- commands ----------
const no = (reason: string): CommandResult => ({ ok: false, reason });
const atDepotIdle = (s: GameState, t: Truck) => t.job === 'idle' && t.path[t.path.length - 1] === s.map.depotNodeId;

export function command(s: GameState, c: Command): CommandResult {
  if (s.over) return no('היום נגמר');
  const t = s.trucks.find((x) => x.id === c.truckId);
  if (!t) return no('המשאית לא נמצאה');
  if (c.type === 'recall') {
    const home = t.path[t.path.length - 1] === s.map.depotNodeId; // false at / on the way to a satellite dump
    if ((t.job === 'idle' || t.job === 'dumping') && home) return no('המשאית כבר במחסן');
    if (t.job === 'toDepot' && home) return no('המשאית כבר חוזרת למחסן');
    t.job = 'toDepot';
    retarget(s, t, s.map.depotNodeId);
    if (t.path.length === 1) arrive(s, t);
    return { ok: true };
  }
  const site = siteOf(s, c.siteId);
  if (!site) return no('האתר לא נמצא');
  if (t.job !== 'idle') return no('המשאית עסוקה');
  if (site.closed) return no('האתר כבר סגור');
  if (c.type === 'service') {
    if (!site.open) return no('האתר עדיין לא נפתח');
    if (cabinsAt(s, site.def.id).length === 0) return no('אין באתר תאים לשאיבה, קודם צריך לספק תאים');
    t.targetSiteId = site.def.id; t.job = 'toSite';
    if (!startRoute(s, t, spotOf(s, site).nodeId)) { t.job = 'idle'; t.targetSiteId = null; return no('אין דרך לאתר'); }
    if (t.path.length === 1) t.job = 'pumping';
    return { ok: true };
  }
  // deliver: cabins load only at the depot (a truck parked at a satellite dump must come back first)
  if (!atDepotIdle(s, t)) return no('כדי להעמיס תאים המשאית צריכה לחזור למחסן');
  const spot = spotOf(s, site);
  const free = spot.slots.length - cabinsAt(s, site.def.id).length;
  const avail = stock(s);
  if (avail.length === 0) return no('אין תאים פנויים במחסן');
  if (free <= 0) return no('אין מקום פנוי באתר');
  const n = Math.min(Math.floor(c.count), ECON.cabinCarry, avail.length, free);
  if (!(n >= 1)) return no('צריך לבחור לפחות תא אחד');
  const mine = boardSlot(s, t);
  for (let i = 0; i < n; i++) avail[i].slot = mine;
  t.carrying = n; t.targetSiteId = site.def.id; t.job = 'delivering';
  if (!startRoute(s, t, spot.nodeId)) { unloadToStock(s, t); t.job = 'idle'; t.targetSiteId = null; return no('אין דרך לאתר'); }
  if (t.path.length === 1) arrive(s, t);
  return { ok: true };
}

// ---------- results ----------
function totals(s: GameState) {
  let earned = 0, fines = 0, overflowSec = 0;
  for (const site of s.sites) {
    earned += site.earned; overflowSec += site.overflowSec;
    fines += Math.floor(site.overflowSec * site.def.overflowFinePerSec + EPS);
  }
  return { earned, fines, overflowSec };
}

export function dayResult(s: GameState): DayResult {
  const { earned, fines, overflowSec } = totals(s);
  const net = earned - fines, target = s.level.coinTarget;
  // design/CONTENT.md: 1 = finished the day in profit, 2 = no overflow, 3 = no overflow + coin target
  const clean = overflowSec <= ECON.feeOverflowTolerance;
  const stars = !s.over || net <= 0 ? 0 : !clean ? 1 : net >= target ? 3 : 2; // survived = day ended in profit
  return { levelId: s.level.id, stars: stars as 0 | 1 | 2 | 3, earned, fines, overflowSec, coinTarget: target };
}

export function applyResult(save: Save, r: DayResult): Save {
  const prev = save.stars[r.levelId] ?? 0;
  const advance = r.stars >= 1 ? Math.min(r.levelId + 1, LEVELS.length) : save.level;
  return {
    coins: save.coins + Math.max(0, r.earned - r.fines),
    level: Math.max(save.level, advance),
    stars: { ...save.stars, [r.levelId]: Math.max(prev, r.stars) },
    upgrades: { ...save.upgrades },
  };
}

export function buyUpgrade(save: Save, id: UpgradeDef['id']): { ok: boolean; save: Save; reason?: string } {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u) return { ok: false, save, reason: 'שדרוג לא נמצא' };
  const lvl = save.upgrades[id];
  if (lvl >= u.costs.length) return { ok: false, save, reason: 'השדרוג כבר במקסימום' };
  if (save.coins < u.costs[lvl]) return { ok: false, save, reason: 'אין מספיק מטבעות' };
  return { ok: true, save: { ...save, coins: save.coins - u.costs[lvl], upgrades: { ...save.upgrades, [id]: lvl + 1 } } };
}
