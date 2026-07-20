// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CONFIG-FIRST world-generation schema (plan §10-bis(2), playbook §2.3, lane NG1-E).
//
// ONE plain, serializable JS object = the ENTIRE world recipe. The north star is
// admin-driven world creation: an editor eventually writes one of these blobs, the gen pipeline
// (density / carve / hydrology / strata / surface / decoration lanes NG1-A..D) reads it, and the
// same blob deterministically reproduces the same world on every peer (§3.7). NG1-E ships:
//   (1) the JSDoc-typed SCHEMA SHAPE  (WorldGenConfig + sub-typedefs)  — this file;
//   (2) DEFAULT_WORLD_GEN_CONFIG      — the CURRENT live gen values, extracted byte-faithfully
//       from the scattered constants across gen/ (fields, sampler, terrain_shaper, biome_placer,
//       biome_registry, surface_decorator, world_config, world_gen)  — this file;
//   (3) validate_world_gen_config()   — structural + range checks → { ok, errors[] };
//   (4) config_hash()/config_hash_hex — deterministic canonical-serialization u32/hex world identity.
// (3)+(4) live in the sibling world_gen_config_validate.js (LOGIC split from this DATA to keep both
// files one-concern + under the ≤600-LoC law) and are re-exported below, so callers import one file.
//
// SCOPE (NG1-E): this file DEFINES the config. It does NOT wire it into gen/** — a concurrent lane
// (NG1-A) is rewiring density in column_gen/terrain_shaper right now and will ADOPT these names
// later. Changing any DEFAULT value here would move golden hashes = a world fork (§4); the defaults
// are therefore transcribed 1:1 from the live constants, NOT re-tuned. Behaviour changes are not
// this lane's job.
//
// NO DEPS, PURE. The density/carve sections mirror gen/density.js `DENSITY_CONFIG` field-for-field,
// and `sky` mirrors gen/sky_islands.js `SKY_ISLANDS_CONFIG` (Pandora region-gated islands, v5), so
// when the gen lanes migrate off those consts they read this recipe with zero rename. That 3D field
// is ACTIVE today (overhangs + caves + Pandora sky islands) — the world is at GEN_VERSION 5. Stages
// NOT yet built (canyon carver, strata banding, slope/snow surface, conifers) carry the playbook's
// proposed defaults, gated `enabled:false`, so turning a stage on is a config edit, never a code edit.

// --- SCHEMA (JSDoc typedefs). Terse by design; the sourcing prose + rationale live in the header
// and inline on DEFAULT_WORLD_GEN_CONFIG below. `enabled:false` sub-blocks are NG1-A..D stages the
// live engine does not yet produce (proposed defaults from playbook §2.3, for later adoption). ---

/**
 * @typedef {object} NoiseFieldConfig one seeded 2D fbm climate field (fields.js).
 * @property {number} period lowest-octave wavelength, world blocks (> 0)
 * @property {number} octaves harmonic count (integer >= 1)
 * @property {number} [spread] lacunarity (freq × per octave; default 2)
 * @property {number} [gain] persistence (amp × per octave; default 0.5)
 * @property {number} [amp] output displacement amplitude, blocks (unused by climate fields)
 * @property {number} [offset] ridged-multifractal offset (unused by climate fields)
 */

/**
 * @typedef {object} NoiseConfig the 5 LIVE 2D climate fields (fields.js). The 3D shaping fields
 *   (warp / detail-ridged / spaghetti / sky) live under `density`/`carvers`/`sky` per DENSITY_CONFIG.
 * @property {NoiseFieldConfig} temperature biome axis (§4.1)
 * @property {NoiseFieldConfig} humidity biome axis (§4.1)
 * @property {NoiseFieldConfig} continentalness ocean↔inland base elevation (§4.1)
 * @property {NoiseFieldConfig} erosion flat↔mountainous modulation (§4.1)
 * @property {NoiseFieldConfig} weirdness mid-freq ridges; PV derived from it (§4.1)
 */

/**
 * @typedef {[number, number]} SplineKnot [x in [0,1], output value] — JSON tuple form of
 *   terrain_shaper's `{x,y}` SplinePoint.
 */

/**
 * @typedef {object} SplinesConfig Catmull-Rom control-point tables (terrain_shaper.js as data).
 * @property {SplineKnot[]} continentalness_to_base continentalness → base height (world y)
 * @property {SplineKnot[]} erosion_to_amplitude erosion → relief amplitude (blocks)
 * @property {SplineKnot[]} pv_to_relief peaks-and-valleys → relief factor
 */

/**
 * @typedef {object} NoiseBandConfig a seeded 3D shaping-noise def (DENSITY_CONFIG warp/detail form).
 * @property {number} period wavelength, world blocks (> 0)
 * @property {number} octaves harmonic count (integer >= 1)
 * @property {number} amp displacement/detail amplitude, blocks
 */

/**
 * @typedef {object} OverhangGateConfig overhang gate — 3D detail turns on only on steep, high-relief
 *   columns (DENSITY_CONFIG.overhang, LIVE).
 * @property {number} erosion_max erosion at/below which the gate starts opening
 * @property {number} pv_min peaks-and-valleys at/above which the gate starts opening
 * @property {number} strength gate output multiplier on the 3D detail term
 */

/**
 * @typedef {object} DensityConfig unified 3D density-function params (LIVE gen/density.js
 *   DENSITY_CONFIG, mirrored 1:1). Surface overhangs + caves + sky islands from one field (§2.2).
 * @property {number} band_blocks ±density-band half-width around surface, blocks (LIVE)
 * @property {number} hard_floor_y world-y below which density is forced solid (LIVE HARD_FLOOR_Y)
 * @property {NoiseBandConfig} warp domain-warp sampler (period/octaves/amp) applied before density
 * @property {NoiseBandConfig} detail ridged 3D overhang-detail sampler
 * @property {OverhangGateConfig} overhang erosion/PV gate for the 3D detail
 */

/**
 * @typedef {object} CanyonConfig config-gated ADDITIVE canyon stage (FIVE-WORLDS; carves a second deeper
 *   channel over the always-on NG1-B baseline canyon, which is untouched). Region-local, not MC's walker.
 * @property {boolean} enabled off in DEFAULT (zero additional carve ⇒ byte-identical world)
 * @property {number} width crest-band half-width fraction (0..1); larger = wider
 * @property {number} depth maximum vertical carve at the axis, blocks (the wall height)
 * @property {number} wall_steepness axis depth-curve exponent t^k (higher = steeper, more vertical walls)
 * @property {boolean} warp warp the sample first for organic meander
 */

/**
 * @typedef {object} CavesConfig spaghetti-tunnel cave carver (LIVE DENSITY_CONFIG.caves — a
 *   near-surface crust so cave mouths open on cliff faces without full deep 3D density).
 * @property {number} depth_min blocks below surface where carving starts (solid crust above)
 * @property {number} depth_max blocks below surface where carving stops (crust-only depth)
 * @property {number} spaghetti_period ridged spaghetti-tunnel wavelength, world blocks
 * @property {number} spaghetti_threshold ridged value above which a tunnel opens (higher = rarer)
 * @property {number} spaghetti_depth density subtracted at a tunnel core, blocks
 */

/**
 * @typedef {object} CarversConfig carver block.
 * @property {CanyonConfig} canyon inverted-ridge canyon carving (§2.1)
 * @property {CavesConfig} caves spaghetti + cheese cave family (§2.2)
 */

/**
 * @typedef {object} RiverConfig folded-ridge river recipe (LIVE gen/hydrology.js HYDROLOGY_CONFIG.river) —
 *   thin meandering rivers along a domain-warped ridged crest network, carving a quadratic channel.
 * @property {{ period: number, octaves: number }} crease ridged crest network whose lines are river axes
 * @property {NoiseBandConfig} warp domain warp (period/octaves/amp) for meander
 * @property {number} width crest-band half-width fraction (river center → edge)
 * @property {number} depth max channel carve at the center, blocks
 * @property {number} bank water surface this many blocks below the un-carved land (dry banks)
 * @property {number} continentalness_min inland gate (no rivers in open ocean)
 * @property {number} pv_max rivers run through valleys/slopes, not the highest peaks
 */

/**
 * @typedef {object} LakeConfig pour-point lake recipe (LIVE HYDROLOGY_CONFIG.lake). A low-freq basin
 *   field marks candidate areas; the water level is the true pour point (flat + enclosed).
 * @property {number} period basin field wavelength, blocks
 * @property {number} octaves basin field octaves
 * @property {number} threshold basin value above which a column is a candidate lake area
 * @property {number} erosion_min lowland/flat gate (mountains drain, they don't pond)
 * @property {number} pv_max valley gate
 * @property {number} min_body_depth a connected lake body must reach this depth or it stays dry
 */

/**
 * @typedef {object} WaterfallConfig waterfall/cascade recipe (LIVE HYDROLOGY_CONFIG.waterfall).
 * @property {number} min_drop an uphill river neighbor this much higher spills a sheet onto the column
 * @property {number} fall_max cap the sheet height (deep canyon fall stays a fall, not a wall)
 * @property {number} cascade_drop a river ≥ this above a neighbor's top is a cascade lip (flag-only)
 */

/**
 * @typedef {object} BeachConfig coastal waterline flattening (world_gen.js). Beach columns with raw
 *   surface in [band_low, band_high] snap to flat_y.
 * @property {number} band_low inclusive lower raw-surface-y (LIVE SEA_LEVEL-2)
 * @property {number} band_high inclusive upper raw-surface-y (LIVE SEA_LEVEL+3)
 * @property {number} flat_y dry level flattened beaches snap to (LIVE SEA_LEVEL+1)
 */

/**
 * @typedef {object} HydrologyConfig sea level + rivers + lakes + waterfalls + beach flatten (§4.4).
 *   `sea_level` = documented world identity (NOT threaded — SEA_LEVEL const is the cross-engine SSOT).
 * @property {number} sea_level world-y of the sea surface (mirrors world_config.SEA_LEVEL)
 * @property {RiverConfig} river folded-ridge river recipe (LIVE)
 * @property {LakeConfig} lake pour-point lake recipe (LIVE)
 * @property {WaterfallConfig} waterfall waterfall/cascade recipe (LIVE)
 * @property {BeachConfig} beach coastal waterline flattening (LIVE surface polish)
 * @property {{ radius?: number, falloff?: number, margin?: number, drop?: number }} [spawn_dry] OPTIONAL
 *   spawn dry-floor override (water-locked-spawn guarantee — column_gen spawn_dry_floor).
 *   Absent ⇒ universal code defaults (radius 24, falloff 24, margin 2, drop 24); radius 0 ⇒ off.
 */

/**
 * @typedef {object} StrataConfig elevation strata banding (FIVE-WORLDS gen/stages/strata.js — Riviera
 *   limestone terraces on STEEP columns). Live = flat 4-band per biome, so `enabled:false`. `palette`
 *   names must resolve in block_registry.
 * @property {boolean} enabled off in the live engine (flat biome strata only)
 * @property {number} band_height one strata-band thickness, blocks
 * @property {number} band_jitter per-column ± y offset so band boundaries waver across a cliff, blocks
 * @property {number} slope_gate slope (rise/run) at/above which a column bands (below = biome surface)
 * @property {string[]} palette ordered strata block names (hash-bucketed per band)
 * @property {number} subsurface_depth subsurface blocks before filler (LIVE SUBSURFACE_DEPTH)
 */

