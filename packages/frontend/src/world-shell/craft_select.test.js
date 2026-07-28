// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Burn-tally regression for the craft ingredient selector. crafting::craft burns WHOLE stacks and requires the
// tally to land EXACT (EIngredientOverSupply on any over-large stack, EMissingIngredient on a shortfall), and
// item::split is public(package) — the client cannot split. So the selector MUST pick a subset summing exactly
// to each ingredient's need and preserve each selected row's own kiosk custody. Pure functions, zero mocks.

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
    expect(sel.input_items.map((item) => item.id).sort()).toEqual(['i1', 'i2'])
    expect(sel.input_items.every((item) => item.kiosk_id === 'K1' && item.kiosk_cap_id === 'C1')).toBe(true)
  })

  it('a single stack of exactly the needed amount', () => {
    const sel = select_ingredients([row('x', 'crude_branch', 2)], [{ id: 'crude_branch', qty: 2 }])
    expect(sel.input_items.map((item) => item.id)).toEqual(['x'])
  })

  it('multi-ingredient recipe, all satisfiable in the same kiosk', () => {
    const items = [row('o1', 'iron_ore', 2), row('w1', 'oak_wood', 1)]
    const sel = select_ingredients(items, [
      { id: 'iron_ore', qty: 2 },
      { id: 'oak_wood', qty: 1 },
    ])
    expect(sel.input_items.map((item) => item.id).sort()).toEqual(['o1', 'w1'])
  })

  it('picks an exact subset across the whole owned bag', () => {
    // K1 holds only a 1-stack, K2 holds an exact 2-stack → the exact K2 stack wins.
    const items = [row('a', 'crude_branch', 1, 'K1', 'C1'), row('b', 'crude_branch', 2, 'K2', 'C2')]
    const sel = select_ingredients(items, [{ id: 'crude_branch', qty: 2 }])
    expect(sel.input_items).toEqual([items[1]])
  })

  it('preserves each ingredient own kiosk when a recipe spans two kiosks', () => {
    const items = [row('o', 'iron_ore', 2, 'K1', 'C1'), row('w', 'oak_wood', 1, 'K2', 'C2')]
    const sel = select_ingredients(items, [
      { id: 'iron_ore', qty: 2 },
      { id: 'oak_wood', qty: 1 },
    ])
    expect(sel.input_items).toEqual(items)
  })

  it('refuses when the ingredient is missing entirely', () => {
    expect(select_ingredients([row('x', 'sword', 1)], [{ id: 'crude_branch', qty: 2 }])).toBeNull()
  })

  it('ignores rows with no kiosk cap (unusable)', () => {
    const items = [{ id: 'x', item_type: 'crude_branch', amount: 2, kiosk_id: 'K1', kiosk_cap_id: null }]
    expect(select_ingredients(items, [{ id: 'crude_branch', qty: 2 }])).toBeNull()
  })
})
