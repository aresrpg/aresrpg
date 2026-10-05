// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { HydratedFightCheckpoint } from '@aresrpg/fight'

import type { AppInput, AppModule, AppState } from '../store.ts'

import {
  initial_fight_environment,
  initial_fight_session_state,
  type FightSessionState,
  type FightEnvironment,
  type FightSessionInput,
  type ReadyAllProgress,
} from './fight_state.ts'
import { holds_character_seat } from './fight_identity.ts'
import { fight_latch } from './fight_latch.ts'
import { end_turn_submission_after_reconcile, same_fight_turn } from './fight_lifecycle.ts'
import { observe_fights } from './fight_observer.ts'
export { create_fight_session, type ActiveFightSession } from './fight_session.ts'
export { fight_should_close, terminal_remote_draft_needs_commit } from './fight_lifecycle.ts'
export { initial_fight_session_state } from './fight_state.ts'
export type {
  FightSessionInput,
  FightSessionState,
  FightEnvironment,
  FightPresentationBatch,
  FightKolizeumManager,
  ReadyAllProgress,
} from './fight_state.ts'

const presentation_start_checkpoint = (
  previous: Readonly<HydratedFightCheckpoint> | undefined,
  current: Readonly<HydratedFightCheckpoint>
): Readonly<HydratedFightCheckpoint> => previous ?? current

const ready_progress_after_reconcile = (
  progress: ReadyAllProgress | null,
  ready_confirmed: boolean
): ReadyAllProgress | null => (ready_confirmed ? null : progress)

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
            ready_submitted_seats: environment.ready_submitted_seats,
            ready_all_progress: environment.ready_all_progress,
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
  const on_screen = [
    input.mode === 'local',
    input.project !== false && mounted,
    state.fight.nearby?.fight === fight_id,
  ].includes(true)
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
    return_character_id: previous.return_character_id,
    zone_ids: Object.freeze([...input.zone_ids]),
    presentations,
    error: input.error,
    canonical_ended: previous.canonical_ended,
    started_at_ms:
      previous.started_at_ms ??
      (input.checkpoint.contract.started_ms === null ? null : Number(input.checkpoint.contract.started_ms)),
    transaction_pending: previous.transaction_pending,
    placement_changed_seats: previous.placement_changed_seats,
    ready_submitted_seats: ready_confirmed ? Object.freeze([]) : previous.ready_submitted_seats,
    ready_all_progress: ready_progress_after_reconcile(previous.ready_all_progress, ready_confirmed),
    end_turn_queued: same_turn ? previous.end_turn_queued : false,
    end_turn_submitted: end_turn_submission_after_reconcile(previous, same_turn, input.checkpoint.contract.ended),
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
      nearby: state.fight.nearby,
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
      ready_submitted_seats: environment.ready_submitted_seats,
      ready_all_progress: environment.ready_all_progress,
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
          nearby: state.fight.nearby,
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
        nearby: state.fight.nearby,
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
        ready_submitted_seats: environment.ready_submitted_seats,
        ready_all_progress: environment.ready_all_progress,
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
        nearby: state.fight.nearby,
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
      nearby: state.fight.nearby,
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
  const owner = state.session.wallet?.address ?? null
  const retained_spectator = [
    state.fight.nearby?.fight,
    ...Object.values(state.fight.spectating_by_character),
  ].includes(fight)
  const owned = state.session.characters.some(({ id }) => holds_character_seat(checkpoint, id, owner))
  return [owned, retained_spectator].includes(true)
    ? state.session.selected_character_id
      ? select_character_fight(state, state.session.selected_character_id)
      : state
    : uncache_fight(state, fight)
}

const release_character_fight = (state: Readonly<AppState>, character_id: string): AppState => {
  const { checkpoint } = state.fight
  if (!checkpoint || !state.fight.mounted) return state
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
  const next = Object.freeze({
    ...state,
    fight: Object.freeze({
      ...state.fight,
      spectating_by_character: Object.freeze(
        Object.fromEntries([
          ...Object.entries(state.fight.spectating_by_character).filter(
            ([character]) => character !== input.character_id
          ),
          ...(input.fight ? [[input.character_id, input.fight]] : []),
        ])
      ),
    }),
  })
  return state.session.selected_character_id === input.character_id
    ? select_character_fight(next, input.character_id)
    : next
}

const close_requested_fight = (state: AppState, fight: string | null): AppState =>
  fight && state.fight.checkpoint?.contract.id !== fight ? state : close_fight(state)

const reduce_local_fight_latch = (state: AppState, input: AppInput): AppState | null => {
  const latch = fight_latch(state, input)
  return latch ? update_fight_environment(state, latch.fight, latch.update) : null
}

type TransformInput = Extract<
  FightSessionInput,
  {
    type:
      | 'fight/cached'
      | 'fight/uncached'
      | 'fight/reconciled'
      | 'fight/spectating'
      | 'fight/preview_closed'
      | 'fight/closed'
      | 'fight/released'
      | 'fight/nearby'
  }
>
const FIGHT_TRANSFORMS: { [Input in TransformInput as Input['type']]: (state: AppState, input: Input) => AppState } = {
  'fight/cached': (state, input) => cache_fight(state, input.checkpoint),
  'fight/uncached': (state, input) => uncache_fight(state, input.fight),
  'fight/reconciled': reconcile_fight,
  'fight/spectating': spectate_fight,
  'fight/preview_closed': (state, input) => close_fight_preview(state, input.fight),
  'fight/closed': (state, input) => close_requested_fight(state, input.fight),
  'fight/released': (state, input) => release_character_fight(state, input.character_id),
  'fight/nearby': (state, { nearby }) => ({
    ...state,
    fight: {
      ...state.fight,
      nearby,
      environments: drop_presentation_queue(
        state.fight.environments,
        state.fight.mounted ? undefined : state.fight.nearby?.fight
      ),
    },
  }),
}
const reduce = (state: AppState, input: AppInput): AppState => {
  const transform = FIGHT_TRANSFORMS[input.type as TransformInput['type']]
  if (transform) return transform(state, input as never)
  const local_latch = reduce_local_fight_latch(state, input)
  if (local_latch) return local_latch
  if (input.type === 'server/packet' && input.packet.type === 'packet/characters') {
    const selected = state.session.selected_character_id
    return selected ? select_character_fight(state, selected) : state
  }
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
        ready_submitted_seats: environment.ready_all_progress ? environment.ready_submitted_seats : Object.freeze([]),
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
  return state
}

const retain_fight_entry = (state: AppState): AppState => {
  const { mode, mounted, checkpoint } = state.fight
  if (mode !== 'remote' || !mounted || !checkpoint) return state
  const environment = fight_environment(state.fight, checkpoint.contract.id)
  if (environment.return_character_id) return state
  if (!holds_character_seat(checkpoint, state.session.selected_character_id, state.session.wallet?.address ?? null))
    return state
  return update_fight_environment(state, checkpoint.contract.id, (current) => ({
    ...current,
    return_character_id: state.session.selected_character_id,
  }))
}

export default Object.freeze({
  name: 'fight',
  reduce: (state, input) => retain_fight_entry(reduce(state, input)),
  observe: observe_fights,
}) satisfies AppModule
