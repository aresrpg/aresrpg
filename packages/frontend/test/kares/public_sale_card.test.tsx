// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { load_app_copy } from '../../src/i18n/copy.ts'
import { PublicSaleCardView } from '../../src/kares/PublicSaleCard.tsx'

import { finance_snapshot } from './fixture.ts'

test('sale card stays quiet without an active sale, including at the closing boundary', async () => {
  const copy = await load_app_copy('en')
  const snapshot = finance_snapshot()
  for (const state of [
    null,
    { ...snapshot, offering: { ...snapshot.offering, started: false } },
    { ...snapshot, clock_ms: snapshot.offering.closes_ms },
    { ...snapshot, clock_ms: snapshot.offering.closes_ms, offering: { ...snapshot.offering, settled: true } },
  ]) {
    const html = renderToStaticMarkup(<PublicSaleCardView copy={copy} snapshot={state} />)
    expect(html).not.toContain('data-phase="open"')
    expect(html).not.toContain('role="timer"')
    expect(html).toContain('data-kares-logo')
  }
})

test('active sale shows the logo and chain-derived time remaining in every locale', async () => {
  const snapshot = finance_snapshot()
  const active = { ...snapshot, offering: { ...snapshot.offering, closes_ms: snapshot.clock_ms + 93_784_000n } }
  for (const locale of ['en', 'fr', 'de', 'es', 'ja', 'uk'] as const) {
    const copy = await load_app_copy(locale)
    const html = renderToStaticMarkup(<PublicSaleCardView copy={copy} snapshot={active} />)
    expect(html).toContain('data-phase="open"')
    expect(html).toContain('data-kares-logo')
    expect(html).toContain('role="timer"')
    expect(html).toContain(`1${copy.kares_page.days_short} 02:03:04`)
    expect(html).toContain(copy.kares_page.closes_in)
    expect(html).toContain('href="https://launchpad.aresrpg.world/#contribute"')
  }
})

test('only a deployed, unstarted sale promises an upcoming launch', async () => {
  const copy = await load_app_copy('en')
  const snapshot = finance_snapshot()
  const unknown = renderToStaticMarkup(<PublicSaleCardView copy={copy} snapshot={null} />)
  const upcoming = renderToStaticMarkup(
    <PublicSaleCardView
      copy={copy}
      snapshot={{ ...snapshot, offering: { ...snapshot.offering, started: false, opens_ms: 0n, closes_ms: 0n } }}
    />
  )
  expect(unknown).toContain(copy.kares_page.funding_unknown)
  expect(unknown).not.toContain(copy.kares_page.sale_card_soon_note)
  expect(upcoming).toContain(copy.kares_page.sale_card_soon_title)
  expect(upcoming).toContain(copy.kares_page.sale_card_soon_note)
  expect(upcoming).not.toContain(copy.kares_page.sale_card_live_title)
})

test('live funding switches at the exact minimum and reports only contributions above the cap as oversubscription', async () => {
  const copy = await load_app_copy('en')
  const snapshot = finance_snapshot()
  const render = (total_contributed: bigint) =>
    renderToStaticMarkup(
      <PublicSaleCardView
        copy={copy}
        snapshot={{
          ...snapshot,
          offering: { ...snapshot.offering, min_raise: 5_000_000_000n, max_raise: 10_000_000_000n, total_contributed },
        }}
      />
    )
  expect(render(4_999_999_999n)).not.toContain(copy.kares_page.sale_card_target_reached)
  expect(render(2_500_000_000n)).toContain('width:50%')
  expect(render(5_000_000_000n)).toContain(copy.kares_page.sale_card_target_reached)
  expect(render(5_000_000_000n)).toContain('width:100%')
  expect(render(10_000_000_000n)).not.toContain(copy.kares_page.oversubscribed)
  const over = render(12_500_000_001n)
  expect(over).toContain(copy.kares_page.sale_card_live_title)
  expect(over).toContain(copy.kares_page.oversubscribed)
  expect(over).toContain('+2.500000001 SUI')
  expect(over).toContain('width:100%')
})

test('completed sales invite claims, while a failed minimum invites only a full refund in all locales', async () => {
  const snapshot = finance_snapshot()
  const ended = { ...snapshot, clock_ms: snapshot.offering.closes_ms }
  for (const locale of ['en', 'fr', 'de', 'es', 'ja', 'uk'] as const) {
    const copy = await load_app_copy(locale)
    const success = renderToStaticMarkup(<PublicSaleCardView copy={copy} snapshot={ended} />)
    const refund = renderToStaticMarkup(
      <PublicSaleCardView copy={copy} snapshot={{ ...ended, offering: { ...ended.offering, total_contributed: 0n } }} />
    )
    expect(success).toContain(copy.kares_page.sale_card_done_title)
    expect(success).toContain(copy.kares_page.sale_card_done_note)
    expect(success).not.toContain('role="timer"')
    expect(refund).toContain(copy.kares_page.sale_card_refund_note)
    expect(refund).toContain(copy.kares_page.refund)
    expect(refund).not.toContain(copy.kares_page.sale_card_done_note)
  }
})
