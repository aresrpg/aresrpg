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
  const outside = { checkpoint: 'checkpoint', x: 50.1, y: 0, z: 0, riding: false }
  const inside = { ...outside, x: 49.99 }
  expect(publisher.publish('viewer', outside, 50)).toBe(true)
  expect(publisher.publish('viewer', inside, 50)).toBe(false)
  expect(publisher.publish('viewer', inside, 50, true)).toBe(true)
  expect(sent.map(({ x }) => x)).toEqual([50.1, 49.99])
})
