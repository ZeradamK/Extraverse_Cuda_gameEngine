/**
 * M1 placeholder starfield: ~6k additive points on a far sphere, parented to the
 * camera position (rotation-only parallax — stars are "at infinity").
 * Replaced by the HYG catalog + galaxy skybox in M2/M8.
 */
import * as THREE from 'three/webgpu';

export function createStarfield(count = 6000, radius = 2e4): THREE.Points {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const tint = new THREE.Color();
  for (let i = 0; i < count; i++) {
    // uniform on sphere
    const u = Math.random() * 2 - 1;
    const phi = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    pos[i * 3] = s * Math.cos(phi) * radius;
    pos[i * 3 + 1] = u * radius;
    pos[i * 3 + 2] = s * Math.sin(phi) * radius;
    // blackbody-ish tints, mostly dim
    const t = Math.random();
    tint.setHSL(t < 0.7 ? 0.62 : t < 0.9 ? 0.08 : 0.0, 0.4 * Math.random(), 0.55 + 0.45 * Math.random() ** 3);
    const b = 0.25 + 0.75 * Math.random() ** 2.5;
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
