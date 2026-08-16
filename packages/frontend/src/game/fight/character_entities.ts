// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Character truth to the engine's shared entity contract. No Three.js object crosses this boundary.

import type { CharacterEntityRender, WornModelRender } from '@aresrpg/engine'

import { load_character_model_urls, load_cosmetic_model_url } from '../../content/character_models.ts'
import { encyclopedia_catalog } from '../../content/catalog.ts'

import type { FightCharacterRenderSource } from './character_entity_sources.ts'

export {
  character_entity_sources,
  fight_character_entity_sources,
  type FightCharacterAppearance,
  type FightCharacterRenderSource,
} from './character_entity_sources.ts'

const worn_model = async (
  item_type: string | undefined,
  category: 'hat' | 'cloak'
): Promise<WornModelRender | null> => {
  if (!item_type) return null
  const item = encyclopedia_catalog.items.find((candidate) => candidate.item_type === item_type)
  return item?.category === category ? load_cosmetic_model_url(item) : null
}

const resolved_character_entity = async (source: FightCharacterRenderSource): Promise<CharacterEntityRender> => {
  const [{ body_url, hair_url }, head, back] = await Promise.all([
    load_character_model_urls(source.classe, source.male),
    worn_model(source.loadout.hat, 'hat'),
    worn_model(source.loadout.cloak, 'cloak'),
  ])
  return Object.freeze({
    id: source.id,
    kind: 'character',
    appearance: Object.freeze({
      body_url,
      hair_url,
      colors: source.colors,
      worn: Object.freeze({ head, back }),
    }),
    anchor: Object.freeze({ kind: 'fight_cell', cell: source.cell }),
    facing: Object.freeze({ kind: 'fight_opponents', side: source.side }),
  })
}

export const load_fight_character_entities = async (
  sources: readonly FightCharacterRenderSource[]
): Promise<readonly CharacterEntityRender[]> => Object.freeze(await Promise.all(sources.map(resolved_character_entity)))
