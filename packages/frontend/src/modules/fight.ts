// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  type FightEvent,
  type FightInput,
  type FightMode,
  type FightRuntimeError,
  type FightSetup,
  type HydratedFightCheckpoint,
} from '@aresrpg/fight'

import type { AppInput, AppModule, AppState } from '../store.ts'

import { holds_character_seat } from './fight_identity.ts'
import { same_fight_turn } from './fight_lifecycle.ts'
import { is_fight_board_page } from './navigation.ts'
import { observe_fights } from './fight_observer.ts'
export { create_fight_session, type ActiveFightSession } from './fight_session.ts'

export { fight_should_close, terminal_remote_draft_needs_commit } from './fight_lifecycle.ts'

export type FightPresentationBatch = Readonly<{
  batch: number
  before: HydratedFightCheckpoint
  checkpoint: HydratedFightCheckpoint
  zone_ids: readonly string[]
  events: readonly FightEvent[]
}>

type FightEnvironment = Readonly<{
  zone_ids: readonly string[]
  presentations: readonly FightPresentationBatch[]
  error: FightRuntimeError | null
  canonical_ended: boolean
  started_at_ms: number | null
  transaction_pending: boolean
  placement_changed_seats: Readonly<Record<number, true>>
  ready_submitted_seat: number | null
  end_turn_queued: boolean
  end_turn_submitted: boolean
  restore_serial: number
  awaiting_turn_witness: boolean
}>

export type FightKolizeumManager = Readonly<{ id: string; pledge_mist: bigint }>

export type FightSessionState = Readonly<{
  cached: Readonly<Record<string, HydratedFightCheckpoint>>
  environments: Readonly<Record<string, FightEnvironment>>
  /** Immutable wager manager terms, projected beside the fight machine and cached per fight. */
  kolizeum_by_fight: Readonly<Record<string, FightKolizeumManager>>
  mode: FightMode | null
  checkpoint: HydratedFightCheckpoint | null
  zone_ids: readonly string[]
  /** ordered remote/local cue batches; React consumes the head before the next can replace it */
  presentations: readonly FightPresentationBatch[]
  error: FightRuntimeError | null
  canonical_ended: boolean
  /** The board is on screen. Derived from the selected owned seat or the spectator identity
   * anchored to this selected character. */
  mounted: boolean
  /** a spectator's commit — the one mount that no seat can witness */
  spectating_by_character: Readonly<Record<string, string>>
  /** the start's wall-clock witness (null when armed after the fight had already begun) */
  started_at_ms: number | null
  transaction_pending: boolean
  /** optimistic placement latch; receipt success does not reopen Ready before projection */
  ready_submitted_seat: number | null
  end_turn_queued: boolean
  end_turn_submitted: boolean
  restore_serial: number
  awaiting_turn_witness: boolean
}>

export type FightSessionInput =
  | Readonly<{
      type: 'fight/opened'
      mode: FightMode
      setup?: FightSetup
      state?: HydratedFightCheckpoint
      seed?: bigint
    }>
  | Readonly<{ type: 'fight/input'; fight: string | null; input: FightInput; origin: 'local' | 'streamed' }>
  | Readonly<{ type: 'fight/cancel_pending_turn'; fight: string }>
  | Readonly<{ type: 'fight/runtime_input'; fight: string; input: FightInput }>
  | Readonly<{ type: 'fight/reset_turn'; fight: string | null }>
  | Readonly<{ type: 'fight/replaced'; checkpoint: HydratedFightCheckpoint }>
  | Readonly<{ type: 'fight/cached'; checkpoint: HydratedFightCheckpoint }>
  | Readonly<{ type: 'fight/uncached'; fight: string }>
  | Readonly<{ type: 'fight/kolizeum'; fight: string; kolizeum: FightKolizeumManager | null }>
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
      awaiting_turn_witness: boolean
      project?: boolean
    }>
  | Readonly<{ type: 'fight/presented'; presentation: FightPresentationBatch }>
  | Readonly<{ type: 'fight/spectating'; character_id: string; fight: string }>
  | Readonly<{ type: 'fight/preview_closed'; character_id: string; fight: string }>
  | Readonly<{ type: 'fight/started_at'; fight: string; at_ms: number }>
  | Readonly<{ type: 'fight/transaction_pending'; fight: string; pending: boolean }>
  | Readonly<{ type: 'fight/end_turn_queued'; fight: string; queued: boolean }>
  | Readonly<{ type: 'fight/canonical_ended'; fight: string; ended: boolean }>
  /** arm/disarm the server-side watch for a fight — folded by NO state; session.ts sends it */
  | Readonly<{ type: 'fight/watch'; character_id: string; fight: string | null }>
  | Readonly<{ type: 'fight/resync'; fight: string }>
  | Readonly<{ type: 'fight/released'; character_id: string }>
  | Readonly<{ type: 'fight/closed'; fight: string | null }>

