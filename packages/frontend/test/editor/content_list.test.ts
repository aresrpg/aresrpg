// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import {
  content_navigation_domains,
  filter_content_rows,
  find_selected_row,
  item_category_rows,
  order_content_rows,
  reordered_spell_levels,
  row_address,
} from '../../src/editor/content_list.ts'
import { replace_json_value, type SeedEntityRow } from '../../src/editor/seed_editor.ts'

const row = (id: string, name: string, category: string, level: number): SeedEntityRow =>
  Object.freeze({ id, label: name, path: Object.freeze([]), value: Object.freeze({ name, category, level }) })

test('recipes stay loaded data, and items order by level then name beside a category column', () => {
  expect(content_navigation_domains.map(({ id }) => id)).not.toContain('recipes')

  const rows = [row('late', 'Zulu', 'staff', 80), row('alpha', 'Alpha', 'sword', 10), row('beta', 'Beta', 'sword', 10)]
  expect(order_content_rows('items', rows).map(({ id }) => id)).toEqual(['alpha', 'beta', 'late'])
  expect(item_category_rows(rows)).toEqual([
    { category: 'staff', count: 1 },
    { category: 'sword', count: 2 },
  ])
})

const spell = (index: number, name: string, unlock_level: number): SeedEntityRow =>
  Object.freeze({ id: name, label: name, path: Object.freeze([index]), value: Object.freeze({ name, unlock_level }) })

test('dragging a spell re-stamps the class ladder instead of storing an order', () => {
  // the ladder (1, 6, 21, 42) never changes — only which spell sits on each rung
  const rows = [spell(7, 'a', 1), spell(3, 'b', 6), spell(9, 'c', 21), spell(4, 'd', 42)]

  // last spell dragged to the front: it takes level 1, everyone else slides one rung up
  expect(reordered_spell_levels(rows, 3, 0)).toEqual({ 4: 1, 7: 6, 3: 21, 9: 42 })
  // a one-step swap touches only the two rows it moves
  expect(reordered_spell_levels(rows, 1, 2)).toEqual({ 9: 6, 3: 21 })
  // a move inside a tie group changes no level at all
  expect(reordered_spell_levels([spell(0, 'a', 1), spell(1, 'b', 1)], 0, 1)).toBeNull()
  expect(reordered_spell_levels(rows, 2, 2)).toBeNull()
  expect(reordered_spell_levels(rows, 0, 9)).toBeNull()
})

test('selection survives renaming the spell it points at', () => {
  const rows = [spell(0, 'fireball', 1), spell(1, 'heal', 6)]
  const address = row_address(rows[1]!)

  // editing the name re-derives every label id — the address must not move
  const renamed = Object.freeze({
    ...rows[1]!,
    id: 'greater_heal',
    label: 'greater_heal',
    value: replace_json_value(rows[1]!.value, ['name'], 'greater_heal'),
  })
  expect(find_selected_row([rows[0]!, renamed], address)).toBe(renamed)

  // the same label under two classes stays two distinct addresses
  const twin_a = Object.freeze({ ...rows[0]!, path: Object.freeze(['drops', 0]) })
  const twin_b = Object.freeze({ ...rows[0]!, path: Object.freeze(['giftcards', 0]) })
  expect(row_address(twin_a)).not.toBe(row_address(twin_b))
  expect(find_selected_row([twin_a, twin_b], row_address(twin_b))).toBe(twin_b)
  expect(find_selected_row(rows, null)).toBeUndefined()
})

test('class and query filters compose without fighting each other', () => {
  const senshi = Object.freeze({ ...spell(0, 'slash', 1), value: Object.freeze({ name: 'slash', classe: 'senshi' }) })
  const mystic = Object.freeze({ ...spell(1, 'slash', 6), value: Object.freeze({ name: 'slash', classe: 'mystic' }) })
  const other = Object.freeze({ ...spell(2, 'heal', 6), value: Object.freeze({ name: 'heal', classe: 'mystic' }) })

  expect(filter_content_rows([senshi, mystic, other], '', null, 'mystic').map(({ id }) => id)).toEqual([
    'slash',
    'heal',
  ])
  expect(filter_content_rows([senshi, mystic, other], 'HEAL', null, 'mystic').map(({ id }) => id)).toEqual(['heal'])
  expect(filter_content_rows([senshi, mystic, other], 'slash', null, 'senshi').map(({ id }) => id)).toEqual(['slash'])
})
