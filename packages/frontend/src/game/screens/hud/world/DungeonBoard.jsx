// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// board #13 — the on-chain dungeon's turn-INPUT bridge + status chrome. The BOARD ITSELF is the rich 3D
// renderer (fight-overlay.js + fight-board-render.js), mounted into the roam scene at DUNGEON_BOARD_ORIGIN.
// What lives HERE is the real on-chain wiring: the turn-draft (a cumulative move PATH + ≤1 cast, mirroring
// dungeon_turn.move's apply_move/apply_cast gates), the SINGLE commit_turn PTB (no separate on-chain end-turn — commit_turn applies
// the batch AND advances the turn), and the terminal/room state machine.
//
// UX (play-test priority #1: make it FEEL like a real game, chain invisible):
//  - INPUT: click an empty reachable cell = draft a MOVE; click / drag-a-spell-card onto a living mob in range
//    = draft a CAST. The pick is made by clicking the rich 3D board (roam raycast → fight-overlay click_cell /
//    a DeckCluster spell drop → drop_cell), relayed here via dungeon-turn.js. `on_cell_click` is the SAME
//    decision logic a flat grid used to call; only the input SOURCE changed. Picks are written back to that
//    store so fight-overlay highlights them on the 3D board (gold tile/ring) — one source of truth.
//  - CONTROLS: END TURN + FORFEIT are the reused sui-branch FightControls chrome, bottom-right. END TURN
//    commits the current draft (move+cast, possibly empty) via commit_turn; FORFEIT (S-80, actions::abandon)
//    dies in THIS fight — normal settlement still runs (loot still rolls). A SEPARATE "Leave dungeon" control
//    (only when a RunPass is live) consumes the RunPass directly (dungeon::abandon) instead — no death write, no
//    loot; it is the pre-S-80 door, kept honest and distinct alongside the new one (see on_leave_dungeon below).
//  - FIGHT-END IS SILENT + AUTOMATIC (never a "claim rewards" step). Clearing a room auto-fires
//    the per-room reward claim SILENTLY (zkLogin signs, no toast/modal); advancing auto-claims first (forfeit
//    impossible); WON/FAILED auto-fire the terminal claim → the Victory/Defeat summary card IS the receipt.
//  - The spell hand (DeckCluster) reads fight.hand; a dungeon has no on-chain spellbook, so we seed the hand
//    from the escrowed character's CLASS spells here (cosmetic — every cast commits the same generic cast).
//
// The existing sections live in sibling files (split for the 600-LoC house budget, issue #2069):
// DungeonBoardState owns store reads + targeting, DungeonBoardCommit owns turn validation/submission,
// DungeonBoardInput owns optimistic board input, DungeonBoardLifecycle owns synchronization/settlement,
// and DungeonBoardControls owns the status chrome. This file remains the thin composition root.

import { useTranslation } from 'react-i18next'

