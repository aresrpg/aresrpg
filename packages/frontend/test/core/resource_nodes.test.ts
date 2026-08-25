// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import type { CharacterRow } from '@aresrpg/protocol'

import { gather_gate } from '../../src/game/gather_gate.ts'
import { resource_markers, resource_seats, resource_tag_ids } from '../../src/game/resource_nodes.ts'
import { gather_progress } from '../../src/game/hud/GatherProgress.tsx'
import { gather_completion_ready } from '../../src/modules/world_gather.ts'

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

  test('each consumed count removes the matching outer visual node', () => {
    const pack = {
      id: 'world:1:2:r3',
      x: 10,
      z: 20,
      item_type: 'ivory_shrooms',
      job: 'HERBALIST',
      tier: 3,
      nodes: 4,
    }
    const before = resource_markers([pack], () => 0)
    const after = resource_markers([{ ...pack, nodes: 3 }], () => 0)

    expect(before.map(({ id }) => id)).toEqual([
      'world:1:2:r3:n0',
      'world:1:2:r3:n1',
      'world:1:2:r3:n2',
      'world:1:2:r3:n3',
    ])
    expect(after.map(({ id }) => id)).toEqual(before.slice(0, 3).map(({ id }) => id))
  })

  test('one pack has one stable central tag across all decorative seats', () => {
    const markers = resource_seats('world:1:2:r3', 4).map(({ dx, dz }, ordinal) => ({
      id: `world:1:2:r3:n${ordinal}`,
      x: dx,
      y: 0,
      z: dz,
      item_type: 'quartz',
      job: 'MINER',
      tier: 1,
    }))

    expect(resource_tag_ids(markers, { x: 49, z: 0 })).toEqual(['world:1:2:r3:n0'])
    expect(resource_tag_ids(markers, { x: 51, z: 0 })).toEqual([])
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

  test('projects the centered gathering bar from the current root deadline', () => {
    const gathering = {
      character_id: '0xc',
      item_type: 'ivory_shrooms',
      protector: 'protector_ivory_gaia',
      started_at_ms: 1_000,
      duration_ms: 12_000,
      ends_at_ms: 13_000,
      confirmed: true,
      authoritative: true,
      ambushed: false,
      quantity: 7,
    }
    expect(gather_progress(gathering, 4_000)).toEqual({ percent: 25, remaining_seconds: 9 })
    expect(gather_progress(gathering, 13_000)).toEqual({ percent: 100, remaining_seconds: 0 })
    expect(gather_completion_ready(gathering, 12_999)).toBeFalse()
    expect(gather_completion_ready(gathering, 13_000)).toBeTrue()
  })
})
