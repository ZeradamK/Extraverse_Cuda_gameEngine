/**
 * Galaxy map (M8, key M): top-down projection of the real HYG neighborhood.
 * [ / ] cycles jump candidates (nearest 40 within 60 ly + Sagittarius A*),
 * J engages the hyperjump. Canvas overlay in the SystemMap style.
 */
import type { Star } from '../game/systems/galaxy';
import { SGR_A_ID } from '../game/systems/galaxy';

export class GalaxyMap {
  visible = false;
  selected: Star | null = null;
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private candidates: Star[] = [];
  private idx = 0;

  constructor(parent: HTMLElement, private stars: Star[], private currentLy: () => { x: number; y: number; z: number }) {
    this.cv = document.createElement('canvas');
    Object.assign(this.cv.style, {
      position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '7', display: 'none',
    } as CSSStyleDeclaration);
    parent.appendChild(this.cv);
    this.ctx = this.cv.getContext('2d')!;
    this.refreshCandidates();
  }

  private refreshCandidates(): void {
    const c = this.currentLy();
    this.candidates = this.stars
      .filter(s => s.id !== SGR_A_ID)
      .map(s => ({ s, d: Math.hypot(s.x - c.x, s.y - c.y, s.z - c.z) * 3.2616 }))
      .filter(e => e.d > 0.1 && e.d < 60)
      .sort((a, b) => a.d - b.d)
      .slice(0, 40)
      .map(e => e.s);
    const sgr = this.stars.find(s => s.id === SGR_A_ID);
    if (sgr) this.candidates.push(sgr); // M10: the pilgrimage is always on the list
    this.idx = 0;
    this.selected = this.candidates[0] ?? null;
  }

  toggle(): void {
    this.visible = !this.visible;
    this.cv.style.display = this.visible ? 'block' : 'none';
    if (this.visible) this.refreshCandidates();
  }

  cycle(dir: 1 | -1): void {
    if (!this.candidates.length) return;
    this.idx = (this.idx + dir + this.candidates.length) % this.candidates.length;
    this.selected = this.candidates[this.idx];
  }

  draw(): void {
    if (!this.visible) return;
    const w = window.innerWidth, h = window.innerHeight;
    if (this.cv.width !== w * devicePixelRatio) {
      this.cv.width = w * devicePixelRatio;
      this.cv.height = h * devicePixelRatio;
      this.ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    }
    const { ctx } = this;
    const cx = w / 2, cy = h / 2;
    const cur = this.currentLy();
    const scale = Math.min(w, h) / 2 / 20; // 20 pc view radius
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(2, 6, 14, 0.88)';
    ctx.fillRect(0, 0, w, h);
    ctx.font = '12px ui-monospace, monospace';

    for (const s of this.stars) {
      if (s.id === SGR_A_ID) continue;
      const dx = (s.x - cur.x) * scale;
      const dy = (s.y - cur.y) * scale;
      if (Math.abs(dx) > w / 2 || Math.abs(dy) > h / 2) continue;
      const r = Math.max(0.8, 3.2 - s.mag * 0.4);
      ctx.fillStyle = `#${s.color.toString(16).padStart(6, '0')}`;
      ctx.beginPath();
      ctx.arc(cx + dx, cy - dy, r, 0, Math.PI * 2);
      ctx.fill();
      if (s.name && !s.name.startsWith('HYG-') && s.mag < 2.2) {
        ctx.fillStyle = 'rgba(140,220,255,0.5)';
        ctx.fillText(s.name, cx + dx + 6, cy - dy + 4);
      }
    }
    // you
    ctx.strokeStyle = '#ffc671';
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ffc671';
    ctx.fillText('YOU', cx + 12, cy - 8);

    // selected target + route line
    if (this.selected) {
      const s = this.selected;
      const sgr = s.id === SGR_A_ID;
      const dx = (s.x - cur.x) * scale, dy = (s.y - cur.y) * scale;
      const px = sgr ? w - 90 : cx + dx, py = sgr ? 80 : cy - dy;
      ctx.strokeStyle = '#ffc671';
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeRect(px - 10, py - 10, 20, 20);
      const d = Math.hypot(s.x - cur.x, s.y - cur.y, s.z - cur.z) * 3.2616;
      ctx.fillStyle = '#ffc671';
      ctx.fillText(`${s.name} — ${d < 100 ? d.toFixed(1) + ' ly' : (d / 1000).toFixed(1) + ' kly'}`, px + 14, py + 4);
    }

    ctx.fillStyle = 'rgba(140,220,255,0.6)';
    ctx.fillText('GALAXY MAP — [ ] cycle target · [J] hyperjump · [M] close · real HYG stars (CC BY-SA astronexus.com)', 16, h - 16);
  }
}
