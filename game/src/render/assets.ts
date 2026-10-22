// Asset loading + art factory. Real sprite when the manifest has the key, else a clean vector placeholder.
import { Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { AssetKey } from '../sim/types.ts';

export const INK = 0x1e2a3a;
export const NAVY = 0x0a4e7f;
const LW = 3.5; // outline width (world px)

interface Entry { file: string; w: number; h: number; ax: number; ay: number }
const tex = new Map<string, { t: Texture; e: Entry }>();

export async function loadAssets(): Promise<void> {
  const base = import.meta.env.BASE_URL + 'assets/';
  let manifest: Record<string, Entry> = {};
  try {
    const r = await fetch(base + 'manifest.json');
    if (r.ok) manifest = await r.json();
  } catch { /* no manifest yet: all placeholders */ }
  await Promise.all(Object.entries(manifest).map(async ([key, e]) => {
    try {
      const t = await Assets.load<Texture>(base + e.file);
      tex.set(key, { t, e });
    } catch { /* missing file: placeholder */ }
  }));
}

export const hasAsset = (k: AssetKey) => tex.has(k);

/** Target world size. Sprites are scaled uniformly to hit w or h (placeholders are drawn at that size already). */
const SIZE: Partial<Record<AssetKey, { w?: number; h?: number }>> = {
  truck: { w: 140 }, cabin: { h: 50 }, depot: { w: 240 },
  'building-1': { w: 130 }, 'building-2': { w: 130 }, 'building-3': { w: 130 },
  'building-4': { w: 130 }, 'building-5': { w: 130 }, 'building-6': { w: 130 },
  'tree-1': { h: 74 }, 'tree-2': { h: 74 }, crane: { h: 150 }, 'wedding-arch': { h: 90 }, 'wedding-table': { w: 44 },
  worker: { h: 28 }, bride: { h: 28 }, groom: { h: 28 }, 'person-1': { h: 28 }, 'person-2': { h: 28 }, 'person-3': { h: 28 },
  'fx-splash': { w: 70 }, 'fx-dust': { w: 50 }, 'icon-coin': { w: 30 },
};

function spriteOf(key: AssetKey, size = SIZE[key], scale = 1): Container | null {
  const a = tex.get(key);
  if (!a) return null;
  const s = new Sprite(a.t);
  s.anchor.set(a.e.ax, a.e.ay);
  const k = size?.w ? size.w / a.t.width : size?.h ? size.h / a.t.height : 1;
  s.scale.set(k * scale);
  const c = new Container();
  c.addChild(s);
  return c;
}

const paint = (g: Graphics, color: number) => g.fill({ color }).stroke({ width: LW, color: INK, join: 'round' });

// ---- placeholders (origin = ground contact bottom-centre, except truck = centre) ----
function truckArt(g: Graphics) {
  // faces RIGHT. tank (back, left) + cab (front, right)
  g.roundRect(-70, -26, 92, 44, 14); paint(g, 0xf4f8fb);
  g.roundRect(-70, -10, 92, 12, 3); g.fill({ color: NAVY });                    // brand stripe
  g.roundRect(-70, -26, 92, 44, 14).stroke({ width: LW, color: INK });
  g.circle(-22, -30, 5); paint(g, 0xc7d3de);                                    // hatch
  g.roundRect(24, -16, 44, 34, 9); paint(g, 0xffc83d);                          // cab
  g.roundRect(46, -12, 18, 14, 4); paint(g, 0x9edcff);                          // window
  g.roundRect(-76, 12, 10, 8, 2); paint(g, 0x8795a6);                           // hose reel/bumper
  for (const x of [-48, -4, 46]) { g.circle(x, 20, 10); paint(g, 0x2b3646); g.circle(x, 20, 3.5).fill({ color: 0xaab6c4 }); }
}
function cabinArt(g: Graphics) {
  g.roundRect(-18, -50, 36, 50, 7); paint(g, 0x2f9be0);
  g.roundRect(-18, -50, 36, 11, 6); paint(g, 0x7fd0ff);                        // roof
  g.roundRect(-12, -35, 24, 31, 4); g.fill({ color: 0x1f7fbf }).stroke({ width: 2.5, color: INK });
  g.circle(8, -20, 2).fill({ color: 0xffffff });
}
function buildingArt(g: Graphics, n: number) {
  const pal = [[0xf6c28b, 0xd9694b], [0xbfe0f2, 0x4f7fb8], [0xf3e19a, 0xb85c5c], [0xd8c7f0, 0x6f5aa8], [0xcfe8c0, 0x5c8a5a], [0xf7b6b0, 0x8a4a4a]][(n - 1) % 6];
  const w = 120, h = 90;
  g.roundRect(-w / 2, -h, w, h, 6); paint(g, pal[0]);
  g.poly([-w / 2 - 6, -h, -w / 2 + 12, -h - 30, w / 2 - 12, -h - 30, w / 2 + 6, -h]); paint(g, pal[1]);
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) { g.roundRect(-44 + c * 32, -76 + r * 34, 20, 22, 3); g.fill({ color: 0xcdeeff }).stroke({ width: 2.5, color: INK }); }
}
function treeArt(g: Graphics, n: number) {
  g.roundRect(-5, -24, 10, 24, 2); paint(g, 0x8a5a3a);
  const col = n === 1 ? 0x48b86a : 0x76c24b;
  g.circle(0, -52, 26); paint(g, col); g.circle(-14, -38, 17); paint(g, col); g.circle(15, -38, 17); paint(g, col);
}
function depotArt(g: Graphics) {
  g.roundRect(-110, -95, 220, 95, 8); paint(g, 0xe8eef4);
  g.poly([-118, -95, -96, -128, 96, -128, 118, -95]); paint(g, NAVY);
  g.roundRect(-70, -62, 80, 62, 5); paint(g, 0x35506b);                          // garage door
  for (let i = 1; i < 4; i++) g.moveTo(-70, -62 + i * 15.5).lineTo(10, -62 + i * 15.5).stroke({ width: 2, color: 0x9bb3c8 });
  g.circle(62, -62, 20); paint(g, 0xffffff);                                    // drop sign
  g.poly([62, -80, 52, -62, 72, -62]); g.fill({ color: NAVY });
  g.circle(62, -58, 8).fill({ color: NAVY });
}
function craneArt(g: Graphics) {
  g.roundRect(-8, -150, 16, 150, 2); paint(g, 0xffc83d);
  g.roundRect(-20, -158, 100, 12, 2); paint(g, 0xffc83d);
  g.moveTo(70, -146).lineTo(70, -100).stroke({ width: 2.5, color: INK });
  g.roundRect(60, -102, 20, 12, 2); paint(g, 0x8795a6);
}
function archArt(g: Graphics) {
  g.roundRect(-34, -80, 8, 80, 2); paint(g, 0xffffff); g.roundRect(26, -80, 8, 80, 2); paint(g, 0xffffff);
  g.arc(0, -78, 34, Math.PI, 0).stroke({ width: 9, color: INK }); g.arc(0, -78, 34, Math.PI, 0).stroke({ width: 5, color: 0xf48fb1 });
  for (const x of [-30, 0, 30]) g.circle(x, x === 0 ? -112 : -80, 6).fill({ color: 0xff6f91 }).stroke({ width: 2, color: INK });
}
function tableArt(g: Graphics) {
  g.ellipse(0, -8, 22, 12); paint(g, 0xffffff); g.roundRect(-3, -8, 6, 8, 1).fill({ color: INK });
}
function coinArt(g: Graphics) {
  g.circle(0, 0, 14); paint(g, 0xffc83d); g.circle(0, 0, 8).stroke({ width: 2.5, color: 0xd98e00 });
}
function splashArt(g: Graphics) {
  g.circle(0, 0, 18).fill({ color: 0x7fd0ff, alpha: 0.7 }).stroke({ width: 3, color: 0x2f9be0 });
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; g.circle(Math.cos(a) * 24, Math.sin(a) * 24, 5).fill({ color: 0x7fd0ff }).stroke({ width: 2, color: 0x2f9be0 }); }
}
function dustArt(g: Graphics) { g.circle(0, 0, 14).fill({ color: 0xe3d8c4, alpha: 0.9 }); }

