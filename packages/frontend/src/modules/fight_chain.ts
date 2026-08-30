// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Remote turn commit: movement/casts are local deterministic drafts relayed through the server;
// End Turn submits their ordered batch as one atomic PTB and owns the only rollback boundary.
// Its receipt seeds presentation immediately; the streamed checkpoint remains authoritative.

import { type FightInput, type HydratedFightCheckpoint } from '@aresrpg/fight'
import { CONTRACT_CONSTANTS } from '@aresrpg/fight/move_contract'
import type { AuthSession, FightActions, KolizeumActions } from '@aresrpg/sdk/auth'

import type { AppModule, AppState } from '../store.ts'
import { toast } from '../toast.ts'

import { fight_environment } from './fight.ts'
import { owned_placement_readiness } from './fight_identity.ts'
import { END_TURN_SUBMIT_GUARD_MS, fight_turn_identity } from './fight_lifecycle.ts'

type TurnAction = Parameters<FightActions['commit_turn']>[0]['actions'][number]
type BufferedTurn = Readonly<{ fight: string; turn: string; actions: readonly TurnAction[] }>
type FightTransactionReceipt = Readonly<{
  digest: string
  turn_witnesses?: readonly Readonly<{ fighter: bigint; seed: bigint }>[]
  started?: boolean
}>

const manager_id = (manager: Readonly<{ id: string }> | undefined): string | null => manager?.id ?? null

const checkpoint_for = (state: Readonly<AppState>, fight: string): HydratedFightCheckpoint | null =>
  state.fight.cached[fight] ?? (state.fight.checkpoint?.contract.id === fight ? state.fight.checkpoint : null)

const remote_input_context = (state: Readonly<AppState>, fight: string | null, origin: 'local' | 'streamed') => {
  const { wallet } = state.session
  if (origin !== 'local' || !fight || state.fight.mode !== 'remote' || !wallet) return null
  const checkpoint = checkpoint_for(state, fight)
  return checkpoint ? Object.freeze({ fight, wallet, checkpoint }) : null
}

const ready_all_context = (state: Readonly<AppState>, fight: string) => {
  const { wallet } = state.session
  const checkpoint = checkpoint_for(state, fight)
  if (
    !wallet ||
    state.fight.mode !== 'remote' ||
    !checkpoint ||
    checkpoint.contract.round !== 0n ||
    checkpoint.contract.wagered
  )
    return null
  return Object.freeze({ wallet, checkpoint })
}

export const queued_end_turn = (
  state: Parameters<NonNullable<AppModule['reduce']>>[0],
  fight: string,
  now_ms: number
): Readonly<{ fighter: bigint; delay_ms: number }> | null => {
  const environment = state.fight.environments[fight]
  const checkpoint = state.fight.cached[fight]
  if (
    !environment?.end_turn_queued ||
    environment.end_turn_submitted ||
    environment.transaction_pending ||
    environment.canonical_ended ||
    !checkpoint ||
    checkpoint.contract.round === 0n
  )
    return null
  const fighter = checkpoint.contract.queue[Number(checkpoint.contract.turn_ptr)]
  const row = fighter === undefined ? null : checkpoint.contract.fighters[Number(fighter)]
  const character = row?.kind.type === 'player' ? row.kind : null
  const owned =
    character !== null &&
    character.owner === state.session.wallet?.address &&
    state.session.characters.some(({ id }) => id === character.character)
  if (!owned || fighter === undefined) return null
  const ready_at =
    Number(checkpoint.contract.turn_started_ms) + Number(CONTRACT_CONSTANTS.turn_min_ms) + END_TURN_SUBMIT_GUARD_MS
  return Object.freeze({ fighter, delay_ms: Math.max(0, ready_at - now_ms) })
}

export const turn_too_soon_refusal = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)
  const refused_before_submission =
    message.includes('transaction NOT submitted') || /transaction resolution failed/i.test(message)
  return refused_before_submission && /abort code:\s*1724/i.test(message)
}

export const end_turn_retry_delay_ms = (chain_delay_ms: number, retry_not_before_ms: number, now_ms: number): number =>
  Math.max(chain_delay_ms, Math.max(0, retry_not_before_ms - now_ms))

