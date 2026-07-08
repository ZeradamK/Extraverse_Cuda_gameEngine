/**
 * M8 — the galaxy: real HYG stars (CC BY-SA 4.0, David Nash / astronexus.com),
 * deterministic procgen star systems (seed hierarchy §4.7), and Sgr A* (M10).
 * ProcSystem is structurally compatible with SolSystem (bodies/planets/sun/
 * update/sunVisibility) so main's flight/warp/terrain stack works unchanged.
 */
import { hash, mulberry32 } from '../../engine/math/rng';
import type { BodyState } from './solSystem';
import type { PlanetDef, MoonDef, AtmoDef } from '../../data/solarSystem';
import type { Vec3d } from '../../engine/math/kepler';

/** [name|null, x, y, z (pc, equatorial), mag, ci] */
export type StarRow = [string | null, number, number, number, number, number];

export interface Star {
  id: number;          // index in the catalog (systemSeed source)
  name: string;
  x: number; y: number; z: number; // pc
  distLy: number;
  mag: number;
  ci: number;
  color: number;       // sRGB int
}

/** B−V color index → RGB (blackbody fit, §6.3) */
export function ciToColor(ci: number): number {
  const t = 4600 * (1 / (0.92 * ci + 1.7) + 1 / (0.92 * ci + 0.62)); // K
  // compact Tanner-Helland-style fit
  const tk = Math.min(Math.max(t, 1500), 40000) / 100;
  let r: number, g: number, b: number;
  if (tk <= 66) { r = 255; g = 99.47 * Math.log(tk) - 161.12; }
  else { r = 329.7 * Math.pow(tk - 60, -0.1332); g = 288.12 * Math.pow(tk - 60, -0.0755); }
  b = tk >= 66 ? 255 : tk <= 19 ? 0 : 138.52 * Math.log(tk - 10) - 305.04;
  const c = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
  return (c(r) << 16) | (c(g) << 8) | c(b);
}

export const SGR_A_ID = -42; // special: the galactic center (M10)

export async function loadStars(): Promise<Star[]> {
  const rows = (await (await fetch('/data/stars.json')).json()) as StarRow[];
  const stars = rows.map((r, i) => ({
    id: i,
    name: r[0] ?? `HYG-${i}`,
    x: r[1], y: r[2], z: r[3],
    distLy: Math.hypot(r[1], r[2], r[3]) * 3.2616,
    mag: r[4],
    ci: r[5],
    color: ciToColor(r[5]),
  }));
  // M10: Sagittarius A* — 8,150 pc toward galactic center (equatorial approx)
  stars.push({
    id: SGR_A_ID, name: 'Sagittarius A*',
    x: -1626, y: -7568, z: -2547, // l=0,b=0 at 8.15 kpc → equatorial pc (approx)
    distLy: 26_600, mag: 99, ci: 2.0, color: 0xffd9a0,
  });
  return stars;
}

const SYSTEM_SCALE = 0.1;
const AU = 1.495978707e11;

/** deterministic procgen system around a star (galaxySeed → systemSeed(starId)) */
export function generateSystem(star: Star, galaxySeed: number, epochMs: number): ProcSystem {
  return new ProcSystem(star, hash(galaxySeed, star.id === SGR_A_ID ? 999983 : star.id), epochMs);
}

export type TerrainKindHint = 'luna' | 'mars';

export interface ProcBodyExtras {
  terrainKind?: TerrainKindHint;
  terrainSeed?: number;
  tint?: number;
}

export class ProcSystem {
  readonly bodies: (BodyState & ProcBodyExtras)[] = [];
  readonly planets: (BodyState & ProcBodyExtras)[] = [];
  readonly sun: BodyState;
  readonly isBlackHole: boolean;
  readonly starColor: number;
  epochMs: number;

