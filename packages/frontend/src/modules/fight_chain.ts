// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Remote turn commit: movement/casts are local deterministic drafts relayed through the server;
// End Turn submits their ordered batch as one atomic PTB and owns the only rollback boundary.
// Its receipt seeds presentation immediately; the streamed checkpoint remains authoritative.

import { players_ready_after, type FightInput, type HydratedFightCheckpoint } from '@aresrpg/fight'
import type { FightActions } from '@aresrpg/sdk/auth'

import type { AppModule } from '../store.ts'
import { toast } from '../toast.ts'

type TurnAction = Parameters<FightActions['commit_turn']>[0]['actions'][number]
type BufferedTurn = Readonly<{ fight: string; started_ms: bigint; actions: readonly TurnAction[] }>
type FightTransactionReceipt = Readonly<{
  digest: string
  turn_witnesses?: readonly Readonly<{ fighter: bigint; seed: bigint }>[]
}>

export const turn_too_soon_refusal = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)
  const refused_before_submission =
    message.includes('transaction NOT submitted') || /transaction resolution failed/i.test(message)
  return refused_before_submission && /abort code:\s*1724/i.test(message)
}

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
      return actions.ready({
        fight,
        fighter_idx: input.fighter,
        and_start: players_ready_after(checkpoint.contract.fighters, input.fighter),
      })
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

const observe: NonNullable<AppModule['observe']> = ({ events, dispatch, get_state }) => {
  let confirmed: HydratedFightCheckpoint | null = null
  let buffered: BufferedTurn | null = null
  const clear_buffer = (): void => {
    buffered = null
  }

  events.on('server/packet', ({ packet }) => {
    if (packet.type !== 'packet/fight_state') return
    const current = get_state().fight.checkpoint
    if (current?.contract.id !== packet.fight) return
    confirmed = current
    if (buffered && (buffered.fight !== packet.fight || buffered.started_ms !== current.contract.turn_started_ms))
      clear_buffer()
  })
  events.on('fight/reset_turn', clear_buffer)
  events.on('fight/restored', clear_buffer)
  events.on('fight/closed', clear_buffer)

  events.on('fight/input', ({ input, origin }) => {
    const state = get_state()
    const { wallet } = state.session
    if (
      origin !== 'local' ||
      state.fight.mode !== 'remote' ||
      state.fight.transaction_pending ||
      !state.fight.checkpoint ||
      !wallet
    )
      return
    const { checkpoint } = state.fight
    const fight = checkpoint.contract.id
    const action = turn_action(input)
    if (action) {
      const same_turn = buffered?.fight === fight && buffered.started_ms === checkpoint.contract.turn_started_ms
      buffered = Object.freeze({
        fight,
        started_ms: checkpoint.contract.turn_started_ms,
        actions: Object.freeze([...(same_turn ? buffered!.actions : []), action]),
      })
      return
    }

    const row = state.session.characters.find(({ id }) => id === state.session.selected_character_id)
    const custody = row ? { kiosk: row.kiosk, kiosk_cap: row.kiosk_cap } : undefined
    const transaction: Promise<FightTransactionReceipt> | null =
      input.type === 'end_turn'
        ? wallet.fight.commit_turn({
            fight,
            actions: Object.freeze([...(buffered?.fight === fight ? buffered.actions : [])]),
            ended: checkpoint.contract.ended,
          })
        : input.type === 'forfeit' && checkpoint.contract.dungeon !== null
          ? wallet.dungeon.give_up_fight({ fight, fighter_idx: input.fighter, custody })
          : immediate_transaction(fight, input, wallet.fight, checkpoint, custody)
    if (!transaction) return
    const submitted_buffer = input.type === 'end_turn' ? buffered : null
    if (input.type === 'forfeit') clear_buffer()
    confirmed ??= checkpoint
    dispatch({ type: 'fight/transaction_pending', fight, pending: true })
    let queue_after_refusal = false
    void transaction
      .then(({ turn_witnesses = [] }) => {
        if (input.type === 'end_turn') clear_buffer()
        turn_witnesses.forEach(({ fighter, seed }) =>
          dispatch({ type: 'fight/input', origin: 'streamed', input: { type: 'turn_seed', fighter, seed } })
        )
        const current = get_state().fight.checkpoint
        if (current?.contract.id === fight) confirmed = current
      })
      .catch((error: unknown) => {
        if (input.type === 'end_turn' && turn_too_soon_refusal(error)) {
          buffered = submitted_buffer
          queue_after_refusal = true
          return
        }
        if (input.type === 'end_turn') clear_buffer()
        if (confirmed?.contract.id === fight) dispatch({ type: 'fight/restored', checkpoint: confirmed })
        toast.add(error)
      })
      .finally(() => {
        dispatch({ type: 'fight/transaction_pending', fight, pending: false })
        if (queue_after_refusal) dispatch({ type: 'fight/end_turn_queued', fight, queued: true })
      })
  })
}

export default Object.freeze({ name: 'fight_chain', reduce: (state) => state, observe }) satisfies AppModule
