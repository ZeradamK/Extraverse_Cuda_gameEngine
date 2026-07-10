# Asset & Dataset Provenance Manifest (MASTER_PLAN S0.4)

Every shipped asset/dataset, its source, license, and obligations. New assets MUST be logged here as part of the PR that adds them. Visual-vs-validation rule: artistic renditions (e.g., Solar System Scope) may ship as **visuals** but never appear as ground truth in `VALIDATION.md`.

## Elevation / mapped data

| Asset | Source | License | Obligations |
|---|---|---|---|
| `public/data/earth_dem_8192x4096_i16.bin.gz` | **NOAA ETOPO 2022** 60 arc-sec surface (ice-top) global relief, baked 21600×10800 f32 → 8192×4096 Int16 LE meters (bilinear, box-prefiltered) | Public domain (US Gov) | Cite: *NOAA National Centers for Environmental Information. ETOPO 2022 15 Arc-Second Global Relief Model. DOI: 10.25921/fd45-gt74* |
| (planned, S1 Tier B) runtime close-up tiles | AWS Terrain Tiles (Mapzen/Tilezen terrarium), `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, keyless, CORS `*` | Open (mixed public sources) | Attribution per tilezen/joerd `docs/attribution.md` (Mapzen, SRTM/USGS, ETOPO1 et al.) in credits UI |

## Earth textures (replaced Spline-extracted set 2026-07-09 — provenance remediation)

| Asset | Source | License | Obligations |
|---|---|---|---|
| `earth_day_8k.jpg` | NASA **Blue Marble: Next Generation** (unshaded, world.200412, 21600×10800 → 8k) | Public domain (NASA) | Credit: *NASA Earth Observatory — Blue Marble: Next Generation (R. Stöckli, NASA GSFC)* |
| `earth_night_8k.jpg` | NASA **Black Marble 2016** (13500×6750 → 8k) | Public domain (NASA) | Credit: *NASA Earth Observatory — Black Marble (Suomi NPP VIIRS)* |
| `earth_clouds_8k.jpg` | NASA cloud_combined (8192×4096 TIFF → JPEG) | Public domain (NASA) | Credit: NASA Earth Observatory |

## Other planetary textures

| Asset | Source | License | Obligations |
|---|---|---|---|
| `2k_*.jpg` planet set, `4k_moon.jpg`, `8k_moon.jpg`, Saturn ring alpha | Solar System Scope textures (artistic renditions of NASA data) | CC BY 4.0 | Visible attribution (credits UI + galaxy-map footer); visuals only, not validation ground truth |
| `2k_earth_daymap.jpg` (land-mask input only) | Solar System Scope | CC BY 4.0 | as above |

## Data catalogs

| Asset | Source | License | Obligations |
|---|---|---|---|
| `public/data/stars.json` (5,161 stars) | HYG Database v4.3 (David Nash, astronexus.com) | CC BY-SA 4.0 | Attribution (galaxy-map footer) + **share-alike attaches to the derived file** |
| `src/data/jpl-elements.json` | JPL/NASA Keplerian elements (Standish Table 1) | Public domain (US Gov) | Cite JPL SSD |

## 3D models

| Asset | Source | License | Obligations |
|---|---|---|---|
| `gridcorp.gltf` (ship), `moon_rotation_wobble.gltf`, `photoreal_earth.gltf` (geometry only — extracted textures were REMOVED 2026-07-09) | Project owner, authored in Spline | Owner's own work | Confirm any third-party Spline library assets before commercial release |
| HDR env `satara_night_no_lamps_2k.hdr` | Poly Haven | CC0 | none |

## Removed (provenance-unknown)

- `earth_day_4k.jpg`, `earth_night_4k.jpg`, `earth_clouds_4k.jpg` — binary-extracted from `photoreal_earth.spline` (upstream license unknown). Deleted 2026-07-09; replaced by the NASA set above.
