// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Lazy seed adapter for local fight birth inputs. Combat remains entirely inside @aresrpg/fight.

import {
  create_character_source,
  mob_scalar_for_level,
  player_max_hp,
  type FightSetup,
  type MobTemplateSource,
  type SpellEffect,
  type SpellLevel,
  type SpellSource,
} from '@aresrpg/fight'
import { equipment_slot_accepts, item_stat_center, stat_names, type CharacterEquipmentSlot } from '@aresrpg/immutable'

import {
  encyclopedia_catalog,
  type SeedMob,
  type SeedSpell,
  type SpellLevel as SeedSpellLevel,
} from '../content/catalog.ts'
import type { SimulatorState } from '../modules/simulator.ts'

const to_effect = (effect: SeedSpellLevel['effects'][number]): SpellEffect => ({
  kind: BigInt(effect.kind),
  element: effect.element,
  value: BigInt(effect.value),
  value_max: BigInt(effect.value_max),
  area_shape: BigInt(effect.area_shape),
  area_size: BigInt(effect.area_size),
  target_filter: BigInt(effect.target_filter),
  chance_bp: BigInt(effect.chance_bp),
  turns: BigInt(effect.turns),
  stat: BigInt(effect.stat),
})

const to_spell_level = (level: SeedSpellLevel): SpellLevel => ({
  ap_cost: BigInt(level.ap_cost),
  range_min: BigInt(level.range_min),
  range_max: BigInt(level.range_max),
  modifiable_range: level.modifiable_range,
  line_of_sight: level.line_of_sight,
  line_launch: level.line_launch,
  free_cell: level.free_cell,
  casts_per_turn: BigInt(level.casts_per_turn),
  casts_per_target: BigInt(level.casts_per_target),
  cooldown_turns: BigInt(level.cooldown_turns),
  crit_1_in: BigInt(level.crit_1_in),
  effects: level.effects.map(to_effect),
  crit_effects: level.crit_effects.map(to_effect),
})

const to_spell_source = (spell: SeedSpell): SpellSource => ({
  classe: spell.classe,
  unlock_level: BigInt(spell.unlock_level),
  levels: spell.levels.map(to_spell_level),
})

const to_mob_template = (mob: SeedMob): MobTemplateSource => ({
  mob_type: mob.mob_type,
  level_min: BigInt(mob.level_min),
  level_max: BigInt(mob.level_max),
  hp: BigInt(mob.hp),
  ap: BigInt(mob.ap),
  mp: BigInt(mob.mp),
  agility: BigInt(mob.agility),
  wisdom: BigInt(mob.wisdom),
  earth_res: BigInt(mob.resistances.earth ?? 32_768),
  fire_res: BigInt(mob.resistances.fire ?? 32_768),
  water_res: BigInt(mob.resistances.water ?? 32_768),
  air_res: BigInt(mob.resistances.air ?? 32_768),
  spells: mob.spells.map((spell) => ({ name: spell.name, levels: spell.levels.map(to_spell_level) })),
  loot: mob.loot.map((row) => ({
    item_type: row.item_type,
    chance_bp: BigInt(row.chance_bp),
    min_qty: BigInt(row.min_qty),
    max_qty: BigInt(row.max_qty),
  })),
  xp: BigInt(mob.xp),
})

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
    spells: Object.fromEntries(encyclopedia_catalog.spells.map((spell) => [spell.name, to_spell_source(spell)])),
  }
}
