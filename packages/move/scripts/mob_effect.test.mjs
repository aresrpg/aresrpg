// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { mobEffect } from './mob_effect.mjs'

const bandedMobEffect = {
  kind: 0,
  op: 'damage',
  element: 'earth',
  base: 1,
  damageMin: 1,
  damageMax: 3,
}

const captureEffect = (row) => {
  const calls = []
  const pure = {
    u8: (value) => value,
    u64: (value) => value,
  }
  const tx = {
    pure,
    moveCall: (call) => {
      calls.push(call)
      return call
    },
  }
  mobEffect(tx, '0xfoundation', row)
  return calls.at(-1)
}

describe('mobEffect — authored corpus bands survive the phase-5 wire builder', () => {
  test('Alley Bunny Kick keeps both damageMin and damageMax endpoints', () => {
    const effect = captureEffect(bandedMobEffect)
    expect(effect.target).toBe(
      '0xfoundation::spell_effect::new_effect_ranged'
    )
    expect(effect.arguments.slice(2, 4)).toEqual([1, 3])
    expect(effect.arguments).toHaveLength(12)
  })
})
