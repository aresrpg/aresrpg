// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Money that enters the account: the one funding window, the exact quote a deposit must match (decoded from
// captured provider payloads), the source-chain transaction that pays it, and the amounts a player types.
import { afterEach, expect, spyOn, test } from 'bun:test'
import type { BaseConnectedEthereumWallet, BaseConnectedSolanaWallet } from '@privy-io/react-auth'
import { CHARACTER_PRICE_MIST } from '@aresrpg/sdk/character-price'
import {
  address,
  createSolanaRpcFromTransport,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type RpcTransport,
} from '@solana/kit'

import {
  character_creation_failure_message,
  character_creation_funding_text,
  character_creation_insufficient,
} from '../src/character_creation_funding.ts'
import {
  checkout_locked,
  initial_checkout,
  reduce_checkout,
  TRANSFER_STEPS,
  transfer_visible,
} from '../src/funding/checkout_state.ts'
import { decode_quote, decode_status, funding_quote, funding_shortfall } from '../src/funding/near.ts'
import { payment_rejected } from '../src/funding/useFundingCheckout.ts'
import { read_sui_usd } from '../src/funding/useSuiUsd.ts'
import { load_app_copy } from '../src/i18n/copy.ts'
import { LOCALES } from '../src/i18n/locale.ts'
import { SITE_MODULES } from '../src/site_modules.ts'
import { evm_send } from '../src/wallet/evm_funding.ts'
import { solana_balances, solana_send } from '../src/wallet/solana_funding.ts'
import { format_sui, format_token, parse_sui_amount } from '../src/wallet_amount.ts'

import captured from './fixtures/near_quote.json' with { type: 'json' }
import solana_quote from './fixtures/near_solana_quote.json' with { type: 'json' }
import refunded_quote from './fixtures/near_solana_refunded_quote.json' with { type: 'json' }
import {
  SOLANA_ACCOUNTS,
  SOLANA_MINT,
  SOLANA_RECIPIENT,
  SOLANA_SENDER,
  solana_rpc_result,
} from './fixtures/solana_rpc.ts'
import { character_row, fake_wallet, sign_in, start_surface, type Started } from './harness.ts'

const running: Started[] = []
afterEach(() => running.splice(0).forEach(({ stop }) => stop()))

test('the one funding window asks for the first hero until the roster has one, and closes with the account', async () => {
  const site = await start_surface(SITE_MODULES, { seat: false, account: { wallet: fake_wallet() } })
  running.push(site)
  await sign_in(site)
  site.dispatch({ type: 'funding/open' })
  expect(site.state().funding).toEqual({ cost_mist: CHARACTER_PRICE_MIST })
  site.dispatch({ type: 'funding/open', cost_mist: 42n })
  expect(site.state().funding).toEqual({ cost_mist: 42n, authorization: undefined })
  site.dispatch({ type: 'funding/close' })
  site.receive({ type: 'packet/characters', characters: [character_row('0xc1')] })
  site.dispatch({ type: 'funding/open' })
  expect(site.state().funding).toEqual({ cost_mist: 0n })
  site.dispatch({ type: 'auth/disconnected' })
  expect(site.state().funding).toBeNull()
  // The 10 SUI hero keeps the SDK's whole gas reserve behind it.
  expect(character_creation_insufficient(10_049_999_999n)).toBe(true)
  expect(character_creation_insufficient(10_050_000_000n)).toBe(false)
  expect(character_creation_insufficient(null)).toBe(false)
  // Funding tops up the purchase and its cushion, and never charges the hero's price twice.
  expect(funding_shortfall(1_000_000_000n, 0n)).toBe(1_200_000_000n)
  expect(funding_shortfall(0n, 150_000_000n)).toBe(50_000_000n)
  expect(funding_shortfall(2_000_000_000n, 1_000_000_000n)).toBe(1_200_000_000n)
})

