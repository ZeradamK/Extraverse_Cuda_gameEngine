/**
 * Space-dust velocity streaks (SC-style motion perception): the ship is pinned
 * at the render origin, so raw motion is invisible without nearby references.
 * ~350 dust motes live in a wrapping bubble around the ship; each renders as a
 * short line streaking opposite the velocity — length/opacity scale with speed.
 */
import * as THREE from 'three/webgpu';

const COUNT = 350;
const RADIUS = 220; // m bubble

export class SpaceDust {
  readonly object: THREE.LineSegments;
  private motes: Float32Array; // xyz, ship-relative (world-anchored: shifted by −v·dt)
  private mat: THREE.LineBasicMaterial;

  constructor() {
    this.motes = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) this.respawn(i);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 6), 3));
    this.mat = new THREE.LineBasicMaterial({
      color: 0xaabdd0, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.object = new THREE.LineSegments(geo, this.mat);
    this.object.frustumCulled = false;
    this.object.visible = false;
  }

  private respawn(i: number): void {
    this.motes[i * 3] = (Math.random() * 2 - 1) * RADIUS;
    this.motes[i * 3 + 1] = (Math.random() * 2 - 1) * RADIUS;
    this.motes[i * 3 + 2] = (Math.random() * 2 - 1) * RADIUS;
  }

  /**
   * velWorld: ship velocity (world frame). Dust is world-anchored: shift motes
   * by −v·dt (the world streams past the origin-pinned ship), wrap in the bubble.
   */
  update(dt: number, velWorld: THREE.Vector3, warping: boolean): void {
    const speed = velWorld.length();
    // fade in from 30 m/s; hidden during warp (tunnel VFX owns that) and at rest
    const vis = warping ? 0 : THREE.MathUtils.clamp((speed - 30) / 120, 0, 1);
    this.mat.opacity = vis * 0.45;
    this.object.visible = vis > 0.02;
    if (!this.object.visible) return;

    const streak = Math.min(0.02 * speed, 45); // 1 km/s → 20 m streaks, capped
    const inv = 1 / Math.max(speed, 1e-6);
    const dx = velWorld.x * inv, dy = velWorld.y * inv, dz = velWorld.z * inv;
    const pos = this.object.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;

    for (let i = 0; i < COUNT; i++) {
      let x = this.motes[i * 3] - velWorld.x * dt;
      let y = this.motes[i * 3 + 1] - velWorld.y * dt;
      let z = this.motes[i * 3 + 2] - velWorld.z * dt;
      // wrap the bubble (world-anchored dust is infinite by tiling)
      if (x > RADIUS) x -= 2 * RADIUS; else if (x < -RADIUS) x += 2 * RADIUS;
      if (y > RADIUS) y -= 2 * RADIUS; else if (y < -RADIUS) y += 2 * RADIUS;
      if (z > RADIUS) z -= 2 * RADIUS; else if (z < -RADIUS) z += 2 * RADIUS;
      this.motes[i * 3] = x;
      this.motes[i * 3 + 1] = y;
      this.motes[i * 3 + 2] = z;
      arr[i * 6] = x; arr[i * 6 + 1] = y; arr[i * 6 + 2] = z;
      arr[i * 6 + 3] = x + dx * streak;
      arr[i * 6 + 4] = y + dy * streak;
      arr[i * 6 + 5] = z + dz * streak;
    }
    pos.needsUpdate = true;
  }
}
