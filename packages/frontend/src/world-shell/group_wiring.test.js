// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Headless units for the GROUP WIRING seam (MULTICHAR lane): the DI core drives the pure group loop and
// executes its requests through injected fakes — no module mocks (bun mock.module is process-global), no DOM.
import { describe, expect, test } from 'bun:test'

import { create_group_wiring, build_follow_entries, fight_facts_of } from './group_wiring_core.js'

const ME = '0xwallet'
const LEADER = '0xleader'
const ALT_1 = '0xalt1'
const ALT_2 = '0xalt2'
const WORLD = '0xworld_a'
const OTHER_WORLD = '0xworld_b'

const members = (...ids) => ids.map((character, order) => ({ character, owner: ME, order }))
const worlds = (rows) => rows.map(([character_id, world_id]) => ({ character_id, world_id }))

function make_harness({ join_world_impl, join_fight_impl } = {}) {
  const calls = { join_world: [], write_checkpoint: [], join_fight: [], focus: [], follow: [] }
  // Mirrors tx.js's run_character_action: `{ queued: true }` (every group-wiring join) waits behind
  // whatever this fake is already running, the SAME guarantee the real ONE cross-character lane gives —
  // a faithful double, not a bare pass-through, or this harness could never catch a lost serialization.
  let join_world_tail = Promise.resolve()
  const wiring = create_group_wiring({
    join_world: (character_id, world_id, { queued = false } = {}) => {
      const task = () => {
        calls.join_world.push([character_id, world_id])
        return join_world_impl ? join_world_impl(character_id, world_id) : Promise.resolve()
      }
      const run = queued ? join_world_tail.then(task) : Promise.resolve().then(task)
      join_world_tail = run.catch(() => undefined)
      return run
    },
    read_checkpoint: () => ({ x: 105, z: 100 }),
    write_checkpoint: async (character_id, world_id, position) => {
      calls.write_checkpoint.push([character_id, world_id, position])
      return { character_id, world_id, position }
    },
    join_fight: (character_id, fight_id, options) =>
      join_fight_impl
        ? join_fight_impl(character_id, fight_id, options)
        : Promise.resolve(calls.join_fight.push([character_id, fight_id])),
    focus_seat: (character_id) => calls.focus.push(character_id),
    apply_follow: (rows) => calls.follow.push(rows),
    is_executed_failure: (error) => !!error?.executed,
    log: () => {},
  })
  return { wiring, calls }
}

const sync_full_group = (wiring, world_rows) =>
  wiring.sync_group({
    my_address: ME,
    leader_character_id: LEADER,
    members: members(LEADER, ALT_1, ALT_2),
    worlds: worlds(world_rows),
  })

