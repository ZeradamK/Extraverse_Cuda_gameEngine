/**
 * Throttle-driven exhaust plumes: additive cones behind each nozzle with a TSL
 * fresnel/length falloff + flicker. GPU particle streams arrive with warp (M3).
 */
import * as THREE from 'three/webgpu';
import { color, float, mix, positionGeometry, sin, time, uniform } from 'three/tsl';
import { SHIP } from '../../data/constants';

export class Exhaust {
  readonly group = new THREE.Group();
  private length = 0.2; // smoothed plume length, m
  private intensity = uniform(0.5);

  constructor() {
    // cone: apex at origin pointing +Z (aft), unit length — scaled per frame
    const geo = new THREE.ConeGeometry(0.55, 1, 24, 6, true);
    geo.rotateX(-Math.PI / 2); // axis → +Z
    geo.translate(0, 0, 0.5);  // base at z=0, tip at +1

    const mat = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    // fade along the cone (z 0→1) with flicker; core hot-white → glow orange
    const zAlong = positionGeometry.z;
    const flicker = sin(time.mul(37.0).add(zAlong.mul(9.0))).mul(0.08).add(0.92);
    const falloff = float(1.0).sub(zAlong).pow(2.0).mul(flicker);
    mat.colorNode = mix(color(0xfff3dd), color(SHIP.GLOW_COLOR), zAlong.min(1)).mul(this.intensity);
    mat.opacityNode = falloff.mul(this.intensity.min(1));

    for (const anchor of [SHIP.ANCHORS.nozzleL, SHIP.ANCHORS.nozzleR]) {
      const cone = new THREE.Mesh(geo, mat);
      cone.position.set(anchor[0], anchor[1], anchor[2]);
      this.group.add(cone);
    }
  }

  /** throttle 0..1, boosting flag */
  update(throttle: number, boosting: boolean): void {
    const len = 2 + throttle * 10 + (boosting ? 6 : 0);
    this.length += (len - this.length) * 0.2;
    this.intensity.value = 0.25 + throttle * 0.9 + (boosting ? 0.5 : 0);
    for (const c of this.group.children) c.scale.set(1 + throttle * 0.3, 1 + throttle * 0.3, this.length);
  }
}
