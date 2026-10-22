// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { Hero } from '../../src/allocation/Hero.tsx'
import { initial_allocation, create_allocation_runtime } from '../../src/allocation/runtime.ts'
import { allocation_view } from '../../src/allocation/view.ts'
import type { AuthSession } from '../../src/auth.ts'

const render = (session: AuthSession | null) =>
  renderToStaticMarkup(
    <Hero
      state={{ ...initial_allocation(), session }}
      view={allocation_view(null, 0)}
      runtime={create_allocation_runtime()}
      text={(key) => key}
      locale="en"
      open
      google_label="Google"
      wallet_label="Connect wallet"
      wallets={['Slush']}
    />
  )

test('logged-out visitors see login without an empty wallet card', () => {
  const html = render(null)
  expect(html).toContain('login_title')
  expect(html).not.toContain('card_placeholder')
  expect(html).not.toContain('class="stage')
})

test('login alone does not show a card before an allocation is known', () => {
  expect(render({ address: '0x1' } as AuthSession)).not.toContain('class="stage')
})

test('wallet login is available before Google authentication', () => {
  const html = render(null)
  expect(html).toContain('Connect wallet')
  expect(html).toContain('Google')
})
