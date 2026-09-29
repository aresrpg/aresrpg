// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import {
  bridge_config,
  FUNDING_SOURCE_CHAINS,
  FUNDING_SUI_CHAIN,
  FUNDING_SUI_TOKEN,
} from '../../src/funding/bridge_config.ts'
import chains from '../../e2e/fixtures/funding_chains.json'
import deployment from '../../vercel.json'

const address = `0x${'11'.repeat(32)}`
test('funding locks native SUI and the game recipient independently of URL or source wallet', () => {
  const config = bridge_config(address, 'en')
  expect(config.toChain).toBe(FUNDING_SUI_CHAIN)
  expect(config.toToken).toBe(FUNDING_SUI_TOKEN)
  expect(config.toAddress!.address).toBe(address)
  expect(String(config.toAddress!.chainType)).toBe('MVM')
  expect(config.chains!.to).toEqual({ allow: [FUNDING_SUI_CHAIN] })
  expect(config.chains!.from!.allow).not.toContain(FUNDING_SUI_CHAIN)
  expect(config.tokens!.to).toEqual({ allow: [{ chainId: FUNDING_SUI_CHAIN, address: FUNDING_SUI_TOKEN }] })
  expect(config.disabledUI).toEqual({ toAddress: true, toToken: true })
  expect(config.requiredUI).toEqual({ toAddress: true })
  expect(config.buildUrl).toBe(false)
  expect(config.sdkConfig!.routeOptions!.allowSwitchChain).toBe(false)
  expect(config.apiKey).toBeUndefined()
  expect(config.feeConfig).toBeUndefined()
})
test('transfer history is stable per recipient and isolated across game accounts', () => {
  expect(bridge_config(address, 'fr').keyPrefix).toBe(bridge_config(address, 'en').keyPrefix)
  expect(bridge_config(`0x${'22'.repeat(32)}`, 'en').keyPrefix).not.toBe(bridge_config(address, 'en').keyPrefix)
  expect(() => bridge_config('0x1234', 'en')).toThrow('Invalid funding address')
})

test('production policy permits the captured RPCs for every offered funding chain', () => {
  const policy = deployment.headers
    .flatMap(({ headers }) => headers)
    .find(({ key }) => key === 'Content-Security-Policy')!.value
  const connections = policy
    .split(';')
    .find((directive) => directive.trim().startsWith('connect-src'))!
    .split(/\s+/u)
  for (const id of [...FUNDING_SOURCE_CHAINS, FUNDING_SUI_CHAIN]) {
    const chain = chains.chains.find((candidate) => candidate.id === id)!
    expect(chain).toBeDefined()
    for (const url of chain.metamask.rpcUrls) expect(connections).toContain(new URL(url).origin)
  }
  expect(chains.chains.find(({ id }) => id === FUNDING_SUI_CHAIN)!.nativeToken.address).toBe(FUNDING_SUI_TOKEN)
})
