// Integration (manager-owned): game loop wiring sim -> render -> ui.
import type { GameState, GameEvent, Save, CityMap } from './sim/types.ts';
import { createDay, step, command, dayResult, applyResult, buyUpgrade, LEVELS, parseSave } from './sim/index.ts';
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

const KEY = 'bereshit.save.v1', GO = 'bereshit.go'; // GO (session): the day to start right after a city-change reload
const store = { get: (k: string, s = localStorage) => { try { return s.getItem(k); } catch { return null; } }, set: (k: string, v: string, s = localStorage) => { try { s.setItem(k, v); } catch { /* blocked: this page only */ } }, del: (k: string, s = localStorage) => { try { s.removeItem(k); } catch { /* blocked */ } } };
const raw = store.get(KEY);
let { save, bad } = parseSave(raw); // a broken save never blanks the game: repaired or fresh, the broken text kept aside
if (bad && raw !== null) store.set(KEY + '.broken', raw);
const persist = () => store.set(KEY, JSON.stringify(save));
if (bad) persist();
let playId = Math.min(save.level, LEVELS.length); // the day on the board: the saved one, or a replay picked on the map
const goRaw = store.get(GO, sessionStorage); store.del(GO, sessionStorage);
const goId = goRaw && +goRaw >= 1 && +goRaw <= save.level ? +goRaw : 0;
if (goId) playId = goId;
const level = () => LEVELS[playId - 1];
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
  startDay: (id) => {
    playId = Math.max(1, Math.min(id, save.level, LEVELS.length));
    if (mapOf(level().city) !== map) { store.set(GO, String(playId), sessionStorage); location.reload(); return; } // one tap: the reload starts the day itself
    state = createDay(level(), map, save); running = true;
  },
  toMenu: () => { running = false; acc = 0; state = createDay(level(), map, save); ui.showTitle(save); },
  buyUpgrade: (id) => { const r = buyUpgrade(save, id); if (r.ok) { save = r.save; persist(); } return r; },
  restart: () => { store.del(KEY); location.reload(); },
  setSpeed: (x) => { speed = x; },
  focus: (x, y, dy) => render.focus(x, y, dy),
});
ui.setPause((p) => { paused = p; }); // the guided first day holds the clock while it waits for a tap
ui.setView((x, y) => render.view(x, y)); // world -> screen, enables off-screen edge arrows
(window as any).__game = { get state() { return state; }, get save() { return save; }, command: (c: any) => command(state, c), focus: (x: number, y: number) => render.focus(x, y) }; // test hook

let last = performance.now();
const STEP = 1 / 30;
let acc = 0;
const sideways = matchMedia('(orientation: landscape) and (max-height: 520px)'); // phone on its side: the rotate prompt covers the game, the clock holds
function frame(now: number) {
  const dt = Math.min(0.25, (now - last) / 1000); last = now;
  const hold = paused || sideways.matches;
  if (hold) acc = 0;
  if (running && !hold) {
    acc += dt * speed;
    const evs: GameEvent[] = []; // step() keeps only its own events: hand render/ui every event of this frame
    while (acc >= STEP && !state.over) { step(state, STEP); acc -= STEP; evs.push(...state.events); }
    state.events = evs;
    if (state.over) {
      running = false; acc = 0;
      const r = dayResult(state);
      save = applyResult(save, r); persist();
      const won = r.stars >= 1;
      ui.showDayEnd(r, save, won ? LEVELS[playId] : level()); // after a win the next day (undefined after the last = ending), after a loss a retry
    }
  }
  render.update(state, dt);
  ui.update(state);
  requestAnimationFrame(frame);
}
if (goId) ui.begin(level(), save); else ui.showTitle(save, bad ? 'השמירה במכשיר נפגמה, אז שחזרנו מה שאפשר. אפשר להמשיך לשחק.' : '');
requestAnimationFrame(frame);
