// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { get_closable_fights } from '../src/reads/get_closable_fights.ts'

test('fight close recovery is scoped through the participant relation', async () => {
  const reads: { cypher: string; params: Record<string, unknown> }[] = []
  const fights = await get_closable_fights(
    {
      read: async (cypher: string, params: Record<string, unknown>) => {
        reads.push({ cypher, params })
        return [
          { fight: '0xf1', kolizeum: null },
          { fight: '0xf2', kolizeum: '0xk2' },
        ]
      },
    } as never,
    { address: '0xme' }
  )

  expect(fights).toEqual([
    { fight: '0xf1', kolizeum: null },
    { fight: '0xf2', kolizeum: '0xk2' },
  ])
  expect(reads[0]).toMatchObject({ params: { address: '0xme' } })
  expect(reads[0]?.cypher).toContain('CLOSABLE_FOR')
  expect(reads[0]?.cypher).toContain('Kolizeum')
})
