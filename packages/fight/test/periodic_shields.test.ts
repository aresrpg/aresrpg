// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import spells from '../../../seed/content/spells.json'
import { GRID_CELLS, mask_from_cells } from '../src/combat_grid.ts'
import { create_character_source, player_max_hp } from '../src/create.ts'
import { create_fight } from '../src/fight.ts'
import { KINDS, STATS } from '../src/fighters.ts'
import { CONTRACT_CONSTANTS } from '../src/move_contract.gen.ts'
import { normalize_sources } from '../src/normalize.ts'
import { create_runtime } from '../src/runtime.ts'
import { expire_turn_effects, tick_turn_end, tick_turn_start } from '../src/turn_effects.ts'
import type { ActiveEffect } from '../src/types.ts'

import { create_fixture } from './helpers.ts'

const effect = (kind: bigint, stat: bigint, value: bigint, turns_left: bigint, element = ''): ActiveEffect => ({
  kind,
  stat,
  value,
  turns_left,
  element,
  source: 0n,
})

const protected_fighter = (shields: readonly ActiveEffect[]) => {
  const checkpoint = structuredClone(create_fixture().checkpoint)
  const base = create_character_source({ classe: 'mori', level: 200n })
  checkpoint.sources.players['0xc1'] = create_character_source({
    classe: 'mori',
    level: 200n,
    vitality: 1285n - player_max_hp(base),
    strength: 100n,
  })
  checkpoint.contract.fighters[0]!.hp = 1285n
  checkpoint.contract.fighters[0]!.effects = [
    effect(KINDS.remove, STATS.hp, 26n, 5n, 'earth'),
    effect(KINDS.remove, STATS.intelligence, 200n, 5n),
    effect(KINDS.remove, STATS.hp, 17n, 3n, 'fire'),
    ...shields,
  ]
  return create_runtime(checkpoint)
}

test('Sylvan Power blocks the screenshot’s 26 earth and 17 fire poison before its 16 HP heal', () => {
  const runtime = protected_fighter([
    effect(KINDS.fixed_remove, STATS.ap, 100n, 3n),
    effect(KINDS.fixed_remove, STATS.mp, 100n, 3n),
    effect(KINDS.reduce, STATS.any, 1000n, 3n),
    effect(KINDS.add, STATS.hp, 16n, 3n),
  ])
  expire_turn_effects(runtime, 0n)
  tick_turn_start(runtime, 0n)
  expect(runtime.contract.fighters[0]!.hp).toBe(1285n)
  expect(runtime.render_actions.filter(({ type }) => type === 'damage_number')).toEqual([])
  expect(
    runtime.render_actions.filter((event) => event.type === 'damage_reduced').map(({ payload }) => payload.prevented)
  ).toEqual([26n, 17n])
})

test('periodic damage uses current matching shields without amplifying the stored damage again', () => {
  const runtime = protected_fighter([
    effect(KINDS.reduce, STATS.any, 20n, 2n, 'earth'),
    effect(KINDS.reduce, STATS.any, 1000n, 2n, 'water'),
    effect(KINDS.reduce, STATS.any, 3n, 2n),
  ])
  tick_turn_start(runtime, 0n)
  expect(runtime.contract.fighters[0]!.hp).toBe(1285n - 3n - 14n)
  expect(
    runtime.render_actions.filter((event) => event.type === 'damage_reduced').map(({ payload }) => payload.prevented)
  ).toEqual([23n, 3n])
})

test('poison keeps ticking while blocked and resumes when protection expires', () => {
  const runtime = protected_fighter([effect(KINDS.reduce, STATS.any, 1000n, 2n)])
  tick_turn_end(runtime, 0n)
  expire_turn_effects(runtime, 0n)
  tick_turn_start(runtime, 0n)
  expect(runtime.contract.fighters[0]!.hp).toBe(1285n)
  expect(runtime.contract.fighters[0]!.effects[0]!.turns_left).toBe(4n)
  tick_turn_end(runtime, 0n)
  expire_turn_effects(runtime, 0n)
  tick_turn_start(runtime, 0n)
  expect(runtime.contract.fighters[0]!.hp).toBe(1242n)
})

test('the authored Poisoned Wind, Earthquake and Sylvan Power combo protects only the caster', () => {
  const names = ['Poisoned Wind', 'Earthquake', 'Sylvan Power']
  const source = create_character_source({
    classe: 'mori',
    level: 200n,
    vitality: 200n,
    strength: 100n,
    intelligence: 200n,
    spell_levels: Object.fromEntries(names.map((name) => [name, 6n])),
    folded_stats: {
      action: BigInt(CONTRACT_CONSTANTS.item_stat_shift) + 1n,
      raw_damage: BigInt(CONTRACT_CONSTANTS.item_stat_shift) + 10n,
    },
  })
  const fight = create_fight({
    mode: 'local',
    seed: 91n,
    setup: {
      board: {
        ...create_fixture().checkpoint.contract.board,
        shape_mask: mask_from_cells(Array.from({ length: Number(GRID_CELLS) }, (_, index) => BigInt(index))),
        obstacles: [],
        holes: [],
        start_cells_a: [100n, 101n, 102n, 103n, 104n, 105n],
        start_cells_b: [200n, 201n, 202n, 203n, 204n, 205n],
      },
      players: [
        { character: 'caster', owner: 'a', team: 0n, cell: 100n, hp: 1000n, ready: true, source },
        { character: 'enemy', owner: 'b', team: 1n, cell: 200n, hp: 1000n, ready: true, source },
      ],
      mobs: [],
      spells: normalize_sources({
        spells: Object.fromEntries(
          spells.filter(({ name }) => names.includes(name)).map((spell) => [spell.name, spell])
        ),
      }).spells,
    },
  })
  expect(fight.apply({ type: 'start', observed_ms: 1n }).error).toBeNull()
  names.forEach((spell) =>
    expect(fight.apply({ type: 'cast_spell', fighter: 0n, spell, target_cell: 100n }).error).toBeNull()
  )
  const poison_damage = fight
    .state()
    .contract.fighters[0]!.effects.filter(({ kind, stat }) => kind === KINDS.remove && stat === STATS.hp)
    .reduce((total, { value }) => total + value, 0n)
  for (let round = 0; round < 4; round++) {
    for (const fighter of [0n, 1n]) {
      expect(
        fight.apply({ type: 'end_turn', fighter, observed_ms: BigInt(round * 6000 + Number(fighter) * 3000 + 3001) })
          .error
      ).toBeNull()
    }
    const expected = 1000n + 16n * BigInt(round + 1) - (round === 3 ? poison_damage : 0n)
    expect(fight.state().contract.fighters[0]!.hp).toBe(expected)
    expect(fight.state().contract.fighters[1]!.hp).toBeLessThan(1000n)
  }
})
