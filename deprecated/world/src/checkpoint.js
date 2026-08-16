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

import { world_offsets, chain_to_world } from '@aresrpg/sdk/coords'
import { travel_ok } from '@aresrpg/sdk/travel'

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

/** The whole-block value a PTB would send for a world coordinate (`Math.floor` — discovery_actions.js). */
const block_of = (v) => Math.floor(Number(v))

/**
 * THE CHAIN ANCHOR BAG (#2231) — the chain's proven checkpoint plus everything the agreement rule needs to
 * judge a local pose against it: `time_ms` (the chain clock at that write), `speed_budget` (the world's dial)
 * and `pet_equipped` (the checkpoint half of the §17.2 mount rule). The dials ride WITH the position they are
 * judged against — read in the same breath, so no consumer can pair a fresh position with a stale budget.
 * @typedef {{ x: number, z: number, time_ms: number|null, speed_budget?: number|null, pet_equipped?: boolean }}
 *   ChainAnchor
 */

/** THE anchor clock: a chain revision, or null when the value cannot be one (absent, corrupt, non-finite). */
export function anchor_time(anchor) {
  const time_ms = Number(anchor?.time_ms)
  return Number.isFinite(time_ms) && time_ms > 0 ? time_ms : null
}

/** THE anchor travel dial (blocks/sec ×100), or null when the value cannot be one. */
const anchor_budget = (anchor) => {
  const speed_budget = Number(anchor?.speed_budget)
  return Number.isFinite(speed_budget) && speed_budget > 0 ? speed_budget : null
}

/**
 * THE ONE normalizer for the anchor bag — every door that stores or forwards a chain anchor (the frontend
 * read/receipt edge, the persistence edge, the spawns core's checkpoint fold) passes it through here, so the
 * bag `pose_agrees` judges is the same bag whichever door produced it. A field that cannot carry its fact
 * becomes null, which is what makes the anchor UNJUDGEABLE below — never a value the rule would act on.
 * @param {Partial<ChainAnchor> | null | undefined} anchor
 * @returns {ChainAnchor | null} null when the position itself is absent or non-finite
 */
export function normalize_chain_anchor(anchor) {
  const x = Number(anchor?.x)
  const z = Number(anchor?.z)
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null
  return {
    x,
    z,
    time_ms: anchor_time(anchor),
    speed_budget: anchor_budget(anchor),
    pet_equipped: anchor?.pet_equipped === true,
  }
}

/**
 * THE AGREEMENT RULE (#2231) — could the body legally stand at `pose` at instant `at_ms`, given the chain's
 * proven checkpoint? The boot arbiter below and the persistence edge's restore guard both ask this one
 * question, so a local row and the chain anchor are compared by one law in one home.
 *
 * The law is the CHAIN's, derived not restated: `@aresrpg/sdk/travel` is the twin of `world_math::travel_ok`,
 * the exact predicate `world::verify_travel` gates every position-proving tx with. It is TIME-BUDGETED — the
 * legal distance from the checkpoint grows with the elapsed time since it was written. The flat 512-block
 * radius this replaced was a third rule: it yanked a long walker back to their last checkpoint on reload
 * (their walk was chain-legal — hours of elapsed time — but past the radius) while accepting a 500-block
 * teleport one second after a search (radius-legal, chain-illegal). Accepting exactly the chain's set is what
 * keeps the rendered body somewhere its owner can still act from.
 *
 * `checkpoint` is the chain anchor bag: proven position + `time_ms` (the chain clock at the write) +
 * `speed_budget` (the world's dial) + `pet_equipped` (the checkpoint half of the §17.2 mount rule).
 *
 * UNJUDGEABLE (no clock or no budget on the anchor — a receipt-built anchor, or a world-doc read that
 * missed): the rule cannot be evaluated, and this answers TRUE, keeping the local pose. A wrong yank is
 * silent, unexplained and unrecoverable for the player; a wrongly kept pose surfaces loudly as abort 121 with
 * the existing one-click resync (world-shell/travel_recovery.js). The caller's own guards — identity, row
 * freshness, and the chain-anchor match that drops the row the instant chain truth moves — still apply.
 *
 * @param {{ x: number, z: number } | null | undefined} pose
 * @param {Partial<ChainAnchor> | null | undefined} checkpoint
 * @param {number} at_ms the instant `pose` claims (a persisted row's write time; `now` for a live body)
 * @returns {boolean}
 */
export function pose_agrees(pose, checkpoint, at_ms) {
  if (!pose || !checkpoint) return false
  const px = block_of(pose.x)
  const pz = block_of(pose.z)
  const cx = block_of(checkpoint.x)
  const cz = block_of(checkpoint.z)
  if (![px, pz, cx, cz].every(Number.isFinite)) return false
  const speed_budget = anchor_budget(checkpoint)
  const from_ms = anchor_time(checkpoint)
  const to_ms = Number(at_ms)
  if (speed_budget === null || from_ms === null || !Number.isFinite(to_ms)) return true // unjudgeable — above
  return travel_ok(speed_budget, cx, cz, from_ms, px, pz, to_ms, checkpoint.pet_equipped === true)
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
 *   • checkpoint present + session restore chain-LEGAL for the elapsed travel time → the session restore,
 *   • checkpoint present + session restore absent or beyond the travel budget → the checkpoint,
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
 *   checkpoint: ChainAnchor | null,
 *   session: { x: number, z: number, y?: number, yaw?: number, return_anchor?: boolean } | null,
 *   fallback: [number, number, number],
 *   y_seed: number,
 *   now: number,
 * }} args
 * @returns {{ position: [number, number, number], yaw: number, source: 'checkpoint' | 'session' | 'fallback' }}
 */
export function resolve_boot_spawn({ checkpoint, session, fallback, y_seed, now }) {
  if (session?.return_anchor === true) return session_spawn(session, y_seed)
  if (checkpoint) {
    if (pose_agrees(session, checkpoint, now)) return session_spawn(session, y_seed)
    return { position: [checkpoint.x, y_seed, checkpoint.z], yaw: 0, source: 'checkpoint' }
  }
  if (session) return session_spawn(session, y_seed)
  return { position: [...fallback], yaw: 0, source: 'fallback' }
}
