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
  aKm: number;          // around parent
  periodDays: number;
  phase0: number;       // rad, fixed seed phase
  inclDeg: number;
  color: number;        // no textures for most moons yet — tinted spheres
  texture?: string;
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
    texture: '/textures/planets/2k_venus_atmosphere.jpg', elements: el['Venus'], moons: [] },
  { name: 'Earth', radiusKm: 6371.0, gmKm3S2: 398_600.435, rotationHours: 23.9345, axialTiltDeg: 23.44,
    texture: '/textures/planets/2k_earth_daymap.jpg',
    emissiveNight: '/textures/planets/2k_earth_nightmap.jpg',
    clouds: '/textures/planets/2k_earth_clouds.jpg',
    elements: el['EM Bary'],
    moons: [
      { name: 'Luna', radiusKm: 1737.4, aKm: 384_400, periodDays: 27.3217, phase0: 1.2, inclDeg: 5.145,
        color: 0xbdbdbd, texture: '/textures/planets/2k_moon.jpg' },
    ] },
  { name: 'Mars', radiusKm: 3389.5, gmKm3S2: 42_828.4, rotationHours: 24.6229, axialTiltDeg: 25.19,
    texture: '/textures/planets/2k_mars.jpg', elements: el['Mars'], moons: [] },
  { name: 'Jupiter', radiusKm: 69_911, gmKm3S2: 1.26686534e8, rotationHours: 9.925, axialTiltDeg: 3.13,
    texture: '/textures/planets/2k_jupiter.jpg', elements: el['Jupiter'],
    moons: [
      { name: 'Io', radiusKm: 1821.6, aKm: 421_800, periodDays: 1.7691, phase0: 0.3, inclDeg: 0.04, color: 0xd8c266 },
      { name: 'Europa', radiusKm: 1560.8, aKm: 671_100, periodDays: 3.5512, phase0: 2.1, inclDeg: 0.47, color: 0xcbb8a0 },
      { name: 'Ganymede', radiusKm: 2634.1, aKm: 1_070_400, periodDays: 7.1546, phase0: 4.4, inclDeg: 0.18, color: 0x9d9484 },
      { name: 'Callisto', radiusKm: 2410.3, aKm: 1_882_700, periodDays: 16.689, phase0: 5.6, inclDeg: 0.19, color: 0x6f6a5e },
    ] },
  { name: 'Saturn', radiusKm: 58_232, gmKm3S2: 3.7931187e7, rotationHours: 10.656, axialTiltDeg: 26.73,
    texture: '/textures/planets/2k_saturn.jpg', elements: el['Saturn'],
    ring: { innerKm: 66_900, outerKm: 136_780, texture: '/textures/planets/2k_saturn_ring_alpha.png' },
    moons: [
      { name: 'Titan', radiusKm: 2574.7, aKm: 1_221_870, periodDays: 15.945, phase0: 0.9, inclDeg: 0.35, color: 0xc68a3f },
      { name: 'Enceladus', radiusKm: 252.1, aKm: 237_948, periodDays: 1.3702, phase0: 3.3, inclDeg: 0.01, color: 0xf0f4f7 },
    ] },
  { name: 'Uranus', radiusKm: 25_362, gmKm3S2: 5.793939e6, rotationHours: -17.24, axialTiltDeg: 97.77,
    texture: '/textures/planets/2k_uranus.jpg', elements: el['Uranus'], moons: [] },
  { name: 'Neptune', radiusKm: 24_622, gmKm3S2: 6.836529e6, rotationHours: 16.11, axialTiltDeg: 28.32,
    texture: '/textures/planets/2k_neptune.jpg', elements: el['Neptune'], moons: [] },
];
