// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import type { CharacterRow } from '@aresrpg/protocol'

import { gather_gate } from '../../src/game/gather_gate.ts'
import { resource_seats } from '../../src/game/resource_nodes.ts'

const character = (jobs: Record<string, string>, category?: string) =>
  ({
    jobs,
    equipment: category ? [{ slot: 'tool', category }] : [],
  }) as CharacterRow

describe('resource patches', () => {
  test('seats are deterministic, adjacent, and unique', () => {
    const first = resource_seats('world:1:2:r3', 22)
    expect(first).toEqual(resource_seats('world:1:2:r3', 22))
    expect(new Set(first.map(({ dx, dz }) => `${dx}:${dz}`)).size).toBe(22)
    first.forEach(({ dx, dz }) => expect(Math.max(Math.abs(dx), Math.abs(dz))).toBeLessThanOrEqual(3))
  })

  test('consumption preserves lower-ordinal seats', () => {
    expect(resource_seats('world:1:2:r3', 5).slice(0, 4)).toEqual([...resource_seats('world:1:2:r3', 4)])
  })
})

describe('gather affordance', () => {
  const resource = { job: 'MINER', tier: 4 }

  test('reports the level requirement before the missing tool', () => {
    expect(gather_gate(character({ MINER: '0' }), resource)).toEqual({
      ok: false,
      reason: 'level',
      job: 'MINER',
      level: 30,
    })
  })

  test('reports the tool only once the job level passes', () => {
    expect(gather_gate(character({ MINER: '999999999' }), resource)).toEqual({
      ok: false,
      reason: 'tool',
      job: 'MINER',
    })
  })

  test('accepts the matching equipped tool', () => {
    expect(gather_gate(character({ MINER: '999999999' }, 'tool_miner'), resource)).toEqual({ ok: true })
  })
})
