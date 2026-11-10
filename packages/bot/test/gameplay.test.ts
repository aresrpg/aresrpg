// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { chain_now } from '@aresrpg/protocol/chain-clock'
import type { CharacterRow, FightStateRow } from '@aresrpg/protocol'

import { create_fight, fight_path_to, reachable_fight_cells } from '../../fight/src/index.ts'
import { create_fixture } from '../../fight/test/helpers.ts'
import { gameplay_observed_ms } from '../src/gameplay_context.ts'
import {
  GAMEPLAY_ACTIONS,
  execute_fight_turn,
  fight_checkpoint_id,
  gameplay_json,
  parse_fight_turn,
  validate_gameplay,
  type GameplayContext,
  type FightTurnPayload,
} from '../src/gameplay.ts'

const address = `0x${'1'.repeat(64)}`
const character_id = `0x${'2'.repeat(64)}`
const fight_id = `0x${'3'.repeat(64)}`
const fixture = (): GameplayContext => {
  const initial = create_fixture().checkpoint
  const first = initial.contract.fighters[0]!
  if (first.kind.type !== 'player') throw new Error('fixture needs player')
  const state = {
    ...initial,
    contract: {
      ...initial.contract,
      id: fight_id,
      fighters: [
        { ...first, kind: { ...first.kind, owner: address, character: character_id } },
        ...initial.contract.fighters.slice(1),
      ],
    },
    sources: { ...initial.sources, players: { [character_id]: initial.sources.players['0xc1']! } },
  }
  const local = create_fight({ state, mode: 'local', seed: 91n })
  const started = local.apply({ type: 'start', observed_ms: 60_000n })
  if (started.error) throw new Error(started.error.code)
  const row = JSON.parse(
    gameplay_json({ contract: started.state.contract, players: started.state.sources.players, kolizeum: null })
  ) as FightStateRow
  const seat = started.state.contract.queue[Number(started.state.contract.turn_ptr)]!
  const target = reachable_fight_cells(started.state, seat)[0]!
  const path = fight_path_to(started.state, seat, target)!
  const payload: FightTurnPayload = {
    character_id,
    fight: fight_id,
    fighter_idx: seat.toString(),
    checkpoint_id: fight_checkpoint_id(row),
    actions: [{ type: 'move', path: path.map(String) }],
  }
  return {
    address,
    now: 63_000,
    freshness_ms: 5_000,
    command: {
      id: 'command',
      grant_id: 'grant',
      bot_id: 'bot',
      lane_key: 'lane',
      fingerprint: 'fingerprint',
      kind: 'fight_turn',
      payload,
      decision_revision: 1,
      observation_revision: 7,
      status: 'accepted',
    },
    snapshot: {
      zones: {},
      tracked_zones: {},
      characters: [
        { id: character_id, custody: 'fight', active_fight: { id: fight_id, seat: Number(seat) } } as CharacterRow,
      ],
      fight_phases: {},
      fights: { [fight_id]: row },
      clock: { chain_ms: 63_000, observed_at: 63_000 },
      observed_at: 63_000,
      observation_revision: 7,
      ready: true,
      frozen: false,
      indexing_lag: 0,
      cursor: 7,
      events: [],
    },
  }
}
const change_payload = (context: GameplayContext, patch: Record<string, unknown>): GameplayContext => ({
  ...context,
  command: { ...context.command, payload: { ...context.command.payload, ...patch } },
})

test('canonical catalog exposes the complete bounded PvE lifecycle and strict nested turn schema', () => {
  expect(Object.keys(GAMEPLAY_ACTIONS)).toEqual([
    'equip_tool',
    'gather',
    'craft',
    'resolve_ambush',
    'raise_stats',
    'world_search',
    'fight_engage',
    'fight_place',
    'fight_ready',
    'fight_start',
    'fight_crank',
    'fight_turn',
    'fight_settle',
  ])
  expect(GAMEPLAY_ACTIONS.fight_turn.input_schema.additionalProperties).toBe(false)
  expect(GAMEPLAY_ACTIONS.fight_turn.input_schema.properties?.actions?.items?.oneOf).toHaveLength(3)
  expect<unknown>(GAMEPLAY_ACTIONS.fight_turn.parse(fixture().command.payload)).toEqual(fixture().command.payload)
})

test('refuses malformed, unknown, unsafe integer and action-local identity inputs', () => {
  const valid = fixture().command.payload
  for (const patch of [
    { owner: address },
    { fighter_idx: 0 },
    { fighter_idx: '00' },
    { fighter_idx: '-1' },
    { fighter_idx: '18446744073709551616' },
    { fight: '0x123' },
    { actions: null },
    { actions: [{ type: 'script', source: 'bad' }] },
    { actions: [{ type: 'move', path: ['1'], extra: true }] },
    { actions: [{ type: 'cast', spell: 'Compulsion', target_cell: '1', fighter_idx: '0' }] },
    { actions: [{ type: 'strike', target_cell: Number.MAX_SAFE_INTEGER + 1 }] },
    { actions: [{ type: 'move', path: ['1.1'] }] },
  ])
    expect(() => parse_fight_turn({ ...valid, ...patch })).toThrow()
})

