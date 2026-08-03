// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1993 WP5 — THE CAST-RESOLUTION RECORD's own law. The #1859 seal (the two homes that used to answer the same
// landing differently, driven through the real receipt producer) lives in
// `packages/frontend/test/world-shell/cast_landing_one_home.test.js`; this file pins the record's rules.

import { describe, expect, test } from 'bun:test'

import { cast_resolution, empty_cast_resolution } from '../src/cast_record.js'

const cast = (payload = {}) => ({ kind: 'cast', payload: { entity_id: 'p0', target: { x: 7, y: 8 }, ...payload } })
const beat = (kind, payload = {}) => ({ kind, payload })

describe('landed — the one verdict', () => {
  test('nothing behind the cast, nothing on it: no landing', () => {
    const record = cast_resolution(cast(), [beat('arrival', { entity_id: 'p0' })])

    expect(record).toMatchObject({ landed: false, target_ids: [], target_cells: [], kinds: [] })
    expect(record.aim_cell).toEqual({ x: 7, y: 8 })
  })

  test('no cast at all yields the empty record', () => {
    expect(cast_resolution(null)).toEqual(empty_cast_resolution())
  })

  test('a self-buff resolves on the caster, with no sibling beat behind it', () => {
    const record = cast_resolution(cast({ effects: [{ status: 'INVISIBILITY' }] }), [], () => ({ x: 4, y: 8 }))

    expect(record).toMatchObject({ landed: true, target_ids: ['p0'], target_cells: [{ x: 4, y: 8 }] })
  })

  test('a status row the cast carries names ITS subject — a debuff is not the caster’s cell', () => {
    const cells = { p0: { x: 4, y: 8 }, m1: { x: 9, y: 8 } }
    const record = cast_resolution(
      cast({ effects: [{ status: 'POISON', target_id: 'm1' }] }),
      [],
      (id) => cells[id] ?? null
    )

    expect(record).toMatchObject({ target_ids: ['m1'], target_cells: [{ x: 9, y: 8 }] })
  })

  test('an absorbed 0-damage hit still CONNECTED — a body was there', () => {
    const record = cast_resolution(cast(), [beat('damage', { target_id: 'm1', damage: 0 })], () => ({ x: 9, y: 8 }))

    expect(record.landed).toBe(true)
  })

  test('a FULLY DODGED drain landed nothing — kind alone cannot see that', () => {
    const dodged = cast_resolution(cast(), [beat('status', { target_id: 'm1', status: 'DRAIN', landed: 0, dodged: 2 })])
    const partial = cast_resolution(cast(), [
      beat('status', { target_id: 'm1', status: 'DRAIN', landed: 1, dodged: 1 }),
    ])

    expect(dodged.landed).toBe(false)
    expect(partial.landed).toBe(true)
  })

  test('a displacement that never left its cell moved no one', () => {
    const blocked = cast_resolution(cast(), [
      beat('displacement', { target_id: 'm1', from: { x: 9, y: 8 }, to: { x: 9, y: 8 }, blocked: 3 }),
    ])
    const shoved = cast_resolution(cast(), [
      beat('displacement', { target_id: 'm1', from: { x: 9, y: 8 }, to: { x: 11, y: 8 } }),
    ])

    expect(blocked.landed).toBe(false)
    expect(shoved.landed).toBe(true)
  })
})

describe('attribution — a cast owns only its own resolution', () => {
  test('the scan stops at the next ACTION: a later cast’s victims are not this cast’s', () => {
    expect(cast_resolution(cast(), [beat('cast'), beat('damage', { target_id: 'm1' })]).landed).toBe(false)
  })

  test('the scan stops at a MOVE: the walk’s trap detonation is the walk’s, not the cast’s (#1859)', () => {
    const following = [
      beat('move', { entity_id: 'p0' }),
      beat('arrival', { entity_id: 'p0' }),
      beat('trap_trigger', { target_id: 'p0', cell: { x: 6, y: 8 } }),
      beat('damage', { target_id: 'p0', damage: 7 }),
    ]

    expect(cast_resolution(cast(), following).landed).toBe(false)
  })
})

describe('cells — resolved once, never invented', () => {
  test('a beat that carries its own cell is believed; a victim without one is looked up ONCE', () => {
    const following = [
      beat('trap_place', { entity_id: 'p0', cell: { x: 7, y: 8 } }),
      beat('damage', { target_id: 'm1', damage: 12 }),
    ]
    let lookups = 0
    const record = cast_resolution(cast(), following, (id) => {
      lookups += 1
      return id === 'm1' ? { x: 12, y: 8 } : null
    })

    expect(record.target_ids).toEqual(['p0', 'm1'])
    expect(record.target_cells).toEqual([
      { x: 7, y: 8 },
      { x: 12, y: 8 },
    ])
    expect(lookups).toBe(1)
  })

  test('a displacement is struck where the body STOOD, not where the push put it', () => {
    const record = cast_resolution(cast(), [
      beat('displacement', { target_id: 'm1', from: { x: 9, y: 8 }, to: { x: 11, y: 8 } }),
    ])

    expect(record.target_cells).toEqual([{ x: 9, y: 8 }])
  })

  test('two victims sharing one cell splash it once; ids stay both', () => {
    const record = cast_resolution(
      cast(),
      [beat('damage', { target_id: 'm1' }), beat('status', { target_id: 'm2', status: 'POISON' })],
      () => ({ x: 9, y: 8 })
    )

    expect(record.target_ids).toEqual(['m1', 'm2'])
    expect(record.target_cells).toEqual([{ x: 9, y: 8 }])
  })

  test('THE AIM IS NOT A LANDING: an unoccupied aim cell never enters the struck set', () => {
    const record = cast_resolution(cast({ target: { x: 7, y: 8 } }), [beat('damage', { target_id: 'm1' })], () => ({
      x: 12,
      y: 8,
    }))

    expect(record.aim_cell).toEqual({ x: 7, y: 8 })
    expect(record.target_cells).toEqual([{ x: 12, y: 8 }])
  })
})
