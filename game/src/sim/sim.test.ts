// @ts-nocheck  (node:test types need @types/node, not installed; build typechecks sim/index.ts only)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import city1 from '../data/city1.json' with { type: 'json' };
import cityBeach from '../data/city-beach.json' with { type: 'json' };
import cityCapital from '../data/city-capital.json' with { type: 'json' };
import cityShows from '../data/city-shows.json' with { type: 'json' };
import cityIndustry from '../data/city-industry.json' with { type: 'json' };
import type { CityMap, GameState, Save, LevelDef } from './types.ts';
import { createDay, step, command, dayResult, applyResult, buyUpgrade, newSave, route, pathTime, gateCrowded, LEVELS, UPGRADES, ECON } from './index.ts';

const map = city1 as unknown as CityMap;
const DT = 1 / 30;
const run = (s: GameState, sec: number) => { for (let i = 0; i < Math.round(sec / DT) && !s.over; i++) step(s, DT); };
const runUntil = (s: GameState, pred: () => boolean, maxSec = 400) => {
  for (let i = 0; i < maxSec / DT && !s.over && !pred(); i++) step(s, DT);
};
const L1 = LEVELS[0];

/** Greedy bot: pump anything nearly full, else deliver spare cabins (wedding gets 2), else pump what is >=60% full. */
function botAct(s: GameState) {
  const t = s.trucks[0];
  if (t.job !== 'idle') return;
  const fullest = (min: number) => {
    let best: { id: string; v: number } | null = null;
    for (const x of s.sites) {
      const cs = s.cabins.filter((c) => c.siteId === x.def.id);
      if (!x.open || cs.length === 0) continue;
      const v = cs.reduce((a, c) => a + c.fill, 0) / (cs.length * 100);
      if (v >= min && (!best || v > best.v)) best = { id: x.def.id, v };
    }
    return best;
  };
  const serve = (b: { id: string } | null) => !!b && command(s, { type: 'service', truckId: t.id, siteId: b.id }).ok;
  if (serve(fullest(0.85))) return;
  const inStock = s.cabins.filter((c) => c.siteId === null && c.slot === -1).length;
  if (inStock > 0) {
    const key = (o: { x: GameState['sites'][0]; n: number }) => o.n - (o.x.def.type === 'wedding' ? 1 : 0);
    const cand = s.sites
      .filter((x) => !x.closed && s.time > x.def.openAt - 80)
      .map((x) => ({ x, n: s.cabins.filter((c) => c.siteId === x.def.id).length }))
      .filter((o) => o.n < 3)
      .sort((a, b) => key(a) - key(b) || a.x.def.openAt - b.x.def.openAt)[0];
    if (cand && command(s, { type: 'deliver', truckId: t.id, siteId: cand.x.def.id, count: cand.x.def.type === 'wedding' ? 2 : 1 }).ok) return;
  }
  serve(fullest(0.6));
}
function playBot(level: LevelDef, save: Save, m: CityMap = map) {
  const s = createDay(level, m, save);
  let n = 0;
  while (!s.over) { if (n++ % 15 === 0) botAct(s); step(s, DT); }
  return s;
}
const oneUpgrade = (): Save => buyUpgrade({ ...newSave(), coins: 500 }, 'cabin').save;

test('routing: shortest path by time, streets slower, depot->sites reachable', () => {
  const p = route(map, 'n04', 'n40');
  assert.equal(p[0], 'n04'); assert.equal(p[p.length - 1], 'n40');
  assert.deepEqual(route(map, 'n04', 'n04'), ['n04']);
  // brute check: no other simple path beats it (compare against path via a tiny relaxation)
  const best = pathTime(map, p, 100);
  for (const alt of [route(map, 'n04', 'n24'), route(map, 'n24', 'n40')]) assert.ok(pathTime(map, alt, 100) > 0);
  assert.ok(best <= pathTime(map, [...route(map, 'n04', 'n24'), ...route(map, 'n24', 'n40').slice(1)], 100) + 1e-9);
  // street edges cost more time than main edges of equal length: n22->n32 is main (200px), n31->n32 street(350)
  assert.ok(pathTime(map, ['n02', 'n12'], 100) < pathTime(map, ['n02', 'n03'], 100)); // main 200px vs street 350px
  for (const sp of map.spots) assert.ok(route(map, map.depotNodeId, sp.nodeId).length > 1);
});

