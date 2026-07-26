// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// AUTO-SEARCH FOLD — the driven unit gate for the scouter core (#1106). Every case here drives the SAME
// door the live adapter drives (`reduce_auto_search(state, input, now)`), with synthetic world snapshots
// standing in for the spawns store's projections — no engine, no chain, no clock of its own.

import { describe, expect, test } from 'bun:test'

import {
  ARRIVE_RADIUS_M,
  DEFAULT_RANGE_FROM_M,
  DEFAULT_RANGE_TO_M,
  LEG_TIMEOUT_MS,
  SCAN_GRACE_MS,
  blank_auto_search,
  reduce_auto_search,
  zone_center_world,
  zone_key_of,
} from './auto_search.js'

// A synthetic world snapshot: zone grid 512, offsets 250k (the SDK defaults), player at the world centre.
const ZONE_SIZE = 512
const OFF = 250_000
const world = (over = {}) => ({
  type: 'world',
  player: { x: 0, z: 0 },
  zone_size: ZONE_SIZE,
  offset_x: OFF,
  offset_z: OFF,
  fresh_keys: [],
  search_armed: false,
  markers: [],
  ...over,
})

/** Drive a list of inputs through the door from a blank state. */
const drive = (inputs, state = blank_auto_search()) =>
  inputs.reduce((acc, [input, now]) => reduce_auto_search(acc, input, now), state)

/** An armed scouter with a wanted set — the fee modal is the ONLY door to `armed`. */
const armed_with = (wanted, over = {}) =>
  drive([
    [{ type: 'config_set', from_m: DEFAULT_RANGE_FROM_M, to_m: DEFAULT_RANGE_TO_M, wanted, ...over }, 0],
    [{ type: 'toggle', value: true }, 0],
    [{ type: 'fee_confirm' }, 0],
  ])

describe('the enable gate — a real transaction is never armed without the fee confirmation', () => {
  test('toggling on raises the fee modal and leaves the scouter DISARMED', () => {
    const state = reduce_auto_search(blank_auto_search(), { type: 'toggle', value: true }, 0)
    expect(state.fee_pending).toBe(true)
    expect(state.armed).toBe(false)
  })

  test('confirming the fee arms it; cancelling leaves it off', () => {
    const on = drive([
      [{ type: 'toggle', value: true }, 0],
      [{ type: 'fee_confirm' }, 1],
    ])
    expect(on.armed).toBe(true)
    expect(on.fee_pending).toBe(false)

    const off = drive([
      [{ type: 'toggle', value: true }, 0],
      [{ type: 'fee_cancel' }, 1],
    ])
    expect(off.armed).toBe(false)
    expect(off.fee_pending).toBe(false)
  })

  test('the fee modal is raised on EVERY enable, never remembered', () => {
    const state = drive([
      [{ type: 'toggle', value: true }, 0],
      [{ type: 'fee_confirm' }, 1],
      [{ type: 'toggle', value: false }, 2],
      [{ type: 'toggle', value: true }, 3],
    ])
    expect(state.fee_pending).toBe(true)
    expect(state.armed).toBe(false)
  })
})

describe('the config — a from/to block range and the wanted mob templates', () => {
  test('the defaults are the 1000–3000 annulus with nothing wanted', () => {
    const state = blank_auto_search()
    expect([state.from_m, state.to_m]).toEqual([1000, 3000])
    expect(state.wanted).toEqual([])
  })

  test('an inverted range is normalised (from ≤ to), never stored backwards', () => {
    const state = reduce_auto_search(blank_auto_search(), { type: 'config_set', from_m: 2500, to_m: 900 }, 0)
    expect(state.from_m).toBeLessThanOrEqual(state.to_m)
    expect([state.from_m, state.to_m]).toEqual([900, 2500])
  })

  test('opening the config modal is a HARD STOP — the loop disarms', () => {
    const state = reduce_auto_search(armed_with(['mob_a']), { type: 'config_open' }, 0)
    expect(state.armed).toBe(false)
    expect(state.config_open).toBe(true)
  })
})