describe('group wiring — feeds the reducer, executes its requests once', () => {
  test('explicit enable runs owned joins sequentially through the one transaction queue', async () => {
    let release_first
    let mark_started
    const first_started = new Promise((resolve) => {
      mark_started = resolve
    })
    const first_gate = new Promise((resolve) => {
      release_first = resolve
    })
    const { wiring, calls } = make_harness({
      join_world_impl: async (character_id) => {
        if (character_id === ALT_1) {
          mark_started()
          await first_gate
        }
      },
    })
    sync_full_group(wiring, [
      [LEADER, WORLD],
      [ALT_1, WORLD],
      [ALT_2, OTHER_WORLD],
    ])
    wiring.pose_tick({ x: 100, z: 100, yaw: 0 }, { character_id: LEADER })
    wiring.enable_follow({ leader_character_id: LEADER, follower_character_ids: [ALT_1, ALT_2] })
    await first_started
    expect(calls.join_world).toEqual([[ALT_1, WORLD]])
    release_first()
    await wiring.settled()
    expect(calls.join_world).toEqual([
      [ALT_1, WORLD],
      [ALT_2, WORLD],
    ])
    expect(wiring.store.getState().follow.followers[ALT_1].status).toBe('in_transit')
    expect(wiring.store.getState().follow.followers[ALT_2].status).toBe('in_transit')
  })

  test('an EXECUTED follow join failure latches the member and a leader world change never re-fires it', async () => {
    const { wiring, calls } = make_harness({
      join_world_impl: () => Promise.reject(Object.assign(new Error('abort'), { executed: true })),
    })
    sync_full_group(wiring, [
      [LEADER, WORLD],
      [ALT_1, WORLD],
      [ALT_2, OTHER_WORLD],
    ])
    wiring.pose_tick({ x: 100, z: 100, yaw: 0 }, { character_id: LEADER })
    wiring.enable_follow({ leader_character_id: LEADER, follower_character_ids: [ALT_2] })
    await wiring.settled()
    expect(calls.join_world).toEqual([[ALT_2, WORLD]])
    wiring.sync_group({
      my_address: ME,
      leader_character_id: LEADER,
      members: members(LEADER, ALT_1, ALT_2),
      worlds: worlds([[LEADER, '0xworld_c']]),
    })
    await wiring.settled()
    expect(calls.join_world).toEqual([[ALT_2, WORLD]])
    expect(calls.join_fight).toHaveLength(0)
  })

  test('transit stays invisible; expiry writes a checkpoint and its receipt renders beside the leader', async () => {
    const { wiring, calls } = make_harness()
    sync_full_group(wiring, [
      [LEADER, WORLD],
      [ALT_1, WORLD],
      [ALT_2, WORLD],
    ])
    const now = Date.now()
    wiring.pose_tick({ x: 100, z: 100, yaw: 0 }, { character_id: LEADER }, now)
    wiring.enable_follow({ leader_character_id: LEADER, follower_character_ids: [ALT_1] }, now)
    await wiring.settled()
    expect(calls.follow).toEqual([])
    wiring.transit_tick(now + 10_000)
    await wiring.settled()
    expect(calls.write_checkpoint).toEqual([[ALT_1, WORLD, { x: 101.5, z: 100.5 }]])
    expect(calls.follow.at(-1).map((row) => row.character_id)).toEqual([ALT_1])

    wiring.dungeon_snapshot(true)
    expect(wiring.store.getState().follow.dungeon_background).toBe(true)
    expect(calls.follow.at(-1)).toEqual([])
    wiring.transit_tick(now + 20_000)
    expect(wiring.store.getState().follow.followers[ALT_1].status).toBe('arrived')
  })

  test('an emptied party projection (manual character switch) leaves explicit follow state untouched', async () => {
    const { wiring, calls } = make_harness()
    sync_full_group(wiring, [
      [LEADER, WORLD],
      [ALT_1, WORLD],
      [ALT_2, WORLD],
    ])
    wiring.pose_tick({ x: 10, z: 10, yaw: 0 }, { character_id: LEADER }, 1_000)
    wiring.enable_follow({ leader_character_id: LEADER, follower_character_ids: [ALT_1] }, 1_000)
    await wiring.settled()
    const before = wiring.store.getState().follow
    wiring.sync_group({ my_address: ME, leader_character_id: LEADER, members: [], worlds: [] })
    expect(wiring.store.getState().follow).toBe(before)
    expect(calls.follow).toEqual([])
  })

  test('a placement fight joins the aligned alts ONCE across polls; focus follows each owned turn', async () => {
    const { wiring, calls } = make_harness()
    sync_full_group(wiring, [
      [LEADER, WORLD],
      [ALT_1, WORLD],
      [ALT_2, WORLD],
    ])
    const facts = { fight_id: '0xf', placement: true, over: false, active_entity_id: null, seated: [LEADER] }
    wiring.fight_snapshot(facts, { join_open: true })
    wiring.fight_snapshot(facts, { join_open: true }) // poll echo
    await wiring.settled()
    expect(calls.join_fight).toEqual([
      [ALT_1, '0xf'],
      [ALT_2, '0xf'],
    ])
    // turn order drives the seat focus exactly once per boundary; mob turns change nothing
    wiring.fight_snapshot({ ...facts, placement: false, seated: [LEADER, ALT_1, ALT_2], active_entity_id: LEADER })
    wiring.fight_snapshot({ ...facts, placement: false, seated: [LEADER, ALT_1, ALT_2], active_entity_id: LEADER })
    wiring.fight_snapshot({ ...facts, placement: false, seated: [LEADER, ALT_1, ALT_2], active_entity_id: 'mob-0' })
    wiring.fight_snapshot({ ...facts, placement: false, seated: [LEADER, ALT_1, ALT_2], active_entity_id: ALT_1 })
    expect(calls.focus).toEqual([LEADER, ALT_1])
    // victory clears the armed fight; the next fight re-arms cleanly
    wiring.fight_snapshot({ ...facts, over: true, seated: [LEADER, ALT_1, ALT_2] })
    expect(wiring.store.getState().fight).toBe(null)
  })

  test('party fight joins queue behind the creator and complete one member at a time', async () => {
    const creator_gate = Promise.withResolvers()
    const order = ['creator:start']
    let tail = creator_gate.promise.then(() => order.push('creator:end'))
    let pending = 1
    const schedule_tx = (task, { queued = false } = {}) => {
      if (!queued && pending) return Promise.reject(new Error('character action in progress'))
      pending += 1
      const scheduled = tail.then(task)
      tail = scheduled
        .catch(() => undefined)
        .then(() => {
          pending -= 1
        })
      return scheduled
    }
    const { wiring, calls } = make_harness({
      join_fight_impl: (character_id, fight_id, options) =>
        schedule_tx(async () => {
          order.push(`${character_id}:start`)
          calls.join_fight.push([character_id, fight_id])
          await Promise.resolve()
          order.push(`${character_id}:end`)
        }, options),
    })
    sync_full_group(wiring, [
      [LEADER, WORLD],
      [ALT_1, WORLD],
      [ALT_2, WORLD],
    ])

    wiring.fight_snapshot(
      { fight_id: '0xf', placement: true, over: false, active_entity_id: null, seated: [LEADER] },
      { join_open: true }
    )
    await Promise.resolve()
    expect(calls.join_fight).toEqual([])

    creator_gate.resolve()
    await wiring.settled()
    expect(calls.join_fight).toEqual([
      [ALT_1, '0xf'],
      [ALT_2, '0xf'],
    ])
    expect(order).toEqual([
      'creator:start',
      'creator:end',
      `${ALT_1}:start`,
      `${ALT_1}:end`,
      `${ALT_2}:start`,
      `${ALT_2}:end`,
    ])
  })

  test('a mid-active resume (join window closed) arms focus WITHOUT firing any join transaction', async () => {
    const { wiring, calls } = make_harness()
    sync_full_group(wiring, [
      [LEADER, WORLD],
      [ALT_1, WORLD],
      [ALT_2, WORLD],
    ])
    wiring.fight_snapshot(
      { fight_id: '0xf', placement: false, over: false, active_entity_id: ALT_2, seated: [LEADER, ALT_2] },
      { join_open: false }
    )
    await wiring.settled()
    expect(calls.join_fight).toEqual([])
    expect(calls.focus).toEqual([ALT_2])
  })
})

