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
  const calls = { join_world: [], join_fight: [], focus: [], follow: [] }
  const wiring = create_group_wiring({
    join_world: (character_id, world_id) => {
      calls.join_world.push([character_id, world_id])
      return join_world_impl ? join_world_impl(character_id, world_id) : Promise.resolve()
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
  test('a world divergence fires exactly one join_world; confirmation stays silent', async () => {
    const { wiring, calls } = make_harness()
    sync_full_group(wiring, [
      [LEADER, WORLD],
      [ALT_1, WORLD],
      [ALT_2, OTHER_WORLD],
    ])
    await wiring.settled()
    expect(calls.join_world).toEqual([[ALT_2, WORLD]])
    // the identical resync (poll echo) re-fires nothing; the chain confirmation drains the latch silently
    sync_full_group(wiring, [
      [LEADER, WORLD],
      [ALT_1, WORLD],
      [ALT_2, OTHER_WORLD],
    ])
    sync_full_group(wiring, [
      [LEADER, WORLD],
      [ALT_1, WORLD],
      [ALT_2, WORLD],
    ])
    await wiring.settled()
    expect(calls.join_world).toHaveLength(1)
  })

  test('an EXECUTED join_world failure latches the member — a later re-divergence never re-fires it', async () => {
    const { wiring, calls } = make_harness({
      join_world_impl: () => Promise.reject(Object.assign(new Error('abort'), { executed: true })),
    })
    sync_full_group(wiring, [
      [LEADER, WORLD],
      [ALT_1, WORLD],
      [ALT_2, OTHER_WORLD],
    ])
    await wiring.settled()
    expect(calls.join_world).toEqual([[ALT_2, WORLD]])
    // the leader travels to a THIRD world — the re-arm moment: the healthy alt re-fires toward it,
    // the latched member must NOT (its executed failure is never auto-retried)
    wiring.sync_group({
      my_address: ME,
      leader_character_id: LEADER,
      members: members(LEADER, ALT_1, ALT_2),
      worlds: worlds([[LEADER, '0xworld_c']]),
    })
    await wiring.settled()
    expect(calls.join_world).toEqual([
      [ALT_2, WORLD],
      [ALT_1, '0xworld_c'],
    ])
    expect(calls.join_fight).toHaveLength(0)
  })

  test('pose ticks apply formation rows; a blocked session (fight/dungeon) clears the layer instead', () => {
    const { wiring, calls } = make_harness()
    sync_full_group(wiring, [
      [LEADER, WORLD],
      [ALT_1, WORLD],
      [ALT_2, WORLD],
    ])
    wiring.pose_tick({ x: 10, z: 10, yaw: 0 }, {}, 1_000)
    const applied = calls.follow.at(-1)
    expect(applied.map((row) => row.character_id)).toEqual([ALT_1, ALT_2])
    wiring.pose_tick({ x: 11, z: 10, yaw: 0 }, { blocked: true }, 1_200)
    expect(calls.follow.at(-1)).toEqual([])
  })

  test('an emptied group (character switch / party leave) clears rendered followers immediately', () => {
    const { wiring, calls } = make_harness()
    sync_full_group(wiring, [
      [LEADER, WORLD],
      [ALT_1, WORLD],
      [ALT_2, WORLD],
    ])
    wiring.pose_tick({ x: 10, z: 10, yaw: 0 }, {}, 1_000)
    expect(calls.follow.at(-1)).toHaveLength(2)
    wiring.sync_group({ my_address: ME, leader_character_id: LEADER, members: [], worlds: [] })
    expect(calls.follow.at(-1)).toEqual([])
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
