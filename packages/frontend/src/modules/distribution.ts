// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Two-wallet distribution: an external holder pays to send a voucher to the authenticated game
// wallet; the game wallet pays to redeem it. A failed second leg stays recoverable as a held card.

import type { AirdropState, GiftcardRow } from '@aresrpg/protocol'

import { create_admin_auth, type AuthSession } from '../auth.ts'
import { content_catalog } from '../content/catalog.ts'
import { encumbered_asset_ids, stack_merge_target_row } from '../inventory_stacks.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'
import { toast } from '../toast.ts'

import { rolled_item_types } from './claims.ts'

export type DistributionState = Readonly<{
  wallets: readonly string[]
  holder: AuthSession | null
  holder_airdrops: readonly AirdropState[] | null
  gift_link_ready: boolean
  pending: string | null
  error: string | null
}>

export type DistributionInput =
  | Readonly<{ type: 'distribution/ready'; wallets: readonly string[] }>
  | Readonly<{ type: 'distribution/connect_holder'; wallet: string }>
  | Readonly<{ type: 'distribution/holder_connected'; session: AuthSession }>
  | Readonly<{ type: 'distribution/claim'; drop_id: string }>
  | Readonly<{ type: 'distribution/claimed'; drop_id: string; giftcard: GiftcardRow }>
  | Readonly<{ type: 'distribution/claim_gift_link' }>
  | Readonly<{ type: 'distribution/gift_link_ready' }>
  | Readonly<{ type: 'distribution/gift_link_claimed' }>
  | Readonly<{ type: 'distribution/redeem'; giftcard: GiftcardRow }>
  | Readonly<{ type: 'distribution/redeemed'; giftcard: string }>
  | Readonly<{ type: 'distribution/pending'; operation: string }>
  | Readonly<{ type: 'distribution/failed'; error: string }>

export const initial_distribution_state = (): DistributionState =>
  Object.freeze({
    wallets: Object.freeze([]),
    holder: null,
    holder_airdrops: null,
    gift_link_ready: false,
    pending: null,
    error: null,
  })

const GIFT_LINK_STORAGE_KEY = 'aresrpg:gift-link'

export const gift_link_from_url = (href: string): string | null => {
  const url = new URL(href)
  return url.pathname === '/gift' && url.hash.startsWith('#$') && url.hash.length > 2 ? url.toString() : null
}

const session_storage = (): Storage | null => {
  try {
    return globalThis.sessionStorage ?? null
  } catch (error) {
    console.warn('Gift-link session storage is unavailable.', error)
    return null
  }
}

const stored_gift_link = (storage: Storage | null): string | null => {
  try {
    return storage?.getItem(GIFT_LINK_STORAGE_KEY) ?? null
  } catch (error) {
    console.warn('The saved gift link could not be read.', error)
    return null
  }
}

export const has_stored_gift_link = (): boolean => stored_gift_link(session_storage()) !== null

const remember_gift_link = (storage: Storage | null, link: string | null): void => {
  try {
    if (link) storage?.setItem(GIFT_LINK_STORAGE_KEY, link)
    else storage?.removeItem(GIFT_LINK_STORAGE_KEY)
  } catch (error) {
    console.warn('The gift link could not be saved.', error)
  }
}

const scanned_gift_link = (): string | null => {
  if (typeof globalThis.location === 'undefined') return null
  try {
    return gift_link_from_url(globalThis.location.href)
  } catch (error) {
    console.warn('The scanned gift link is invalid.', error)
    return null
  }
}

const hide_gift_secret = (): void => {
  if (typeof globalThis.location === 'undefined' || typeof globalThis.history === 'undefined') return
  globalThis.history.replaceState(null, '', `${globalThis.location.pathname}${globalThis.location.search}`)
}

const with_distribution = (state: AppState, distribution: DistributionState): AppState =>
  Object.freeze({ ...state, distribution })

