// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// W4 — the React bridge to the pure phase machine (fight-engine/phase.js). Components are READ-ONLY
// subscribers: this hook folds the live dungeon read + the engine fight slice + my seat into the derived
// { phase, unmet, outcome } and hands it to the mount decisions. No component writes fight state — they ask
// the machine "what should be on screen" and render. Subscribes to the minimal fields so a re-derive happens
// exactly when an input the machine reads changes (not every unrelated store tick).
//
// #1993 — THIS FILE IS THE EPIC'S PROJECTION-BOUNDARY CARVE-OUT (arch_law.yml scope note), and what remains of
// it is named below: `my_seat` no longer re-resolves identity here, and the `dungeon` read is a stated residual.

import { useMemo } from 'react'

import { useFightVisibleEntities, useFightVisibleMount, useFightView } from '../../../store.js'
import { use_dungeon } from '../../../../world-shell/dungeon_store.js'
import { derive_phase } from '../../../../fight-engine/phase.js'

/**
 * Derive the current fight phase for the live dungeon session. Pure view-derivation — never writes.
 *
 * `my_seat` is MY seat's canonical identity row (#1993 WP3's roster identity book, reached through
 * `fight_visible_view.entities`). It used to be re-resolved HERE, by scanning `dungeon.escrow` for the row whose
 * character matched my entity id — the identity book's own rule, spelled a second time at a consumer, which is
 * the #1865 class this epic exists to close. It is the same escrow either way: `use_dungeon`'s `dungeon` has
 * exactly ONE non-null writer — the fight-store subscription that publishes `board_view(s)` into it
 * (dungeon_run_store.js) — so the scan reached the fight store's own `view.escrow` through a store-to-store
 * mirror — the very lag the line below refuses for the fight slice. `identity.seat` is the escrow index the book
 * assigned (null for a mob, and 0 is a real seat — hence the `!= null` gate, never truthiness).
 *
 * RESIDUAL (#1993): `dungeon` itself. `derive_phase` reconciles the chain dungeon's `status`/`id` against the
 * fight slice, and `fight_visible_view` publishes no dungeon-lifecycle fact — folding that status into the fight
 * core as a reducer input is the phase family's own fold-first change, which phase.js already declines to make
 * as a drive-by (its WP4 note). Until then this read stays, named rather than quietly inherited.
 * @returns {import('../../../../fight-engine/phase.js').PhaseResult}
 */
export function useFightPhase() {
  const dungeon = use_dungeon(s => s.dungeon)
  const fight = useFightView() // SYNCHRONOUS core view (S2 mirror kill) — the phase machine never lags a dispatch
  const { viewer } = useFightVisibleMount()
  const entities = useFightVisibleEntities()
  const identity = viewer.my_entity_id ? (entities[viewer.my_entity_id]?.identity ?? null) : null
  const my_seat = identity?.seat != null ? identity : null
  return useMemo(() => derive_phase(dungeon, fight, my_seat), [dungeon, fight, my_seat])
}
