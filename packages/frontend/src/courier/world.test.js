// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { ingest_courier_event } from './world.js'

describe('presence SSE courier rows', () => {
  test('position rows enter the established peer-position fold shape', () => {
    const inputs = []
    ingest_courier_event({ type: 'position', character: 'character-a', x: -12, z: 44, heading: 1.5 }, (input) =>
      inputs.push(input)
    )
    expect(inputs).toEqual([{ type: 'peer_pos', id: 'character-a', x: -12, y: 44, yw: 1.5 }])
  })

  test('chat rows enter chat_received; party rows are receiver-filtered on the current party', () => {
    const inputs = []
    const input = (row) => inputs.push(row)
    ingest_courier_event(
      {
        type: 'chat',
        character: 'character-a',
        address: 'address-a',
        text: 'hello',
        channel: 'CHAT_GENERAL',
      },
      input
    )
    ingest_courier_event(
      {
        type: 'chat',
        character: 'character-b',
        address: 'address-b',
        text: 'foreign party',
        channel: 'CHAT_GROUP',
        party: 'party-b',
      },
      input,
      'party-a'
    )
    ingest_courier_event(
      {
        type: 'chat',
        character: 'character-c',
        address: 'address-c',
        text: 'our party',
        channel: 'CHAT_GROUP',
        party: 'party-a',
      },
      input,
      'party-a'
    )

    expect(inputs).toEqual([
      {
        type: 'chat_received',
        row: {
          id: 'character-a',
          message: 'hello',
          address: 'address-a',
          name: '',
          channel: 'CHAT_GENERAL',
          target: '',
        },
      },
      {
        type: 'chat_received',
        row: {
          id: 'character-c',
          message: 'our party',
          address: 'address-c',
          name: '',
          channel: 'CHAT_GROUP',
          target: '',
        },
      },
    ])
  })

  test('an initial registry snapshot folds every live position', () => {
    const inputs = []
    ingest_courier_event(
      {
        type: 'positions',
        positions: [
          { type: 'position', character: 'a', x: 1, z: 2, heading: 0 },
          { type: 'position', character: 'b', x: 3, z: 4, heading: -1 },
        ],
      },
      (input) => inputs.push(input)
    )
    expect(inputs.map(({ id }) => id)).toEqual(['a', 'b'])
  })
})
