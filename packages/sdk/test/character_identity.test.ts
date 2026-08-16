// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { character_claim_id, character_id, normalize_character_name } from '../src/character.ts'

describe('derived character identity', () => {
  test('matches the Sui derived-object address for registry + lowercase String', () => {
    expect(character_id('0x2', '  AiDeN  ')).toBe('0x55b378d77ba06f8f5822d4b4f16ae3eb8b565ca0e9853b1bda4ff6d8935abce9')
  })

  test('derives the permanent framework claim marker without a lookup', () => {
    expect(character_claim_id('0x2', 'aiden')).toBe(
      '0xd00bfc963baa398d636f64bad0a43e46b9b368836dcbda1c7c1026e247f7c2d3'
    )
  })

  test('applies the same ASCII, length, and whitespace law as Move', () => {
    expect(normalize_character_name(' AIDEN ')).toBe('aiden')
    expect(() => normalize_character_name('abc')).toThrow()
    expect(() => normalize_character_name('with space')).toThrow()
    expect(() => normalize_character_name('éclair')).toThrow()
  })
})
