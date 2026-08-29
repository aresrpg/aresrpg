// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { MOBILE_VIEWPORT_QUERY, MobileUnavailableScreen } from '../../src/components/MobileUnavailableScreen.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'

test('the mobile gate presents the dedicated desktop handoff', async () => {
  const copy = await load_app_copy('en')
  const html = renderToStaticMarkup(<MobileUnavailableScreen copy={copy} />)

  expect(MOBILE_VIEWPORT_QUERY).toBe('(max-width: 1023px)')
  expect(html).toContain('data-mobile-unavailable="true"')
  expect(html).toContain('AresRPG is not yet available on mobile devices')
  expect(html).toContain('Desktop build online')
  expect(html).toContain('/logo.png')
})
