// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DungeonBoard's turn/fight lifecycle synchronization and terminal auto-claim effects. Split out of
// DungeonBoard.jsx (issue #2069); the section is unchanged.
import { useEffect, useMemo, useRef } from 'react'

import { fight_store } from '@aresrpg/fight/store'

/**
 * Keep the fight hand/draft clocks synchronized and fire terminal claims.
 */
export function use_dungeon_board_lifecycle(state) {
  const {
    clear_picks,
    fight,
    reset_cast_clock,
    placement_pick,
    seeded_pick,
    entity_id,
    set_placement_pick,
    move_path,
    cast_target,
    my_spells,
    dungeon,
    busy,
    claim,
  } = state

  // A turn boundary invalidates any pending LOCAL draft (the use_dungeon_turn move/cast picks — the core's own
  // optimistic intents self-purge on the next authoritative receipt, fight-intents.js's manual clear is gone).
  // KEY ON THE REAL BOUNDARY (active_entity_id AND turn_deadline_ms — the SAME `active_id@deadline` key
  // sync_engine's fightTurnStart uses): in a SOLO fight (or any mob cascade resolved within a poll window)
  // control returns to the SAME player, so active_entity_id ALONE never changes — the old single-dep effect
  // then never fired, so the previous turn's move draft re-committed a move to my own (now-occupied) cell →
  // on-chain abort 104. The fresh deadline the chain stamps on every landing is the one signal that flips on a
  // same-player new turn.
  useEffect(() => {
    clear_picks()
  }, [fight?.active_entity_id, fight?.turn_deadline_ms])

  // FIX 4: a fresh Fight (a new room mints a new on-chain fight_id) means fresh on-chain cast history — clear the
  // lifted last_cast_turn record explicitly (the store outlives this component, so remount can no longer do it).
  // my_turn_no needs no reset here: it lives in the fight core and zeroes on the new Fight's session init.
  useEffect(() => {
    if (!fight?.fight_id) return
    reset_cast_clock()
  }, [fight?.fight_id])

  // D108/D109: entering placement with NO explicit pick, default the pick to the seeded cell so frame 1 READY is
  // enabled. A real pick supersedes it. [GAP] the pre-Ready visual pin (fight-intents.js's placement_intent mask,
  // showing my model standing on the picked cell before READY's place_at commits) has no core equivalent yet —
  // the board renders the chain cell until place_at lands; flagged, not fixed (fight/ core is read-only here).
  useEffect(() => {
    if (placement_pick != null || seeded_pick == null || !entity_id) return
    set_placement_pick(seeded_pick)
  }, [seeded_pick, placement_pick, entity_id])

  // FightControls only needs the presentation flag; reducer ticks receive the exact live queue length separately.
  const has_draft = move_path.length > 0 || cast_target != null

  // ── DeckCluster hand = the character's REAL on-chain spells (resolve_class_spells), name_keys only. The bar
  //    renders EXACTLY these (unlock_level ≤ char level) — no stub, no empty slot, no locked card; a class with
  //    no seeded spells shows weapon + move only. Each card's cast stages ITS SpellTemplate object id (above).
  //    Dispatched via the SAME action fight.js folds; sync/turn_start never touch `hand`, so it persists. ──
  const hand_spells = useMemo(() => my_spells.map((sp) => sp.name_key), [my_spells])
  const hand_synced = useRef('')
  useEffect(() => {
    if (!entity_id) return
    const sync_key = `${entity_id}:${hand_spells.join(',')}`
    if (hand_synced.current === sync_key) return
    fight_store.getState().input({ type: 'hand_update', hand: hand_spells })
    hand_synced.current = sync_key
  }, [entity_id, hand_spells])

  const draft_character = useRef(null)
  useEffect(() => {
    if (!entity_id || draft_character.current === entity_id) return
    draft_character.current = entity_id
    clear_picks()
  }, [entity_id])

  // NOTE: the SILENT per-room claim (D37c #33) + the ROOM_CLEARED→plane return now live in dungeon_store.js
  // (refresh → _claim_cleared_room + teardown), because on ROOM_CLEARED this board UNMOUNTS (fight_mode drops so
  // the player free-roams the plane). The reward recap slides in as a NON-GATING panel (RewardRecap.jsx).

  // TERMINAL auto-claim: fires on CLIENT-KNOWABLE, receipt-proven fight-over (`decided_winner`) so a lagged
  // settle can never dead-air a won fight (shape ②, seat ruling 2026-07-19). claim() opens the card PENDING and
  // its background chain settles + fills the rewards — receipt-gated, a17c9fc stands (the card never fabricates
  // reward content). The receipt-confirmed terminal (`settlement_request`) still fires it and is consumed for the
  // settle machine's dedupe; `decided_winner` covers the window where the kill folded but the settle read lags.
  useEffect(() => {
    const request = dungeon?.settlement_request
    const decided = dungeon?.decided_winner ?? null // 0 = client-knowable victory (committed: every mob dead)
    // D6: skip the terminal auto-claim if the local player is NO LONGER escrowed — they ABANDONED (abandon_
    // dungeon removed the participant + already fired its own defeat recap). Auto-claiming then aborts on-chain
    // (claim_room_rewards on an uncleared/unowned room) → the misleading "Claiming rewards failed" toast that
    // also blocked the hp=0 reconcile onto the defeat card. Only a genuine WON / wipe-FAILED (still escrowed)
    // has rewards to claim.
    const still_escrowed =
      !!entity_id && (dungeon?.escrow ?? []).some((p) => (p.character ?? p.character_id) === entity_id)
    if ((!request && decided == null) || !still_escrowed || busy) return
    // D132: claim() OWNS the terminal mint in its background chain (W1/D116). The old follow-up mint_loot()
    // here was the SECOND mint path — on a defeat it raced claim's own mint into "fail to mint reward"
    // toast duplication (no PendingLoot exists on a loss). One flow, one home: the call dies. claim()'s own
    // `_claiming` single-flight makes a repeat fire from this level-triggered gate a harmless no-op.
    void claim()
    if (request) fight_store.getState().input({ type: 'settlement_request_consumed', signal: request.signal })
  }, [dungeon?.settlement_request?.signal, dungeon?.decided_winner, busy])

  return has_draft
}
