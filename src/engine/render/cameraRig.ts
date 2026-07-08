/**
 * Camera rig (§12.3): cockpit + chase strategies over ONE PerspectiveCamera.
 * Frame-rate-independent smoothing x += (t−x)(1−exp(−λ·dt)); trauma shake.
 */
import * as THREE from 'three/webgpu';
import { SHIP } from '../../data/constants';

export type CamMode = 'cockpit' | 'chase';

const FOV = { cockpit: 60, chase: 55 };
const BOOST_FOV_KICK = 15;
const SHIP_LENGTH = 18;

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CamMode = 'chase';
  /** 0..1 — camera shake energy; events add, decays 1.2/s; shake = trauma² */
  trauma = 0;

  private pos = new THREE.Vector3(0, 8, 45);
  private quat = new THREE.Quaternion();
  private fovCurrent = FOV.chase;
  private boostBlend = 0;
  private t = 0;

  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();
  private tmpE = new THREE.Euler();

  constructor(aspect: number) {
    // far 1e7: whole planets visible from orbit; reversed-Z keeps depth clean
    this.camera = new THREE.PerspectiveCamera(FOV.chase, aspect, 0.1, 1e7);
  }

  toggle(): void {
    this.mode = this.mode === 'chase' ? 'cockpit' : 'chase';
  }

  /**
   * shipPos/shipQuat = interpolated render transform; called per render frame.
   * fovKick: 0 = base, 1 = boost (+15°), 2 = warp (+30° → 90° cockpit-equivalent)
   */
  update(dt: number, shipPos: THREE.Vector3, shipQuat: THREE.Quaternion, fovKick: number): void {
    this.t += dt;
    const k = (lambda: number) => 1 - Math.exp(-lambda * dt);

    if (this.mode === 'cockpit') {
      // rigid attach at pilot anchor
      this.tmpV.set(...SHIP.ANCHORS.cockpitCam).applyQuaternion(shipQuat).add(shipPos);
      this.pos.copy(this.tmpV);
      this.quat.copy(shipQuat);
    } else {
      // chase: spring arm, rest 2.2×length behind, +12° elevation, λpos 12 / λrot 8
      const arm = 2.2 * SHIP_LENGTH;
      const elev = THREE.MathUtils.degToRad(12);
      this.tmpV.set(0, Math.sin(elev) * arm, Math.cos(elev) * arm).applyQuaternion(shipQuat).add(shipPos);
      this.pos.lerp(this.tmpV, k(12));
      this.quat.slerp(shipQuat, k(8));
    }

    // FOV: base per mode + kick (in fast λ≈15, out slower)
    this.boostBlend += (fovKick - this.boostBlend) * k(fovKick > this.boostBlend ? 15 : 6);
    const targetFov = FOV[this.mode] + BOOST_FOV_KICK * this.boostBlend;
    this.fovCurrent += (targetFov - this.fovCurrent) * k(10);

    // trauma shake (§12.3): 3 pseudo-Perlin channels @ ~18 Hz
    this.trauma = Math.max(0, this.trauma - 1.2 * dt);
    const shake = this.trauma * this.trauma;
    const n = (f: number, s: number) =>
      Math.sin(this.t * f * Math.PI * 2 + s) * 0.6 + Math.sin(this.t * f * 1.37 * Math.PI * 2 + s * 2.7) * 0.4;

    this.camera.position.copy(this.pos);
    this.camera.quaternion.copy(this.quat);
    if (shake > 1e-4) {
      this.tmpE.set(n(18, 1) * 0.04 * shake, n(18, 5) * 0.04 * shake, n(18, 9) * 0.06 * shake);
      this.tmpQ.setFromEuler(this.tmpE);
      this.camera.quaternion.multiply(this.tmpQ);
      this.tmpV2.set(n(18, 13), n(18, 17), 0).multiplyScalar(0.06 * shake);
      this.camera.position.add(this.tmpV2.applyQuaternion(this.quat));
    }
    if (Math.abs(this.camera.fov - this.fovCurrent) > 0.01) {
      this.camera.fov = this.fovCurrent;
      this.camera.updateProjectionMatrix();
    }
  }
}
