// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The END-TURN re-validation of a drafted cast queue — extracted out of DungeonBoard's render closure so the
// decision that decides whether a staged strike REACHES THE CHAIN is drivable (and red-testable) on its own.
// Pure: plain data in, the composed `{kind:1|2}` action slots + the drop records out. Effects (game_log, toasts,
// the store's trap rollback) stay at the caller's edge — this file never touches a store.
//
// ONE LEGALITY HOME: the footprint is the SAME `cast_range_set_dungeon` the click gate paints, fed the SAME
// blocker rule (`cast_los_blockers` below). Click-time and flush-time can no longer drift.

import {
  CAST_DROP_STALE_TARGET,
  CAST_DROP_TARGET_OUT_OF_REACH,
  local_commit_cast_drop,
  strike_flush_illegal,
} from '@aresrpg/fight/turn_commit'
import { retarget_cast } from '@aresrpg/fight/txs'
import { decode } from '@aresrpg/fight/los'

import { cast_range_set_dungeon } from '../../../../fight-engine/overlay_intents.js'

/**
 * Re-validate every drafted cast/weapon against the board the chain evolves to just before it fires, and compose
 * the ordered `cast_actions` slots the PTB ships. A rejected cast keeps an EMPTY slot so later survivors never
 * slide ahead of an intervening move.
 *
 * @param {object} params
 * @param {Array<{ cell:number, spell_key:string|null }>} params.cast_queue drafted casts, in staged order
 * @param {Array<{ occupied: Map<number, any>, caster_cell: number|null }>} params.evolved one pre-fire snapshot per cast
 * @param {Map<number, { kind:'player'|'mob', alive:boolean, idx:number }>} params.occupied eye-state occupancy
 * @param {number[]} params.obstacles
 * @param {{ width:number, height:number, shape_mask?:Set<number>|number[] }} params.grid
 * @param {number} params.committed_caster_cell anchor fallback when the evolver has no snapshot
 * @param {number} params.caster_seat the caster's escrow index
 * @param {string} params.caster_id
 * @param {Array<any>} params.my_spells the seat's on-chain spell rows
 * @param {string} params.weapon_attack_id
 * @param {number} params.weapon_reach
 * @param {any} params.active_fighter
 * @param {[number, number]} params.fallback_range used when the drafted spell carries no authored range
 * @param {Record<string, { cell?:number }>} params.committed_fighters committed_state fighters, keyed p{seat}/m{idx}
 * @param {(idx:number) => number|null} params.mob_hp_of chain-committed mob hp (my drafts EXCLUDED)
 * @param {(entry:{ spell_key:string|null }, drafted_spell:any, is_weapon:boolean) => string} params.spell_name_of
 * @returns {{ cast_actions: Array<any>, dropped: number, cast_drops: Array<any>, trap_placed: number[],
 *   trap_dropped: number[], logs: Array<{ message: string, payload: object }> }}
 */
