// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { InputSystem } from './input';

const DT = 1 / 60;

function key(type: 'keydown' | 'keyup', code: string): void {
  window.dispatchEvent(new KeyboardEvent(type, { code }));
}

describe('InputSystem', () => {
  let input: InputSystem;

  beforeEach(() => {
    input = new InputSystem(document.createElement('canvas'));
  });

  it('maps WA/R/Ctrl/QE to signed axes; Space and S are actions, not axes', () => {
    key('keydown', 'KeyW');
    key('keydown', 'KeyA');
    key('keydown', 'KeyR');
    key('keydown', 'KeyQ');
    key('keydown', 'Space');
    key('keydown', 'KeyS');
    const f = input.sample(0, DT, false);
    expect(f.axes['ship.strafeZ']).toBe(-1); // W = forward = −Z (S is brake, not reverse)
    expect(f.axes['ship.strafeX']).toBe(-1); // A = left
    expect(f.axes['ship.strafeY']).toBe(1);  // R = up
    expect(f.axes['ship.roll']).toBe(1);     // Q
    expect(f.held.has('ship.afterburner')).toBe(true); // Space
    expect(f.held.has('ship.brake')).toBe(true);       // S
    key('keyup', 'KeyW');
    const g = input.sample(1, DT, false);
    expect(g.axes['ship.strafeZ']).toBe(0);
  });

  it('opposed keys cancel (R up vs Ctrl down)', () => {
    key('keydown', 'KeyR');
    key('keydown', 'ControlLeft');
    const f = input.sample(0, DT, false);
    expect(f.axes['ship.strafeY']).toBe(0);
  });

  it('W+S = thrust with brake overlaid (brake wins in the flight model)', () => {
    key('keydown', 'KeyW');
    key('keydown', 'KeyS');
    const f = input.sample(0, DT, false);
    expect(f.axes['ship.strafeZ']).toBe(-1);
    expect(f.held.has('ship.brake')).toBe(true);
  });

  it('pressed is edge-triggered (fires once), held is level', () => {
    key('keydown', 'ShiftLeft');
    const f1 = input.sample(0, DT, false);
    expect(f1.pressed.has('ship.boost')).toBe(true);
    expect(f1.held.has('ship.boost')).toBe(true);
    const f2 = input.sample(1, DT, false);
    expect(f2.pressed.has('ship.boost')).toBe(false); // edge consumed
    expect(f2.held.has('ship.boost')).toBe(true);     // still held
  });

  it('action keys map to the right actions', () => {
    for (const [code, action] of [
      ['KeyT', 'ship.flightAssistToggle'],
      ['KeyV', 'ship.decoupleToggle'],
      ['KeyB', 'ship.warpEngage'],
      ['KeyG', 'ship.cycleTarget'],
      ['Space', 'ship.afterburner'],
      ['KeyS', 'ship.brake'],
      ['F4', 'camera.toggleChase'],
    ] as const) {
      key('keydown', code);
      const f = input.sample(0, DT, false);
      expect(f.pressed.has(action), `${code} → ${action}`).toBe(true);
      key('keyup', code);
    }
  });

  it('raw codes surface for dev shortcuts', () => {
    key('keydown', 'Digit5');
    key('keydown', 'F2');
    const f = input.sample(0, DT, false);
    expect(f.codes.has('Digit5')).toBe(true);
    expect(f.codes.has('F2')).toBe(true);
  });

  it('window blur releases all held keys (no stuck-key on Alt-Tab)', () => {
    key('keydown', 'KeyW');
    window.dispatchEvent(new Event('blur'));
    const f = input.sample(0, DT, false);
    expect(f.axes['ship.strafeZ']).toBe(0);
  });

  it('reticle recenters exponentially when assist is on and no mouse input', () => {
    input.reticleX = 200;
    input.reticleY = -100;
    for (let i = 0; i < 60; i++) input.sample(i, DT, true); // 1 s of recentering
    expect(Math.abs(input.reticleX)).toBeLessThan(15);
    expect(Math.abs(input.reticleY)).toBeLessThan(8);
    // and stays put when recentering is off
    input.reticleX = 100;
    for (let i = 0; i < 30; i++) input.sample(i, DT, false);
    expect(input.reticleX).toBe(100);
  });

  it('reticle is clamped to its radius', () => {
    input.reticleX = 10_000;
    input.reticleY = 10_000;
    input.sample(0, DT, false);
    expect(Math.hypot(input.reticleX, input.reticleY)).toBeLessThanOrEqual(input.reticleRadius + 1e-9);
  });
});