/**
 * @typedef {object} SurfaceConfig slope-material + snow-cap gates (FIVE-WORLDS gen/stages/surface_by_slope.js
 *   — Everest). Live surface is biome-fixed → both gates false.
 * @property {boolean} slope_enabled off in the live engine (biome-fixed surface)
 * @property {boolean} snow_enabled off in the live engine (snow is a biome, not a cap)
 * @property {number} snow_line world-y above which flat columns get a snow cap
 * @property {number} steep_slope gradient (rise/run) at/above which a face stays bare rock
 * @property {number} grass_slope gradient below which a surface reads as its biome cover (snow-eligible)
 * @property {boolean} scree_enabled scree/talus apron on moderate slopes [grass_slope, steep_slope)
 * @property {number} [scree_relief] GLACIAL §B.4 talus-apron mound height at cliff feet, blocks (0 = material-only)
 * @property {number} treeline world-y above which the decorator anchors no trees (default = world_height)
 * @property {string} snow_block surface block name for the snow cap (must resolve in block_registry)
 * @property {string} rock_block surface block name for bare steep rock
 * @property {string} scree_block surface block name for the talus/scree apron
 * @property {SnowScoreConfig} [snow_score] GLACIAL §C snow-score field (replaces the hard snow threshold)
 * @property {AlpineConfig} [alpine] S-24 alpine painter (snow-default / rock-on-steep / ice-high) — when
 *   enabled it OWNS the surface pick, replacing snow_score/the hard threshold (Everest)
 */

/**
 * @typedef {object} AlpineConfig S-24 ALPINE SURFACE PAINTER (gen/stages/surface_by_slope.js). Rule:
 *   "snowless patches of rocks ONLY on very steep slopes, and ice higher — never just check the topmost
 *   block to paint it snowy". SNOW is the default across the alpine zone; ROCK exposes only where the
 *   neighbourhood slope clears a HIGH threshold (couloirs/cliffs), coherently banded by a low-freq geology
 *   mask; ICE takes over above `ice_line`. Off/absent ⇒ the snow_score / hard-threshold path runs (parity).
 * @property {boolean} enabled painter owns the surface pick (off/absent ⇒ byte-identical world)
 * @property {number} snow_floor world-y below which the biome cover is kept (snow is the default above it)
 * @property {number} rock_slope neighbourhood slope (rise/run) at/above which rock exposes (high ⇒ steep only)
 * @property {number} rock_coherence low-freq mask fraction that LOWERS rock_slope (coherent bands), 0..1
 * @property {number} [rock_mask_period] geology mask wavelength, blocks (broad ⇒ regional rock-proneness)
 * @property {number} [rock_mask_octaves] geology mask fbm octave count
 * @property {number} ice_line world-y at/above which ice appears (within the blend band)
 * @property {number} ice_blend blend-band height: [ice_line, ice_line+ice_blend] mixes snow/ice, above ⇒ pure ice
 * @property {number} [ice_mask_period] snow↔ice transition mask wavelength, blocks
 * @property {number} [ice_mask_octaves] snow↔ice transition mask fbm octave count
 * @property {number} [sun_aspect] fraction (0..~0.6) a fully SUN-FACING slope lowers rock_slope ("snow less on
 *   the sun side"); 0 ⇒ no aspect term (parity)
 * @property {number} [sun_dx] @property {number} [sun_dz] precomputed unit sun horizontal (world x/z). Painting
 *   matches the render's tod sun so exposed rock lands on the lit faces. Literals (no trig in gen/, §3.7 gate).
 * @property {number} [slope_window] ± neighbourhood (blocks) the painting slope is measured over (default 1)
 * @property {string} [snow_block] surface block name for snow (default 'snow')
 * @property {string} [rock_block] surface block name for exposed rock (default 'stone')
 * @property {string} [ice_block] surface block name for high ice (default 'ice')
 */

/**
 * @typedef {object} SnowScoreConfig snow-score dressing v2 (GLACIAL gen/stages/surface_by_slope.js — §C).
 *   Replaces the hard snow slope-threshold with a probability field f(altitude, slope, speckle) so the
 *   snow↔rock transition is a salt-and-pepper speckle (ref R5). Off ⇒ the legacy hard threshold ⇒ parity.
 * @property {boolean} enabled off in DEFAULT (legacy hard threshold ⇒ byte-identical world)
 * @property {number} band_low world-y below which the score never applies (biome cover kept)
 * @property {number} band_high world-y at/above which the altitude term saturates
 * @property {number} slope_max slope at/above which snow probability → 0
 * @property {number} speckle_period melt/salt-and-pepper noise wavelength, blocks
 * @property {number} speckle_octaves speckle fbm octave count (broad patches + fine grain)
 * @property {number} speckle_amp speckle perturbation amplitude on the score
 * @property {number} threshold score ≥ this → snow, else bare rock
 */

/**
 * @typedef {object} IcebergConfig buoyant ocean ice masses (FIVE-WORLDS gen/stages/icebergs.js — Everest).
 *   Region-gated radial ICE blobs in below-sea columns, anchored at sea level. Off in DEFAULT.
 * @property {boolean} enabled off in DEFAULT (no icebergs ⇒ byte-identical world)
 * @property {number} region_size iceberg-region cell size, blocks (coarse XZ tiling)
 * @property {number} region_rate fraction of region cells that host icebergs (0..1)
 * @property {number} blobs_min min iceberg blobs per iceberg region
 * @property {number} blobs_max max iceberg blobs per iceberg region
 * @property {number} radius_min min horizontal blob radius, blocks
 * @property {number} radius_max max horizontal blob radius, blocks
 * @property {number} freeboard ice height ABOVE the waterline as a fraction of radius
 * @property {number} draft ice depth BELOW the waterline as a fraction of radius
 */

/**
 * @typedef {object} CragConfig the RELIEF LADDER (gen/stages/crag.js — TERRAIN_REALISM_BASELINE.md).
 *   Four additive height terms: relief-SCALED ridged `band` (crag/gully texture on ridges), UNSCALED
 *   ridged `base` (the connected ridge network + enclosed valleys — kills "boulder on a plain"),
 *   UNSCALED `roll` (drumlin/moraine mounds), UNSCALED fine `micro` (the anti-flat guarantee that
 *   breaks voxel terrace furrows). base/roll amp 0 ⇒ those terms are byte-inert.
 * @property {boolean} enabled ladder on (DEFAULT: true since the realism-baseline fork)
 * @property {number} band_period base wavelength of the ridged crag band, blocks (octaves fold it to ~40)
 * @property {number} band_octaves ridged octave count (more = sharper sub-ridges)
 * @property {number} band_amp crag half-amplitude at full relief, blocks
 * @property {number} base_period base wavelength of the unscaled ridge-network band, blocks
 * @property {number} base_octaves ridge-network ridged octave count
 * @property {number} base_amp ridge-network half-amplitude (applied everywhere), blocks (0 = off)
 * @property {number} roll_period base wavelength of the drumlin roll fbm, blocks
 * @property {number} roll_octaves roll fbm octave count
 * @property {number} roll_amp drumlin-roll half-amplitude (applied everywhere), blocks (0 = off)
 * @property {number} micro_period base wavelength of the micro-roughness fbm, blocks
 * @property {number} micro_octaves micro fbm octave count
 * @property {number} micro_amp micro-roughness half-amplitude (applied everywhere), blocks
 * @property {number} relief_floor shaper-relief below which the crag band is fully damped (valley calm)
 * @property {number} relief_gain relief span over which crag ramps 0→1 above the floor (>0)
 * @property {number} [flat_lo] FLAT-SMOOTH: relief ≤ this ⇒ roll+micro fully attenuated (plains smoothed)
 * @property {number} [flat_hi] FLAT-SMOOTH: relief ≥ this ⇒ roll+micro at full amp (steep terrain kept);
 *   smoothstep across [flat_lo, flat_hi]. flat_hi ≤ flat_lo ⇒ OFF (byte-identical).
 */

/**
 * @typedef {object} MassifConfig S-24 COMPOSITE SURFACE (gen/stages/massif.js). When enabled it OWNS the
 *   land surface for a world (Everest), replacing the spline+erosion+canyon+trough composition with one
 *   scale-coupled function: TRUNK (macro drainage — broad massifs vs deep corridors near `floor`), SKELETON
 *   (within-massif radiating ridge/spur network), EROSION (derivative-damped face detail), MICRO (anti-flat).
 *   Off in DEFAULT ⇒ column_gen keeps the legacy raw_land ⇒ byte-identical world.
 * @property {boolean} enabled stage owns raw_land (off in DEFAULT ⇒ byte-identical world)
 * @property {number} floor deepest master-valley corridor floor, world-y
 * @property {number} span body height span (floor + span ≈ summit body cap)
 * @property {number} [body_concave] CONCAVE body shaping 0..1 (0 = linear; 1 = quadratic): compresses low body
 *   into long gentle valley aprons, accelerates high body toward steep peaks ("fade into valleys, accelerate for peaks")
 * @property {number} [trunk_warp_period] macro-drainage domain-warp base wavelength, blocks
 * @property {number} [trunk_warp_amp] macro-drainage warp amplitude, blocks
 * @property {number} [trunk_period] macro massif/corridor ridged base wavelength, blocks (wide = broad valleys)
 * @property {number} [trunk_octaves] macro ridged octave count
 * @property {number} [env_lo] trunk contrast window low — below ⇒ corridor floor (0..1)
 * @property {number} [env_hi] trunk contrast window high — above ⇒ massif core (0..1)
 * @property {number} [skel_warp_period] ridge-network domain-warp base wavelength, blocks
 * @property {number} [skel_warp_amp] ridge-network warp amplitude, blocks
 * @property {number} [skel_period] within-massif ridge multifractal base wavelength, blocks
 * @property {number} [skel_octaves] ridge multifractal octave count (spurs)
 * @property {number} [skel_lo] skeleton contrast window low (0..1)
 * @property {number} [skel_hi] skeleton contrast window high (0..1)
 * @property {number} [shoulder] massif-body floor (hanging-valley elevation inside massifs), 0..1
 * @property {number} [ero_period] face-erosion turbulence base wavelength, blocks
 * @property {number} [ero_octaves] face-erosion octave count
 * @property {number} [ero_damp] derivative-feedback strength (higher = smoother faces, sharper couloirs)
 * @property {number} [ero_amp] face-erosion half-amplitude, blocks
 * @property {number} [ero_face_lo] face mask low — body above which erosion begins (0..1)
 * @property {number} [ero_face_hi] face mask high — body at which erosion saturates (0..1)
 * @property {number} [ero_crest_fade] body above which erosion fades out toward the summit (0..1)
 * @property {number} [micro_period] anti-flat roughness base wavelength, blocks
 * @property {number} [micro_amp] anti-flat roughness half-amplitude, blocks
 */

