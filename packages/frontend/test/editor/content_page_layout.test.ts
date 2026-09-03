// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { content_domain_icon } from '../../src/editor/content_domain_icons.ts'
import { seed_content_domains } from '../../src/editor/seed_editor.ts'

test('every seed domain has a concrete navigation component', () => {
  for (const { id } of seed_content_domains)
    expect(() => renderToStaticMarkup(createElement(content_domain_icon(id)))).not.toThrow()
})

test('seed save errors render inside a permanent lane without shifting the selected editor', () => {
  const source = readFileSync(new URL('../../src/editor/ContentPage.tsx', import.meta.url), 'utf8')

  expect(source).toContain('data-editor-error-lane=""')
  expect(source).toContain('h-[68px]')
  expect(source.indexOf('data-editor-error-lane=""')).toBeLessThan(source.indexOf('<ValidationPanel'))
})

test('the mob result header has no redundant protector visibility checkbox', () => {
  const source = readFileSync(new URL('../../src/editor/ContentPage.tsx', import.meta.url), 'utf8')

  expect(source).not.toContain('text.hide_protectors')
  expect(source).not.toContain('mob_types_for_protector_visibility')
})
