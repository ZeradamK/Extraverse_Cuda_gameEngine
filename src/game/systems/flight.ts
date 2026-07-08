/**
 * 6DOF ship flight (§9.1): semi-implicit Euler at fixed dt, per-axis thruster
 * authority, Elite/SC-style flight assist (exponential setpoint tracking).
 * No gravity/drag yet (M1 = empty space); those join in M2/M5.
 */
import * as THREE from 'three';
import type { IntentFrame } from '../../engine/core/input';

/** per-axis linear authority, m/s² (body frame; -Z = forward) */
const AUTH = {
  main: 50, // thrust along -Z
  retro: 30,
  lateral: 20,
  vertical: 20,
};
/** angular accel rad/s² and max rates rad/s (§9.1) */
const ANG_AUTH = { pitch: 2.5, yaw: 1.5, roll: 4.0 };
const ANG_MAX = { pitch: THREE.MathUtils.degToRad(60), yaw: THREE.MathUtils.degToRad(45), roll: THREE.MathUtils.degToRad(143) };

const V_MAX_COUPLED = 250; // m/s SCM-style speed cap (coupled)
/** NAV cruise ceiling: 4000 miles/sec (§ user spec) — interplanetary hops without warp */
export const NAV_V_MAX = 4000 * 1609.344; // 6,437,376 m/s ≈ 2.1% c
const NAV_ACCEL = 30_000; // m/s² — inertial-damper fiction; 0→cruise in minutes, not hours
const NAV_TAU = 5;        // s — cruise velocity convergence
const BOOST_MULT = 2.0;
const BOOST_MAX_S = 4.0; // heat-gated
const TAU_LIN = 0.4;
const TAU_ROT = 0.2;

export interface FlightState {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  quat: THREE.Quaternion;
  omega: THREE.Vector3; // body frame
}

export class ShipFlight {
  // simulation state (curr + prev for render interpolation)
  readonly curr: FlightState = {
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    omega: new THREE.Vector3(),
  };
  readonly prev: FlightState = {
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    omega: new THREE.Vector3(),
  };

  flightAssist = true;
  decoupled = false;
  boosting = false;
  /** NAV cruise mode (C): coupled cap lifts to NAV_V_MAX, damped by opts.navCap */
  navMode = false;
  boostHeat = 0; // 0..1, gates boost
  /** last commanded accel (body), for G-meter + engine visuals */
  readonly aCmdBody = new THREE.Vector3();
  visualThrottle = 0.2;

  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();

