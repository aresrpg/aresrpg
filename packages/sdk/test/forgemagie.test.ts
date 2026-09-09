// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { scribe_losses } from '../src/forgemagie.ts'
import fixture from '../../indexer/tests/forgemagie.localnet.json'

test('captured forging losses retain the fixed stat order and exact amounts', () => {
  const losses = scribe_losses(fixture.parsed_json)
  expect(losses).toEqual([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  expect(Object.isFrozen(losses)).toBe(true)
})

test('malformed forging loss vectors cannot enter inventory folding', () => {
  for (const lost_amounts of [null, [], Array(14).fill('0'), Array(16).fill('0')])
    expect(() => scribe_losses({ lost_amounts })).toThrow('invalid stat-loss vector')
  for (const invalid of ['-1', '1.5', '9007199254740993'])
    expect(() => scribe_losses({ lost_amounts: [invalid, ...Array(14).fill('0')] })).toThrow('invalid')
})
