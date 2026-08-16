// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { get_character_owner } from '../src/reads/get_character_owner.ts'

describe('derived-character recipient lookup', () => {
  test('returns the indexed current owner for a client-derived character id', async () => {
    let params: Record<string, unknown> | undefined
    const graph = {
      read: async (_query: string, input?: Record<string, string | number | boolean>) => {
        params = input
        return [{ character_id: '0xcharacter', name: 'aiden', owner: '0xowner' }]
      },
      close: async () => undefined,
    }

    expect(await get_character_owner(graph, { character_id: '0xcharacter' })).toEqual({
      character_id: '0xcharacter',
      name: 'aiden',
      owner: '0xowner',
    })
    expect(params).toEqual({ character_id: '0xcharacter' })
  })

  test('does not return a character without a current custody owner', async () => {
    const graph = { read: async () => [], close: async () => undefined }
    expect(await get_character_owner(graph, { character_id: '0xmissing' })).toBeNull()
  })
})