test('every locale names the reserved fee, and a split-coin failure is translated only at hero creation', async () => {
  for (const { code } of LOCALES) {
    const copy = await load_app_copy(code)
    const amount = (mist: bigint, digits = 2): string => format_sui(mist, digits, code)
    for (const template of [copy.welcome_need_sui, copy.insufficient_sui]) {
      const rendered = character_creation_funding_text(template, amount)
      expect(rendered).toContain(new Intl.NumberFormat(code).format(0.05))
      expect(rendered).not.toContain('{{fee}}')
    }
  }
  expect(
    character_creation_failure_message(
      new Error('Transaction resolution failed: InsufficientCoinBalance in command 1'),
      {
        insufficient_sui: 'Keep {{fee}} SUI for fees.',
      }
    )
  ).toMatchObject({ name: 'LocalizedError', message: 'Keep 0.05 SUI for fees.' })
  const other = new Error('Transaction resolution failed: MoveAbort')
  expect(character_creation_failure_message(other, null)).toBe(other)
  // Amounts a player types are exact decimals; displays keep six significant digits.
  expect(parse_sui_amount('1.25')).toBe(1_250_000_000n)
  expect(parse_sui_amount('0.000000001')).toBe(1n)
  for (const refused of ['0', '-1', '0.0000000001', '1e2']) expect(parse_sui_amount(refused)).toBeNull()
  expect(format_token(4_687_123_001_203_636n, 18)).toBe('0.00468712')
  expect(format_token(1_234_567_890n, 6)).toBe('1234.56')
  expect(format_sui(-20_000_000n, 4)).toBe('-0.0200')
})

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

test('a captured exact-output quote pins native SUI, the recipient, the refund address and the deadline', async () => {
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
  // The request asks a 1% input allowance and sends the provider's amount with no second buffer.
  const send = spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(response))
  try {
    const quote = await funding_quote(expected, new AbortController().signal)
    const body = JSON.parse(String(send.mock.calls[0]![1]?.body))
    expect(body).toMatchObject({ swapType: 'EXACT_OUTPUT', slippageTolerance: 100, amount: '1200000000' })
    expect(quote.amount_in).toBe(BigInt(captured.quote.amountIn))
    expect(quote.amount_out).toBe(expected.amount)
  } finally {
    send.mockRestore()
  }
  // Captured 2026-10-27: 1Click correlation 9098b4ee-e1a1-4dd4-b2c2-d18eed5aaaf2 (dry quote). Refund correlation
  // 99d376ed-85a7-47d5-9789-c4eef7388a5e comes from Solana transaction
  // 4t2gCJB7EMPRLYXR65t4AmpGEFi2Ua8aTDsUwPV2yYSm6Q6KC8966bbCjsTpjAfSCNxaNmygeXZqXbkCEC8QmrV.
  const solana_expected = {
    source: { ...source, asset_id: solana_quote.quoteRequest.originAsset, blockchain: 'sol' },
    sender: solana_quote.quoteRequest.refundTo,
    recipient: solana_quote.quoteRequest.recipient,
    amount: 1_000_000_000n,
  }
  expect(() => decode_quote(refunded_quote, solana_expected)).toThrow('funding_invalid_response')
  const solana_response = {
    ...solana_quote,
    quote: { ...solana_quote.quote, depositAddress: refunded_quote.quote.depositAddress },
  }
  expect(decode_quote(solana_response, solana_expected)).toMatchObject({
    amount_in: 923866n,
    amount_out: 1_000_000_000n,
  })
  // The provider's address lifetime cannot extend the requested payment deadline.
  const priced = { ...refunded_quote, quoteRequest: { ...refunded_quote.quoteRequest, slippageTolerance: 100 } }
  expect(decode_quote(priced, solana_expected).deadline).toBe(Date.parse(priced.quoteRequest.deadline))
  const earlier = '2026-10-27T08:15:00.000Z'
  expect(decode_quote({ ...priced, quote: { ...priced.quote, deadline: earlier } }, solana_expected).deadline).toBe(
    Date.parse(earlier)
  )
  // Unknown provider statuses fail closed.
  expect(decode_status({ status: 'REFUNDED' })).toBe('refunded')
  expect(decode_status({ status: 'PROCESSING' })).toBe('bridging')
  expect(() => decode_status({ status: 'NEW_UNKNOWN_STATE' })).toThrow()
  // Captured 2026-10-25 from https://1click.chaindefuser.com/v0/tokens, native SUI catalogue row.
  const sui_row = { assetId: 'nep141:sui.omft.near', blockchain: 'sui', symbol: 'SUI', decimals: 9, price: 0.90794 }
  const respond = (body: unknown, status = 200) =>
    (async () => Response.json(body, { status })) as unknown as typeof fetch
  const { signal } = new AbortController()
  expect(await read_sui_usd(signal, respond([sui_row]))).toBe(0.90794)
  for (const body of [
    null,
    [],
    [{ ...sui_row, assetId: 'nep141:eth.omft.near' }],
    [{ ...sui_row, price: 0 }],
    [{ ...sui_row, price: '0.9' }],
  ])
    await expect(read_sui_usd(signal, respond(body))).rejects.toThrow()
  await expect(read_sui_usd(signal, respond([sui_row], 503))).rejects.toThrow('unavailable')
})

