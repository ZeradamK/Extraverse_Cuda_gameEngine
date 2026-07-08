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
  screenUV, unpackRGBToNormal, normalView, vec4, velocity,
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

export interface PostFX {
  pipeline: THREE.RenderPipeline;
  render(): void;
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
  const aoPass = ao(prePassDepth, prePassNormal, camera);
  aoPass.resolutionScale = 0.5;
  aoPass.useTemporalFiltering = true;
  scenePass.contextNode = builtinAOContext(aoPass.getTextureNode().sample(screenUV).r);

  // temporal AA over the beauty, then add bloom (bloom is smooth — safe after TRAA)
  const traaPass = traa(scenePass, prePassDepth, prePassVelocity, camera);
  const bloomPass = bloom(scenePass.getTextureNode('emissive'), 0.8, 0.3);

  pipeline.outputNode = traaPass.add(bloomPass);

  return { pipeline, render: () => void pipeline.render() };
}
