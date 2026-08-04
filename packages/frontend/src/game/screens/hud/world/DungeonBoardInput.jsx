// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DungeonBoard's optimistic move/cast prediction and rich-board click relay. Split out of
// DungeonBoard.jsx (issue #2069); the section is unchanged.
import { useEffect } from 'react'

import { push_event_toast } from '../../../core/toast.js'
import { WEAPON_ATTACK_ID } from '../../../core/modules/fight.js'
import { fight_store } from '@aresrpg/fight/store'
import { fight_view, mob_entity_id, my_action_slot, next_move_tackle } from '@aresrpg/fight/project'
import { synthetic_tackled_events, local_intent_beats, local_move_beats } from '@aresrpg/fight/present'
import { crit_clock_of, predict_cast, weapon_spell_template } from '@aresrpg/fight/predict_cast'
import { move_plan_dungeon } from '../../../../fight-engine/overlay_intents.js'
import { use_dungeon_turn } from '../../dungeon-turn.js'
import { decode } from '@aresrpg/fight/los'
import { presentation_blocked_cells } from '../../../../world-shell/fight_board_blockers.js'
import { target_cap_reached } from '@aresrpg/fight/draft_budget'
import { fight_spell_template, seat_spell_level } from '../fight-spells.js'

/**
 * Install the rich-board click relay and fold each legal pick optimistically.
 */
