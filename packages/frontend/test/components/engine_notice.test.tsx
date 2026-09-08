// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { EngineNotice } from '../../src/components/EngineNotice.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'

for (const locale of ['en', 'fr', 'de', 'es', 'uk', 'ja'] as const) {
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
}
