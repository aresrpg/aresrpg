// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SINGLE-PTB TURN COMMIT — the pure core of the turn-commit system: a turn
// is a single PTB. Small pure helpers the store composes with its effects:
//
//   stage_to_batch            staged UI intents → the @aresrpg/sdk `commit_turn_ptb` action shape (+ the VFX
//                             keys of what actually ships, order preserved; staging-bug casts are DROPPED and
//                             reported — loud at the call site, never silently downgraded to a weapon swing).
//
// Its EFFECT half — `commit_with_overdue_retry` (runs commits, speaks the tx error vocabulary) — lives at the
// frontend tx edge (world-shell/overdue_retry.js): the fight core is promise-free by law.

export const CAST_DROP_TARGET_OUT_OF_REACH = 'target_out_of_reach'
export const CAST_DROP_STALE_TARGET = 'stale_target'

/**
 * A cast actually omitted from the controlled player's commit batch. This record is created at the removal
 * edge, after re-validation has made its domain decision; prediction, peer replay, and mob processing never need
 * to manufacture one. The frontend may project this explicit local event into feedback after the batch commits.
 * @param {{ actor_id:string, spell_name:string, reason:string }} drop
 */
export function local_commit_cast_drop({ actor_id, spell_name, reason }) {
  return { kind: 'cast_drop', source: 'local_commit', actor_id, spell_name, reason }
}

/**
 * Map the store's staged intents (kind 0 move / 2 weapon / 1 cast) to the SDK batch shape.
 * @param {Array<{ kind: number, target: number, spell_template_id?: string, spell_key?: string }>} actions
 * @param {(cell: number) => number} to_cell canonical stride-20 → the fight's own width (fight_bridge.to_fight_cell)
 * @returns {{
 *   batch: Array<{ kind: 'move', cell: number } | { kind: 'weapon', target_cell: number } |
 *     { kind: 'cast', spell_template_id: string, target_cell: number }>,
 *   vfx_keys: string[],
 *   dropped: object[],
 * }}
 */
export function stage_to_batch(actions, to_cell) {
  const batch = []
  const vfx_keys = []
  const dropped = []
  for (const a of actions ?? []) {
    const target = to_cell(a.target)
    if (a.kind === 0) batch.push({ kind: 'move', cell: target })
    else if (a.kind === 2) {
      // WEAPON strike (§17.27) — no SpellTemplate; its VFX key rides like a cast (the 'weapon' beat).
      batch.push({ kind: 'weapon', target_cell: target })
      if (a.spell_key) vfx_keys.push(a.spell_key)
    } else if (typeof a.spell_template_id === 'string' && a.spell_template_id.startsWith('0x')) {
      batch.push({ kind: 'cast', spell_template_id: a.spell_template_id, target_cell: target })
      if (a.spell_key) vfx_keys.push(a.spell_key)
    } else dropped.push(a) // cast staged WITHOUT its SpellTemplate object id — a staging bug, surfaced by the caller
  }
  return { batch, vfx_keys, dropped }
}

/**
 * Recompose flush-validated casts into the canonical staged order. Moves need no replacement, so they are copied
 * directly from `staged`; each cast/weapon consumes exactly one slot from `resolved_casts`. A rejected cast keeps a
 * `null` slot so a later survivor can never slide into the rejected action's earlier position.
 * @param {Array<{ kind:number, target:number }>} staged
 * @param {Array<{ kind:1|2, target:number, spell_template_id?:string, spell_key?:string }|null>} resolved_casts
 * @returns {Array<{ kind:number, target:number, spell_template_id?:string, spell_key?:string }>}
 */
export function compose_turn_actions(staged, resolved_casts = []) {
  const actions = []
  let cast_i = 0
  for (const action of staged ?? []) {
    if (action.kind === 0) actions.push({ kind: 0, target: action.target })
    else if (action.kind === 1 || action.kind === 2) {
      const resolved = resolved_casts[cast_i]
      cast_i += 1
      if (resolved) actions.push(resolved)
    }
  }
  return actions
}

/** Exact chain turn identity. A same-player solo turn is still distinct because its deadline changes. */
export function turn_commit_key({ fight_id, entity_id, deadline_ms }) {
  if (!fight_id || !entity_id || !(Number(deadline_ms) > 0)) return null
  return `${fight_id}@${entity_id}@${Number(deadline_ms)}`
}

