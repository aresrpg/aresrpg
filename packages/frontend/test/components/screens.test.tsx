// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { CharacterCreateModal, character_name_error_text } from '../../src/components/CharacterCreateModal.tsx'
import SettingsPage from '../../src/settings/SettingsPage.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'

const SETTINGS = Object.freeze({
  quality: 'medium' as const,
  flat_mode: false,
  music_enabled: true,
  render_distance: null,
})

test('each standalone screen exposes only its own surface', async () => {
  const copy = await load_app_copy('en')

  // Character creation reserves the model preview and carries no release-status copy.
  const create = renderToStaticMarkup(
    <CharacterCreateModal cancel={() => undefined} copy={copy} create={async () => undefined} />
  )

  expect(create).toContain('data-character-preview=""')
  expect(create).toContain('data-character-name-error=""')
  expect(create).toContain('maxLength="19"')
  expect(copy).not.toHaveProperty('create_unavailable')
  expect(create).not.toContain('next published game package')
  expect(create).toContain('1 SUI')
  expect(create).toContain(copy.character_price)
  expect(character_name_error_text(copy, '')).toBeNull()
  expect(character_name_error_text(copy, 'Sceat 6')).toBe(copy.name_invalid)

  // Settings exposes only the music preference.
  const settings = renderToStaticMarkup(<SettingsPage copy={copy} settings={SETTINGS} />)

  expect(settings).toContain('Music')
  expect(settings).toContain('role="switch"')
  expect(settings).not.toContain(copy.quality)
  expect(settings).not.toContain(copy.flat_mode)
  expect(settings).not.toContain('Rendering Options')
})
