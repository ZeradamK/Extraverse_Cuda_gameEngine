/**
 * HUD v1 (§13): transparent 2D canvas over the render canvas.
 * Crosshair, virtual-joystick reticle, prograde marker, speed, mode flags,
 * boost-heat bar, G-meter.
 */
import * as THREE from 'three/webgpu';

const CYAN = 'rgba(140, 220, 255, 0.9)';
const CYAN_DIM = 'rgba(140, 220, 255, 0.35)';
const AMBER = 'rgba(255, 198, 113, 0.95)';

export class Hud {
  private cv: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tmpV = new THREE.Vector3();

  constructor(parent: HTMLElement) {
    this.cv = document.createElement('canvas');
    Object.assign(this.cv.style, {
      position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '4',
    } as CSSStyleDeclaration);
    parent.appendChild(this.cv);
    this.ctx = this.cv.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private resize(): void {
    this.cv.width = window.innerWidth * devicePixelRatio;
    this.cv.height = window.innerHeight * devicePixelRatio;
    this.ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  draw(o: {
    speed: number; gForce: number; boostHeat: number; boosting: boolean;
    flightAssist: boolean; decoupled: boolean; reticleX: number; reticleY: number;
    reticleRadius: number; vel: THREE.Vector3; camera: THREE.PerspectiveCamera;
    cockpit: boolean; locked: boolean;
  }): void {
    const { ctx } = this;
    const w = window.innerWidth, h = window.innerHeight;
    const cx = w / 2, cy = h / 2;
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 1.25;
    ctx.font = '13px ui-monospace, monospace';

    // crosshair + reticle circle
    ctx.strokeStyle = CYAN_DIM;
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.stroke();
    // virtual joystick dot
    const rx = cx + o.reticleX * 0.55; // visual scale of the 250px logical circle
    const ry = cy + o.reticleY * 0.55;
    ctx.strokeStyle = CYAN;
    ctx.beginPath();
    ctx.moveTo(rx - 9, ry); ctx.lineTo(rx - 3, ry);
    ctx.moveTo(rx + 3, ry); ctx.lineTo(rx + 9, ry);
    ctx.moveTo(rx, ry - 9); ctx.lineTo(rx, ry - 3);
    ctx.moveTo(rx, ry + 3); ctx.lineTo(rx, ry + 9);
    ctx.stroke();

    // prograde marker (⊕) — velocity direction projected to screen
    if (o.speed > 2) {
      this.tmpV.copy(o.vel).normalize().multiplyScalar(1000).add(o.camera.position);
      this.tmpV.project(o.camera);
      if (this.tmpV.z < 1) {
        const px = (this.tmpV.x * 0.5 + 0.5) * w;
        const py = (-this.tmpV.y * 0.5 + 0.5) * h;
        if (px > 0 && px < w && py > 0 && py < h) {
          ctx.strokeStyle = AMBER;
          ctx.beginPath();
          ctx.arc(px, py, 7, 0, Math.PI * 2);
          ctx.moveTo(px - 12, py); ctx.lineTo(px - 7, py);
          ctx.moveTo(px + 7, py); ctx.lineTo(px + 12, py);
          ctx.moveTo(px, py - 12); ctx.lineTo(px, py - 7);
          ctx.stroke();
        }
      }
    }

    // left block: speed + G
    ctx.fillStyle = CYAN;
    ctx.textAlign = 'right';
    ctx.fillText(`${o.speed.toFixed(0)} m/s`, cx - 90, cy + 4);
    ctx.fillStyle = o.gForce > 6 ? AMBER : CYAN_DIM;
    ctx.fillText(`${o.gForce.toFixed(1)} G`, cx - 90, cy + 22);

    // right block: mode flags + boost heat
    ctx.textAlign = 'left';
    ctx.fillStyle = o.flightAssist ? CYAN_DIM : AMBER;
    ctx.fillText(o.flightAssist ? 'FA ON' : 'FA OFF', cx + 90, cy - 14);
    ctx.fillStyle = o.decoupled ? AMBER : CYAN_DIM;
    ctx.fillText(o.decoupled ? 'DECOUPLED' : 'COUPLED', cx + 90, cy + 4);
    ctx.fillStyle = CYAN_DIM;
    ctx.fillText(o.cockpit ? 'COCKPIT' : 'CHASE', cx + 90, cy + 22);
    // heat bar
    ctx.strokeStyle = CYAN_DIM;
    ctx.strokeRect(cx + 90, cy + 32, 80, 6);
    ctx.fillStyle = o.boostHeat > 0.85 ? AMBER : CYAN;
    ctx.fillRect(cx + 90, cy + 32, 80 * o.boostHeat, 6);

    if (!o.locked) {
      ctx.textAlign = 'center';
      ctx.fillStyle = AMBER;
      ctx.fillText('CLICK TO TAKE CONTROL', cx, h - 60);
    }
  }
}
