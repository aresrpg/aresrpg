// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { decode_assets, decode_quote, decode_status, funding_shortfall } from '../../src/funding/near.ts'

import captured from './fixtures/near_quote.json' with { type: 'json' }

// Captured from 1Click POST /v0/quote on 2026-10-25, correlation 61cbcac5-af97-40be-9668-3ef58c939f54.
// Dry quote: the deposit address below is synthetic, since the dry endpoint does not allocate one.
const response = {
  ...captured,
  quote: { ...captured.quote, depositAddress: '0x2222222222222222222222222222222222222222' },
}
const source = {
  asset_id: captured.quoteRequest.originAsset,
  symbol: 'USDC',
  blockchain: 'base',
  decimals: 6,
  price: 1,
}
const expected = {
  source,
  sender: captured.quoteRequest.refundTo,
  recipient: captured.quoteRequest.recipient,
  amount: 1_200_000_000n,
}

test('funding tops up the purchase and cushion, never charges the character price twice', () => {
  expect(funding_shortfall(1_000_000_000n, 0n)).toBe(1_200_000_000n)
  expect(funding_shortfall(0n, 150_000_000n)).toBe(50_000_000n)
  expect(funding_shortfall(0n, 300_000_000n)).toBe(0n)
  expect(funding_shortfall(2_000_000_000n, 1_000_000_000n)).toBe(1_200_000_000n)
})

test('captured exact-output quote pins native SUI, recipient and source refund address', () => {
  expect(decode_quote(response, expected)).toMatchObject({
    amount_in: 1107290n,
    amount_out: 1_200_000_000n,
    sender: expected.sender,
    recipient: expected.recipient,
  })
  for (const patch of [
    { destinationAsset: 'nep141:eth.omft.near' },
    { recipient: '0xwrong' },
    { refundTo: '0xwrong' },
    { recipientType: 'INTENTS' },
    { refundType: 'INTENTS' },
    { swapType: 'EXACT_INPUT' },
    { originAsset: 'wrong' },
  ])
    expect(() =>
      decode_quote({ ...response, quoteRequest: { ...captured.quoteRequest, ...patch } }, expected)
    ).toThrow()
  expect(() =>
    decode_quote({ ...response, quote: { ...response.quote, minAmountOut: '1199999999' } }, expected)
  ).toThrow()
  expect(() => decode_quote({ ...response, quote: { ...response.quote, amountIn: '-1' } }, expected)).toThrow()
})

test('unknown provider statuses and malformed catalogue rows fail closed', () => {
  expect(decode_status({ status: 'REFUNDED' })).toBe('refunded')
  expect(decode_status({ status: 'INCOMPLETE_DEPOSIT' })).toBe('pending')
  expect(decode_status({ status: 'KNOWN_DEPOSIT_TX' })).toBe('pending')
  expect(decode_status({ status: 'PROCESSING' })).toBe('bridging')
  expect(() => decode_status({ status: 'NEW_UNKNOWN_STATE' })).toThrow()
  expect(() => decode_assets([{ assetId: 'x', symbol: 'X', blockchain: 'base', decimals: -1 }])).toThrow()
})
