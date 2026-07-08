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

## M2 — Sol on rails (2026-07-06)

- **Far-shell instead of two-pass composite (deliberate §4.3 simplification)**: distant bodies are proxies projected to a fixed 9 km shell around the camera (`pos = dir·R`, `scale = R·radius/dist`, depthTest off, distance-sorted renderOrder). Perspectively identical to the far-scene pass but needs no second camera/clearDepth. The true two-pass split lands in M4 when quadtree terrain needs tight near/far planes.
- **Ephemeris**: JPL approx_pos Table 1 (1800–2050) parsed from ssd.jpl.nasa.gov into `src/data/jpl-elements.json` (8 planets; Earth = EM Barycenter; Pluto omitted). Verified against reality: sun distances 1.02/5.27/9.47/29.88 AU at the 2026-07-06 epoch.
- **f64 proof**: HUD shows f32 ULP at current |pos| — 32,768 m at Neptune (would be km-scale jitter naively); camera-relative rendering keeps the GPU in small numbers, renders are rock solid at 120 fps.
- **Moons**: circular-orbit approximation (real a, period, inclination; seeded phase) — full elements not worth it until landings. Orbital periods kept REAL while distances are ×0.1, so moons sit deep inside parent SOI; revisit when patched-conics ship orbits arrive (M3+).
- **Earth night lights** are emissive on the whole sphere for now (day-side too); proper terminator day/night blend is the M6 Earth milestone.
- **Physical sun falloff** (8/dAU²) makes the outer system authentically dim — Saturn at 9.5 AU gets 1% of Earth light. May add a small "gameplay ambient" floor later if legibility suffers.
- Dev jumps: keys 1–8 teleport 6 radii sunward of each planet (spawn/testing only). F2 = system map (log-radial).

## M3 — Warp (2026-07-06)

- **Auto-align is mandatory**: first flight test warped along the nose vector while facing Earth → runaway to 6.6 AU (v_cap grows with target distance, so a miss accelerates forever). SPOOL now owns rotation (autopilot slerp to target, τ 0.35 s, entry gated on < 2° error) and WARP applies gentle track-hold (τ 2.5 s) under the player's reduced steering (×0.15).
- **Trip time**: distance-slaved cap means the gravity-well climb-out dominates, not V_MAX — Earth→Mars measured **104 s** (spool + climb + 6e8 m/s cruise + auto-brake) with T_BRAKE 5 s, τ_accel 1.5 s. Spec's "30–75 s" assumed cap-dominated travel; the well-climb version feels more Elite-authentic. Tune T_BRAKE if faster is wanted.
- **r185 bug found**: `chromaticAberration(node, strength)` crashes in node-build when `center` is left at its documented `null` default — pass `uniform(new Vector2(0.5, 0.5))` explicitly.
- Warp tunnel = 500 additive LineSegments scrolling in a camera-space cylinder (CPU-updated, ~0 cost); CA strength = 0.65·factor².
- During WARP the flight sim skips translation (warp owns pos/vel; HUD speed reads warp v); exit drops to 150 m/s forward drift (350 on emergency).
- Verified end-to-end: G-cycle to Mars, B engage, auto-drop at 17 Mm / sun 1.45 AU, 0 console errors, 120 fps (scripts/verify-m3.mjs).

## M4 — Planet terrain (2026-07-06)