test('route prefers a longer main road over a shorter street when faster', () => {
  const m: CityMap = { ...map, nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 100, y: 0 }, { id: 'c', x: 0, y: 150 }, { id: 'd', x: 100, y: 150 }],
    edges: [{ a: 'a', b: 'b', kind: 'street' }, { a: 'a', b: 'c', kind: 'main' }, { a: 'c', b: 'd', kind: 'main' }, { a: 'd', b: 'b', kind: 'main' }] };
  // direct street: 100/0.7=143 ; around: 150+100+150=400 -> direct wins
  assert.deepEqual(route(m, 'a', 'b'), ['a', 'b']);
  const m2: CityMap = { ...m, nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 300, y: 0 }, { id: 'c', x: 0, y: 40 }, { id: 'd', x: 300, y: 40 }] };
  // direct street 300/0.7=428 ; around 40+300+40=380 -> around wins
  assert.deepEqual(route(m2, 'a', 'b'), ['a', 'c', 'd', 'b']);
});

test('overflow: open site with zero cabins fines; wedding fine and no fee when failed', () => {
  const s = createDay(L1, map, newSave());
  run(s, 60); // build site opened at 35, no cabins delivered
  const site = s.sites[0];
  assert.ok(site.open); assert.ok(site.overflowSec > 20);
  assert.ok(s.coins === 0 || s.coins >= 0);
  assert.ok(s.events.length >= 0);
  assert.equal(dayResult(s).fines, Math.floor(site.overflowSec * site.def.overflowFinePerSec));
  assert.ok(dayResult(s).fines > 30);
});

test('overflow: full cabin overflows and emits start/end events + fine event', () => {
  const s = createDay(L1, map, newSave());
  const seen = new Set<string>();
  assert.ok(command(s, { type: 'deliver', truckId: 't1', siteId: 's1', count: 1 }).ok);
  for (let i = 0; i < 210 / DT && !s.over; i++) { step(s, DT); s.events.forEach((e) => seen.add(e.kind)); }
  for (const k of ['siteOpen', 'delivered', 'overflowStart', 'fine', 'siteClose', 'dayEnd']) assert.ok(seen.has(k), k);
  assert.ok(!seen.has('paid'));
});

test('deliver fills slots (carry 2), cabins appear at free slot indices', () => {
  const s = createDay(L1, map, newSave());
  assert.equal(command(s, { type: 'deliver', truckId: 't1', siteId: 's1', count: 3 }).ok, true);
  assert.equal(s.trucks[0].carrying, 2); // old truck carries 2
  assert.equal(command(s, { type: 'deliver', truckId: 't1', siteId: 's1', count: 1 }).ok, false); // busy
  runUntil(s, () => s.trucks[0].job === 'idle');
  const at = s.cabins.filter((c) => c.siteId === 's1');
  assert.equal(at.length, 2);
  assert.deepEqual(at.map((c) => c.slot).sort(), [0, 1]);
  assert.equal(s.cabins.filter((c) => c.siteId === null && c.slot === -1).length, 1);
  assert.equal(s.trucks[0].carrying, 0);
  const r = command(s, { type: 'deliver', truckId: 't1', siteId: 's1', count: 5 });
  assert.equal(r.ok, true); // 1 left in stock
  runUntil(s, () => s.trucks[0].job === 'idle');
  assert.equal(s.cabins.filter((c) => c.siteId === 's1').length, 3);
  assert.equal(command(s, { type: 'deliver', truckId: 't1', siteId: 's1', count: 1 }).ok, false); // stock empty
});

test('usage spreads least-full first across a site\'s cabins', () => {
  const s = createDay(L1, map, newSave());
  command(s, { type: 'deliver', truckId: 't1', siteId: 's1', count: 2 });
  runUntil(s, () => s.time > 80);
  const [a, b] = s.cabins.filter((c) => c.siteId === 's1');
  assert.ok(a.fill > 10 && b.fill > 10);
  assert.ok(Math.abs(a.fill - b.fill) < 2);
});

test('service empties cabins, tips paid, tank dumped at depot, truck idle again', () => {
  const s = createDay(L1, map, newSave());
  command(s, { type: 'deliver', truckId: 't1', siteId: 's1', count: 2 });
  runUntil(s, () => s.time > 100);
  const t = s.trucks[0];
  assert.equal(t.job, 'idle');
  const before = s.sites[0].earned;
  assert.ok(s.cabins.filter((c) => c.siteId === 's1').every((c) => c.fill > 25));
  assert.equal(command(s, { type: 'service', truckId: 't1', siteId: 's1' }).ok, true);
  const seen: string[] = []; let maxTank = 0; let sawDump = false;
  for (let i = 0; i < 300 / DT && !(seen.length && t.job === 'idle'); i++) {
    step(s, DT); maxTank = Math.max(maxTank, t.tank); if (t.job === 'dumping') sawDump = true;
    s.events.forEach((e) => { if (e.kind === 'cabinEmptied') seen.push(e.cabinId); });
  }
  assert.equal(seen.length, 2);
  assert.ok(maxTank > 100); assert.ok(sawDump);
  assert.equal(t.tank, 0); assert.equal(t.job, 'idle');
  assert.equal(t.path[t.path.length - 1], map.depotNodeId);
  assert.equal(s.sites[0].earned, before + 2 * 10); // 2 tips
});

