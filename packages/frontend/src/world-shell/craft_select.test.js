// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Burn-tally regression for the craft ingredient selector. crafting::craft consumes min(need, amount) per stack
// and AUTO-SPLITS an over-large one (surplus re-locked), so a bag satisfies a recipe iff the owned amounts SUM
// to the requirement per ingredient — out of the ONE kiosk the craft runs in (#1494). #1604: the selector used
// to demand an EXACT tally and refused the merged single stack the world-load sweep produces. Zero mocks.

import { describe, expect, it } from 'bun:test'

import { covering_stacks, select_ingredients } from './craft_select.js'

const stack = (id, amount) => ({ id, amount })
// s.sui.items row (read_staking shape) — only the fields the selector reads.
const row = (id, item_type, amount, kiosk_id = 'K1', kiosk_cap_id = 'C1') => ({
  id,
  item_type,
  amount,
  kiosk_id,
  kiosk_cap_id,
})
const sum = (ids, by) => ids.reduce((s, id) => s + by[id], 0)

describe('covering_stacks', () => {
  it('a single stack that equals the target', () => {
    expect(covering_stacks([stack('a', 2)], 2)).toEqual(['a'])
  })

  it('two unit stacks that sum to the target', () => {
    const picked = covering_stacks([stack('a', 1), stack('b', 1)], 2)
    expect(picked).not.toBeNull()
    expect(sum(picked, { a: 1, b: 1 })).toBe(2)
  })

  it('ACCEPTS a stack larger than the need — the chain splits the surplus and re-locks it', () => {
    expect(covering_stacks([stack('a', 3)], 2)).toEqual(['a'])
  })

  it('takes the fewest objects that cover the need (no redundant input)', () => {
    // Biggest-first, stopping at coverage: the 3-stack alone covers 2, so the 1-stack is never supplied — a
    // stack for an already-satisfied ingredient is exactly what EIngredientOverSupply aborts on.
    expect(covering_stacks([stack('big', 3), stack('small', 1)], 2)).toEqual(['big'])
  })

  it('sums across stacks when no single one covers the need', () => {
    const picked = covering_stacks([stack('one', 1), stack('two', 2)], 3)
    expect(picked.sort()).toEqual(['one', 'two'])
  })

  it('refuses when the owned total is short', () => {
    expect(covering_stacks([stack('a', 1), stack('b', 1)], 3)).toBeNull()
  })

  it('empty stacks / non-positive target → null', () => {
    expect(covering_stacks([], 2)).toBeNull()
    expect(covering_stacks([stack('a', 2)], 0)).toBeNull()
  })
})

