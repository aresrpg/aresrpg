// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FAST-TRAVEL STORE — proves the pure phase machine + the ROUTING LAW (plan §2-①/§3.1). The reducer is tested
// directly (like presence's reduce_presence): begin gates, same-world fly, foreign-world join, the level +
// non-catalog realm refusals, /v1-first (a live p2p pos with a mismatched world never flies), retarget/lost/
// cancel/reset. No store, no effects.
import { describe, expect, test } from 'bun:test'

import { ft_active, ft_flight_target, initial_ft_state, reduce_fast_travel } from './fast_travel_store.js'

const run = (state, ...inputs) => inputs.reduce((s, i) => reduce_fast_travel(s, i), state)
const begin = { type: 'begin', character_id: 'C_TARGET', address: '0xbob', name: 'Bob' }

const resolved = (over = {}) => ({
  type: 'resolved',
  world_id: 'W_MINE',
  x: 120,
  z: -40,
  live: true,
  my_world_id: 'W_MINE',
  my_level: 30,
  required_level: 1,
  catalog_has_world: true,
  ...over,
})

describe('begin — idle → resolving, target seeded', () => {
  test('seeds the target skeleton and clears any prior refusal', () => {
    const s = reduce_fast_travel({ ...initial_ft_state(), refusal: 'stale' }, begin)
    expect(s.phase).toBe('resolving')
    expect(s.refusal).toBeNull()
    expect(s.target).toMatchObject({ character_id: 'C_TARGET', address: '0xbob', name: 'Bob' })
  })
  test('a begin without a character id is ignored', () => {
    const s = reduce_fast_travel(initial_ft_state(), { type: 'begin', name: 'x' })
    expect(s.phase).toBe('idle')
  })
  test('begin keeps the address-only fallback for unresolved player targets', () => {
    const s = reduce_fast_travel(initial_ft_state(), { type: 'begin', address: '0xfriend', name: 'Al' })
    expect(s.phase).toBe('resolving')
    expect(s.target).toMatchObject({ character_id: null, address: '0xfriend', name: 'Al' })
  })
  test('begin preserves a friend entry live route for the shared resolve edge', () => {
    const s = reduce_fast_travel(initial_ft_state(), {
      ...begin,
      world_id: 'W_FAR',
      x: 42,
      z: -7,
      live: true,
    })
    expect(s.phase).toBe('resolving')
    expect(s.target).toMatchObject({ character_id: 'C_TARGET', world_id: 'W_FAR', x: 42, z: -7, live: true })
  })
  test('re-begin while active is refused (no clobber)', () => {
    const flying = run(initial_ft_state(), begin, resolved())
    expect(flying.phase).toBe('flying')
    const again = reduce_fast_travel(flying, { type: 'begin', character_id: 'C_OTHER', name: 'Eve' })
    expect(again).toBe(flying) // unchanged reference — re-begin is a no-op
  })
  test('friend preflight refusal is idle-guarded, repeatable, and never clobbers an active trip', () => {
    const offline = { type: 'begin', refusal: 'fast_travel.friend_offline' }
    const first = reduce_fast_travel(initial_ft_state(), offline)
    const repeated = reduce_fast_travel(first, offline)
    expect(first).toMatchObject({ phase: 'idle', refusal: 'fast_travel.friend_offline', refusal_seq: 1 })
    expect(repeated).toMatchObject({ phase: 'idle', refusal: 'fast_travel.friend_offline', refusal_seq: 2 })

    const flying = run(initial_ft_state(), begin, resolved())
    expect(reduce_fast_travel(flying, offline)).toBe(flying)
  })
})

