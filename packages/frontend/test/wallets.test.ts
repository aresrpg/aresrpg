// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The player's other wallets: switching between authorized accounts never signs anyone out, only the selected
// wallet and address are remembered, a funding wallet never becomes the game wallet, and nothing changes the holder
// while a giftcard transfer or redemption runs. A printed card's link is claimed on the gift page alone.
import { afterEach, expect, test } from 'bun:test'
import type { BaseConnectedEthereumWallet, BaseConnectedSolanaWallet } from '@privy-io/react-auth'
import type { GiftPolicy } from '@aresrpg/sdk/gift-provenance'
import { GiftError, type GiftStatus } from '@aresrpg/sdk/gift'

import { capture_gift_intent, is_gift_entry, saved_gift_route } from '../src/airdrop/gift_intent.ts'
import { gift_presentation } from '../src/airdrop/gift_presentation.ts'
import { create_gift_runtime } from '../src/airdrop/gift_runtime.ts'
import {
  gift_needs_funding,
  initial_gift_state,
  reduce_gift,
  type GiftState,
  type GiftWallet,
} from '../src/airdrop/gift_state.ts'
import { GAME_MODULES } from '../src/game/game_modules.ts'
import { SITE_MODULES } from '../src/site_modules.ts'
import { create_privy_discovery } from '../src/wallet/privy_adapter.ts'
import { crypto_session, sui_session, type CryptoWalletSession } from '../src/wallet/external_session.ts'
import { create_wallet_runtime } from '../src/wallet/runtime.ts'

import {
  fake_wallet,
  install_browser,
  memory_storage,
  replace_globals,
  restore_globals,
  settle,
  sign_in,
  start_surface,
  type Started,
} from './harness.ts'

const running: Started[] = []
afterEach(() => running.splice(0).forEach(({ stop }) => stop()))
const FIRST = `0x${'1'.repeat(64)}`
const SECOND = `0x${'2'.repeat(64)}`

const providers = () => {
  const calls = { authorize: [] as string[], disposed: [] as string[], disconnect: 0 }
  const wallets = ['First', 'Second'].map((name) => ({
    name,
    authorize: async (silent = false) => {
      calls.authorize.push(silent ? `${name}:silent` : name)
      return [FIRST, SECOND]
    },
    connect: async (address: string) => ({
      wallet_name: name,
      address,
      dispose: () => void calls.disposed.push(`${name}:${address.slice(0, 3)}`),
      disconnect: async () => void (calls.disconnect += 1),
    }),
    disconnect: async () => void (calls.disconnect += 1),
  }))
  return { calls, create_auth: async () => ({ wallets: () => wallets }) }
}

test('accounts switch across providers without a sign-out; one selection is remembered, restored silently, forgotten on disconnect', async () => {
  const { calls, create_auth } = providers()
  const storage = memory_storage()
  const runtime = create_wallet_runtime({ network: 'testnet', storage, create_auth })
  const stop = runtime.start()
  await Bun.sleep(0)
  runtime.dispatch({ type: 'external_wallet/authorize', wallet_name: 'First' })
  await Bun.sleep(0)
  runtime.dispatch({ type: 'external_wallet/select', wallet_name: 'First', address: FIRST })
  await Bun.sleep(0)
  const first = runtime.store.getState().session
  runtime.dispatch({ type: 'external_wallet/authorize', wallet_name: 'Second' })
  await Bun.sleep(0)
  expect(runtime.store.getState().session).toBe(first)
  expect(runtime.store.getState().accounts).toHaveLength(4)
  runtime.dispatch({ type: 'external_wallet/select', wallet_name: 'Second', address: SECOND })
  await Bun.sleep(0)
  // A late invalidation of the previous account cannot remove the current one.
  runtime.dispatch({ type: 'external_wallet/invalidated', session: first! })
  expect(runtime.store.getState().session).toMatchObject({ wallet_name: 'Second', address: SECOND })
  expect(calls.disposed).toEqual(['First:0x1'])
  expect(calls.disconnect).toBe(0)
  // Only the wallet name and the address are stored.
  expect([...storage.values.values()].map((value) => JSON.parse(value))).toEqual([
    { wallet_name: 'Second', address: SECOND },
  ])
  stop()
  // The next start restores that account silently; a disconnect forgets it and the start after restores nothing.
  const restored = create_wallet_runtime({ network: 'testnet', storage, create_auth })
  const stop_restored = restored.start()
  await Bun.sleep(5)
  expect(restored.store.getState().session).toMatchObject({ wallet_name: 'Second', address: SECOND })
  expect(calls.authorize.at(-1)).toBe('Second:silent')
  restored.dispatch({ type: 'external_wallet/disconnect' })
  await Bun.sleep(0)
  expect(storage.values.size).toBe(0)
  expect(calls.disconnect).toBe(1)
  stop_restored()
  const next = create_wallet_runtime({ network: 'testnet', storage, create_auth })
  const stop_next = next.start()
  await Bun.sleep(5)
  expect(next.store.getState().session).toBeNull()
  stop_next()
})

