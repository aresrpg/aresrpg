// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { apply_command } from './commands.ts'
import { create_fight_state } from './create.ts'
import { normalize_checkpoint } from './normalize.ts'
import { mix } from './prng.ts'
import { create_render_ids, create_runtime } from './runtime.ts'
import type { FightCommand, FightEvent, FightRuntimeError, HydratedFightCheckpoint, SeedWitness } from './types.ts'

export type FightMode = 'remote' | 'local'
export type TurnWitness = { fighter: bigint; seed: bigint }
export type FightCommandInput = FightCommand & {
  observed_ms?: bigint
  turn_witnesses?: readonly TurnWitness[]
}
export type TurnSeedInput = { type: 'turn_seed'; fighter: bigint; seed: bigint }
export type FightInput = FightCommandInput | TurnSeedInput
export type FightResult = {
  state: HydratedFightCheckpoint
  events: readonly FightEvent[]
  error: FightRuntimeError | null
}
export type Fight = {
  state: () => HydratedFightCheckpoint
  zone_ids: () => readonly string[]
  awaiting_witness: () => boolean
  apply: (input: FightInput) => FightResult
  reset_turn: () => FightResult
  transform: (inputs: Iterable<FightInput>) => Generator<FightEvent, void, void>
  replace: (state: HydratedFightCheckpoint) => readonly FightEvent[]
  simulate_turn: (input: { observed_ms: bigint }) => FightResult
}

const seed_at = (seed: bigint, index: bigint): bigint => (mix(seed, index * 2n) << 32n) | mix(seed, index * 2n + 1n)
const AWAITING_WITNESS = new Set(['missing_turn_seed_witness', 'missing_player_turn_seed', 'missing_mob_turn_witness'])

