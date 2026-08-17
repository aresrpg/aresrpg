// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

import {
  CHARACTER_NAME_MAX_LENGTH,
  CHARACTER_NAME_MIN_LENGTH,
  character_claim_id,
  character_id,
  is_valid_character_name,
  normalize_character_name,
} from '../src/character.ts'

describe('derived character identity', () => {
  test('pins the client name twin to Move length and printable-byte checks', () => {
    const character_move = readFileSync(new URL('../../move/sources/character.move', import.meta.url), 'utf8')
    const content_rules_move = readFileSync(
      new URL('../../move-math/sources/content_rules.move', import.meta.url),
      'utf8'
    )

    expect(character_move).toContain(
      `name.length() > ${CHARACTER_NAME_MIN_LENGTH - 1} && name.length() < ${CHARACTER_NAME_MAX_LENGTH + 1}`
    )
    expect(content_rules_move).toContain('byte < 33u8 || byte > 126u8')
  })

  test('matches the Sui derived-object address for registry + lowercase String', () => {
    expect(character_id('0x2', '  AiDeN  ')).toBe('0x55b378d77ba06f8f5822d4b4f16ae3eb8b565ca0e9853b1bda4ff6d8935abce9')
  })

  test('derives the permanent framework claim marker without a lookup', () => {
    expect(character_claim_id('0x2', 'aiden')).toBe(
      '0xd00bfc963baa398d636f64bad0a43e46b9b368836dcbda1c7c1026e247f7c2d3'
    )
  })

  test('applies the same ASCII, length, and whitespace law as Move', () => {
    expect(CHARACTER_NAME_MAX_LENGTH).toBe(19)
    expect(is_valid_character_name('AIDEN')).toBe(true)
    expect(is_valid_character_name('Sceat 6')).toBe(false)
    expect(normalize_character_name(' AIDEN ')).toBe('aiden')
    expect(() => normalize_character_name('abc')).toThrow()
    expect(() => normalize_character_name('with space')).toThrow()
    expect(() => normalize_character_name('éclair')).toThrow()
  })
})