/** Build art for a key. */
export function art(key: AssetKey, scale = 1): Container {
  const s = spriteOf(key, undefined, scale);
  if (s) return s;
  const g = new Graphics();
  if (key === 'truck') truckArt(g);
  else if (key === 'cabin' || key === 'cabin-door-open') cabinArt(g);
  else if (key.startsWith('building-')) buildingArt(g, +key.slice(9));
  else if (key.startsWith('tree-')) treeArt(g, +key.slice(5));
  else if (key === 'depot') depotArt(g);
  else if (key === 'crane') craneArt(g);
  else if (key === 'wedding-arch') archArt(g);
  else if (key === 'wedding-table') tableArt(g);
  else if (key === 'icon-coin') coinArt(g);
  else if (key === 'fx-splash') splashArt(g);
  else if (key === 'fx-dust') dustArt(g);
  else { g.circle(0, -10, 10); paint(g, 0xff00ff); }
  g.scale.set(scale);
  return g;
}

/** Person: real sprite or tiny vector person. kind picks palette. */
export function personArt(kind: 'worker' | 'guest', i: number): Container {
  const key = (kind === 'worker' ? 'worker' : (['person-1', 'person-2', 'person-3'] as const)[i % 3]) as AssetKey;
  const s = spriteOf(key);
  if (s) return s;
  const g = new Graphics();
  const shirt = kind === 'worker' ? 0xff8a3d : [0xf48fb1, 0x7fd0ff, 0xb39ddb, 0xffd166, 0x9be7a8][i % 5];
  g.ellipse(0, -1, 8, 3).fill({ color: 0x000000, alpha: 0.18 });
  g.roundRect(-6, -18, 12, 16, 5); paint(g, shirt);
  g.circle(0, -23, 6); paint(g, 0xf2c9a0);
  if (kind === 'worker') g.arc(0, -25, 7, Math.PI, 0).fill({ color: 0xffd23d }).stroke({ width: 2, color: INK });
  else g.arc(0, -25, 6.5, Math.PI, 0).fill({ color: [0x4a3426, 0x2b2b2b, 0xb5651d][i % 3] });
  return g;
}

