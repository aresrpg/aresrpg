// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { CONTRACT_CONSTANTS, create_character_source, create_fight } from '@aresrpg/fight'

import spells from '../../../seed/content/spells.json'
import { encode_cell, mask_from_cells } from '../../fight/src/combat_grid.ts'
import { plan_combat_turn } from '../src/combat_tactics.ts'
import { parse_combat_profile, type CombatProfile } from '../src/combat_profile.ts'
import { next_behavior_action } from '../src/behavior_plan.ts'
import { parse_behavior_script, type BehaviorRun } from '../src/behavior_script.ts'
import { empty_behavior_memory } from '../src/behavior_tree.ts'
import { fight_turn_inputs, type FightTurnPayload } from '../src/gameplay.ts'

import { character_id, combat_fixture, placement } from './helpers/combat_runtime_fixture.ts'

const cell = (x: number, y = 5) => encode_cell(BigInt(x), BigInt(y))
const checkpoint = (walls = [cell(8)]) => {
  const state = placement()
  state.sources.players[character_id] = create_character_source({ classe: 'yajin', level: 30n })
  state.sources.spells = Object.fromEntries(spells.map(({ name, ...spell }) => [name, spell])) as never
  state.contract.closed = mask_from_cells(walls)
  state.contract.board.shape_mask = mask_from_cells(
    Array.from({ length: Number(CONTRACT_CONSTANTS.grid_cells) }, (_, index) => BigInt(index))
  )
  state.contract.board.obstacles = walls
  state.contract.board.holes = []
  state.contract.round = 1n
  state.contract.queue = [0n, 1n, 2n]
  state.contract.turn_ptr = 0n
  state.contract.turn_started_ms = 60_000n
  Object.assign(state.contract.fighters[0]!, { cell: cell(5), ap: 8n, mp: 3n })
  Object.assign(state.contract.fighters[1]!, { cell: cell(4), hp: 1_000n })
  state.contract.fighters.push({ ...structuredClone(state.contract.fighters[1]!), cell: cell(6) })
  return create_fight({ state, mode: 'remote' }).state()
}
const profile = (): CombatProfile =>
  parse_combat_profile({
    version: '1',
    intent: 'Push for damage, then hit the displaced enemy.',
    combos: [
      {
        name: 'attack',
        steps: [
          { type: 'cast', spell: 'Tricky Blow', target: 'highest_damage_enemy' },
          { type: 'cast', spell: 'Deviousness', target: 'lowest_hp_enemy' },
        ],
      },
    ],
    rules: [{ when: { type: 'always' }, combo: 'attack' }],
    fallback: 'awaiting_ai',
  })
const replay = (state: ReturnType<typeof checkpoint>, actions: FightTurnPayload['actions']) => {
  const runtime = create_fight({ state, mode: 'remote' })
  return fight_turn_inputs({ fighter_idx: '0', actions } as FightTurnPayload).flatMap((action) => {
    const result = runtime.apply({ ...action, observed_ms: 63_000n })
    expect(result.error).toBeNull()
    return result.events
  })
}

test('autonomous damage targeting chooses wall collision over equal-range free push and chains displaced state', () => {
  const state = checkpoint()
  const before = structuredClone(state)
  const planned = plan_combat_turn(profile(), state, 0n, 63_000n)
  expect(planned.actions).toEqual([
    { type: 'cast', spell: 'Tricky Blow', target_cell: String(cell(6)) },
    { type: 'cast', spell: 'Deviousness', target_cell: String(cell(7)) },
  ])
  const events = replay(state, planned.actions)
  expect(events.some(({ type }) => type === 'push_collided')).toBe(true)
  expect(plan_combat_turn(profile(), state, 0n, 63_000n)).toEqual(planned)
  expect(state).toEqual(before)
  const free = plan_combat_turn(profile(), checkpoint([]), 0n, 63_000n)
  expect(free.actions[0]).toMatchObject({ target_cell: String(cell(4)) })
})

test('damage targeting scores actual HP loss rather than overkill and keeps normal no-action fallback', () => {
  const state = checkpoint()
  state.contract.fighters[2]!.hp = 1n
  expect(plan_combat_turn(profile(), state, 0n, 63_000n).actions[0]).toMatchObject({ target_cell: String(cell(4)) })
  state.contract.fighters[0]!.ap = 0n
  expect(plan_combat_turn(profile(), state, 0n, 63_000n)).toMatchObject({ actions: [], issue: 'no_legal_tactic' })
})

test('accepted behavior combat sequences select and validate collision-aware ordinary turn actions', async () => {
  for (const [state, tactics] of [
    [checkpoint(), profile()],
    [positioning_checkpoint(), positioned_profile()],
  ] as const) {
    const f = await combat_fixture(state)
    const script = parse_behavior_script({
      version: '1',
      objective: { title: 'Wall-aware combat' },
      tree: { type: 'action', action: { type: 'combat', profiles: [{ character_id, profile: tactics }] } },
    })
    const run: BehaviorRun = {
      ...(await f.get_run()),
      script,
      revision: 1,
      memory: empty_behavior_memory(),
      pending_node: null,
      activation: null,
      consumed_command_id: null,
    }
    const next = next_behavior_action(run, null, f.context)
    expect(next.state).toBe('action')
    expect(next.action?.kind).toBe('fight_turn')
    expect(next.action?.payload.actions).toEqual(plan_combat_turn(tactics, state, 0n, 63_000n).actions)
    expect(next.record.activation?.fight).toBe(state.contract.id)
    replay(state, next.action!.payload.actions as FightTurnPayload['actions'])
  }
})

