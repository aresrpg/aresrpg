// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { Hero } from '../../src/allocation/Hero.tsx'
import { initial_allocation, create_allocation_runtime } from '../../src/allocation/runtime.ts'
import { allocation_view } from '../../src/allocation/view.ts'
import type { AuthSession } from '../../src/auth.ts'

const render = (session: AuthSession | null) =>
  renderToStaticMarkup(
    <Hero
      state={{ ...initial_allocation(), session }}
      view={allocation_view(null)}
      runtime={create_allocation_runtime()}
      text={(key) => key}
      locale="en"
      sale={null}
      now={0}
      kares={{} as never}
      spot={() => null}
    />
  )

test('logged-out visitors see the campaign without an onboarding gate or empty card', () => {
  const html = render(null)
  expect(html).not.toContain('login_title')
  expect(html).not.toContain('card_placeholder')
  expect(html).not.toContain('class="stage')
})

test('login alone does not show a card before an allocation is known', () => {
  expect(render({ address: '0x1' } as AuthSession)).not.toContain('class="stage')
})

test('a live sale says when it opens to everyone, and nothing when it has no public phase', async () => {
  const { SaleHero } = await import('../../src/allocation/SaleHero.tsx')
  const sale = {
    version: '10',
    clock_ms: 0n,
    phase: 'live' as const,
    committed: 75n,
    target: 100n,
    progress_bps: 7500,
    start_ms: 0n,
    end_ms: 5n * 86_400_000n,
    token_allocation: 400n,
  }
  const text = (key: string, values?: Readonly<Record<string, unknown>>): string => {
    if (!values) return key
    return 'time' in values ? `${key}=${String(values.time)}` : `${String(values.days)}d${String(values.hours)}h`
  }
  const render = (snapshot: typeof sale & Readonly<{ public_ms?: bigint | null }>, now: number) =>
    renderToStaticMarkup(<SaleHero sale={snapshot} spots={0} now={now} text={text} kares={{} as never} locale="en" />)
  const opening = { ...sale, public_ms: 4n * 86_400_000n }
  const waiting = render(opening, 86_400_000 + 3_600_000)
  expect(waiting).toContain('sale_public_in=2d23h')
  expect(render(opening, 4 * 86_400_000)).toContain('sale_public_now')
  for (const quiet of [
    render(sale, 0),
    render({ ...sale, public_ms: null }, 0),
    render({ ...opening, phase: 'funded' as never }, 0),
  ])
    expect(quiet).not.toContain('sale_public')
})
