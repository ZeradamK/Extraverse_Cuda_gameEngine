/**
 * Pure terrain patch mesh builder — extracted from the worker so it is
 * unit-testable (border continuity, skirt geometry, normals). The worker is a
 * thin postMessage shell around buildPatch().
 */
import { createHeightField, type PlanetKind } from './heightfield';
import type { LandMask } from './landMask';
import type { DemGrid } from './demGrid';

export interface PatchRequest {
  id: number;
  kind: PlanetKind;
  seed: number;
  radiusM: number;        // scaled planet radius
  face: number;           // 0..5
  level: number;
  ix: number;             // node coords within face at this level
  iy: number;
}

export interface PatchResult {
  id: number;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  origin: [number, number, number]; // patch origin relative to planet center (m)
}

const RES = 33; // vertices per edge (32 quads)

/** cube face → world direction. faces: ±X, ±Y, ±Z */
function faceDir(face: number, u: number, v: number): [number, number, number] {
  // u,v in [-1, 1]
  switch (face) {
    case 0: return [1, v, -u];
    case 1: return [-1, v, u];
    case 2: return [u, 1, -v];
    case 3: return [u, -1, v];
    case 4: return [u, v, 1];
    case 5: return [-u, v, -1];
    default: throw new Error('bad face');
  }
}

/** COBE-ish tangent adjustment for more uniform cells */
function warp(t: number): number {
  return Math.tan(t * (Math.PI / 4)) / Math.tan(Math.PI / 4);
}

export function buildPatch(req: PatchRequest, mask?: LandMask, dem?: DemGrid): PatchResult {
  const { radiusM, face, level, ix, iy } = req;
  const hf = createHeightField(req.kind, req.seed, mask, dem);
  const n = 1 << level;
  const size = 2 / n; // face-uv span of this node
  const u0 = -1 + ix * size;
  const v0 = -1 + iy * size;

  const dir = { x: 0, y: 0, z: 0 };
  const setDir = (u: number, v: number) => {
    const [dx, dy, dz] = faceDir(face, warp(u), warp(v));
    const l = Math.hypot(dx, dy, dz);
    dir.x = dx / l; dir.y = dy / l; dir.z = dz / l;
  };

  // patch origin: sphere point at patch center (datum radius — no height)
  setDir(u0 + size / 2, v0 + size / 2);
  const ox = dir.x * radiusM, oy = dir.y * radiusM, oz = dir.z * radiusM;

  const grid = RES;
  const skirtVerts = grid * 4;
  const vertCount = grid * grid + skirtVerts;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);

  // main grid
  const pos = (i: number, j: number) => (j * grid + i) * 3;
  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      setDir(u0 + (i / (grid - 1)) * size, v0 + (j / (grid - 1)) * size);
      const h = hf.height(dir);
      const r = radiusM + h;
      const k = pos(i, j);
      positions[k] = dir.x * r - ox;
      positions[k + 1] = dir.y * r - oy;
      positions[k + 2] = dir.z * r - oz;
    }
  }

  // normals via grid central differences (one-sided at edges)
  const p = (i: number, j: number, o: number) => positions[pos(Math.max(0, Math.min(grid - 1, i)), Math.max(0, Math.min(grid - 1, j))) + o];
  for (let j = 0; j < grid; j++) {
    for (let i = 0; i < grid; i++) {
      const ax = p(i + 1, j, 0) - p(i - 1, j, 0);
      const ay = p(i + 1, j, 1) - p(i - 1, j, 1);
      const az = p(i + 1, j, 2) - p(i - 1, j, 2);
      const bx = p(i, j + 1, 0) - p(i, j - 1, 0);
      const by = p(i, j + 1, 1) - p(i, j - 1, 1);
      const bz = p(i, j + 1, 2) - p(i, j - 1, 2);
      let nx = ay * bz - az * by;
      let ny = az * bx - ax * bz;
      let nz = ax * by - ay * bx;
      const l = Math.hypot(nx, ny, nz) || 1;
      const k = pos(i, j);
      // orient outward (dot with radial direction > 0)
      const rx = positions[k] + ox, ry = positions[k + 1] + oy, rz = positions[k + 2] + oz;
      const s = nx * rx + ny * ry + nz * rz > 0 ? 1 : -1;
      normals[k] = (nx / l) * s;
      normals[k + 1] = (ny / l) * s;
      normals[k + 2] = (nz / l) * s;
    }
  }

  // skirts: copy each border vertex, push down radially by 2.5% of patch arc —
  // enough for T-junction height error at LOD transitions without reading as walls
  const skirtDepth = radiusM * (Math.PI / 2) * size * 0.025;
  let sv = grid * grid;
  const skirtIndexOf = new Map<number, number>(); // borderVertIdx → skirt vert idx
  const border: number[] = [];
  for (let i = 0; i < grid; i++) border.push(i);                            // bottom j=0
  for (let j = 1; j < grid; j++) border.push(j * grid + (grid - 1));        // right
  for (let i = grid - 2; i >= 0; i--) border.push((grid - 1) * grid + i);   // top
  for (let j = grid - 2; j >= 1; j--) border.push(j * grid);                // left
  for (const b of border) {
    const k = b * 3;
    const rx = positions[k] + ox, ry = positions[k + 1] + oy, rz = positions[k + 2] + oz;
    const rl = Math.hypot(rx, ry, rz);
    const kk = sv * 3;
    positions[kk] = positions[k] - (rx / rl) * skirtDepth;
    positions[kk + 1] = positions[k + 1] - (ry / rl) * skirtDepth;
    positions[kk + 2] = positions[k + 2] - (rz / rl) * skirtDepth;
    normals[kk] = normals[k];
    normals[kk + 1] = normals[k + 1];
    normals[kk + 2] = normals[k + 2];
    skirtIndexOf.set(b, sv);
    sv++;
  }

  // indices: grid quads + skirt ring
  const quadCount = (grid - 1) * (grid - 1);
  const skirtQuads = border.length; // ring
  const indices = new Uint32Array((quadCount + skirtQuads) * 6);
  // audit fix (2026-07-08): winding must be CCW seen from OUTSIDE the planet —
  // it was inverted, so front-face culling removed the near ground everywhere
  // and every planet rendered its dark far-side interior ("black moon" bug)
  let q = 0;
  for (let j = 0; j < grid - 1; j++) {
    for (let i = 0; i < grid - 1; i++) {
      const a = j * grid + i, b = a + 1, c = a + grid, d = c + 1;
      indices[q++] = a; indices[q++] = b; indices[q++] = c;
      indices[q++] = b; indices[q++] = d; indices[q++] = c;
    }
  }
  for (let e = 0; e < border.length; e++) {
    const b0 = border[e];
    const b1 = border[(e + 1) % border.length];
    const s0 = skirtIndexOf.get(b0)!;
    const s1 = skirtIndexOf.get(b1)!;
    indices[q++] = b0; indices[q++] = b1; indices[q++] = s0;
    indices[q++] = b1; indices[q++] = s1; indices[q++] = s0;
  }

  return { id: req.id, positions, normals, indices, origin: [ox, oy, oz] };
}

