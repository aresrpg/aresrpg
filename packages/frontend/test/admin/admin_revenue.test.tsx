// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { Children, isValidElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { TreasuryStrip } from '../../src/admin/OverviewPage.tsx'
import type { AdminRevenue } from '../../src/admin/useAdminRevenue.ts'

const revenue: AdminRevenue = {
  royalties: [],
  treasury_mist: 0n,
  claimable: 2_530_000_000n,
  reading: false,
  claiming: false,
  claim_blocked: null,
  connected: true,
  error: null,
  refresh: () => {},
  claim: () => {},
}

test('inactive or unread claim status disables withdrawal and explains the restriction', () => {
  for (const claim_blocked of ['Claims unlock after settlement.', 'Reading…', 'Claim status unavailable.']) {
    const html = renderToStaticMarkup(<TreasuryStrip copy={{}} revenue={{ ...revenue, claim_blocked }} />)
    expect(html).toMatch(/<button[^>]*disabled=""/)
    expect(html).toContain(claim_blocked)
    expect(html).toContain('role="status"')
  }
})

test('an available claim invokes the withdrawal directly without an arming step', () => {
  let claims = 0
  const view = TreasuryStrip({
    copy: {},
    revenue: {
      ...revenue,
      claim: () => {
        claims += 1
      },
    },
  })
  const button = Children.toArray(view.props.children).find(
    (child) => isValidElement(child) && child.type === 'button'
  ) as ReactElement<{ onClick: () => void; disabled: boolean }>
  expect(button.props.disabled).toBe(false)
  button.props.onClick()
  expect(claims).toBe(1)
  const html = renderToStaticMarkup(view)
  expect(html).toContain('Claim 2.53 SUI')
  expect(html).not.toContain('Confirm claim')
})

test('pending, disconnected and empty claims stay disabled', () => {
  for (const state of [{ claiming: true }, { connected: false }, { claimable: 0n }]) {
    const html = renderToStaticMarkup(<TreasuryStrip copy={{}} revenue={{ ...revenue, ...state }} />)
    expect(html).toMatch(/<button[^>]*disabled=""/)
  }
})