test('an unsent or uncertain deposit stays locked; provider status moves the transfer forward only', () => {
  const unknown = reduce_checkout(initial_checkout(), { type: 'error', error: 'timeout', uncertain: true })
  expect(checkout_locked(unknown)).toBe(true)
  expect(reduce_checkout(unknown, { type: 'reset' })).toBe(unknown)
  expect(reduce_checkout(unknown, { type: 'observed', status: 'refunded' })).toMatchObject({ stage: 'refunded' })
  expect(payment_rejected({ cause: { code: 4001 } })).toBe(true)
  expect(payment_rejected(new Error('Network timeout'))).toBe(false)
  expect(transfer_visible(reduce_checkout(initial_checkout(), { type: 'error', error: 'rejected' }))).toBe(false)
  const idle = initial_checkout()
  expect(reduce_checkout(idle, { type: 'observed', status: 'success' })).toBe(idle)
  // Only owned tokens enter the picker; a failed read is not an empty wallet; a late read of another wallet is refused.
  const held = (asset_id: string, balance: bigint) => ({
    asset_id,
    symbol: asset_id,
    balance,
    blockchain: 'sol',
    decimals: 6,
    price: 1,
  })
  const first = { address: 'first' } as never
  const second = { address: 'second' } as never
  const loading = reduce_checkout(idle, { type: 'assets_loading', source: second })
  expect(reduce_checkout(loading, { type: 'assets', source: first, assets: [held('OLD', 9n)], failed: false })).toBe(
    loading
  )
  const ready = reduce_checkout(loading, {
    type: 'assets',
    source: second,
    assets: [held('USDC', 0n), held('SOL', 100n)],
    failed: false,
  })
  expect(ready).toMatchObject({ asset_id: 'SOL', assets_status: 'ready' })
  expect(ready.assets.map(({ asset_id }) => asset_id)).toEqual(['SOL'])
  expect(reduce_checkout(loading, { type: 'assets', source: second, assets: [], failed: true }).assets_status).toBe(
    'failed'
  )
  const pending = reduce_checkout(ready, { type: 'submitted', transaction: '0xabc', at: 1_000 })
  expect(TRANSFER_STEPS[pending.stage]).toEqual(['live', 'todo', 'todo'])
  const bridging = reduce_checkout(pending, { type: 'observed', status: 'bridging' })
  expect(checkout_locked(bridging)).toBe(true)
  expect(reduce_checkout(bridging, { type: 'observed', status: 'pending' })).toBe(bridging)
  const delivered = reduce_checkout(bridging, { type: 'observed', status: 'success' })
  expect(TRANSFER_STEPS[delivered.stage]).toEqual(['done', 'done', 'done'])
  expect(reduce_checkout(delivered, { type: 'observed', status: 'refunded' })).toBe(delivered)
  expect(TRANSFER_STEPS[reduce_checkout(pending, { type: 'observed', status: 'failed' }).stage]).toEqual([
    'done',
    'failed',
    'todo',
  ])
})

const decode_solana = (bytes: Uint8Array) => {
  const message = getCompiledTransactionMessageDecoder().decode(getTransactionDecoder().decode(bytes).messageBytes)
  if (message.version !== 0) throw new Error('Expected a version-0 funding transaction')
  return message
}
const solana_source = (balance = 10_000_000_000) => {
  const transactions: Uint8Array[] = []
  const methods: string[] = []
  const wallet = {
    address: SOLANA_SENDER,
    isConnected: async () => true,
    provider: {
      signAndSendTransaction: async ({ transaction }: { transaction: Uint8Array }) => {
        transactions.push(transaction)
        return { signature: new Uint8Array(64).fill(5) }
      },
    },
  } as unknown as BaseConnectedSolanaWallet
  const transport = async <T>({ payload }: Parameters<RpcTransport>[0]): Promise<T> => {
    const { id, method } = payload as { id: string; method: string }
    methods.push(method)
    return { jsonrpc: '2.0', id, result: solana_rpc_result(method, balance) } as T
  }
  return { wallet, rpc: createSolanaRpcFromTransport(transport), transactions, methods }
}