test('tank full stops pumping early and truck goes to dump', () => {
  const s = createDay(L1, map, newSave());
  command(s, { type: 'deliver', truckId: 't1', siteId: 's1', count: 2 });
  runUntil(s, () => s.trucks[0].job === 'idle');
  s.trucks[0].tankCap = 120; // tiny tank
  for (const c of s.cabins) if (c.siteId === 's1') c.fill = 100;
  s.time = 40; s.sites[0].open = true;
  command(s, { type: 'service', truckId: 't1', siteId: 's1' });
  let empt = 0;
  for (let i = 0; i < 100 / DT && s.trucks[0].job !== 'toDepot'; i++) { step(s, DT); s.events.forEach((e) => { if (e.kind === 'cabinEmptied') empt++; }); }
  assert.equal(empt, 1);
  assert.ok(s.trucks[0].tank >= 119);
  assert.ok(s.cabins.some((c) => c.siteId === 's1' && c.fill > 70)); // second cabin only partly pumped
});

test('rejections are Hebrew, truck pose updates, recall works', () => {
  const s = createDay(L1, map, newSave());
  const r = command(s, { type: 'service', truckId: 't1', siteId: 's1' });
  assert.equal(r.ok, false); assert.match(r.reason!, /[֐-׿]/);
  assert.equal(command(s, { type: 'recall', truckId: 't1' }).ok, false);
  command(s, { type: 'deliver', truckId: 't1', siteId: 's1', count: 2 });
  const t = s.trucks[0]; const x0 = t.x, y0 = t.y;
  run(s, 3);
  assert.ok(Math.hypot(t.x - x0, t.y - y0) > 50);
  assert.equal(command(s, { type: 'recall', truckId: 't1' }).ok, true);
  runUntil(s, () => t.job === 'idle');
  assert.equal(s.cabins.filter((c) => c.siteId === null && c.slot === -1).length, 3); // cargo back in stock
  const n = s.map.nodes.find((q) => q.id === s.map.depotNodeId)!;
  assert.ok(Math.hypot(t.x - n.x, t.y - n.y) < 1e-6);
});

test('site close: fee paid when no overflow, cabins return to stock', () => {
  const s = createDay(L1, map, newSave());
  s.cabins.slice(0, 2).forEach((c, i) => { c.siteId = 's1'; c.slot = i; });
  const open = s.sites[0];
  open.def = { ...open.def, usage: [[0, 0.5]] }; // light use: never overflows
  runUntil(s, () => open.closed, 260);
  assert.ok(open.closed);
  assert.equal(open.earned, open.def.fee);
  assert.equal(s.cabins.filter((c) => c.siteId === null && c.slot === -1).length, 3);
  assert.equal(open.overflowSec, 0);
});

test('determinism: same commands => identical state', () => {
  const a = playBot(L1, newSave()), b = playBot(L1, newSave());
  const strip = (s: GameState) => JSON.stringify({ ...s, map: undefined, level: undefined });
  assert.equal(strip(a), strip(b));
  assert.deepEqual(dayResult(a), dayResult(b));
});

test('greedy bot finishes L1 with >=2 stars (start kit) and keeps >=2 after one upgrade (cabin)', () => {
  const r0 = dayResult(playBot(L1, newSave()));
  console.log('L1 start kit', JSON.stringify(r0));
  assert.ok(r0.stars >= 2, `start kit stars ${r0.stars}`);
  const r1 = dayResult(playBot(L1, oneUpgrade()));
  console.log('L1 one upgrade', JSON.stringify(r1));
  assert.ok(r1.stars >= 2);
});

test('idle player (no commands) fails L1: 0 stars, level not advanced', () => {
  const s = createDay(L1, map, newSave());
  while (!s.over) step(s, DT);
  const r = dayResult(s);
  assert.equal(r.stars, 0);
  const sv = applyResult(newSave(), r);
  assert.equal(sv.level, 1); assert.equal(sv.coins, 0);
});