/**
 * @typedef {object} TroughConfig glacial U-trough reshape (GLACIAL gen/stages/trough.js — §B.1). Carves a
 *   flat-floored, steep-walled U into the PV valley network. Off in DEFAULT ⇒ byte-identical world.
 * @property {boolean} enabled off in DEFAULT (no trough carve ⇒ byte-identical world)
 * @property {number} depth max carve at the flat floor, blocks (the trough depth)
 * @property {number} floor_pv pv at/below which the carve is full depth (flat-floor half-width, 0..1)
 * @property {number} wall_pv pv at/above which the carve is zero (wall top; must exceed floor_pv, 0..1)
 */

/**
 * @typedef {object} CirqueConfig amphitheater scoop placer (GLACIAL gen/stages/cirque.js — §B.2). Region-
 *   gated radial bowls (flat floor + steep headwall + rim lip) carved into high ridge heads. Off in DEFAULT.
 * @property {boolean} enabled off in DEFAULT (no cirque carve ⇒ byte-identical world)
 * @property {number} region_size cirque-region cell size, blocks (coarse XZ tiling)
 * @property {number} region_rate fraction of region cells that host cirques (0..1)
 * @property {number} per_region candidate cirque centres per hosting region (altitude-gated at build)
 * @property {number} radius_min min rim radius, blocks
 * @property {number} radius_max max rim radius, blocks
 * @property {number} depth bowl floor carve depth, blocks
 * @property {number} floor_ratio flat-floor radius as a fraction of the rim radius (0..1)
 * @property {number} lip raised-rim width just outside the rim, blocks (0 = no lip)
 * @property {number} min_altitude land-y a centre must exceed to host a cirque
 */

/**
 * @typedef {object} GlacierConfig glacier ribbon + moraines surface stage (GLACIAL gen/stages/glacier.js —
 *   §B.3). Paints flat trough floors in the ice band as ice/firn with dark medial + lateral moraine stripes,
 *   crevasse banding, and terminal rubble (material only). Off in DEFAULT ⇒ byte-identical world.
 * @property {boolean} enabled off in DEFAULT (no override ⇒ byte-identical world)
 * @property {number} ice_low bottom of the glacier ice altitude band, world-y
 * @property {number} ice_high top of the ice band (above = snow/rock via the surface stage), world-y
 * @property {number} flat_gate slope (rise/run) at/below which a column is a flat glacier floor
 * @property {number} valley_pv pv at/below which a column is a valley/trough floor (0..1)
 * @property {number} medial_pv pv at/below which the centreline reads as dark medial moraine (0..1)
 * @property {number} lateral_band pv within this of valley_pv reads as lateral moraine (0..1)
 * @property {number} crevasse_period altitude period of the crevasse banding, blocks (≥1)
 * @property {number} terminal_band blocks above ice_low that read as terminal rubble
 * @property {number} firn_band blocks below ice_high that read as granular firn
 * @property {string} ice_block main glacier-ice block name (must resolve in block_registry)
 * @property {string} firn_block upper granular firn block name
 * @property {string} moraine_block dark debris (medial + lateral) block name
 * @property {string} crevasse_block crevasse-groove block name
 * @property {string} rubble_block terminal-rubble block name
 */

/**
 * @typedef {object} WaterOpticsConfig per-config water shading params (FIVE-WORLDS render/water_material.js).
 *   Defaults = the live constants (visual-only, never in the gen golden). Everglades = murky, Paradise = clear.
 * @property {[number, number, number]} body_color deep-water linear RGB tint (0..1)
 * @property {[number, number, number]} shallow_color shallow-water linear RGB tint (0..1)
 * @property {[number, number, number]} sigma Beer-Lambert per-block extinction (r,g,b); bigger = murkier
 * @property {number} fade_start through-water depth below which water stays readably transparent, blocks
 * @property {number} tint_depth through-water depth at which the tint is fully body-colour (opaque), blocks
 * @property {number} deep_floor residual body-colour glow once the bed is fully extinguished
 * @property {number} [shallow_presence] minimum SHALLOW-surface alpha floor (0..1) — the visible presence
 *   of 1-2 block water (2026-07-07 owner fix). Omitted ⇒ the universal WATER_SHALLOW_PRESENCE default.
 */

/**
 * @typedef {object} SkyConfig Pandora-style floating islands (LIVE gen/sky_islands.js
 *   SKY_ISLANDS_CONFIG — ACTIVE; region-gated Hallelujah-Mountain masses, v5). The v4 inverted noise
 *   SHELL (period/threshold) was RETIRED. `low_y/high_y/thickness/enabled` are the band ENVELOPE the
 *   LOD far-shell scans; the rest are the region-gating + island-shape grammar.
 * @property {boolean} enabled sky islands on/off (LIVE true)
 * @property {number} low_y bottom of the CAP altitude band (lowest an island cap top may sit)
 * @property {number} high_y top of the CAP altitude band (highest an island cap top may sit)
 * @property {number} thickness vertical margin around the band (contains hanging roots + crown), blocks
 * @property {number} region_size sky-region cell size, blocks (coarse XZ tiling)
 * @property {number} region_rate fraction of region cells that are sky-island regions (0..1)
 * @property {number} islands_min min islands spawned in one sky region (archipelago)
 * @property {number} islands_max max islands spawned in one sky region
 * @property {number} satellites_max max companion islets hashed off each parent island
 * @property {number} cap_radius_min min broad-cap radius, blocks (≥24 so islands read as landmasses)
 * @property {number} cap_radius_max max broad-cap radius, blocks
 * @property {number} root_ratio_min min root depth as a multiple of cap radius (hanging taper length)
 * @property {number} root_ratio_max max root depth as a multiple of cap radius
 * @property {number} crown_ratio crown dome height above the cap as a fraction of cap radius
 * @property {number} wobble_amp rim/silhouette wobble amplitude, fraction of local radius
 * @property {number} wobble_period rim value-noise lattice period, blocks
 * @property {number} satellite_radius_ratio satellite cap radius as a fraction of the parent's
 * @property {number} satellite_orbit satellite orbit distance in parent radii
 * @property {number} crust_depth grass/soil crust depth on island tops, blocks
 */

/**
 * @typedef {object} BiomeClimatePoint [0,1] target point in the 5-axis placement space (weirdness is
 *   derived via PV, not an axis).
 * @property {number} temperature 0 cold → 1 hot
 * @property {number} humidity 0 dry → 1 wet
 * @property {number} continentalness 0 deep-ocean → 1 far-inland
 * @property {number} erosion 0 mountainous → 1 flat
 * @property {number} pv 0 valley/river → 1 peak
 */

/**
 * @typedef {object} BiomeLandConfig per-biome strata block NAMES (must resolve in block_registry).
 * @property {string} surface top-of-column block
 * @property {string} subsurface subsurface-band block
 * @property {string} underwater surface substitute below sea level
 * @property {string} filler deep block
 */

/**
 * @typedef {object} BiomeConfig one biome entry (biome_registry BiomeDef, config form).
 * @property {number} id stable numeric id — persisted in chunk arrays, never renumbered (§3.7)
 * @property {string} name snake_case identifier
 * @property {BiomeClimatePoint} climate target point in the placement space (§4.3)
 * @property {number} weight nearest-fit tie-break priority
 * @property {boolean} weirdness_gate esoteric — placed only at extreme weirdness (§4.3)
 * @property {BiomeLandConfig} land flat surface/subsurface/underwater/filler strata (§4.2)
 * @property {number} tree_density 0..1 tree decorator hint
 * @property {number} grass_density 0..1 grass clutter hint (§6.3)
 * @property {string[]} structure_pools jigsaw/schematic pool ids eligible here (§4.6)
 * @property {string} music_bed audio biome-bed id (§6.4)
 */

/**
 * @typedef {object} BiomeAxisWeights per-axis weighting of the climate-space distance metric.
 * @property {number} temperature
 * @property {number} humidity
 * @property {number} continentalness
 * @property {number} erosion
 * @property {number} pv
 */

/**
 * @typedef {object} BiomeSelectionConfig climate-space placement metric (biome_placer.js).
 * @property {BiomeAxisWeights} axis_weights distance-metric axis weights (LIVE AXIS_WEIGHTS)
 * @property {number} blend_k nearest biomes contributing to the blend (LIVE BLEND_K)
 * @property {number} transition_softness smoothstep falloff width over distance (LIVE)
 * @property {number} weirdness_esoteric_threshold |w-0.5|*2 esoteric gate (LIVE)
 * @property {Partial<BiomeClimatePoint>} [climate_bias] OPTIONAL placement-only additive climate offset
 *   per axis (clamped [0,1]) — the Phase-0 §3 "constant temperature/humidity" pin lever so a single-family
 *   world's family wins nearest-fit. Absent = no bias (byte-identical DEFAULT). Terrain shaping is unbiased.
 */

/**
 * @typedef {object} ConiferConfig conifer/spruce tree params (§2.1; NG1-D owns impl).
 * @property {boolean} enabled off in the live engine (oak-style trees only)
 * @property {number} trunk_min minimum trunk height, blocks
 * @property {number} trunk_max maximum trunk height, blocks
 * @property {number} base_radius bottom ring radius, blocks
 * @property {number} radius_step ring radius reduction per level up
 */

/**
 * @typedef {object} OakTreeConfig the LIVE oak-style decorator tree (stamp_tree geometry).
 * @property {number} trunk_min minimum trunk height, blocks (LIVE 4)
 * @property {number} trunk_max maximum trunk height, blocks (LIVE 6)
 * @property {number} canopy_radius 5×5 leaf-layer half-extent (LIVE 2)
 * @property {number} cap_radius 3×3 cap half-extent above the trunk top (LIVE 1)
 */

/**
 * @typedef {object} TreesConfig procedural-tree ROLLOUT gate (ENGINE_AAA_PLAN §3.5). Phase 1 ships the
 *   procedural generator BEHIND this flag: `procedural:false` (DEFAULT) ⇒ the decorator places the legacy
 *   schematic trees ⇒ byte-identical world; `procedural:true` (the `?proctrees=1` demo A/B) swaps the tree
 *   PICK for a synthesized species skeleton (gen/trees/tree_gen.js) — rocks/structures stay schematic and
 *   the grounding/halo/stamp/union path is reused unchanged (§3.1: swap WHAT is picked, not HOW it's placed).
 * @property {boolean} procedural off in DEFAULT (schematics) ⇒ byte-identical world
 * @property {number} [baked_variants] BAKE-THEN-STAMP dial (gen/trees/tree_bake.js) — DEFAULT 32
 *   (GEN_VERSION 9 — pregenerate a lot of different trees and use them as
 *   schematics). N>0 ⇒ bake N deterministic variants per species ONCE, then each column O(1)-picks one
 *   + a hash-picked quarter-turn rotation (~4N distinct reads); synthesis runs N×species per WORLD, not
 *   once per column — forest gen collapses to ~stamp cost. 0 ⇒ the old live per-column generate_tree
 *   (every tree unique — the measured load cost; `?baketrees=0` is the escape/A-B).
 */

/**
 * @typedef {object} TreeSpeciesEntry one weighted procedural-species candidate for a biome (§3.4).
 * @property {string} species species key into gen/trees/species.js SPECIES (e.g. 'pine_cathedral')
 * @property {number} weight integer selection weight — a per-column hash indexes the cumulative ladder (larger = commoner)
 */

