// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { create_character_source, type PlayerSource } from '@aresrpg/fight'
import { is_class_name, worn_appearance } from '@aresrpg/immutable'
import type { CharacterRow } from '@aresrpg/protocol'

import { encyclopedia_catalog } from '../content/catalog.ts'
import { read_app_state } from '../store.ts'

export const practice_character_source = (character: Readonly<CharacterRow>): PlayerSource => {
  const weapon = character.equipment.find(({ slot }) => slot === 'weapon')
  const template = weapon ? encyclopedia_catalog.item(weapon.item_type)?.item : null
  return create_character_source({
    ...character,
    level: BigInt(character.level),
    experience: BigInt(character.experience),
    vitality: BigInt(character.vitality),
    wisdom: BigInt(character.wisdom),
    strength: BigInt(character.strength),
    intelligence: BigInt(character.intelligence),
    chance: BigInt(character.chance),
    agility: BigInt(character.agility),
    spell_levels: Object.fromEntries(Object.entries(character.spells).map(([name, level]) => [name, BigInt(level)])),
    folded_stats: Object.fromEntries(
      Object.entries(character.folded_stats ?? {}).map(([name, value]) => [name, BigInt(value)])
    ),
    ...worn_appearance(Object.fromEntries(character.equipment.map(({ slot, item_type }) => [slot, item_type]))),
    weapon: template
      ? {
          category: template.category,
          damages: (template.damages ?? []).map(({ element, from, to }) => ({
            element,
            from: BigInt(from),
            to: BigInt(to),
          })),
        }
      : null,
  })
}

export const open_practice = (character: Readonly<CharacterRow>): void => {
  const { session, external_wallet } = read_app_state()
  if ([session.wallet, external_wallet.session].some((wallet) => wallet && !wallet.is_transaction_idle())) return
  // A full document boot selects only local observers. History carries a disposable, unsigned snapshot.
  globalThis.history.pushState({ practice_source: practice_character_source(character) }, '', '/practice')
  globalThis.location.reload()
}

export const read_practice_source = (): PlayerSource | null => {
  const source: unknown = globalThis.history.state?.practice_source
  if (!source || typeof source !== 'object' || !('classe' in source) || !is_class_name(String(source.classe)))
    return null
  try {
    return create_character_source(source as PlayerSource)
  } catch (error) {
    console.warn('Invalid local practice character.', error)
    return null
  }
}
