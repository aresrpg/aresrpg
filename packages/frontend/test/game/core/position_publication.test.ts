// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_position_publisher, type PublishedPosition } from '../../../src/game/core/position_publication.ts'

test('an interest change flushes a sub-threshold boundary crossing before the locality request', () => {
  const sent: PublishedPosition[] = []
  const publisher = create_position_publisher({
    send: (_id, position) => {
      sent.push(position)
      return true
    },
    now: () => 100,
  })
  const outside = { checkpoint: 'checkpoint', x: 50.1, y: 0, z: 0, riding: false, gliding: false }
  const inside = { ...outside, x: 49.99 }
  expect(publisher.publish('viewer', outside, 50)).toBe(true)
  expect(publisher.publish('viewer', inside, 50)).toBe(false)
  expect(publisher.publish('viewer', inside, 50, true)).toBe(true)
  expect(sent.map(({ x }) => x)).toEqual([50.1, 49.99])
})

test('a glide transition publishes even with no positional displacement', () => {
  const sent: PublishedPosition[] = []
  let now = 0
  const publisher = create_position_publisher({
    now: () => now,
    send: (_id, position) => {
      sent.push(position)
      return true
    },
  })
  const position = { checkpoint: 'checkpoint', x: 10, y: 20, z: 10, riding: true, gliding: false }
  expect(publisher.publish('rider', position, 50)).toBe(true)
  now = 50
  expect(publisher.publish('rider', { ...position, gliding: true }, 50)).toBe(true)
  now = 100
  expect(publisher.publish('rider', position, 50)).toBe(true)
  expect(sent.map(({ gliding }) => gliding)).toEqual([false, true, false])
})

test('retiring a controlled glider clears remote flags immediately and only once', () => {
  const sent: PublishedPosition[] = []
  const publisher = create_position_publisher({
    now: () => 100,
    send: (_id, position) => {
      sent.push(position)
      return true
    },
  })
  const flying = { checkpoint: 'checkpoint', x: 10, y: 20, z: 30, riding: true, gliding: true }
  publisher.publish('old-character', flying, 50)
  expect(publisher.release('old-character')).toBe(true)
  expect(sent.at(-1)).toEqual({ ...flying, riding: false, gliding: false })
  expect(publisher.release('old-character')).toBe(false)
  expect(publisher.release('unknown')).toBe(false)
  expect(sent).toHaveLength(2)
})
