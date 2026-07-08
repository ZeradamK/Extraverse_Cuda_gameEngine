// EXTRAVERSE constants — mirrors EXTRAVERSE_BUILD_PROMPT.md tables. Keep ALL magic numbers here.

/** Ship: gridcorp.gltf "Gridcorp dron". Local bounds W498.6 × H175.3 × D244.0 Spline units, nose = −Z. */
export const SHIP = {
  /** locked: 18 m length → wingspan 36.8 m, height 12.9 m */
  SCALE: 18 / 244,
  /** authored engine glow (KHR point light in the source file) */
  GLOW_COLOR: 0xffc671,
  /** ship-local anchors in METERS (already scaled) */
  ANCHORS: {
    cockpitCam: [0, 1.85, -7.0] as const,
    engineLight: [0, -0.17, 13.1] as const,
    nozzleL: [-2.82, 0.07, 7.97] as const,
    nozzleR: [2.82, 0.07, 7.97] as const,
  },
  /** node name kept from the glTF scene */
  ROOT_NODE: 'Gridcorp dron',
} as const;

/** Sun photometrics (§5.2) */
export const SUN = {
  COLOR: 0xfff5f0, // 5778 K in vacuum
  IRRADIANCE_1AU_W_M2: 1361,
  ILLUMINANCE_1AU_LUX: 133_100,
  ANGULAR_DIAMETER_1AU_DEG: 0.533,
} as const;

/** triplanar tiling: ~0.35 tiles/meter, expressed per ship-local Spline unit */
export const TRIPLANAR_TILE_PER_LOCAL_UNIT = 0.35 * SHIP.SCALE;
