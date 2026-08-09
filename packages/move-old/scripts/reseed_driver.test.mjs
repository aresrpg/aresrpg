// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { build_item_leg, build_spell_leg, execute_transactions, resolve_mode, stat_fields } from './reseed_plan.mjs'
import { build_world_leg } from './reseed_world_plan.mjs'

const spell_id = '0x100'
const item_id = '0x200'
const world_id = '0x300'
const mob_id = '0x400'

const seed_effect = (overrides) => ({
  kind: 0,
  element: 2,
  value: 8,
  area_shape: 0,
  area_size: 0,
  target_filter: 1,
  chance: 100,
  turns: 0,
  stat: 0,
  flags: 0,
  ...overrides,
})

const seed_level = (overrides) => ({
  min_char_level: 1,
  ap_cost: 3,
  range_min: 1,
  range_max: 5,
  modifiable_range: false,
  line_launch: false,
  line_of_sight: true,
  free_cell: false,
  casts_per_turn: 2,
  casts_per_target: 1,
  cooldown_turns: 0,
  crit_rate: 50,
  effects: [seed_effect()],
  crit_effects: [seed_effect({ value: 10 })],
  ...overrides,
})

const chain_effect = (overrides) => ({
  kind: 0,
  element: 2,
  value: '8',
  area_shape: 0,
  area_size: '0',
  target_filter: 1,
  chance: 100,
  turns: 0,
  stat: 0,
  flags: 0,
  phase: 0,
  ...overrides,
})

const chain_level = (overrides) => ({
  min_char_level: 1,
  ap_cost: '3',
  range_min: '1',
  range_max: '5',
  modifiable_range: false,
  line_launch: false,
  line_of_sight: true,
  free_cell: false,
  casts_per_turn: 2,
  casts_per_target: 1,
  cooldown_turns: 0,
  crit_rate: '50',
  ends_turn_on_fail: false,
  required_states: [],
  forbidden_states: [],
  effects: [chain_effect()],
  crit_effects: [chain_effect({ value: '10' })],
  ...overrides,
})

const spell_inputs = (seed_overrides = {}, chain_overrides = {}) => {
  const row = {
    id: 'test_spell',
    classType: 'senshi',
    unlock: 1,
    levels: [seed_level(seed_overrides), ...Array.from({ length: 5 }, () => seed_level())],
  }
  const chain = {
    class: 'senshi',
    unlock_level: 1,
    name: 'test_spell',
    levels: [chain_level(chain_overrides), ...Array.from({ length: 5 }, () => chain_level())],
  }
  return {
    seed_rows: [row],
    seed_manifest: { spells: { 'senshi:1:test_spell': { id: spell_id } } },
    chain_state: { [spell_id]: chain },
    targets: { spells: '0xspell_latest', foundation: '0xfoundation_latest' },
  }
}

describe('spell diff -> published setter calls', () => {
  test('one drifted level emits AP, range, limits, then both effect vectors', () => {
    const inputs = spell_inputs(
      {
        ap_cost: 4,
        range_max: 7,
        modifiable_range: true,
        casts_per_turn: 3,
        cooldown_turns: 2,
        effects: [seed_effect({ value: 9 })],
      },
      {}
    )
    const leg = build_spell_leg(inputs)
    expect(leg.blockers).toEqual([])
    expect(leg.rows_drifted).toBe(1)
    expect(leg.levels_drifted).toBe(1)
    expect(leg.transactions.flatMap((transaction) => transaction.calls).map((call) => call.function)).toEqual([
      'set_level_ap_cost',
      'set_level_range',
      'set_level_limits',
      'set_level_effects',
    ])
    expect(leg.transactions.every((transaction) => transaction.ptb_command_count <= 30)).toBe(true)
  })

  test('a matching spell emits no calls', () => {
    const leg = build_spell_leg(spell_inputs())
    expect(leg.rows_drifted).toBe(0)
    expect(leg.call_count).toBe(0)
    expect(leg.transactions).toEqual([])
  })

  test('unsupported spell-level drift blocks the whole spell instead of partial tuning', () => {
    const leg = build_spell_leg(spell_inputs({ ap_cost: 4, min_char_level: 2, line_of_sight: false }, {}))
    expect(leg.rows_drifted).toBe(1)
    expect(leg.call_count).toBe(0)
    expect(leg.blockers.join('\n')).toContain('min_char_level')
    expect(leg.blockers.join('\n')).toContain('line_of_sight')
  })
})

const centered = (overrides) =>
  Object.fromEntries(stat_fields.map((field) => [field, 32_768 + (overrides[field] ?? 0)]))
const item_inputs = (seed_stats, chain_min, chain_max) => ({
  seed_rows: [{ slug: 'test_blade', category: 'SWORD', stats: seed_stats }],
  seed_manifest: { items: { test_blade: item_id } },
  chain_state: {
    [item_id]: {
      template: { id: item_id },
      stats_min: chain_min,
      stats_max: chain_max,
    },
  },
  target: '0xaresrpg_latest',
})

