// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createRoot } from 'react-dom/client'

import { load_app_copy } from '../../src/i18n/copy.ts'
import { LocaleScope } from '../../src/i18n/LocaleScope.tsx'
import { BlastSaleCardView } from '../../src/kares/BlastSaleCard.tsx'
import { initial_blast_state } from '../../src/kares/blast.ts'
import '../../src/tailwind.css'

const copy = await load_app_copy('en')
const base = { ...initial_blast_state(), ready: true }
const live = {
  version: '10',
  clock_ms: 100n,
  phase: 'live' as const,
  committed: 75_000_000_000_000n,
  target: 100_000_000_000_000n,
  progress_bps: 7500,
}
const states = [
  base,
  { ...base, snapshot: live },
  { ...base, snapshot: { ...live, phase: 'funded' as const, committed: live.target, progress_bps: 10000 } },
  { ...base, snapshot: live, error: true },
]
createRoot(document.getElementById('root')!).render(
  <LocaleScope locale="en">
    <main className="min-h-screen bg-[#100d19] p-8 font-mono">
      <div className="grid max-w-4xl gap-8 md:grid-cols-2">
        {states.map((state, index) => (
          <section data-card={index} key={index}>
            <BlastSaleCardView copy={copy} state={state} />
          </section>
        ))}
      </div>
    </main>
  </LocaleScope>
)
