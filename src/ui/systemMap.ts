/**
 * System map v1 (§13): top-down log-radial orbit view on a 2D canvas overlay.
 * F2 toggles. Log-scaled radii keep Mercury..Neptune all readable.
 */
import type { SolSystem } from '../game/systems/solSystem';
import type { Vec3d } from '../engine/math/kepler';

export class SystemMap {
  visible = false;
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(parent: HTMLElement) {
    this.cv = document.createElement('canvas');
    Object.assign(this.cv.style, {
      position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '6', display: 'none',
    } as CSSStyleDeclaration);
    parent.appendChild(this.cv);
    this.ctx = this.cv.getContext('2d')!;
  }

  toggle(): void {
    this.visible = !this.visible;
    this.cv.style.display = this.visible ? 'block' : 'none';
  }

  draw(sys: SolSystem, shipPosM: Vec3d): void {
    if (!this.visible) return;
    const w = window.innerWidth, h = window.innerHeight;
    if (this.cv.width !== w * devicePixelRatio) {
      this.cv.width = w * devicePixelRatio;
      this.cv.height = h * devicePixelRatio;
      this.ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    }
    const { ctx } = this;
    const cx = w / 2, cy = h / 2;
    const maxR = Math.min(w, h) * 0.44;

    // log-radial mapping: Mercury a≈5.8e9 m (scaled) … Neptune a≈4.5e11
    const rMin = 3e9, rMax = 5.5e11;
    const map = (rm: number) =>
      (Math.log(Math.max(rm, rMin) / rMin) / Math.log(rMax / rMin)) * (maxR - 30) + 30;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(2, 6, 14, 0.82)';
    ctx.fillRect(0, 0, w, h);
    ctx.font = '12px ui-monospace, monospace';

    // sun
    ctx.fillStyle = '#ffc671';
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();

    for (const p of sys.planets) {
      const rWorld = Math.hypot(p.posM.x, p.posM.z);
      const r = map(rWorld);
      ctx.strokeStyle = 'rgba(140,220,255,0.18)';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      const ang = Math.atan2(p.posM.z, p.posM.x);
      const px = cx + Math.cos(ang) * r;
      const py = cy + Math.sin(ang) * r;
      ctx.fillStyle = '#8cdcff';
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(140,220,255,0.75)';
      ctx.fillText(p.name, px + 7, py + 4);
    }

    // ship marker
    const shipR = map(Math.hypot(shipPosM.x, shipPosM.z));
    const shipA = Math.atan2(shipPosM.z, shipPosM.x);
    const sx = cx + Math.cos(shipA) * shipR;
    const sy = cy + Math.sin(shipA) * shipR;
    ctx.strokeStyle = '#ffc671';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx, sy - 7); ctx.lineTo(sx + 5, sy + 5); ctx.lineTo(sx - 5, sy + 5); ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = '#ffc671';
    ctx.fillText('YOU', sx + 8, sy + 4);

    ctx.fillStyle = 'rgba(140,220,255,0.6)';
    ctx.fillText('SYSTEM MAP — SOL  ·  [F2] close  ·  [1-9] jump to body (dev)', 16, h - 16);
  }
}
