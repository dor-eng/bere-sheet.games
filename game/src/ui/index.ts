/// <reference types="vite/client" />
// DOM Hebrew RTL UI over the canvas. Reads GameState, calls handlers only (no sim logic, no canvas).
import { LEVELS } from '../sim/index.ts';
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
  pumping: ['שואב', 's-pump'], dumping: ['מרוקן', 's-dump'],
};
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
const setHtml = (e: HTMLElement, h: string) => { if (e.dataset.h !== h) { e.dataset.h = h; e.innerHTML = h; } };

export interface UiExtra {
  /** Optional: world->screen projection from render (null = unknown). Enables edge arrows; otherwise alerts are shown as chips. */
  setView(fn: ((x: number, y: number) => { x: number; y: number } | null) | null): void;
}

export function createUi(): UiApi & UiExtra {
  let h: UiHandlers;
  let root: HTMLElement;
  let hud: HTMLElement, chips: HTMLElement, sheet: HTMLElement, toast: HTMLElement, cardWrap: HTMLElement, arrows: HTMLElement;
  let coinsEl: HTMLElement, clockEl: HTMLElement, progEl: HTMLElement, speedEl: HTMLElement;
  let sel: Selection = null;
  let last: GameState | null = null;
  let deliverN = 1, speed: 1 | 2 | 3 = 1, toastT = 0, lastCoins = -1;
  let view: ((x: number, y: number) => { x: number; y: number } | null) | null = null;
  const hist = new Map<string, { t: number; v: number }[]>();
  let shopSave: Save | null = null;

  const say = (msg: string) => { toast.textContent = msg; toast.classList.add('on'); clearTimeout(toastT); toastT = window.setTimeout(() => toast.classList.remove('on'), 2200); };
  const run = (c: Parameters<UiHandlers['command']>[0]) => { const r = h.command(c); if (!r.ok) say(r.reason ?? 'לא הצלחנו, נסו שוב'); else if (c.type === 'recall') say('המשאבה חוזרת הביתה'); else say(c.type === 'service' ? 'המשאבה בדרך!' : 'התאים בדרך!'); return r; };
  const idleTruck = (s: GameState): Truck | undefined => s.trucks.find((t) => t.job === 'idle') ?? s.trucks[0];

  function mount(r: HTMLElement, handlers: UiHandlers) {
    root = r; h = handlers; root.textContent = '';
    hud = el('ui-hud ui-hidden');
    hud.innerHTML = `<div class="ui-coins">${COIN}<span data-k="coins">0</span></div><div class="ui-clock" data-k="clock">06:00</div>` +
      `<div class="ui-speed">${[1, 2, 3].map((x) => `<button data-sp="${x}" aria-label="מהירות ${x}">${x}x</button>`).join('')}</div><div class="ui-prog"><i></i></div>`;
    coinsEl = hud.querySelector('[data-k=coins]')!; clockEl = hud.querySelector('[data-k=clock]')!;
    progEl = hud.querySelector('.ui-prog i')!; speedEl = hud.querySelector('.ui-speed')!;
    hud.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-sp]') as HTMLElement | null;
      if (b) { speed = +b.dataset.sp! as 1 | 2 | 3; h.setSpeed(speed); paintSpeed(); }
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
    root.append(hud, chips, arrows, alertChips, sheet, toast, cardWrap);
  }

  function paintSpeed() { speedEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +(b as HTMLElement).dataset.sp! === speed)); }

  function onSheet(e: Event) {
    const b = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!b || !last || !sel) return;
    const a = b.dataset.act;
    if (a === 'close') return select(null, last);
    if (a === 'minus') { deliverN = Math.max(1, deliverN - 1); return refreshSheet(last); }
    if (a === 'plus') { deliverN = Math.min(8, deliverN + 1); return refreshSheet(last); }
    const t = idleTruck(last);
    if (!t) return say('אין משאבה פנויה');
    if (a === 'service' && sel.kind === 'site') run({ type: 'service', truckId: t.id, siteId: sel.id });
    else if (a === 'deliver' && sel.kind === 'site') run({ type: 'deliver', truckId: t.id, siteId: sel.id, count: deliverN });
    else if (a === 'recall' && sel.kind === 'truck') run({ type: 'recall', truckId: sel.id });
    else if (a === 'service-depot') { /* depot has no extra action */ }
  }

  function select(s: Selection, st: GameState) {
    sel = s; last = st; deliverN = 1;
    sheet.dataset.h = '';
    if (!s) { sheet.classList.add('ui-hidden'); return; }
    sheet.classList.remove('ui-hidden'); refreshSheet(st);
  }

  function trendOf(id: string): string {
    const a = hist.get(id); if (!a || a.length < 2) return 'יציב';
    const d = a[a.length - 1].v - a[0].v;
    return d > 0.08 ? '⬆ מתמלא מהר' : d > 0.02 ? '↗ מתמלא' : d < -0.02 ? '⬇ מתרוקן' : 'יציב';
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
      const status = st.closed ? 'האתר סגור' : st.open ? 'האתר פתוח' : 'עוד לא נפתח';
      html = `<h3><span>${SITE_ICON[st.def.type]} ${esc(st.def.name)}</span><button class="ui-x" data-act="close" aria-label="סגור">✕</button></h3>` +
        `<div class="ui-sub">${status} · <span class="trend">${trendOf(st.def.id)}</span> · ${DROP}</div>` +
        `<div class="ui-cabins">${cabs.map((c) => { const p = pct(c.fill, c.capacity); return `<div class="cab"><div class="gauge ${heat(p)}"><i style="height:${p}%"></i></div>${p}%</div>`; }).join('') || '<div class="ui-sub">אין תאים באתר</div>'}</div>` +
        `<div class="ui-sub">${cabs.length ? `ממוצע ${pct(total, 1)}%` : ''} · במחסן: ${free} תאים${wash ? ` (${wash} בשטיפה)` : ''}</div>` +
        `<div class="row"><button class="btn" data-act="service"${st.closed ? ' disabled' : ''}>שלח משאבה</button></div>` +
        `<div class="row"><div class="step"><button data-act="minus" aria-label="פחות">−</button><span>${deliverN}</span><button data-act="plus" aria-label="עוד">+</button></div>` +
        `<button class="btn alt" data-act="deliver"${st.closed || !free ? ' disabled' : ''}>הצב תאים</button></div>`;
    } else if (sel.kind === 'truck') {
      const t = s.trucks.find((x) => x.id === sel!.id); if (!t) return;
      const p = pct(t.tank, t.tankCap);
      html = `<h3><span>🚚 ${esc(t.name)}</span><button class="ui-x" data-act="close" aria-label="סגור">✕</button></h3>` +
        `<div class="ui-sub">מצב: <b>${JOB[t.job][0]}</b> · מיכל ${p}% <span class="mini ${heat(p)}"><i style="width:${p}%"></i></span></div>` +
        (t.carrying ? `<div class="ui-sub">מובילה ${t.carrying} תאים</div>` : '') +
        `<div class="row"><button class="btn alt" data-act="recall"${t.job === 'idle' ? ' disabled' : ''}>חזרה למחסן</button></div>`;
    } else {
      const free = s.cabins.filter(clean).length, wash = s.cabins.filter(dirty).length;
      html = `<h3><span>🏭 המחסן</span><button class="ui-x" data-act="close" aria-label="סגור">✕</button></h3>` +
        `<div class="ui-sub">נקיים: <b>${free}</b> · בשטיפה: <b>${wash}</b></div>` +
        (wash ? `<div class="ui-sub">תאים שחוזרים מאתר נשטפים לפני שיוצאים שוב.</div>` : '') +
        s.trucks.map((t) => { const p = pct(t.tank, t.tankCap); return `<div class="ui-sub">${esc(t.name)} · ${JOB[t.job][0]} · מיכל ${p}% <span class="mini ${heat(p)}"><i style="width:${p}%"></i></span></div>`; }).join('') +
        `<div class="ui-sub">הציבו תאים דרך לחיצה על אתר.</div>`;
    }
    setHtml(sheet, html);
  }

  let lastSlow = 0;
  function update(s: GameState) {
    last = s;
    const coins = Math.floor(s.coins);
    if (coins !== lastCoins) { lastCoins = coins; coinsEl.textContent = fmt(coins); }
    clockEl.textContent = clock(s.time, s.level.dayLength);
    progEl.style.width = pct(s.time, s.level.dayLength) + '%';
    // trucks chips
    setHtml(chips, s.trucks.map((t) => { const p = pct(t.tank, t.tankCap); return `<button class="ui-chip" data-truck="${t.id}" style="font-family:inherit">🚚 <b>${esc(t.name)}</b><span class="st ${JOB[t.job][1]}">${JOB[t.job][0]}</span><span class="mini ${heat(p)}"><i style="width:${p}%"></i></span></button>`; }).join(''));
    // alerts: sites close to overflow
    const hot = s.sites.filter((st) => st.open && !st.closed && (st.overflowSec > 0 || s.cabins.some((c) => c.siteId === st.def.id && c.fill / (c.capacity || 1) >= 0.85)));
    paintAlerts(hot);
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

  function paintAlerts(hot: GameState['sites']) {
    if (!view) { // fallback: alert chips in the chip column
      const html = hot.map((st) => `<button class="ui-chip" data-site="${st.def.id}" style="font-family:inherit;background:#ffe1e1">⚠️ <b>${esc(st.def.name)}</b></button>`).join('');
      setHtml(arrows, ''); alertChips.innerHTML = html;
      return;
    }
    alertChips.innerHTML = '';
    const W = root.clientWidth, H = root.clientHeight, m = 36;
    let out = '';
    const pos: string[] = [];
    for (const st of hot) {
      const p = view(st.x, st.y); if (!p) continue;
      if (p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H) continue; // visible on screen
      const cx = W / 2, cy = H / 2, dx = p.x - cx, dy = p.y - cy;
      const k = Math.min((W / 2 - m) / (Math.abs(dx) || 1e-6), (H / 2 - m - 100) / (Math.abs(dy) || 1e-6));
      const x = cx + dx * k, y = cy + dy * k, ang = Math.atan2(dy, dx);
      pos.push(`<button class="ui-arrow" data-site="${st.def.id}" style="left:${x.toFixed(0)}px;top:${y.toFixed(0)}px" aria-label="${esc(st.def.name)}"><span style="display:block;transform:rotate(${ang.toFixed(2)}rad)">➤</span></button>`);
    }
    out = pos.join('');
    arrows.style.pointerEvents = 'none';
    setHtml(arrows, out);
  }
  const alertChips = el('ui-chips'); alertChips.style.top = 'auto'; alertChips.style.bottom = 'calc(var(--sab) + 300px)';
  const onAlert = (e: Event) => {
    const b = (e.target as HTMLElement).closest('[data-site]') as HTMLElement | null;
    if (!b || !last) return;
    const st = last.sites.find((x) => x.def.id === b.dataset.site); if (st) { h.focus(st.x, st.y); select({ kind: 'site', id: st.def.id }, last); }
  };

  // ---------- cards ----------
  const showCard = (inner: string) => { cardWrap.innerHTML = `<div class="ui-card">${inner}</div>`; cardWrap.classList.remove('ui-hidden'); hud.classList.add('ui-hidden'); chips.classList.add('ui-hidden'); sheet.classList.add('ui-hidden'); arrows.style.display = 'none'; alertChips.style.display = 'none'; sel = null; };
  const hideCard = () => { cardWrap.classList.add('ui-hidden'); cardWrap.textContent = ''; hud.classList.remove('ui-hidden'); chips.classList.remove('ui-hidden'); arrows.style.display = ''; alertChips.style.display = ''; };

  function showDayStart(level: LevelDef, save: Save) {
    const len = level.dayLength;
    const sites = level.sites.map((s) => `<div class="site-row"><span>${SITE_ICON[s.type]}</span><span>${esc(s.name)}</span><span class="t">${clock(s.openAt, len)}–${clock(s.closeAt, len)}</span></div>`).join('');
    showCard(`<div class="logo"><img src="/play/assets/logo-white.svg" alt="בראשית"></div>` +
      `<h2>יום ${level.id}: ${esc(level.title)}</h2>` +
      `<div class="ui-sub" style="color:#4a5a6a;display:flex;justify-content:center;gap:6px;align-items:center">בקופה: <b>${fmt(save.coins)}</b>${COIN}</div>` +
      `<h4>האתרים היום</h4><div class="sites">${sites}</div>` +
      `<h4>המטרה</h4><ul class="rules"><li>${STAR.replace('<svg', '<svg width="26" height="26"')} כוכב: מסיימים את היום ברווח</li>` +
      `<li>${STAR.replace('<svg', '<svg width="26" height="26"')}${STAR.replace('<svg', '<svg width="26" height="26"')} שני כוכבים: בלי אף עומס יתר</li>` +
      `<li>${STAR.replace('<svg', '<svg width="26" height="26"')}${STAR.replace('<svg', '<svg width="26" height="26"')}${STAR.replace('<svg', '<svg width="26" height="26"')} שלושה: גם ${fmt(level.coinTarget)} ${COIN}</li></ul>` +
      `<button class="btn go" data-go>יוצאים לעבודה</button>`);
    cardWrap.querySelector('[data-go]')!.addEventListener('click', () => { hideCard(); speed = 1; paintSpeed(); h.setSpeed(1); h.startDay(); });
  }

  function showDayEnd(r: DayResult, save: Save, next: LevelDef | undefined) {
    shopSave = JSON.parse(JSON.stringify(save));
    // a level's unlock describes what the following level brings, so show the one just won
    const u = r.stars >= 1 ? LEVELS.find((l) => l.id === r.levelId)?.unlock : undefined;
    const stars = [0, 1, 2].map((i) => STAR.replace('<svg', `<svg class="${i < r.stars ? 'on' : ''}" style="--d:${0.3 + i * 0.35}s"`)).join('');
    const msg = r.stars === 3 ? 'מושלם! אלופי השירות!' : r.stars === 2 ? 'יופי של יום!' : r.stars === 1 ? 'סיימנו! אפשר יותר' : 'יום קשה, ננסה שוב';
    showCard(`<h2>${msg}</h2><div class="big-stars">${stars}</div>` +
      `<div class="sum"><div class="pos">הרווחנו<b>+${fmt(r.earned)}</b></div><div class="neg">קנסות<b>−${fmt(r.fines)}</b></div><div>בקופה<b>${fmt(save.coins)}</b></div></div>` +
      (r.stars < 3 ? `<div class="ui-sub" style="color:#4a5a6a">כוכב שלישי: ${fmt(r.coinTarget)} מטבעות בלי עומס יתר</div>` : '') +
      (u ? `<div class="teaser"><div style="font-size:34px">${ICON[u.kind] ?? '🎁'}</div><div><b>בשלב הבא נפתח: ${esc(u.name)}</b><span>${esc(u.desc)}</span></div></div>` : '') +
      `<h4>שדרוגים</h4><div class="shop" data-shop></div><button class="btn go" data-next>ליום הבא</button>`);
    paintShop();
    cardWrap.querySelector('[data-shop]')!.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-up]') as HTMLButtonElement | null;
      if (!b || b.disabled || !shopSave) return;
      const u = upgrades.find((x) => x.id === b.dataset.up)!;
      const cost = u.costs[shopSave.upgrades[u.id]];
      const res = h.buyUpgrade(u.id);
      if (!res.ok) return say(res.reason ?? 'אין מספיק מטבעות');
      shopSave.coins -= cost; shopSave.upgrades[u.id]++; // local mirror of what the handler persisted
      say('שודרג!'); paintShop();
      const sum = cardWrap.querySelectorAll('.sum b')[2]; if (sum) sum.textContent = fmt(shopSave.coins);
    });
    cardWrap.querySelector('[data-next]')!.addEventListener('click', () => { if (next) showDayStart(next, shopSave!); else hideCard(); });
  }

  function paintShop() {
    const box = cardWrap.querySelector('[data-shop]') as HTMLElement | null; if (!box || !shopSave) return;
    box.innerHTML = upgrades.map((u) => {
      const lvl = shopSave!.upgrades[u.id], cost = u.costs[lvl], maxed = cost === undefined;
      const poor = !maxed && shopSave!.coins < cost;
      return `<div class="up"><div class="nm">${esc(u.name)} · רמה ${lvl + 1}<small>${esc(u.desc)}</small></div>` +
        `<button class="btn" data-up="${u.id}"${maxed || poor ? ' disabled' : ''}>${maxed ? 'מקסימום' : `<small>שדרג</small>${fmt(cost)} ${COIN}`}</button></div>`;
    }).join('');
  }

  return { mount, update, select, showDayStart, showDayEnd, setView: (fn) => { view = fn; } };
}
