// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pandora-style floating islands (§2.2 sky-island lane; the target look: "Pandora style,
// not fish bones floating the sky"). The v4 placeholder was a thin ridged SHELL — a horizontal noise
// slab that produced fish-bone ribbons everywhere in the band. This module RETIRES that and generates
// real Avatar/Hallelujah-Mountain hanging masses: a broad living TOP that necks in and tapers DOWN
// into a stalactite-like ROOT, clustered into dramatic archipelagos, and REGION-GATED so islands
// belong to dedicated sky regions ("different biomes, not everything at once") instead of
// smearing across the whole sky.
//
// GRAMMAR (all deterministic — pure function of (seed, x, y, z)):
//   1. REGION GATE — the world is tiled into `region_size` cells; a hashed fraction (`region_rate`)
//      are SKY-ISLAND regions. Outside them the sky is EMPTY (kills every ribbon). One 2D integer
//      hash, evaluated only after the altitude cheap-reject → near-free on the ~7/8 empty regions.
//   2. ARCHIPELAGO — inside a sky region, a hashed count of islands (`islands_min..max`) are scattered
//      at hashed XZ offsets + hashed altitudes (across the band) + hashed cap radii. Each island may
//      spawn 0..`satellites_max` small companion islets (the Pandora "cluster of floating rocks").
//   3. ISLAND BODY (SDF, arithmetic-only) — for a voxel, the dominant island's signed field is:
//        broad domed TOP (radius ~cap_r, gently value-noise-wobbled rim) that necks in and TAPERS
//        with depth-below-cap via a quadratic radius falloff (fat top, pointy root) down to a thin
//        root tip at depth `root_ratio·cap_r`. The crown above the cap is a shallow dome. Positive
//        inside ⇒ solid; the sign is returned to density.js which UNIONS (max) it with terrain.
//
// DETERMINISM LAW (§3.7): arithmetic + Math.floor/abs/min/max/sqrt + Math.imul bit-ops ONLY. NO
// sin/cos/pow/exp/log/random (CI grep guard in column_gen.test.js). The rim/silhouette wobble is a
// hand-rolled INTEGER-lattice value noise (hash3 + smootherstep blend) — no simplex, no transcendental,
// obviously portable. Same seed ⇒ bit-identical islands on every peer. Changing any const here moves
// the golden hash = a WORLD FORK (§4): bump GEN_VERSION + re-bless.

/**
 * Sky-island grammar recipe (const world-recipe — moving these forks the world, §4). Mirrored 1:1
 * into world_gen_config.js `sky` (guarded by world_gen_config.test.js) so the admin recipe carries it.
 * The `low_y/high_y/thickness/enabled` keys are the BAND ENVELOPE the LOD far-shell + section_builder
 * scan against (kept stable names); the rest are the Pandora placement/shape knobs.
 */
import { hash2, hash3 } from './noise/integer_hash.js'

