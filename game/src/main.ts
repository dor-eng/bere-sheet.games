// Integration (manager-owned): game loop wiring sim -> render -> ui.
import type { GameState, GameEvent, Save, CityMap } from './sim/types.ts';
import { createDay, step, command, dayResult, applyResult, buyUpgrade, LEVELS, newSave } from './sim/index.ts';
import { createRender } from './render/index.ts';
import { createUi } from './ui/index.ts';
import cityReal from './data/city-real.json';

const KEY = 'bereshit.save.v1';
const map = cityReal as CityMap;
let save: Save = JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? newSave();
const persist = () => localStorage.setItem(KEY, JSON.stringify(save));
const level = () => LEVELS[Math.min(save.level, LEVELS.length) - 1];

let state: GameState = createDay(level(), map, save);
let running = false, speed: 1 | 2 | 3 = 1;
const render = createRender();
const ui = createUi();

await render.mount(document.getElementById('stage')!, map);
render.onSelect((sel) => ui.select(sel, state));
ui.mount(document.getElementById('ui')!, {
  command: (c) => command(state, c),
  startDay: () => { state = createDay(level(), map, save); running = true; },
  buyUpgrade: (id) => { const r = buyUpgrade(save, id); if (r.ok) { save = r.save; persist(); } return r; },
  setSpeed: (x) => { speed = x; },
  focus: (x, y) => render.focus(x, y),
});
ui.setView((x, y) => render.view(x, y)); // world -> screen, enables off-screen edge arrows
ui.showDayStart(level(), save);
(window as any).__game = { get state() { return state; }, get save() { return save; }, command: (c: any) => command(state, c), focus: (x: number, y: number) => render.focus(x, y) }; // test hook

let last = performance.now();
const STEP = 1 / 30;
let acc = 0;
function frame(now: number) {
  const dt = Math.min(0.25, (now - last) / 1000); last = now;
  if (running) {
    acc += dt * speed;
    const evs: GameEvent[] = []; // step() keeps only its own events: hand render/ui every event of this frame
    while (acc >= STEP && !state.over) { step(state, STEP); acc -= STEP; evs.push(...state.events); }
    state.events = evs;
    if (state.over) {
      running = false; acc = 0;
      const r = dayResult(state);
      save = applyResult(save, r); persist();
      ui.showDayEnd(r, save, LEVELS[save.level - 1] !== state.level ? LEVELS[save.level - 1] : LEVELS[state.level.id]);
    }
  }
  render.update(state, dt);
  ui.update(state);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
