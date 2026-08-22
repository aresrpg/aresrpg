// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE LIVENESS JOIN. The wire carries a zone's two facts apart — the seed's whole population
// once, the consumption bitmaps on every change — so this fold is what makes them one truth
// again. It is the seam where a wrong bit retires the wrong group, so it is sealed here rather
// than re-derived by each surface that renders a zone.

import { describe, expect, test } from 'bun:test'

import { live_mob_groups, live_resource_packs, type MobGroupRow, type ResourcePackRow } from '../src/packets.ts'

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
