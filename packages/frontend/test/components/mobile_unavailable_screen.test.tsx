// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  MOBILE_VIEWPORT_QUERY,
  mobile_app_unavailable,
  MobileUnavailableScreen,
} from '../../src/components/MobileUnavailableScreen.tsx'
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

test('printed giftcards alone may enter the authentication flow on mobile', () => {
  expect(mobile_app_unavailable('/', true)).toBeTrue()
  expect(mobile_app_unavailable('/gift', true)).toBeFalse()
  expect(mobile_app_unavailable('/gift/', true)).toBeFalse()
  expect(mobile_app_unavailable('/enoki', true, true)).toBeFalse()
  expect(mobile_app_unavailable('/enoki', true, false)).toBeTrue()
  expect(mobile_app_unavailable('/giftcard', true)).toBeTrue()
})
