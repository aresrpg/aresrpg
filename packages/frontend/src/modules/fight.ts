// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable complexity -- the reducer exhaustively folds the sealed fight input union. */

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
import { catalog_spell_sources } from '../content/fight_sources.ts'
import { project_fight_chat_lines } from '../game/fight/fight_chat_lines.ts'

import { fight_should_close, terminal_remote_draft_needs_commit } from './fight_lifecycle.ts'

export { fight_should_close, terminal_remote_draft_needs_commit } from './fight_lifecycle.ts'

export type FightPresentationBatch = Readonly<{
  batch: number
  checkpoint: HydratedFightCheckpoint
  zone_ids: readonly string[]
  events: readonly FightEvent[]
}>

export type FightSessionState = Readonly<{
  cached: Readonly<Record<string, HydratedFightCheckpoint>>
  mode: FightMode | null
  checkpoint: HydratedFightCheckpoint | null
  zone_ids: readonly string[]
  /** ordered remote/local cue batches; React consumes the head before the next can replace it */
  presentations: readonly FightPresentationBatch[]
  error: FightRuntimeError | null
  /** Only a streamed checkpoint may end a remote fight; local turn drafts are not chain truth. */
  canonical_ended: boolean
  /** the board is on screen. DERIVED from our own seat on every reconcile; `fight/mounted`
   *  sets it directly for a SPECTATOR alone, who never holds a seat to derive from. */
  mounted: boolean
  /** a spectator's commit — the one mount that no seat can witness */
  spectating: boolean
  /** the start's wall-clock witness (null when armed after the fight had already begun) */
  started_at_ms: number | null
  /** one remote transaction at a time; a second command cannot build from unconfirmed state */
  transaction_pending: boolean
  /** End Turn was clicked while an action/presentation/floor was still draining */
  end_turn_queued: boolean
  /** the boundary was submitted; held until canonical turn truth advances or refuses it */
  end_turn_submitted: boolean
  /** increments only on an authoritative rollback; the engine snaps every fighter to it */
  restore_serial: number
}>

export type FightSessionInput =
  | Readonly<{
      type: 'fight/opened'
      mode: FightMode
      setup?: FightSetup
      state?: HydratedFightCheckpoint
      seed?: bigint
    }>
  | Readonly<{ type: 'fight/input'; input: FightInput; origin: 'local' | 'streamed' }>
  | Readonly<{ type: 'fight/reset_turn' }>
  | Readonly<{ type: 'fight/replaced'; checkpoint: HydratedFightCheckpoint }>
  | Readonly<{ type: 'fight/cached'; checkpoint: HydratedFightCheckpoint }>
  | Readonly<{ type: 'fight/uncached'; fight: string }>
  /** authoritative rollback after a refused remote transaction; pending witnesses are discarded */
  | Readonly<{ type: 'fight/restored'; checkpoint: HydratedFightCheckpoint }>
  | Readonly<{
      type: 'fight/reconciled'
      mode: FightMode
      checkpoint: HydratedFightCheckpoint
      zone_ids: readonly string[]
      events: readonly FightEvent[]
      presentation_batch: number
      error: FightRuntimeError | null
    }>
  | Readonly<{ type: 'fight/presented'; presentation_batch: number }>
  | Readonly<{ type: 'fight/mounted'; mounted: boolean }>
  | Readonly<{ type: 'fight/started_at'; fight: string; at_ms: number }>
  | Readonly<{ type: 'fight/transaction_pending'; fight: string; pending: boolean }>
  | Readonly<{ type: 'fight/end_turn_queued'; fight: string; queued: boolean }>
  | Readonly<{ type: 'fight/canonical_ended'; fight: string; ended: boolean }>
  /** arm/disarm the server-side watch for a fight — folded by NO state; session.ts sends it */
  | Readonly<{ type: 'fight/watch'; fight: string | null }>
  | Readonly<{ type: 'fight/released'; character_id: string }>
  | Readonly<{ type: 'fight/closed' }>

export const initial_fight_session_state = (): FightSessionState =>
  Object.freeze({
    cached: Object.freeze({}),
    mode: null,
    checkpoint: null,
    zone_ids: Object.freeze([]),
    presentations: Object.freeze([]),
    error: null,
    canonical_ended: false,
    mounted: false,
    spectating: false,
    started_at_ms: null,
    transaction_pending: false,
    end_turn_queued: false,
    end_turn_submitted: false,
    restore_serial: 0,
  })

