// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { class_names } from '@aresrpg/immutable'
import { renderToStaticMarkup } from 'react-dom/server'

import { CharacterCreateModal, character_name_error_text } from '../../src/components/CharacterCreateModal.tsx'
import SettingsPage from '../../src/settings/SettingsPage.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'

const SETTINGS = Object.freeze({
  quality: 'medium' as const,

  music_enabled: true,
  render_distance: null,
})

test('each modal exposes its own initial surface', async () => {
  const copy = await load_app_copy('en')

  // Character creation reserves the model preview and carries no release-status copy.
  const create = renderToStaticMarkup(
    <CharacterCreateModal
      cancel={() => undefined}
      copy={copy}
      create={async () => undefined}
      insufficient={false}
      view_spells={() => undefined}
    />
  )

  expect(create).toContain('data-character-preview=""')
  expect(create).toContain('data-character-name-error=""')
  expect(create).toContain('maxLength="19"')
  expect(copy).not.toHaveProperty('create_unavailable')
  expect(create).not.toContain('next published game package')
  expect(create).toContain('1 SUI')
  expect(create).toContain(copy.character_price)
  expect(create).toContain('data-class-spells-link=""')
  expect(create).toContain('See the spells for that class')
  class_names.forEach((classe) => expect(create).toContain(copy.simulator_page[`class_${classe}_title`]))
  expect(character_name_error_text(copy, '')).toBeNull()
  expect(character_name_error_text(copy, 'Sceat 6')).toBe(copy.name_invalid)

  const insufficient = renderToStaticMarkup(
    <CharacterCreateModal
      cancel={() => undefined}
      copy={copy}
      create={async () => undefined}
      insufficient
      view_spells={() => undefined}
    />
  )
  expect(insufficient).toContain('You need at least 0.05 SUI left in your balance for fees.')
  expect(insufficient).toMatch(/<button[^>]*disabled=""[^>]*type="submit"/)

  // Settings initially opens graphics; audio interactions are covered in browser tests.
  const settings = renderToStaticMarkup(<SettingsPage copy={copy} settings={SETTINGS} />)

  expect(settings).toContain('Render distance')
  expect(settings).toContain('type="range"')
  expect(settings).toContain('Day/night cycle')
  expect(settings).toContain('Disable to keep the world at midday.')
  expect(settings).toContain('role="switch"')
  expect(settings).not.toContain('Rendering Options')
})
