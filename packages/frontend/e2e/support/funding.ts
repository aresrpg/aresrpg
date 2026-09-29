// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { Page } from '@playwright/test'

import snapshot from '../fixtures/funding_chains.json' with { type: 'json' }

export const mock_funding = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const calls: string[] = []
    let authorized = false
    const provider = {
      on: () => undefined,
      removeListener: () => undefined,
      request: async ({ method }: { method: string }) => {
        calls.push(method)
        document.documentElement.dataset.walletCalls = JSON.stringify(calls)
        switch (method) {
          case 'eth_chainId':
            return '0x2105'
          case 'eth_accounts':
            return authorized ? [`0x${'44'.repeat(20)}`] : []
          case 'eth_requestAccounts':
            authorized = true
            return [`0x${'44'.repeat(20)}`]
          case 'wallet_requestPermissions':
            authorized = true
            return [{ parentCapability: 'eth_accounts' }]
          default:
            throw new Error(`Fixture refuses wallet method: ${method}`)
        }
      },
    }
    const announce = () =>
      window.dispatchEvent(
        new CustomEvent('eip6963:announceProvider', {
          detail: {
            info: {
              uuid: 'e57e1c01-91dc-4c53-b28c-8055a53794c8',
              name: 'Fixture wallet',
              icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
              rdns: 'world.aresrpg.fixture',
            },
            provider,
          },
        })
      )
    window.addEventListener('eip6963:requestProvider', announce)
    announce()
  })
  await page.route('https://**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === 'li.quest') {
      const tokens = Object.fromEntries(snapshot.chains.map((chain) => [chain.id, [chain.nativeToken]]))
      const responses: Record<string, unknown> = {
        '/v1/chains': snapshot,
        '/v1/tokens': { tokens },
        '/v1/token': snapshot.chains.find((chain) => String(chain.id) === url.searchParams.get('chain'))?.nativeToken,
        '/v1/tools': { bridges: [], exchanges: [] },
        '/v1/connections': { connections: [] },
        '/v1/advanced/routes': { routes: [] },
      }
      await route.fulfill({ json: responses[url.pathname] ?? {} })
    } else if (route.request().resourceType() === 'image') {
      await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' })
    } else {
      await route.fulfill({ status: 503, body: 'Offline fixture: no chain requests or transactions' })
    }
  })
}
