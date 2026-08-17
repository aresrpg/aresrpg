// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Engine-side execution of plain fight cues. Combat ordering stays in the game presenter;
// this layer owns only pixels and model animation.

import { fight_path_gait, type create_entity_layer } from './entities.ts'
import type { create_fight_vfx } from './fight_vfx.ts'
import type { FightPresentationCue } from './types.ts'

type EntityLayer = ReturnType<typeof create_entity_layer>
type FightVfx = ReturnType<typeof create_fight_vfx>

export const create_fight_presentation = ({ entities, vfx }: Readonly<{ entities: EntityLayer; vfx: FightVfx }>) =>
  Object.freeze({
    play: async (cue: FightPresentationCue): Promise<boolean> => {
      if (cue.type === 'cast') {
        void entities.beat(cue.caster_id, 'attack')
        return vfx.play_cast(cue)
      }
      if (cue.type === 'movement') {
        if (cue.mode === 'teleport' || cue.mode === 'swap' || cue.mode === 'place') return entities.snap(cue.entity_id)
        return entities.animate({
          id: cue.entity_id,
          cells: cue.cells,
          gait: cue.mode === 'walk' ? fight_path_gait(cue.cells.length) : 'run',
        })
      }
      if (cue.type === 'damage') return entities.beat(cue.target_id, 'hit', cue.source_id, cue.critical)
      if (cue.type === 'heal') return entities.beat(cue.target_id, 'heal', cue.source_id)
      if (cue.type === 'death') {
        vfx.play_death(cue)
        return entities.beat(cue.entity_id, 'death', cue.source_id)
      }
      return true
    },
  })
