/**
 * Thruster dust (§10): a ring of soft additive sprites at the ground point
 * under the ship, drifting outward; intensity from the autoland/thrust level.
 */
import * as THREE from 'three/webgpu';

const COUNT = 16;

function makePuffTexture(): THREE.Texture {
  const s = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d')!;
  const grad = ctx.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(210,190,165,0.55)');
  grad.addColorStop(0.5, 'rgba(190,170,150,0.22)');
  grad.addColorStop(1, 'rgba(180,160,140,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Dust {
  readonly group = new THREE.Group();
  private sprites: { s: THREE.Sprite; phase: number; speed: number; ang: number }[] = [];
  private level = 0;

  constructor() {
    const tex = makePuffTexture();
    for (let i = 0; i < COUNT; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true, opacity: 0, depthWrite: false,
        blending: THREE.NormalBlending,
      });
      const s = new THREE.Sprite(mat);
      this.sprites.push({
        s,
        phase: Math.random(),
        speed: 4 + Math.random() * 5,
        ang: (i / COUNT) * Math.PI * 2 + Math.random() * 0.4,
      });
      this.group.add(s);
    }
    this.group.visible = false;
  }

  /**
   * groundPos: scene-space point under the ship; up: surface normal;
   * level 0..1 — dust kicks below ~50 m at thrust.
   */
  update(dt: number, groundPos: THREE.Vector3, up: THREE.Vector3, level: number): void {
    this.level += (level - this.level) * Math.min(1, 6 * dt);
    this.group.visible = this.level > 0.03;
    if (!this.group.visible) return;
    this.group.position.copy(groundPos);
    // tangent frame on the surface
    const tx = Math.abs(up.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const t1 = new THREE.Vector3().crossVectors(up, tx).normalize();
    const t2 = new THREE.Vector3().crossVectors(up, t1).normalize();

    for (const p of this.sprites) {
      p.phase += (dt / 2.2) * (0.7 + p.speed * 0.06);
      if (p.phase > 1) p.phase -= 1;
      const r = 4 + p.phase * p.speed * 3.5;
      const puffUp = 0.6 + p.phase * 2.2;
      p.s.position
        .copy(t1).multiplyScalar(Math.cos(p.ang) * r)
        .addScaledVector(t2, Math.sin(p.ang) * r)
        .addScaledVector(up, puffUp);
      const size = 3.5 + p.phase * 9;
      p.s.scale.setScalar(size);
      (p.s.material as THREE.SpriteMaterial).opacity = this.level * (1 - p.phase) * 0.55;
    }
  }
}
