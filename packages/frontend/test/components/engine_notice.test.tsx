// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { EngineNotice, engine_notice_kind } from '../../src/components/EngineNotice.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { LOCALES } from '../../src/i18n/locale.ts'
import { graphics_notice_visible } from '../../src/components/app_layout.ts'

for (const { code: locale } of LOCALES) {
  test(`${locale}: terminal terrain/device failure offers explicit reload instead of continuing a dead renderer`, async () => {
    const copy = await load_app_copy(locale)
    const markup = renderToStaticMarkup(
      <EngineNotice
        copy={copy}
        status={{ state: 'failed', backend: 'webgpu', issue: { code: 'terrain_failed' } }}
        dismiss={() => undefined}
        reload={() => undefined}
      />
    )
    expect(markup).toContain(copy.engine_reload)
    expect(markup).toContain(copy.engine_recovery)
    expect(markup).not.toContain(copy.continue)
  })
  test(`${locale}: minimum graphics notice offers continue without claiming the computer is underpowered`, async () => {
    const copy = await load_app_copy(locale)
    const markup = renderToStaticMarkup(
      <EngineNotice
        copy={copy}
        status={{ state: 'ready', backend: 'webgpu' }}
        minimum_graphics
        dismiss={() => undefined}
        reload={() => undefined}
      />
    )
    expect(markup).toContain(copy.engine_minimum_title)
    expect(markup).toContain(copy.engine_continue)
    expect(markup).not.toContain(copy.engine_reload)
  })
}

test('dismissed minimum notice cannot suppress a later grid fallback', () => {
  const dismissed = engine_notice_kind({ state: 'ready', backend: 'webgpu' }, true)
  const grid = engine_notice_kind({ state: 'degraded', backend: 'grid' }, true)
  expect(dismissed).toBe('minimum')
  expect(grid).toBe('fallback')
  expect(graphics_notice_visible(false, false, false, dismissed === grid, grid !== null)).toBe(true)
  expect(engine_notice_kind({ state: 'failed', backend: 'grid' }, true)).toBe('failed')
})
