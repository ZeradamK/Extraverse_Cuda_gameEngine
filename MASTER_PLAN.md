# EXTRAVERSE — Master Plan: the Base, built for the RL Layer

**Thesis (locked):** EXTRAVERSE the game is the flagship demo and the environment library. The company is the layer above it — *prompt → WorldSpec → 3D environment → agent task → reward → evaluation → export* (see `3D-RL-layer`). Every milestone below builds the base **as if the RL layer already existed**: features land as *data (specs)*, not code; determinism and headless-testability are acceptance criteria, not afterthoughts; every environment doubles as a training gym.

Sources consolidated: `EXTRAVERSE_BUILD_PROMPT.md` (M0–M10, shipped), `GameEngine_startup.md` (startup thesis), `3D-RL-layer` (RL environment compiler plan), owner direction 2026-07-09 (research-grade Sol system end-to-end incl. the Sun; multi-galaxy reach kept playable via warp). *This revision incorporates a 3-lens adversarial review (feasibility vs codebase / fidelity vs sources / science & licensing) — 2026-07-09.*

---

## 0. Doctrine — four rules every milestone obeys

1. **Worlds are data.** Anything we add (a moon, an atmosphere, a storm, a mission) must be expressible in the WorldSpec IR so a prompt-agent can later generate it. If a feature can only be created by writing TypeScript, it's not done.
2. **Deterministic and headless.** Same seed + same inputs = same world and same physics trajectory, in a browser or in Node. Every milestone ships headless tests; anything that breaks replay determinism (wall-clock, `Math.random`) is a bug. *Scope note: the replay-determinism gate covers the ship sim (pure TS). On-foot mode uses Rapier's standard build, which is NOT cross-platform deterministic — foot-mode training/eval is pinned to one platform until we adopt Rapier's enhanced-determinism build.*
3. **Accuracy = cited + CI-validated, at the right scale.** We never claim "99% accurate." We cite the source model per system and publish error bounds from automated validation. **Research-grade numbers are validated at REAL scale in sim-core; the browser game renders a 1/10 presentation of the same spec** (see the Scale Decision, S0.1). Where gameplay stylizes reality (asteroid density, CME sheltering), `VALIDATION.md` says so explicitly with the real number next to the chosen one.
4. **Playable after every step.** Realism never means boredom: adaptive velocity, warp, hyperjump, and time acceleration are the contract. A playability regression (like the 250 m/s "frozen Earth") is a release blocker.

## 1. Where the base stands today (as-built, 2026-07-09 — review-verified)

