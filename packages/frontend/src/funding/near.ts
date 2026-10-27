// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { FundingAsset } from '../wallet/external_session.ts'

const API = 'https://1click.chaindefuser.com/v0'
export const NATIVE_SUI_ASSET = 'nep141:sui.omft.near'
export const FUNDING_CUSHION_MIST = 200_000_000n
const PAYMENT_DEADLINE_MS = 10 * 60 * 1000

export const funding_shortfall = (cost: bigint, balance: bigint): bigint => {
  const missing = cost + FUNDING_CUSHION_MIST - balance
  return missing > 0n ? missing : 0n
}

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('funding_invalid_response')
  return value as Record<string, unknown>
}
const text = (value: unknown): string => {
  if (typeof value !== 'string' || !value) throw new Error('funding_invalid_response')
  return value
}
const units = (value: unknown): bigint => {
  const raw = text(value)
  if (!/^\d+$/.test(raw)) throw new Error('funding_invalid_response')
  return BigInt(raw)
}

export const decode_assets = (value: unknown): readonly FundingAsset[] => {
  if (!Array.isArray(value)) throw new Error('funding_invalid_response')
  return value.map((entry: unknown) => {
    const row = record(entry)
    if (!Number.isSafeInteger(row.decimals) || Number(row.decimals) < 0) throw new Error('funding_invalid_response')
    return {
      asset_id: text(row.assetId),
      blockchain: text(row.blockchain),
      symbol: text(row.symbol),
      decimals: Number(row.decimals),
      ...(row.contractAddress ? { contract: text(row.contractAddress) } : {}),
      price: typeof row.price === 'number' && Number.isFinite(row.price) && row.price > 0 ? row.price : null,
    }
  })
}

const request = async (path: string, signal: Readonly<AbortSignal>, body?: unknown): Promise<unknown> => {
  const response = await fetch(`${API}/${path}`, {
    signal,
    credentials: 'omit',
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  if (!response.ok) throw new Error(response.status === 429 ? 'funding_rate_limited' : 'funding_route_unavailable')
  return response.json()
}

export const funding_assets = async (signal: Readonly<AbortSignal>): Promise<readonly FundingAsset[]> =>
  decode_assets(await request('tokens', signal))

export type FundingQuote = Readonly<{
  source: FundingAsset
  sender: string
  recipient: string
  amount_in: bigint
  amount_out: bigint
  deposit_address: string
  deposit_memo?: string
  deadline: number
  estimated_seconds: number | null
}>

export type QuoteRequest = Readonly<{ source: FundingAsset; sender: string; recipient: string; amount: bigint }>

export const decode_quote = (value: unknown, expected: QuoteRequest): FundingQuote => {
  const result = record(value)
  const quoted = record(result.quote)
  const intent = record(result.quoteRequest)
  const expected_intent = {
    destinationAsset: NATIVE_SUI_ASSET,
    originAsset: expected.source.asset_id,
    recipient: expected.recipient,
    refundTo: expected.sender,
    recipientType: 'DESTINATION_CHAIN',
    refundType: 'ORIGIN_CHAIN',
    swapType: 'EXACT_OUTPUT',
  }
  const matches = Object.entries(expected_intent).every(([key, value]) => intent[key] === value)
  const amounts =
    units(quoted.amountOut) === expected.amount &&
    units(quoted.minAmountOut) >= expected.amount &&
    units(quoted.amountIn) > 0n
  if (!matches || !amounts) throw new Error('funding_invalid_response')
  const deadline = Date.parse(text(quoted.deadline ?? intent.deadline))
  if (!Number.isFinite(deadline)) throw new Error('funding_invalid_response')
  return {
    source: expected.source,
    sender: expected.sender,
    recipient: expected.recipient,
    amount_in: units(quoted.amountIn),
    amount_out: units(quoted.amountOut),
    deposit_address: text(quoted.depositAddress),
    ...(quoted.depositMemo ? { deposit_memo: text(quoted.depositMemo) } : {}),
    deadline,
    estimated_seconds: typeof quoted.timeEstimate === 'number' ? quoted.timeEstimate : null,
  }
}

export const funding_quote = async (input: QuoteRequest, signal: Readonly<AbortSignal>): Promise<FundingQuote> =>
  decode_quote(
    await request('quote', signal, {
      dry: false,
      swapType: 'EXACT_OUTPUT',
      slippageTolerance: 0,
      originAsset: input.source.asset_id,
      destinationAsset: NATIVE_SUI_ASSET,
      amount: input.amount.toString(),
      depositType: 'ORIGIN_CHAIN',
      recipientType: 'DESTINATION_CHAIN',
      refundType: 'ORIGIN_CHAIN',
      recipient: input.recipient,
      refundTo: input.sender,
      deadline: new Date(Date.now() + PAYMENT_DEADLINE_MS).toISOString(),
    }),
    input
  )

// `pending` waits for the source deposit; `bridging` means 1Click holds it and is delivering SUI.
export type FundingStatus = 'pending' | 'bridging' | 'success' | 'refunded' | 'failed'
export const decode_status = (value: unknown): FundingStatus => {
  const { status } = record(value)
  switch (status) {
    case 'SUCCESS':
      return 'success'
    case 'REFUNDED':
      return 'refunded'
    case 'FAILED':
      return 'failed'
    case 'PROCESSING':
      return 'bridging'
    case 'PENDING_DEPOSIT':
    case 'KNOWN_DEPOSIT_TX':
    case 'INCOMPLETE_DEPOSIT':
      return 'pending'
    default:
      throw new Error('funding_invalid_response')
  }
}
export const funding_status = async (quote: FundingQuote, signal: Readonly<AbortSignal>): Promise<FundingStatus> => {
  const params = new URLSearchParams({ depositAddress: quote.deposit_address })
  if (quote.deposit_memo) params.set('depositMemo', quote.deposit_memo)
  return decode_status(await request(`status?${params}`, signal))
}
