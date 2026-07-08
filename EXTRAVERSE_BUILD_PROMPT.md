# EXTRAVERSE — Master Build Prompt

> **This is a self-contained build prompt.** Feed it to Claude Code in `/Users/zerish/Extraverse` and say "build it" (or build one milestone at a time — see §17). Every constant, formula, URL, version number, and license below was verified against primary sources on 2026-07-06. Do not re-research; implement.

---

## 1. Mission

Build **EXTRAVERSE**: a browser-based, first-person, Star Citizen-class space exploration game. One player, one ship — the **GRIDCORP drone** from `gridcorp.gltf` — an entire Milky Way.

**Pillars (in priority order):**
1. **Seamless scale** — walk on a planet, lift off through the atmosphere, reach orbit, warp across the system, hyperjump across the galaxy. No loading screens (warp/jump tunnels ARE the loading screens). No teleports, no visible LOD pops.
2. **Real physics that stays fun** — Newtonian 6DOF flight with flight-assist, analytic Kepler orbits, real atmospheric density/drag/reentry heating, real planetary data. Infinite fuel, honest acceleration.
3. **Ray-traced-quality visuals** — there is no hardware RT API in any browser (verified: WebGPU has no shipped acceleration-structure extension as of July 2026). Deliver the ray-traced *look* with the physically-based pipeline in §5: SSGI + SSR + GTAO + HDR IBL + AgX, plus a true path-traced **photo mode**. Never claim real-time path tracing; achieve the look.
4. **The real Milky Way** — Reid et al. 2019 spiral arms, the real solar neighborhood from the HYG catalog, Sgr A* at the center, real Solar System as the starting system.
5. **60 fps on a mid-range desktop GPU.** Every feature obeys the budget in §16.

Non-goals for v1: multiplayer (keep the input→command seam from §4.5, write zero netcode), combat, economy, VR.

---

## 2. The Ship — `gridcorp.gltf` (verified manifest)

**File facts:** glTF 2.0, exported by THREE.GLTFExporter from Spline. 188 nodes, 79 meshes, 54,490 triangles, one embedded base64 buffer (2.2 MB). Two cameras, one point light (`KHR_lights_punctual`). **Zero materials — everything loads gray.** Spline's matcap materials ("Matcap Reflection", "Matcap Roughness", "Noise Gradient Color Shiny") never survive glTF export. `scene.splinecode` is the Spline source — do NOT ship the Spline runtime; recreate the look in PBR (§2.3).

### 2.1 Scene cleanup on load (strip list)

Root is node "Scene 1". Keep **only** node `Gridcorp dron` (the ship). Strip:
| node | name | what it is |
|---|---|---|
| 1 | `GRIDCORP` | logo text mesh (901×72×13 units) — strip (optional: reuse as hangar signage later) |
| 2 | `Torus` | 500-radius dressing ring |
| 3, 4, 5 | `BG 2`, `BG 3`, `BG` | 3000×2000 background planes |
| 6 | `Camera` | Spline viewport camera |
| 178, 186 | unnamed empties/groups | dressing (meshes 180–185) |
| 179 | `Default Ambient Light` | game does its own lighting |

### 2.2 Ship anatomy ("Gridcorp dron", 32 direct children, 123 mesh nodes)

Local bounds: **W 498.6 × H 175.3 × D 244.0** Spline units. **Nose = −Z** (three.js forward — no reorientation needed), engines = +Z, +Y up, mirror-symmetric across X.

**Scale decision (locked):** `SHIP_SCALE = 18 / 244 ≈ 0.0738` → length 18 m, wingspan 36.8 m, height 12.9 m. A heavy-fighter delta wing.

Parts manifest (centers/sizes in ship-local units — multiply by SHIP_SCALE for meters):

| part [node] | center (x,y,z) | role → game use |
|---|---|---|
| `Point Light` [7] | (0, −2.3, 177) | authored **engine glow**, color `#FFC671`, intensity 0.91 — keep, parent to engine, drive intensity from throttle |
| `Shape 2`/`Shape` [8/9] | (±38.2, 1.0, 97.9) | twin engine nozzles → engine material, exhaust particle emitters at (±38.2, 1.0, 108)·scale pointing +Z |
| `Sphere 4`/`Sphere 3` [10/11] | (0, −0.2, 106.2) | reactor core spheres → **emissive `#FFC671`**, the bloom hero |
| `Torus` [12] | (0, 0, 110.1) | reactor containment ring → dark metal + emissive rim |
| `Boolean` [13] | — | 0 triangles, skip |
| `Cylinder` [14] | (0, 0, 93.7) | engine housing |
| `Cables` [22] | (0, −38.7, 1.7) | belly cable runs (7 meshes, lowest geometry y≈−141) → rubber material |
| `WingLeft`/`WingRight` [38/54] | (∓160.5, 27.8, 8.5) | main wings, 13 meshes each → **animatable groups** (landing fold, §10) |
| `SideBodyLeft/Right` [60/66] + `Group 13` [57/63] | (±53.8, 0, ·) | side hull pods |
| `Body` [89] | (0, 9.2, −4.8) | main hull, 133×70×228 |
| `TopWingLeft/Right` [97/93] | (∓66.9, 56.7, −7.5) | upper fins → animatable |
| `TopPlane2`/`TopPlane` [98/99] | dorsal spine / top plate (highest point y≈71.6) |
| unnamed [128]/[169] | (∓63.1, 37.2, 36.7) | thruster banks → RCS visual puff points |
| unnamed [139]/[150] | (∓109.2, 4.1, 16.9) | wing hardpoint rigs |
| `Group 3–15`, unnamed [109]/[176] | greebles → trim material |

**Derived anchors (meters, ship-local after scaling):**
- Cockpit camera: `(0, 1.85, −7.0)` (front of hull, above centerline).
- Main thrusters: `(±2.82, 0.07, 7.97)`, +Z exhaust. Engine light at `(0, −0.17, 13.1)`.
- Center of mass: `(0, 0, 0)` after recentering; box-approx inertia from 18×12.9×36.8 m dims (§9.1).
- **No landing gear is modeled.** Build procedural gear: 3 retractable struts (cylinder + foot pad, ~1.2 m travel) at ship-local meters `(0, −5.2, −6.5)`, `(±8.5, −4.8, 4.5)`; animate deploy in 1.2 s with ease-out bounce. Belly clearance when deployed ≥ 1.4 m below the Cables group.

### 2.3 Load pipeline + PBR re-materialing (three r185, `three/webgpu`)

Spline exports have degenerate/missing UVs on boolean/Smooth&Edit geometry — **assume no usable UVs, use TSL triplanar everywhere** (`triplanarTexture` is core TSL, exported from `three/tsl`).

