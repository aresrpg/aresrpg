// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { AgentInventoryItem } from '@aresrpg/sdk/agent-inventory'

import {
  selected_transfer_items,
  coin_transfer_intent,
  agent_inventory_groups,
} from '../../src/agents/inventory_transfer.ts'

const row = (id: string, amount: number, kiosk = 'kiosk'): AgentInventoryItem => ({
  item: { id, amount, kiosk, version: '1', item_type: 'wheat', name: 'Wheat', category: 'resource', level: 1 },
  status: 'available',
})
test('dragging a visual stack expands all exact members without crossing kiosks', () => {
  const rows = [row('small', 2), row('large', 5), row('other', 3, 'another')]
  const result = selected_transfer_items(rows, ['large'])
  expect(result?.map(({ item_id }) => item_id)).toEqual(['small', 'large'])
  expect(result?.every(({ version, kiosk }) => version === '1' && kiosk === 'kiosk')).toBe(true)
  expect(selected_transfer_items(rows, ['large', 'other'])?.length).toBe(3)
})
test('missing, locked or versionless selections refuse the complete group instead of a subset', () => {
  const rows = [row('a', 2), { ...row('locked', 1, 'listed'), status: 'listed' as const }]
  expect(selected_transfer_items(rows, ['a', 'locked'])).toBeNull()
  expect(selected_transfer_items(rows, ['a', 'gone'])).toBeNull()
  expect(
    selected_transfer_items([{ ...row('a', 2), item: { ...row('a', 2).item, version: undefined } }], ['a'])
  ).toBeNull()
  expect(selected_transfer_items(rows, [])).toBeNull()
})
test('equipped selections preserve their current character and slot for SDK revalidation', () => {
  const equipped = {
    ...row('hat', 1),
    item: { ...row('hat', 1).item, category: 'hat' },
    status: 'equipped' as const,
    character_id: 'character',
    slot: 'hat',
  }
  expect(selected_transfer_items([equipped], ['hat'])?.[0]).toMatchObject({
    item_id: 'hat',
    character_id: 'character',
    slot: 'hat',
  })
})
test('coin inputs bind exact amounts, sender balance, recipient and retained source reserve', () => {
  const input = { token: 'sui' as const, amount: '0.000000001', reserve: '0', balance: 2n, recipient: 'agent' }
  expect(coin_transfer_intent(input)).toMatchObject({
    items: [],
    recipient: 'agent',
    sui_mist: '1',
    kares_mist: '0',
    reserve_mist: '0',
  })
  expect(coin_transfer_intent({ ...input, token: 'kares' })).toMatchObject({ sui_mist: '0', kares_mist: '1' })
  for (const amount of ['0', '-1', '1e3', '0.0000000001', '0.000000003'])
    expect(coin_transfer_intent({ ...input, amount })).toBeNull()
  expect(coin_transfer_intent({ ...input, balance: null })).toBeNull()
  expect(coin_transfer_intent({ ...input, reserve: '-1' })).toBeNull()
})

test('locked fragments never inflate movable cells or their transferred quantity', () => {
  const rows = [row('small', 2), row('large', 5), { ...row('locked', 9), exclusive: true }]
  const groups = agent_inventory_groups(rows)
  expect(groups.map(({ item, amount, locked }) => [item.id, amount, locked])).toEqual([
    ['large', 7, false],
    ['locked', 9, true],
  ])
  expect(selected_transfer_items(rows, ['large'])?.map(({ item_id }) => item_id)).toEqual(['small', 'large'])
  expect(selected_transfer_items(rows, ['locked'])).toBeNull()
  expect(groups[1]?.status).toBe('reserved')
})