test('a funding wallet never becomes the game wallet, and a running giftcard transfer pins the holder', async () => {
  const site = await start_surface(SITE_MODULES, { seat: false, account: { wallet: fake_wallet() } })
  running.push(site)
  const game_wallet = await sign_in(site)
  const funding: CryptoWalletSession = {
    family: 'evm',
    address: `0x${'11'.repeat(20)}`,
    wallet_name: 'MetaMask · EVM',
    disconnect: async () => {},
    is_transaction_idle: () => true,
    balance: async () => 1n,
    balances: async () => ({ assets: [], failed: false }),
    send: async () => 'hash',
  }
  site.dispatch({ type: 'external_wallet/crypto_requested' })
  site.dispatch({
    type: 'external_wallet/connected',
    sequence: site.state().external_wallet.sequence,
    session: funding,
  })
  expect(site.state().session.wallet).toBe(game_wallet)
  expect(crypto_session(site.state().external_wallet.session)).toBe(funding)
  expect(sui_session(site.state().external_wallet.session)).toBeNull()
  site.dispatch({ type: 'external_wallet/disconnect' })
  expect(site.state().session.wallet).toBe(game_wallet)
  // While a holder's vouchers move or redeem, the holder cannot be swapped or disconnected.
  const holder = fake_wallet({ read_giftcards: async () => [] }, `0x${'4'.repeat(64)}`)
  site.dispatch({ type: 'external_wallet/connected', sequence: site.state().external_wallet.sequence, session: holder })
  for (const operation of ['import', 'redeem'] as const) {
    site.dispatch({ type: 'distribution/pending', operation })
    const pinned = site.state().external_wallet
    site.dispatch({ type: 'external_wallet/disconnect' })
    expect(site.state().external_wallet).toBe(pinned)
    expect(site.state().distribution.pending).toBe(operation)
  }
})

