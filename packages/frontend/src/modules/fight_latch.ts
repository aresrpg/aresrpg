// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { AppInput, AppState } from '../store.ts'

import type { FightEnvironment } from './fight.ts'
import { requested_owned_unready_seats } from './fight_identity.ts'

type FightLatch = Readonly<{
  fight: string
  update: (environment: FightEnvironment) => FightEnvironment
}>

const append_ready = (environment: FightEnvironment, seats: readonly number[]): FightEnvironment =>
  Object.freeze({
    ...environment,
    ready_submitted_seats: Object.freeze([...new Set([...environment.ready_submitted_seats, ...seats])]),
  })

const ready_all_latch = (state: Readonly<AppState>, input: AppInput): FightLatch | null => {
  if (input.type !== 'fight/ready_all') return null
  const checkpoint = state.fight.cached[input.fight]
  if (!checkpoint) return null
  const roster = new Set(state.session.characters.map(({ id }) => id))
  const seats = requested_owned_unready_seats(checkpoint, state.session.wallet?.address ?? null, roster, input.fighters)
  return seats.length > 0
    ? Object.freeze({
        fight: input.fight,
        update: (current) =>
          Object.freeze({
            ...current,
            ready_all_progress: Object.freeze({ completed: 0, total: seats.length, status: 'running' }),
          }),
      })
    : null
}

const ready_progress_latch = (input: AppInput): FightLatch | null => {
  if (input.type !== 'fight/ready_all_progress') return null
  return Object.freeze({
    fight: input.fight,
    update: (current) =>
      Object.freeze({
        ...current,
        ready_submitted_seats:
          input.fighter === undefined
            ? current.ready_submitted_seats
            : Object.freeze([...new Set([...current.ready_submitted_seats, Number(input.fighter)])]),
        ready_all_progress: Object.freeze({
          completed: input.completed,
          total: input.total,
          status: input.status,
        }),
      }),
  })
}

const single_latch = (input: AppInput): FightLatch | null => {
  if (input.type !== 'fight/input' || input.origin !== 'local' || !input.fight) return null
  const { fight } = input
  if (input.input.type === 'place') {
    const fighter = Number(input.input.fighter)
    return Object.freeze({
      fight,
      update: (environment) =>
        Object.freeze({
          ...environment,
          placement_changed_seats: Object.freeze({ ...environment.placement_changed_seats, [fighter]: true }),
        }),
    })
  }
  if (input.input.type === 'ready') {
    const fighter = Number(input.input.fighter)
    return Object.freeze({ fight, update: (environment) => append_ready(environment, [fighter]) })
  }
  return input.input.type === 'end_turn'
    ? Object.freeze({ fight, update: (environment) => Object.freeze({ ...environment, end_turn_submitted: true }) })
    : null
}

export const fight_latch = (state: Readonly<AppState>, input: AppInput): FightLatch | null =>
  ready_all_latch(state, input) ?? ready_progress_latch(input) ?? single_latch(input)
