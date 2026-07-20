// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// In-fight ARMED-SPELL READOUT (canon/14) — the compact bottom-left card shown while the local player has a
// spell armed (drag-and-drop aiming). It REUSES the shared DECK-B `SpellDetail` panel (the SAME schema the
// out-of-fight deck builder renders) so the in-fight readout never drifts from combat truth — the "compact
// mode" is pure CSS scoped under `.fight-readout` (see fight-targeting.css), so SpellDetail itself is
// untouched. The board telegraph (range / AOE / cursor / reticles / damage preview) lives in the imperative
// Three layer (fight-targeting.js); this is the matching DOM readout + a one-line aiming hint.
//
// The under-cursor hint ("Drop on a cell to cast") is already provided by the grabbed-card ghost
// (DeckCluster.GrabbedCard), so this card carries the spell facts + a short in-card hint rather than a
// second floating hint (no-clutter law).

import { use_fight_view } from '../../store.js'
import { spell_card } from '../../core/modules/fight.js'

import { SpellDetail } from './SpellDetail.jsx'
import './fight-targeting.css'

/**
 * The armed-spell readout. Renders only while the LOCAL player has a spell armed on their own turn; null
 * otherwise (spectators never arm; off-turn the deck cannot be grabbed). Self-gating off the fight slice.
 */
export function FightArmedReadout() {
  const fight = use_fight_view() // synchronous core view (S2 mirror kill)
  const armed = fight?.armed_spell_id ?? null
  const my_turn =
    !!fight &&
    fight.active_entity_id === fight.my_entity_id &&
    fight.winner === -1 &&
    !fight.placement

  if (!fight || !armed || !my_turn) return null

  const card = spell_card(armed)

  return (
    <div className="fight-readout" aria-hidden="true">
      <SpellDetail spell_id={armed} />
      <div className="fight-readout__hint">
        Targeting <b>{card.name}</b> · pick a cell in range
      </div>
    </div>
  )
}