const mark_claimed = (current: DistributionState, drop_id: string): DistributionState =>
  Object.freeze({
    ...current,
    holder_airdrops:
      current.holder_airdrops?.map((drop) =>
        drop.drop_id === drop_id
          ? Object.freeze({ ...drop, eligible: false, eligible_count: Math.max(0, drop.eligible_count - 1) })
          : drop
      ) ?? null,
    pending: null,
    error: null,
  })

const reduce_gift_link_input = (current: DistributionState, input: AppInput): DistributionState | null => {
  if (input.type === 'distribution/gift_link_ready')
    return Object.freeze({ ...current, gift_link_ready: true, error: null })
  if (input.type === 'distribution/gift_link_claimed')
    return Object.freeze({ ...current, gift_link_ready: false, pending: null, error: null })
  return null
}

const reduce_distribution_input = (current: DistributionState, input: AppInput): DistributionState | null => {
  if (input.type === 'distribution/ready') return Object.freeze({ ...current, wallets: input.wallets })
  if (input.type === 'distribution/holder_connected')
    return Object.freeze({ ...current, holder: input.session, holder_airdrops: null, pending: null, error: null })
  if (input.type === 'distribution/claimed') return mark_claimed(current, input.drop_id)
  if (input.type === 'distribution/pending') return Object.freeze({ ...current, pending: input.operation, error: null })
  if (input.type === 'distribution/redeemed') return Object.freeze({ ...current, pending: null, error: null })
  if (input.type === 'distribution/failed') return Object.freeze({ ...current, pending: null, error: input.error })
  return null
}

const eligibility_packet = (current: DistributionState, input: AppInput): DistributionState | null => {
  if (input.type !== 'server/packet' || input.packet.type !== 'packet/airdrop_eligibility') return null
  if (input.packet.address !== current.holder?.address) return null
  return Object.freeze({ ...current, holder_airdrops: input.packet.airdrops, pending: null, error: null })
}

const reduce = (state: AppState, input: AppInput): AppState => {
  const next =
    eligibility_packet(state.distribution, input) ??
    reduce_gift_link_input(state.distribution, input) ??
    reduce_distribution_input(state.distribution, input)
  if (next) return with_distribution(state, next)
  if (input.type === 'auth/disconnected' || input.type === 'auth/rejected')
    return with_distribution(
      state,
      Object.freeze({
        ...initial_distribution_state(),
        wallets: state.distribution.wallets,
        gift_link_ready: state.distribution.gift_link_ready,
      })
    )
  return state
}

const redemption_plan = (state: AppState, giftcard: GiftcardRow) => {
  const { wallet, inventory } = state.session
  const item_type = rolled_item_types().get(giftcard.template)
  const item = item_type ? content_catalog.item(item_type)?.item : null
  if (!wallet || !item) return null
  const existing = stack_merge_target_row(
    inventory,
    encumbered_asset_ids(state.marketplace.own_listings, state.trade.rows),
    item.item_type
  )
  return Object.freeze({ wallet, item, existing })
}