export const SKY_ISLANDS_CONFIG = {
  /** Master on/off. When false, `sky_islands_density` always returns air (no band cost). */
  enabled: true,
  // ---- Altitude band (the vertical envelope; LOD scans [low_y - thickness, high_y + thickness]) ----
  // `low_y`/`high_y` bound where the island CAP TOP sits; roots hang DOWN into the `thickness` margin.
  // INVARIANT (asserted in the test): thickness ≥ cap_radius_max·root_ratio_max, so the LOWEST possible
  // root tip (cap at low_y, longest root) still lies inside [low_y - thickness] and is never clipped by
  // the band cheap-reject / the LOD scan. Kept as tight as that bound allows (perf: band height × 1
  // region-hash per non-sky column).
  /** Bottom of the CAP altitude band (lowest an island cap top may sit). */
  low_y: 300,
  /** Top of the CAP altitude band (highest an island cap top may sit). */
  high_y: 352,
  /** Vertical margin (blocks) around the band: contains the hanging roots below + the crown dome above.
   *  Sized to the deepest root (cap_radius_max·root_ratio_max = 52·2.2 = 114.4 → 116). */
  thickness: 116,
  // ---- Region gating (dedicated sky-island regions, not everywhere) ----
  /** Sky-region cell size in blocks (a coarse tiling of the world XZ plane). ~768 ⇒ archipelagos are
   *  spaced ~0.75 km apart at most, so they read as special landmarks, not sky wallpaper. */
  region_size: 768,
  /** Fraction of region cells that are SKY-ISLAND regions (hashed). ~1 in 8 → rare + dramatic. */
  region_rate: 0.13,
  // ---- Archipelago (islands per sky region) ----
  /** Inclusive min/max islands spawned in one sky region (a clustered archipelago). */
  islands_min: 3,
  islands_max: 8,
  /** Max small companion islets hashed off each parent island (0..this). Pandora rock clusters. */
  satellites_max: 2,
  // ---- Per-island shape (the Hallelujah-mountain silhouette) ----
  /** Inclusive min/max broad-cap radius (blocks). Min ≥ 24 so every island reads as a landmass from
   *  the ground; max 52 for the hero masses (bounded so the deepest root fits the band `thickness`). */
  cap_radius_min: 24,
  cap_radius_max: 52,
  /** Root depth as a multiple of cap radius — the hanging taper length below the cap (1.5..2.2× the
   *  cap radius gives the tall stalactite root). Randomized per island in [root_ratio_min, max]. The
   *  max × cap_radius_max sets the band `thickness` (see the invariant there). */
  root_ratio_min: 1.5,
  root_ratio_max: 2.2,
  /** Crown height as a fraction of cap radius — the shallow dome bulging ABOVE the cap surface. */
  crown_ratio: 0.22,
  /** Rim/silhouette wobble amplitude as a fraction of the local allowed radius (breaks perfect circles
   *  + varies the taper so no two islands share a silhouette). */
  wobble_amp: 0.3,
  /** Value-noise lattice period (blocks) for the rim wobble — whole-island scale so the rim undulates
   *  in a few broad lobes, not fine fuzz. */
  wobble_period: 34,
  /** Satellite cap radius as a fraction of the parent's, and how far (in parent radii) they orbit. */
  satellite_radius_ratio: 0.4,
  satellite_orbit: 1.7,
  /** Depth of the grass/soil CRUST on island top surfaces (blocks below the top face) — reuses the
   *  column strata approach in column_gen (crust = surface strata, body = stone). Consumed there. */
  crust_depth: 4,
}

// ---- Integer hashing (exact 32-bit, deterministic — §3.7; same family as carvers/caves.js) --------

// hash2 (2D) + hash3 (3D) splitmix integer hashes are imported from ./noise/integer_hash.js — the
// shared determinism-pinned home (formerly a byte-identical local copy here).

/** Hash → float in [0,1). @param {number} h uint32 @returns {number} */
function to_unit(h) {
  return (h >>> 0) * 2.3283064365386963e-10 // 2^-32
}

/** Maps a unit hash to [lo, hi]. @param {number} u @param {number} lo @param {number} hi @returns {number} */
function lerp_unit(u, lo, hi) {
  return lo + (hi - lo) * u
}

/**
 * Smootherstep (Ken Perlin's C2 quintic) — pure polynomial, no transcendental. Eases a lattice
 * fraction in [0,1] for the value-noise blend so the wobble is smooth across cells.
 * @param {number} t in [0,1]
 * @returns {number} eased t
 */
