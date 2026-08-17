// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { create_fight } from '../src/fight.ts'
import { preview_spell_cast } from '../src/spell_preview.ts'

import { create_fixture } from './helpers.ts'

describe('spell cast preview', () => {
  test('uses the fight resolver to report fighters affected through an empty AoE anchor', () => {
    const setup = structuredClone(create_fixture().checkpoint)
    setup.sources.spells.slash.levels[0]!.effects[0]!.area_shape = 1n
    setup.sources.spells.slash.levels[0]!.effects[0]!.area_size = 1n
    const fight = create_fight({ state: setup, mode: 'local' })
    fight.apply({ type: 'start', observed_ms: 60_000n })
    const checkpoint = fight.state()
    const caster = checkpoint.contract.fighters[0]!
    const target = checkpoint.contract.fighters[1]!
    const empty_anchor = [target.cell - 1n, target.cell + 1n].find(
      (cell) => cell !== caster.cell && !checkpoint.contract.fighters.some((fighter) => fighter.cell === cell)
    )
    expect(empty_anchor).toBeDefined()
    const hp_before = target.hp

    const preview = preview_spell_cast(checkpoint, caster.kind.type === 'player' ? 0n : 1n, 'slash', empty_anchor!)

    expect(preview.error).toBeNull()
    expect(preview.targets).toContainEqual(
      expect.objectContaining({ fighter: 1n, hp_before, hp_after: hp_before - 40n })
    )
    expect(preview.targets.map(({ fighter }) => fighter)).toEqual([1n])
  })

  test('does not mutate the checkpoint it previews', () => {
    const { checkpoint } = create_fixture()
    const before = structuredClone(checkpoint)
    const target = checkpoint.contract.fighters[1]!.cell

    preview_spell_cast(checkpoint, 0n, 'slash', target)

    expect(checkpoint).toEqual(before)
  })
})
