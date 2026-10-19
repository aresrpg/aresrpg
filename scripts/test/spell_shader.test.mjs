// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { fragment as FRAGMENT } from '../../packages/engine/test/fixtures/claude_spell_fragment.json'
import { FRAGMENT as GAME_FRAGMENT } from '../../packages/engine/src/generated/claude_spell_game_fragment.js'
import { compile_spell_shader } from '../spell_shader.mjs'

test('offline integration produces the shipped gameplay artifact', () => {
  expect(compile_spell_shader(FRAGMENT)).toBe(GAME_FRAGMENT)
})

test('changed or ambiguous preview boundaries stop generation', () => {
  expect(() => compile_spell_shader(FRAGMENT.replace('void dummy(', 'void renamed_dummy('))).toThrow('section changed')
  expect(() => compile_spell_shader(`${FRAGMENT}\nvoid dummy(`)).toThrow('section changed')
})

test('new references to removed preview helpers require an explicit integration update', () => {
  const changed = FRAGMENT.replace('  gl_FragColor =', '  box();\n  gl_FragColor =')
  expect(() => compile_spell_shader(changed)).toThrow('Preview shader dependencies remain')
})