describe('the walk legs — only zones whose centre sits inside the configured annulus', () => {
  test('an armed scouter walks to a zone centre INSIDE [from,to] of the world centre', () => {
    const state = reduce_auto_search(armed_with(['mob_a']), world(), 1000)
    expect(state.phase).toBe('travel')
    expect(state.command.kind).toBe('walk')
    const distance = Math.hypot(state.command.x, state.command.z)
    expect(distance).toBeGreaterThanOrEqual(DEFAULT_RANGE_FROM_M)
    expect(distance).toBeLessThanOrEqual(DEFAULT_RANGE_TO_M)
    // …and the walk target IS that zone's centre, never an arbitrary point.
    expect(state.command.x).toBe(zone_center_world(state.target.zx, ZONE_SIZE, OFF))
    expect(state.command.z).toBe(zone_center_world(state.target.zy, ZONE_SIZE, OFF))
  })

  test('a narrow annulus with no zone in it never walks — it reports exhaustion honestly', () => {
    const state = reduce_auto_search(
      armed_with(['mob_a'], { from_m: 1, to_m: 2 }),
      world(),
      1000
    )
    expect(state.command.kind).toBe('exhausted')
    expect(state.armed).toBe(false)
  })

  test('a FRESH-TTL zone is skipped — the picker takes the next candidate instead', () => {
    const first = reduce_auto_search(armed_with(['mob_a']), world(), 1000)
    const fresh = zone_key_of(first.target.zx, first.target.zy)
    const second = reduce_auto_search(armed_with(['mob_a']), world({ fresh_keys: [fresh] }), 1000)
    expect(zone_key_of(second.target.zx, second.target.zy)).not.toBe(fresh)
  })

  test('a leg that never arrives times out, skips that zone and re-targets', () => {
    const start = reduce_auto_search(armed_with(['mob_a']), world(), 1000)
    const stuck = reduce_auto_search(start, world(), 1000 + LEG_TIMEOUT_MS + 1)
    expect(zone_key_of(stuck.target.zx, stuck.target.zy)).not.toBe(zone_key_of(start.target.zx, start.target.zy))
    expect(stuck.command.kind).toBe('walk')
  })
})

describe('the search — one in flight, ever, and never over a fresh zone', () => {
  /** Walk a scouter to its first target and stand in it. */
  const standing_in_target = (wanted = ['mob_a']) => {
    const travelling = reduce_auto_search(armed_with(wanted), world(), 1000)
    const at = { x: travelling.command.x, z: travelling.command.z }
    return { travelling, at }
  }

  test('standing in the target zone with the search gate OPEN fires exactly one search', () => {
    const { travelling, at } = standing_in_target()
    const searching = reduce_auto_search(travelling, world({ player: at, search_armed: true }), 2000)
    expect(searching.phase).toBe('search')
    expect(searching.command.kind).toBe('search')

    // a second world tick while that search is in flight emits NOTHING new
    const again = reduce_auto_search(searching, world({ player: at, search_armed: true }), 2100)
    expect(again.command.seq).toBe(searching.command.seq)
  })

  test('standing in the target zone with the gate CLOSED never fires — it moves on after the grace', () => {
    const { travelling, at } = standing_in_target()
    const waiting = reduce_auto_search(travelling, world({ player: at, search_armed: false }), 2000)
    expect(waiting.command.kind).toBe('walk') // unchanged — still the travel command
    expect(waiting.phase).toBe('travel')

    const moved_on = reduce_auto_search(waiting, world({ player: at, search_armed: false }), 2000 + LEG_TIMEOUT_MS + 1)
    expect(moved_on.command.kind).toBe('walk')
    expect(zone_key_of(moved_on.target.zx, moved_on.target.zy)).not.toBe(
      zone_key_of(travelling.target.zx, travelling.target.zy)
    )
  })

  test('a failed search releases the flight and re-targets instead of hanging forever', () => {
    const { travelling, at } = standing_in_target()
    const searching = reduce_auto_search(travelling, world({ player: at, search_armed: true }), 2000)
    const failed = reduce_auto_search(
      searching,
      { type: 'search_failed', zx: searching.target.zx, zy: searching.target.zy },
      2500
    )
    expect(failed.phase).toBe('idle')
    const retargeted = reduce_auto_search(failed, world({ player: at }), 2600)
    expect(retargeted.command.kind).toBe('walk')
    // …and NEVER back onto the zone that just failed — re-picking it would re-fire the doomed tx, and
    // every one of those costs real gas.
    expect(zone_key_of(retargeted.target.zx, retargeted.target.zy)).not.toBe(
      zone_key_of(searching.target.zx, searching.target.zy)
    )
  })
})

