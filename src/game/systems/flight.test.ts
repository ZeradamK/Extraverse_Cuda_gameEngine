import { describe, expect, it } from 'vitest';
import { ShipFlight } from './flight';
import type { ActionId, IntentFrame } from '../../engine/core/input';

const DT = 1 / 60;

function intent(o: {
  axes?: Partial<Record<ActionId, number>>;
  pressed?: ActionId[];
  held?: ActionId[];
} = {}): IntentFrame {
  return {
    tick: 0,
    axes: o.axes ?? {},
    pressed: new Set(o.pressed ?? []),
    held: new Set(o.held ?? []),
    codes: new Set(), lookDX: 0, lookDY: 0,
  };
}

function run(f: ShipFlight, seconds: number, i: IntentFrame): void {
  const n = Math.round(seconds / DT);
  for (let k = 0; k < n; k++) f.step(DT, i);
}

describe('ShipFlight — coupled mode (flight assist)', () => {
  it('W accelerates forward (−Z) and converges to the 250 m/s SCM cap', () => {
    const f = new ShipFlight();
    run(f, 20, intent({ axes: { 'ship.strafeZ': -1 } }));
    expect(f.curr.vel.z).toBeLessThan(0); // forward is −Z
    expect(f.speed).toBeGreaterThan(240);
    expect(f.speed).toBeLessThan(255);
  });

  it('released stick decelerates back toward zero', () => {
    const f = new ShipFlight();
    run(f, 10, intent({ axes: { 'ship.strafeZ': -1 } }));
    run(f, 25, intent());
    expect(f.speed).toBeLessThan(5);
  });

  it('all-stop (X) kills residual velocity', () => {
    const f = new ShipFlight();
    run(f, 5, intent({ axes: { 'ship.strafeZ': -1 } }));
    run(f, 15, intent({ held: ['ship.allStop'] }));
    expect(f.speed).toBeLessThan(1);
  });
});

describe('ShipFlight — decoupled mode', () => {
  it('V toggles decoupled; velocity persists with no input (Newtonian drift)', () => {
    const f = new ShipFlight();
    run(f, 6, intent({ axes: { 'ship.strafeZ': -1 } }));
    f.step(DT, intent({ pressed: ['ship.decoupleToggle'] }));
    expect(f.decoupled).toBe(true);
    const v0 = f.speed;
    run(f, 10, intent());
    expect(f.speed).toBeCloseTo(v0, 6); // no drag in space
  });

  it('rotating while drifting does not change velocity direction', () => {
    const f = new ShipFlight();
    run(f, 6, intent({ axes: { 'ship.strafeZ': -1 } }));
    f.step(DT, intent({ pressed: ['ship.decoupleToggle'] }));
    const v0 = f.curr.vel.clone();
    run(f, 3, intent({ axes: { 'ship.yaw': 1 } })); // yaw hard while coasting
    expect(f.curr.vel.angleTo(v0)).toBeLessThan(1e-6);
  });
});

describe('ShipFlight — afterburner (hold Space WITH W = 5×, infinite fuel)', () => {
  it('spools up and lifts the coupled cap toward 5× (1250 m/s)', () => {
    const f = new ShipFlight();
    run(f, 12, intent({ axes: { 'ship.strafeZ': -1 }, held: ['ship.afterburner'] }));
    expect(f.boosting).toBe(true);
    expect(f.boost01).toBeGreaterThan(0.99);   // fully spooled
    expect(f.speed).toBeGreaterThan(1150);
    expect(f.speed).toBeLessThan(1260);
  });

  it('does nothing without forward thrust (Space alone)', () => {
    const f = new ShipFlight();
    run(f, 3, intent({ held: ['ship.afterburner'] }));
    expect(f.boosting).toBe(false);
    expect(f.boost01).toBeLessThan(0.01);
    expect(f.speed).toBeLessThan(1);
  });

  it('releasing Space decelerates back to the 250 m/s cap while W stays held', () => {
    const f = new ShipFlight();
    run(f, 12, intent({ axes: { 'ship.strafeZ': -1 }, held: ['ship.afterburner'] }));
    expect(f.speed).toBeGreaterThan(1100);
    run(f, 10, intent({ axes: { 'ship.strafeZ': -1 } })); // W only — damper-assisted decel
    expect(f.speed).toBeGreaterThan(240); // still cruising forward at SCM
    expect(f.speed).toBeLessThan(260);
  });

  it('multiplies decoupled main-thrust authority by 5 once spooled', () => {
    const f = new ShipFlight();
    f.decoupled = true;
    run(f, 3, intent({ axes: { 'ship.strafeZ': -1 }, held: ['ship.afterburner'] }));
    expect(f.aCmdBody.z).toBeCloseTo(-250, 0); // 50 × 5
  });
});