describe('item stat diff -> additive set_template_stats', () => {
  test('one drifted item emits all 17 mins + 17 maxes in field order', () => {
    const seed_stats = {
      min: { vitality: 1, critical: 2 },
      max: { vitality: 5, critical: 3 },
    }
    const leg = build_item_leg(item_inputs(seed_stats, centered({}), centered({})))
    expect(leg.blockers).toEqual([])
    expect(leg.rows_drifted).toBe(1)
    expect(leg.call_count).toBe(1)
    const [
      {
        calls: [call],
      },
    ] = leg.transactions
    expect(call.function).toBe('set_template_stats')
    expect(call.payload.mins).toHaveLength(17)
    expect(call.payload.maxs).toHaveLength(17)
    expect(call.payload.mins[0]).toBe(32_769)
    expect(call.payload.mins[9]).toBe(32_770)
    expect(call.payload.maxs[0]).toBe(32_773)
  })

  test('a matching item emits no calls', () => {
    const seed_stats = { min: { vitality: 1 }, max: { vitality: 5 } }
    const leg = build_item_leg(item_inputs(seed_stats, centered({ vitality: 1 }), centered({ vitality: 5 })))
    expect(leg.rows_drifted).toBe(0)
    expect(leg.transactions).toEqual([])
  })
})

test('changed world is one atomic clear + complete ordered re-author PTB; role stays projection-only', () => {
  const seed_manifest = {
    items: { wheat: item_id },
    mobs: {
      rat: { id: mob_id, role: 'archi' },
      archi: { id: '0x401', role: 'archi' },
    },
    worlds: [{ wid: '01_test', id: world_id }],
  }
  const world = {
    id: '01_test',
    resources: [{ slug: 'wheat', rate: 0.9, job: 0, tier: 1 }],
    mobGroups: [{ mob: 'rat', rate: 0.8 }],
    dungeonRooms: [['rat']],
  }
  const chain_state = {
    [world_id]: {
      resources: [
        {
          template_id: item_id,
          rate_bp: 9000,
          min_qty: 10,
          max_qty: 20,
          job: 0,
          tier: 1,
        },
      ],
      mobs: [
        { template_id: mob_id, rate_bp: 8000, min_group: 2, max_group: 3 },
        { template_id: '0x401', rate_bp: 8000, min_group: 2, max_group: 3 },
      ],
      dungeon_rooms: [{ mobs: [mob_id] }],
    },
  }
  const leg = build_world_leg({
    seed_rows: [world],
    mob_rows: [{ key: 'rat', role: 'trash' }],
    seed_manifest,
    chain_state,
    target: '0xaresrpg_latest',
  })
  expect(leg.rows_drifted).toBe(1)
  expect(leg.tx_count).toBe(1)
  expect(leg.transactions[0].atomic_world).toBe(true)
  expect(leg.transactions[0].calls.map((call) => call.function)).toEqual([
    'clear_tables',
    'add_resource_entry',
    'add_mob_entry',
    // clear_tables empties the level vector and add_mob_entry re-inits it to 0, so the authored eligibility
    // ceiling has to be re-emitted per row or every reseed silently erases it
    'set_mob_level',
    'add_dungeon_room',
  ])
  expect(leg.totals.mob_groups).toEqual({ removed: 1, added: 0 })
  expect(leg.role_projection_drift).toEqual([{ mob: 'rat', manifest_role: 'archi', seed_role: 'trash' }])

  const matching = build_world_leg({
    seed_rows: [world],
    mob_rows: [{ key: 'rat', role: 'trash' }],
    seed_manifest,
    chain_state: {
      [world_id]: {
        resources: chain_state[world_id].resources,
        mobs: chain_state[world_id].mobs.slice(0, 1),
        // the authored ceiling for `rat` (no maxLevel in the row above ⇒ the level-1 default)
        mob_levels: [1],
        dungeon_rooms: chain_state[world_id].dungeon_rooms,
      },
    },
    target: '0xaresrpg_latest',
  })
  expect(matching.rows_drifted).toBe(0)
  expect(matching.transactions).toEqual([])
})

describe('DRY_RUN gate and executed-failure latch', () => {
  test('DRY_RUN is the default, DRY_RUN=0 hard-fails without LIVE=1, and dry invokes no executor', async () => {
    expect(resolve_mode({})).toEqual({ live: false, dry_run: true })
    expect(() => resolve_mode({ DRY_RUN: '0' })).toThrow(/LIVE=1/)
    let calls = 0
    const result = await execute_transactions([{ label: 'never' }], {
      live: false,
      execute_transaction: async () => {
        calls += 1
        return { status: 'success', digest: 'not-reached' }
      },
    })
    expect(calls).toBe(0)
    expect(result.executed).toBe(0)
  })

  test('an executed failure latches its digest and prevents the next sequential tx', async () => {
    const attempted = []
    let error
    try {
      await execute_transactions([{ label: 'first' }, { label: 'must-not-run' }], {
        live: true,
        execute_transaction: async (transaction) => {
          attempted.push(transaction.label)
          return {
            status: 'failure',
            digest: '0xdeadbeef',
            error: 'MoveAbort',
          }
        },
      })
    } catch (caught) {
      error = caught
    }
    expect(attempted).toEqual(['first'])
    expect(error?.message).toContain('0xdeadbeef')
    expect(error?.digest).toBe('0xdeadbeef')
  })
})
