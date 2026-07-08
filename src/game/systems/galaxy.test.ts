import { describe, expect, it } from 'vitest';
import { ciToColor, generateSystem, ProcSystem, SGR_A_ID, type Star } from './galaxy';

const star = (id: number, name = 'Test'): Star =>
  ({ id, name, x: 3, y: 4, z: 0, distLy: 16.3, mag: 5, ci: 0.65, color: 0xffffff });

describe('galaxy procgen (M8)', () => {
  it('is DETERMINISTIC: same star + seed → identical system', () => {
    const a = generateSystem(star(77), 20260706, 0);
    const b = generateSystem(star(77), 20260706, 0);
    expect(a.planets.length).toBe(b.planets.length);
    for (let i = 0; i < a.planets.length; i++) {
      expect(a.planets[i].radiusM).toBe(b.planets[i].radiusM);
      expect(a.planets[i].posM.x).toBe(b.planets[i].posM.x);
      expect(a.planets[i].terrainSeed).toBe(b.planets[i].terrainSeed);
    }
  });

  it('different stars diverge; planets orbit and carry deltas', () => {
    const a = generateSystem(star(77), 20260706, 0);
    const c = generateSystem(star(78), 20260706, 0);
    const differ = a.planets.length !== c.planets.length ||
      a.planets.some((p, i) => c.planets[i] && p.radiusM !== c.planets[i].radiusM);
    expect(differ).toBe(true);
    const p0 = { ...a.planets[0].posM };
    a.update(600);
    expect(Math.hypot(a.planets[0].posM.x - p0.x, a.planets[0].posM.z - p0.z)).toBeGreaterThan(0);
    expect(Math.abs(a.planets[0].deltaM.x) + Math.abs(a.planets[0].deltaM.z)).toBeGreaterThan(0);
  });

  it('generates 2–6 planets with sane radii and some landable', () => {
    let landable = 0;
    for (let id = 0; id < 30; id++) {
      const s = generateSystem(star(id), 1, 0);
      expect(s.planets.length).toBeGreaterThanOrEqual(2);
      expect(s.planets.length).toBeLessThanOrEqual(6);
      for (const p of s.planets) {
        expect(p.radiusM).toBeGreaterThan(100_000);   // ≥ 1200 km real ×0.1
        expect(p.radiusM).toBeLessThan(7_100_000);
      }
      landable += s.planets.filter(p => p.terrainKind).length;
    }
    expect(landable).toBeGreaterThan(20); // rocky worlds are common
  });

  it('Sagittarius A* is a black hole with no planets', () => {
    const s = new ProcSystem(star(SGR_A_ID, 'Sagittarius A*'), 42, 0);
    expect(s.isBlackHole).toBe(true);
    expect(s.planets.length).toBe(0);
    expect((s.sun.def as { blackHole?: boolean }).blackHole).toBe(true);
  });
});

describe('ciToColor (B−V → blackbody sRGB)', () => {
  it('hot stars are blue-white, cool stars are orange-red', () => {
    const hot = ciToColor(-0.2);   // B-class
    const cool = ciToColor(1.8);   // M-class
    const r = (c: number) => (c >> 16) & 0xff, b = (c: number) => c & 0xff;
    expect(b(hot)).toBeGreaterThanOrEqual(r(hot));   // blue ≥ red
    expect(r(cool)).toBeGreaterThan(b(cool) + 40);   // strongly red
  });
  it('solar ci 0.65 is warm white', () => {
    const c = ciToColor(0.65);
    expect((c >> 16) & 0xff).toBeGreaterThan(230);
    expect(c & 0xff).toBeGreaterThan(180);
  });
});
