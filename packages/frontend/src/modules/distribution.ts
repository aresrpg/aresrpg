// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Two-wallet distribution: an external holder pays to send a voucher to the authenticated game
// wallet; the game wallet pays to redeem it. A failed second leg stays recoverable as a held card.

import type { GiftcardRow } from '@aresrpg/protocol'

import type { AuthSession } from '../auth.ts'
import { content_catalog } from '../content/catalog.ts'
import { encumbered_asset_ids, stack_merge_target_row } from '../inventory_stacks.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'
import { copy_text } from '../i18n/copy.ts'
import { env } from '../env.ts'
import { browser_auth_storage } from '../auth_storage.ts'
import { toast } from '../toast.ts'

import { rolled_item_types } from './claims.ts'
import { create_giftcard_attempts } from './giftcard_attempts.ts'

export type DistributionState = Readonly<{
  holder_giftcards: readonly GiftcardRow[] | null
  gift_link_ready: boolean
  pending: string | null
  error: string | null
}>

export type DistributionInput =
  | Readonly<{ type: 'distribution/refresh_holder' }>
  | Readonly<{ type: 'distribution/holder_loaded'; holder: AuthSession; giftcards: readonly GiftcardRow[] }>
  | Readonly<{ type: 'distribution/import'; giftcard: GiftcardRow }>
  | Readonly<{ type: 'distribution/imported'; giftcard: string }>
  | Readonly<{ type: 'distribution/claim_gift_link' }>
  | Readonly<{ type: 'distribution/gift_link_ready' }>
  | Readonly<{ type: 'distribution/gift_link_claimed' }>
  | Readonly<{ type: 'distribution/redeem'; giftcard: GiftcardRow; automatic?: boolean }>
  | Readonly<{ type: 'distribution/redeemed'; giftcard: string }>
  | Readonly<{ type: 'distribution/pending'; operation: string }>
  | Readonly<{ type: 'distribution/failed'; error: string }>

export const initial_distribution_state = (): DistributionState =>
  Object.freeze({
    holder_giftcards: null,
    gift_link_ready: false,
    pending: null,
    error: null,
  })

const GIFT_LINK_STORAGE_KEY = 'aresrpg:gift-link'

export const gift_link_from_url = (href: string): string | null => {
  const url = new URL(href)
  return ['/gift', '/claim'].includes(url.pathname) && url.hash.startsWith('#$') && url.hash.length > 2
    ? url.toString()
    : null
}

const gift_intent_from_url = (href: string): string | null =>
  ['/gift', '/claim'].includes(new URL(href).pathname) ? href : null

const resumable_gift_intent = (scanned: string | null, saved: string | null): string | null =>
  [scanned, saved].find((intent) => intent !== null && gift_link_from_url(intent) !== null) ?? scanned ?? saved

const session_storage = (): Storage | null => {
  try {
    return globalThis.sessionStorage ?? null
  } catch (error) {
    console.warn('Gift-link session storage is unavailable.', error)
    return null
  }
}

const stored_gift_intent = (storage: Storage | null): string | null => {
  try {
    const saved = storage?.getItem(GIFT_LINK_STORAGE_KEY)
    return saved ? gift_intent_from_url(saved) : null
  } catch (error) {
    console.warn('The saved gift link could not be read.', error)
    return null
  }
}

const remember_gift_intent = (storage: Storage | null, link: string | null): void => {
  try {
    if (link) storage?.setItem(GIFT_LINK_STORAGE_KEY, link)
    else storage?.removeItem(GIFT_LINK_STORAGE_KEY)
  } catch (error) {
    console.warn('The gift link could not be saved.', error)
  }
}