export const initial_fight_session_state = (): FightSessionState =>
  Object.freeze({
    cached: Object.freeze({}),
    environments: Object.freeze({}),
    kolizeum_by_fight: Object.freeze({}),
    mode: null,
    checkpoint: null,
    zone_ids: Object.freeze([]),
    presentations: Object.freeze([]),
    error: null,
    canonical_ended: false,
    mounted: false,
    spectating_by_character: Object.freeze({}),
    started_at_ms: null,
    transaction_pending: false,
    ready_submitted_seat: null,
    end_turn_queued: false,
    end_turn_submitted: false,
    restore_serial: 0,
    awaiting_turn_witness: false,
  })

const initial_fight_environment = (): FightEnvironment =>
  Object.freeze({
    zone_ids: Object.freeze([]),
    presentations: Object.freeze([]),
    error: null,
    canonical_ended: false,
    started_at_ms: null,
    transaction_pending: false,
    placement_changed_seats: Object.freeze({}),
    ready_submitted_seat: null,
    end_turn_queued: false,
    end_turn_submitted: false,
    restore_serial: 0,
    awaiting_turn_witness: false,
  })

const presentation_start_checkpoint = (
  previous: Readonly<HydratedFightCheckpoint> | undefined,
  current: Readonly<HydratedFightCheckpoint>
): Readonly<HydratedFightCheckpoint> => previous ?? current

export const fight_environment = (fight: Readonly<FightSessionState>, fight_id: string): FightEnvironment =>
  fight.environments[fight_id] ?? initial_fight_environment()

export const fight_placement_changes = (
  fight: Readonly<FightSessionState>,
  fight_id: string | null
): Readonly<Record<number, true>> => fight_environment(fight, fight_id ?? '').placement_changed_seats

const update_fight_environment = (
  state: AppState,
  fight_id: string,
  update: (environment: FightEnvironment) => FightEnvironment
): AppState => {
  const environment = update(fight_environment(state.fight, fight_id))
  const selected = state.fight.checkpoint?.contract.id === fight_id
  return Object.freeze({
    ...state,
    fight: Object.freeze({
      ...state.fight,
      environments: Object.freeze({ ...state.fight.environments, [fight_id]: environment }),
      ...(selected
        ? {
            zone_ids: environment.zone_ids,
            presentations: environment.presentations,
            error: environment.error,
            canonical_ended: environment.canonical_ended,
            started_at_ms: environment.started_at_ms,
            transaction_pending: environment.transaction_pending,
            end_turn_queued: environment.end_turn_queued,
            end_turn_submitted: environment.end_turn_submitted,
            restore_serial: environment.restore_serial,
            awaiting_turn_witness: environment.awaiting_turn_witness,
          }
        : {}),
    }),
  })
}

