// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { CONTRACT_CONSTANTS, create_character_source, create_fight } from '@aresrpg/fight'
import type { CharacterRow, FightStateRow } from '@aresrpg/protocol'

import { encode_cell, mask_from_cells } from '../../fight/src/combat_grid.ts'
import { create_fixture } from '../../fight/test/helpers.ts'
import {
  fight_checkpoint_id,
  gameplay_json,
  hydrate_gameplay_fight,
  type GameplayContext,
  type FightTurnPayload,
} from '../src/gameplay.ts'
import { actor_observation } from '../src/actor_observation.ts'
import { fight_planning } from '../src/fight_planning.ts'

const character_id = `0x${'2'.repeat(64)}`
const fight_id = `0x${'3'.repeat(64)}`
const cell = (x: number, y = 5) => encode_cell(BigInt(x), BigInt(y))
const fixture = (walls: bigint[] = [], caster = cell(5), target = cell(6)): GameplayContext => {
  const state = structuredClone(create_fixture().checkpoint)
  state.contract.id = fight_id
  const player = state.contract.fighters[0]!
  if (player.kind.type !== 'player') throw new Error('expected player')
  player.kind.character = character_id
  state.sources.players = {}
  state.sources.players[character_id] = create_character_source({ classe: 'yajin', level: 30n })
  state.contract.closed = mask_from_cells(walls)
  state.contract.board.shape_mask = mask_from_cells(
    Array.from({ length: Number(CONTRACT_CONSTANTS.grid_cells) }, (_, index) => BigInt(index))
  )
  state.contract.board.obstacles = walls
  state.contract.board.holes = []
  state.contract.round = 1n
  state.contract.queue = [0n, 1n]
  state.contract.turn_ptr = 0n
  state.contract.turn_started_ms = 1_000n
  state.contract.fighters[0]!.cell = caster
  state.contract.fighters[0]!.ap = 6n
  state.contract.fighters[0]!.mp = 3n
  state.contract.fighters[1]!.cell = target
  state.contract.fighters[1]!.hp = 1_000n
  const normalized = create_fight({ state, mode: 'remote' }).state()
  const row = JSON.parse(
    gameplay_json({ contract: normalized.contract, players: normalized.sources.players, kolizeum: null })
  ) as FightStateRow
  return {
    address: '0xa1',
    now: 4_000,
    freshness_ms: 5_000,
    command: { payload: {} } as GameplayContext['command'],
    snapshot: {
      ready: true,
      frozen: false,
      indexing_lag: 0,
      observed_at: 4_000,
      clock: { chain_ms: 4_000, observed_at: 4_000 },
      cursor: 0,
      observation_revision: 0,
      characters: [
        {
          id: character_id,
          custody: 'fight',
          equipment: [],
          jobs: {},
          active_fight: { id: fight_id, seat: 0 },
        } as unknown as CharacterRow,
      ],
      fights: { [fight_id]: row },
      zones: {},
      tracked_zones: {},
      fight_phases: {},
      events: [],
    },
  }
}
const plan = (context: GameplayContext, actions: FightTurnPayload['actions'] = []) =>
  fight_planning(context, {
    character_id,
    fight: fight_id,
    fighter_idx: '0',
    checkpoint_id: fight_checkpoint_id(context.snapshot.fights[fight_id]!),
    actions,
  })
const cast = (target = cell(6), spell = 'Tricky Blow'): FightTurnPayload['actions'][number] => ({
  type: 'cast',
  spell,
  target_cell: String(target),
})

test('discovers legal adjacent casts and reports real push collision events without changing the observation', () => {
  const context = fixture([cell(7)])
  const before = structuredClone(context)
  expect(plan(context).next_casts.find(({ spell }) => spell === 'Tricky Blow')?.target_cells).toContain(cell(6))
  const result = plan(context, [cast()])
  expect(result.error).toBeNull()
  expect(result.prediction).toBe(true)
  expect(result.events.some(({ type }) => type === 'push_collided')).toBe(true)
  expect(result.fighters[1]!.cell).toBe(cell(6))
  expect(result.fighters[1]!.hp).toBeLessThan(1_000n)
  expect(context).toEqual(before)
})

test('free push, body blocking and board edges use the same displacement resolver', () => {
  const free = plan(fixture(), [cast()])
  const movement = free.events.filter((event) => event.type === 'fighter_moved' && event.payload.mode === 'push')
  expect(movement.length).toBeGreaterThan(0)
  expect(free.events.some(({ type }) => type === 'push_collided')).toBe(false)
  expect(free.fighters[1]!.cell).toBe(cell(6) + BigInt(movement.length))
  const blocked = fixture()
  const row = blocked.snapshot.fights[fight_id]!
  const { contract } = hydrate_gameplay_fight(row)
  contract.fighters.push({ ...structuredClone(contract.fighters[1]!), cell: cell(7) })
  row.contract = JSON.parse(gameplay_json(contract))
  expect(plan(blocked, [cast()]).events.find(({ type }) => type === 'push_collided')).toBeDefined()
  expect(plan(blocked, [cast()]).fighters[1]!.cell).toBe(cell(6))
  const edge = plan(fixture([], cell(1), cell(0)), [cast(cell(0))])
  expect(edge.fighters[1]!.cell).toBe(cell(0))
  expect(edge.events.some(({ type }) => type === 'push_collided')).toBe(true)
  const partial = plan(fixture([cell(8)]), [cast()])
  expect(partial.fighters[1]!.cell).toBe(cell(7))
  expect(partial.events.some(({ type }) => type === 'push_collided')).toBe(true)
})

