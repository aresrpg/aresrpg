// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { get_item_row } from '../../src/reads/get_item_row.ts'

test('the item stream preserves the exact projected object version', async () => {
  const props = {
    id: '0xitem',
    version: '9007199254740993',
    name: 'Wool',
    item_type: 'wool',
    category: 'resource',
    level: 1,
    amount: 3,
  }
  const graph = { read: async () => [{ item: { properties: props }, kiosk: '0xkiosk' }] }
  expect(await get_item_row(graph as never, { id: props.id })).toEqual({ ...props, kiosk: '0xkiosk' })
})
