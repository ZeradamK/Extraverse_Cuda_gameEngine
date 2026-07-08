/**
 * In-system warp (§9.5) — Elite-style distance-slaved speed cap:
 *   v_cap = clamp(min(d_bodySurface, d_target)/t_brake, V_MIN, V_MAX)
 * Stateless cap → automatic slowdown near masses and overshoot-proof arrival.
 * States: IDLE → SPOOL (3 s, must hold alignment) → WARP → drop (auto or manual).
 */
import * as THREE from 'three';
import type { BodyState } from './solSystem';

/** minimal system surface the drive needs (SolSystem or ProcSystem) */
export interface WarpSystem {
  bodies: BodyState[];
  planets: BodyState[];
}
import type { ShipFlight } from './flight';

const T_BRAKE = 5;            // s — Elite's rule is ~7; 5 tightens well climb-out (~90 s Earth→Mars)
const V_MIN = 30_000;         // m/s
const V_MAX = 6e8;            // m/s — 2c at 1/10 scale ≈ a 20c real-scale drive
const SPOOL_S = 3;
const COOLDOWN_S = 5;
const DROP_DIST = 2e5;        // m — safe-drop gate at target (200 km scaled)
const STEER_RATE = 0.15;      // warp steering authority multiplier

export type WarpState = 'IDLE' | 'SPOOL' | 'WARP' | 'COOLDOWN';

export class WarpDrive {
  state: WarpState = 'IDLE';
  target: BodyState | null = null;
  v = 0;                      // current warp speed m/s
  vCap = 0;
  spoolT = 0;
  cooldownT = 0;
  /** 0..1 — drives tunnel VFX/FOV/CA */
  factor = 0;

  private tmp = new THREE.Vector3();

  constructor(private sys: WarpSystem, private flight: ShipFlight) {}

  /** hyperjump swaps the star system (M8) */
  setSystem(s: WarpSystem): void {
    this.sys = s;
    this.target = null;
  }

  cycleTarget(): void {
    // planets + major moons are warp/nav targets
    const targets = this.sys.bodies.filter(b => b.kind !== 'star');
    const i = this.target ? targets.indexOf(this.target) : -1;
    this.target = targets[(i + 1) % targets.length];
  }

  /** distance to target center, m (f64) */
  targetDistance(): number {
    if (!this.target) return Infinity;
    const p = this.flight.curr.pos;
    return Math.hypot(this.target.posM.x - p.x, this.target.posM.y - p.y, this.target.posM.z - p.z);
  }

  /** true when a body blocks the straight path to the target (SC "OBSTRUCTED") */
  get obstructed(): boolean {
    if (!this.target) return false;
    const p = this.flight.curr.pos;
    const tx = this.target.posM.x - p.x;
    const ty = this.target.posM.y - p.y;
    const tz = this.target.posM.z - p.z;
    const len = Math.hypot(tx, ty, tz) || 1;
    for (const b of this.sys.bodies) {
      if (b === this.target || b.kind === 'star') continue;
      // closest approach of the segment ship→target to the body center
      const bx = b.posM.x - p.x, by = b.posM.y - p.y, bz = b.posM.z - p.z;
      const t = Math.max(0, Math.min(len, (bx * tx + by * ty + bz * tz) / len));
      const cx = bx - (tx / len) * t, cy = by - (ty / len) * t, cz = bz - (tz / len) * t;
      if (Math.hypot(cx, cy, cz) < b.radiusM * 2) return true;
    }
    return false;
  }

  requestSpool(): void {
    if (this.state === 'IDLE' && this.target && !this.obstructed) {
      this.state = 'SPOOL';
      this.spoolT = 0;
    } else if (this.state === 'WARP') {
      this.drop(false); // manual drop
    }
  }

  private drop(emergency: boolean): void {
    this.state = 'COOLDOWN';
    this.cooldownT = emergency ? COOLDOWN_S * 2 : COOLDOWN_S;
    // exit velocity: gentle forward drift
    const fwd = this.tmp.set(0, 0, -1).applyQuaternion(this.flight.curr.quat);
    this.flight.curr.vel.copy(fwd.multiplyScalar(emergency ? 350 : 150));
    this.v = 0;
  }

