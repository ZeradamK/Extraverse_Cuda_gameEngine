/**
 * Deterministic procgen primitives (§4.7). FROZEN FOREVER — changing either
 * function invalidates every player's galaxy.
 */

/** mulberry32 — fast seeded PRNG, returns () => [0,1) */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** avalanche-quality u32 combiner: hash(seed, ...ints) → u32 */
export function hash(seed: number, ...ks: number[]): number {
  let h = seed >>> 0;
  for (const k of ks) {
    h = Math.imul(h ^ (k | 0), 2654435761);
    h = ((h << 13) | (h >>> 19)) >>> 0;
    h = Math.imul(h, 2246822519);
    h ^= h >>> 16;
  }
  return h >>> 0;
}