describe('the receipt — a wanted template halts the loop with the found popup', () => {
  const searched_state = (wanted) => {
    const travelling = reduce_auto_search(armed_with(wanted), world(), 1000)
    const at = { x: travelling.command.x, z: travelling.command.z }
    const searching = reduce_auto_search(travelling, world({ player: at, search_armed: true }), 2000)
    const receipt = reduce_auto_search(
      searching,
      { type: 'zone_searched', zx: searching.target.zx, zy: searching.target.zy },
      3000
    )
    return { receipt, at, zone: { zx: searching.target.zx, zy: searching.target.zy } }
  }

  const mob = (zone, over = {}) => ({
    kind: 'mob',
    template_id: 'mob_a',
    name: 'Sewer Rat',
    zx: zone.zx,
    zy: zone.zy,
    x: 40,
    z: 0,
    ...over,
  })

  test('a matching row makes it run at the NEAREST matching group', () => {
    const { receipt, at, zone } = searched_state(['mob_a'])
    const rows = [
      mob(zone, { x: at.x + 90, z: at.z }),
      mob(zone, { x: at.x + 12, z: at.z, name: 'Sewer Rat' }),
      mob(zone, { template_id: 'mob_b', x: at.x + 1, z: at.z }), // unwanted, even though closest
    ]
    const approaching = reduce_auto_search(receipt, world({ player: at, markers: rows }), 3100)
    expect(approaching.phase).toBe('approach')
    expect(approaching.command.kind).toBe('walk')
    expect(approaching.command.x).toBe(at.x + 12)
    expect(approaching.armed).toBe(true) // still running until it arrives
  })

  test('arriving at the group emits the found popup and DISARMS the toggle', () => {
    const { receipt, at, zone } = searched_state(['mob_a'])
    const rows = [mob(zone, { x: at.x + 12, z: at.z })]
    const approaching = reduce_auto_search(receipt, world({ player: at, markers: rows }), 3100)
    const arrived = reduce_auto_search(
      approaching,
      world({ player: { x: at.x + 12 - ARRIVE_RADIUS_M / 2, z: at.z }, markers: rows }),
      3200
    )
    expect(arrived.command.kind).toBe('found')
    expect(arrived.command.name).toBe('Sewer Rat')
    expect(arrived.command.template_id).toBe('mob_a')
    expect(arrived.armed).toBe(false)
    expect(arrived.phase).toBe('found')
  })

  test('no matching row moves on to the next zone (never a second search on the same one)', () => {
    const { receipt, at, zone } = searched_state(['mob_a'])
    const rows = [mob(zone, { template_id: 'mob_b' })]
    const next = reduce_auto_search(receipt, world({ player: at, markers: rows }), 3100)
    expect(next.phase).toBe('travel')
    expect(zone_key_of(next.target.zx, next.target.zy)).not.toBe(zone_key_of(zone.zx, zone.zy))
  })

  test('an empty reveal waits out the row-ferry grace before giving up on the zone', () => {
    const { receipt, at } = searched_state(['mob_a'])
    const waiting = reduce_auto_search(receipt, world({ player: at, markers: [] }), 3100)
    expect(waiting.phase).toBe('scan')
    const gave_up = reduce_auto_search(receipt, world({ player: at, markers: [] }), 3000 + SCAN_GRACE_MS + 1)
    expect(gave_up.phase).toBe('travel')
  })
})

describe('the hard stops', () => {
  test('entering a fight disarms the loop and halts the walk', () => {
    const running = reduce_auto_search(armed_with(['mob_a']), world(), 1000)
    const halted = reduce_auto_search(running, { type: 'fight_entry' }, 1100)
    expect(halted.armed).toBe(false)
    expect(halted.phase).toBe('idle')
    expect(halted.command.kind).toBe('halt')
  })

  test('toggling off halts the walk in flight', () => {
    const running = reduce_auto_search(armed_with(['mob_a']), world(), 1000)
    const halted = reduce_auto_search(running, { type: 'toggle', value: false }, 1100)
    expect(halted.armed).toBe(false)
    expect(halted.command.kind).toBe('halt')
  })

  test('a disarmed scouter ignores world snapshots entirely (same state reference back)', () => {
    const idle = blank_auto_search()
    expect(reduce_auto_search(idle, world(), 1000)).toBe(idle)
  })
})