- **Local-frame carry is mandatory** (found by E2E): bodies move on heliocentric rails (~3 km/s scaled) — without carrying the ship in the nearest body's frame (< 3R), the planet literally flies away mid-descent. `BodyState.deltaM` + per-frame carry in main; skipped during WARP. Surface-rotation carry (spin) still TODO before M7 on-foot.
- **Exclusive quadtree resolve**: render a node OR its four children, never both — coarse stand-ins + their skirts poke through fine terrain otherwise (the "pink grid" bug). While streaming, a built parent stands in exclusively; holes only if nothing in the chain is built.
- **Nearest-first build queue**: DFS-order requests starved the patches directly under the ship (worker slots eaten by horizon nodes). All missing nodes are collected per frame, sorted by camera distance, dispatched to the pool (12 in flight, 2 workers).
- **Age-based eviction** (not strict LRU count): evict only patches unused for 240+ frames; strict-count eviction thrashed against parent stand-ins (rebuild loop, starved queue).
- **Skirts at 2.5% arc**: 12% skirts read as black walls at LOD transitions near the ground. Residual hairline seams remain at close range — proper fix is CDLOD vertex morphing or neighbor-LOD stitching (polish backlog, pre-M6).
- Terrain patches cast no shadows (receive only) — casting doubled shadow-pass draws for zero visual gain at this scale.
- Patch mesh math lives in pure `patchBuilder.ts` (worker is a thin shell) — unit-tested: exact border sharing between neighbors (the crack regression test), outward unit normals, skirt below source, determinism.
- Collision = analytic height clamp (radial), not Rapier yet — Rapier arrives with M5 landing/gear + M7 on-foot per plan. Camera can still clip terrain (chase cam collision is an M5 task).
- CPU workers for heightmaps (simplex-noise); TSL compute is a later optimization. MAX_LEVEL 13 ≈ 0.65 m cells on Luna.

## M5 — Atmosphere & landing (2026-07-06)

