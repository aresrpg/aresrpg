// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import {
  characteristic_values_cost,
  item_stat_center,
  pet_max_feeds,
  stat_names,
  xp_for_level,
  type ClassName,
  type StatName,
} from '@aresrpg/immutable'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'
import { fold_equipment_stats } from '@aresrpg/protocol/character-stats'

import guide from '../../../../seed/content/guide.json'
import { encyclopedia_catalog, type SeedItem } from '../content/catalog.ts'
import { titleize } from '../content/titles.ts'
import { mob_level_from_scalar } from '../content/mob_levels.ts'
import {
  affordable_stat_value,
  initial_simulator_state,
  simulator_board,
  spell_budget,
  spell_point_cost,
  stat_budget,
  type SimulatorCharacter,
} from '../modules/simulator.ts'
import { simulator_fight_setup } from '../simulator/fight_setup.ts'

// Sample data of the composition lab and of the tests. It is never published, indexed, or merged
// into the live catalogue, and no wallet or session stands behind it.
const SAMPLE_KIOSK = 'sample'
const SAMPLE_LEVEL = 199
const SAMPLE_SPELLS = [
  'Jump',
  'Pressure',
  'Intimidation',
  'Divine Sword',
  'Sword of Fate',
  'Destructive Sword',
  'Cut',
  'Power',
  'Strengthstorm',
  'Concentration',
  "Senshi's Sword",
  "Senshi's Wrath",
] as const
const COMPANION_SPELLS = [
  'Deviousness',
  'Tricky Blow',
  'Tricky Trap',
  'Mass Trap',
  'Fear',
  'Lethal Attack',
  'Lethal Trap',
  'Shadowstep',
] as const

/** A senshi with the starting capital spent on Strength through the canonical class cost ladder. */
export const sample_character = (level = SAMPLE_LEVEL): SimulatorCharacter => {
  const budget = stat_budget(level)
  return Object.freeze({
    id: 'sample_senshi',
    name: 'Senshi',
    classe: 'senshi',
    male: true,
    colors: Object.freeze(['#e8dfc7', '#497559', '#ac713f'] as const),
    level,
    vitality: 0,
    wisdom: 0,
    strength: affordable_stat_value('senshi', 'strength', budget, budget),
    intelligence: 0,
    chance: 0,
    agility: 0,
    spell_levels: Object.freeze(Object.fromEntries(SAMPLE_SPELLS.map((spell) => [spell, 6]))),
    loadout: Object.freeze({}),
  })
}

/** A second hero for rosters: the authored guide's appearance on a level 200 yajin. */
export const sample_companion = (): SimulatorCharacter => {
  const budget = stat_budget(200)
  return Object.freeze({
    ...sample_character(200),
    id: 'sample_sceat',
    name: guide.name,
    classe: guide.classe,
    colors: guide.colors as [string, string, string],
    strength: affordable_stat_value('yajin', 'strength', budget, budget),
    spell_levels: Object.fromEntries(COMPANION_SPELLS.map((name) => [name, 6])),
    loadout: guide.loadout,
  })
}

const equipment = (
  item_type: string,
  category: SeedItem['category'],
  bonuses: Readonly<Partial<Record<StatName, number>>>
): SeedItem => {
  const stats = Object.freeze(
    Object.fromEntries(stat_names.map((stat) => [stat, bonuses[stat] ?? 0])) as Record<StatName, number>
  )
  return Object.freeze({
    item_type,
    name: titleize(item_type.replace('demo_goblin_', 'muru_')),
    category,
    level: 200,
    stats: { min: stats, max: stats },
  })
}
const catalog_item = (id: string): SeedItem => encyclopedia_catalog.items.find(({ item_type }) => item_type === id)!