const turn_action = (input: Readonly<FightInput>): TurnAction | null => {
  if (input.type === 'move_to') return Object.freeze({ type: 'move', path: Object.freeze([...input.path]) })
  if (input.type === 'cast_spell')
    return Object.freeze({
      type: 'cast',
      fighter_idx: input.fighter,
      spell: input.spell,
      target_cell: input.target_cell,
    })
  if (input.type === 'weapon_strike')
    return Object.freeze({ type: 'strike', fighter_idx: input.fighter, target_cell: input.target_cell })
  return null
}

const immediate_transaction = (
  fight: string,
  input: Readonly<FightInput>,
  actions: Readonly<FightActions>,
  checkpoint: Readonly<HydratedFightCheckpoint>,
  custody: Readonly<{ kiosk: string; kiosk_cap?: string }> | undefined
): Promise<FightTransactionReceipt> | null => {
  switch (input.type) {
    case 'place':
      return actions.place({ fight, fighter_idx: input.fighter, cell: input.cell })
    case 'ready':
      return actions.ready({ fight, fighter_idx: input.fighter })
    case 'start':
      return actions.start({ fight })
    case 'crank':
      return actions.crank({ fight })
    case 'forfeit':
      return actions.forfeit({ fight, fighter_idx: input.fighter, custody })
    default:
      return null
  }
}

const kolizeum_transaction = (
  kolizeum: string,
  fight: string,
  input: Readonly<FightInput>,
  actions: Readonly<KolizeumActions>,
  fight_actions: Readonly<FightActions>,
  checkpoint: Readonly<HydratedFightCheckpoint>,
  custody: Readonly<{ kiosk: string; kiosk_cap?: string }> | undefined
): Promise<FightTransactionReceipt> | null => {
  switch (input.type) {
    case 'ready':
      return actions.ready({
        kolizeum,
        fight,
        fighter_idx: input.fighter,
      })
    case 'start':
      return actions.start({ kolizeum, fight })
    case 'forfeit':
      return checkpoint.contract.round === 0n
        ? actions.exit({ kolizeum, fight, fighter_idx: input.fighter, custody })
        : actions.forfeit({ fight, fighter_idx: input.fighter, custody })
    default:
      return immediate_transaction(fight, input, fight_actions, checkpoint, custody)
  }
}

const remote_transaction = ({
  fight,
  input,
  wallet,
  checkpoint,
  custody,
  turn_actions,
  kolizeum,
}: Readonly<{
  fight: string
  input: FightInput
  wallet: Pick<AuthSession, 'fight' | 'dungeon' | 'kolizeum'>
  checkpoint: HydratedFightCheckpoint
  custody: Readonly<{ kiosk: string; kiosk_cap?: string }> | undefined
  turn_actions: readonly TurnAction[]
  kolizeum: string | null
}>): Promise<FightTransactionReceipt> | null => {
  if (input.type === 'end_turn')
    return wallet.fight.commit_turn({ fight, actions: turn_actions, ended: checkpoint.contract.ended })
  if (kolizeum) return kolizeum_transaction(kolizeum, fight, input, wallet.kolizeum, wallet.fight, checkpoint, custody)
  if (input.type === 'forfeit' && checkpoint.contract.dungeon !== null)
    return wallet.dungeon.give_up_fight({ fight, fighter_idx: input.fighter, custody })
  return checkpoint.contract.wagered ? null : immediate_transaction(fight, input, wallet.fight, checkpoint, custody)
}

