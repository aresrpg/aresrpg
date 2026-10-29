// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import spells from '../../../seed/content/spells.json'
import { mask_from_cells } from '../src/combat_grid.ts'
import { create_character_source } from '../src/create.ts'
import { create_fight, type Fight } from '../src/fight.ts'
import { KINDS, STATS } from '../src/fighters.ts'
import { normalize_sources } from '../src/normalize.ts'
import type { SpellSource } from '../src/types.ts'

import { create_fixture } from './helpers.ts'

const authored = spells.find(({ name }) => name === 'All or Nothing')!
const all_or_nothing = normalize_sources({ spells: { [authored.name]: authored } }).spells[authored.name]!

const setup = (spell: SpellSource, level = 1n): Fight => {
  const source = create_character_source({
    classe: spell.classe,
    level: 200n,
    spell_levels: { [authored.name]: level },
  })
  const fight = create_fight({
    mode: 'local',
    seed: 91n,
    setup: {
      board: {
        ...create_fixture().checkpoint.contract.board,
        shape_mask: mask_from_cells(Array.from({ length: 380 }, (_, index) => BigInt(index))),
        obstacles: [],
        holes: [],
        start_cells_a: [100n, 101n, 102n, 103n, 104n, 105n],
        start_cells_b: [200n, 201n, 202n, 203n, 204n, 205n],
      },
      players: [
        { character: 'caster', owner: 'a', team: 0n, cell: 100n, hp: 100n, ready: true, source },
        { character: 'ally', owner: 'b', team: 0n, cell: 101n, hp: 100n, ready: true, source },
        { character: 'enemy', owner: 'c', team: 1n, cell: 200n, hp: 1000n, ready: true, source },
      ],
      mobs: [],
      spells: { [authored.name]: spell },
    },
  })
  expect(fight.apply({ type: 'start', observed_ms: 1n }).error).toBeNull()
  const cast = fight.apply({ type: 'cast_spell', fighter: 0n, spell: authored.name, target_cell: 100n })
  expect(cast.error).toBeNull()
  expect(cast.events.some(({ type }) => type === 'heal_number' || type === 'damage_number')).toBe(false)
  return fight
}

const next_round = (fight: Fight, round: number) =>
  Array.from({ length: 3 }, (_, index) => {
    const { queue, turn_ptr } = fight.state().contract
    const result = fight.apply({
      type: 'end_turn',
      fighter: queue[Number(turn_ptr)]!,
      observed_ms: BigInt(round * 9000 + index * 3000 + 3001),
    })
    expect(result.error).toBeNull()
    return result.events
  }).flat()

for (const level of [1n, 2n, 3n, 4n, 5n, 6n]) {
  test(`All or Nothing level ${level} heals its caster and ally on two future turns`, () => {
    const fight = setup(all_or_nothing, level)
    const amounts = fight.state().contract.fighters.map(({ effects }) => effects[0]!.value)
    const events = Array.from({ length: 3 }, (_, round) => next_round(fight, round)).flat()

    for (const target of [0n, 1n]) {
      const heals = events.filter((event) => event.type === 'heal_number' && event.payload.target === target)
      expect(heals).toHaveLength(2)
      expect(fight.state().contract.fighters[Number(target)]!.hp).toBe(100n + 2n * amounts[Number(target)]!)
    }
    expect(fight.state().contract.fighters[2]!.hp).toBe(1000n - 2n * amounts[2]!)
    expect(fight.state().contract.fighters.every(({ effects }) => effects.length === 0)).toBe(true)
  })
}

for (const kind of [KINDS.add, KINDS.remove, KINDS.steal]) {
  for (const turns of [1n, 2n, 3n]) {
    test(`HP kind ${kind} ticks ${turns} times on active and inactive recipients`, () => {
      const base = all_or_nothing.levels[0]!
      const element = kind === KINDS.add ? '' : 'earth'
      const fight = setup({
        ...all_or_nothing,
        levels: [
          {
            ...base,
            crit_effects: [],
            effects: [{ ...base.effects[1]!, kind, turns, element, value: 7n, value_max: 7n, stat: STATS.hp }],
          },
        ],
      })
      const sign = kind === KINDS.add ? 1n : -1n
      for (let round = 0; round <= Number(turns); round++) {
        next_round(fight, round)
        const ticks = BigInt(Math.min(round + 1, Number(turns)))
        expect(
          fight
            .state()
            .contract.fighters.slice(0, 2)
            .map(({ hp }) => hp)
        ).toEqual([100n + sign * 7n * ticks, 100n + sign * 7n * ticks])
      }
    })
  }
}
