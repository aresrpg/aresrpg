// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One fight session boundary for every surface. Local is only a create_fight birth mode.

import {
  create_fight,
  decode_fight_action,
  type Fight,
  type FightEvent,
  type FightInput,
  type FightMode,
  type FightRuntimeError,
  type FightSetup,
  type HydratedFightCheckpoint,
} from '@aresrpg/fight'

import type { AppInput, AppModule, AppState } from '../store.ts'
import { select_fight_view } from '../game/fight/fight_projection.ts'

export type FightSessionState = Readonly<{
  mode: FightMode | null
  checkpoint: HydratedFightCheckpoint | null
  events: readonly FightEvent[]
  presentation_batch: number
  error: FightRuntimeError | null
}>

export type FightSessionInput =
  | Readonly<{ type: 'fight/opened'; mode: FightMode; setup: FightSetup; seed: bigint }>
  | Readonly<{ type: 'fight/input'; input: FightInput; origin: 'local' | 'streamed' }>
  | Readonly<{ type: 'fight/reset_turn' }>
  | Readonly<{ type: 'fight/replaced'; checkpoint: HydratedFightCheckpoint }>
  | Readonly<{
      type: 'fight/reconciled'
      mode: FightMode
      checkpoint: HydratedFightCheckpoint
      events: readonly FightEvent[]
      presentation_batch: number
      error: FightRuntimeError | null
    }>
  | Readonly<{ type: 'fight/presented'; presentation_batch: number }>
  | Readonly<{ type: 'fight/closed' }>

export const initial_fight_session_state = (): FightSessionState =>
  Object.freeze({ mode: null, checkpoint: null, events: Object.freeze([]), presentation_batch: 0, error: null })

type ActiveFightSession = Readonly<{
  mode: FightMode
  checkpoint: HydratedFightCheckpoint
  events: readonly FightEvent[]
  presentation_batch: number
  error: FightRuntimeError | null
}>

const stamp_boundary = (input: Readonly<FightInput>, now: () => bigint): FightInput => {
  if (input.type !== 'start' && input.type !== 'end_turn' && input.type !== 'crank') return input
  return input.observed_ms === undefined ? Object.freeze({ ...input, observed_ms: now() }) : input
}

/** Owns the one stateful @aresrpg/fight instance mounted by every fight surface. */
export const create_fight_session = ({
  now,
  reconcile,
}: Readonly<{
  now: () => bigint
  reconcile: (state: ActiveFightSession) => void
}>) => {
  let runtime: Fight | null = null
  let mode: FightMode | null = null
  let current: ActiveFightSession | null = null
  let presentation_batch = 0

  const reconcile_runtime = (
    checkpoint: Readonly<HydratedFightCheckpoint>,
    events: readonly Readonly<FightEvent>[],
    error: Readonly<FightRuntimeError> | null
  ): void => {
    if (!mode) return
    if (events.length > 0) presentation_batch += 1
    current = Object.freeze({
      mode,
      checkpoint,
      events: Object.freeze([...events]),
      presentation_batch,
      error,
    })
    reconcile(current)
  }

  const publish = (result: Readonly<ReturnType<Fight['apply']>>): void =>
    reconcile_runtime(result.state, result.events, result.error)

  return Object.freeze({
    open: ({ setup, mode: next_mode, seed }: Readonly<{ setup: FightSetup; mode: FightMode; seed: bigint }>): void => {
      mode = next_mode
      runtime = create_fight({ setup, mode, seed })
      reconcile_runtime(runtime.state(), Object.freeze([]), null)
    },
    apply: (input: Readonly<FightInput>): boolean => {
      if (!runtime) return false
      publish(runtime.apply(stamp_boundary(input, now)))
      return true
    },
    reset_turn: (): boolean => {
      if (!runtime) return false
      publish(runtime.reset_turn())
      return true
    },
    replace: (checkpoint: Readonly<HydratedFightCheckpoint>): boolean => {
      if (!runtime || !mode) return false
      const events = runtime.replace(checkpoint)
      current = Object.freeze({
        mode,
        checkpoint: runtime.state(),
        events: Object.freeze([...events]),
        presentation_batch: events.length > 0 ? ++presentation_batch : presentation_batch,
        error: null,
      })
      reconcile(current)
      return true
    },
    close: (): void => {
      runtime = null
      mode = null
      current = null
      presentation_batch = 0
    },
    state: (): ActiveFightSession | null => current,
  })
}

const reduce = (state: AppState, input: AppInput): AppState => {
  if (input.type === 'fight/reconciled')
    return Object.freeze({
      ...state,
      fight: Object.freeze({
        mode: input.mode,
        checkpoint: input.checkpoint,
        events: Object.freeze([...input.events]),
        presentation_batch: input.presentation_batch,
        error: input.error,
      }),
    })
  if (input.type === 'fight/presented' && input.presentation_batch === state.fight.presentation_batch)
    return Object.freeze({
      ...state,
      fight: Object.freeze({ ...state.fight, events: Object.freeze([]) }),
    })
  if (input.type === 'fight/closed') return Object.freeze({ ...state, fight: initial_fight_session_state() })
  return state
}

const observe = ({ dispatch, events }: Parameters<NonNullable<AppModule['observe']>>[0]): void => {
  const session = create_fight_session({
    // Move stores wall-clock milliseconds. A monotonic page-relative clock would make every
    // remotely hydrated deadline look permanently in the future.
    now: () => BigInt(Date.now()),
    reconcile: ({ mode, checkpoint, events: fight_events, presentation_batch, error }) =>
      dispatch({
        type: 'fight/reconciled',
        mode,
        checkpoint,
        events: fight_events,
        presentation_batch,
        error,
      }),
  })
  events.on('fight/opened', ({ mode, seed, setup }) => {
    session.open({ mode, seed, setup })
  })
  events.on('fight/input', ({ input }) => session.apply(input))
  events.on('fight/reset_turn', session.reset_turn)
  events.on('server/packet', ({ packet }) => {
    if (packet.type !== 'packet/fight_action' || session.state()?.checkpoint.contract.id !== packet.fight) return
    dispatch({ type: 'fight/input', input: decode_fight_action(packet.action), origin: 'streamed' })
  })
  events.on('STATE_UPDATED', (state, previous) => {
    if (
      state.fight === previous.fight ||
      state.fight.mode !== 'remote' ||
      !state.fight.checkpoint ||
      !state.session.wallet
    )
      return
    const selected = select_fight_view({
      checkpoint: state.fight.checkpoint,
      mode: state.fight.mode,
      owner: state.session.wallet.address,
      names: Object.fromEntries(state.session.characters.map(({ id, name }) => [id, name])),
    }).selected?.character_id
    if (
      selected &&
      selected !== state.session.selected_character_id &&
      state.session.characters.some(({ id }) => id === selected)
    )
      dispatch({ type: 'character/select', character_id: selected })
  })
  events.on('fight/replaced', ({ checkpoint }) => session.replace(checkpoint))
  events.on('fight/closed', session.close)
}

export default Object.freeze({ name: 'fight', reduce, observe }) satisfies AppModule