type ActiveFightSession = Readonly<{
  mode: FightMode
  checkpoint: HydratedFightCheckpoint
  zone_ids: readonly string[]
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
      zone_ids: Object.freeze([...(runtime?.zone_ids() ?? [])]),
      events: Object.freeze([...events]),
      presentation_batch,
      error,
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
    close: (): void => {
      runtime = null
      mode = null
      current = null
      presentation_batch = 0
    },
    state: (): ActiveFightSession | null => current,
  })
}

/** A SEAT IS THE MOUNT (2026-08-22): a chain transaction — a duel challenge, a duel accept, a
 *  mob engage — seats a character without any modal ever opening, and the board must appear on
 *  its own. Mounting off the modal alone left every duel challenger standing in the overworld
 *  while his character sat on a board he could not see. A spectator holds no seat and still
 *  mounts explicitly. */
const holds_selected_seat = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  character_id: string | null,
  owner: string | null
): boolean =>
  !!character_id &&
  !!owner &&
  checkpoint.contract.fighters.some(
    (fighter) =>
      fighter.kind.type === 'player' &&
      fighter.kind.character === character_id &&
      fighter.kind.owner === owner &&
      !fighter.settled
  )

const reconcile_fight = (
  state: Readonly<AppState>,
  input: Extract<AppInput, { type: 'fight/reconciled' }>
): AppState => {
  const same_fight = state.fight.checkpoint?.contract.id === input.checkpoint.contract.id
  const pending = same_fight ? state.fight.presentations : Object.freeze([])
  const presentations =
    input.events.length === 0
      ? pending
      : Object.freeze([
          ...pending,
          Object.freeze({
            batch: input.presentation_batch,
            checkpoint: input.checkpoint,
            zone_ids: Object.freeze([...input.zone_ids]),
            events: Object.freeze([...input.events]),
          }),
        ])
  return Object.freeze({
    ...state,
    fight: Object.freeze({
      mode: input.mode,
      cached: Object.freeze({ ...state.fight.cached, [input.checkpoint.contract.id]: input.checkpoint }),
      checkpoint: input.checkpoint,
      zone_ids: Object.freeze([...input.zone_ids]),
      presentations,
      error: input.error,
      canonical_ended: same_fight ? state.fight.canonical_ended : false,
      // The selected character owns the board. Wallet ownership is too broad: one account may
      // have several characters standing in different worlds or fights.
      mounted:
        state.fight.spectating ||
        (input.mode === 'remote' &&
          holds_selected_seat(
            input.checkpoint,
            state.session.selected_character_id,
            state.session.wallet?.address ?? null
          )),
      spectating: state.fight.spectating,
      started_at_ms: state.fight.started_at_ms,
      transaction_pending: state.fight.transaction_pending,
      end_turn_queued:
        same_fight && state.fight.checkpoint?.contract.turn_started_ms === input.checkpoint.contract.turn_started_ms
          ? state.fight.end_turn_queued
          : false,
      end_turn_submitted:
        same_fight && state.fight.checkpoint?.contract.turn_started_ms === input.checkpoint.contract.turn_started_ms
          ? state.fight.end_turn_submitted
          : false,
      restore_serial: state.fight.restore_serial,
    }),
  })
}

const cache_fight = (state: Readonly<AppState>, checkpoint: Readonly<HydratedFightCheckpoint>): AppState =>
  Object.freeze({
    ...state,
    fight: Object.freeze({
      ...state.fight,
      cached: Object.freeze({ ...state.fight.cached, [checkpoint.contract.id]: checkpoint }),
    }),
  })

const uncache_fight = (state: Readonly<AppState>, fight: string): AppState => {
  const cached = Object.freeze(Object.fromEntries(Object.entries(state.fight.cached).filter(([id]) => id !== fight)))
  return state.fight.checkpoint?.contract.id === fight
    ? Object.freeze({ ...state, fight: Object.freeze({ ...initial_fight_session_state(), cached }) })
    : Object.freeze({ ...state, fight: Object.freeze({ ...state.fight, cached }) })
}

