// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Two-wallet distribution: an external holder pays to send a voucher to the authenticated game
// wallet; the game wallet pays to redeem it. A failed second leg stays recoverable as a held card.

import type { GiftcardRow } from '@aresrpg/protocol'
import { MAX_GIFTCARDS_PER_TRANSACTION } from '@aresrpg/sdk/auth'

import type { AuthSession } from '../auth.ts'
import { content_catalog } from '../content/catalog.ts'
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
  | Readonly<{ type: 'distribution/claim_all' }>
  | Readonly<{ type: 'distribution/import' }>
  | Readonly<{ type: 'distribution/imported'; giftcards: readonly string[] }>
  | Readonly<{ type: 'distribution/claim_gift_link' }>
  | Readonly<{ type: 'distribution/gift_link_ready' }>
  | Readonly<{ type: 'distribution/gift_link_claimed' }>
  | Readonly<{
      type: 'distribution/redeem'
      giftcards: readonly GiftcardRow[]
      automatic?: boolean
      received_transaction?: string
    }>
  | Readonly<{ type: 'distribution/redeemed' }>
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
      holder_giftcards: current.holder_giftcards?.filter(({ id }) => !input.giftcards.includes(id)) ?? null,
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

const holder_operation = (operation: string | null): boolean => operation === 'load' || operation === 'import'

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

const redeemable = (state: AppState, card: GiftcardRow): boolean => {
  const item_type = rolled_item_types().get(card.template)
  return Boolean(state.session.wallet && state.session.roster_loaded && item_type && content_catalog.item(item_type))
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
      .then(({ digest, giftcard }) => {
        if (!current()) return
        gift_link = null
        remember_gift_intent(storage, null)
        dispatch({ type: 'distribution/gift_link_claimed' })
        if (!signal.aborted && get_state().session.wallet === wallet) dispatch({ type: 'giftcard/received', giftcard })
        dispatch({ type: 'distribution/redeem', giftcards: [giftcard], automatic: true, received_transaction: digest })
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
  events.on('distribution/claim_all', () => {
    const state = get_state()
    if (state.distribution.pending) return
    const external = state.distribution.holder_giftcards ?? []
    if (external.length) dispatch({ type: 'distribution/import' })
    else
      dispatch({
        type: 'distribution/redeem',
        giftcards: state.session.giftcards.slice(0, MAX_GIFTCARDS_PER_TRANSACTION),
      })
  })
  events.on('distribution/import', () => {
    const { distribution, session, external_wallet } = get_state()
    const holder = external_wallet.session
    const recipient = session.wallet
    const giftcards = (distribution.holder_giftcards ?? []).slice(0, MAX_GIFTCARDS_PER_TRANSACTION)
    if (!holder || !recipient || distribution.pending || !giftcards.length) return
    if (recipient.identity !== 'zklogin')
      return fail_holder(new Error(copy_text(get_state().copy?.airdrop_page ?? {})('gift_login')))
    const current = current_operation(true)
    dispatch({ type: 'distribution/pending', operation: 'import' })
    void holder
      .transfer_giftcards(giftcards.map(({ id }) => ({ id, recipient: recipient.address })))
      .then(({ digest, giftcards: transferred }) => {
        if (!current()) return
        dispatch({ type: 'distribution/imported', giftcards: transferred.map(({ id }) => id) })
        for (const card of transferred) dispatch({ type: 'giftcard/received', giftcard: card })
        dispatch({ type: 'distribution/redeem', giftcards: transferred, automatic: true, received_transaction: digest })
      })
      .catch((error) => {
        if (current()) fail_holder(error)
        else console.error('Giftcard transfer failed after the account changed.', error)
      })
  })
  events.on('distribution/redeem', ({ giftcards, automatic, received_transaction }) => {
    const state = get_state()
    const { wallet } = state.session
    if (
      !wallet ||
      state.distribution.pending ||
      !giftcards.length ||
      !giftcards.every((card) => redeemable(state, card))
    )
      return
    const current = current_operation()
    const retained = giftcards.map(({ id }) => attempts.remember(wallet.address, id))
    if (automatic && retained.includes(false)) return
    dispatch({ type: 'distribution/pending', operation: 'redeem' })
    void wallet
      .redeem_giftcards(giftcards, received_transaction)
      .then(() => {
        if (!current()) return
        for (const card of giftcards) dispatch({ type: 'giftcard/redeemed', giftcard: card.id })
        dispatch({ type: 'distribution/redeemed' })
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
      const cards = state.session.giftcards
        .filter(({ id }) => !attempts.has(state.session.wallet!.address, id))
        .slice(0, MAX_GIFTCARDS_PER_TRANSACTION)
      if (cards.length && cards.every((card) => redeemable(state, card)))
        dispatch({ type: 'distribution/redeem', giftcards: cards, automatic: true })
    })
  })
  if (gift_link && get_state().session.wallet?.identity === 'zklogin')
    dispatch({ type: 'distribution/claim_gift_link' })
}

export default Object.freeze({ name: 'distribution', reduce, observe }) satisfies AppModule
