/**
 * M1 placeholder starfield: ~6k additive points on a far sphere, parented to the
 * camera position (rotation-only parallax — stars are "at infinity").
 * Replaced by the HYG catalog + galaxy skybox in M2/M8.
 */
import * as THREE from 'three/webgpu';
import { mulberry32 } from '../../engine/math/rng';

export function createStarfield(count = 6000, radius = 2e4, seed = 12345, warmth = 0): THREE.Points {
  const rand = mulberry32(seed);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const tint = new THREE.Color();
  for (let i = 0; i < count; i++) {
    // uniform on sphere
    const u = rand() * 2 - 1;
    const phi = rand() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    pos[i * 3] = s * Math.cos(phi) * radius;
    pos[i * 3 + 1] = u * radius;
    pos[i * 3 + 2] = s * Math.sin(phi) * radius;
    // blackbody-ish tints, mostly dim
    const t = rand();
    tint.setHSL(t < 0.7 - warmth * 0.5 ? 0.62 : t < 0.9 ? 0.08 : 0.0, 0.4 * rand(), 0.55 + 0.45 * rand() ** 3);
    const b = 0.25 + 0.75 * rand() ** 2.5;
    col[i * 3] = tint.r * b;
    col[i * 3 + 1] = tint.g * b;
    col[i * 3 + 2] = tint.b * b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 1.6,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return points;
}
