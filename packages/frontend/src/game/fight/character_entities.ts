// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Character truth to the engine's shared entity contract. No Three.js object crosses this boundary.

import type { CharacterEntityRender } from '@aresrpg/engine'

import { load_character_appearance } from '../character_entities.ts'

import type { FightCharacterRenderSource } from './character_entity_sources.ts'

export {
  character_entity_sources,
  fight_character_entity_sources,
  type FightCharacterAppearance,
  type FightCharacterRenderSource,
} from './character_entity_sources.ts'

const resolved_character_entity = async (source: FightCharacterRenderSource): Promise<CharacterEntityRender> => {
  return Object.freeze({
    id: source.id,
    kind: 'character',
    appearance: await load_character_appearance(source),
    anchor: Object.freeze({ kind: 'fight_cell', cell: source.cell }),
    facing: Object.freeze({ kind: 'fight_opponents', side: source.side }),
    ...(source.visual_effect ? { visual_effect: source.visual_effect } : {}),
  })
}

/** Cell and visibility are live fight truth; appearance is immutable for the fight. Reproject
 * those live fields synchronously so a late appearance promise can never restore an old cell. */
export const fight_character_entities_from_loaded = (
  sources: readonly FightCharacterRenderSource[],
  loaded: readonly CharacterEntityRender[]
): readonly CharacterEntityRender[] => {
  const appearances = new Map(loaded.map(({ id, appearance }) => [id, appearance]))
  return Object.freeze(
    sources.flatMap((source) => {
      const appearance = appearances.get(source.id)
      return appearance
        ? [
            Object.freeze({
              id: source.id,
              kind: 'character' as const,
              appearance,
              anchor: Object.freeze({ kind: 'fight_cell' as const, cell: source.cell }),
              facing: Object.freeze({ kind: 'fight_opponents' as const, side: source.side }),
              ...(source.visual_effect ? { visual_effect: source.visual_effect } : {}),
            }),
          ]
        : []
    })
  )
}

export const load_fight_character_entities = async (
  sources: readonly FightCharacterRenderSource[]
): Promise<readonly CharacterEntityRender[]> => Object.freeze(await Promise.all(sources.map(resolved_character_entity)))
