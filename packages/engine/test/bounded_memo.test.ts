// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { create_bounded_memo } from '../src/bounded_memo.ts'

test('bounded memo evicts old history without flushing recent locality', () => {
  const memo = create_bounded_memo<string, object>(2)
  const first = {}
  const second = {}
  const third = {}

  expect(memo.get('first', () => first)).toBe(first)
  expect(memo.get('second', () => second)).toBe(second)
  expect(memo.get('first', () => third)).toBe(first)
  expect(memo.get('third', () => third)).toBe(third)
  expect(memo.get('second', () => first)).toBe(second)
  expect(memo.get('first', () => third)).toBe(third)
})
