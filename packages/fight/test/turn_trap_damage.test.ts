// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { resolve_rows } from '../src/effects.ts'
import { KINDS, STATS } from '../src/fighters.ts'
import { create_runtime } from '../src/runtime.ts'
import type { ActiveEffect, SpellEffect } from '../src/types.ts'
import { on_enter } from '../src/zones.ts'

import { create_fixture } from './helpers.ts'

const lasting = (kind: bigint, stat: bigint, value: bigint): ActiveEffect => ({
  kind,
  element: 'earth',
  value,
  turns_left: 2n,
  source: 1n,
  stat,
})

const damage_row = (value: bigint): SpellEffect => ({
  kind: KINDS.damage,
  element: 'earth',
  value,
  value_max: value,
  area_shape: 0n,
  area_size: 0n,
  target_filter: 0n,
  chance_bp: 10_000n,
  turns: 0n,
  stat: STATS.any,
})

test('a trap inherits its owner current raw-damage buff when it triggers', () => {
  const triggered_damage = (raw_damage: bigint): bigint => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    const owner = checkpoint.contract.fighters[0]!
    const target = checkpoint.contract.fighters[1]!
    owner.effects = raw_damage > 0n ? [lasting(KINDS.add, STATS.raw_damage, raw_damage)] : []
    checkpoint.contract.zones = [
      {
        owner_fighter: 0n,
        trap: true,
        shape: 0n,
        size: 0n,
        anchor: target.cell,
        turns_left: 0n,
        effects: [damage_row(4n)],
      },
    ]
    const before = target.hp
    const runtime = create_runtime(checkpoint)
    expect(on_enter(runtime, 1n, target.cell - 1n, resolve_rows)).toBeTrue()
    return before - runtime.contract.fighters[1]!.hp
  }

  expect(triggered_damage(17n) - triggered_damage(0n)).toBe(17n)
})
