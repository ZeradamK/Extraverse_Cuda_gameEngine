import { describe, expect, it } from 'vitest';
import { circularOrbit, jplPosition, julianCenturies, solveKepler, type Vec3d } from './kepler';
import jpl from '../../data/jpl-elements.json';
import type { JplElements } from './kepler';

const AU = 1.495978707e11;
const el = jpl as Record<string, JplElements>;
const v: Vec3d = { x: 0, y: 0, z: 0 };
const rAU = (p: Vec3d) => Math.hypot(p.x, p.y, p.z) / AU;

describe('solveKepler (Newton–Raphson)', () => {
  it('E = 0 when M = 0', () => {
    expect(solveKepler(0, 0.5)).toBeCloseTo(0, 12);
  });
  it('reduces to M for circular orbits', () => {
    expect(solveKepler(1.234, 0)).toBeCloseTo(1.234, 12);
  });
  it('roundtrips M = E − e·sinE across the domain', () => {
    for (const e of [0.01, 0.2056, 0.5, 0.9]) {
      for (let i = -6; i <= 6; i++) {
        const M = i * 0.5;
        const E = solveKepler(M, e);
        const Mrt = E - e * Math.sin(E);
        // normalize both to [-π, π]
        const norm = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));
        expect(norm(Mrt)).toBeCloseTo(norm(M), 9);
      }
    }
  });
});

describe('julianCenturies', () => {
  it('J2000 epoch (2000-01-01 12:00 TT≈UTC) → 0', () => {
    expect(julianCenturies(Date.UTC(2000, 0, 1, 12))).toBeCloseTo(0, 6);
  });
  it('one Julian century later → 1', () => {
    expect(julianCenturies(Date.UTC(2000, 0, 1, 12) + 36525 * 86400e3)).toBeCloseTo(1, 9);
  });
});

describe('jplPosition (real ephemeris sanity)', () => {
  it('Earth ≈ 1 AU at J2000', () => {
    const r = rAU(jplPosition(el['EM Bary'], 0, v));
    expect(r).toBeGreaterThan(0.97);
    expect(r).toBeLessThan(1.03);
  });
  it('Earth near aphelion (~1.0167 AU) in early July 2026', () => {
    const T = julianCenturies(Date.UTC(2026, 6, 6));
    const r = rAU(jplPosition(el['EM Bary'], T, v));
    expect(r).toBeGreaterThan(1.01);
    expect(r).toBeLessThan(1.02);
  });
  it('Mercury stays within its real perihelion/aphelion band', () => {
    for (let d = 0; d < 88; d += 8) {
      const T = julianCenturies(Date.UTC(2026, 0, 1) + d * 86400e3);
      const r = rAU(jplPosition(el['Mercury'], T, v));
      expect(r).toBeGreaterThan(0.306);
      expect(r).toBeLessThan(0.468);
    }
  });
  it('Neptune ≈ 30 AU', () => {
    const r = rAU(jplPosition(el['Neptune'], 0.26, v));
    expect(r).toBeGreaterThan(29.5);
    expect(r).toBeLessThan(30.5);
  });
  it('Earth advances ~0.9856°/day along its orbit', () => {
    const t0 = Date.UTC(2026, 6, 6);
    const a: Vec3d = { x: 0, y: 0, z: 0 };
    const b: Vec3d = { x: 0, y: 0, z: 0 };
    jplPosition(el['EM Bary'], julianCenturies(t0), a);
    jplPosition(el['EM Bary'], julianCenturies(t0 + 86400e3), b);
    const dot = (a.x * b.x + a.y * b.y + a.z * b.z) / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z));
    const deg = (Math.acos(Math.min(1, dot)) * 180) / Math.PI;
    expect(deg).toBeGreaterThan(0.93);
    expect(deg).toBeLessThan(1.04);
  });
  it('orbit stays near the ecliptic plane (|y| small vs |r|)', () => {
    const p = jplPosition(el['EM Bary'], 0.26, v);
    expect(Math.abs(p.y)).toBeLessThan(0.05 * AU);
  });
});

describe('circularOrbit', () => {
  it('returns radius a and closes after one period', () => {
    const out: Vec3d = { x: 0, y: 0, z: 0 };
    circularOrbit(1000, 3600, 0.4, 0, 0, out);
    expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(1000, 6);
    const out2: Vec3d = { x: 0, y: 0, z: 0 };
    circularOrbit(1000, 3600, 0.4, 0, 3600, out2);
    expect(out2.x).toBeCloseTo(out.x, 6);
    expect(out2.z).toBeCloseTo(out.z, 6);
  });

  it('preserves radius under inclination (regression: tilted orbits shrank)', () => {
    const out: Vec3d = { x: 0, y: 0, z: 0 };
    for (let t = 0; t < 3600; t += 300) {
      circularOrbit(1000, 3600, 1.2, 0.4, t, out);
      expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(1000, 6);
    }
  });
});
