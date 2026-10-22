// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createStore } from 'zustand/vanilla'

import { AllocationPage } from '../../src/allocation/AllocationPage.tsx'
import { initial_allocation, type AllocationState } from '../../src/allocation/runtime.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'

const copy = await load_app_copy('en')
const render = (state: AllocationState) =>
  renderToStaticMarkup(
    <AllocationPage
      locale="en"
      copy={copy}
      runtime={{ store: createStore(() => state), dispatch: () => {}, observe: () => () => {} }}
    />
  )

test('initial loading stays in the compact header status instead of a page-wide banner', () => {
  const html = render({ ...initial_allocation(), task: { kind: 'boot' } })
  expect(html).toContain('class="phase-chip" role="status"')
  expect(html).toContain('class="spinner"')
  expect(html).not.toContain('class="banner"')
})

test('refreshing an existing campaign projection does not show a loading indicator', () => {
  const html = render({
    ...initial_allocation(),
    task: { kind: 'load' },
    status: { phase: 'registration', submissions_open: true, wallets: [], awards: [], user: null, submission: null },
  })
  expect(html).not.toContain('class="spinner"')
  expect(html).not.toContain('class="banner"')
})

test('the real campaign and wallet linking are visible before login, with Google in the chooser', () => {
  const html = render(initial_allocation())
  expect(html).toContain('Link your wallets')
  expect(html).toContain('Link a Sui wallet')
  expect(html).toContain('Continue with Google')
  expect(html).toContain('class="steps"')
  expect(html).not.toContain('login-gate')
})