test('illegal casts report the engine reason and never offer continuation of an invalid prefix', () => {
  for (const [context, action, code] of [
    [fixture(), cast(cell(8)), 'out_of_range'],
    [fixture([cell(6)]), cast(), 'bad_target_cell'],
    [fixture(), cast(BigInt(CONTRACT_CONSTANTS.grid_cells)), 'bad_target_cell'],
    [fixture([cell(6)], cell(5), cell(8)), cast(cell(8), 'Deviousness'), 'no_line_of_sight'],
    [fixture(), cast(cell(6), 'unknown'), 'not_your_spell'],
    [fixture(), cast(cell(6), 'Tricky Trap'), 'bad_target_cell'],
    [fixture(), cast(cell(6, 6), 'Mass Trap'), 'not_in_line'],
  ] as const) {
    const result = plan(context, [action, cast()])
    expect(result.error).toMatchObject({ action_index: 0, code })
    expect(result.events).toEqual([])
    expect(result.next_casts).toEqual([])
  }
  const blocked = plan(fixture([cell(6)], cell(5), cell(8)))
  expect(blocked.next_casts.find(({ spell }) => spell === 'Deviousness')?.target_cells).not.toContain(cell(8))
  expect(plan(fixture([], cell(5), cell(8)), [cast(cell(8), 'Deviousness')]).error).toBeNull()
})

test('sequential AP, cast caps and cooldowns derive from the successful prefix', () => {
  const spent = plan(fixture(), [cast()])
  expect(spent.next_casts.find(({ spell }) => spell === 'Tricky Blow')?.target_cells).toEqual([])
  const rejected = plan(fixture(), [cast(), cast()])
  expect(rejected.error).toMatchObject({ action_index: 1, code: 'no_ap' })
  expect(rejected.fighters).toEqual(spent.fighters)
  expect(rejected.events).toEqual(spent.events)
  const trap = plan(fixture(), [cast(cell(4), 'Tricky Trap')])
  expect(trap.next_casts.find(({ spell }) => spell === 'Tricky Trap')?.target_cells).toEqual([])
  const invisible = plan(fixture(), [cast(cell(5), 'Invisibility')])
  expect(invisible.next_casts.find(({ spell }) => spell === 'Invisibility')?.target_cells).toEqual([])
})

test('movement prefixes change aim and blocked paths cannot masquerade as legal casts', () => {
  const context = fixture([], cell(4), cell(6))
  expect(plan(context).next_casts.find(({ spell }) => spell === 'Tricky Blow')?.target_cells).not.toContain(cell(6))
  const actions: FightTurnPayload['actions'] = [{ type: 'move', path: [String(cell(5))] }, cast()]
  expect(plan(context, actions).error).toBeNull()
  expect(plan(context, actions).events.some(({ type }) => type === 'fighter_moved')).toBe(true)
  expect(plan(fixture([cell(5)], cell(4), cell(6)), actions).error).toMatchObject({ action_index: 0, code: 'no_path' })
})

test('freshness, identity and current turn gate analysis; observations are JSON-safe predictions', () => {
  const context = fixture([cell(7)])
  expect(() => plan({ ...context, now: 20_000 })).toThrow('needs_resync')
  expect(() => plan({ ...context, address: '0xother' })).toThrow('fight_authority_mismatch')
  const payload = {
    character_id,
    fight: fight_id,
    fighter_idx: '0',
    checkpoint_id: fight_checkpoint_id(context.snapshot.fights[fight_id]!),
    actions: [cast()],
  }
  expect(() => fight_planning(context, { ...payload, checkpoint_id: 'stale' })).toThrow('needs_resync')
  const observed = actor_observation(
    { ...context, command: { ...context.command, payload: { fight_plan: payload } } },
    1
  )
  const wire = JSON.parse(JSON.stringify(observed))
  expect(wire.fight_plan.prediction).toBe(true)
  expect(wire.fight_plan.fighters[1].cell).toBe(String(cell(6)))
  expect(wire.fight_plan.grid.cells.find((entry: { cell: string }) => entry.cell === String(cell(7))).kind).toBe(
    'obstacle'
  )
  const row = context.snapshot.fights[fight_id]!
  row.contract = { ...hydrate_gameplay_fight(row).contract, turn_ptr: 1n }
  expect(() => plan(context)).toThrow('not_active_turn')
})
