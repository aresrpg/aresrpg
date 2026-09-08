// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { createRoot } from 'react-dom/client'

import { load_app_copy } from '../../src/i18n/copy.ts'
import { LOCALES } from '../../src/i18n/locale.ts'
import { PublicSaleCardView } from '../../src/kares/PublicSaleCard.tsx'
import { finance_snapshot } from '../../test/kares/fixture.ts'

import '../../src/tailwind.css'

// Synthetic lifecycle states; no wallet, finance runtime, RPC or transaction runs in this preview.
const base = finance_snapshot()
const unit = 1_000_000_000n
const clock_ms = 1_788_854_400_000n
const offering = {
  ...base.offering,
  started: true,
  opens_ms: clock_ms - 1000n,
  closes_ms: clock_ms + 93_784_000n,
  min_raise: 500n * unit,
  max_raise: 1000n * unit,
}
const active = { ...base, clock_ms, offering }
const rows = [
  { name: 'Upcoming', snapshot: { ...active, offering: { ...offering, started: false, total_contributed: 0n } } },
  {
    name: 'Live · oversubscribed',
    snapshot: { ...active, offering: { ...offering, total_contributed: 1485n * unit } },
  },
  {
    name: 'Completed',
    snapshot: { ...active, clock_ms: offering.closes_ms, offering: { ...offering, total_contributed: 1485n * unit } },
  },
  {
    name: 'Live · building toward target',
    snapshot: { ...active, offering: { ...offering, total_contributed: 275n * unit } },
  },
  { name: 'Live · target reached', snapshot: { ...active, offering: { ...offering, total_contributed: 720n * unit } } },
  {
    name: 'Completed · full refund',
    snapshot: { ...active, clock_ms: offering.closes_ms, offering: { ...offering, total_contributed: 275n * unit } },
  },
]
const requested = new URLSearchParams(location.search).get('locale')
const locale = LOCALES.find(({ code }) => code === requested)?.code ?? 'en'
void load_app_copy(locale)
  .then((copy) =>
    createRoot(document.getElementById('root')!).render(
      <main className="min-h-dvh bg-[#100d17] px-10 py-8 font-mono text-text">
        <header className="mx-auto mb-8 max-w-[700px] border-b border-white/10 pb-5">
          <p className="text-[10px] tracking-[0.2em] text-gold uppercase">AresRPG / KARES</p>
          <h1 className="mt-2 text-xl">Public sale · card states</h1>
          <nav className="mt-4 flex gap-4 text-xs text-muted">
            {LOCALES.map(({ code }) => (
              <a key={code} href={`?locale=${code}`} className={code === locale ? 'text-cyan' : ''}>
                {code.toUpperCase()}
              </a>
            ))}
          </nav>
        </header>
        <div
          className="mx-auto grid max-w-[700px] grid-cols-[repeat(3,200px)] items-start gap-x-[50px] gap-y-10"
          data-sale-gallery=""
        >
          {rows.map(({ name, snapshot }) => (
            <section key={name}>
              <h2 className="mb-3 min-h-6 text-[9px] leading-4 text-muted">{name}</h2>
              <PublicSaleCardView copy={copy} snapshot={snapshot} />
            </section>
          ))}
        </div>
      </main>
    )
  )
  .catch((error: unknown) => console.error('Sale card preview failed.', error))
