// WORLD ACCESS GATES — the seeded worlds + each world's on-chain `required_level`, for the character
// level-up card's "you now have access to X and Y worlds" row. The required_level — the field zones.move
// actually asserts join against — is sourced by DELEGATING to read_worlds.js's `get_worlds` (the ONE World
// reader; world_levels adds NO duplicate chain-direct read — reads have one home). Since the
// 07-17 indexer world-object snapshot the /v1 encyclopedia worlds view serves the live gate too (the
// switcher's travel modal reads it there); this pre-existing reader stays on its chain-direct home. Cached once per session (world gates are
// static config); a read failure resolves to [] so the card simply omits the world row (never a fabricated unlock).
//
// DECLARED REALITY: the live testnet seed carries ONE world (Testlands, required_level 1), so no character
// level-up unlocks a NEW world today; this lights up the moment higher-gate biome worlds are seeded. The
// unlock MATH (worlds_unlocked_between, level_unlocks.js) is unit-proven independently of this reader.

import { get_worlds } from '../../../chain/read_worlds.js'
import { T62_WORLDS } from '../../../chain/deployment'
import { game_log } from '../../../core/log.js'

/** @typedef {{ id: string, label: string, required_level: number }} WorldGate */

/** @type {Promise<WorldGate[]> | null} — the session-cached read (worlds config is static). */
let cache = null

/**
 * Every seeded world + its join gate, read chain-direct and cached. Over gRPC json a World is a flat struct,
 * so `required_level` reads directly (default 1 — world.move's create default — if a field is unreadable).
 * Never throws: a failed/partial read degrades to the worlds it could resolve (or []), so the card's world
 * row degrades to absent rather than blocking the celebration.
 * @returns {Promise<WorldGate[]>}
 */
export function load_world_gates() {
  if (cache) return cache
  cache = (async () => {
    try {
      if (T62_WORLDS.length === 0) return []
      // Reuse the single World reader (read_worlds.js) — it already decodes `required_level`; world_levels is a
      // pure consumer, so there is NO duplicate chain-direct read here (reads have one home).
      const worlds = await get_worlds(T62_WORLDS)
      return worlds
        .map((w) => ({
          id: String(w.id),
          label: String(w.label ?? w.id),
          required_level: Number(w.required_level ?? 1),
        }))
        .filter(/** @returns {w is WorldGate} */ (w) => w != null && !!w.id)
    } catch (error) {
      game_log('world-gates', 'world read failed — the level-up world row is omitted', error)
      cache = null // let a later card retry rather than caching the failure forever
      return []
    }
  })()
  return cache
}
