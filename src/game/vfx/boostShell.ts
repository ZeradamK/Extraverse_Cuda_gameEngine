/**
 * Afterburner energy shell (W+Space): additive fresnel ellipsoid hugging the
 * hull — engine-glow amber igniting to blue-white as boost01 spools, with
 * aft-racing bands for the "speed animation around the spaceship" read.
 * Same construction pattern as ReentryGlow; driven by ShipFlight.boost01.
 */
import * as THREE from 'three/webgpu';
import { color, float, mix, normalView, positionGeometry, positionView, sin, time, uniform } from 'three/tsl';
import { SHIP } from '../../data/constants';

export class BoostShell {
  readonly mesh: THREE.Mesh;
  private uBoost = uniform(0.0);

  constructor() {
    const mat = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    const viewDir = positionView.normalize().negate();
    const fresnel = float(1.0).sub(normalView.dot(viewDir).abs()).pow(2.0);
    // aft bias (unit sphere z −1..1 → 0.25..1): the shell burns hottest behind the CoM
    const aft = positionGeometry.z.mul(0.375).add(0.625);
    // energy bands racing tailward — the motion cue that sells the boost
    const race = sin(positionGeometry.z.mul(16.0).sub(time.mul(55.0))).mul(0.3).add(0.7);
    const hot = mix(color(SHIP.GLOW_COLOR), color(0xd8f2ff), this.uBoost.min(1.0).pow(2.0));
    mat.colorNode = hot.mul(fresnel).mul(aft).mul(race).mul(this.uBoost.mul(2.4));

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
    this.mesh.scale.set(11.5, 5, 13.5); // slightly outside the reentry sheath
    this.mesh.visible = false;
    this.mesh.renderOrder = 6;
  }

  /** boost01 0..1 (ShipFlight afterburner spool) */
  set(boost01: number): void {
    this.uBoost.value = boost01;
    this.mesh.visible = boost01 > 0.02;
  }
}