test('a printed gift redeems once per explicit step: no automatic repeat, no paid step unfunded, no late result', () => {
  const wallet = { address: 'alice', identity: 'zklogin' } as GiftWallet
  const proof = { giftcard: `0x${'1'.repeat(64)}` }
  const ready: GiftState = { ...initial_gift_state(), ready: true, wallet }
  const checked = (
    state: GiftState,
    stage: 'voucher' | 'crate' | 'reward' | 'collected',
    balance: bigint | null = null
  ) => {
    const pending = reduce_gift(state, { type: 'request', kind: 'check' })
    return reduce_gift(pending, {
      type: 'completed',
      task: pending.task!.id,
      result: { kind: 'checked', status: { stage, proof }, balance },
    })
  }
  // A refused automatic redemption stops; only the player's next continuation retries it.
  const started = checked(ready, 'voucher')
  expect(started.task?.kind).toBe('redeem')
  const failed = reduce_gift(started, { type: 'failed', task: started.task!.id, error: 'unavailable' })
  expect(failed.task).toBeNull()
  expect(checked(failed, 'voucher').task?.kind).toBe('redeem')
  // A restored session only reads the status: it submits nothing.
  const boot = reduce_gift(initial_gift_state(), { type: 'start' })
  const restored = reduce_gift(boot, {
    type: 'completed',
    task: boot.task!.id,
    result: { kind: 'connected', wallet, advance: false },
  })
  const read = reduce_gift(restored, {
    type: 'completed',
    task: restored.task!.id,
    result: { kind: 'checked', status: { stage: 'voucher', proof }, balance: null },
  })
  expect(read.task).toBeNull()
  // One open per crate; an uncertain opening is never repeated while recovery still sees the crate.
  const opening = reduce_gift(checked(ready, 'crate'), { type: 'request', kind: 'open' })
  expect(reduce_gift(opening, { type: 'request', kind: 'open' })).toBe(opening)
  const uncertain = reduce_gift(opening, { type: 'failed', task: opening.task!.id, error: 'uncertain' })
  expect(checked(uncertain, 'crate').task).toBeNull()
  // A completion that arrives after the wallet ended changes nothing.
  const stopped = reduce_gift(opening, { type: 'invalidated', wallet })
  const late = reduce_gift(stopped, {
    type: 'completed',
    task: opening.task!.id,
    result: { kind: 'executed', status: { stage: 'reward', proof } },
  })
  expect(late).toBe(stopped)
  // Below 0.1 SUI the gift waits on the funding step; a collected gift never asks for funds.
  const unfunded = checked(ready, 'voucher', 99_999_999n)
  expect([unfunded.task, gift_needs_funding(unfunded), gift_presentation(unfunded).screen]).toEqual([
    null,
    true,
    'funding',
  ])
  expect(reduce_gift(unfunded, { type: 'request', kind: 'redeem' })).toBe(unfunded)
  expect(checked(unfunded, 'voucher', 100_000_000n).task?.kind).toBe('redeem')
  expect(gift_needs_funding(checked(ready, 'collected', 0n))).toBe(false)
})