- **Atmosphere = single-scatter raymarch (O'Neil-class) in TSL**, not full Bruneton: 12 view × 4 light samples, JS-unrolled at graph build (no TSL Loop API risk), ground-sphere occlusion in-march, per-planet spectra from `AtmoDef`. Mars's reversed Rayleigh (OpenSpace data) produces the real blue sunset aureole — verified visually. Bruneton LUTs remain an M6+ upgrade if multi-scatter quality is wanted.
- **Scale choice**: ρ0/H kept REAL at 1/10 radii → atmospheres are proportionally ~10× thicker than reality. Dramatic limb glow, Kármán line still at the real 99.6 km for Earth. μ_eff = μ_real × 0.01 keeps real surface gravity (unit-tested).
- **FA-vs-autoland bug (caught by E2E)**: coupled flight assist drives v→0 and cancels the autoland descent law near the ground (hover deadlock at ~16 m). Autoland now suppresses the assist translation loop via `flight.step opts.suppressAssist`.
- **Landing beats implemented**: gear deploys at FINAL (500 m, 1.2 s ease-out+bounce), dust ring < 50 m, plasma sheath + trauma ∝ q_dyn, LANDED pin (ship rides the planet's rail motion at rest), thrust breaks the pin. Autoland does NOT manage attitude yet (ship keeps its orientation; fine on gear) — attitude hold is an M7-adjacent polish item.
- **Terrain MAX_LEVEL 13 → 12, split 2.2**: Mars at full depth ran 53 fps at the deck; 12 gives 2.6 m cells and 70+ fps. CDLOD morphing still the proper seam fix.
- **E2E test hook**: `window.__XV` exposes sim state (autoland/gear/pin/speed/alt/heat/warp/fps) — HUD-canvas states aren't string-greppable; scripts assert on the hook now.
- **Known issue (pre-M5, still open)**: dark jagged blobs at frame corners in close-to-terrain shots — present since M4, occludes stars, cause unidentified (suspects: far-shell draw order, skirt geometry behind camera). Bisect scheduled for the M6 polish pass.
- Dev keys: 0 = Mars terminator sunset (4 km AGL, nose at the sun), Minus = Mars entry demo (60 km, 2.4 km/s oblique, decoupled).

## M6 — Earth (2026-07-06)

- **Corner-blob "bug" diagnosed as correct physics**: bisect (?hide= toggles) showed the dark jagged frame-edge shapes in every variant — they're the unlit night-side limb of the body (terrain silhouettes past the terminator occluding stars). Closed, not a bug. `?hide=exhaust,stars,shell,atmo,tunnel,dust,glow,gear,terrain` stays as a permanent debug tool.
- **Real continents via land mask**: Blue Marble day texture → 1024×512 water/land mask (blue-dominance heuristic, unit-tested) → gates the Earth heightfield (land rises, seafloor −900 m) and ships to terrain workers via a one-time init message. Geometry matches albedo; no DEM download needed yet (NASA Trek tiles remain the upgrade path).
- **Real-texture drape**: terrain shader computes equirect UV from world direction (spin-corrected longitude via uniform) — real albedo at all LODs, rock detail modulating up close. Night lights use the same UV with a terminator smoothstep on `normalWorld·sunDir` — fixes the M2 "lights everywhere" issue on BOTH the terrain and the far-shell proxy (proxy got a node material + per-body sun uniform).
- **Ocean**: datum-radius specular sphere (roughness 0.12) inside the terrain group; collision/landing surface = max(terrain, datum) on ocean worlds — you belly-land on water, not the seafloor. FFT waves remain a later tier.
- **Clouds**: real 2k cloud map on a translucent DoubleSide sphere at R+6 km with slow drift (tier-1 of §8.4); volumetric raymarch still future.
- Money shot verified: sunrise over Earth from 224 km — blue Rayleigh limb ring + sunrise band, real clouds over the Pacific, 120 fps, 0 console errors. Note: verify-m6's "low pass" leg times out by design (autoland descends at 55 m/s from 215 km ≈ 65 min) — informational, not a failure; manual dives are the way down from orbit.

## Moon, photoreal Earth, NAV cruise (2026-07-07)

- **User Spline assets**: both new glTFs (moon_rotation_wobble, photoreal_earth) export geometry-only (no materials/animations — known Spline limitation). The VALUE was inside `photoreal_earth.spline`: extracted 3× 4096×2048 embedded JPEGs by binary magic-scan (day albedo, night lights, clouds) — now Earth's textures (2× our old resolution). Extraction script pattern kept in git history.
- **Moon**: 8k albedo (Solar System Scope) draped on the Luna terrain + proxy. The gltf's "rotation wobble" intent implemented SCIENTIFICALLY as optical libration: spin = orbit + 2e·sin(M) (±6.3° longitude), latitude nod ±6.68° — real values, unit-tested, applied to proxy rotation + terrain frame.
- **Earth–Moon distance** was already scientifically exact (384,400 km × 0.1 scale): now asserted in tests including the scale-invariant truths — 60.34 Earth radii separation, 0.518° lunar disc.
- **NAV cruise (C)**: coupled ceiling lifts 250 m/s → 4000 mi/s (6,437 km/s ≈ 2.1% c) with damper fiction (30 km/s² assist) and a distance-slaved safety cap (dSurface/4) so cruising at a planet auto-brakes instead of lithobraking. Spooldown: dampers stay hot above 1 km/s after NAV exit — braking from cruise on RCS would take a day (test-caught). Moons are warp/NAV targets now (cycle includes them).
- E2E: NAV 552 km/s from LEO PASS; warp to Luna arrival at 346 km PASS; obstruction refusal + retry pattern validated in-script. 96 unit tests.

## User meshes, motion perception, stability (2026-07-07)

- **User glTFs are now THE Earth and Moon**: `celestialMeshes.ts` extracts sphere geometry from photoreal_earth.gltf ('Earth' node, 16k verts) and moon_rotation_wobble.gltf ('Sphere', 4k verts), unit-normalized, passed as FarShell geometry overrides. Their meshes are higher-res than the old proxies; Spline's UVs map our equirect textures correctly (verified visually).
- **Relative-motion perception** (user-reported "ship doesn't look like it's moving"): the ship is origin-pinned by design, and space has no nearby references. Added SC-style cues: `SpaceDust` — 350 world-anchored motes in a 220 m wrapping bubble rendered as velocity streaks (length/opacity ∝ speed, hidden in warp), and cosmetic banking lean on the ship visual (roll ∝ yaw rate, pitch ∝ pitch rate; sim untouched).
- **Terrain LOD resolve-skip**: re-resolve only when the camera moves > 0.4% of its distance since the last resolve — kills the 31 fps churn dip when receding at cruise speed AND per-frame work while hovering.
- **8k moon texture crashed headless Chrome** (134 MB decoded in the GPU process): proxy uses 2k, terrain drape 4k. Rule of thumb: keep per-texture decode ≤ ~50 MB.
- **Headless Chrome WebGPU is flaky** (GPU process death after ~40 s under load even post-diet); headed Playwright is rock stable (60 fps vsync). E2E policy: logic asserts headless where possible, screenshots/long soak via `headless: false`.
- NAV HUD shows honest damper G (3000+ G at full NAV accel) — fiction says inertial dampers; revisit display clamp in M9 polish.
