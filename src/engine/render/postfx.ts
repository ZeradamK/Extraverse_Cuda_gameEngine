/**
 * M0 post pipeline (§5.1), composed exactly like the official r185 examples
 * (webgpu_postprocessing_ao + webgpu_postprocessing_bloom_emissive):
 *
 *   prePass  (packed normals + velocity + depth)
 *   scenePass (beauty, MRT: output + emissive)
 *   GTAO  → injected into the lighting context (builtinAOContext)
 *   TRAA  (temporal AA from depth+velocity)
 *   Bloom (from the emissive MRT attachment — inherently selective, no threshold)
 *
 * SSGI/SSR join in a later milestone; tone mapping is AgX on the renderer.
 */
import * as THREE from 'three/webgpu';
import {
  builtinAOContext, mrt, output, emissive, packNormalToRGB, pass, sample,
  screenUV, uniform, unpackRGBToNormal, normalView, vec4, velocity,
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';

export interface PostFX {
  pipeline: THREE.RenderPipeline;
  render(): void;
  /** 0..~1: warp chromatic aberration strength */
  warpCA: { value: number };
}

export function createPostFX(
  renderer: THREE.WebGPURenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): PostFX {
  const pipeline = new THREE.RenderPipeline(renderer);

  // pre-pass: normals (packed to RGB) + velocity; depth comes for free
  const prePass = pass(scene, camera);
  prePass.name = 'Pre-Pass';
  prePass.transparent = false;
  prePass.setMRT(mrt({ output: packNormalToRGB(normalView), velocity }));
  const prePassNormal = sample((uv: any) => unpackRGBToNormal(prePass.getTextureNode().sample(uv)));
  const prePassDepth = prePass.getTextureNode('depth');
  const prePassVelocity = prePass.getTextureNode('velocity');
  prePass.getTexture('output').type = THREE.UnsignedByteType; // bandwidth: packed normals fit 8-bit

  // beauty pass with emissive MRT (kept HalfFloat: emissiveIntensity goes to ~13, must not clip)
  const scenePass = pass(scene, camera);
  scenePass.name = 'Beauty';
  const mrtNode = mrt({ output, emissive: vec4(emissive, output.a) });
  mrtNode.setBlendMode('emissive', new THREE.BlendMode(THREE.NormalBlending));
  scenePass.setMRT(mrtNode);

  // GTAO, half-res + temporal filtering, applied inside the lighting context
  // (?noao bisect flag: the pass mis-darkens planet-scale ground if mistuned)
  const aoPass = ao(prePassDepth, prePassNormal, camera);
  aoPass.resolutionScale = 0.5;
  aoPass.useTemporalFiltering = true;
  if (!(typeof location !== 'undefined' && location.search.includes('noao'))) {
    scenePass.contextNode = builtinAOContext(aoPass.getTextureNode().sample(screenUV).r);
  }

  // temporal AA over the beauty, then add bloom (bloom is smooth — safe after TRAA)
  const traaPass = traa(scenePass, prePassDepth, prePassVelocity, camera);
  const bloomPass = bloom(scenePass.getTextureNode('emissive'), 0.8, 0.3);

  // warp-driven chromatic aberration over the final composite.
  // NOTE: center must be explicit — the helper's `center = null` default crashes
  // the node build despite docs claiming it means screen center (r185 bug).
  const warpCA = uniform(0.0);
  pipeline.outputNode = chromaticAberration(
    traaPass.add(bloomPass), warpCA, uniform(new THREE.Vector2(0.5, 0.5)), uniform(1.06),
  );

  return { pipeline, render: () => void pipeline.render(), warpCA };
}
