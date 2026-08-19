// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { UNDERWATER, is_submerged } from '../src/underwater.ts'

const GRAZING = UNDERWATER.hysteresis_m / 2

test('immersion follows the waterline with a flicker-free dead band and a hard dry exit', () => {
  const cases: readonly {
    why: string
    eye: number
    liquid: number | null
    previous: boolean
    submerged: boolean
  }[] = [
    { why: 'the eye submerges past the band', eye: -0.5, liquid: 0, previous: false, submerged: true },
    { why: 'the eye surfaces past the band', eye: 0.5, liquid: 0, previous: true, submerged: false },
    { why: 'the dead band holds a dry eye dry', eye: -GRAZING, liquid: 0, previous: false, submerged: false },
    { why: 'the dead band holds a wet eye wet', eye: GRAZING, liquid: 0, previous: true, submerged: true },
    { why: 'no water over the eye is a hard exit', eye: -10, liquid: null, previous: true, submerged: false },
    { why: 'an absolute authored height submerges', eye: 59.5, liquid: 60, previous: false, submerged: true },
    { why: 'an absolute authored height surfaces', eye: 60.5, liquid: 60, previous: true, submerged: false },
  ]

  cases.forEach(({ why, eye, liquid, previous, submerged }) => {
    expect(is_submerged(eye, liquid, previous), why).toBe(submerged)
  })
})
