/**
 * Terrain worker: thin shell around the pure patch builder (§8.2 CPU path).
 * Accepts an optional one-time land-mask init message (Earth continents).
 */
import { buildPatch, type PatchRequest, type PatchResult } from '../../game/terrain/patchBuilder';
import type { LandMask } from '../../game/terrain/landMask';

export type { PatchRequest, PatchResult };

export interface MaskInit {
  type: 'mask';
  data: Uint8Array;
  w: number;
  h: number;
}

let mask: LandMask | undefined;

self.onmessage = (e: MessageEvent<PatchRequest | MaskInit>) => {
  if ((e.data as MaskInit).type === 'mask') {
    const m = e.data as MaskInit;
    mask = { data: m.data, w: m.w, h: m.h };
    return;
  }
  const res = buildPatch(e.data as PatchRequest, mask);
  (self as unknown as Worker).postMessage(res, [res.positions.buffer, res.normals.buffer, res.indices.buffer]);
};
