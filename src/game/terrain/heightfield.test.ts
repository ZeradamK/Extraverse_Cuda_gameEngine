import { describe, expect, it } from 'vitest';
import { createHeightField, type Vec3 } from './heightfield';

function dirOf(x: number, y: number, z: number): Vec3 {
  const l = Math.hypot(x, y, z);
  return { x: x / l, y: y / l, z: z / l };
}

// deterministic sample directions spread over the sphere
function sampleDirs(n: number): Vec3[] {
  const dirs: Vec3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * i) / (n - 1);
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = golden * i;
    dirs.push(dirOf(Math.cos(th) * r, y, Math.sin(th) * r));
  }
  return dirs;
}

describe('createHeightField', () => {
  it('is deterministic: same seed + direction → identical height', () => {
    const a = createHeightField('luna', 20260706);
    const b = createHeightField('luna', 20260706);
    for (const d of sampleDirs(200)) {
      expect(a.height(d)).toBe(b.height(d));
    }
  });

  it('different seeds diverge', () => {
    const a = createHeightField('luna', 1);
    const b = createHeightField('luna', 2);
    let diff = 0;
    for (const d of sampleDirs(100)) {
      if (Math.abs(a.height(d) - b.height(d)) > 1) diff++;
    }
    expect(diff).toBeGreaterThan(80);
  });

  it('luna heights stay within the advertised amplitude envelope', () => {
    const hf = createHeightField('luna', 20260706);
    for (const d of sampleDirs(2000)) {
      const h = hf.height(d);
      expect(Math.abs(h)).toBeLessThan(hf.maxAmp);
      expect(Number.isFinite(h)).toBe(true);
    }
  });

  it('mars heights bounded and finite', () => {
    const hf = createHeightField('mars', 19570104);
    for (const d of sampleDirs(1000)) {
      const h = hf.height(d);
      expect(Math.abs(h)).toBeLessThan(hf.maxAmp);
      expect(Number.isFinite(h)).toBe(true);
    }
  });

  it('has actual relief (not flat) and craters carve below the mean', () => {
    const hf = createHeightField('luna', 20260706);
    const hs = sampleDirs(2000).map(d => hf.height(d));
    const mean = hs.reduce((s, h) => s + h, 0) / hs.length;
    const spread = Math.sqrt(hs.reduce((s, h) => s + (h - mean) ** 2, 0) / hs.length);
    expect(spread).toBeGreaterThan(30);        // meaningful relief
    expect(Math.min(...hs)).toBeLessThan(mean - 50); // depressions exist
    expect(Math.max(...hs)).toBeGreaterThan(mean + 50); // rims/hills exist
  });

  it('is continuous (no cliffs between adjacent samples)', () => {
    const hf = createHeightField('luna', 20260706);
    // walk a tight arc; adjacent samples ~11 m apart on scaled Luna (R≈174 km)
    const eps = 1 / 16000;
    let prev = hf.height(dirOf(1, 0, 0));
    for (let i = 1; i <= 300; i++) {
      const h = hf.height(dirOf(1, i * eps, 0));
      expect(Math.abs(h - prev)).toBeLessThan(60); // < 60 m step between samples
      prev = h;
    }
  });
});