  step(
    dt: number,
    intent: IntentFrame,
    opts?: {
      steerScale?: number;
      skipTranslation?: boolean;
      externalAccel?: THREE.Vector3;
      /** autoland owns translation: coupled velocity loop off (it would fight the descent law) */
      suppressAssist?: boolean;
      /** distance-slaved NAV ceiling from main (safety near bodies); m/s */
      navCap?: number;
    },
  ): void {
    const steerScale = opts?.steerScale ?? 1;
    const c = this.curr;
    this.prev.pos.copy(c.pos);
    this.prev.vel.copy(c.vel);
    this.prev.quat.copy(c.quat);
    this.prev.omega.copy(c.omega);

    // --- mode toggles ---
    if (intent.pressed.has('ship.flightAssistToggle')) this.flightAssist = !this.flightAssist;
    if (intent.pressed.has('ship.decoupleToggle')) this.decoupled = !this.decoupled;
    if (intent.pressed.has('ship.navToggle')) this.navMode = !this.navMode;

    // --- boost heat gate ---
    const wantBoost = intent.held.has('ship.boost');
    this.boosting = wantBoost && this.boostHeat < 1;
    this.boostHeat = THREE.MathUtils.clamp(
      this.boostHeat + (this.boosting ? dt / BOOST_MAX_S : -dt / (BOOST_MAX_S * 2)),
      0, 1,
    );
    const boost = this.boosting ? BOOST_MULT : 1;

    // --- rotation: stick → target rates, assist converges omega exponentially ---
    const stickPitch = intent.axes['ship.pitch'] ?? 0; // mouse down = +Y reticle = nose down
    const stickYaw = intent.axes['ship.yaw'] ?? 0;
    const stickRoll = intent.axes['ship.roll'] ?? 0;
    const target = this.tmpV.set(
      -stickPitch * ANG_MAX.pitch, // +X body rotation = nose up
      -stickYaw * ANG_MAX.yaw,     // +Y body rotation = nose left
      -stickRoll * ANG_MAX.roll,
    ).multiplyScalar(steerScale);
    const alpha = this.tmpV2.subVectors(target, c.omega).divideScalar(TAU_ROT);
    alpha.x = THREE.MathUtils.clamp(alpha.x, -ANG_AUTH.pitch * boost, ANG_AUTH.pitch * boost);
    alpha.y = THREE.MathUtils.clamp(alpha.y, -ANG_AUTH.yaw * boost, ANG_AUTH.yaw * boost);
    alpha.z = THREE.MathUtils.clamp(alpha.z, -ANG_AUTH.roll * boost, ANG_AUTH.roll * boost);
    c.omega.addScaledVector(alpha, dt);

    // integrate orientation: q̇ = ½ q ⊗ (0, ω_body)
    const w = c.omega;
    this.tmpQ.set(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 1).normalize();
    c.quat.multiply(this.tmpQ).normalize();

    // --- translation (skipped while warp owns it) ---
    if (opts?.skipTranslation) {
      this.aCmdBody.set(0, 0, 0);
      this.visualThrottle += (0.85 - this.visualThrottle) * Math.min(1, 6 * dt);
      return;
    }
    const sx = intent.axes['ship.strafeX'] ?? 0;
    const sy = intent.axes['ship.strafeY'] ?? 0;
    const sz = intent.axes['ship.strafeZ'] ?? 0; // -1 = forward (W)
    const allStop = intent.held.has('ship.allStop');

    this.aCmdBody.set(0, 0, 0);
    if (this.flightAssist && !this.decoupled && !opts?.suppressAssist) {
      // coupled: stick = target velocity (body frame); NAV lifts the ceiling
      const vCap = this.navMode
        ? Math.min(NAV_V_MAX, opts?.navCap ?? NAV_V_MAX)
        : V_MAX_COUPLED * (sz < 0 ? boost : 1);
      const vt = this.tmpV.set(sx, sy, sz).multiplyScalar(vCap);
      if (allStop) vt.set(0, 0, 0);
      const vBody = this.tmpV2.copy(c.vel).applyQuaternion(this.tmpQ.copy(c.quat).invert());
      this.aCmdBody.subVectors(vt, vBody).divideScalar(this.navMode ? NAV_TAU : TAU_LIN);
    } else {
      // decoupled / FA-off: stick = direct thrust
      this.aCmdBody.set(
        sx * AUTH.lateral,
        sy * AUTH.vertical,
        sz < 0 ? sz * AUTH.main * boost : sz * AUTH.retro,
      );
      if (allStop && this.flightAssist) {
        const vBody = this.tmpV2.copy(c.vel).applyQuaternion(this.tmpQ.copy(c.quat).invert());
        this.aCmdBody.subVectors(this.tmpV.set(0, 0, 0), vBody).divideScalar(TAU_LIN);
      }
    }
    // clamp to authority (asymmetric Z: main vs retro; NAV = damper-assisted).
    // Dampers also stay hot ABOVE SCM speeds after NAV exit (spooldown brake) —
    // otherwise braking from cruise on 30 m/s² RCS takes a literal day.
    const dampersHot = (this.navMode || c.vel.lengthSq() > 1000 * 1000) && this.flightAssist && !this.decoupled;
    if (dampersHot) {
      this.aCmdBody.clampScalar(-NAV_ACCEL, NAV_ACCEL);
    } else {
      this.aCmdBody.x = THREE.MathUtils.clamp(this.aCmdBody.x, -AUTH.lateral, AUTH.lateral);
      this.aCmdBody.y = THREE.MathUtils.clamp(this.aCmdBody.y, -AUTH.vertical, AUTH.vertical);
      this.aCmdBody.z = THREE.MathUtils.clamp(this.aCmdBody.z, -AUTH.main * boost, AUTH.retro);
    }

    // semi-implicit Euler: v first, then p (world frame)
    const aWorld = this.tmpV.copy(this.aCmdBody).applyQuaternion(c.quat);
    if (opts?.externalAccel) aWorld.add(opts.externalAccel); // gravity + drag + autoland (§9.3)
    c.vel.addScaledVector(aWorld, dt);
    c.pos.addScaledVector(c.vel, dt);

    // engine visual throttle: forward (−Z body) commanded accel fraction
    const fwd = Math.max(0, -this.aCmdBody.z) / AUTH.main;
    this.visualThrottle += (THREE.MathUtils.clamp(fwd * (this.boosting ? 1.2 : 1) + 0.12, 0, 1) - this.visualThrottle) * Math.min(1, 6 * dt);
  }

  /** current felt acceleration in g (no gravity yet) */
  get gForce(): number {
    return this.aCmdBody.length() / 9.81;
  }

  get speed(): number {
    return this.curr.vel.length();
  }
}
