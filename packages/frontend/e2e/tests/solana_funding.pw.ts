// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from '@playwright/test'

import deployment from '../../vercel.json' with { type: 'json' }
import { mock_solflare_funding } from '../support/solana_funding.ts'

test('Solflare balance and the 1% AresRPG quote require no signing request', async ({ page }) => {
  const external_reads: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('alchemy.com')) external_reads.push(request.url())
  })
  await mock_solflare_funding(page)
  const policy = deployment.headers
    .flatMap(({ headers }) => headers)
    .find(({ key }) => key === 'Content-Security-Policy')!.value
  await page.route('**/e2e/fixtures/add_funds.html', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': policy } })
  })
  await page.goto('/e2e/fixtures/add_funds.html')
  await page.getByRole('button', { name: /Bridge deposit/ }).click()
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click()
  await page.getByText('Solflare', { exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-solflare-connected', 'true')
  const bridge = page.locator('[data-bridge-funding]')
  await bridge.getByRole('button', { name: /^From / }).click()
  await page.getByText('USDC', { exact: true }).click()
  await expect(bridge).toContainText('12.5')
  const quote = page.waitForRequest('https://li.quest/v1/advanced/routes')
  await bridge.locator('input[name="fromAmount"]').fill('1')
  expect((await quote).postDataJSON()).toMatchObject({
    fromAmount: '1000000',
    toAddress: `0x${'11'.repeat(32)}`,
    options: { integrator: 'aresrpg', fee: 0.01 },
  })
  expect(external_reads).toEqual([])
  await expect(page.locator('[data-bridge-recipient]')).toHaveText(`0x${'11'.repeat(32)}`)
})

test('the deployed-path relay handles requests instead of the SPA fallback', async ({ request }) => {
  const response = await request.get('/api/solana')
  expect(response.status()).toBe(405)
  expect(response.headers()['content-type']).toContain('application/json')
  const foreign = await request.post('/api/solana', {
    headers: { origin: 'https://foreign.example' },
    data: { jsonrpc: '2.0', id: 1, method: 'getSlot', params: [] },
  })
  expect(foreign.status()).toBe(403)
})
