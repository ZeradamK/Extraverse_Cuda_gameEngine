import { describe, expect, it } from 'vitest';
import { SolSystem, bodyOrientation } from './solSystem';
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

describe('Earth–Moon system (scientific scale + libration)', () => {
  it('distance is the real 384,400 km at system scale (38,440 km)', () => {
    const s = new SolSystem(EPOCH);
    const luna = s.bodies.find(b => b.name === 'Luna')!;
    const earth = s.planets[2];
    const d = Math.hypot(
      luna.posM.x - earth.posM.x, luna.posM.y - earth.posM.y, luna.posM.z - earth.posM.z);
    expect(d).toBeCloseTo(384_400e3 * SYSTEM_SCALE, -2);
    // scale-invariant truths: distance = 60.34 Earth radii; Moon disc ≈ 0.518°
    expect(d / earth.radiusM).toBeCloseTo(60.34, 1);
    const angularDeg = (2 * Math.atan(luna.radiusM / d) * 180) / Math.PI;
    expect(angularDeg).toBeGreaterThan(0.49);
    expect(angularDeg).toBeLessThan(0.55);
  });

  it('libration: spin wobbles ±2e around tidal lock, latitude nods ±6.7°', () => {
    const s = new SolSystem(EPOCH);
    const luna = () => s.bodies.find(b => b.name === 'Luna')!;
    let minDev = Infinity, maxDev = -Infinity, minWob = Infinity, maxWob = -Infinity;
    for (let d = 0; d <= 28; d++) {
      s.update(86400);
      const b = luna();
      const tS = (EPOCH + (d + 1) * 86400e3) / 1000;
      const orbitAngle = ((tS / 86400 / 27.3217) % 1) * 2 * Math.PI;
      const dev = b.spin - orbitAngle; // deviation from pure tidal lock
      minDev = Math.min(minDev, dev); maxDev = Math.max(maxDev, dev);
      minWob = Math.min(minWob, b.wobble); maxWob = Math.max(maxWob, b.wobble);
    }
    expect(maxDev).toBeGreaterThan(0.09);   // ≈ +0.11 rad (2e)
    expect(minDev).toBeLessThan(-0.09);
    expect(maxWob).toBeGreaterThan(0.10);   // ≈ ±0.1166 rad (6.68°)
    expect(minWob).toBeLessThan(-0.10);
  });

  it('planets have zero wobble (libration is a tidally-locked-moon effect)', () => {
    const s = new SolSystem(EPOCH);
    s.update(86400);
    for (const p of s.planets) expect(p.wobble).toBe(0);
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

describe('bodyOrientation (audit regressions)', () => {
  const Q = () => new (class {
    x = 0; y = 0; z = 0; w = 1;
    setFromAxisAngle(a: { x: number; y: number; z: number }, r: number) {
      const s = Math.sin(r / 2);
      this.x = a.x * s; this.y = a.y * s; this.z = a.z * s; this.w = Math.cos(r / 2);
      return this;
    }
    multiply(q: { x: number; y: number; z: number; w: number }) {
      const { x, y, z, w } = this;
      this.x = w * q.x + x * q.w + y * q.z - z * q.y;
      this.y = w * q.y - x * q.z + y * q.w + z * q.x;
      this.z = w * q.z + x * q.y - y * q.x + z * q.w;
      this.w = w * q.w - x * q.x - y * q.y - z * q.z;
      return this;
    }
    rotY(v: { x: number; y: number; z: number }) { // rotate vector by this quat
      const { x, y, z, w } = this;
      const ix = w * v.x + y * v.z - z * v.y;
      const iy = w * v.y + z * v.x - x * v.z;
      const iz = w * v.z + x * v.y - y * v.x;
      const iw = -x * v.x - y * v.y - z * v.z;
      return {
        x: ix * w + iw * -x + iy * -z - iz * -y,
        y: iy * w + iw * -y + iz * -x - ix * -z,
        z: iz * w + iw * -z + ix * -y - iy * -x,
      };
    }
  })();

  it('Earth pole stays at exactly 23.44° obliquity and DOES NOT precess with spin', () => {
    const s = new SolSystem(EPOCH);
    const earth = s.planets[2];
    const poleAt = (spin: number) => {
      const q = Q(), scratch = Q();
      bodyOrientation({ ...earth, spin, wobble: 0 }, q, scratch);
      return q.rotY({ x: 0, y: 1, z: 0 });
    };
    const p0 = poleAt(0);
    const p1 = poleAt(2.1); // different spin phase
    const ang0 = Math.acos(p0.y) * 180 / Math.PI;
    expect(ang0).toBeCloseTo(23.44, 1);
    // the pole is FIXED as the planet spins (the old Euler order made it precess)
    expect(Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z)).toBeLessThan(1e-9);
  });

  it('Venus reads retrograde via its 177° tilt with positive spin rate', () => {
    const s = new SolSystem(EPOCH);
    const venus = s.planets[1];
    s.update(3600);
    expect(venus.spin).toBeGreaterThan(0); // |rotationHours| — no double negation
    expect(venus.axialTiltRad * 180 / Math.PI).toBeCloseTo(177.36, 1);
  });
});

describe('surfaceVelocity (audit: landed co-rotation)', () => {
  it('Earth equator ground speed ≈ 46.4 m/s at 1/10 scale', async () => {
    const { surfaceVelocity } = await import('./environment');
    const R = 637_100; // scaled Earth radius, m
    const out = { x: 0, y: 0, z: 0 };
    // point on the tilted equator: r ⊥ spin axis; use r along +X (always ⊥ axis)
    surfaceVelocity((23.44 * Math.PI) / 180, 23.9345, R, 0, 0, out);
    const speed = Math.hypot(out.x, out.y, out.z);
    expect(speed).toBeCloseTo((2 * Math.PI * R) / (23.9345 * 3600), 3);
    expect(speed).toBeGreaterThan(46);
    expect(speed).toBeLessThan(47);
  });
  it('is perpendicular to both the axis and the radius (Ω × r)', async () => {
    const { surfaceVelocity } = await import('./environment');
    const out = { x: 0, y: 0, z: 0 };
    surfaceVelocity(0.5, 24, 1000, 2000, -500, out);
    // v · r = 0
    expect(out.x * 1000 + out.y * 2000 + out.z * -500).toBeCloseTo(0, 6);
  });
});
