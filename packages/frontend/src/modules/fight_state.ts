// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type {
  FightEvent,
  FightInput,
  FightMode,
  FightRuntimeError,
  FightSetup,
  HydratedFightCheckpoint,
} from '@aresrpg/fight'
import type { FightPresentationCue } from '@aresrpg/engine'

import type { NearbyFight } from './nearby_fight.ts'

export type FightPresentationBatch = Readonly<{
  batch: number
  before: HydratedFightCheckpoint
  checkpoint: HydratedFightCheckpoint
  zone_ids: readonly string[]
  events: readonly FightEvent[]
}>
export type FightEnvironment = Readonly<{
  zone_ids: readonly string[]
  presentations: readonly FightPresentationBatch[]
  error: FightRuntimeError | null
  canonical_ended: boolean
  started_at_ms: number | null
  transaction_pending: boolean
  placement_changed_seats: Readonly<Record<number, true>>
  ready_submitted_seats: readonly number[]
  ready_all_progress: ReadyAllProgress | null
  end_turn_queued: boolean
  end_turn_submitted: boolean
  restore_serial: number
  awaiting_turn_witness: boolean
}>
export type ReadyAllProgress = Readonly<{
  completed: number
  total: number
  status: 'running' | 'failed' | 'complete'
}>
export type FightKolizeumManager = Readonly<{ id: string; pledge_mist: bigint }>
export type FightSessionState = Readonly<{
  nearby: NearbyFight
  cached: Readonly<Record<string, HydratedFightCheckpoint>>
  environments: Readonly<Record<string, FightEnvironment>>
  /** Immutable wager manager terms, projected beside the fight machine and cached per fight. */
  kolizeum_by_fight: Readonly<Record<string, FightKolizeumManager>>
  mode: FightMode | null
  checkpoint: HydratedFightCheckpoint | null
  zone_ids: readonly string[]
  presentations: readonly FightPresentationBatch[]
  error: FightRuntimeError | null
  canonical_ended: boolean
  /** Immersive presentation owns controls. Ambient boards never set this flag. */
  mounted: boolean
  /** a spectator's commit — the one mount that no seat can witness */
  spectating_by_character: Readonly<Record<string, string>>
  /** the start's wall-clock witness (null when armed after the fight had already begun) */
  started_at_ms: number | null
  transaction_pending: boolean
  /** optimistic placement latch; receipt success does not reopen Ready before projection */
  ready_submitted_seats: readonly number[]
  ready_all_progress: ReadyAllProgress | null
  end_turn_queued: boolean
  end_turn_submitted: boolean
  restore_serial: number
  awaiting_turn_witness: boolean
}>
export type FightSessionInput =
  | Readonly<{ type: 'fight/nearby'; nearby: NearbyFight }>
  | Readonly<{
      type: 'fight/opened'
      mode: FightMode
      setup?: FightSetup
      state?: HydratedFightCheckpoint
      seed?: bigint
    }>
  | Readonly<{ type: 'fight/input'; fight: string | null; input: FightInput; origin: 'local' | 'streamed' }>
  | Readonly<{ type: 'fight/ready_all'; fight: string; fighters: readonly bigint[] }>
  | Readonly<{
      type: 'fight/ready_all_progress'
      fight: string
      completed: number
      total: number
      status: ReadyAllProgress['status']
      fighter?: bigint
    }>
  | Readonly<{ type: 'fight/cancel_pending_turn'; fight: string }>
  | Readonly<{ type: 'fight/runtime_input'; fight: string; input: FightInput }>
  | Readonly<{ type: 'fight/reset_turn'; fight: string | null }>
  | Readonly<{ type: 'fight/replaced'; checkpoint: HydratedFightCheckpoint }>
  | Readonly<{ type: 'fight/cached'; checkpoint: HydratedFightCheckpoint }>
  | Readonly<{ type: 'fight/checkpoint_confirmed'; checkpoint: HydratedFightCheckpoint }>
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
  | Readonly<{
      type: 'fight/presentation_cue'
      presentation: FightPresentationBatch | null
      cue: FightPresentationCue
      phase: 'start' | 'complete'
    }>
  | Readonly<{ type: 'fight/spectating'; character_id: string; fight: string | null }>
  | Readonly<{ type: 'fight/preview_closed'; character_id: string; fight: string }>
  | Readonly<{ type: 'fight/started_at'; fight: string; at_ms: number }>
  | Readonly<{ type: 'fight/transaction_pending'; fight: string; pending: boolean }>
  | Readonly<{ type: 'fight/forfeit_completed'; fight: string; fighter: bigint; ok: boolean }>
  | Readonly<{ type: 'fight/end_turn_queued'; fight: string; queued: boolean }>
  | Readonly<{ type: 'fight/canonical_ended'; fight: string; ended: boolean }>
  /** arm/disarm the server-side watch for a fight — folded by NO state; session.ts sends it */
  | Readonly<{ type: 'fight/watch'; character_id: string; fight: string | null }>
  | Readonly<{ type: 'fight/resync'; fight: string }>
  | Readonly<{ type: 'fight/released'; character_id: string }>
  | Readonly<{ type: 'fight/closed'; fight: string | null }>

export const initial_fight_session_state = (): FightSessionState =>
  Object.freeze({
    nearby: null,
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
    ready_submitted_seats: Object.freeze([]),
    ready_all_progress: null,
    end_turn_queued: false,
    end_turn_submitted: false,
    restore_serial: 0,
    awaiting_turn_witness: false,
  })

export const initial_fight_environment = (): FightEnvironment =>
  Object.freeze({
    zone_ids: Object.freeze([]),
    presentations: Object.freeze([]),
    error: null,
    canonical_ended: false,
    started_at_ms: null,
    transaction_pending: false,
    placement_changed_seats: Object.freeze({}),
    ready_submitted_seats: Object.freeze([]),
    ready_all_progress: null,
    end_turn_queued: false,
    end_turn_submitted: false,
    restore_serial: 0,
    awaiting_turn_witness: false,
  })