describe('resolved — the routing law', () => {
  test('same /v1 world → flying, coordinate + live flag adopted', () => {
    const s = run(initial_ft_state(), begin, resolved({ x: 7, z: 8, live: true }))
    expect(s.phase).toBe('flying')
    expect(s.target).toMatchObject({ world_id: 'W_MINE', x: 7, z: 8, live: true })
  })
  test('foreign world, gated open → joining (needs the world-join tx)', () => {
    const s = run(initial_ft_state(), begin, resolved({ world_id: 'W_FAR', my_level: 40, required_level: 20 }))
    expect(s.phase).toBe('joining')
    expect(s.target?.world_id).toBe('W_FAR')
  })
  test('foreign world, level too low → refused (realm unreachable), back to idle', () => {
    const s = run(initial_ft_state(), begin, resolved({ world_id: 'W_FAR', my_level: 10, required_level: 20 }))
    expect(s.phase).toBe('idle')
    expect(s.refusal).toBe('fast_travel.realm_unreachable')
  })
  test('foreign world NOT in the catalog (dungeon/unknown) → refused (B3)', () => {
    const s = run(
      initial_ft_state(),
      begin,
      resolved({ world_id: 'W_DUNGEON', catalog_has_world: false, required_level: null, my_level: 99 })
    )
    expect(s.phase).toBe('idle')
    expect(s.refusal).toBe('fast_travel.realm_unreachable')
  })
  test('/v1-FIRST: a live p2p position with a mismatched /v1 world must NOT fly', () => {
    // p2p is world-blind — a same-coords peer in another world would look co-located. The foreign /v1 world
    // must force the join path (or a refusal), NEVER a same-world flight, even though live:true is present.
    const s = run(
      initial_ft_state(),
      begin,
      resolved({ world_id: 'W_FAR', live: true, my_level: 40, required_level: 5 })
    )
    expect(s.phase).not.toBe('flying')
    expect(s.phase).toBe('joining')
  })
  test('/v1-FIRST: the resolved document replaces a stale roster world hint', () => {
    const hinted = { ...begin, world_id: 'W_STALE', x: 42, z: -7, live: true }
    const s = run(
      initial_ft_state(),
      hinted,
      resolved({ world_id: 'W_FAR', live: true, my_level: 40, required_level: 5 })
    )
    expect(s.phase).toBe('joining')
    expect(s.target?.world_id).toBe('W_FAR')
  })
  test('an address-only begin learns its character id from the /v1 resolve', () => {
    const s = run(
      initial_ft_state(),
      { type: 'begin', address: '0xfriend', name: 'Al' },
      resolved({ character_id: 'C_RESOLVED' })
    )
    expect(s.target?.character_id).toBe('C_RESOLVED')
  })
  test('a resolve arriving after cancel is ignored (phase no longer resolving)', () => {
    const s = run(initial_ft_state(), begin, { type: 'cancel' }, resolved())
    expect(s.phase).toBe('idle')
  })
  test('a late async refusal after cancel is ignored', () => {
    const cancelled = run(initial_ft_state(), begin, { type: 'cancel' })
    expect(reduce_fast_travel(cancelled, { type: 'refused', reason: 'late' })).toBe(cancelled)
  })
})

describe('cross-world sequencing', () => {
  test('world_joined only advances from joining; boot_ready only from awaiting_boot', () => {
    const joining = run(initial_ft_state(), begin, resolved({ world_id: 'W_FAR', my_level: 40, required_level: 20 }))
    expect(reduce_fast_travel(joining, { type: 'boot_ready' })).toBe(joining) // premature boot ignored
    const awaiting = reduce_fast_travel(joining, { type: 'world_joined' })
    expect(awaiting.phase).toBe('awaiting_boot')
    const flying = reduce_fast_travel(awaiting, { type: 'boot_ready' })
    expect(flying.phase).toBe('flying')
  })
})

describe('flight-phase inputs', () => {
  const flying = () => run(initial_ft_state(), begin, resolved({ x: 0, z: 0, live: false }))
  test('retarget updates the coordinate and marks it live (only while flying)', () => {
    const s = reduce_fast_travel(flying(), { type: 'retarget', x: 99, z: 12 })
    expect(s.target).toMatchObject({ x: 99, z: 12, live: true })
    // no retarget before flight — the routing law bars a pre-flight p2p drive
    const resolving = reduce_fast_travel(initial_ft_state(), begin)
    expect(reduce_fast_travel(resolving, { type: 'retarget', x: 1, z: 1 })).toBe(resolving)
  })
  test('target_lost freezes at last-known (live=false) but stays flying', () => {
    const s = reduce_fast_travel(flying(), { type: 'target_lost' })
    expect(s.phase).toBe('flying')
    expect(s.target?.live).toBe(false)
  })
  test('arrived → landing', () => {
    expect(reduce_fast_travel(flying(), { type: 'arrived' }).phase).toBe('landing')
  })
})

describe('cancel / reset', () => {
  test('cancel from an active phase clears to idle; from idle it is a no-op', () => {
    const flying = run(initial_ft_state(), begin, resolved())
    expect(reduce_fast_travel(flying, { type: 'cancel' }).phase).toBe('idle')
    const idle = initial_ft_state()
    expect(reduce_fast_travel(idle, { type: 'cancel' })).toBe(idle)
  })
  test('reset wipes target + refusal', () => {
    const s = reduce_fast_travel({ phase: 'landing', target: { x: 1 }, refusal: null }, { type: 'reset' })
    expect(s).toEqual(initial_ft_state())
  })
})

describe('selectors', () => {
  test('ft_active is true off idle; ft_flight_target only in flying/landing', () => {
    expect(ft_active({ phase: 'idle' })).toBe(false)
    expect(ft_active({ phase: 'joining' })).toBe(true)
    expect(ft_flight_target({ phase: 'joining', target: { x: 1, z: 2 } })).toBeNull()
    const flying = run(initial_ft_state(), begin, resolved({ x: 5, z: 6, live: true }))
    expect(ft_flight_target(flying)).toMatchObject({ x: 5, z: 6, live: true, landing: false })
  })
})
