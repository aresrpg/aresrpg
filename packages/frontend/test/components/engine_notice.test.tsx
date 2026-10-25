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
    expect(markup).not.toContain(copy.engine_continue)
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

test('missing WebGPU blocks gameplay; a degraded sky is not a missing renderer', () => {
  expect(engine_notice_kind({ state: 'failed', backend: 'none', issue: { code: 'webgpu_unavailable' } })).toBe(
    'unsupported'
  )
  expect(
    engine_notice_kind({ state: 'degraded', backend: 'webgpu', issue: { code: 'advanced_sky_failed' } })
  ).toBeNull()
  expect(graphics_notice_visible(false, false, false, false, true)).toBe(true)
})

test('failed WebGPU initialization offers neutral graphics recovery instead of claiming unsupported hardware', async () => {
  const copy = await load_app_copy('en')
  const html = renderToStaticMarkup(
    <EngineNotice
      copy={copy}
      status={{ state: 'failed', backend: 'none', issue: { code: 'webgpu_initialization_failed' } }}
      dismiss={() => undefined}
      reload={() => undefined}
    />
  )
  expect(html).toContain(copy.engine_graphics_failure)
  expect(html).toContain(copy.engine_reload)
  expect(html).not.toContain(copy.engine_recovery)
})

test('the low-quality initialization retry does not show a terminal GPU notice', () => {
  expect(
    engine_notice_kind({ state: 'initializing', backend: 'none', issue: { code: 'webgpu_initialization_failed' } })
  ).toBeNull()
})