```js
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { texture, triplanarTexture, float, color, uniform } from 'three/tsl';

const gltf = await new GLTFLoader().loadAsync('/models/gridcorp.gltf');
const ship = gltf.scene.getObjectByName('Gridcorp dron');   // strip everything else
const SHIP_SCALE = 18 / 244;
ship.scale.setScalar(SHIP_SCALE);
// recenter: subtract Box3 center so CoM ≈ origin

ship.traverse(o => {
  if (!o.isMesh) return;
  o.castShadow = o.receiveShadow = true;
  const g = o.geometry;
  if (g.attributes.color) g.deleteAttribute('color');        // kill Spline vertex-color bakes
  if (!g.attributes.normal) g.computeVertexNormals();
  // if normals look faceted: BufferGeometryUtils.mergeVertices(g, 1e-4) then recompute
  o.material = pickMaterial(o);                               // by node name / ancestry, table below
});
```

Material table (all `MeshStandardNodeMaterial` / `MeshPhysicalNodeMaterial`, triplanar-sampled at `scale ≈ 0.35` tiles/meter, textures from §15):

| matcher (node name or ancestor) | material | params |
|---|---|---|
| default (Body, wings, fins, pods) | **hull** — painted dark metal | Poly Haven `metal_plate_02` maps; metalness map (paint 0 → scratches 1), roughness 0.45, optional clearcoat 0.35 (showroom paint, matches the Spline "shiny" matcap look) |
| `Cables` subtree | rubber | ambientCG `Rubber004`; metalness 0, roughness 0.9 |
| `Torus`[12], `Cylinder`[14], greeble groups | trim — bare metal | ambientCG `Metal032`; metalness 1.0, roughness 0.25 |
| `Sphere 3`/`Sphere 4` [10/11] | **reactor** | black base, `emissive #FFC671`, `emissiveIntensity = 3 + throttle*10` via TSL uniform |
| `Shape`/`Shape 2` [8/9] nozzle interiors | engine | color black, emissive `#FFC671`, intensity throttle-driven |

Triplanar normal maps have no tangent frame — carry surface detail in roughness/AO via triplanar, or `bumpMap` from the height channel. Skip MikkTSpace tangents (UV-less). Environment: `scene.environment` = the baked galaxy skybox (§6.5) — WebGPURenderer PMREM-filters equirect maps automatically. Add 2 small warm PointLights at the nozzles (intensity ~20, distance ~15) so engine glow lights the hull.

**Verification gate:** ship renders in a lookdev scene (HDRI + sun light) with zero gray meshes, reactor blooming, before ANY game systems are built.

---

## 3. Tech Stack (exact, verified July 2026)

```bash
npm create vite@latest extraverse -- --template vanilla-ts   # Vite 8 (Rolldown)
npm i three@0.185.1                     # r185: WebGPURenderer, TSL, all post FX, CSMShadowNode
npm i @dimforge/rapier3d-compat@0.19.3  # physics (f32! see §4.1) — cannon-es is dead, do not use
npm i three-mesh-bvh@0.9.10             # raycasts vs terrain/ship
npm i mitt@3.0.1 idb@8                  # event bus, IndexedDB saves
npm i -D @gltf-transform/cli@4.4.1      # meshopt + KTX2 asset pipeline
# photo mode only (not real-time): three-gpu-pathtracer@0.0.24 (WebGL2 path)
```

- **Renderer: `WebGPURenderer` + TSL only.** `import * as THREE from 'three/webgpu'`, shaders via `three/tsl` (compiles WGSL + GLSL). `await renderer.init()` before first frame. Automatic WebGL2 fallback covers the ~16% of users without WebGPU — on fallback, degrade per §16.
- All custom shading = TSL node materials. **No raw GLSL ShaderMaterial anywhere.**
- Pin `three` exactly; it breaks monthly.
- TypeScript strict. Project layout in §4.6.

---

## 4. Engine Architecture (make-or-break decisions, all locked)

### 4.1 Coordinates — the three-layer rule
Float32 jitters visibly at 10⁶ m from origin; the galaxy is 10²¹ m. **The GPU must never see a big number.**

