import { describe, expect, it } from 'vitest';
import { SolSystem } from './solSystem';
import { SYSTEM_SCALE, AU_M } from '../../data/solarSystem';

const EPOCH = Date.UTC(2026, 6, 6); // fixed for determinism
const AU_SCALED = AU_M * SYSTEM_SCALE;

describe('SolSystem rails', () => {
  const sys = new SolSystem(EPOCH);

  it('builds sun + 8 planets + 7 moons (Luna, Galileans, Titan, Enceladus)', () => {
    expect(sys.planets.length).toBe(8);
    expect(sys.bodies.length).toBe(1 + 8 + 7);
    expect(sys.bodies.filter(b => b.kind === 'moon').length).toBe(7);
  });

  it('planet heliocentric distances are ordered and scaled', () => {
    const d = sys.planets.map(p => Math.hypot(p.posM.x, p.posM.y, p.posM.z));
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThan(d[i - 1]);
    expect(d[2] / AU_SCALED).toBeGreaterThan(0.98); // Earth ≈ 1 AU (scaled)
    expect(d[2] / AU_SCALED).toBeLessThan(1.03);
    expect(d[7] / AU_SCALED).toBeGreaterThan(29);   // Neptune
  });

  it('moons stay near their parents (scaled orbit radius)', () => {
    const luna = sys.bodies.find(b => b.name === 'Luna')!;
    const earth = sys.planets[2];
    const d = Math.hypot(
      luna.posM.x - earth.posM.x, luna.posM.y - earth.posM.y, luna.posM.z - earth.posM.z);
    expect(d).toBeCloseTo(384_400e3 * SYSTEM_SCALE, -3); // 38,440 km
  });

  it('update advances deterministically and keeps rails analytic', () => {
    const a = new SolSystem(EPOCH);
    const b = new SolSystem(EPOCH);
    a.update(3600);           // one big step
    for (let i = 0; i < 60; i++) b.update(60); // many small steps
    const pa = a.planets[3].posM;
    const pb = b.planets[3].posM;
    expect(pa.x).toBeCloseTo(pb.x, 3); // analytic → path-independent
    expect(pa.y).toBeCloseTo(pb.y, 3);
    expect(pa.z).toBeCloseTo(pb.z, 3);
  });

  it('Luna moves ~13°/day around Earth', () => {
    const a = new SolSystem(EPOCH);
    const l0 = { ...a.bodies.find(b => b.name === 'Luna')!.posM };
    const e0 = { ...a.planets[2].posM };
    a.update(86400);
    const l1 = a.bodies.find(b => b.name === 'Luna')!.posM;
    const e1 = a.planets[2].posM;
    const v0 = { x: l0.x - e0.x, z: l0.z - e0.z };
    const v1 = { x: l1.x - e1.x, z: l1.z - e1.z };
    const ang = Math.abs(Math.atan2(v0.x * v1.z - v0.z * v1.x, v0.x * v1.x + v0.z * v1.z)) * 180 / Math.PI;
    expect(ang).toBeGreaterThan(12);
    expect(ang).toBeLessThan(14.5);
  });
});

describe('SolSystem.sunVisibility (eclipses)', () => {
  const sys = new SolSystem(EPOCH);
  const earth = sys.planets[2];

  it('fully lit in open space', () => {
    const p = { x: earth.posM.x, y: earth.posM.y + earth.radiusM * 50, z: earth.posM.z };
    expect(sys.sunVisibility(p)).toBe(1);
  });

  it('umbra directly behind Earth (anti-sun) blocks the sun', () => {
    const r = Math.hypot(earth.posM.x, earth.posM.y, earth.posM.z);
    const u = { x: earth.posM.x / r, y: earth.posM.y / r, z: earth.posM.z / r };
    const p = {
      x: earth.posM.x + u.x * earth.radiusM * 3,
      y: earth.posM.y + u.y * earth.radiusM * 3,
      z: earth.posM.z + u.z * earth.radiusM * 3,
    };
    expect(sys.sunVisibility(p)).toBeLessThan(0.15);
  });

  it('sunward side of Earth is fully lit', () => {
    const r = Math.hypot(earth.posM.x, earth.posM.y, earth.posM.z);
    const u = { x: earth.posM.x / r, y: earth.posM.y / r, z: earth.posM.z / r };
    const p = {
      x: earth.posM.x - u.x * earth.radiusM * 3,
      y: earth.posM.y - u.y * earth.radiusM * 3,
      z: earth.posM.z - u.z * earth.radiusM * 3,
    };
    expect(sys.sunVisibility(p)).toBe(1);
  });
});