// ---- photoreal iso sprites (assets/real/*.png). Missing file -> null, caller falls back. ----
export type RealKey = 'bg' | 'truck-dl' | 'truck-dr' | 'truck-ul' | 'truck-ur' | 'cabin' | 'worker' | 'guest'
  | 'prop-wedding' | 'prop-depot' | 'bg-beach' | 'prop-beach' | 'bg-capital' | 'prop-capital' | 'bg-shows' | 'bg-industry' | 'bg-valley';
const REAL: RealKey[] = ['bg', 'truck-dl', 'truck-dr', 'truck-ul', 'truck-ur', 'cabin', 'worker', 'guest', 'prop-wedding', 'prop-depot', 'bg-beach', 'prop-beach', 'bg-capital', 'prop-capital', 'bg-shows', 'bg-industry', 'bg-valley'];
const real = new Map<RealKey, Texture>();

export async function loadReal(): Promise<void> {
  const base = import.meta.env.BASE_URL + 'assets/real/';
  await Promise.all(REAL.map(async (k) => {
    const url = base + k + (k.startsWith('bg') ? '.jpg' : '.png');
    try {
      real.set(k, await Assets.load<Texture>(url));
    } catch { /* missing: fallback art */ }
  }));
}
export const realTex = (k: RealKey) => real.get(k);

/** Bereshit brand mark (navy), width w, centered. */
export const logo = (w: number) => spriteOf('logo-navy', { w });

/** Sprite scaled so its height (or width) hits the target, anchored at (ax, ay). */
export function realSprite(k: RealKey, ax: number, ay: number, size: { w?: number; h?: number }): Sprite | null {
  const t = real.get(k); if (!t) return null;
  const s = new Sprite(t); s.anchor.set(ax, ay);
  s.scale.set(size.w ? size.w / t.width : size.h ? size.h / t.height : 1);
  return s;
}