test('a Solana deposit sends exactly the quoted amount in one transaction, gathering fragmented token accounts', async () => {
  const sol = solana_source()
  const sol_asset = { asset_id: 'sol', blockchain: 'sol', symbol: 'SOL', decimals: 9, price: 1 }
  await solana_send(sol.wallet, { asset: sol_asset, recipient: SOLANA_RECIPIENT, amount: 123456n }, () => {}, sol.rpc)
  const lamports = decode_solana(sol.transactions[0]!)
  const [transfer] = lamports.instructions
  expect(Array.from(transfer!.data!)).toEqual([2, 0, 0, 0, 64, 226, 1, 0, 0, 0, 0, 0])
  expect(transfer!.accountIndices!.map((index) => lamports.staticAccounts[index])).toEqual([
    SOLANA_SENDER,
    SOLANA_RECIPIENT,
  ])
  expect(lamports.staticAccounts[transfer!.programAddressIndex]).toBe(address('11111111111111111111111111111111'))
  expect(sol.transactions).toHaveLength(1)

  const usdc = { asset_id: 'usdc', blockchain: 'sol', symbol: 'USDC', decimals: 6, contract: SOLANA_MINT, price: 1 }
  const spl = solana_source()
  await solana_send(spl.wallet, { asset: usdc, recipient: SOLANA_RECIPIENT, amount: 1_000_000n }, () => {}, spl.rpc)
  const message = decode_solana(spl.transactions[0]!)
  const [create, ...transfers] = message.instructions
  expect(message.header.numSignerAccounts).toBe(1)
  expect(Array.from(create!.data!)).toEqual([1])
  expect(message.staticAccounts[create!.accountIndices![2]!]).toBe(SOLANA_RECIPIENT)
  expect(transfers.map(({ data }) => new DataView(data!.buffer, data!.byteOffset).getBigUint64(1, true))).toEqual([
    400_000n,
    600_000n,
  ])
  expect(transfers.map(({ accountIndices }) => message.staticAccounts[accountIndices![0]!])).toEqual([
    ...SOLANA_ACCOUNTS,
  ])
  // Without the source chain's fee the deposit fails before any signature.
  const short = solana_source(5000)
  await expect(
    solana_send(short.wallet, { asset: usdc, recipient: SOLANA_RECIPIENT, amount: 1_000_000n }, () => {}, short.rpc)
  ).rejects.toThrow('funding_source_gas')
  expect(short.transactions).toHaveLength(0)
  // The holdings read takes two calls and sums fragmented accounts.
  const read = solana_source()
  const snapshot = await solana_balances(read.wallet, [sol_asset, usdc], new AbortController().signal, read.rpc)
  expect(snapshot.assets.map(({ asset_id, balance }) => [asset_id, balance])).toEqual([
    ['sol', 10_000_000_000n],
    ['usdc', 1_300_000n],
  ])
  expect(read.methods.toSorted()).toEqual(['getBalance', 'getTokenAccountsByOwner'])
})

test('an EVM deposit transfers only the quoted tokens, with no approval, and refuses before signing when unsafe', async () => {
  const sender = `0x${'11'.repeat(20)}`
  const recipient = `0x${'22'.repeat(20)}`
  const token = `0x${'33'.repeat(20)}`
  const asset = { asset_id: 'base-usdc', blockchain: 'base', symbol: 'USDC', decimals: 6, contract: token, price: 1 }
  const source_wallet = (native_balance = '0xffffffffff', account = sender) => {
    const requests: { method: string; params?: unknown }[] = []
    const replies: Record<string, unknown> = {
      eth_chainId: '0x2105',
      eth_accounts: [account],
      eth_estimateGas: '0x5208',
      eth_gasPrice: '0x1',
      eth_getBalance: native_balance,
      eth_sendTransaction: `0x${'ab'.repeat(32)}`,
    }
    const wallet = {
      address: sender,
      switchChain: async () => {},
      getEthereumProvider: async () => ({
        request: async (request: { method: string; params?: unknown }) => {
          requests.push(request)
          if (!(request.method in replies)) throw new Error(`Unexpected RPC: ${request.method}`)
          return replies[request.method]
        },
      }),
    } as unknown as BaseConnectedEthereumWallet
    return { wallet, requests }
  }
  const paying = source_wallet()
  const submitted: string[] = []
  await evm_send(paying.wallet, { asset, recipient, amount: 1_300_000n }, () => void submitted.push('sent'))
  expect(submitted).toEqual(['sent'])
  const sends = paying.requests.filter(({ method }) => method === 'eth_sendTransaction')
  expect(sends).toHaveLength(1)
  expect((sends[0]!.params as unknown[])[0]).toEqual(
    expect.objectContaining({
      from: sender,
      to: token,
      value: '0x0',
      data: `0xa9059cbb${recipient.slice(2).padStart(64, '0')}${1_300_000n.toString(16).padStart(64, '0')}`,
    })
  )
  for (const unsafe of [source_wallet('0x0'), source_wallet('0xffffffffff', recipient)]) {
    await expect(evm_send(unsafe.wallet, { asset, recipient, amount: 1n }, () => {})).rejects.toThrow('funding_source_')
    expect(unsafe.requests.some(({ method }) => method === 'eth_sendTransaction')).toBe(false)
  }
})
