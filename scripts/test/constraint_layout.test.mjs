// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { collapse_layout } from '../constraint_layout.mjs'

const different = (a, b) => a !== b

test('contradictions fail rather than deleting links or returning a partial layout', () => {
  expect(() =>
    collapse_layout({
      domains: [
        [0, 1],
        [0, 1],
        [0, 1],
      ],
      edges: [
        [0, 1],
        [1, 2],
        [2, 0],
      ],
      compatible: different,
      seed: 4,
    })
  ).toThrow('No compatible')
  expect(() => collapse_layout({ domains: [[0]], edges: [[0, 2]], compatible: different, seed: 4 })).toThrow(
    'absent parcel'
  )
  expect(() => collapse_layout({ domains: [[]], edges: [], compatible: different, seed: 4 })).toThrow('nonempty')
})

test('propagation respects pinned parcels and deterministically collapses every domain', () => {
  const input = {
    domains: [[0], [0, 1, 2], [1]],
    edges: [
      [0, 1],
      [1, 2],
    ],
    compatible: different,
    seed: 72,
  }
  expect(collapse_layout(input)).toEqual([0, 2, 1])
  expect(collapse_layout(input)).toEqual(collapse_layout(input))
  expect(input.domains).toEqual([[0], [0, 1, 2], [1]])
})

test('backtracking resolves a cycle that local propagation alone cannot choose', () => {
  const domains = Array.from({ length: 5 }, () => [0, 1, 2])
  const edges = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 0],
    [0, 2],
    [1, 3],
  ]
  for (let seed = 0; seed < 20; seed++) {
    const result = collapse_layout({ domains, edges, compatible: different, seed })
    edges.forEach(([a, b]) => expect(result[a]).not.toBe(result[b]))
  }
  expect(() => collapse_layout({ domains, edges, compatible: different, seed: 0, max_decisions: 1 })).toThrow('budget')
})
