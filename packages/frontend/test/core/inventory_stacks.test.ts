// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import {
  allocate_stack_amount,
  available_item_stacks,
  coalesced_stack_groups,
  stack_merge_target,
} from '../../src/inventory_stacks.ts'

const stack = (id: string, amount: number, category = 'resource', kiosk = '0xk') => ({
  id,
  amount,
  item_type: 'wool',
  category,
  name: 'Wool',
  level: 1,
  kiosk,
})

const listing = (id: string) => ({ id }) as never

describe('inventory stack selection', () => {
  test('new yields merge into the largest unlisted stack', () => {
    const inventory = [stack('small', 3), stack('listed', 100), stack('large', 20)]
    expect(stack_merge_target(inventory, [listing('listed')], 'wool')).toBe('large')
    expect(available_item_stacks(inventory, [listing('listed')], 'wool').map(({ id }) => id)).toEqual([
      'large',
      'small',
    ])
  })

  test('non-stackable items never become merge targets', () => {
    expect(stack_merge_target([stack('gear', 1, 'sword')], [], 'wool')).toBeNull()
  })

  test('a transaction targets only stacks inside its selected kiosk', () => {
    const inventory = [stack('other', 100, 'resource', '0xother'), stack('mine', 2, 'resource', '0xmine')]
    expect(stack_merge_target(inventory, [], 'wool', '0xmine')).toBe('mine')
  })

  test('recipe burns cover one requirement across several unlocked stacks exactly', () => {
    expect(allocate_stack_amount([stack('a', 3), stack('b', 5)], 6)).toEqual([
      { item_id: 'a', amount: 3 },
      { item_id: 'b', amount: 3 },
    ])
    expect(allocate_stack_amount([stack('a', 3)], 4)).toBeNull()
  })

  test('split fragments present as one merge plan per item type and kiosk', () => {
    expect(coalesced_stack_groups([stack('a', 3), stack('b', 5)], [])).toEqual([
      { target: stack('b', 5), total_amount: 8, source_ids: ['a'] },
    ])
  })
})
