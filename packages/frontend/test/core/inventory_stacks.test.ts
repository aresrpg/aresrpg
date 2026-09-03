// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import {
  allocate_stack_amount,
  available_inventory_items,
  available_item_stacks,
  coalesced_stack_groups,
  craft_output_stack_plan,
  craft_stack_plan,
  encumbered_asset_ids,
  stack_merge_target,
  trade_stack_targets,
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

describe('inventory stack selection', () => {
  test('new yields merge into the largest unlisted stack', () => {
    const inventory = [stack('small', 3), stack('listed', 100), stack('large', 20)]
    const encumbered = new Set(['listed'])
    expect(stack_merge_target(inventory, encumbered, 'wool')).toBe('large')
    expect(available_item_stacks(inventory, encumbered, 'wool').map(({ id }) => id)).toEqual(['large', 'small'])
  })

  test('non-stackable items never become merge targets', () => {
    expect(stack_merge_target([stack('gear', 1, 'sword')], new Set(), 'wool')).toBeNull()
  })

  test('a transaction targets only stacks inside its selected kiosk', () => {
    const inventory = [stack('other', 100, 'resource', '0xother'), stack('mine', 2, 'resource', '0xmine')]
    expect(stack_merge_target(inventory, new Set(), 'wool', '0xmine')).toBe('mine')
  })

  test('recipe burns cover one requirement across several unlocked stacks exactly', () => {
    expect(allocate_stack_amount([stack('a', 3), stack('b', 5)], 6)).toEqual([
      { item_id: 'a', amount: 3 },
      { item_id: 'b', amount: 3 },
    ])
    expect(allocate_stack_amount([stack('a', 3)], 4)).toBeNull()
  })

  test('split fragments present as one merge plan per item type and kiosk', () => {
    expect(coalesced_stack_groups([stack('a', 3), stack('b', 5)], new Set())).toEqual([
      { target: stack('b', 5), total_amount: 8, source_ids: ['a'] },
    ])
  })

  test('craft preparation merges fragments into one ordered target', () => {
    expect(craft_stack_plan({ wool: 4 }, 2, [stack('small', 3), stack('large', 6)], new Set(), '0xk')).toEqual([
      {
        item_type: 'wool',
        target_id: 'large',
        source_ids: ['small'],
        amount: 8,
        total_amount: 9,
        kiosk: '0xk',
      },
    ])
    expect(craft_stack_plan({ wool: 5 }, 2, [stack('short', 9)], new Set(), '0xk')).toBeNull()
  })

  test('output merge selection reserves worst-case batch capacity', () => {
    const inventory = [stack('full', 4_294_967_000), stack('room', 4_294_966_000)]
    expect(stack_merge_target(inventory, new Set(), 'wool', '0xk', 1_000)).toBe('room')
  })

  test('trade settlement packs only incoming stacks that fit without overflow', () => {
    const target = stack('target', 4_294_967_285)
    const first = { ...stack('first', 6), object: 'first' }
    const second = { ...stack('second', 6), object: 'second' }
    expect(trade_stack_targets([target], new Set(), [first, second] as never)).toEqual({
      first: { id: 'target', kiosk: '0xk', amount: target.amount },
    })
    expect(trade_stack_targets([], new Set(), [first, second] as never)).toEqual({})
  })

  test('an offer removal merges only inside the kiosk that receives it', () => {
    const incoming = { ...stack('incoming', 6, 'resource', '0xmine'), object: 'incoming' }
    expect(
      trade_stack_targets(
        [stack('larger', 100, 'resource', '0xother'), stack('mine', 2, 'resource', '0xmine')],
        new Set(),
        [incoming] as never,
        { same_kiosk: true }
      )
    ).toEqual({ incoming: { id: 'mine', kiosk: '0xmine', amount: 2 } })
  })

  test('an offer replacement merges into the inventory object that will be re-listed', () => {
    const incoming = { ...stack('incoming', 1), object: 'incoming' }
    expect(
      trade_stack_targets([stack('larger', 20), stack('selected', 1)], new Set(), [incoming] as never, {
        same_kiosk: true,
        target_ids: { incoming: 'selected' },
      })
    ).toEqual({ incoming: { id: 'selected', kiosk: '0xk', amount: 1 } })
  })

  test('craft preparation coalesces output dust only when the whole batch fits', () => {
    const inventory = [stack('large', 20), stack('small', 3)]
    expect(craft_output_stack_plan(inventory, new Set(), 'wool', '0xk', 1_000, new Set())).toEqual({
      target_id: 'large',
      source_ids: ['small'],
      kiosk: '0xk',
    })
    expect(craft_output_stack_plan(inventory, new Set(), 'wool', '0xk', 1_000, new Set(['large']))).toEqual({
      target_id: 'small',
      source_ids: [],
      kiosk: '0xk',
    })
  })

  test('market listings and every trade offer share one encumbrance rule', () => {
    const encumbered = encumbered_asset_ids(
      [{ id: 'listed' } as never],
      [{ caps_a: [{ object: 'offered' }], caps_b: [{ object: 'claimed' }] } as never]
    )
    expect([...encumbered].sort()).toEqual(['claimed', 'listed', 'offered'])
    expect(
      available_inventory_items(
        [
          stack('available', 1),
          stack('listed', 1),
          stack('offered', 1),
          stack('other-kiosk', 1, 'resource', '0xother'),
        ],
        encumbered,
        '0xk'
      ).map(({ id }) => id)
    ).toEqual(['available'])
  })
})
