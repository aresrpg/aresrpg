// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { Hero } from '../../src/allocation/Hero.tsx'
import { initial_allocation, create_allocation_runtime } from '../../src/allocation/runtime.ts'
import { allocation_view } from '../../src/allocation/view.ts'
import type { AuthSession } from '../../src/auth.ts'

const render = (google: AuthSession | null) =>
  renderToStaticMarkup(
    <Hero
      state={{ ...initial_allocation(), google }}
      view={allocation_view(null, 0)}
      runtime={create_allocation_runtime()}
      text={(key) => key}
      locale="en"
      open
      google_label="Google"
    />
  )

test('logged-out visitors see login without an empty wallet card', () => {
  const html = render(null)
  expect(html).toContain('google_first')
  expect(html).not.toContain('card_placeholder')
  expect(html).not.toContain('class="stage')
})

test('the card placeholder remains available after login while the portfolio loads', () => {
  expect(render({ address: '0x1' } as AuthSession)).toContain('card_placeholder')
})
