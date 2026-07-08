/**
 * Warp tunnel VFX: ~500 additive streak lines in a cylinder around the camera,
 * scrolling backward; length/opacity ∝ warp factor. Classic and cheap.
 */
import * as THREE from 'three/webgpu';

const COUNT = 500;
const RADIUS = 60;
const LENGTH = 900;

export class WarpTunnel {
  readonly object: THREE.LineSegments;
  private offsets: Float32Array;
  private mat: THREE.LineBasicMaterial;

  constructor() {
    const pos = new Float32Array(COUNT * 6);
    const col = new Float32Array(COUNT * 6);
    this.offsets = new Float32Array(COUNT * 3);
    const c1 = new THREE.Color(0x8cd8ff);
    const c2 = new THREE.Color(0xffc671);
    for (let i = 0; i < COUNT; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = RADIUS * (0.35 + Math.random() * 0.9);
      const z = (Math.random() - 0.5) * LENGTH;
      this.offsets[i * 3] = Math.cos(a) * r;
      this.offsets[i * 3 + 1] = Math.sin(a) * r;
      this.offsets[i * 3 + 2] = z;
      const c = Math.random() < 0.85 ? c1 : c2;
      const b = 0.4 + Math.random() * 0.6;
      for (const k of [0, 3]) {
        col[i * 6 + k] = c.r * b;
        col[i * 6 + k + 1] = c.g * b;
        col[i * 6 + k + 2] = c.b * b;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.mat = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.object = new THREE.LineSegments(geo, this.mat);
    this.object.frustumCulled = false;
    this.object.visible = false;
    this.object.renderOrder = 10;
  }

  /** factor 0..1; camera-local space (object should be child of/at camera) */
  update(dt: number, factor: number, quat: THREE.Quaternion): void {
    this.object.visible = factor > 0.02;
    this.mat.opacity = Math.min(1, factor * 1.4) * 0.7;
    if (!this.object.visible) return;
    this.object.quaternion.copy(quat); // streaks aligned to flight direction
    const speed = 400 + 2200 * factor;
    const streak = 8 + 220 * factor * factor;
    const posAttr = this.object.geometry.attributes.position as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    for (let i = 0; i < COUNT; i++) {
      let z = this.offsets[i * 3 + 2] + speed * dt;
      if (z > LENGTH / 2) z -= LENGTH;
      this.offsets[i * 3 + 2] = z;
      const x = this.offsets[i * 3], y = this.offsets[i * 3 + 1];
      arr[i * 6] = x; arr[i * 6 + 1] = y; arr[i * 6 + 2] = z;
      arr[i * 6 + 3] = x; arr[i * 6 + 4] = y; arr[i * 6 + 5] = z + streak;
    }
    posAttr.needsUpdate = true;
  }
}
