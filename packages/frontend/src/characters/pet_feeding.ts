// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { pet_max_feeds } from '@aresrpg/immutable'
import type { ItemRow } from '@aresrpg/protocol'

export type FeedingFood = Readonly<Pick<ItemRow, 'id' | 'item_type' | 'name'>>
export type FeedingState = Readonly<{
  phase: 'selecting' | 'pending' | 'throwing' | 'celebrating' | 'done'
  selected_id: string | null
  food: FeedingFood | null
  error: string | null
}>
export type FeedingInput =
  | Readonly<{ type: 'select'; food_id: string }>
  | Readonly<{ type: 'confirm'; food: FeedingFood }>
  | Readonly<{ type: 'failed'; error: string }>
  | Readonly<{ type: 'succeeded' | 'landed' | 'finished' }>

export const initial_feeding: FeedingState = { phase: 'selecting', selected_id: null, food: null, error: null }

const transitions = {
  succeeded: { from: 'pending', to: 'throwing' },
  landed: { from: 'throwing', to: 'celebrating' },
  finished: { from: 'celebrating', to: 'done' },
} as const

export const reduce_feeding = (state: FeedingState, input: FeedingInput): FeedingState => {
  if (input.type === 'select')
    return state.phase === 'selecting' ? { ...state, selected_id: input.food_id, food: null, error: null } : state
  if (input.type === 'confirm')
    return state.phase === 'selecting' && state.selected_id === input.food.id
      ? { ...state, phase: 'pending', food: input.food, error: null }
      : state
  if (input.type === 'failed')
    return state.phase === 'pending' ? { ...state, phase: 'selecting', food: null, error: input.error } : state
  const transition = transitions[input.type]
  return state.phase === transition.from ? { ...state, phase: transition.to } : state
}

export const feeding_gate = (pet: Readonly<ItemRow> | undefined, encumbered: boolean, day: number) => {
  if (!pet || encumbered) return 'feed_unavailable'
  if ((pet.pet_power ?? 0) >= pet_max_feeds) return 'feed_full'
  if ((pet.pet_last_day ?? 0) >= day) return 'feed_already_today'
  return null
}

export const FEEDING_ANIMATION = {
  throwing: { duration: 650, input: 'landed', sound: 'element_cast_air_1' },
  celebrating: { duration: 1800, input: 'finished', sound: 'element_cast_heal_1' },
} as const
