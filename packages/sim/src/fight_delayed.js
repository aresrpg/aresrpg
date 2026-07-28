// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Linked raw-787 payloads live on their bearer and fire at that bearer's turn start after exactly N starts.
// Their original source supplies stats even if dead; removal precedes dispatch so a payload cannot re-enter.

import { find_entity, update_entity } from './fight_state.js'
import { apply_spell_effect } from './fight_spells.js'
import { crank_damage_roll } from './turn_seed.js'
import { turn_rng_of } from './combat_clock.js'

/** Resolve due timed payload rows before ordinary turn-start status decay. */
export const process_delayed_payloads = (state, entity_id) => {
  const bearer = find_entity(state, entity_id)
  if (!bearer) return { state, effects: [] }
  const due = bearer.effects.filter(
    effect => effect.type === 'TIMED_PAYLOAD' && effect.turns_remaining <= 1,
  )
  if (due.length === 0) return { state, effects: [] }
  const cleared = update_entity(state, entity_id, entity => ({
    ...entity,
    effects: entity.effects.filter(effect => !due.includes(effect)),
  }))
  return due.reduce(
    (outer, row) => {
      const source = find_entity(outer.state, row.source_id)
      const target = find_entity(outer.state, entity_id)
      if (!source || !target) return outer
      return (row.payload ?? []).reduce((inner, effect) => {
        const applied = apply_spell_effect(
          inner.state,
          effect,
          source,
          entity_id,
          target.cell,
          () => true,
          { spell_id: row.spell_id ?? '', stack_target_id: entity_id },
          crank_damage_roll(turn_rng_of(inner.state)), // #577 — deferred payload reads the explicit turn thread
        )
        return {
          state: applied.state,
          effects: [...inner.effects, ...applied.effects],
        }
      }, outer)
    },
    {
      state: cleared,
      effects:
        /** @type {import('./fight_spells.js').SpellCastEffect[]} */ ([]),
    },
  )
}
