// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { decode_agent_equipment, read_agent_equipment } from '../src/agent_equipment.ts'

// Mainnet GraphQL captured 2026-11-05, object
// 0x00bde1150d4e9ef2eea82559d64b15620e4169d0be5575e50165f09d2f46ca74, version 1011059436.
// Only the consumed slot/item fields are projected from the real EquipmentKey payload.
const item = '0x70d5f3b08b728070a221345bb5a5e52e4d755da6ffc18173e204bc785a276e18'
const captured = { value: { contents: [{ key: 'tool', value: { item } }] } }
test('captured equipment map resolves the exact receiving item and slot', () => {
  expect(decode_agent_equipment(captured)).toEqual([{ slot: 'tool', item_id: item }])
  expect(decode_agent_equipment({ value: { contents: [] } })).toEqual([])
  expect(() => decode_agent_equipment({})).toThrow()
  expect(() => decode_agent_equipment({ value: { contents: [{ key: 'tool', value: { item: 'wrong' } }] } })).toThrow()
})
test('absent equipment follows all pages; failed and cyclic reads do not mean naked', async () => {
  let count = 0
  const core = { listDynamicFields: async () => ({ dynamicFields: [], hasNextPage: ++count === 1, cursor: 'next' }) }
  expect(await read_agent_equipment({ core } as never, '0x1', item)).toEqual([])
  expect(count).toBe(2)
  core.listDynamicFields = async () => ({ dynamicFields: [], hasNextPage: true, cursor: 'same' })
  await expect(read_agent_equipment({ core } as never, '0x1', item)).rejects.toThrow('pagination')
  core.listDynamicFields = async () => {
    throw new Error('offline')
  }
  await expect(read_agent_equipment({ core } as never, '0x1', item)).rejects.toThrow('offline')
})
