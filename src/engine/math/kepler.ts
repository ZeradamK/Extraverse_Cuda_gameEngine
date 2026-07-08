/**
 * Kepler propagation (§9.2) — JPL "Approximate Positions" algorithm.
 * All math in f64 (plain JS numbers). Returns heliocentric ecliptic meters.
 * World mapping: three.x = ecl.x, three.y = ecl.z (north), three.z = −ecl.y.
 */

export interface JplElements {
  a: number; e: number; I: number; L: number; varpi: number; Omega: number;
  aDot: number; eDot: number; IDot: number; LDot: number; varpiDot: number; OmegaDot: number;
}

export interface Vec3d { x: number; y: number; z: number }

const AU_M = 1.495978707e11;
const DEG = Math.PI / 180;

/** Newton–Raphson for M = E − e·sinE (M rad, normalized) */
export function solveKepler(M: number, e: number): number {
  // normalize M to [-π, π]
  M = M % (2 * Math.PI);
  if (M > Math.PI) M -= 2 * Math.PI;
  if (M < -Math.PI) M += 2 * Math.PI;
  let E = e < 0.8 ? M : Math.PI * Math.sign(M || 1);
  for (let i = 0; i < 30; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

/**
 * Position at time T (Julian centuries since J2000.0) from JPL Table-1 elements.
 * Output: heliocentric, ecliptic-plane world coords (three.js y-up), METERS (real scale).
 */
export function jplPosition(el: JplElements, T: number, out: Vec3d): Vec3d {
  const a = (el.a + el.aDot * T) * AU_M;
  const e = el.e + el.eDot * T;
  const I = (el.I + el.IDot * T) * DEG;
  const L = (el.L + el.LDot * T) * DEG;
  const varpi = (el.varpi + el.varpiDot * T) * DEG;
  const Omega = (el.Omega + el.OmegaDot * T) * DEG;

  const omega = varpi - Omega; // argument of perihelion
  const M = L - varpi;         // mean anomaly
  const E = solveKepler(M, e);

  // perifocal coordinates
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E);

  const cw = Math.cos(omega), sw = Math.sin(omega);
  const cO = Math.cos(Omega), sO = Math.sin(Omega);
  const ci = Math.cos(I), si = Math.sin(I);

  // ecliptic frame (JPL: x toward equinox, z north)
  const xe = (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp;
  const ye = (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp;
  const ze = (sw * si) * xp + (cw * si) * yp;

  out.x = xe;
  out.y = ze;
  out.z = -ye;
  return out;
}

/** circular-orbit helper for moons: a (m), period (s), phase (rad), inclination (rad) around parent */
export function circularOrbit(a: number, periodS: number, phase0: number, incl: number, tS: number, out: Vec3d): Vec3d {
  const th = phase0 + (2 * Math.PI * tS) / periodS;
  const x = a * Math.cos(th);
  const z = -a * Math.sin(th);
  out.x = x;
  out.y = Math.sin(incl) * z * 0.5; // gentle tilt (visual)
  out.z = Math.cos(incl) * z;
  return out;
}

/** Julian centuries since J2000 for a JS epoch-ms timestamp */
export function julianCenturies(epochMs: number): number {
  const jd = epochMs / 86_400_000 + 2440587.5;
  return (jd - 2451545.0) / 36525;
}