Proven substrate (M0–M10 complete; 130 unit tests + 11-gate gameplay smoke + E2E, all passing):
- WebGPU/three.js r185 renderer, f64 camera-relative sim (no jitter at Neptune), post stack (GTAO/TRAA/bloom).
- All 8 planets + Sun on JPL Kepler rails; Saturn's ring rendered; 7 moons on rails (Luna textured + libration; Io, Europa, Ganymede, Callisto, Titan, Enceladus as tinted spheres). **Moon phases are invented constants (`phase0`), not ephemeris-true — Titan is in the wrong place at every real epoch.**
- Landable streamed terrain: **Luna, Mars, Earth only**. Atmospheres + entry: **Venus, Earth, Mars** (single-exponential density; Earth's Sutton–Graves k applied to all bodies — both to be upgraded in S2).
- Flight: 6DOF Newtonian, adaptive velocity (distance-slaved cap to 4,000 mi/s), afterburner, autoland, on-foot (Rapier), in-system warp, hyperjump across 5,161 real HYG stars + procgen systems + Sgr A*.
- **Agent-testability (our unfair advantage):** `window.__XV` + Playwright harness boots the real game, flies, lands, walks, jumps systems, and gates on 11 gameplay assertions. The `3D-RL-layer` playtester exists in embryo.
- **Known debts (from review):**
  - *Determinism:* procgen fully seeded ✓, fixed 60 Hz step for flight ✓ — **but** rails advance on render `dtReal` and the local-frame carry runs per render frame outside the fixed loop → replays are frame-rate coupled as-built. Epoch uses `Date.now()`. Rapier cross-platform determinism unverified.
  - *Scale:* SYSTEM_SCALE 0.1 with μ×0.01 preserves surface gravity but rails use real periods at 0.1× distances → rail velocities are 3.16× faster than dynamically consistent orbits. Fine as game fiction; **incompatible with orbital-fidelity claims** — resolved by the Scale Decision below.
  - *IP:* shipping Earth day/night/cloud textures were binary-extracted from a `.spline` file (provenance unknown); HYG is CC BY-SA (share-alike attaches to `stars.json`); Solar System Scope requires visible attribution. Remediation is S0.4.
  - *No CI exists* (no `.github/workflows`); the smoke gate needs a GPU and runs headed on this Mac.
  - *No entity/mission runtime, no drone/rover embodiments, no Python bridge* — all scheduled below.

---

## 2. Phase S0 — Foundation (first in dependency order; everything compounds on these)

### S0.0 CI that can actually enforce the doctrine
- GitHub Actions: typecheck + vitest + all headless sim checks (no GPU needed) on hosted runners; the WebGPU smoke gate runs on a **self-hosted Mac runner** (this machine or a Mac mini).
- Validation data (Horizons states, atmosphere profiles) is committed as **cached golden fixtures** with a weekly refresh job — CI never depends on a live external API.
- Acceptance: a PR that breaks a unit test, the replay hash, or the smoke gate cannot merge.

### S0.1 WorldSpec IR v0 — *the moat starts here*
Formalize the implicit schemas (`PlanetDef`, `MoonDef`, `AtmoDef`, `TerrainOptions`, `ProcSystem` seeds) into one versioned, serializable **WorldSpec**:
```
WorldSpec {
  meta { version, name, seed, epoch, scale }          // scale: 1.0 (truth) | 0.1 (presentation)
  physics { integrator, timestep, gravityModel }       // PhysicsSpec — top-level, per source plan
  scene; bodies[]; terrains[]; atmospheres[]; hazards[];
  entities[]; agents[]                                 // AgentSpec { embodiment, sensors[], actions } per 3D-RL-layer
  tasks[]; rewards[]; resets[]; randomization; metrics; exportTargets
}
```
- **The Scale Decision (blocker fix):** `meta.scale` is first-class. sim-core computes at **real scale with real μ** when asked; the 0.1 game presentation is a render-time mapping of the same spec. All S6 validation and all R-phase GNC training/export run at scale 1.0. Drone/rover verticals are already scale-clean (surface g and ρ real, terrain in absolute meters).
- Terrains carry `verticalScale` (1.0 slope-true for RL export; 0.1 proportional for game globes) and `tileSource` (procedural | DEM tile URL) so real-data terrain is data, not a code path.
- Sol ships as `worlds/sol.worldspec.json`; the game boots from it; procgen systems emit WorldSpecs; specs round-trip byte-identically. Player saves get schema versioning + a committed v1 fixture migration test.
- **RL hook:** this IS the `3D-RL-layer` WorldSpec, including `physics`, and `sensors`/`actions` nested in `AgentSpec` exactly as the source specifies.
- Acceptance: game boots from spec; JSON-schema validation in CI; procgen round-trip; v1 save loads after migration.

### S0.2 Headless sim-core — *the load-bearing wall (rescoped: this is a game-loop re-architecture, not a file move)*
- Extract the pure modules (`flight`, `solSystem`, `kepler`, `environment`, `autoland`, `warpDrive`, heightfields/collision — verified near-zero DOM deps; land-mask gets a Node decode path) **and port the ~400 lines of orchestration living in `main.ts`**: the fixed-step accumulator, rails/carry/collision/pin/warp interlocks all move into `simcore.step(tick)`. **Rails and frame-carry advance on tick count, not `dtReal`** — this fixes the frame-rate-coupled replay debt. The renderer becomes a reader of sim state.
- Seeded epoch (kill `Date.now()`); recorded-replay determinism test (ship sim; 1,000-tick trajectory hash equal across runs and platforms).
- Gym-shaped API: `env = simcore.load(worldspec); obs = env.reset(seed); {obs, reward, done, info} = env.step(action)`.
- Acceptance: **≥10,000 `env.step()`/s single-threaded** with flight + atmosphere + collision active (a real benchmark — closed-form Kepler alone proves nothing); deterministic replay in CI; the game still passes all tests + smoke.

### S0.3 AgentBridge — observations/actions as a contract
- Grow `__XV` + input injection into `observe()/act()`, identical in-browser and headless. Analytic sensors first (pose, velocity, altitude, target vector, ray-distance/depth probes); RGB camera observations are explicitly **later** (headless GPU render worker or browser-side capture — named R-phase work, not smuggled into sim-core).
- The new AgentBridge smoke harness runs **in parallel with** the existing timing-based harness until it has a week of green soak; only then retire the old gates.
- Acceptance: smoke passes via AgentBridge; a scripted "fly to Luna and land" agent completes headless (gates Demo One, not S1).

### S0.4 Asset provenance (IP remediation — before anything commercial)
- Replace the Spline-extracted Earth textures with NASA **Blue Marble / Black Marble** (public domain, equal/better resolution). Create `LICENSES.md` — one entry per asset/dataset (source, license, obligations). Render all CC attributions in a credits UI (HYG CC BY-SA, Solar System Scope CC BY). Note for later steps: ESA/Rosetta assets are CC BY-SA IGO (share-alike) — prefer procedural comet nuclei from published shape statistics; "GRAM-style" atmosphere variability means *our own implementation from published profiles*, never embedded Mars-GRAM/MCD output (license-restricted).

*No calendar — we move as fast as the gates go green. Only the dependency rule holds: S0.1/S0.2 interface agreement blocks everything downstream; implementations overlap S1 freely.*

---

## 3. Phase S1–S8 — the Base: research-grade Sol system, end to end

Each step: scope → sources → RL hook → acceptance. Two classes: **[GATE]** steps gate the acquisition demo; **[BREADTH]** steps are world-breadth that can proceed in parallel/after without blocking the RL spine.

### S1 [GATE, partial] Every solid surface in the Sol system (landable)
- New terrain kinds: **Mercury** (cratered, lobate scarps), **Venus** (volcanic plains/tesserae — *terrain authored in S1 but surface access gated behind S3's crush/thermal fail-states; until then it's "visible from altitude"* — 92 bar/460 °C without survival mechanics would undermine the research-grade frame), **Io** (volcanic), **Europa** (ice ridges/chaos), **Ganymede/Callisto** (grooved/cratered ice), **Titan** (dunes + methane-lake mask), **Enceladus** (tiger stripes), **Triton** (add to Neptune), **Pluto/Charon** (add as a *barycentric binary* — small rail-model extension, elements from JPL Table 2b since Table 1 omits Pluto), **Ceres/Vesta** (with S5). **Phobos/Deimos**: high-detail proxies now; non-spherical terrain is explicitly a stretch goal. **`canyon` terrain kind** added for Mars (Valles-class) — the Drone Rescue flagship needs it.
- **✅ SHIPPED 2026-07-09 — Real Earth Tier A:** global ETOPO 2022 bake (8192×4096 Int16 real meters incl. bathymetry, 49.9 MB gz) drives the Earth heightfield + collision; NASA Blue/Black Marble + cloud textures replace the provenance-unknown set; real-asset regression tests (Himalaya/Mariana/Kansas). Real vertical meters on the 0.1 globe (correct atmosphere coupling; documented). **Tier B next:** runtime close-ups from AWS terrarium tiles (keyless, CORS `*`, verified) with `terrain.reearth.land` fallback; poles come from the baked base.
- **DEM v1 for other bodies scoped tight:** 2 bodies × 2 landmark sites (e.g., Olympus Mons + Valles Marineris from **MOLA**; Tycho + Apollo 11 from **LOLA**) as pre-baked patch tiles, streamed via `tileSource`. `verticalScale: 1.0` for these (slope-true; that's what RL export uses); `VALIDATION.md` documents which mode feeds which claim.
- Sources (review-corrected): MESSENGER/**MDIS stereo + MLA (northern hemisphere)** for Mercury; **Magellan altimetry (GTDR, ~10–30 km effective)** for Venus topography — landmark-accuracy impossible, procedural infill mandatory; Galileo/Voyager (Jovian moons); Cassini (**SAR covers ~half of Titan**); New Horizons (Pluto); MOLA/LOLA PDS. Solar System Scope textures are *artistic renditions* — visuals only, never cited as ground truth.
- **RL hook:** every kind becomes a generator in the environment library (`canyon`, `crater_field`, `ice_ridges`, `dune_field`…) — moat #4's natural-terrain half.
- Acceptance: dev-key tour of 12+ landable bodies; autoland + on-foot smoke on 3 new bodies; per-kind heightfield tests; cold-start download stays within budget (below).

### S2 [GATE, partial] Atmospheres and entry, per body, with a model class that can pass its own test
- **Upgrade `AtmoDef` to piecewise-exponential layers / tabulated ρ(h)** (GRAM-lite) — the single-(ρ₀,H) exponential is off ~3.4× at 50 km on Earth and cannot pass validation; the single-H form survives only inside the scattering shader.
- Add: **Titan** (ρ₀ ≈ 5.3 kg/m³, H ≈ 20 km near-surface; cite **Huygens/HASI descent profile (Fulchignoni 2005) + Titan-GRAM**, with Yelle 1997 as the historical engineering model), **Triton/Pluto** (thin N₂), gas-giant upper decks (S3). Winds: Mars dust storms + GRAM-style variability, Venus super-rotation (~100 m/s cloud-top), Titan gentle. **Per-gas Sutton–Graves constants** (SI, kg^0.5/m): Earth air 1.7415e-4, Mars/Venus CO₂ ≈ 1.90e-4, Titan N₂ ≈ 1.74e-4, H₂/He giants ≈ 6.6e-5 — today Earth's k is wrongly applied everywhere.
- **In-atmosphere sky rendering for dense decks** is a named work item (the 12×4 single-scatter shell won't render a plausible sky *inside* a ρ₀=65 kg/m³ Venus deck; Titan and the giants need it too).
- Sources: NRLMSISE-00 / US Standard Atmosphere 1976 (Earth), Mars-GRAM/Justus-class profiles (Mars), VIRA (Venus), HASI (Titan), Voyager/New Horizons occultations (Triton/Pluto).
- **RL hook:** wind/density profiles become `DomainRandomizationSpec` dimensions.
- Acceptance (numeric, real-scale): modeled ρ within **15% below 60 km, 30% to shell top** vs published profiles, per body, in CI; entry-heating *formula* tests at game scale; **absolute heating validation (vs Huygens/Pioneer-Venus/Galileo entry reconstructions) only at scale 1.0** — at 0.1 scale speeds are 0.316× and q∝v³ gives ~3% of real heat flux, so game-scale heating is drama, not data.

### S3 [BREADTH] Gas AND ice giants as environments (depth is the boss)
- Cloud-deck flight with crush depth (hull-failure fail-state — this also unlocks Venus surface access), buffeting, lightning; **zonal jets per Voyager/Cassini profiles: Jupiter prograde peaks ~+150–180 m/s with retrograde only ~−60 m/s (asymmetric — Limaye 1986), Saturn ~400 m/s equatorial (Porco 2003), Uranus/Neptune included — Neptune ~−400 m/s retrograde equatorial**; GRS as persistent storm; Saturn ring-plane flight (instanced particles + collision risk); methane-haze visuals and crush parameters for **Uranus and Neptune explicitly** (the owner's "every planet" is testably met).
- `VALIDATION.md` caveat: the Galileo probe descended into an anomalously dry 5-μm hot spot — good for ρ(P), unrepresentative of mean clouds.
- **RL hook:** storm-navigation and ring-field traversal task templates.
- Acceptance: Jupiter descent to crush depth (fail) and out; one ice-giant environment gate; ring-plane collision test.

### S4 [BREADTH] The Sun as an environment
- Photosphere (granulation, limb darkening), chromosphere/corona streamers, sunspots. **Radiation model, worded right:** the magnetosphere is a GCR/SEP *attenuation zone*; the **belts are trapped-particle dose hazards** (high-dose shells) — validated against **AP8/AE8 L-shell ranges (AP9/AE9-IRENE as modern successor)** for Earth and **Divine & Garrett 1983 / GIRE** for Jupiter. Solar wind speed/density vs distance per the Parker model. CME events are **explicitly-labeled gameplay** (real CMEs are 40–60° wide; "shelter behind a planet" is fiction and stays out of VALIDATION.md).
- **RL hook:** hazard fields = `SensorSpec` channels (declared in S0.1's agent schema) + continuous `RewardSpec` penalties.
- Acceptance: survivable perihelion pass with heat/radiation HUD + death state; belt zone altitudes match published L-shell ranges.

### S5 [BREADTH] Small bodies
- Main belt: **stylized density, honestly labeled** — real >1 km spacing is ~10⁶ km (invisible); we ship gamified spatial density with MPC-seeded orbital *statistics*, and `VALIDATION.md` states both numbers. Ceres/Vesta terrains (Dawn). Comets: procedural nuclei from published shape statistics (avoids ESA share-alike); **ion tail anti-sunward (testable), dust tail curved along the orbit** (syndyne behavior — or excluded from the realism claim). NEAs; Kuiper sampling.
- **RL hook:** cluttered-field traversal gym — the space twin of the drone canyon.
- Acceptance: belt flight + Ceres landing; ion-tail direction test through perihelion.

### S6 [GATE for the GNC vertical] Orbital fidelity + time — the honesty layer (real scale)
- J2 for LEO/polar, patched-conic moon SOIs, Lagrange POIs. **Moon ephemerides fixed:** real epoch phases + eccentric/inclined elements (Horizons osculating) for all named moons — no more invented `phase0`; moons join the validation table with their own bounds.
- **Horizons validation harness, specified precisely:** real-scale Kepler propagation vs cached Horizons fixtures; Earth compares against **EMB (target 3)**, planets vs barycenters; **expected bounds pre-declared from the Standish Table-1 error class (10²–10⁴ km per planet — the source model dominates, and the published table says so)**; Pluto + time-accel headroom use Table 2b (3000 BC–3000 AD) or the sim clamps epoch to element validity; upgrade path to VSOP87/DE-SPK named for when tighter claims are wanted.
- **Time acceleration policy (1×–10,000×):** analytic rails at any accel; the *ship* under accel either coasts on patched conics (no numerical integration) or uses capped substeps with a documented max during powered/atmospheric flight; auto-drop to 1× on controller engagement, proximity, or atmo entry (defined thresholds); determinism test covers accel transitions. Never step controllers (autoland τ 3–5 s) at inflated dt.
- Acceptance: Horizons CI table green at declared bounds; **ISS-like orbit at scale 1.0** closed for 100 orbits headless; J2 nodal-precession test vs textbook rate (Vallado, *Fundamentals of Astrodynamics and Applications*).

### S7 [BREADTH] Playability: warp, routes, autopilot, many galaxies
- Route planner (multi-hop warp → hyperjump chains) on the maps; **autopilot** ("fly me to Titan" = align + warp + arrive + optional autoland, composed from existing systems); time-accel integration.
- **Multi-galaxy tiers:** Tier 1 = current galaxy (HYG + procgen + Sgr A*). Tier 2 = LMC/SMC/M31 with **real galaxy positions, orientations, and structural parameters (disk/bulge/bar profiles); star contents procedural, optionally Gaia-seeded where resolved (LMC/SMC)** — no false "real star catalog" claim for M31.
- **RL hook:** the autopilot is the first scripted baseline agent (exactly the `3D-RL-layer` guidance: scripted before deep RL) — the reference policy all evaluations compare against.
- Acceptance: Earth → Titan → M31-procgen world with ≤ 3 player inputs; autopilot completes Earth→Luna hands-off.

### S8 [GATE] Embodiments + missions = tasks (where game and RL become one product)
- **S8.0 Embodiments (blocker fix — the wedge needs a drone, not an 18 m fighter):** quadrotor dynamics (thrust/pitch/roll/yaw continuous actions) + wheeled-rover dynamics in sim-core; `AgentSpec.embodiment` first-class; analytic sensor channels (imu/position/ray-depth) now, RGB camera later (R-phase render worker). Simple drone + rover art assets (kit-bashed or generated; logged in LICENSES.md).
- **S8a Entity/objective runtime:** entities, triggers, timers, objective state machine (reach/checkpoint first), mission HUD. This is a new subsystem comparable to a shipped milestone — budgeted as such, not smuggled into the schema task.
- **S8b Task templates + flagship:** collect/deliver/scan/repair/return objectives, hazard hooks (dust storm affects flight), rescue/cargo/survey/race templates. Flagship: **"Mars Drone Rescue"** exactly as specced in `3D-RL-layer`, *flown by the quadrotor embodiment*, in the S1 canyon kind, authored in true meters for export. One spec, two renderers: playable mission AND RL environment.
- **RL hook:** `MissionSpec/TaskSpec` + `RewardSpec` + `ResetSpec` = moat #5; missions playable from WorldSpec JSON alone.
- Acceptance: 5 templates from JSON with no code; Drone Rescue completable by a human (drone), attempted by the scripted agent, auto-generating a playtest report (completion %, failure clusters, times).

**Always-on budgets (added per review):** cold start ≤ 150 MB (per-body lazy texture/DEM loading); fps ≥ 50 smoke gate extended to 2 more bodies; supported surface through Demo One and the acquisition demo = **desktop Chrome/Edge (Safari WebGPU where stable); mobile explicitly out of scope**.

---

## 4. Phase R — the RL layer (dependency-ordered, runs IN PARALLEL with S3–S7, not after)

- **R1 (unblocked by S0.2 + S8a) Environment compiler + Python bridge:** WorldSpec → `simcore.make("mars_rescue_drone_v1")`; **Gymnasium shim ships WITH R1, not after** — Python ↔ Node bridge (subprocess IPC or WebSocket on the AgentBridge contract; an explicit design decision with a round-trip acceptance test), because PPO realistically means stable-baselines3, not a TS RL stack. Thin **platform infra** alongside: WorldSpec storage (Postgres), asset bucket, job runner for headless eval/training (the source plan's FastAPI/Redis stack, minimally).
- **R2 (after R1) Three flagship gyms:** Mars drone canyon (quadrotor); rover exploration (Ceres or Mars); **game-level playtest with the on-foot character — "is this level beatable?"** (the source's Environment 3; "no humanoids" applies to robot embodiments/export, not to having a game character). Beautiful AND functional — the demo reel.
- **R3 (with R2) Agent evaluation as a data product (moat #2, restored):** scripted/heuristic/LLM-planner agents run any WorldSpec and **persist structured traces — trajectories, failure events, collision points, reward curves, path heatmaps — keyed by WorldSpec id+version in queryable storage; the playtest report is generated FROM the trace store.** The data flywheel exists from the first artifact.
- **R4 (after R1) Training + export:** PPO baseline on the drone gym via the Python bridge (parallel headless workers). **Isaac Lab export v1 descoped honestly:** task/reward/randomization YAML + heightmap/terrain-parameter export; **full USD scene export is its own later milestone** (meshing quadtree terrain to USD with materials/collision is a mini-project). **After Isaac: Unity adapter next (acquisition-relevant), Unreal later** — moat #3 stays a roadmap, not a drop. RGB-camera observations land here (headless render worker) if a vision task demands them.
- **R5 (last) Prompt layer + the acquisition-grade demo:** the source's **five** agents — world-designer, **asset/layout**, task-designer, playtester, patch agent — emitting/patching WorldSpecs against a schema that S1–S8 content has battle-tested. Demo: describe → generate → agent fails → patch → agent succeeds → export to Isaac. *(Stage-5 marketplace deferred — revisit post-R5.)*

---

## 5. Sequencing — dependency order only (no calendar; we move as fast as gates go green)

**Pipeline order:** ① S0.0 CI + S0.1 WorldSpec interfaces + Scale Decision → ② S0.2 sim-core re-architecture (rails/carry on ticks; real-scale support) ∥ S0.4 asset remediation ∥ S1 partial (real-Earth DEM, Mercury, Titan, Europa, `canyon` kind) → ③ S8.0 quadrotor embodiment + S8a objective runtime ∥ S0.3 AgentBridge (parallel-soak) ∥ S2 partial (Titan atmo + layered AtmoDef + wind randomization) → ④ S8b Drone Rescue + R1 minimal (`make()` + Python round-trip) + R3 minimal (scripted-agent report from the trace store). Breadth steps (S3–S7) interleave whenever they don't block the spine.

**Demo One (fallback-safe, ships when ④ lands):** one link — play a **reach/race mission on a new S1 body** in the browser, then the same WorldSpec as `env.step()` rollouts with an agent playtest report. **Stretch version:** full Mars Drone Rescue with the quadrotor. (The flagship needs S8.0+S8a+S8b+canyon; the fallback needs only S8a — the demo cannot slip on content.)

**Demo gate map:** S0 (all), S1-partial, S2-partial, S8 → gate the acquisition demo. S3, S4, S5, S7-Tier-2 → breadth, parallel, non-blocking. S6 → gates the *space-GNC vertical* specifically (and any "research-grade orbital" public claim), not the earlier demos.

**Always-on rules:** world content lands as WorldSpec data + generators; every milestone adds unit tests + a smoke/E2E gate + (where physics) a `VALIDATION.md` entry with citation and scale; replay-hash determinism stays green (ship sim); epoch comes from the spec; playability regressions block release; LICENSES.md grows with every asset.

**What we deliberately do NOT do:** build a general game-engine business; compete with Isaac/MuJoCo on contact physics (export to them; MuJoCo-WASM if browser robot previews are ever needed); humanoid *robotics* before drones/rovers; deep-RL training in the browser; "metaverse" pitches; percentage-accuracy claims.

---

## 6. Milestone → RL-layer traceability (complete moat map)

| Base step | Feeds RL layer as |
|---|---|
| S0.1 WorldSpec (incl. physics/agents/sensors/actions, scale) | The IR itself — **moat #1** |
| S0.2 sim-core (real-scale capable) | `env.step()` runtime, parallel training rollouts |
| S0.3 AgentBridge | Observation/action contract + playtester substrate |
| S1 terrains + S8.0-adjacent interiors (stations/habitats, R-phase: warehouse/factory) | Procedural environment library — **moat #4** (natural AND man-made halves) |
| S2 atmospheres/winds | DomainRandomizationSpec dimensions |
| S3 storms/rings | Dynamic-hazard task templates |
| S4 radiation fields | SensorSpec channels + continuous reward penalties |
| S5 asteroid fields | Cluttered-navigation gyms |
| S6 Horizons validation (real scale) | Sim-to-real credibility for the space-GNC vertical |
| S7 autopilot | Scripted baseline agent for evaluations |
| S8 embodiments + missions | TaskSpec/RewardSpec library — **moat #5** — + AI playtesting product |
| R3 trace store | Evaluation data flywheel — **moat #2** |
| R4 exporters (Isaac → Unity → Unreal → USD) | Engine adapters — **moat #3** |

*Man-made/interior generators note (review fix): space-station and surface-habitat interiors fit the game fiction and reuse the on-foot mode; warehouse/factory generators join as R-phase library entries — they anchor the robotics customers (`3D-RL-layer`'s own warehouse example) that pure planetary terrain can't serve.*
