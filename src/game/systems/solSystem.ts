/**
 * Sol system on rails (§9.2): every body's position is analytic in f64,
 * evaluated per frame at the current sim epoch. World scale = ×0.1 (§7).
 */
import { circularOrbit, jplPosition, julianCenturies, type Vec3d } from '../../engine/math/kepler';
import { PLANETS, SUN_DEF, SYSTEM_SCALE, type MoonDef, type PlanetDef } from '../../data/solarSystem';

export interface BodyState {
  def: PlanetDef | MoonDef | typeof SUN_DEF;
  name: string;
  kind: 'star' | 'planet' | 'moon';
  parent: BodyState | null;
  /** world position, METERS at SYSTEM_SCALE, f64 (heliocentric world frame) */
  posM: Vec3d;
  /** position delta of the last update() — for local-frame carry (§9.6) */
  deltaM: Vec3d;
  /** scaled radius, m */
  radiusM: number;
  /** current spin angle, rad */
  spin: number;
  /** latitude libration nod, rad (tidally locked moons — the 'wobble') */
  wobble: number;
  axialTiltRad: number;
}

export class SolSystem {
  readonly bodies: BodyState[] = [];
  readonly sun: BodyState;
  readonly planets: BodyState[] = [];
  /** sim epoch in ms (starts now, advances with sim time) */
  epochMs: number;
  private tmp: Vec3d = { x: 0, y: 0, z: 0 };

  constructor(startEpochMs: number) {
    this.epochMs = startEpochMs;
    this.sun = {
      def: SUN_DEF, name: 'Sol', kind: 'star', parent: null,
      posM: { x: 0, y: 0, z: 0 }, deltaM: { x: 0, y: 0, z: 0 },
      radiusM: SUN_DEF.radiusKm * 1000 * SYSTEM_SCALE,
      spin: 0, wobble: 0, axialTiltRad: 0,
    };
    this.bodies.push(this.sun);
    for (const p of PLANETS) {
      const ps: BodyState = {
        def: p, name: p.name, kind: 'planet', parent: this.sun,
        posM: { x: 0, y: 0, z: 0 }, deltaM: { x: 0, y: 0, z: 0 },
        radiusM: p.radiusKm * 1000 * SYSTEM_SCALE,
        spin: 0, wobble: 0, axialTiltRad: (p.axialTiltDeg * Math.PI) / 180,
      };
      this.bodies.push(ps);
      this.planets.push(ps);
      for (const m of p.moons) {
        this.bodies.push({
          def: m, name: m.name, kind: 'moon', parent: ps,
          posM: { x: 0, y: 0, z: 0 }, deltaM: { x: 0, y: 0, z: 0 },
          radiusM: m.radiusKm * 1000 * SYSTEM_SCALE,
          spin: 0, wobble: 0, axialTiltRad: 0,
        });
      }
    }
    this.update(0);
    for (const b of this.bodies) { b.deltaM.x = 0; b.deltaM.y = 0; b.deltaM.z = 0; } // first update is not motion
  }

  /** advance sim clock and re-evaluate all rails (analytic — any dt is exact) */
  update(dtS: number): void {
    this.epochMs += dtS * 1000;
    const T = julianCenturies(this.epochMs);
    const tS = this.epochMs / 1000;

    for (const b of this.bodies) {
      const px = b.posM.x, py = b.posM.y, pz = b.posM.z;
      if (b.kind === 'planet') {
        const def = b.def as PlanetDef;
        jplPosition(def.elements, T, this.tmp);
        // ×0.1 world scale: radii AND orbital distances (§7)
        b.posM.x = this.tmp.x * SYSTEM_SCALE;
        b.posM.y = this.tmp.y * SYSTEM_SCALE;
        b.posM.z = this.tmp.z * SYSTEM_SCALE;
        b.spin = ((tS / 3600 / def.rotationHours) % 1) * 2 * Math.PI;
      } else if (b.kind === 'moon') {
        const def = b.def as MoonDef;
        // orbital PERIOD kept real; radius scaled — keeps moons inside SOI at 1/10 scale
        circularOrbit(def.aKm * 1000 * SYSTEM_SCALE, def.periodDays * 86400, def.phase0,
          (def.inclDeg * Math.PI) / 180, tS, this.tmp);
        b.posM.x = b.parent!.posM.x + this.tmp.x;
        b.posM.y = b.parent!.posM.y + this.tmp.y;
        b.posM.z = b.parent!.posM.z + this.tmp.z;
        const orbitAngle = ((tS / 86400 / def.periodDays) % 1) * 2 * Math.PI;
        // tidal lock + optical libration: uniform rotation vs non-uniform orbit
        // gives a ±2e longitude wobble; axial tilt to the orbit gives a latitude nod
        b.spin = orbitAngle + (def.librLonRad ?? 0) * Math.sin(orbitAngle);
        b.wobble = (def.librLatRad ?? 0) * Math.sin(orbitAngle + Math.PI / 3);
      }
      b.deltaM.x = b.posM.x - px;
      b.deltaM.y = b.posM.y - py;
      b.deltaM.z = b.posM.z - pz;
    }
  }

  /** eclipse factor 0..1 for a point: 1 = full sun, 0 = umbra (sphere occlusion, §5.2) */
  sunVisibility(p: Vec3d): number {
    let vis = 1;
    const dxs = this.sun.posM.x - p.x, dys = this.sun.posM.y - p.y, dzs = this.sun.posM.z - p.z;
    const dSun = Math.hypot(dxs, dys, dzs);
    const sunAng = Math.atan2(this.sun.radiusM, dSun);
    for (const b of this.bodies) {
      if (b.kind === 'star') continue;
      const dxb = b.posM.x - p.x, dyb = b.posM.y - p.y, dzb = b.posM.z - p.z;
      const dBody = Math.hypot(dxb, dyb, dzb);
      if (dBody > dSun || dBody < b.radiusM) continue;
      const bodyAng = Math.atan2(b.radiusM, dBody);
      // angle between directions
      const dot = (dxs * dxb + dys * dyb + dzs * dzb) / (dSun * dBody);
      const sep = Math.acos(Math.min(1, Math.max(-1, dot)));
      // smooth partial occlusion
      const overlap = (bodyAng + sunAng - sep) / (2 * sunAng);
      if (overlap > 0) vis = Math.min(vis, 1 - Math.min(1, overlap));
    }
    return vis;
  }
}