export const SAMPLE_ITEMS = Object.freeze([
  equipment('zukin_muru', 'hat', { vitality: 350, strength: 100, intelligence: 100 }),
  equipment('enka_muru', 'cloak', { vitality: 300, strength: 100, intelligence: 100 }),
  equipment('demo_goblin_relic', 'relic', { action: 1, strength: 100, intelligence: 100 }),
  equipment('demo_goblin_ring', 'ring', { vitality: 200, action: 1, strength: 80, intelligence: 80 }),
  equipment('demo_goblin_boots', 'boots', { vitality: 250, movement: 1, strength: 80, intelligence: 80 }),
])
export const SAMPLE_PET_ITEM = catalog_item('beru')
export const SAMPLE_COMPANION_ITEMS: readonly SeedItem[] = [
  equipment(guide.loadout.hat, 'hat', { vitality: 250, strength: 150, action: 1 }),
  catalog_item(guide.loadout.cloak),
]

export const sample_inventory = (items: readonly SeedItem[]): readonly ItemRow[] =>
  Object.freeze(
    items.map((item) => ({
      id: item.item_type,
      name: item.name,
      item_type: item.item_type,
      category: item.category,
      level: item.level,
      amount: 1,
      kiosk: SAMPLE_KIOSK,
      ...(item.category === 'pet' ? { pet_power: pet_max_feeds } : {}),
      stats: Object.fromEntries(
        Object.entries(item.stats?.max ?? {}).map(([stat, value]) => [stat, value + item_stat_center])
      ),
    }))
  )

export const SAMPLE_INVENTORY = sample_inventory([...SAMPLE_ITEMS, SAMPLE_PET_ITEM])

/** The normal HUD consumes the normal read shape, derived without creating a wallet or session. */
export const sample_character_row = (
  character: SimulatorCharacter,
  inventory: readonly ItemRow[] = [...SAMPLE_INVENTORY, ...sample_inventory(SAMPLE_COMPANION_ITEMS)]
): CharacterRow => {
  const worn = Object.entries(character.loadout).flatMap(([slot, item_type]) => {
    const item = inventory.find((row) => row.item_type === item_type)
    return item ? [{ ...item, slot }] : []
  })
  return {
    ...character,
    sex: character.male ? 'male' : 'female',
    experience: String(xp_for_level(character.level)),
    color_1: Number.parseInt(character.colors[0].slice(1), 16),
    color_2: Number.parseInt(character.colors[1].slice(1), 16),
    color_3: Number.parseInt(character.colors[2].slice(1), 16),
    available_points:
      stat_budget(character.level) - characteristic_values_cost(character.classe as ClassName, character)!,
    available_spell_points:
      spell_budget(character.level) -
      Object.values(character.spell_levels).reduce((sum, level) => sum + spell_point_cost(level), 0),
    spells: { ...character.spell_levels },
    jobs: {},
    kiosk: SAMPLE_KIOSK,
    custody: 'kiosk',
    world: 'nauvis',
    equipment: worn,
    folded_stats: fold_equipment_stats(worn),
  }
}

export const SAMPLE_FIGHT_ID = 'sample_fight'
/** A local fight of the sample heroes against the first catalogue mob, on the simulator's board. */
export const sample_fight_setup = (character: SimulatorCharacter, companion: SimulatorCharacter | null = null) => {
  const state = { ...initial_simulator_state(), seed: 38n }
  const characters = companion ? [character, companion] : [character]
  const board = simulator_board(state)
  const mob = encyclopedia_catalog.mobs[0]!
  const setup = simulator_fight_setup(
    {
      ...state,
      characters,
      character_placements: Object.fromEntries(
        characters.map((row, index) => [Number(board.start_cells_a[index]!), row.id])
      ),
      mob_placements: {
        [Number(board.start_cells_b[0]!)]: {
          mob_type: mob.mob_type,
          level: mob_level_from_scalar(mob.level_min, mob.level_max, 50),
        },
      },
    },
    {
      items: [...encyclopedia_catalog.items, ...SAMPLE_ITEMS, ...SAMPLE_COMPANION_ITEMS],
      mobs: encyclopedia_catalog.mobs,
    }
  )
  return {
    ...setup,
    players: setup.players.map((player) => ({ ...player, ready: false })),
    fight_id: SAMPLE_FIGHT_ID,
  }
}