const scanned_gift_intent = (): string | null => {
  if (typeof globalThis.location === 'undefined') return null
  try {
    return gift_intent_from_url(globalThis.location.href)
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

const reduce_gift_link_input = (current: DistributionState, input: AppInput): DistributionState | null => {
  if (input.type === 'distribution/gift_link_ready')
    return Object.freeze({ ...current, gift_link_ready: true, error: null })
  if (input.type === 'distribution/gift_link_claimed')
    return Object.freeze({ ...current, gift_link_ready: false, pending: null, error: null })
  return null
}

const reduce_distribution_input = (current: DistributionState, input: AppInput): DistributionState | null => {
  if (input.type === 'distribution/imported')
    return Object.freeze({
      ...current,
      holder_giftcards: current.holder_giftcards?.filter(({ id }) => id !== input.giftcard) ?? null,
      pending: null,
    })
  if (input.type === 'distribution/pending') return Object.freeze({ ...current, pending: input.operation, error: null })
  if (input.type === 'distribution/redeemed')
    return Object.freeze({
      ...current,
      pending: null,
      error: null,
    })
  if (input.type === 'distribution/failed') return Object.freeze({ ...current, pending: null, error: input.error })
  return null
}

const holder_operation = (operation: string | null): boolean =>
  operation === 'load' || (operation !== null && operation.startsWith('import:'))

const reduce = (state: AppState, input: AppInput): AppState => {
  if (input.type === 'distribution/holder_loaded')
    return input.holder === state.external_wallet.session
      ? with_distribution(state, { ...state.distribution, holder_giftcards: input.giftcards, pending: null })
      : state
  const holder_pending = holder_operation(state.distribution.pending)
  if (
    input.type.startsWith('external_wallet/') &&
    !state.external_wallet.session &&
    (state.distribution.holder_giftcards !== null || holder_pending)
  )
    return with_distribution(state, {
      ...state.distribution,
      holder_giftcards: null,
      pending: holder_pending ? null : state.distribution.pending,
      error: null,
    })
  const next = reduce_gift_link_input(state.distribution, input) ?? reduce_distribution_input(state.distribution, input)
  if (next) return with_distribution(state, next)
  if (input.type === 'auth/disconnected' || input.type === 'auth/rejected')
    return with_distribution(
      state,
      Object.freeze({
        ...initial_distribution_state(),
        gift_link_ready: state.distribution.gift_link_ready,
      })
    )
  return state
}

const redemption_plan = (state: AppState, giftcard: GiftcardRow) => {
  const { wallet, inventory } = state.session
  const item_type = rolled_item_types().get(giftcard.template)
  const item = item_type ? content_catalog.item(item_type)?.item : null
  if (!wallet || !item || !state.session.roster_loaded) return null
  const existing = stack_merge_target_row(
    inventory,
    encumbered_asset_ids(state.marketplace.own_listings, state.trade.rows),
    item.item_type,
    undefined,
    giftcard.amount
  )
  return Object.freeze({ wallet, item, existing })
}

const observe: NonNullable<AppModule['observe']> = ({ events, dispatch, get_state, signal }) => {
  let game_lifetime = 0
  let holder_lifetime = 0
  const current_operation = (holder = false): (() => boolean) => {
    const game = game_lifetime
    const external = holder_lifetime
    return () => !signal.aborted && game === game_lifetime && (!holder || external === holder_lifetime)
  }
  const storage = session_storage()
  const scanned = scanned_gift_intent()
  const intent = resumable_gift_intent(scanned, stored_gift_intent(storage))
  let gift_link = intent ? gift_link_from_url(intent) : null
  remember_gift_intent(storage, gift_link ?? scanned)
  if (scanned) hide_gift_secret()
  const attempts = create_giftcard_attempts(browser_auth_storage(), env.network)
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
  if (gift_link) dispatch({ type: 'distribution/gift_link_ready' })
  if (intent) dispatch({ type: 'path/open', pathname: new URL(intent).pathname })
  events.on('auth/connected', ({ session }) => {
    if (!gift_link) {
      remember_gift_intent(storage, null)
      return
    }
    if (session.identity !== 'zklogin') {
      dispatch({ type: 'auth/disconnected' })
      dispatch({ type: 'distribution/failed', error: copy_text(get_state().copy?.airdrop_page ?? {})('gift_login') })
      return
    }
    dispatch({ type: 'distribution/claim_gift_link' })
  })
  events.on('distribution/claim_gift_link', () => {
    const state = get_state()
    const { wallet } = state.session
    if (!gift_link || !wallet || !state.session.roster_loaded || state.distribution.pending) return
    const current = current_operation()
    dispatch({ type: 'distribution/pending', operation: 'gift-link' })
    void wallet
      .claim_giftcard_link(gift_link)
      .then(({ giftcard }) => {
        if (!current()) return
        gift_link = null
        remember_gift_intent(storage, null)
        dispatch({ type: 'distribution/gift_link_claimed' })
        if (!signal.aborted && get_state().session.wallet === wallet) dispatch({ type: 'giftcard/received', giftcard })
      })
      .catch((error) => {
        if (current()) fail_holder(error)
        else console.error('Gift-link claim failed after the account changed.', error)
      })
  })
  const refresh_holder = (): void => {
    const { pending } = get_state().distribution
    const holder = get_state().external_wallet.session
    if (!holder || pending) return
    const current = current_operation(true)
    dispatch({ type: 'distribution/pending', operation: 'load' })
    void holder
      .read_giftcards()
      .then((giftcards) => {
        if (current()) dispatch({ type: 'distribution/holder_loaded', holder, giftcards })
      })
      .catch((error) => {
        if (current()) fail_holder(error)
        else console.error('Giftcard inspection failed after the wallet changed.', error)
      })
  }
  events.on('distribution/refresh_holder', refresh_holder)
  events.on('distribution/import', ({ giftcard }) => {
    const { distribution, session } = get_state()
    const { pending } = distribution
    const holder = get_state().external_wallet.session
    const recipient = session.wallet
    if (!holder || !recipient || pending || !distribution.holder_giftcards?.some(({ id }) => id === giftcard.id)) return
    if (recipient.identity !== 'zklogin')
      return fail_holder(new Error(copy_text(get_state().copy?.airdrop_page ?? {})('gift_login')))
    const current = current_operation(true)
    dispatch({ type: 'distribution/pending', operation: `import:${giftcard.id}` })
    void holder
      .transfer_giftcards([{ id: giftcard.id, recipient: recipient.address }])
      .then(({ giftcards }) => {
        if (!current()) return
        dispatch({ type: 'distribution/imported', giftcard: giftcard.id })
        for (const card of giftcards) dispatch({ type: 'giftcard/received', giftcard: card })
      })
      .catch((error) => {
        if (current()) fail_holder(error)
        else console.error('Giftcard transfer failed after the account changed.', error)
      })
  })
  events.on('distribution/redeem', ({ giftcard, automatic }) => {
    const state = get_state()
    const plan = redemption_plan(state, giftcard)
    if (!plan || state.distribution.pending) return
    const { wallet, item, existing } = plan
    const current = current_operation()
    const retained = attempts.remember(wallet.address, giftcard.id)
    if (automatic && !retained) return
    dispatch({ type: 'distribution/pending', operation: `redeem:${giftcard.id}` })
    void wallet
      .redeem_giftcard({
        card: giftcard,
        category: item.category,
        existing_item_id: existing?.id ?? null,
        existing_kiosk_id: existing?.kiosk ?? null,
      })
      .then(() => {
        if (!current()) return
        dispatch({ type: 'giftcard/redeemed', giftcard: giftcard.id })
        dispatch({ type: 'distribution/redeemed', giftcard: giftcard.id })
        dispatch({ type: 'wallet/refresh' })
      })
      .catch((error) => {
        if (current()) fail_game_wallet(error)
        else console.error('Giftcard redemption failed after the wallet changed.', error)
      })
  })
  events.on('STATE_UPDATED', (state, previous) => {
    if (state.session.wallet !== previous.session.wallet) game_lifetime++
    if (state.external_wallet.session !== previous.external_wallet.session) holder_lifetime++
  })
  events.on('STATE_UPDATED', (state, previous) => {
    if (state.navigation.page !== 'airdrop' || state.distribution.error) return
    if (state.distribution.holder_giftcards !== null && previous.navigation.page === 'airdrop') return
    refresh_holder()
  })
  events.on('STATE_UPDATED', (state, previous) => {
    if (
      state.session === previous.session &&
      state.distribution === previous.distribution &&
      state.navigation === previous.navigation
    )
      return
    queueMicrotask(() => {
      if (signal.aborted) return
      const state = get_state()
      if (
        state.navigation.page !== 'airdrop' ||
        state.session.wallet?.identity !== 'zklogin' ||
        !state.session.roster_loaded ||
        state.distribution.pending ||
        state.distribution.error
      )
        return
      if (gift_link) return dispatch({ type: 'distribution/claim_gift_link' })
      const card = state.session.giftcards.find(({ id }) => !attempts.has(state.session.wallet!.address, id))
      if (card && redemption_plan(state, card))
        dispatch({ type: 'distribution/redeem', giftcard: card, automatic: true })
    })
  })
  if (gift_link && get_state().session.wallet?.identity === 'zklogin')
    dispatch({ type: 'distribution/claim_gift_link' })
}

export default Object.freeze({ name: 'distribution', reduce, observe }) satisfies AppModule
