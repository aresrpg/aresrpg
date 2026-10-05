// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { MasteryOfferRow, MasteryRow } from '@aresrpg/protocol'

import { content_catalog } from '../content/catalog.ts'
import { mastery_world_witness } from '../mastery/model.ts'
import { copy_text } from '../i18n/copy.ts'
import { encumbered_asset_ids, stack_merge_target_row } from '../inventory_stacks.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'
import { toast } from '../toast.ts'

import { character_custody } from './session.ts'

export type MasteryState = Readonly<{
  loaded: boolean
  row: MasteryRow | null
  offers: readonly MasteryOfferRow[]
  pending: string | null
  error: string | null
}>

export type MasteryInput =
  | Readonly<{ type: 'mastery/start'; world: string }>
  | Readonly<{ type: 'mastery/redeem'; item_type: string; payment?: 'mastery' | 'kares'; count?: number }>
  | Readonly<{ type: 'mastery/pending'; operation: string | null }>
  | Readonly<{ type: 'mastery/reconciled'; mastery: MasteryRow | null }>
  | Readonly<{ type: 'mastery/failed'; error: string }>

export const initial_mastery_state = (): MasteryState =>
  Object.freeze({ loaded: false, row: null, offers: Object.freeze([]), pending: null, error: null })

const with_mastery = (state: AppState, mastery: MasteryState): AppState => Object.freeze({ ...state, mastery })

const reconciled_mastery = (state: MasteryState, row: MasteryRow | null): MasteryState =>
  Object.freeze({ ...state, loaded: true, row: row ?? state.row, pending: null, error: null })

const reduce = (state: AppState, input: AppInput): AppState => {
  if (input.type === 'server/packet' && input.packet.type === 'packet/mastery')
    return with_mastery(
      state,
      Object.freeze({
        loaded: true,
        row: input.packet.mastery,
        offers: Object.freeze(input.packet.offers),
        pending: state.mastery.pending,
        error: null,
      })
    )
  if (input.type === 'mastery/pending')
    return with_mastery(state, Object.freeze({ ...state.mastery, pending: input.operation, error: null }))
  if (input.type === 'mastery/reconciled') return with_mastery(state, reconciled_mastery(state.mastery, input.mastery))
  if (input.type === 'mastery/failed')
    return with_mastery(state, Object.freeze({ ...state.mastery, pending: null, error: input.error }))
  if (input.type === 'auth/rejected' || input.type === 'auth/disconnected')
    return with_mastery(state, initial_mastery_state())
  return state
}

const observe: NonNullable<AppModule['observe']> = ({ events, dispatch, get_state, signal }) => {
  type Wallet = NonNullable<AppState['session']['wallet']>
  const current = (wallet: Wallet): boolean => !signal.aborted && get_state().session.wallet === wallet
  const finish = (wallet: Wallet, mastery: MasteryRow | null, message: 'quest_started' | 'offer_purchased'): void => {
    if (!current(wallet)) return
    dispatch({ type: 'mastery/reconciled', mastery })
    const { copy } = get_state()
    toast.add(copy ? copy_text(copy.mastery_page)(message) : message, 'success')
  }
  const fail = (wallet: Wallet, error: unknown): void => {
    console.error('Mastery operation failed.', error)
    if (!current(wallet)) return
    const message = error instanceof Error ? error.message : String(error)
    dispatch({ type: 'mastery/failed', error: message })
    toast.add(error)
  }
  events.on('mastery/start', ({ world: world_name }) => {
    const state = get_state()
    const { wallet, characters } = state.session
    const world = content_catalog.world(world_name)
    const witness = world ? mastery_world_witness(characters, world) : null
    if (!wallet || !world || !witness || state.mastery.pending) return
    dispatch({ type: 'mastery/pending', operation: 'start' })
    void wallet.mastery
      .start({ world: world.world, character_id: witness.id, custody: character_custody(witness) })
      .then(({ mastery }) => finish(wallet, mastery, 'quest_started'))
      .catch((error: unknown) => fail(wallet, error))
  })
  events.on('mastery/redeem', ({ item_type, payment, count }) => {
    const state = get_state()
    const { wallet, inventory, characters } = state.session
    if (!wallet || state.mastery.pending) return
    const offer = state.mastery.offers.find((row) => row.item_type === item_type && row.enabled)
    if (!offer) return
    const encumbered = encumbered_asset_ids(state.marketplace.own_listings, state.trade.rows)
    const existing = stack_merge_target_row(inventory, encumbered, item_type)
    const custody_character =
      characters.find(({ kiosk, custody }) => custody !== 'fight' && kiosk === existing?.kiosk) ??
      characters.find(({ custody }) => custody !== 'fight')
    dispatch({ type: 'mastery/pending', operation: `redeem:${item_type}` })
    void wallet.mastery
      .redeem({
        item_type,
        payment,
        expected_cost: BigInt(offer.cost),
        count,
        existing: existing?.id ?? null,
        custody: custody_character ? character_custody(custody_character) : undefined,
      })
      .then(({ mastery }) => finish(wallet, mastery, 'offer_purchased'))
      .catch((error: unknown) => fail(wallet, error))
  })
}

export default Object.freeze({ name: 'mastery', reduce, observe }) satisfies AppModule
