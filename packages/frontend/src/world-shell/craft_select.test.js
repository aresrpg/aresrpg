// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Burn-tally regression for the craft ingredient selector. crafting::craft burns WHOLE stacks and requires the
// tally to land EXACT (EIngredientOverSupply on any over-large stack, EMissingIngredient on a shortfall), and
// item::split is public(package) — the client cannot split. So the selector MUST pick a subset summing exactly
// to each ingredient's need, out of the ONE kiosk the craft runs in (#1494). Pure functions, zero mocks.

import { describe, expect, it } from 'bun:test'

import { exact_subset, select_ingredients } from './craft_select.js'

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

describe('exact_subset', () => {
  it('a single stack that equals the target', () => {
    expect(exact_subset([stack('a', 2)], 2)).toEqual(['a'])
  })

  it('two unit stacks that sum to the target', () => {
    const picked = exact_subset([stack('a', 1), stack('b', 1)], 2)
    expect(picked).not.toBeNull()
    expect(sum(picked, { a: 1, b: 1 })).toBe(2)
  })

  it('REFUSES when the only stack is larger than the need (no split door)', () => {
    // The QA hazard: a single crude_branch stack of 3, recipe needs 2 → no exact subset, must refuse.
    expect(exact_subset([stack('a', 3)], 2)).toBeNull()
  })

  it('prefers the exact stack over an over-large one', () => {
    expect(exact_subset([stack('big', 3), stack('exact', 2)], 2)).toEqual(['exact'])
  })

  it('finds a single large stack that greedy-ascending would miss', () => {
    // stacks [1,3], target 3 → the [3] alone (not the [1]); a naive ascending accumulate would stall at 1.
    expect(exact_subset([stack('one', 1), stack('three', 3)], 3)).toEqual(['three'])
  })

  it('empty stacks / non-positive target → null', () => {
    expect(exact_subset([], 2)).toBeNull()
    expect(exact_subset([stack('a', 2)], 0)).toBeNull()
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

  it('picks an exact subset within the crafting kiosk, ignoring a sibling kiosk stack', () => {
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

  it('refuses (not wrong_kiosk) when no kiosk can satisfy the tally', () => {
    // A single over-large stack in each kiosk: no exact subset anywhere, so this is a materials refusal.
    const items = [row('a', 'crude_branch', 3, 'K1', 'C1'), row('b', 'crude_branch', 3, 'K2', 'C2')]
    expect(select_ingredients(items, [{ id: 'crude_branch', qty: 2 }], 'K1')).toBeNull()
  })

  it('ignores rows with no kiosk cap (unusable)', () => {
    const items = [{ id: 'x', item_type: 'crude_branch', amount: 2, kiosk_id: 'K1', kiosk_cap_id: null }]
    expect(select_ingredients(items, [{ id: 'crude_branch', qty: 2 }], 'K1')).toBeNull()
  })
})
