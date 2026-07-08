import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { WarpDrive } from './warpDrive';
import { ShipFlight } from './flight';
import type { SolSystem, BodyState } from './solSystem';
import type { ActionId, IntentFrame } from '../../engine/core/input';

const DT = 1 / 60;

const emptyIntent = (): IntentFrame => ({
  tick: 0, axes: {}, pressed: new Set<ActionId>(), held: new Set<ActionId>(), codes: new Set<string>(),
});

/** minimal stub system: sun at origin + one target planet ahead on −Z */
function stubSystem(targetZ: number, radiusM = 3.4e5): { sys: SolSystem; target: BodyState } {
  const sun = { name: 'Sol', kind: 'star', posM: { x: 0, y: 1e12, z: 0 }, radiusM: 7e7 } as BodyState;
  const target = { name: 'TestPlanet', kind: 'planet', posM: { x: 0, y: 0, z: targetZ }, radiusM } as BodyState;
  const sys = { bodies: [sun, target], planets: [target] } as unknown as SolSystem;
  return { sys, target };
}

function stepAll(warp: WarpDrive, flight: ShipFlight, seconds: number): void {
  const n = Math.round(seconds / DT);
  for (let k = 0; k < n; k++) {
    const owns = warp.state === 'WARP';
    flight.step(DT, emptyIntent(), { steerScale: warp.steerScale, skipTranslation: owns });
    warp.step(DT);
  }
}

describe('WarpDrive state machine', () => {
  it('will not spool without a target', () => {
    const { sys } = stubSystem(-1e10);
    const flight = new ShipFlight();
    const warp = new WarpDrive(sys, flight);
    warp.requestSpool();
    expect(warp.state).toBe('IDLE');
  });

  it('cycleTarget selects planets in order and wraps', () => {
    const { sys, target } = stubSystem(-1e10);
    const warp = new WarpDrive(sys, new ShipFlight());
    warp.cycleTarget();
    expect(warp.target).toBe(target);
    warp.cycleTarget();
    expect(warp.target).toBe(target); // single planet wraps to itself
  });

  it('SPOOL owns rotation (steerScale 0) and engages after 3 s when aligned', () => {
    const { sys } = stubSystem(-1e10);
    const flight = new ShipFlight(); // identity quat: nose −Z → already aligned
    const warp = new WarpDrive(sys, flight);
    warp.cycleTarget();
    warp.requestSpool();
    expect(warp.state).toBe('SPOOL');
    expect(warp.steerScale).toBe(0);
    stepAll(warp, flight, 3.2);
    expect(warp.state).toBe('WARP');
  });

  it('spool auto-aligns a misaligned ship before engaging', () => {
    const { sys } = stubSystem(-1e10);
    const flight = new ShipFlight();
    flight.curr.quat.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI); // facing +Z (away)
    const warp = new WarpDrive(sys, flight);
    warp.cycleTarget();
    warp.requestSpool();
    stepAll(warp, flight, 1.0);
    expect(warp.state).toBe('SPOOL'); // not yet — time and/or angle gate
    stepAll(warp, flight, 2.6);
    expect(warp.state).toBe('WARP'); // autopilot brought it around
    // nose (−Z rotated by quat) now points at the target on −Z
    const nose = new Vector3(0, 0, -1).applyQuaternion(flight.curr.quat);
    expect(nose.z).toBeLessThan(-0.999);
    expect(flight.curr.quat.angleTo(new Quaternion())).toBeLessThan(0.05);
  });

  it('WARP: speed respects the distance-slaved cap and closes on target', () => {
    const { sys } = stubSystem(-1e10);
    const flight = new ShipFlight();
    const warp = new WarpDrive(sys, flight);
    warp.cycleTarget();
    warp.requestSpool();
    stepAll(warp, flight, 3.2); // now WARP
    const d0 = warp.targetDistance();
    stepAll(warp, flight, 10);
    expect(warp.v).toBeLessThanOrEqual(warp.vCap * 1.001);
    expect(warp.v).toBeGreaterThan(30_000);
    expect(warp.targetDistance()).toBeLessThan(d0);
  });

  it('auto-drops at the target into COOLDOWN, then returns to IDLE', () => {
    const { sys } = stubSystem(-3e6); // start just 3000 km out
    const flight = new ShipFlight();
    const warp = new WarpDrive(sys, flight);
    warp.cycleTarget();
    warp.requestSpool();
    stepAll(warp, flight, 3.2);
    stepAll(warp, flight, 60); // plenty to arrive
    expect(['COOLDOWN', 'IDLE']).toContain(warp.state);
    expect(warp.targetDistance()).toBeLessThan(2e6);
    stepAll(warp, flight, 12);
    expect(warp.state).toBe('IDLE');
    // drop leaves a gentle drift, not warp speed
    expect(flight.speed).toBeLessThan(400);
  });

  it('OBSTRUCTED: refuses to spool when a body blocks the path (SC behavior)', () => {
    const { sys, target } = stubSystem(-1e10);
    // blocker planet dead-center between ship and target
    const blocker = {
      name: 'Blocker', kind: 'planet', posM: { x: 0, y: 0, z: -5e9 }, radiusM: 6.4e5,
    } as never;
    (sys.bodies as unknown[]).push(blocker);
    const flight = new ShipFlight();
    const warp = new WarpDrive(sys, flight);
    warp.target = target;
    expect(warp.obstructed).toBe(true);
    warp.requestSpool();
    expect(warp.state).toBe('IDLE'); // refused
    // offset blocker far off-axis → clear
    (blocker as { posM: { x: number } }).posM.x = 1e9;
    expect(warp.obstructed).toBe(false);
    warp.requestSpool();
    expect(warp.state).toBe('SPOOL');
  });

  it('mass-lock: entering a body exclusion zone mid-warp = emergency drop', () => {
    const { sys, target } = stubSystem(-1e10);
    const blocker = {
      name: 'Blocker', kind: 'planet', posM: { x: 0, y: 0, z: -2e9 }, radiusM: 6.4e5,
    } as never;
    const flight = new ShipFlight();
    const warp = new WarpDrive(sys, flight);
    warp.target = target;
    warp.requestSpool();
    stepAll(warp, flight, 3.2);
    expect(warp.state).toBe('WARP');
    (sys.bodies as unknown[]).push(blocker); // body appears in the path (worst case)
    // teleport the ship inside the exclusion zone
    flight.curr.pos.set(0, 0, -2e9 + 6.4e5);
    warp.step(1 / 60);
    expect(warp.state).toBe('COOLDOWN'); // emergency drop, no fly-through
    expect(flight.speed).toBeLessThan(400);
  });

  it('manual drop from WARP goes to COOLDOWN', () => {
    const { sys } = stubSystem(-1e10);
    const flight = new ShipFlight();
    const warp = new WarpDrive(sys, flight);
    warp.cycleTarget();
    warp.requestSpool();
    stepAll(warp, flight, 3.2);
    expect(warp.state).toBe('WARP');
    warp.requestSpool(); // B again = drop
    expect(warp.state).toBe('COOLDOWN');
  });
});