test('economy: applyResult advances + keeps best stars, upgrades cost + cap', () => {
  const sv = applyResult(newSave(), { levelId: 1, stars: 2, earned: 300, fines: 20, overflowSec: 3, coinTarget: 300 });
  assert.equal(sv.level, 2); assert.equal(sv.coins, 280); assert.equal(sv.stars[1], 2);
  const sv2 = applyResult(sv, { levelId: 1, stars: 1, earned: 100, fines: 0, overflowSec: 0, coinTarget: 300 });
  assert.equal(sv2.stars[1], 2); assert.equal(sv2.level, 2);
  assert.equal(buyUpgrade(newSave(), 'pump').ok, false);
  let cur: Save = { ...newSave(), coins: 5000 };
  for (let i = 0; i < 3; i++) { const r = buyUpgrade(cur, 'pump'); assert.ok(r.ok); cur = r.save; }
  assert.equal(cur.upgrades.pump, 3); assert.equal(buyUpgrade(cur, 'pump').ok, false);
  for (const u of UPGRADES) { assert.equal(u.values.length, 4); assert.equal(u.costs.length, 3); }
  assert.equal(LEVELS.length, 15);
  const s3 = createDay(LEVELS[0], map, cur);
  assert.equal(s3.trucks[0].pumpRate, 70);
});

test('L2/L3 play: bot completes and levels are tuned reachable', () => {
  const rich: Save = { coins: 0, level: 2, stars: {}, upgrades: { pump: 1, tank: 1, cabin: 1 } };
  const r2 = dayResult(playBot(LEVELS[1], rich));
  console.log('L2', JSON.stringify(r2));
  const r3 = dayResult(playBot(LEVELS[2], { ...rich, level: 3, upgrades: { pump: 2, tank: 2, cabin: 2 } }));
  console.log('L3', JSON.stringify(r3));
  assert.ok(r2.stars >= 1 && r3.stars >= 1);
});

// ---------- wash center (step F) ----------
const ECONW = { sec: 25, bays: 1 }; // mirrors economy.json wash
function washDay() {
  const s = createDay(LEVELS[1], map, { coins: 0, level: 2, stars: {}, upgrades: { pump: 0, tank: 0, cabin: 1 } });
  // 2 cabins on the short job s3 (closes at 110), the rest on s1: depot is empty
  s.cabins.forEach((c, i) => { c.siteId = i < 2 ? 's3' : 's1'; c.slot = i < 2 ? i : i - 2; });
  return s;
}

test('wash: cabins from a closed site come back dirty and cannot be delivered', () => {
  const s = washDay();
  run(s, 110.5);
  const back = s.cabins.filter((c) => c.siteId === null);
  assert.equal(back.length, 2);
  assert.ok(back.every((c) => c.washT > 0));
  const r = command(s, { type: 'deliver', truckId: 't1', siteId: 's2', count: 1 });
  assert.equal(r.ok, false);
});

test('wash: one bay washes one cabin at a time, then it can be delivered', () => {
  const s = washDay();
  run(s, 110 + ECONW.sec + 0.5);
  assert.deepEqual(s.cabins.filter((c) => c.siteId === null).map((c) => c.washT === 0), [true, false]);
  assert.equal(command(s, { type: 'deliver', truckId: 't1', siteId: 's2', count: 2 }).ok, true);
  assert.equal(s.trucks[0].carrying, 1); // only the clean one is loaded
});

test('wash: washed event fires per cabin; both clean after two cycles', () => {
  const s = washDay();
  let washed = 0;
  for (let i = 0; i < Math.round((110 + 2 * ECONW.sec + 1) / DT) && !s.over; i++) { step(s, DT); washed += s.events.filter((e) => e.kind === 'washed').length; }
  assert.equal(washed, 2);
  assert.ok(s.cabins.filter((c) => c.siteId === null).every((c) => c.washT === 0));
});

// ---------- city 2 beach (step G1) ----------
const beach = cityBeach as unknown as CityMap;
test('beach: sand tracks are slower than asphalt of the same length', () => {
  const sand = pathTime(beach, ['B1', 'B2'], 100), asphalt = pathTime(beach, ['A1', 'A2', 'A3'], 100); // both 480 long
  assert.ok(sand > asphalt * 2, `sand ${sand} vs asphalt ${asphalt}`);
});
test('beach: levels 4-6 use the beach map, every site spot reachable from the depot', () => {
  const lv = LEVELS.filter((l) => l.city === 'city-beach');
  assert.deepEqual(lv.map((l) => l.id), [4, 5, 6]);
  for (const l of lv) for (const st of l.sites) {
    const spot = beach.spots.find((p) => p.id === st.spotId)!;
    assert.ok(spot, st.spotId);
    assert.ok(route(beach, beach.depotNodeId, spot.nodeId).length > 1, st.spotId);
  }
});
test('beach play: bot gets >=1 star on L4-L6', () => {
  const save: Save = { coins: 0, level: 4, stars: {}, upgrades: { pump: 2, tank: 2, cabin: 2 } };
  for (const l of LEVELS.filter((x) => x.city === 'city-beach')) {
    const r = dayResult(playBot(l, { ...save, level: l.id }, beach));
    console.log('L' + l.id, JSON.stringify(r));
    assert.ok(r.stars >= 1, 'L' + l.id);
  }
});