describe('select_ingredients', () => {
  it('the golden path: crude_branch×2 from two unit stacks in the crafting kiosk', () => {
    const items = [row('i1', 'crude_branch', 1), row('i2', 'crude_branch', 1)]
    const sel = select_ingredients(items, [{ id: 'crude_branch', qty: 2 }], 'K1')
    expect(sel).not.toBeNull()
    expect(sel.input_items.map((item) => item.id).sort()).toEqual(['i1', 'i2'])
    expect(sel.input_items.every((item) => item.kiosk_id === 'K1' && item.kiosk_cap_id === 'C1')).toBe(true)
  })

  it('a single stack of exactly the needed amount', () => {
    const sel = select_ingredients([row('x', 'crude_branch', 2)], [{ id: 'crude_branch', qty: 2 }], 'K1')
    expect(sel.input_items.map((item) => item.id)).toEqual(['x'])
  })

  it('multi-ingredient recipe, all satisfiable in the crafting kiosk', () => {
    const items = [row('o1', 'iron_ore', 2), row('w1', 'oak_wood', 1)]
    const sel = select_ingredients(
      items,
      [
        { id: 'iron_ore', qty: 2 },
        { id: 'oak_wood', qty: 1 },
      ],
      'K1'
    )
    expect(sel.input_items.map((item) => item.id).sort()).toEqual(['o1', 'w1'])
  })

  it('covers the need within the crafting kiosk, ignoring a sibling kiosk stack', () => {
    // K1 holds a 1-stack and a 2-stack; the sibling K2 stack is unreachable for the craft.
    const items = [
      row('a', 'crude_branch', 1, 'K1', 'C1'),
      row('b', 'crude_branch', 2, 'K1', 'C1'),
      row('c', 'crude_branch', 2, 'K2', 'C2'),
    ]
    const sel = select_ingredients(items, [{ id: 'crude_branch', qty: 2 }], 'K1')
    expect(sel.input_items).toEqual([items[1]])
  })

  // #1494: the chain burns every ingredient out of the ONE crafting kiosk, so a recipe that only balances by
  // reaching into a sibling kiosk is NOT craftable — and that is a different refusal from "you lack materials".
  it('reports wrong_kiosk when the recipe only balances across two kiosks', () => {
    const items = [row('o', 'iron_ore', 2, 'K1', 'C1'), row('w', 'oak_wood', 1, 'K2', 'C2')]
    const sel = select_ingredients(
      items,
      [
        { id: 'iron_ore', qty: 2 },
        { id: 'oak_wood', qty: 1 },
      ],
      'K1'
    )
    expect(sel).toEqual({ error: 'wrong_kiosk' })
  })

  it('reports wrong_kiosk when every stack sits in a sibling kiosk', () => {
    const items = [row('a', 'crude_branch', 2, 'K2', 'C2')]
    expect(select_ingredients(items, [{ id: 'crude_branch', qty: 2 }], 'K1')).toEqual({ error: 'wrong_kiosk' })
  })

  it('refuses when the ingredient is missing entirely', () => {
    expect(select_ingredients([row('x', 'sword', 1)], [{ id: 'crude_branch', qty: 2 }], 'K1')).toBeNull()
  })

  it('refuses (not wrong_kiosk) when the whole bag is short of the tally', () => {
    // Short in each kiosk AND short across both: a genuine materials refusal, not a custody one.
    const items = [row('a', 'crude_branch', 1, 'K1', 'C1'), row('b', 'crude_branch', 1, 'K2', 'C2')]
    expect(select_ingredients(items, [{ id: 'crude_branch', qty: 3 }], 'K1')).toBeNull()
  })

  // #1604 — the chain SPLITS an over-large ingredient stack and re-locks the surplus (crafting.move y18), so the
  // post-auto-merge bag shape (ONE stack per resource, see chain/stack_merge.js) is craftable, not a refusal.
  it('a single merged stack covers a smaller requirement (the chain splits the surplus)', () => {
    const items = [row('merged', 'crude_branch', 20)]
    const sel = select_ingredients(items, [{ id: 'crude_branch', qty: 3 }], 'K1')
    expect(sel.input_items.map((item) => item.id)).toEqual(['merged'])
  })

  it('sums across stacks when no single stack covers the need', () => {
    const items = [row('a', 'crude_branch', 2), row('b', 'crude_branch', 1)]
    const sel = select_ingredients(items, [{ id: 'crude_branch', qty: 3 }], 'K1')
    expect(sel.input_items.map((item) => item.id).sort()).toEqual(['a', 'b'])
  })

  it('refuses when the owned total is short of the requirement', () => {
    const items = [row('a', 'crude_branch', 1), row('b', 'crude_branch', 1)]
    expect(select_ingredients(items, [{ id: 'crude_branch', qty: 3 }], 'K1')).toBeNull()
  })

  it('ignores rows with no kiosk cap (unusable)', () => {
    const items = [{ id: 'x', item_type: 'crude_branch', amount: 2, kiosk_id: 'K1', kiosk_cap_id: null }]
    expect(select_ingredients(items, [{ id: 'crude_branch', qty: 2 }], 'K1')).toBeNull()
  })
})
