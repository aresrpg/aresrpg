// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

// Two-wallet distribution: an external holder pays to send a voucher to the authenticated game
// wallet; the game wallet pays to redeem it. A failed second leg stays recoverable as a held card.
// A printed card's link is claimed on the gift page alone (`airdrop/gift_runtime.ts`), never here.

import type { GiftcardRow } from '@aresrpg/protocol'
import { MAX_GIFTCARDS_PER_TRANSACTION } from '@aresrpg/sdk/giftcard-batch'

import { sui_session } from '../wallet/external_session.ts'
import type { AuthSession } from '../auth.ts'
import { items_by_type } from '../content/items.ts'
import type { AppInput, SiteModule, SiteState } from '../store.ts'
import { copy_text } from '../i18n/copy.ts'
import { env } from '../env.ts'
import { browser_auth_storage } from '../auth_storage.ts'
import { toast } from '../toast.ts'
import { rolled_item_types } from '../content/item_templates.ts'

import { create_giftcard_attempts } from './giftcard_attempts.ts'

export type DistributionState = Readonly<{
  holder_giftcards: readonly GiftcardRow[] | null
  pending: string | null
  error: string | null
  /** Vouchers that reached the game wallet while it was signed in; the reward notice shows them. */
  notice: Readonly<{ giftcards: readonly GiftcardRow[] }> | null
  /** The airdrop view is on screen: the one fact the holder read and the automatic redemption follow. The
   * view sets it; it is a fact of the page, not of the account, so a sign-out keeps it. */
  open: boolean
}>

export type DistributionInput =
  | Readonly<{ type: 'distribution/viewed'; open: boolean }>
  | Readonly<{ type: 'distribution/refresh_holder' }>
  | Readonly<{ type: 'distribution/holder_loaded'; holder: AuthSession; giftcards: readonly GiftcardRow[] }>
  | Readonly<{ type: 'distribution/claim_all' }>
  | Readonly<{ type: 'distribution/import' }>
  | Readonly<{ type: 'distribution/imported'; giftcards: readonly string[] }>
  | Readonly<{ type: 'distribution/gifts_received'; giftcards: readonly GiftcardRow[] }>
  | Readonly<{ type: 'distribution/notice_dismissed' }>
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
    pending: null,
    error: null,
    notice: null,
    open: false,
  })

const with_distribution = <S extends SiteState>(state: S, distribution: DistributionState): S =>
  Object.freeze({ ...state, distribution })

const reduce_notice_input = (current: DistributionState, input: AppInput): DistributionState | null => {
  if (input.type === 'distribution/notice_dismissed') return Object.freeze({ ...current, notice: null })
  if (input.type === 'distribution/gifts_received') {
    const previous = current.notice?.giftcards ?? []
    const giftcards = [...new Map([...previous, ...input.giftcards].map((card) => [card.id, card])).values()]
    return Object.freeze({ ...current, notice: Object.freeze({ giftcards }) })
  }
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
  if (input.type === 'distribution/viewed') return Object.freeze({ ...current, open: input.open })
  return null
}

const holder_operation = (operation: string | null): boolean => operation === 'load' || operation === 'import'

const reduce = <S extends SiteState>(state: S, input: AppInput): S => {
  if (input.type === 'distribution/holder_loaded')
    return input.holder === state.external_wallet.session
      ? with_distribution(state, { ...state.distribution, holder_giftcards: input.giftcards, pending: null })
      : state
  const holder_pending = holder_operation(state.distribution.pending)
  if (
    input.type.startsWith('external_wallet/') &&
    !sui_session(state.external_wallet.session) &&
    (state.distribution.holder_giftcards !== null || holder_pending)
  )
    return with_distribution(state, {
      ...state.distribution,
      holder_giftcards: null,
      pending: holder_pending ? null : state.distribution.pending,
      error: null,
    })
  const next = reduce_notice_input(state.distribution, input) ?? reduce_distribution_input(state.distribution, input)
  if (next) return with_distribution(state, next)
  if (input.type === 'auth/disconnected' || input.type === 'auth/rejected')
    return with_distribution(state, Object.freeze({ ...initial_distribution_state(), open: state.distribution.open }))
  return state
}

const redeemable = (state: SiteState, card: GiftcardRow): boolean => {
  const item_type = rolled_item_types().get(card.template)
  return Boolean(state.session.wallet && state.session.roster_loaded && item_type && items_by_type[item_type])
}

const observe: NonNullable<SiteModule['observe']> = ({ events, dispatch, get_state, signal }) => {
  let game_lifetime = 0
  let holder_lifetime = 0
  const current_operation = (holder = false): (() => boolean) => {
    const game = game_lifetime
    const external = holder_lifetime
    return () => !signal.aborted && game === game_lifetime && (!holder || external === holder_lifetime)
  }
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
  const refresh_holder = (): void => {
    const { pending } = get_state().distribution
    const holder = sui_session(get_state().external_wallet.session)
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
    const holder = sui_session(external_wallet.session)
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
    if (!state.session.wallet || state.session.wallet !== previous.session.wallet) return
    if (state.session.giftcards === previous.session.giftcards) return
    const prior = new Set(previous.session.giftcards.map(({ id }) => id))
    const giftcards = state.session.giftcards.filter(({ id }) => !prior.has(id))
    if (giftcards.length) dispatch({ type: 'distribution/gifts_received', giftcards })
  })
  events.on('STATE_UPDATED', (state, previous) => {
    if (!state.distribution.open || state.distribution.error) return
    if (state.distribution.holder_giftcards !== null && previous.distribution.open) return
    refresh_holder()
  })
  events.on('STATE_UPDATED', (state, previous) => {
    if (state.session === previous.session && state.distribution === previous.distribution) return
    queueMicrotask(() => {
      if (signal.aborted) return
      const state = get_state()
      if (
        !state.distribution.open ||
        state.session.wallet?.identity !== 'zklogin' ||
        !state.session.roster_loaded ||
        state.distribution.pending ||
        state.distribution.error
      )
        return
      const cards = state.session.giftcards
        .filter(({ id }) => !attempts.has(state.session.wallet!.address, id))
        .slice(0, MAX_GIFTCARDS_PER_TRANSACTION)
      if (cards.length && cards.every((card) => redeemable(state, card)))
        dispatch({ type: 'distribution/redeem', giftcards: cards, automatic: true })
    })
  })
}

export default Object.freeze({
  name: 'distribution',
  initial: () => ({ distribution: initial_distribution_state() }),
  reduce,
  observe,
}) satisfies SiteModule
