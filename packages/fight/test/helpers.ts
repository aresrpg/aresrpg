// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { create_character_source, create_fight, create_fight_state } from '../src/index.ts'
import type { ActiveEffect, HydratedFightCheckpoint, SpellEffect, SpellLevel } from '../src/index.ts'

export const effect_row = (overrides: Partial<SpellEffect> = {}): SpellEffect => ({
  kind: 0n,
  element: 'earth',
  value: 10n,
  value_max: 10n,
  area_shape: 0n,
  area_size: 0n,
  target_filter: 0n,
  chance_bp: 10_000n,
  turns: 0n,
  stat: 0n,
  ...overrides,
})

export const spell_level = (effects: SpellEffect[], overrides: Partial<SpellLevel> = {}): SpellLevel => ({
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
  effects,
  crit_effects: [],
  ...overrides,
})

export const active = (kind: bigint, stat: bigint, value: bigint, turns_left = 2n, element = ''): ActiveEffect => ({
  kind,
  element,
  value,
  turns_left,
  source: 0n,
  stat,
})

/** A mutable level-10 senshi (seat 0, strength 100, `slash` deals 20 earth) against a level-10 wabbit (seat 1). */
export const fixture = (): HydratedFightCheckpoint =>
  structuredClone(
    create_fight_state({
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
          source: create_character_source({ classe: 'senshi', level: 10n, strength: 100n }),
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
            spells: [{ name: 'bite', level: spell_level([effect_row()]) }],
            xp: 50n,
            loot: [],
          },
        },
      ],
      spells: {
        slash: {
          classe: 'senshi',
          unlock_level: 1n,
          levels: [spell_level([effect_row({ value: 20n, value_max: 20n })])],
        },
      },
    })
  )

/** A mutable copy of the fixture whose board has no closed cell. */
export const open_fixture = (): HydratedFightCheckpoint => {
  const checkpoint = fixture()
  checkpoint.contract.closed = checkpoint.contract.closed.map(() => 0n)
  checkpoint.contract.board.obstacles = []
  return checkpoint
}

/** The checkpoint with extra one-level senshi spells. */
export const with_spells = (
  checkpoint: HydratedFightCheckpoint,
  spells: Readonly<Record<string, SpellLevel>>
): HydratedFightCheckpoint => ({
  ...checkpoint,
  sources: {
    ...checkpoint.sources,
    spells: {
      ...checkpoint.sources.spells,
      ...Object.fromEntries(
        Object.entries(spells).map(([name, level]) => [name, { classe: 'senshi', unlock_level: 1n, levels: [level] }])
      ),
    },
  },
})

/** A local fight started at the placement deadline; seat 0 plays first. */
export const started = (checkpoint: HydratedFightCheckpoint, seed = 91n) => {
  const fight = create_fight({ state: checkpoint, mode: 'local', seed })
  fight.apply({ type: 'start', observed_ms: 60_000n })
  return fight
}