const select_character_fight = (state: Readonly<AppState>, character_id: string): AppState => {
  const owner = state.session.wallet?.address ?? null
  const checkpoint = Object.values(state.fight.cached).find((candidate) =>
    holds_selected_seat(candidate, character_id, owner)
  )
  if (checkpoint && state.fight.checkpoint?.contract.id !== checkpoint.contract.id)
    return Object.freeze({
      ...state,
      fight: Object.freeze({
        ...initial_fight_session_state(),
        cached: state.fight.cached,
        mode: 'remote',
        checkpoint,
        mounted: true,
      }),
    })
  const mounted = !!checkpoint
  return Object.freeze({
    ...state,
    fight: Object.freeze({ ...state.fight, mounted, spectating: false }),
  })
}

const close_fight = (state: Readonly<AppState>): AppState => {
  const closing = state.fight.checkpoint?.contract.id
  const cached = closing
    ? Object.freeze(Object.fromEntries(Object.entries(state.fight.cached).filter(([fight]) => fight !== closing)))
    : state.fight.cached
  return Object.freeze({ ...state, fight: Object.freeze({ ...initial_fight_session_state(), cached }) })
}

const release_character_fight = (state: Readonly<AppState>, character_id: string): AppState => {
  const { checkpoint } = state.fight
  if (!checkpoint) return state
  const roster = new Set(state.session.characters.map(({ id }) => id))
  const another_seated = checkpoint.contract.fighters.some(
    (fighter) =>
      fighter.kind.type === 'player' &&
      fighter.kind.character !== character_id &&
      roster.has(fighter.kind.character) &&
      !fighter.settled
  )
  if (!another_seated) return close_fight(state)
  return Object.freeze({
    ...state,
    fight: Object.freeze({
      ...state.fight,
      mounted: false,
      spectating: false,
      presentations: Object.freeze([]),
      transaction_pending: false,
      end_turn_queued: false,
      end_turn_submitted: false,
    }),
  })
}

const reduce = (state: AppState, input: AppInput): AppState => {
  if (input.type === 'fight/cached') return cache_fight(state, input.checkpoint)
  if (input.type === 'fight/canonical_ended' && state.fight.checkpoint?.contract.id === input.fight)
    return Object.freeze({
      ...state,
      fight: Object.freeze({ ...state.fight, canonical_ended: input.ended }),
    })
  if (input.type === 'fight/uncached') return uncache_fight(state, input.fight)
  if (input.type === 'fight/reconciled') return reconcile_fight(state, input)
  if (input.type === 'fight/input' && input.origin === 'local' && input.input.type === 'end_turn')
    return Object.freeze({
      ...state,
      fight: Object.freeze({ ...state.fight, end_turn_submitted: true }),
    })
  if (input.type === 'fight/mounted')
    return Object.freeze({
      ...state,
      fight: Object.freeze({
        ...state.fight,
        spectating: input.mounted,
        mounted: input.mounted || state.fight.mounted,
      }),
    })
  if (input.type === 'character/select') return select_character_fight(state, input.character_id)
  if (input.type === 'fight/started_at' && state.fight.checkpoint?.contract.id === input.fight)
    return Object.freeze({
      ...state,
      fight: Object.freeze({ ...state.fight, started_at_ms: input.at_ms }),
    })
  if (input.type === 'fight/transaction_pending' && state.fight.checkpoint?.contract.id === input.fight)
    return Object.freeze({
      ...state,
      fight: Object.freeze({ ...state.fight, transaction_pending: input.pending }),
    })
  if (input.type === 'fight/end_turn_queued' && state.fight.checkpoint?.contract.id === input.fight) {
    if (input.queued && state.fight.transaction_pending) return state
    return Object.freeze({
      ...state,
      fight: Object.freeze({
        ...state.fight,
        end_turn_queued: input.queued,
        end_turn_submitted: input.queued ? false : state.fight.end_turn_submitted,
      }),
    })
  }
  if (input.type === 'fight/restored')
    return Object.freeze({
      ...state,
      fight: Object.freeze({
        ...state.fight,
        end_turn_queued: false,
        end_turn_submitted: false,
        restore_serial: state.fight.restore_serial + 1,
      }),
    })
  if (input.type === 'fight/presented' && input.presentation_batch === state.fight.presentations[0]?.batch)
    return Object.freeze({
      ...state,
      fight: Object.freeze({ ...state.fight, presentations: Object.freeze(state.fight.presentations.slice(1)) }),
    })
  if (input.type === 'fight/closed') return close_fight(state)
  if (input.type === 'fight/released') return release_character_fight(state, input.character_id)
  return state
}

