/**
 * Reentry plasma sheath (§10): additive fresnel ellipsoid around the hull,
 * intensity driven by Sutton–Graves heat flux, flicker via time.
 */
import * as THREE from 'three/webgpu';
import { color, float, mix, normalView, positionView, sin, time, uniform } from 'three/tsl';

export class ReentryGlow {
  readonly mesh: THREE.Mesh;
  private uIntensity = uniform(0.0);

  constructor() {
    const mat = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    const viewDir = positionView.normalize().negate();
    const fresnel = float(1.0).sub(normalView.dot(viewDir).abs()).pow(1.6);
    const flicker = sin(time.mul(41.0)).mul(0.12).add(sin(time.mul(97.0)).mul(0.06)).add(0.85);
    const hot = mix(color(0xff5a1e), color(0xfff2d8), this.uIntensity.min(1.0).pow(2.0));
    mat.colorNode = hot.mul(fresnel).mul(flicker).mul(this.uIntensity.mul(2.2));

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
    this.mesh.scale.set(11, 4.5, 12);
    this.mesh.visible = false;
    this.mesh.renderOrder = 6;
  }

  /** intensity 0..1 (mapped from heat flux between PLASMA_START and PLASMA_FULL) */
  set(intensity: number): void {
    this.uIntensity.value = intensity;
    this.mesh.visible = intensity > 0.02;
  }
}
