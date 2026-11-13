// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { AREA_SHAPES, CHANNELS, EFFECT_KINDS, TARGET_FILTERS } from '@aresrpg/fight/move_contract'
import type { CharacterRow } from '@aresrpg/protocol'

import spells from '../../../seed/content/spells.json'

export const catalog_spell = (name: string) => spells.find((spell) => spell.name === name)

/** Entitlement only; current cast legality belongs to the fight twin. */
export const learned_spell_rank = (
  name: string,
  character: Readonly<Pick<CharacterRow, 'classe' | 'level' | 'spells'>>
): number | null => {
  const spell = catalog_spell(name)
  const rank = character.spells[name] ?? 1
  return spell?.classe === character.classe && spell.unlock_level <= character.level && spell.levels[rank - 1]
    ? rank
    : null
}
/** Mirrors progression::raise_spell: one rank costs the current rank; authored levels own the cap. */
export const spell_upgrade_quote = (name: string, character: Readonly<CharacterRow>) => {
  const rank = learned_spell_rank(name, character)
  return rank !== null && catalog_spell(name)?.levels[rank] ? { cost: rank, next_rank: rank + 1 } : null
}
const numeric_codes = (codes: Readonly<Record<string, bigint>>) =>
  Object.fromEntries(Object.entries(codes).map(([name, value]) => [name, Number(value)]))

export const spell_knowledge = (characters: readonly CharacterRow[], requested: readonly string[]) => ({
  source: 'seed/content/spells.json and Move-derived fight vocabulary; live Move validation remains authoritative',
  ...(requested.length === 0
    ? { catalog: spells.map(({ name, classe, unlock_level }) => ({ name, classe, unlock_level })) }
    : {
        definitions: spells
          .filter(({ name }) => requested.includes(name))
          .map((spell) => ({
            ...spell,
            characters: characters.map((character) => ({
              character_id: character.id,
              learned_rank: learned_spell_rank(spell.name, character),
              available_spell_points: character.available_spell_points,
              upgrade: spell_upgrade_quote(spell.name, character),
            })),
          })),
        effect_kinds: numeric_codes(EFFECT_KINDS),
        area_shapes: numeric_codes(AREA_SHAPES),
        target_filters: numeric_codes(TARGET_FILTERS),
        stat_channels: numeric_codes(CHANNELS),
      }),
})
