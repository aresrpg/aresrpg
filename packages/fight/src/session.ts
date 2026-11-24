// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Shared stateful session used by interactive and hosted fight clients.

import { create_fight, type Fight, type FightInput, type FightMode, type FightResult } from './fight.ts'
import { players_ready_after } from './fighters.ts'
import type { FightEvent, FightRuntimeError, FightSetup, HydratedFightCheckpoint } from './types.ts'
import { CONTRACT_CONSTANTS } from './move_contract.gen.ts'

export type ActiveFightSession = Readonly<{
  mode: FightMode
  checkpoint: HydratedFightCheckpoint
  zone_ids: readonly string[]
  events: readonly FightEvent[]
  presentation_batch: number
  error: FightRuntimeError | null
  awaiting_turn_witness: boolean
}>

type BoundaryInput = Extract<FightInput, { type: 'start' | 'end_turn' | 'crank' | 'forfeit' }>

/** Remote replay proves ordering, not wall time. Move still validates every submitted boundary. */
const replay_boundary_ms = (
  input: Readonly<BoundaryInput>,
  { contract }: Readonly<HydratedFightCheckpoint>
): bigint => {
  switch (input.type) {
    case 'start':
      return (
        contract.placement_ms +
        (players_ready_after(contract.fighters, null) ? 0n : CONTRACT_CONSTANTS.placement_force_ms)
      )
    case 'end_turn':
      return contract.turn_started_ms + CONTRACT_CONSTANTS.turn_min_ms
    case 'crank':
      return (
        contract.turn_started_ms +
        (contract.fighters[Number(contract.queue[Number(contract.turn_ptr)])]?.dead
          ? 0n
          : CONTRACT_CONSTANTS.turn_max_ms)
      )
    case 'forfeit':
      return contract.turn_started_ms
  }
}

const stamp_boundary = (
  input: Readonly<FightInput>,
  now: () => bigint,
  checkpoint: Readonly<HydratedFightCheckpoint>,
  mode: FightMode
): FightInput => {
  if (input.type !== 'start' && input.type !== 'end_turn' && input.type !== 'crank' && input.type !== 'forfeit')
    return input
  if (mode === 'local' && input.observed_ms !== undefined) return input
  const minimum = replay_boundary_ms(input, checkpoint)
  const observed = now()
  return Object.freeze({ ...input, observed_ms: observed < minimum ? minimum : observed })
}

/** Owns the one stateful @aresrpg/fight instance mounted by every fight surface. */
export const create_fight_session = ({
  now,
  reconcile,
}: Readonly<{
  now: () => bigint
  reconcile: (state: ActiveFightSession) => void
}>) => {
  /** Null while closed; an open session always holds its fight and the state it last published. */
  let open: Readonly<{ runtime: Fight; current: ActiveFightSession }> | null = null
  let presentation_batch = 0

  const publish = (runtime: Fight, mode: FightMode, { state, events, error }: Readonly<FightResult>): void => {
    if (events.length > 0) presentation_batch += 1
    const current = Object.freeze({
      mode,
      checkpoint: state,
      zone_ids: runtime.zone_ids(),
      events: Object.freeze([...events]),
      presentation_batch,
      error,
      awaiting_turn_witness: runtime.awaiting_witness(),
    })
    open = Object.freeze({ runtime, current })
    reconcile(current)
  }

  const opened = (runtime: Fight, mode: FightMode): void =>
    publish(runtime, mode, { state: runtime.state(), events: [], error: null })

  return Object.freeze({
    open: ({
      setup,
      state,
      mode,
      seed,
    }: Readonly<{ setup?: FightSetup; state?: HydratedFightCheckpoint; mode: FightMode; seed?: bigint }>): void => {
      const runtime = create_fight({ setup, state, mode, seed })
      opened(runtime, mode)
    },
    apply: (input: Readonly<FightInput>): boolean => {
      if (!open) return false
      const { runtime } = open
      const { mode } = open.current
      const result = runtime.apply(stamp_boundary(input, now, runtime.state(), mode))
      publish(runtime, mode, result)
      if (
        mode === 'local' &&
        input.type === 'ready' &&
        result.error === null &&
        players_ready_after(result.state.contract.fighters, null)
      )
        publish(runtime, mode, runtime.apply(stamp_boundary({ type: 'start' }, now, runtime.state(), mode)))
      return true
    },
    simulate_turn: (): boolean => {
      if (open?.current.mode !== 'local') return false
      const { runtime } = open
      const { contract } = runtime.state()
      const minimum = contract.turn_started_ms + CONTRACT_CONSTANTS.turn_min_ms
      const observed_ms = now()
      const boundary = { observed_ms: observed_ms < minimum ? minimum : observed_ms }
      const actor = contract.queue[Number(contract.turn_ptr)]
      publish(
        runtime,
        'local',
        contract.fighters[Number(actor)]?.settled
          ? runtime.apply({ type: 'crank', ...boundary })
          : runtime.simulate_turn(boundary)
      )
      return true
    },
    cancel_pending_turn: (): boolean => {
      if (!open) return false
      publish(open.runtime, open.current.mode, open.runtime.cancel_pending_turn())
      return true
    },
    reset_turn: (): boolean => {
      if (!open) return false
      publish(open.runtime, open.current.mode, open.runtime.reset_turn())
      return true
    },
    replace: (checkpoint: Readonly<HydratedFightCheckpoint>): boolean => {
      if (!open) return false
      const events = open.runtime.replace(checkpoint)
      publish(open.runtime, open.current.mode, { state: open.runtime.state(), events, error: null })
      return true
    },
    restore: (checkpoint: Readonly<HydratedFightCheckpoint>): boolean => {
      if (!open) return false
      const { mode } = open.current
      opened(create_fight({ state: checkpoint, mode }), mode)
      return true
    },
    acknowledge: (batch: number): void => {
      if (open?.current.presentation_batch !== batch) return
      open = Object.freeze({ ...open, current: Object.freeze({ ...open.current, events: Object.freeze([]) }) })
    },
    close: (): void => {
      open = null
      presentation_batch = 0
    },
    state: (): ActiveFightSession | null => open?.current ?? null,
  })
}
