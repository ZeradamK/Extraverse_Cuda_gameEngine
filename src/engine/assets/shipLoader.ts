/**
 * Loads gridcorp.gltf, strips Spline scene dressing, recenters + scales to meters,
 * and re-materials every mesh (the export ships ZERO materials — all would be gray).
 * Manifest and material table: EXTRAVERSE_BUILD_PROMPT.md §2.
 */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SHIP } from '../../data/constants';
import { createShipMaterials, throttleUniform, type ShipMaterials } from './materials';

export interface Ship {
  /** wrapper group, recentered: origin ≈ center of mass, nose −Z, meters */
  object: THREE.Group;
  materials: ShipMaterials;
  /** set 0..1; drives reactor/engine emissive + engine lights */
  setThrottle(t: number): void;
  readonly throttle: number;
}

/** GLTFLoader sanitizes node names (spaces → underscores); map back to the manifest names */
const unsanitize = (s: string): string => s.replace(/_/g, ' ');

/** direct children of "Gridcorp dron" that get special materials (names reused deeper in the tree!) */
const DEPTH1_REACTOR = new Set(['Sphere 3', 'Sphere 4']);
const DEPTH1_ENGINE = new Set(['Shape', 'Shape 2']);
const DEPTH1_TRIM = new Set(['Torus', 'Cylinder']);
/** "Group 13" pods read as hull; every other "Group N" + unnamed cluster is metal greeble */
const HULL_GROUPS = new Set(['Group 13']);

export async function loadShip(): Promise<Ship> {
  const gltf = await new GLTFLoader().loadAsync('/models/gridcorp.gltf');
  let found: THREE.Object3D | undefined;
  gltf.scene.traverse(o => {
    if (!found && unsanitize(o.name) === SHIP.ROOT_NODE) found = o;
  });
  if (!found) throw new Error(`"${SHIP.ROOT_NODE}" not found in gridcorp.gltf`);
  const dron = found; // const: keeps TS narrowing stable inside closures below

  const materials = createShipMaterials();

  // strip authored lights/cameras inside the ship subtree (we add our own)
  const doomed: THREE.Object3D[] = [];
  dron.traverse(o => {
    if ((o as THREE.Light).isLight || (o as THREE.Camera).isCamera) doomed.push(o);
  });
  for (const o of doomed) o.removeFromParent();

  // re-material
  dron.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = mesh.receiveShadow = true;

    const g = mesh.geometry;
    if (g.attributes.color) g.deleteAttribute('color'); // Spline vertex-color bakes tint PBR albedo
    if (!g.attributes.normal) g.computeVertexNormals();

    mesh.material = pickMaterial(mesh, dron, materials);
  });

  // wrapper: scale to meters, recenter so CoM ≈ origin
  const object = new THREE.Group();
  object.name = 'ship';
  object.add(dron);
  dron.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(dron);
  const center = box.getCenter(new THREE.Vector3());
  dron.position.sub(center); // recenter in local (pre-scale) units
  object.scale.setScalar(SHIP.SCALE);

  // engine lights — authored glow color #FFC671, throttle-driven
  const glow = new THREE.Color(SHIP.GLOW_COLOR);
  const engineLight = new THREE.PointLight(glow, 0, 30, 2);
  engineLight.position.set(...SHIP.ANCHORS.engineLight).divideScalar(SHIP.SCALE).sub(center);
  const nozzleL = new THREE.PointLight(glow, 0, 15, 2);
  nozzleL.position.set(...SHIP.ANCHORS.nozzleL).divideScalar(SHIP.SCALE).sub(center);
  const nozzleR = new THREE.PointLight(glow, 0, 15, 2);
  nozzleR.position.set(...SHIP.ANCHORS.nozzleR).divideScalar(SHIP.SCALE).sub(center);
  dron.add(engineLight, nozzleL, nozzleR);

  let throttle = 0;
  const ship: Ship = {
    object,
    materials,
    get throttle() {
      return throttle;
    },
    setThrottle(t: number) {
      throttle = THREE.MathUtils.clamp(t, 0, 1);
      throttleUniform.value = throttle;
      engineLight.intensity = 2 + throttle * 12;
      nozzleL.intensity = nozzleR.intensity = 1 + throttle * 6;
    },
  };
  ship.setThrottle(0.2);
  return ship;
}

function pickMaterial(
  mesh: THREE.Mesh,
  root: THREE.Object3D,
  m: ShipMaterials,
): THREE.Material {
  const isDepth1 = mesh.parent === root;
  const name = unsanitize(mesh.name);

  if (isDepth1 && DEPTH1_REACTOR.has(name)) return m.reactor;
  if (isDepth1 && DEPTH1_ENGINE.has(name)) return m.engine;
  if (isDepth1 && DEPTH1_TRIM.has(name)) return m.trim;

  // walk ancestry up to (not including) the dron root
  for (let a: THREE.Object3D | null = mesh; a && a !== root; a = a.parent) {
    const n = unsanitize(a.name);
    if (n === 'Cables') return m.rubber;
    if (
      n === 'Body' || n.startsWith('Wing') || n.startsWith('TopWing') ||
      n.startsWith('TopPlane') || n.startsWith('SideBody') || HULL_GROUPS.has(n)
    ) {
      return m.hull;
    }
    if (n.startsWith('Group')) return m.trim; // greeble clusters
  }
  // unnamed clusters (thruster banks, hardpoint rigs) → trim; bare depth-1 shapes → hull
  return mesh.name === '' ? m.trim : m.hull;
}
