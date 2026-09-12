// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { advance_konami, KONAMI_CODE } from '../../../src/game/core/konami.ts'

test('only the full code unlocks; mistakes and overlapping prefixes recover', () => {
  expect(KONAMI_CODE.reduce(advance_konami, [] as readonly string[])).toEqual(KONAMI_CODE)
  expect(
    [...KONAMI_CODE.slice(0, 4), 'KeyX', ...KONAMI_CODE.slice(4)].reduce(advance_konami, [] as readonly string[])
  ).toEqual([])
  expect(['ArrowUp', ...KONAMI_CODE].reduce(advance_konami, [] as readonly string[])).toEqual(KONAMI_CODE)
})
