/**
 * Procedural planet height fields (§8.2) — pure functions of a unit direction
 * vector, deterministic per seed. Used by BOTH the terrain worker (mesh gen)
 * and the main thread (collision sampling) — must stay dependency-light.
 * All heights returned in SCALED meters (world ×0.1).
 */
import { createNoise3D, type NoiseFunction3D } from 'simplex-noise';
import { hash, mulberry32 } from '../../engine/math/rng';
import { landAtDir, type LandMask } from './landMask';
import { demAtDir, type DemGrid } from './demGrid';

export interface Vec3 { x: number; y: number; z: number }

export type PlanetKind = 'luna' | 'mars' | 'earth';

export interface HeightField {
  /** height above datum (scaled m) for a unit direction from planet center */
  height(dir: Vec3): number;
  readonly maxAmp: number;
}

function fbm(noise: NoiseFunction3D, x: number, y: number, z: number, octaves: number, lac = 2.0, gain = 0.5): number {
  let a = 1, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += a * noise(x * f, y * f, z * f);
    norm += a;
    a *= gain;
    f *= lac;
  }
  return sum / norm; // [-1, 1]
}

function ridged(noise: NoiseFunction3D, x: number, y: number, z: number, octaves: number): number {
  let a = 0.5, f = 1, sum = 0, w = 1;
  for (let i = 0; i < octaves; i++) {
    let r = 1 - Math.abs(noise(x * f, y * f, z * f));
    r = r * r * w;
    w = Math.min(1, r * 2);
    sum += r * a;
    a *= 0.5;
    f *= 2.1;
  }
  return sum; // [0, ~1]
}

/**
 * Crater field (Lague formula, §8.2): jittered craters on a 3D cell grid over
 * the unit sphere. Deterministic from seed; power-law-ish radii.
 */
function craterField(dir: Vec3, seed: number, cellFreq: number, maxRadius: number, depthScale: number): number {
  const cx = Math.floor(dir.x * cellFreq);
  const cy = Math.floor(dir.y * cellFreq);
  const cz = Math.floor(dir.z * cellFreq);
  let h = 0;
  for (let ix = cx - 1; ix <= cx + 1; ix++) {
    for (let iy = cy - 1; iy <= cy + 1; iy++) {
      for (let iz = cz - 1; iz <= cz + 1; iz++) {
        const rng = mulberry32(hash(seed, ix, iy, iz));
        // one crater per cell, jittered position, on the sphere
        const jx = (ix + rng()) / cellFreq;
        const jy = (iy + rng()) / cellFreq;
        const jz = (iz + rng()) / cellFreq;
        const jl = Math.hypot(jx, jy, jz);
        if (jl < 1e-6) continue;
        // power-law radius: N(>D) ∝ D⁻² → r = rmin·u^(−1/2) flavor, clamped
        const u = Math.max(rng(), 0.04);
        const r = Math.min(maxRadius, maxRadius * 0.18 / Math.sqrt(u));
        // angular distance center→sample (unit sphere chord ≈ angle for small)
        const dx = dir.x - jx / jl, dy = dir.y - jy / jl, dz = dir.z - jz / jl;
        const dist = Math.hypot(dx, dy, dz); // chord on unit sphere
        const x = dist / r;
        if (x > 1.6) continue;
        // Lague: cavity = x²−1; rim = steep·(min(x−1−rimW,0))²; smooth blend
        const cavity = (x * x - 1) * 1.0;
        const rimX = Math.min(x - 1 - 0.25, 0);
        const rim = 3.5 * rimX * rimX;
        const floorH = -0.35;
        // smoothMax(cavity, floor) then smoothMin(·, rim)
        const sMax = smoothMax(cavity, floorH, 0.25);
        const shape = smoothMin(sMax, rim, 0.18);
        h += shape * r * depthScale;
      }
    }
  }
  return h;
}

function smoothMin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
function smoothMax(a: number, b: number, k: number): number {
  return -smoothMin(-a, -b, k);
}

export function createHeightField(kind: PlanetKind, seed: number, mask?: LandMask, dem?: DemGrid): HeightField {
  const n1 = createNoise3D(mulberry32(hash(seed, 1)));
  const n2 = createNoise3D(mulberry32(hash(seed, 2)));

  if (kind === 'earth' && dem) {
    // REAL EARTH (S1): ETOPO-baked global DEM in real meters (land + bathymetry)
    // + sub-pixel procedural detail so close-ups aren't bilinear pyramids.
    // Real vertical on the 0.1-radius globe is deliberate: absolute altitudes
    // couple correctly with the real-H atmosphere (Everest sits at true 8.8 km
    // pressure altitude), at the cost of 10× relative slope drama.
    const maxAmp = 9200; // Everest 8848 + detail headroom
    return {
      maxAmp,
      height(dir: Vec3): number {
        const base = demAtDir(dem, dir);
        // detail fades in above the shoreline (land) and stays tiny on the
        // seafloor — beaches keep their real elevation, peaks get texture
        const landF = Math.max(0, Math.min(1, base / 120));
        const detail = ridged(n2, dir.x * 90, dir.y * 90, dir.z * 90, 4) * 55 * landF
          + fbm(n1, dir.x * 300, dir.y * 300, dir.z * 300, 3) * (8 + 22 * landF);
        return base + detail;
      },
    };
  }

  if (kind === 'earth') {
    // fallback (no DEM loaded): land mask from the Blue Marble texture gates
    // procedural relief. Land rises above datum; seafloor dips below.
    const maxAmp = 1400;
    return {
      maxAmp,
      height(dir: Vec3): number {
        const land = mask ? landAtDir(mask, dir) : 0.5; // soft 0..1 at shores
        const hills = (fbm(n1, dir.x * 6, dir.y * 6, dir.z * 6, 6) * 0.5 + 0.5) * 700;
        const mountains = ridged(n2, dir.x * 14, dir.y * 14, dir.z * 14, 5) * 650;
        const landH = 40 + hills + mountains * Math.max(0, land - 0.4) * 1.6;
        const oceanH = -900 + hills * 0.15;
        return oceanH + (landH - oceanH) * land;
      },
    };
  }

  if (kind === 'luna') {
    // Luna (scaled): broad maria/highlands ±260 m, ridged detail, two crater tiers
    const maxAmp = 900;
    return {
      maxAmp,
      height(dir: Vec3): number {
        const base = fbm(n1, dir.x * 2.2, dir.y * 2.2, dir.z * 2.2, 6) * 260;
        const detail = ridged(n2, dir.x * 40, dir.y * 40, dir.z * 40, 4) * 60;
        const bigCraters = craterField(dir, hash(seed, 77), 14, 0.055, 5200);
        const smallCraters = craterField(dir, hash(seed, 78), 90, 0.011, 4200);
        return base + detail + bigCraters + smallCraters;
      },
    };
  }
  // mars: taller relief, canyon-ish ridges, sparse craters
  const maxAmp = 1600;
  return {
    maxAmp,
    height(dir: Vec3): number {
      const base = fbm(n1, dir.x * 1.6, dir.y * 1.6, dir.z * 1.6, 7) * 550;
      const ridge = ridged(n2, dir.x * 7, dir.y * 7, dir.z * 7, 5) * 500;
      const craters = craterField(dir, hash(seed, 77), 20, 0.03, 3000);
      return base + ridge - 250 + craters * 0.6;
    },
  };
}
