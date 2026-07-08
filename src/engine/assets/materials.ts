/**
 * Ship PBR materials (§2.3). Spline exports have no usable UVs on boolean/Smooth&Edit
 * geometry, so every map is sampled with TSL triplanar projection in mesh-local space
 * (stable under the ship's rotation; world space would swim).
 */
import * as THREE from 'three/webgpu';
import { color, float, texture, triplanarTexture, uniform } from 'three/tsl';
import { SHIP, TRIPLANAR_TILE_PER_LOCAL_UNIT } from '../../data/constants';

/** 0..1 throttle shared by reactor/engine emissives and engine lights */
export const throttleUniform = uniform(0.0);

const texLoader = new THREE.TextureLoader();

function loadMap(url: string, srgb: boolean): THREE.Texture {
  const t = texLoader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

const tile = float(TRIPLANAR_TILE_PER_LOCAL_UNIT);
const tri = (t: THREE.Texture) => triplanarTexture(texture(t), null, null, tile);

export interface ShipMaterials {
  hull: THREE.MeshPhysicalNodeMaterial;
  trim: THREE.MeshStandardNodeMaterial;
  rubber: THREE.MeshStandardNodeMaterial;
  reactor: THREE.MeshStandardNodeMaterial;
  engine: THREE.MeshStandardNodeMaterial;
}

export function createShipMaterials(): ShipMaterials {
  // --- hull: painted dark metal (Poly Haven metal_plate_02, CC0) ---
  const hullDiff = loadMap('/textures/hull/metal_plate_02_diff_2k.jpg', true);
  const hullRough = loadMap('/textures/hull/metal_plate_02_rough_2k.jpg', false);
  const hullMetal = loadMap('/textures/hull/metal_plate_02_metal_2k.jpg', false);
  const hullAO = loadMap('/textures/hull/metal_plate_02_ao_2k.jpg', false);

  const hull = new THREE.MeshPhysicalNodeMaterial({});
  hull.colorNode = tri(hullDiff).mul(color(0x87909c)); // tint toward gunmetal (Spline look: dark shiny metal)
  hull.roughnessNode = tri(hullRough).r.mul(0.9);
  hull.metalnessNode = tri(hullMetal).r.max(0.35);
  hull.aoNode = tri(hullAO).r;
  hull.clearcoat = 0.35; // showroom paint feel ≈ the original matcap sheen
  hull.clearcoatRoughness = 0.25;

  // --- trim: bare scratched metal (ambientCG Metal032, CC0) ---
  const trimDiff = loadMap('/textures/trim/trim_diff.jpg', true);
  const trimRough = loadMap('/textures/trim/trim_rough.jpg', false);

  const trim = new THREE.MeshStandardNodeMaterial({});
  trim.colorNode = tri(trimDiff);
  trim.roughnessNode = tri(trimRough).r.mul(0.7);
  trim.metalnessNode = float(1.0);

  // --- rubber: belly cables (ambientCG Rubber004, CC0) ---
  const rubberDiff = loadMap('/textures/rubber/rubber_diff.jpg', true);
  const rubberRough = loadMap('/textures/rubber/rubber_rough.jpg', false);

  const rubber = new THREE.MeshStandardNodeMaterial({});
  rubber.colorNode = tri(rubberDiff).mul(color(0x555a5f));
  rubber.roughnessNode = tri(rubberRough).r.max(0.75);
  rubber.metalnessNode = float(0.0);

  // --- reactor core: the bloom hero. Black body, throttle-driven emissive ---
  const glow = color(SHIP.GLOW_COLOR);
  const reactor = new THREE.MeshStandardNodeMaterial({ color: 0x000000, roughness: 1.0 });
  reactor.emissiveNode = glow.mul(throttleUniform.mul(4.5).add(1.2)); // idle 1.2 → full 5.7

  // --- engine aft frames ("Shape"/"Shape 2" are LARGE surfaces → low area-light intensity) ---
  const engine = new THREE.MeshStandardNodeMaterial({ color: 0x000000, roughness: 0.9 });
  engine.emissiveNode = glow.mul(throttleUniform.mul(2.2).add(0.25));

  return { hull, trim, rubber, reactor, engine };
}
