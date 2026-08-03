// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DungeonBoard's staged-turn validation, composition, and auto-commit subscriptions. Split out of
// DungeonBoard.jsx (issue #2069); the section is unchanged.
import { useEffect } from 'react'

import { push_event_toast } from '../../../core/toast.js'
import { WEAPON_ATTACK_ID, WEAPON_ATTACK_RANGE } from '../../../core/modules/fight.js'
import { use_dungeon } from '../../../../world-shell/dungeon_store.js'
import {
  compose_staged_turn,
  retarget_cast,
  staged_turn_paths,
  subscribe_commit_due,
  subscribe_divergence,
  subscribe_turn_lost,
} from '@aresrpg/fight/txs'
import { fight_store } from '@aresrpg/fight/store'
import { committed_mob_hp, committed_truth, fight_view } from '@aresrpg/fight/project'
import {
  CAST_DROP_STALE_TARGET,
  CAST_DROP_TARGET_OUT_OF_REACH,
  local_commit_cast_drop,
  strike_flush_illegal,
} from '@aresrpg/fight/turn_commit'
import { evolve_flush_casts } from '@aresrpg/fight/predict_cast'
import { decode } from '@aresrpg/fight/los'
import { cast_range_set_dungeon } from '../../../../fight-engine/overlay_intents.js'
import { dungeon_grid_of } from '../../dungeon-grid.js'
import { cast_requires_occupant } from '../fight-spells.js'
import { game_log } from '../../../../core/log.js'
import { fight_state_trace } from '../../../../world-shell/fight_state_trace.js'
import { emit_local_cast_drop_toast } from './cast_drop_toast.js'
import { evolution_actions_of } from './DungeonBoardState.jsx'

// Dungeon.status machine (dungeon.move). ROOM_CLEARED is handled in dungeon_store (board unmounts → plane).
const STATUS_ACTIVE = 1 // live fire-time guard for the reducer-derived commit edge
// (STATUS_PLACEMENT removed — the placement chrome gate is now the phase machine's is_placement, not a raw read)

/**
 * Install the commit-edge subscriptions and return the shared manual/background turn flusher.
 */
