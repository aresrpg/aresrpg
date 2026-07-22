// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import level_gate from '../behaviors/regressions/level_gate.behavior.js'
import { parse_move_abort } from '../../localnet/bots/framework/sui.js'

import { compile_behavior, verify_expected_abort } from './behavior.mjs'

describe('expected Move abort grammar', () => {
  test('the level-gate regression compiles a first-class expect_abort step', () => {
    const steps = compile_behavior(level_gate)
    const refusal = steps.find((step) => step.expect_abort)
    expect(refusal?.expect_abort).toMatchObject({
      do: 'enter_world',
      module: 'zones',
      abort_code: 101,
      no_digest: true,
    })
  })

  test('typed aborts require no digest and no selected state delta', async () => {
    const snapshots = [{ character_id: '0xc', level: 1 }]
    const result = await verify_expected_abort({
      step: {
        expect_abort: {
          do: 'enter_world',
          module: 'zones',
          abort_code: 101,
          no_digest: true,
          no_state_delta: ['chain.character.snapshot'],
        },
      },
      execute: async () => ({ ok: false, digest: null, abort_module: 'zones', abort_code: 101 }),
      snapshot: async () => snapshots.shift() ?? { character_id: '0xc', level: 1 },
    })
    expect(result.ok).toBe(true)
  })

  test('nested object changes are rejected as a state delta', async () => {
    const snapshots = [
      [{ id: '0xitem', kiosk_id: '0xbuyer', amount: 1 }],
      [{ id: '0xitem', kiosk_id: '0xbuyer', amount: 2 }],
    ]
    await expect(
      verify_expected_abort({
        step: {
          expect_abort: {
            do: 'marketplace_buy',
            module: 'dynamic_field',
            abort_code: 1,
            no_digest: false,
            no_state_delta: ['v1.buyer.items'],
          },
        },
        execute: async () => ({
          ok: false,
          digest: 'executed-loser-digest',
          abort_module: 'dynamic_field',
          abort_code: 1,
        }),
        snapshot: async () => snapshots.shift(),
      })
    ).rejects.toThrow('expected no state delta for v1.buyer.items')
  })

  test('Sui MoveAbort text retains both module and code', () => {
    const message =
      'MoveAbort(MoveLocation { module: ModuleId { address: 0x1, name: Identifier("zones") }, function: 2 }, 101)'
    expect(parse_move_abort(message)).toEqual({ abort_module: 'zones', abort_code: 101 })
  })

  test('an executed contention abort keeps its burned-gas digest', async () => {
    const values = [[], []]
    const verified = await verify_expected_abort({
      step: {
        expect_abort: {
          do: 'marketplace_buy',
          module: 'dynamic_field',
          abort_code: 1,
          no_digest: false,
          no_state_delta: ['v1.buyer.items'],
        },
      },
      execute: async () => ({
        ok: false,
        digest: 'executed-loser-digest',
        abort_module: 'dynamic_field',
        abort_code: 1,
      }),
      snapshot: async () => values.shift(),
    })
    expect(verified.ok).toBe(true)
  })
})
