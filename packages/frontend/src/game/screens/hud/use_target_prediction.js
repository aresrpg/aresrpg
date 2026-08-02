// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// LIVE cast-prediction hook for the board-hover tooltip — show exactly what will happen: damage
// taken, critical chance, effects, kill. Thin store wiring only: it reads the three live slices — the fight view
// (armed spell + fighters), the hovered id, the dungeon escrow — and hands them to the STORE-FREE core
// (target_prediction_core.js), memoized on the aim so the sim re-runs only when the aim actually changes, never
// per frame. It is a pure READ (the one-pipeline law): never an async callback that set()s a store.

import { useMemo } from 'react'

import { my_action_slot } from '@aresrpg/fight/project'

import { useFight, useFightView, useGameState } from '../../store.js'
import { use_dungeon } from '../../../world-shell/dungeon_store.js'
import { compute_target_prediction, prediction_memo_key } from './target_prediction_core.js'

// re-export so existing importers keep resolving these from here too.
export { compute_target_prediction, resolve_dungeon_ref } from './target_prediction_core.js'

/**
 * The live prediction of the armed spell on the hovered target — the SINGLE resolved outcome (crit or not is a
 * seed-deterministic fact), its is_crit flag, the target ref, and the spell's secondary effect rows. The core
 * prices the pending cast's crit SLOT off the fight store's own journal (#1224 — my drafted casts ride it as
 * intents), exactly like the DeckCluster socket glow. Memoized on `prediction_memo_key` — the core's OWN statement
 * of what this preview depends on, never a list re-assembled here.
 * @returns {ReturnType<typeof compute_target_prediction>}
 */
export const useTargetPrediction = () => {
  const fight = useFightView()
  const hover = useGameState((state) => state.fight_hover)
  const dungeon = use_dungeon((state) => state.dungeon)
  // The slot, not a proxy for it: a scalar off the ONE derivation, so the memo re-runs on exactly the folds
  // that change this preview (a drafted cast, a landed receipt, my turn restarting) and on no other.
  const slot = useFight(my_action_slot)

  const args = { fight, hover, dungeon, slot }
  // ONE derivation, ONE key: the memo key comes from the same module as the derivation and is built from the same
  // args object, so an input the preview reads can never be missing from the key it re-runs on.
  // (react-hooks exhaustive-deps is not registered on this tree, so no disable directive — it would error.)
  return useMemo(() => compute_target_prediction(args), prediction_memo_key(args))
}