/**
 * @typedef {object} DecorationConfig surface-decorator scatter tuning (surface_decorator.js DECO_DEFAULTS,
 *   mirrored 1:1). `*_one_in` = 1-in-N per eligible column; `grove_cell_shift` = log2 of the clumping cell.
 * @property {number} grove_cell_shift log2 grove-cell side, blocks (LIVE 4 = 16)
 * @property {number} tree_grove_one_in 1-in-N cells are tree groves (LIVE 3)
 * @property {number} rock_grove_one_in 1-in-N cells are rock groves (LIVE 6)
 * @property {number} forest_tree_density biome tree_density at/above which a grass floor is FOREST (LIVE 0.15)
 * @property {number} tall_cluster_one_in 1-in-N grove cells are tall-grass accent patches (LIVE 5)
 * @property {number} tall_in_cluster_one_in 1-in-N in-cluster columns grow tall_grass (LIVE 1)
 * @property {number} fern_one_in 1-in-N forest-floor columns grow fern (LIVE 1)
 * @property {number} forest_tuft_one_in 1-in-N forest-floor columns grow a tuft (LIVE 3)
 * @property {number} path_one_in 1-in-N forest grove cells are bare walking lanes (LIVE 5)
 * @property {number} flower_patch_one_in 1-in-N grove cells are meadow flower patches (LIVE 6)
 * @property {number} flower_in_patch_one_in 1-in-N in-patch columns bloom (LIVE 3)
 * @property {number} reed_one_in 1-in-N water-margin columns grow a reed (LIVE 2)
 * @property {number} shore_band water-margin band height above sea level, blocks (LIVE 2)
 * @property {number} reed_min_grass biome grass_density floor for reeds (LIVE 0.15)
 * @property {Partial<Record<string, boolean>>} [sprites] land kinds (tuft/tall_grass/fern/flower/reed) default
 *   ON; coral + the vivid sprite kinds (bush/orchid/dune_grass/frozen_shrub/… sprite-vivid roster) are OPT-IN
 *   (absent ⇒ OFF, byte-identical DEFAULT). Set a kind false to disable a default-on land kind, true to enable an opt-in one.
 * @property {OakTreeConfig} oak live oak-style tree geometry
 * @property {ConiferConfig} conifer conifer/spruce params (NG1-D, §2.1)
 * @property {GrammarConfig} [grammar] NATURE-PLACEMENT GRAMMAR (surface_decorator + far_trees_gen via
 *   deco_shared) — ecological tree/rock placement (clusters/slope/treeline/scree/hero). Absent/disabled ⇒
 *   the legacy grove+scatter path ⇒ byte-identical parity. Everest-only pattern-setter today.
 */

/**
 * @typedef {object} GrammarConfig NATURE-PLACEMENT GRAMMAR knobs (deco_shared.GRAMMAR_DEFAULTS, mirrored;
 *   every field but `enabled` optional → defaulted). Replaces the uniform grove-cell scatter with an
 *   ecological grammar the near decorator AND the far impostor mirror share (replaces uniform sprinkle
 *   placement with organic clustering, in the spirit of Conquest Reforged and Massive Mountains).
 * @property {boolean} enabled the grammar is on (absent/false ⇒ legacy grove scatter ⇒ byte-identical parity)
 * @property {number} [cluster_period] block period of a forest STAND/CLEARING (warped value-noise field)
 * @property {number} [cluster_octaves] value-noise octaves (1..4)
 * @property {number} [cluster_warp] domain-warp displacement (blocks) bending stand boundaries organic
 * @property {number} [cluster_threshold] field value below which tree density → 0 (clearings), [0,1]
 * @property {number} [cluster_softness] smoothstep width above threshold to a full-density stand core
 * @property {number} [canopy_density] WALKABILITY cap — the stand-CORE tree-anchor fraction [0,1] (keep
 *   ≤ ~0.1 so a path always exists; canopies still overlap wide ⇒ dense from outside, walkable inside)
 * @property {Record<string, number>} [biome_density] PER-REGION density knob — biome_name → canopy_density
 *   (each region pins a distinct biome, so taiga vs ice_forest is tuned from config, no code)
 * @property {number} [tree_slope_max] slope (rise/run) at/above which NO tree (bare steep faces/ridgelines)
 * @property {number} [slope_softness] slope band below tree_slope_max over which tree density ramps 1 → 0
 * @property {number} [slope_step] central-difference probe step (blocks) for the neighbourhood slope
 * @property {number} [treeline_band] blocks below `surface.treeline` over which trees thin out (krummholz; 0 = hard line)
 * @property {number} [rock_slope_boost] boulder density multiplier at full steepness (scree fields on steeps)
 * @property {number} [rock_density_scale] multiplier on the biome's 1/rock_one_in
 * @property {string} [hero_species] species key forced on a rare hero column (landmark giant), or absent ⇒ no hero
 * @property {number} [hero_one_in] 1-in-N tree columns become a hero (only when hero_species set)
 */

/**
 * @typedef {object} GeometryConfig world-box geometry (world_config.js; frozen contract, §3.4).
 * @property {number} chunk_size chunk edge, blocks (LIVE 32)
 * @property {number} world_height total world height, blocks (LIVE 384)
 */

/**
 * @typedef {object} LodConfig RENDER/LOD falloff schedule (BIOMES plan §P1 — "way more detailed in the
 *   beginning, then decrease quality FAST with distance"). RENDER-ONLY: gen/** never reads this, so it
 *   does NOT move golden GEN bytes; it tunes only the radial quality curve.
 *
 *   The falloff is TWO-TIER by construction (no third mesh system): a NEAR full-voxel ring
 *   (ring_manager, all block faces + overhangs + decorations + trees), then the FAR quadtree shell
 *   (lod/*), which already renders FULL-DISC beneath the near ring (far_streamer near_radius_m=0) masked
 *   per-column over drawn near columns. Shrinking `full_voxel_radius_chunks` reveals the far shell's FINE
 *   inner sections (L1 = 2 m cells, corner heights quantized to whole blocks + macro tint = a "fake
 *   voxel" look, far_mesher D206-B) closer to the camera; the shell's geometric ring widths (L1 64 m →
 *   L2 128 m → L3 256 m → L4 512 m span) ARE the steep-inverse-of-distance decay. So a shorter near ring
 *   = a richer-near / faster-falloff curve at FEWER total draw calls (each far section is one coarse draw
 *   covering many near columns), which is the §P1 budget goal.
 * @property {number} full_voxel_radius_chunks NEAR full-voxel streaming ring radius, in chunks
 *   (ring_manager load_radius). Each chunk is 32 m, so radius r ⇒ an r·32 m rich near band. Lower =
 *   shorter rich band + the far shell (and its faster falloff) starts closer + fewer near draws.
 * @property {number} far_radius_m FAR-shell outer reach in meters (far_streamer far_radius_m / the
 *   quadtree root footprint radius) — how far to the horizon the coarse colored shell extends.
 */

/**
 * @typedef {object} RegionClassConfig ONE sub-biome region class (S-25 "world-as-planet"). The region
 *   field r∈[0,1] is partitioned into ordered bands; this class owns [prev.upto, upto). Each class
 *   modulates the massif surface (terrain), shifts the alpine ice-line (palette), and pins a biome
 *   (decoration + strata). All knobs optional (default = identity/no-pin).
 * @property {string} name region class label (taiga / glacier / peaks / ice_wasteland / ice_forest / …)
 * @property {number} upto the class' UPPER edge in the region field r∈[0,1] (its band = [prev.upto, upto));
 *   the last class should reach ≥1 so the ladder saturates. Strictly ascending across the class list.
 * @property {string} [biome] biome NAME this region pins (must resolve in the world biome table AND the
 *   module biome_registry — the decorator resolves decoration by module id). Absent ⇒ keep climate placement.
 * @property {number} [relief_scale] massif-body multiplier: <1 flattens the region toward its valley floor
 *   (glacier basins / flat wastelands), 1 keeps the natural massif (peaks), >1 amplifies (default 1)
 * @property {number} [height_bias] additive world-y shift for the whole region, blocks (default 0)
 * @property {number} [roughness_scale] massif face-detail (ero+micro) multiplier: <1 smooth (glaciers),
 *   >1 jagged (peak couloirs) (default 1)
 * @property {number} [ice_line_delta] additive shift to the alpine painter ice_line, blocks: − lowers ice
 *   into a low glacier basin (ice sheet), + raises it to summit caps only (default 0)
 */

/**
 * @typedef {object} RegionsConfig S-25 SUB-BIOME REGION LAYER (gen/stages/regions.js) — a low-frequency
 *   field partitioning a MASSIF world into named terrain regions so one cold world reads as many places
 *   (a lot of terrain variety — no locations look the same). Config-first + everest-only today:
 *   absent / enabled:false ⇒ region_profile returns identity ⇒ the massif is byte-identical and no biome/
 *   palette is overridden (every non-region world unchanged). The PATTERN-SETTER the per-world fan-out copies.
 * @property {boolean} enabled the layer is on (needs a non-empty `classes` list)
 * @property {{ period: number, octaves?: number }} [field] the low-freq region field r (own sub-seed) —
 *   large period ⇒ broad regions you traverse for a while (default period 2200, octaves 2)
 * @property {{ period: number, octaves?: number, amp: number }} [warp] domain-warp the region field so the
 *   band boundaries meander (organic pockets, not concentric rings); amp = displacement blocks
 * @property {number} [blend] smoothstep half-width (in r units) cross-fading adjacent class bands, so the
 *   terrain params are CONTINUOUS across a border (no cliffs). 0 ⇒ hard bands (default 0)
 * @property {{ period?: number, octaves?: number, relief?: number, rough?: number, bias?: number, ice?: number }}
 *   [variance] the 2nd low-freq channel that jitters the blended profile within a region so two patches of
 *   the same class differ (relief/rough = multiplicative fractions, bias/ice = additive blocks)
 * @property {RegionClassConfig[]} classes the ordered region classes (bands over r∈[0,1])
 */

