import { describe, expect, it } from 'vitest';
import { hash, mulberry32 } from './rng';

describe('mulberry32 (FROZEN — galaxy determinism depends on it)', () => {
  it('is deterministic per seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });
  it('produces [0,1) with a healthy spread', () => {
    const r = mulberry32(42);
    let min = 1, max = 0, sum = 0;
    for (let i = 0; i < 10_000; i++) {
      const v = r();
      min = Math.min(min, v);
      max = Math.max(max, v);
      sum += v;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(min).toBeLessThan(0.01);
    expect(max).toBeGreaterThan(0.99);
    expect(sum / 10_000).toBeGreaterThan(0.47);
    expect(sum / 10_000).toBeLessThan(0.53);
  });
  it('golden values are frozen (regression pin — REAL literals)', () => {
    const r = mulberry32(20260706);
    // hard literals: if these ever change, every saved galaxy breaks
    expect(r()).toBeCloseTo(0.6981992106884718, 15);
    expect(r()).toBeCloseTo(0.43607783946208656, 15);
    expect(r()).toBeCloseTo(0.4254737156443298, 15);
  });
});

describe('hash', () => {
  it('is deterministic and order-sensitive', () => {
    expect(hash(1, 2, 3)).toBe(hash(1, 2, 3));
    expect(hash(1, 2, 3)).not.toBe(hash(1, 3, 2));
    expect(hash(1, 2, 3)).not.toBe(hash(2, 2, 3));
  });
  it('avalanches on small input changes (no obvious collisions)', () => {
    const seen = new Set<number>();
    for (let x = -50; x <= 50; x++) {
      for (let y = -5; y <= 5; y++) {
        seen.add(hash(7, x, y));
      }
    }
    expect(seen.size).toBe(101 * 11); // all distinct
  });
});
