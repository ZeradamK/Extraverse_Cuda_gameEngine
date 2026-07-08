import { describe, expect, it } from 'vitest';
import {
  density, dragAccel, dynamicPressure, gravityAccel, spaceAltitude, suttonGraves,
  PLASMA_START_W_M2,
} from './environment';
import { PLANETS, SYSTEM_SCALE } from '../../data/solarSystem';

const earth = PLANETS[2];
const mars = PLANETS[3];

describe('environment — gravity (real surface g at 1/10 radii)', () => {
  it('Earth surface gravity ≈ 9.81 m/s²', () => {
    const g = gravityAccel(earth.gmKm3S2, earth.radiusKm * 1000 * SYSTEM_SCALE);
    expect(g).toBeGreaterThan(9.7);
    expect(g).toBeLessThan(9.9);
  });
  it('Mars surface gravity ≈ 3.71 m/s²', () => {
    const g = gravityAccel(mars.gmKm3S2, mars.radiusKm * 1000 * SYSTEM_SCALE);
    expect(g).toBeGreaterThan(3.6);
    expect(g).toBeLessThan(3.8);
  });
  it('falls off with inverse square', () => {
    const r = mars.radiusKm * 1000 * SYSTEM_SCALE;
    expect(gravityAccel(mars.gmKm3S2, 2 * r)).toBeCloseTo(gravityAccel(mars.gmKm3S2, r) / 4, 6);
  });
});

describe('environment — atmosphere', () => {
  it('Earth space altitude reproduces the Kármán line (~99.6 km)', () => {
    const h = spaceAltitude(earth.atmo!);
    expect(h / 1000).toBeGreaterThan(98);
    expect(h / 1000).toBeLessThan(101);
  });
  it('density decays exponentially and clamps at the shell top', () => {
    const a = mars.atmo!;
    expect(density(a, 0)).toBeCloseTo(0.02, 6);
    expect(density(a, a.H)).toBeCloseTo(0.02 / Math.E, 6);
    expect(density(a, a.topM)).toBe(0);
    expect(density(a, -100)).toBeCloseTo(0.02, 6); // below datum clamps to surface
  });
  it('Mars Rayleigh spectrum is reversed vs Earth (red > blue)', () => {
    expect(mars.atmo!.betaR[0]).toBeGreaterThan(mars.atmo!.betaR[2]);
    expect(earth.atmo!.betaR[2]).toBeGreaterThan(earth.atmo!.betaR[0]);
  });
  it('Mie extinction ≥ scattering (dust absorbs)', () => {
    for (const p of PLANETS) {
      if (p.atmo) expect(p.atmo.betaMExt).toBeGreaterThanOrEqual(p.atmo.betaMSca);
    }
  });
});

describe('environment — drag & heating', () => {
  it('terminal velocity balance: drag = gravity at v_t', () => {
    // 50 t ship, CdA 60 (airbrake) at Earth sea level
    const m = 50_000, cdA = 60, rho = 1.225;
    const g = 9.81;
    const vT = Math.sqrt((2 * m * g) / (rho * cdA));
    expect(dragAccel(rho, vT, cdA, m)).toBeCloseTo(g, 3);
    expect(vT).toBeGreaterThan(100); // ~115 m/s — believable for a brick
    expect(vT).toBeLessThan(130);
  });
  it('dynamic pressure at Max-Q-ish conditions', () => {
    expect(dynamicPressure(0.3, 450)).toBeGreaterThan(29_000); // ~30 kPa
  });
  it('reentry plasma triggers at hypersonic speed in thin Mars air, not on approach', () => {
    const rhoHigh = density(mars.atmo!, 30_000);
    expect(suttonGraves(rhoHigh, 2200)).toBeGreaterThan(PLASMA_START_W_M2); // entry burn
    expect(suttonGraves(density(mars.atmo!, 5000), 250)).toBeLessThan(PLASMA_START_W_M2); // landing approach: no plasma
  });
  it('heat scales with v³ (speed dominates)', () => {
    const rho = 0.001;
    expect(suttonGraves(rho, 2000) / suttonGraves(rho, 1000)).toBeCloseTo(8, 3);
  });
});
