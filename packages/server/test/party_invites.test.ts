// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { get_party_invites } from '../src/reads/get_party.ts'

test('incoming party invitations are bounded before roster enrichment', async () => {
  let query = ''
  const rows = await get_party_invites(
    {
      read: async (cypher: string) => {
        query = cypher
        return []
      },
    } as never,
    { character_id: '0xc' }
  )
  expect(rows).toEqual([])
  expect(query).toContain('WITH DISTINCT p ORDER BY p.ckpt DESC LIMIT 50')
  expect(query.indexOf('LIMIT 50')).toBeLessThan(query.indexOf('OPTIONAL MATCH'))
})
