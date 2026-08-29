// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { stack_actions } from '../src/stacks.ts'

const digest = '11111111111111111111111111111111'
const receipt = { $kind: 'Transaction', Transaction: { digest } }

const harness = () => {
  const calls: unknown[] = []
  const tx = {
    pure: { id: (value: string) => value },
    moveCall: (call: unknown) => {
      calls.push(call)
      return {} as never
    },
  }
  const sdk = {
    pins: { package: '0xpackage' },
    tx: () => tx,
    door_context: { pin: (_tx: unknown, name: string) => name },
    with_owner_kiosk: (transaction: unknown, _cap: unknown, compose: (kiosk: string, cap: string) => void) => {
      expect(transaction).toBe(tx)
      compose('0xkiosk', '0xcap')
    },
    execute: async () => receipt,
  }
  return { actions: stack_actions(sdk as never, { kiosk_cap: async () => ({}) as never }), calls }
}

describe('stack batch actions', () => {
  test('one deterministic transaction merges every recipe fragment', async () => {
    const { actions, calls } = harness()
    const result = await actions.merge_many([
      { kiosk: '0xkiosk', target_id: 'wool', source_ids: ['wool-a', 'wool-b'] },
      { kiosk: '0xkiosk', target_id: 'water', source_ids: ['water-a'] },
    ])
    expect(result.digest).toBe(digest)
    expect(calls).toHaveLength(3)
  })

  test('an already normalized plan signs nothing', async () => {
    const { actions, calls } = harness()
    expect(await actions.merge_many([{ kiosk: '0xkiosk', target_id: 'wool', source_ids: [] }])).toEqual({
      digest: null,
    })
    expect(calls).toHaveLength(0)
  })

  test('a source cannot appear twice', async () => {
    const { actions } = harness()
    await expect(
      actions.merge_many([
        { kiosk: '0xkiosk', target_id: 'wool', source_ids: ['dust'] },
        { kiosk: '0xkiosk', target_id: 'water', source_ids: ['dust'] },
      ])
    ).rejects.toThrow('reuses an object')
  })

  test('normalization stays below the PTB command ceiling', async () => {
    const { actions } = harness()
    await expect(
      actions.merge_many([
        {
          kiosk: '0xkiosk',
          target_id: 'target',
          source_ids: Array.from({ length: 1_001 }, (_, index) => `source-${index}`),
        },
      ])
    ).rejects.toThrow('cannot exceed 1000 merges')
  })
})