function smootherstep(t) {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

/**
 * 2D integer-lattice VALUE NOISE in [-1,1] at (x, z) with period `period`. Hashes the 4 lattice
 * corners to unit values and blends with smootherstep. Arithmetic-only (§3.7) — deliberately NOT
 * simplex, so the rim wobble is obviously determinism-legal and cheap. Seeded via `salt`.
 * @param {number} x @param {number} z @param {number} period @param {number} salt
 * @returns {number} value in [-1,1]
 */
function value_noise2(x, z, period, salt) {
  const inv = 1 / period
  const fx = x * inv
  const fz = z * inv
  const x0 = Math.floor(fx)
  const z0 = Math.floor(fz)
  const tx = smootherstep(fx - x0)
  const tz = smootherstep(fz - z0)
  const c00 = to_unit(hash2(x0, z0, salt))
  const c10 = to_unit(hash2(x0 + 1, z0, salt))
  const c01 = to_unit(hash2(x0, z0 + 1, salt))
  const c11 = to_unit(hash2(x0 + 1, z0 + 1, salt))
  const a = c00 + (c10 - c00) * tx
  const b = c01 + (c11 - c01) * tx
  return (a + (b - a) * tz) * 2 - 1 // [0,1] → [-1,1]
}

/**
 * @typedef {object} SkyIsland one placed island (or satellite) in an archipelago.
 * @property {number} cx world-x of the island axis (center of the cap)
 * @property {number} cy world-y of the CAP TOP surface (highest solid of the body, pre-crown)
 * @property {number} cz world-z of the island axis
 * @property {number} cap_r broad-cap radius (blocks)
 * @property {number} root_depth taper length below the cap to the root tip (blocks)
 * @property {number} salt per-island hash salt (decorrelates the rim wobble)
 */

/**
 * @typedef {object} SkyIslandsContext seeded sky-island generator state.
 * @property {number} seed base sub-seed (decorrelated from density/carvers salts)
 * @property {typeof SKY_ISLANDS_CONFIG} cfg the world's sky-island recipe (world_gen_config `sky`) —
 *   every placement/shape read goes through this so a per-world recipe drives the archipelago (§2.3)
 * @property {number} reach max horizontal reach (blocks) an island footprint can extend from its axis,
 *   derived once from `cfg` (region_size > 2·reach ⇒ a 3×3 region scan suffices)
 * @property {Map<number, SkyIsland[]>} region_cache memo of each region's archipelago (pure function
 *   of region+seed, so it's a bounded memo — never a source of world state)
 */

/** Region-archipelago memo cap. A region list is a pure function of (region, seed) so clearing it is
 *  world-neutral; the cap just bounds memory across a long streaming session. */
const REGION_CACHE_CAP = 64

/**
 * Max horizontal reach (blocks) an island's solid footprint can extend from its axis for a recipe:
 * the biggest cap (with full rim wobble) PLUS the farthest a satellite can orbit and still be solid.
 * A voxel closer to a region boundary than this must consult the neighbor region. Derived once per
 * world so `region_size` > 2·reach guarantees a 3×3 scan suffices.
 * @param {typeof SKY_ISLANDS_CONFIG} cfg
 * @returns {number}
 */
function island_reach(cfg) {
  return (
    cfg.cap_radius_max * cfg.satellite_orbit + cfg.cap_radius_max * cfg.satellite_radius_ratio * (1 + cfg.wobble_amp)
  )
}

/**
 * Builds the sky-island generator context from the density/carvers sub-seed + the world's `sky`
 * recipe. No noise samplers to build — the whole feature is integer-hash + arithmetic — so this just
 * fixes the salt, precomputes the island reach, and a small region memo. Kept as a context so
 * density.js constructs it alongside the other samplers (uniform shape). The recipe defaults to the
 * live/default world so context-free callers keep working unchanged.
 * @param {number} carve_seed the `carvers` sub-seed (>>>0), reused (decorrelated by a fixed salt)
 * @param {typeof SKY_ISLANDS_CONFIG} [cfg] the world's sky recipe (world_gen_config `sky`)
 * @returns {SkyIslandsContext}
 */
export function create_sky_islands_context(carve_seed, cfg = SKY_ISLANDS_CONFIG) {
  return { seed: (carve_seed ^ 0x15_1a_2d_5f) >>> 0, cfg, reach: island_reach(cfg), region_cache: new Map() }
}

/**
 * Whether a region cell (rx, rz) is a SKY-ISLAND region. One integer hash vs `region_rate`.
 * @param {SkyIslandsContext} sk @param {number} rx region cell x @param {number} rz region cell z
 * @returns {boolean}
 */
function is_sky_region(sk, rx, rz) {
  return to_unit(hash2(rx, rz, sk.seed ^ 0x5217_a1e5)) < sk.cfg.region_rate
}

/**
 * Deterministically materializes the archipelago (islands + satellites) of one sky region into `out`.
 * Island i is placed at a hashed offset inside the region, at a hashed altitude across the band, with a
 * hashed cap radius + root ratio. Satellites orbit their parent at a hashed angle-substitute (two
 * hashed offset components — no trig) and altitude jitter. Pure function of (region, seed).
 * @param {SkyIslandsContext} sk @param {number} rx @param {number} rz
 * @param {SkyIsland[]} out cleared+filled with the region's islands
 * @returns {void}
 */
export function build_region_islands(sk, rx, rz, out) {
  out.length = 0
  const { cfg } = sk
  if (!is_sky_region(sk, rx, rz)) return

  const base_x = rx * cfg.region_size
  const base_z = rz * cfg.region_size
  const h_count = hash2(rx, rz, sk.seed ^ 0x0c0f_fee1)
  const count = cfg.islands_min + Math.floor(to_unit(h_count) * (cfg.islands_max - cfg.islands_min + 1))
  // Keep the archipelago clustered toward the region's core (inset margin) so islands read as ONE
  // cluster, not scattered to the cell edges where neighbors' clusters would blur together.
  const inset = cfg.cap_radius_max
  const span = cfg.region_size - 2 * inset

  for (let i = 0; i < count; i += 1) {
    const salt = (sk.seed ^ Math.imul(i + 1, 0x9e37_79b1)) >>> 0
    const ox = to_unit(hash3(rx, rz, i, salt ^ 0x00a1)) * span + inset
    const oz = to_unit(hash3(rx, rz, i, salt ^ 0x00b2)) * span + inset
    const cx = Math.floor(base_x + ox)
    const cz = Math.floor(base_z + oz)
    const cy = Math.floor(lerp_unit(to_unit(hash3(rx, rz, i, salt ^ 0x00c3)), cfg.low_y, cfg.high_y))
    const cap_r = lerp_unit(to_unit(hash3(rx, rz, i, salt ^ 0x00d4)), cfg.cap_radius_min, cfg.cap_radius_max)
    const root_ratio = lerp_unit(to_unit(hash3(rx, rz, i, salt ^ 0x00e5)), cfg.root_ratio_min, cfg.root_ratio_max)
    out.push({ cx, cy, cz, cap_r, root_depth: cap_r * root_ratio, salt })

    // Companion islets — smaller, orbiting, slightly lower (they hang around the hero mass).
    const sat_h = hash3(rx, rz, i, salt ^ 0x00f6)
    const sat_count = Math.floor(to_unit(sat_h) * (cfg.satellites_max + 1))
    for (let s = 0; s < sat_count; s += 1) {
      const ssalt = (salt ^ Math.imul(s + 1, 0x85eb_ca77)) >>> 0
      const off = cap_r * cfg.satellite_orbit
      const dx = (to_unit(hash3(cx, cz, s, ssalt ^ 0x1111)) * 2 - 1) * off
      const dz = (to_unit(hash3(cx, cz, s, ssalt ^ 0x2222)) * 2 - 1) * off
      const scr = cap_r * cfg.satellite_radius_ratio
      const sry = lerp_unit(to_unit(hash3(cx, cz, s, ssalt ^ 0x3333)), cfg.root_ratio_min, cfg.root_ratio_max)
      const sdy = (to_unit(hash3(cx, cz, s, ssalt ^ 0x4444)) * 2 - 1) * cap_r * 0.5
      out.push({
        cx: Math.floor(cx + dx),
        cy: Math.floor(cy + sdy),
        cz: Math.floor(cz + dz),
        cap_r: scr,
        root_depth: scr * sry,
        salt: ssalt,
      })
    }
  }
}

/**
 * Signed density of ONE island at a voxel (positive ⇒ inside solid rock). This is the Hallelujah
 * silhouette:
 *   - horizontal distance `rh` from the island axis;
 *   - depth `dd = cy - y` below the cap top (positive = below);
 *   - the ALLOWED radius shrinks with depth via a quadratic falloff `s²` (s = 1 - dd/root_depth) so
 *     the top is broad and the body tapers to a pointy root tip; the rim is wobbled by whole-island
 *     value noise so it isn't a perfect circle;
 *   - above the cap (dd < 0) only a shallow CROWN dome is solid.
 * Signed value ≈ (allowed_radius − rh) in blocks, so it composes as a smooth field density.js can max
 * against terrain. Purely arithmetic (§3.7).
 * @param {typeof SKY_ISLANDS_CONFIG} cfg the world's sky recipe (rim wobble / crown shape)
 * @param {SkyIsland} isl @param {number} x @param {number} y @param {number} z @param {number} salt0
 * @returns {number} signed island density (solid iff > 0)
 */
function island_density(cfg, isl, x, y, z, salt0) {
  const dx = x - isl.cx
  const dz = z - isl.cz
  const rh2 = dx * dx + dz * dz
  // Cheap-reject: outside the widest possible footprint (cap + full wobble) can't be solid.
  const max_r = isl.cap_r * (1 + cfg.wobble_amp)
  if (rh2 > max_r * max_r) return -1
  const rh = Math.sqrt(rh2)

  const dd = isl.cy - y // depth below the cap top surface (blocks)
  if (dd < 0) {
    // Above the cap: a shallow crown dome. Solid where we're within a height that shrinks toward the
    // rim — gives the top a gentle bulge instead of a flat lid.
    const crown = isl.cap_r * cfg.crown_ratio
    const rim = 1 - rh / isl.cap_r // 1 at axis → 0 at rim
    if (rim <= 0) return -1
    const dome = crown * rim * rim // dome height at this radius
    return dome + dd // dd is negative; solid while |dd| < dome
  }

  // Below the cap: allowed radius tapers quadratically to the root tip.
  const s = 1 - dd / isl.root_depth
  if (s <= 0) return -1 // past the root tip → air
  // Wobble the silhouette per-island (decorrelated by salt) so rims + taper vary between islands.
  const wob =
    1 + cfg.wobble_amp * value_noise2(x + isl.salt * 0.13, z - isl.salt * 0.17, cfg.wobble_period, salt0 ^ isl.salt)
  const allowed = isl.cap_r * s * s * wob
  return allowed - rh
}

/**
 * Region's archipelago, memoized on the context (pure function of region+seed → a bounded memo, never
 * world state). Cap-bounded; a cleared region rebuilds identically.
 * @param {SkyIslandsContext} sk @param {number} rx @param {number} rz
 * @returns {SkyIsland[]}
 */
function cached_region(sk, rx, rz) {
  const key = ((rx & 0xffff) | ((rz & 0xffff) << 16)) >>> 0
  let list = sk.region_cache.get(key)
  if (list === undefined) {
    if (sk.region_cache.size >= REGION_CACHE_CAP) {
      sk.region_cache.delete(/** @type {number} */ (sk.region_cache.keys().next().value))
    }
    list = region_islands(sk, rx, rz)
    sk.region_cache.set(key, list)
  }
  return list
}

/** Accumulate the max island density over one region's list into `best`. @returns {number} */
function max_over_region(
  /** @type {SkyIsland[]} */ list,
  /** @type {SkyIslandsContext} */ sk,
  /** @type {number} */ x,
  /** @type {number} */ y,
  /** @type {number} */ z,
  /** @type {number} */ best
) {
  for (let i = 0; i < list.length; i += 1) {
    const d = island_density(sk.cfg, list[i], x, y, z, sk.seed)
    if (d > best) best = d
  }
  return best
}

/**
 * The sky-island field at a world voxel: positive ⇒ solid island rock, ≤0 ⇒ empty sky. Region-gated
 * (empty sky regions materialize an EMPTY list, so they cost one hash + a memo hit) then the max over
 * the covering region's islands. Callers (density.js) cheap-reject the altitude band FIRST so this
 * only fires on the thin band. Interior voxels touch a SINGLE region; only voxels within `ISLAND_REACH`
 * of a region boundary consult the (≤ 8) neighbors an island could straddle — so it's O(islands) with
 * no per-voxel rebuild (regions are memoized on the context).
 * @param {SkyIslandsContext} sk @param {number} x @param {number} y @param {number} z
 * @returns {number} signed sky-island density (solid iff > 0)
 */
export function sky_islands_density(sk, x, y, z) {
  const { cfg } = sk
  if (!cfg.enabled) return -1
  const rsize = cfg.region_size
  const { reach } = sk
  const rx = Math.floor(x / rsize)
  const rz = Math.floor(z / rsize)

  let best = max_over_region(cached_region(sk, rx, rz), sk, x, y, z, -1)

  // Only near a region edge can a neighbor's island reach this voxel — test just the sides/corner in
  // range, never a blind 3×3. (region_size > 2·reach ⇒ at most one neighbor per axis.)
  const lx = x - rx * rsize
  const lz = z - rz * rsize
  const sx = lx < reach ? -1 : lx > rsize - reach ? 1 : 0
  const sz = lz < reach ? -1 : lz > rsize - reach ? 1 : 0
  if (sx !== 0) best = max_over_region(cached_region(sk, rx + sx, rz), sk, x, y, z, best)
  if (sz !== 0) best = max_over_region(cached_region(sk, rx, rz + sz), sk, x, y, z, best)
  if (sx !== 0 && sz !== 0) best = max_over_region(cached_region(sk, rx + sx, rz + sz), sk, x, y, z, best)

  return best
}

/**
 * Whether a voxel is inside any sky island (solid). Thin wrapper over the signed field for callers
 * that only need a boolean (tests / the surface-crust strata gate).
 * @param {SkyIslandsContext} sk @param {number} x @param {number} y @param {number} z
 * @returns {boolean}
 */
export function sky_island_at(sk, x, y, z) {
  return sky_islands_density(sk, x, y, z) > 0
}

/**
 * Whether a WHOLE XZ column can hold any sky-island rock — i.e. its region (or a neighbor whose
 * archipelago can reach across the boundary within `ISLAND_REACH`) is a sky-island region. This is
 * the COLUMN-level gate density.js precomputes once per column so the per-voxel sky band is skipped
 * entirely on the ~87% of columns that are not under an archipelago (the perf keystone: without it,
 * every column pays a region hash on every voxel of the tall island band). A `true` here does NOT
 * guarantee a solid in the column — only that the (rare) full band scan is worth doing.
 * @param {SkyIslandsContext} sk @param {number} x world x @param {number} z world z
 * @returns {boolean}
 */
export function column_has_sky(sk, x, z) {
  if (!sk.cfg.enabled) return false
  const rsize = sk.cfg.region_size
  const { reach } = sk
  const rx = Math.floor(x / rsize)
  const rz = Math.floor(z / rsize)
  if (is_sky_region(sk, rx, rz)) return true
  // Near a region edge, a neighbor archipelago can reach in — mirror sky_islands_density's edge test.
  const lx = x - rx * rsize
  const lz = z - rz * rsize
  const sx = lx < reach ? -1 : lx > rsize - reach ? 1 : 0
  const sz = lz < reach ? -1 : lz > rsize - reach ? 1 : 0
  if (sx !== 0 && is_sky_region(sk, rx + sx, rz)) return true
  if (sz !== 0 && is_sky_region(sk, rx, rz + sz)) return true
  if (sx !== 0 && sz !== 0 && is_sky_region(sk, rx + sx, rz + sz)) return true
  return false
}

/**
 * Enumerates the islands of a single region (for surveys / reports / the LOD vista). Fills a fresh
 * array (does NOT touch the per-voxel scratch), so callers can hold the result.
 * @param {SkyIslandsContext} sk @param {number} rx @param {number} rz
 * @returns {SkyIsland[]}
 */
export function region_islands(sk, rx, rz) {
  /** @type {SkyIsland[]} */
  const out = []
  build_region_islands(sk, rx, rz, out)
  return out
}
