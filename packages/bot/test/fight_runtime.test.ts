// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { create_fight, fight_turn_identity } from '@aresrpg/fight'
import type { FightStateRow } from '@aresrpg/protocol'
import { mix } from '@aresrpg/fight/prng'

import { create_fixture } from '../../fight/test/helpers.ts'
import {
  assert_fight_reconciled,
  replay_fight_receipt,
  retire_fight_replays,
  settled_fight_replays,
  type FightReplay,
} from '../src/fight_runtime.ts'
import { gameplay_json, hydrate_gameplay_fight } from '../src/gameplay.ts'
import { empty_lane, type Lane, type Command } from '../src/control.ts'

const fixture = () => {
  const local = create_fight({ state: create_fixture().checkpoint, mode: 'local', seed: 91n })
  local.apply({ type: 'start', observed_ms: 60000n })
  const checkpoint = local.state()
  const row = JSON.parse(
    gameplay_json({ contract: checkpoint.contract, players: checkpoint.sources.players, kolizeum: null })
  ) as FightStateRow
  const command = {
    kind: 'fight_turn',
    fight_baseline: row,
    payload: {
      character_id: '0x' + '1'.repeat(64),
      fight: '0x' + '2'.repeat(64),
      fighter_idx: '0',
      checkpoint_id: 'fixture',
      actions: [],
    },
  } as unknown as Command
  return { local, row, command }
}

test('receipt-fed shared session retains submitted-turn latch after serialization and unrelated metadata', () => {
  const { row, command } = fixture()
  const replay = replay_fight_receipt(command, { Transaction: { digest: 'test', events: [] } })!
  const restarted = JSON.parse(gameplay_json(replay)) as FightReplay
  expect(restarted.awaiting_witness).toBeTrue()
  expect(() => assert_fight_reconciled(restarted, row)).toThrow('fight_turn_already_submitted')
  expect(() => assert_fight_reconciled(restarted, { ...row, players: { ...row.players } })).toThrow(
    'fight_turn_already_submitted'
  )
})

test('certified TurnSeedUsed feeds the shared runtime, canonical continuation unlocks without a new version', () => {
  const { local, row, command } = fixture()
  const seed = (mix(91n, 2n) << 32n) | mix(91n, 3n)
  const replay = replay_fight_receipt(command, {
    Transaction: {
      digest: 'test',
      events: [{ type: '0x1::fight::TurnSeedUsed', json: { seat: '1', seed: String(seed) } }],
    },
  })!
  expect(() => assert_fight_reconciled(replay, row)).toThrow('fight_turn_already_submitted')
  const next = local.simulate_turn({ observed_ms: 63000n })
  expect(next.error).toBeNull()
  const canonical = JSON.parse(gameplay_json({ ...row, contract: next.state.contract })) as FightStateRow
  expect(fight_turn_identity(hydrate_gameplay_fight(canonical).contract)).not.toBe(replay.submitted_turn)
  expect(() => assert_fight_reconciled(JSON.parse(gameplay_json(replay)), canonical)).not.toThrow()
})

test('retirement requires settled custody evidence, complete exit and no pending envelope after restart', () => {
  const { command, row } = fixture()
  const player = hydrate_gameplay_fight(row).contract.fighters.find(({ kind }) => kind.type === 'player')!
  if (player.kind.type !== 'player') throw new Error('fixture player missing')
  const fight = String(command.payload.fight)
  const receipt = { Transaction: { digest: 'test', events: [] } }
  const replay = replay_fight_receipt(command, receipt)!
  const lane: Lane = {
    ...empty_lane({ address: player.kind.owner, network: 'mainnet' }),
    fight_replays: { [fight]: replay },
  }
  // An old empty row alone cannot erase a certified turn latch.
  expect(retire_fight_replays(lane, [])).toBe(lane)
  const settle = {
    ...command,
    kind: 'fight_settle',
    payload: { ...command.payload, character_id: player.kind.character },
  } as Command
  expect(settled_fight_replays(lane, settle, receipt, false)).toBe(lane.fight_replays)
  const completed = JSON.parse(
    gameplay_json({ ...lane, fight_replays: settled_fight_replays(lane, settle, receipt, true) })
  ) as Lane
  const active = [
    { id: player.kind.character, active_fight: { id: fight, seat: 0 } },
  ] as import('@aresrpg/protocol').CharacterRow[]
  expect(retire_fight_replays(completed, active)).toBe(completed)
  const pending = { ...completed, pending: { command_id: 'uncertain' } } as Lane
  expect(retire_fight_replays(pending, [])).toBe(pending)
  expect(retire_fight_replays(completed, []).fight_replays).toEqual({})
  expect(completed.fight_replays?.[fight]).toBeDefined()
})
