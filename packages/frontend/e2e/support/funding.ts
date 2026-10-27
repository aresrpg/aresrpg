// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { Page } from '@playwright/test'

export const mock_funding = async (page: Page, status = 'SUCCESS'): Promise<void> => {
  await page.route('https://1click.chaindefuser.com/v0/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/tokens'))
      return route.fulfill({
        json: [
          { assetId: 'nep141:sui.omft.near', blockchain: 'sui', symbol: 'SUI', decimals: 9, price: 1 },
          {
            assetId: 'nep141:base-zero',
            blockchain: 'base',
            symbol: 'ZERO',
            decimals: 6,
            contractAddress: `0x${'66'.repeat(20)}`,
            price: 1,
          },
          {
            assetId: 'nep141:base-usdc',
            blockchain: 'base',
            symbol: 'USDC',
            decimals: 6,
            contractAddress: `0x${'44'.repeat(20)}`,
            price: 1,
          },
        ],
      })
    if (url.pathname.endsWith('/quote')) {
      const input = route.request().postDataJSON() as Record<string, unknown>
      return route.fulfill({
        json: {
          quoteRequest: input,
          quote: {
            amountIn: '1300000',
            amountOut: input.amount,
            minAmountOut: input.amount,
            depositAddress: `0x${'55'.repeat(20)}`,
            deadline: input.deadline,
            timeEstimate: 35,
          },
        },
      })
    }
    return route.fulfill({ json: { status } })
  })
}