export const validate_flush_casts = ({
  cast_queue,
  evolved,
  occupied,
  obstacles,
  grid,
  committed_caster_cell,
  caster_seat,
  caster_id,
  my_spells,
  weapon_attack_id,
  weapon_reach,
  active_fighter,
  fallback_range,
  committed_fighters,
  mob_hp_of,
  spell_name_of,
}) => {
  const cast_actions = Array(cast_queue.length).fill(null)
  // Trap cells committed THIS flush (survivors → chain truth) vs DROPPED trap drafts (their optimistic
  // click-time marker — trap paint at cast, design ruling 2026-07-17 — must roll back).
  const trap_placed = []
  const trap_dropped = []
  const cast_drops = []
  const logs = []
  let dropped = 0
  for (const [cast_i, entry] of (cast_queue ?? []).entries()) {
    const is_weapon = entry.spell_key === weapon_attack_id
    const drafted_spell = is_weapon ? null : (my_spells.find((sp) => sp.name_key === entry.spell_key) ?? null)
    // #321 GROUND-TARGET EXEMPTION: a free_cell spell (trap/glyph/teleport) targets the CELL itself, not a
    // fighter standing on it — cells don't move, so it must never enter the fighter retarget/drop path below,
    // whatever occupies that cell by flush time (a body walking onto a drafted trap cell must not un-draft it).
    const ground_targeted = !is_weapon && drafted_spell?.levels?.[0]?.free_cell === true
    // #321 PER-CAST ANCHOR: this cast's own footprint origin — the caster's cell evolved through casts
    // 1..cast_i-1's OWN displacement effects (a drafted teleport/dash among them), never the sequence's
    // static starting cell.
    const cast_anchor = evolved[cast_i]?.caster_cell ?? committed_caster_cell
    const spell_display_name = spell_name_of(entry, drafted_spell, is_weapon)
    // ⑭ the board the chain evolves to JUST BEFORE this cast fires; the eye-state occupancy is the fallback.
    const occ = evolved[cast_i]?.occupied ?? occupied
    const caster_alive = [...occ.values()].find(
      (fighter) => fighter.kind === 'player' && fighter.idx === caster_seat
    )?.alive
    const los = [...obstacles]
    for (const [c, o] of occ) if (o.alive && !(o.kind === 'player' && o.idx === caster_seat)) los.push(c)
    // Resolve the drafted cast's target FIGHTER through the EYE-STATE occupancy (`occupied` — the last-rendered
    // board; it still shows the click-time cell even once a fresher committed/evolved read has moved the
    // fighter on, which is exactly what makes it useful here). No fighter found (a void cast, the ground
    // itself, or a ground_targeted cast — #321, cells don't move) resolves a null committed_cell —
    // txs.retarget_cast's own null branch composes the drafted cell unchanged.
    const eye_target = ground_targeted ? null : occupied.get(entry.cell)
    const target_committed_cell = eye_target
      ? (committed_fighters?.[`${eye_target.kind === 'mob' ? 'm' : 'p'}${eye_target.idx}`]?.cell ?? null)
      : null
    const drop_entry = (reason) => {
      logs.push({
        message: `flush_commit: staged strike dropped — ${reason}`,
        payload: { cell: entry.cell, anchor: cast_anchor, weapon: is_weapon },
      })
      dropped += 1
      cast_drops.push(local_commit_cast_drop({ actor_id: caster_id, spell_name: spell_display_name, reason }))
      // a dropped trap draft never reaches the chain — its click-time optimistic marker rolls back at the edge.
      if ((drafted_spell?.levels?.[0]?.effects ?? []).some((e) => e.kind === 'PLACE_TRAP'))
        trap_dropped.push(entry.cell)
    }
    // A prior ordered move may have crossed a lethal known trap. The contract commits that death, but any
    // following act_cast would fail begin_living_action and revert the PTB, so omit the now-impossible suffix cast.
    if (caster_alive === false) {
      drop_entry(CAST_DROP_STALE_TARGET)
      continue
    }
    let illegal
    let target_cell = entry.cell
    if (is_weapon) {
      // WEAPON: [1, reach] + LOS + a LIVING enemy on the cell — the exact cast::weapon_strike gate.
      const footprint = cast_range_set_dungeon([1, weapon_reach], { cell: decode(cast_anchor) }, grid, los, {
        los: true,
        linear: false,
      })
      const retargeted = retarget_cast({
        target_cell: entry.cell,
        committed_cell: target_committed_cell,
        reaches: (cell) => footprint.has(cell),
      })
      if (retargeted.dropped) {
        drop_entry(CAST_DROP_TARGET_OUT_OF_REACH)
        continue
      }
      target_cell = retargeted.target
      const tgt = occ.get(target_cell)
      // Liveness is CHAIN-COMMITTED (mob_hp_of — my drafts EXCLUDED), never the optimistic `tgt.alive`: this
      // swing's OWN kill already folded the mob dead, so gating on the optimistic corpse dropped a mob-killing
      // strike "as if I did nothing" and the receipt then revived it (regression ①/⑧b).
      illegal = strike_flush_illegal({
        in_footprint: footprint.has(target_cell),
        is_weapon: true,
        target_is_mob: tgt?.kind === 'mob',
        committed_target_alive: tgt?.kind === 'mob' && (mob_hp_of(tgt.idx) ?? 0) > 0,
      })
    } else {
      // The DRAFTED spell (pinned at pick) judges the cast — a disarm/re-arm can't use the wrong spell's flags.
      const lvl = drafted_spell?.levels?.[0]
      const range = lvl?.range ?? fallback_range
      // SELF-ONLY BUFF (#321/#323): rmax 0 (invisibility/vanish — the spellbook 'self' marker) targets the
      // caster's OWN tile. It can never move out of reach of itself, so it NEVER re-validates (the twin of the
      // trap rule, cells don't move) — commit it on the caster's CURRENT cell (`cast_anchor`, this cast's own
      // per-cast-evolved cell — never dropped).
      const self_cast = (range?.[1] ?? 0) === 0
      const footprint = cast_range_set_dungeon(
        range,
        { ...active_fighter, cell: decode(cast_anchor) },
        grid,
        los,
        {
          los: lvl?.line_of_sight !== false,
          linear: lvl?.linear === true,
          modifiable_range: lvl?.modifiable_range === true,
        }
      )
      const retargeted = self_cast
        ? { target: cast_anchor }
        : retarget_cast({
            target_cell: entry.cell,
            committed_cell: target_committed_cell,
            reaches: (cell) => footprint.has(cell),
          })
      if (retargeted.dropped) {
        drop_entry(CAST_DROP_TARGET_OUT_OF_REACH)
        continue
      }
      target_cell = retargeted.target
      illegal = strike_flush_illegal({
        in_footprint: footprint.has(target_cell),
        is_weapon: false,
        self_cast,
        free_cell: lvl?.free_cell === true,
        occupied_alive: !!occ.get(target_cell)?.alive,
      })
    }
    if (illegal) {
      drop_entry(CAST_DROP_STALE_TARGET)
      continue
    }
    // VOID CASTS ARE LEGAL (a cast at any legal-geometry cell is the player's right). Weapon → {kind:2}
    // act_weapon; spell → {kind:1} act_cast staging the on-chain SpellTemplate id (a spell with no resolved id
    // is skipped LOUDLY, never downgraded to a swing).
    if (is_weapon) cast_actions[cast_i] = { kind: 2, target: target_cell, spell_key: weapon_attack_id }
    else if (drafted_spell?.object_id) {
      cast_actions[cast_i] = {
        kind: 1,
        target: target_cell,
        spell_template_id: drafted_spell.object_id,
        spell_key: drafted_spell.name_key, // VFX handoff — the bridge's confirm replay routes element VFX by it
      }
      // A PLACE_TRAP effect ⇒ this cast lays a trap on `target_cell` — remember it to mark once committed.
      if ((drafted_spell.levels?.[0]?.effects ?? []).some((e) => e.kind === 'PLACE_TRAP')) trap_placed.push(target_cell)
    } else
      logs.push({
        message: 'flush_commit: cast drafted but no on-chain spell id resolved — skipped',
        payload: { spell_key: entry.spell_key },
      })
  }
  return { cast_actions, dropped, cast_drops, trap_placed, trap_dropped, logs }
}
