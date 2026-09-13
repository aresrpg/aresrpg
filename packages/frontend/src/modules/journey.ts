// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { DEFAULT_NETWORK, resolve_pins } from '@aresrpg/sdk/pins'

import type { AppContext, AppInput, AppModule, AppState } from '../store.ts'
import { complete_quests, completed_quests_from, initial_journey_state, type JourneyState } from '../journey/model.ts'
import { quest_changes } from '../journey/facts.ts'
import { browser_journey_storage, type JourneyStorage } from '../journey/persistence.ts'

export type JourneyInput =
  | Readonly<{
      type: 'journey/loaded'
      identity: string
      generation: number
      completed: readonly string[]
      failed?: boolean
    }>
  | Readonly<{ type: 'journey/storage_failed'; identity: string; generation: number }>
  | Readonly<{ type: 'journey/persisted'; identity: string; generation: number }>
  | Readonly<{ type: 'journey/completed'; ids: readonly string[] }>
  | Readonly<{ type: 'journey/start' }>
  | Readonly<{ type: 'journey/reset' }>
  | Readonly<{ type: 'journey/acknowledged' }>
  | Readonly<{ type: 'journey/journal'; open: boolean }>
  | Readonly<{ type: 'journey/collapse'; collapsed: boolean }>

const reduce_journey = (state: JourneyState, input: JourneyInput): JourneyState => {
  switch (input.type) {
    case 'journey/loaded':
      return {
        ...state,
        ready: true,
        saving: false,
        completed: completed_quests_from(input.completed),
        storage_failed: input.failed === true,
      }
    case 'journey/storage_failed':
      return { ...state, storage_failed: true, saving: false }
    case 'journey/persisted':
      return { ...state, saving: false }
    case 'journey/reset':
      return { ...initial_journey_state(state.identity, state.generation + 1), ready: true, saving: true }
    case 'journey/start':
      return complete_quests(state, ['welcome'], false)
    case 'journey/completed':
      return complete_quests(state, input.ids)
    case 'journey/acknowledged':
      return { ...state, celebrations: state.celebrations.slice(1), journal_open: true }
    case 'journey/journal':
      return { ...state, journal_open: input.open }
    case 'journey/collapse':
      return { ...state, collapsed: input.collapsed }
  }
}

const accepts_input = (state: JourneyState, input: JourneyInput): boolean => {
  if ('generation' in input) return input.identity === state.identity && input.generation === state.generation
  if (!state.ready) return false
  return input.type !== 'journey/completed' || state.completed.includes('welcome')
}

const identity_for = (state: AppState): string | null => {
  const address = state.session.wallet?.address
  return address
    ? `${DEFAULT_NETWORK}:${resolve_pins(DEFAULT_NETWORK).package_original ?? resolve_pins(DEFAULT_NETWORK).package}:${address}`
    : null
}

const reduce = (state: AppState, input: AppInput): AppState => {
  const identity = identity_for(state)
  if (identity !== state.journey.identity)
    return { ...state, journey: initial_journey_state(identity, state.journey.generation + 1) }
  if (!input.type.startsWith('journey/')) return state
  const action = input as JourneyInput
  if (!accepts_input(state.journey, action)) return state
  const journey = reduce_journey(state.journey, action)
  return journey === state.journey ? state : { ...state, journey }
}

export const observe_journey = (context: AppContext, storage: JourneyStorage): void => {
  const { events, dispatch, get_state, signal } = context
  let io: Promise<void> = Promise.resolve()
  const failure = (identity: string, generation: number, error: unknown): void => {
    console.error('Journey completion storage failed.', error)
    if (!signal.aborted) dispatch({ type: 'journey/storage_failed', identity, generation })
  }
  const load = (state: JourneyState): void => {
    const { identity, generation } = state
    if (!identity) return
    io = io.then(async () => {
      try {
        const completed = await storage.load(identity)
        if (!signal.aborted) dispatch({ type: 'journey/loaded', identity, generation, completed })
      } catch (error) {
        console.error('Journey completion could not be loaded.', error)
        failure(identity, generation, error)
        if (!signal.aborted) dispatch({ type: 'journey/loaded', identity, generation, completed: [], failed: true })
      }
    })
  }
  events.on('STATE_UPDATED', (state, previous) => {
    const { journey } = state
    const { identity } = journey
    if (journey.identity !== previous.journey.identity) load(journey)
    if (identity && journey.saving && journey.completed !== previous.journey.completed) {
      const { generation } = journey
      io = io
        .then(async () => {
          await storage.save(identity, journey.completed)
          if (!signal.aborted && get_state().journey.completed === journey.completed)
            dispatch({ type: 'journey/persisted', identity, generation })
        })
        .catch((error: unknown) => failure(identity, generation, error))
    }
    const ids = quest_changes(state, previous)
    if (ids.length) dispatch({ type: 'journey/completed', ids })
  })
  load(get_state().journey)
}

export default Object.freeze({
  name: 'journey',
  reduce,
  observe: (context: AppContext) => observe_journey(context, browser_journey_storage()),
}) satisfies AppModule
