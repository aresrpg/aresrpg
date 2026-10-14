// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Engine-side execution of plain fight cues. Combat ordering stays in the game presenter;
// this layer owns only pixels and model animation.

import type { create_entity_layer } from './entities.ts'
import type { create_transient_effects } from './transient_effects.ts'
import type { create_spell_effect_layer } from './spell_effect_layer.ts'
import { spell_effect_timing } from './spell_effect_recipe.ts'
import type { FightPresentationCue } from './types.ts'

type EntityLayer = ReturnType<typeof create_entity_layer>
type TransientEffects = ReturnType<typeof create_transient_effects>

export const create_fight_presentation = ({
  entities,
  vfx,
  shock = () => {},
  spells,
}: Readonly<{
  entities: EntityLayer
  vfx: TransientEffects
  shock?: () => void
  spells?: ReturnType<typeof create_spell_effect_layer>
}>) => {
  const play_cast = (cue: Extract<FightPresentationCue, { type: 'cast' }>): Promise<boolean> => {
    entities.face_cell(cue.caster_id, cue.target_cell)
    void entities.beat(cue.caster_id, 'attack', undefined, false, cue.effect?.preset.cast)
    return cue.effect && spells ? spells.play(cue) : vfx.play_cast(cue)
  }
  const play_zone = async (cue: Extract<FightPresentationCue, { type: 'zone' }>): Promise<boolean> => {
    const played = await (cue.effect && spells ? spells.play_zone(cue) : vfx.play_zone(cue))
    if (!played) return false
    await Promise.all((cue.affected_ids ?? []).map((id) => entities.beat(id, 'hit', cue.owner_id)))
    return true
  }
  return Object.freeze({
    prepare: async (cue: FightPresentationCue): Promise<FightPresentationCue> => {
      if ((cue.type !== 'cast' && cue.type !== 'zone') || !cue.effect || !spells) return cue
      const release_time = cue.type === 'cast' ? entities.prepare_attack(cue.caster_id) : Promise.resolve(0)
      const [release] = await Promise.all([release_time, spells.prepare(cue.effect.atlas_urls)])
      return Object.freeze({
        ...cue,
        effect: Object.freeze({ ...cue.effect, timing: spell_effect_timing(cue.effect, release) }),
      })
    },
    play: async (cue: FightPresentationCue): Promise<boolean> => {
      // The presenter reports completion only after this promise settles.
      // Combat and checkpoint state remain outside the renderer.
      if (['turn', 'visibility', 'status'].includes(cue.type)) return true
      if (cue.type === 'cast') return play_cast(cue)
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
      if (cue.type === 'zone') return play_zone(cue)
      return true
    },
  })
}
