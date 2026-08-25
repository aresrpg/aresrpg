// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { create_runtime } from '../src/runtime.ts'
import { tick_turn_end, tick_turn_start } from '../src/turn_effects.ts'
import { tick_board_zones } from '../src/zones.ts'

import { create_fixture } from './helpers.ts'

describe('render identities', () => {
  test('a remaining zone keeps its identity after an earlier zone expires', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    const zone = {
      owner_fighter: 0n,
      trap: false,
      shape: 0n,
      size: 0n,
      anchor: checkpoint.contract.fighters[0].cell,
      turns_left: 1n,
      effects: [],
    }
    checkpoint.contract.zones = [zone, { ...zone, owner_fighter: 1n, turns_left: 2n }]
    const runtime = create_runtime(checkpoint)
    const [, remaining_id] = runtime.render_ids.zones

    tick_board_zones(runtime, 0n)
    tick_board_zones(runtime, 1n)
    tick_board_zones(runtime, 1n)

    expect(runtime.render_actions.at(-1)).toEqual({
      type: 'zone_removed',
      payload: { zone_id: remaining_id, kind: 'glyph', reason: 'expired' },
    })
  })

  test('a remaining effect keeps its identity after an earlier effect expires', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    const effect = { kind: 4n, element: '', value: 5n, turns_left: 1n, source: 0n, stat: 0n }
    checkpoint.contract.fighters[0].effects = [effect, { ...effect, turns_left: 2n }]
    const runtime = create_runtime(checkpoint)
    const [fighter_effects] = runtime.render_ids.effects
    const [, remaining_id] = fighter_effects

    tick_turn_start(runtime, 0n)
    tick_turn_end(runtime, 0n)
    tick_turn_start(runtime, 0n)
    tick_turn_end(runtime, 0n)

    expect(runtime.render_actions).toContainEqual({
      type: 'effect_expired',
      payload: { target: 0n, effect_id: remaining_id, kind: 4n, channel: 0n },
    })
  })
})