  constructor(readonly star: Star, readonly seed: number, epochMs: number) {
    this.epochMs = epochMs;
    this.isBlackHole = star.id === SGR_A_ID;
    this.starColor = star.color;
    const rng = mulberry32(seed);

    // star (or black hole): datum radius drives warp caps + light falloff
    const starRadiusKm = this.isBlackHole
      ? 12_700_000  // ~Schwarzschild 0.085 AU real → scaled disc scale
      : 400_000 + rng() * 900_000;
    const sunDef = {
      name: star.name, radiusKm: starRadiusKm,
      gmKm3S2: 1.3e11 * (0.4 + rng() * 1.6),
      texture: '/textures/planets/2k_sun.jpg',
      blackHole: this.isBlackHole, // M10: FarShell renders horizon + accretion disk
    };
    this.sun = {
      def: sunDef as never, name: star.name, kind: 'star', parent: null,
      posM: { x: 0, y: 0, z: 0 }, deltaM: { x: 0, y: 0, z: 0 },
      radiusM: starRadiusKm * 1000 * SYSTEM_SCALE,
      spin: 0, wobble: 0, axialTiltRad: 0,
    };
    this.bodies.push(this.sun);

    // planets: 0 for the black hole (cluster only), else 2–6, deterministic
    const n = this.isBlackHole ? 0 : 2 + Math.floor(rng() * 5);
    for (let i = 0; i < n; i++) {
      const pseed = hash(seed, i + 1);
      const pr = mulberry32(pseed);
      const rocky = pr() < 0.75;
      const radiusKm = rocky ? 1200 + pr() * 5500 : 20_000 + pr() * 50_000;
      const aAU = 0.35 * Math.pow(1.7, i) * (0.85 + pr() * 0.3);
      const marsLike = pr() < 0.5;
      const atmo: AtmoDef | undefined = rocky && pr() < 0.45 ? {
        rho0: 0.01 + pr() * 1.5, H: 6000 + pr() * 12_000,
        betaR: marsLike ? [1.9e-5, 1.3e-5, 6e-6] : [6e-6, 1.35e-5, 3.3e-5],
        betaMSca: 4e-6 + pr() * 5e-5, betaMExt: 1e-5 + pr() * 2e-4,
        HM: 1200 + pr() * 3000, g: 0.7 + pr() * 0.2,
        topM: 90_000,
      } : undefined;
      const def: PlanetDef = {
        name: `${star.name} ${'bcdefgh'[i]}`,
        radiusKm,
        gmKm3S2: rocky ? 20_000 + pr() * 400_000 : 5e6 + pr() * 1e8,
        rotationHours: 8 + pr() * 60,
        axialTiltDeg: pr() * 40,
        texture: '', // procgen worlds render via terrain/proxy tint
        atmo,
        elements: null as never, // circular orbit below — no JPL elements
        moons: [],
      };
      const body: BodyState & ProcBodyExtras = {
        def, name: def.name, kind: 'planet', parent: this.sun,
        posM: { x: 0, y: 0, z: 0 }, deltaM: { x: 0, y: 0, z: 0 },
        radiusM: radiusKm * 1000 * SYSTEM_SCALE,
        spin: 0, wobble: 0,
        axialTiltRad: (def.axialTiltDeg * Math.PI) / 180,
        terrainKind: rocky ? (marsLike ? 'mars' : 'luna') : undefined,
        terrainSeed: pseed,
        tint: rocky
          ? (marsLike ? 0x9b5f3c + ((pseed & 0xff) << 8) : 0x777788 + (pseed & 0x1f1f1f))
          : 0xb8a67a + (pseed & 0x0f2f4f),
      };
      // orbital phase + period (game-scaled: hours, not years — visible motion)
      (body as never as { _aM: number })._aM = aAU * AU * SYSTEM_SCALE;
      (body as never as { _period: number })._period = (8 + pr() * 80) * 3600;
      (body as never as { _phase: number })._phase = pr() * Math.PI * 2;
      this.bodies.push(body);
      this.planets.push(body);
    }
    this.update(0);
    for (const b of this.bodies) { b.deltaM.x = 0; b.deltaM.y = 0; b.deltaM.z = 0; }
  }

  update(dtS: number): void {
    this.epochMs += dtS * 1000;
    const tS = this.epochMs / 1000;
    for (const b of this.planets) {
      const px = b.posM.x, py = b.posM.y, pz = b.posM.z;
      const aM = (b as never as { _aM: number })._aM;
      const period = (b as never as { _period: number })._period;
      const phase = (b as never as { _phase: number })._phase;
      const th = phase + (2 * Math.PI * tS) / period;
      b.posM.x = aM * Math.cos(th);
      b.posM.y = 0;
      b.posM.z = -aM * Math.sin(th);
      b.spin = ((tS / 3600 / Math.abs((b.def as PlanetDef).rotationHours)) % 1) * 2 * Math.PI;
      b.deltaM.x = b.posM.x - px;
      b.deltaM.y = b.posM.y - py;
      b.deltaM.z = b.posM.z - pz;
    }
  }

  sunVisibility(p: Vec3d): number {
    // same sphere-occlusion as Sol (planets only)
    let vis = 1;
    const dSun = Math.hypot(p.x, p.y, p.z) || 1;
    const sunAng = Math.atan2(this.sun.radiusM, dSun);
    for (const b of this.planets) {
      const dx = b.posM.x - p.x, dy = b.posM.y - p.y, dz = b.posM.z - p.z;
      const dB = Math.hypot(dx, dy, dz);
      if (dB > dSun || dB < b.radiusM) continue;
      const bodyAng = Math.atan2(b.radiusM, dB);
      const dot = (-p.x * dx - p.y * dy - p.z * dz) / (dSun * dB);
      const sep = Math.acos(Math.min(1, Math.max(-1, dot)));
      const overlap = (bodyAng + sunAng - sep) / (2 * sunAng);
      if (overlap > 0) vis = Math.min(vis, 1 - Math.min(1, overlap));
    }
    return vis;
  }
}

/** moons typed import kept for structural parity */
export type { MoonDef };
