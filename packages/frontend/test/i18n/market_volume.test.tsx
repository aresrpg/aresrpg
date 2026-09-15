// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { LocaleScope } from '../../src/i18n/LocaleScope.tsx'
import { MarketVolumeBadge } from '../../src/marketplace/marketplace_model.tsx'

test('partial marketplace history shows known sales with a lower-bound explanation', () => {
  const text = (key: string) => key
  const partial = renderToStaticMarkup(
    <LocaleScope locale="de">
      <MarketVolumeBadge window="24h" mist="40000000" partial text={text} />
    </LocaleScope>
  )
  expect(partial).toContain('≥ 0,04')
  expect(partial).toContain('title="volume_partial"')
  const full = renderToStaticMarkup(<MarketVolumeBadge window="24h" mist="40000000" text={text} />)
  expect(full).not.toContain('≥')
  expect(full).toContain('title="volume_window"')
  const missing = renderToStaticMarkup(<MarketVolumeBadge window="24h" mist={null} text={text} />)
  expect(missing).toContain('—')
  expect(missing).toContain('title="volume_unavailable"')
})
