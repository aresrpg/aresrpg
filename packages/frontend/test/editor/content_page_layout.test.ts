// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

test('seed save errors render inside a permanent lane without shifting the selected editor', () => {
  const source = readFileSync(new URL('../../src/editor/ContentPage.tsx', import.meta.url), 'utf8')

  expect(source).toContain('data-editor-error-lane=""')
  expect(source).toContain('h-[68px]')
  expect(source.indexOf('data-editor-error-lane=""')).toBeLessThan(source.indexOf('{editor.error && ('))
})

test('the mob result header exposes the localized protector visibility checkbox', () => {
  const source = readFileSync(new URL('../../src/editor/ContentPage.tsx', import.meta.url), 'utf8')

  expect(source).toContain('type="checkbox"')
  expect(source).toContain('text.hide_protectors')
  expect(source).toContain('mob_types_for_protector_visibility')
})
