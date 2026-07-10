/**
 * Real-Earth global DEM (S1): equirectangular Int16 height grid in REAL meters
 * (positive = land above sea level, negative = bathymetry), sampled bilinearly
 * by unit direction — same lon/lat convention as landMask (row 0 = north pole).
 * Shipped asset is baked from NOAA ETOPO 2022 (public domain, DOI
 * 10.25921/fd45-gt74) — see LICENSES.md. Pure functions; worker + Node safe.
 */
import type { Vec3 } from './heightfield';

export interface DemGrid {
  data: Int16Array;
  w: number;
  h: number;
}

/** bilinear sample in real meters for a unit direction from planet center */
export function demAtDir(dem: DemGrid, dir: Vec3): number {
  const lon = Math.atan2(dir.z, -dir.x); // matches landMask/three sphere mapping
  const lat = Math.asin(Math.max(-1, Math.min(1, dir.y)));
  const u = lon / (2 * Math.PI) + 0.5;
  const v = 0.5 - lat / Math.PI; // 0 = north pole (image top)
  const x = ((u % 1) + 1) % 1 * dem.w;
  const y = Math.max(0, Math.min(1, v)) * (dem.h - 1);
  const x0 = Math.floor(x) % dem.w, y0 = Math.floor(y);
  const x1 = (x0 + 1) % dem.w; // wrap the antimeridian
  const y1 = Math.min(dem.h - 1, y0 + 1);
  const fx = x - Math.floor(x), fy = y - y0;
  const at = (xx: number, yy: number) => dem.data[yy * dem.w + xx];
  return (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) +
         (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
}

/** decode a raw little-endian Int16 buffer (already un-gzipped) into a grid */
export function parseDem(buf: ArrayBuffer, w: number, h: number): DemGrid {
  const data = new Int16Array(buf);
  if (data.length !== w * h) throw new Error(`DEM size mismatch: ${data.length} ≠ ${w}×${h}`);
  return { data, w, h };
}

/**
 * browser/Node loader for a .bin.gz. Adaptive: some servers (vite/sirv) send
 * Content-Encoding: gzip for .gz files so the body arrives ALREADY inflated;
 * others hand over raw gzip bytes. Sniff the magic (1f 8b) and act accordingly.
 */
export async function loadDemGrid(url: string, w: number, h: number): Promise<DemGrid> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`DEM fetch failed: ${res.status} ${url}`);
  const buf = await res.arrayBuffer();
  const head = new Uint8Array(buf, 0, 2);
  if (head[0] === 0x1f && head[1] === 0x8b) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return parseDem(await new Response(stream).arrayBuffer(), w, h);
  }
  return parseDem(buf, w, h);
}
