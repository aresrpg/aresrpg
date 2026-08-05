// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CHECKPOINT SPAWN — the pure half (D770a W2, moved verbatim from world-shell/world_checkpoint.js): resolve
// the character's on-chain checkpoint (chain truth) to a WORLD render position for a (re)join/reload. THE fix
// for the "reload spawns at the origin" bug: a zone SEARCH advances the per-world checkpoint (§5 — zones.move
// writes the proven standing position) but the client rendered the hardcoded WORLD_SPAWN default, so any
// player who searched then reloaded stood zones from their checkpoint — their zone-scoped mobs/nodes
// invisible AND their next search aborting ETravelTooFar forever (checkpoint::verify_travel). Chain is the
// source of truth: the checkpoint WINS over any local session restore when they disagree.
//
// COORD CODEC: the checkpoint stores UNSIGNED CHAIN block coords (search_zone_ptb sent `world_to_chain(x,
// bounds/2)`); the inverse `chain_to_world` with the SAME per-world offset brings it back to signed world
// space — exactly how the spawns core ingests the mob rows, so the player and their mobs share one space.
// The async read + synchronous boot cache stay at the frontend edge (world-shell/world_checkpoint.js).

import { world_offsets, chain_to_world, DEFAULT_ZONE_SIZE } from '@aresrpg/sdk/coords'

// A session restore within this 2D radius (blocks) of the checkpoint is the SAME area — a fine-grained free
// walk since the last position-proving tx — so it's kept for exact resume; farther = they DISAGREE and chain
// wins. Defaults to one discovery-zone edge (the render neighbourhood streamed around the checkpoint).
export const AGREE_RADIUS_M = DEFAULT_ZONE_SIZE

/**
 * PURE: chain checkpoint `{ x, z }` (unsigned block coords) + the World doc (its `bounds` → per-axis offset)
 * → SIGNED world render `{ x, z }`, or null when the checkpoint/coords are absent or non-finite.
 * @param {{ x: number, z: number } | null | undefined} cp
 * @param {{ bounds_x?: number, bounds_z?: number } | null | undefined} world_doc
 * @returns {{ x: number, z: number } | null}
 */
export function checkpoint_to_world(cp, world_doc) {
  if (!cp || !Number.isFinite(Number(cp.x)) || !Number.isFinite(Number(cp.z))) return null
  const off = world_offsets(world_doc)
  return { x: chain_to_world(Number(cp.x), off.x), z: chain_to_world(Number(cp.z), off.z) }
}

/**
 * PURE: true when `a` and `b` are the SAME area — within `radius` blocks in the (x,z) plane. THE agreement
 * rule: the boot arbiter below and the persistence edge's restore guard both ask this one question, so a
 * local row and the chain anchor are compared by one law in one home.
 * @param {{ x: number, z: number } | null | undefined} a
 * @param {{ x: number, z: number } | null | undefined} b
 * @param {number} [radius]
 * @returns {boolean}
 */
export function positions_agree(a, b, radius = AGREE_RADIUS_M) {
  if (!a || !b) return false
  const dx = Number(a.x) - Number(b.x)
  const dz = Number(a.z) - Number(b.z)
  return Number.isFinite(dx) && Number.isFinite(dz) && radius > 0 && dx * dx + dz * dz <= radius * radius
}

/** PURE: one session row → its boot spawn (the checkpoint carries no height, so `y_seed` fills it in). */
const session_spawn = (session, y_seed) => ({
  position: /** @type {[number, number, number]} */ ([
    session.x,
    Number.isFinite(session.y) ? session.y : y_seed,
    session.z,
  ]),
  yaw: Number.isFinite(session.yaw) ? session.yaw : 0,
  source: /** @type {'session'} */ ('session'),
})

/**
 * PURE boot-spawn priority — CHAIN CHECKPOINT is the source of truth:
 *   • session restore stamped as a RETURN ANCHOR → that restore (see below),
 *   • checkpoint present + session restore CLOSE (same area) → the session restore (exact fine-grained resume),
 *   • checkpoint present + session restore absent or FAR (they disagree) → the checkpoint,
 *   • no checkpoint (pre-first-join) → the session restore if any, else the WORLD_SPAWN fallback.
 * The checkpoint carries no height, so its spawn seeds `y_seed` (the WORLD_SPAWN y); the boot's D188 ground
 * scan + physics gate settle the body onto the real column exactly as they do for the default spawn.
 *
 * THE RETURN ANCHOR (#2174) — a fight took the body out of the world at a pose the chain never recorded: the
 * JOIN door (`fight::join`) takes no `&World` and writes no checkpoint, so a teammate's anchor stays wherever
 * it last was while they walked to the fight. The agreement rule then has nothing to agree with and the
 * teammate woke at the stale checkpoint (the world origin, right after a world join). A restore the
 * persistence edge stamped at that fight's door is the pose the session pulled the body OUT of, observed
 * AFTER the checkpoint was written, so it resumes exactly. Chain truth still wins the moment it moves: a
 * checkpoint that advanced since drops the stamped row at the persistence edge, and this arbiter never sees it.
 * @param {{
 *   checkpoint: { x: number, z: number } | null,
 *   session: { x: number, z: number, y?: number, yaw?: number, return_anchor?: boolean } | null,
 *   fallback: [number, number, number],
 *   y_seed: number,
 *   radius?: number,
 * }} args
 * @returns {{ position: [number, number, number], yaw: number, source: 'checkpoint' | 'session' | 'fallback' }}
 */
export function resolve_boot_spawn({ checkpoint, session, fallback, y_seed, radius = AGREE_RADIUS_M }) {
  if (session?.return_anchor === true) return session_spawn(session, y_seed)
  if (checkpoint) {
    if (positions_agree(session, checkpoint, radius)) return session_spawn(session, y_seed)
    return { position: [checkpoint.x, y_seed, checkpoint.z], yaw: 0, source: 'checkpoint' }
  }
  if (session) return session_spawn(session, y_seed)
  return { position: [...fallback], yaw: 0, source: 'fallback' }
}
