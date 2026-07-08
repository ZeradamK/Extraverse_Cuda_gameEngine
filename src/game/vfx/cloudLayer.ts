/**
 * Near-planet cloud layer (M6, §8.4 tier-1): translucent sphere at R + 6 km
 * with the real cloud map as color+alpha, slow drift, lit by the sun.
 * Raymarched volumetrics remain a later upgrade.
 */
import * as THREE from 'three/webgpu';
import type { BodyState } from '../systems/solSystem';

export class CloudLayer {
  readonly mesh: THREE.Mesh;
  private drift = 0;

  constructor(readonly body: BodyState, textureUrl: string, altitudeM = 6000) {
    const tex = new THREE.TextureLoader().load(textureUrl);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      alphaMap: tex,           // white clouds → opaque, black sky → transparent
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,  // readable from orbit AND from the ground
      roughness: 1,
      metalness: 0,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), mat);
    this.mesh.scale.setScalar(body.radiusM + altitudeM);
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
  }

  /** centerScene: planet center in scene space; visible within ~30 radii */
  update(dt: number, centerScene: THREE.Vector3, camDistM: number): void {
    this.mesh.visible = camDistM < this.body.radiusM * 30;
    if (!this.mesh.visible) return;
    this.drift += dt * 1.2e-5; // slow westerly drift
    this.mesh.position.copy(centerScene);
    this.mesh.rotation.y = this.body.spin * 0.85 + this.drift;
  }
}
