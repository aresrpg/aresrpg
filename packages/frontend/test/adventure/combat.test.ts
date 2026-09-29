// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { create_fight, create_fight_state } from '@aresrpg/fight'
import { expect, test } from 'bun:test'

import { adventure_character } from '../../src/adventure/character.ts'
import { adventure_fight_setup } from '../../src/adventure/fight_setup.ts'

test('the stronger opening pack remains beatable by the unequipped Strength Senshi', () => {
  const game = create_fight({
    state: create_fight_state(adventure_fight_setup(adventure_character(), 0)),
    mode: 'local',
    seed: 42n,
  })
  expect(
    game
      .state()
      .contract.fighters.slice(1)
      .map(({ hp }) => hp)
  ).toEqual([420n, 770n, 1120n])
  expect(game.apply({ type: 'ready', fighter: 0n }).error).toBeNull()
  expect(game.apply({ type: 'start', observed_ms: 60000n }).error).toBeNull()
  // Captured winning sequence: ordinary spells and AI turns, no health or result overrides.
  const turns = [
    [
      ["Senshi's Sword", 82n],
      ['Pressure', 82n],
    ],
    [["Senshi's Wrath", 22n]],
    [
      ["Senshi's Sword", 22n],
      ['Intimidation', 22n],
    ],
    [
      ["Senshi's Sword", 40n],
      ['Intimidation', 22n],
    ],
    [
      ["Senshi's Sword", 40n],
      ['Intimidation', 43n],
    ],
    [
      ["Senshi's Sword", 40n],
      ['Intimidation', 43n],
    ],
    [["Senshi's Sword", 22n]],
  ] as const
  turns.forEach((casts, turn) => {
    for (const [spell, target_cell] of casts)
      expect(game.apply({ type: 'cast_spell', fighter: 0n, spell, target_cell }).error).toBeNull()
    if (!game.state().contract.ended)
      expect(game.simulate_turn({ observed_ms: BigInt(63000 + turn * 60000) }).error).toBeNull()
  })
  expect(game.state().contract.winner).toBe(0n)
  expect(game.state().contract.fighters[0]!.hp).toBeGreaterThan(0n)
  expect(game.state().contract.fighters[0]!.hp).toBeLessThan(300n)
})

test('level-350 Gobadoc wears the party down over several rounds rather than killing either hero immediately', async () => {
  const { adventure_companion } = await import('../../src/adventure/character.ts')
  const hero = {
    ...adventure_character(200),
    loadout: {
      hat: 'zukin_muru',
      cloak: 'enka_muru',
      relic: 'demo_goblin_relic',
      ring: 'demo_goblin_ring',
      boots: 'demo_goblin_boots',
    },
  }
  const game = create_fight({
    state: create_fight_state(adventure_fight_setup(hero, 2, adventure_companion())),
    mode: 'local',
    seed: 42n,
  })
  const boss = game.state().contract.fighters[2]!
  expect(boss.kind.type === 'mob' && boss.kind.snapshot.level).toBe(350n)
  expect(boss.hp).toBe(8000n)
  game.apply({ type: 'ready', fighter: 0n })
  game.apply({ type: 'ready', fighter: 1n })
  expect(game.apply({ type: 'start', observed_ms: 60000n }).error).toBeNull()
  for (let turn = 0; turn < 24 && !game.state().contract.ended; turn++) {
    expect(game.simulate_turn({ observed_ms: BigInt(63000 + turn * 60000) }).error).toBeNull()
    if (turn < 4)
      expect(
        game
          .state()
          .contract.fighters.slice(0, 2)
          .every(({ hp }) => hp > 0n)
      ).toBe(true)
  }
  expect(game.state().contract.winner).toBe(1n)
  expect(game.state().contract.round).toBeGreaterThanOrEqual(4n)
  expect(game.state().contract.round).toBeLessThanOrEqual(10n)
})

test('an attacking two-hero party can visibly wound Gobadoc before losing through normal combat', async () => {
  const { adventure_companion } = await import('../../src/adventure/character.ts')
  const hero = {
    ...adventure_character(200),
    loadout: {
      hat: 'zukin_muru',
      cloak: 'enka_muru',
      relic: 'demo_goblin_relic',
      ring: 'demo_goblin_ring',
      boots: 'demo_goblin_boots',
    },
  }
  const game = create_fight({
    state: create_fight_state(adventure_fight_setup(hero, 2, adventure_companion())),
    mode: 'local',
    seed: 42n,
  })
  game.apply({ type: 'ready', fighter: 0n })
  game.apply({ type: 'ready', fighter: 1n })
  expect(game.apply({ type: 'start', observed_ms: 60000n }).error).toBeNull()
  // Captured local moves and spell choices on board seed 38. No HP, damage or winner overrides.
  const turns = [
    [0, [41, 61, 81], ["Senshi's Wrath", 'Concentration'], 82],
    [1, [43, 63, 83], ['Lethal Attack', 'Tricky Blow'], 82],
    [0, [61, 62], ["Senshi's Sword"], 82],
    [1, [84], ['Lethal Attack', 'Deviousness'], 82],
    [0, [61, 81], ["Senshi's Sword"], 82],
    [1, [83], ['Lethal Attack', 'Tricky Blow'], 82],
    [0, [61, 62], ["Senshi's Sword", "Senshi's Sword"], 82],
    [1, [84], ['Lethal Attack', 'Deviousness'], 82],
    [0, [61, 81], ["Senshi's Sword"], 82],
    [1, [64, 63], ['Lethal Attack', 'Tricky Blow'], 83],
    [1, [62, 82], ['Lethal Attack', 'Deviousness'], 83],
  ] as const
  turns.forEach(([seat, path, spells, cell], turn) => {
    expect(game.apply({ type: 'move_to', fighter: BigInt(seat), path: path.map(BigInt) }).error).toBeNull()
    for (const spell of spells)
      expect(
        game.apply({ type: 'cast_spell', fighter: BigInt(seat), spell, target_cell: BigInt(cell) }).error
      ).toBeNull()
    expect(game.simulate_turn({ observed_ms: BigInt(63000 + turn * 60000) }).error).toBeNull()
  })
  expect(game.state().contract.winner).toBe(1n)
  expect(game.state().contract.round).toBeGreaterThanOrEqual(4n)
  expect(game.state().contract.fighters[2]!.hp).toBeGreaterThan(0n)
  expect(game.state().contract.fighters[2]!.hp).toBeLessThan(4000n)
})
