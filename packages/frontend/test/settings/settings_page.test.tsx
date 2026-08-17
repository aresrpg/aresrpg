// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import SettingsPage from '../../src/settings/SettingsPage.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'

test('settings exposes only the music preference', async () => {
  const copy = await load_app_copy('en')
  const html = renderToStaticMarkup(
    <SettingsPage copy={copy} settings={Object.freeze({ quality: 'medium', flat_mode: false, music_enabled: true })} />
  )

  expect(html).toContain('Music')
  expect(html).toContain('role="switch"')
  expect(html).not.toContain(copy.quality)
  expect(html).not.toContain(copy.flat_mode)
  expect(html).not.toContain('Rendering Options')
})
