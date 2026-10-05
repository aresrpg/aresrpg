// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { FinanceStatus } from '../../src/kares/components.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'

import { finance_state } from './fixture.ts'

test('unknown, failed and recovered digests have links without claiming confirmed success', async () => {
  const copy = (await load_app_copy('en')).kares_page
  for (const status of ['unknown', 'failed', 'recovered'] as const) {
    const html = renderToStaticMarkup(
      <FinanceStatus
        network="mainnet"
        copy={copy}
        state={{
          ...finance_state(),
          error: null,
          transaction_error: { digest: `${status}-digest`, status },
        }}
      />
    )
    expect(html).toContain(`https://suiscan.xyz/mainnet/tx/${status}-digest`)
    expect(html).not.toContain(copy.confirmed)
    expect(html).toContain(
      { unknown: copy.error_unknown, failed: copy.transaction_failed, recovered: copy.error_recovered }[status]
    )
  }
})