describe('ShipFlight — S brake', () => {
  it('kills residual velocity like all-stop', () => {
    const f = new ShipFlight();
    run(f, 5, intent({ axes: { 'ship.strafeZ': -1 } }));
    run(f, 5, intent({ held: ['ship.brake'] }));
    expect(f.speed).toBeLessThan(1);
  });

  it('overrides W: braking while thrusting decelerates', () => {
    const f = new ShipFlight();
    run(f, 5, intent({ axes: { 'ship.strafeZ': -1 } }));
    const v0 = f.speed;
    run(f, 2, intent({ axes: { 'ship.strafeZ': -1 }, held: ['ship.brake'] }));
    expect(f.speed).toBeLessThan(v0 * 0.2);
  });

  it('brakes from afterburner speed with damper assist (seconds, not minutes)', () => {
    const f = new ShipFlight();
    run(f, 12, intent({ axes: { 'ship.strafeZ': -1 }, held: ['ship.afterburner'] }));
    expect(f.speed).toBeGreaterThan(1100);
    run(f, 6, intent({ held: ['ship.brake'] }));
    expect(f.speed).toBeLessThan(5);
  });
});

describe('ShipFlight — rotation assist', () => {
  it('pitch stick converges to the 60°/s rate cap and stops when released', () => {
    const f = new ShipFlight();
    run(f, 3, intent({ axes: { 'ship.pitch': -1 } })); // nose up
    expect(f.curr.omega.x).toBeGreaterThan(0.9);       // ≈ 1.047 rad/s cap
    expect(f.curr.omega.x).toBeLessThanOrEqual(1.05);
    run(f, 3, intent());
    expect(f.curr.omega.length()).toBeLessThan(0.01);  // assist damps rotation
  });

  it('steerScale option reduces rotation authority (warp steering)', () => {
    const a = new ShipFlight();
    const b = new ShipFlight();
    for (let k = 0; k < 120; k++) {
      a.step(DT, intent({ axes: { 'ship.yaw': 1 } }));
      b.step(DT, intent({ axes: { 'ship.yaw': 1 } }), { steerScale: 0.15 });
    }
    expect(Math.abs(b.curr.omega.y)).toBeLessThan(Math.abs(a.curr.omega.y) * 0.25);
  });
});

describe('ShipFlight — warp translation ownership', () => {
  it('skipTranslation freezes velocity/position integration but keeps rotation', () => {
    const f = new ShipFlight();
    run(f, 4, intent({ axes: { 'ship.strafeZ': -1 } }));
    const p0 = f.curr.pos.clone();
    const v0 = f.curr.vel.clone();
    run(f, 2, intent({ axes: { 'ship.strafeZ': -1, 'ship.yaw': 1 } }));
    // sanity: normally it would move
    expect(f.curr.pos.distanceTo(p0)).toBeGreaterThan(100);
    const p1 = f.curr.pos.clone();
    for (let k = 0; k < 120; k++) f.step(DT, intent({ axes: { 'ship.strafeZ': -1 } }), { skipTranslation: true });
    expect(f.curr.pos.distanceTo(p1)).toBe(0);
    expect(f.curr.vel.equals(v0.set(f.curr.vel.x, f.curr.vel.y, f.curr.vel.z))).toBe(true);
  });
});

describe('ShipFlight — NAV cruise mode (4000 mi/s)', () => {
  const NAV_V_MAX = 4000 * 1609.344;

  it('C toggles NAV; cruise blows past the 250 m/s SCM cap toward the ceiling', () => {
    const f = new ShipFlight();
    f.step(1 / 60, intent({ pressed: ['ship.navToggle'] }));
    expect(f.navMode).toBe(true);
    // open space: no navCap constraint
    for (let k = 0; k < 60 * 40; k++) f.step(DT, intent({ axes: { 'ship.strafeZ': -1 } }));
    expect(f.speed).toBeGreaterThan(1e6);          // way beyond SCM after 40 s
    expect(f.speed).toBeLessThanOrEqual(NAV_V_MAX * 1.001);
  });

  it('respects the distance-slaved safety cap near a body', () => {
    const f = new ShipFlight();
    f.navMode = true;
    for (let k = 0; k < 60 * 30; k++) {
      f.step(DT, intent({ axes: { 'ship.strafeZ': -1 } }), { navCap: 50_000 });
    }
    expect(f.speed).toBeLessThanOrEqual(50_000 * 1.001);
    expect(f.speed).toBeGreaterThan(45_000);
  });

  it('dropping out of NAV decelerates back to SCM speeds', () => {
    const f = new ShipFlight();
    f.navMode = true;
    for (let k = 0; k < 60 * 20; k++) f.step(DT, intent({ axes: { 'ship.strafeZ': -1 } }));
    f.navMode = false;
    for (let k = 0; k < 60 * 60 * 3; k++) f.step(DT, intent({})); // SCM assist brakes (authority-limited)
    expect(f.speed).toBeLessThan(300);
  });
});

describe('ShipFlight — G meter', () => {
  it('full afterburner thrust reads ≈ 25 G (50 m/s² × 5)', () => {
    const f = new ShipFlight();
    f.decoupled = true;
    run(f, 2, intent({ axes: { 'ship.strafeZ': -1 }, held: ['ship.afterburner'] }));
    expect(f.gForce).toBeGreaterThan(24.5);
    expect(f.gForce).toBeLessThan(26);
  });
});
