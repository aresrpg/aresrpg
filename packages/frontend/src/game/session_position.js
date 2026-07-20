// LAST OVERWORLD POSITION — refresh continuity over the on-chain checkpoint. Free walking is local, so the
// checkpoint can legitimately trail the avatar between position-proving transactions. This per-character
// localStorage cache supplies only the fine-grained "session restore" candidate to resolve_boot_spawn; that
// existing arbiter still lets chain truth win when the two positions disagree beyond AGREE_RADIUS_M.
//
// The persisted payload is deliberately tiny and world-scoped: `{ x, z, world_id, ts }`. Height and yaw are
// not durable truth; the boot uses WORLD_SPAWN's y seed and its existing ground-settle gate. Writers call
// `can_cache_live_position` before both interval notes and unload flushes, so fights and dungeons never write.

import { use_dungeon } from '../world-shell/dungeon_store.js'

const storage_prefix = 'ares:last_position:v1:'
const write_interval_ms = 5000
const max_age_ms = 30 * 60 * 1000

/** @type {{ character_id: string, world_id: string, x: number, z: number } | null} */
let pending = null
/** @type {Map<string, number>} */
const last_write_at = new Map()

/** The versioned per-character localStorage key. */
export const live_position_storage_key = (character_id) => `${storage_prefix}${character_id}`
const cadence_key = ({ character_id, world_id }) => `${live_position_storage_key(character_id)}:${world_id}`

/**
 * PURE eligibility gate shared by the frame cadence and unload flush.
 * @param {{ character_id?: string|null, world_id?: string|null, in_fight?: boolean,
 *   in_dungeon?: boolean, in_cave?: boolean }} state
 */
export function can_cache_live_position({ character_id, world_id, in_fight = false, in_dungeon = false, in_cave = false }) {
  return !!character_id && !!world_id && !in_fight && !in_dungeon && !in_cave
}

// Defense in depth for every writer, including persistent actions that can outlive the roam state which
// created them. The render seam still owns its stricter cave/camera gate; this store gate makes it impossible
// for a direct note/flush to write while any world-fight or dungeon phase is live. `in_session` closes the
// optimistic-entry window before a run/fight id exists; `run_pass_id` covers the bound run between fights.
function phase_blocks_cache() {
  const phase = use_dungeon.getState()
  return !!(phase.in_session || phase.run_pass_id || phase.dungeon || phase.dungeon_id || phase.fight_id)
}

function flush(now = Date.now()) {
  if (!pending) return
  if (phase_blocks_cache()) {
    pending = null
    return
  }
  const key = live_position_storage_key(pending.character_id)
  try {
    globalThis.localStorage?.setItem(
      key,
      JSON.stringify({ x: pending.x, z: pending.z, world_id: pending.world_id, ts: now })
    )
    last_write_at.set(cadence_key(pending), now)
  } catch {
    /* storage unavailable (private mode/quota) — refresh continuity is never a hard dependency */
  }
}

/**
 * Note a free-walking overworld position. Calls are cheap except for one localStorage write every ~5s.
 * Eligibility is owned by the caller because it has the live fight/cave/dungeon state.
 * @param {{ character_id: string, world_id: string, x: number, z: number }} position
 */
export function note_live_position({ character_id, world_id, x, z }) {
  if (phase_blocks_cache()) {
    pending = null
    return
  }
  if (!character_id || !world_id || ![x, z].every(Number.isFinite)) return
  pending = { character_id, world_id, x, z }
  const key = cadence_key(pending)
  const now = Date.now()
  if (now - (last_write_at.get(key) ?? 0) < write_interval_ms) return
  flush(now)
}

/** Flush the freshest eligible pose now. The caller must apply `can_cache_live_position` at the event seam. */
export function flush_live_position() {
  flush()
}

/**
 * The fresh stored x/z for THIS character+world, or null when absent, stale, mismatched, or corrupt.
 * @param {string} character_id @param {string|null} world_id
 * @returns {{ x: number, z: number } | null}
 */
export function read_live_position(character_id, world_id) {
  if (!character_id || !world_id) return null
  try {
    const raw = globalThis.localStorage?.getItem(live_position_storage_key(character_id))
    if (!raw) return null
    const saved = JSON.parse(raw)
    if (saved.world_id !== world_id) return null
    const age = Date.now() - Number(saved.ts)
    if (!Number.isFinite(age) || age < 0 || age > max_age_ms) return null
    const { x, z } = saved
    if (![x, z].every(Number.isFinite)) return null
    return { x, z }
  } catch {
    return null
  }
}

/** Test-only reset of the in-memory cadence state. */
export function _reset_for_test() {
  pending = null
  last_write_at.clear()
}