const observe: NonNullable<AppModule['observe']> = ({ events, dispatch, get_state, signal }) => {
  const confirmed = new Map<string, HydratedFightCheckpoint>()
  const buffered = new Map<string, BufferedTurn>()
  const in_flight = new Set<string>()
  const queued_timers = new Map<string, ReturnType<typeof setTimeout>>()
  const retry_not_before = new Map<string, number>()
  const clear_buffer = (fight?: string): void => {
    if (fight) buffered.delete(fight)
    else buffered.clear()
  }
  const clear_queued_timer = (fight: string): void => {
    const timer = queued_timers.get(fight)
    if (timer) clearTimeout(timer)
    queued_timers.delete(fight)
  }
  const schedule_queued_turn = (fight: string): void => {
    clear_queued_timer(fight)
    const now = Date.now()
    const queued = queued_end_turn(get_state(), fight, now)
    if (!queued) return
    const delay_ms = end_turn_retry_delay_ms(queued.delay_ms, retry_not_before.get(fight) ?? 0, now)
    if (delay_ms > 0) {
      queued_timers.set(
        fight,
        setTimeout(() => schedule_queued_turn(fight), delay_ms)
      )
      return
    }
    retry_not_before.delete(fight)
    dispatch({
      type: 'fight/input',
      fight,
      origin: 'local',
      input: { type: 'end_turn', fighter: queued.fighter, observed_ms: BigInt(Date.now()) },
    })
    dispatch({ type: 'fight/end_turn_queued', fight, queued: false })
  }

  const submit_readiness = (
    fight: string,
    checkpoint: Readonly<HydratedFightCheckpoint>,
    transaction: Promise<FightTransactionReceipt>,
    on_failure?: () => void
  ): void => {
    if (!confirmed.has(fight)) confirmed.set(fight, checkpoint)
    in_flight.add(fight)
    dispatch({ type: 'fight/transaction_pending', fight, pending: true })
    void transaction
      .then(({ turn_witnesses = [], started = false }) => {
        if (started)
          dispatch({
            type: 'fight/runtime_input',
            fight,
            input: { type: 'start', observed_ms: BigInt(Date.now()) },
          })
        turn_witnesses.forEach(({ fighter, seed }) =>
          dispatch({ type: 'fight/runtime_input', fight, input: { type: 'turn_seed', fighter, seed } })
        )
        const current = get_state().fight.cached[fight]
        if (current) confirmed.set(fight, current)
      })
      .catch((error: unknown) => {
        const rollback = confirmed.get(fight)
        if (rollback) dispatch({ type: 'fight/restored', checkpoint: rollback })
        on_failure?.()
        toast.add(error)
      })
      .finally(() => {
        in_flight.delete(fight)
        dispatch({ type: 'fight/transaction_pending', fight, pending: false })
      })
  }

  events.on('server/packet', ({ packet }) => {
    if (packet.type !== 'packet/fight_state') return
    const current = get_state().fight.cached[packet.fight]
    if (!current) return
    confirmed.set(packet.fight, current)
    // Any full checkpoint replaces the runtime that authored this local draft. Keeping its
    // paths would compose the next action from a different starting cell (spectator refresh →
    // command two abort 1725), so authoritative replacement always invalidates the draft.
    if (buffered.has(packet.fight)) clear_buffer(packet.fight)
  })
  events.on('fight/reset_turn', ({ fight }) => {
    if (fight) clear_buffer(fight)
  })
  events.on('fight/restored', ({ checkpoint }) => clear_buffer(checkpoint.contract.id))
  events.on('fight/closed', ({ fight }) => {
    if (fight) {
      clear_buffer(fight)
      clear_queued_timer(fight)
      retry_not_before.delete(fight)
    }
  })

  events.on('STATE_UPDATED', (state, previous) => {
    if (state.fight.environments === previous.fight.environments) return
    new Set([...Object.keys(previous.fight.environments), ...Object.keys(state.fight.environments)]).forEach(
      schedule_queued_turn
    )
  })
  signal.addEventListener('abort', () => queued_timers.forEach(clearTimeout))

  events.on('fight/ready_all', ({ fight, fighters }) => {
    const state = get_state()
    const context = ready_all_context(state, fight)
    const environment = fight_environment(state.fight, fight)
    if (!context || environment.transaction_pending || in_flight.has(fight)) return
    const { wallet, checkpoint } = context
    const requested = new Set(fighters.map(String))
    const roster = new Set(state.session.characters.map(({ id }) => id))
    const readiness = owned_placement_readiness(checkpoint, wallet.address, roster)
    const eligible = readiness.unready_seats.filter((seat) => requested.has(String(seat)))
    if (eligible.length === 0) return
    let completed = 0
    const total = eligible.length
    const transaction = wallet.fight.ready_many({
      fight,
      fighter_indices: eligible,
      on_progress: (progress) => {
        completed = progress.started ? progress.total : progress.completed
        dispatch({
          type: 'fight/ready_all_progress',
          fight,
          completed,
          total: progress.total,
          status: progress.started || progress.completed === progress.total ? 'complete' : 'running',
          fighter: progress.fighter_idx,
        })
      },
    })
    submit_readiness(fight, checkpoint, transaction, () =>
      dispatch({ type: 'fight/ready_all_progress', fight, completed, total, status: 'failed' })
    )
  })

  events.on('fight/input', ({ fight, input, origin }) => {
    const state = get_state()
    const context = remote_input_context(state, fight, origin)
    if (!context) return
    const { fight: fight_id, wallet, checkpoint } = context
    if (fight_environment(state.fight, fight_id).transaction_pending || in_flight.has(fight_id)) return
    const action = turn_action(input)
    if (action) {
      const draft = buffered.get(fight_id)
      const turn = fight_turn_identity(checkpoint.contract)
      const same_turn = draft?.turn === turn
      buffered.set(
        fight_id,
        Object.freeze({
          fight: fight_id,
          turn,
          actions: Object.freeze([...(same_turn ? draft.actions : []), action]),
        })
      )
      return
    }

    const fighter = 'fighter' in input ? checkpoint.contract.fighters[Number(input.fighter)] : null
    const character_id = fighter?.kind.type === 'player' ? fighter.kind.character : null
    const row = state.session.characters.find(({ id }) => id === character_id)
    const custody = row ? { kiosk: row.kiosk, kiosk_cap: row.kiosk_cap } : undefined
    const kolizeum = manager_id(state.fight.kolizeum_by_fight[fight_id])
    const transaction = remote_transaction({
      fight: fight_id,
      input,
      wallet,
      checkpoint,
      custody,
      turn_actions: Object.freeze([...(buffered.get(fight_id)?.actions ?? [])]),
      kolizeum,
    })
    if (!transaction) return
    if (input.type === 'ready') {
      submit_readiness(fight_id, checkpoint, transaction)
      return
    }
    const submitted_buffer = input.type === 'end_turn' ? (buffered.get(fight_id) ?? null) : null
    if (input.type === 'forfeit') clear_buffer(fight_id)
    if (!confirmed.has(fight_id)) confirmed.set(fight_id, checkpoint)
    in_flight.add(fight_id)
    dispatch({ type: 'fight/transaction_pending', fight: fight_id, pending: true })
    let queue_after_refusal = false
    void transaction
      .then(({ turn_witnesses = [] }) => {
        retry_not_before.delete(fight_id)
        if (input.type === 'end_turn') clear_buffer(fight_id)
        turn_witnesses.forEach(({ fighter, seed }) =>
          dispatch({ type: 'fight/runtime_input', fight: fight_id, input: { type: 'turn_seed', fighter, seed } })
        )
        const current = get_state().fight.cached[fight_id]
        if (current) confirmed.set(fight_id, current)
      })
      .catch((error: unknown) => {
        if (input.type === 'end_turn' && turn_too_soon_refusal(error)) {
          // Nothing executed: cancel only the pending boundary, retaining movement/casts so
          // the same draft can retry after a bounded backoff despite client clock skew.
          dispatch({ type: 'fight/cancel_pending_turn', fight: fight_id })
          retry_not_before.set(fight_id, Date.now() + END_TURN_SUBMIT_GUARD_MS)
          queue_after_refusal = true
          return
        }
        retry_not_before.delete(fight_id)
        if (input.type === 'end_turn') clear_buffer(fight_id)
        const rollback = confirmed.get(fight_id)
        if (rollback) dispatch({ type: 'fight/restored', checkpoint: rollback })
        if (submitted_buffer?.actions.length) dispatch({ type: 'fight/resync', fight: fight_id })
        toast.add(error)
      })
      .finally(() => {
        in_flight.delete(fight_id)
        dispatch({ type: 'fight/transaction_pending', fight: fight_id, pending: false })
        if (queue_after_refusal) dispatch({ type: 'fight/end_turn_queued', fight: fight_id, queued: true })
      })
  })
}

export default Object.freeze({ name: 'fight_chain', reduce: (state) => state, observe }) satisfies AppModule