describe('pure helpers', () => {
  test('fight_facts_of maps an engine view to the loop facts (players only, mob keys excluded)', () => {
    const view = {
      fight_id: '0xf',
      placement: true,
      winner: -1,
      active_entity_id: LEADER,
      fighters: new Map([
        [LEADER, {}],
        [ALT_1, {}],
        ['mob-0', {}],
      ]),
    }
    expect(fight_facts_of(view)).toEqual({
      fight_id: '0xf',
      placement: true,
      over: false,
      active_entity_id: LEADER,
      seated: [LEADER, ALT_1],
    })
    expect(fight_facts_of(null)).toBe(null)
    expect(fight_facts_of({ fight_id: '0xf', winner: 0, fighters: new Map() })?.over).toBe(true)
  })

  test('build_follow_entries produces renderer rows from roster cards and skips unresolved identities', () => {
    const rows = [
      { character_id: ALT_1, x: 5, z: 7, yaw: 1 },
      { character_id: ALT_2, x: 6, z: 8, yaw: 1 },
    ]
    const cards = new Map([[ALT_1, { id: ALT_1, name: 'Kara', classe: 'yajin', male: false, color_1: 3 }]])
    const entries = build_follow_entries(rows, cards, WORLD)
    expect(entries).toHaveLength(1)
    expect(entries[0].entry).toMatchObject({
      id: ALT_1,
      name: 'Kara',
      classe: 'yajin',
      male: false,
      owned_follow: true,
      target_position: { x: 5, y: 0, z: 7 },
      target_yaw: 1,
    })
    expect(entries[0].cache_position).toEqual({ character_id: ALT_1, world_id: WORLD, x: 5, z: 7 })
    expect(build_follow_entries(rows, cards, null)).toEqual([])
  })
})
