// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Lazy seed adapter for local fight birth inputs. Combat remains entirely inside @aresrpg/fight.

import { create_character_source, mob_scalar_for_level, player_max_hp, type FightSetup } from '@aresrpg/fight'
import { equipment_slot_accepts, item_stat_center, stat_names, type CharacterEquipmentSlot } from '@aresrpg/immutable'

import { encyclopedia_catalog } from '../content/catalog.ts'
import { catalog_spell_sources, to_mob_template } from '../content/fight_sources.ts'
import type { SimulatorState } from '../modules/simulator.ts'

const loadout_source = (loadout: Readonly<Record<string, string>>) => {
  const rows = Object.entries(loadout).map(([slot, item_type]) => {
    const item = encyclopedia_catalog.items.find((candidate) => candidate.item_type === item_type)
    if (!item || !equipment_slot_accepts(slot as CharacterEquipmentSlot, item.category))
      throw new Error(`Invalid local loadout item ${item_type} in ${slot}`)
    return { slot, item }
  })
  const folded_stats = Object.fromEntries(
    stat_names.map((field) => [
      field,
      BigInt(
        Math.max(
          0,
          Math.min(
            65_535,
            item_stat_center + rows.reduce((total, { item }) => total + (item.stats?.max[field] ?? 0), 0)
          )
        )
      ),
    ])
  )
  const weapon = rows.find(({ slot }) => slot === 'weapon')?.item
  return {
    folded_stats,
    weapon: weapon
      ? {
          category: weapon.category,
          damages: (weapon.damages ?? []).map(({ element, from, to }) => ({
            element,
            from: BigInt(from),
            to: BigInt(to),
          })),
        }
      : null,
  }
}

export const simulator_fight_setup = (state: Readonly<SimulatorState>): FightSetup => {
  const characters = Object.fromEntries(state.characters.map((character) => [character.id, character]))
  const players = Object.entries(state.character_placements).map(([cell, character_id]) => {
    const character = characters[character_id]
    if (!character) throw new Error(`Unknown local character ${character_id}`)
    const source = create_character_source({
      classe: character.classe,
      level: BigInt(character.level),
      vitality: BigInt(character.vitality),
      wisdom: BigInt(character.wisdom),
      strength: BigInt(character.strength),
      intelligence: BigInt(character.intelligence),
      chance: BigInt(character.chance),
      agility: BigInt(character.agility),
      spell_levels: Object.fromEntries(
        Object.entries(character.spell_levels).map(([spell, level]) => [spell, BigInt(level)])
      ),
      ...loadout_source(character.loadout),
    })
    return {
      character: character.id,
      owner: 'local',
      team: 0n,
      cell: BigInt(cell),
      ready: true,
      hp: player_max_hp(source),
      source,
    }
  })
  const mobs = Object.entries(state.mob_placements).map(([cell, placement]) => {
    const seed_mob = encyclopedia_catalog.mobs.find(({ mob_type }) => mob_type === placement.mob_type)
    if (!seed_mob || placement.level < seed_mob.level_min || placement.level > seed_mob.level_max)
      throw new Error(`Invalid seed mob ${placement.mob_type} level ${placement.level}`)
    const template = to_mob_template(seed_mob)
    return {
      team: 1n,
      cell: BigInt(cell),
      template,
      scalar: mob_scalar_for_level(template, BigInt(placement.level)),
    }
  })
  return {
    fight_id: `local_${state.seed}`,
    world: 'local',
    board_seed: state.seed,
    players,
    mobs,
    spells: { ...catalog_spell_sources() },
  }
}
