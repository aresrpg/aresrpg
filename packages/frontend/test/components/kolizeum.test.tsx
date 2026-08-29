// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

test('the War Table selects rows and confirms an explicit side wager before joining', () => {
  const source = readFileSync(new URL('../../src/kolizeum/KolizeumPage.tsx', import.meta.url), 'utf8')
  const locale = readFileSync(new URL('../../src/i18n/locales/en.yaml', import.meta.url), 'utf8')

  expect(source).toContain('data-kolizeum-page=""')
  for (const column of ['col_format', 'col_access', 'col_status', 'col_pledge', 'col_full_pot', 'col_creator'])
    expect(source).toContain(column)
  expect(source).toContain('<ModalFrame')
  expect(source).toContain("t('join_confirm_body'")
  expect(source).toContain("type: 'kolizeum/join'")
  expect(source).toContain('character_id: intent.character_id')
  expect(source).not.toContain('const SideActions')
  expect(locale).toContain('create_title: Create a lobby')
  expect(source).toContain("if (tab === 'open') return lobby.status === 'open'")
  expect(locale).toContain('paid_out: Paid out')
  expect(source).not.toContain('tab_history')
  expect(source).not.toContain('settlements')
})
