/**
 * Terrain worker: thin shell around the pure patch builder (§8.2 CPU path).
 */
import { buildPatch, type PatchRequest, type PatchResult } from '../../game/terrain/patchBuilder';

export type { PatchRequest, PatchResult };

self.onmessage = (e: MessageEvent<PatchRequest>) => {
  const res = buildPatch(e.data);
  (self as unknown as Worker).postMessage(res, [res.positions.buffer, res.normals.buffer, res.indices.buffer]);
};
