// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Engine-side execution of plain fight cues. Combat ordering stays in the game presenter;
// this layer owns only pixels and model animation.

import type { create_entity_layer } from './entities.ts'
import type { create_transient_effects } from './transient_effects.ts'
import type { FightPresentationCue } from './types.ts'

type EntityLayer = ReturnType<typeof create_entity_layer>
type TransientEffects = ReturnType<typeof create_transient_effects>

export const create_fight_presentation = ({
  entities,
  vfx,
  shock = () => {},
}: Readonly<{ entities: EntityLayer; vfx: TransientEffects; shock?: () => void }>) => {
  // The previous turn's on-screen floor: a mob turn holds the card for its chain-projected
  // minimum before the next turn cue may take over.
  let turn_shown_at = 0
  let turn_min_ms = 0
  return Object.freeze({
    play: async (cue: FightPresentationCue): Promise<boolean> => {
      if (cue.type === 'turn') {
        const remaining = turn_shown_at + turn_min_ms - performance.now()
        if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining))
        turn_shown_at = performance.now()
        turn_min_ms = cue.min_ms ?? 0
        return true
      }
      if (cue.type === 'cast') {
        entities.face_cell(cue.caster_id, cue.target_cell)
        void entities.beat(cue.caster_id, 'attack')
        return vfx.play_cast(cue)
      }
      if (cue.type === 'movement') {
        const moved =
          cue.mode === 'teleport' || cue.mode === 'swap' || cue.mode === 'place'
            ? entities.snap(cue.entity_id, cue.cells.at(-1))
            : await entities.animate({
                id: cue.entity_id,
                cells: cue.cells,
                gait: cue.gait,
              })
        if (cue.mp_spent > 0) vfx.play_float(cue.entity_id, -cue.mp_spent, 'mp')
        return moved
      }
      if (cue.type === 'damage') {
        // a critical shocks the whole board, whoever landed it
        if (cue.critical) shock()
        vfx.play_float(cue.target_id, cue.amount, cue.critical ? 'critical' : 'damage')
        return entities.beat(cue.target_id, 'hit', cue.source_id, cue.critical)
      }
      if (cue.type === 'heal') {
        vfx.play_float(cue.target_id, cue.amount, 'heal')
        return entities.beat(cue.target_id, 'heal', cue.source_id)
      }
      if (cue.type === 'death') {
        vfx.play_death(cue)
        return entities.beat(cue.entity_id, 'death', cue.source_id)
      }
      if (cue.type === 'tackle') {
        const played = await entities.beat(cue.entity_id, 'hit', cue.source_id)
        if (cue.mp_lost > 0) vfx.play_float(cue.entity_id, -cue.mp_lost, 'mp')
        if (cue.ap_lost > 0) vfx.play_float(cue.entity_id, -cue.ap_lost, 'ap')
        return played
      }
      if (cue.type === 'pool') {
        if (cue.ap !== 0) vfx.play_float(cue.entity_id, cue.ap, 'ap')
        if (cue.mp !== 0) vfx.play_float(cue.entity_id, cue.mp, 'mp')
        return true
      }
      if (cue.type === 'zone') {
        const played = await vfx.play_zone(cue)
        await Promise.all((cue.affected_ids ?? []).map((id) => entities.beat(id, 'hit', cue.owner_id)))
        return played
      }
      return true
    },
  })
}
