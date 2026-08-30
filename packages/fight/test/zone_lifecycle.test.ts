// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { kill_fighter } from '../src/fighters.ts'
import { create_runtime } from '../src/runtime.ts'
import type { BoardZone } from '../src/types.ts'

import { create_fixture } from './helpers.ts'

test('death removes every zone owned by the fighter before another turn can use it', () => {
  const checkpoint = structuredClone(create_fixture().checkpoint)
  const zone = (owner_fighter: bigint, trap: boolean): BoardZone => ({
    owner_fighter,
    trap,
    shape: 0n,
    size: 0n,
    anchor: checkpoint.contract.fighters[1]!.cell,
    turns_left: trap ? 0n : 2n,
    effects: [],
  })
  checkpoint.contract.zones = [zone(0n, false), zone(0n, true), zone(1n, false)]
  const runtime = create_runtime(checkpoint)

  kill_fighter(runtime, 0n, 1n, 'spell')

  expect(runtime.contract.zones).toEqual([zone(1n, false)])
  expect(runtime.render_actions.filter(({ type }) => type === 'zone_removed')).toEqual([
    { type: 'zone_removed', payload: { zone_id: 'initial:zone:0', kind: 'glyph', reason: 'owner_died' } },
    { type: 'zone_removed', payload: { zone_id: 'initial:zone:1', kind: 'trap', reason: 'owner_died' } },
  ])
})
