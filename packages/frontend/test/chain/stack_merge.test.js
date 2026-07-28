// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1495 — every stackable acquisition mints a NEW Item of amount 1 (item.move y54/mint), so a player's bag
// accumulates same-template singletons. These are the two PURE halves of the boot sweep that folds them:
// the PLAN (which duplicates merge into which canonical stack) and the RECEIPT projection (what the chain
// actually merged). No chain, no store, no mocks.

import { describe, expect, test } from 'bun:test'

import { plan_stack_merges, stack_merge_receipt_rows } from '../../src/chain/stack_merge.js'

const row = (over = {}) => ({
  id: '0x1',
  template_id: 't-bread',
  kiosk_id: '0xk1',
  item_category: 'consumable',
  amount: 1,
  stackable: true,
  listed: false,
  ...over,
})

describe('plan_stack_merges — the duplicate sweep plan', () => {
  test('three amount-1 rows of one template collapse into two merges onto ONE canonical target', () => {
    const plan = plan_stack_merges([row({ id: '0xa' }), row({ id: '0xb' }), row({ id: '0xc' })])
    expect(plan).toHaveLength(2)
    expect(new Set(plan.map((m) => m.target_item_id))).toEqual(new Set(['0xa']))
    expect(plan.map((m) => m.source_item_id).sort()).toEqual(['0xb', '0xc'])
    expect(plan.every((m) => m.kiosk_id === '0xk1')).toBe(true)
  })

  test('the canonical is the LARGEST stack (ties break on the lowest id, deterministically)', () => {
    const plan = plan_stack_merges([
      row({ id: '0xa', amount: 1 }),
      row({ id: '0xb', amount: 40 }),
      row({ id: '0xc', amount: 7 }),
    ])
    expect(plan.map((m) => m.target_item_id)).toEqual(['0xb', '0xb'])
    expect(plan.map((m) => m.source_item_id)).toEqual(['0xc', '0xa'])
  })

  test('a lone stack, a non-stackable pair, and a listed duplicate are never planned', () => {
    expect(plan_stack_merges([row({ id: '0xa' })])).toEqual([])
    // two identical GEAR objects are distinct NFTs — item::merge aborts ENotStackable on them
    expect(plan_stack_merges([row({ id: '0xa', stackable: false }), row({ id: '0xb', stackable: false })])).toEqual([])
    // a listed row is marketplace inventory: merging it would need a delist first
    expect(plan_stack_merges([row({ id: '0xa' }), row({ id: '0xb', listed: true })])).toEqual([])
  })

  test('same template in TWO kiosks stays split — the Move door re-locks into ONE kiosk', () => {
    const plan = plan_stack_merges([row({ id: '0xa', kiosk_id: '0xk1' }), row({ id: '0xb', kiosk_id: '0xk2' })])
    expect(plan).toEqual([])
  })

  test('a row without a template id is skipped — never guess a merge the chain would abort', () => {
    const plan = plan_stack_merges([row({ id: '0xa', template_id: null }), row({ id: '0xb', template_id: null })])
    expect(plan).toEqual([])
  })
})

describe('stack_merge_receipt_rows — the chain-proven fold input', () => {
  test('ItemMerged events project to {into, from, total}; other events are ignored', () => {
    const rows = stack_merge_receipt_rows({
      events: [
        { type: '0x2::item::ItemMinted', parsedJson: { item: '0xz' } },
        { type: '0xpkg::item::ItemMerged', parsedJson: { into: '0xa', from: '0xb', added: '1', total: '2' } },
        { type: '0xpkg::item::ItemMerged', parsedJson: { into: '0xa', from: '0xc', added: '1', total: '3' } },
      ],
    })
    expect(rows).toEqual([
      { into: '0xa', from: '0xb', total: 2 },
      { into: '0xa', from: '0xc', total: 3 },
    ])
  })

  test('a receipt with no events yields nothing to fold', () => {
    expect(stack_merge_receipt_rows(null)).toEqual([])
    expect(stack_merge_receipt_rows({ events: [] })).toEqual([])
  })
})
