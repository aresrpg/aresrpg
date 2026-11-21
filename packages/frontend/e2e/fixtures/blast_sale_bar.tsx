// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The home page's sale header inside the home page's own scroll container, over content taller than the window.
import { createRoot } from 'react-dom/client'

import { load_app_copy } from '../../src/i18n/copy.ts'
import { LocaleScope } from '../../src/i18n/LocaleScope.tsx'
import { BlastSaleBarView } from '../../src/kares/BlastSaleBar.tsx'
import { initial_blast_state } from '../../src/kares/blast.ts'
import '../../src/tailwind.css'
import '../../src/landing/landing_base.css'

const copy = await load_app_copy('en')
const snapshot = {
  version: '10',
  clock_ms: 100n,
  phase: 'live' as const,
  committed: 1_918_850_000_000n,
  target: 60_000_000_000_000n,
  progress_bps: 320,
  start_ms: 0n,
  end_ms: 400_000_000n,
  public_ms: 268_000_000n,
  token_allocation: 400_000_000_000_000_000n,
}
const state = { ...initial_blast_state(), ready: true, url: 'https://www.blast.fun/presale/example', snapshot }
createRoot(document.getElementById('root')!).render(
  <LocaleScope locale="en">
    <div className="landing">
      <BlastSaleBarView copy={copy} state={state} now={100} />
      <div className="landing-flow" style={{ height: '300vh' }} data-content="" />
    </div>
  </LocaleScope>
)
