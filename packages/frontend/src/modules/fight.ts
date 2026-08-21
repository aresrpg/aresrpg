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
import { catalog_spell_sources } from '../content/fight_sources.ts'
import { select_fight_view } from '../game/fight/fight_projection.ts'
import { project_fight_chat_lines } from '../game/fight/fight_chat_lines.ts'

export type FightSessionState = Readonly<{
  mode: FightMode | null
  checkpoint: HydratedFightCheckpoint | null
  zone_ids: readonly string[]
  events: readonly FightEvent[]
  presentation_batch: number
  error: FightRuntimeError | null
  /** false while the session is only a modal's live preview — the board mounts on commit */
  mounted: boolean
  /** the start's wall-clock witness (null when armed after the fight had already begun) */
  started_at_ms: number | null
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
  /** arm/disarm the server-side watch for a fight — folded by NO state; session.ts sends it */
  | Readonly<{ type: 'fight/watch'; fight: string | null }>
  | Readonly<{ type: 'fight/closed' }>

export const initial_fight_session_state = (): FightSessionState =>
  Object.freeze({
    mode: null,
    checkpoint: null,
    zone_ids: Object.freeze([]),
    events: Object.freeze([]),
    presentation_batch: 0,
    error: null,
    mounted: false,
    started_at_ms: null,
  })

/** THE ONE EXIT RULE — a fight surface is released the moment the viewer has no further part
 *  in it. A LOCAL fight ends with its runtime; a REMOTE one ends for YOU when your own seat is
 *  SETTLED, which is the single fact behind all three real exits: forfeiting, losing, winning.
 *  A forfeit that leaves the fight running emits nothing at all, so nothing else could witness
 *  it. Both wait for the presentation to DRAIN, or the last animation — your own death among
 *  them — would be cut mid-frame. A spectator holds no seat and leaves on FightEnded instead. */
export const fight_should_close = (
  fight: Readonly<Pick<FightSessionState, 'mode' | 'checkpoint' | 'events'>>,
  owner: string | null
): boolean => {
  if (fight.events.length > 0 || !fight.checkpoint) return false
  if (fight.mode === 'local') return fight.checkpoint.contract.ended
  if (fight.mode !== 'remote') return false
  // the fight is over for everyone, spectators included — they hold no seat, so `ended` is the
  // only fact that releases them
  if (fight.checkpoint.contract.ended) return true
  // or it is over for YOU alone: a forfeit that leaves the fight running settles your seat and
  // emits nothing else, so this is its only witness
  return (
    !!owner &&
    fight.checkpoint.contract.fighters.some(
      (fighter) => fighter.kind.type === 'player' && fighter.kind.owner === owner && fighter.settled
    )
  )
}

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
  if (input.type === 'fight/reconciled') {
    return Object.freeze({
      ...state,
      fight: Object.freeze({
        mode: input.mode,
        checkpoint: input.checkpoint,
        zone_ids: Object.freeze([...input.zone_ids]),
        events: Object.freeze([...input.events]),
        presentation_batch: input.presentation_batch,
        error: input.error,
        // the runtime never owns mounting — a preview hydrates without ever drawing a board
        mounted: state.fight.mounted,
        started_at_ms: state.fight.started_at_ms,
      }),
    })
  }
  if (input.type === 'fight/mounted')
    return Object.freeze({ ...state, fight: Object.freeze({ ...state.fight, mounted: input.mounted }) })
  if (input.type === 'fight/started_at' && state.fight.checkpoint?.contract.id === input.fight)
    return Object.freeze({
      ...state,
      fight: Object.freeze({ ...state.fight, started_at_ms: input.at_ms }),
    })
  if (input.type === 'fight/presented' && input.presentation_batch === state.fight.presentation_batch)
    return Object.freeze({
      ...state,
      fight: Object.freeze({ ...state.fight, events: Object.freeze([]) }),
    })
  if (input.type === 'fight/closed') return Object.freeze({ ...state, fight: initial_fight_session_state() })
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
  // semantic chat lines here (fight module -> chat module), never into a fight-local log.
  // A per-open instance stamp keeps line ids unique when a fight id is reused (lab restarts).
  let fight_instance = 0
  events.on('fight/opened', () => {
    fight_instance += 1
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
  events.on('fight/input', ({ input }) => session.apply(input))
  events.on('fight/reset_turn', session.reset_turn)
  events.on('server/packet', ({ packet }) => {
    if (packet.type === 'packet/fight_state') {
      // the chain checkpoint: contract + player sources off the wire, spells from the local
      // seed catalog. normalize_checkpoint inside the core is the one decoder — the cast is
      // the boundary between the wire's raw JSON and the core's bigint-native shape.
      const checkpoint = {
        contract: packet.state.contract,
        sources: { players: packet.state.players, spells: catalog_spell_sources() },
      } as unknown as HydratedFightCheckpoint
      if (session.state()?.checkpoint.contract.id === packet.fight) dispatch({ type: 'fight/replaced', checkpoint })
      else dispatch({ type: 'fight/opened', mode: 'remote', state: checkpoint })
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
    // the close is decided HERE, on the observed state delta — never inside the `fight/input`
    // handler, where clearing the session would race the peer relay that reads the fight id
    // from the same state and leave nobody told about the forfeit
    if (state.fight !== previous.fight && fight_should_close(state.fight, state.session.wallet?.address ?? null)) {
      dispatch({ type: 'fight/closed' })
      return
    }
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
