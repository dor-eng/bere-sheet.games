// Player settings on this device (sound, vibration, rules seen). Storage may be blocked (private mode): then they live for this page only.
const KEY = 'bereshit.prefs.v1';
export interface Prefs { sound: boolean; vibe: boolean; howto: boolean }
const read = (): Prefs => {
  const d: Prefs = { sound: true, vibe: true, howto: false };
  try { const o = JSON.parse(localStorage.getItem(KEY) ?? '{}'); for (const k of Object.keys(d) as (keyof Prefs)[]) if (typeof o?.[k] === 'boolean') d[k] = o[k]; } catch { /* broken or blocked: defaults */ }
  return d;
};
export const prefs: Prefs = read();
export function setPref<K extends keyof Prefs>(k: K, v: Prefs[K]) { prefs[k] = v; try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* blocked */ } }
