// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PER-REGION ZONE MUSIC: each world's 5-6 biomes get a music track taken randomly from the pool of
// musics, with the equivalent battle track for each. The player's CURRENT sub-biome
// region — sampled from position via the engine's `world_region_at` probe — drives the zone key
// `${world}:${region}`; ambient_music hash-assigns the key onto the 9 owned track pairs (same FNV-1a,
// one home), so every region of every world gets its own stable-forever pick AND its `_battle` twin
// swaps in on fight start (resolve_tracks builds both off the same key). Coordinator ruling 2026-07-13:
// the `${world}:${region}` key supersedes D-2710's plain biome-name hash for region worlds (fixes the
// charnel_marches 5-of-6-regions→desert collapse); non-region worlds keep the base biome key unchanged.
//
// HYSTERESIS (no flapping at borders): a region switch arms ONLY after the sampled region has read the
// SAME new value `confirm` consecutive samples in a row (samples `interval_ms` apart ⇒ ~confirm×interval
// of stability before a switch). A border-straddling walk that alternates A/B resets the streak every
// flip and never switches; the armed zone always wins ties. The actual audio swap is ambient_music's
// engine_retune soft crossfade (dip-to-silence, never a hard cut).
//
// Pure decision core (create_region_follower — unit-tested, no DOM); the caller (embed_voxel's frame
// loop) owns position + the engine probe and feeds ticks. One home for the key format: region_zone_key.

/**
 * The zone-music identity for a position: the region-qualified `${world_key}:${region}` when a region
 * layer names one, else the world's base biome key (non-region worlds keep today's behavior verbatim).
 * @param {string} world_key stable world identity — the on-chain world id when bound, else the recipe name
 * @param {string | null} region dominant region class name at the position (engine world_region_at), or null
 * @param {string} base_biome the world's base biome key (what GameWorldHost arms at boot)
 * @returns {string} the zone key set_zone_music receives (hash-assigned onto the owned track pairs)
 */
export function region_zone_key(world_key, region, base_biome) {
  return region ? `${world_key}:${region}` : base_biome
}

/**
 * @typedef {object} RegionFollower
 * @property {(key: string | null | undefined) => string | null} feed feed one sampled zone key; returns the
 *   key just ARMED when the hysteresis confirms a switch, else null (no change this sample)
 * @property {(now: number, get_key: () => string | null | undefined) => string | null} tick time-gated feed —
 *   a no-op (null) until `interval_ms` has elapsed since the last accepted sample; `get_key` (the engine
 *   region probe) is only invoked on accepted samples, so the per-frame cost is one clock compare
 * @property {() => string | null} armed the currently armed key (null before the first confirm)
 */

/**
 * Builds the hysteresis follower. `arm` is called EXACTLY once per confirmed switch with the new key
 * (wire it to set_zone_music). Pure state machine — no timers, no DOM; the caller drives time via tick(now).
 * @param {{ arm: (key: string) => void, confirm?: number, interval_ms?: number }} opts
 * @returns {RegionFollower}
 */
export function create_region_follower({ arm, confirm = 3, interval_ms = 2000 }) {
  /** @type {string | null} */
  let armed = null
  /** @type {string | null} */
  let candidate = null
  let streak = 0
  let last = -Infinity // the FIRST tick is always an accepted sample, whatever the caller's clock origin

  /** @param {string | null | undefined} key @returns {string | null} */
  const feed = (key) => {
    if (!key || key === armed) {
      // stable on the armed zone (or nothing to sample) — any half-built candidate streak dissolves.
      candidate = null
      streak = 0
      return null
    }
    if (key === candidate) streak += 1
    else {
      candidate = key
      streak = 1
    }
    if (streak < confirm) return null
    armed = candidate
    candidate = null
    streak = 0
    arm(armed)
    return armed
  }

  return {
    feed,
    tick(now, get_key) {
      if (now - last < interval_ms) return null
      last = now
      return feed(get_key())
    },
    armed: () => armed,
  }
}
