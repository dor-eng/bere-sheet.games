// Integration (manager-owned): game loop wiring sim -> render -> ui.
import type { GameState, GameEvent, Save, CityMap } from './sim/types.ts';
import { createDay, step, command, dayResult, applyResult, buyUpgrade, LEVELS, newSave } from './sim/index.ts';
import { createRender } from './render/index.ts';
import { createUi } from './ui/index.ts';
import cityReal from './data/city-real.json';
import cityBeach from './data/city-beach.json';
import cityCapital from './data/city-capital.json';
import cityShows from './data/city-shows.json';
import cityIndustry from './data/city-industry.json';
import cityValley from './data/city-valley.json';
import cityDesert from './data/city-desert.json';
import cityNight from './data/city-night.json';

const KEY = 'bereshit.save.v1';
let save: Save = JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? newSave();
save.upgrades.lights ??= 0; // saves from before city 8
save.upgrades.engine ??= 0; save.upgrades.fleet ??= 0; // saves from before the fleet shop
const persist = () => localStorage.setItem(KEY, JSON.stringify(save));
const level = () => LEVELS[Math.min(save.level, LEVELS.length) - 1];
const mapOf = (id?: string) => ((id === 'city-beach' ? cityBeach : id === 'city-capital' ? cityCapital : id === 'city-shows' ? cityShows : id === 'city-industry' ? cityIndustry : id === 'city-valley' ? cityValley : id === 'city-desert' ? cityDesert : id === 'city-night' ? cityNight : cityReal) as CityMap);
const map = mapOf(level().city); // ponytail: a new city reloads the page (render mounts once); live swap when cities need it

let state: GameState = createDay(level(), map, save);
let running = false, paused = false, speed: 1 | 2 | 3 = 1;
const render = createRender();
const ui = createUi();

await render.mount(document.getElementById('stage')!, map);
render.onSelect((sel) => ui.select(sel, state));
ui.mount(document.getElementById('ui')!, {
  command: (c) => command(state, c),
  startDay: () => { if (mapOf(level().city) !== map) { location.reload(); return; } state = createDay(level(), map, save); running = true; },
  buyUpgrade: (id) => { const r = buyUpgrade(save, id); if (r.ok) { save = r.save; persist(); } return r; },
  setSpeed: (x) => { speed = x; },
  focus: (x, y, dy) => render.focus(x, y, dy),
});
ui.setPause((p) => { paused = p; }); // the guided first day holds the clock while it waits for a tap
ui.setView((x, y) => render.view(x, y)); // world -> screen, enables off-screen edge arrows
ui.showDayStart(level(), save);
(window as any).__game = { get state() { return state; }, get save() { return save; }, command: (c: any) => command(state, c), focus: (x: number, y: number) => render.focus(x, y) }; // test hook

let last = performance.now();
const STEP = 1 / 30;
let acc = 0;
function frame(now: number) {
  const dt = Math.min(0.25, (now - last) / 1000); last = now;
  if (paused) acc = 0;
  if (running && !paused) {
    acc += dt * speed;
    const evs: GameEvent[] = []; // step() keeps only its own events: hand render/ui every event of this frame
    while (acc >= STEP && !state.over) { step(state, STEP); acc -= STEP; evs.push(...state.events); }
    state.events = evs;
    if (state.over) {
      running = false; acc = 0;
      const r = dayResult(state);
      save = applyResult(save, r); persist();
      ui.showDayEnd(r, save, level()); // saved level: the next one after a win, a retry after a loss, the last level replays
    }
  }
  render.update(state, dt);
  ui.update(state);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
