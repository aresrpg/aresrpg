// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { copy_text, format_text } from '../../src/i18n/copy.ts'

test('player text is literal, including replacement tokens and other placeholders', () => {
  const text = copy_text({ review: 'Register {{character}} with {{team}}?' })
  expect(text('review', { character: 'hero', team: "$& $$ $` $'" })).toBe("Register hero with $& $$ $` $'?")
  expect(text('review', { character: '{{team}}', team: 'Rivals' })).toBe('Register {{team}} with Rivals?')
})

test('missing and inherited placeholders remain text', () => {
  const text = copy_text({ review: '{{missing}} {{constructor}} {{toString}} {{zero}}' })
  expect(text('review', { zero: 0 })).toBe('{{missing}} {{constructor}} {{toString}} 0')
})

test('both authored placeholder spellings share one nonrecursive substitution', () => {
  expect(format_text('{name} / {{name}} / {count}', { name: '$& {{count}}', count: 0 })).toBe(
    '$& {{count}} / $& {{count}} / 0'
  )
  expect(format_text('{constructor} {{toString}}')).toBe('{constructor} {{toString}}')
  expect(format_text('{name}', { name: '夜の梟 🦉' })).toBe('夜の梟 🦉')
})
