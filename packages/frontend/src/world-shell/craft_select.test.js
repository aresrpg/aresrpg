// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Burn-tally regression for the craft ingredient selector. crafting::craft burns WHOLE stacks and requires the
// tally to land EXACT (EIngredientOverSupply on any over-large stack, EMissingIngredient on a shortfall), and
// item::split is public(package) — the client cannot split. So the selector MUST pick a subset summing exactly
// to each ingredient's need, all within ONE kiosk, or refuse. Pure functions, zero mocks.

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
  it('the golden path: crude_branch×2 from two unit stacks in one kiosk', () => {
    const items = [row('i1', 'crude_branch', 1), row('i2', 'crude_branch', 1)]
    const sel = select_ingredients(items, [{ id: 'crude_branch', qty: 2 }])
    expect(sel).not.toBeNull()
    expect(sel.kiosk_id).toBe('K1')
    expect(sel.personal_kiosk_cap_id).toBe('C1')
    expect([...sel.input_item_ids].sort()).toEqual(['i1', 'i2'])
  })

  it('a single stack of exactly the needed amount', () => {
    const sel = select_ingredients([row('x', 'crude_branch', 2)], [{ id: 'crude_branch', qty: 2 }])
    expect(sel.input_item_ids).toEqual(['x'])
  })

  it('multi-ingredient recipe, all satisfiable in the same kiosk', () => {
    const items = [row('o1', 'iron_ore', 2), row('w1', 'oak_wood', 1)]
    const sel = select_ingredients(items, [
      { id: 'iron_ore', qty: 2 },
      { id: 'oak_wood', qty: 1 },
    ])
    expect([...sel.input_item_ids].sort()).toEqual(['o1', 'w1'])
  })

  it('picks the kiosk that CAN satisfy exactly (skips the one that cannot)', () => {
    // K1 holds only a 1-stack (short), K2 holds an exact 2-stack → must select from K2.
    const items = [row('a', 'crude_branch', 1, 'K1', 'C1'), row('b', 'crude_branch', 2, 'K2', 'C2')]
    const sel = select_ingredients(items, [{ id: 'crude_branch', qty: 2 }])
    expect(sel.kiosk_id).toBe('K2')
    expect(sel.input_item_ids).toEqual(['b'])
  })

  it('refuses when no single kiosk can satisfy every ingredient exactly', () => {
    // iron_ore in K1, oak_wood in K2 — no single kiosk has both (the craft borrows ONE kiosk).
    const items = [row('o', 'iron_ore', 2, 'K1', 'C1'), row('w', 'oak_wood', 1, 'K2', 'C2')]
    expect(
      select_ingredients(items, [
        { id: 'iron_ore', qty: 2 },
        { id: 'oak_wood', qty: 1 },
      ])
    ).toBeNull()
  })

  it('refuses when the ingredient is missing entirely', () => {
    expect(select_ingredients([row('x', 'sword', 1)], [{ id: 'crude_branch', qty: 2 }])).toBeNull()
  })

  it('ignores rows with no kiosk cap (unusable)', () => {
    const items = [{ id: 'x', item_type: 'crude_branch', amount: 2, kiosk_id: 'K1', kiosk_cap_id: null }]
    expect(select_ingredients(items, [{ id: 'crude_branch', qty: 2 }])).toBeNull()
  })
})
