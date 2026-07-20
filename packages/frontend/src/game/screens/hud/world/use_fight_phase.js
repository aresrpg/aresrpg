// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// W4 — the React bridge to the pure phase machine (fight-engine/phase.js). Components are READ-ONLY
// subscribers: this hook folds the live dungeon read + the engine fight slice + my seat into the derived
// { phase, unmet, outcome } and hands it to the mount decisions. No component writes fight state — they ask
// the machine "what should be on screen" and render. Subscribes to the minimal fields so a re-derive happens
// exactly when an input the machine reads changes (not every unrelated store tick).

import { useMemo } from 'react'

import { use_fight_view } from '../../../store.js'
import { use_dungeon } from '../../../../world-shell/dungeon_store.js'
import { derive_phase } from '../../../../fight-engine/phase.js'

/**
 * Derive the current fight phase for the live dungeon session. Pure view-derivation — never writes.
 * `my_seat` is the selected controlled character's escrow participant, resolved once
 * here so the machine never re-derives identity (single source of truth, mirrors DungeonBoard's own `me`).
 * @returns {import('../../../../fight-engine/phase.js').PhaseResult}
 */
export function use_fight_phase() {
  const dungeon = use_dungeon(s => s.dungeon)
  const fight = use_fight_view() // SYNCHRONOUS core view (S2 mirror kill) — the phase machine never lags a dispatch
  const character_id = fight?.my_entity_id ?? null
  const my_seat = useMemo(
    () =>
      character_id
        ? (dungeon?.escrow?.find(p => (p.character ?? p.character_id) === character_id) ?? null)
        : null,
    [dungeon, character_id],
  )
  return useMemo(() => derive_phase(dungeon, fight, my_seat), [dungeon, fight, my_seat])
}
