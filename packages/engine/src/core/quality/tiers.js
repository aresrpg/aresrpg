// Quality tier table — the single source of truth for the 3-tier ladder (S-85, 2026-07-10). WS1
// (governor.js, detect.js), the render features (render_scale, foliage_shadows, displacement, grass
// sway, weather particles, atlas texel size), and the satellite name-keyed tables (cloud_noise.js,
// froxels.js, atmosphere.js WEATHER_BUDGET) all read this table instead of hardcoding tier numbers.
//
// THE 3 RUNGS: LOW = mobile / very-low-end floor (reduced chunk gen, 32px textures, STATIC grass,
// 0.66 render scale, no fancy post). MEDIUM = the tuned NORMAL game — these TABLE VALUES stay
// frozen, but its SCENE pass now defaults to the taau recipe (0.66 downscale + RCAS sharpen — the
// base-game default 2026-07-12; renderer.js, ?taau_medium=0 escapes to native). HIGH = the max ceiling (best textures,
// foliage shadows, motion blur, biggest weather + cloud budgets). The former 5-name ladder
// (potato·low·medium·high·ultra) collapsed here: potato→low (floor), medium stays put, ultra→high
// (ceiling). Every consumer that reads this table or TIER_ORDER dynamically auto-follows.

/** @typedef {'low'|'medium'|'high'} TierName */

/**
 * @typedef {object} TierDef
 *
 * Every field below is READ by live runtime code (S-85 deleted the former aspirational §5.1 fields
 * that had zero readers — frame_budget_ms, render_scale_min, upscaler, voxel_view_distance,
 * far_field_horizon_km, shadows, ao, voxel_flood_light, gi_bounce, point_lights, water, post,
 * foliage_instance_count, clouds — those systems configure themselves elsewhere or aren't built).
 *
 * @property {TierName} name identity → drives the string gates (motion blur / froxels / underwater
 *   warp / clouds march) that key on the tier name directly.
 * @property {number} render_scale_max whole-swapchain pixel scale fed to setPixelRatio on a tier
 *   swap (engine.js set_tier → set_render_scale). The single biggest fill lever.
 * @property {number} dpr_max per-tier CEILING for window.devicePixelRatio → setPixelRatio. core/renderer.js
 *   consumes this (replacing its hardcoded `min(devicePixelRatio, 2)` at renderer.js:364), so a LOW/MEDIUM
 *   boot never allocates a full-Retina swapchain — the biggest fill lever on dense mobile/laptop panels.
 *   low 1 / medium 1.5 / high 2. (Another lane wires the renderer read; this field is the SSOT for the cap.)
 * @property {boolean} foliage_shadows whether the foliage/leaf classes cast into the sun shadow map —
 *   HIGH only (pool_renderer.js). Since Rung 2 this gates ALL of cross-flora (grass/flowers), the
 *   cutout leaf SPRITES, AND the opaque canopy CUBE shell — so at LOW/MEDIUM (the most-played tiers)
 *   NO leaf/foliage casts, and the BFS sun-leak gate owns the canopy-floor darkening. Only tree TRUNKS +
 *   terrain (solid class) cast at every tier. (Was "canopy cubes cast at every tier" pre-Rung-2 — stale.)
 * @property {boolean} terrain_displacement D164: the extra-cost APPEARANCE moves — bushy leaf FINS
 *   (extra billboard quads on surface canopy) + world-position vertex jitter (rock corners / trunk
 *   waviness). OFF at LOW to stay in the frame budget on weak GPUs. Occupancy/collision are ALWAYS
 *   exact 1 m cubes; this only toggles render-side silhouette detail.
 * @property {boolean} grass_sway [S-85] the flora wind vertex animation (terrain_flora sway amp).
 *   STATIC (false) at LOW — no grass moving, like very low end and mobile; the flora
 *   vertex graph gates its sway amplitude to 0. On (true) at MEDIUM/HIGH (the shipped 0.07 amp).
 * @property {number} weather_particle_count ambient/precip particle budget read by particles.js
 *   (mirrored in atmosphere.js WEATHER_BUDGET to avoid an import cycle — keep the two in lockstep).
 * @property {number} texture_resolution_px [S-85] per-block baked atlas texel edge length, read by
 *   pool_renderer.js as the bake size. LOW 32 (reduced textures for mobile), MEDIUM 64
 *   (UNCHANGED — the shipped hardcoded size, byte-identical), HIGH 128 (best textures). Boot-only
 *   (the atlas bakes once at renderer creation from the boot tier).
 * @property {boolean} simple_shaders [MOBILE SHADER DIET] BUILD-TIME terrain-shader gate — TRUE at LOW
 *   only. Threaded through pool_renderer → create_terrain_material → build_terrain_material and consumed
 *   at MATERIAL BUILD TIME (exactly like reveal_variant): at LOW the expensive terrain-fragment nodes are
 *   NOT EMITTED at all (not merely uniform-branched to 0) — leaf backlight + per-plane species/hue variety
 *   + cross-face climate pick (D2), per-block atlas-variant/coherent hashing + macro climate tint + moss
 *   (D3), one flat diffuse lighting model with the BFS sun-leak gate folded into the direct-sun term +
 *   flat ambient (D4), flat single-tint near-water (D5), and no shadow-map receive/cast (D8, cave stays
 *   dark via the relocated sun-leak gate). Halves the low-tier WGSL / shrinks the max fragment so iOS
 *   Metal stops wedging on compile. FALSE at MEDIUM/HIGH ⇒ the full graph compiles BYTE-IDENTICALLY.
 */

