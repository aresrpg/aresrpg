// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import adventure from '../../../../seed/content/adventure.json'
import { affordable_stat_value, stat_budget, type SimulatorCharacter } from '../modules/simulator.ts'

/** Spend the starting capital on Strength using the canonical class cost ladder. */
export const adventure_character = (level = adventure.starting_level): SimulatorCharacter => {
  const budget = stat_budget(level)
  return Object.freeze({
    id: 'adventure_senshi',
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
    spell_levels: Object.freeze(
      Object.fromEntries(
        [
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
        ].map((spell) => [spell, 6])
      )
    ),
    loadout: Object.freeze({}),
  })
}

export const adventure_companion = (): SimulatorCharacter => {
  const source = adventure.companion
  return Object.freeze({
    ...adventure_character(source.level),
    id: source.id,
    name: source.name,
    classe: source.classe,
    colors: source.colors as [string, string, string],
    strength: affordable_stat_value('yajin', 'strength', stat_budget(source.level), stat_budget(source.level)),
    intelligence: 0,
    spell_levels: Object.fromEntries(source.spells.map((name) => [name, 6])),
    loadout: source.loadout,
  })
}
