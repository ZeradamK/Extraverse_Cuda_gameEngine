# Extraverse_Cuda_gameEngine

**EXTRAVERSE** — a browser-based, Star Citizen-class space exploration game built on Three.js r185 **WebGPU** + TSL node materials, with real orbital mechanics, seamless planet landings, on-foot EVA, and a full procedural galaxy of 5,000+ real stars.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173  (Chrome with WebGPU)
npm run check      # typecheck + 113 unit tests + 11-gate smoke test
```

## What's inside

- **f64 camera-relative rendering** — the ship is pinned at the render origin; world positions are JS doubles. Distant bodies render as far-shell proxies with *true* angular size (no fake scaling), down to sub-pixel glint sprites.
- **Real solar system** — JPL approximate ephemerides + Kepler solver; SYSTEM_SCALE 1/10 radii and orbits with surface gravity preserved. Earth and Moon use the original Spline-authored photoreal meshes and textures.
- **Relativity-correct reference frames** — unified body orientation quaternion (axial tilt × spin × wobble/libration) drives rendering, terrain, collision, and texture drape; landed ships co-rotate with the planet and inherit surface velocity (Ω × r) on takeoff.
- **Flight model** — 6DOF Newtonian with flight assist, NAV cruise to **4,000 mi/s**, 30,000 m/s² dampers, Elite-style warp with line-of-sight obstruction checks and mass-lock emergency drop.
- **Seamless planet tech** — cube-sphere quadtree terrain (LOD to level 12) streamed from workers, TSL single-scatter atmospheres (Mars gets its real blue sunsets), autoland state machine, re-entry plasma from Sutton–Graves heat flux.
- **On-foot mode** — Rapier kinematic character controller in a planet-fixed tangent frame: walk, sprint, jump (floaty on Luna), collide with your parked ship.
- **Procedural galaxy** — HYG v4.3 star catalog (5,161 real stars), deterministic per-star system generation, 17-second hyperjump tunnel, and Sagittarius A* — an actual black hole with accretion disk and photon ring — waiting at the center.
- **Procedural audio** — reactor hum, aerodynamic wind ∝ dynamic pressure, warp/jump whooshes; all synthesized WebAudio, zero samples.

## Controls

| Key | Action |
| --- | --- |
| `W` / `S` | thrust forward / **brake** |
| `W`+`SPACE` (hold) | **afterburner** — 5× speed with spool-up; release to decelerate back |
| `A D` / `R Ctrl` | strafe left/right · up/down |
| Mouse | pitch/yaw · `Q E` roll |
| `X` | all-stop · `T` flight assist · `V` decouple |
| `C` | NAV cruise (4,000 mi/s) · `B` warp · `G` cycle target |
| `N` | landing gear (hold = autoland) |
| `Y` (hold) | exit ship on foot · `F` board · `Shift` sprint · `Space` jump |
| `M` | galaxy map · `[ ]` cycle star · `J` hyperjump |
| `F4` | camera · `F9` photo mode (`P` saves PNG) |

## Testing

113 Vitest unit tests (physics, Kepler, reference frames, terrain continuity, Rapier character controller) plus a gating Playwright smoke harness (`scripts/smoke.mjs`) that boots the real game in Chrome/WebGPU and asserts 11 gameplay gates end-to-end. See `DECISIONS.md` for the audit trail.

## Credits

- Planet textures: [Solar System Scope](https://www.solarsystemscope.com/textures/) (CC BY 4.0)
- Star catalog: [HYG Database v4.3](https://www.astronexus.com/hyg) (CC BY-SA 4.0)
- Earth/Moon/ship 3D models: authored in Spline by the project owner
- Physics references: NASA NTRS entry-heating papers, Millington *Game Physics Engine Development*, Gaffer on Games