const observe: NonNullable<AppModule['observe']> = ({ events, dispatch, get_state, signal }) => {
  const holder_auth = create_admin_auth()
  const storage = session_storage()
  const scanned = scanned_gift_link()
  let gift_link = scanned ?? stored_gift_link(storage)
  if (scanned) {
    remember_gift_link(storage, scanned)
    hide_gift_secret()
  }
  const message_of = (error: unknown): string => (error instanceof Error ? error.message : String(error))
  const mark_failed = (error: unknown): string => {
    const message = message_of(error)
    dispatch({ type: 'distribution/failed', error: message })
    return message
  }
  const fail_holder = (error: unknown): void => {
    const message = mark_failed(error)
    // Holder A pays this leg. B's global gas listener must not open B's funding modal for A.
    toast.rich(message, Object.freeze([]), 'error')
  }
  const fail_game_wallet = (error: unknown): void => {
    mark_failed(error)
    toast.add(error)
  }
  dispatch({ type: 'distribution/ready', wallets: holder_auth.wallets().map(({ name }) => name) })
  if (gift_link) {
    dispatch({ type: 'distribution/gift_link_ready' })
    dispatch({ type: 'path/open', pathname: '/gift' })
  }
  events.on('auth/connected', ({ session }) => {
    if (!gift_link) return
    if (session.identity !== 'zklogin') {
      dispatch({ type: 'auth/disconnected' })
      dispatch({ type: 'distribution/failed', error: 'Continue with Google to receive this gift.' })
      return
    }
    dispatch({ type: 'distribution/claim_gift_link' })
  })
  events.on('distribution/claim_gift_link', () => {
    const state = get_state()
    const { wallet } = state.session
    if (!gift_link || !wallet || state.distribution.pending) return
    dispatch({ type: 'distribution/pending', operation: 'gift-link' })
    void wallet
      .claim_giftcard_link(gift_link)
      .then(({ giftcard }) => {
        gift_link = null
        remember_gift_link(storage, null)
        dispatch({ type: 'distribution/gift_link_claimed' })
        dispatch({ type: 'giftcard/received', giftcard })
        dispatch({ type: 'distribution/redeem', giftcard })
      })
      .catch(fail_holder)
  })
  events.on('distribution/connect_holder', ({ wallet: wallet_name }) => {
    if (get_state().distribution.pending) return
    const wallet = holder_auth.wallets().find(({ name }) => name === wallet_name)
    if (!wallet) return fail_holder(new Error(`${wallet_name} is unavailable`))
    dispatch({ type: 'distribution/pending', operation: 'connect' })
    void wallet
      .authorize()
      .then((addresses) => {
        const [address] = addresses
        if (!address) throw new Error(`${wallet_name} returned no account`)
        return wallet.connect(address)
      })
      .then((session) => dispatch({ type: 'distribution/holder_connected', session }))
      .catch(fail_holder)
  })
  events.on('distribution/claim', ({ drop_id }) => {
    const state = get_state()
    const { holder } = state.distribution
    const recipient = state.session.wallet
    const drop = content_catalog.airdrop.drops.find(({ id }) => id === drop_id)
    if (!holder || !recipient || !drop || state.distribution.pending) return
    dispatch({ type: 'distribution/pending', operation: `claim:${drop_id}` })
    void holder
      .claim_airdrop({ drop_id, item_type: drop.item_type, recipient: recipient.address })
      .then(({ giftcard }) => {
        dispatch({ type: 'distribution/claimed', drop_id, giftcard })
        dispatch({ type: 'giftcard/received', giftcard })
        dispatch({ type: 'distribution/redeem', giftcard })
      })
      .catch(fail_holder)
  })
  events.on('distribution/redeem', ({ giftcard }) => {
    const state = get_state()
    const plan = redemption_plan(state, giftcard)
    if (!plan || state.distribution.pending) return
    const { wallet, item, existing } = plan
    dispatch({ type: 'distribution/pending', operation: `redeem:${giftcard.id}` })
    void wallet
      .redeem_giftcard({
        card: giftcard,
        category: item.category,
        existing_item_id: existing?.id ?? null,
        existing_kiosk_id: existing?.kiosk ?? null,
      })
      .then(() => {
        dispatch({ type: 'distribution/redeemed', giftcard: giftcard.id })
        dispatch({ type: 'giftcard/redeemed', giftcard: giftcard.id })
        dispatch({ type: 'wallet/refresh' })
      })
      .catch(fail_game_wallet)
  })
  if (gift_link && get_state().session.wallet?.identity === 'zklogin')
    dispatch({ type: 'distribution/claim_gift_link' })
  signal.addEventListener('abort', () => void get_state().distribution.holder?.disconnect())
}

export default Object.freeze({ name: 'distribution', reduce, observe }) satisfies AppModule