/**
 * The ENTIRE world recipe — one serializable object (§2.3). `seed`+`version` gate world identity;
 * any value change re-cuts golden hashes (§4).
 * @typedef {object} WorldGenConfig
 * @property {string} seed master world seed (LIVE MASTER_SEED)
 * @property {number} version recipe version — bumps gate golden hashes (§4)
 * @property {GeometryConfig} geometry world-box geometry (§3.4)
 * @property {NoiseConfig} noise per-field fbm defs (§4.1 + NG1-A)
 * @property {SplinesConfig} splines Catmull-Rom height tables (§4.2)
 * @property {DensityConfig} density unified 3D density params (§2.2)
 * @property {CarversConfig} carvers canyon + cave carvers (§2.1/§2.2)
 * @property {HydrologyConfig} hydrology sea level + rivers + beach (§4.4)
 * @property {StrataConfig} strata elevation strata banding (§2.1)
 * @property {SurfaceConfig} surface slope-material + snow-cap gates (§2.1)
 * @property {IcebergConfig} icebergs buoyant ocean ice masses (FIVE-WORLDS Everest)
 * @property {CragConfig} [crag] crag/gully + micro spectrum repair (GLACIAL §A)
 * @property {MassifConfig} [massif] S-24 composite surface — owns raw_land when enabled (Everest)
 * @property {RegionsConfig} [regions] S-25 sub-biome region layer — partitions a massif world into named
 *   terrain regions (Everest pattern-setter); absent ⇒ identity ⇒ byte-identical world
 * @property {TroughConfig} [trough] glacial U-trough reshape (GLACIAL §B.1)
 * @property {CirqueConfig} [cirque] amphitheater scoop placer (GLACIAL §B.2)
 * @property {GlacierConfig} [glacier] glacier ribbon + moraines surface stage (GLACIAL §B.3)
 * @property {WaterOpticsConfig} water per-config water shading params (FIVE-WORLDS)
 * @property {SkyConfig} sky inverted-shell sky islands (§2.2)
 * @property {BiomeSelectionConfig} biome_selection placement metric (§4.3)
 * @property {BiomeConfig[]} biomes the biome table (§4.3)
 * @property {DecorationConfig} decoration decorator scatter tuning (§4.6)
 * @property {LodConfig} [lod] RENDER-ONLY LOD falloff schedule (§P1). Optional for back-compat with
 *   pre-P1 blobs; engine.js falls back to the world_config constants when absent.
 * @property {Record<string, string[]>} [structure_pool_overrides] biome_name → bundle pool ids added to
 *   that biome's schematic sets, config-only (FIVE-WORLDS decorator hook; default {} = parity)
 * @property {TreesConfig} [trees] procedural-tree rollout gate (§3.5; default `procedural:false` ⇒ schematics ⇒ parity)
 * @property {Record<string, TreeSpeciesEntry[]>} [tree_species] biome_name → weighted procedural-species
 *   roster (§3.4). Read ONLY when `trees.procedural` — populated in DEFAULT so `?proctrees=1` shows trees
 *   without a world edit, but INERT (never read) while procedural is false ⇒ byte-identical DEFAULT world.
 * @property {import('../render/texture_palette.js').TexturesConfig} [textures] per-biome TEXTURE IDENTITY
 *   (FIVE-WORLDS) — per-family HSV palette transforms baked into the atlas + far-shell colours. Absent/
 *   all-identity = byte-identical atlas (render-only; never in the gen golden). §texture_palette.js.
 */

// =============================================================================================
// DEFAULT_WORLD_GEN_CONFIG — the CURRENT live values, transcribed byte-faithfully from gen/.
// Every number below is sourced from a live constant (file cited). Do NOT re-tune here: changing
// a default moves the golden hashes = a world fork (§4). This is a faithful mirror, not a redesign.
// =============================================================================================

/**
 * The default recipe = today's engine. Sourced 1:1 from: world_config.js (seed, geometry, sea
 * level, hard floor, GEN_VERSION), fields.js (climate periods/octaves), sampler.js (spread/gain),
 * terrain_shaper.js (splines), gen/density.js DENSITY_CONFIG (band/warp/detail/overhang/caves/sky —
 * the ACTIVE unified 3D field), biome_placer.js (axis weights, blend, softness), biome_registry.js
 * (subsurface depth, esoteric threshold, the 17 biomes), surface_decorator.js (grove/tree/flower/
 * tuft/oak geometry), world_gen.js (beach band). Stages not yet built (canyon carver, strata
 * banding, slope/snow surface, conifers) carry playbook §2.x proposed defaults gated `enabled:false`
 * so live behaviour is unchanged. Every value is cross-checked against its live source in the test.
 * @type {WorldGenConfig}
 */