const observe = ({ dispatch, events, get_state }: Parameters<NonNullable<AppModule['observe']>>[0]): void => {
  const session = create_fight_session({
    // Move stores wall-clock milliseconds. A monotonic page-relative clock would make every
    // remotely hydrated deadline look permanently in the future.
    now: () => BigInt(Date.now()),
    reconcile: ({ mode, checkpoint, zone_ids, events: fight_events, presentation_batch, error }) =>
      dispatch({
        type: 'fight/reconciled',
        mode,
        checkpoint,
        zone_ids,
        events: fight_events,
        presentation_batch,
        error,
      }),
  })
  // The combat log rides the ONE game chat: every reconciled batch's events project to
  // A per-open instance stamp keeps line ids unique when a fight id is reused (lab restarts).
  let fight_instance = 0
  let watched_fight: string | null = null
  const applied_turn_witnesses = new Set<string>()
  events.on('fight/watch', ({ fight }) => {
    watched_fight = fight
  })
  events.on('fight/opened', () => {
    fight_instance += 1
    applied_turn_witnesses.clear()
  })
  events.on('fight/reconciled', ({ checkpoint, events: fight_events, presentation_batch }) => {
    if (fight_events.length === 0) return
    const state = get_state()
    const name_of = (seat: bigint): string => {
      const fighter = checkpoint.contract.fighters[Number(seat)]
      if (!fighter) return `#${seat}`
      if (fighter.kind.type === 'mob') return fighter.kind.snapshot.mob_type
      const { character } = fighter.kind
      return (
        state.session.characters.find(({ id }) => id === character)?.name ??
        state.simulator.characters.find(({ id }) => id === character)?.name ??
        `#${seat}`
      )
    }
    project_fight_chat_lines(checkpoint, fight_events, `${fight_instance}.${presentation_batch}`, name_of).forEach(
      (line) => dispatch({ type: 'chat/line', line })
    )
  })
  events.on('fight/opened', ({ mode, seed, setup, state }) => {
    session.open({ mode, seed, setup, state })
  })
  events.on('fight/input', ({ input, origin }) => {
    if (origin === 'local' && get_state().fight.transaction_pending) return
    const witness_key = input.type === 'turn_seed' ? `${input.fighter}:${input.seed}` : null
    if (witness_key && applied_turn_witnesses.has(witness_key)) return
    session.apply(input)
    if (witness_key && session.state()?.error?.code !== 'unexpected_turn_seed') applied_turn_witnesses.add(witness_key)
  })
  events.on('fight/reset_turn', session.reset_turn)
  events.on('server/packet', ({ packet }) => {
    if (packet.type === 'packet/character_tracked') {
      const state = get_state()
      if (packet.fight !== null) return
      const stale = Object.values(state.fight.cached).find((checkpoint) =>
        checkpoint.contract.fighters.some(
          (fighter) => fighter.kind.type === 'player' && fighter.kind.character === packet.character_id
        )
      )
      const roster = new Set(state.session.characters.map(({ id }) => id))
      const another_seated = stale?.contract.fighters.some(
        (fighter) =>
          fighter.kind.type === 'player' &&
          fighter.kind.character !== packet.character_id &&
          roster.has(fighter.kind.character) &&
          !fighter.settled
      )
      if (stale && packet.character_id === state.session.selected_character_id)
        dispatch({ type: 'fight/released', character_id: packet.character_id })
      if (stale && !another_seated) dispatch({ type: 'fight/uncached', fight: stale.contract.id })
      return
    }
    if (packet.type === 'packet/fight_state') {
      // the chain checkpoint: contract + player sources off the wire, spells from the local
      // seed catalog. normalize_checkpoint inside the core is the one decoder — the cast is
      // the boundary between the wire's raw JSON and the core's bigint-native shape.
      const checkpoint = {
        contract: packet.state.contract,
        sources: { players: packet.state.players, spells: catalog_spell_sources() },
      } as unknown as HydratedFightCheckpoint
      const state = get_state()
      const selected_seated = holds_selected_seat(
        checkpoint,
        state.session.selected_character_id,
        state.session.wallet?.address ?? null
      )
      if (!selected_seated && watched_fight !== packet.fight) {
        dispatch({ type: 'fight/cached', checkpoint })
        return
      }
      if (session.state()?.checkpoint.contract.id === packet.fight) dispatch({ type: 'fight/replaced', checkpoint })
      else dispatch({ type: 'fight/opened', mode: 'remote', state: checkpoint })
      const canonical = get_state().fight.checkpoint
      const ended = Boolean((packet.state.contract as { ended?: boolean }).ended)
      dispatch({ type: 'fight/canonical_ended', fight: packet.fight, ended })
      if (ended && canonical?.contract.id === packet.fight)
        dispatch({ type: 'fight_result/checkpoint', checkpoint: canonical })
      return
    }
    if (session.state()?.checkpoint.contract.id !== ('fight' in packet ? packet.fight : null)) return
    if (packet.type === 'packet/fight_started')
      dispatch({ type: 'fight/started_at', fight: packet.fight, at_ms: Number(packet.started_ms ?? Date.now()) })
    if (packet.type === 'packet/fight_action') {
      dispatch({ type: 'fight/input', input: decode_fight_action(packet.action), origin: 'streamed' })
      return
    }
    if (packet.type === 'packet/fighter_forfeited') {
      // the chain's witness of a walk-out, replayed through the SAME door as the live relay —
      // the core folds it once (a second arrival finds the seat already settled and fails
      // harmlessly), and the death cue plus the combat-log line fall out of that fold
      dispatch({
        type: 'fight/input',
        input: { type: 'forfeit', fighter: BigInt(packet.fighter) },
        origin: 'streamed',
      })
      return
    }
    if (packet.type === 'packet/turn_seed') {
      const witness = Object.freeze({
        type: 'turn_seed' as const,
        fighter: BigInt(packet.seat),
        seed: BigInt(packet.seed),
      })
      dispatch({ type: 'fight/input', input: witness, origin: 'streamed' })
      // a seed with no pending boundary means the turn advanced without a streamed action —
      // someone CRANKED the stall (crank is chain-only, never relayed). Replay it, then feed
      // the same witness into the now-pending crank.
      if (get_state().fight.error?.code === 'unexpected_turn_seed') {
        // observed_ms is REQUIRED: a 0n clock reads as too_soon and the crank never pends
        dispatch({
          type: 'fight/input',
          input: { type: 'crank', observed_ms: BigInt(Date.now()) },
          origin: 'streamed',
        })
        dispatch({ type: 'fight/input', input: witness, origin: 'streamed' })
      }
    }
  })
  events.on('STATE_UPDATED', (state, previous) => {
    if (state.fight !== previous.fight && terminal_remote_draft_needs_commit(state.fight)) {
      dispatch({ type: 'fight/end_turn_queued', fight: state.fight.checkpoint!.contract.id, queued: true })
      return
    }
    // the close is decided HERE, on the observed state delta — never inside the `fight/input`
    // handler, where clearing the session would race the peer relay that reads the fight id
    // from the same state and leave nobody told about the forfeit
    if (state.fight !== previous.fight && fight_should_close(state.fight, state.session.selected_character_id)) {
      const selected = state.session.selected_character_id
      if (state.fight.mode === 'remote' && !state.fight.checkpoint?.contract.ended && selected)
        dispatch({ type: 'fight/released', character_id: selected })
      else dispatch({ type: 'fight/closed' })
      return
    }
  })
  events.on('character/select', ({ character_id }) => {
    const cached = Object.values(get_state().fight.cached).find((checkpoint) =>
      holds_selected_seat(checkpoint, character_id, get_state().session.wallet?.address ?? null)
    )
    if (cached) session.open({ mode: 'remote', state: cached })
  })
  events.on('fight/replaced', ({ checkpoint }) => session.replace(checkpoint))
  events.on('fight/restored', ({ checkpoint }) => session.restore(checkpoint))
  const close_session = (): void => {
    applied_turn_witnesses.clear()
    session.close()
    dispatch({ type: 'fight/watch', fight: null })
  }
  events.on('fight/closed', close_session)
  events.on('fight/released', close_session)
}
export default Object.freeze({ name: 'fight', reduce, observe }) satisfies AppModule
