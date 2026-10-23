// Camera: pinch zoom + drag pan + wheel, clamped to the map; animated focus. z = zoom factor relative to fit (cover) (>= 1).
import type { Container } from 'pixi.js';

export class Camera {
  cx: number; cy: number; z = 1;
  vw = 390; vh = 844;
  private anim: { cx: number; cy: number; dy: number; z: number; t: number } | null = null;
  constructor(private world: Container, private mapW: number, private mapH: number) {
    this.cx = mapW / 2; this.cy = mapH / 2;
  }
  padTop = 170; // css px under the DOM HUD: the map can scroll so its top row clears the HUD
  get fit() { return Math.max(this.vw / this.mapW, (this.vh - this.padTop) / this.mapH); } // cover the screen, no empty band
  get scale() { return this.fit * this.z; }
  private get zMax() { return Math.max(1.5, 1.5 / this.fit); } // up to ~1.5 css px per world px
  resize(w: number, h: number) { this.vw = w; this.vh = h; this.apply(); }
  toWorld(px: number, py: number) { return { x: this.cx + (px - this.vw / 2) / this.scale, y: this.cy + (py - this.vh / 2) / this.scale }; }
  private clamp() {
    this.z = Math.min(this.zMax, Math.max(1, this.z));
    const hw = this.vw / this.scale / 2, hh = this.vh / this.scale / 2;
    this.cx = hw * 2 >= this.mapW ? this.mapW / 2 : Math.min(this.mapW - hw, Math.max(hw, this.cx));
    const pt = this.padTop / this.scale, span = this.mapH + pt;
    this.cy = hh * 2 >= span ? (this.mapH - pt) / 2 : Math.min(this.mapH - hh, Math.max(hh - pt, this.cy));
  }
  apply() {
    this.clamp();
    const s = this.scale;
    this.world.scale.set(s);
    this.world.position.set(this.vw / 2 - this.cx * s, this.vh / 2 - this.cy * s);
  }
  panBy(dxPx: number, dyPx: number) { this.anim = null; this.cx -= dxPx / this.scale; this.cy -= dyPx / this.scale; this.apply(); }
  /** zoom by factor keeping screen point (px,py) fixed */
  zoomAt(factor: number, px: number, py: number) {
    this.anim = null;
    const before = this.toWorld(px, py);
    this.z *= factor; this.clamp();
    this.cx = before.x - (px - this.vw / 2) / this.scale;
    this.cy = before.y - (py - this.vh / 2) / this.scale;
    this.apply();
  }
  /** dyPx > 0 puts the point that many screen px below the view centre (clear of an overlay on top) */
  focus(x: number, y: number, dyPx = 0) { this.anim = { cx: x, cy: y, dy: dyPx, z: Math.max(this.z, 1.8), t: 0 }; }
  tick(dt: number) {
    const a = this.anim; if (!a) return;
    a.t += dt;
    const k = 1 - Math.exp(-dt * 9);
    this.cx += (a.cx - this.cx) * k; this.cy += (a.cy - a.dy / this.scale - this.cy) * k; this.z += (a.z - this.z) * k;
    this.apply();
    if (a.t > 0.9) this.anim = null;
  }
}

/** Wire pointer events on the canvas. onTap gets canvas-local css px. */
export function bindGestures(el: HTMLElement, cam: Camera, onTap: (px: number, py: number) => void) {
  el.style.touchAction = 'none';
  const ptrs = new Map<number, { x: number; y: number }>();
  let down: { x: number; y: number; t: number; moved: boolean } | null = null;
  let pinchD = 0;
  const local = (e: PointerEvent) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    const p = local(e); ptrs.set(e.pointerId, p);
    if (ptrs.size === 1) down = { x: p.x, y: p.y, t: performance.now(), moved: false };
    else { if (down) down.moved = true; const [a, b] = [...ptrs.values()]; pinchD = Math.hypot(a.x - b.x, a.y - b.y); }
  });
  el.addEventListener('pointermove', (e) => {
    const prev = ptrs.get(e.pointerId); if (!prev) return;
    const p = local(e);
    if (ptrs.size === 1) {
      if (down && !down.moved && Math.hypot(p.x - down.x, p.y - down.y) > 8) down.moved = true;
      if (down?.moved) cam.panBy(p.x - prev.x, p.y - prev.y);
    } else if (ptrs.size === 2) {
      ptrs.set(e.pointerId, p);
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchD > 0 && d > 0) cam.zoomAt(d / pinchD, (a.x + b.x) / 2, (a.y + b.y) / 2);
      pinchD = d;
    }
    ptrs.set(e.pointerId, p);
  });
  const up = (e: PointerEvent) => {
    if (!ptrs.has(e.pointerId)) return;
    const p = local(e);
    ptrs.delete(e.pointerId);
    if (ptrs.size === 0 && down && !down.moved && e.type === 'pointerup' && performance.now() - down.t < 700) onTap(p.x, p.y);
    if (ptrs.size === 0) down = null;
    pinchD = 0;
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = el.getBoundingClientRect();
    cam.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
}