export const DEFAULT_WORLD_GEN_CONFIG = {
  seed: 'aresrpg', // world_config.MASTER_SEED
  version: 14, // world_config.GEN_VERSION (v14: region-driven terrain corpus-wide + spawn dry-floor; v13 spawn-clearing — see world_config.js ledger)
  geometry: {
    chunk_size: 32, // world_config.CHUNK_SIZE
    world_height: 384, // world_config.WORLD_HEIGHT
  },
  noise: {
    // fields.js: *_PERIOD + CLIMATE_OCTAVES (6), weirdness octaves 4; sampler defaults spread 2/gain 0.5.
    // The 3D shaping fields (warp / detail-ridged / spaghetti / sky) live under `density`/`carvers`/
    // `sky` (mirroring gen/density.js DENSITY_CONFIG, which co-locates their period+octaves+amp), so
    // `noise` holds exactly the 5 LIVE 2D climate fields — no duplicate/speculative field defs.
    temperature: { period: 2048, octaves: 6, spread: 2, gain: 0.5 },
    humidity: { period: 1536, octaves: 6, spread: 2, gain: 0.5 },
    continentalness: { period: 4096, octaves: 6, spread: 2, gain: 0.5 },
    erosion: { period: 1024, octaves: 6, spread: 2, gain: 0.5 },
    weirdness: { period: 512, octaves: 4, spread: 2, gain: 0.5 },
  },
  splines: {
    // terrain_shaper.js: CONTINENTALNESS_TO_BASE / EROSION_TO_AMPLITUDE / PV_TO_RELIEF, tuple form —
    // NOW the SINGLE SOURCE OF TRUTH (terrain_shaper compiles these tuples into its runtime tables).
    // continentalness_to_base knots straddle the waterline: 126 = SEA_LEVEL-2, 132 = SEA_LEVEL+4.
    // erosion_to_amplitude / pv_to_relief carry the NG1-B relief-amplitude retune (GEN_VERSION 3):
    // the low-erosion end reaches ~148 (mountain BELTS ~100-160 blocks) and the valley floor drops to
    // -0.2 — transcribed 1:1 from the live shaper. (Corrected 2026-07-06 during config adoption: the
    // earlier literals here were the pre-NG1-B values [72/56/30/12/4] & [-0.15/0.22/0.55], stale since
    // the shaper retune — a transcription bug that the fake hardcoded test cross-check masked. The
    // decorated-chunk golden parity test proves these reproduce the live world byte-for-byte.)
    continentalness_to_base: [
      [0.0, 88],
      [0.18, 104],
      [0.34, 126],
      [0.42, 132],
      [0.6, 148],
      [0.8, 160],
      [1.0, 176],
    ],
    erosion_to_amplitude: [
      [0.0, 148],
      [0.16, 120],
      [0.34, 66],
      [0.55, 30],
      [0.75, 12],
      [1.0, 4],
    ],
    pv_to_relief: [
      [0.0, -0.2],
      [0.12, 0.0],
      [0.35, 0.26],
      [0.65, 0.6],
      [1.0, 1.0],
    ],
  },
  // density = LIVE gen/density.js DENSITY_CONFIG, mirrored 1:1 (its header: "NG1-E promotes this into
  // the full serializable world_gen_config schema"). This unified 3D field is ACTIVE (overhangs +
  // caves + sky islands), which is why the golden hash sits at GEN_VERSION 2. Cross-checked in the test.
  density: {
    band_blocks: 10, // DENSITY_CONFIG.band_blocks (LIVE — NG1-A's own band, diverged from shaper's 8)
    hard_floor_y: 3, // world_config.HARD_FLOOR_Y (LIVE bedrock floor)
    warp: { period: 240, octaves: 2, amp: 26 }, // DENSITY_CONFIG.warp (LIVE)
    detail: { period: 132, octaves: 4, amp: 34 }, // DENSITY_CONFIG.detail (LIVE overhang ridged noise)
    overhang: { erosion_max: 0.46, pv_min: 0.46, strength: 1.35 }, // DENSITY_CONFIG.overhang (LIVE gate)
  },
  carvers: {
    // caves = LIVE DENSITY_CONFIG.caves (ACTIVE — near-surface spaghetti crust). `canyon` is the
    // FIVE-WORLDS config-gated ADDITIVE canyon stage (gen/carvers/canyon.js canyon_stage_depth): a
    // SECOND, deeper channel carved ON TOP of the always-on NG1-B erosion-baseline canyon (which stays
    // untouched — gating IT would fork the golden, since it materially carves the shipped world). So
    // enabled:false ⇒ zero additional carve ⇒ byte-identical DEFAULT; Riviera cranks it for dramatic
    // steep-walled ravines. width = crest-band half-width fraction (larger=wider); depth = max axis carve
    // (blocks, the wall height); wall_steepness = axis depth-curve exponent t^k (higher=steeper walls);
    // warp = domain-warp the sample first for organic meander.
    canyon: { enabled: false, width: 0.06, depth: 40, wall_steepness: 2, warp: true },
    caves: {
      // Mirror of the LIVE near-surface spaghetti crust (DENSITY_CONFIG.caves, projected from
      // carvers/caves.js CAVES_CONFIG.spaghetti). NG1-B moved caves to carvers/caves.js and added
      // worley caverns + worms; extending this schema block to carry those is an NG1-E follow-up.
      depth_min: 3, // CAVES_CONFIG.spaghetti.depth_min (LIVE — solid crust before carving)
      depth_max: 34, // CAVES_CONFIG.spaghetti.depth_max (LIVE)
      spaghetti_period: 88, // CAVES_CONFIG.spaghetti.period (LIVE)
      spaghetti_threshold: 0.9, // CAVES_CONFIG.spaghetti.threshold (LIVE)
      spaghetti_depth: 40, // CAVES_CONFIG.spaghetti.depth (LIVE — density subtracted at core)
    },
  },
  hydrology: {
    // sea_level: documented world identity, NOT threaded — world_config.SEA_LEVEL is the cross-engine
    // single source of truth (imported by column_gen/world_gen/mesher/border/atmosphere); threading a
    // per-world value into all of those is out of this adoption's scope (declared, §P0-follow-up).
    sea_level: 128,
    // river/lake/waterfall = LIVE gen/hydrology.js HYDROLOGY_CONFIG, mirrored 1:1 (the earlier
    // {valley_width/floor_ratio/shape} river was a stale placeholder — schema now matches the live
    // folded-ridge river + pour-point lake + waterfall recipe). Cross-checked in world_gen_config.test.js.
    river: {
      crease: { period: 560, octaves: 3 }, // thin river crest network
      warp: { period: 520, octaves: 2, amp: 70 }, // meander
      width: 0.12, // crest-band half-width (river center → edge)
      depth: 11, // max channel carve at center, blocks
      bank: 3, // water surface this many blocks below the un-carved land (dry banks)
      continentalness_min: 0.42, // inland of the beach band (no ocean rivers)
      pv_max: 0.72, // valleys/slopes, not the highest peaks
      max_step: 1, // containment clamp: river surface stands ≤1 block proud of its lowest neighbour (no
      //   exposed voxel-water walls staircasing down a slope) — see hydrology.js HYDROLOGY_CONFIG.river
    },
    lake: {
      period: 320,
      octaves: 2,
      threshold: 0.72, // basin field above this = candidate lake area
      erosion_min: 0.5, // lowland/flat only
      pv_max: 0.3,
      min_body_depth: 4, // a lake body must reach this depth or it stays dry (kills puddles)
    },
    waterfall: {
      min_drop: 6, // an uphill river neighbor this much higher spills a sheet onto us
      fall_max: 28, // cap the sheet height (deep canyon fall stays a fall, not a wall)
      cascade_drop: 2, // a river ≥ this above a neighbor's top is a cascade lip (flag-only)
    },
    beach: {
      band_low: 126, // world_gen.BEACH_BAND_LOW = SEA_LEVEL - 2 (LIVE)
      band_high: 131, // world_gen.BEACH_BAND_HIGH = SEA_LEVEL + 3 (LIVE)
      flat_y: 129, // world_gen.BEACH_FLAT_Y = SEA_LEVEL + 1 (LIVE)
    },
  },
  strata: {
    // FIVE-WORLDS STRATA BANDING (gen/stages/strata.js — Riviera limestone terraces). Quantizes the
    // exposed rock of STEEP columns into horizontal sedimentary bands (pale-stone strata) — flat ground
    // keeps its biome soil. Off in the live engine → enabled:false ⇒ byte-identical DEFAULT.
    //   band_height   one strata band thickness, blocks
    //   band_jitter   per-column ± y offset so band boundaries waver across a cliff, blocks
    //   slope_gate    slope (rise/run) at/above which a column bands (below = normal biome surface)
    //   palette       ordered strata block names, hash-bucketed per band (must resolve in block_registry)
    enabled: false,
    band_height: 4, // (was band_thickness; renamed to the FIVE-WORLDS param name)
    band_jitter: 7, // (was warp_amp)
    slope_gate: 0.55,
    palette: ['stone', 'dirt', 'sand'],
    subsurface_depth: 4, // biome_registry.SUBSURFACE_DEPTH (LIVE — unchanged)
  },
  surface: {
    // FIVE-WORLDS SLOPE/SNOW SURFACE (gen/stages/surface_by_slope.js — Everest). Overrides the surface
    // block by (altitude, slope): high + flat → snow; steep → bare rock; moderate slope → scree/talus.
    // Live surface is biome-fixed → both gates false ⇒ byte-identical DEFAULT. `treeline` is read by the
    // decorator (no trees anchored above it); default = world_height ⇒ no effect.
    slope_enabled: false,
    snow_enabled: false,
    snow_line: 190, // world-y above which flat columns snow-cap
    steep_slope: 0.7, // slope (rise/run) at/above which a face is bare rock
    grass_slope: 0.2, // slope below which the surface reads as its biome cover (snow only applies here)
    scree_enabled: false, // scree/talus apron on moderate slopes [grass_slope, steep_slope)
    scree_relief: 0, // GLACIAL §B.4 talus-apron mound height at cliff feet, blocks (0 = material-only, parity)
    treeline: 384, // world-y above which the decorator anchors no trees (default = world_height ⇒ off)
    snow_block: 'snow', // surface block for the snow cap (must resolve in block_registry)
    rock_block: 'stone', // surface block for bare steep rock
    scree_block: 'stone', // surface block for the talus/scree apron
    // GLACIAL §C SNOW-SCORE v2: probability field (altitude/slope/speckle) → salt-and-pepper snow↔rock
    // transition. Off ⇒ the hard threshold above runs ⇒ byte-identical DEFAULT.
    snow_score: {
      enabled: false,
      band_low: 170, // below this world-y the score never applies (biome cover kept)
      band_high: 240, // altitude term saturates at/above this
      slope_max: 0.9, // snow probability → 0 at this slope
      speckle_period: 40, // melt/salt-and-pepper noise wavelength, blocks
      speckle_octaves: 4, // broad melt patches + fine grain
      speckle_amp: 0.7, // speckle perturbation on the score
      threshold: 0.5, // score ≥ this → snow, else bare rock
    },
  },
  // FIVE-WORLDS ICEBERG PLACER (gen/stages/icebergs.js — Everest oceans). Buoyant ice masses in
  // below-sea columns: region-gated cell hash → radial ICE blobs anchored at sea level (freeboard above +
  // draft below the waterline). Off in the live engine → enabled:false ⇒ byte-identical DEFAULT.
  //   region_size/region_rate  coarse XZ tiling + fraction of cells that host icebergs
  //   blobs_min/blobs_max      icebergs per iceberg region
  //   radius_min/radius_max    horizontal blob radius, blocks
  //   freeboard/draft          ice height above / depth below the waterline, as a fraction of radius
  icebergs: {
    enabled: false,
    region_size: 384,
    region_rate: 0.22,
    blobs_min: 2,
    blobs_max: 6,
    radius_min: 8,
    radius_max: 24,
    freeboard: 0.35,
    draft: 0.9,
  },
  // RELIEF LADDER (gen/stages/crag.js — TERRAIN_REALISM_BASELINE.md, grew out of GLACIAL §A).
  // ENABLED BY DEFAULT since the realism-baseline fork (GEN_VERSION 7 —
  // realistic terrain for all biomes): every world inherits a MODERATE rolling baseline — realistic,
  // not everest-dramatic. micro_amp ≥ 2 is the ANTI-FLAT GUARANTEE (no dead-flat terrain by omission);
  // relief_floor 0 keeps the band alive on gentle ground; base/roll ride unscaled (the connected ridge
  // network + drumlins that kill "boulder on a plain"). Recipes retune amps, oracles (gen/stages/
  // terrain_realism.test.js) stop them from zeroing back into a plane.
  crag: {
    enabled: true,
    band_period: 320, // ridged crag band base wavelength (4 octaves fold to ~40-320 blocks)
    band_octaves: 4,
    band_amp: 14, // crag half-amplitude at full relief, blocks (moderate baseline)
    base_period: 250, // unscaled ridge-network base wavelength, blocks
    base_octaves: 4,
    base_amp: 8, // ridge-network half-amplitude everywhere, blocks (connected relief baseline)
    roll_period: 60, // drumlin/moraine roll base wavelength, blocks
    roll_octaves: 3,
    roll_amp: 5, // drumlin-roll half-amplitude everywhere, blocks
    micro_period: 12, // micro-roughness base wavelength, blocks
    micro_octaves: 3,
    micro_amp: 2, // micro half-amplitude everywhere — the anti-flat guarantee (≥ 2 ALWAYS), blocks
    relief_floor: 0, // band alive on gentle ground too (0 = no dead valley-calm cutoff by default)
    relief_gain: 0.5, // relief span over which crag ramps 0→1 above the floor
    // FLAT-SMOOTH (Testlands/DEFAULT byte-freeze LIFTED for this — GEN_VERSION 11→12):
    // plains read slightly too granular; softly smooth ONLY the plain terrain, keep the rest of the
    // variety". The unscaled roll(±5)+micro(±2) rode EVERY column (the anti-flat guarantee) and read as
    // 1-block rubble on walkable flats. Now they attenuate by smoothstep(relief) over [0, 0.20]: relief ≤ 0
    // (the pv-relief floor — ~80% of the map, the plains) → jitter fully damped (clean runs); relief ≥ 0.20
    // (cliffs/badlands/peaks, the top ~10%) → untouched. base (the ~250-block ridge network) is NOT damped,
    // so plains keep a soft broad undulation, never dead-flat. Inherited by every DEFAULT-clone spline world
    // (paradise/rainforest/ember_steppe + everglades); everest uses massif (crag bypassed) + its regions'
    // per-class roughness_scale already flattens its basins, so it is unaffected.
    flat_lo: 0,
    flat_hi: 0.2,
  },
  // S-24 COMPOSITE SURFACE (gen/stages/massif.js). When enabled it OWNS raw_land (C trunk drainage + A
  // ridge skeleton + B face erosion + micro), replacing the spline/erosion/canyon/trough composition.
  // Off in DEFAULT ⇒ enabled:false ⇒ the legacy raw_land runs ⇒ byte-identical world. Everest turns it on.
  massif: {
    enabled: false,
    floor: 10, // deepest master-valley corridor floor, world-y
    span: 350, // body height span (floor + span ≈ summit body cap)
    trunk_warp_period: 1650,
    trunk_warp_amp: 300,
    trunk_period: 1180,
    trunk_octaves: 5,
    env_lo: 0.12,
    env_hi: 0.6,
    skel_warp_period: 1500,
    skel_warp_amp: 330,
    skel_period: 780,
    skel_octaves: 5,
    skel_lo: 0.13,
    skel_hi: 0.68,
    shoulder: 0.32,
    ero_period: 640,
    ero_octaves: 4,
    ero_damp: 30,
    ero_amp: 15,
    ero_face_lo: 0.12,
    ero_face_hi: 0.55,
    ero_crest_fade: 0.82,
    micro_period: 22,
    micro_amp: 2.2,
  },
  // GLACIAL §B.1 GLACIAL TROUGH (gen/stages/trough.js). Reshapes the PV valley network into a flat-floored,
  // steep-walled U-profile (ref R2). Off ⇒ zero carve ⇒ byte-identical DEFAULT.
  trough: {
    enabled: false,
    depth: 28, // max carve at the flat floor, blocks
    floor_pv: 0.06, // pv ≤ this = full-depth flat floor (glacier/outwash plain half-width)
    wall_pv: 0.34, // pv ≥ this = no carve (ridges untouched); U wall spans [floor_pv, wall_pv]
  },
  // GLACIAL §B.2 CIRQUE SCOOP (gen/stages/cirque.js). Region-gated amphitheater bowls (flat floor + steep
  // headwall + rim lip) carved into high ridge heads (ref R4). Off ⇒ zero carve ⇒ byte-identical DEFAULT.
  cirque: {
    enabled: false,
    region_size: 256, // cirque-region cell size, blocks
    region_rate: 0.5, // fraction of region cells that host cirques
    per_region: 2, // candidate centres per hosting region (altitude-gated at build)
    radius_min: 26, // min rim radius, blocks
    radius_max: 60, // max rim radius, blocks
    depth: 34, // bowl floor carve depth, blocks
    floor_ratio: 0.35, // flat-floor radius as a fraction of the rim radius
    lip: 3, // raised-rim width just outside the rim, blocks
    min_altitude: 180, // land-y a centre must exceed to host a cirque
  },
  // GLACIAL §B.3 GLACIER RIBBON + MORAINES (gen/stages/glacier.js). Material-only surface stage: flat trough
  // floors in the ice band → ice/firn with dark medial + lateral moraine stripes, crevasse banding, terminal
  // rubble. Curves with the valley (keyed on PV + altitude). Off ⇒ -1 everywhere ⇒ byte-identical DEFAULT.
  glacier: {
    enabled: false,
    ice_low: 150, // bottom of the glacier ice altitude band, world-y
    ice_high: 260, // top of the ice band (above = snow/rock), world-y
    flat_gate: 0.35, // slope ≤ this = flat glacier floor
    valley_pv: 0.28, // pv ≤ this = valley/trough floor
    medial_pv: 0.05, // pv ≤ this = dark medial moraine (centreline stripe)
    lateral_band: 0.06, // pv within this of valley_pv = lateral moraine (wall-hugging)
    crevasse_period: 9, // altitude period of crevasse banding, blocks
    terminal_band: 12, // blocks above ice_low that read as terminal rubble
    firn_band: 24, // blocks below ice_high that read as granular firn
    ice_block: 'ice', // main glacier ice
    firn_block: 'snow', // upper granular firn
    moraine_block: 'stone', // dark medial + lateral debris
    crevasse_block: 'packed_ice', // crevasse groove stripe
    rubble_block: 'stone', // terminal rubble
  },
  // FIVE-WORLDS PER-CONFIG WATER OPTICS (render/water_material.js reads this). Defaults transcribed 1:1
  // from the live water_material constants so DEFAULT water is byte-identical (visual-only — never in the
  // gen golden). Everglades sets a murky brown-green, Paradise a turquoise high-clarity body.
  //   body_color/shallow_color  deep / shallow linear-RGB tint (0..1)
  //   sigma                     Beer-Lambert per-block extinction (r,g,b) — bigger = murkier/shallower
  //   fade_start/tint_depth     see-through→opaque ramp window, blocks
  //   deep_floor                residual body glow once the bed is fully extinguished
  water: {
    body_color: [0.03, 0.105, 0.15], // WATER_BODY_COLOR
    shallow_color: [0.13, 0.34, 0.42], // WATER_SHALLOW_COLOR
    sigma: [0.9, 0.62, 0.48], // WATER_SIGMA
    fade_start: 2.5, // WATER_FADE_START
    tint_depth: 6.0, // WATER_TINT_DEPTH
    deep_floor: 0.16, // WATER_DEEP_FLOOR
  },
  // sky = LIVE gen/sky_islands.js SKY_ISLANDS_CONFIG (== DENSITY_CONFIG.sky) — Pandora floating
  // islands, region-gated (v5). Mirrored 1:1 (guarded field-for-field in world_gen_config.test.js).
  sky: {
    enabled: true, // SKY_ISLANDS_CONFIG.enabled (LIVE)
    low_y: 300, // cap altitude band bottom
    high_y: 352, // cap altitude band top
    thickness: 116, // band margin (contains roots below + crown above): cap_radius_max·root_ratio_max
    region_size: 768, // sky-region cell size, blocks
    region_rate: 0.13, // fraction of region cells that are sky-island regions
    islands_min: 3, // archipelago min islands per sky region
    islands_max: 8, // archipelago max islands per sky region
    satellites_max: 2, // max companion islets per island
    cap_radius_min: 24, // ≥24 so islands read as landmasses from the ground
    cap_radius_max: 52,
    root_ratio_min: 1.5, // root depth = cap_r × root_ratio (hanging taper)
    root_ratio_max: 2.2,
    crown_ratio: 0.22, // crown dome height above cap, fraction of cap radius
    wobble_amp: 0.3, // rim wobble amplitude, fraction of local radius
    wobble_period: 34, // rim value-noise lattice period, blocks
    satellite_radius_ratio: 0.4, // satellite cap radius as a fraction of parent's
    satellite_orbit: 1.7, // satellite orbit distance in parent radii
    crust_depth: 4, // grass/soil crust on island tops, blocks
  },
  biome_selection: {
    // biome_placer.js: AXIS_WEIGHTS, BLEND_K, TRANSITION_SOFTNESS; biome_registry WEIRDNESS_ESOTERIC_THRESHOLD.
    axis_weights: {
      temperature: 1.0,
      humidity: 1.0,
      continentalness: 0.6,
      erosion: 0.5,
      pv: 0.4,
    },
    blend_k: 3,
    transition_softness: 0.6,
    weirdness_esoteric_threshold: 0.82,
  },
  // biome_registry.BIOME_REGISTRY — the 17 biomes, transcribed 1:1 (ids are persisted, never renumber).
  biomes: [
    {
      id: 0,
      name: 'ocean',
      climate: { temperature: 0.5, humidity: 0.6, continentalness: 0.05, erosion: 0.8, pv: 0.3 },
      weight: 1.4,
      weirdness_gate: false,
      land: { surface: 'sand', subsurface: 'dirt', underwater: 'sand', filler: 'stone' },
      tree_density: 0,
      grass_density: 0,
      structure_pools: [],
      music_bed: 'ocean',
    },
    {
      id: 1,
      name: 'beach',
      climate: { temperature: 0.55, humidity: 0.5, continentalness: 0.32, erosion: 0.85, pv: 0.45 },
      weight: 1.1,
      weirdness_gate: false,
      land: { surface: 'sand', subsurface: 'sand', underwater: 'sand', filler: 'stone' },
      tree_density: 0.01,
      grass_density: 0.05,
      structure_pools: [],
      music_bed: 'beach',
    },
    {
      id: 2,
      name: 'river',
      climate: { temperature: 0.5, humidity: 0.7, continentalness: 0.55, erosion: 0.7, pv: 0.02 },
      weight: 1.2,
      weirdness_gate: false,
      land: { surface: 'sand', subsurface: 'dirt', underwater: 'sand', filler: 'stone' },
      tree_density: 0.05,
      grass_density: 0.3,
      structure_pools: [],
      music_bed: 'river',
    },
    {
      id: 3,
      name: 'grassland',
      climate: { temperature: 0.55, humidity: 0.3, continentalness: 0.7, erosion: 0.8, pv: 0.5 },
      weight: 1,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.03,
      grass_density: 0.7,
      structure_pools: ['village_plains'],
      music_bed: 'grassland',
    },
    {
      id: 4,
      name: 'temperate_forest',
      climate: { temperature: 0.5, humidity: 0.55, continentalness: 0.68, erosion: 0.72, pv: 0.5 },
      weight: 1,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.18,
      grass_density: 0.5,
      structure_pools: ['village_plains'],
      music_bed: 'forest',
    },
    {
      id: 5,
      name: 'dense_forest',
      climate: { temperature: 0.48, humidity: 0.75, continentalness: 0.66, erosion: 0.68, pv: 0.52 },
      weight: 1,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.35,
      grass_density: 0.6,
      structure_pools: [],
      music_bed: 'forest',
    },
    {
      id: 6,
      name: 'swamp',
      climate: { temperature: 0.6, humidity: 0.9, continentalness: 0.58, erosion: 0.9, pv: 0.32 },
      weight: 1,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.12,
      grass_density: 0.4,
      structure_pools: [],
      music_bed: 'swamp',
    },
    {
      id: 7,
      name: 'taiga',
      climate: { temperature: 0.28, humidity: 0.4, continentalness: 0.7, erosion: 0.6, pv: 0.55 },
      weight: 1,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.2,
      grass_density: 0.35,
      structure_pools: [],
      music_bed: 'taiga',
    },
    {
      id: 8,
      name: 'arctic',
      climate: { temperature: 0.1, humidity: 0.6, continentalness: 0.68, erosion: 0.7, pv: 0.5 },
      weight: 1,
      weirdness_gate: false,
      land: { surface: 'snow', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.04,
      grass_density: 0.1,
      structure_pools: [],
      music_bed: 'arctic',
    },
    {
      id: 9,
      name: 'glacier',
      climate: { temperature: 0.05, humidity: 0.85, continentalness: 0.6, erosion: 0.5, pv: 0.6 },
      weight: 1,
      weirdness_gate: false,
      land: { surface: 'snow', subsurface: 'snow', underwater: 'stone', filler: 'stone' },
      tree_density: 0,
      grass_density: 0,
      structure_pools: [],
      music_bed: 'arctic',
    },
    {
      id: 10,
      name: 'desert',
      climate: { temperature: 0.92, humidity: 0.08, continentalness: 0.72, erosion: 0.82, pv: 0.5 },
      weight: 1,
      weirdness_gate: false,
      land: { surface: 'sand', subsurface: 'sand', underwater: 'sand', filler: 'stone' },
      tree_density: 0.005,
      grass_density: 0.05,
      structure_pools: [],
      music_bed: 'desert',
    },
    {
      id: 11,
      name: 'scorched_badlands',
      climate: { temperature: 0.95, humidity: 0.2, continentalness: 0.7, erosion: 0.4, pv: 0.62 },
      weight: 1,
      weirdness_gate: false,
      land: { surface: 'sand', subsurface: 'dirt', underwater: 'sand', filler: 'stone' },
      tree_density: 0,
      grass_density: 0.02,
      structure_pools: [],
      music_bed: 'desert',
    },
    {
      id: 12,
      name: 'tropical',
      climate: { temperature: 0.85, humidity: 0.85, continentalness: 0.65, erosion: 0.75, pv: 0.48 },
      weight: 1,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'sand', filler: 'stone' },
      tree_density: 0.28,
      grass_density: 0.7,
      structure_pools: [],
      music_bed: 'tropical',
    },
    {
      id: 13,
      name: 'alpine',
      climate: { temperature: 0.3, humidity: 0.45, continentalness: 0.72, erosion: 0.15, pv: 0.85 },
      weight: 1.05,
      weirdness_gate: false,
      land: { surface: 'stone', subsurface: 'stone', underwater: 'stone', filler: 'stone' },
      tree_density: 0.05,
      grass_density: 0.2,
      structure_pools: [],
      music_bed: 'alpine',
    },
    {
      id: 14,
      name: 'crystal_hollows',
      climate: { temperature: 0.5, humidity: 0.5, continentalness: 0.75, erosion: 0.5, pv: 0.6 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.02,
      grass_density: 0.15,
      structure_pools: ['crystal_geode'],
      music_bed: 'esoteric',
    },
    {
      id: 15,
      name: 'obsidian_spires',
      climate: { temperature: 0.7, humidity: 0.2, continentalness: 0.74, erosion: 0.1, pv: 0.92 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'stone', subsurface: 'stone', underwater: 'stone', filler: 'stone' },
      tree_density: 0,
      grass_density: 0,
      structure_pools: ['obsidian_spire'],
      music_bed: 'esoteric',
    },
    {
      id: 16,
      name: 'void_marsh',
      climate: { temperature: 0.4, humidity: 0.95, continentalness: 0.55, erosion: 0.95, pv: 0.25 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'dirt', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.03,
      grass_density: 0.1,
      structure_pools: [],
      music_bed: 'esoteric',
    },
  ],
  decoration: {
    // surface_decorator.js DECO_DEFAULTS, mirrored 1:1 (the earlier grove_one_in/tree_one_in/flower_one_in/
    // tuft_one_in keys were STALE pre-DIVERGENCE constants no longer read by the decorator — schema now
    // matches the live grove + DIVERGENCE-WAVE cross-flora densities). Cross-checked in world_gen_config.test.js.
    grove_cell_shift: 4, // GROVE_CELL_SHIFT (log2 grove-cell side)
    tree_grove_one_in: 3, // TREE_GROVE_ONE_IN
    rock_grove_one_in: 6, // ROCK_GROVE_ONE_IN
    forest_tree_density: 0.15, // FOREST_TREE_DENSITY (grass floor is FOREST fern at/above this tree_density)
    tall_cluster_one_in: 5, // TALL_CLUSTER_ONE_IN
    tall_in_cluster_one_in: 1, // TALL_IN_CLUSTER_ONE_IN
    fern_one_in: 1, // FERN_ONE_IN
    forest_tuft_one_in: 3, // FOREST_TUFT_ONE_IN
    path_one_in: 5, // PATH_ONE_IN
    flower_patch_one_in: 6, // FLOWER_PATCH_ONE_IN
    flower_in_patch_one_in: 3, // FLOWER_IN_PATCH_ONE_IN
    reed_one_in: 2, // REED_ONE_IN
    shore_band: 2, // SHORE_BAND
    reed_min_grass: 0.15, // REED_MIN_GRASS
    oak: { trunk_min: 4, trunk_max: 6, canopy_radius: 2, cap_radius: 1 }, // stamp_tree geometry (LIVE)
    conifer: { enabled: false, trunk_min: 6, trunk_max: 12, base_radius: 2, radius_step: 1 }, // §2.3
  },
  // lod = RENDER-ONLY falloff (§P1). Defaults transcribed 1:1 from the live render constants so the
  // DEFAULT recipe reproduces today's look exactly (gen bytes are untouched — gen/ never reads `lod`).
  // A trailer/biome world shortens `full_voxel_radius_chunks` for a richer-near / faster-falloff curve
  // at fewer draw calls; the far quadtree shell (which renders full-disc beneath the near ring) backfills.
  lod: {
    full_voxel_radius_chunks: 7, // world_config.LOAD_RADIUS_CHUNKS (near full-voxel ring radius, chunks)
    far_radius_m: 4096, // lod/far_streamer.DEFAULT_FAR_RADIUS_M (far-shell outer reach, meters)
  },
  // FIVE-WORLDS CONFIG-DRIVEN DECORATOR HOOK: { biome_name: pool_id[] } adds bundle schematic pools to a
  // biome's tree/rock sets CONFIG-ONLY (surface_decorator resolves + merges; pool members split by
  // category). Lets biome LANES wire e.g. everglades swamp→['pool_mangrove'], paradise beach→['pool_palms']
  // without touching BIOME_SCHEMATICS. Default {} ⇒ no override ⇒ byte-identical DEFAULT world.
  structure_pool_overrides: {},
  // PROCEDURAL TREES (ENGINE_AAA_PLAN C4) — now the DEFAULT (GEN_VERSION 8 world fork). `procedural:true`
  // ⇒ the decorator grows SYNTHESIZED species skeletons (the tree_species roster below) instead of the
  // legacy schematic tree stamps, which are RETIRED (BIOME_SCHEMATICS[*].trees emptied). The tree pick is
  // grounded + haloed + meshed by the SAME decorator path (surface_decorator.js) — only WHAT is placed
  // changes; rocks/structures stay schematic. The five trailer worlds structuredClone this default, so they
  // inherit procedural trees too (water-anchored pool schematics — mangroves — survive: the proc path is
  // land-only). `?proctrees=0` is the escape hatch: procedural OFF ⇒ a rock-only world (the perf A/B that
  // isolates the proc-tree cost; the schematic tree stamps are gone, so OFF grows no trees, not legacy ones).
  // BAKE-THEN-STAMP (GEN_VERSION 9): baked_variants:32 ⇒ trees are pre-baked
  // (32 deterministic variants/species, tree_bake.js) and stamped like schematics — an O(1) hash-pick +
  // quarter-turn rotation per column instead of per-column synthesis (the v8 load cost). `?baketrees=0`
  // is the escape (the old every-tree-unique world for A/B).
  trees: { procedural: true, baked_variants: 32 },
  // Per-biome weighted procedural-species roster (§3.4 — the SCALE-IDENTITY home, ENGINE_AAA_PLAN P4
  // "scale as emotion"). Read ONLY under ?proctrees=1 (trees.procedural) ⇒ inert in the DEFAULT world ⇒
  // moves ZERO chunk bytes (parity). The weighted MIX is the wired scale lever: a per-column hash indexes
  // the cumulative-weight ladder (surface_decorator.select_tree_species), so a biome's DOMINANT species —
  // and thus its height band (gen/trees/species.js h_min/h_max) — sets its felt scale. The per-biome tree
  // DENSITY is already native (biomes[].tree_density + the grove gate), so scale contrast rides two axes
  // that need no new wiring: WHICH species (here) × HOW MANY (biome tree_density). The four contact-sheet
  // biomes are engineered to read as different games (B2 side-by-side proof):
  //   • taiga    — CATHEDRAL: pine_cathedral DOMINANT (30-62 blk, ancient→71, colossal→~99). Towering, the
  //                "feel small" biome (rider 1); the tall bare bole (crown_start ~45%) lets you walk UNDER
  //                the canopy at the native 0.2 density. spruce_mid fills the mid-scale understory layer.
  //   • temperate— MID / human-scale woodland: oak + birch (8-18 blk), mixed dome + slim silhouettes.
  //   • swamp    — LOW & CLOSED (tunnel/intimate): swamp_buttress dominant (leaning root-flare, draped) +
  //                drowned dead_snag + mushroom clumps — presses in low, the opposite of taiga's soar.
  //   • desert   — HORIZONTAL VASTNESS: flat-top acacia + bleached dead_snag, near-zero density (0.005) ⇒
  //                the eye travels to the horizon, sparse short accents instead of a canopy.
  // Density stays the native biome value (unchanged ⇒ no schematic-world drift); only WHICH species varies.
  // Species keys ⇒ gen/trees/species.js; test asserts every biome real + every species exists + weights > 0.
  tree_species: {
    grassland: [
      { species: 'oak_broadleaf', weight: 3 },
      { species: 'birch_slim', weight: 1 },
      { species: 'acacia_umbrella', weight: 1 },
    ], // open parkland: lone spreading oaks + occasional flat-top
    temperate_forest: [
      { species: 'oak_broadleaf', weight: 3 },
      { species: 'birch_slim', weight: 2 },
    ], // mixed mid-scale broadleaf
    dense_forest: [
      { species: 'oak_broadleaf', weight: 4 },
      { species: 'birch_slim', weight: 2 },
    ], // tallest closed broadleaf canopy
    taiga: [
      { species: 'pine_cathedral', weight: 5 },
      { species: 'spruce_mid', weight: 2 },
    ], // CATHEDRAL: pine-dominant (towering), spruce understory
    swamp: [
      { species: 'swamp_buttress', weight: 4 },
      { species: 'dead_snag', weight: 2 },
    ], // low + draped + drowned snags (intimate/closed)
    tropical: [{ species: 'jungle_giant', weight: 3 }], // emergent-tier giants
    // mushroom_giant (emissive azure `mushroom_cap_azure` caps) REMOVED from every overworld roster
    // 2026-07-11 (the unlit glowing blue caps read as "sky-looking blocks that don't look like
    // anything" among the spawn canopy). The species + block stay for the CAVES (cave_room.js glow) and
    // the dedicated everglades swamp world (its own schematic `pool_giant_mushrooms`), where the glow belongs.
    beach: [
      { species: 'palm_curve', weight: 3 },
      { species: 'dead_snag', weight: 1 },
    ], // curved palms + driftwood snag
    desert: [
      { species: 'acacia_umbrella', weight: 2 },
      { species: 'dead_snag', weight: 1 },
    ], // sparse flat-top acacia + bleached snag (horizontal)
    arctic: [
      { species: 'dead_snag', weight: 2 },
      { species: 'spruce_mid', weight: 1 },
    ], // lonely bleached snags + rare cold-hardy spruce
    alpine: [
      { species: 'spruce_mid', weight: 2 },
      { species: 'dead_snag', weight: 1 },
    ], // hardy high-altitude conifers + weathered snags
  },
}

/**
 * Normalizes a gen-config INPUT into a full {@link WorldGenConfig}. The gen contexts (create_gen_context,
 * far-section worker, webgl fallback, heightmap tool) historically accepted a bare seed STRING; config
 * adoption keeps that seam working while also accepting a full recipe object. Pure, allocation-light:
 *   - `undefined`/`null`  → the DEFAULT recipe (today's world);
 *   - a string            → the DEFAULT recipe with that master seed (back-compat: `create_gen_context('aresrpg')`);
 *   - an object           → returned as-is (assumed a full, upstream-validated config — engine.js validates).
 * @param {WorldGenConfig | string | undefined | null} input
 * @returns {WorldGenConfig}
 */
export function resolve_world_config(input) {
  if (input === undefined || input === null) return DEFAULT_WORLD_GEN_CONFIG
  if (typeof input === 'string') return { ...DEFAULT_WORLD_GEN_CONFIG, seed: input }
  return input
}

// validate_world_gen_config() + config_hash()/config_hash_hex() live in the sibling
// world_gen_config_validate.js (validation+hash LOGIC split from this schema+defaults DATA so each
// file stays one concern, well under the ≤600-LoC law). Re-exported here so callers have one import.
export {
  validate_world_gen_config,
  config_hash,
  config_hash_hex,
  canonical_serialize,
} from './world_gen_config_validate.js'

// =============================================================================================
// WORKED EXAMPLE — the admin-creation vision (playbook §2.3 "desert world" override).
// =============================================================================================
//
// A future admin editor produces a WorldGenConfig by spreading the defaults and overriding a few
// fields — no code change, no redeploy. A DESERT WORLD: crank the whole climate hot & dry, drop the
// sea, flatten relief, and swap the biome table down to the arid set. Illustrative — the density
// lane will consume the same shape:
//
//   import { DEFAULT_WORLD_GEN_CONFIG, validate_world_gen_config, config_hash_hex } from './world_gen_config.js'
//
//   const DESERT_WORLD = {
//     ...DEFAULT_WORLD_GEN_CONFIG,
//     seed: 'dune',
//     version: 1,
//     // Lower the sea so dunes dominate and coastlines are rare.
//     hydrology: { ...DEFAULT_WORLD_GEN_CONFIG.hydrology, sea_level: 96 },
//     // Bias the erosion→amplitude spline flat: rolling dunes, not jagged peaks.
//     splines: {
//       ...DEFAULT_WORLD_GEN_CONFIG.splines,
//       erosion_to_amplitude: [[0, 24], [0.5, 12], [1, 3]],
//     },
//     // A trimmed arid biome table (ids stay stable where reused; every id unique).
//     biomes: [
//       { id: 10, name: 'desert', climate: { temperature: 0.95, humidity: 0.05, continentalness: 0.7, erosion: 0.85, pv: 0.5 }, weight: 2, weirdness_gate: false, land: { surface: 'sand', subsurface: 'sand', underwater: 'sand', filler: 'stone' }, tree_density: 0.002, grass_density: 0.01, structure_pools: [], music_bed: 'desert' },
//       { id: 11, name: 'scorched_badlands', climate: { temperature: 0.98, humidity: 0.15, continentalness: 0.7, erosion: 0.4, pv: 0.62 }, weight: 1.2, weirdness_gate: false, land: { surface: 'sand', subsurface: 'dirt', underwater: 'sand', filler: 'stone' }, tree_density: 0, grass_density: 0.005, structure_pools: [], music_bed: 'desert' },
//       { id: 1, name: 'beach', climate: { temperature: 0.9, humidity: 0.2, continentalness: 0.32, erosion: 0.85, pv: 0.45 }, weight: 1, weirdness_gate: false, land: { surface: 'sand', subsurface: 'sand', underwater: 'sand', filler: 'stone' }, tree_density: 0, grass_density: 0.01, structure_pools: [], music_bed: 'beach' },
//     ],
//     // Turn ON canyons for dramatic mesas (a stage the default leaves off).
//     carvers: {
//       ...DEFAULT_WORLD_GEN_CONFIG.carvers,
//       canyon: { enabled: true, width: 0.05, depth: 55, warp: true },
//     },
//   }
//
//   const check = validate_world_gen_config(DESERT_WORLD) // → { ok: true, errors: [] }
//   const world_id = config_hash_hex(DESERT_WORLD)         // stable identity for this recipe
//   // Persist world_id alongside the blob; peers deriving the same blob reproduce the same world.
