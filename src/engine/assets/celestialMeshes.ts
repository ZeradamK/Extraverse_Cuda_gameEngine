/**
 * User-authored celestial meshes: extracts the sphere geometry from
 * photoreal_earth.gltf (nodes 'Earth' + 'Atmosphere') and
 * moon_rotation_wobble.gltf (node 'Sphere'), normalized to unit radius so the
 * FarShell can scale them to real body radii. These replace the generic
 * SphereGeometry proxies — the shipped 3D objects ARE the planets now.
 * (Spline exports carry no materials/animations; we re-material + drive the
 * wobble scientifically as libration — see DECISIONS.)
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export interface CelestialMeshes {
  earth: THREE.BufferGeometry;      // unit radius, real Spline UVs
  earthAtmosphere: THREE.BufferGeometry;
  moon: THREE.BufferGeometry;
}

/** normalize a mesh geometry to unit radius around its center */
function unitize(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.clone();
  g.computeBoundingSphere();
  const bs = g.boundingSphere!;
  g.translate(-bs.center.x, -bs.center.y, -bs.center.z);
  g.scale(1 / bs.radius, 1 / bs.radius, 1 / bs.radius);
  g.computeVertexNormals();
  return g;
}

function findMeshGeometry(root: THREE.Object3D, nodeName: string): THREE.BufferGeometry {
  let found: THREE.BufferGeometry | null = null;
  root.traverse(o => {
    if (found) return;
    const unsan = o.name.replace(/_/g, ' ');
    if (unsan === nodeName || o.name === nodeName) {
      const m = (o as THREE.Mesh).isMesh ? (o as THREE.Mesh) : (o.children.find(c => (c as THREE.Mesh).isMesh) as THREE.Mesh | undefined);
      if (m?.geometry) found = m.geometry;
    }
  });
  if (!found) throw new Error(`celestial mesh node "${nodeName}" not found`);
  return found;
}

export async function loadCelestialMeshes(): Promise<CelestialMeshes> {
  const loader = new GLTFLoader();
  const [earthG, moonG] = await Promise.all([
    loader.loadAsync('/models/photoreal_earth.gltf'),
    loader.loadAsync('/models/moon_rotation_wobble.gltf'),
  ]);
  return {
    earth: unitize(findMeshGeometry(earthG.scene, 'Earth')),
    earthAtmosphere: unitize(findMeshGeometry(earthG.scene, 'Atmosphere')),
    moon: unitize(findMeshGeometry(moonG.scene, 'Sphere')),
  };
}