/** @type {Record<TierName, TierDef>} */
export const QUALITY_TIERS = {
  low: {
    name: 'low',
    render_scale_max: 0.66,
    dpr_max: 1,
    foliage_shadows: false,
    terrain_displacement: false,
    grass_sway: false,
    weather_particle_count: 0,
    texture_resolution_px: 32,
    simple_shaders: true, // [SHADER DIET] the diet path — the only tier that build-time-gates the fragment
  },
  medium: {
    // The tuned normal game. These TABLE VALUES stay frozen — render_scale_max 1.0 is the GOVERNOR's
    // setPixelRatio CEILING (the whole-swapchain axis), NOT the scene-pass scale. SEPARATELY, medium's SCENE
    // pass now defaults to the taau recipe (0.66 + RCAS sharpen) — the base-game default (2026-07-12; wired in
    // renderer.js's flag-parse, ?taau_medium=0 escapes) — and its POST chain defaults to HALF-RES POST
    // (bloom pyramid 0.25 + cloud deck rtt 0.5 — post_stack.js, ?halfpost=0 escapes). Both are BOOT-BAKED
    // recipes (a live set_tier re-arms them on reload — the set_tier live-arm residual ticket). So medium
    // no longer renders byte-identical to the old native path, but these fields are unchanged (changing
    // one is still a regression on the most-played tier).
    name: 'medium',
    render_scale_max: 1.0,
    dpr_max: 1.5,
    foliage_shadows: false,
    terrain_displacement: true,
    grass_sway: true,
    weather_particle_count: 50_000,
    texture_resolution_px: 64,
    simple_shaders: false, // MEDIUM keeps the full terrain-fragment graph (byte-identical)
  },
  high: {
    name: 'high',
    render_scale_max: 1.0, // S-85 OQ1: dropped from ultra's 1.25 supersample (the "5K/ULTRA LOD takes
    //   a minute" fill drain — ring_manager post-mortems); a power user can still supersample via the
    //   manual set_render_scale override.
    dpr_max: 2,
    foliage_shadows: true,
    terrain_displacement: true,
    grass_sway: true,
    weather_particle_count: 300_000,
    texture_resolution_px: 128,
    simple_shaders: false, // HIGH keeps the full terrain-fragment graph (byte-identical)
  },
}

/** Ordered rung list, lowest to highest — governor.js steps through this array. */
export const TIER_ORDER = /** @type {TierName[]} */ (['low', 'medium', 'high'])

/** Looks up a tier definition by name. @param {TierName} name @returns {TierDef} */
export function get_tier(name) {
  return QUALITY_TIERS[name]
}
