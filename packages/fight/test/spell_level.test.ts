// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { create_fight, preview_spell_cast, spell_level_of, spell_target_cells } from '../src/index.ts'

import { create_fixture } from './helpers.ts'

const leveled_checkpoint = () => {
  const checkpoint = structuredClone(create_fixture().checkpoint)
  const level = checkpoint.sources.spells.slash!.levels[0]!
  checkpoint.sources.spells.slash!.levels = [
    { ...structuredClone(level), ap_cost: 5n },
    { ...structuredClone(level), ap_cost: 3n, casts_per_turn: 1n },
  ]
  return checkpoint
}

test('public spell inspection uses default and invested levels without changing the checkpoint', () => {
  const checkpoint = leveled_checkpoint()
  expect(spell_level_of(checkpoint, 0n, 'slash')?.ap_cost).toBe(5n)
  checkpoint.sources.players['0xc1']!.spell_levels.slash = 2n
  const before = structuredClone(checkpoint)
  expect(spell_level_of(checkpoint, 0n, 'slash')?.ap_cost).toBe(3n)
  expect(checkpoint).toEqual(before)
})

test('public spell inspection refuses absent, locked, foreign-class and unavailable levels', () => {
  const checkpoint = leveled_checkpoint()
  expect(spell_level_of(checkpoint, 0n, 'missing')).toBeNull()
  expect(spell_level_of(checkpoint, 1n, 'slash')).toBeNull()
  expect(spell_level_of(checkpoint, 99n, 'slash')).toBeNull()
  checkpoint.sources.spells.slash!.unlock_level = 11n
  expect(spell_level_of(checkpoint, 0n, 'slash')).toBeNull()
  checkpoint.sources.spells.slash!.unlock_level = 1n
  checkpoint.sources.spells.slash!.classe = 'tomoda'
  expect(spell_level_of(checkpoint, 0n, 'slash')).toBeNull()
  checkpoint.sources.spells.slash!.classe = 'senshi'
  checkpoint.sources.players['0xc1']!.spell_levels.slash = 6n
  expect(spell_level_of(checkpoint, 0n, 'slash')).toBeNull()
})

test('public inspection, targeting and previews compose with sequential canonical cast limits', () => {
  const checkpoint = leveled_checkpoint()
  checkpoint.sources.players['0xc1']!.spell_levels.slash = 2n
  const simulation = create_fight({ state: checkpoint, mode: 'local' })
  expect(simulation.apply({ type: 'start', observed_ms: 60_000n }).error).toBeNull()
  const state = simulation.state()
  const target_cell = state.contract.fighters[1]!.cell
  const before = structuredClone(state)
  expect(spell_target_cells(state, 0n, 'slash').targetable).toContain(target_cell)
  expect(preview_spell_cast(state, 0n, 'slash', target_cell).error).toBeNull()
  expect(state).toEqual(before)
  const cast = simulation.apply({ type: 'cast_spell', fighter: 0n, spell: 'slash', target_cell })
  expect(cast.error).toBeNull()
  expect(cast.state.contract.fighters[0]!.ap).toBe(
    state.contract.fighters[0]!.ap - spell_level_of(state, 0n, 'slash')!.ap_cost
  )
  expect(spell_target_cells(cast.state, 0n, 'slash').targetable).toEqual([])
  expect(preview_spell_cast(cast.state, 0n, 'slash', target_cell).error).not.toBeNull()
})
