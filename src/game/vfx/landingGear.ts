/**
 * Procedural landing gear (§2.2): none is modeled in gridcorp.gltf, so three
 * retractable struts (leg + foot pad) at the belly anchors. 1.2 s deploy with
 * ease-out; compression on touchdown.
 */
import * as THREE from 'three/webgpu';

const ANCHORS: [number, number, number][] = [
  [0, -5.2, -6.5],
  [-8.5, -4.8, 4.5],
  [8.5, -4.8, 4.5],
];
const LEG_LEN = 1.9;
const DEPLOY_S = 1.2;

export class LandingGear {
  readonly group = new THREE.Group();
  /** 0 = stowed, 1 = deployed */
  deploy01 = 0;
  targetDown = false;
  compression = 0; // 0..1 on touchdown

  private legs: THREE.Group[] = [];

  constructor() {
    const legMat = new THREE.MeshStandardMaterial({ color: 0x3a3f45, metalness: 0.9, roughness: 0.4 });
    const padMat = new THREE.MeshStandardMaterial({ color: 0x22262a, metalness: 0.6, roughness: 0.7 });
    const legGeo = new THREE.CylinderGeometry(0.14, 0.18, LEG_LEN, 10);
    legGeo.translate(0, -LEG_LEN / 2, 0); // hinge at top
    const padGeo = new THREE.CylinderGeometry(0.55, 0.62, 0.14, 12);

    for (const a of ANCHORS) {
      const leg = new THREE.Group();
      leg.position.set(a[0], a[1], a[2]);
      const shaft = new THREE.Mesh(legGeo, legMat);
      shaft.castShadow = true;
      const pad = new THREE.Mesh(padGeo, padMat);
      pad.position.y = -LEG_LEN;
      pad.castShadow = true;
      leg.add(shaft, pad);
      this.legs.push(leg);
      this.group.add(leg);
    }
    this.apply();
  }

  update(dt: number, down: boolean, compression: number): void {
    this.targetDown = down;
    const dir = down ? 1 : -1;
    this.deploy01 = THREE.MathUtils.clamp(this.deploy01 + (dir * dt) / DEPLOY_S, 0, 1);
    this.compression += (compression - this.compression) * Math.min(1, 8 * dt);
    this.apply();
  }

  private apply(): void {
    // ease-out with a touch of overshoot bounce near the end
    const t = this.deploy01;
    const eased = t < 1 ? 1 - Math.pow(1 - t, 3) : 1;
    const bounce = t > 0.85 ? Math.sin((t - 0.85) / 0.15 * Math.PI) * 0.06 : 0;
    const ext = Math.max(0.02, eased + bounce - this.compression * 0.12);
    for (const leg of this.legs) {
      leg.scale.y = ext;
      leg.visible = this.deploy01 > 0.03;
    }
  }

  get isDown(): boolean {
    return this.deploy01 > 0.95;
  }
}