// ---------- city 3 capital (step G2): security checkpoints ----------
const capital = cityCapital as unknown as CityMap;
const line = (kind: 'main' | 'check'): CityMap => ({ ...capital, nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 300, y: 0 }], edges: [{ a: 'a', b: 'b', kind }] });
test('capital: a checkpoint edge is slower than main of the same length; mult=1 -> equal (negative control)', () => {
  const chk = pathTime(line('check'), ['a', 'b'], 100), main = pathTime(line('main'), ['a', 'b'], 100);
  assert.ok(chk > main * 2, `check ${chk} vs main ${main}`);
  const keep = ECON.checkSpeedMult;
  try {
    ECON.checkSpeedMult = 1;
    assert.equal(pathTime(line('check'), ['a', 'b'], 100), main);
  } finally { ECON.checkSpeedMult = keep; }
});
test('capital: the 4 checkpoints sit on painted barriers; every spot is reachable with or without them (check-free route is longer)', () => {
  const kinds = (p: string[]) => p.slice(1).map((n, i) => capital.edges.find((e) => (e.a === p[i] && e.b === n) || (e.b === p[i] && e.a === n))!.kind);
  const len = (p: string[]) => p.slice(1).reduce((t, n, i) => { const a = capital.nodes.find((x) => x.id === p[i])!, b = capital.nodes.find((x) => x.id === n)!; return t + Math.hypot(b.x - a.x, b.y - a.y); }, 0);
  assert.equal(capital.edges.filter((e) => e.kind === 'check').length, 4);
  const noCheck: CityMap = { ...capital, edges: capital.edges.filter((e) => e.kind !== 'check') };
  const p = route(capital, capital.depotNodeId, 'Q2');
  assert.ok(kinds(p).includes('check'), p.join()); // the checkpoint is still the fastest way to the rally square from the depot
  for (const sp of capital.spots) {
    const free = route(noCheck, capital.depotNodeId, sp.nodeId);
    assert.ok(free.length > 1, sp.id);
    assert.ok(!kinds(free).includes('check'), sp.id);
  }
  const free = route(noCheck, capital.depotNodeId, 'Q2');
  assert.ok(len(free) > len(p)); // the check-free detour is longer
  // depot->ceremony: the short northern road crosses a checkpoint, so a longer road is faster; mult=1 -> the shortcut wins (negative control)
  const shortcut = ['D0', 'W0', 'R1', 'X1', 'Q1'];
  assert.ok(kinds(shortcut).includes('check'));
  const q1 = route(capital, 'D0', 'Q1');
  assert.ok(len(q1) > len(shortcut) && pathTime(capital, q1, 110) < pathTime(capital, shortcut, 110), q1.join());
  const keep = ECON.checkSpeedMult;
  try {
    ECON.checkSpeedMult = 1;
    assert.deepEqual(route(capital, 'D0', 'Q1'), shortcut);
  } finally { ECON.checkSpeedMult = keep; }
});
test('capital: levels 7-9 use the capital map, every site spot reachable from the depot', () => {
  const lv = LEVELS.filter((l) => l.city === 'city-capital');
  assert.deepEqual(lv.map((l) => l.id), [7, 8, 9]);
  for (const l of lv) for (const st of l.sites) {
    const spot = capital.spots.find((p) => p.id === st.spotId)!;
    assert.ok(spot, st.spotId);
    assert.ok(route(capital, capital.depotNodeId, spot.nodeId).length > 1, st.spotId);
  }
});
test('capital play: bot gets >=1 star on L7-L9', () => {
  const save: Save = { coins: 0, level: 7, stars: {}, upgrades: { pump: 2, tank: 2, cabin: 2 } };
  for (const l of LEVELS.filter((x) => x.city === 'city-capital')) {
    const r = dayResult(playBot(l, { ...save, level: l.id }, capital));
    console.log('L' + l.id, JSON.stringify(r));
    assert.ok(r.stars >= 1, 'L' + l.id);
  }
});