import { useGameState, useFightView } from '../../../store.js'
import { useSpellCorpus } from '../../../data/use_spell_corpus.js'
import { use_expedition, STATUS_ACTIVE as EXPEDITION_ACTIVE } from '../../../../roster/store'
import { seat_character } from '../../../../world-shell/seat_character.js'
import {
  cast_requires_occupant,
  fight_spell_template,
  resolve_class_spells,
  seat_spell_level,
  seat_spell_row,
} from '../fight-spells.js'
import { push_event_toast } from '../../../core/toast.js'
import { WEAPON_ATTACK_ID, WEAPON_ATTACK_RANGE, WEAPON_ATTACK_AP } from '../../../core/modules/fight.js'
import { use_dungeon } from '../../../../world-shell/dungeon_store.js'
import {
  compose_staged_turn,
  subscribe_commit_due,
  subscribe_divergence,
  subscribe_turn_lost,
  staged_turn_paths,
} from '@aresrpg/fight/txs'
import { fight_store } from '@aresrpg/fight/store'
import {
  committed_truth,
  fight_view,
  mob_entity_id,
  mob_entity_index,
  my_action_slot,
  next_move_tackle,
} from '@aresrpg/fight/project'
import {
  CAST_DROP_STALE_TARGET,
  CAST_DROP_TARGET_OUT_OF_REACH,
  local_commit_cast_drop,
  strike_flush_illegal,
} from '@aresrpg/fight/turn_commit'
import { retarget_cast } from '@aresrpg/fight/txs'
import { synthetic_tackled_events, local_intent_beats, local_move_beats } from '@aresrpg/fight/present'
import {
  crit_clock_of,
  predict_cast,
  weapon_spell_template,
  evolve_flush_casts,
  evolve_caster_cell,
  evolve_draft_health,
} from '@aresrpg/fight/predict_cast'
import { cast_range_set_dungeon, move_plan_dungeon } from '../../../../fight-engine/overlay_intents.js' // D139: cast_range_set_dungeon = THE cast-legality home (P1 self-cast)
import { character_cast_clock, use_dungeon_turn } from '../../dungeon-turn.js'
import { encode, decode, manhattan, lineOfSight, bfsReachable } from '@aresrpg/fight/los'
import { occupancy_of, visible_occupant_cells } from '@aresrpg/fight/occupancy'
import { dungeon_grid_of } from '../../dungeon-grid.js'
import { presentation_blocked_cells } from '../../../../world-shell/fight_board_blockers.js'
import { on_cooldown, cooldown_left, target_cap_reached, cap_of } from '@aresrpg/fight/draft_budget'
import { FightControls } from '../FightControls.jsx'
import { ConfirmDialog } from './ConfirmDialog.jsx'
import { useFightPhase } from './use_fight_phase.js'
import { is_active as phase_is_active, is_placement as phase_is_placement } from '../../../../fight-engine/phase.js'
import { useDungeonBoardState } from './DungeonBoardState.jsx'
import { useDungeonBoardCommit } from './DungeonBoardCommit.jsx'
import { useDungeonBoardInput } from './DungeonBoardInput.jsx'
import { useDungeonBoardLifecycle } from './DungeonBoardLifecycle.jsx'
import { DungeonBoardControls } from './DungeonBoardControls.jsx'
import './dungeon-board.css'

/** @returns {import('react').ReactElement | null} */
export function DungeonBoard() {
  const { t } = useTranslation()
  const state = useDungeonBoardState()
  const flush_commit = useDungeonBoardCommit(state, t)
  useDungeonBoardInput(state, t)
  const has_draft = useDungeonBoardLifecycle(state)

  const {
    phase,
    dungeon,
    busy,
    abandon,
    run_pass_id,
    fight,
    leave_confirm,
    set_leave_confirm,
    effective_pick,
    place_at_cell,
  } = state

  if (!dungeon || !fight) return null

  // END TURN = flush the current draft (move + cast); an EMPTY commit is a legal "end turn" on-chain (commit_turn
  // applies the batch AND advances the turn — dungeon_turn.move allows zero actions). Reads the LIVE draft.
  const on_end_turn = () => {
    const { draft_actions } = staged_turn_paths(fight_store)
    // The commit_turn store door catches submission failures and owns their player feedback.
    void flush_commit(draft_actions)
  }

  // LEAVE DUNGEON (the RUN door, dungeon::abandon): open the in-app confirm modal (never a native dialog). The
  // confirm handler runs the RUN abandon → the defeat end-card (dungeon_store.abandon → open_fight_recap) when
  // it catches a fight I was actually seated in, so a give-up is a SEEN defeat, not a silent dump. DISTINCT from
  // the FIGHT-forfeit door FightControls now owns itself (actions::abandon — dies in-fight, settles normally).
  const on_leave_dungeon = () => {
    if (busy) return
    set_leave_confirm(true)
  }
  const on_leave_dungeon_confirmed = async () => {
    set_leave_confirm(false)
    await abandon()
  }

  // D66 READY — commit the LOCAL placement pick with the ONE `place_at` tx (place + READY + auto-ACTIVE-when-all-
  // ready; solo flips instantly). The click was predict-only (no tx); this is the single confirmation. Guarded on
  // a live pick + not busy so a mis-fire before picking can't sign a bogus cell.
  const on_ready = () => {
    if (busy || effective_pick == null) return
    place_at_cell(effective_pick)
  }

  return (
    <DungeonBoardControls
      t={t}
      phase={phase}
      dungeon={dungeon}
      busy={busy}
      run_pass_id={run_pass_id}
      effective_pick={effective_pick}
      has_draft={has_draft}
      leave_confirm={leave_confirm}
      set_leave_confirm={set_leave_confirm}
      on_end_turn={on_end_turn}
      on_ready={on_ready}
      on_leave_dungeon={on_leave_dungeon}
      on_leave_dungeon_confirmed={on_leave_dungeon_confirmed}
    />
  )
}
