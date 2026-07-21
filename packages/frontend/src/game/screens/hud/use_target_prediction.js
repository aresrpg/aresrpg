// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// LIVE cast-prediction hook for the board-hover tooltip — show exactly what will happen: damage
// taken, critical chance, effects, kill. Thin store wiring only: it reads the three live slices — the fight view
// (armed spell + fighters), the hovered id, the dungeon escrow — and hands them to the STORE-FREE core
// (target_prediction_core.js), memoized on the aim so the sim re-runs only when the aim actually changes, never
// per frame. It is a pure READ (the one-pipeline law): never an async callback that set()s a store.

import { useMemo } from 'react'

import { encode } from '@aresrpg/fight/los'

import { use_fight_view, use_game_state } from '../../store.js'
import { use_dungeon } from '../../../world-shell/dungeon_store.js'
import { use_dungeon_turn } from '../dungeon-turn.js'
import { compute_target_prediction } from './target_prediction_core.js'

// re-export so existing importers keep resolving these from here too.
export { compute_target_prediction, resolve_dungeon_ref } from './target_prediction_core.js'

/**
 * The live prediction of the armed spell on the hovered target — the SINGLE resolved outcome (crit or not is a
 * seed-deterministic fact), its is_crit flag, the target ref, and the spell's secondary effect rows. `draft_len`
 * (the AP-queue's queued-cast count) rides in so the pending cast's crit SLOT advances with the draft, exactly
 * like the DeckCluster socket glow. Memoized on the armed id / caster / hovered target (+ its encoded cell & hp) /
 * the dungeon identity / the draft length.
 * @returns {ReturnType<typeof compute_target_prediction>}
 */
export const use_target_prediction = () => {
  const fight = use_fight_view()
  const hover = use_game_state((state) => state.fight_hover)
  const dungeon = use_dungeon((state) => state.dungeon)
  const draft_len = use_dungeon_turn((state) => state.cast_path.length)

  const armed = fight?.armed_spell_id ?? null
  const caster_id = fight?.my_entity_id ?? null
  const hovered_id = hover?.entity_id ?? null
  const target = fight && hovered_id ? fight.fighters.get(hovered_id) : null
  const target_key = target?.cell ? encode(target.cell.x, target.cell.y) : null
  const target_hp = target?.health ?? null

  return useMemo(
    () => compute_target_prediction({ fight, hover, dungeon, draft_len }),
    // `fight` is intentionally read live inside the core but excluded from deps: recomputing on every fold would
    // re-run the sim each frame. The aim primitives below capture every change that alters THIS preview — including
    // `draft_len`, since queuing a cast advances the pending cast's crit slot (the roll can flip crit↔non-crit).
    // (react-hooks exhaustive-deps is not registered on this tree, so no disable directive — it would error.)
    [armed, caster_id, hovered_id, target_key, target_hp, dungeon, draft_len]
  )
}
