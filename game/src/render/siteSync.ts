// Pure helpers for the renderer's per-site state (no pixi, so node tests can import them).
import type { GameState, SiteState } from '../sim/types.ts';

/** ids held by the renderer that the new GameState no longer has (to be destroyed). Kept ids are refreshed from the new def. */
export const staleSiteIds = (have: Iterable<string>, s: GameState): string[] => {
  const want = new Set(s.sites.map((x) => x.def.id));
  return [...have].filter((id) => !want.has(id));
};

/** same format as the HUD clock: day length -> 06:00..24:00 */
export const clockText = (t: number, len: number) => {
  const m = Math.floor(360 + Math.min(1, Math.max(0, t / (len || 1))) * 1080);
  return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
};

export const cabinsOf = (s: GameState, id: string) => s.cabins.filter((c) => c.siteId === id);
/** average fill 0..1 over the site's cabins (0 when it has none) */
export function avgFill(s: GameState, id: string): number {
  const cs = cabinsOf(s, id); let f = 0, c = 0;
  for (const x of cs) { f += x.fill; c += x.capacity; }
  return c > 0 ? f / c : 0;
}
/** open and fines are running: no cabins, or every cabin full */
export function isOverflowing(s: GameState, st: SiteState): boolean {
  if (!st.open) return false;
  const cs = cabinsOf(s, st.def.id);
  return cs.length === 0 || cs.every((c) => c.capacity > 0 && c.fill >= c.capacity * 0.999);
}
/** fine accumulated on this site so far today (same rounding as the sim) */
export const fineSoFar = (st: SiteState) => Math.floor(st.overflowSec * st.def.overflowFinePerSec + 1e-9);

/** the site that most needs action: open or opening in <=30 s with 0 cabins (open first, then soonest), else fullest open site above 60% */
export function needsActionId(s: GameState): string | null {
  let best: string | null = null, bt = Infinity;
  for (const st of s.sites) {
    if (st.closed) continue;
    const soon = st.open || st.def.openAt - s.time <= 30;
    if (soon && cabinsOf(s, st.def.id).length === 0) {
      const t = st.open ? -1 : st.def.openAt - s.time;
      if (t < bt) { bt = t; best = st.def.id; }
    }
  }
  if (best) return best;
  let bf = 0.6;
  for (const st of s.sites) if (st.open) { const f = avgFill(s, st.def.id); if (f > bf) { bf = f; best = st.def.id; } }
  return best;
}