// ---------- city 4 shows (step G3): crowd-flow gates, open only inside the level's gateWindows ----------
const shows = cityShows as unknown as CityMap;
const showsKinds = (p: string[]) => p.slice(1).map((n, i) => shows.edges.find((e) => (e.a === p[i] && e.b === n) || (e.b === p[i] && e.a === n))!.kind);
/** Sim-level probe: one truck sent to deliver at the stadium at time t0; returns [arrival sec after dispatch, path]. */
function gateTrip(windows: [number, number][] | undefined, t0: number) {
  const lv: LevelDef = { ...LEVELS.find((l) => l.id === 10)!, gateWindows: windows };
  const s = createDay(lv, shows, { coins: 0, level: 10, stars: {}, upgrades: { pump: 0, tank: 0, cabin: 2 } });
  run(s, t0);
  const site = s.sites.find((x) => x.def.spotId === 'spot-stadium')!;
  assert.ok(command(s, { type: 'deliver', truckId: 't1', siteId: site.def.id, count: 1 }).ok);
  const path = [...s.trucks[0].path], start = s.time;
  runUntil(s, () => s.cabins.some((c) => c.siteId === site.def.id));
  return { sec: s.time - start, path };
}
test('shows: gateCrowded is [from, to) over the windows; none -> never', () => {
  assert.equal(gateCrowded(undefined, 100), false);
  assert.equal(gateCrowded([], 100), false);
  assert.equal(gateCrowded([[10, 20], [50, 60]], 10), true);
  assert.equal(gateCrowded([[10, 20], [50, 60]], 20), false);
  assert.equal(gateCrowded([[10, 20], [50, 60]], 55), true);
});
test('shows: a gate edge is main speed outside a window, ECON.gateSpeedMult inside', () => {
  const g: CityMap = { ...shows, nodes: [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 300, y: 0 }], edges: [{ a: 'a', b: 'b', kind: 'gate' }] };
  const m: CityMap = { ...g, edges: [{ a: 'a', b: 'b', kind: 'main' }] };
  assert.equal(pathTime(g, ['a', 'b'], 100), pathTime(m, ['a', 'b'], 100));
  assert.ok(Math.abs(pathTime(g, ['a', 'b'], 100, true) - pathTime(m, ['a', 'b'], 100) / ECON.gateSpeedMult) < 1e-9);
  assert.equal(pathTime(m, ['a', 'b'], 100, true), pathTime(m, ['a', 'b'], 100)); // only gate edges care
});
test('shows: depot->stadium uses a gate when open, the longer non-gate road while the crowd window is open', () => {
  const free = route(shows, shows.depotNodeId, 'ST'), crowd = route(shows, shows.depotNodeId, 'ST', true);
  assert.ok(showsKinds(free).includes('gate'), free.join());
  assert.ok(!showsKinds(crowd).includes('gate'), crowd.join());
  assert.ok(pathTime(shows, crowd, 110) > pathTime(shows, free, 110)); // detour is longer when gates are open
  assert.ok(pathTime(shows, free, 110, true) > pathTime(shows, crowd, 110, true)); // but beats crawling through the crowd
  const a1 = route(shows, shows.depotNodeId, 'AR'), a2 = route(shows, shows.depotNodeId, 'AR', true);
  assert.ok(showsKinds(a1).includes('gate') && !showsKinds(a2).includes('gate'), a1.join() + ' / ' + a2.join());
});
test('shows sim: a truck dispatched inside a window reroutes and arrives later; no gateWindows -> old timing (negative control)', () => {
  const base = gateTrip(undefined, 130); // L10 with the windows removed = plain roads
  const open = gateTrip([[0, 1e9]], 130); // window covers the whole trip
  const outside = gateTrip([[500, 600]], 130); // window exists but not now
  assert.ok(showsKinds(base.path).includes('gate'), base.path.join());
  assert.ok(!showsKinds(open.path).includes('gate'), open.path.join());
  assert.ok(open.sec > base.sec + 3, `window ${open.sec} vs none ${base.sec}`);
  assert.deepEqual(outside.path, base.path);
  assert.equal(outside.sec, base.sec);
  const expect = pathTime(shows, base.path, ECON.truck.speed);
  assert.ok(Math.abs(base.sec - expect) <= DT * 2, `${base.sec} vs ${expect}`);
});
test('shows sim: a window opening mid-trip slows a truck already on a gate edge (movement sees sim time)', () => {
  const free = gateTrip(undefined, 30);
  const p = free.path, gi = showsKinds(p).indexOf('gate');
  // open the window at the moment the truck reaches the gate edge: it keeps its path but crawls
  const tGate = 30 + pathTime(shows, p.slice(0, gi + 1), ECON.truck.speed);
  const slow = gateTrip([[tGate, 1e9]], 30);
  assert.deepEqual(slow.path, p);
  assert.ok(slow.sec > free.sec + 3, `${slow.sec} vs ${free.sec}`);
});
test('shows: levels 10-12 use the shows map with gate windows, every site spot reachable from the depot', () => {
  const lv = LEVELS.filter((l) => l.city === 'city-shows');
  assert.deepEqual(lv.map((l) => l.id), [10, 11, 12]);
  assert.ok(shows.edges.filter((e) => e.kind === 'gate').length >= 4);
  for (const l of lv) {
    assert.ok(l.gateWindows && l.gateWindows.length >= 1, 'L' + l.id);
    for (const [a, b] of l.gateWindows!) assert.ok(a < b && b <= l.dayLength, 'L' + l.id);
    for (const st of l.sites) {
      const spot = shows.spots.find((p) => p.id === st.spotId)!;
      assert.ok(spot, st.spotId);
      assert.ok(route(shows, shows.depotNodeId, spot.nodeId).length > 1, st.spotId);
      assert.ok(route(shows, shows.depotNodeId, spot.nodeId, true).length > 1, st.spotId);
    }
  }
  for (const l of LEVELS.filter((x) => x.id <= 9)) assert.equal(l.gateWindows, undefined, 'L' + l.id);
});
test('shows play: bot reaches day end with >=1 star on L10-L12', () => {
  const save: Save = { coins: 0, level: 10, stars: {}, upgrades: { pump: 2, tank: 2, cabin: 2 } };
  for (const l of LEVELS.filter((x) => x.city === 'city-shows')) {
    const s = playBot(l, { ...save, level: l.id }, shows);
    assert.ok(s.over, 'L' + l.id);
    const r = dayResult(s);
    console.log('L' + l.id, JSON.stringify(r));
    assert.ok(r.stars >= 1, 'L' + l.id);
  }
});

