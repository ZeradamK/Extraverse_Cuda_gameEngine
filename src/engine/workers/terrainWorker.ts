/**
 * Terrain worker: thin shell around the pure patch builder (§8.2 CPU path).
 * Accepts optional one-time init messages: land mask (Earth continents,
 * procedural fallback) and real-Earth DEM grid (S1 — ETOPO real meters).
 */
import { buildPatch, type PatchRequest, type PatchResult } from '../../game/terrain/patchBuilder';
import type { LandMask } from '../../game/terrain/landMask';
import type { DemGrid } from '../../game/terrain/demGrid';

export type { PatchRequest, PatchResult };

export interface MaskInit {
  type: 'mask';
  data: Uint8Array;
  w: number;
  h: number;
}

export interface DemInit {
  type: 'dem';
  data: Int16Array;
  w: number;
  h: number;
}

let mask: LandMask | undefined;
let dem: DemGrid | undefined;

self.onmessage = (e: MessageEvent<PatchRequest | MaskInit | DemInit>) => {
  const t = (e.data as MaskInit | DemInit).type;
  if (t === 'mask') {
    const m = e.data as MaskInit;
    mask = { data: m.data, w: m.w, h: m.h };
    return;
  }
  if (t === 'dem') {
    const d = e.data as DemInit;
    dem = { data: d.data, w: d.w, h: d.h };
    return;
  }
  const res = buildPatch(e.data as PatchRequest, mask, dem);
  (self as unknown as Worker).postMessage(res, [res.positions.buffer, res.normals.buffer, res.indices.buffer]);
};
