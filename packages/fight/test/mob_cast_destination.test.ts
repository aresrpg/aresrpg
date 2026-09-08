// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { encode_cell, mask_from_cells } from '../src/combat_grid.ts'
import { create_runtime } from '../src/runtime.ts'
import { mob_turn } from '../src/turns.ts'
import type { SpellLevel } from '../src/types.ts'
import mobs from '../../../seed/content/mobs.json'

import { create_fixture } from './helpers.ts'

for (const line_launch of [true, false]) {
  test(`a ranged mob finds its nearest legal casting cell (line launch ${line_launch})`, () => {
    const { checkpoint } = create_fixture()
    const [player, mob] = checkpoint.contract.fighters
    if (!player || mob?.kind.type !== 'mob') throw new Error('missing fixture')
    checkpoint.contract.closed = mask_from_cells([])
    checkpoint.contract.board.obstacles = []
    player.cell = encode_cell(7n, 6n)
    mob.cell = encode_cell(4n, 5n)
    mob.mp = 1n
    mob.ap = 2n
    const spell = mob.kind.snapshot.kit[0]!
    mob.kind.snapshot.kit = [{ ...spell, level: { ...spell.level, range_min: 3n, range_max: 5n, line_launch } }]
    const runtime = create_runtime(checkpoint)
    mob_turn(runtime, 1n)
    expect(runtime.contract.fighters[0]!.hp).toBeLessThan(player.hp)
    expect(runtime.contract.fighters[1]!.cell).toBe(line_launch ? encode_cell(4n, 6n) : encode_cell(5n, 5n))
    expect(runtime.contract.fighters[1]!.ap).toBe(0n)
  })
}

for (const mob_type of ['protector_amber', 'protector_jade', 'protector_quartz']) {
  test(`${mob_type} attacks from a reachable aligned cell with its actual authored kit`, () => {
    const authored = mobs.find((candidate) => candidate.mob_type === mob_type)!
    const { checkpoint } = create_fixture()
    const [player, mob] = checkpoint.contract.fighters
    if (!player || mob?.kind.type !== 'mob') throw new Error('missing fixture')
    checkpoint.contract.closed = mask_from_cells([])
    checkpoint.contract.board.obstacles = []
    player.cell = encode_cell(7n, 6n)
    mob.cell = encode_cell(4n, 5n)
    mob.ap = BigInt(authored.ap)
    mob.mp = BigInt(authored.mp)
    mob.cooldowns = [{ spell: 'Prismatic Guard', left: 3n }]
    mob.kind.snapshot.kit = authored.spells.map(({ name, levels }) => ({
      name,
      ordinal: 1n,
      level: JSON.parse(JSON.stringify(levels[0]), (_key, value: unknown) =>
        typeof value === 'number' ? BigInt(value) : value
      ) as SpellLevel,
    }))
    const runtime = create_runtime(checkpoint)
    mob_turn(runtime, 1n)
    const cast_index = runtime.render_actions.findIndex(
      (event) => event.type === 'spell_cast' && event.payload.spell === 'Shard Volley'
    )
    expect(cast_index).toBeGreaterThan(0)
    const movement = runtime.render_actions.slice(0, cast_index).find((event) => event.type === 'fighter_moved')
    expect(movement?.payload).toMatchObject({ from: encode_cell(4n, 5n), to: encode_cell(4n, 6n) })
    expect(runtime.contract.fighters[0]!.hp).toBeLessThan(player.hp)
  })
}
