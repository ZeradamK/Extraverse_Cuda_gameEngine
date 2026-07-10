/**
 * Sol system bodies (§7) — REAL values (km, hours, days); world scale ×0.1 (§7)
 * is applied by the sim, not here. Textures: Solar System Scope (CC BY 4.0).
 */
import jpl from './jpl-elements.json';
import type { JplElements } from '../engine/math/kepler';

export const SYSTEM_SCALE = 0.1; // 1/10 linear (§7, locked)
export const AU_M = 1.495978707e11;

export interface MoonDef {
  name: string;
  radiusKm: number;
  gmKm3S2: number;
  aKm: number;          // around parent
  periodDays: number;
  phase0: number;       // rad, fixed seed phase
  inclDeg: number;
  color: number;        // no textures for most moons yet — tinted spheres
  texture?: string;
  /** optical libration amplitudes (rad): lon ≈ 2e (orbital), lat ≈ axial tilt to orbit */
  librLonRad?: number;
  librLatRad?: number;
}

/** atmosphere (§8.3/§9.3) — real ρ0/H (meters, kg/m³); β in m⁻¹ at scaled radii */
export interface AtmoDef {
  rho0: number;        // surface density kg/m³
  H: number;           // density scale height, m (kept REAL at 1/10 radii — thick, dramatic)
  betaR: [number, number, number]; // Rayleigh scattering m⁻¹ (RGB)
  betaMSca: number;    // Mie scattering m⁻¹
  betaMExt: number;    // Mie extinction m⁻¹ (≥ sca; dust absorbs)
  HM: number;          // Mie scale height, m
  g: number;           // HG phase asymmetry
  topM: number;        // shell top above datum, m
}

export interface PlanetDef {
  name: string;
  radiusKm: number;
  gmKm3S2: number;
  rotationHours: number; // sidereal, negative = retrograde
  axialTiltDeg: number;
  texture: string;
  emissiveNight?: string; // Earth night lights
  clouds?: string;
  ring?: { innerKm: number; outerKm: number; texture: string };
  atmo?: AtmoDef;
  elements: JplElements;
  moons: MoonDef[];
}

const el = jpl as Record<string, JplElements>;

export const SUN_DEF = {
  name: 'Sol',
  radiusKm: 695_700,
  gmKm3S2: 1.32712440018e11,
  texture: '/textures/planets/2k_sun.jpg',
};