export function useDungeonBoardCommit(state, t) {
  const {
    auto_submit_ref,
    entity_id,
    me,
    my_spells,
    resolve_ref,
    dungeon,
    level_row,
    cast_params,
    active_fighter,
    occupied,
    obstacles,
    fight,
    commit_turn,
    my_turn_no,
    record_cast_turns,
    clear_picks,
  } = state

  // ── AUTO-COMMIT (D36 deadline + D37a kill) — the reducer derives one due edge; this function remains the
  //    shared manual/background batch builder and revalidates the live fire conditions before submit. ──
  const flush_commit = async (draft_actions, background = false) => {
    // LOUD-PIPELINE (qa D89 flag: a sequential commit dropped SILENTLY): the last mute guard on the END TURN
    // path now NAMES itself instead of vanishing.
    // Read `busy` LIVE at the derived edge; a render closure is never transaction authority.
    const busy_now = use_dungeon.getState().busy
    // TERMINAL-RACE guard (regression: the deadline auto-commit fired begin_action into a fight the
    // killing blow already ENDED → SimulationError abort 101, then a scary "failed on-chain" toast). Only an
    // ACTIVE fight on MY still-live turn takes a commit. Re-read the fire conditions LIVE at FIRE time — status
    // from the store AND my-turn/winner from the live fight slice (the `my_turn` closure can be stale by the time
    // an async edge runs) — so a moot commit is SKIPPED silently (nothing to commit, no toast). The
    // benign-101 swallow in commit_turn is the backstop for the case only the CHAIN yet knows is terminal.
    const status_now = use_dungeon.getState().dungeon?.status
    const live_fight = fight_view() // synchronous core view (S2 mirror kill) — fire-time truth, never a stale copy
    const my_turn_now = !!live_fight && live_fight.active_entity_id === entity_id && live_fight.winner === -1
    if (!my_turn_now || busy_now || status_now !== STATUS_ACTIVE) {
      fight_state_trace('flush_skipped', {
        background,
        my_turn: my_turn_now,
        busy: busy_now,
        status: status_now,
      })
      game_log('board', 'flush_commit skipped — not an active commit at fire time', {
        my_turn_now,
        busy: busy_now,
        status: status_now,
        background,
      })
      return
    }
    // D254 (1.29 cumulative move): EACH drafted step ships as its OWN {kind:0} move — commit_turn_core's loop
    // charges bfs_path_cost PER segment from the running cell (a single direct move under-charges a bent path).
    const move_actions = (draft_actions ?? [])
      .filter((action) => action.kind === 0)
      .map((action) => ({ kind: 0, target: action.target }))
    const cast_queue = (draft_actions ?? [])
      .filter((action) => action.kind === 1 || action.kind === 2)
      .map((action) => ({ cell: action.target, spell_key: action.spell_key ?? null }))
    // S-12 §17.27 STACKED CASTS: ship EVERY queued cast/weapon (the chain accepts N/turn, AP-limited on-chain). Each
    // entry PINNED its own spell_key at draft time, so a disarm/re-arm between pick and flush can't swap what
    // commits. Revalidate each against CURRENT state with the SAME twin the click gate paints (a co-op mob shift /
    // an earlier action can invalidate a target between pick and flush). The reducer-owned staged array is the ONE
    // order source for both this validation and the submitted PTB; rejected casts keep an empty slot during
    // composition, so later survivors never slide ahead of an intervening move.
    const committed_caster_cell = me?.committed?.cell ?? me?.cell ?? null
    const caster_seat = resolve_ref(entity_id)?.idx ?? -1
    // ⑭ EVOLVED-SEQUENCE VALIDATION (regression: placing a trap behind a mob then pushing it on — the turn
    // committed without the spell, though everything was valid): every action reads LIVE evolved state, so a cast
    // is judged against the committed base folded through every PRIOR drafted action. Casts evolve displacement /
    // kills through the sim door; moves immediately relocate the caster before a following cast takes its snapshot.
    // This is also the #321 per-cast caster anchor: an earlier teleport, ordinary move, or both determine the exact
    // footprint origin the contract reads when this cast fires.
    const evolution_actions = evolution_actions_of(draft_actions, my_spells, me?.weapon)
    const evolved = evolve_flush_casts({
      view: fight_view(),
      committed: committed_truth(fight_store.getState()),
      caster_id: entity_id,
      actions: evolution_actions,
      resolve_ref,
    })
    const cast_actions = Array(cast_queue.length).fill(null)
    // Trap cells committed THIS flush (survivors → chain truth) vs DROPPED trap drafts (their optimistic
    // click-time marker — trap paint at cast, design ruling 2026-07-17 — must roll back). The keyless read layer drops
    // Fight.fx, so the client mirrors its own placed traps; markers live until sprung / fight end.
    const trap_placed = []
    const trap_dropped = []
    let dropped = 0
    // Only this local commit-removal edge creates cast-drop events. Re-validation, evolved fighters, canonical
    // ingress, claim retirement, peers, and mobs return domain/state results but cannot request UI; the successful
    // commit consumes these records below.
    const cast_drops = []
    if (me && dungeon && committed_caster_cell != null)
      for (const [cast_i, entry] of (cast_queue ?? []).entries()) {
        const is_weapon = entry.spell_key === WEAPON_ATTACK_ID
        const drafted_spell = is_weapon ? null : (my_spells.find((sp) => sp.name_key === entry.spell_key) ?? null)
        // #321 GROUND-TARGET EXEMPTION: a free_cell spell (trap/glyph/teleport) targets the CELL itself, not a
        // fighter standing on it — cells don't move, so it must never enter the fighter retarget/drop path below,
        // whatever occupies that cell by flush time (a body walking onto a drafted trap cell must not un-draft it).
        const ground_targeted = !is_weapon && level_row(drafted_spell)?.free_cell === true
        // #321 PER-CAST ANCHOR: this cast's own footprint origin — the caster's cell evolved through casts
        // 1..cast_i-1's OWN displacement effects (a drafted teleport/dash among them), never the sequence's
        // static starting cell. That staleness was the drop-valid-stationary-targets class: an in-range target
        // fell out of a footprint drawn from the caster's pre-relocation corner of the board.
        const cast_anchor = evolved[cast_i]?.caster_cell ?? committed_caster_cell
        const spell_display_name = is_weapon
          ? t('fight.weapon_attack')
          : t(`spells.spell_${entry.spell_key}`, { defaultValue: drafted_spell?.name ?? entry.spell_key })
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
        // txs.retarget_cast's own null branch composes the drafted cell unchanged, so none of those are touched by
        // this lookup. Same p{seat}/m{idx} key format base_from_view writes (fold.js) — mob_key/seat_key aren't
        // exported; `occupied`'s idx already matches that indexing.
        const eye_target = ground_targeted ? null : occupied.get(entry.cell)
        const target_committed_cell = eye_target
          ? (committed_truth(fight_store.getState()).fighters?.[
              `${eye_target.kind === 'mob' ? 'm' : 'p'}${eye_target.idx}`
            ]?.cell ?? null)
          : null
        const drop_entry = (reason) => {
          game_log('board', `flush_commit: staged strike dropped — ${reason}`, {
            cell: entry.cell,
            anchor: cast_anchor,
            weapon: is_weapon,
            background,
          })
          dropped += 1
          cast_drops.push(local_commit_cast_drop({ actor_id: entity_id, spell_name: spell_display_name, reason }))
          // a dropped trap draft never reaches the chain — its click-time optimistic marker rolls back below.
          if ((level_row(drafted_spell)?.effects ?? []).some((e) => e.kind === 'PLACE_TRAP'))
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
          // WEAPON: [1, reach] + LOS + a LIVING enemy on the cell — the exact cast::weapon_strike gate. reach off the
          // seat's on-chain Weapon (independent of the current armed state — the draft is what commits).
          const reach = me.weapon?.reach ?? WEAPON_ATTACK_RANGE[1]
          const footprint = cast_range_set_dungeon(
            [1, reach],
            { cell: decode(cast_anchor) },
            dungeon_grid_of(dungeon),
            los,
            { los: true, linear: false }
          )
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
          // Liveness is CHAIN-COMMITTED (committed_mob_hp — my drafts EXCLUDED), never the optimistic `tgt.alive`:
          // this swing's OWN kill already folded the mob dead, so gating on the optimistic corpse dropped a
          // mob-killing strike "as if I did nothing" and the receipt then revived it (regression ①/⑧b). The
          // chain's act_weapon validates against live on-chain hp BEFORE applying, so the finishing swing is legal.
          illegal = strike_flush_illegal({
            in_footprint: footprint.has(target_cell),
            is_weapon: true,
            target_is_mob: tgt?.kind === 'mob',
            committed_target_alive: tgt?.kind === 'mob' && (committed_mob_hp(fight_store.getState(), tgt.idx) ?? 0) > 0,
          })
        } else {
          // The DRAFTED spell (pinned at pick) judges the cast — a disarm/re-arm can't use the wrong spell's flags.
          const lvl = level_row(drafted_spell)
          const range = lvl?.range ?? [cast_params.range_min, cast_params.range_max]
          // SELF-ONLY BUFF (#321/#323): rmax 0 (invisibility/vanish — the spellbook 'self' marker) targets the
          // caster's OWN tile. It can never move out of reach of itself, so it NEVER re-validates (the twin of the
          // trap rule, cells don't move) — commit it on the caster's CURRENT cell (`cast_anchor`, this cast's own
          // per-cast-evolved cell — never dropped). A stale adoption that shifted the eye/committed cell used to
          // false-drop it, reverting the buff AND the MP it granted — the "turn auto-ends right after a cast, the
          // cast then reverts" report.
          const self_cast = (range?.[1] ?? 0) === 0
          const footprint = cast_range_set_dungeon(
            range,
            { ...active_fighter, cell: decode(cast_anchor) },
            dungeon_grid_of(dungeon),
            los,
            {
              los: lvl?.line_of_sight !== false,
              linear: lvl?.linear === true,
              modifiable_range: lvl?.modifiable_range === true,
            }
          )
          // #321 + #323: "the caster's own cell" for a self-cast drafted after a teleport/dash earlier in the SAME
          // sequence is that cast's per-cast EVOLVED cell, never the sequence's static starting anchor (the same
          // staleness class #321 fixes for every other cast; a self-buff is no exception).
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
            // #1741's flush half: the click gate withheld the empty cell, so this only catches the body that died
            // or walked off mid-draft — the same void cast, arriving late. Judged on the flush's own occupancy
            // (chain-consistent), never the projected set: no refusal is rendered here, so nothing can leak.
            requires_occupant: cast_requires_occupant(lvl),
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
        if (is_weapon) cast_actions[cast_i] = { kind: 2, target: target_cell, spell_key: WEAPON_ATTACK_ID }
        else if (drafted_spell?.object_id) {
          cast_actions[cast_i] = {
            kind: 1,
            target: target_cell,
            spell_template_id: drafted_spell.object_id,
            spell_key: drafted_spell.name_key, // VFX handoff — the bridge's confirm replay routes element VFX by it
          }
          // A PLACE_TRAP effect ⇒ this cast lays a trap on `target_cell` — remember it to mark once committed.
          if ((level_row(drafted_spell)?.effects ?? []).some((e) => e.kind === 'PLACE_TRAP'))
            trap_placed.push(target_cell)
        } else
          game_log('board', 'flush_commit: cast drafted but no on-chain spell id resolved — skipped', {
            spell_key: entry.spell_key,
          })
      }
    // ROLLBACK LAW (regression: "mobs regain health"): predictions now retire through the ONE receipt ingress by
    // claim identity; the receipt's TurnEnded expires any local cast prediction the committed batch omitted. An
    // unrelated receipt never purges it, and object snapshots never re-adopt over the fold (M6 + M2b).
    // ARRAY ORDER (#398): validated casts return to their original staged slots; moves stay exactly where drafted.
    const actions = compose_staged_turn(draft_actions, cast_actions)
    const resolved_casts = cast_actions.filter(Boolean)
    fight_state_trace('flush_started', {
      background,
      move_count: move_actions.length,
      cast_count: resolved_casts.length,
      dropped,
    })
    const ok = await commit_turn(actions, { background }) // reconciles to committed chain (crit lands here)
    // ④+⑦b: the store's durable my_traps is the ONE trap home — a trap whose cast never reached the chain (dropped,
    // or a failed commit) is taken back by cell through drop_traps; render + cast-legality read the same fold.
    const store_dropped = ok ? trap_dropped : [...trap_placed, ...trap_dropped]
    if (fight?.fight_id && store_dropped.length)
      fight_store.getState().input({ type: 'drop_traps', cells: store_dropped })
    fight_state_trace('flush_finished', { background, ok })
    // NO SILENT FAILURE (#922): a refused commit throws the whole drafted turn away, and until now the ONLY tell
    // was this trace line's `ok:false` — which is off unless fight-state tracing is armed. The simulator's silent
    // END-TURN loop is exactly what that costs. One honest log per refusal, on every composition; the store door
    // that refused (chain tx or sim shim) still owns the WHY and its own toast.
    if (!ok)
      game_log('board', 'commit refused — the drafted turn was rolled back', {
        background,
        move_count: move_actions.length,
        cast_count: resolved_casts.length,
      })
    // FIX 4: stamp each committed SPELL cast (kind:1) onto the cooldown clock at the turn it cast (my_turn_no) —
    // mirrors enforce_and_record_cast recording only casts that LANDED (a dropped/weapon action records nothing).
    if (ok) {
      const cast_turns = /** @type {Record<string, number>} */ ({})
      for (const a of resolved_casts) if (a.kind === 1 && a.spell_key) cast_turns[a.spell_key] = my_turn_no
      if (entity_id && Object.keys(cast_turns).length) record_cast_turns(entity_id, cast_turns)
    }
    clear_picks()
    // FIX 2 (overrules D97 silence): a flush-time cast DROP surfaces ONE honest event toast — the moves
    // committed, the spell did not (its target went stale). Only on a SUCCESSFUL commit; a FAILED commit already
    // surfaces its own single toast (manual via tx_commit_turn, background via commit_turn's catch below).
    // The named out-of-reach toast has exactly one input: a genuine local cast-drop record from drop_entry above,
    // consumed only after the surviving batch commits. Accepted events and claim retirement stay state-only.
    emit_local_cast_drop_toast({
      commit_succeeded: ok,
      drops: cast_drops,
      local_actor_id: entity_id,
      t,
      emit: push_event_toast,
    })
    const stale_spell_names = cast_drops
      .filter((drop) => drop.reason === CAST_DROP_STALE_TARGET)
      .map((drop) => drop.spell_name)
    if (ok && stale_spell_names.length > 0)
      push_event_toast({
        state: 'info',
        title: t('dungeons.cast_dropped_stale', { spell: stale_spell_names.join(', ') }),
      })
    fight_store.getState().input({ type: 'clear_staged' })
    return ok
  }
  // The reducer owns deadline/kill/busy/latch decisions. This is the ONE remaining effect: claim the derived
  // false→true edge once for the playable turn, read the draft live, and submit the existing background commit.
  // #605: an idle (zero-draft) due commit is NEVER a no-op — an empty batch is the exact legal bare pass
  // on_end_turn already sends with nothing staged (turn_commit.js's auto_commit_decision docblock: "a ZERO-draft
  // turn still fires ... to trigger mob actions"); skipping it left an armed turn timer hanging past its
  // deadline until the player clicked End Turn themselves — the one path this edge exists to replace.
  auto_submit_ref.current = () => {
    const { draft_actions, move_path: mp, cast_path: cq } = staged_turn_paths(fight_store)
    fight_state_trace('auto_flush_fired', { move_count: mp.length, cast_count: cq.length })
    return flush_commit(draft_actions, true)
  }
  useEffect(
    () =>
      subscribe_commit_due(fight_store, {
        submit: () => auto_submit_ref.current?.(),
        on_error: (error) => {
          fight_state_trace('auto_flush_edge_error', { message: String(error?.message ?? error) })
          game_log('board', 'auto-commit edge failed', error)
        },
      }),
    []
  )
  useEffect(
    () =>
      subscribe_divergence(fight_store, {
        on_divergence: (divergence) => {
          game_log('board', 'fight prediction diverged; authoritative action adopted', divergence)
        },
      }),
    []
  )
  // The reducer surfaces a drafted turn that expired uncommitted as `turn_lost`; consume and trace that edge
  // exactly once per turn (reducer-owned `shown` consumption — remount-safe), without announcing an auto-pass.
  useEffect(
    () =>
      subscribe_turn_lost(fight_store, {
        on_lost: ({ reason }) => {
          fight_state_trace('turn_lost_toast', { reason })
        },
      }),
    []
  )

  return flush_commit
}