test('refuses wrong character, seat, fight and checkpoint owner before SDK writes', async () => {
  const context = fixture()
  let writes = 0
  const actions = {
    commit_turn: async () => {
      writes += 1
      return { digest: 'unused', turn_witnesses: [] }
    },
  }
  for (const patch of [{ character_id: address }, { fighter_idx: '1' }, { fight: address }])
    await expect(execute_fight_turn(change_payload(context, patch), actions)).rejects.toThrow()
  await expect(execute_fight_turn({ ...context, address: character_id }, actions)).rejects.toThrow(
    'fight_authority_mismatch'
  )
  expect(writes).toBe(0)
})

test('refuses stale snapshot, checkpoint, clock, revision and disconnected/frozen state', () => {
  const context = fixture()
  const stale = { ...context.snapshot, observed_at: 58_000 }
  const bad_snapshots = [
    stale,
    { ...context.snapshot, ready: false },
    { ...context.snapshot, frozen: true },
    { ...context.snapshot, indexing_lag: 301 },
    { ...context.snapshot, clock: null },
    { ...context.snapshot, clock: { chain_ms: 63_000, observed_at: 58_000 } },
    { ...context.snapshot, clock: { chain_ms: 63_000.5, observed_at: 63_000 } },
    { ...context.snapshot, observation_revision: 8 },
    { ...context.snapshot, observed_at: 64_000 },
  ]
  for (const snapshot of bad_snapshots)
    expect(() => validate_gameplay({ ...context, snapshot })).toThrow('needs_resync')
  expect(() => validate_gameplay(change_payload(context, { checkpoint_id: 'older' }))).toThrow('needs_resync')
})

test('whole legal turn executes once through SDK-shaped injection, retains exact integers and receipt', async () => {
  const context = fixture()
  const calls: unknown[] = []
  const receipt = { digest: 'certified', turn_witnesses: [{ fighter: 1n, seed: 18446744073709551615n }] }
  const result = await execute_fight_turn(context, {
    commit_turn: async (input) => {
      calls.push(input)
      return receipt
    },
  })
  expect(calls).toEqual([{ fight: fight_id, actions: [{ type: 'move', path: [1n] }] }])
  expect(result).toBe(receipt)
  expect(JSON.parse(gameplay_json(result))).toEqual({
    digest: 'certified',
    turn_witnesses: [{ fighter: '1', seed: '18446744073709551615' }],
  })
})

test('canonical twin rejects illegal movement and too-early boundaries without writes', async () => {
  const context = fixture()
  let writes = 0
  const actions = {
    commit_turn: async () => {
      writes += 1
      return { digest: 'unused', turn_witnesses: [] }
    },
  }
  await expect(
    execute_fight_turn(
      change_payload(context, { actions: [{ type: 'move', path: ['18446744073709551615'] }] }),
      actions
    )
  ).rejects.toThrow('illegal_fight_action')
  await expect(
    execute_fight_turn(
      { ...context, snapshot: { ...context.snapshot, clock: { chain_ms: 60_000, observed_at: 63_000 } } },
      actions
    )
  ).rejects.toThrow('illegal_fight_turn:too_soon')
  expect(writes).toBe(0)
})

test('does not invent expiry of an owned turn when the canonical crank deadline passed', () => {
  const context = fixture()
  const plan = validate_gameplay({
    ...context,
    snapshot: { ...context.snapshot, clock: { chain_ms: 600_000, observed_at: 63_000 } },
  })
  expect(plan.kind).toBe('fight_turn')
  if (plan.kind !== 'fight_turn') throw new Error('expected turn')
  expect(plan.input.fight).toBe(fight_id)
})

test('bot freshness cannot extend the shared chain clock expiry', () => {
  const context = fixture()
  const snapshot = { ...context.snapshot, clock: { chain_ms: 63000, observed_at: context.now - 19900 } }
  expect(chain_now(snapshot.clock, context.now)).toBeNull()
  expect(() => gameplay_observed_ms({ ...context, snapshot, freshness_ms: 60000 })).toThrow('needs_resync')
  const boundary = { ...snapshot, clock: { ...snapshot.clock, observed_at: context.now - 15000 } }
  expect(gameplay_observed_ms({ ...context, snapshot: boundary, freshness_ms: 60000 })).toBe(
    BigInt(chain_now(boundary.clock, context.now)!)
  )
})
