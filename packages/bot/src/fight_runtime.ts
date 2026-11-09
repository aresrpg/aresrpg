// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  create_fight_session,
  fight_turn_identity,
  same_fight_turn,
  end_turn_submission_after_reconcile,
} from '@aresrpg/fight'
import type { FightStateRow, CharacterRow } from '@aresrpg/protocol'
import { project_fight_boundary_receipt } from '@aresrpg/sdk/fight'
import type { Receipt } from '@aresrpg/sdk/transaction-execution'

import { hydrate_gameplay_fight, parse_fight_turn, gameplay_json, type FightTurnPayload } from './gameplay.ts'
import type { Command, Lane } from './control.ts'

/** Durable adapter state for the same session and submitted-turn latch used by the client. */
export type FightReplay = Readonly<{
  settled_characters?: readonly string[]
  row: FightStateRow
  submitted_turn: string
  awaiting_witness: boolean
}>
export const replay_fight_receipt = (command: Command, receipt: Receipt): FightReplay | null => {
  if (command.kind !== 'fight_turn' || !command.fight_baseline) return null
  const payload = parse_fight_turn(command.payload)
  const checkpoint = hydrate_gameplay_fight(command.fight_baseline)
  const session = create_fight_session({ now: () => checkpoint.contract.turn_started_ms, reconcile: () => {} })
  session.open({ mode: 'remote', state: checkpoint })
  const fighter = BigInt(payload.fighter_idx)
  const apply = (input: Parameters<typeof session.apply>[0]) => {
    session.apply(input)
    if (session.state()?.error) throw new Error('fight_receipt_replay_failed:' + session.state()!.error!.code)
  }
  for (const action of payload.actions) apply(replay_input(action, fighter))
  if (!session.state()!.checkpoint.contract.ended) apply({ type: 'end_turn', fighter })
  for (const { fighter, seed } of project_fight_boundary_receipt(receipt).turn_witnesses ?? [])
    apply({ type: 'turn_seed', fighter, seed })
  const result = session.state()!
  return {
    row: JSON.parse(gameplay_json({ ...command.fight_baseline, contract: result.checkpoint.contract })),
    submitted_turn: fight_turn_identity(checkpoint.contract),
    awaiting_witness: result.awaiting_turn_witness,
  }
}

/** An unrelated packet cannot release the client's end-turn submission latch. */
export const assert_fight_reconciled = (replay: FightReplay | undefined, row: FightStateRow) => {
  if (!replay) return
  const current = hydrate_gameplay_fight(row).contract
  const confirmed = hydrate_gameplay_fight(replay.row).contract
  const submitted = fight_turn_identity(current) === replay.submitted_turn
  if (end_turn_submission_after_reconcile({ end_turn_submitted: true }, submitted, current.ended))
    throw new Error('fight_turn_already_submitted')
  // The receipt may already have replayed further than a delayed canonical snapshot.
  if (
    [
      current.round < confirmed.round,
      current.round === confirmed.round && current.turn_ptr < confirmed.turn_ptr,
      current.turn_started_ms < confirmed.turn_started_ms,
    ].some(Boolean)
  )
    throw new Error('needs_fight_reconciliation')
  if (same_fight_turn(current, confirmed) && replay.awaiting_witness) throw new Error('needs_fight_reconciliation')
}

const replay_input = (
  action: FightTurnPayload['actions'][number],
  fighter: bigint
): Parameters<ReturnType<typeof create_fight_session>['apply']>[0] => {
  if (action.type === 'move') return { type: 'move_to', fighter, path: action.path.map(BigInt) }
  if (action.type === 'cast')
    return { type: 'cast_spell', fighter, spell: action.spell, target_cell: BigInt(action.target_cell) }
  return { type: 'weapon_strike', fighter, target_cell: BigInt(action.target_cell) }
}

/** Settlement receipts, not an old empty character row, prove custody has left this fight. */
export const settled_fight_replays = (lane: Lane, command: Command, receipt: Receipt, completed: boolean) => {
  if (!completed) return lane.fight_replays
  const replay = replay_fight_receipt(command, receipt)
  const fight = String(command.payload.fight)
  if (replay)
    return {
      ...lane.fight_replays,
      [fight]: { ...replay, settled_characters: lane.fight_replays?.[fight]?.settled_characters },
    }
  const previous = lane.fight_replays?.[fight]
  if (command.kind !== 'fight_settle' || !previous) return lane.fight_replays
  return { ...lane.fight_replays, [fight]: record_settlement(previous, String(command.payload.character_id)) }
}

export const retire_fight_replays = (lane: Lane, characters: readonly CharacterRow[]): Lane => {
  if (lane.pending || !lane.fight_replays) return lane
  const active = new Set(characters.flatMap(({ active_fight }) => (active_fight ? [active_fight.id] : [])))
  const kept = Object.entries(lane.fight_replays).filter(
    ([fight, replay]) => active.has(fight) || !custody_settled(replay, lane.address)
  )
  return kept.length === Object.keys(lane.fight_replays).length
    ? lane
    : { ...lane, fight_replays: Object.fromEntries(kept) }
}

const custody_settled = (replay: FightReplay, address: string): boolean => {
  const owned = hydrate_gameplay_fight(replay.row).contract.fighters.flatMap(({ kind }) =>
    kind.type === 'player' && kind.owner === address ? [kind.character] : []
  )
  return owned.length > 0 && owned.every((id) => replay.settled_characters?.includes(id))
}

const record_settlement = (previous: FightReplay, character: string): FightReplay => ({
  ...previous,
  settled_characters: [...new Set([...(previous.settled_characters ?? []), character])],
})