test('a printed card is claimed on the gift page alone: arrival, sign-in, claim, a spent or malformed link, and never by the app store', async () => {
  const card_link = 'https://aresrpg.world/claim#$printed-key'
  const tab = memory_storage()
  const saved = (): boolean => [...tab.values.values()].includes(card_link)
  const arrive = (href: string): string | null => {
    install_browser(href)
    replace_globals({ sessionStorage: tab })
    return is_gift_entry(location.pathname, location.hash, saved_gift_route()) ? capture_gift_intent() : null
  }
  const calls: string[] = []
  const reads: string[] = []
  const chain = { claimed: false }
  const card = { id: `0x${'c'.repeat(64)}`, template: '0xtemplate', amount: 1 }
  const status = (stage: GiftStatus['stage'], proof: GiftStatus['proof']): GiftStatus =>
    ({ stage, proof }) as GiftStatus
  const gift_wallet = {
    address: `0x${'b'.repeat(64)}`,
    wallet_name: 'Sign in with Google',
    identity: 'zklogin',
    disconnect: async () => undefined,
    read_sui_balance: async () => {
      reads.push('balance')
      return 1_000_000_000n
    },
    // The SDK refuses a key it cannot parse before any request, with its typed gift error.
    inspect_giftcard_link: async (url: string) => {
      reads.push('inspect')
      if (url.endsWith('#$not-a-key')) throw new GiftError('invalid')
      return chain.claimed ? null : card
    },
    gift: () => ({
      recover: async () => false,
      status: async (proof: GiftStatus['proof']) => {
        reads.push('status')
        // Without a proof the SDK looks in the account; this one holds no other gift.
        return proof ? status(chain.claimed ? 'voucher' : 'available', proof) : status('missing', null)
      },
      transfer: async (url: string, proof: GiftStatus['proof']) => {
        calls.push(`transfer ${url}`)
        chain.claimed = true
        return status('voucher', proof)
      },
      execute: async (action: string, current: GiftStatus) => {
        calls.push(action)
        return status('crate', current.proof)
      },
    }),
  } as unknown as GiftWallet
  const gift_page = (link: string | null) => {
    const runtime = create_gift_runtime({
      link,
      policy: {} as GiftPolicy,
      storage: memory_storage(),
      load_auth: async () => () => ({
        connect_google: async () => gift_wallet,
        restore: async () => null,
        dispose: () => undefined,
      }),
    })
    return { runtime, stop: runtime.observe(), screen: () => gift_presentation(runtime.store.getState()).screen }
  }
  try {
    // A printed QR card opens the gift page; its key leaves the address bar but stays in the tab.
    expect(arrive(card_link)).toBe(card_link)
    expect([location.hash, saved()]).toEqual(['', true])
    // A reload keeps the gift page and the link, though the key is no longer in the address.
    expect(arrive('https://aresrpg.world/claim')).toBe(card_link)
    const first = gift_page(card_link)
    await settle()
    expect(first.screen()).toBe('welcome')
    // Signing in with Google claims the card with the player's wallet, redeems it, and waits on the crate.
    first.runtime.dispatch({ type: 'request', kind: 'login' })
    await settle(5)
    expect(calls).toEqual([`transfer ${card_link}`, 'redeem'])
    expect(first.screen()).toBe('received')
    // Claimed: the key leaves the tab; the route stays, so a reload still opens the gift page.
    expect(saved()).toBe(false)
    expect(is_gift_entry('/claim', '', saved_gift_route())).toBe(true)
    first.stop()
    // The same card again is spent: the page says so, submits nothing and forgets the link.
    const again = gift_page(arrive(card_link))
    await settle()
    again.runtime.dispatch({ type: 'request', kind: 'login' })
    await settle(5)
    expect([again.screen(), calls.length, saved()]).toEqual(['missing', 2, false])
    again.stop()
    // A malformed key ends at once on "this link is not valid": no chain request, no retry, no link left in the tab.
    const malformed = 'https://aresrpg.world/claim#$not-a-key'
    const refused = gift_page(arrive(malformed))
    await settle()
    reads.splice(0)
    refused.runtime.dispatch({ type: 'request', kind: 'login' })
    await settle(5)
    expect([refused.screen(), refused.runtime.store.getState().error, reads]).toEqual([
      'missing',
      'invalid',
      ['inspect'],
    ])
    expect([...tab.values.values()]).not.toContain(malformed)
    refused.runtime.dispatch({ type: 'request', kind: 'check' })
    await settle(5)
    expect([refused.screen(), reads.filter((read) => read === 'inspect')]).toEqual(['missing', ['inspect']])
    expect(calls.length).toBe(2)
    refused.stop()
    // A tab that still holds an unclaimed link: neither the site nor the game claims it, whatever the player opens.
    chain.claimed = false
    arrive('https://aresrpg.world/gift#$second-key')
    let store_claims = 0
    const wallet = fake_wallet({
      claim_giftcard_link: async () => {
        store_claims += 1
        return null
      },
      read_giftcards: async () => [],
    })
    for (const [modules, seat] of [
      [SITE_MODULES, false],
      [GAME_MODULES, true],
    ] as const) {
      const surface = await start_surface(modules, { seat, account: { wallet } })
      replace_globals({ sessionStorage: tab })
      await sign_in(surface)
      surface.dispatch({ type: 'distribution/viewed', open: true })
      await settle(5)
      surface.stop()
    }
    expect(store_claims).toBe(0)
    expect([...tab.values.values()]).toContain('https://aresrpg.world/gift#$second-key')
  } finally {
    restore_globals()
  }
})

test('the Privy adapter publishes a funding wallet only when its provider or account really changed', () => {
  const discover = create_privy_discovery()
  // Repeated empty snapshots publish once: no render loop.
  expect([discover([]), discover([])]).toEqual([[], null])
  const phantom = { name: 'Phantom' }
  const solana = (address: string, standard = phantom) =>
    ({
      type: 'solana',
      address,
      meta: { name: standard.name },
      provider: { standardWallet: standard },
    }) as BaseConnectedSolanaWallet
  expect(discover([solana('first')])?.map(({ name }) => name)).toEqual(['Phantom · Solana'])
  // A wrapper rebuilt around the same wallet is not a change; another account or provider object is.
  expect(discover([solana('first')])).toBeNull()
  expect(discover([solana('second')])).not.toBeNull()
  expect(discover([solana('second', { name: 'Phantom' })])).not.toBeNull()
  const evm = { type: 'ethereum', address: 'first', meta: { name: 'MetaMask' } } as BaseConnectedEthereumWallet
  expect(discover([evm])).not.toBeNull()
  expect(discover([evm])).toBeNull()
  expect(discover([{ ...evm, address: 'second' }])).not.toBeNull()
})
