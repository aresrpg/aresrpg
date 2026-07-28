// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { courier_inputs } from './world.js'

describe('presence SSE courier rows', () => {
  test('position rows enter the established peer-position fold shape', () => {
    const inputs = courier_inputs({ type: 'position', character: 'character-a', x: -12, z: 44, heading: 1.5 })
    expect(inputs).toEqual([{ type: 'peer_pos', id: 'character-a', x: -12, y: 44, yw: 1.5 }])
  })

  test('chat rows enter chat_received; party rows are receiver-filtered on the current party', () => {
    const inputs = [
      ...courier_inputs({
        type: 'chat',
        character: 'character-a',
        address: 'address-a',
        text: 'hello',
        channel: 'CHAT_GENERAL',
      }),
      ...courier_inputs(
        {
          type: 'chat',
          character: 'character-b',
          address: 'address-b',
          text: 'foreign party',
          channel: 'CHAT_GROUP',
          party: 'party-b',
        },
        'party-a'
      ),
      ...courier_inputs(
        {
          type: 'chat',
          character: 'character-c',
          address: 'address-c',
          text: 'our party',
          channel: 'CHAT_GROUP',
          party: 'party-a',
        },
        'party-a'
      ),
    ]

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
    const inputs = courier_inputs({
      type: 'positions',
      positions: [
        { type: 'position', character: 'a', x: 1, z: 2, heading: 0 },
        { type: 'position', character: 'b', x: 3, z: 4, heading: -1 },
      ],
    })
    expect(inputs.map(({ id }) => id)).toEqual(['a', 'b'])
  })
})
