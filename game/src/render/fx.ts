// Short-lived effects: splash, coin pop, red flash, dust. All pooled-free (tiny counts), destroyed on end.
import { Container, Graphics, Text } from 'pixi.js';
import { art, INK } from './assets.ts';

interface Fx { c: Container; t: number; dur: number; run: (c: Container, k: number) => void }

export class FxLayer {
  readonly layer = new Container();
  private list: Fx[] = [];
  private add(c: Container, dur: number, run: Fx['run']) { this.layer.addChild(c); this.list.push({ c, t: 0, dur, run }); }

  splash(x: number, y: number) {
    const c = new Container(); c.position.set(x, y - 24);
    c.addChild(art('fx-splash'));
    this.add(c, 0.7, (c, k) => { c.scale.set(0.5 + k * 1.1); c.y = y - 24 - k * 18; c.alpha = 1 - k * k; });
  }
  coin(x: number, y: number, amount: number) {
    const c = new Container(); c.position.set(x, y);
    const coin = art('icon-coin'); coin.x = -22; c.addChild(coin);
    const t = new Text({ text: '+' + amount, style: { fontFamily: 'system-ui, sans-serif', fontWeight: '900', fontSize: 30, fill: 0xffffff, stroke: { color: INK, width: 6, join: 'round' } } });
    t.anchor.set(0, 0.5); t.x = -4; c.addChild(t);
    this.add(c, 1.3, (c, k) => { c.y = y - 10 - k * 70; c.scale.set(k < 0.15 ? 0.6 + k * 2.6 : 1); c.alpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3; });
  }
  /** shake-free red flash: expanding rounded ring over a site pad */
  flash(x: number, y: number, w: number, h: number) {
    for (let i = 0; i < 2; i++) {
      const g = new Graphics(); g.position.set(x, y);
      g.roundRect(-w / 2, -h / 2, w, h, 24).fill({ color: 0xe5484d, alpha: 0.28 }).stroke({ width: 8, color: 0xe5484d });
      this.layer.addChild(g);
      this.list.push({ c: g, t: -i * 0.35, dur: 0.7, run: (c, k) => { c.scale.set(1 + k * 0.14); c.alpha = 1 - k; } });
    }
  }
  /** dust behind a truck: (x, y) = projected ground point, angle = projected heading (rad); n puffs, k = size */
  /** red flash over a projected polygon (flat points, absolute coords) */
  flashPoly(pts: number[]) {
    const n = pts.length / 2; let cx = 0, cy = 0;
    for (let i = 0; i < n; i++) { cx += pts[2 * i] / n; cy += pts[2 * i + 1] / n; }
    const rel = pts.map((v, i) => v - (i % 2 ? cy : cx));
    for (let i = 0; i < 2; i++) {
      const g = new Graphics(); g.position.set(cx, cy);
      g.poly(rel).fill({ color: 0xe5484d, alpha: 0.28 }).stroke({ width: 8, color: 0xe5484d, join: 'round' });
      this.layer.addChild(g);
      this.list.push({ c: g, t: -i * 0.35, dur: 0.7, run: (c, k) => { c.scale.set(1 + k * 0.14); c.alpha = 1 - k; } });
    }
  }
  dust(x: number, y: number, angle: number, n = 4, k = 1, back = 50) {
    for (let i = 0; i < n; i++) {
      const c = new Container();
      c.addChild(art('fx-dust'));
      const bx = x - Math.cos(angle) * (back + i * 10) + (Math.random() - 0.5) * 8, by = y + 2 - Math.sin(angle) * (back + i * 10);
      c.position.set(bx, by);
      this.list.push({ c, t: -i * 0.08, dur: 0.6 + 0.2 * k, run: (c, q) => { c.scale.set((0.4 + q * 0.9) * k); c.y = by - q * 14; c.alpha = 0.7 * (1 - q); } });
      this.layer.addChild(c);
    }
  }
  tick(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const f = this.list[i];
      f.t += dt;
      if (f.t < 0) { f.c.alpha = 0; continue; }
      const k = f.t / f.dur;
      if (k >= 1) { f.c.destroy({ children: true }); this.list.splice(i, 1); continue; }
      f.run(f.c, k);
    }
  }
}