1. **Galactic layer**: `sector Int32×3` (10 ly cubes) + `float64×3` offset. Used only by galaxy map + procgen addressing.
2. **System layer**: on system entry, all bodies/ship get `posM: float64×3` (plain JS numbers = native doubles; ULP at Pluto's orbit ≈ 2 mm) relative to the system barycenter.
3. **Render layer**: `camera.position` is permanently `(0,0,0)`. Per frame, on CPU in f64: `renderPos = posM − cameraPosM` → write to `object3d.position`. Terrain patch vertices stay patch-local; only patch origins are camera-relative.

**Rapier is f32 internally** — it simulates a "physics bubble" (§9.6) in a zone-local frame; rebase when the ship drifts > 2–8 km from the bubble origin: one atomic pass at tick start, `body.setTranslation(t − shift)` for every body, `zoneOrigin += shift`. Above ~750 m/s also rebase velocity (KSP Krakensbane) so f32 velocity integration stays precise.

### 4.2 Depth precision
`new THREE.WebGPURenderer({ reverseDepthBuffer: true })` — reversed-Z shipped for WebGPU in r183+ (official example `webgpu_reversed_depth_buffer`; verify exact option name against installed r185 typings). Combined with §4.3's near/far scene split, depth artifacts vanish. WebGL2 fallback: `logarithmicDepthBuffer: true` (slower — disables early-Z; acceptable on the fallback path). Never rely on log-depth on the primary path.

### 4.3 Two-pass far/near composite (KSP ScaledSpace pattern)
```js
renderer.autoClear = false;
// FAR pass: distant planets/moons/sun as proxies projected to a fixed-radius shell:
//   pos = dir_to_body * 1e4;  scale = 1e4 * bodyRadius / dist   (perspectively identical)
// farCamera: position (0,0,0), same quaternion as main, near 1, far 2e4
renderer.clear(); renderer.render(farScene, farCamera);
renderer.clearDepth();
renderer.render(nearScene, nearCamera);   // near 0.1, far 5e4 m
```
Bodies promote far→near when < ~2× planet radius (quadtree terrain activates; LOD-0 sphere ≈ proxy sphere so the swap is invisible). Sun, galaxy skybox, star billboards live in the far scene.

### 4.4 Mode state machine
```
GALAXY_MAP ⇄ SYSTEM_FLIGHT ⇄ WARP ⇄ HYPERJUMP ; SYSTEM_FLIGHT ⇄ ORBIT ⇄ ATMOSPHERIC ⇄ LANDED ⇄ ON_FOOT
```
Plain TS: `interface GameMode { enter(ctx): Promise<void>; exit(): void; fixedUpdate(dt): void; render(alpha): void }` — async `enter()` is the loading hook. WARP/HYPERJUMP render only tunnel VFX + HUD while workers generate the destination and prefetch textures; arrival gates on `Promise.all`.

### 4.5 Fixed-timestep loop (canonical, Gaffer)
```ts
const DT = 1/60; let acc = 0;
renderer.setAnimationLoop((now) => {
  acc += Math.min(dtReal, 0.25);
  while (acc >= DT) { input.sample(tick++); mode.fixedUpdate(DT); physics.step(); acc -= DT; }
  mode.render(acc / DT);   // interpolate prev→curr transforms (slerp quats); Kepler + camera-relative recompute here
});
```
Input flows **device → binding → `IntentFrame{tick, axes, pressed/held/released}` → simulation**. Sim code never touches DOM events. This is the multiplayer seam; keep it clean.

### 4.6 Project structure
```
/src
  main.ts
  /engine
    /core   loop.ts time.ts events.ts modeMachine.ts save.ts
    /math   Vec3d.ts kepler.ts frames.ts rng.ts (mulberry32 + hash)
    /render compositor.ts farScene.ts postfx.ts csm.ts
    /physics bubble.ts (Rapier wrapper + rebase) character.ts
    /assets assetManager.ts streaming.ts
    /workers terrainWorker.ts genWorker.ts pool.ts
  /game
    /modes   galaxyMap.ts systemFlight.ts warp.ts orbit.ts atmospheric.ts landed.ts onFoot.ts
    /systems flight.ts flightAssist.ts warpDrive.ts gravity.ts autopilot.ts discovery.ts
    /entities ship.ts planet.ts star.ts player.ts
    /procgen galaxy.ts system.ts terrain.ts
  /shaders  *.ts (TSL functions)
  /ui       hud.ts (canvas 2D overlay) menus (DOM) galaxyMapUI.ts reticle.ts
  /data     constants.ts hyg.bin solar-system.json
/public/textures /public/env /public/models /public/audio
```
ECS: **no framework.** Plain classes + composition (~50 important objects). Add `bitecs@0.4.0` later only for >10³ homogeneous entities (asteroid fields). miniplex is unmaintained — do not use.

### 4.7 Persistence & determinism
- Saves in IndexedDB (`idb`): `{version, galaxySeed, mode, sector, systemId, posM, vel, quat, discovered[]}`. Settings/keybinds in localStorage.
- **Seed hierarchy**: `galaxySeed → sectorSeed = hash(g, sx,sy,sz) → systemSeed = hash(sector, starIdx) → planetSeed → terrainSeed(face, x, y, lod)`. RNG = mulberry32; **never `Math.random()` in procgen**; derive each property from `hash(seed, 'propName')` so adding properties never reshuffles existing worlds. Freeze the hash function forever.

```js
function mulberry32(seed){let a=seed>>>0;return function(){a=(a+0x6D2B79F5)|0;
let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;
return((t^(t>>>14))>>>0)/4294967296;};}
```

---

## 5. Rendering — the "ray-traced look" pipeline

All effects are **built into three r185** under `three/addons/tsl/display/` — no third-party post libs on the WebGPU path.

### 5.1 Post stack (in order)
```js
import { pass, mrt, output, emissive, velocity } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
// scenePass with MRT: output + emissive (+ velocity for motion blur)
const scenePass = pass(scene, camera);
scenePass.setMRT(mrt({ output, emissive }));
```
1. **GTAO** (`GTAONode`) — ambient occlusion
2. **SSGI** (`SSGINode`) — the closest thing to RT GI at 60 fps; hull picks up planet bounce light
3. **SSR** (`SSRNode` + `DenoiseNode`) — glossy hull reflections
4. **TRAA** (`TRAANode`) — temporal AA (FXAA on WebGL2 fallback)
5. **Bloom from the emissive MRT attachment** (`bloom(emissivePass, 2.5, 0.5)`) — inherently selective: only reactor/engines/stars/city-lights bloom, zero threshold tuning
6. **GodraysNode** for the sun; `LensflareNode` (post) for star flares
7. **MotionBlur** (velocity MRT) — subtle, ship-relative
8. Grade: `ChromaticAberrationNode` (warp only), `FilmNode` grain (subtle), vignette
9. **Tone mapping: `THREE.AgXToneMapping`, exposure 1.0** — best highlight handling for HDR space; grade with `scene.environmentIntensity`, not exposure.
- Photo mode (F9): freeze sim, hand the scene to `three-gpu-pathtracer` (WebGL2 canvas), progressive-render 1–5 s → true path-traced screenshots. This is the only "real ray tracing" and it's labeled as such.

### 5.2 Lighting (physical units only — legacy lighting was removed in r165)
- **Sun = DirectionalLight**: irradiance `1361 / d_AU²` W/m² → illuminance `133,100 / d_AU²` lux. Keep intensity physical and expose via EV100 ≈ 15 (daylight) / 9–10 (cockpit). Sun disc: emissive sprite, angular size 0.533° at 1 AU. Color: 5778 K ≈ `#fff5f0` in space.
- **Shadows**: `CSMShadowNode` (r185, `three/addons/csm/CSMShadowNode.js`), 4 cascades, practical mode, maxFar ~5 km; fade out beyond. Ship self-shadowing on; terrain receives.
- **IBL**: `scene.environment` = baked galaxy cubemap (§6.5) — dim starlight so PBR always has something to reflect; `environmentIntensity ≈ 0.3–0.6` in deep space.
- Eclipses: when a planet occludes the sun (analytic sphere test), fade the DirectionalLight — free drama.

---

## 6. The Milky Way (real data, procedural render)

World frame: right-handed galactocentric — +X Sun→center, +Y toward galactic rotation (l = 90°), +Z north galactic pole. **Sgr A\* at origin** (4.297×10⁶ M☉, Schwarzschild radius 0.085 AU — render: black sphere + lensed accretion glow + dense Nuclear Star Cluster sprite field). **Sun at (−8150, 0, +20.8) pc** (use R0 = 8.15 kpc to match the Reid arm fits).

### 6.1 Density field (stars/pc³) — drives procgen + volume impostor
```
ρ(R,z) = 0.1 · [ exp(−(R−R0)/2600 − |z|/300) + 0.12·exp(−(R−R0)/2000 − |z|/900) ]   // pc units
+ bulge:  ρ_b ∝ exp(−(m/700)^1.8),  m² = x_b² + (y_b/0.4)² + (z/0.3)²  (bar frame, rotated 30° to Sun line, half-length 5 kpc)
+ halo:   0.1·5e−5 · (r/8277)^−2.3  (r<27 kpc), ∝ r^−4.6 beyond
× arms:   1 + A·exp(−d_arm²/(2·w(R)²)),  A = 0.25 old stars, A = 3–5 young stars/nebulae
```

### 6.2 Spiral arms — Reid et al. 2019 (implement verbatim)
`R(β) = R_kink · exp(−(β − β_kink)·tan ψ)`, β in rad, β=0 toward Sun, ψ switches at the kink; Gaussian cross-section `w(R) = 0.336 + 0.036(R_kpc − 8.15)` kpc.

| Arm | β range° | β_kink° | R_kink kpc | ψ<° | ψ>° | σ kpc |
|---|---|---|---|---|---|---|
| 3-kpc | 15→18 | 15 | 3.52 | −4.2 | −4.2 | 0.18 |
| Norma–Outer | 5→54 | 18 | 4.46 | −1.0 | 19.5 | 0.14 |
| Scutum–Centaurus | 0→104 | 23 | 4.91 | 14.1 | 12.1 | 0.23 |
| Sagittarius–Carina | 2→97 | 24 | 6.04 | 17.1 | 1.0 | 0.27 |
| Local (Orion Spur) | −8→34 | 9 | 8.26 | 11.4 | 11.4 | 0.31 |
| Perseus | −23→115 | 40 | 8.87 | 10.3 | 8.7 | 0.35 |
| Outer | −16→71 | 18 | 12.24 | 3.0 | 9.4 | 0.65 |

Extrapolate ±180° beyond fitted ranges with density taper; arms root at the bar ends. Optional beauty: disk warp beyond R = 9 kpc (±1 kpc by R = 15).

### 6.3 Stellar population
Spawn weights (per 10,000): **M 7645, K 1210, G 760, F 300, A 61, B 13, O 0.03** (+ ~5% white dwarfs, ~0.4% giants). O/B only in arms/young clusters. Class table (blackbody sRGB):

| Class | T(K) | M☉ | R☉ | L☉ | hex |
|---|---|---|---|---|---|
| O | 30–50k | ≥16 | ≥6.6 | ≥30000 | `#9bb0ff` |
| B | 10–30k | 2.1–16 | 1.8–6.6 | 25–30k | `#aabfff` |
| A | 7.5–10k | 1.4–2.1 | 1.4–1.8 | 5–25 | `#cad7ff` |
| F | 6–7.5k | 1.04–1.4 | 1.15–1.4 | 1.5–5 | `#f8f7ff` |
| G | 5.2–6k | 0.8–1.04 | 0.96–1.15 | 0.6–1.5 | `#fff4ea` |
| K | 3.7–5.2k | 0.45–0.8 | 0.7–0.96 | 0.08–0.6 | `#ffd2a1` |
| M | 2.4–3.7k | 0.08–0.45 | ≤0.7 | ≤0.08 | `#ffcc6f` |

Relations: `L ∝ M^3.5`, `R ∝ M^0.8`, T from `L = 4πR²σT⁴`. Continuous T→RGB: Tanner Helland piecewise fit. B−V→T: `T = 4600(1/(0.92·BV+1.7) + 1/(0.92·BV+0.62))`.

### 6.4 Real stars — HYG v4.3
**Ship it**: 119,614 stars, CSV with precomputed XYZ (pc), spectral class, luminosity. Download (Codeberg Git-LFS — must use `/media/`, the `/raw/` URL returns a 133-byte LFS pointer):
`https://codeberg.org/astronexus/hyg/media/branch/main/data/hyg/CURRENT/hyg_v43.csv.gz` (13.6 MB)
License **CC BY-SA 4.0** → credit "David Nash / astronexus.com" AND keep the converted binary catalog a separate data file (share-alike applies to the data). Bake offline to a ~2 MB binary (pos f32×3, colorIdx u8, lum f16, nameIdx u16). Hand-place landmark systems with real planets: **Proxima/Alpha Centauri (4.25 ly), Sirius, Barnard's Star, Tau Ceti, Epsilon Eridani, Vega, TRAPPIST-1 (7 Earth-size planets, 40.7 ly), 51 Pegasi, Betelgeuse (~760 R☉ red supergiant), Polaris, Rigel, Antares, Kepler-186** — plus Orion Nebula, Pleiades, Crab, Eagle, Carina nebulae and ~150 procedural halo globulars (data in research notes; approximate l,b positions fine).

### 6.5 Rendering the galaxy (Elite Dangerous technique)
- **Live shell** (< ~20 pc): stars = `InstancedMesh` billboard quads + `SpriteNodeMaterial`, additive, depthWrite off (official `webgpu_tsl_galaxy` pattern; 100k+ instances is one draw call). Size ∝ magnitude, clamp ≥1 px, dump sub-pixel energy into brightness.
- **Everything beyond**: on every hyperjump, a worker re-bakes a **6×2048 cubemap skybox** of the whole galaxy from the new position — density-field volume splats + far catalog stars. PMREM it → it's also `scene.environment`. Parallax on nearby stars during warp comes free from the live shell.
- **Base backdrop art**: NASA SVS Deep Star Maps 2020 (galactic-coords EXR, HDR): `https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/starmap_2020_16k_gal.exr` (also 4k/8k/32k/64k). Credit "NASA/Goddard SVS; Gaia DR2: ESA/Gaia/DPAC". Convert offline to KTX2/BC6H cubemap. From Sol the skybox ≈ this real map; procedural bake takes over as you travel.
- Galaxy map mode: separate scene, orbit camera, A* route plotting within jump range, render-on-demand.

---

## 7. Scale Strategy + The Solar System

**Locked decision:** 1:1 interstellar distances (real HYG positions), **1/10 linear scale inside systems** (planet radii AND orbital radii ×0.1), real surface gravity kept. KSP proved nobody notices the density fudge; orbits happen in minutes; `SCALE = 0.1` multiplies every table below at load.

Starting system = Sol, real data (JSON in `/data/solar-system.json`):

| Body | R (km) | GM (km³/s²) | a (10⁶ km) | P_orb (d) | P_rot (h) | tilt° | e |
|---|---|---|---|---|---|---|---|
| Sun | 695,700 | 1.32712440018e11 | — | — | 601.2 | — | — |
| Mercury | 2,439.7 | 22,032 | 57.909 | 87.969 | 1407.6 | 0.034 | 0.2056 |
| Venus | 6,051.8 | 324,859 | 108.210 | 224.701 | −5832.5 | 177.36 | 0.0068 |
| Earth | 6,371.0 | 398,600.435 | 149.598 | 365.256 | 23.9345 | 23.44 | 0.0167 |
| Mars | 3,389.5 | 42,828.4 | 227.956 | 686.980 | 24.6229 | 25.19 | 0.0935 |
| Jupiter | 69,911 | 1.26686534e8 | 778.479 | 4,332.59 | 9.9250 | 3.13 | 0.0489 |
| Saturn | 58,232 | 3.7931187e7 | 1,432.041 | 10,759.22 | 10.656 | 26.73 | 0.0565 |
| Uranus | 25,362 | 5.793939e6 | 2,867.043 | 30,688.5 | −17.24 | 97.77 | 0.0457 |
| Neptune | 24,622 | 6.836529e6 | 4,514.953 | 60,182 | 16.11 | 28.32 | 0.0113 |

Moons: Luna (R 1737.4, GM 4902.8, a 384,400 km, P 27.32 d), Io, Europa, Ganymede, Callisto, Titan, Enceladus (values in research notes/NASA fact sheets; all tidally locked). Saturn rings: 66,900→136,780 km, Cassini division 117,580–122,170 km — textured annulus with alpha (§15), cast ring shadows on Saturn via projected texture.

Planet positions from JPL approximate Keplerian elements (https://ssd.jpl.nasa.gov/planets/approx_pos.html), epoch-propagated — planets genuinely orbit.

Atmospheres (per-body, §8.3 + §9.3): Earth (101.3 kPa, H 8.5 km, blue Rayleigh), Mars (0.61 kPa, H 11.1 km, butterscotch sky/blue sunsets), Venus (92 bar, H 15.9 km, orange gloom), Titan (1.45 bar, orange haze, g = −0.52 backscatter). Airless: Mercury, Luna, the icy moons → black sky, stars in daytime.

Beyond Sol: every star system procedurally generated from `systemSeed` — planet count/types/orbits from the star's class, using the same body pipeline.

---

## 8. Planets — orbit-to-ground

### 8.1 Cube-sphere quadtree terrain
6 face quadtrees, vertices `normalize(cubePos)·(R + h)` with COBE tangent adjustment (equal-area). 33×33-vertex patches; **~19 levels** takes Earth-size (even at 1/10 scale: ~16 levels) to sub-meter. Split when `dist < 2.5 × nodeSize`; enforce neighbor LOD Δ ≤ 1. **Crack fix: skirts** (border verts extruded down 5% of node size) for v1; CDLOD morphing later if popping bothers. ~300–600 live patches typical. Collision: Rapier heightfield colliders generated only for leaf patches within 2 km of the player.

### 8.2 Terrain generation (GPU-first)
TSL compute (`Fn().compute(count)`, `renderer.computeAsync`) writes one 256² R32F heightmap tile per node on demand; MaterialX noise is built into TSL (`mx_fractal_noise_float`, `mx_worley_noise_float`). CPU worker-pool fallback (`simplex-noise@4`) on WebGL2. LRU tile cache. Normals from central differences in the same pass — never per-frame.
Recipes: continents = 8–16-octave fBm (split octaves by LOD depth); mountains = Musgrave ridged multifractal; erosion look = domain warp `fbm(p + 4·fbm(p + 4·fbm(p)))`; moons = Lague crater formula (`cavity = x²−1`, rim `rimSteepness·min(x−1−rimWidth,0)²`, smoothMin/Max blend, power-law sizes `N(>D) ∝ D⁻²`). Splat by slope/altitude/latitude: rock/sand/grass/snow/ice from §15 CC0 sets, triplanar.
Earth/Mars/Luna get **real** albedo (§15 maps) blended with procedural detail; real DEMs optional via NASA Trek WMTS tiles (`https://trek.nasa.gov/tiles/...` — verified, public domain, bot-accessible).

### 8.3 Atmosphere — Bruneton precomputed scattering
Use `@takram/three-atmosphere` (WebGPU core done — pin latest; currently Earth-tuned) OR port jeantimex's three.js Bruneton to TSL with per-planet LUT precompute (transmittance 256×64, scattering 256×128×32, irradiance 64×16 — seconds on GPU, cache per planet type). **Verified coefficients (km⁻¹):**
- **Earth**: Rayleigh β (0.0058, 0.0135, 0.0331), H_R 8; Mie β_s 0.004, H_M 1.2, g 0.8; ozone tent 10–40 km peak 25.
- **Mars**: Rayleigh β (0.0199, 0.0136, 0.0058) — *reversed → butterscotch days, blue sunsets*; H_R 10.44; dust Mie β_s 0.0536, ext 0.2247, H_M 3.1.
- **Titan**: Rayleigh (0.0053, 0.0127, 0.0313), H_R 20; haze Mie β_s (0.005, 0.012, 0.08), **g = −0.52**, H_M 14.85.
The atmosphere is a screen-space effect active at any distance → planets have glowing limbs from orbit for free.

### 8.4 Clouds, ocean, night
- Clouds v1: textured translucent sphere at R+5 km (real Earth cloud map §15, procedural Worley for others), scrolling, normal-mapped self-shadow. v2: HZD-style raymarched volumetrics within 50 km of surface (128³ Perlin-Worley base + 32³ detail via TSL compute, ½-res + temporal reproject, 64–128 steps, Beer-Powder `2e^{-d}(1−e^{-2d})`) — budget 2 ms.
- Ocean: second cube-sphere at sea level; from orbit = albedo + GGX sun glint; below 50 km add normal-map waves → optional FFT displacement (reference: Spiri0/Threejs-WebGPU-IFFT-Ocean). Water absorption `exp(−k·depth)`, k = (0.46, 0.09, 0.06) m⁻¹. Shore foam where height-above-seabed < threshold.
- Night side: Black Marble emissive map for Earth; procedural city masks (Worley clusters × flat × low × coastal, 2200–3000 K warm) for colonized procgen worlds. Terminator: `smoothstep(−0.12, 0.12, dot(N, sunDir))`, emissive × bloom.

---

## 9. Physics

### 9.1 Ship 6DOF (fixed dt 1/60, semi-implicit Euler — NOT RK4; forces are control inputs)
State: p (f64), v, quaternion q, ω (body). Inertia: box approx `I = m/12·diag(sy²+sz², sx²+sz², sx²+sy²)`, m = 50 t. Gyroscopic term stays: `ω̇ = I⁻¹(τ − ω×(Iω))`.
Per-axis authority (GRIDCORP, heavy-fighter feel): main +Z⁻ 50 m/s², retro 30, lateral/vertical RCS 20, **boost ×2 for 4 s** (heat-gated, §9.4); angular accel pitch 2.5 / yaw 1.5 / roll 4.0 rad/s²; max rates pitch 60°/s, yaw 45°/s, roll 143°/s.

**Flight assist** (exponential setpoint tracking): `a_cmd = clamp((v_target − v)/τ, authority)`, τ_lin 0.4 s, τ_rot 0.2 s. Modes: **coupled** (both loops), **decoupled** (V key: linear loop off, Newtonian drift, rotation assist stays), **FA-off** (all off + tiny damping). G-meter: `g = |a_cmd − g_local|/9.81`; grey-out > 6 g sustained, blackout > 9 g.

### 9.2 Orbits — patched conics, on-rails (NO n-body)
Planets/moons on fixed Keplerian rails (analytic at any t — free time-warp, zero drift). Ship: on-rails when unpowered outside atmosphere; integrated with single dominant-body gravity `−μr̂/r²` when thrusting/in-atmo. SOI handoff `r_SOI = a(m/M)^(2/5)` → convert state vector, recompute elements.
Kepler solver (Newton–Raphson, 3–5 iters):
```js
function solveKepler(M, e){ let E = e<0.8 ? M : Math.PI*Math.sign(M||1);
  for(let i=0;i<30;i++){ const dE=(E-e*Math.sin(E)-M)/(1-e*Math.cos(E)); E-=dE; if(Math.abs(dE)<1e-12)break; }
  return E; }
// ν = 2·atan2(√(1+e)·sin(E/2), √(1−e)·cos(E/2)); r = a(1−e·cosE); rotate by Ω,i,ω
```
Hyperbolic (escape): solve `M = e·sinhF − F`. Checkpoints to unit-test: Earth v_circ(200 km) = 7.784 km/s, T = 88.5 min; v_esc surface = 11.186 km/s. (At 1/10 scale, velocities scale by √0.1 ≈ 0.316 — verify tests against scaled values.)
Time warp: on-rails 1×→100,000×; physics-bubble integration capped at 4×; forbidden in atmosphere/thrusting.

### 9.3 Atmosphere & reentry
`ρ(h) = ρ0·exp(−h/H)` — Earth (1.225, 8500 m), Mars (0.020, 11100), Venus (65.0, 15900), Titan (5.4, 21000).
Drag `F = ½ρv²·CdA` (CdA ≈ 6 m² clean, 60 m² airbrake); lift `CL = clamp(4.5α, ±1.4)`, stall 16°; induced drag `Cd0 0.025 + CL²/(π·AR·e)`.
**Space begins where ρ < 1e-5 kg/m³** → `h_space = H·ln(ρ0/1e-5)` (Earth 99.6 km — the real Kármán line falls out). Reentry: Sutton-Graves `q̇ = 1.7415e-4·√(ρ/Rn)·v³`; plasma VFX > 100 kW/m², full streamers > 1 MW/m²; buffet/shake ∝ dynamic pressure from 5 kPa (Max-Q beat ~30 kPa); external audio fades with pressure, silent above ~60 km.

### 9.4 Infinite fuel, honest feel
No fuel counter. Keep TWR 1.3–2.0 so climbs are earned; heat gates boost (builds during boost/reentry, cools otherwise); Max-Q shake punishes going too fast too low. Ascent profile that should emerge naturally: vertical to 1 km → pitch-over 5–10° → gravity turn following prograde (scripted assist: `pitch = 90°(1−√(h/65 km))`) → horizontal insertion burn. ~8 min to orbit real-scale; minutes at 1/10.

### 9.5 Warp (in-system) + Hyperjump (interstellar)
**Warp = Elite-style distance-slaved speed cap** (stateless, auto-slows near masses):
```
v_cap = clamp( min(d_nearestBodySurface, d_target) / t_brake, 30 km/s, 20c )   // t_brake = 7 s
v += (throttle·v_cap − v)·(1 − exp(−dt/τ)),  τ = 3 s accel / 1.5 s brake
```
Charge 3 s (align + spool, SC-style) → tunnel VFX (FOV 90°, radial star streaks, chromatic aberration) → auto-drop at `d_target < 1 Mm ∧ v ≤ d/t_brake`; emergency drop = cooldown + heat + camera slam. 20c gives Earth→Mars in ~30–75 s and the cap makes every arrival cinematic.
**Hyperjump**: select star in map (range-gated by drive tier, e.g. 40 ly) → align → 5 s charge → 12 s tunnel (fixed, it's the loading screen) → drop at 0.01 AU facing the arrival star's corona. Workers generate the destination system during the tunnel.

### 9.6 Local physics bubble (Rapier)
One Rapier world riding the player: only objects within ~3 km get rigid bodies; everything else analytic/frozen. Frames: landed/atmo = planet-surface rotating frame (gravity −g·up); space = dominant-body inertial. Rails→bubble: evaluate Kepler state, spawn body with p,v. Bubble→rails: rv→elements, despawn (gate: no thrust, no atmo, no contacts). Rebase per §4.1. `world.timestep = 1/60` inside the accumulator, ≤ 200 active bodies.

---

## 10. Landing & Liftoff (the showpiece — every beat animated)

Autopilot state machine (manual flight always allowed; autoland = hold N):
```
ORBIT → DEORBIT_BURN → COAST → ENTRY → ATMO_DESCENT → FINAL_DESCENT → TOUCHDOWN → LANDED  (LIFTOFF reverses)
```
| state | control law | animation beats |
|---|---|---|
| DEORBIT_BURN | burn retro until periapsis ≈ 25 km (or below surface for airless) | HUD "AUTOLAND", retro flare, attitude swing |
| ENTRY | hold retrograde ±α | **plasma sheath** (emissive fresnel shell shader, q̇-driven), trauma shake ∝ q_dyn, comm-static audio |
| ATMO_DESCENT | pitch to bleed speed; proportional navigation to pad: `a = N·λ̇×v_closing`, N = 4 | contrails, wing-level flare, buffet easing |
| FINAL_DESCENT | `v_target = −clamp(h_AGL/5 s, 2, 60)` m/s; `throttle = clamp((g + 2(v_t−v))·m/T_max, 0, 1)`; horizontal kill: critically-damped PD τ_p 5 s | **gear deploys at h < 500 m (1.2 s strut animation)**, landing lights, thrust-scaled dust VFX < 50 m (GPU particles), engine pitch-down whine |
| TOUCHDOWN/LANDED | cut thrust at contact & \|v\| < 1 m/s | gear compression (spring 0.15 m), settle rock, spin-down, reactor dims to idle, wing-fold option (WingLeft/Right rotate at roots — the rig exists, §2.2) |
| LIFTOFF | spool 2 s → +30 m/s vertical to 500 m → gravity turn or manual | dust blast, gear retract at h > 100 m, reactor flare `#FFC671` → white-hot |
Suicide-burn check for airless bodies: start braking at `h = v²/(2(a_max − g))·1.15`.

---

## 11. On-Foot FPS Mode

Rapier `KinematicCharacterController` (verified API): capsule(halfHeight 0.6, r 0.3) = 1.8 m; kinematicPositionBased body; `createCharacterController(0.01)`; autostep(0.4, 0.2, true); snapToGround(0.4) — **disable while jump ascending**; slopes climb 45°/slide 30°; manual gravity (KCC applies none): `verticalVel −= g·dt`, jump v = 4.43 m/s (1 m at 1 g; constant-v across bodies → floaty Moon jumps 6 m, cap 4 m; below g < 0.5 switch to jetpack EVA 6DOF).
**Spherical gravity**: per tick `up = normalize(pos − planetCenter)`; `cc.setUp(up)`; capsule rotated to match; heading parallel-transported: `yawQuat.premultiply(setFromUnitVectors(prevUp, up))`. Never Euler/lookAt on a sphere.
**Ship enter/exit** (freeze-the-ship pattern — locked decision): ON_FOOT → E at hatch (3 m interaction raycast, INTERACTABLE collision group) → ENTERING 0.7 s camera slerp to seat → PILOTING (character body disabled, ship dynamic) → EXITING reverse (ship → Fixed, store velocity, restore on re-entry). Exit in space only at ~0 relative velocity. Walk speeds 2.5 / 6.0 sprint / 1.2 crouch m/s, accel `1−exp(−10dt)`, air control 0.25×, eye 1.62 m.

---

## 12. Input & Camera

### 12.1 Bindings (defaults; fully rebindable via serialized ActionMap — `KeyboardEvent.code` only)
**SHIP**: mouse = pitch/yaw (virtual-joystick: reticle in 250 px circle → rate; NOT raw delta) · Q/E roll · W/S fore/aft · A/D lateral · Space/Ctrl vert · wheel throttle · X all-stop · Z full · Shift boost · T flight-assist · V decouple · N gear (hold = autoland) · B warp spool/hold-engage · J hyperjump · G cycle target · MMB target reticle · R flight-ready · L lights · Y-hold exit seat · Alt-hold freelook · F4 third-person · F2 starmap · F9 photo · Esc pause.
**FOOT**: WASD · Shift sprint · Space jump · Ctrl crouch · F interact (hold = context) · T flashlight · F4 cam.
**MAP**: LMB orbit, MMB pan, wheel zoom (`r *= 0.9^steps`), click select, Enter plot route.
Gamepad (poll `navigator.getGamepads()` once per frame, `mapping === "standard"` only): radial deadzone 0.12 rescaled, cubic blend `lerp(v, v³, 0.6)` look / 0.3 move; LS strafe, RS pitch/yaw, LB/RB roll, RT boost, A spool, B gear, X FA, L3 decouple. Rumble on boost/landing/warp.

### 12.2 Pointer lock (2026 rules)
`canvas.requestPointerLock({unadjustedMovement: true})` → Promise; catch `NotSupportedError` → plain lock (Safari). Only from user gestures. Esc force-unlocks → auto-open pause menu; re-lock only via "Click to resume" (Chrome enforces ~1.25 s cooldown). Sum `getCoalescedEvents()` deltas; drain accumulated deltas once per frame. `visibilitychange`/`blur` → release all held keys. **Don't use PointerLockControls** — custom ~40-line lock manager + quaternion rig.

### 12.3 Camera rig
One PerspectiveCamera; modes output `{pos, quat, fov}`; rig blends (0.4–0.8 s smoothstep, slerp). All smoothing frame-rate-independent: `x += (t−x)(1−exp(−λdt))`.
- **Cockpit** (60°): at §2.2 anchor; freelook Alt (yaw ±160°, pitch −60/+80, return 0.3 s); G-lag head offset `−a·0.0015 m`, clamp 0.12 m.
- **Chase** (55°): arm 2.2× ship length, +12°; λ_pos 12, λ_rot 8; velocity lead 0.3×length; sphere-cast collision; RMB orbit, snap-back 1.5 s.
- **FPS** (70°): eye 1.72/1.2 m, pitch ±89°, yaw on up-aligned body quat; headbob 0.035 m at 1.4/2.2 Hz (toggle); sprint +8°.
- **Map**: orbit rig, inertia λ 5; double-click flies to body 0.8 s.
- FOV kicks: boost 60→75° in 0.25 s; warp spool→68°, engage snap 90° + streaks, exit →60° in 0.6 s. Always `updateProjectionMatrix()`.
- **Shake = trauma model**: trauma ∈ [0,1], `shake = trauma²`, 3 Perlin channels @ 18 Hz, roll ±0.06 rad, pitch/yaw ±0.04, pos ±0.06 m; decay 1.2/s. Events: landing +0.3, warp exit +0.5, reentry floor 0.3, boost floor 0.15.

---

## 13. HUD / UI

- **Menus/settings/map overlays: DOM+CSS** over the canvas (`pointer-events` targeted). **Flight HUD: transparent 2D canvas** redrawn per frame (velocity ladder, prograde/retrograde markers, target box, orbit readouts Ap/Pe/period, radar sphere, warp gauge, G-meter, heat bar, gear/FA/decouple flags, landing pips).
- 3D→2D: `v.project(camera)`, clamp off-screen targets to edge ellipse with arrows.
- Cockpit diegetic panels (v2): CanvasTexture quads.
- Fonts (Google Fonts, OFL, self-host via @fontsource): **Orbitron** (titles), **Rajdhani** (HUD numerals), **Share Tech Mono** (telemetry), Exo 2 (body).
- Galaxy map: own scene — instanced stars, arm density fog sprites, route lines, search box (DOM), filters by class/visited. System map: top-down orbit lines, click-to-set-warp-target.
- Screen flow: Boot ("click to launch" — unlocks AudioContext + pointer lock) → hangar-ish start on Earth pad → play. Pause = Esc. Photo mode F9 (free cam, hide HUD, path-trace button §5.1). Credits screen from §15 (legally required).

---

## 14. Audio

WebAudio graph; **AudioContext must resume inside the boot click** (autoplay policy). Layers: reactor hum (throttle-pitched), RCS ticks, boost roar, warp spool/tunnel/drop, atmospheric wind ∝ q_dyn (silent in vacuum — filter exterior sounds by ρ), landing gear clunks, UI blips, on-foot footsteps by material. Interior vs exterior mix switch with camera. Sources (§15): Kenney (CC0) first, OpenGameArt CC0 packs; anything CC-BY → credits screen.

---

## 15. Asset Manifest (all URLs verified live 2026-07-06; pipeline: download → KTX2/meshopt via gltf-transform → /public)

**Planet maps — Solar System Scope, CC BY 4.0 (credit required)** — pattern `https://www.solarsystemscope.com/textures/download/{2k|4k|8k}_{name}.{jpg|tif|png}`:
`8k_earth_daymap.jpg`, `8k_earth_nightmap.jpg`, `8k_earth_clouds.jpg`, `8k_earth_normal_map.tif`, `8k_earth_specular_map.tif`, `8k_mercury.jpg`, `8k_venus_surface.jpg`, `4k_venus_atmosphere.jpg`, `8k_mars.jpg`, `8k_jupiter.jpg`, `8k_saturn.jpg`, `2k_uranus.jpg`, `2k_neptune.jpg`, `8k_moon.jpg`, `8k_sun.jpg`, `8k_saturn_ring_alpha.png`.
**NASA (public domain)**: Blue Marble 21600×10800 `https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73909/world.topo.bathy.200412.3x21600x10800.jpg`; Black Marble 13500×6750 `https://eoimages.gsfc.nasa.gov/images/imagerecords/79000/79765/dnb_land_ocean_ice.2012.13500x6750.jpg`; cloud map TIF `https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud_combined_8192.tif`. Real Moon/Mars tiles: NASA Trek WMTS (`https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{z}/{row}/{col}.jpg`, same for `Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m`). USGS direct GeoTIFFs exist but bot-block — browser-download if needed.
**Skybox**: NASA SVS starmap `starmap_2020_16k_gal.exr` (§6.5). **Stars**: HYG v4.3 (§6.4).
**PBR (CC0, no attribution)**: Poly Haven `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/{id}/{id}_{diff|nor_gl|rough|metal|ao}_2k.jpg` → `metal_plate_02` (hull hero), `blue_metal_plate`; ambientCG `https://ambientcg.com/get?file={ID}_2K-JPG.zip` → `Metal032`, `PaintedMetal001`, `Rubber004`, `MetalPlates006`; terrain: `Rock035`, `Ground054`, `Grass001`, `Gravel022`, `Ice004`, Poly Haven `aerial_rocks_02`, `snow_02`, `sandy_gravel`. Lookdev HDRI: `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/4k/satara_night_no_lamps_4k.hdr` (CC0).
**Audio**: Kenney Sci-Fi Sounds + Interface Sounds (CC0) `https://kenney.nl/assets/sci-fi-sounds`; OpenGameArt "7 Space Sounds" (CC0).
**Do NOT ship**: nidorx/matcaps (unlicensed scrapes). Optional CC-BY cockpit mesh v2: Sketchfab "Spacefighter Cockpit (Wasp Interdictor)" by Comrade1280 (16 k verts).

**Credits screen (required):** Solar System Scope (CC BY 4.0) · NASA/Goddard SVS, Gaia DR2: ESA/Gaia/DPAC · HYG/AT-HYG © David Nash astronexus.com (CC BY-SA 4.0) · any Sketchfab CC-BY model · any CC-BY audio. Courtesy: NASA Earth Observatory, USGS Astrogeology. Ship OFL texts with fonts.

---

## 16. Performance Budget (60 fps = 16.67 ms) + fallback ladder

| slice | budget | enforcement |
|---|---|---|
| logic | ≤ 2 ms | perf brackets in debug HUD (F3) |
| Rapier | ≤ 2 ms | ≤ 200 active bodies, sleep aggressively |
| streaming (main) | ≤ 1 ms | all gen in workers/GPU; ≤ 2 geometry uploads/frame |
| render CPU | ≤ 4 ms | < 300 draw calls (InstancedMesh/BatchedMesh) |
| GPU | ≤ 10 ms | WebGPU timestamp queries via stats-gl@3.6 |

Triangles ≤ 2 M/frame. Memory ≤ 2 GB (wasm32 caps at 4 GB): 512 MB texture pool, LRU-evict terrain tiles. Workers: `hardwareConcurrency − 2` pool for terrain/procgen (transferables). Quality ladder (auto-detect + settings): Ultra (SSGI+SSR+volumetric clouds) → High (SSR, sphere clouds) → Medium (GTAO only, FXAA) → WebGL2-fallback (no SSGI/SSR/compute; CPU terrain workers; log depth; FXAA). Tooling: stats-gl, WebGPU Inspector, lil-gui tuning panel behind F3.

---

## 17. Milestones — build in this order; each ends RUNNING and VERIFIED

Each milestone = branch + demoable state + the listed acceptance test. Don't start N+1 until N's test passes at 60 fps.

- **M0 — Lookdev**: Vite+TS+WebGPURenderer boot; gridcorp loaded, stripped, re-materialed (§2.3); HDRI + sun; post stack (bloom-MRT, GTAO, TRAA, AgX); orbit camera. ✓ *Ship looks AAA, reactor blooms orange, zero gray meshes, 60 fps.*
- **M1 — Flight**: fixed loop, IntentFrame input, pointer lock, 6DOF + flight assist (coupled/decoupled), cockpit+chase cameras, engine glow/exhaust particles throttle-driven, HUD v1 (velocity, orientation ladder). ✓ *Flying feels like SC arena mode in an empty starfield.*
- **M2 — Sol on rails**: f64 frames + camera-relative rendering + far/near composite; all planets/moons on Kepler rails at 1/10 scale; sun light + eclipses; Saturn rings; planet proxies with real textures; system map. ✓ *Warp-less cruise past textured Jupiter; no jitter at Neptune (log the f32 error to prove it).*
- **M3 — Warp**: distance-slaved warp + tunnel VFX + FOV/shake choreography; system map targeting. ✓ *Earth→Mars in ~60 s with cinematic auto-arrival.*
- **M4 — Planet terrain**: cube-sphere quadtree + TSL compute heightmaps + skirts + triplanar splats; Luna first (airless, craters), then Mars. Collision patches. ✓ *Orbit→100 m hover→touch terrain anywhere, no cracks/pops, 60 fps.*
- **M5 — Atmosphere & landing**: Bruneton (Earth/Mars/Titan params), exponential density + drag + reentry plasma/heat/shake, autoland state machine, procedural gear, dust, full beat sheet (§10). ✓ *One unbroken shot: deorbit → plasma → gear → touchdown on Mars at sunset (blue sunset visible).*
- **M6 — Earth**: real albedo/night/clouds/ocean + terrain detail blend; city night glow; cloud layer. ✓ *The money shot: sunrise over Earth from orbit.*
- **M7 — On foot**: KCC + spherical gravity + enter/exit choreography + freeze-ship. ✓ *Land anywhere, walk around the ship, jump (floaty on Luna), climb back in, fly away.*
- **M8 — The galaxy**: density field + arms + HYG stars + galaxy map + hyperjump + skybox re-bake worker + procgen systems (seed hierarchy). ✓ *Jump to Proxima Centauri; skybox visibly changed; land on a procgen world; save/reload restores everything deterministically.*
- **M9 — Audio + UI polish + photo mode**: full soundscape, menus, settings (rebinding, quality ladder), credits screen, path-traced photo mode. ✓ *Complete game loop, ship it.*
- **M10 — Sgr A\***: the pilgrimage. Nuclear star cluster, accretion glow, lensing shader. ✓ *Flying to the center of the galaxy is worth the trip.*

**Standing rules while building:** verify each milestone by running it (screenshots at minimum); keep a `DECISIONS.md`; commit per milestone; when a library API mismatches this spec (three moves fast), trust the installed version's types/examples over the spec and note the delta; keep all magic numbers in `/data/constants.ts` mirroring the tables above.

---

## 18. Primary references (already distilled above — consult only when stuck)

Reid et al. 2019 (arXiv:1910.03357) · GRAVITY 2022 (Sgr A*) · NASA planetary fact sheets (nssdc.gsfc.nasa.gov) · JPL approx_pos · Bruneton scattering (ebruneton + jeantimex ports, OpenSpace params) · CDLOD (Strugar) · HZD clouds (SIGGRAPH 2015) · Gaffer "Fix Your Timestep" · rapier.rs character-controller docs · three.js r185 examples: `webgpu_tsl_galaxy`, `webgpu_postprocessing_bloom_emissive`, `webgpu_postprocessing_ssgi`, `webgpu_reversed_depth_buffer`, `webgpu_shadowmap_csm`, `webgpu_compute_particles` · Repos to study: takram-design-engineering/three-geospatial, BarthPaleologue/CosmosJourneyer, gkjohnson/three-gpu-pathtracer, Spiri0/Threejs-WebGPU-IFFT-Ocean, SebLague/Solar-System (crater math).
