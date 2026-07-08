# EXTRAVERSE — Build Decisions Log

Deltas and discoveries vs `EXTRAVERSE_BUILD_PROMPT.md`, newest first.

## M0 — Lookdev (2026-07-06)

- **GLTFLoader sanitizes node names**: spaces become underscores (`Gridcorp dron` → `Gridcorp_dron`). All manifest-name matching goes through `unsanitize()` in `shipLoader.ts`. Any future name-based lookup must do the same.
- **`antialias: false` is required** on WebGPURenderer when using the TRAA/GTAO pass chain: pass depth textures are copied by the pipeline and MSAA (4-sample) depth cannot be copied/resolved into the single-sample pass textures (GPUValidationError). TRAA provides the AA; matches the official r185 examples.
- **r185 post pipeline class is `THREE.RenderPipeline`** (spec's `PostProcessing` still exists but is the legacy name). Composition copied from `webgpu_postprocessing_ao` + `webgpu_postprocessing_bloom_emissive`: prePass (packed normalView + velocity MRT) → beauty pass (output + emissive MRT, `builtinAOContext` for GTAO) → `traa(...)` → `.add(bloom(emissiveMRT))`.
- **`renderer.info.render.drawCalls`** is the per-frame counter; `.calls` is cumulative since app start (misread it first — looked like 9k draws/frame, real value is 261).
- **Emissive tuning under AgX** (spec suggested reactor 3→13): the aft "Shape/Shape 2 nozzles" from the manifest are actually *large* aft frame surfaces, so area × intensity made 13 nuclear. Shipped values: reactor `1.2 + 4.5·throttle`, engine frames `0.25 + 2.2·throttle`, bloom `strength 0.8, radius 0.3`. Reads hot without whiting out the whole aft.
- **HDRI is environment-only**: satara_night as `scene.background` looks like a night garden (trees visible). Background is flat `#030508` until the real galaxy skybox (M2/M8); HDRI stays as `scene.environment` (0.9) so PBR has reflections.
- Lookdev sun (intensity 8.0 from aft-starboard) is **not** the physical-units sun from §5.2 — that lands with M2's real sun.
- Verification harness: `scripts/verify-m0.mjs` (Playwright + system Chrome, `--enable-unsafe-webgpu --use-angle=metal`) — boots, clicks launch, screenshots, dumps console errors + HUD. WebGPU confirmed active in headless Chrome on this machine.

## Pre-M0 (research phase, 2026-07-06)

- All stack versions/URLs verified 2026-07-06; see `EXTRAVERSE_BUILD_PROMPT.md` §18 for sources.
- Ship scale locked at 18 m length (`SHIP_SCALE = 18/244`).

## M1 — Flight (2026-07-06)

- **Roll sign**: Q/E mapped so stick roll → body −Z rotation with nose = −Z; verified feel in chase cam.
- **Boost G**: 2× main authority = 100 m/s² ≈ 10 G displayed. Blackout/grey-out effects are deferred to M5 (HUD shows amber G past 6 for now).
- **Float precision**: M1 flies in plain world coordinates (no camera-relative rendering yet) — fine to ~100 km from origin; M2 introduces the f64 + camera-relative layer per §4.1.
- **Exhaust**: additive TSL cone plumes (MeshBasicNodeMaterial, opacityNode falloff + flicker) instead of GPU particles — particles arrive with warp VFX (M3). Plumes don't write the emissive MRT, so they don't bloom; the reactor/engine-frame emissives carry the bloom.
- **Shadow while flying**: sun + shadow frustum follow the ship every frame (directional light target re-anchored to ship position).
- Verification: `scripts/verify-m1.mjs` — thrust/boost/decouple/camera-toggle exercised headlessly; coupled cap ~252 m/s under boost decay, decoupled coast at 200 m/s & 0 G confirmed via HUD telemetry.
