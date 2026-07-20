// BINDING — the on-chain world binding seams (S-17). The engine side of "the world is derivable from
// the seed": a canonical Y-oracle, deterministic board-from-anchor, the gather glow/affordance feed, the
// phase-out visibility registry, the pure compass/zone wayfinding view, world-from-template (chain world
// → gen recipe + barrier bounds), the deterministic world mob-group placement/roam/aging feed, and the
// cosmetic head-slot precedence. All are re-exported from the engine's main entry (engine.js) so the app
// reaches them alongside create_engine; the render-bound feeds (gather/visibility) are factories taking the
// engine handle, mirroring the tactical board — everything else is pure data in → data out.
//
// No chain awareness lives here — these are pure feeds over pushed data + the deterministic terrain math.

export { ground_height } from './ground_height.js' // seam 1 — SPEC §4 Y-oracle
export { board_spec_for_anchor, board_seed_from_anchor, voids_from_shape_mask } from './board_anchor.js' // seam 2 — SPEC §7 deterministic board (+ chain bitset→voids adapter for S-18)
export { create_gather_feed, nearest_within, GATHER_RANGE_DEFAULT } from './gather_feed.js' // seam 3 — §5/§6
export { create_entity_visibility } from './entity_visibility.js' // seam 4 — SPEC §7 phase-out
export { zone_state_view, DEFAULT_ZONE_SIZE_BLOCKS, DEFAULT_WORLD_SIZE_BLOCKS } from './zone_view.js' // seam 5 — §5
export { world_from_template, DEFAULT_SPAWN_ZONE_BLOCKS } from './world_template.js' // seam 6 — SPEC §4 world-from-template
export {
  mob_group_placement,
  mob_roam_offset,
  mob_aging_fraction,
  MAX_GROUP_SIZE,
  MOB_SCATTER_RADIUS_BLOCKS,
  MOB_ROAM_RADIUS_BLOCKS,
  AGING_RATE_PER_HOUR,
  AGING_CAP_HOURS,
} from './world_mobs.js' // seam 7 — SPEC §8 world mob groups (roam-near-anchor + nametag aging)
export { resolve_headgear } from './cosmetics.js' // seam 8 — SPEC §7.11 cosmetic hat>helmet precedence

// The portable derivation primitives (the on-chain FIGHT/discovery twins mirror these byte-for-byte).
export { rng_seed, rng_next, rng_int, rng_range, hash_bytes, hash_anchor } from './prng.js'