/** Stable client submit epoch: failure keeps it claimed; receipt_seq advances only after authoritative feedback. */
export function turn_submit_epoch({ fight_id, turn_started_at, receipt_seq = 0 }) {
  if (!fight_id || turn_started_at == null) return null
  return `${fight_id}@${Number(turn_started_at)}#${Number(receipt_seq) || 0}`
}

/** Immutable executed-failure latch row. `digest` is the proof that this attempt already burned gas. */
export function executed_turn_failure(turn_key, digest, failed_at_ms = 0) {
  if (!turn_key || !digest) return null
  return { turn_key, digest: String(digest), failed_at_ms: Number(failed_at_ms) || 0 }
}

/** Only automatic fire is blocked; a deliberate manual End Turn press remains a fresh user action. */
export function auto_commit_blocked(latch, turn_key) {
  return !!turn_key && latch?.turn_key === turn_key && !!latch?.digest
}

/** Pure auto-flush switchboard used by the board and its deterministic failure trace. A ZERO-draft turn
 *  still fires — a turn commits in any case, to trigger mob actions — stage_to_batch
 *  ships an empty batch as one bare act_pass, so the idle commit is what hands the mobs their wave. */
export function auto_commit_decision({ enabled, busy, now_ms, deadline_ms, latch, turn_key }) {
  if (!enabled) return 'disabled'
  if (auto_commit_blocked(latch, turn_key)) return 'latched'
  if (!busy) return 'fire'
  return Number(now_ms) < Number(deadline_ms) - 1500 ? 'retry' : 'missed'
}

/**
 * COMMIT-LEGALITY of ONE drafted strike/cast entry at flush — pure, so the drop rule is provable off the browser.
 * `in_footprint`: the cell lies inside this entry's own [rmin,rmax] + LOS geometry.
 *  · WEAPON — demands a LIVING enemy on the cell, judged on the CHAIN-COMMITTED target (`committed_target_alive`,
 *    my own drafts EXCLUDED). The chain's `act_weapon` validates against live on-chain hp BEFORE applying, so a
 *    swing that OPTIMISTICALLY killed its own target must still commit — the optimistic occupancy already folded
 *    THIS strike's kill, and gating on it dropped a mob-killing swing "as if I did nothing", then the
 *    authoritative receipt revived the corpse. The spell path never gated on target
 *    liveness (a void cast at any legal cell is the player's right), which is exactly why the SPELL kill worked.
 *  · SPELL — legal at any in-footprint cell, with two symmetric occupancy rules: a `free_cell` (trap) spell drops
 *    an OCCUPIED-by-living cell, and a `requires_occupant` spell (#1741 — zero-area single-target DAMAGE) drops an
 *    EMPTY one. The click gate already withholds the empty cell, so this catches only the mid-draft change of
 *    truth: the aimed body died or walked off before the flush, which is the same void cast arriving late.
 *  · SELF-CAST (`self_cast`, rmax 0 — invisibility/vanish, the spellbook 'self' marker) — NEVER illegal. A
 *    self-only buff targets the caster's OWN tile; the caster can never move out of reach of itself, so
 *    re-validating it can only FALSE-DROP the buff (and revert its granted MP) — the #321/#323 absurdity
 *    ceiling ("a self-target cast can never be no longer valid"). The flush snaps its target to the caster's
 *    current cell and this gate lets it through unconditionally (the twin of the trap rule: cells don't move).
 * @param {{ in_footprint: boolean, is_weapon: boolean, target_is_mob?: boolean, committed_target_alive?: boolean,
 *   free_cell?: boolean, occupied_alive?: boolean, self_cast?: boolean, requires_occupant?: boolean }} entry
 * @returns {boolean} true ⇒ DROP this entry (illegal to commit)
 */
export function strike_flush_illegal({
  in_footprint,
  is_weapon,
  target_is_mob = false,
  committed_target_alive = false,
  free_cell = false,
  occupied_alive = false,
  self_cast = false,
  requires_occupant = false,
}) {
  if (self_cast) return false // a self-only buff always commits on the caster's own cell — #321/#323
  if (!in_footprint) return true
  if (is_weapon) return !(target_is_mob && committed_target_alive)
  if (free_cell === true) return !!occupied_alive
  return requires_occupant === true && !occupied_alive
}