export const create_fight = ({
  state: initial_state,
  setup,
  mode = 'remote',
  seed = 1n,
}: {
  state?: HydratedFightCheckpoint
  setup?: import('./types.ts').FightSetup
  mode?: FightMode
  seed?: bigint
}): Fight => {
  if (!initial_state && !setup) throw new Error('create_fight requires state or setup')
  if (initial_state && setup) throw new Error('create_fight accepts state or setup, not both')
  let state = initial_state
    ? (normalize_checkpoint(initial_state) as HydratedFightCheckpoint)
    : create_fight_state(setup!)
  let seed_index = 0n
  let render_ids = create_render_ids(state.contract)
  let pending_turn: Readonly<{
    input: FightCommandInput
    witnesses: readonly TurnWitness[]
    emitted: number
  }> | null = null
  let turn_boundary: Readonly<{
    state: HydratedFightCheckpoint
    render_ids: ReturnType<typeof create_render_ids>
    seed_index: bigint
  }> | null = null

  const snapshot = (): HydratedFightCheckpoint => structuredClone(state)
  const capture_turn_boundary = (): void => {
    if (mode !== 'local' || state.contract.round === 0n || state.contract.ended) return
    turn_boundary = Object.freeze({
      state: snapshot(),
      render_ids: structuredClone(render_ids),
      seed_index,
    })
  }
  capture_turn_boundary()

  const run = (input: FightCommandInput, supplied_witnesses: readonly TurnWitness[] = []) => {
    let witnesses = [...(input.turn_witnesses ?? []), ...supplied_witnesses]
    const seed_for = (fighter: bigint): SeedWitness | null => {
      if (mode === 'local') {
        const next = seed_at(seed, seed_index)
        seed_index += 1n
        return { seed: next, witnessed: true }
      }
      const witness_index = witnesses.findIndex((witness) => witness.fighter === fighter)
      if (witness_index < 0) return null
      const witness = witnesses[witness_index]!
      witnesses = witnesses.filter((_, index) => index !== witness_index)
      return { seed: witness.seed, witnessed: true }
    }
    const runtime = create_runtime({
      contract: state.contract,
      sources: state.sources,
      render_ids,
    })
    const result = apply_command(runtime, input, {
      observed_ms: input.observed_ms ?? 0n,
      seed_for,
    })
    return result
  }

  const proven_events = (result: ReturnType<typeof run>): FightEvent[] => {
    if (!result.error || !AWAITING_WITNESS.has(result.error.code)) return result.render_actions
    const seat = (result.error.detail as { seat?: bigint } | null)?.seat
    if (seat === undefined) return result.render_actions
    const unproven = result.render_actions.findIndex(
      (event) => event.type === 'turn_switched' && event.payload.to === seat
    )
    return unproven < 0 ? result.render_actions : result.render_actions.slice(0, unproven)
  }

  const replay_pending_turn = (): FightResult => {
    if (!pending_turn) return { state: snapshot(), events: [], error: { code: 'no_pending_turn', detail: null } }
    const pending = pending_turn
    const result = run(pending.input, pending.witnesses)
    const transcript = proven_events(result)
    const events = transcript.slice(pending.emitted)
    pending_turn = Object.freeze({ ...pending, emitted: transcript.length })
    if (!result.error) {
      state = { contract: structuredClone(result.contract), sources: result.sources }
      render_ids = structuredClone(result.render_ids)
      pending_turn = null
    }
    const waiting = result.error && AWAITING_WITNESS.has(result.error.code)
    return { state: snapshot(), events: structuredClone(events), error: waiting ? null : result.error }
  }

  const apply = (input: FightInput): FightResult => {
    if (input.type === 'turn_seed') {
      if (!pending_turn)
        return { state: snapshot(), events: [], error: { code: 'unexpected_turn_seed', detail: input } }
      pending_turn = Object.freeze({
        ...pending_turn,
        witnesses: [...pending_turn.witnesses, { fighter: input.fighter, seed: input.seed }],
      })
      return replay_pending_turn()
    }
    if (pending_turn) return { state: snapshot(), events: [], error: { code: 'turn_witnesses_pending', detail: null } }
    const result = run(input)
    if (mode === 'remote' && (input.type === 'start' || input.type === 'end_turn' || input.type === 'crank')) {
      if (result.error && !AWAITING_WITNESS.has(result.error.code))
        return { state: snapshot(), events: [], error: result.error }
      pending_turn = Object.freeze({ input, witnesses: Object.freeze([]), emitted: 0 })
      return { state: snapshot(), events: [], error: null }
    }
    if (!result.error) {
      state = { contract: structuredClone(result.contract), sources: result.sources }
      render_ids = structuredClone(result.render_ids)
      if (result.render_actions.some(({ type }) => type === 'fight_started' || type === 'turn_switched'))
        capture_turn_boundary()
    }
    return {
      state: snapshot(),
      events: result.error ? [] : structuredClone(result.render_actions),
      error: result.error,
    }
  }

  return Object.freeze({
    state: snapshot,
    zone_ids: () => Object.freeze([...render_ids.zones]),
    awaiting_witness: () => pending_turn !== null,
    apply,
    reset_turn: () => {
      if (mode !== 'local')
        return { state: snapshot(), events: [], error: { code: 'local_mode_required', detail: null } }
      if (!turn_boundary) return { state: snapshot(), events: [], error: { code: 'no_turn_boundary', detail: null } }
      const { state: boundary_state, render_ids: boundary_render_ids, seed_index: boundary_seed_index } = turn_boundary
      state = structuredClone(boundary_state)
      render_ids = structuredClone(boundary_render_ids)
      seed_index = boundary_seed_index
      pending_turn = null
      return { state: snapshot(), events: [], error: null }
    },
    *transform(inputs: Iterable<FightInput>) {
      for (const input of inputs) yield* apply(input).events
    },
    replace: (replacement: HydratedFightCheckpoint) => {
      const normalized = normalize_checkpoint(replacement) as HydratedFightCheckpoint
      let replayed_pending_turn = false
      let events: readonly FightEvent[] = []
      if (pending_turn && !normalized.contract.ended && normalized.contract.queue.length > 0) {
        const fighter = normalized.contract.queue[Number(normalized.contract.turn_ptr)]
        pending_turn = Object.freeze({
          ...pending_turn,
          witnesses: [...pending_turn.witnesses, { fighter, seed: normalized.contract.turn_seed }],
        })
        const { events: replayed_events } = replay_pending_turn()
        events = replayed_events
        replayed_pending_turn = pending_turn === null
      }
      pending_turn = null
      state = normalized
      if (!replayed_pending_turn) render_ids = create_render_ids(normalized.contract)
      capture_turn_boundary()
      return events
    },
    simulate_turn: ({ observed_ms }: { observed_ms: bigint }) => {
      if (mode !== 'local')
        return {
          state: snapshot(),
          events: [],
          error: { code: 'local_mode_required', detail: null },
        }
      const fighter = state.contract.queue[Number(state.contract.turn_ptr)]
      return apply({ type: 'end_turn', fighter, observed_ms })
    },
  })
}
