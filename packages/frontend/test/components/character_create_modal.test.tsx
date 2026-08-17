// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { CharacterCreateModal, character_name_error_text } from '../../src/components/CharacterCreateModal.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'

test('character creation reserves the model preview and contains no release-status copy', async () => {
  const copy = await load_app_copy('en')
  const html = renderToStaticMarkup(
    <CharacterCreateModal cancel={() => undefined} copy={copy} create={async () => undefined} />
  )

  expect(html).toContain('data-character-preview=""')
  expect(html).toContain('data-character-name-error=""')
  expect(html).toContain('maxLength="19"')
  expect(copy).not.toHaveProperty('create_unavailable')
  expect(html).not.toContain('next published game package')
  expect(html).toContain('1 SUI')
  expect(html).toContain(copy.character_price)
  expect(character_name_error_text(copy, '')).toBeNull()
  expect(character_name_error_text(copy, 'Sceat 6')).toBe(copy.name_invalid)
})