const positioned_profile = (): CombatProfile =>
  parse_combat_profile({
    ...profile(),
    combos: [
      {
        name: 'attack',
        steps: [{ type: 'cast', spell: 'Tricky Blow', target: 'highest_damage_enemy', position: 'best_damage' }],
      },
    ],
  })
const positioning_checkpoint = (walls = [cell(6, 7)]) => {
  const state = checkpoint(walls)
  state.sources.players[character_id] = create_character_source({ classe: 'yajin', level: 30n, agility: 1_000n })
  state.contract.fighters[0]!.mp = 2n
  return state
}

test('position search finds a legal flank for wall damage rather than the nearest enemy or straight approach', () => {
  const state = positioning_checkpoint()
  const before = structuredClone(state)
  const stationary = plan_combat_turn(profile(), state, 0n, 63_000n)
  expect(replay(state, stationary.actions).some(({ type }) => type === 'push_collided')).toBe(false)
  const planned = plan_combat_turn(positioned_profile(), state, 0n, 63_000n)
  expect(planned.actions).toEqual([
    { type: 'move', path: [String(cell(5, 4)), String(cell(6, 4))] },
    { type: 'cast', spell: 'Tricky Blow', target_cell: String(cell(6)) },
  ])
  expect(replay(state, planned.actions).some(({ type }) => type === 'push_collided')).toBe(true)
  expect(state).toEqual(before)
  const chained = parse_combat_profile({
    ...positioned_profile(),
    combos: [
      {
        name: 'attack',
        steps: [
          ...positioned_profile().combos[0]!.steps,
          { type: 'cast', spell: 'Deviousness', target: 'lowest_hp_enemy' },
        ],
      },
    ],
  })
  const chain = plan_combat_turn(chained, state, 0n, 63_000n)
  expect(chain.actions.at(-1)).toMatchObject({ type: 'cast', spell: 'Deviousness', target_cell: String(cell(6, 6)) })
  replay(state, chain.actions)
  expect(plan_combat_turn(positioned_profile(), state, 0n, 63_000n)).toEqual(planned)
})

test('position search preserves stationary attacks without a wall or path and never spends movement without a legal cast', () => {
  for (const state of [positioning_checkpoint([]), positioning_checkpoint([cell(5, 4), cell(5, 6)])]) {
    const planned = plan_combat_turn(positioned_profile(), state, 0n, 63_000n)
    expect(planned.actions.map(({ type }) => type)).toEqual(['cast'])
    replay(state, planned.actions)
  }
  const spent = positioning_checkpoint()
  spent.contract.fighters[0]!.ap = 3n
  expect(plan_combat_turn(positioned_profile(), spent, 0n, 63_000n)).toMatchObject({
    actions: [],
    issue: 'no_legal_tactic',
  })
})

test('position search simulates lethal traps and tackle costs instead of assuming the path endpoint', () => {
  const trapped = positioning_checkpoint()
  trapped.contract.zones = [
    {
      owner_fighter: 1n,
      trap: true,
      shape: 0n,
      size: 0n,
      anchor: cell(5, 4),
      turns_left: 0n,
      effects: [
        {
          kind: 0n,
          element: 'earth',
          value: 100_000n,
          value_max: 100_000n,
          area_shape: 0n,
          area_size: 0n,
          target_filter: 0n,
          chance_bp: 10_000n,
          turns: 0n,
          stat: 0n,
        },
      ],
    },
  ]
  const planned = plan_combat_turn(positioned_profile(), trapped, 0n, 63_000n)
  expect(planned.actions.map(({ type }) => type)).toEqual(['cast'])
  expect(replay(trapped, planned.actions).some(({ type }) => type === 'trap_triggered')).toBe(false)
  const tackled = positioning_checkpoint()
  tackled.sources.players[character_id] = create_character_source({ classe: 'yajin', level: 30n })
  for (const fighter of tackled.contract.fighters.slice(1)) {
    if (fighter.kind.type === 'mob') fighter.kind.snapshot.agility = 1_000_000n
  }
  expect(plan_combat_turn(positioned_profile(), tackled, 0n, 63_000n).actions.map(({ type }) => type)).toEqual(['cast'])
})

test('position search respects occupied flank cells and cannot cast through blocked line of sight', () => {
  const occupied = positioning_checkpoint()
  occupied.contract.fighters.push({ ...structuredClone(occupied.contract.fighters[1]!), team: 0n, cell: cell(6, 4) })
  const planned = plan_combat_turn(positioned_profile(), occupied, 0n, 63_000n)
  const move = planned.actions.find((action) => action.type === 'move')
  expect(move?.path).not.toContain(String(cell(6, 4)))
  expect(replay(occupied, planned.actions).some(({ type }) => type === 'push_collided')).toBe(true)

  const occluded = positioning_checkpoint([cell(6)])
  occluded.contract.fighters[0]!.mp = 0n
  occluded.contract.fighters[1]!.dead = true
  occluded.contract.fighters[2]!.cell = cell(8)
  const ranged = parse_combat_profile({
    ...positioned_profile(),
    combos: [
      {
        name: 'attack',
        steps: [{ type: 'cast', spell: 'Deviousness', target: 'highest_damage_enemy', position: 'best_damage' }],
      },
    ],
  })
  expect(plan_combat_turn(ranged, occluded, 0n, 63_000n)).toMatchObject({ actions: [], issue: 'no_legal_tactic' })
})
