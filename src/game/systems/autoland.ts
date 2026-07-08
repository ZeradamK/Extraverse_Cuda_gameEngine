/**
 * Autoland (§10) — vertical-speed control law with gravity feed-forward,
 * horizontal kill, gear/dust beats. Pure: consumes a context, emits an accel
 * command in the radial frame; main maps it to world space.
 *
 *   v_target = −clamp(h_AGL / τ_d, V_TOUCH, V_DESCENT_MAX)   (exponential flare)
 *   a_radial = g + Kp·(v_target − v_radial)                  (P + gravity FF)
 */

export type AutolandState = 'IDLE' | 'DESCEND' | 'FINAL' | 'LANDED';

const TAU_D = 5;          // s — flare time constant
const V_TOUCH = 2;        // m/s — touchdown sink rate
const V_DESCENT_MAX = 55; // m/s
const KP = 2.2;           // 1/s
const TAU_H = 3;          // s — horizontal kill
const FINAL_ALT = 500;    // m — gear + beats
const TOUCH_ALT = 1.2;    // m AGL (gear-height allowance above the +4 m clamp)

export interface AutolandCtx {
  altAGL: number;      // m above terrain
  vRadial: number;     // m/s, + = away from planet
  vHorizX: number;     // m/s horizontal components (world, ⊥ radial)
  vHorizY: number;
  vHorizZ: number;
  gravity: number;     // m/s², local
  maxAccel: number;    // thruster authority for the radial axis
}

export interface AutolandCmd {
  aRadial: number;                       // m/s² along +radial (up)
  aHorizX: number; aHorizY: number; aHorizZ: number;
  gearDown: boolean;
  /** 0..1 — thrust-dust intensity (only meaningful below ~50 m) */
  dust: number;
  landedNow: boolean;                    // true on the LANDED transition tick
}

export class Autoland {
  state: AutolandState = 'IDLE';

  engage(): void {
    if (this.state === 'IDLE') this.state = 'DESCEND';
  }

  /** player input or liftoff cancels */
  cancel(): void {
    this.state = 'IDLE';
  }

  step(dt: number, ctx: AutolandCtx): AutolandCmd {
    void dt;
    const cmd: AutolandCmd = {
      aRadial: 0, aHorizX: 0, aHorizY: 0, aHorizZ: 0,
      gearDown: this.state === 'FINAL' || this.state === 'LANDED',
      dust: 0,
      landedNow: false,
    };
    if (this.state === 'IDLE' || this.state === 'LANDED') return cmd;

    // state transitions
    if (this.state === 'DESCEND' && ctx.altAGL < FINAL_ALT) this.state = 'FINAL';
    const hSpeed = Math.hypot(ctx.vHorizX, ctx.vHorizY, ctx.vHorizZ);
    if (this.state === 'FINAL' && ctx.altAGL <= TOUCH_ALT && Math.abs(ctx.vRadial) < V_TOUCH * 1.6 && hSpeed < 3) {
      this.state = 'LANDED';
      cmd.landedNow = true;
      cmd.gearDown = true;
      return cmd;
    }

    // vertical-speed law with gravity feed-forward
    const vTarget = -Math.min(Math.max(ctx.altAGL / TAU_D, V_TOUCH), V_DESCENT_MAX);
    cmd.aRadial = Math.min(Math.max(ctx.gravity + KP * (vTarget - ctx.vRadial), -ctx.maxAccel), ctx.maxAccel);

    // horizontal kill (critically-damped-ish exponential)
    cmd.aHorizX = -ctx.vHorizX / TAU_H;
    cmd.aHorizY = -ctx.vHorizY / TAU_H;
    cmd.aHorizZ = -ctx.vHorizZ / TAU_H;

    cmd.gearDown = this.state === 'FINAL';
    cmd.dust = Math.max(0, 1 - ctx.altAGL / 50) * Math.min(1, cmd.aRadial / Math.max(ctx.gravity, 0.1));
    return cmd;
  }
}
