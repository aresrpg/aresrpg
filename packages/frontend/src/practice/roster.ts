// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { create_character_source, type PlayerSource, type SpellSource } from '@aresrpg/fight'
import { draw } from '@aresrpg/fight/prng'
import { EFFECT_KINDS } from '@aresrpg/fight/move_contract'
import { class_names, xp_for_level } from '@aresrpg/immutable'

import { catalog_spell_sources } from '../content/fight_sources.ts'
import { affordable_stat_value, spell_point_cost } from '../modules/simulator.ts'

export type PracticeEntrant = Readonly<{ id: string; source: PlayerSource }>

export const simple_spell = (spell: Readonly<SpellSource>): boolean =>
  spell.levels.every(({ effects, crit_effects }) =>
    [...effects, ...crit_effects].every(({ kind }) =>
      [EFFECT_KINDS.damage, EFFECT_KINDS.add, EFFECT_KINDS.reduce].some((allowed) => allowed === kind)
    )
  )

export const practice_roster = (hero: Readonly<PlayerSource>, seed: bigint): readonly PracticeEntrant[] => {
  const cursor = { state: seed }
  const bots = Array.from({ length: 5 }, (_, index) => {
    const classe = class_names[Number(draw(cursor) % BigInt(class_names.length))]!
    const spells = Object.entries(catalog_spell_sources())
      .filter(([, spell]) => spell.classe === classe && spell.unlock_level <= hero.level && simple_spell(spell))
      .map(([name, spell]) => ({ name, spell, order: draw(cursor) }))
      .sort((a, b) => Number(a.order - b.order))
    const attacks = spells
      .filter(({ spell }) => spell.levels[0]!.effects.some(({ kind }) => kind === EFFECT_KINDS.damage))
      .slice(0, 2)
    const support = spells
      .filter(({ spell }) => spell.levels[0]!.effects.every(({ kind }) => kind !== EFFECT_KINDS.damage))
      .slice(0, 2)
    let budget = Number(hero.level - 1n)
    const spell_levels = Object.fromEntries(
      [...attacks, ...support].map(({ name, spell }) => {
        let level = 1 + Number(draw(cursor) % BigInt(spell.levels.length))
        while (spell_point_cost(level) > budget) level -= 1
        budget -= spell_point_cost(level)
        return [name, BigInt(level)]
      })
    )
    const capital = Number(hero.level - 1n) * 5
    const source = create_character_source({
      name: `${classe} ${index + 1}`,
      classe,
      sex: draw(cursor) % 2n ? 'male' : 'female',
      color_1: Number(draw(cursor) & 0xffffffn),
      color_2: Number(draw(cursor) & 0xffffffn),
      color_3: Number(draw(cursor) & 0xffffffn),
      level: hero.level,
      experience: BigInt(xp_for_level(Number(hero.level))!),
      vitality: BigInt(affordable_stat_value(classe, 'vitality', capital, Math.floor(capital / 3))),
      strength: BigInt(affordable_stat_value(classe, 'strength', capital, Math.floor(capital / 6))),
      intelligence: BigInt(affordable_stat_value(classe, 'intelligence', capital, Math.floor(capital / 6))),
      chance: BigInt(affordable_stat_value(classe, 'chance', capital, Math.floor(capital / 6))),
      agility: BigInt(affordable_stat_value(classe, 'agility', capital, Math.floor(capital / 6))),
      spell_levels,
    })
    return { id: `practice_bot_${index}`, source }
  })
  return [{ id: 'practice_hero', source: structuredClone(hero) }, ...bots]
}
