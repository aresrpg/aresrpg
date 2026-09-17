// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { get_market_counts } from '../src/reads/get_market_slice.ts'

test('market counts cover every public category and characters outside the active slice', async () => {
  const graph = {
    read: async (query: string) =>
      query.includes('asset:Item')
        ? [
            { category: 'hat', item_type: 'hat_a', count: 2 },
            { category: 'resource', item_type: 'wood', count: 201 },
            { category: 'resource', item_type: 'ore', count: 6 },
          ]
        : [{ count: 3 }],
  }

  expect(await get_market_counts(graph as never)).toEqual({
    categories: { hat: 2, resource: 207 },
    items: { hat_a: 2, wood: 201, ore: 6 },
    characters: 3,
  })
})