export function useDungeonBoardInput(state, t) {
  const {
    fight,
    entity_id,
    draft_caster_cell,
    armed_key,
    me,
    my_spells,
    dungeon,
    resolve_ref,
    my_turn,
    castable,
    active_spell,
    append_cast_step,
    armed_on_cd,
    armed_cd_left,
    cast_path,
    cpt_target_authored,
    remaining_ap,
    cast_params,
    reachable,
    optimistic_vacated,
    my_mp_eff,
    append_move_step,
    clicked_seq,
    clicked_cell,
    clicked_cast,
  } = state

  // OPTIMISTIC WALK (#39, D254 cumulative): the click IS the move — walk the active player NOW, from wherever
  // they're currently rendered (the chain start, or a previous draft cell) to the new LAST cell of the draft
  // path (or BACK toward the chain start when a step is undone). THE ONE DOOR (fight/store.js): the core paints
  // this as a LOCAL wave turn (prediction-first, natural durations) the instant it folds — replacing the old
  // fight-intents.js mask + packet/fightMoved dispatch. The on-chain 1.29 rule (each move charges its own
  // segment) is mirrored — every drafted step is one commit action.
  const optimistic_walk = (dest, plan) => {
    if (!fight.fighters.has(entity_id) || draft_caster_cell == null) return
    fight_store.getState().input({
      type: 'intent',
      intent: { kind: 'move', character: entity_id, to_cell: dest, mp_left: plan.mp_left },
      // The drafted path renders THIS frame; local_move_beats bridges it to the producer's move_path RESOLVER
      // contract (a raw array here is invoked as a function → the S2 "instance of Array" crash — regression-locked).
      beats: local_move_beats({
        fight_id: fight.fight_id,
        character: entity_id,
        to_cell: dest,
        path: plan.path.map(decode),
      }),
    })
  }

  // OPTIMISTIC CAST (P1): the chain-corpus template runs through @aresrpg/sim once. Its deterministic state delta
  // becomes one composite reducer input (Cast + all projection-supported outcomes + the shared sim render beats),
  // so subscribers can never observe a half-folded cast. Public turn-seed crits select the exact authored branch;
  // chance rows and B7's not-yet-deployed chain kinds remain cast-only until authoritative settlement.
  const optimistic_cast = (mob_cell) => {
    const queue = use_dungeon_turn.getState().cast_path
    const core = fight_store.getState()
    const spell_key = queue.at(-1)?.spell_key ?? armed_key ?? null
    const template =
      spell_key === WEAPON_ATTACK_ID ? weapon_spell_template(me?.weapon) : fight_spell_template(spell_key)
    // The RANK the chain will resolve this cast at, off the seat's composed build — never a defaulted 1. Stats
    // need no adapter: every fighter's locked snapshot rides the fight view itself (#1077), so this cast and the
    // authority that settles it run the same math on the same inputs.
    const spell_level =
      spell_key === WEAPON_ATTACK_ID ? 1 : seat_spell_level(me, my_spells.find((sp) => sp.name_key === spell_key))
    const prediction = predict_cast({
      view: fight_view(),
      caster_id: entity_id,
      spell: template,
      spell_level,
      target_cell: mob_cell,
      // The §7 clock through its ONE composer (#1190): the seat is MY escrow row's own `seat`, the same tuple the
      // socket glow and the tooltip preview roll — so a cast can never resolve against a sequence the player was
      // not shown. Its slot comes from the store's own fold (#1224): the casts already drafted this turn ride the
      // journal as intents and THIS one has not been folded yet, so the count is exact — no second store, no `- 1`.
      critical_clock: crit_clock_of({ fight: dungeon, seat_row: me, slot: my_action_slot(core) }),
      resolve_ref,
    })
    const refused = !prediction?.actions.length
    // REFUSAL IS RECONCILIATION DATA (#2152): the staged cast proves this local action expected prediction.
    // Preserve the sim's reason as an inert Cast claim so an authoritative Cast can use the SAME divergence
    // log family with `predicted:null`; it paints nothing and another seat's differently-keyed Cast cannot claim it.
    core.input({
      type: 'predicted',
      intent_id: `cast:${fight.fight_id}:${core.intent_seq}`,
      basis_version: core.applied_version + 1,
      actions: prediction?.actions ?? [],
      ...(refused
        ? {
            expected: { kind: 'cast', target_cell: mob_cell },
            refusal: prediction?.result?.error ?? true,
          }
        : {
            beats: prediction.beats,
            // ④+⑦b: fold any trap THIS cast places into the store's durable my_traps (the ONE client trap home) so a
            // same-turn push force-stops on it AND render + cast-legality read the same projection.
            place_traps: prediction.placed_traps ?? [],
            // fold any glyph THIS cast places into the store's durable my_glyphs (single home — the render reads the
            // engine_view projection directly, no overlay module) so the orange zone shows this frame and expires with it.
            place_glyphs: prediction.placed_glyphs ?? [],
          }),
    })
    if (refused) return
  }

  // THE TOLL'S FORFEIT (#239): when next_move_tackle says my next move fails its escape, the pools are bitten
  // BEFORE the walk. Predict the sim's EXACT outcome (fight_actions.apply_move failed escape = both pools
  // bitten, then the affordable prefix walks): the 'Tackled' action folds the forfeit THIS frame + the
  // hit-anim/pool-forfeit beat plays — the SAME action + producer the receipt uses, so the receipt's own
  // Tackled event CONFIRMS (version-purge → re-fold), never corrects. The displacement is the caller's: the
  // walk is folded separately, against the pool this forfeit already lowered.
  const predict_tackle = ({ ap_lost, mp_lost }) => {
    const runner_idx = dungeon.escrow.findIndex((p) => (p.character ?? p.character_id) === entity_id)
    if (runner_idx < 0) return
    fight_store.getState().input({
      type: 'intent',
      intent: { kind: 'Tackled', runner_is_mob: false, runner_idx, ap_lost, mp_lost },
      beats: local_intent_beats(
        synthetic_tackled_events({ fight_id: fight.fight_id, runner_is_mob: false, runner_idx, ap_lost, mp_lost }),
        {
          fight_id: fight.fight_id,
          resolve_fighter_id: ({ is_mob, idx, character }) =>
            character != null ? String(character) : is_mob ? mob_entity_id(idx) : entity_id,
        }
      ),
    })
  }

  // The pick decision (unchanged rules): a CAST wins over a move on a castable cell. `cast_only` (a spell
  // card dropped on the board) restricts the decision to the cast branch — a drop on a non-castable cell is
  // a no-op (the card returns to the hand), never a stray move pick. Every pick now ALSO fires its optimistic
  // execution (walk / cast) so the action resolves in a frame — never a yellow-draft-then-nothing (#39).
  const on_cell_click = (cell, cast_only) => {
    // A local optimistic draft (set_*_target + optimistic_*, zero tx) doesn't gate on the tx-`busy` flag — consistent
    // with the store's user-actions-proceed-during-busy design; commit_turn snapshots the draft at End-Turn so a
    // re-draft can't race it. my_turn alone gates (placement/entering have my_turn=false). [D242: busy was NOT the
    // "click doesn't move" root — that was placement-phase/coords confusion; the move-fires path is qa-verified.]
    if (!my_turn) return
    // ── S-12 §17.27: the equipped-WEAPON strike and every spell share ONE targeting model. A click on a CASTABLE
    //    cell drafts the strike/cast (optimistic beat now, act_weapon/act_cast at End Turn); a click OFF the
    //    targetable set DESELECTS the armed card (clicking outside a targetable cell unselects
    //    the spell, superseding the old D301 silent no-op). The WEAPON pins WEAPON_ATTACK_ID so flush_commit
    //    routes it to act_weapon; a spell pins its name_key. ──
    const armed = fight?.armed_spell_id ?? null
    // D1 CELL-EXACT TARGETING (only the cell hitbox counts): the old ±1 "snap to the unique castable
    // neighbour" tolerance is DEAD — its root cause (a pointer-DOWN-time projection against a still-orbiting
    // camera) was fixed at the engine (board_picking projects FRESH at UP-time), and the snap itself grew every
    // castable mob a 5-cell click region that swallowed the cells beside/behind it (the v30 "hitbox too big"
    // report) and hijacked the off-target deselect. A click is exactly its cell now.
    // D2: while ARMED, every board click is forwarded to the CORE with its castable verdict — the deselect rule
    // (armed ∧ ¬targetable ⇒ disarm) lives in the fight core (store 'board_click'), not here. The disarm never
    // touches the draft queue (queued strikes survive — flush still ships them).
    if (armed) fight_store.getState().input({ type: 'board_click', cell, targetable: castable.has(cell) })
    if (castable.has(cell)) {
      // §17.27 STACK: each affordable click on a castable cell drafts ONE MORE strike/cast. `castable` already
      // went EMPTY once the remaining AP can't afford another (or the casts_per_turn cap is hit), so a click only
      // reaches here while affordable — the optimistic beat is 1:1 with a committable action (no phantom beats, no
      // "mobs regain health"). Each entry pins its own spell_key. NO toggle-off on a re-click — that would forbid
      // the 2nd stacked strike; cancel is the off-target disarm below.
      const spell_key = armed === WEAPON_ATTACK_ID ? WEAPON_ATTACK_ID : (active_spell?.name_key ?? null)
      append_cast_step({ cell, spell_key })
      const drafted_spell = my_spells.find((spell) => spell.name_key === spell_key)
      fight_store.getState().input({
        type: 'stage',
        intent: {
          kind: spell_key === WEAPON_ATTACK_ID ? 2 : 1,
          target: cell,
          spell_key,
          ...(drafted_spell?.object_id ? { spell_template_id: drafted_spell.object_id } : {}),
        },
      })
      optimistic_cast(cell)
      return
    }
    if (cast_only) return
    // ARMED + a click OFF the targetable set: the CORE already disarmed (the board_click forward above —
    // 2026-07-17: clicking any non-targetable cell with a spell armed deselects it, now the store's one rule).
    // Queued strikes on real enemies SURVIVE the disarm (this block's own charter): the old
    // set_cast_target(null) here wiped the whole cast_path queue — flush ships it, so wiping it silently
    // cancelled every drafted strike. The KNOWN refusals keep a surface here: surface WHY (no silent no-op).
    if (armed) {
      if (armed !== WEAPON_ATTACK_ID && armed_on_cd)
        push_event_toast({ state: 'info', title: t('dungeons.spell_on_cooldown', { n: armed_cd_left }) })
      // #1045 A SPENT TARGET SAYS SO: an unlimited-per-turn spell with a per-TARGET cap (patient venom ships
      // casts_per_target 1) stays legitimately armable — every other cell is still legal — so the re-armed click
      // landed on a cell `castable` had dropped and vanished into the disarm. Name it with the copy the chain's
      // own ECastsPerTarget abort already ships (abort_copy.js 106), off the ONE per-target home.
      else if (armed !== WEAPON_ATTACK_ID && target_cap_reached(cast_path, armed_key, cell, cpt_target_authored))
        push_event_toast({ state: 'info', title: t('errors.cast_per_target_limit') })
      // #1215 THE SILENT DISARM NAMES ITSELF: every other refusal (not enough AP for another swing/cast, or the
      // cell just has no legal target — out of range, LOS-blocked, no living occupant) used to disarm and say
      // nothing, so the player re-armed and clicked again with no idea why (sword-refusal trace: re-armed 3×,
      // disarmed 3×, no toast). The gate already knows which — reuse the SAME copy the chain's own abort already
      // ships (abort_copy.js 101/115, 102/114), never a bespoke string.
      else if (remaining_ap < cast_params.ap_cost) push_event_toast({ state: 'info', title: t('errors.cast_no_ap') })
      else push_event_toast({ state: 'info', title: t('errors.cast_illegal_target') })
      return
    }
    // D254 cumulative move: each reachable click APPENDS a new SEGMENT from the last step (its own segment + BFS
    // cost); `reachable` re-anchors at the new last step with the remaining MP (0 MP → empty reach → movement ends).
    // ② RULING 2026-07-19 (a player must not be able to cancel their action to replay it — walk, place a trap,
    // then click on yourself, which rolled the action back): the old "click the last drafted step ⇒ pop" undo is GONE — after a
    // walk the last step IS the player's own rendered cell, so that branch turned a SELF-CLICK into a draft cancel (a
    // free cancel-and-replay that also ate the turn clock, feeding ③). Rollback of a draft is not a user gesture; a
    // click on your own cell is now an inert no-op (the anchor is excluded from `reachable`) and a drafted turn stands.
    if (reachable.has(cell)) {
      // #933: prove the exact existing BFS route + MP cost BEFORE any draft write. `reachable` and this plan use
      // the same blocker set and budget; a defensive mismatch remains the ruled silent non-event.
      const blocked = presentation_blocked_cells(dungeon, fight?.fighters, entity_id, optimistic_vacated)
      const plan = move_plan_dungeon(
        { cell: decode(draft_caster_cell) },
        decode(cell),
        { blocked, mp: my_mp_eff }
      )
      if (!plan) return
      // TOLL LAW (#239, replacing the v31 NO-WALK LAW): consult the SAME deterministic contest the commit path
      // enforces. A bitten move is a committed attempt that STILL WALKS — the chain rolls act_move(cell), fails
      // the escape, forfeits the failed fraction of both pools, and then walks the prefix the surviving MP
      // affords. `reachable` already budgeted this cell against the post-toll pool, so the whole plan lands and
      // the client folds BOTH halves: the forfeit + hit-anim THIS frame, and the walk. The receipt's own
      // Tackled + Moved events then CONFIRM (version-purge → re-fold), never correct.
      const bite = next_move_tackle(fight_store.getState())
      append_move_step(cell)
      fight_store.getState().input({ type: 'stage', intent: { kind: 0, target: cell, landed: true } })
      if (bite) predict_tackle(bite)
      optimistic_walk(cell, plan)
    }
  }

  // Relay: a click / spell-drop on the rich 3D board bumps `clicked_seq` — react to every bump (not the
  // cell value, so re-clicking the SAME cell to toggle it off still fires).
  useEffect(() => {
    if (clicked_seq === 0) return
    on_cell_click(clicked_cell, clicked_cast)
  }, [clicked_seq])
}
