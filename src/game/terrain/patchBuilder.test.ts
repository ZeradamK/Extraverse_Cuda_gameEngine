import { describe, expect, it } from 'vitest';
import { buildPatch, type PatchRequest } from './patchBuilder';

const RES = 33;
const R = 173_740; // scaled Luna radius

function req(o: Partial<PatchRequest>): PatchRequest {
  return { id: 1, kind: 'luna', seed: 20260706, radiusM: R, face: 0, level: 8, ix: 10, iy: 10, ...o };
}

/** absolute (planet-centered) position of grid vertex (i, j) */
function absVert(p: ReturnType<typeof buildPatch>, i: number, j: number): [number, number, number] {
  const k = (j * RES + i) * 3;
  return [
    p.positions[k] + p.origin[0],
    p.positions[k + 1] + p.origin[1],
    p.positions[k + 2] + p.origin[2],
  ];
}

describe('buildPatch geometry', () => {
  it('grid vertices lie near the datum sphere (radius ± maxAmp)', () => {
    const p = buildPatch(req({}));
    for (let j = 0; j < RES; j += 8) {
      for (let i = 0; i < RES; i += 8) {
        const [x, y, z] = absVert(p, i, j);
        const r = Math.hypot(x, y, z);
        expect(r).toBeGreaterThan(R - 2000);
        expect(r).toBeLessThan(R + 2000);
      }
    }
  });

  it('normals are unit-length and point outward', () => {
    const p = buildPatch(req({}));
    for (let j = 0; j < RES; j += 4) {
      for (let i = 0; i < RES; i += 4) {
        const k = (j * RES + i) * 3;
        const nl = Math.hypot(p.normals[k], p.normals[k + 1], p.normals[k + 2]);
        expect(nl).toBeCloseTo(1, 3);
        const [x, y, z] = absVert(p, i, j);
        const dot = (p.normals[k] * x + p.normals[k + 1] * y + p.normals[k + 2] * z) / Math.hypot(x, y, z);
        expect(dot).toBeGreaterThan(0.3);
      }
    }
  });

  it('TRIANGLES WIND CCW SEEN FROM OUTSIDE (inside-out planet regression)', () => {
    // 2026-07-08: winding was inverted on every face/level — front-face culling
    // removed the near ground and all planets rendered their dark far-side
    // interior. Face normals from winding must point OUTWARD (dot radial > 0).
    for (const face of [0, 1, 2, 3, 4, 5]) {
      for (const level of [0, 5, 9]) {
        const n = 1 << level;
        const p = buildPatch(req({ face, level, ix: n >> 1, iy: n >> 1 }));
        const P = p.positions, I = p.indices;
        const mainTris = (RES - 1) * (RES - 1) * 2;
        for (let t = 0; t < mainTris; t += 7) {
          const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
          const abx = P[b] - P[a], aby = P[b + 1] - P[a + 1], abz = P[b + 2] - P[a + 2];
          const acx = P[c] - P[a], acy = P[c + 1] - P[a + 1], acz = P[c + 2] - P[a + 2];
          const nx = aby * acz - abz * acy;
          const ny = abz * acx - abx * acz;
          const nz = abx * acy - aby * acx;
          const rx = P[a] + p.origin[0], ry = P[a + 1] + p.origin[1], rz = P[a + 2] + p.origin[2];
          expect(nx * rx + ny * ry + nz * rz, `face ${face} level ${level} tri ${t}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('ADJACENT SAME-LEVEL PATCHES SHARE BORDER VERTICES EXACTLY (crack regression)', () => {
    const a = buildPatch(req({ ix: 10, iy: 10 }));
    const b = buildPatch(req({ ix: 11, iy: 10 })); // right neighbor
    for (let j = 0; j < RES; j++) {
      const [ax, ay, az] = absVert(a, RES - 1, j); // a's right edge
      const [bx, by, bz] = absVert(b, 0, j);       // b's left edge
      const gap = Math.hypot(ax - bx, ay - by, az - bz);
      expect(gap, `row ${j}: gap ${gap.toFixed(3)} m`).toBeLessThan(0.01);
    }
  });

  it('parent border matches children corners (LOD T-junction sanity)', () => {
    const parent = buildPatch(req({ level: 8, ix: 10, iy: 10 }));
    const child = buildPatch(req({ level: 9, ix: 20, iy: 20 })); // lower-left child
    // parent (0,0) corner == child (0,0) corner
    const [px, py, pz] = absVert(parent, 0, 0);
    const [cx, cy, cz] = absVert(child, 0, 0);
    expect(Math.hypot(px - cx, py - cy, pz - cz)).toBeLessThan(0.01);
  });

  it('skirt vertices sit strictly below their border source', () => {
    const p = buildPatch(req({}));
    const skirtStart = RES * RES;
    // first border vertex is grid (0,0); first skirt vertex copies it
    const [bx, by, bz] = absVert(p, 0, 0);
    const kk = skirtStart * 3;
    const sx = p.positions[kk] + p.origin[0];
    const sy = p.positions[kk + 1] + p.origin[1];
    const sz = p.positions[kk + 2] + p.origin[2];
    expect(Math.hypot(sx, sy, sz)).toBeLessThan(Math.hypot(bx, by, bz) - 1);
  });

  it('deterministic: same request → identical buffers', () => {
    const a = buildPatch(req({}));
    const b = buildPatch(req({}));
    expect(a.positions).toEqual(b.positions);
    expect(a.origin).toEqual(b.origin);
  });
});