/** A SEAT IS THE MOUNT (2026-08-22): a chain transaction — a duel challenge, a duel accept, a
 *  mob engage — seats a character without any modal ever opening, and the board must appear on
 *  its own. Mounting off the modal alone left every duel challenger standing in the overworld
 *  while his character sat on a board he could not see. A spectator holds no seat and still
 *  mounts explicitly. */
const reconcile_fight = (
  state: Readonly<AppState>,
  input: Extract<AppInput, { type: 'fight/reconciled' }>
): AppState => {
  const fight_id = input.checkpoint.contract.id
  const previous_checkpoint = state.fight.cached[fight_id]
  const previous = fight_environment(state.fight, fight_id)
  const mounted =
    input.mode === 'local' ||
    state.session.characters.find(({ id }) => id === state.session.selected_character_id)?.active_fight?.id ===
      fight_id ||
    state.fight.spectating_by_character[state.session.selected_character_id ?? ''] === fight_id ||
    (input.mode === 'remote' &&
      holds_character_seat(
        input.checkpoint,
        state.session.selected_character_id,
        state.session.wallet?.address ?? null
      ))
  // A fight nobody is watching runs like a background window: its state advances, its
  // animations are simply never scheduled. Switching back lands on the live checkpoint.
  const on_screen =
    input.mode === 'local' || (input.project !== false && mounted && is_fight_board_page(state.navigation.page))
  const presentations = !on_screen
    ? Object.freeze([])
    : input.events.length === 0
      ? previous.presentations
      : Object.freeze([
          ...previous.presentations,
          Object.freeze({
            batch: input.presentation_batch,
            before: presentation_start_checkpoint(previous_checkpoint, input.checkpoint),
            checkpoint: input.checkpoint,
            zone_ids: Object.freeze([...input.zone_ids]),
            events: Object.freeze([...input.events]),
          }),
        ])
  const same_turn = same_fight_turn(previous_checkpoint?.contract, input.checkpoint.contract)
  // Ready is irreversible during placement. Keep the latch through receipt success and stale
  // streamed placement rows; only starting the fight or an explicit refusal restores it.
  const ready_confirmed = input.checkpoint.contract.round !== 0n
  const environment = Object.freeze({
    zone_ids: Object.freeze([...input.zone_ids]),
    presentations,
    error: input.error,
    canonical_ended: previous.canonical_ended,
    started_at_ms:
      previous.started_at_ms ??
      (input.checkpoint.contract.started_ms === null ? null : Number(input.checkpoint.contract.started_ms)),
    transaction_pending: previous.transaction_pending,
    placement_changed_seats: previous.placement_changed_seats,
    ready_submitted_seat: ready_confirmed ? null : previous.ready_submitted_seat,
    end_turn_queued: same_turn ? previous.end_turn_queued : false,
    end_turn_submitted: same_turn ? previous.end_turn_submitted : false,
    restore_serial: previous.restore_serial,
    awaiting_turn_witness: input.awaiting_turn_witness,
  })
  const environments = Object.freeze({ ...state.fight.environments, [fight_id]: environment })
  const cached = Object.freeze({ ...state.fight.cached, [fight_id]: input.checkpoint })
  if (input.project === false)
    return Object.freeze({ ...state, fight: Object.freeze({ ...state.fight, cached, environments }) })
  return Object.freeze({
    ...state,
    fight: Object.freeze({
      mode: input.mode,
      cached,
      environments,
      kolizeum_by_fight: state.fight.kolizeum_by_fight,
      checkpoint: input.checkpoint,
      zone_ids: environment.zone_ids,
      presentations: environment.presentations,
      error: environment.error,
      canonical_ended: environment.canonical_ended,
      // The selected character owns the board. Wallet ownership is too broad: one account may
      // have several characters standing in different worlds or fights. The local lab has no
      // selected chain character; successful local reconciliation is its mount witness.
      mounted,
      spectating_by_character: state.fight.spectating_by_character,
      started_at_ms: environment.started_at_ms,
      transaction_pending: environment.transaction_pending,
      ready_submitted_seat: environment.ready_submitted_seat,
      end_turn_queued: environment.end_turn_queued,
      end_turn_submitted: environment.end_turn_submitted,
      restore_serial: environment.restore_serial,
      awaiting_turn_witness: environment.awaiting_turn_witness,
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
  const environments = Object.freeze(
    Object.fromEntries(Object.entries(state.fight.environments).filter(([id]) => id !== fight))
  )
  const kolizeum_by_fight = Object.freeze(
    Object.fromEntries(Object.entries(state.fight.kolizeum_by_fight).filter(([id]) => id !== fight))
  )
  return state.fight.checkpoint?.contract.id === fight
    ? Object.freeze({
        ...state,
        fight: Object.freeze({
          ...initial_fight_session_state(),
          cached,
          environments,
          kolizeum_by_fight,
          spectating_by_character: state.fight.spectating_by_character,
        }),
      })
    : Object.freeze({ ...state, fight: Object.freeze({ ...state.fight, cached, environments, kolizeum_by_fight }) })
}

/** Unwatched animations are never owed: leaving a board (or arriving on one) drops its queued
 *  cue batches — like switching windows, the game ran on without us. */
const drop_presentation_queue = (
  environments: Readonly<Record<string, FightEnvironment>>,
  fight_id: string | undefined
): Readonly<Record<string, FightEnvironment>> => {
  const environment = fight_id ? environments[fight_id] : undefined
  if (!fight_id || !environment || environment.presentations.length === 0) return environments
  return Object.freeze({
    ...environments,
    [fight_id]: Object.freeze({ ...environment, presentations: Object.freeze([]) }),
  })
}

const select_character_fight = (state: Readonly<AppState>, character_id: string): AppState => {
  const owner = state.session.wallet?.address ?? null
  const character = state.session.characters.find(({ id }) => id === character_id)
  const seated = character?.active_fight
    ? state.fight.cached[character.active_fight.id]
    : character && character.custody !== 'kiosk'
      ? Object.values(state.fight.cached).find((candidate) => holds_character_seat(candidate, character_id, owner))
      : undefined
  const spectated_fight = state.fight.spectating_by_character[character_id]
  const spectated = spectated_fight ? state.fight.cached[spectated_fight] : undefined
  const checkpoint = seated ?? spectated
  if (checkpoint && state.fight.checkpoint?.contract.id !== checkpoint.contract.id) {
    const environments = drop_presentation_queue(
      drop_presentation_queue(state.fight.environments, state.fight.checkpoint?.contract.id),
      checkpoint.contract.id
    )
    const environment = environments[checkpoint.contract.id] ?? initial_fight_environment()
    return Object.freeze({
      ...state,
      fight: Object.freeze({
        ...initial_fight_session_state(),
        cached: state.fight.cached,
        environments,
        kolizeum_by_fight: state.fight.kolizeum_by_fight,
        mode: 'remote',
        checkpoint,
        zone_ids: environment.zone_ids,
        presentations: environment.presentations,
        error: environment.error,
        canonical_ended: environment.canonical_ended,
        mounted: true,
        spectating_by_character: state.fight.spectating_by_character,
        started_at_ms: environment.started_at_ms,
        transaction_pending: environment.transaction_pending,
        ready_submitted_seat: environment.ready_submitted_seat,
        end_turn_queued: environment.end_turn_queued,
        end_turn_submitted: environment.end_turn_submitted,
        restore_serial: environment.restore_serial,
        awaiting_turn_witness: environment.awaiting_turn_witness,
      }),
    })
  }
  if (!checkpoint)
    return Object.freeze({
      ...state,
      fight: Object.freeze({
        ...initial_fight_session_state(),
        cached: state.fight.cached,
        environments: drop_presentation_queue(state.fight.environments, state.fight.checkpoint?.contract.id),
        kolizeum_by_fight: state.fight.kolizeum_by_fight,
        spectating_by_character: state.fight.spectating_by_character,
      }),
    })
  const mounted = !!checkpoint
  return Object.freeze({
    ...state,
    fight: Object.freeze({ ...state.fight, mounted }),
  })
}

const close_fight = (state: Readonly<AppState>): AppState => {
  const closing = state.fight.checkpoint?.contract.id
  const cached = closing
    ? Object.freeze(Object.fromEntries(Object.entries(state.fight.cached).filter(([fight]) => fight !== closing)))
    : state.fight.cached
  const environments = closing
    ? Object.freeze(Object.fromEntries(Object.entries(state.fight.environments).filter(([fight]) => fight !== closing)))
    : state.fight.environments
  const kolizeum_by_fight = closing
    ? Object.freeze(
        Object.fromEntries(Object.entries(state.fight.kolizeum_by_fight).filter(([fight]) => fight !== closing))
      )
    : state.fight.kolizeum_by_fight
  const spectating_by_character = Object.freeze(
    Object.fromEntries(Object.entries(state.fight.spectating_by_character).filter(([, fight]) => fight !== closing))
  )
  return Object.freeze({
    ...state,
    fight: Object.freeze({
      ...initial_fight_session_state(),
      cached,
      environments,
      kolizeum_by_fight,
      spectating_by_character,
    }),
  })
}

const close_fight_preview = (state: Readonly<AppState>, fight: string): AppState => {
  const checkpoint =
    state.fight.cached[fight] ?? (state.fight.checkpoint?.contract.id === fight ? state.fight.checkpoint : null)
  if (!checkpoint) return state
  const roster = new Set(state.session.characters.map(({ id }) => id))
  const owner = state.session.wallet?.address ?? null
  const retained_spectator = Object.values(state.fight.spectating_by_character).includes(fight)
  const owned = checkpoint.contract.fighters.some(
    (fighter) =>
      fighter.kind.type === 'player' &&
      fighter.kind.owner === owner &&
      roster.has(fighter.kind.character) &&
      !fighter.settled
  )
  return owned || retained_spectator
    ? state.session.selected_character_id
      ? select_character_fight(state, state.session.selected_character_id)
      : state
    : uncache_fight(state, fight)
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
  const retained_spectator = Object.values(state.fight.spectating_by_character).includes(checkpoint.contract.id)
  if (!another_seated && !retained_spectator) return close_fight(state)
  return Object.freeze({
    ...state,
    fight: Object.freeze({
      ...state.fight,
      mounted: false,
      presentations: Object.freeze([]),
      transaction_pending: false,
      end_turn_queued: false,
      end_turn_submitted: false,
    }),
  })
}

const spectate_fight = (
  state: Readonly<AppState>,
  input: Extract<AppInput, { type: 'fight/spectating' }>
): AppState => {
  const checkpoint = state.fight.cached[input.fight]
  const swapping = !!checkpoint && state.fight.checkpoint?.contract.id !== input.fight
  return Object.freeze({
    ...state,
    fight: Object.freeze({
      ...state.fight,
      ...(checkpoint ? { mode: 'remote' as const, checkpoint } : {}),
      ...(swapping
        ? {
            environments: drop_presentation_queue(state.fight.environments, state.fight.checkpoint?.contract.id),
            presentations: Object.freeze([]),
          }
        : {}),
      spectating_by_character: Object.freeze({
        ...state.fight.spectating_by_character,
        [input.character_id]: input.fight,
      }),
      mounted: state.session.selected_character_id === input.character_id && !!checkpoint,
    }),
  })
}

const close_requested_fight = (state: AppState, fight: string | null): AppState =>
  fight && state.fight.checkpoint?.contract.id !== fight ? state : close_fight(state)

const reduce_local_fight_latch = (state: AppState, input: AppInput): AppState | null => {
  if (input.type !== 'fight/input' || input.origin !== 'local' || !input.fight) return null
  if (input.input.type === 'place') {
    const fighter = Number(input.input.fighter)
    return update_fight_environment(state, input.fight, (environment) =>
      Object.freeze({
        ...environment,
        placement_changed_seats: Object.freeze({ ...environment.placement_changed_seats, [fighter]: true }),
      })
    )
  }
  if (input.input.type === 'ready') {
    const fighter = Number(input.input.fighter)
    return update_fight_environment(state, input.fight, (environment) =>
      Object.freeze({ ...environment, ready_submitted_seat: fighter })
    )
  }
  return input.input.type === 'end_turn'
    ? update_fight_environment(state, input.fight, (environment) =>
        Object.freeze({ ...environment, end_turn_submitted: true })
      )
    : null
}

const reduce = (state: AppState, input: AppInput): AppState => {
  const local_latch = reduce_local_fight_latch(state, input)
  if (local_latch) return local_latch
  if (input.type === 'server/packet' && input.packet.type === 'packet/characters') {
    const selected = state.session.selected_character_id
    return selected ? select_character_fight(state, selected) : state
  }
  if (input.type === 'fight/cached') return cache_fight(state, input.checkpoint)
  if (input.type === 'fight/kolizeum') {
    const kolizeum_by_fight = Object.freeze({
      ...Object.fromEntries(Object.entries(state.fight.kolizeum_by_fight).filter(([fight]) => fight !== input.fight)),
      ...(input.kolizeum ? { [input.fight]: input.kolizeum } : {}),
    })
    return Object.freeze({ ...state, fight: Object.freeze({ ...state.fight, kolizeum_by_fight }) })
  }
  if (input.type === 'fight/canonical_ended')
    return update_fight_environment(state, input.fight, (environment) =>
      Object.freeze({ ...environment, canonical_ended: input.ended })
    )
  if (input.type === 'fight/uncached') return uncache_fight(state, input.fight)
  if (input.type === 'fight/reconciled') return reconcile_fight(state, input)
  if (input.type === 'fight/spectating') return spectate_fight(state, input)
  if (input.type === 'fight/preview_closed') return close_fight_preview(state, input.fight)
  if (input.type === 'character/select') return select_character_fight(state, input.character_id)
  if (input.type === 'fight/started_at')
    return update_fight_environment(state, input.fight, (environment) =>
      Object.freeze({ ...environment, started_at_ms: input.at_ms })
    )
  if (input.type === 'fight/transaction_pending')
    return update_fight_environment(state, input.fight, (environment) =>
      Object.freeze({ ...environment, transaction_pending: input.pending })
    )
  if (input.type === 'fight/end_turn_queued') {
    const environment = fight_environment(state.fight, input.fight)
    if (input.queued && environment.transaction_pending) return state
    return update_fight_environment(state, input.fight, (current) =>
      Object.freeze({
        ...current,
        end_turn_queued: input.queued,
        end_turn_submitted: input.queued ? false : current.end_turn_submitted,
      })
    )
  }
  if (input.type === 'fight/restored')
    return update_fight_environment(state, input.checkpoint.contract.id, (environment) =>
      Object.freeze({
        ...environment,
        end_turn_queued: false,
        end_turn_submitted: false,
        ready_submitted_seat: null,
        restore_serial: environment.restore_serial + 1,
      })
    )
  if (input.type === 'fight/presented') {
    const fight_id = input.presentation.checkpoint.contract.id
    const environment = fight_environment(state.fight, fight_id)
    if (input.presentation.batch !== environment.presentations[0]?.batch) return state
    return update_fight_environment(state, fight_id, (current) =>
      Object.freeze({ ...current, presentations: Object.freeze(current.presentations.slice(1)) })
    )
  }
  if (input.type === 'fight/closed') return close_requested_fight(state, input.fight)
  if (input.type === 'fight/released') return release_character_fight(state, input.character_id)
  return state
}

export default Object.freeze({ name: 'fight', reduce, observe: observe_fights }) satisfies AppModule
