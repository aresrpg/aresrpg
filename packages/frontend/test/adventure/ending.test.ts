// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { adventure_ending_frame } from '../../src/adventure/ending.ts'

test('victory stays clear before poison builds, and both deaths start only after the blur finishes', () => {
  expect(adventure_ending_frame(0)).toEqual({ blur: 0, dying: false })
  expect(adventure_ending_frame(2_200)).toEqual({ blur: 0, dying: false })
  expect(adventure_ending_frame(3_800)).toEqual({ blur: 2, dying: false })
  expect(adventure_ending_frame(5_400)).toEqual({ blur: 4, dying: true })
  expect(adventure_ending_frame(60_000)).toEqual({ blur: 4, dying: true })
})