  /** call per fixed tick; returns true while warp OWNS translation */
  step(dt: number): boolean {
    const f = this.flight;
    switch (this.state) {
      case 'IDLE':
        this.factor = Math.max(0, this.factor - dt / 0.6);
        return false;
      case 'COOLDOWN':
        this.cooldownT -= dt;
        this.factor = Math.max(0, this.factor - dt / 0.4);
        if (this.cooldownT <= 0) this.state = 'IDLE';
        return false;
      case 'SPOOL': {
        this.spoolT += dt;
        this.factor = Math.min(0.25, this.factor + dt / (SPOOL_S * 4));
        // auto-align nose to target (§9.5 spool = align + charge); gate entry on < 2°
        const err = this.alignToTarget(dt, 0.35);
        if (this.spoolT >= SPOOL_S && err < THREE.MathUtils.degToRad(2)) {
          this.state = 'WARP';
          this.v = V_MIN;
        }
        return false;
      }
      case 'WARP': {
        if (!this.target) { this.drop(true); return false; }
        const p = f.curr.pos;
        const dTgt = this.targetDistance();
        // nearest body surface distance (excluding target when far)
        let dBody = Infinity;
        for (const b of this.sys.bodies) {
          const dc = Math.hypot(b.posM.x - p.x, b.posM.y - p.y, b.posM.z - p.z);
          // mass-lock: flying INTO a body's exclusion zone = emergency drop
          // (Elite-style — the V_MIN floor would otherwise punch through planets)
          if (b !== this.target && dc < b.radiusM * 1.6) {
            this.drop(true);
            return false;
          }
          const d = dc - b.radiusM * 2;
          if (d < dBody) dBody = d;
        }
        this.vCap = THREE.MathUtils.clamp(Math.min(dBody, dTgt) / T_BRAKE, V_MIN, V_MAX);
        // throttle: full ahead, exponential approach (τ 1.5s accel / 1.2s brake)
        const tau = this.vCap > this.v ? 1.5 : 1.2;
        this.v += (this.vCap - this.v) * (1 - Math.exp(-dt / tau));
        this.factor = THREE.MathUtils.clamp(0.25 + 0.75 * Math.log10(1 + this.v / V_MIN) / 4.3, 0, 1);

        // track-hold: gently re-center the target so drift can't cause a runaway miss
        this.alignToTarget(dt, 2.5);

        // translate along nose (f64); prev was already snapshotted by flight.step
        const fwd = this.tmp.set(0, 0, -1).applyQuaternion(f.curr.quat);
        f.curr.pos.addScaledVector(fwd, this.v * dt);
        f.curr.vel.copy(fwd).multiplyScalar(this.v); // HUD reads warp speed

        // arrival: inside drop gate and speed within brake envelope
        if (dTgt < Math.max(DROP_DIST, this.target.radiusM * 3) && this.v <= dTgt / T_BRAKE * 1.5) {
          this.drop(false);
        }
        return true;
      }
    }
  }

  get steerScale(): number {
    if (this.state === 'WARP') return STEER_RATE;
    if (this.state === 'SPOOL') return 0; // autopilot owns rotation while aligning
    return 1;
  }

  private tmpQ = new THREE.Quaternion();
  private tmpM = new THREE.Matrix4();
  private tmpEye = new THREE.Vector3();
  private tmpTgt = new THREE.Vector3();

  /** slerp nose toward target (τ seconds); returns remaining angle error (rad) */
  private alignToTarget(dt: number, tau: number): number {
    if (!this.target) return Math.PI;
    const f = this.flight;
    this.tmpEye.set(0, 0, 0);
    this.tmpTgt.set(
      this.target.posM.x - f.curr.pos.x,
      this.target.posM.y - f.curr.pos.y,
      this.target.posM.z - f.curr.pos.z,
    );
    this.tmpM.lookAt(this.tmpEye, this.tmpTgt, this.tmp.set(0, 1, 0).applyQuaternion(f.curr.quat));
    this.tmpQ.setFromRotationMatrix(this.tmpM);
    const err = f.curr.quat.angleTo(this.tmpQ);
    f.curr.quat.slerp(this.tmpQ, 1 - Math.exp(-dt / tau));
    f.curr.omega.multiplyScalar(Math.exp(-dt / (tau * 0.5))); // damp residual rates
    return err;
  }
}
