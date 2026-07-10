import { describe, expect, it } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { demAtDir, parseDem, type DemGrid } from './demGrid';
import type { Vec3 } from './heightfield';

/** unit direction from geographic lat/lon (deg) matching the engine's
 *  equirect convention: lon = atan2(z, −x), u = lon/2π + 0.5 */
function dirFrom(latDeg: number, lonDeg: number): Vec3 {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  return { x: -Math.cos(lat) * Math.cos(lon), y: Math.sin(lat), z: Math.cos(lat) * Math.sin(lon) };
}

describe('demGrid — bilinear equirect sampling', () => {
  //  grid 4×2: row 0 (north) = [0, 100, 200, 300], row 1 (south) = [1000, ...]
  const dem: DemGrid = { data: new Int16Array([0, 100, 200, 300, 1000, 1100, 1200, 1300]), w: 4, h: 2 };

  it('samples the north row at the pole and interpolates by longitude', () => {
    // at lat=+90, v=0 → row 0; u wraps by longitude
    const north = demAtDir(dem, { x: 0, y: 1, z: 0 });
    expect(north).toBeGreaterThanOrEqual(0);
    expect(north).toBeLessThanOrEqual(300);
  });

  it('interpolates between rows at the equator', () => {
    const h = demAtDir(dem, dirFrom(0, -180 + 0.01)); // near col 0, mid rows
    expect(h).toBeGreaterThan(400); // between 0 (north) and 1000 (south) rows
    expect(h).toBeLessThan(600);
  });

  it('wraps the antimeridian without a seam', () => {
    const west = demAtDir(dem, dirFrom(45, -179.9));
    const east = demAtDir(dem, dirFrom(45, 179.9));
    expect(Math.abs(west - east)).toBeLessThan(160); // adjacent columns, no jump across the seam
  });

  it('parseDem rejects mismatched dimensions', () => {
    expect(() => parseDem(new Int16Array(7).buffer, 4, 2)).toThrow();
  });
});

describe('demGrid — REAL EARTH asset (ETOPO 2022 bake, public/data)', () => {
  const raw = gunzipSync(readFileSync('public/data/earth_dem_8192x4096_i16.bin.gz'));
  const dem = parseDem(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer, 8192, 4096);

  it('Himalaya (28.0N, 86.9E) is high mountain terrain', () => {
    expect(demAtDir(dem, dirFrom(28.0, 86.9))).toBeGreaterThan(5000);
  });

  it('Mariana Trench (11.35N, 142.2E) is deep ocean', () => {
    expect(demAtDir(dem, dirFrom(11.35, 142.2))).toBeLessThan(-8000);
  });

  it('Kansas (38.5N, 98.5W) is plains', () => {
    const h = demAtDir(dem, dirFrom(38.5, -98.5));
    expect(h).toBeGreaterThan(200);
    expect(h).toBeLessThan(900);
  });

  it('Atlantic (0N, 25W) is sea floor; Lake Victoria region (1S, 33E) is land', () => {
    expect(demAtDir(dem, dirFrom(0, -25))).toBeLessThan(-1500);
    expect(demAtDir(dem, dirFrom(-1, 33))).toBeGreaterThan(500); // African plateau
  });

  it('sea level dominates: majority of samples on a lat ring over oceans are ≤ 0', () => {
    let below = 0, n = 0;
    for (let lon = -180; lon < 180; lon += 2) {
      if (demAtDir(dem, dirFrom(-55, lon)) <= 0) below++; // Southern Ocean ring
      n++;
    }
    expect(below / n).toBeGreaterThan(0.9);
  });
});
