// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The ONE stateful @aresrpg/fight session (split from modules/fight.ts under the 600-line
// law): local and remote fights mount through this factory; the store module keeps the
// reducer and observers, and re-exports this surface unchanged.

import {
  create_fight,
  type Fight,
  type FightEvent,
  type FightInput,
  type FightMode,
  type FightRuntimeError,
  type FightSetup,
  type HydratedFightCheckpoint,
} from '@aresrpg/fight'

export type ActiveFightSession = Readonly<{
  mode: FightMode
  checkpoint: HydratedFightCheckpoint
  zone_ids: readonly string[]
  events: readonly FightEvent[]
  presentation_batch: number
  error: FightRuntimeError | null
  awaiting_turn_witness: boolean
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
      zone_ids: Object.freeze([...(runtime?.zone_ids() ?? [])]),
      events: Object.freeze([...events]),
      presentation_batch,
      error,
      awaiting_turn_witness: runtime?.awaiting_witness() ?? false,
    })
    reconcile(current)
  }

  const publish = (result: Readonly<ReturnType<Fight['apply']>>): void =>
    reconcile_runtime(result.state, result.events, result.error)

  return Object.freeze({
    open: ({
      setup,
      state,
      mode: next_mode,
      seed,
    }: Readonly<{ setup?: FightSetup; state?: HydratedFightCheckpoint; mode: FightMode; seed?: bigint }>): void => {
      mode = next_mode
      runtime = create_fight({ setup, state, mode, seed })
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
        zone_ids: runtime.zone_ids(),
        events: Object.freeze([...events]),
        presentation_batch: events.length > 0 ? ++presentation_batch : presentation_batch,
        error: null,
        awaiting_turn_witness: runtime.awaiting_witness(),
      })
      reconcile(current)
      return true
    },
    restore: (checkpoint: Readonly<HydratedFightCheckpoint>): boolean => {
      if (!runtime || !mode) return false
      runtime = create_fight({ state: checkpoint, mode })
      reconcile_runtime(runtime.state(), Object.freeze([]), null)
      return true
    },
    acknowledge: (batch: number): void => {
      if (!current || current.presentation_batch !== batch) return
      current = Object.freeze({ ...current, events: Object.freeze([]) })
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
