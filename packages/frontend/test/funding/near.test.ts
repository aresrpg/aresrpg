// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, spyOn, test } from 'bun:test'

import { decode_assets, decode_quote, decode_status, funding_quote, funding_shortfall } from '../../src/funding/near.ts'

import captured from './fixtures/near_quote.json' with { type: 'json' }
import solana_quote from './fixtures/near_solana_quote.json' with { type: 'json' }
import refunded_quote from './fixtures/near_solana_refunded_quote.json' with { type: 'json' }

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
    { slippageTolerance: 0 },
    { slippageTolerance: 101 },
  ])
    expect(() =>
      decode_quote({ ...response, quoteRequest: { ...captured.quoteRequest, ...patch } }, expected)
    ).toThrow()
  expect(() =>
    decode_quote({ ...response, quote: { ...response.quote, minAmountOut: '1199999999' } }, expected)
  ).toThrow()
  expect(() => decode_quote({ ...response, quote: { ...response.quote, amountIn: '-1' } }, expected)).toThrow()
})

test('funding requests a 1% input allowance and sends the provider amount without adding another buffer', async () => {
  const send = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(response))
  try {
    const quote = await funding_quote(expected, new AbortController().signal)
    const body = JSON.parse(String(send.mock.calls[0][1]?.body))
    expect(body).toMatchObject({ swapType: 'EXACT_OUTPUT', slippageTolerance: 100, amount: '1200000000' })
    expect(quote.amount_in).toBe(BigInt(captured.quote.amountIn))
    expect(quote.amount_in).toBeGreaterThan(BigInt(captured.quote.minAmountIn))
    expect(quote.amount_out).toBe(expected.amount)
  } finally {
    send.mockRestore()
  }
})

test('unknown provider statuses and malformed catalogue rows fail closed', () => {
  expect(decode_status({ status: 'REFUNDED' })).toBe('refunded')
  expect(decode_status({ status: 'INCOMPLETE_DEPOSIT' })).toBe('pending')
  expect(decode_status({ status: 'KNOWN_DEPOSIT_TX' })).toBe('pending')
  expect(decode_status({ status: 'PROCESSING' })).toBe('bridging')
  expect(() => decode_status({ status: 'NEW_UNKNOWN_STATE' })).toThrow()
  expect(() => decode_assets([{ assetId: 'x', symbol: 'X', blockchain: 'base', decimals: -1 }])).toThrow()
})

// Captured 2026-10-27: 1Click correlation 9098b4ee-e1a1-4dd4-b2c2-d18eed5aaaf2 (dry quote).
// Refund correlation 99d376ed-85a7-47d5-9789-c4eef7388a5e comes from Solana transaction
// 4t2gCJB7EMPRLYXR65t4AmpGEFi2Ua8aTDsUwPV2yYSm6Q6KC8966bbCjsTpjAfSCNxaNmygeXZqXbkCEC8QmrV.
const solana_expected = {
  source: { ...source, asset_id: solana_quote.quoteRequest.originAsset, blockchain: 'sol' },
  sender: solana_quote.quoteRequest.refundTo,
  recipient: solana_quote.quoteRequest.recipient,
  amount: 1_000_000_000n,
}

test('captured Solana quotes keep 1 SUI fixed while rejecting the refunded zero-buffer policy', () => {
  expect(() => decode_quote(refunded_quote, solana_expected)).toThrow('funding_invalid_response')
  // Dry quotes allocate no address; use the captured old address only as decoder fixture data.
  const response = {
    ...solana_quote,
    quote: { ...solana_quote.quote, depositAddress: refunded_quote.quote.depositAddress },
  }
  expect(decode_quote(response, solana_expected)).toMatchObject({ amount_in: 923866n, amount_out: 1_000_000_000n })
})

test('a provider address lifetime cannot extend the requested payment deadline', () => {
  const response = {
    ...refunded_quote,
    quoteRequest: { ...refunded_quote.quoteRequest, slippageTolerance: 100 },
  }
  expect(decode_quote(response, solana_expected).deadline).toBe(Date.parse(response.quoteRequest.deadline))
  const earlier = '2026-10-27T08:15:00.000Z'
  expect(decode_quote({ ...response, quote: { ...response.quote, deadline: earlier } }, solana_expected).deadline).toBe(
    Date.parse(earlier)
  )
})
