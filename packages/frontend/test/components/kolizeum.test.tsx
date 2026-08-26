// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

test('the restored War Table keeps the exact dense lobby layout and explicit side controls', () => {
  const source = readFileSync(new URL('../../src/kolizeum/KolizeumPage.tsx', import.meta.url), 'utf8')
  const locale = readFileSync(new URL('../../src/i18n/locales/en.yaml', import.meta.url), 'utf8')

  expect(source).toContain('data-kolizeum-page=""')
  for (const column of ['col_format', 'col_access', 'col_status', 'col_pledge', 'col_full_pot', 'col_creator'])
    expect(source).toContain(column)
  expect(source).toContain("side === 0 ? 'join_a' : 'join_b'")
  expect(source).toContain("side === 0 ? 'A' : 'B'")
  expect(locale).toContain('create_title: Create a lobby')
  expect(source).not.toContain('tab_history')
  expect(source).not.toContain('settlements')
})
