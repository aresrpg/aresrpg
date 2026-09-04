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
  | Readonly<{ type: 'mastery/redeem'; item_type: string }>
  | Readonly<{ type: 'mastery/pending'; operation: string | null }>
  | Readonly<{ type: 'mastery/reconciled'; mastery: MasteryRow }>
  | Readonly<{ type: 'mastery/failed'; error: string }>

export const initial_mastery_state = (): MasteryState =>
  Object.freeze({ loaded: false, row: null, offers: Object.freeze([]), pending: null, error: null })

const with_mastery = (state: AppState, mastery: MasteryState): AppState => Object.freeze({ ...state, mastery })

const reduce = (state: AppState, input: AppInput): AppState => {
  if (input.type === 'server/packet' && input.packet.type === 'packet/mastery')
    return with_mastery(
      state,
      Object.freeze({
        loaded: true,
        row: input.packet.mastery,
        offers: Object.freeze(input.packet.offers),
        pending: null,
        error: null,
      })
    )
  if (input.type === 'mastery/pending')
    return with_mastery(state, Object.freeze({ ...state.mastery, pending: input.operation, error: null }))
  if (input.type === 'mastery/reconciled')
    return with_mastery(
      state,
      Object.freeze({ ...state.mastery, loaded: true, row: input.mastery, pending: null, error: null })
    )
  if (input.type === 'mastery/failed')
    return with_mastery(state, Object.freeze({ ...state.mastery, pending: null, error: input.error }))
  if (input.type === 'auth/rejected' || input.type === 'auth/disconnected')
    return with_mastery(state, initial_mastery_state())
  return state
}

const observe: NonNullable<AppModule['observe']> = ({ events, dispatch, get_state }) => {
  const fail = (error: unknown): void => {
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
      .then(({ mastery }) => {
        dispatch({ type: 'mastery/reconciled', mastery })
        const text = state.copy ? copy_text(state.copy.mastery_page) : (key: string) => key
        toast.add(text('quest_started'))
      })
      .catch(fail)
  })
  events.on('mastery/redeem', ({ item_type }) => {
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
        existing: existing?.id ?? null,
        custody: custody_character ? character_custody(custody_character) : undefined,
      })
      .then(({ mastery }) => {
        dispatch({ type: 'mastery/reconciled', mastery })
        const text = state.copy ? copy_text(state.copy.mastery_page) : (key: string) => key
        toast.add(text('offer_purchased'))
      })
      .catch(fail)
  })
}

export default Object.freeze({ name: 'mastery', reduce, observe }) satisfies AppModule
