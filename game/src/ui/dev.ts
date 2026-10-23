// Dev page: fake GameState cycling through every UI screen. ?s=start|hud|site|truck|depot|end|toast for a fixed screen.
import type { GameState, Save, LevelDef, UpgradeDef, CityMap, Cabin } from '../sim/types.ts';
import city1 from '../data/city1.json';
import { createUi, setUpgrades } from './index.ts';

const map = city1 as unknown as CityMap;
const UP: UpgradeDef[] = [
  { id: 'pump', name: 'משאבה חזקה', desc: 'שואבת מהר יותר', costs: [100, 250, 600], values: [10, 14, 20, 28] },
  { id: 'tank', name: 'מיכל גדול', desc: 'מכיל יותר לפני הרוקן', costs: [120, 300], values: [200, 300, 450] },
  { id: 'cabin', name: 'תא נוסף', desc: 'עוד תא למחסן', costs: [80, 160, 400], values: [3, 4, 5, 6] },
];
setUpgrades(UP); // sim lane's UPGRADES not needed here
const level: LevelDef = {
  id: 1, title: 'פותחים בניין', dayLength: 240, coinTarget: 300,
  sites: [
    { id: 's1', type: 'construction', name: 'אתר בנייה צפון', spotId: map.spots[0].id, openAt: 0, closeAt: 150, usage: [[0, 1]], fee: 100, serviceTip: 5, overflowFinePerSec: 2 },
    { id: 's2', type: 'wedding', name: 'אולם הדר', spotId: map.spots[1].id, openAt: 100, closeAt: 240, usage: [[0, 1]], fee: 200, serviceTip: 8, overflowFinePerSec: 4 },
  ],
  unlock: { kind: 'site', name: 'אתר חדש', desc: 'חתונה גדולה בשער העיר', icon: 'icon-cabin' },
};
const level2: LevelDef = { ...level, id: 2, title: 'שוק הכרמל', unlock: { kind: 'vehicle', name: 'משאבה מהירה', desc: 'משאית שנוסעת כפול', icon: 'icon-pump' } };
const save: Save = { coins: 260, level: 1, stars: {}, upgrades: { pump: 0, tank: 0, cabin: 0, lights: 0, engine: 0, fleet: 0 } };

const cabins: Cabin[] = [];
level.sites.forEach((s, si) => [0.15, 0.55, 0.82, 0.97].slice(0, si ? 3 : 4).forEach((f, i) => cabins.push({ id: `c${si}${i}`, siteId: s.id, slot: i, fill: f * 100, capacity: 100, washT: 0 })));
cabins.push({ id: 'c90', siteId: null, slot: 0, fill: 0, capacity: 100, washT: 0 }, { id: 'c91', siteId: null, slot: 1, fill: 0, capacity: 100, washT: 0 });
const state: GameState = {
  level, map, time: 96, over: false, coinsStart: 120, coins: 184,
  trucks: [{ id: 't1', name: 'הוותיקה', job: 'toSite', path: [], seg: 0, segT: 0, x: 300, y: 600, angle: 0, tank: 90, tankCap: 200, pumpRate: 10, speed: 80, targetSiteId: 's1', carrying: 0 }],
  cabins,
  sites: level.sites.map((d, i) => ({ def: d, open: true, closed: false, overflowSec: i ? 0 : 3, earned: 0, x: map.spots[i].x, y: map.spots[i].y })),
  events: [],
};
const ui = createUi();
ui.mount(document.getElementById('ui')!, {
  command: (c) => (c.type === 'deliver' ? { ok: false, reason: 'אין תאים פנויים במחסן' } : { ok: true }),
  startDay: () => {}, setSpeed: () => {}, focus: () => {},
  buyUpgrade: (id) => { const u = UP.find((x) => x.id === id)!; return save.coins >= u.costs[save.upgrades[id]] ? (save.coins -= u.costs[save.upgrades[id]++], { ok: true }) : { ok: false, reason: 'אין מספיק מטבעות' }; },
});
const result = { levelId: 1, stars: 2 as const, earned: 340, fines: 40, overflowSec: 0, coinTarget: 300 };
const screens: Record<string, () => void> = {
  start: () => ui.showDayStart(level, save),
  hud: () => ui.select(null, state),
  site: () => ui.select({ kind: 'site', id: 's1' }, state),
  truck: () => ui.select({ kind: 'truck', id: 't1' }, state),
  depot: () => ui.select({ kind: 'depot', id: 'depot' }, state),
  end: () => ui.showDayEnd(result, save, level2),
};
const want = new URLSearchParams(location.search).get('s');
const names = Object.keys(screens);
let i = 0;
function go(n: string) {
  document.querySelector('.ui-card-wrap')?.classList.add('ui-hidden');
  document.querySelector('.ui-hud')?.classList.remove('ui-hidden'); document.querySelector('.ui-chips')?.classList.remove('ui-hidden');
  screens[n]();
}
setInterval(() => { if (state.time < 230) state.time += 0.3; state.coins += 0; ui.update(state); }, 100);
ui.update(state);
if (want && screens[want]) { go(want); if (want === 'site') setTimeout(() => (document.querySelector('[data-act=deliver]') as HTMLElement)?.click(), 300); }
else { go(names[0]); setInterval(() => go(names[++i % names.length]), 3000); }
