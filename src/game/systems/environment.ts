/**
 * Environmental physics (§9.3) — pure, unit-tested.
 * Gravity uses μ_eff = μ_real × MU_SCALE so REAL surface gravity holds at 1/10 radii (§7).
 */
import type { AtmoDef } from '../../data/solarSystem';

/** km³/s² → m³/s², then ×0.01 to preserve g_surface = μ/R² at R×0.1 */
export const MU_SCALE = 1e9 * 0.01;

/** kg/m³ below which space begins (reproduces the real Kármán line for Earth) */
export const SPACE_RHO = 1e-5;

export function density(atmo: AtmoDef, altM: number): number {
  if (altM >= atmo.topM) return 0;
  return atmo.rho0 * Math.exp(-Math.max(altM, 0) / atmo.H);
}

/** altitude where space begins: ρ < 1e-5 kg/m³ (Earth → 99.6 km with real H) */
export function spaceAltitude(atmo: AtmoDef): number {
  return atmo.H * Math.log(atmo.rho0 / SPACE_RHO);
}

/** gravitational acceleration magnitude at scaled radius r (m) for gmKm3S2 (real) */
export function gravityAccel(gmKm3S2: number, rM: number): number {
  return (gmKm3S2 * MU_SCALE) / (rM * rM);
}

/** drag deceleration, m/s² */
export function dragAccel(rho: number, speed: number, cdA: number, massKg: number): number {
  return (0.5 * rho * speed * speed * cdA) / massKg;
}

export function dynamicPressure(rho: number, speed: number): number {
  return 0.5 * rho * speed * speed;
}

/** Sutton–Graves stagnation heat flux, W/m² (Rn = nose radius, m) */
export function suttonGraves(rho: number, speed: number, noseRadiusM = 1): number {
  return 1.7415e-4 * Math.sqrt(rho / noseRadiusM) * speed ** 3;
}

/** plasma VFX thresholds (§9.3) */
export const PLASMA_START_W_M2 = 40_000;  // glow begins (tuned for thin Mars air drama)
export const PLASMA_FULL_W_M2 = 900_000;  // full streamers

/** ground velocity Ω × r about a body's tilted spin axis (axis = Rx(tilt)·ŷ) */
export function surfaceVelocity(
  tiltRad: number, rotationHoursAbs: number,
  rx: number, ry: number, rz: number,
  out: { x: number; y: number; z: number },
): void {
  const w = (2 * Math.PI) / (rotationHoursAbs * 3600);
  const ay = Math.cos(tiltRad) * w;
  const az = Math.sin(tiltRad) * w;
  out.x = ay * rz - az * ry;
  out.y = az * rx;
  out.z = -ay * rx;
}
