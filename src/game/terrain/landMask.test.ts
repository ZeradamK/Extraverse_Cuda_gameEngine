import { describe, expect, it } from 'vitest';
import { equirectUV, isWaterPixel, sampleMask, type LandMask } from './landMask';
import { createHeightField } from './heightfield';

describe('equirectUV', () => {
  it('poles map to v = 0 / 1', () => {
    expect(equirectUV({ x: 0, y: 1, z: 0 })[1]).toBeCloseTo(0, 6);
    expect(equirectUV({ x: 0, y: -1, z: 0 })[1]).toBeCloseTo(1, 6);
  });
  it('equator maps to v = 0.5 and u covers the full range', () => {
    const [u1, v1] = equirectUV({ x: -1, y: 0, z: 0 });
    expect(v1).toBeCloseTo(0.5, 6);
    expect(u1).toBeCloseTo(0.5, 6); // lon 0 at −x (three SphereGeometry seam convention)
    const [u2] = equirectUV({ x: 1, y: 0, z: 0 });
    expect(Math.abs(u2 - 0.5)).toBeCloseTo(0.5, 6); // antipode → u 0 or 1
  });
});

describe('sampleMask', () => {
  // 4×2 checkerboard-ish mask
  const mask: LandMask = { data: new Uint8Array([0, 255, 0, 255, 255, 0, 255, 0]), w: 4, h: 2 };
  it('bilinear interpolates between texels', () => {
    expect(sampleMask(mask, 0, 0)).toBe(0);
    const mid = sampleMask(mask, 1 / 6, 0); // halfway texel 0→1 on row 0
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
  });
  it('wraps longitude', () => {
    expect(sampleMask(mask, 1.25, 0)).toBeCloseTo(sampleMask(mask, 0.25, 0), 6);
  });
});

describe('isWaterPixel (Blue Marble heuristic)', () => {
  it('deep ocean blue → water', () => {
    expect(isWaterPixel(8, 20, 60)).toBe(true);
  });
  it('desert tan / forest green / ice white → land', () => {
    expect(isWaterPixel(180, 150, 110)).toBe(false);
    expect(isWaterPixel(60, 90, 40)).toBe(false);
    expect(isWaterPixel(230, 235, 240)).toBe(false);
  });
});

describe('earth heightfield with a synthetic mask', () => {
  // left hemisphere land, right hemisphere ocean
  const w = 64, h = 32;
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = x < w / 2 ? 255 : 0;
  const mask: LandMask = { data, w, h };
  const hf = createHeightField('earth', 42, mask);

  it('land rises above datum, ocean floor dips below', () => {
    // u < 0.5 → land: lon in (−π, 0) → x-ish positive... probe via known dirs:
    const landDir = { x: Math.cos(Math.PI * 0.5), y: 0, z: -Math.sin(Math.PI * 0.5) }; // u=0.25
    const oceanDir = { x: Math.cos(Math.PI * 0.5), y: 0, z: Math.sin(Math.PI * 0.5) }; // u=0.75
    expect(hf.height(landDir)).toBeGreaterThan(0);
    expect(hf.height(oceanDir)).toBeLessThan(-300);
  });
  it('is deterministic', () => {
    const hf2 = createHeightField('earth', 42, mask);
    const d = { x: 0.3, y: 0.5, z: -0.81 };
    const l = Math.hypot(d.x, d.y, d.z);
    const dir = { x: d.x / l, y: d.y / l, z: d.z / l };
    expect(hf.height(dir)).toBe(hf2.height(dir));
  });
});
