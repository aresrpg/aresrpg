// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE LIVENESS JOIN. The wire carries a zone's two facts apart — the seed's whole population
// once, the consumption bitmaps on every change — so this fold is what makes them one truth
// again. It is the seam where a wrong bit retires the wrong group, so it is sealed here rather
// than re-derived by each surface that renders a zone.

import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

import {
  live_mob_groups,
  live_resource_packs,
  travel_proof_ready,
  ZONE_RESEARCH_TTL_MS,
  type MobGroupRow,
  type ResourcePackRow,
} from '../src/packets.ts'

const group = (index: number): MobGroupRow => ({
  index,
  x: index * 10,
  z: index * 10,
  members: [{ mob_type: 'wooling', level_scalar: 50 }],
})

const pack = (index: number, nodes: number): ResourcePackRow => ({
  index,
  x: index * 10,
  z: index * 10,
  item_type: 'wheat',
  nodes,
})

describe('a zone joins its population with its consumption', () => {
  test('the client reroll clock matches the Move source constant', () => {
    const source = readFileSync(new URL('../../move/sources/zone.move', import.meta.url), 'utf8')
    const ttl = /const RESEARCH_TTL_MS: u64 = ([\d_]+);/.exec(source)?.[1]

    expect(Number(ttl?.replaceAll('_', ''))).toBe(ZONE_RESEARCH_TTL_MS)
  })

  test('a set bit retires exactly its own group', () => {
    const groups = [group(0), group(1), group(2), group(3)]

    // bits 1 and 3 — zone.move consume_mob_group sets `1 << index`
    const live = live_mob_groups(groups, { mob_taken: String(0b1010n), res_taken: [] })

    expect(live.map(({ index }) => index)).toEqual([0, 2])
    // the survivors are untouched, not rebuilt
    expect(live[0]).toBe(groups[0]!)
    expect(live[1]).toBe(groups[2]!)
  })

  test('an untouched zone keeps every group, and a u128 high bit still lands', () => {
    const groups = [group(0), group(70), group(127)]

    expect(live_mob_groups(groups, { mob_taken: '0', res_taken: [] })).toEqual(groups)
    expect(live_mob_groups(groups, { mob_taken: String(1n << 127n), res_taken: [] }).map(({ index }) => index)).toEqual(
      [0, 70]
    )
  })

  test('a pack reports what REMAINS, and an emptied pack stops existing', () => {
    const packs = [pack(0, 5), pack(1, 3), pack(2, 4)]

    const live = live_resource_packs(packs, { mob_taken: '0', res_taken: [2, 3] })

    // pack 0 gave up two nodes, pack 1 is exhausted, pack 2 was never touched
    expect(live.map(({ index, nodes }) => [index, nodes])).toEqual([
      [0, 3],
      [2, 4],
    ])
  })

  test('res_taken grows lazily on chain — an index past its end is simply untouched', () => {
    // zone.move pushes zeros up to the gathered index, so a short array is the common shape
    const packs = [pack(0, 2), pack(9, 6)]

    expect(
      live_resource_packs(packs, { mob_taken: '0', res_taken: [1] }).map(({ index, nodes }) => [index, nodes])
    ).toEqual([
      [0, 1],
      [9, 6],
    ])
  })

  test('the fold never mutates the population it was handed', () => {
    const packs = [pack(0, 5)]
    const snapshot = structuredClone(packs)

    live_resource_packs(packs, { mob_taken: '0', res_taken: [4] })

    expect(packs).toEqual(snapshot)
  })
})

describe('the client travel gate mirrors the chain proof', () => {
  const proof = (overrides: Partial<Parameters<typeof travel_proof_ready>[0]> = {}) =>
    travel_proof_ready({
      from_x: 0,
      from_z: 0,
      from_ms: 0,
      pet_at_start: false,
      to_x: 0,
      to_z: 0,
      now_ms: 1_000,
      pet_now: false,
      ...overrides,
    })

  test('uses the same floored Euclidean budget as Move', () => {
    expect(proof({ to_x: 11 })).toBeTrue()
    expect(proof({ to_x: 12 })).toBeFalse()
    expect(proof({ to_x: 7, to_z: 8 })).toBeTrue()
    expect(proof({ to_x: 8, to_z: 8 })).toBeFalse()
  })

  test('grants pet speed only when both ends of the checkpoint leg have a pet', () => {
    expect(proof({ pet_at_start: true, pet_now: true, to_x: 17 })).toBeTrue()
    expect(proof({ pet_at_start: true, pet_now: true, to_x: 18 })).toBeFalse()
    expect(proof({ pet_at_start: false, pet_now: true, to_x: 17 })).toBeFalse()
    expect(proof({ pet_at_start: true, pet_now: false, to_x: 17 })).toBeFalse()
  })

  test('refuses a future or malformed checkpoint instead of guessing', () => {
    expect(proof({ from_ms: 1_001 })).toBeFalse()
    expect(proof({ from_x: Number.NaN })).toBeFalse()
  })
})