export const PLANETS: PlanetDef[] = [
  { name: 'Mercury', radiusKm: 2439.7, gmKm3S2: 22_032, rotationHours: 1407.6, axialTiltDeg: 0.034,
    texture: '/textures/planets/2k_mercury.jpg', elements: el['Mercury'], moons: [] },
  { name: 'Venus', radiusKm: 6051.8, gmKm3S2: 324_859, rotationHours: -5832.5, axialTiltDeg: 177.36,
    texture: '/textures/planets/2k_venus_atmosphere.jpg', elements: el['Venus'], moons: [],
    atmo: { rho0: 65.0, H: 15_900, betaR: [3.0e-5, 2.2e-5, 1.0e-5], betaMSca: 2.0e-4, betaMExt: 4.0e-4, HM: 5000, g: 0.75, topM: 250_000 } },
  // Earth media: NASA Blue Marble NG (day, unshaded 200412), Black Marble 2016
  // (night), NASA cloud_combined (clouds) — public domain (S0.4 provenance fix)
  { name: 'Earth', radiusKm: 6371.0, gmKm3S2: 398_600.435, rotationHours: 23.9345, axialTiltDeg: 23.44,
    texture: '/textures/planets/earth_day_8k.jpg',
    emissiveNight: '/textures/planets/earth_night_8k.jpg',
    clouds: '/textures/planets/earth_clouds_8k.jpg',
    elements: el['EM Bary'],
    atmo: { rho0: 1.225, H: 8500, betaR: [5.8e-6, 13.5e-6, 33.1e-6], betaMSca: 4.0e-6, betaMExt: 4.44e-6, HM: 1200, g: 0.8, topM: 100_000 },
    moons: [
      { name: 'Luna', radiusKm: 1737.4, gmKm3S2: 4902.8, aKm: 384_400, periodDays: 27.3217, phase0: 1.2, inclDeg: 5.145,
        color: 0xbdbdbd, texture: '/textures/planets/2k_moon.jpg',
        // libration (the 'rotation wobble'): optical lon ±2e rad, lat ±6.68° (real values)
        librLonRad: 0.1098, librLatRad: 0.1166 },
    ] },
  { name: 'Mars', radiusKm: 3389.5, gmKm3S2: 42_828.4, rotationHours: 24.6229, axialTiltDeg: 25.19,
    texture: '/textures/planets/2k_mars.jpg', elements: el['Mars'], moons: [],
    // REVERSED Rayleigh spectrum (OpenSpace/Bruneton data): butterscotch days, BLUE sunsets
    atmo: { rho0: 0.020, H: 11_100, betaR: [1.99e-5, 1.36e-5, 5.8e-6], betaMSca: 5.36e-5, betaMExt: 2.25e-4, HM: 3100, g: 0.85, topM: 90_000 } },
  { name: 'Jupiter', radiusKm: 69_911, gmKm3S2: 1.26686534e8, rotationHours: 9.925, axialTiltDeg: 3.13,
    texture: '/textures/planets/2k_jupiter.jpg', elements: el['Jupiter'],
    moons: [
      { name: 'Io', radiusKm: 1821.6, gmKm3S2: 5959.9, aKm: 421_800, periodDays: 1.7691, phase0: 0.3, inclDeg: 0.04, color: 0xd8c266 },
      { name: 'Europa', radiusKm: 1560.8, gmKm3S2: 3202.7, aKm: 671_100, periodDays: 3.5512, phase0: 2.1, inclDeg: 0.47, color: 0xcbb8a0 },
      { name: 'Ganymede', radiusKm: 2634.1, gmKm3S2: 9887.8, aKm: 1_070_400, periodDays: 7.1546, phase0: 4.4, inclDeg: 0.18, color: 0x9d9484 },
      { name: 'Callisto', radiusKm: 2410.3, gmKm3S2: 7179.3, aKm: 1_882_700, periodDays: 16.689, phase0: 5.6, inclDeg: 0.19, color: 0x6f6a5e },
    ] },
  { name: 'Saturn', radiusKm: 58_232, gmKm3S2: 3.7931187e7, rotationHours: 10.656, axialTiltDeg: 26.73,
    texture: '/textures/planets/2k_saturn.jpg', elements: el['Saturn'],
    ring: { innerKm: 66_900, outerKm: 136_780, texture: '/textures/planets/2k_saturn_ring_alpha.png' },
    moons: [
      { name: 'Titan', radiusKm: 2574.7, gmKm3S2: 8978.1, aKm: 1_221_870, periodDays: 15.945, phase0: 0.9, inclDeg: 0.35, color: 0xc68a3f },
      { name: 'Enceladus', radiusKm: 252.1, gmKm3S2: 7.21, aKm: 237_948, periodDays: 1.3702, phase0: 3.3, inclDeg: 0.01, color: 0xf0f4f7 },
    ] },
  { name: 'Uranus', radiusKm: 25_362, gmKm3S2: 5.793939e6, rotationHours: -17.24, axialTiltDeg: 97.77,
    texture: '/textures/planets/2k_uranus.jpg', elements: el['Uranus'], moons: [] },
  { name: 'Neptune', radiusKm: 24_622, gmKm3S2: 6.836529e6, rotationHours: 16.11, axialTiltDeg: 28.32,
    texture: '/textures/planets/2k_neptune.jpg', elements: el['Neptune'], moons: [] },
];
