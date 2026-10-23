/// <reference types="vite/client" />
// DOM Hebrew RTL UI over the canvas. Reads GameState, calls handlers only (no sim logic, no canvas).
import { LEVELS, ECON, dayResult, takesOrder } from '../sim/index.ts';
import { prep } from './heb.ts';
import { sfx, buzz, unlockAudio } from '../audio.ts';
import { prefs, setPref } from '../prefs.ts';
import type { GameState, UiApi, UiHandlers, Selection, LevelDef, Save, DayResult, UpgradeDef, Truck, TruckJob, Cabin } from '../sim/types.ts';

const inDepot = (c: Cabin) => c.siteId === null && c.slot === -1;
const clean = (c: Cabin) => inDepot(c) && c.washT <= 0, dirty = (c: Cabin) => inDepot(c) && c.washT > 0;

// UPGRADES come from the sim; resolved lazily so this module also loads before sim/index.ts exists.
const simMods = import.meta.glob('../sim/index.ts', { eager: true }) as Record<string, { UPGRADES?: UpgradeDef[] }>;
let upgrades: UpgradeDef[] = Object.values(simMods)[0]?.UPGRADES ?? [];
export function setUpgrades(u: UpgradeDef[]) { upgrades = u; } // dev/test override

const STAR = '<svg viewBox="0 0 24 24"><path d="M12 2l3 6.9 7.4.7-5.6 4.9 1.7 7.3L12 18l-6.5 3.8 1.7-7.3L1.6 9.6 9 8.9z" fill="#FFCC00" stroke="#1E2A3A" stroke-width="1.8" stroke-linejoin="round"/></svg>';
const COIN = '<svg class="coin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#FFCC00" stroke="#1E2A3A" stroke-width="2.4"/><circle cx="12" cy="12" r="6" fill="none" stroke="#c98f00" stroke-width="2"/></svg>';
const DROP = '<svg class="coin" viewBox="0 0 24 24"><path d="M12 2C9 7 5 10.5 5 15a7 7 0 0014 0c0-4.500-4-8-7-13z" fill="#29a3dd" stroke="#1E2A3A" stroke-width="2.2" stroke-linejoin="round"/></svg>';
const JOB: Record<TruckJob, [string, string]> = {
  idle: ['חונה', 's-idle'], toSite: ['בדרך', 's-go'], delivering: ['בדרך', 's-go'], toDepot: ['בדרך', 's-go'],
  pumping: ['שואב', 's-pump'], dumping: ['מרוקן', 's-dump'], collecting: ['בדרך', 's-go'],
};
/** What the truck is doing, in words (destination named). */
function truckSay(t: Truck, s: GameState): string {
  const site = t.targetSiteId ? s.sites.find((x) => x.def.id === t.targetSiteId) : undefined, nm = site ? shortName(site.def.name) : '';
  const home = t.path[t.path.length - 1] === s.map.depotNodeId; // route endpoint, not the job name
  const dirtyAboard = t.carrying && s.cabins.some((c) => c.slot === -100 - s.trucks.indexOf(t) && c.washT > 0); // a finished client's cabins
  if (t.job === 'delivering' && dirtyAboard) return `מחזירה ${t.carrying} ${t.carrying === 1 ? 'תא' : 'תאים'} לשטיפה`;
  if (t.job !== 'idle' && t.job !== 'pumping' && t.job !== 'dumping' && !t.carrying && home && t.path.length > 1) return 'חוזרת למחסן';
  switch (t.job) {
    case 'toSite': return nm ? `בדרך ${prep('ל', nm)}` : 'בדרך לאתר';
    case 'collecting': return nm ? `אוספת תאים ${prep('מ', nm)}` : 'אוספת תאים';
    case 'delivering': return t.carrying ? `מביאה ${t.carrying} ${t.carrying === 1 ? 'תא' : 'תאים'}${nm ? ` ${prep('ל', nm)}` : ''}` : (nm ? `בדרך ${prep('ל', nm)}` : 'בדרך');
    case 'pumping': return nm ? `שואבת ${prep('ב', nm)}` : 'שואבת';
    case 'toDepot': return home ? 'חוזרת למחסן' : 'נוסעת לרוקן את המיכל';
    case 'dumping': return 'מרוקנת את המיכל';
    default: return 'פנויה';
  }
}
const SITE_ICON: Record<string, string> = { construction: '🏗️', wedding: '💒', beach: '🏖️', ceremony: '🇮🇱', show: '🎤' };
const ICON: Record<string, string> = { site: '🏗️', equipment: '🧰', vehicle: '🚚', city: '🏙️', mechanic: '⚙️' };
const el = (cls: string, tag = 'div') => { const e = document.createElement(tag); e.className = cls; return e; };
const pct = (a: number, b: number) => Math.max(0, Math.min(100, Math.round((a / (b || 1)) * 100)));
const heat = (p: number) => (p >= 90 ? 'hot' : p >= 70 ? 'warm' : '');
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const clock = (t: number, len: number) => {
  const m = Math.floor(360 + Math.min(1, Math.max(0, t / (len || 1))) * 1080); // 06:00 -> 24:00
  return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
};
const mmss = (sec: number) => { const s = Math.max(0, Math.ceil(sec)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const shortName = (n: string) => n.split(' - ')[0];
/** Net of the day exactly as dayResult counts it: fees paid minus fines (the wallet is clamped at 0, so it is not used). */
const netOf = (s: GameState) => s.sites.reduce((n, st) => n + st.earned - Math.floor(st.overflowSec * st.def.overflowFinePerSec + 1e-6), 0);
const setHtml = (e: HTMLElement, h: string) => { if (e.dataset.h !== h) { e.dataset.h = h; e.innerHTML = h; } };

export interface UiExtra {
  /** Optional: world->screen projection from render (null = unknown). Enables edge arrows; otherwise alerts are shown as chips. */
  setView(fn: ((x: number, y: number) => { x: number; y: number } | null) | null): void;
  /** The guided first day pauses the sim through this (main.ts owns the flag). */
  setPause(fn: (p: boolean) => void): void;
}

export function createUi(): UiApi & UiExtra {
  let h: UiHandlers;
  let root: HTMLElement;
  let hud: HTMLElement, chips: HTMLElement, sheet: HTMLElement, toast: HTMLElement, cardWrap: HTMLElement, arrows: HTMLElement;
  let goalEl: HTMLElement, starsEl: HTMLElement, leftEl: HTMLElement, coinsEl: HTMLElement, clockEl: HTMLElement, progEl: HTMLElement, speedEl: HTMLElement;
  let sel: Selection = null;
  let last: GameState | null = null;
  let deliverN = 0 /* 0 = default: as many as can be delivered */, speed: 1 | 2 | 3 = 1, toastT = 0, lastCoins = -1;
  let view: ((x: number, y: number) => { x: number; y: number } | null) | null = null;
  const hist = new Map<string, { t: number; v: number }[]>();
  let shopSave: Save | null = null;
  // live bookkeeping per day (reset when the GameState object changes): sites over capacity right now, seconds open with no cabins, lowest wallet
  let book: { s: GameState; over: Set<string>; noCab: Map<string, number>; t: number; minCoins: number } | null = null;

  const say = (msg: string) => { toast.textContent = msg; toast.classList.add('on'); clearTimeout(toastT); toastT = window.setTimeout(() => toast.classList.remove('on'), 2200); };
  const run = (c: Parameters<UiHandlers['command']>[0], okMsg?: string) => { const r = h.command(c); if (r.ok) noteCmd(c); if (r.ok && c.type !== 'recall' && sel?.kind === 'site' && last) select(null, last); /* owner: the order is given, close the sheet */ if (!r.ok) say(r.reason ?? 'לא הצלחנו, נסו שוב'); else if (okMsg) say(okMsg); else if (c.type === 'recall') say('המשאית חוזרת למחסן'); else say(c.type === 'service' ? 'המשאית יוצאת לשאוב!' : c.type === 'collect' ? 'המשאית יוצאת לאסוף את התאים' : 'התאים בדרך!'); return r; };
  /** How many cabins a deliver command would really bring: min(truck carry, clean stock, free slots) - same as sim command(). */
  const deliverable = (s: GameState, siteId: string) => {
    const st = s.sites.find((x) => x.def.id === siteId), spot = st && s.map.spots.find((p) => p.id === st.def.spotId);
    if (!st || !spot) return 0;
    return Math.max(0, Math.min(ECON.cabinCarry, s.cabins.filter(clean).length, spot.slots.length - s.cabins.filter((c) => c.siteId === siteId).length));
  };
  const deliverCount = (s: GameState, siteId: string) => { const mx = deliverable(s, siteId); return mx < 1 ? 0 : deliverN ? Math.min(deliverN, mx) : Math.min(guideQty(siteId) || mx, mx); };
  const idleTruck = (s: GameState, pump = false): Truck | undefined => s.trucks.find((t) => t.job === 'idle') ?? s.trucks.find((t) => takesOrder(t) && (!pump || t.tank < t.tankCap - 0.001)) ?? s.trucks[0]; // a pump order needs tank room

  function mount(r: HTMLElement, handlers: UiHandlers) {
    root = r; h = handlers; root.textContent = '';
    hud = el('ui-hud ui-hidden');
    hud.innerHTML = `<div class="ui-coins">${COIN}<span data-k="coins">0</span></div><div class="ui-clock" data-k="clock">06:00</div>` +
      `<div class="ui-speed">${[1, 2, 3].map((x) => `<button data-sp="${x}" aria-label="מהירות ${x}">${x}x</button>`).join('')}<button data-help aria-label="עצירה וחוקים"><i class="pz"></i></button></div><div class="ui-goal"><span data-k="goal"></span><span data-k="stars"></span></div><div class="ui-prog"><i></i><em data-k="left"></em></div>`;
    coinsEl = hud.querySelector('[data-k=coins]')!; clockEl = hud.querySelector('[data-k=clock]')!;
    progEl = hud.querySelector('.ui-prog i')!; goalEl = hud.querySelector('[data-k=goal]')!; starsEl = hud.querySelector('[data-k=stars]')!; leftEl = hud.querySelector('[data-k=left]')!; speedEl = hud.querySelector('.ui-speed')!;
    hud.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-sp]') as HTMLElement | null;
      if (b) { speed = +b.dataset.sp! as 1 | 2 | 3; h.setSpeed(speed); paintSpeed(); }
      else if ((e.target as HTMLElement).closest('[data-help]') && last && !last.over) openHelp();
    });
    paintSpeed();
    chips = el('ui-chips ui-hidden');
    chips.addEventListener('click', (e) => {
      const c = (e.target as HTMLElement).closest('[data-truck],[data-site]') as HTMLElement | null;
      if (!c || !last) return;
      if (c.dataset.truck) { const t = last.trucks.find((x) => x.id === c.dataset.truck); if (t) { h.focus(t.x, t.y); select({ kind: 'truck', id: t.id }, last); } }
      else { const st = last.sites.find((x) => x.def.id === c.dataset.site); if (st) { h.focus(st.x, st.y); select({ kind: 'site', id: st.def.id }, last); } }
    });
    arrows = el('', 'div'); arrows.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    sheet = el('ui-sheet ui-hidden');
    sheet.addEventListener('click', onSheet);
    toast = el('ui-toast');
    cardWrap = el('ui-card-wrap ui-hidden');
    alertChips.addEventListener('click', onAlert); arrows.addEventListener('click', onAlert);
    bubble = el('ui-guide ui-hidden'); finger = el('ui-finger ui-hidden'); finger.textContent = '👇';
    bubble.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-g]') as HTMLElement | null;
      if (b?.dataset.g === 'skip') guideStop(true); else if (b?.dataset.g === 'ok') { g.ack = true; }
    });
    root.append(hud, chips, arrows, alertChips, sheet, toast, finger, bubble, cardWrap);
    root.addEventListener('pointerdown', (e) => { unlockAudio(); if ((e.target as HTMLElement).closest('button:not(:disabled),[data-g]')) sfx('tap'); }, true);
  }

  function paintSpeed() { speedEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +(b as HTMLElement).dataset.sp! === speed)); }

  function onSheet(e: Event) {
    const b = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!b || !last || !sel) return;
    const a = b.dataset.act;
    if (a === 'close') return select(null, last);
    if (a === 'minus' && sel.kind === 'site') { deliverN = Math.max(1, deliverCount(last, sel.id) - 1); return refreshSheet(last); }
    if (a === 'plus' && sel.kind === 'site') { deliverN = Math.min(deliverable(last, sel.id), deliverCount(last, sel.id) + 1); return refreshSheet(last); }
    // deliver loads only at the depot: prefer an idle truck parked there (another may be idle at a dump)
    const depot = last.map.depotNodeId;
    const t = (a === 'deliver' && last.trucks.find((x) => x.job === 'idle' && x.path[x.path.length - 1] === depot)) || idleTruck(last, a === 'service');
    if (!t) return say('אין משאית פנויה');
    if (a === 'service' && sel.kind === 'site') run({ type: 'service', truckId: t.id, siteId: sel.id });
    else if (a === 'collect' && sel.kind === 'site') run({ type: 'collect', truckId: t.id, siteId: sel.id });
    else if (a === 'deliver' && sel.kind === 'site') {
      const n = deliverCount(last, sel.id), st = last.sites.find((x) => x.def.id === sel!.id);
      run({ type: 'deliver', truckId: t.id, siteId: sel.id, count: n }, `${n} ${n === 1 ? 'תא' : 'תאים'} בדרך ${prep('ל', shortName(st?.def.name ?? ''))}`);
    }
    else if (a === 'recall' && sel.kind === 'truck') run({ type: 'recall', truckId: sel.id });
    else if (a === 'service-depot') { /* depot has no extra action */ }
  }

  function select(s: Selection, st: GameState) {
    sel = s; last = st; deliverN = 0;
    sheet.dataset.h = '';
    if (!s) { sheet.classList.add('ui-hidden'); return; }
    sheet.classList.remove('ui-hidden'); refreshSheet(st);
  }

  function trendOf(id: string): string {
    const a = hist.get(id); if (!a || a.length < 3) return '';
    const d = a[a.length - 1].v - a[0].v;
    return d > 0.08 ? 'מתמלא מהר' : d > 0.02 ? 'מתמלא' : d < -0.02 ? 'מתרוקן' : '';
  }

  function refreshSheet(s: GameState) {
    if (!sel) return;
    let html = '';
    if (sel.kind === 'site') {
      const st = s.sites.find((x) => x.def.id === sel!.id);
      if (!st) return;
      const cabs = s.cabins.filter((c) => c.siteId === st.def.id).sort((a, b) => a.slot - b.slot);
      const total = cabs.reduce((n, c) => n + c.fill / (c.capacity || 1), 0) / (cabs.length || 1);
      const free = s.cabins.filter(clean).length, wash = s.cabins.filter(dirty).length;
      const mx = deliverable(s, st.def.id), n = deliverCount(s, st.def.id), len = s.level.dayLength;
      const fills = cabs.map((c) => c.fill), pumpOk = fills.some((f) => f >= ECON.pumpMinFill);
      const status = st.closed ? 'הסתיים' : st.open ? `פתוח עד ${clock(st.def.closeAt, len)}` : `נפתח ב-${clock(st.def.openAt, len)}`;
      const trend = st.open && cabs.length ? trendOf(st.def.id) : '';
      const pay = st.closed ? (st.earned > 0 ? `שולם ${fmt(st.earned)}` : 'התשלום אבד בגלל עומס יתר') : `משלם ${fmt(st.def.fee)} ${COIN} בסיום`;
      const over = st.open && st.overflowSec > 0 ? ` · עומס יתר ${Math.ceil(st.overflowSec)} שנ' (מעל ${ECON.feeOverflowTolerance} התשלום אובד)` : '';
      const pumpWhy = st.closed ? 'האתר סגור' : !st.open ? 'האתר עוד לא נפתח' : !cabs.length ? 'אין באתר תאים לשאיבה' : !pumpOk ? `אין מה לשאוב עדיין: שואבים מתא שמלא ${ECON.pumpMinFill}% ומעלה` : '';
      const delWhy = st.closed ? 'האתר סגור' : !free ? 'אין תאים נקיים במחסן' : mx < 1 ? 'אין מקום פנוי באתר' : '';
      const pumpBtn = `<div class="row"><button class="btn${cabs.length ? '' : ' alt'}" data-act="service"${pumpWhy ? ' disabled' : ''}>שלח משאבה</button></div>` + (pumpWhy ? `<div class="ui-why">${pumpWhy}</div>` : '');
      const delBtn = `<div class="row"><div class="step"><button data-act="minus" aria-label="פחות"${n <= 1 ? ' disabled' : ''}>−</button><span>${n}</span><button data-act="plus" aria-label="עוד"${n >= mx ? ' disabled' : ''}>+</button></div>` +
        `<button class="btn${cabs.length ? ' alt' : ''}" data-act="deliver"${delWhy ? ' disabled' : ''}>הצב תאים</button></div>` + (delWhy ? `<div class="ui-why">${delWhy}</div>` : '');
      html = `<h3><span>${SITE_ICON[st.def.type]} ${esc(st.def.name)}</span><button class="ui-x" data-act="close" aria-label="סגור">✕</button></h3>` +
        `<div class="ui-sub">${status}${trend ? ` · <span class="trend">${trend}</span>` : ''} · ${pay}${over}</div>` +
        `<div class="ui-cabins">${cabs.map((c) => { const p = pct(c.fill, c.capacity); return `<div class="cab"><div class="gauge ${heat(p)}"><i style="height:${p}%"></i></div>${p}%</div>`; }).join('') || '<div class="ui-sub">אין תאים באתר</div>'}</div>` +
        `<div class="ui-sub">${cabs.length ? `ממוצע ${pct(total, 1)}% · ` : ''}במחסן: ${free} תאים${wash ? ` (${wash} בשטיפה)` : ''}</div>` +
        (st.closed ? (cabs.length ? `<div class="ui-sub">האירוע נגמר: ${cabs.length} ${cabs.length === 1 ? 'תא מחכה' : 'תאים מחכים'} לאיסוף ולשטיפה במחסן</div><div class="row"><button class="btn" data-act="collect">החזר תאים לשטיפה</button></div>` : '')
          : cabs.length ? pumpBtn + delBtn : delBtn + pumpBtn);
    } else if (sel.kind === 'truck') {
      const t = s.trucks.find((x) => x.id === sel!.id); if (!t) return;
      const p = pct(t.tank, t.tankCap);
      html = `<h3><span>🚚 ${esc(t.name)}</span><button class="ui-x" data-act="close" aria-label="סגור">✕</button></h3>` +
        `<div class="ui-sub">מצב: <b>${truckSay(t, s)}</b> · מיכל ${p}% <span class="mini ${heat(p)}"><i style="width:${p}%"></i></span></div>` +
        (t.carrying ? `<div class="ui-sub">מובילה ${t.carrying} תאים</div>` : '') +
        `<div class="row"><button class="btn alt" data-act="recall"${t.job === 'idle' && t.path[t.path.length - 1] === s.map.depotNodeId ? ' disabled' : ''}>חזרה למחסן</button></div>`;
    } else {
      const free = s.cabins.filter(clean).length, wash = s.cabins.filter(dirty).length;
      html = `<h3><span>🏭 המחסן</span><button class="ui-x" data-act="close" aria-label="סגור">✕</button></h3>` +
        `<div class="ui-sub">נקיים: <b>${free}</b> · בשטיפה: <b>${wash}</b></div>` +
        (wash ? `<div class="ui-sub">תאים שחוזרים מאתר נשטפים לפני שיוצאים שוב.</div>` : '') +
        s.trucks.map((t) => { const p = pct(t.tank, t.tankCap); return `<div class="ui-sub">${esc(t.name)} · ${truckSay(t, s)} · מיכל ${p}% <span class="mini ${heat(p)}"><i style="width:${p}%"></i></span></div>`; }).join('') +
        `<div class="ui-sub">הציבו תאים דרך לחיצה על אתר.</div>`;
    }
    setHtml(sheet, html);
  }

  let lastSlow = 0, evSeen: GameState['events'] | null = null;
  /** Day bookkeeping from the event stream and the clock; restarts when a new GameState appears. */
  function track(s: GameState) {
    if (!book || book.s !== s) book = { s, over: new Set(), noCab: new Map(), t: s.time, minCoins: s.coins };
    const dt = s.time - book.t; book.t = s.time;
    book.minCoins = Math.min(book.minCoins, s.coins);
    for (const e of s.events) {
      if (e.kind === 'overflowStart') book.over.add(e.siteId);
      else if (e.kind === 'overflowEnd' || e.kind === 'siteClose') book.over.delete(e.siteId);
    }
    if (dt > 0 && dt < 1) for (const st of s.sites) if (st.open && !st.closed && !s.cabins.some((c) => c.siteId === st.def.id)) book.noCab.set(st.def.id, (book.noCab.get(st.def.id) ?? 0) + dt);
  }

  function update(s: GameState) {
    last = s; track(s);
    if (s.events !== evSeen) for (const e of s.events) { // one pass per events array: a stopped clock keeps the old array
      if (e.kind === 'delivered') sfx('deliver'); else if (e.kind === 'cabinEmptied') sfx('pump'); else if (e.kind === 'paid') sfx('coin');
      else if (e.kind === 'overflowStart') { sfx('warn'); buzz([60, 40, 60]); }
    }
    evSeen = s.events;
    const coins = Math.floor(s.coinsStart + Math.max(0, netOf(s))); // what the bank will hold: fines never touch savings (applyResult)
    if (coins !== lastCoins) { lastCoins = coins; coinsEl.textContent = fmt(coins); }
    clockEl.textContent = clock(s.time, s.level.dayLength);
    progEl.style.width = pct(s.time, s.level.dayLength) + '%';
    // goal line: today's net, stars by the real rules (dayResult as if the day ended now), time left
    const net = Math.round(netOf(s)), res = dayResult({ ...s, over: true });
    setHtml(goalEl, `יום ${s.level.id} · היום: <b class="${net < 0 ? 'neg' : ''}">${net < 0 ? '−' : '+'}${fmt(Math.abs(net))}</b> · לעבור: רווח · ל-3 כוכבים: ${fmt(s.level.coinTarget)}`);
    setHtml(starsEl, [0, 1, 2].map((i) => `<i class="${i < res.stars ? 'on' : ''}">${i < res.stars ? '★' : '☆'}</i>`).join(''));
    leftEl.textContent = `נשארו ${mmss(s.level.dayLength - s.time)}`;
    // trucks chips: what each one is doing, in words; the bar is the tank
    setHtml(chips, s.trucks.map((t) => { const p = pct(t.tank, t.tankCap); return `<button class="ui-chip" data-truck="${t.id}" style="font-family:inherit"><span class="top">🚚 <b>${esc(t.name)}</b><span class="st ${JOB[t.job][1]}">${esc(truckSay(t, s))}</span></span><span class="tank">מיכל ${p}% <span class="mini ${heat(p)}"><i style="width:${p}%"></i></span></span></button>`; }).join(''));
    // alerts: sites overflowing / open with no cabins RIGHT NOW (from events, not history), or a cabin nearly full
    const soon = (st: GameState['sites'][number]) => !st.open && !st.closed && st.def.openAt - s.time <= s.level.dayLength / 18 && !s.cabins.some((c) => c.siteId === st.def.id); // opens within a game hour with no cabins: warn before the fine starts
    const hot = s.sites.filter((st) => st.closed ? s.cabins.some((c) => c.siteId === st.def.id) : soon(st) || st.open && (book!.over.has(st.def.id) || !s.cabins.some((c) => c.siteId === st.def.id) || s.cabins.some((c) => c.siteId === st.def.id && c.fill / (c.capacity || 1) >= 0.85)));
    paintAlerts(hot, s);
    guideTick(s);
    // slow lane (4Hz): history + open sheet
    const now = performance.now();
    if (now - lastSlow > 250) {
      lastSlow = now;
      for (const st of s.sites) {
        const cs = s.cabins.filter((c) => c.siteId === st.def.id);
        if (!cs.length) continue;
        const v = cs.reduce((n, c) => n + c.fill / (c.capacity || 1), 0) / cs.length;
        const a = hist.get(st.def.id) ?? []; if (!a.length || s.time - a[a.length - 1].t >= 2) a.push({ t: s.time, v });
        while (a.length > 6) a.shift(); if (a.length && s.time < a[0].t) a.length = 0;
        hist.set(st.def.id, a);
      }
      refreshSheet(s);
    }
  }

  function paintAlerts(hot: GameState['sites'], s: GameState) {
    const why = (st: GameState['sites'][number]) => (st.closed ? 'תאים לאיסוף' : !st.open ? `נפתח ב-${clock(st.def.openAt, s.level.dayLength)} בלי תאים` : !s.cabins.some((c) => c.siteId === st.def.id) ? 'בלי תאים!' : book!.over.has(st.def.id) ? 'גולש!' : 'כמעט מלא');
    const chip = (st: GameState['sites'][number]) => `<button class="ui-chip warn" data-site="${st.def.id}" style="font-family:inherit">⚠️ <b>${esc(shortName(st.def.name))}</b> ${why(st)}</button>`;
    const W = root.clientWidth, H = root.clientHeight, m = 36;
    const hudB = hud.getBoundingClientRect().bottom, sheetT = sel ? sheet.getBoundingClientRect().top : H;
    const asChip: string[] = [], pos: string[] = [];
    for (const st of hot) {
      const p = view ? view(st.x, st.y) : null;
      const off = !p || p.x < 0 || p.x > W || p.y < 0 || p.y > H;
      const covered = !!p && !off && (p.y < hudB + 4 || p.y > sheetT - 4); // on screen but under the HUD or the sheet
      const urgent = !st.closed && (book!.over.has(st.def.id) || !s.cabins.some((c) => c.siteId === st.def.id));
      if (!view || covered || urgent) asChip.push(chip(st));
      if (p && off) {
        const cx = W / 2, cy = H / 2, dx = p.x - cx, dy = p.y - cy;
        const k = Math.min((W / 2 - m) / (Math.abs(dx) || 1e-6), (H / 2 - m - 100) / (Math.abs(dy) || 1e-6));
        const x = cx + dx * k, y = cy + dy * k, ang = Math.atan2(dy, dx);
        pos.push(`<button class="ui-arrow" data-site="${st.def.id}" style="left:${x.toFixed(0)}px;top:${y.toFixed(0)}px" aria-label="${esc(st.def.name)}"><span style="display:block;transform:rotate(${ang.toFixed(2)}rad)">➤</span></button>`);
      }
    }
    alertChips.style.bottom = `calc(var(--sab) + ${sel ? Math.round(H - sheetT) + 10 : 12}px)`;
    setHtml(alertChips, asChip.join(''));
    arrows.style.pointerEvents = 'none';
    setHtml(arrows, pos.join(''));
  }
  const alertChips = el('ui-chips'); alertChips.style.top = 'auto'; alertChips.style.bottom = 'calc(var(--sab) + 12px)';
  const onAlert = (e: Event) => {
    const b = (e.target as HTMLElement).closest('[data-site]') as HTMLElement | null;
    if (!b || !last) return;
    const st = last.sites.find((x) => x.def.id === b.dataset.site); if (st) { h.focus(st.x, st.y); select({ kind: 'site', id: st.def.id }, last); }
  };


  // ---------- guided first day (level 1, fresh save): a step list + one bubble; the sim pauses while a step waits for the player ----------
  type Step = { id: string; pause: boolean; ok?: boolean; qty?: number; site?: (s: GameState) => string | undefined; act?: 'deliver' | 'service'; trig: (s: GameState) => boolean; done: (s: GameState) => boolean; text: (s: GameState) => string };
  let bubble: HTMLElement, finger: HTMLElement, rawPause: (p: boolean) => void = () => {};
  // the clock stops while the guide waits for a tap or while the pause/rules card is open
  let guidePause = false, helpOpen = false;
  const setPause = (p: boolean) => { guidePause = p; rawPause(p || helpOpen); };
  function openHelp() {
    helpOpen = true; setPause(guidePause); bubble.classList.add('ui-hidden'); finger.classList.add('ui-hidden');
    showPause();
  }
  let guideSkipped = false;
  const g = { on: false, delivered: new Map<string, number>(), pumps: 0, ack: false, endAt: 0 };
  const noteCmd = (c: Parameters<UiHandlers['command']>[0]) => {
    if (c.type === 'deliver') g.delivered.set(c.siteId, (g.delivered.get(c.siteId) ?? 0) + 1);
    else if (c.type === 'service') g.pumps++;
  };
  const atSite = (s: GameState, id?: string) => s.cabins.filter((c) => c.siteId === id).length;
  const hotCabin = (s: GameState) => s.cabins.find((c) => c.siteId !== null && c.fill / (c.capacity || 1) >= 0.6);
  const truckReady = (s: GameState) => s.trucks.some((t) => t.job === 'idle' && t.path[t.path.length - 1] === s.map.depotNodeId);
  const nm = (s: GameState, id?: string) => shortName(s.sites.find((x) => x.def.id === id)?.def.name ?? '');
  const STEPS: Step[] = [
    { id: 'place1', pause: true, qty: 1, act: 'deliver', site: (s) => s.sites[0]?.def.id, trig: () => true,
      done: (s) => !!g.delivered.get(s.sites[0]?.def.id) || atSite(s, s.sites[0]?.def.id) > 0 || s.sites[0]?.closed || s.time > s.sites[0]?.def.openAt + 30 || !s.cabins.some(clean),
      text: (s) => sel?.kind === 'site' && sel.id === s.sites[0]?.def.id ? 'לחצו על "הצב תאים" כדי להביא תא אחד' : `לחצו על ${nm(s, s.sites[0]?.def.id)} במפה: שם מציבים את התא הראשון` },
    { id: 'watch', pause: false, trig: (s) => !!g.delivered.get(s.sites[0]?.def.id), done: (s) => atSite(s, s.sites[0]?.def.id) > 0 || s.time >= s.sites[1]?.def.openAt - 40,
      text: () => 'המשאית מביאה את התא. מחכים רגע' },
    { id: 'fill', pause: false, trig: (s) => atSite(s, s.sites[0]?.def.id) > 0, done: (s) => s.time >= s.sites[1]?.def.openAt - 40 || !!hotCabin(s),
      text: () => 'התא מוצב. כשהאתר נפתח, העובדים משתמשים בו והוא מתמלא. האתר משלם בסוף. אפשר ללחוץ 2x כדי לזרז' },
    { id: 'place2', pause: true, qty: 2, act: 'deliver', site: (s) => s.sites[1]?.def.id, trig: (s) => s.sites.length > 1 && s.time >= s.sites[1].def.openAt - 40,
      done: (s) => atSite(s, s.sites[1]?.def.id) > 1 || (g.delivered.get(s.sites[1]?.def.id) ?? 0) > 0 || s.sites[1]?.open || !s.cabins.some(clean),
      text: (s) => sel?.kind === 'site' && sel.id === s.sites[1]?.def.id ? 'לחצו "הצב תאים" כדי להביא 2 תאים' : `${nm(s, s.sites[1]?.def.id)} נפתח עוד רגע. לחצו עליו והציבו 2 תאים לפני שהאורחים מגיעים` },
    { id: 'pump', pause: true, act: 'service', site: (s) => hotCabin(s)?.siteId ?? undefined, trig: (s) => !!hotCabin(s) && s.time > 20, done: () => g.pumps > 0,
      text: (s) => sel?.kind === 'site' && sel.id === hotCabin(s)?.siteId ? 'לחצו "שלח משאבה"' : `תא ${prep('ב', nm(s, hotCabin(s)?.siteId ?? undefined))} התמלא ברובו. לחצו על האתר ושלחו משאבה לפני שיגלוש` },
    { id: 'info', pause: true, ok: true, trig: () => g.pumps > 0, done: () => g.ack, text: () => 'האירוע משלם כשהוא נגמר. אפשר לזרז את השעון עם 2x ו-3x' },
    { id: 'pump2', pause: true, act: 'service', site: (s) => hotCabin(s)?.siteId ?? undefined, trig: (s) => g.ack && !!hotCabin(s) && truckReady(s), done: () => g.pumps > 1,
      text: (s) => sel?.kind === 'site' && sel.id === hotCabin(s)?.siteId ? 'לחצו "שלח משאבה"' : `עוד תא ${prep('ב', nm(s, hotCabin(s)?.siteId ?? undefined))} התמלא. שוב לוחצים על האתר ושולחים משאבה` },
    { id: 'end', pause: false, trig: () => g.ack && g.pumps > 1, done: () => g.endAt > 0 && performance.now() > g.endAt, text: () => 'זהו, מכאן לבד: מציבים תאים לפני האירוע, שואבים לפני שמתמלא' },
  ];
  function guideStart(level: LevelDef, save: Save) {
    g.delivered.clear(); g.pumps = 0; g.ack = false; g.endAt = 0;
    g.on = level.id === 1 && !Object.values(save.stars).some((n) => n > 0) && !guideSkipped;
  }
  function guideStop(skip: boolean) { if (skip) guideSkipped = true; g.on = false; setPause(false); bubble.classList.add('ui-hidden'); finger.classList.add('ui-hidden'); sheet.querySelectorAll('.guide-pulse').forEach((b) => b.classList.remove('guide-pulse')); }
  function guideTick(s: GameState) {
    if (!g.on || helpOpen) return;
    if (s.over || s.level.id !== 1) return guideStop(false);
    const step = STEPS.find((x) => !x.done(s) && x.trig(s));
    if (!step) { setPause(false); bubble.classList.add('ui-hidden'); finger.classList.add('ui-hidden'); return; }
    if (step.id === 'end' && !g.endAt) g.endAt = performance.now() + 7000;
    if (step.id === 'end' && g.endAt && performance.now() > g.endAt) return guideStop(false);
    const wait = step.act === 'deliver' && !truckReady(s) || step.act === 'service' && !s.trucks.some((t) => t.job === 'idle');
    setPause(step.pause && !wait);
    const target = step.site?.(s), pt = target ? s.sites.find((x) => x.def.id === target) : undefined;
    const txt = wait ? 'מחכים שהמשאית תתפנה' : step.text(s);
    setHtml(bubble, `${step.pause && !wait ? '<small>השעון עצור עד שתלחצו</small>' : ''}<span>${esc(txt)}</span>${step.ok ? '<button class="btn go" data-g="ok">הבנתי</button>' : ''}<a data-g="skip">דלג על ההדרכה</a>`);
    bubble.classList.remove('ui-hidden');
    const top = Math.max(chips.getBoundingClientRect().bottom, hud.getBoundingClientRect().bottom) + 8 - root.getBoundingClientRect().top;
    bubble.style.top = Math.round(top) + 'px';
    // site plate (~160px above the pad incl. its name row) must land below the bubble, not under it
    if (pt && step.pause && stepFocused !== step.id) {
      stepFocused = step.id;
      if (sel && !(sel.kind === 'site' && sel.id === target)) select(null, s); // another site's sheet would hide the map
      h.focus(pt.x, pt.y, Math.max(0, top + bubble.offsetHeight + 170 - root.clientHeight / 2));
    }
    // finger over the site on the map; pulse the button in the sheet
    const onSheetOf = sel?.kind === 'site' && sel.id === target;
    const p = pt && view && !wait && !onSheetOf ? view(pt.x, pt.y) : null;
    if (p && p.x > 0 && p.x < root.clientWidth && p.y > 0) { finger.style.left = p.x + 'px'; finger.style.top = Math.max(top + 70, p.y - 90) + 'px'; finger.classList.remove('ui-hidden'); } else finger.classList.add('ui-hidden');
    sheet.querySelectorAll('[data-act]').forEach((b) => b.classList.toggle('guide-pulse', onSheetOf && !wait && (b as HTMLElement).dataset.act === step.act));
  }
  let stepFocused = '';
  /** the cabin count the current guide step asks for on this site (0 = no guide default) */
  function guideQty(siteId: string) { if (!g.on || !last) return 0; const st = STEPS.find((x) => !x.done(last!) && x.trig(last!)); return st?.qty && st.site?.(last!) === siteId ? st.qty : 0; }

  // ---------- cards ----------
  const showCard = (inner: string, cls = '') => { cardWrap.innerHTML = `<div class="ui-card ${cls}">${inner}</div>`; cardWrap.classList.remove('ui-hidden'); cardWrap.scrollTop = 0; hud.classList.add('ui-hidden'); chips.classList.add('ui-hidden'); sheet.classList.add('ui-hidden'); arrows.style.display = 'none'; alertChips.style.display = 'none'; sel = null; };
  const hideCard = () => { cardWrap.classList.add('ui-hidden'); cardWrap.textContent = ''; hud.classList.remove('ui-hidden'); chips.classList.remove('ui-hidden'); arrows.style.display = ''; alertChips.style.display = ''; };
  const on = (q: string, fn: () => void) => cardWrap.querySelector(q)?.addEventListener('click', fn);
  const LOGO = `<div class="logo"><img src="/play/assets/logo-white.svg" alt="בראשית"></div>`;
  const BACK = `<button class="ui-back" data-back aria-label="חזרה">→ חזרה</button>`;
  const star = (cls = '', w = 26) => STAR.replace('<svg', `<svg width="${w}" height="${w}" class="${cls}"`);
  const starsOf = (n: number, w = 16) => [0, 1, 2].map((i) => star(i < n ? 'on' : 'off', w)).join('');
  const totalStars = (sv: Save) => Object.values(sv.stars).reduce((a, b) => a + b, 0);
  /** City of a level: the 'city' unlock that led to it, else the first city. */
  const cityName = (id: number) => { for (let i = id - 2; i >= 0; i--) if (LEVELS[i].unlock?.kind === 'city') return LEVELS[i].unlock!.name; return 'עיר הבנייה'; };
  /** Two-tap confirm inside the card (no native confirm()): first tap arms, second within 4 s does it. */
  const armed = (btn: HTMLButtonElement | null, ask: string, fn: () => void) => {
    if (!btn) return; const orig = btn.innerHTML; let t = 0;
    btn.addEventListener('click', () => {
      if (btn.dataset.armed) { clearTimeout(t); fn(); return; }
      btn.dataset.armed = '1'; btn.classList.add('danger'); btn.innerHTML = ask; buzz(30);
      t = window.setTimeout(() => { delete btn.dataset.armed; btn.classList.remove('danger'); btn.innerHTML = orig; }, 4000);
    });
  };
  let saveNow: Save | null = null; // latest save the shell screens read
  let mapFrom: () => void = () => {};

  /** Title screen + main menu. */
  function showTitle(save: Save, note = '') {
    saveNow = save; helpOpen = false;
    const started = save.level > 1 || Object.keys(save.stars).length > 0, done = (save.stars[LEVELS.length] ?? 0) > 0;
    showCard(`<div class="title-hero"><img class="t-logo" src="/play/assets/logo-white.svg" alt="בראשית"><div class="t-scene" aria-hidden="true"><img class="t-cab a" src="/play/assets/cabin.svg" alt=""><img class="t-cab b" src="/play/assets/cabin.svg" alt=""><img class="t-truck" src="/play/assets/truck.svg" alt=""></div><h1>משאיות השירותים של העיר</h1></div>` +
      (note ? `<div class="note">${esc(note)}</div>` : '') +
      `<button class="btn go big" data-play>${!started ? 'משחקים' : done ? 'משחקים שוב' : `ממשיכים מיום ${save.level}`}</button>` +
      `<div class="menu"><button class="btn alt" data-map><span>🗺️</span>מפת השלבים</button><button class="btn alt" data-me><span>🏆</span>האזור שלי</button>` +
      `<button class="btn alt" data-how><span>📖</span>איך משחקים</button><button class="btn alt" data-set><span>⚙️</span>הגדרות</button></div>` +
      `<div class="t-foot">${star('on', 18)} ${totalStars(save)} / ${LEVELS.length * 3} · יום ${Math.min(save.level, LEVELS.length)} מתוך ${LEVELS.length}</div>`, 'title');
    on('[data-play]', () => { sfx('go'); if (done) { mapFrom = () => showTitle(save); showMap(save); } else showDayStart(LEVELS[Math.min(save.level, LEVELS.length) - 1], save); });
    on('[data-map]', () => { mapFrom = () => showTitle(save); showMap(save); });
    on('[data-me]', () => showProfile(save, () => showTitle(save)));
    on('[data-how]', () => showHowTo(() => showTitle(save)));
    on('[data-set]', () => showSettings(() => showTitle(save)));
  }

  /** Levels map: every day by city, stars won, locked days greyed; an open day can be replayed. */
  function showMap(save: Save) {
    let html = '', city = '';
    for (const l of LEVELS) {
      const c = cityName(l.id);
      if (c !== city) { html += `${city ? '</div>' : ''}<h4>${esc(c)}</h4><div class="lv-grid">`; city = c; }
      const open = l.id <= save.level, st = save.stars[l.id] ?? 0, cur = l.id === save.level && st === 0;
      html += `<button class="lv${open ? '' : ' lock'}${cur ? ' cur' : ''}" data-lv="${l.id}"${open ? '' : ' disabled'} aria-label="יום ${l.id}${open ? '' : ' נעול'}"><b>${open ? l.id : '🔒'}</b><span>${open ? starsOf(st, 14) : ''}</span></button>`;
    }
    showCard(`${BACK}<h2>מפת השלבים</h2><div class="ui-sub dark">${star('on', 18)} ${totalStars(save)} מתוך ${LEVELS.length * 3} כוכבים · לוחצים על יום פתוח כדי לשחק אותו</div>${html}</div>`, 'screen');
    on('[data-back]', mapFrom);
    cardWrap.querySelectorAll('[data-lv]').forEach((b) => b.addEventListener('click', () => { const l = LEVELS[+(b as HTMLElement).dataset.lv! - 1]; if (l.id <= save.level) showDayStart(l, save); }));
  }

  /** Personal area: progress, stars, best profit per day, the fleet. */
  function showProfile(save: Save, back: () => void) {
    const won = LEVELS.filter((l) => (save.stars[l.id] ?? 0) > 0).length, three = LEVELS.filter((l) => save.stars[l.id] === 3).length;
    const best = save.best ?? {}, bestSum = Object.values(best).reduce((a, b) => a + b, 0);
    const top = Object.entries(best).sort((a, b) => b[1] - a[1])[0];
    const rows = LEVELS.filter((l) => l.id <= save.level).map((l) => `<div class="pr-row"><span class="d">יום ${l.id}</span><span class="nm">${esc(l.title)}</span><span class="s">${starsOf(save.stars[l.id] ?? 0, 13)}</span><span class="v">${best[l.id] !== undefined ? fmt(best[l.id]) : '—'}</span></div>`).join('');
    const ups = upgrades.map((u) => `<div class="pr-up"><span>${esc(u.name)}</span><b>${save.upgrades[u.id] + 1} / ${u.costs.length + 1}</b></div>`).join('');
    showCard(`${BACK}<h2>האזור שלי</h2>` +
      `<div class="stats"><div><b>${won}</b><span>ימים הושלמו</span></div><div><b>${totalStars(save)}</b><span>כוכבים</span></div><div><b>${three}</b><span>ימים מושלמים</span></div>` +
      `<div><b>${fmt(save.coins)}</b><span>בקופה</span></div><div><b>${fmt(bestSum)}</b><span>סך השיאים</span></div><div><b>${top ? fmt(top[1]) : '—'}</b><span>${top ? `השיא: יום ${top[0]}` : 'שיא יומי'}</span></div></div>` +
      `<h4>הצי והמחסן</h4><div class="pr-ups">${ups}</div>` +
      `<h4>השיאים שלי</h4><div class="pr-head"><span>יום</span><span></span><span>כוכבים</span><span>רווח שיא</span></div><div class="pr-list">${rows}</div>`, 'screen');
    on('[data-back]', back);
  }

  /** Settings: sound, vibration, reset progress, about + privacy. */
  function showSettings(back: () => void) {
    const tg = (k: 'sound' | 'vibe', label: string, icon: string) => `<button class="tg${prefs[k] ? ' on' : ''}" data-tg="${k}" role="switch" aria-checked="${prefs[k]}"><span>${icon} ${label}</span><i></i></button>`;
    showCard(`${BACK}<h2>הגדרות</h2><div class="tgs">${tg('sound', 'צלילים', '🔊')}${tg('vibe', 'רטט', '📳')}</div>` +
      `<h4>התקדמות</h4><button class="btn alt" data-reset>מתחילים מחדש מיום 1</button><div class="ui-sub dark">מוחק כוכבים, מטבעות ושדרוגים במכשיר הזה.</div>` +
      `<h4>על המשחק</h4><div class="about">משחק של <b>בראשית</b>: שירותים כימיים, משאיות ושטיפה. ההתקדמות נשמרת רק במכשיר הזה. המשחק לא אוסף פרטים אישיים ולא שולח מידע לשום מקום.<br>גופן: Rubik (רישיון OFL).</div>`, 'screen');
    on('[data-back]', back);
    cardWrap.querySelectorAll('[data-tg]').forEach((b) => b.addEventListener('click', () => {
      const k = (b as HTMLElement).dataset.tg as 'sound' | 'vibe', v = !prefs[k]; setPref(k, v);
      b.classList.toggle('on', v); b.setAttribute('aria-checked', String(v)); if (k === 'sound' && v) { unlockAudio(); sfx('coin'); } if (k === 'vibe' && v) buzz(40);
    }));
    armed(cardWrap.querySelector('[data-reset]'), 'בטוחים? לוחצים שוב כדי למחוק הכל', () => h.restart());
  }

  /** How to play: from the menu, before the first day of a new game, and from the pause card. */
  function showHowTo(then: () => void, paused = false) {
    showCard(LOGO + `<h2>איך משחקים</h2>` +
      `<div class="ui-sub dark">אתם מנהלים את משאיות השירותים של בראשית. אין יריב: משחקים נגד השעון.</div>` +
      `<ul class="rules">` +
      `<li>🎉 <span>בכל יום יש אירועים בעיר: חתונות, הופעות, אתרי בנייה. האורחים משתמשים בתאים והתאים מתמלאים.</span></li>` +
      `<li>🚽 <span>לוחצים על אתר ← <b>הצב תאים</b>: המשאית מביאה תאים מהמחסן.</span></li>` +
      `<li>🚚 <span>תא מתמלא? לוחצים על האתר ← <b>שלח משאבה</b>: המשאית שואבת ומרוקנת את המיכל במחסן או בתחנת ריקון.</span></li>` +
      `<li>⚠️ <span>תא שמתמלא עד הסוף = עומס יתר = קנס. מקדימים את המשאבה.</span></li>` +
      `<li>⏰ <span>גם אתר פתוח <b>בלי תאים</b> מקבל קנס. מציבים תאים <b>לפני</b> שהאירוע נפתח.</span></li>` +
      `<li>🧽 <span>האירוע נגמר? לוחצים עליו ← <b>החזר תאים לשטיפה</b>: המשאית אוספת אותם למחסן, ורק תא שטוף יוצא שוב.</span></li>` +
      `<li>${COIN} <span>התשלום מגיע כשהאירוע נגמר, ואובד אם היה עומס יתר של יותר מ-${ECON.feeOverflowTolerance} שניות. בכסף קונים שדרוגים.</span></li>` +
      `</ul>` +
      `<button class="btn go" data-ok>${paused ? 'חזרה' : 'הבנתי, יאללה'}</button>`);
    on('[data-ok]', () => { setPref('howto', true); then(); });
  }

  /** Pause: the clock holds while this card is open. */
  function showPause() {
    const lv = last?.level;
    showCard(LOGO + `<h2>המשחק עצור</h2><div class="ui-sub dark">השעון לא זז עד שחוזרים לשחק.</div>` +
      `<button class="btn go" data-ok>חוזרים לשחק</button>` +
      `<div class="menu"><button class="btn alt" data-how><span>📖</span>איך משחקים</button><button class="btn alt" data-set><span>⚙️</span>הגדרות</button></div>` +
      `<button class="btn alt" data-again>מתחילים את היום מחדש</button><button class="btn alt" data-menu style="margin-top:8px">לתפריט הראשי</button>`);
    on('[data-ok]', () => { hideCard(); helpOpen = false; setPause(guidePause); });
    on('[data-how]', () => showHowTo(showPause, true));
    on('[data-set]', () => showSettings(showPause));
    armed(cardWrap.querySelector('[data-again]'), 'לוחצים שוב: היום יתחיל מההתחלה', () => { helpOpen = false; guideStop(false); if (lv) begin(lv, saveNow!); });
    armed(cardWrap.querySelector('[data-menu]'), 'לוחצים שוב: היום הזה לא יישמר', () => { helpOpen = false; guideStop(false); h.toMenu(); });
  }

  /** Start a day right away (the card's go button, a restart, or the auto-start after a city change). */
  function begin(level: LevelDef, save: Save) { saveNow = save; hideCard(); speed = 1; paintSpeed(); h.setSpeed(1); h.startDay(level.id); guideStart(level, save); }

  function showDayStart(level: LevelDef, save: Save) {
    saveNow = save;
    if (level.id === 1 && !Object.keys(save.stars).length && !prefs.howto) return showHowTo(() => showDayStart(level, save));
    const len = level.dayLength;
    const nu = LEVELS[level.id - 2]?.unlock; // the previous level's unlock describes what this day brings: introduce it on the day it first appears
    const nuText = (u: NonNullable<typeof nu>) => { const d = u.desc.replace(/^הבא:\s*/, ''); return d.startsWith(u.name + '. ') ? d.slice(u.name.length + 2) : d; }; // the city name is already the title
    const sites = level.sites.map((s) => `<div class="site-row"><span>${SITE_ICON[s.type]}</span><span>${esc(s.name)}</span><span class="t">${clock(s.openAt, len)}–${clock(s.closeAt, len)}</span></div>`).join('');
    const best = save.stars[level.id] ?? 0, replay = level.id < save.level;
    showCard(`<div class="card-top"><button class="ui-back" data-menu aria-label="לתפריט">☰ תפריט</button><span class="bank">${COIN}<b>${fmt(save.coins)}</b></span></div>` +
      `<h2>יום ${level.id}: ${esc(level.title)}</h2>` +
      (replay ? `<div class="ui-sub dark">משחקים שוב · הכי טוב עד עכשיו: ${starsOf(best, 16)}</div>` : '') +
      (nu ? `<div class="teaser"><div style="font-size:34px">${ICON[nu.kind] ?? '🎁'}</div><div><b>חדש היום: ${esc(nu.name)}</b><span>${esc(nuText(nu))}</span></div></div>` : '') +
      `<h4>האתרים היום</h4><div class="sites">${sites}</div>` +
      `<h4>המטרה</h4><ul class="rules"><li>${star()} <span>כוכב: מסיימים את היום ברווח (שכר פחות קנסות גדול מאפס)</span></li>` +
      `<li>${star()}${star()} <span>שני כוכבים: גם עומס יתר של עד ${ECON.feeOverflowTolerance} שניות בסך הכל</span></li>` +
      `<li>${star()}${star()}${star()} <span>שלושה: גם רווח של ${fmt(level.coinTarget)} ${COIN} ביום (הרווח של היום, לא מה שבקופה)</span></li></ul>` +
      `<div class="foot"><button class="btn go" data-go>${level.id === 1 && !replay ? 'יוצאים לעבודה' : replay ? `משחקים את יום ${level.id}` : `ממשיכים מיום ${level.id}`}</button><button class="btn alt" data-how>איך משחקים?</button></div>`);
    on('[data-go]', () => { sfx('go'); begin(level, save); });
    on('[data-how]', () => showHowTo(() => showDayStart(level, save)));
    on('[data-menu]', () => h.toMenu());
  }

  /** Main reason the day lost stars: the site with the biggest loss (fine + forfeited fee), with one tip. Null when nothing to say. */
  function lossCause(r: DayResult): { line: string; tip: string } | null {
    const s = last; if (!s || s.level.id !== r.levelId) return null;
    let worst: GameState['sites'][number] | null = null, wl = 0, wf = 0, wForfeit = false;
    for (const st of s.sites) {
      const fine = Math.floor(st.overflowSec * st.def.overflowFinePerSec + 1e-6), forfeit = st.overflowSec > ECON.feeOverflowTolerance;
      const loss = fine + (forfeit ? st.def.fee : 0);
      if (loss > wl) { worst = st; wl = loss; wf = fine; wForfeit = forfeit; }
    }
    if (!worst) return r.earned - r.fines <= 0 ? { line: 'לא נכנס כסף: התשלום מגיע רק כשהאירוע נגמר.', tip: 'הציבו תאים באתרים ושלחו משאבה לפני שהם מתמלאים.' } : null;
    const tol = ECON.feeOverflowTolerance, nm = worst.def.name, sec = wForfeit ? Math.max(tol + 1, Math.ceil(worst.overflowSec)) : Math.min(tol, Math.floor(worst.overflowSec)), // 'over 12 s' = forfeit: never show 12 next to a lost fee
    nc = Math.round(book?.s === s ? book.noCab.get(worst.def.id) ?? 0 : 0);
    const noCabMain = nc >= worst.overflowSec * 0.5;
    const line = (noCabMain ? `האתר ${nm} היה פתוח בלי תאים: ${sec} שניות עומס יתר` : `האתר ${nm} היה בעומס יתר ${sec} שניות`) + `: קנס ${fmt(wf)}` + (wForfeit ? ` והתשלום (${fmt(worst.def.fee)}) אבד` : '');
    const tip = noCabMain ? `הציבו תאים לפני הפתיחה (${clock(worst.def.openAt, s.level.dayLength)}).` : 'שלחו משאבה כשהתא מלא בערך בשני שליש, לפני שהוא מתמלא.';
    return { line, tip };
  }

  function showDayEnd(r: DayResult, save: Save, next: LevelDef | undefined) {
    shopSave = JSON.parse(JSON.stringify(save)); saveNow = shopSave;
    // a level's unlock describes what the following level brings, so show the one just won
    const u = r.stars >= 1 && next ? LEVELS.find((l) => l.id === r.levelId)?.unlock : undefined;
    const stars = [0, 1, 2].map((i) => STAR.replace('<svg', `<svg class="${i < r.stars ? 'on' : ''}" style="--d:${0.3 + i * 0.35}s"`)).join('');
    const cause = lossCause(r), won = r.stars >= 1, last24 = won && !next;
    const kept = !won && !!last && last.level.id === r.levelId && !!book && book.s === last && book.minCoins < last.coinsStart;
    const msg = r.stars === 3 ? 'מושלם! אלופי השירות!' : r.stars === 2 ? 'יופי של יום!' : r.stars === 1 ? 'סיימנו! אפשר יותר' : 'יום קשה, ננסה שוב';
    const record = won && save.best?.[r.levelId] === r.earned - r.fines && r.earned - r.fines > 0;
    showCard(`<h2>${msg}</h2><div class="big-stars">${stars}</div>` +
      `<div class="sum"><div class="pos">הרווחנו<b>+${fmt(r.earned)}</b></div><div class="neg">קנסות<b>${r.fines ? `−${fmt(r.fines)}` : '0'}</b></div><div>בקופה<b>${fmt(save.coins)}</b></div></div>` +
      (record ? `<div class="ui-sub dark">🏆 שיא חדש ליום ${r.levelId}</div>` : '') +
      (cause && r.stars < 2 ? `<div class="cause"><b>${esc(cause.line)}</b><span>טיפ: ${esc(cause.tip)}</span></div>` : '') +
      (kept ? `<div class="ui-sub dark">הקנסות לא נגעו בחיסכון: ${fmt(save.coins)} נשארו בקופה.</div>` : '') +
      (r.stars < 3 ? `<div class="ui-sub dark">כוכב שלישי: רווח של ${fmt(r.coinTarget)} ביום, עם עד ${ECON.feeOverflowTolerance} שניות עומס יתר</div>` : '') +
      (u ? `<div class="teaser"><div style="font-size:34px">${ICON[u.kind] ?? '🎁'}</div><div><b>בשלב הבא נפתח: ${esc(u.name)}</b><span>${esc(u.desc)}</span></div></div>` : '') +
      (last24 ? '' : `<h4>שדרוגים</h4><div class="shop" data-shop></div>`) +
      `<div class="foot"><button class="btn go" data-next>${last24 ? 'לסיום המשחק 🎉' : won ? 'ליום הבא' : `נסה שוב את יום ${r.levelId}`}</button><button class="btn alt" data-menu>לתפריט</button></div>`);
    if (won) { sfx('win'); for (let i = 0; i < r.stars; i++) sfx('star', 0.3 + i * 0.35); } else sfx('lose');
    paintShop();
    cardWrap.querySelector('[data-shop]')?.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-up]') as HTMLButtonElement | null;
      if (!b || b.disabled || !shopSave) return;
      const u = upgrades.find((x) => x.id === b.dataset.up)!;
      const cost = u.costs[shopSave.upgrades[u.id]];
      const res = h.buyUpgrade(u.id);
      if (!res.ok) return say(res.reason ?? 'אין מספיק מטבעות');
      shopSave.coins -= cost; shopSave.upgrades[u.id]++; // local mirror of what the handler persisted
      sfx('coin'); say('שודרג!'); paintShop();
      const sum = cardWrap.querySelectorAll('.sum b')[2]; if (sum) sum.textContent = fmt(shopSave.coins);
    });
    on('[data-next]', () => { if (next) showDayStart(next, shopSave!); else showEnding(shopSave!); });
    on('[data-menu]', () => h.toMenu());
  }

  /** After the last day: the whole run in one card, then the map (chase 3 stars) or the menu. */
  function showEnding(save: Save) {
    const n = totalStars(save), max = LEVELS.length * 3;
    showCard(`<div class="confetti" aria-hidden="true">${Array.from({ length: 18 }, (_, i) => `<i style="--x:${(i * 37) % 100}%;--d:${(i % 6) * 0.25}s;--c:${['#FFCC00', '#29a3dd', '#E5484D', '#4CAF50'][i % 4]}"></i>`).join('')}</div>` +
      LOGO + `<h2>סיימתם את כל ${LEVELS.length} הימים!</h2>` +
      `<div class="ui-sub dark">עברתם ${new Set(LEVELS.map((l) => cityName(l.id))).size} ערים, מאתר הבנייה הראשון ועד מסיבת פורים בעיר הלילה. הצי של בראשית מוכן לכל אירוע.</div>` +
      `<div class="stats"><div><b>${n}</b><span>כוכבים מתוך ${max}</span></div><div><b>${fmt(save.coins)}</b><span>בקופה</span></div><div><b>${LEVELS.filter((l) => save.stars[l.id] === 3).length}</b><span>ימים מושלמים</span></div></div>` +
      (n < max ? `<div class="ui-sub dark">רוצים את כל הכוכבים? כל יום פתוח במפת השלבים.</div>` : `<div class="ui-sub dark">כל הכוכבים! אלופי השירות של בראשית.</div>`) +
      `<div class="soon">🏙️ <b>עיר חדשה בקרוב</b></div>` +
      `<div class="foot"><button class="btn go" data-map>למפת השלבים</button><button class="btn alt" data-menu>לתפריט הראשי</button></div>`, 'ending');
    sfx('win');
    on('[data-map]', () => { mapFrom = () => showEnding(save); showMap(save); });
    on('[data-menu]', () => h.toMenu());
  }

  function paintShop() {
    const box = cardWrap.querySelector('[data-shop]') as HTMLElement | null; if (!box || !shopSave) return;
    box.innerHTML = upgrades.filter((u) => shopSave!.level >= (u.fromLevel ?? 0)).map((u) => {
      const lvl = shopSave!.upgrades[u.id], cost = u.costs[lvl], maxed = cost === undefined;
      const poor = !maxed && shopSave!.coins < cost;
      return `<div class="up"><div class="nm">${esc(u.name)} · רמה ${lvl + 1}<small>${esc(u.desc)}</small></div>` +
        `<button class="btn" data-up="${u.id}"${maxed || poor ? ' disabled' : ''}>${maxed ? 'מקסימום' : `<small>שדרג</small>${fmt(cost)} ${COIN}`}</button></div>`;
    }).join('');
  }

  return { mount, update, select, showDayStart, showDayEnd, showTitle, begin, setView: (fn) => { view = fn; }, setPause: (fn) => { rawPause = fn; } };
}
