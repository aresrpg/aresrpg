// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Page, Route } from '@playwright/test'

import snapshot from '../fixtures/funding_chains.json' with { type: 'json' }
import { FUNDING_SOLANA_CHAIN } from '../../src/funding/bridge_config.ts'

import { mock_funding } from './funding.ts'

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'

export const mock_solflare_funding = async (page: Page): Promise<void> => {
  await mock_funding(page)
  await page.addInitScript(() => {
    let connected = false
    const account = {
      address: '11111111111111111111111111111111',
      publicKey: new Uint8Array(32),
      chains: ['solana:mainnet'],
      features: [],
    }
    const wallet = {
      version: '1.0.0',
      name: 'Solflare',
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
      chains: ['solana:mainnet'],
      get accounts() {
        return connected ? [account] : []
      },
      features: {
        'standard:connect': {
          version: '1.0.0',
          connect: async () => {
            connected = true
            document.documentElement.dataset.solflareConnected = 'true'
            return { accounts: [account] }
          },
        },
        'standard:disconnect': {
          version: '1.0.0',
          disconnect: async () => {
            connected = false
          },
        },
        'standard:events': { version: '1.0.0', on: () => () => {} },
      },
    }
    const register = (registry: { register: (wallet: unknown) => void }) => registry.register(wallet)
    window.addEventListener('wallet-standard:app-ready', (event) => register((event as CustomEvent).detail))
    window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }))
  })
  await page.route('https://li.quest/v1/tokens**', (route) =>
    route.fulfill({
      json: {
        tokens: Object.fromEntries(
          snapshot.chains.map((chain) => [
            chain.id,
            [
              chain.nativeToken,
              ...(chain.id === FUNDING_SOLANA_CHAIN
                ? [
                    {
                      address: USDC,
                      chainId: FUNDING_SOLANA_CHAIN,
                      symbol: 'USDC',
                      decimals: 6,
                      name: 'USD Coin',
                      priceUSD: '1',
                      coinKey: 'USDC',
                    },
                  ]
                : []),
            ],
          ])
        ),
      },
    })
  )
  const rpc = async (route: Readonly<Route>) => {
    const request = route.request().postDataJSON() as { id: number; method: string; params: readonly unknown[] }
    const context = { slot: 300000000, apiVersion: '2.0.0' }
    const accounts = [
      {
        pubkey: USDC,
        account: {
          lamports: 2039280,
          owner: TOKEN_PROGRAM,
          executable: false,
          rentEpoch: 1000,
          space: 165,
          data: {
            program: 'spl-token',
            space: 165,
            parsed: {
              type: 'account',
              info: {
                mint: USDC,
                owner: '11111111111111111111111111111111',
                state: 'initialized',
                isNative: false,
                tokenAmount: { amount: '12500000', decimals: 6, uiAmount: 12.5, uiAmountString: '12.5' },
              },
            },
          },
        },
      },
    ]
    const results: Record<string, unknown> = {
      getSlot: context.slot,
      getBalance: { context, value: 1000000000 },
      getTokenAccountsByOwner: {
        context,
        value: (request.params[1] as { programId?: string })?.programId === TOKEN_PROGRAM ? accounts : [],
      },
    }
    await route.fulfill({ json: { jsonrpc: '2.0', id: request.id, result: results[request.method] } })
  }
  // Public Solana endpoints rejected indexed token reads during the 2026-10-01 reproduction.
  const unavailable = (route: Readonly<Route>) =>
    route.fulfill({ status: 403, body: 'Token reads require authentication' })
  await page.route('https://api.mainnet-beta.solana.com/**', unavailable)
  await page.route('https://solana-rpc.publicnode.com/**', unavailable)
  await page.route('https://solana-mainnet.g.alchemy.com/**', unavailable)
  await page.route('**/api/solana', rpc)
}
