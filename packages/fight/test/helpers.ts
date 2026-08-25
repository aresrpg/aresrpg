// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { create_character_source, create_fight_state } from '../src/create.ts'
import type { SpellEffect, SpellLevel } from '../src/types.ts'

const damage_effect = (value: bigint): SpellEffect => ({
  kind: 0n,
  element: 'earth',
  value,
  value_max: value,
  area_shape: 0n,
  area_size: 0n,
  target_filter: 0n,
  chance_bp: 10_000n,
  turns: 0n,
  stat: 0n,
})

const spell_level = (value: bigint): SpellLevel => ({
  ap_cost: 2n,
  range_min: 1n,
  range_max: 40n,
  modifiable_range: false,
  line_of_sight: false,
  line_launch: false,
  free_cell: false,
  casts_per_turn: 0n,
  casts_per_target: 0n,
  cooldown_turns: 0n,
  crit_1_in: 0n,
  effects: [damage_effect(value)],
  crit_effects: [],
})

export const create_fixture = () => {
  const source = create_character_source({ classe: 'senshi', level: 10n, strength: 100n })
  return {
    checkpoint: create_fight_state({
      fight_id: '0xf1',
      world: 'incarnam',
      x: 250_000n,
      z: 250_000n,
      board_seed: 1n,
      players: [
        {
          character: '0xc1',
          owner: '0xa1',
          team: 0n,
          ready: true,
          hp: 100n,
          source,
        },
      ],
      mobs: [
        {
          team: 1n,
          scalar: 100n,
          template: {
            mob_type: 'wabbit',
            level_min: 10n,
            level_max: 10n,
            hp: 100n,
            ap: 6n,
            mp: 3n,
            agility: 0n,
            wisdom: 0n,
            earth_res: 32_768n,
            fire_res: 32_768n,
            water_res: 32_768n,
            air_res: 32_768n,
            spells: [{ name: 'bite', level: spell_level(10n) }],
            xp: 50n,
            loot: [],
          },
        },
      ],
      spells: {
        slash: { classe: 'senshi', unlock_level: 1n, levels: [spell_level(20n)] },
      },
    }),
  }
}
