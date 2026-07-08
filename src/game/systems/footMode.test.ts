import { beforeAll, describe, expect, it } from 'vitest';
import { FootMode, initRapier, type FootInput } from './footMode';

const DT = 1 / 60;
const idle: FootInput = { moveX: 0, moveZ: 0, sprint: false, jump: false, lookDX: 0, lookDY: 0 };

beforeAll(async () => {
  await initRapier();
});

/** flat ground with a 5 m wall at x > 40 (63° over 2.5 m cells — above the 45° climb limit) */
const ground = (x: number) => (x > 40 ? 5 : 0);

function make(g = 9.81): FootMode {
  return new FootMode(g, (x) => ground(x), [
    { pos: [0, 3.5, -20], halfExtents: [9, 3, 6.5] }, // a ship-ish box
  ], [5, 3, 5]);
}

function run(f: FootMode, seconds: number, input: Partial<FootInput> = {}): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) f.step(DT, { ...idle, ...input });
}

describe('FootMode — Rapier character controller (spec §11)', () => {
  it('falls to the ground and grounds (capsule feet at terrain height)', () => {
    const f = make();
    run(f, 3);
    expect(f.grounded).toBe(true);
    expect(f.position.y).toBeGreaterThan(0.85); // capsule center ≈ 0.9 above feet
    expect(f.position.y).toBeLessThan(1.0);
  });

  it('walks at 2.5 m/s, sprints at 6.0 m/s', () => {
    const f = make();
    run(f, 2);
    f.yaw = Math.PI; // face +Z — AWAY from the ship collider parked at −Z
    const p0 = { ...f.position };
    run(f, 4, { moveZ: 1 });
    const walked = Math.hypot(f.position.x - p0.x, f.position.z - p0.z);
    expect(walked).toBeGreaterThan(8);   // ~9.5 m in 4 s incl. accel
    expect(walked).toBeLessThan(11);
    const p1 = { ...f.position };
    run(f, 4, { moveZ: 1, sprint: true });
    const sprinted = Math.hypot(f.position.x - p1.x, f.position.z - p1.z);
    expect(sprinted).toBeGreaterThan(20);
    expect(sprinted).toBeLessThan(25);
  });

  it('jumps ~1 m at Earth gravity', () => {
    const f = make(9.81);
    run(f, 2);
    const y0 = f.position.y;
    let apex = y0;
    let jumped = false;
    for (let i = 0; i < 240; i++) {
      f.step(DT, { ...idle, jump: !jumped });
      jumped = true;
      apex = Math.max(apex, f.position.y);
    }
    expect(apex - y0).toBeGreaterThan(0.8);
    expect(apex - y0).toBeLessThan(1.25);
    expect(f.grounded).toBe(true); // landed again
  });

  it('is floaty on Luna (1.62 m/s²): same jump speed → ~4 m apex (clamped)', () => {
    const f = make(1.62);
    run(f, 4); // slower fall to ground
    const y0 = f.position.y;
    let apex = y0;
    let jumped = false;
    for (let i = 0; i < 60 * 10; i++) {
      f.step(DT, { ...idle, jump: !jumped });
      jumped = true;
      apex = Math.max(apex, f.position.y);
    }
    expect(apex - y0).toBeGreaterThan(2.5);
    expect(apex - y0).toBeLessThanOrEqual(4.3);
  });

  it('cannot walk through the ship collider', () => {
    const f = make();
    run(f, 2);
    // ship box spans z ∈ [-26.5, -13.5] at x ∈ [-9, 9]; walk toward it from (5,·,5)
    f.yaw = 0; // forward = −Z
    run(f, 12, { moveZ: 1, sprint: true });
    expect(f.position.z).toBeGreaterThan(-13.6); // stopped at the hull, not inside
  });

  it('is stopped by a wall steeper than the 45° climb limit', () => {
    const f = make();
    run(f, 2);
    f.yaw = -Math.PI / 2; // face +X
    run(f, 25, { moveZ: 1, sprint: true });
    // 5 m over one 2.5 m cell ≈ 63° — unclimbable; character stays below the crest
    expect(f.position.x).toBeLessThan(42.5);
    expect(f.position.y).toBeLessThan(3); // never topped the wall
  });

  it('look: yaw unbounded, pitch clamped to ±89°', () => {
    const f = make();
    f.step(DT, { ...idle, lookDX: 5000, lookDY: 5000 });
    expect(Math.abs(f.pitch)).toBeLessThanOrEqual(1.55);
    f.step(DT, { ...idle, lookDY: -20000 });
    expect(f.pitch).toBeLessThanOrEqual(1.55);
  });
});