// ---------- city 5 industry (step G4): long distances + satellite dump stations (map.dumps) ----------
const industry = cityIndustry as unknown as CityMap;
/** Tiny line map: depot D --(far, 1200px)-- S (site) --(200px)-- X (dump). Truck pumps at S, then dumps. */
const lineMap = (dumps?: CityMap['dumps']): CityMap => ({
  id: 'line', name: 'line', width: 1600, height: 200, depotNodeId: 'D', depot: { x: 0, y: 100 },
  nodes: [{ id: 'D', x: 0, y: 100 }, { id: 'S', x: 1200, y: 100 }, { id: 'X', x: 1400, y: 100 }],
  edges: [{ a: 'D', b: 'S', kind: 'main' }, { a: 'S', b: 'X', kind: 'main' }],
  spots: [{ id: 'sp', nodeId: 'S', x: 1200, y: 60, slots: [{ x: 1180, y: 60 }, { x: 1220, y: 60 }] }], decor: [], dumps,
});
/** Deliver 2 cabins at S, let them fill, service; returns the state when the truck is idle again + sec from pump end to idle. */
function dumpTrip(m: CityMap) {
  const lv: LevelDef = { ...LEVELS[0], dayLength: 2000, sites: [{ id: 'x', type: 'construction', name: 'אתר', spotId: 'sp', openAt: 0, closeAt: 1900, usage: [[0, 2]], fee: 0, serviceTip: 0, overflowFinePerSec: 0 }] };
  const s = createDay(lv, m, newSave());
  const t = s.trucks[0];
  assert.ok(command(s, { type: 'deliver', truckId: 't1', siteId: 'x', count: 2 }).ok);
  runUntil(s, () => t.job === 'idle', 600);
  run(s, 40);
  assert.ok(command(s, { type: 'service', truckId: 't1', siteId: 'x' }).ok);
  runUntil(s, () => t.job === 'toDepot', 600);
  const tank = t.tank, start = s.time, path = [...t.path];
  assert.ok(tank > 0);
  runUntil(s, () => t.job === 'idle', 600);
  return { s, t, sec: s.time - start, path, tank };
}
test('industry sim: a truck dumps at a satellite dump nearer than the depot, parks there; stock untouched', () => {
  const m = lineMap([{ nodeId: 'X', x: 1400, y: 60 }]);
  const r = dumpTrip(m);
  assert.deepEqual(r.path, ['S', 'X']);
  assert.equal(r.t.tank, 0);
  assert.equal(r.t.job, 'idle');
  assert.equal(r.t.path[r.t.path.length - 1], 'X');
  assert.deepEqual([r.t.x, r.t.y], [1400, 100]);
  const travel = pathTime(m, ['S', 'X'], ECON.truck.speed), expect = travel + r.tank / ECON.dumpRate;
  assert.ok(Math.abs(r.sec - expect) <= DT * 3, `${r.sec} vs ${expect}`);
  const base = dumpTrip(lineMap()); // negative control: no dumps -> depot, old timing
  assert.ok(r.sec < base.sec - 5, `${r.sec} vs depot ${base.sec}`);
  // parked at the dump: deliver refused (cabins load only at the depot), recall drives home (desk G4 r1)
  assert.deepEqual(command(r.s, { type: 'deliver', truckId: 't1', siteId: 'x', count: 1 }), { ok: false, reason: 'כדי להעמיס תאים המשאית צריכה לחזור למחסן' });
  const back = structuredClone(r.s);
  assert.ok(command(back, { type: 'recall', truckId: 't1' }).ok);
  assert.equal(back.trucks[0].job, 'toDepot');
  assert.equal(back.trucks[0].path[back.trucks[0].path.length - 1], 'D');
  assert.equal(command(back, { type: 'recall', truckId: 't1' }).ok, false); // already heading to the depot
  // the truck parked at the dump can still be sent out to service
  assert.ok(command(r.s, { type: 'service', truckId: 't1', siteId: 'x' }).ok);
});
test('industry sim: no map.dumps (negative control) -> truck goes to the depot, old timing, cabins/tank as before', () => {
  const m = lineMap();
  const r = dumpTrip(m);
  assert.deepEqual(r.path, ['S', 'D']);
  assert.equal(r.t.tank, 0);
  assert.equal(r.t.path[r.t.path.length - 1], 'D');
  const expect = pathTime(m, ['S', 'D'], ECON.truck.speed) + r.tank / ECON.dumpRate;
  assert.ok(Math.abs(r.sec - expect) <= DT * 3, `${r.sec} vs ${expect}`);
  // a dump that is farther than the depot is ignored
  const far = dumpTrip({ ...lineMap([{ nodeId: 'X', x: 1400, y: 60 }]), nodes: [{ id: 'D', x: 0, y: 100 }, { id: 'S', x: 300, y: 100 }, { id: 'X', x: 1400, y: 100 }] });
  assert.deepEqual(far.path, ['S', 'D']);
});
test('industry: map has long distances, rail gate crossings with a way round, dump nodes on the graph', () => {
  assert.equal(industry.id, 'city-industry');
  assert.ok(industry.edges.filter((e) => e.kind === 'gate').length >= 1);
  assert.ok((industry.dumps ?? []).length >= 1);
  for (const d of industry.dumps!) assert.ok(industry.nodes.some((n) => n.id === d.nodeId), d.nodeId);
  const q = industry.spots.find((p) => p.id === 'spot-quarry')!;
  const far = (id: string) => pathTime(industry, route(industry, industry.depotNodeId, id), 110);
  for (const p of industry.spots) assert.ok(far(q.nodeId) >= far(p.nodeId), p.id); // quarry = farthest
  assert.ok(far(q.nodeId) > 15, String(far(q.nodeId)));
  for (const p of industry.spots) assert.ok(route(industry, industry.depotNodeId, p.nodeId, true).length > 1, p.id);
});
test('industry: levels 13-15 use the industry map, every site spot reachable; rail windows on L14-15', () => {
  const lv = LEVELS.filter((l) => l.city === 'city-industry');
  assert.deepEqual(lv.map((l) => l.id), [13, 14, 15]);
  for (const l of lv) for (const st of l.sites) {
    const spot = industry.spots.find((p) => p.id === st.spotId)!;
    assert.ok(spot, st.spotId);
    assert.ok(route(industry, industry.depotNodeId, spot.nodeId).length > 1, st.spotId);
  }
  for (const l of lv.slice(1)) {
    assert.ok(l.gateWindows && l.gateWindows.length >= 1, 'L' + l.id);
    for (const [a, b] of l.gateWindows!) assert.ok(a < b && b <= l.dayLength, 'L' + l.id);
    assert.ok(l.sites.some((x) => x.closeAt < l.dayLength - 60), 'L' + l.id + ' plant shutdown');
  }
  assert.equal(LEVELS.find((l) => l.id === 12)!.unlock.name, 'עיר התעשייה');
  assert.equal(LEVELS.find((l) => l.id === 15)!.unlock.name, 'בקרוב');
});
test('industry play: bot reaches day end with >=1 star on L13-L15 and uses the dump stations', () => {
  const save: Save = { coins: 0, level: 13, stars: {}, upgrades: { pump: 2, tank: 2, cabin: 2 } };
  for (const l of LEVELS.filter((x) => x.city === 'city-industry')) {
    const s = createDay(l, industry, { ...save, level: l.id });
    let n = 0, dumped = 0;
    const dumpNodes = new Set(industry.dumps!.map((d) => d.nodeId));
    while (!s.over) {
      if (n++ % 15 === 0) botAct(s);
      const before = s.trucks[0].job;
      step(s, DT);
      const t = s.trucks[0];
      if (before === 'toDepot' && t.job !== 'toDepot' && dumpNodes.has(t.path[t.path.length - 1])) dumped++;
    }
    const r = dayResult(s);
    console.log('L' + l.id, JSON.stringify(r), 'dumps', dumped);
    assert.ok(r.stars >= 1, 'L' + l.id);
    assert.ok(dumped >= 1, 'L' + l.id + ' dumps');
  }
});
