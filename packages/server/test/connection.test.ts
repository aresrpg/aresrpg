// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { create_authenticated_connection } from '../src/connection.ts'

const proof = JSON.stringify({ type: 'packet/signature_response', bytes: 'bytes', signature: 'signature' })

describe('websocket admission', () => {
  test('a socket receives a fresh challenge and promotes only after its proof verifies', async () => {
    const sent: unknown[] = []
    let promoted = 0
    const connection = create_authenticated_connection({
      address: '0xowner',
      challenge: 'fresh',
      send: (packet) => void sent.push(packet),
      close: () => undefined,
      verify: async ({ uuid }) => uuid === 'fresh',
      promote: () => {
        promoted += 1
        return { dispatch: () => undefined, on_message: () => undefined, on_close: () => undefined }
      },
    })

    expect(sent).toEqual([{ type: 'packet/signature_request', payload: 'fresh' }])
    expect(promoted).toBe(0)
    await connection.on_message(proof)
    expect(promoted).toBe(1)
    expect(sent.at(-1)).toEqual({ type: 'packet/connection_accepted', address: '0xowner' })
    connection.on_close()
  })

  test('an invalid proof is rejected without creating player state', async () => {
    const closed: string[] = []
    let promoted = false
    const connection = create_authenticated_connection({
      address: '0xowner',
      challenge: 'fresh',
      send: () => undefined,
      close: (_code, reason) => void closed.push(reason ?? ''),
      verify: async () => false,
      promote: () => {
        promoted = true
        return { dispatch: () => undefined, on_message: () => undefined, on_close: () => undefined }
      },
    })

    await connection.on_message(proof)
    expect(promoted).toBeFalse()
    expect(closed).toEqual(['INVALID_SIGNATURE'])
    connection.on_close()
  })

  test('gameplay packets are refused before admission', async () => {
    const closed: string[] = []
    const connection = create_authenticated_connection({
      address: '0xowner',
      challenge: 'fresh',
      send: () => undefined,
      close: (_code, reason) => void closed.push(reason ?? ''),
      verify: async () => true,
      promote: () => ({ dispatch: () => undefined, on_message: () => undefined, on_close: () => undefined }),
    })

    await connection.on_message(
      JSON.stringify({ type: 'packet/track_character', character_id: '0xcharacter', tracked: true })
    )
    expect(closed).toEqual(['INVALID_PACKET'])
    connection.on_close()
  })
})
